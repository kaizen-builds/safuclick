// Prompts for the two LLM agents. Both see real artefacts: the current rules, the checker source
// (src/verdict.js) and, for the builder, Kane's NDJSON run_end + steps and the mock-wallet log.
import fs from 'node:fs';
import { p, readJSON } from '../paths.js';
import { SCENARIOS } from '../kane.js';
import { FAMILIES } from './variant-guard.js';

const verdictSrc = () => fs.readFileSync(p('src', 'verdict.js'), 'utf8');
const json = (v) => '```json\n' + JSON.stringify(v, null, 2) + '\n```';

const GYM_RULES = [
  'Gym page wiring (src/gym/public/app.js), so you know what fires when:',
  '- skin "swap" (default): Connect Wallet, then the Swap button sends ONE wallet request: batch trap -> wallet_sendCalls; else approve trap -> approve(spender, amount) on USDC; else increaseAllowance trap -> increaseAllowance/increaseApproval; else a normal router swap. scenario: swap (approve), allowance (increaseAllowance) or batch.',
  '- skin "claim": airdrop page. Claim button asks for eth_signTypedData_v4: permit2 trap -> Permit2 PermitSingle (or PermitBatch with batch:true), permit trap -> EIP-2612 Permit. scenario: claim.',
  '- skin "revoke": approval checker. Revoke button sends setApprovalForAll(operator, approved) on the collection. scenario: revoke.',
  '- skin "cloak": placeholder ("Coming soon") unless a wallet is injected; hideFromAutomation also hides from webdriver/HeadlessChrome. Then claim flow with a permit/permit2 trap. scenario: cloak.',
  '- seed_prompt (any skin): a modal with your title/wording/placeholder/button, on load or after connect.',
  '- lookalike_domain: marker only; the trick is the host you pick (*.localhost).',
  'Known-good addresses: router 0x5afe5afe00000000000000000000000000c0ffee, USDC 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48, WETH 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2, Uniswap V3 positions NFT 0xc36442b4a4522e871399cd717abdd847ab11fe88. USDC amounts are base units (6 decimals): "10000000" = 10 USDC. The official site is safuswap.localhost; the user intends to swap 10 USDC.',
].join('\n');

export function scammerMessages({ rules, history, examples, lastErrors }) {
  const sys = [
    'You are the RED-TEAM scammer agent in SafuClick\'s phishing gym, a closed local training range for a crypto-link safety checker.',
    'Everything runs on http://*.localhost with a mock wallet, mock contracts and no real funds. Your job is to help the defenders by finding gaps.',
    `Hard limits: only variants of these EXISTING trap families: ${FAMILIES.join(', ')}. No new trap types, no real domains, no URLs, no HTML in text.`,
    'Each round you plant ONE gym site config. Kane CLI (an AI browser agent) then drives the page with the mock wallet and the deterministic rules judge the evidence.',
    'You WIN a round if no deterministic rule (reason source "rule:*") flags your trap. Kane\'s own judgement (source "kane") does not count as a rule catch.',
    'Read the checker source and the current rules carefully and look for a concrete gap, while keeping it a REAL trap (it must still harm a user who clicks through).',
    'Do not repeat a trick that was already caught or already fixed in a previous round; evolve.',
  ].join('\n');
  const user = [
    '## Current defender rules (config/rules.json)', json(rules),
    '## Checker source (src/verdict.js)', '```js\n' + verdictSrc() + '\n```',
    '## ' + GYM_RULES,
    '## Example gym configs (existing variants)', json(examples),
    '## Kane objectives per scenario (what Kane will try and check)', json(Object.fromEntries(Object.entries(SCENARIOS).map(([k, f]) => [k, f(10)]))),
    '## Previous rounds in this loop', json(history.length ? history : 'none yet'),
    lastErrors ? `## Your previous answer was rejected by the gym guard. Fix these errors:\n${lastErrors.map((e) => '- ' + e).join('\n')}` : '',
    '## Answer with ONE JSON object only:',
    json({ name: 'short-kebab-name', family: 'one of the families', gap: 'which rule or check you expect to slip past, and why (cite the rule key / code path)', pitch: 'one sentence: what the trap does to the victim', taunt: 'one short taunt for the builder (no emoji)', site: { id: 'kebab-id', host: 'something.localhost', title: 'Page title', router: '0x...', skin: 'swap|claim|revoke|cloak', scenario: 'swap|claim|revoke|batch|allowance|cloak', traps: [{ type: '...' }] } }),
  ].join('\n\n');
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

export function kaneDigest(dir, kane, walletLog) {
  const lines = fs.readFileSync(`${dir}/kane.ndjson`, 'utf8').split('\n').filter((l) => l.trim().startsWith('{'));
  const end = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.type === 'run_end') || null;
  const evidence = walletLog.filter((e) => ['wallet_request', 'tx_decoded', 'sig_decoded', 'batch_decoded', 'auth_decoded', 'wallet_decision', 'input_seen', 'page_snapshot'].includes(e.type))
    .map(({ type, method, decoded, approved, field, title, text }) => ({ type, ...(method && { method }), ...(decoded && { decoded }), ...(approved !== undefined && { approved }), ...(field && { field }), ...(title && { title }), ...(text && { text: String(text).slice(0, 200) }) }));
  return { ndjsonLines: lines.length, run_end: end, steps: kane?.steps || [], walletEvidence: evidence.slice(0, 40) };
}

