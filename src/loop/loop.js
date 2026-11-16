// Closed loop: scammer plants a trap → Kane referees → report becomes a fix prompt →
// builder hardens the checker → Kane re-verifies. Repeat; scammer evolves when caught.
import fs from 'node:fs';
import path from 'node:path';
import { p, readJSON, writeJSON, STATE } from '../paths.js';
import { startGym } from '../gym/server.js';
import { check } from '../check.js';
import { plant } from './scammer.js';
import { writeFixPrompt, build } from './builder.js';
import { red, green, yellow, bold, dim, cyan } from '../report.js';
import { writeLive } from '../live.js';

const LOOP = path.join(STATE, 'loop');
const banner = (s) => console.log('\n' + bold('╔' + '═'.repeat(70) + '╗\n║ ' + s.padEnd(69) + '║\n╚' + '═'.repeat(70) + '╝'));
const ruleCaught = (v) => v.reasons.some((r) => r.source.startsWith('rule:'));
const kaneCaught = (v) => v.reasons.some((r) => r.source === 'kane');

async function referee(move, rulesFile, opts, label) {
  console.log(`\n  Kane: ${bold('Kane referee')} ${label} → ${cyan(move.url)}`);
  const res = await check(move.url, { rules: rulesFile, maxSteps: opts.maxSteps || 16, quiet: false, scenario: move.scenario });
  return res;
}

export async function runLoop({ rounds = 2, promote = false, fresh = false, maxSteps, from, only } = {}) {
  fs.mkdirSync(LOOP, { recursive: true });
  const rulesFile = path.join(LOOP, 'rules.json');
  if (from) writeJSON(rulesFile, readJSON(from));
  else if (fresh || !fs.existsSync(rulesFile)) writeJSON(rulesFile, readJSON(p('config', 'rules.baseline.json')));
  const allowlist = readJSON(p('config', 'allowlist.json'));
  const gym = await startGym({ quiet: true });
  const history = []; let move = 0; let credits = 0;

  writeLive({ phase: 'loop-start', mode: 'loop', rounds, steps: [], history });
  banner(`SafuClick closed loop · ${rounds} round(s) · rules v${readJSON(rulesFile).version} · powered by Kane CLI`);
  console.log(dim('  scammer plants traps · Kane CLI drives the page + mock wallet · builder hardens the checker'));

  for (let round = 1; round <= rounds; round++) {
    const rules = readJSON(rulesFile);
    const m = plant(move, { rules, history, only });
    banner(`ROUND ${round} · scammer plays "${m.name}"`);
    console.log(`  ${m.pitch}`);
    if (m.taunt) console.log(`  scammer: ${yellow(m.taunt)}`);
    console.log(dim(`  planted on ${m.url} (hot-reloaded, no restart)`));
    writeLive({ phase: 'planted', mode: 'loop', round, move: m.name, pitch: m.pitch, taunt: m.taunt, url: m.url, steps: [], history });

    writeLive({ phase: 'kane', mode: 'loop', round, move: m.name, pitch: m.pitch, taunt: m.taunt, url: m.url, steps: [], history });
    const first = await referee(m, rulesFile, { maxSteps }, `(rules v${rules.version})`);
    credits += Number(first.kane.credits_consumed || 0);
    const entry = { round, move: m.name, pitch: m.pitch, taunt: m.taunt, url: m.url, rulesBefore: rules.version, first: summarize(first.verdict) };

    if (ruleCaught(first.verdict)) {
      entry.outcome = 'CAUGHT';
      console.log(`  ${green('ok CAUGHT')} by deterministic rules${kaneCaught(first.verdict) ? ' and by Kane' : ''}. Scammer must evolve.`);
      history.push(entry); writeJSON(path.join(LOOP, 'history.json'), { finishedAt: null, credits, history }); writeLive({ phase: 'round-done', round, move: m.name, outcome: entry.outcome, history }); move++; continue;
    }

    entry.outcome = kaneCaught(first.verdict) ? 'KANE-ONLY' : 'MISSED';
    console.log(entry.outcome === 'KANE-ONLY'
      ? `  ${yellow('KANE-ONLY')}: Kane's own check flagged it, but no deterministic rule did. Handing Kane's report to the builder.`
      : `  ${red('x MISSED')}: the trap slipped past. Scammer's disclosure + Kane's report go to the builder.`);

    const fixPrompt = writeFixPrompt({ round, move: m, verdict: first.verdict, kane: first.kane, walletLog: first.walletLog, rulesFile, promptDir: path.join(LOOP, 'prompts') });
    console.log(`  fix prompt → ${dim(path.relative(process.cwd(), fixPrompt))}`);
    console.log(`  ${bold('builder')} ${process.env.SAFU_BUILDER_CMD ? '(external agent: ' + process.env.SAFU_BUILDER_CMD.split(' ')[0] + ')' : '(scripted, LLM-free)'} is patching…`);
    const b = build({ round, move: m, fixPrompt, rulesFile, evidence: { url: m.url, intendedAmount: 10, kane: first.kane, walletLog: first.walletLog, allowlist } });
    for (const c of b.changes) console.log(`     + ${c}`);
    console.log(`     ${b.testsOk ? green('ok unit + regression tests pass') : red('x tests failing')} · rules v${rules.version} → v${b.rules.version}`);
    entry.builder = { changes: b.changes, testsOk: b.testsOk, rulesAfter: b.rules.version, fixPrompt: path.relative(p(), fixPrompt) };

    const second = await referee(m, rulesFile, { maxSteps }, `re-check (rules v${b.rules.version})`);
    credits += Number(second.kane.credits_consumed || 0);
    entry.recheck = summarize(second.verdict);
    entry.outcome += ruleCaught(second.verdict) ? ' → FIXED' : ' → STILL OPEN';
    console.log(ruleCaught(second.verdict) ? `  ${green('ok FIXED')}: Kane re-ran the trap and the hardened rules flag it.` : `  ${red('x still open')}: next round the builder tries again.`);
    history.push(entry);
    writeJSON(path.join(LOOP, 'history.json'), { finishedAt: null, credits, history });
    writeLive({ phase: 'round-done', round, move: m.name, outcome: entry.outcome, history });
    if (ruleCaught(second.verdict)) move++; else round--; // retry same move if not fixed
    if (history.length > rounds * 2) break;
  }

  writeLive({ phase: 'scoreboard', mode: 'loop', credits, history });
  banner('SCOREBOARD');
  for (const h of history) console.log(`  R${h.round}  ${h.move.padEnd(20)} ${h.outcome.includes('FIXED') || h.outcome === 'CAUGHT' ? green(h.outcome) : red(h.outcome)}  ${dim('rules v' + h.rulesBefore + (h.builder ? ' → v' + h.builder.rulesAfter : ''))}`);
  console.log(`  Kane credits used this loop: ${credits.toFixed(1)}`);
  writeJSON(path.join(LOOP, 'history.json'), { finishedAt: new Date().toISOString(), credits, history });
  if (promote) { fs.copyFileSync(rulesFile, p('config', 'rules.json')); console.log(green(`  promoted hardened rules → config/rules.json`)); }
  gym.close();
  return history;
}

