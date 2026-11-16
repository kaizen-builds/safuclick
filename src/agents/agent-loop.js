// Agent <-> Kane loop with REAL LLM agents.
//   scammer agent (LLM) --writes a gym variant--> guard --plants it on the loop slot-->
//   kane-cli run (NDJSON + mock-wallet log) --> verdict -->
//   builder agent (LLM) reads Kane's NDJSON + wallet evidence + verdict, decides MISSED or not, writes
//   rules.json ops --> gate (schema, hardening-only, --replay of every recorded run, fix-effective, unit tests)
//   --> builder calls Kane again (kane_recheck) --> builder reacts to Kane's result.
// Every hop is written to a transcript (docs/runs/agent-loop/round-N/transcript.{json,md}).
// --agent replay (or SAFU_AGENT=replay) answers from a recorded run's LLM calls; --kane replay re-judges the
// recorded Kane runs instead of calling Kane (0 credits). In llm mode a provider error falls back to the
// recorded answer for that turn when a recording exists.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { p, readJSON, writeJSON, ROOT } from '../paths.js';
import { SCENARIOS, kaneCommandLine } from '../kane.js';
import { validateVariant } from './variant-guard.js';
import { scammerMessages, builderMessages, reactionMessages, kaneDigest } from './prompts.js';
import { gateCandidate, runUnitTests, recordedRuns } from '../rules-guard.js';
import { createBrain, providerFromEnv } from './llm.js';

export const OUT = p('docs', 'runs', 'agent-loop');
const ruleCaught = (v) => (v?.reasons || []).some((r) => String(r.source).startsWith('rule:'));
const rel = (f) => path.relative(ROOT, f);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(n)) ? Number(n) : hi));

export function kaneBalance() {
  try { const out = execFileSync(process.env.KANE_BIN || 'kane-cli', ['balance'], { stdio: 'pipe', timeout: 60000 }).toString(); const m = out.match(/Available credits:\s*([\d.]+)/); return m ? Number(m[1]) : null; } catch { return null; }
}

export function loadRecorded(dir) {
  const calls = [];
  if (!dir || !fs.existsSync(dir)) return calls;
  for (const d of fs.readdirSync(dir).filter((x) => /^round-\d+$/.test(x)).sort()) calls.push(...readJSON(path.join(dir, d, 'llm-calls.json'), []));
  return calls;
}

function kaneSummary(res, dir) {
  const v = res.verdict; const k = res.kane || {};
  return { status: k.status, one_liner: k.one_liner, summary: k.summary, reason_code: k.reason_code, credits: k.credits_consumed ?? v.kane?.credits ?? null, steps: (k.steps || []).map((s) => ({ step: s.step, remark: s.remark })), test_url: k.test_url || null,
    ndjson: rel(path.join(dir, 'kane.ndjson')), walletEvents: (res.walletLog || []).length, walletRequests: v.walletSummary?.requests || [],
    verdict: v.verdict, rulesVersion: v.rulesVersion, reasons: v.reasons.map((r) => ({ id: r.id, source: r.source, detail: r.detail })), caughtByRule: ruleCaught(v) };
}

