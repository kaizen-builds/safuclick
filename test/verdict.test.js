// Fixture tests: real Kane run outputs + wallet logs (captured from the gym) → expected verdicts.
// No Kane credits, no browser. Rules file can be overridden with SAFU_RULES (the loop does this).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluate } from '../src/verdict.js';
import { checkDomain, levenshtein } from '../src/domain.js';
import { loadKaneNdjson } from '../src/kane.js';
import { p, readJSON } from '../src/paths.js';

const rules = readJSON(process.env.SAFU_RULES || p('config', 'rules.json'));
const baseline = readJSON(p('config', 'rules.baseline.json'));
const allow = readJSON(p('config', 'allowlist.json'));
const FX = p('test', 'fixtures');

function fixture(name) {
  const dir = path.join(FX, name);
  return { url: readJSON(path.join(dir, 'meta.json')).url, intendedAmount: 10, kane: loadKaneNdjson(path.join(dir, 'kane.ndjson')), walletLog: readJSON(path.join(dir, 'wallet-log.json')) };
}

test('levenshtein + domain lookalikes', () => {
  assert.equal(levenshtein('safuswap', 'safuswep'), 1);
  assert.equal(checkDomain('http://safuswap.localhost:4100/', allow, rules).official, true);
  assert.ok(checkDomain('http://safuswep.localhost:4101/', allow, rules).findings.some((f) => f.id === 'lookalike_domain'));
  assert.ok(checkDomain('http://safuswap-verify.localhost:4102/', allow, rules).findings.some((f) => f.id === 'brand_impersonation'));
  assert.ok(checkDomain('http://xn--safuswa-0ze.localhost/', allow, rules).findings.some((f) => f.id === 'punycode_domain'));
});

const cases = [
  ['official', 'NO KNOWN TRAPS FOUND', []],
  ['approval', 'TRAP FLAGGED', ['unlimited_approval']],
  ['seed', 'TRAP FLAGGED', ['seed_phrase_prompt']],
  ['clone', 'TRAP FLAGGED', ['lookalike_domain', 'unknown_contract']],
];
for (const [name, verdict, ids] of cases) {
  if (!fs.existsSync(path.join(FX, name))) continue;
  test(`real Kane run fixture: ${name} → ${verdict}`, () => {
    for (const r of [baseline, rules]) {
      const v = evaluate(fixture(name), r, allow);
      assert.equal(v.verdict, verdict, JSON.stringify(v.reasons, null, 1));
      for (const id of ids) assert.ok(v.reasons.some((x) => x.id === id), `${name} should include ${id}`);
    }
  });
}

test('synthetic: 5,000,000 USDC approval to a poisoned router address', () => {
  const walletLog = [{ type: 'tx_decoded', decoded: { kind: 'approve', label: 'Approve token spending', to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', token: 'USDC', spender: '0x5afe9d1b7c3e2a4f6b8d0e1c3a5f7b9d1ec0ffee', amountRaw: '5000000000000', amountHuman: '5,000,000 USDC' } }];
  const v0 = evaluate({ url: 'http://safuswap.localhost:4110/', walletLog, kane: { status: 'passed', steps: [] } }, baseline, allow);
  assert.equal(v0.verdict, 'NO KNOWN TRAPS FOUND', 'baseline rules are naive on purpose (the loop hardens them)');
});

// Regressions written by the builder agent during `npm run loop`.
const regDir = path.join(FX, 'regressions');
for (const f of fs.existsSync(regDir) ? fs.readdirSync(regDir).filter((x) => x.endsWith('.json')) : []) {
  test(`regression (from loop): ${f}`, () => {
    const fx = readJSON(path.join(regDir, f));
    const v = evaluate(fx, rules, allow);
    assert.equal(v.verdict, fx.expect);
    if (fx.expectRuleSource) assert.ok(v.reasons.some((r) => r.source.startsWith('rule:')), 'must be caught by a deterministic rule, not only Kane: ' + JSON.stringify(v.reasons.map((r) => r.id)));
  });
}
