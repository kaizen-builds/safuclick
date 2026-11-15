import { configured, lastMessage, tResult } from './_lib/relay.js';
import { safuCard } from './_lib/card.js';
export default async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!configured || !/^[a-z0-9]{8,24}$/.test(id)) return res.status(400).send('bad id');
  const m = await lastMessage(tResult(id)).catch(() => null);
  if (!m?.verdict) return res.status(404).send('no card yet');
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="safucard-${id}.svg"`);
  res.status(200).send(safuCard(m.verdict));
}
