// Shared live-check queue: caps, one Kane run at a time, watchdog. Used by the relay worker and the direct API.
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { STATE, readJSON, writeJSON } from '../paths.js';
import { check } from '../check.js';
import { assertPublicUrl } from '../urlguard.js';

export const CAPS = {
  perIp: Number(process.env.SAFU_PER_IP_DAILY || 3),
  global: Number(process.env.SAFU_GLOBAL_DAILY || 40),
  maxQueue: Number(process.env.SAFU_MAX_QUEUE || 5),
  kaneTimeout: Number(process.env.SAFU_KANE_TIMEOUT || 150),
};
const WATCHDOG_MS = (CAPS.kaneTimeout + 90) * 1000;
const USAGE_FILE = path.join(STATE, 'live-api', 'usage.json');
export const TZ = 'Africa/Lagos';
export const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export function usage() {
  const u = readJSON(USAGE_FILE, null);
  return u && u.day === day() ? u : { day: day(), total: 0, perIp: {}, rejects: 0 };
}
const saveUsage = (u) => writeJSON(USAGE_FILE, u);

export const kane = { ok: null };
export function checkKane() {
  execFile(process.env.KANE_BIN || 'kane-cli', ['whoami'], { timeout: 20000 }, (err, out) => {
    kane.ok = !err && !/not logged in|login required/i.test(String(out));
  });
}

export function publicVerdict(v) {
  if (!v) return null;
  const o = JSON.parse(JSON.stringify(v));
  delete o.runDir; delete o.card;
  return o;
}

export function createQueue({ onChange = () => {} } = {}) {
  const queue = [];
  let running = null;
  async function pump() {
    if (running || !queue.length) return;
    const job = queue.shift();
    running = job; job.status = 'running'; job.startedAt = new Date().toISOString();
    onChange(job);
    queue.forEach((j, i) => { j.position = i + 1; });
    let timer;
    const watchdog = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Timed out waiting for Kane')), WATCHDOG_MS); });
    try {
      const { verdict, kane: k } = await Promise.race([
        check(job.url, { realSite: true, quiet: true, maxSteps: 10, timeout: CAPS.kaneTimeout, urlGuard: assertPublicUrl }),
        watchdog,
      ]);
      job.verdict = publicVerdict(verdict); job.steps = k?.steps || verdict.kane?.steps || []; job.status = 'done';
    } catch (e) {
      const msg = String(e.message || e);
      if (/timed out/i.test(msg)) {
        job.status = 'done';
        job.verdict = {
          verdict: 'INCONCLUSIVE',
          url: job.url,
          reasons: [{ source: 'kane', detail: 'Kane did not finish in time. Try again, or browse the recorded checks.' }],
          signals: [],
          kane: { reason: msg },
        };
      } else {
        job.status = 'error'; job.error = msg;
      }
    } finally {
      clearTimeout(timer);
      job.finishedAt = new Date().toISOString();
      running = null;
      onChange(job);
      setImmediate(pump);
    }
  }
  async function submit({ id, url, ipKey }) {
    let target;
    try { target = (await assertPublicUrl(url)).toString(); } catch (e) { return { ok: false, code: 400, error: e.message }; }
    const u = usage();
    if (kane.ok === false) return { ok: false, code: 503, error: 'Live checks are temporarily offline (Kane is not logged in on the host).' };
    if ((u.perIp[ipKey] || 0) >= CAPS.perIp) return { ok: false, code: 429, error: `Daily limit reached: ${CAPS.perIp} live checks per visitor per day. The recorded checks are free.` };
    if (u.total >= CAPS.global) return { ok: false, code: 429, error: `Today's ${CAPS.global} live checks are used up. Try again tomorrow, or browse the recorded checks.` };
    if (queue.length >= CAPS.maxQueue) return { ok: false, code: 503, error: 'The queue is full. Kane runs one check at a time — try again in a few minutes.' };
    u.total += 1; u.perIp[ipKey] = (u.perIp[ipKey] || 0) + 1; saveUsage(u);
    const job = { id: id || crypto.randomBytes(6).toString('hex'), url: target, status: 'queued', createdAt: new Date().toISOString(), steps: [], position: queue.length + 1 };
    queue.push(job);
    setImmediate(pump);
    return { ok: true, job, waiting: !!running || queue.length > 1 };
  }
  return { submit, get running() { return running; }, get length() { return queue.length + (running ? 1 : 0); }, queue };
}

export function noteReject() { const u = usage(); u.rejects = (u.rejects || 0) + 1; saveUsage(u); return u.rejects; }
