// 2025-26 trap families: Permit/Permit2 "sign to claim", fake revoke (setApprovalForAll),
// EIP-5792/7702 batches, increaseAllowance ice phishing, cloaking. Gym wallet logs, no Kane credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { evaluate } from '../src/verdict.js';
import { p, readJSON } from '../src/paths.js';

const rules = readJSON(process.env.SAFU_RULES || p('config', 'rules.json'));
const v2 = { ...readJSON(p('config', 'rules.json')) };
for (const k of ['signatures', 'nft', 'batch', 'cloak']) delete v2[k];
v2.approval = { ...v2.approval }; delete v2.approval.includeIncrease; v2.version = 2;
const allow = readJSON(p('config', 'allowlist.json'));
const fx = (name) => readJSON(path.join(p('test', 'fixtures', 'new-traps'), `${name}.json`));
const run = (name, r = rules, kane = { status: 'passed', steps: [] }) => { const f = fx(name); return evaluate({ url: f.url, walletLog: f.walletLog, probe: f.probe, kane, mode: 'gym' }, r, allow); };
const ids = (v) => v.reasons.map((r) => r.id);
const full = !!(rules.signatures && rules.nft && rules.batch && rules.cloak && rules.approval?.includeIncrease);

const expected = [
  ['claim', 'TRAP FLAGGED', ['permit_signature']],
  ['revoke', 'TRAP FLAGGED', ['nft_approval_for_all', 'fake_revoke']],
  ['batch', 'TRAP FLAGGED', ['hidden_batch', 'batch_hidden_approvals']],
  ['allowance', 'TRAP FLAGGED', ['increase_allowance', 'unlimited_approval']],
  ['cloak', 'TRAP FLAGGED', ['permit_signature', 'cloaking_suspected']],
  ['cloak-strict', 'INCONCLUSIVE', []],
  ['official', 'NO KNOWN TRAPS FOUND', []],
];
for (const [name, verdict, want] of expected) {
  test(`new trap fixture (full rules): ${name} → ${verdict}`, { skip: !full && 'needs full rules' }, () => {
    const v = run(name);
    assert.equal(v.verdict, verdict, JSON.stringify(v.reasons.map((r) => r.detail), null, 1));
    for (const id of want) assert.ok(ids(v).includes(id), `${name} should include ${id}: ${ids(v)}`);
    for (const r of v.reasons) assert.ok(!/\bsafe\b/i.test(r.detail.replace(/not .{0,20}safe/i, '')), 'never call anything safe');
  });
}

test('v2 rules (before this upgrade) are blind to batch, increaseAllowance and wallet-gated cloaking', () => {
  for (const name of ['batch', 'allowance', 'cloak']) assert.equal(run(name, v2).verdict, 'NO KNOWN TRAPS FOUND', name);
});

test('cloak-strict: placeholder-only view is inconclusive with a cloaking signal, never "no known traps"', { skip: !full && 'needs full rules' }, () => {
  const v = run('cloak-strict');
  assert.equal(v.verdict, 'INCONCLUSIVE');
  assert.ok(v.signals.some((s) => s.id === 'cloaking_suspected'));
});

test('batch via the known MetaMask delegator: still flagged, delegation is only a signal', { skip: !full && 'needs full rules' }, () => {
  const v = run('batch');
  assert.ok(!ids(v).includes('unknown_delegator'));
  assert.ok(v.signals.some((s) => s.id === 'eip7702_delegation'));
});

const sig = (decoded) => [{ type: 'sig_decoded', ts: '2026-11-16T00:00:00Z', decoded }];
const permit = (o) => ({ token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tokenSymbol: 'USDC', amountHuman: '5 USDC', amountRaw: '5000000', unlimited: false, expiry: Date.parse('2026-11-16T00:30:00Z') / 1000, expiryIso: '2026-11-16', ...o });

test('synthetic: EIP-2612 Permit to the official router, small amount, 30-minute deadline → not flagged', { skip: !full && 'needs full rules' }, () => {
  const walletLog = sig({ kind: 'typed', scheme: 'EIP-2612 Permit', primaryType: 'Permit', permits: [permit({ spender: '0x5afe5afe00000000000000000000000000c0ffee' })] });
  const v = evaluate({ url: 'http://safuswap.localhost:4100/', walletLog, kane: { status: 'passed', steps: [] } }, rules, allow);
  assert.equal(v.verdict, 'NO KNOWN TRAPS FOUND', JSON.stringify(v.reasons));
});

test('synthetic: Permit2 PermitBatch, 2 tokens to an unknown spender → one reason per token', { skip: !full && 'needs full rules' }, () => {
  const sp = '0x9999999999999999999999999999999999999999';
  const walletLog = sig({ kind: 'typed', scheme: 'Permit2 PermitBatch', primaryType: 'PermitBatch', permits: [permit({ spender: sp }), permit({ spender: sp, tokenSymbol: 'WETH', token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' })] });
  const v = evaluate({ url: 'http://safuswap.localhost:4100/', walletLog, kane: { status: 'passed', steps: [] } }, rules, allow);
  assert.equal(v.reasons.filter((r) => r.id === 'permit_signature').length, 2);
});

test('synthetic: eth_sign blind signature and 7702 authorization to an unknown delegator are flagged', { skip: !full && 'needs full rules' }, () => {
  const walletLog = [...sig({ kind: 'eth_sign', scheme: 'eth_sign', permits: [] }), { type: 'auth_decoded', decoded: { kind: 'eip7702_authorization', delegator: '0xdead00000000000000000000000000000000beef' } }];
  const v = evaluate({ url: 'http://safuswap.localhost:4100/', walletLog, kane: { status: 'passed', steps: [] } }, rules, allow);
  assert.ok(ids(v).includes('blind_signature'));
  assert.ok(ids(v).includes('unknown_delegator'));
});

test('synthetic: a real revoke (approved = false) is not flagged', { skip: !full && 'needs full rules' }, () => {
  const walletLog = [{ type: 'page_loaded', title: 'Approval Checker' }, { type: 'tx_decoded', decoded: { kind: 'setApprovalForAll', to: '0xc36442b4a4522e871399cd717abdd847ab11fe88', operator: '0x0be7a70b0be7a70b0be7a70b0be7a70b0be7a70b', spender: '0x0be7a70b0be7a70b0be7a70b0be7a70b0be7a70b', approved: false, collection: 'Uniswap V3 Positions NFT', amountHuman: 'none (revoke)' } }];
  const v = evaluate({ url: 'http://safuswap.localhost:4100/', walletLog, kane: { status: 'passed', steps: [] } }, rules, allow);
  assert.equal(v.verdict, 'NO KNOWN TRAPS FOUND', JSON.stringify(v.reasons));
});