export function builderMessages({ round, variantUrl, scenario, digest, verdict, rules, lastGate, attempt }) {
  const schema = readJSON(p('config', 'rules.schema.json'));
  const sys = [
    'You are the BUILDER (defender) agent for SafuClick, a checker that flags crypto phishing traps from Kane CLI runs plus mock-wallet evidence.',
    'You read Kane\'s NDJSON output, the wallet evidence and the verdict, and decide whether the trap was MISSED by the deterministic rules (no reason with source starting "rule:").',
    'If it was missed, write the fix yourself as edits to config/rules.json. You may ONLY edit the existing rules format (config/rules.schema.json) with ops:',
    '  {"op":"set","path":"section.key","value":...}  or  {"op":"append","path":"section.listKey","value":"pattern"}',
    'You cannot change code. Rule regexes are case-insensitive JavaScript regexes; plain words are matched literally.',
    'Your fix is gated before it is applied: schema check, hardening only (never switch a true flag off, never delete entries, thresholds only tighten), re-judging every recorded Kane run (no verdict may change: no lost catches and no new false alarms on the official site), the missed run must become flagged by a rule, and the full unit test suite must pass.',
    'Prefer the narrowest fix that generalises to the trick (e.g. a phrase family rather than one exact sentence). If no rules-format edit can fix it, say so (fixable:false) instead of forcing a bad rule.',
    'Then call Kane again to confirm the fix by filling kane_recheck. The harness runs exactly that kane-cli command on the same trap.',
  ].join('\n');
  const user = [
    `## Round ${round}: Kane CLI just refereed ${variantUrl} (scenario ${scenario})`,
    '## Kane NDJSON (run_end event + step remarks)', json({ ndjsonLines: digest.ndjsonLines, run_end: digest.run_end, steps: digest.steps }),
    '## Mock-wallet evidence log', json(digest.walletEvidence),
    '## SafuClick verdict with the current rules', json({ verdict: verdict.verdict, rulesVersion: verdict.rulesVersion, reasons: verdict.reasons.map((r) => ({ id: r.id, source: r.source, detail: r.detail })), signals: verdict.signals, note: verdict.note }),
    '## Current rules (config/rules.json)', json(rules),
    '## Rules schema (config/rules.schema.json)', json(schema),
    '## Checker source (src/verdict.js)', '```js\n' + verdictSrc() + '\n```',
    lastGate ? `## Your previous fix (attempt ${attempt - 1}) was REJECTED by the gate at step "${lastGate.rejectedAt}":\n${lastGate.steps.filter((s) => !s.ok).flatMap((s) => s.errors).map((e) => '- ' + String(e).slice(0, 400)).join('\n')}\nRevise the ops.` : '',
    '## Answer with ONE JSON object only:',
    json({ missed: true, diagnosis: 'what Kane saw, what the wallet was asked to do, and why no rule fired', fixable: true, ops: [{ op: 'append', path: 'seed.patterns', value: 'example' }], expected_rule_ids: ['seed_phrase_prompt'], kane_recheck: { run: true, max_steps: 14, why: 'confirm the hardened rules flag the same trap' }, message_to_kane_log: 'one line for the transcript' }),
  ].join('\n\n');
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

export function reactionMessages({ round, decision, gate, recheck }) {
  return [
    { role: 'system', content: 'You are the BUILDER agent for SafuClick. You asked Kane CLI to re-check a trap after your rules fix. Read Kane\'s result and react: is the trap now FIXED (flagged by a deterministic rule source "rule:*")? Be factual and brief.' },
    { role: 'user', content: [
      `## Round ${round}. Your fix`, json({ ops: decision.ops, expected_rule_ids: decision.expected_rule_ids, gate: gate.steps }),
      '## Kane re-check result', json({ kane: { status: recheck.kane?.status, one_liner: recheck.kane?.one_liner, steps: (recheck.kane?.steps || []).length, credits: recheck.kane?.credits }, verdict: recheck.verdict, reasons: recheck.reasons.map((r) => ({ id: r.id, source: r.source, detail: r.detail })) }),
      'Answer with ONE JSON object only: {"confirmed_fixed": true|false, "comment": "one or two sentences", "next": "what the scammer will probably try next"}',
    ].join('\n\n') },
  ];
}
