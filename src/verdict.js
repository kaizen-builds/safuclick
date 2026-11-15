// Combines Kane's run, the mock-wallet evidence log and the domain check into a verdict.
// Pure function: (evidence, rules, allowlist) -> verdict. Fixture-testable without Kane.
import { checkDomain } from './domain.js';

const MAX = (1n << 256n) - 1n;
const rx = (s) => new RegExp(s.startsWith('\\') || /[()[\]|?+*]/.test(s) ? s : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const short = (a) => (a ? a.slice(0, 8) + '…' + a.slice(-4) : '?');

function looksLike(addr, known) {
  addr = addr.toLowerCase(); known = known.toLowerCase();
  return addr !== known && addr.slice(2, 6) === known.slice(2, 6) && addr.slice(-4) === known.slice(-4);
}

export function kaneText(kane) {
  if (!kane) return '';
  return [kane.summary, kane.one_liner, kane.reason, JSON.stringify(kane.final_state || {}),
    ...(kane.steps || []).map((s) => s.remark)].filter(Boolean).join('\n');
}

export function evaluate({ url, intendedAmount = 10, kane, walletLog = [], probe, mode = 'gym' }, rules, allowlist) {
  const reasons = [];
  const signals = [];
  const add = (id, source, detail, evidence) => reasons.push({ id, source, detail, evidence });
  const note = (id, source, detail) => signals.push({ id, source, detail });
  const known = Object.fromEntries(Object.entries(allowlist.contracts).map(([k, v]) => [k.toLowerCase(), v]));
  const knownSpenders = Object.fromEntries(Object.entries(allowlist.spenders).map(([k, v]) => [k.toLowerCase(), v]));
  const seedRx = (rules.seed?.patterns || []).map(rx);
  const real = rules.realSite || {};
  // Avoid "No seed phrase fields" style false positives when Kane reports a clean page.
  const negatedSecret = (text) => /\b(no|not|without|never|doesn't|does not|didn't|did not|none)\b[\s\S]{0,50}(seed|recovery|mnemonic|secret words|private key)|\b(seed|recovery|mnemonic|secret words|private key)[\s\S]{0,40}\b(not (found|present|visible|shown|asked)|absent|fields)\b/i.test(text);

  // 1. Domain (pasted URL, plus the post-redirect host in real-site mode)
  const dom = checkDomain(url, allowlist, rules);
  for (const f of dom.findings) add(f.id, 'rule:domain', f.detail);
  let dest = null;
  if (probe?.finalUrl) {
    try {
      const startHost = new URL(url).hostname.toLowerCase();
      const endHost = new URL(probe.finalUrl).hostname.toLowerCase();
      if (endHost !== startHost) {
        dest = checkDomain(probe.finalUrl, allowlist, rules);
        for (const f of dest.findings) add(f.id, 'rule:domain', `After redirect: ${f.detail}`);
        const bothOfficial = dom.official && dest.official;
        const hops = (probe.hops || []).length;
        if (!bothOfficial && real.flagSuspiciousRedirect !== false && (dest.findings.length || hops > 1)) {
          add('suspicious_redirect', 'rule:redirect',
            `Redirected from ${startHost} to ${endHost}` + (dest.findings[0] ? ` (${dest.findings[0].detail})` : ''),
            { from: url, to: probe.finalUrl, hops: probe.hops });
        } else {
          note('redirect', 'rule:redirect', `Redirected from ${startHost} to ${endHost}`);
        }
      }
    } catch { /* ignore invalid finalUrl */ }
  }

  // 2. Wallet transactions (the part a visual check can't see) — gym / mock wallet only
  const txs = walletLog.filter((e) => e.type === 'tx_decoded').map((e) => e.decoded);
  const intendedRaw = BigInt(Math.round(intendedAmount * 1e6));
  for (const d of txs) {
    if (rules.contracts.requireKnownContract && !known[d.to])
      add('unknown_contract', 'rule:wallet', `Transaction sent to unknown contract ${short(d.to)} (not in allowlist)`, d);
    if (d.kind === 'approve') {
      const amt = BigInt(d.amountRaw);
      if (rules.approval.flagMaxUint && amt === MAX)
        add('unlimited_approval', 'rule:wallet', `Page asked the wallet for UNLIMITED ${d.token} approval to ${short(d.spender)} while the UI said "swap ${intendedAmount} USDC"`, d);
      else if (rules.approval.maxAllowanceRatio && amt > intendedRaw * BigInt(rules.approval.maxAllowanceRatio))
        add('excessive_approval', 'rule:wallet', `Approval of ${d.amountHuman} is ${amt / (intendedRaw || 1n)}x the ${intendedAmount} USDC the user intended`, d);
      if (rules.approval.flagAddressPoisoning) {
        const twin = Object.keys(knownSpenders).find((k) => looksLike(d.spender, k));
        if (twin) add('address_poisoning', 'rule:wallet', `Spender ${short(d.spender)} imitates ${knownSpenders[twin]} ${short(twin)} (same prefix/suffix, different address)`, d);
      }
      if (rules.approval.requireKnownSpender && !knownSpenders[d.spender])
        add('unknown_spender', 'rule:wallet', `Approval spender ${short(d.spender)} is not a known router`, d);
    }
  }

  // 3. Secret-harvesting prompts (seed phrase etc.) from wallet DOM log, HTML probe, or Kane
  const considerSeed = (text, field, source, lead) => {
    const hit = seedRx.find((r) => r.test(text));
    if (hit && !negatedSecret(text) && !reasons.some((r) => r.id === 'seed_phrase_prompt')) {
      add('seed_phrase_prompt', source, `${lead}: "${String(text).replace(/\s+/g, ' ').slice(0, 120)}"`, field);
    }
    return !!hit && !negatedSecret(text);
  };
  for (const e of walletLog.filter((x) => x.type === 'input_seen')) {
    const f = e.field; const text = [f.label, f.placeholder, f.nearbyText].join(' ');
    considerSeed(text, f, 'rule:dom', 'Page shows a field asking for secrets');
  }
  for (const f of probe?.fields || []) {
    considerSeed([f.label, f.placeholder, f.nearbyText].join(' '), f, 'rule:html', 'Page HTML shows a field asking for secrets');
  }
  if (probe && real.flagSeedInKaneOrHtml !== false) {
    considerSeed([probe.title, probe.textSnippet].join(' '), null, 'rule:html', 'Page copy mentions secrets');
  }
  const typed = walletLog.filter((e) => e.type === 'input_typed' && e.field.id !== 'amount');
  if (typed.length && reasons.some((r) => r.id === 'seed_phrase_prompt'))
    add('secret_typed', 'rule:dom', 'Something was typed into the secret-harvesting field', typed[0]);

  if (mode === 'real-site' && kane && real.flagSeedInKaneOrHtml !== false) {
    const text = kaneText(kane);
    if (seedRx.some((r) => r.test(text)) && !negatedSecret(text) && !reasons.some((r) => r.id === 'seed_phrase_prompt')) {
      const sentences = [...String(kane.summary || '').split(/(?<=[.!?])\s+|\n+/), kane.one_liner || '', text];
      const quote = sentences.find((x) => seedRx.some((r) => r.test(x)) && !negatedSecret(x)) || text;
      add('seed_phrase_prompt', 'kane', `Kane: "${String(quote).replace(/\s+/g, ' ').trim().slice(0, 220)}"`, { matched: 'seed' });
    }
  }

  // 4. What Kane itself reported. Kane's objective asserts the wallet popup matches the
  //    swap the user asked for; a failed assertion that talks about traps is a trap signal.
  let kaneNote = null;
  if (kane && kane.status && kane.status !== 'passed' && rules.kane.flagFailedFlow) {
    const text = kaneText(kane);
    const kHit = (rules.kane.textPatterns || []).map(rx).find((r) => r.test(text));
    const said = (kane.summary || kane.one_liner || kane.reason || '').replace(/\s+/g, ' ').slice(0, 260);
    // Only assertion failures / confirmed product bugs count as Kane trap signals;
    // stuck.max_steps, timeouts etc. are inconclusive (Kane's summary can over-narrate those).
    const assertive = !kane.reason_code || /^assertion_error/.test(kane.reason_code);
    // Quote the sentence where Kane actually describes the trap (not its meta commentary).
    const sentences = [...String(kane.summary || '').split(/(?<=[.!?])\s+|\n+/), kane.one_liner || ''];
    const pats = (rules.kane.textPatterns || []).map(rx);
    const quote = sentences.find((x) => pats.some((r) => r.test(x))) || said;
    if (kHit && assertive) add('kane_assertion_failed', 'kane', `Kane: "${quote.trim().slice(0, 220)}"`, { status: kane.status, reason_code: kane.reason_code, matched: kHit.source });
    else kaneNote = `Kane could not complete the flow (${kane.reason_code || kane.status}): ${(kane.reason || said).slice(0, 160)}`;
  }

  // 5. Page-level observations (real-site mode, also harmless in gym)
  const connectSeen = !!(probe?.walletConnect) || /connect([\s-]?wallet|\s+metamask)|import\s+(your\s+)?wallet/i.test(kaneText(kane));
  if (connectSeen && mode === 'real-site') {
    note('wallet_connect_prompt', 'observe',
      dom.official
        ? 'Connect Wallet prompt observed on a known-good domain (expected for a dApp).'
        : 'Connect Wallet prompt observed on a domain that is not on the known-good list.');
  }
  if (probe?.blocked) note('cloaking_or_block', 'observe', 'Page looks like a captcha, 403, or anti-bot wall. Sites can cloak test browsers — this is inconclusive, not "safe".');
  if (probe?.error) note('probe_error', 'observe', `HTTP peek failed: ${probe.error}`);

  const blockedInconclusive = mode === 'real-site' && (probe?.blocked || probe?.error) && !reasons.length;
  const noEvidence = !kane && walletLog.length === 0 && !probe;
  const verdict = reasons.length ? 'TRAP FLAGGED' : (blockedInconclusive || kaneNote || noEvidence) ? 'INCONCLUSIVE' : 'NO KNOWN TRAPS FOUND';
  const traps = reasons;
  return {
    verdict, url, host: dom.host, officialDomain: dom.official, reasons: traps, signals, mode,
    walletSummary: { requests: walletLog.filter((e) => e.type === 'wallet_request').map((e) => e.method), transactions: txs },
    kane: kane ? { status: kane.status, one_liner: kane.one_liner, summary: kane.summary, credits: kane.credits_consumed, test_url: kane.test_url, reason_code: kane.reason_code, steps: kane.steps || [] } : null,
    probe: probe ? { finalUrl: probe.finalUrl, status: probe.status, title: probe.title, hops: probe.hops || [], blocked: !!probe.blocked, error: probe.error || null, walletConnect: !!probe.walletConnect } : null,
    rulesVersion: rules.version, note: kaneNote,
    disclaimer: 'Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets.',
  };
}
