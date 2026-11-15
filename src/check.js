// `safuclick check <url>`: Kane drives the page with the mock wallet; we combine Kane's NDJSON,
// the wallet evidence log and the domain check into a verdict card.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { p, readJSON, writeJSON, STATE } from './paths.js';
import { startCollector, fetchLog } from './collector.js';
import { runKane, loadKaneNdjson } from './kane.js';
import { evaluate } from './verdict.js';
import { terminalCard, markdown, dim, cyan } from './report.js';

export const DEFAULT_RULES = p('config', 'rules.json');

export async function check(url, opts = {}) {
  const rules = readJSON(opts.rules || DEFAULT_RULES);
  const allowlist = readJSON(opts.allowlist || p('config', 'allowlist.json'));
  const amount = Number(opts.amount || 10);
  const log = opts.quiet ? () => {} : (s) => console.log(s);
  let kane, walletLog, runDir;

  if (opts.replay) {
    runDir = opts.replay;
    kane = loadKaneNdjson(path.join(runDir, 'kane.ndjson'));
    walletLog = readJSON(path.join(runDir, 'wallet-log.json'), []);
    url = url || readJSON(path.join(runDir, 'verdict.json'), {}).url;
    log(dim(`  ↺ replaying saved Kane run from ${runDir} (0 credits)`));
  } else {
    const collector = await startCollector({ quiet: true });
    const runId = crypto.randomBytes(4).toString('hex');
    const target = new URL(url); target.searchParams.set('safu_run', runId);
    runDir = opts.outDir || path.join(STATE, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${target.hostname}-${target.port || 80}`);
    log(`  🤖 Kane CLI is driving ${cyan(url)} in headless Chrome (run ${runId})…`);
    kane = await runKane({ url: target.toString(), amount, maxSteps: opts.maxSteps || 16, outDir: runDir,
      onEvent: (ev) => { if (ev.step && ev.status === 'done') log(dim(`     step ${String(ev.step).padStart(2)} · ${ev.remark.slice(0, 110)}`)); } });
    await new Promise((r) => setTimeout(r, 800));
    walletLog = await fetchLog(runId).catch(() => []);
    writeJSON(path.join(runDir, 'wallet-log.json'), walletLog);
    if (collector) collector.close();
  }

  const verdict = evaluate({ url, intendedAmount: amount, kane, walletLog }, rules, allowlist);
  verdict.runDir = runDir;
  if (!opts.replay) {
    writeJSON(path.join(runDir, 'verdict.json'), verdict);
    fs.writeFileSync(path.join(runDir, 'report.md'), markdown(verdict) + '\n');
  }
  if (!opts.quiet) console.log(opts.json ? JSON.stringify(verdict, null, 2) : terminalCard(verdict));
  if (opts.markdown) fs.writeFileSync(opts.markdown, markdown(verdict) + '\n');
  return { verdict, kane, walletLog, runDir };
}
