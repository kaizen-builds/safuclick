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
  return { title, fields, walletConnect, blocked, textSnippet: text.slice(0, 500), pageUrl };
}

export async function probeUrl(raw, { timeoutMs = 8000 } = {}) {
  const hops = [];
  let url = raw, finalUrl = raw, status = 0, html = '', error = null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for (let i = 0; i < 8; i++) {
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
