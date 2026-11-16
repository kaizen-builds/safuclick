/* SafuWallet: an in-page, EIP-1193-style MOCK wallet for testing.
 * - No real keys, no chain. Every request opens a plain-DOM popup that shows
 *   origin, method, decoded action, spender and amount in readable text, so a
 *   browser agent (Kane CLI) can read and click it like any web button.
 * - Every request, decision and suspicious input is logged to the SafuClick
 *   collector, which the verdict uses as evidence.
 */
(function () {
  'use strict';
  var COLLECTOR = window.__SAFU_COLLECTOR__ || 'http://127.0.0.1:4199/log';
  var ACCOUNT = '0x7e57000000000000000000000000000000000001'; // test-only address
  var MAX = (1n << 256n) - 1n;
  var params = new URLSearchParams(location.search);
  var runId = params.get('safu_run') || sessionStorage.getItem('safu_run') || 'manual';
  sessionStorage.setItem('safu_run', runId);
  var seq = 0;

  function log(type, data) {
    var entry = Object.assign({ run: runId, seq: ++seq, ts: new Date().toISOString(), type: type, origin: location.origin, href: location.href }, data || {});
    window.__safuLog = window.__safuLog || [];
    window.__safuLog.push(entry);
    try {
      fetch(COLLECTOR, { method: 'POST', mode: 'cors', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(entry) });
    } catch (e) { /* collector offline: entry still in window.__safuLog */ }
  }

  var MAX160 = (1n << 160n) - 1n;
  var TOKENS = {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18 },
  };
  var NFTS = { '0xc36442b4a4522e871399cd717abdd847ab11fe88': 'Uniswap V3 Positions NFT' };
  var NAMES = {
    '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Permit2',
    '0x5afe5afe00000000000000000000000000c0ffee': 'SafuSwap Router',
    '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b': 'MetaMask EIP-7702 delegator',
  };
  var short = function (a) { a = String(a || ''); return a.length > 14 ? a.slice(0, 8) + '…' + a.slice(-4) : a; };
  var named = function (a) { a = String(a || '').toLowerCase(); var n = NAMES[a] || (TOKENS[a] && TOKENS[a].symbol) || NFTS[a]; return n ? a + ' (' + n + ')' : a; };

  function fmtUnits(raw, decimals) {
    var s = raw.toString().padStart(decimals + 1, '0');
    var whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, '');
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac ? whole + '.' + frac : whole;
  }
  // "Unlimited" = MAX_UINT256, MAX_UINT160 (Permit2), or anything at least half of either.
  function isUnlimited(amt) { return amt >= MAX160 / 2n; }
  function human(amt, tokenAddr) {
    var t = TOKENS[String(tokenAddr || '').toLowerCase()];
    var sym = t ? t.symbol : 'tokens';
    return isUnlimited(amt) ? 'UNLIMITED ' + sym : fmtUnits(amt, t ? t.decimals : 18) + ' ' + sym;
  }
  var word = function (data, i) { return data.slice(10 + i * 64, 10 + (i + 1) * 64); };
  var wAddr = function (data, i) { return '0x' + word(data, i).slice(24); };
  var wInt = function (data, i) { var w = word(data, i); return w ? BigInt('0x' + w) : 0n; };

  // Decode one contract call (eth_sendTransaction, or one call inside a wallet_sendCalls batch).
  function decodeTx(tx) {
    var data = (tx.data || '0x').toLowerCase();
    var to = (tx.to || '').toLowerCase();
    var sel = data.slice(0, 10);
    var token = TOKENS[to];
    var sym = token ? token.symbol : (NFTS[to] || 'tokens');
    var base = { to: to, selector: sel, token: sym };
    if (sel === '0x095ea7b3' || sel === '0x39509351' || sel === '0xd73dd623') {
      var spender = wAddr(data, 0), amt = wInt(data, 1);
      var kind = sel === '0x095ea7b3' ? 'approve' : sel === '0x39509351' ? 'increaseAllowance' : 'increaseApproval';
      var label = kind === 'approve' ? 'Approve token spending' : 'Increase allowance (' + kind + ')';
      return Object.assign(base, { kind: kind, label: label, spender: spender, amountRaw: amt.toString(), amountHuman: human(amt, to), unlimited: isUnlimited(amt), additive: kind !== 'approve' });
    }
    if (sel === '0xa22cb465') {
      var operator = wAddr(data, 0), approved = wInt(data, 1) !== 0n;
      return Object.assign(base, { kind: 'setApprovalForAll', label: 'setApprovalForAll (' + (approved ? 'GRANT access to ALL NFTs' : 'remove access') + ')', collection: NFTS[to] || to, operator: operator, spender: operator, approved: approved, amountHuman: approved ? 'ALL ' + (NFTS[to] || 'NFTs') : 'none (revoke)', unlimited: approved });
    }
    if (sel === '0xa9059cbb') {
      var amtT = wInt(data, 1);
      return Object.assign(base, { kind: 'transfer', label: 'Transfer tokens', recipient: wAddr(data, 0), spender: wAddr(data, 0), amountRaw: amtT.toString(), amountHuman: human(amtT, to) });
    }
    if (sel === '0x23b872dd') {
      var amtF = wInt(data, 2);
      return Object.assign(base, { kind: 'transferFrom', label: 'transferFrom (move tokens out of an account)', from: wAddr(data, 0), recipient: wAddr(data, 1), spender: wAddr(data, 1), amountRaw: amtF.toString(), amountHuman: NFTS[to] ? 'NFT #' + amtF : human(amtF, to) });
    }
    if (sel === '0x38ed1739') {
      var amtIn = wInt(data, 0);
      return Object.assign(base, { kind: 'swap', label: 'Swap', token: 'USDC', amountRaw: amtIn.toString(), amountHuman: fmtUnits(amtIn, 6) + ' USDC', spender: to });
    }
    return Object.assign(base, { kind: 'unknown', label: 'Unknown contract call', amountHuman: 'unknown', spender: to });
  }

  // Decode eth_signTypedData_v4 (params[1]): EIP-2612 Permit, Permit2 PermitSingle/PermitBatch,
  // Permit2 SignatureTransfer, or generic typed data with a spender/operator field.
  function decodeTyped(raw) {
    var td; try { td = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return { kind: 'typed', scheme: 'unparseable typed data', permits: [], raw: String(raw).slice(0, 300) }; }
    td = td || {};
    var m = td.message || {}, dom = td.domain || {}, pt = td.primaryType || '';
    var vc = String(dom.verifyingContract || '').toLowerCase();
    var out = { kind: 'typed', primaryType: pt, domainName: dom.name || '', verifyingContract: vc, chainId: dom.chainId, scheme: 'typed data', permits: [] };
    var now = Math.floor(Date.now() / 1000);
    function push(tokenAddr, spender, amount, expiry) {
      var amt = BigInt(amount || 0); var exp = Number(expiry || 0);
      out.permits.push({ token: String(tokenAddr || '').toLowerCase(), tokenSymbol: (TOKENS[String(tokenAddr || '').toLowerCase()] || {}).symbol || 'tokens', spender: String(spender || '').toLowerCase(), amountRaw: amt.toString(), amountHuman: human(amt, tokenAddr), unlimited: isUnlimited(amt), expiry: exp, expiryIso: exp ? new Date(exp * 1000).toISOString().slice(0, 10) : null, expiryDays: exp ? Math.round((exp - now) / 86400) : null });
    }
    if (pt === 'Permit' && m.spender) { out.scheme = 'EIP-2612 Permit'; push(vc, m.spender, m.value, m.deadline); }
    else if (pt === 'PermitSingle') { out.scheme = 'Permit2 PermitSingle'; var d = m.details || {}; push(d.token, m.spender, d.amount, d.expiration || m.sigDeadline); out.sigDeadline = Number(m.sigDeadline || 0); }
    else if (pt === 'PermitBatch') { out.scheme = 'Permit2 PermitBatch'; (m.details || []).forEach(function (d) { push(d.token, m.spender, d.amount, d.expiration || m.sigDeadline); }); out.sigDeadline = Number(m.sigDeadline || 0); }
    else if (pt === 'PermitTransferFrom' || pt === 'PermitBatchTransferFrom' || pt === 'PermitWitnessTransferFrom') {
      out.scheme = 'Permit2 SignatureTransfer (' + pt + ')';
      [].concat(m.permitted || []).forEach(function (pm) { push(pm.token, m.spender, pm.amount, m.deadline); });
    } else if (m.spender || m.operator) { out.scheme = 'typed data with a spender'; push(vc, m.spender || m.operator, m.value || m.amount || 0, m.deadline || m.expiry); }
    out.isPermit = out.permits.length > 0 || /permit/i.test(pt) || /permit2/i.test(out.domainName);
    return out;
  }

  function decodeBatch(req) {
    req = req || {};
    var calls = (req.calls || []).map(function (c) { return decodeTx(c); });
    var caps = req.capabilities || {};
    var auth = caps.eip7702Auth || caps.eip7702 || null;
    var delegator = auth && (auth.address || auth.delegator) ? String(auth.address || auth.delegator).toLowerCase() : null;
    return { kind: 'batch', method: 'wallet_sendCalls', atomic: req.atomicRequired !== false, callCount: calls.length, calls: calls, delegation: delegator ? { delegator: delegator, name: NAMES[delegator] || null } : null };
  }

  function popup(rows, title) {
    return new Promise(function (resolve) {
      var old = document.getElementById('safu-wallet-popup'); if (old) old.remove();
      var el = document.createElement('div');
      el.id = 'safu-wallet-popup';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'SafuWallet popup');
      el.innerHTML =
        '<div class="sw-card"><div class="sw-head"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f6851b;margin-right:7px;vertical-align:middle"></span>SafuWallet <span class="sw-badge">TEST WALLET</span></div>' +
        '<div class="sw-title">' + title + '</div>' +
        rows.map(function (r) { return '<div class="sw-row"><span class="sw-k">' + r[0] + ':</span> <span class="sw-v" data-field="' + r[0].toLowerCase() + '">' + r[1] + '</span></div>'; }).join('') +
        '<div class="sw-btns"><button id="safu-wallet-reject" type="button">Reject</button><button id="safu-wallet-confirm" type="button">Confirm</button></div></div>';
      document.body.appendChild(el);
      el.querySelector('#safu-wallet-confirm').onclick = function () { el.remove(); resolve(true); };
      el.querySelector('#safu-wallet-reject').onclick = function () { el.remove(); resolve(false); };
    });
  }

  var css = document.createElement('style');
  css.textContent = '#safu-wallet-popup{position:fixed;top:16px;right:16px;z-index:99999;font:14px/1.45 system-ui,sans-serif}' +
    '.sw-card{background:#fff;color:#111;border:2px solid #f6851b;border-radius:14px;width:360px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
    '.sw-head{font-weight:700;margin-bottom:6px}.sw-badge{background:#fde68a;border-radius:6px;padding:1px 6px;font-size:11px;margin-left:6px}' +
    '.sw-title{font-size:16px;font-weight:700;margin:6px 0 10px}.sw-row{margin:4px 0;word-break:break-all}.sw-k{color:#555}' +
    '.sw-btns{display:flex;gap:10px;margin-top:14px}.sw-btns button{flex:1;padding:10px;border-radius:10px;border:0;font-weight:700;cursor:pointer}' +
    '#safu-wallet-reject{background:#e5e7eb}#safu-wallet-confirm{background:#f6851b;color:#fff}';
  document.documentElement.appendChild(css);

  function randHash() { return '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  var connected = false;
  var listeners = {};
  async function request(args) {
    var method = args && args.method, p = (args && args.params) || [];
    log('wallet_request', { method: method, params: p });
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_accounts') return connected ? [ACCOUNT] : [];
    if (method === 'eth_requestAccounts') {
      var ok = await popup([['Site', location.origin], ['Request', 'Connect account'], ['Account', ACCOUNT]], 'Connect to this site?');
      log('wallet_decision', { method: method, approved: ok });
      if (!ok) throw Object.assign(new Error('User rejected'), { code: 4001 });
      connected = true; (listeners.accountsChanged || []).forEach(function (f) { f([ACCOUNT]); });
      return [ACCOUNT];
    }
    if (method === 'wallet_getCapabilities') return { '0xaa36a7': { atomic: { status: 'supported' } } };
    if (method === 'eth_sendTransaction') {
      var d = decodeTx(p[0] || {});
      log('tx_decoded', { decoded: d });
      var rows = [['Site', location.origin], ['Request', 'Send transaction'], ['Action', d.label], ['Contract', named(d.to)]];
      if (d.kind === 'setApprovalForAll') { rows.push(['Operator', d.operator]); rows.push(['Approved', d.approved ? 'TRUE (operator can move ALL your NFTs in this collection)' : 'false']); }
      else rows.push([d.kind === 'transfer' || d.kind === 'transferFrom' ? 'Recipient' : 'Spender', d.spender]); // for a swap, the router contract that pulls your tokens
      rows.push(['Amount', d.amountHuman + (d.additive ? ' (ADDED on top of any existing allowance)' : '')]);
      var title = d.kind === 'approve' ? 'Allow token spending?' : d.additive ? 'Allow MORE token spending?' : d.kind === 'setApprovalForAll' ? (d.approved ? 'Give access to ALL your NFTs?' : 'Remove NFT access?') : 'Confirm transaction';
      var ok2 = await popup(rows, title);
      log('wallet_decision', { method: method, approved: ok2, decoded: d });
      if (!ok2) throw Object.assign(new Error('User rejected'), { code: 4001 });
      return randHash();
    }
    if (method === 'wallet_sendCalls') {
      var b = decodeBatch(p[0]);
      log('batch_decoded', { decoded: b });
      var brows = [['Site', location.origin], ['Request', 'Batch: ' + b.callCount + ' actions in ONE confirm (wallet_sendCalls)']];
      if (b.delegation) brows.push(['Account upgrade', 'EIP-7702 delegation to ' + named(b.delegation.delegator)]);
      b.calls.forEach(function (c, i) {
        var who = c.kind === 'setApprovalForAll' ? 'operator ' + c.operator + ', approved ' + (c.approved ? 'TRUE' : 'false') : c.kind === 'swap' ? 'via ' + short(c.to) : (c.kind === 'transfer' || c.kind === 'transferFrom' ? 'to ' : 'spender ') + c.spender;
        brows.push(['Action ' + (i + 1), c.label + ': ' + c.amountHuman + ' (' + c.token + '), ' + who]);
      });
      var okB = await popup(brows, 'Confirm ' + b.callCount + ' actions?');
      log('wallet_decision', { method: method, approved: okB, decoded: b });
      if (!okB) throw Object.assign(new Error('User rejected'), { code: 4001 });
      return { id: randHash() };
    }
    if (method === 'eth_signAuthorization' || method === 'wallet_signAuthorization') {
      // Gym-only stand-in for an EIP-7702 authorization request (no standard dApp RPC exists yet).
      var a7 = p[0] || {};
      var auth = { kind: 'eip7702_authorization', delegator: String(a7.address || a7.contractAddress || '').toLowerCase(), chainId: a7.chainId, nonce: a7.nonce };
      auth.name = NAMES[auth.delegator] || null;
      log('auth_decoded', { decoded: auth });
      var okA = await popup([['Site', location.origin], ['Request', 'EIP-7702 account delegation'], ['Delegate to', named(auth.delegator)], ['Effect', 'This contract can run ANY action from your account']], 'Upgrade your account?');
      log('wallet_decision', { method: method, approved: okA, decoded: auth });
      if (!okA) throw Object.assign(new Error('User rejected'), { code: 4001 });
      return '0x' + '00'.repeat(65);
    }
    if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData_v3' || method === 'eth_signTypedData') {
      var s = decodeTyped(p[1] !== undefined ? p[1] : p[0]);
      log('sig_decoded', { method: method, decoded: s });
      var srows = [['Site', location.origin], ['Request', 'Sign typed data (no gas, no transaction)'], ['Signature type', s.scheme + (s.primaryType ? ' / ' + s.primaryType : '')], ['Contract', named(s.verifyingContract) || 'none']];
      s.permits.forEach(function (pm, i) {
        var n = s.permits.length > 1 ? ' ' + (i + 1) : '';
        srows.push(['Token' + n, named(pm.token)]);
        srows.push(['Spender' + n, pm.spender]);
        srows.push(['Amount' + n, pm.amountHuman]);
        srows.push(['Expires' + n, pm.expiryIso ? pm.expiryIso + ' (in ' + pm.expiryDays + ' days)' : 'never / not set']);
      });
      if (!s.permits.length) srows.push(['Message', JSON.stringify((s.raw || '')).slice(0, 160)]);
      var ok4 = await popup(srows, s.isPermit ? 'Signature request: token permit' : 'Signature request');
      log('wallet_decision', { method: method, approved: ok4, decoded: s });
      if (!ok4) throw Object.assign(new Error('User rejected'), { code: 4001 });
      return '0x' + '00'.repeat(65);
    }
    if (method === 'eth_sign') {
      var blind = { kind: 'eth_sign', scheme: 'eth_sign (blind hash signature)', hash: String(p[1] || '').slice(0, 66), permits: [] };
      log('sig_decoded', { method: method, decoded: blind });
      var ok5 = await popup([['Site', location.origin], ['Request', 'eth_sign: sign an unreadable hash'], ['Hash', blind.hash]], 'Blind signature request');
      log('wallet_decision', { method: method, approved: ok5, decoded: blind });
      if (!ok5) throw Object.assign(new Error('User rejected'), { code: 4001 });
      return '0x' + '00'.repeat(65);
    }
    if (method === 'personal_sign') {
      var ok3 = await popup([['Site', location.origin], ['Request', 'Sign message'], ['Message', String(p[0]).slice(0, 200)]], 'Signature request');
      log('wallet_decision', { method: method, approved: ok3 });
      if (!ok3) throw Object.assign(new Error('User rejected'), { code: 4001 });
      return '0x' + '00'.repeat(65);
    }
    throw Object.assign(new Error('SafuWallet mock: unsupported method ' + method), { code: 4200 });
  }

  var NO_WALLET = params.get('nowallet') === '1';
  if (!NO_WALLET) window.ethereum = { isSafuWallet: true, isMetaMask: false, request: request,
    on: function (ev, f) { (listeners[ev] = listeners[ev] || []).push(f); }, removeListener: function () {} };

  // Raw evidence for secret-harvesting prompts: record every text field that
  // appears, with its label/placeholder/surrounding text. Classification is done
  // by the (hardenable) rules in the checker, not here.
  var seen = new Set();
  function scan() {
    document.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(function (f) {
      if (f.closest('#safu-wallet-popup')) return;
      var r = f.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return;
      var box = f.closest('form, dialog, [role=dialog], section, div');
      var label = (f.labels && f.labels[0] && f.labels[0].innerText) || f.getAttribute('aria-label') || '';
      var sig = (f.id || f.name || '') + '|' + (f.placeholder || '') + '|' + label;
      if (seen.has(sig)) return; seen.add(sig);
      log('input_seen', { field: { tag: f.tagName.toLowerCase(), type: f.type || '', id: f.id || '', name: f.name || '', placeholder: f.placeholder || '', label: label, nearbyText: box ? box.innerText.replace(/\s+/g, ' ').slice(0, 300) : '' } });
    });
  }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  document.addEventListener('DOMContentLoaded', scan);
  document.addEventListener('input', function (e) {
    if (e.target && e.target.closest && !e.target.closest('#safu-wallet-popup')) log('input_typed', { field: { id: e.target.id || '', name: e.target.name || '' }, length: (e.target.value || '').length });
  }, true);
  log('page_loaded', { title: document.title, userAgent: navigator.userAgent, webdriver: !!navigator.webdriver, walletInjected: !NO_WALLET });
  // What did this browser actually see? (cloaking evidence: compare with the HTTP peek)
  function snapshot(tag) {
    var main = document.querySelector('main') || document.body;
    var text = main ? main.innerText.replace(/\s+/g, ' ').trim() : '';
    var buttons = Array.from(document.querySelectorAll('button')).filter(function (x) { return !x.closest('#safu-wallet-popup'); }).map(function (x) { return x.innerText.trim(); }).filter(Boolean).slice(0, 8);
    log('page_snapshot', { tag: tag, title: document.title, text: text.slice(0, 300), textLength: text.length, buttons: buttons, webdriver: !!navigator.webdriver });
  }
  setTimeout(function () { snapshot('t+3s'); }, 3000);
  setTimeout(function () { snapshot('t+10s'); }, 10000);
})();
