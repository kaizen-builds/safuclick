// Builder agent: turns Kane's report into a fix prompt, then hardens the checker.
// Default: a scripted, LLM-free builder that derives rule patches from the evidence.
// Plug in a real coding agent with SAFU_BUILDER_CMD; it receives the same fix prompt.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readJSON, writeJSON, p, ROOT } from '../paths.js';
import { kaneText } from '../verdict.js';

const MAX = (1n << 256n) - 1n;

export function writeFixPrompt({ round, move, verdict, kane, walletLog, rulesFile, promptDir }) {
  const file = path.join(promptDir, `round-${round}-fix.md`);
  const txs = walletLog.filter((e) => e.type === 'tx_decoded').map((e) => e.decoded);
  const signatures = walletLog.filter((e) => e.type === 'sig_decoded').map((e) => e.decoded);
  const batches = walletLog.filter((e) => e.type === 'batch_decoded').map((e) => e.decoded);
  const inputs = walletLog.filter((e) => e.type === 'input_seen').map((e) => e.field);
  const ruleHits = verdict.reasons.filter((r) => r.source.startsWith('rule:'));
  const md = [
    `# SafuClick fix request: round ${round}`,
    '',
    `Kane CLI just refereed the scammer's move **${move.name}** on \`${verdict.url}\`.`,
    `Verdict with current rules (v${verdict.rulesVersion}): **${verdict.verdict}**. Deterministic rules fired: **${ruleHits.length ? ruleHits.map((r) => r.id).join(', ') : 'none'}**.`,
    '',
    '## What Kane reported',
    '```', `status: ${kane.status}`, `one_liner: ${kane.one_liner || ''}`, `summary: ${(kane.summary || '').trim()}`, `test_url: ${kane.test_url || ''}`, '```',
    '### Kane steps', ...kane.steps.map((s) => `- ${s.step}: ${s.remark}`),
    '',
    '## Wallet evidence (mock wallet log)',
    '```json', JSON.stringify({ transactions: txs, signatures, batches, inputs }, null, 2), '```',
    '',
    '## Your task (builder agent)',
    `1. Harden the heuristics in \`${path.relative(ROOT, rulesFile)}\` (and \`src/verdict.js\` if a new rule type is needed) so this evidence is flagged by a **deterministic rule** (source \`rule:*\`), not only by Kane's LLM judgement.`,
    '2. Do not break the official site: `config/allowlist.json` routers and the official swap must stay clean.',
    `3. Add a regression fixture under \`test/fixtures/regressions/\` and make \`SAFU_RULES=${path.relative(ROOT, rulesFile)} npm test\` pass.`,
    '4. Exit. The loop will re-run Kane against the same trap to verify your fix.',
  ].join('\n');
  fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(file, md + '\n');
  return file;
}

// Scripted builder: reads the evidence and applies the matching hardening.
export const FAKE_EXCHANGE_RULES = {
  flagTickerDigitsDomain: true,
  tickers: ['usdc', 'usdt', 'btc', 'eth', 'bnb', 'sol', 'trx', 'xrp', 'doge', 'busd', 'dai', 'binance', 'coinbase', 'okx', 'bybit', 'kraken', 'kucoin', 'huobi', 'htx', 'bitget', 'mexc', 'gateio'],
  newDomainDays: 90,
  flagFakeExchangeSignals: true,
  loginPattern: '\\b(log ?in|sign ?in|register|sign ?up|password|username)\\b',
  exchangeWords: ['withdraw', 'balance', 'deposit', 'customer service', 'online service', 'vip', 'assets', 'exchange', 'trading', 'invest', 'bitcoin', 'ethereum'],
  minSignals: 3,
};

