import { configured, lastMessage, tResult, send } from './_lib/relay.js';
export default async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!configured || !/^[a-z0-9]{8,24}$/.test(id)) return send(res, 400, { error: 'Bad job id' });
  const created = parseInt(id.slice(0, 8), 36);
  const age = Date.now() - created;
  let m;
  try { m = await lastMessage(tResult(id)); } catch (e) { return send(res, 200, { id, status: 'submitted', note: 'relay busy' }); }
  if (!m) {
    if (age > 90_000) return send(res, 200, { id, status: 'error', error: 'The live-check host did not pick this up. It may be offline — browse the recorded checks meanwhile.' });
    return send(res, 200, { id, status: 'submitted', ageSec: Math.round(age / 1000) });
  }
  if ((m.status === 'running' || m.status === 'queued') && age > 9 * 60_000) return send(res, 200, { id, status: 'error', error: 'The check timed out.' });
  const { _time, ...rest } = m;
  return send(res, 200, { ...rest, ageSec: Math.round(age / 1000) });
}
