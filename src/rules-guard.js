// Guardrails for agent-written rule changes. The builder agent may only emit rules in the existing
// config/rules.json format (config/rules.schema.json). Every candidate goes through:
//   1. schema validation (known keys, types, regexes that compile and are not catch-alls),
//   2. a hardening-only check (no true flag switched off, no list entry deleted, thresholds only tighten),
//   3. --replay of every recorded Kane run (no verdict may change: no lost catches, no new false alarms),
//   4. the effectiveness check (the missed run must now be flagged by a deterministic rule),
//   5. the full unit test suite with SAFU_RULES pointing at the candidate.
// Any failure rejects the candidate; config/rules.json is never touched until all pass.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { p, readJSON, writeJSON, ROOT } from './paths.js';
import { evaluate } from './verdict.js';
import { loadKaneNdjson } from './kane.js';

export const SCHEMA = readJSON(p('config', 'rules.schema.json'));
const NEUTRAL = 'Swap 10 USDC for ETH on SafuSwap. Connect Wallet. Confirm. Swap complete. The popup showed Action Swap and Amount 10 USDC.';

function checkRegex(s, where, errors) {
  if (typeof s !== 'string' || !s.trim()) return errors.push(`${where}: must be a non-empty string`);
  if (s.length > 160) return errors.push(`${where}: pattern longer than 160 chars`);
  let r; try { r = new RegExp(s, 'i'); } catch (e) { return errors.push(`${where}: regex does not compile (${e.message})`); }
  if (r.test('')) errors.push(`${where}: pattern matches the empty string (catch-all)`);
  else if (r.test(NEUTRAL)) errors.push(`${where}: pattern matches a normal, clean swap description (would cause false alarms)`);
  if (/\([^)]*[+*]\)[+*{]/.test(s)) errors.push(`${where}: nested quantifier (ReDoS risk)`);
}

export function validateRules(rules, schema = SCHEMA) {
  const errors = [];
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return ['rules must be a JSON object'];
  if (!Number.isInteger(rules.version) || rules.version < 0) errors.push('version: must be a non-negative integer');
  for (const [sec, body] of Object.entries(rules)) {
    if (sec === 'version' || sec.startsWith('_')) { if (sec.startsWith('_') && typeof body !== 'string') errors.push(`${sec}: comments must be strings`); continue; }
    const spec = schema[sec];
    if (!spec || spec.type) { errors.push(`${sec}: unknown section (allowed: ${Object.keys(schema).filter((k) => !k.startsWith('_') && k !== 'version').join(', ')})`); continue; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) { errors.push(`${sec}: must be an object`); continue; }
    for (const [k, v] of Object.entries(body)) {
      const s = spec[k]; const at = `${sec}.${k}`;
      if (!s) { errors.push(`${at}: unknown key (allowed: ${Object.keys(spec).join(', ')})`); continue; }
      if (s.type === 'bool' && typeof v !== 'boolean') errors.push(`${at}: must be true/false`);
      if ((s.type === 'num' || s.type === 'num?') && !(typeof v === 'number' && Number.isFinite(v)) && !(s.type === 'num?' && v === null)) errors.push(`${at}: must be a number${s.type === 'num?' ? ' or null' : ''}`);
      if (typeof v === 'number' && s.min != null && v < s.min) errors.push(`${at}: must be >= ${s.min}`);
      if (typeof v === 'number' && s.max != null && v > s.max) errors.push(`${at}: must be <= ${s.max}`);
      if (s.type === 'str' && typeof v !== 'string') errors.push(`${at}: must be a string`);
      if (s.type === 'regex') checkRegex(v, at, errors);
      if (s.type === 'regex[]' || s.type === 'str[]') {
        if (!Array.isArray(v)) { errors.push(`${at}: must be an array of strings`); continue; }
        if (v.length > 80) errors.push(`${at}: too many entries`);
        v.forEach((x, i) => (s.type === 'regex[]' ? checkRegex(x, `${at}[${i}]`, errors) : (typeof x !== 'string' || !x.trim()) && errors.push(`${at}[${i}]: must be a non-empty string`)));
        if (new Set(v).size !== v.length) errors.push(`${at}: duplicate entries`);
      }
    }
  }
  return errors;
}

