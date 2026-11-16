// Cheap, no-Kane HTTP peek used by real-site mode: redirects, title, obvious
// seed-phrase fields and Connect Wallet copy. Never submits forms or cookies.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ATTR = (attrs, name) => {
  const m = attrs.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
};

export function inspectHtml(html = '', pageUrl = '') {
  const title = (html.match(/<title[^>]*>([^<]+)/i) || [, ''])[1].replace(/\s+/g, ' ').trim();
  const fields = [];
  const re = /<(input|textarea)([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[2] || '';
    const typ = (ATTR(attrs, 'type') || (m[1].toLowerCase() === 'textarea' ? 'textarea' : 'text')).toLowerCase();
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(typ)) continue;
    const nearby = html.slice(Math.max(0, m.index - 400), m.index + 400).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    fields.push({
      tag: m[1].toLowerCase(), type: typ, id: ATTR(attrs, 'id'), name: ATTR(attrs, 'name'),
      placeholder: ATTR(attrs, 'placeholder'), label: ATTR(attrs, 'aria-label'), nearbyText: nearby.slice(0, 240),
    });
  }
  const text = (title + ' ' + html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const walletConnect = /connect([\s-]?wallet|\s+metamask|\s+to\s+wallet)|import\s+(your\s+)?wallet|link\s+wallet/i.test(text);
  const blocked = /just a moment|attention required|access denied|cf-browser-verification|captcha|enable javascript and cookies|unfortunately (we )?can.t|forbidden/i.test(text);
  const turnstile = /challenges\.cloudflare\.com\/turnstile|cf-turnstile/i.test(html);
  return { title, fields, walletConnect, blocked, turnstile, textSnippet: text.slice(0, 500), pageUrl };
}

export async function probeUrl(raw, { timeoutMs = 8000, guard = null } = {}) {
  const hops = [];
  let url = raw, finalUrl = raw, status = 0, html = '', error = null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for (let i = 0; i < 8; i++) {
      if (guard) await guard(url);
      const res = await fetch(url, {
        redirect: 'manual', signal: ac.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
      });
      status = res.status;
      const location = res.headers.get('location');
      hops.push({ url, status, location });
      if ([301, 302, 303, 307, 308].includes(res.status) && location) {
        url = new URL(location, url).toString();
        finalUrl = url;
        continue;
      }
      finalUrl = res.url || url;
      const buf = new Uint8Array(await res.arrayBuffer());
      html = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 400_000));
      break;
    }
  } catch (e) {
    error = e.name === 'AbortError' ? 'timeout' : String(e.message || e);
  } finally { clearTimeout(t); }
  const inspect = inspectHtml(html, finalUrl);
  const blocked = inspect.blocked || status === 403 || status === 451;
  return { startUrl: raw, finalUrl, status, hops, error, blocked, ...inspect };
}

// Domain age via RDAP (public, no key). Best effort: many ccTLDs have no RDAP; then we just say "unknown".
export function registrable(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  const two = ['co.uk', 'com.au', 'co.jp', 'com.br', 'com.cn', 'com.ng', 'co.za', 'co.in'];
  const last2 = parts.slice(-2).join('.');
  return two.includes(last2) ? parts.slice(-3).join('.') : last2;
}
export async function rdapAge(host, { timeoutMs = 6000, now = Date.now() } = {}) {
  const domain = registrable(host);
  if (!domain || domain.endsWith('localhost') || /^[\d.]+$/.test(domain)) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: ac.signal, headers: { Accept: 'application/rdap+json', 'User-Agent': 'SafuClick/0.1 (+https://github.com/kaizen-builds/safuclick)' }, redirect: 'follow' });
    if (!r.ok) return { domain, error: `rdap ${r.status}` };
    const j = await r.json();
    const ev = (j.events || []).find((e) => /registration/i.test(e.eventAction));
    const registrar = ((j.entities || []).find((e) => (e.roles || []).includes('registrar'))?.vcardArray?.[1] || []).find((x) => x[0] === 'fn')?.[3] || null;
    if (!ev) return { domain, registered: null, ageDays: null, registrar };
    return { domain, registered: ev.eventDate, ageDays: Math.floor((now - Date.parse(ev.eventDate)) / 86400000), registrar };
  } catch (e) { return { domain, error: e.name === 'AbortError' ? 'rdap timeout' : String(e.message || e) }; }
  finally { clearTimeout(t); }
}
