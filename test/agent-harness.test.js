// Agent <-> Kane harness with a MOCKED LLM and a mocked Kane (no network, no credits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { p, readJSON, writeJSON } from '../src/paths.js';
import { evaluate } from '../src/verdict.js';
import { extractJSON, createBrain } from '../src/agents/llm.js';
import { validateVariant } from '../src/agents/variant-guard.js';
import { validateRules, hardeningErrors, applyOps, gateCandidate, replayGate, recordedRuns } from '../src/rules-guard.js';
import { runAgentLoop } from '../src/agents/agent-loop.js';

const allow = readJSON(p('config', 'allowlist.json'));
const v7 = readJSON(p('config', 'rules.json'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'safu-agent-'));
const okTests = () => ({ ok: true, pass: 1, fail: 0, tests: 1 });

const SEED_SITE = { id: 'backup-words', host: 'safuswap.localhost', title: 'SafuSwap', router: '0x5afe5afe00000000000000000000000000c0ffee', skin: 'swap', scenario: 'swap',
  traps: [{ type: 'seed_prompt', when: 'after_connect', title: 'Session expired', wording: 'Type your twelve backup words to restore SafuWallet.', placeholder: 'twelve backup words' }] };
const seedEvidence = (site) => [
  { type: 'page_loaded', title: site.title, text: '' },
  { type: 'wallet_request', method: 'eth_requestAccounts' },
  { type: 'input_seen', field: { tag: 'textarea', id: 'verify-input', placeholder: site.traps[0].placeholder, label: '', nearbyText: `${site.traps[0].title} ${site.traps[0].wording}` } },
];
const GOOD_OPS = [{ op: 'append', path: 'seed.patterns', value: '\\b(twelve|twenty[- ]four|12|24)\\b.{0,20}\\bwords\\b' }];

// Mock Kane: writes a run dir like check() does, judged by the rules file the harness passes in.
function mockKane(log) {
  return async (url, o) => {
    const dir = o.outDir; fs.mkdirSync(dir, { recursive: true });
    const kane = { status: 'passed', one_liner: 'Connected and swapped; a session popup asked for words, did not type.', summary: 'Swap of 10 USDC completed.', credits_consumed: 5, steps: [{ step: 1, remark: 'clicked Connect Wallet' }] };
    fs.writeFileSync(path.join(dir, 'kane.ndjson'), JSON.stringify({ step: 1, status: 'done', remark: 'clicked Connect Wallet' }) + '\n' + JSON.stringify({ type: 'run_end', ...kane }) + '\n');
    const walletLog = seedEvidence(o.site);
    writeJSON(path.join(dir, 'wallet-log.json'), walletLog);
    const verdict = evaluate({ url, kane, walletLog, mode: 'gym' }, readJSON(o.rules), allow);
    writeJSON(path.join(dir, 'verdict.json'), verdict);
    log.push(o.phase);
    return { verdict, kane, walletLog, runDir: dir };
  };
}

function scriptedBrain(answers) {
  const calls = [];
  return { mode: 'mock', provider: { name: 'mock', model: 'mock-1' }, calls,
    async ask(key, messages) {
      const a = answers[key]; if (a === undefined) throw new Error('no mock answer for ' + key);
      const text = typeof a === 'function' ? a(messages) : '```json\n' + JSON.stringify(a) + '\n```';
      const call = { key, source: 'llm', model: 'mock-1', messages, response: text }; calls.push(call);
      return { text, json: () => extractJSON(text), call };
    } };
}

test('extractJSON reads fenced and bare JSON with braces inside strings', () => {
  assert.deepEqual(extractJSON('Sure:\n```json\n{"a":"}{","b":[1]}\n```'), { a: '}{', b: [1] });
  assert.deepEqual(extractJSON('noise {"x":{"y":2}} tail'), { x: { y: 2 } });
  assert.throws(() => extractJSON('no json here'));
});

test('variant guard: existing gym variants pass, unsafe or new trap types are rejected', () => {
  for (const s of readJSON(p('gym', 'variants.json')).variants) { const { port, ...site } = s; assert.deepEqual(validateVariant(site).errors, [], s.id); }
  const bad = validateVariant({ id: 'x-1', host: 'uniswap.org', title: 'Hi <script>', router: '0x1', traps: [{ type: 'transfer', to: '0x' }] }).errors.join('\n');
  assert.match(bad, /localhost/); assert.match(bad, /not an existing trap family/); assert.match(bad, /title/);
  assert.match(validateVariant({ ...SEED_SITE, traps: [{ type: 'permit2', spender: '0x' + 'c'.repeat(40) }] }).errors.join(), /claim or cloak skin/);
  const ok = validateVariant(SEED_SITE); assert.deepEqual(ok.errors, []); assert.equal(ok.url, 'http://safuswap.localhost:4110/'); assert.equal(ok.site.id, 'agent-backup-words');
});

