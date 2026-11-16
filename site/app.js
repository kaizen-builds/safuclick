// SafuClick site. Recorded checks + Scam Arena come from data/*.json, built from real Kane run files.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (v) => (v === 'TRAP FLAGGED' ? 'trap' : v === 'INCONCLUSIVE' ? 'inc' : 'clean');
const short = (a) => (a && a.length > 14 ? a.slice(0, 8) + '…' + a.slice(-4) : a || '');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -- dithered shield (ordered Bayer dither, one pigment) */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
function shieldDist(x, y) { // x,y in [-1,1]; returns >0 inside the shield
  const top = -0.78, w = 0.66 - 0.06 * Math.max(0, -y);
  if (y < top) return -1;
  if (y < 0.15) return Math.min(w - Math.abs(x), y - top);
  const k = (y - 0.15) / 0.75; const half = w * Math.sqrt(Math.max(0, 1 - k * k));
  return Math.min(half - Math.abs(x), 0.9 - y);
}
function segD(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const segDist = (x, y) => Math.min(segD(x, y, -0.3, 0.0, -0.08, 0.24), segD(x, y, -0.08, 0.24, 0.34, -0.22));
function dither(canvas, { cell = 5, shield = true, color = [218, 255, 82] } = {}) {
  const ctx = canvas.getContext('2d');
  let W, H, t0 = performance.now();
  const resize = () => { const r = canvas.getBoundingClientRect(); W = canvas.width = Math.max(1, Math.floor(r.width)); H = canvas.height = Math.max(1, Math.floor(r.height)); };
  resize(); addEventListener('resize', resize);
  const frame = (now) => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell), cx = W * 0.5, cy = H * 0.5, S = Math.min(W, H) * 0.42;
    const scanY = ((t * 0.22) % 1.6) - 0.8;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const px = i * cell, py = j * cell, x = (px - cx) / S, y = (py - cy) / S;
      let v;
      if (shield) {
        const d = shieldDist(x, y), r = Math.hypot(x, y);
        const inner = d > 0 ? 0.55 + 0.45 * Math.min(1, d * 6) * (0.55 + 0.45 * Math.sin(y * 9 - t * 1.6 + x * 3)) : 0;
        const rim = Math.exp(-Math.pow(d * 22, 2)) * 1.1;
        const check = d > 0 ? Math.max(0, 1 - segDist(x, y) * 6) : 0;
        const halo = Math.max(0, 0.42 - r * 0.32) * (0.8 + 0.2 * Math.sin(t * 2 + r * 8));
        const rays = Math.max(0, Math.cos(Math.atan2(y, x) * 10 + t * 0.4)) * Math.max(0, 1 - r / 2.2) * 0.22;
        const scan = Math.exp(-Math.pow((y - scanY) * 14, 2)) * (d > -0.08 ? 0.7 : 0.12);
        v = Math.max(inner * (d > 0 ? 0.3 : 0) * (1 - check), rim, check * 1.6) + halo + rays + scan;
      } else {
        const n = Math.sin(x * 2.1 + t * 0.5) * Math.cos(y * 3.3 - t * 0.35) + Math.sin((x + y) * 5 + t);
        const edge = Math.max(Math.abs(px / W - 0.5), Math.abs(py / H - 0.5)) * 2;
        v = (0.18 + 0.2 * n) * Math.pow(edge, 2.2) + 0.06;
      }
      if (v > BAYER[(j & 3) * 4 + (i & 3)]) {
        const a = Math.min(1, 0.25 + v * 0.75);
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${a})`;
        ctx.fillRect(px, py, cell - 1.4, cell - 1.4);
      }
    }
    if (!REDUCED) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
if ($('#dither')) dither($('#dither'), { cell: 6 });

/* -- shared renderers */
function stepsHtml(steps) {
  return (steps || []).map((s, i) => {
    const [act, ...rest] = String(s.remark || '').split(': ');
    return `<li style="animation-delay:${REDUCED ? 0 : i * 0.08}s"><span class="t">${String(s.step).padStart(2, '0')}</span><span class="a">${esc(act)}</span><span>${esc(rest.join(': '))}</span></li>`;
  }).join('') || '<li><span class="t">--</span><span></span><span>Kane did not run (site unreachable).</span></li>';
}
function verdictHtml(v, url, resembles) {
  return `<span class="stamp ${cls(v)}">${esc(v)}</span><div class="v-url">${esc(url)}${resembles ? ` <span class="looks">looks like ${esc(resembles)}</span>` : ''}</div>`;
}
function reasonsHtml(reasons, signals, verdict) {
  let h = '';
  for (const r of reasons || []) h += `<div class="reason"><span class="src">${esc(r.source)}</span><span>${esc(r.detail)}</span></div>`;
  for (const s of signals || []) h += `<div class="reason sig"><span class="src">signal</span><span>${esc(s.detail)}</span></div>`;
  if (!h) h = verdict === 'INCONCLUSIVE' ? '<div class="reason"><span class="src">result</span><span>Kane could not finish the flow, so no verdict either way.</span></div>' : '<div class="reason"><span class="src">result</span><span>No known trap patterns on this run. Not a guarantee: see the limits below.</span></div>';
  return `<div class="blk"><h4>Why</h4>${h}</div>`;
}
function walletHtml(c) {
  if (c.mode === 'real-site') {
    const p = c.probe;
    if (!p) return '';
    return `<div class="blk"><h4>HTTP peek, no browser</h4><div class="ev"><span class="k">status</span> ${esc(p.status)} &middot; <span class="k">title</span> ${esc(p.title)}<br><span class="k">connect wallet copy</span> ${p.walletConnect ? '<span class="bad">yes</span>' : 'no'}${p.blocked ? ' &middot; <span class="bad">blocked / captcha</span>' : ''}</div></div>`;
  }
  const peek = c.probe ? `<div class="blk"><h4>View 1: HTTP peek, no JS, no wallet</h4><div class="ev">${esc((c.probe.textSnippet || '').replace(/^(SafuSwap\s*)+/, '').slice(0, 110))}</div></div>` : '';
  const sigs = (c.signatures || []).flatMap((s) => (s.permits || []).map((pm) => `<div class="ev"><span class="k">signature</span> ${esc(s.scheme)} (no gas)<br><span class="k">spender</span> ${esc(short(pm.spender))}<br><span class="k">amount</span> <span class="${pm.unlimited ? 'bad' : ''}">${esc(pm.amountHuman)}</span> &middot; <span class="k">expires</span> ${esc(pm.expiryIso || 'never')}</div>`)).join('');
  const bats = (c.batches || []).map((b) => `<div class="ev"><span class="k">batch</span> ${b.callCount} actions in one confirm${b.delegation ? ' &middot; 7702 delegator ' + esc(short(b.delegation.delegator)) : ''}${b.calls.map((x, i) => `<br><span class="k">${i + 1}</span> ${esc(x.kind)} <span class="${x.unlimited ? 'bad' : ''}">${esc(x.amountHuman)}</span>${x.kind !== 'swap' ? ' to ' + esc(short(x.spender)) : ''}`).join('')}</div>`).join('');
  const title = c.probe ? 'View 2: Kane browser + mock wallet' : 'Mock wallet evidence';
  if (sigs || bats) return peek + `<div class="blk"><h4>${title}</h4>${sigs}${bats}</div>`;
  if (!c.wallet?.length) return peek + `<div class="blk"><h4>${title}</h4><div class="ev"><span class="k">requests</span> ${esc((c.walletRequests || []).join(', ') || 'none')}<br>No transaction was requested.</div></div>`;
  return peek + `<div class="blk"><h4>${title}</h4>${c.wallet.map((t) => `<div class="ev"><span class="k">action</span> ${esc(t.label)}<br><span class="k">${t.kind === 'setApprovalForAll' ? 'operator' : t.spender && t.spender !== t.to ? 'spender' : 'to'}</span> ${esc(short(t.spender || t.to))}<br><span class="k">amount</span> <span class="${t.unlimited || /UNLIMITED/.test(t.amountHuman) ? 'bad' : ''}">${esc(t.amountHuman)}</span></div>`).join('')}</div>`;
}
function kaneHtml(k) {
  if (!k) return '';
  const meta = [k.status && `status ${esc(k.status)}`, k.duration && `${Math.round(k.duration)}s`, k.credits && `${Number(k.credits).toFixed(1)} credits`].filter(Boolean).join(' &middot; ');
  return `<div class="blk"><h4>Kane CLI said</h4><p class="kane-line">&ldquo;${esc(k.one_liner || k.reason || '')}&rdquo;</p><p class="kane-meta mono">${meta}${k.test_url ? ` &middot; <a href="${esc(k.test_url)}" target="_blank" rel="noopener">run report</a>` : ''}</p></div>`;
}

/* -- recorded checks */
let CHECKS = [], current = null;
function showCheck(slug) {
  const c = CHECKS.find((x) => x.slug === slug) || CHECKS[0];
  current = c;
  document.querySelectorAll('.tab').forEach((b) => { const on = b.dataset.slug === c.slug; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#checkMode').textContent = c.mode === 'real-site' ? 'live site · observe only' : 'phishing gym · mock wallet';
  $('#checkVerdict').innerHTML = verdictHtml(c.verdict, c.url, c.resembles);
  $('#checkBlurb').textContent = c.blurb;
  $('#checkReasons').innerHTML = reasonsHtml(c.reasons, c.signals, c.verdict);
  $('#checkWallet').innerHTML = walletHtml(c);
  $('#checkKane').innerHTML = kaneHtml(c.kane);
  $('#checkCard').src = c.card;
  const open = !$('#checkSteps').classList.contains('hidden');
  $('#checkSteps').innerHTML = open ? stepsHtml(c.kane?.steps) : '';
  $('#stepsBtn').textContent = `${open ? 'Hide' : 'Show'} Kane step timeline (${(c.kane?.steps || []).length})`;
}
fetch('data/checks.json').then((r) => r.json()).then((d) => {
  CHECKS = d.checks;
  const tab = (c) => `<button class="tab" role="tab" data-slug="${c.slug}"><span class="s ${cls(c.verdict)}"></span>${esc(c.title)}</button>`;
  $('#chips').innerHTML = '<div class="tab-grp">2026 drainer traps</div>' + CHECKS.filter((c) => c.kind === 'new').map(tab).join('') + '<div class="tab-grp">Phishing gym basics</div>' + CHECKS.filter((c) => c.kind === 'gym').map(tab).join('') + '<div class="tab-grp">Live sites</div>' + CHECKS.filter((c) => c.kind === 'real').map(tab).join('');
  $('#chips').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) { showCheck(b.dataset.slug); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } });
  showCheck('claim');
});
$('#stepsBtn').addEventListener('click', () => {
  const el = $('#checkSteps'), open = el.classList.toggle('hidden') === false;
  $('#stepsBtn').setAttribute('aria-expanded', open);
  el.innerHTML = open && current ? stepsHtml(current.kane?.steps) : '';
  $('#stepsBtn').textContent = `${open ? 'Hide' : 'Show'} Kane step timeline (${(current?.kane?.steps || []).length})`;
});
$('#cardBtn').addEventListener('click', () => $('#cardDlg').showModal());
$('#cardDlg').addEventListener('click', (e) => { if (e.target.id === 'cardDlg') e.target.close(); });

/* -- Scam Arena */
let ARENA = null;
const vcls = (v) => ({ trap: 't-trap', inc: 't-inc', clean: 't-clean' }[cls(v)]);
function renderArena(upTo = 99) {
  const rs = ARENA.rounds;
  let scam = 0, build = 0;
  $('#rounds').innerHTML = rs.map((r, i) => {
    const vis = i < upTo;
    const ruleCaughtFirst = r.first?.reasons?.some((x) => x.source !== 'kane');
    if (vis) { if (ruleCaughtFirst) build++; else { scam++; if (r.recheck?.reasons?.some((x) => x.source !== 'kane')) build++; } }
    const caught = r.outcome === 'CAUGHT';
    const after = r.builder?.rulesAfter ?? r.rulesBefore;
    return `<article class="round ${vis ? '' : 'dim'}">
      <div class="round-h"><h3>${r.round}. ${esc(r.move)}${r.real ? ' <span class="mono tag">real link</span>' : ''}</h3><span class="mono">rules v${r.rulesBefore}${after !== r.rulesBefore ? ` to v${after}` : ''}</span></div>
      <p class="taunt">&ldquo;${esc(r.taunt || r.pitch)}&rdquo;</p>
      <span class="outcome ${caught ? 'caught' : 'fixed'}">${esc(r.outcome)}</span>
      <div class="r-line">First try: <span class="${vcls(r.first?.verdict)}">${esc(r.first?.verdict)}</span>${r.first?.reasons?.length ? ` (${esc(r.first.reasons.map((x) => x.id).join(', '))})` : ''}</div>
      ${r.recheck ? `<div class="r-line">After ${r.builder?.changes?.length || 0} rule changes: <span class="${vcls(r.recheck.verdict)}">${esc(r.recheck.verdict)}</span></div>` : ''}
    </article>`;
  }).join('');
  $('#scScam').textContent = scam; $('#scBuild').textContent = build;
}
fetch('data/arena.json').then((r) => r.json()).then((d) => {
  ARENA = d; renderArena();
  const when = new Date(d.finishedAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
  $('#arenaFoot').innerHTML = `Recorded ${esc(when)} Lagos time &middot; ${d.rounds.length} rounds &middot; ${Number(d.credits).toFixed(1)} Kane credits &middot; <a href="https://github.com/kaizen-builds/safuclick/tree/main/docs/runs" target="_blank" rel="noopener">transcripts</a>`;
});
$('#arenaPlay').addEventListener('click', () => {
  if (!ARENA) return;
  let k = 0; renderArena(0);
  const tick = () => { k++; renderArena(k); if (k < ARENA.rounds.length) setTimeout(tick, 1600); };
  setTimeout(tick, 400);
});

/* -- live check (same-origin API, secret relay, Kane CLI on the host machine) */
let LIVE = false;
function metaLine(s) {
  const left = s.global ? Math.max(0, s.global.cap - s.global.used) : null;
  return `Live: a real Kane CLI run, observe-only · ${s.perIpCap || 3} checks per visitor per day${left != null ? ` · ${left} of ${s.global.cap} left today` : ''}`;
}
async function refreshStatus() {
  try {
    const s = await (await fetch('/api/status', { cache: 'no-store' })).json();
    LIVE = !!s.online;
    if (!LIVE) return offline();
    const m = $('#liveMeta'); m.classList.remove('off'); m.textContent = metaLine(s); $('#liveBtn').disabled = false;
  } catch { offline(); }
}
function offline(msg) {
  LIVE = false;
  const m = $('#liveMeta');
  m.classList.add('off');
  m.textContent = msg || 'Live checks are temporarily offline. The recorded checks below are free to browse.';
}
refreshStatus();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
$('#liveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let url = $('#liveUrl').value.trim();
  if (!url) return $('#liveUrl').focus();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
  const box = $('#live'); box.classList.remove('hidden');
  $('#liveVerdict').innerHTML = `<div class="v-url">${esc(url)}</div>`;
  $('#liveSteps').innerHTML = '';
  $('#liveCard').innerHTML = '<div class="scan"><span></span></div><p class="mono" id="liveWait">Sending to Kane...</p>';
  $('#liveState').textContent = 'submitting';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!LIVE) { $('#liveState').textContent = 'offline'; $('#liveVerdict').innerHTML = '<p class="err">Live checks are temporarily offline. The recorded checks below are real Kane runs you can browse for free.</p>'; $('#liveCard').innerHTML = ''; return; }
  $('#liveBtn').disabled = true;
  const t0 = Date.now();
  try {
    const r = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Request failed');
    let job = j;
    while (!['done', 'error', 'rejected'].includes(job.status)) {
      const secs = Math.round((Date.now() - t0) / 1000);
      const label = job.status === 'queued' ? `queued · position ${job.position}` : job.status === 'running' ? 'kane-cli running' : 'waiting for the Kane host';
      $('#liveState').textContent = `${label} · ${secs}s`;
      const w = $('#liveWait'); if (w) w.textContent = job.status === 'running' ? `Kane is reviewing the page in headless Chrome, ${secs}s (usually 60 to 120s)` : job.status === 'queued' ? `In line behind ${job.position} other check(s). Kane runs one at a time.` : 'Handing the link to Kane...';
      await sleep(3000);
      const q = await fetch('/api/job?id=' + encodeURIComponent(j.id), { cache: 'no-store' });
      job = await q.json();
      if (!q.ok) throw new Error(job.error || 'Lost the job');
    }
    if (job.status !== 'done') throw new Error(job.error || 'The check failed');
    const v = job.verdict;
    $('#liveState').textContent = `done · ${Math.round((Date.now() - t0) / 1000)}s`;
    $('#liveVerdict').innerHTML = verdictHtml(v.verdict, v.url, v.resembles) + reasonsHtml(v.reasons, v.signals, v.verdict) + kaneHtml(v.kane);
    $('#liveSteps').innerHTML = stepsHtml(job.steps?.length ? job.steps : v.kane?.steps);
    const card = '/api/card?id=' + encodeURIComponent(j.id);
    $('#liveCard').innerHTML = `<img class="safucard" alt="SafuCard for this check" src="${card}"><a class="link-btn" style="margin-top:10px;display:inline-block" href="${card}&download=1">download SafuCard</a>`;
  } catch (err) {
    $('#liveState').textContent = 'stopped';
    $('#liveVerdict').innerHTML += `<p class="err">${esc(err.message)}</p>`;
    $('#liveCard').innerHTML = '<p class="mono">No live result. Browse the recorded checks below.</p>';
  } finally {
    $('#liveBtn').disabled = false;
    refreshStatus();
  }
});