// Hardening only: compares candidate to the current rules.
export function hardeningErrors(before, after, schema = SCHEMA) {
  const errors = [];
  for (const [sec, spec] of Object.entries(schema)) {
    if (sec.startsWith('_') || spec.type) continue;
    for (const [k, s] of Object.entries(spec)) {
      const a = before[sec]?.[k]; const b = after[sec]?.[k]; const at = `${sec}.${k}`;
      if (a === undefined) continue;
      if (b === undefined) { errors.push(`${at}: removed`); continue; }
      if (s.frozen && JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${at}: frozen (only a human may change it)`);
      if (s.type === 'bool' && a === true && b === false) errors.push(`${at}: switched off (weakens the checker)`);
      if (Array.isArray(a) && Array.isArray(b)) for (const x of a) if (!b.includes(x)) errors.push(`${at}: removed entry ${JSON.stringify(x)}`);
      if (typeof a === 'number' && s.tighten === 'down' && (b === null || b > a)) errors.push(`${at}: loosened ${a} -> ${b} (may only go down)`);
      if (typeof a === 'number' && s.tighten === 'up' && b < a) errors.push(`${at}: loosened ${a} -> ${b} (may only go up)`);
    }
  }
  if (!(after.version > before.version)) errors.push(`version: must increase (was ${before.version})`);
  return errors;
}

// The builder's patch language: a short list of edits addressed by path, applied to a copy.
//   { "op": "set", "path": "approval.maxAllowanceRatio", "value": 5 }
//   { "op": "append", "path": "seed.patterns", "value": "backup words" }
export function applyOps(rules, ops = []) {
  const r = structuredClone(rules); const errors = []; const applied = [];
  if (!Array.isArray(ops) || !ops.length) return { rules: r, errors: ['no ops'], applied };
  if (ops.length > 8) errors.push('at most 8 ops per fix');
  for (const [i, o] of ops.slice(0, 8).entries()) {
    const parts = String(o?.path || '').split('.');
    if (parts.length !== 2) { errors.push(`ops[${i}]: path must be "section.key"`); continue; }
    const [sec, key] = parts; const s = SCHEMA[sec]?.[key];
    if (!s || SCHEMA[sec].type) { errors.push(`ops[${i}]: ${o.path} is not in config/rules.schema.json`); continue; }
    r[sec] = r[sec] || {};
    if (o.op === 'set') { r[sec][key] = o.value; applied.push(`set ${o.path} = ${JSON.stringify(o.value)}`); }
    else if (o.op === 'append') {
      if (!/\[\]$/.test(s.type)) { errors.push(`ops[${i}]: ${o.path} is not a list`); continue; }
      const cur = Array.isArray(r[sec][key]) ? r[sec][key] : [];
      for (const v of [].concat(o.value)) if (!cur.includes(v)) cur.push(v);
      r[sec][key] = cur; applied.push(`append ${o.path} += ${JSON.stringify(o.value)}`);
    } else errors.push(`ops[${i}]: op must be "set" or "append"`);
  }
  r.version = (rules.version || 0) + 1;
  return { rules: r, errors, applied };
}

// Every recorded Kane run in docs/runs (gym, loops, real sites, agent loop).
export function recordedRuns(root = p('docs', 'runs')) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(d, e.name);
      if (fs.existsSync(path.join(dir, 'verdict.json')) && fs.existsSync(path.join(dir, 'kane.ndjson'))) out.push(dir);
      else walk(dir);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

export function replayRun(dir, rules, allowlist = readJSON(p('config', 'allowlist.json'))) {
  const saved = readJSON(path.join(dir, 'verdict.json'));
  const probe = readJSON(path.join(dir, 'probe.json'), null);
  const kane = loadKaneNdjson(path.join(dir, 'kane.ndjson'));
  const walletLog = readJSON(path.join(dir, 'wallet-log.json'), []);
  return evaluate({ url: saved.url, intendedAmount: 10, kane, walletLog, probe, mode: saved.mode || (probe ? 'real-site' : 'gym') }, rules, allowlist);
}

// No verdict on any recorded run may change between the current and the candidate rules.
export function replayGate(before, after, dirs = recordedRuns()) {
  const regressions = []; let checked = 0;
  for (const dir of dirs) {
    let a, b;
    try { a = replayRun(dir, before); b = replayRun(dir, after); } catch (e) { regressions.push({ run: path.relative(ROOT, dir), error: e.message }); continue; }
    checked++;
    if (a.verdict !== b.verdict) regressions.push({ run: path.relative(ROOT, dir), before: a.verdict, after: b.verdict, newReasons: b.reasons.filter((r) => !a.reasons.some((x) => x.id === r.id)).map((r) => r.id) });
  }
  return { checked, regressions };
}

export function runUnitTests(rulesFile) {
  try {
    const out = execFileSync(process.execPath, ['--test', ...fs.readdirSync(p('test')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('test', f))],
      { cwd: ROOT, stdio: 'pipe', env: { ...process.env, SAFU_RULES: rulesFile, SAFU_SKIP_HARNESS_SELFTEST: '1' }, timeout: 120000 }).toString();
    const n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1] || 0);
    return { ok: true, pass: n('pass'), fail: n('fail'), tests: n('tests') };
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1] || 0);
    return { ok: false, pass: n('pass'), fail: n('fail'), tests: n('tests'), tail: out.slice(-1200) };
  }
}

// Full gate. `missed` = { dir } of the run that slipped through: it must now be flagged by a rule.
export function gateCandidate({ before, ops, missedDir, dirs, runTests = runUnitTests }) {
  const { rules: cand, errors: opErrors, applied } = applyOps(before, ops);
  const report = { applied, candidateVersion: cand.version, steps: [] };
  const fail = (step, errors) => { report.steps.push({ step, ok: false, errors }); report.ok = false; report.rejectedAt = step; return { ...report, rules: cand }; };
  if (opErrors.length) return fail('ops', opErrors);
  report.steps.push({ step: 'ops', ok: true });
  const schemaErr = validateRules(cand);
  if (schemaErr.length) return fail('schema', schemaErr);
  report.steps.push({ step: 'schema', ok: true });
  const hard = hardeningErrors(before, cand);
  if (hard.length) return fail('hardening-only', hard);
  report.steps.push({ step: 'hardening-only', ok: true });
  if (missedDir) {
    const v = replayRun(missedDir, cand);
    const hit = v.reasons.filter((r) => r.source.startsWith('rule:'));
    if (!hit.length) return fail('fix-effective', [`replaying the missed Kane run with the candidate rules still gives ${v.verdict} with no deterministic rule (reasons: ${v.reasons.map((r) => r.id).join(', ') || 'none'})`]);
    report.steps.push({ step: 'fix-effective', ok: true, detail: `missed run now ${v.verdict} via ${hit.map((r) => r.id).join(', ')}` });
  }
  const rg = replayGate(before, cand, (dirs || recordedRuns()).filter((d) => !missedDir || path.resolve(d) !== path.resolve(missedDir)));
  if (rg.regressions.length) return fail('replay-recorded-runs', rg.regressions.map((r) => r.error ? `${r.run}: ${r.error}` : `${r.run}: ${r.before} -> ${r.after}${r.newReasons.length ? ' (new: ' + r.newReasons.join(', ') + ')' : ''}`));
  report.steps.push({ step: 'replay-recorded-runs', ok: true, detail: `${rg.checked} recorded Kane runs re-judged, 0 verdict changes` });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'safu-rules-')), 'rules.json');
  writeJSON(tmp, cand);
  const t = runTests(tmp);
  if (!t.ok) return fail('unit-tests', [`${t.fail} of ${t.tests} tests failed`, t.tail || '']);
  report.steps.push({ step: 'unit-tests', ok: true, detail: `${t.pass}/${t.tests} tests pass with the candidate rules` });
  report.ok = true;
  return { ...report, rules: cand };
}
