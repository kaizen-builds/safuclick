// Public-URL guard for the hosted live check: http/https only, default ports, no credentials,
// and every resolved address must be public (blocks localhost, private, link-local, CGNAT, metadata IPs).
import dns from 'node:dns/promises';
import net from 'node:net';

function v4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return v4Private(ip);
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return v4Private(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith('64:ff9b') || s.startsWith('2001:db8');
  }
  return true;
}

export async function assertPublicUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('URL is missing or too long');
  let u;
  try { u = new URL(raw.trim().match(/^[a-z][a-z0-9+.-]*:/i) ? raw.trim() : 'https://' + raw.trim()); } catch { throw new Error('That does not look like a URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https links can be checked');
  if (u.username || u.password) throw new Error('Links with embedded credentials are not allowed');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Only standard ports (80/443) are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host)) throw new Error('Local and internal hostnames are not allowed');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('Private or local IP addresses are not allowed'); return u; }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw new Error(`Could not resolve ${host}`); }
  // 198.18.0.0/15 from DNS (not a literal) is a sandbox egress proxy's fake-IP answer; the proxy resolves the real host.
  const fakeIp = (ip) => /^198\.1[89]\./.test(ip);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address) && !fakeIp(a.address))) throw new Error('That host resolves to a private or local address');
  return u;
}
