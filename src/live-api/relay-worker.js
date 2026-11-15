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
const HB_MS = 20 * 60 * 1000;
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function publish(topic, obj) {
  try {
    const r = await fetch(`${NTFY}/${topic}`, { method: 'POST', body: JSON.stringify(obj), headers: { 'Cache': 'yes', 'Firebase': 'no' } });
    if (!r.ok) log('publish failed', r.status, (await r.text()).slice(0, 200));
  } catch (e) { log('publish error', e.message); }
}
const stats = () => { const u = usage(); return { day: u.day, global: { used: u.total, cap: CAPS.global }, perIpCap: CAPS.perIp }; };
const heartbeat = () => publish(T_HB, { type: 'hb', at: new Date().toISOString(), online: kane.ok !== false, ...stats(), queue: q.length });

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
async function handle(msg) {
  let job; try { job = JSON.parse(msg.message); } catch { return; }
  if (!job || !/^[a-z0-9]{8,24}$/.test(job.id || '') || seen.has(job.id)) return;
  seen.add(job.id);
  writeJSON(CURSOR, { last: msg.id, seen: [...seen].slice(-300) });
  if (Date.now() - Number(job.ts || 0) > 10 * 60 * 1000) return; // stale
  const res = await q.submit({ id: job.id, url: job.url, ipKey: String(job.ip || 'unknown').slice(0, 64) });
  if (!res.ok) {
    log('reject', job.id, res.error);
    if (noteReject() <= MAX_REJECT_MSGS) publish(tResult(job.id), { id: job.id, status: 'rejected', code: res.code, error: res.error, ...stats() });
    return;
  }
  log('accepted', job.id, res.job.url, res.waiting ? `(queued #${res.job.position})` : '');
  if (res.waiting) publish(tResult(job.id), { id: job.id, status: 'queued', position: res.job.position, url: res.job.url });
}

async function subscribe() {
  for (;;) {
    const since = readJSON(CURSOR, {}).last || '2m';
    try {
      const r = await fetch(`${NTFY}/${T_JOBS}/json?since=${encodeURIComponent(since)}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      log('subscribed to job topic');
      let buf = '';
      const dec = new TextDecoder();
      for await (const chunk of r.body) {
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
    } catch (e) { log('subscription error', e.message); }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

checkKane();
setInterval(checkKane, 10 * 60 * 1000);
setTimeout(heartbeat, 4000);
setInterval(heartbeat, HB_MS);
log(`SafuClick relay worker · ${NTFY} · caps ${CAPS.perIp}/visitor/day, ${CAPS.global}/day (${day()} ${'Africa/Lagos'}) · one Kane run at a time`);
subscribe();
