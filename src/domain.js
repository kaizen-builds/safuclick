// Domain comparison against the official allowlist: typosquats, brand-in-subdomain, punycode.
export function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const label = (host) => host.replace(/\.(localhost|com|org|io|xyz|app|finance|exchange|net)$/i, '').split('.').pop();

export function checkDomain(rawUrl, allowlist, rules) {
  const u = new URL(rawUrl);
  const host = u.hostname.toLowerCase();
  const hostPort = u.host.toLowerCase();
  const findings = [];
  const allowed = allowlist.domains.map((d) => d.toLowerCase());
  if (allowed.includes(host) || allowed.includes(hostPort)) return { host, official: true, findings };

  if (rules.domain.flagPunycode && host.split('.').some((l) => l.startsWith('xn--')))
    findings.push({ id: 'punycode_domain', detail: `${host} uses punycode (possible homoglyph lookalike)` });

  for (const off of allowed.filter((d) => !/^[\d.]+(:\d+)?$|^localhost/.test(d))) {
    const dist = levenshtein(label(host), label(off));
    if (dist > 0 && dist <= rules.domain.maxEditDistance)
      findings.push({ id: 'lookalike_domain', detail: `${host} is ${dist} edit${dist > 1 ? 's' : ''} away from official ${off}` });
  }
  if (rules.domain.flagBrandTokens) {
    for (const brand of allowlist.brands) {
      if (host.includes(brand) && !findings.some((f) => f.id === 'lookalike_domain'))
        findings.push({ id: 'brand_impersonation', detail: `${host} contains brand "${brand}" but is not an official domain` });
    }
  }
  return { host, official: false, findings };
}
