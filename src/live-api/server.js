// Direct live-check API (for hosting behind your own tunnel / reverse proxy on a Kane-logged-in machine).
// The public site uses relay-worker.js instead (no inbound port needed). Same caps via core.js.
import http from 'node:http';
import crypto from 'node:crypto';
import { safuCard } from '../card.js';
import { readLive } from '../live.js';
import { createQueue, usage, CAPS, kane, checkKane, TZ } from './core.js';

const PORT = Number(process.env.SAFU_LIVE_PORT || 4300);
const ORIGINS = (process.env.SAFU_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ORIGIN_RE = /^https:\/\/safuclick[a-z0-9-]*\.vercel\.app$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const hashIp = (ip) => crypto.createHash('sha256').update('safu:' + ip).digest('hex').slice(0, 16);
const jobs = new Map();
const q = createQueue();
checkKane();
setInterval(checkKane, 10 * 60 * 1000).unref();

function view(job) {
  const steps = job === q.running ? ((readLive() || {}).steps || []) : job.steps || [];
  return { id: job.id, url: job.url, status: job.status, position: job.status === 'queued' ? job.position : 0, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, steps, verdict: job.verdict || null, error: job.error || null };
}
function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
}

const srv = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && (ORIGIN_RE.test(origin) || ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  const json = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
  const ipKey = hashIp(clientIp(req));
  const u = usage();

  if (url.pathname === '/api/status') {
    return json(200, {
      online: kane.ok !== false, kane: kane.ok, mode: 'real-site · observe only', day: u.day, timezone: TZ,
      global: { used: u.total, cap: CAPS.global }, you: { used: u.perIp[ipKey] || 0, cap: CAPS.perIp },
      queue: q.length, maxQueue: CAPS.maxQueue, kaneTimeoutSec: CAPS.kaneTimeout,
    });
  }
  if (url.pathname === '/api/check' && req.method === 'POST') {
    let body = '';
    for await (const c of req) { body += c; if (body.length > 8192) return json(413, { error: 'Request too large' }); }
    let payload; try { payload = JSON.parse(body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const r = await q.submit({ url: payload.url, ipKey });
    if (!r.ok) return json(r.code, { error: r.error });
    const job = r.job; jobs.set(job.id, job);
    if (jobs.size > 500) jobs.delete(jobs.keys().next().value);
    return json(202, view(job));
  }
  const card = url.pathname.match(/^\/api\/card\/([a-f0-9]{12})\.svg$/);
  if (card) {
    const j = jobs.get(card[1]);
    if (!j?.verdict) return json(404, { error: 'No card yet' });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(safuCard(j.verdict));
  }
  const m = url.pathname.match(/^\/api\/job\/([a-f0-9]{12})$/);
  if (m) { const j = jobs.get(m[1]); return j ? json(200, view(j)) : json(404, { error: 'No such job (the host may have restarted)' }); }
  if (url.pathname === '/' || url.pathname === '/healthz') return json(200, { ok: true, service: 'safuclick-live-api' });
  json(404, { error: 'Not found' });
});

srv.listen(PORT, '127.0.0.1', () => console.log(`SafuClick live API on http://127.0.0.1:${PORT} · caps ${CAPS.perIp}/IP/day, ${CAPS.global}/day · one Kane run at a time`));
