// Shareable SafuCard: an SVG verdict image written next to every run (and served by the UI).


const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function wrap(text, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (next.length > width && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function safuCard(v) {
  const trap = v.verdict === 'TRAP FLAGGED';
  const inc = v.verdict === 'INCONCLUSIVE';
  const accent = trap ? '#FF5A4F' : inc ? '#FFB020' : '#2DD4BF';
  const bg = trap ? '#2B0E0C' : inc ? '#2B1F05' : '#0B2B27';
  const stamp = trap ? 'TRAP FLAGGED' : inc ? 'INCONCLUSIVE' : 'NO KNOWN TRAPS FOUND';
  const icon = trap ? '!' : inc ? '?' : 'OK'; // drawn as text, no emoji
  const reasons = (v.reasons || []).slice(0, 4);
  const signals = (v.signals || []).slice(0, 3);
  let y = 250;
  const blocks = [];
  for (const r of reasons) {
    const lines = wrap('x  ' + r.detail, 72);
    blocks.push(`<text x="72" y="${y}" font-size="20" fill="#F2F2F2">${esc(lines[0] || '')}</text>`);
    y += 28;
    for (const ln of lines.slice(1, 2)) { blocks.push(`<text x="96" y="${y}" font-size="18" fill="#BDBDBD">${esc(ln)}</text>`); y += 26; }
    y += 6;
  }
  if (!reasons.length && !inc) {
    blocks.push(`<text x="72" y="${y}" font-size="20" fill="#2DD4BF">No known trap patterns on this run.</text>`);
    y += 36;
  }
  for (const s of signals) {
    const lines = wrap('·  ' + s.detail, 74);
    blocks.push(`<text x="72" y="${y}" font-size="16" fill="#9A9A9A">${esc(lines[0] || '')}</text>`);
    y += 24;
  }
  const kane = v.kane ? `Kane CLI: ${v.kane.status || ''}${v.kane.one_liner ? ': ' + v.kane.one_liner : ''}` : 'Kane CLI did not run';
  const kLines = wrap(kane, 78);
  const host = v.host || '';
  const url = String(v.url || '').slice(0, 88);
  const official = v.officialDomain ? 'official allowlist' : 'not on known-good list';
  const mode = v.mode === 'real-site' ? 'real-site mode · observe only' : 'gym / mock-wallet mode';
  const disclaimer = v.disclaimer || 'Flags known trap patterns seen on this run. Not a guarantee of safety: sites can cloak or fingerprint test wallets.';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Inter Tight, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="#0B0B0B"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" rx="28" fill="#000000"/>
  <rect width="1200" height="630" rx="28" fill="url(#bg)"/>
  <rect x="18" y="18" width="1164" height="594" rx="22" fill="none" stroke="${accent}" stroke-width="4"/>
  <text x="64" y="86" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="36" font-weight="800" fill="#F2F2F2">Safu<tspan fill="#DAFF52">Click</tspan></text>
  <text x="1136" y="80" text-anchor="end" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16" fill="#DAFF52">powered by Kane CLI</text>
  <circle cx="88" cy="160" r="28" fill="${accent}"/>
  <text x="88" y="168" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${icon === 'OK' ? 16 : 24}" font-weight="800" fill="#000000">${esc(icon)}</text>
  <text x="136" y="172" font-family="ui-sans-serif, system-ui, sans-serif" font-size="42" font-weight="900" fill="${accent}">${esc(stamp)}</text>
  <text x="72" y="216" font-family="IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" fill="#9A9A9A">${esc(url)}</text>
  ${blocks.join('\n  ')}
  <text x="72" y="500" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16" fill="#F2F2F2">Domain: ${esc(host)} (${esc(official)})  ·  ${esc(mode)}</text>
  ${kLines.map((ln, i) => `<text x="72" y="${528 + i * 22}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16" fill="#BDBDBD">${esc(ln)}</text>`).join('\n  ')}
  <text x="72" y="596" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="#7E7E7E">${esc(disclaimer.slice(0, 140))}</text>
</svg>
`;
}