function summarize(v) {
  return { verdict: v.verdict, reasons: v.reasons.map((r) => ({ id: r.id, source: r.source, detail: r.detail })), kane: v.kane, runDir: v.runDir, rulesVersion: v.rulesVersion };
}

// Real-world round: a link that slipped past SafuClick in the wild. First verdict = replay of the
// original Kane run under the current rules (0 credits), the builder hardens the rules from that
// evidence, then Kane re-checks the LIVE site (observe only, never logs in).
export async function runRealRound({ url, first: firstDir, from, promote = false, maxSteps, name = 'real-world miss', pitch = '', taunt = '' }) {
  const dir = path.join(STATE, 'loop-real');
  fs.mkdirSync(dir, { recursive: true });
  const rulesFile = path.join(dir, 'rules.json');
  writeJSON(rulesFile, readJSON(from || p('config', 'rules.json')));
  const allowlist = readJSON(p('config', 'allowlist.json'));
  const rules = readJSON(rulesFile);
  banner(`REAL-WORLD ROUND · ${url} · rules v${rules.version}`);
  if (pitch) console.log('  ' + pitch);
  const first = await check(url, { replay: firstDir, rules: rulesFile, quiet: false });
  const firstKane = readJSON(path.join(firstDir, 'verdict.json')).kane || {};
  const probe = readJSON(path.join(firstDir, 'probe.json'), null);
  const entry = { round: 1, move: name, pitch, taunt, url, real: true, rulesBefore: rules.version, first: { ...summarize(first.verdict), runDir: path.relative(p(), firstDir), kane: { ...(first.verdict.kane || {}), credits: firstKane.credits } } };
  let credits = Number(firstKane.credits || 0);
  if (ruleCaught(first.verdict)) { entry.outcome = 'CAUGHT'; }
  else {
    entry.outcome = kaneCaught(first.verdict) ? 'KANE-ONLY' : 'MISSED';
    console.log(`  ${red('x ' + entry.outcome)} in the wild. Handing the real run to the builder.`);
    const fixPrompt = writeFixPrompt({ round: 'real-1', move: { name }, verdict: first.verdict, kane: first.kane, walletLog: [], rulesFile, promptDir: path.join(dir, 'prompts') });
    const b = build({ round: 1, move: { name: name.replace(/[^a-z0-9.-]+/gi, '-') }, fixPrompt, rulesFile, evidence: { url, intendedAmount: 10, kane: first.kane, walletLog: [], allowlist, probe } });
    for (const c of b.changes) console.log(`     + ${c}`);
    console.log(`     ${b.testsOk ? green('ok unit + regression tests pass') : red('x tests failing')} · rules v${rules.version} → v${b.rules.version}`);
    entry.builder = { changes: b.changes, testsOk: b.testsOk, rulesAfter: b.rules.version, fixPrompt: path.relative(p(), fixPrompt) };
    console.log(`\n  Kane: ${bold('Kane re-check on the live site')} (rules v${b.rules.version}, observe only, no login) → ${cyan(url)}`);
    const second = await check(url, { realSite: true, rules: rulesFile, maxSteps: maxSteps || 12, quiet: false });
    credits += Number(second.kane?.credits_consumed || 0);
    entry.recheck = summarize(second.verdict);
    entry.outcome += ruleCaught(second.verdict) ? ' → FIXED' : ' → STILL OPEN';
    console.log(ruleCaught(second.verdict) ? `  ${green('ok FIXED')}: Kane re-ran the live site and the hardened rules flag it.` : `  ${red('x still open')}`);
  }
  writeJSON(path.join(dir, 'history.json'), { finishedAt: new Date().toISOString(), credits, history: [entry] });
  if (promote) { fs.copyFileSync(rulesFile, p('config', 'rules.json')); console.log(green('  promoted hardened rules → config/rules.json')); }
  return entry;
}
