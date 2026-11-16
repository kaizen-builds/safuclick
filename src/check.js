// `safuclick check <url>`: Kane drives the page with the mock wallet; we combine Kane's NDJSON,
// the wallet evidence log and the domain check into a verdict card.
// `--real-site` skips the mock wallet: Kane only observes page-level signals (no signing).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { p, readJSON, writeJSON, STATE } from './paths.js';
import { startCollector, fetchLog } from './collector.js';
import { runKane, loadKaneNdjson, realSiteObjective, SCENARIOS } from './kane.js';
import { evaluate } from './verdict.js';
import { terminalCard, markdown, dim, cyan, yellow } from './report.js';
import { probeUrl, rdapAge } from './probe.js';
import { writeCard } from './card.js';
import { writeLive, patchLive } from './live.js';

export const DEFAULT_RULES = p('config', 'rules.json');

function stampDir(url) {
  try {
    const target = new URL(url);
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-${target.hostname}-${target.port || (target.protocol === 'https:' ? 443 : 80)}`;
  } catch {
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-url`;
  }
}

export async function check(url, opts = {}) {
  const rules = readJSON(opts.rules || DEFAULT_RULES);
  const allowlist = readJSON(opts.allowlist || p('config', 'allowlist.json'));
  const amount = Number(opts.amount || 10);
  const log = opts.quiet ? () => {} : opts.json ? (s) => console.error(s) : (s) => console.log(s);
  const realSite = !!(opts.realSite || opts['real-site']);
  const mode = realSite ? 'real-site' : 'gym';
  let kane, walletLog = [], probe, runDir;

  if (opts.replay) {
    runDir = opts.replay;
    kane = loadKaneNdjson(path.join(runDir, 'kane.ndjson'));
    walletLog = readJSON(path.join(runDir, 'wallet-log.json'), []);
    probe = readJSON(path.join(runDir, 'probe.json'), null);
    const saved = readJSON(path.join(runDir, 'verdict.json'), {});
    url = url || saved.url;
    const savedMode = saved.mode || (probe ? 'real-site' : 'gym');
    log(dim(`  ↺ replaying saved Kane run from ${runDir} (0 credits)`));
    const verdict = evaluate({ url, intendedAmount: amount, kane, walletLog, probe, mode: savedMode }, rules, allowlist);
    return finish(verdict, { kane, walletLog, runDir, opts, log, writeArtifacts: false });
  }

  runDir = opts.outDir || path.join(STATE, 'runs', stampDir(url));
  fs.mkdirSync(runDir, { recursive: true });
  writeLive({ phase: 'starting', mode, url, steps: [], runDir });

  if (realSite) {
    log(`  real-site mode: peeking at ${cyan(url)} (no mock wallet, no signing)…`);
    probe = await probeUrl(url, { guard: opts.urlGuard || null });
    try { probe.rdap = await rdapAge(new URL(probe.finalUrl || url).hostname); } catch { probe.rdap = null; }
    if (probe.rdap?.registered) log(dim(`     domain registered ${probe.rdap.registered.slice(0, 10)} (${probe.rdap.ageDays} days ago, RDAP)`));
    writeJSON(path.join(runDir, 'probe.json'), probe);
    if (probe.error) log(yellow(`     HTTP peek failed: ${probe.error}`));
    else log(dim(`     HTTP ${probe.status || '?'} · final ${probe.finalUrl} · title ${JSON.stringify(probe.title || '')}`));
    if (probe.blocked) log(yellow('     page looks cloaked or blocked (captcha / 403 / anti-bot). Kane may see the same wall.'));

    const dead = probe.error || (probe.status && probe.status >= 400 && probe.status !== 403 && probe.status !== 451);
    if (dead && probe.status !== 403 && probe.status !== 451 && probe.error) {
      log(yellow('     skipping Kane to save credits — site was not reachable from this machine.'));
      kane = null;
    } else {
      log(`  Kane CLI is reviewing ${cyan(url)} in headless Chrome (observe only, run ${path.basename(runDir)})…`);
      patchLive({ phase: 'kane', steps: [] });
      const steps = [];
      kane = await runKane({
        url, amount, maxSteps: opts.maxSteps || 12, timeout: opts.timeout || 300, outDir: runDir, objective: realSiteObjective(),
        onEvent: (ev) => {
          if (ev.step && ev.status === 'done') {
            steps.push({ step: ev.step, remark: ev.remark });
            log(dim(`     step ${String(ev.step).padStart(2)} · ${String(ev.remark || '').slice(0, 110)}`));
            patchLive({ phase: 'kane', steps: steps.slice() });
          }
        },
      });
    }
  } else {
    const scenario = opts.scenario || 'swap';
    if (!SCENARIOS[scenario]) throw new Error(`unknown --scenario ${scenario} (use ${Object.keys(SCENARIOS).join('|')})`);
    if (opts.twoViews) {
      // View 1: plain HTTP peek, no JavaScript, no wallet (what a crawler or a no-wallet visitor gets).
      // *.localhost is resolved by browsers, not always by Node: peek the gym port on 127.0.0.1.
      const u = new URL(url);
      const peekUrl = u.hostname.endsWith('.localhost') ? url.replace(u.hostname, '127.0.0.1') : url;
      probe = await probeUrl(peekUrl);
      probe = { ...probe, startUrl: url, finalUrl: url, peekedVia: peekUrl };
      writeJSON(path.join(runDir, 'probe.json'), probe);
      log(dim(`  view 1 · HTTP peek (no JS, no wallet): ${JSON.stringify((probe.textSnippet || '').slice(0, 90))}`));
    }
    const collector = await startCollector({ quiet: true });
    const runId = crypto.randomBytes(4).toString('hex');
    const target = new URL(url); target.searchParams.set('safu_run', runId);
    log(`  Kane CLI is driving ${cyan(url)} in headless Chrome (run ${runId})…`);
    patchLive({ phase: 'kane', runId, steps: [] });
    const steps = [];
    kane = await runKane({
      url: target.toString(), amount, maxSteps: opts.maxSteps || 16, outDir: runDir, objective: SCENARIOS[scenario](amount),
      onEvent: (ev) => {
        if (ev.step && ev.status === 'done') {
          steps.push({ step: ev.step, remark: ev.remark });
          log(dim(`     step ${String(ev.step).padStart(2)} · ${String(ev.remark || '').slice(0, 110)}`));
          patchLive({ phase: 'kane', steps: steps.slice() });
        }
      },
    });
    await new Promise((r) => setTimeout(r, 800));
    walletLog = await fetchLog(runId).catch(() => []);
    writeJSON(path.join(runDir, 'wallet-log.json'), walletLog);
    if (collector) collector.close();
  }

  const verdict = evaluate({ url, intendedAmount: amount, kane, walletLog, probe, mode }, rules, allowlist);
  if (!realSite) verdict.scenario = opts.scenario || 'swap';
  return finish(verdict, { kane, walletLog, runDir, opts, log, writeArtifacts: true });
}


function finish(verdict, { kane, walletLog, runDir, opts, log, writeArtifacts }) {
  verdict.runDir = runDir;
  let cardFile;
  if (writeArtifacts) {
    try { cardFile = writeCard(runDir, verdict); } catch { /* card is best-effort */ }
    if (cardFile) verdict.card = cardFile;
    writeJSON(path.join(runDir, 'verdict.json'), verdict);
    fs.writeFileSync(path.join(runDir, 'report.md'), markdown(verdict) + '\n');
  }
  writeLive({ phase: 'done', mode: verdict.mode, url: verdict.url, steps: verdict.kane?.steps || [], verdict, runDir, card: cardFile });
  if (!opts.quiet) console.log(opts.json ? JSON.stringify(verdict, null, 2) : terminalCard(verdict) + (cardFile && !opts.json ? dim(`  SafuCard   ${cardFile}`) + '\n' : ''));
  if (opts.markdown) fs.writeFileSync(opts.markdown, markdown(verdict) + '\n');
  return { verdict, kane, walletLog, runDir, card: cardFile };
}
