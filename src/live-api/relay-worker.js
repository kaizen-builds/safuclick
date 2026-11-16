// Relay worker: lets a public website use Kane CLI on this machine WITHOUT any inbound port or tunnel.
// The website's serverless function publishes jobs to a secret ntfy.sh topic over HTTPS; this worker
// subscribes (outbound HTTPS only), runs the real-site Kane check, and publishes the result to a
// per-job secret topic the website polls. Kane credentials never leave this machine.
//   SAFU_RELAY_SECRET  shared secret topic prefix (same value as the Vercel env var)
//   SAFU_NTFY          ntfy server (default https://ntfy.sh)
import path from 'node:path';
import { STATE, readJSON, writeJSON } from '../paths.js';
import { createQueue, usage, CAPS, kane, checkKane, noteReject, day } from './core.js';

const SECRET = process.env.SAFU_RELAY_SECRET;
const NTFY = (process.env.SAFU_NTFY || 'https://ntfy.sh').replace(/\/$/, '');
if (!SECRET || !/^[A-Za-z0-9]{16,40}$/.test(SECRET)) { console.error('Set SAFU_RELAY_SECRET (16-40 letters/digits).'); process.exit(1); }
const T_JOBS = `sc-${SECRET}-jobs`, T_HB = `sc-${SECRET}-hb`, tResult = (id) => `sc-${SECRET}-r-${id}`;
const CURSOR = path.join(STATE, 'live-api', 'relay-cursor.json');
const MAX_REJECT_MSGS = Number(process.env.SAFU_MAX_REJECT_MSGS || 50);
// Heartbeats used to go out every 20 minutes, so a wedged worker could look
// fine until /api/status noticed a 50-minute gap. Send often enough that a
// missed run can trip the liveness exit below.
const HB_MS = Number(process.env.SAFU_RELAY_HB_MS || 30_000);
const LIVE_MS = Number(process.env.SAFU_RELAY_LIVE_MS || 180_000);
const FETCH_MS = Number(process.env.SAFU_RELAY_FETCH_MS || 20_000);
// ntfy sends a keepalive about every 30s. If the stream goes quiet, the TCP connection is
// probably a zombie (the bug that left jup.ag sitting in the cache for ~9 minutes).
const IDLE_MS = Number(process.env.SAFU_RELAY_IDLE_MS || 75_000);
const POLL_MS = Number(process.env.SAFU_RELAY_POLL_MS || 45_000);
const STALE_MS = 10 * 60 * 1000;
const fetchSignal = () => AbortSignal.timeout(FETCH_MS);
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function publish(topic, obj) {
  try {
    const r = await fetch(`${NTFY}/${topic}`, { method: 'POST', body: JSON.stringify(obj), headers: { 'Cache': 'yes', 'Firebase': 'no' }, signal: fetchSignal() });
    if (!r.ok) { log('publish failed', r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { log('publish error', e.message); return false; }
}
const stats = () => { const u = usage(); return { day: u.day, global: { used: u.total, cap: CAPS.global }, perIpCap: CAPS.perIp }; };
let lastHbOk = Date.now();
async function heartbeat() {
  const ok = await publish(T_HB, { type: 'hb', at: new Date().toISOString(), online: kane.ok !== false, ...stats(), queue: q.length });
  if (ok) lastHbOk = Date.now();
}

// Always reschedule, even when fn throws or returns a rejected promise.
// setInterval plus an unhandled rejection (or a hung fetch with no timeout)
// is what let heartbeats and interval polls go quiet while the process stayed up.
function every(ms, fn, name, first = ms) {
  const tick = () => {
    Promise.resolve()
      .then(() => fn())
      .catch((e) => log(name, 'error', e && e.message ? e.message : e))
      .finally(() => {
        try { setTimeout(tick, ms); }
        catch (e) { log(name, 'reschedule error', e.message); process.exit(1); }
      });
  };
  try { setTimeout(tick, first); }
  catch (e) { log(name, 'schedule error', e.message); process.exit(1); }
}

const q = createQueue({
  onChange: (job) => {
    if (job.status === 'running') publish(tResult(job.id), { id: job.id, status: 'running', url: job.url, startedAt: job.startedAt });
    if (job.status === 'done' || job.status === 'error') {
      log('job', job.id, job.status, job.verdict?.verdict || job.error || '');
      publish(tResult(job.id), { id: job.id, status: job.status, url: job.url, verdict: job.verdict || null, steps: job.steps || [], error: job.error || null, finishedAt: job.finishedAt, ...stats() });
    }
  },
});

const seen = new Set(readJSON(CURSOR, {}).seen || []);
function sinceMark() {
  return readJSON(CURSOR, {}).last || '15m';
}
function remember(msg) {
  if (msg?.id) writeJSON(CURSOR, { last: msg.id, seen: [...seen].slice(-300) });
}

async function handle(msg) {
  let job; try { job = JSON.parse(msg.message); } catch { log('ignored unreadable job message', msg?.id || ''); return; }
  if (!job || !/^[a-z0-9]{8,24}$/.test(job.id || '')) { log('ignored bad job payload', msg?.id || ''); return; }
  if (seen.has(job.id)) { remember(msg); return; }
  seen.add(job.id);
  remember(msg);
  log('got job', job.id, job.url || '');
  if (Date.now() - Number(job.ts || 0) > STALE_MS) {
    log('stale', job.id);
    publish(tResult(job.id), { id: job.id, status: 'error', error: 'The check was received too late and was dropped.', ...stats() });
    return;
  }
  const res = await q.submit({ id: job.id, url: job.url, ipKey: String(job.ip || 'unknown').slice(0, 64) });
  if (!res.ok) {
    log('reject', job.id, res.error);
    if (noteReject() <= MAX_REJECT_MSGS) publish(tResult(job.id), { id: job.id, status: 'rejected', code: res.code, error: res.error, ...stats() });
    return;
  }
  log('accepted', job.id, res.job.url, res.waiting ? `(queued #${res.job.position})` : '');
  if (res.waiting) publish(tResult(job.id), { id: job.id, status: 'queued', position: res.job.position, url: res.job.url });
}

function takeEvents(text, onEvent) {
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    onEvent(ev);
  }
}

let polling = false;
async function pollPending(reason) {
  if (polling) return 0;
  polling = true;
  const since = sinceMark();
  try {
    const r = await fetch(`${NTFY}/${T_JOBS}/json?poll=1&since=${encodeURIComponent(since)}`, { cache: 'no-store', signal: fetchSignal() });
    if (!r.ok) { log('poll pending failed', r.status, reason); return 0; }
    const lines = (await r.text()).split('\n').filter(Boolean);
    let n = 0;
    for (const line of lines) {
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.event !== 'message') continue;
      n += 1;
      await handle(ev);
    }
    if (n || reason !== 'interval') log('poll pending', reason, n ? `${n} message(s)` : 'none');
    return n;
  } catch (e) {
    log('poll pending error', reason, e.message);
    return 0;
  } finally {
    polling = false;
  }
}

async function subscribe() {
  for (;;) {
    await pollPending('resubscribe');
    const since = sinceMark();
    const ac = new AbortController();
    let idle;
    const bump = () => {
      try {
        clearTimeout(idle);
        idle = setTimeout(() => {
          try { ac.abort(); } catch (e) { log('idle abort error', e.message); }
        }, IDLE_MS);
      } catch (e) {
        log('idle watchdog error', e.message);
        try { ac.abort(); } catch (err) { log('idle abort error', err.message); }
      }
    };
    try {
      bump();
      const r = await fetch(`${NTFY}/${T_JOBS}/json?since=${encodeURIComponent(since)}`, { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      log('subscribed to job topic');
      let buf = '';
      const dec = new TextDecoder();
      for await (const chunk of r.body) {
        bump();
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.event === 'message') handle(ev).catch((e) => log('handle error', e.message));
        }
      }
      log('subscription ended, reconnecting');
    } catch (e) {
      const idleHit = ac.signal.aborted;
      log('subscription error', idleHit ? 'idle timeout' : e.message);
    } finally {
      clearTimeout(idle);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

checkKane();
every(10 * 60 * 1000, () => { checkKane(); }, 'checkKane');
every(HB_MS, heartbeat, 'heartbeat', 4000);
every(POLL_MS, () => pollPending('interval'), 'poll');
every(30_000, () => {
  const quiet = Date.now() - lastHbOk;
  if (quiet > LIVE_MS) {
    log('liveness: no successful heartbeat for', Math.round(quiet / 1000) + 's, exiting');
    process.exit(1);
  }
}, 'liveness');
log(`SafuClick relay worker · ${NTFY} · caps ${CAPS.perIp}/visitor/day, ${CAPS.global}/day (${day()} ${'Africa/Lagos'}) · one Kane run at a time`);
subscribe().catch((e) => { log('subscribe loop died', e.message); process.exit(1); });