test('rules schema: shipped rules valid; unknown keys, bad or catch-all regexes rejected', () => {
  assert.deepEqual(validateRules(v7), []);
  assert.deepEqual(validateRules(readJSON(p('config', 'rules.baseline.json'))), []);
  assert.match(validateRules({ ...v7, magic: { x: 1 } }).join(), /unknown section/);
  assert.match(validateRules({ ...v7, seed: { patterns: ['(unclosed'] } }).join(), /does not compile/);
  assert.match(validateRules({ ...v7, seed: { patterns: ['.*'] } }).join(), /empty string/);
  assert.match(validateRules({ ...v7, kane: { ...v7.kane, textPatterns: [...v7.kane.textPatterns, 'swap'] } }).join(), /clean swap/);
});

test('hardening only: no switching flags off, no deleting entries, thresholds only tighten', () => {
  const off = applyOps(v7, [{ op: 'set', path: 'approval.requireKnownSpender', value: false }]).rules;
  assert.match(hardeningErrors(v7, off).join(), /switched off/);
  const loose = applyOps(v7, [{ op: 'set', path: 'approval.maxAllowanceRatio', value: 50 }]).rules;
  assert.match(hardeningErrors(v7, loose).join(), /loosened/);
  const del = structuredClone(v7); del.seed.patterns = del.seed.patterns.slice(1); del.version++;
  assert.match(hardeningErrors(v7, del).join(), /removed entry/);
  assert.match(applyOps(v7, [{ op: 'set', path: 'evil.code', value: 1 }]).errors.join(), /not in config\/rules.schema.json/);
  assert.match(applyOps(v7, [{ op: 'append', path: 'approval.flagMaxUint', value: 'x' }]).errors.join(), /not a list/);
});

test('replay gate: shipped rules re-judge every recorded Kane run identically', () => {
  const dirs = recordedRuns();
  assert.ok(dirs.length >= 20, 'recorded runs present');
  assert.deepEqual(replayGate(v7, v7, dirs).regressions, []);
});

test('gate: a fix that does not catch the missed run is rejected; a good one passes every step', async () => {
  const d = tmp(); const log = [];
  const r = await mockKane(log)('http://safuswap.localhost:4110/', { outDir: d, site: SEED_SITE, rules: p('config', 'rules.json'), phase: 'x' });
  assert.equal(r.verdict.verdict, 'NO KNOWN TRAPS FOUND', 'v7 misses "twelve backup words" (the gap the agent loop is for)');
  const weak = gateCandidate({ before: v7, ops: [{ op: 'append', path: 'seed.patterns', value: 'passphrase' }], missedDir: d, runTests: okTests });
  assert.equal(weak.ok, false); assert.equal(weak.rejectedAt, 'fix-effective');
  const good = gateCandidate({ before: v7, ops: GOOD_OPS, missedDir: d, runTests: okTests });
  assert.equal(good.ok, true, JSON.stringify(good.steps));
  assert.deepEqual(good.steps.map((s) => s.step), ['ops', 'schema', 'hardening-only', 'fix-effective', 'replay-recorded-runs', 'unit-tests']);
  assert.equal(good.rules.version, v7.version + 1);
  const failingTests = gateCandidate({ before: v7, ops: GOOD_OPS, missedDir: d, runTests: () => ({ ok: false, fail: 1, tests: 2, tail: 'boom' }) });
  assert.equal(failingTests.rejectedAt, 'unit-tests');
});

