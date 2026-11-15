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
import { inspectHtml } from '../src/probe.js';
import { safuCard } from '../src/card.js';

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
    // Mid-loop (`SAFU_RULES` still at v1) must not fail later-round fixtures that need v2 patterns.
    if ((fx.minRulesVersion || 0) > (rules.version || 0)) return;
    const v = evaluate(fx, rules, allow);
    assert.equal(v.verdict, fx.expect);
    if (fx.expectRuleSource) assert.ok(v.reasons.some((r) => r.source.startsWith('rule:')), 'must be caught by a deterministic rule, not only Kane: ' + JSON.stringify(v.reasons.map((r) => r.id)));
  });
}


test('real-site: official Uniswap domain is known-good and Connect Wallet is a signal, not a trap', () => {
  const probe = {
    finalUrl: 'https://app.uniswap.org/', status: 200, title: 'Uniswap Interface',
    walletConnect: true, fields: [], hops: [{ url: 'https://app.uniswap.org/', status: 200 }],
    blocked: false,
  };
  const v = evaluate({ url: 'https://app.uniswap.org/', kane: { status: 'passed', steps: [], one_liner: 'Observed the Uniswap app. Connect Wallet is visible. No seed phrase fields.' }, probe, mode: 'real-site' }, rules, allow);
  assert.equal(v.verdict, 'NO KNOWN TRAPS FOUND', JSON.stringify(v.reasons, null, 1));
  assert.equal(v.officialDomain, true);
  assert.ok(v.signals.some((s) => s.id === 'wallet_connect_prompt'));
});

test('real-site: brand impersonation + seed field in HTML is flagged', () => {
  const html = '<title>Aave</title><h1>Verify wallet</h1><input placeholder="Enter your 12-word recovery phrase">';
  const inspected = inspectHtml(html, 'https://aave-fi.info/');
  assert.ok(inspected.fields.some((f) => /recovery phrase/i.test(f.placeholder)));
  const probe = { finalUrl: 'https://aave-fi.info/', status: 200, title: inspected.title, fields: inspected.fields, walletConnect: true, hops: [], blocked: false, textSnippet: 'Verify wallet Enter your 12-word recovery phrase' };
  const v = evaluate({ url: 'https://aave-fi.info/', kane: { status: 'failed', reason_code: 'assertion_error', summary: 'The page asked for a recovery phrase.', one_liner: 'Seed prompt.', steps: [] }, probe, mode: 'real-site' }, rules, allow);
  assert.equal(v.verdict, 'TRAP FLAGGED');
  assert.ok(v.reasons.some((r) => r.id === 'brand_impersonation'), JSON.stringify(v.reasons));
  assert.ok(v.reasons.some((r) => r.id === 'seed_phrase_prompt'));
});

test('real-site: cloaked/blocked page with no other evidence is inconclusive', () => {
  const v = evaluate({
    url: 'https://suspicious-claim.example/',
    kane: null,
    probe: { finalUrl: 'https://suspicious-claim.example/', status: 403, title: 'Just a moment...', fields: [], hops: [], blocked: true, error: null },
    mode: 'real-site',
  }, rules, allow);
  assert.equal(v.verdict, 'INCONCLUSIVE');
  assert.ok(v.signals.some((s) => s.id === 'cloaking_or_block'));
});

test('inspectHtml detects Connect Wallet copy', () => {
  const i = inspectHtml('<button>Connect Wallet</button>', 'https://example.com');
  assert.equal(i.walletConnect, true);
});

test('SafuCard SVG includes the verdict and the Kane disclaimer', () => {
  const v = evaluate(fixture('approval'), rules, allow);
  const svg = safuCard(v);
  assert.match(svg, /TRAP FLAGGED/);
  assert.match(svg, /powered by Kane CLI/);
  assert.match(svg, /not a guarantee of safety/i);
});

test('CLI accepts --help on subcommands', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [p('bin', 'safuclick.js'), 'check', '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--real-site/);
});

test('check --replay works when probe.json is missing (older gym runs)', async () => {
  const { check } = await import('../src/check.js');
  const { verdict } = await check(null, { replay: p('docs', 'runs', 'gym', '07-official-final'), quiet: true });
  assert.equal(verdict.verdict, 'NO KNOWN TRAPS FOUND');
});
