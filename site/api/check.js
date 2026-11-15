import crypto from 'node:crypto';
import { configured, publish, T_JOBS, CAPS, send } from './_lib/relay.js';
import { assertPublicUrl } from './_lib/urlguard.js';

const recent = new Map(); // best-effort per-instance limiter; the box worker enforces the real caps
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!configured) return send(res, 503, { error: 'Live checks are temporarily offline.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  let target;
  try { target = (await assertPublicUrl(body.url)).toString(); } catch (e) { return send(res, 400, { error: e.message }); }
  const ip = String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  const ipHash = crypto.createHash('sha256').update((process.env.SAFU_IP_SALT || 'safu') + ':' + ip).digest('hex').slice(0, 24);
  const now = Date.now();
  const mine = (recent.get(ipHash) || []).filter((t) => now - t < 86400000);
  if (mine.length >= CAPS.perIp) return send(res, 429, { error: `Daily limit reached: ${CAPS.perIp} live checks per visitor per day. The recorded checks are free.` });
  const id = now.toString(36) + crypto.randomBytes(3).toString('hex');
  try { await publish(T_JOBS, { id, url: target, ip: ipHash, ts: now }); } catch (e) { return send(res, 503, { error: 'Could not reach the live-check host. Try again shortly.' }); }
  mine.push(now); recent.set(ipHash, mine);
  return send(res, 202, { id, url: target, status: 'submitted' });
}
