// Lookalike-domain detection against the known-good allowlist.
// Catches: 1-2 letter typos (Damerau-Levenshtein: swaps, insertions, deletions, substitutions),
// homoglyphs (punycode / Cyrillic look-alikes, rn->m, 0->o, 1->l, vv->w), brand + extra words or hyphens
// (uniswap-app, aave-fi, curvegov), right name on the wrong TLD (uniswap.icu), official domain used as a
// subdomain prefix (uniswap.org.evil.com), and coin ticker / exchange name + digits (usdc082).
// Every finding names the official domain it resembles ("looks like app.uniswap.org").
import { domainToUnicode } from 'node:url';

export function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Optimal-string-alignment Damerau-Levenshtein: an adjacent swap ("unsiwap") costs 1, not 2.
export function damerau(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

// Cyrillic / Greek / fullwidth look-alikes and digit / letter-pair swaps, folded to plain Latin.
const CONFUSABLE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ɡ': 'g', 'ո': 'n', 'ս': 'u', 'ᴜ': 'u', 'ⅼ': 'l', 'ı': 'i', 'α': 'a', 'ο': 'o', 'ρ': 'p', 'ν': 'v', 'κ': 'k', 'τ': 't', 'ϲ': 'c', 'ǀ': 'l', 'ɩ': 'l', 'ꮃ': 'w', 'ѡ': 'w', 'ԝ': 'w', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'к': 'k' };
export function skeleton(s) {
  let t = String(s || '').normalize('NFKC').toLowerCase();
  t = [...t].map((c) => CONFUSABLE[c] || c).join('');
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents: unìswap -> uniswap
  return t.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd').replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/\$/g, 's').replace(/i/g, 'l');
}

const TWO_PART = ['co.uk', 'com.au', 'co.jp', 'com.br', 'com.cn', 'com.ng', 'co.za', 'co.in', 'com.tr'];
export function splitHost(host) {
  const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  const two = TWO_PART.includes(parts.slice(-2).join('.'));
  const n = two ? 3 : 2;
  const registrable = parts.slice(-n).join('.');
  return { parts, registrable, label: parts.length >= n ? parts[parts.length - n] : parts[0] || '', tld: parts.slice(-(n - 1)).join('.'), sub: parts.slice(0, -n) };
}

const DEFAULT_TICKERS = ['usdc', 'usdt', 'btc', 'eth', 'bnb', 'sol', 'trx', 'xrp', 'doge', 'busd', 'dai', 'binance', 'coinbase', 'okx', 'bybit', 'kraken', 'kucoin', 'huobi', 'htx', 'bitget', 'mexc', 'gateio'];

export function checkDomain(rawUrl, allowlist, rules) {
  const u = new URL(rawUrl);
  const host = u.hostname.toLowerCase();
  const hostPort = u.host.toLowerCase();
  const R = rules.domain || {};
  const findings = [];
  const allowed = allowlist.domains.map((d) => d.toLowerCase());
  const official = (allowed.includes(host) || allowed.includes(hostPort));
  const me = splitHost(host);
  const named = allowed.filter((d) => !/^[\d.]+(:\d+)?$|^localhost/.test(d)).map((d) => ({ d, ...splitHost(d) }));
  // A subdomain of an official registrable domain is run by the same owner (docs.uniswap.org).
  if (official || (R.trustOfficialSubdomains !== false && named.some((o) => o.registrable === me.registrable && o.label === me.label)))
    return { host, official: true, findings };

  // "Looks like" target: allowlist.canonical[label] (e.g. uniswap -> app.uniswap.org), else the first allowlisted domain with that label.
  const canonical = allowlist.canonical || {};
  const looks = (label) => canonical[label] || (named.find((o) => o.label === label) || {}).d || label;
  const brands = [...new Set([...(allowlist.brands || []), ...named.map((o) => o.label)])].filter((b) => b && b.length >= 3);
  const push = (id, label, detail) => { if (!findings.some((f) => f.id === id && f.resembles === looks(label))) findings.push({ id, resembles: looks(label), detail }); };

  // 1. Official domain used as a subdomain prefix: uniswap.org.evil.com
  if (R.flagSubdomainTrick !== false) {
    for (const o of named) {
      if (me.registrable !== o.registrable && (host.startsWith(o.registrable + '.') || host.includes('.' + o.registrable + '.') || host.startsWith(o.d + '.') || host.startsWith(o.registrable + '-'))) {
        push('subdomain_trick', o.label, `${host} starts with "${o.registrable}" but the real domain is ${me.registrable}. Looks like ${looks(o.label)}`);
        break;
      }
    }
  }

  // 2. Punycode / homoglyphs: decode xn-- and fold confusables, then compare skeletons.
  const unicode = domainToUnicode(host) || host;
  const isPuny = host.split('.').some((l) => l.startsWith('xn--'));
  const meU = splitHost(unicode);
  if (R.flagPunycode && isPuny) {
    const hit = named.find((o) => skeleton(meU.label) === skeleton(o.label));
    findings.push({ id: 'punycode_domain', resembles: hit ? looks(hit.label) : null, detail: `${host} is punycode for "${unicode}"${hit ? `, built from look-alike letters. Looks like ${looks(hit.label)}` : ' (possible homoglyph lookalike)'}` });
  }
  if (R.flagHomoglyphs !== false) {
    for (const o of named) {
      if (meU.label !== o.label && skeleton(meU.label) === skeleton(o.label)) {
        push('homoglyph_domain', o.label, `"${meU.label}" uses look-alike characters for "${o.label}" (e.g. rn for m, 0 for o, 1 for l, Cyrillic letters). Looks like ${looks(o.label)}`);
      }
    }
  }

  // 3. Same name, wrong TLD: uniswap.icu vs uniswap.org
  if (R.flagWrongTld !== false) {
    const o = named.find((x) => x.label === me.label && x.tld !== me.tld);
    if (o) push('wrong_tld', o.label, `${me.registrable} uses the official name "${o.label}" on the wrong ending (.${me.tld}). Looks like ${looks(o.label)}`);
  }

  // 4. Typos: Damerau-Levenshtein on the name part (swaps, insertions, deletions, substitutions).
  const maxD = R.maxEditDistance ?? 2;
  for (const o of named) {
    if (o.label === me.label) continue;
    const a = skeleton(me.label), b = skeleton(o.label);
    const dist = Math.min(damerau(me.label, o.label), damerau(a, b));
    const len = o.label.length;
    // Short names (aave, okx, lido) only get 1 edit and must start with the same letter, so "dave.com" is not "aave".
    const limit = len <= 4 ? (me.label[0] === o.label[0] ? 1 : 0) : len <= 6 ? Math.min(1, maxD) : maxD;
    if (dist > 0 && dist <= limit) push('lookalike_domain', o.label, `${host} is ${dist} edit${dist > 1 ? 's' : ''} away from official ${o.d}. Looks like ${looks(o.label)}`);
  }

  // 5. Brand + extra words / hyphens: uniswap-app, aave-fi, curvegov, metamask-wallet-sync
  if (R.flagBrandTokens) {
    const tokens = unicode.split(/[.\-_]/).filter(Boolean);
    for (const brand of brands) {
      const inName = brand.length >= 5 ? host.includes(brand) || skeleton(unicode).includes(skeleton(brand)) : tokens.includes(brand) || me.label.startsWith(brand) || me.label.endsWith(brand);
      if (inName && !findings.some((f) => ['lookalike_domain', 'homoglyph_domain', 'wrong_tld', 'subdomain_trick'].includes(f.id) && f.resembles === looks(brand)))
        push('brand_impersonation', brand, `${host} uses the brand "${brand}" but is not an official domain. Looks like ${looks(brand)}`);
    }
  }

  // 6. Coin ticker / exchange name + digits: usdc082, binance123, 2024-usdt
  if (R.flagTickerDigits) {
    const tick = (R.tickers || DEFAULT_TICKERS).join('|');
    if (new RegExp(`(^|-)(${tick})[-_]?\\d{2,}|\\d{2,}[-_]?(${tick})($|-)`, 'i').test(me.label)) {
      const t = (me.label.match(new RegExp(tick, 'i')) || [''])[0].toLowerCase();
      findings.push({ id: 'ticker_digits_domain', resembles: canonical[t] || null, detail: `${host} is a coin ticker or exchange name ("${t}") plus digits, a naming pattern common to throwaway fake-exchange sites${canonical[t] ? `. Looks like ${canonical[t]}` : ''}` });
    }
  }
  return { host, official: false, findings, resembles: findings.find((f) => f.resembles)?.resembles || null };
}