function scriptedPatch(rules, { walletLog, kane, intendedAmount, allowlist, url, probe }) {
  const r = structuredClone(rules); const changes = [];
  const intended = BigInt(Math.round(intendedAmount * 1e6));
  const spenders = Object.keys(allowlist.spenders).map((s) => s.toLowerCase());
  for (const e of walletLog.filter((x) => x.type === 'tx_decoded' && x.decoded.kind === 'approve')) {
    const d = e.decoded; const amt = BigInt(d.amountRaw);
    if (amt !== MAX && amt > intended * 10n && !r.approval.maxAllowanceRatio) { r.approval.maxAllowanceRatio = 10; changes.push('approval.maxAllowanceRatio = 10 (approvals > 10x the intended swap are flagged)'); }
    if (!spenders.includes(d.spender) && !r.approval.requireKnownSpender) { r.approval.requireKnownSpender = true; changes.push('approval.requireKnownSpender = true (spender must be an allowlisted router)'); }
    if (spenders.some((s) => s !== d.spender && s.slice(2, 6) === d.spender.slice(2, 6) && s.slice(-4) === d.spender.slice(-4)) && !r.approval.flagAddressPoisoning) { r.approval.flagAddressPoisoning = true; changes.push('approval.flagAddressPoisoning = true (same prefix/suffix as a known router)'); }
  }
  // New trap families: only switch on the rule block the evidence actually needs.
  const sigs = walletLog.filter((x) => x.type === 'sig_decoded').map((x) => x.decoded);
  if (sigs.some((s) => (s.permits || []).length) && !r.signatures?.decodeTypedData) {
    r.signatures = { decodeTypedData: true, flagUnknownSpender: true, flagLargeAmount: true, maxDeadlineDays: 30, flagEthSign: true };
    changes.push('signatures.* on: decode eth_signTypedData_v4 Permit/Permit2 and flag unknown spender, unlimited amount or expiry > 30 days');
  }
  if (sigs.some((s) => s.kind === 'eth_sign') && !r.signatures?.flagEthSign) { r.signatures = { ...(r.signatures || {}), flagEthSign: true }; changes.push('signatures.flagEthSign = true'); }
  const txKinds = walletLog.filter((x) => x.type === 'tx_decoded').map((x) => x.decoded.kind);
  if (txKinds.some((k) => k === 'increaseAllowance' || k === 'increaseApproval') && !r.approval.includeIncrease) {
    r.approval.includeIncrease = true; changes.push('approval.includeIncrease = true (increaseAllowance / increaseApproval get the same checks as approve)');
  }
  if (txKinds.includes('setApprovalForAll') && !r.nft?.flagApprovalForAll) {
    r.nft = { flagApprovalForAll: true, revokeWords: ['revoke', 'approval checker', 'risky approvals'] };
    changes.push('nft.flagApprovalForAll = true (+ fake "revoke" page wording check)');
  }
  if (walletLog.some((x) => x.type === 'batch_decoded' || x.type === 'auth_decoded') && !r.batch) {
    r.batch = { flagMultiCallForSingleAction: true, flagBulkApprovals: true, flagUnknownDelegator: true };
    changes.push('batch.* on: decode wallet_sendCalls / EIP-7702 and flag hidden multi-call grants');
  }
  // Real-site miss: fake exchange / withdrawal-fee landing page (ticker+digits domain, login wall, generic title).
  if (probe && url && !r.fakeExchange) {
    const host = new URL(url).hostname.toLowerCase();
    const tickerDigits = new RegExp(`(${FAKE_EXCHANGE_RULES.tickers.join('|')})[-_]?\\d{2,}|\\d{2,}[-_]?(${FAKE_EXCHANGE_RULES.tickers.join('|')})`, 'i').test(host);
    const exchangey = /exchange|trading|withdraw|balance|bitcoin|ethereum|log ?in|register/i.test(kaneText(kane) + ' ' + (probe.title || ''));
    if (tickerDigits || exchangey) {
      r.fakeExchange = structuredClone(FAKE_EXCHANGE_RULES);
      changes.push('fakeExchange.* on: ticker/exchange-name + digits domains, RDAP domain age (<= 90 days), login/register wall + withdraw/balance/customer-service wording + Turnstile + generic title on a non-listed domain');
    }
  }
  const secretish = [
    ['secret words', /secret words?/i], ['\\b(12|24)[- ]?(secret |recovery |seed |private )?words\\b', /\b(12|24)[- ]?(\w+ )?words\b/i],
    ['re-?sync.{0,40}(wallet|words)', /re-?sync/i], ['passphrase', /passphrase/i],
  ];
  const fieldText = walletLog.filter((x) => x.type === 'input_seen').map((x) => [x.field.label, x.field.placeholder, x.field.nearbyText].join(' ')).join('\n');
  const evidenceText = fieldText + '\n' + kaneText(kane);
  for (const [pat, test] of secretish) {
    if (test.test(evidenceText) && !r.seed.patterns.includes(pat)) { r.seed.patterns.push(pat); changes.push(`seed.patterns += /${pat}/`); }
  }
  for (const k of ['approv', 'spender', 'secret words', 'phishing', 'permit', 'signature', 'setApprovalForAll', 'batch', 'increaseAllowance', 'delegat']) {
    if (new RegExp(k, 'i').test(kaneText(kane)) && !r.kane.textPatterns.includes(k)) { r.kane.textPatterns.push(k); changes.push(`kane.textPatterns += "${k}"`); }
  }
  if (changes.length) r.version = (r.version || 0) + 1;
  return { rules: r, changes };
}

export function build({ round, move, fixPrompt, rulesFile, evidence }) {
  const before = readJSON(rulesFile);
  let changes;
  if (process.env.SAFU_BUILDER_CMD) {
    execSync(process.env.SAFU_BUILDER_CMD, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, SAFU_FIX_PROMPT: fixPrompt, SAFU_RULES: rulesFile } });
    const after = readJSON(rulesFile);
    changes = [`external builder updated rules v${before.version} → v${after.version}`];
  } else {
    const { rules, changes: c } = scriptedPatch(before, evidence);
    writeJSON(rulesFile, rules); changes = c;
  }
  // Regression fixture from the real Kane run + wallet log, so the catch is locked in.
  const fx = p('test', 'fixtures', 'regressions', `${move.name}.json`);
  writeJSON(fx, { name: move.name, url: evidence.url, intendedAmount: evidence.intendedAmount, kane: evidence.kane, walletLog: evidence.walletLog, ...(evidence.probe ? { probe: evidence.probe, mode: 'real-site' } : {}), expect: 'TRAP FLAGGED', expectRuleSource: true, minRulesVersion: readJSON(rulesFile).version });
  let testsOk = true;
  try { execSync('node --test test/*.test.js', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, SAFU_RULES: rulesFile } }); } catch (e) { testsOk = false; changes.push('tests failed:\n' + String(e.stdout).slice(-800)); }
  return { changes, testsOk, fixture: fx, rules: readJSON(rulesFile) };
}
