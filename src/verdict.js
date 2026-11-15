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

export function evaluate({ url, intendedAmount = 10, kane, walletLog = [] }, rules, allowlist) {
  const reasons = [];
  const add = (id, source, detail, evidence) => reasons.push({ id, source, detail, evidence });
  const known = Object.fromEntries(Object.entries(allowlist.contracts).map(([k, v]) => [k.toLowerCase(), v]));
  const knownSpenders = Object.fromEntries(Object.entries(allowlist.spenders).map(([k, v]) => [k.toLowerCase(), v]));

  // 1. Domain
  const dom = checkDomain(url, allowlist, rules);
  for (const f of dom.findings) add(f.id, 'rule:domain', f.detail);

  // 2. Wallet transactions (the part a visual check can't see)
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

  // 3. Secret-harvesting prompts (seed phrase etc.), from raw DOM evidence
  const seedRx = rules.seed.patterns.map(rx);
  for (const e of walletLog.filter((x) => x.type === 'input_seen')) {
    const f = e.field; const text = [f.label, f.placeholder, f.nearbyText].join(' ');
    const hit = seedRx.find((r) => r.test(text));
    if (hit) { add('seed_phrase_prompt', 'rule:dom', `Page shows a field asking for secrets: "${(f.nearbyText || f.placeholder).slice(0, 120)}"`, f); break; }
  }
  const typed = walletLog.filter((e) => e.type === 'input_typed' && e.field.id !== 'amount');
  if (typed.length && reasons.some((r) => r.id === 'seed_phrase_prompt'))
    add('secret_typed', 'rule:dom', 'Something was typed into the secret-harvesting field', typed[0]);

  // 4. What Kane itself reported. Kane's objective asserts the wallet popup matches the
  //    swap the user asked for; a failed assertion that talks about traps is a trap signal.
  let kaneNote = null;
  if (kane && kane.status && kane.status !== 'passed' && rules.kane.flagFailedFlow) {
    const text = kaneText(kane);
    const kHit = (rules.kane.textPatterns || []).map(rx).find((r) => r.test(text));
    const said = (kane.summary || kane.one_liner || kane.reason || '').replace(/\s+/g, ' ').slice(0, 260);
    if (kHit) add('kane_assertion_failed', 'kane', `Kane's check failed: ${said}`, { status: kane.status, reason_code: kane.reason_code, matched: kHit.source });
    else kaneNote = `Kane could not complete the flow (${kane.status}): ${said}`;
  }

  const verdict = reasons.length ? 'TRAP FLAGGED' : (kaneNote || (!kane && walletLog.length === 0)) ? 'INCONCLUSIVE' : 'NO KNOWN TRAPS FOUND';
  const traps = reasons;
  return {
    verdict, url, host: dom.host, officialDomain: dom.official, reasons: traps,
    walletSummary: { requests: walletLog.filter((e) => e.type === 'wallet_request').map((e) => e.method), transactions: txs },
    kane: kane ? { status: kane.status, one_liner: kane.one_liner, summary: kane.summary, credits: kane.credits_consumed, test_url: kane.test_url } : null,
    rulesVersion: rules.version, note: kaneNote,
    disclaimer: 'Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets.',
  };
}
