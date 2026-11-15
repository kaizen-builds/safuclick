// Talks to the box-hosted Kane worker through secret ntfy.sh topics (outbound HTTPS on both sides).
const NTFY = (process.env.SAFU_NTFY || 'https://ntfy.sh').replace(/\/$/, '');
const SECRET = process.env.SAFU_RELAY_SECRET || '';
export const configured = /^[A-Za-z0-9]{16,40}$/.test(SECRET);
export const T_JOBS = `sc-${SECRET}-jobs`;
export const T_HB = `sc-${SECRET}-hb`;
export const tResult = (id) => `sc-${SECRET}-r-${id}`;
export const CAPS = { perIp: 3, global: 40 };

export async function publish(topic, obj) {
  const r = await fetch(`${NTFY}/${topic}`, { method: 'POST', body: JSON.stringify(obj), headers: { Firebase: 'no' } });
  if (!r.ok) throw new Error('relay publish failed: HTTP ' + r.status);
}

export async function lastMessage(topic, since = 'all') {
  const r = await fetch(`${NTFY}/${topic}/json?poll=1&since=${encodeURIComponent(since)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('relay poll failed: HTTP ' + r.status);
  const lines = (await r.text()).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.event === 'message');
  if (!lines.length) return null;
  const m = lines[lines.length - 1];
  let text = m.message;
  if (m.attachment?.url) text = await (await fetch(m.attachment.url)).text();
  try { return { ...JSON.parse(text), _time: m.time }; } catch { return null; }
}

export const send = (res, code, obj) => { res.setHeader('Cache-Control', 'no-store'); res.status(code).json(obj); };