test('agent loop (mocked LLM + mocked Kane): MISSED -> rejected fix logged -> accepted fix -> Kane re-check -> FIXED', async () => {
  const out = tmp(); const kaneLog = [];
  const brain = scriptedBrain({
    'r1:scammer:1': { name: 'bad', family: 'transfer', gap: 'x', pitch: 'x', taunt: 'x', site: { ...SEED_SITE, host: 'evil.com' } },
    'r1:scammer:2': { name: 'backup-words', family: 'seed_prompt', gap: 'seed.patterns has no "backup words"', pitch: 'asks for twelve backup words', taunt: 'Say the magic words.', site: SEED_SITE },
    'r1:builder:1': { missed: true, diagnosis: 'switching off is wrong', fixable: true, ops: [{ op: 'set', path: 'kane.flagFailedFlow', value: false }], kane_recheck: { run: true, max_steps: 12 } },
    'r1:builder:2': { missed: true, diagnosis: 'input asks for twelve backup words; no seed pattern matched', fixable: true, ops: GOOD_OPS, expected_rule_ids: ['seed_phrase_prompt'], kane_recheck: { run: true, max_steps: 12, why: 'confirm' } },
    'r1:builder:reaction': { confirmed_fixed: true, comment: 'Kane re-check flagged seed_phrase_prompt from rule:dom.', next: 'a different number word' },
  });
  const r = await runAgentLoop({ rounds: 1, brain, runCheck: mockKane(kaneLog), runTests: okTests, outDir: out, kane: 'mock', balance: () => null, log: () => {} });
  const h = r.history[0];
  assert.equal(h.outcome, 'MISSED -> FIXED');
  assert.deepEqual(kaneLog, ['kane-1-first', 'kane-2-recheck']);
  assert.equal(readJSON(path.join(out, 'rules.working.json')).version, v7.version + 1);
  const T = readJSON(path.join(out, 'round-1', 'transcript.json')).entries;
  const seq = T.map((e) => `${e.from}>${e.to || ''}:${e.kind}`);
  assert.deepEqual(seq, [
    'harness>scammer:prompt', 'scammer>harness:decision', 'harness>scammer:guard',
    'harness>scammer:prompt', 'scammer>harness:decision', 'harness>:guard',
    'harness>kane:command', 'kane>harness:result',
    'harness>builder:prompt', 'builder>harness:decision', 'harness>builder:gate',
    'harness>builder:prompt', 'builder>harness:decision', 'harness>builder:gate',
    'builder>kane:command', 'kane>builder:result', 'builder>harness:reaction', 'harness>:apply',
  ]);
  assert.equal(T[10].ok, false); assert.equal(T[10].rejectedAt, 'hardening-only');
  assert.match(T[14].command, /^kane-cli run .* --agent --max-steps 12/s);
  assert.ok(fs.readFileSync(path.join(out, 'round-1', 'transcript.md'), 'utf8').includes('REJECTED at hardening-only'));
  assert.equal(readJSON(path.join(out, 'round-1', 'llm-calls.json')).length, 5);
  assert.equal(readJSON(path.join(config(), 'rules.json')).version, v7.version, 'config/rules.json untouched without --promote');
});
const config = () => p('config');

test('agent loop: rules catch -> CAUGHT, no fix and no re-check', async () => {
  const out = tmp(); const kaneLog = [];
  const site = { ...SEED_SITE, traps: [{ ...SEED_SITE.traps[0], wording: 'Enter your seed phrase to continue.' }] };
  const brain = scriptedBrain({
    'r1:scammer:1': { name: 'plain-seed', family: 'seed_prompt', gap: 'none', pitch: 'p', taunt: 't', site },
    'r1:builder:1': { missed: false, diagnosis: 'seed_phrase_prompt fired from rule:dom', fixable: true, ops: [] },
  });
  const r = await runAgentLoop({ rounds: 1, brain, runCheck: mockKane(kaneLog), runTests: okTests, outDir: out, kane: 'mock', balance: () => null, log: () => {} });
  assert.equal(r.history[0].outcome, 'CAUGHT'); assert.equal(r.history[0].agreesWithRules, true);
  assert.deepEqual(kaneLog, ['kane-1-first']);
});

test('brain: replay answers from a recording; llm mode falls back to the recording on provider error', async () => {
  const recorded = [{ key: 'r1:scammer:1', response: '{"ok":1}', model: 'rec' }];
  const rep = createBrain({ mode: 'replay', recorded });
  assert.deepEqual((await rep.ask('r1:scammer:1', [])).json(), { ok: 1 });
  await assert.rejects(rep.ask('r9:x:1', []), /no recorded answer/);
  const notes = [];
  const fb = createBrain({ mode: 'llm', provider: { name: 'p', model: 'm', baseUrl: 'http://x' }, recorded, chat: async () => { throw new Error('HTTP 503'); }, log: (s) => notes.push(s) });
  const a = await fb.ask('r1:scammer:1', []);
  assert.equal(a.call.source, 'fallback'); assert.match(notes[0], /falling back/);
  await assert.rejects(fb.ask('r2:none:1', []), /HTTP 503/);
});
