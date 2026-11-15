import { configured, lastMessage, T_HB, CAPS, send } from './_lib/relay.js';
export default async function handler(req, res) {
  if (!configured) return send(res, 200, { online: false, reason: 'not configured', caps: CAPS });
  try {
    const hb = await lastMessage(T_HB, '50m');
    if (!hb || hb.online === false) return send(res, 200, { online: false, reason: hb ? 'kane offline' : 'no heartbeat from the live-check host in 50 min', caps: CAPS });
    return send(res, 200, { online: true, at: hb.at, global: hb.global, perIpCap: hb.perIpCap, caps: CAPS, mode: 'real-site · observe only' });
  } catch (e) {
    return send(res, 200, { online: false, reason: e.message, caps: CAPS });
  }
}