function promptGist(messages) {
  const u = messages.find((m) => m.role === 'user')?.content || '';
  const heads = [...u.matchAll(/^## (.+)$/gm)].map((m) => m[1].split('\n')[0]).filter((h) => !/^Answer/.test(h));
  return { system: messages.find((m) => m.role === 'system')?.content || '', includes: heads, chars: messages.reduce((a, m) => a + m.content.length, 0) };
}

export async function runAgentLoop(o = {}) {
  const rounds = Number(o.rounds || 3);
  let agentMode = o.agent || process.env.SAFU_AGENT || 'llm';
  if (agentMode === 'llm' && !o.brain && !providerFromEnv()) { (o.log || console.log)('no LLM provider configured (NEARAI_API_KEY / AI_GATEWAY_API_KEY / OPENAI_API_KEY): using the recorded agent answers (--agent replay)'); agentMode = 'replay'; }
  const kaneMode = o.kane || (agentMode === 'replay' ? 'replay' : 'live');
  const outDir = o.outDir || (agentMode === 'replay' || kaneMode === 'replay' ? p('.safuclick', 'agent-loop-replay') : OUT);
  const from = o.from || OUT; // recorded run used for replay / fallback
  const maxSteps = clamp(o.maxSteps || 14, 6, 16);
  const budget = Number(o.budget || 250);
  const log = o.log || ((s) => console.log(s));
  const recorded = o.recorded || loadRecorded(from); // read before this run overwrites anything
  const brain = o.brain || createBrain({ mode: agentMode, recorded, log });
  const runTests = o.runTests || runUnitTests;
  const balance = o.balance || (kaneMode === 'live' ? kaneBalance : () => null);
  const examples = readJSON(p('gym', 'variants.json')).variants.slice(1, 6).map(({ port, _truth, ...s }) => s);
  let runCheck = o.runCheck;
  let gym = null;
  if (!runCheck) {
    const { check } = await import('../check.js');
    if (kaneMode === 'replay') runCheck = (url, opts) => check(url, { replay: path.join(from, `round-${opts.round}`, opts.phase), rules: opts.rules, quiet: true });
    else {
      const { startGym, LOOP_VARIANT_FILE } = await import('../gym/server.js');
      gym = await startGym({ quiet: true });
      runCheck = (url, opts) => { writeJSON(LOOP_VARIANT_FILE, opts.site); return check(url, { rules: opts.rules, scenario: opts.scenario, maxSteps: opts.maxSteps, outDir: opts.outDir, quiet: !!o.quiet }); };
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const workRules = path.join(outDir, 'rules.working.json');
  // A replay starts from the rules the recorded run started from, so every turn lines up.
  const recordedStart = path.join(from, 'rules.start.json');
  const startRules = readJSON(o.rulesFrom || ((agentMode === 'replay' || kaneMode === 'replay') && fs.existsSync(recordedStart) ? recordedStart : p('config', 'rules.json')));
  writeJSON(workRules, startRules);
  writeJSON(path.join(outDir, 'rules.start.json'), startRules);
  const meta = { startedAt: new Date().toISOString(), agentMode, kaneMode, provider: brain.provider, maxSteps, budget, rulesStart: startRules.version, balanceBefore: balance() };
  const history = [];
  // Replay gate covers every recorded Kane run except this experiment's own (they are the traps under test;
  // confirmed catches are locked in as regression fixtures instead).
  const own = [outDir, from].map((d) => path.resolve(d) + path.sep);
  const gateDirs = () => recordedRuns().filter((d) => !own.some((x) => (path.resolve(d) + path.sep).startsWith(x)));
  log(`agent loop: ${rounds} round(s), agents=${agentMode}${brain.provider ? ` (${brain.provider.name} ${brain.provider.model})` : ''}, kane=${kaneMode}, rules v${startRules.version}, Kane budget ${budget} credits`);

  for (let round = 1; round <= rounds; round++) {
    const rdir = path.join(outDir, `round-${round}`);
    fs.rmSync(rdir, { recursive: true, force: true }); fs.mkdirSync(rdir, { recursive: true });
    const T = []; const callsBefore = brain.calls.length;
    const say = (from, to, kind, data) => { T.push({ i: T.length + 1, at: new Date().toISOString(), from, to, kind, ...data }); };
    const rules = readJSON(workRules);
    const entry = { round, rulesBefore: rules.version };
    const spent = () => (meta.balanceBefore != null ? meta.balanceBefore - (balance() ?? meta.balanceBefore) : history.reduce((a, h) => a + (h.kaneCredits || 0), 0));
    const budgetOk = () => kaneMode !== 'live' || spent() + 45 <= budget;

    // 1. Scammer agent invents a variant.
    let out = null, vg = null, lastErrors = null;
    for (let attempt = 1; attempt <= 3 && !vg; attempt++) {
      const msgs = scammerMessages({ rules, history: history.map((h) => ({ round: h.round, name: h.name, family: h.family, gap: h.gap, outcome: h.outcome, builderFix: h.fix || null })), examples, lastErrors });
      say('harness', 'scammer', 'prompt', { attempt, ...promptGist(msgs) });
      const res = await brain.ask(`r${round}:scammer:${attempt}`, msgs, { maxTokens: 12000, temperature: 0.9 });
      try { out = res.json(); } catch (e) { say('harness', 'scammer', 'guard', { ok: false, errors: [`unparseable reply: ${e.message}`] }); lastErrors = [`reply was not one JSON object (${e.message})`]; continue; }
      say('scammer', 'harness', 'decision', { source: res.call.source, model: res.call.model, name: out.name, family: out.family, gap: out.gap, pitch: out.pitch, taunt: out.taunt, site: out.site });
      const g = validateVariant(out.site);
      if (g.errors.length) { say('harness', 'scammer', 'guard', { ok: false, errors: g.errors }); lastErrors = g.errors; continue; }
      vg = g; say('harness', null, 'guard', { ok: true, detail: `variant within gym bounds; planted on ${g.url} (mock wallet, no real funds)` });
    }
    Object.assign(entry, { name: out?.name || null, family: out?.family || null, gap: out?.gap || null, pitch: out?.pitch || null, taunt: out?.taunt || null, url: vg?.url || null });
    if (!vg) { entry.outcome = 'SCAMMER-REJECTED'; finishRound(); continue; }
    writeJSON(path.join(rdir, 'variant.json'), { ...vg.site, _truth: out.pitch, _gap: out.gap });

    if (!budgetOk()) { say('harness', null, 'budget', { detail: `stopping: Kane budget ${budget} credits would be exceeded (spent ${spent().toFixed(1)})` }); entry.outcome = 'BUDGET'; finishRound(); break; }

    // 2. Kane CLI referees the trap.
    const scenario = vg.site.scenario;
    const firstDir = path.join(rdir, 'kane-1-first');
    say('harness', 'kane', 'command', { command: kaneCommandLine({ url: vg.url + '?safu_run=<id>', objective: SCENARIOS[scenario](10), maxSteps }), scenario, maxSteps });
    log(`round ${round}: scammer planted "${out.name}" (${out.family}) at ${vg.url}; kane-cli run (scenario ${scenario})`);
    const first = await runCheck(vg.url, { round, phase: 'kane-1-first', site: { ...vg.site, _truth: out.pitch }, rules: workRules, scenario, maxSteps, outDir: firstDir });
    const firstDirReal = first.runDir || firstDir;
    say('kane', 'harness', 'result', kaneSummary(first, firstDirReal));
    entry.first = kaneSummary(first, firstDirReal);
    entry.kaneCredits = Number(first.kane?.credits_consumed || 0);
    const truthMissed = !ruleCaught(first.verdict);

    // 3. Builder agent reads Kane's output and decides; its fix is gated before it is applied.
    let dec = null, gate = null, lastGate = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const digest = kaneDigest(firstDirReal, first.kane, first.walletLog || []);
      const msgs = builderMessages({ round, variantUrl: vg.url, scenario, digest, verdict: first.verdict, rules, lastGate, attempt });
      say('harness', 'builder', 'prompt', { attempt, ...promptGist(msgs) });
      const res = await brain.ask(`r${round}:builder:${attempt}`, msgs, { maxTokens: 12000, temperature: 0.2 });
      try { dec = res.json(); } catch (e) { say('harness', 'builder', 'gate', { ok: false, rejectedAt: 'parse', steps: [{ step: 'parse', ok: false, errors: [e.message] }] }); lastGate = { rejectedAt: 'parse', steps: [{ step: 'parse', ok: false, errors: ['reply was not one JSON object'] }] }; continue; }
      say('builder', 'harness', 'decision', { source: res.call.source, model: res.call.model, missed: dec.missed, diagnosis: dec.diagnosis, fixable: dec.fixable, ops: dec.ops || [], expected_rule_ids: dec.expected_rule_ids || [], kane_recheck: dec.kane_recheck || null, message: dec.message_to_kane_log || null });
      if (!dec.missed || dec.fixable === false || !(dec.ops || []).length) break;
      gate = gateCandidate({ before: rules, ops: dec.ops, missedDir: truthMissed ? firstDirReal : null, runTests, dirs: gateDirs() });
      say('harness', 'builder', 'gate', { ok: gate.ok, rejectedAt: gate.rejectedAt || null, applied: gate.applied, candidateVersion: gate.candidateVersion, steps: gate.steps });
      if (gate.ok) break;
      log(`round ${round}: builder fix rejected at ${gate.rejectedAt}; rolled back, asking the builder again`);
      lastGate = gate; gate = null;
    }
    entry.builder = dec ? { missed: !!dec.missed, diagnosis: dec.diagnosis, fixable: dec.fixable !== false, ops: dec.ops || [] } : null;
    entry.agreesWithRules = dec ? !!dec.missed === truthMissed : null;

    if (!truthMissed) {
      entry.outcome = 'CAUGHT';
      if (dec?.missed && gate?.ok) {
        entry.proposedHardening = gate.applied;
        say('harness', 'builder', 'note', { detail: `A deterministic rule already flagged this trap (${entry.first.reasons.filter((r) => r.source.startsWith('rule:')).map((r) => r.id).join(', ')}), so the loop does not apply fixes here. The builder's defense-in-depth proposal passed the gate and is kept for review in round-${round}/rules-proposal.json: ${gate.applied.join('; ')}` });
        writeJSON(path.join(rdir, 'rules-proposal.json'), { from: rules.version, ops: dec.ops, applied: gate.applied, gate: gate.steps, diagnosis: dec.diagnosis });
      }
    }
    else if (!gate?.ok) entry.outcome = dec?.missed === false ? 'MISSED (builder said caught)' : dec?.fixable === false ? 'MISSED (builder: not fixable in rules format)' : 'MISSED (no accepted fix)';
    else {
      // 4. Builder calls Kane again to confirm.
      const cand = { ...gate.rules, _comment: `${rules._comment || ''} v${gate.rules.version}: agent-loop round ${round}, LLM builder (${gate.applied.join('; ')}).`.trim() };
      const candFile = path.join(rdir, 'rules.candidate.json'); writeJSON(candFile, cand);
      writeJSON(path.join(rdir, 'rules-diff.json'), { from: rules.version, to: cand.version, ops: dec.ops, applied: gate.applied, gate: gate.steps });
      entry.fix = gate.applied;
      const want = dec.kane_recheck?.run !== false;
      if (!want) { entry.outcome = 'MISSED, fix gated (builder skipped Kane re-check, not applied)'; say('harness', null, 'rollback', { detail: 'builder did not ask Kane to confirm; fix not applied' }); }
      else if (!budgetOk()) { entry.outcome = 'MISSED, fix gated (no budget for Kane re-check, not applied)'; say('harness', null, 'budget', { detail: 'no Kane budget left to confirm the fix; not applied' }); }
      else {
        const steps2 = clamp(dec.kane_recheck.max_steps, 8, 16);
        const recheckDir = path.join(rdir, 'kane-2-recheck');
        say('builder', 'kane', 'command', { why: dec.kane_recheck.why || null, command: kaneCommandLine({ url: vg.url + '?safu_run=<id>', objective: SCENARIOS[scenario](10), maxSteps: steps2 }), scenario, maxSteps: steps2, rulesVersion: cand.version });
        log(`round ${round}: builder fix passed the gate (v${rules.version} -> v${cand.version}); builder calls Kane to re-check`);
        const second = await runCheck(vg.url, { round, phase: 'kane-2-recheck', site: { ...vg.site, _truth: out.pitch }, rules: candFile, scenario, maxSteps: steps2, outDir: recheckDir });
        const recheckDirReal = second.runDir || recheckDir;
        const sum = kaneSummary(second, recheckDirReal);
        say('kane', 'builder', 'result', sum);
        entry.recheck = sum; entry.kaneCredits += Number(second.kane?.credits_consumed || 0);
        const res = await brain.ask(`r${round}:builder:reaction`, reactionMessages({ round, decision: dec, gate, recheck: sum }), { maxTokens: 4000, temperature: 0.2 });
        let react = null; try { react = res.json(); } catch { react = { comment: res.text.slice(0, 400) }; }
        say('builder', 'harness', 'reaction', { source: res.call.source, model: res.call.model, ...react });
        entry.reaction = react;
        if (ruleCaught(second.verdict)) {
          entry.outcome = 'MISSED -> FIXED'; writeJSON(workRules, cand);
          say('harness', null, 'apply', { detail: `Kane confirmed: rules v${cand.version} flag the trap (${sum.reasons.filter((r) => r.source.startsWith('rule:')).map((r) => r.id).join(', ')}). Fix kept.` });
          writeJSON(path.join(rdir, 'regression-fixture.json'), { name: `agent-${out.name}`, url: vg.url, intendedAmount: 10, kane: first.kane, walletLog: first.walletLog || [], expect: 'TRAP FLAGGED', expectRuleSource: true, minRulesVersion: cand.version });
        } else {
          entry.outcome = 'MISSED -> STILL OPEN';
          say('harness', null, 'rollback', { detail: `Kane re-check was not flagged by a rule (${sum.verdict}); fix rolled back` });
        }
      }
    }
    log(`round ${round}: ${entry.outcome}`);
    finishRound();

    function finishRound() {
      entry.transcript = rel(path.join(rdir, 'transcript.json'));
      writeJSON(path.join(rdir, 'transcript.json'), { round, outcome: entry.outcome, entries: T });
      writeJSON(path.join(rdir, 'llm-calls.json'), brain.calls.slice(callsBefore));
      fs.writeFileSync(path.join(rdir, 'transcript.md'), transcriptMarkdown(entry, T));
      history.push(entry);
      writeJSON(path.join(outDir, 'history.json'), { ...meta, history });
    }
  }

  meta.finishedAt = new Date().toISOString();
  meta.balanceAfter = balance();
  meta.creditsBilled = meta.balanceBefore != null && meta.balanceAfter != null ? +(meta.balanceBefore - meta.balanceAfter).toFixed(4) : null;
  meta.creditsKaneReported = +history.reduce((a, h) => a + (h.kaneCredits || 0), 0).toFixed(4);
  meta.rulesEnd = readJSON(workRules).version;
  meta.llmCalls = brain.calls.length;
  meta.llmUsage = brain.calls.reduce((a, c) => ({ prompt: a.prompt + (c.usage?.prompt_tokens || 0), completion: a.completion + (c.usage?.completion_tokens || 0) }), { prompt: 0, completion: 0 });
  meta.llmSources = [...new Set(brain.calls.map((c) => c.source))];
  writeJSON(path.join(outDir, 'history.json'), { ...meta, history });
  if (o.promote && meta.rulesEnd > startRules.version) promote(outDir, history, log);
  if (gym) gym.close();
  return { ...meta, history };
}

// Copy Kane-confirmed rules to config/rules.json and lock each catch in as a regression fixture.
// Full test suite must pass afterwards, otherwise everything is rolled back.
export function promote(outDir, history, log = console.log) {
  const cfg = p('config', 'rules.json'); const backup = fs.readFileSync(cfg, 'utf8');
  const fixtures = [];
  fs.copyFileSync(path.join(outDir, 'rules.working.json'), cfg);
  for (const h of history.filter((x) => x.outcome === 'MISSED -> FIXED')) {
    const src = path.join(outDir, `round-${h.round}`, 'regression-fixture.json');
    if (!fs.existsSync(src)) continue;
    const fx = readJSON(src); const dst = p('test', 'fixtures', 'regressions', `${fx.name}.json`);
    writeJSON(dst, fx); fixtures.push(dst);
  }
  const t = runUnitTests(cfg);
  if (!t.ok) { fs.writeFileSync(cfg, backup); fixtures.forEach((f) => fs.rmSync(f, { force: true })); log(`promote rolled back: ${t.fail} test(s) failed`); return false; }
  log(`promoted rules v${readJSON(cfg).version} to config/rules.json; ${fixtures.length} regression fixture(s); ${t.pass}/${t.tests} tests pass`);
  return true;
}

export function transcriptMarkdown(entry, T) {
  const L = [`# Agent <-> Kane transcript, round ${entry.round}`, '', `Outcome: **${entry.outcome}**  `, `Trap: ${entry.name || '?'} (${entry.family || '?'}) at ${entry.url || '?'}`, ''];
  for (const e of T) {
    const who = `**${e.from}${e.to ? ' -> ' + e.to : ''}** · ${e.kind}`;
    if (e.kind === 'prompt') L.push(`${e.i}. ${who} (attempt ${e.attempt}, ${e.chars} chars): includes ${e.includes.join('; ')}`);
    else if (e.kind === 'decision' && e.from === 'scammer') L.push(`${e.i}. ${who} [${e.source}, ${e.model}]: **${e.name}** (${e.family}). Gap: ${e.gap}. Pitch: ${e.pitch}. Taunt: "${e.taunt}"`, '```json', JSON.stringify(e.site, null, 2), '```');
    else if (e.kind === 'decision') L.push(`${e.i}. ${who} [${e.source}, ${e.model}]: missed=${e.missed}, fixable=${e.fixable}. ${e.diagnosis}`, ...(e.ops.length ? ['```json', JSON.stringify(e.ops, null, 2), '```'] : []), ...(e.kane_recheck ? [`   kane_recheck: ${JSON.stringify(e.kane_recheck)}`] : []));
    else if (e.kind === 'command') L.push(`${e.i}. ${who}${e.why ? ` (${e.why})` : ''}:`, '```sh', e.command, '```');
    else if (e.kind === 'result') L.push(`${e.i}. ${who}: Kane ${e.status} in ${e.steps.length} steps (${e.credits ?? '?'} credits, ${e.ndjson}). "${e.one_liner || ''}" -> SafuClick ${e.verdict} with rules v${e.rulesVersion}; rule catch: ${e.caughtByRule ? 'yes' : 'NO'}; reasons: ${e.reasons.map((r) => `${r.id} [${r.source}]`).join(', ') || 'none'}`);
    else if (e.kind === 'gate') L.push(`${e.i}. ${who}: ${e.ok ? 'ACCEPTED' : 'REJECTED at ' + e.rejectedAt}`, ...(e.steps || []).map((s) => `   - ${s.step}: ${s.ok ? 'ok' : 'FAIL'}${s.detail ? ' (' + s.detail + ')' : ''}${s.errors ? ': ' + s.errors.map((x) => String(x).slice(0, 200)).join(' | ') : ''}`));
    else if (e.kind === 'reaction') L.push(`${e.i}. ${who} [${e.source}]: confirmed_fixed=${e.confirmed_fixed}. ${e.comment || ''}${e.next ? ' Next: ' + e.next : ''}`);
    else L.push(`${e.i}. ${who}: ${e.detail || (e.errors || []).join(' | ')}`);
  }
  return L.join('\n') + '\n';
}
