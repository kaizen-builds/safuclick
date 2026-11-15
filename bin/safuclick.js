#!/usr/bin/env node
// SafuClick CLI, powered by Kane CLI.
import { parseArgs } from 'node:util';

const [cmd, ...rest] = process.argv.slice(2);
const { values: o, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
  rules: { type: 'string' }, allowlist: { type: 'string' }, amount: { type: 'string' }, 'max-steps': { type: 'string' },
  replay: { type: 'string' }, json: { type: 'boolean' }, markdown: { type: 'string' }, rounds: { type: 'string' },
  port: { type: 'string' }, 'fail-on-trap': { type: 'boolean' }, promote: { type: 'boolean' }, fresh: { type: 'boolean' },
  'real-site': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} });

const help = `
  SafuClick: paste a crypto link before you connect your wallet. Powered by Kane CLI.

  safuclick gym                     start the local phishing gym (official SafuSwap + scam variants)
  safuclick check <url>             Kane drives the URL with a mock wallet; prints a verdict card
      --amount 10                   amount the user intends to swap (USDC)
      --max-steps 16                Kane step budget (credits!)
      --rules config/rules.json     heuristics file  --json  --markdown report.md  --fail-on-trap
      --replay <runDir>             re-judge a saved Kane run with current rules (0 credits)
      --real-site                   no mock wallet: Kane observes the live page only (no signing)
  safuclick card <runDir>           (re)write a shareable SafuCard SVG from a saved verdict
  safuclick ui [--port 4200]        web UI for checks + Scam Arena at /arena
  safuclick loop [--rounds 2]       scammer vs builder rounds refereed by Kane (closed loop)
      --fresh                       restart from config/rules.baseline.json
      --promote                     copy hardened loop rules to config/rules.json at the end
`;

if (o.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(help);
  process.exit(0);
}

if (cmd === 'gym') {
  const { startGym } = await import('../src/gym/server.js');
  await startGym();
} else if (cmd === 'check') {
  if (!positionals[0] && !o.replay) { console.log(help); process.exit(2); }
  const { check } = await import('../src/check.js');
  const { verdict } = await check(positionals[0], { ...o, maxSteps: o['max-steps'] && Number(o['max-steps']), realSite: o['real-site'] });
  process.exit(o['fail-on-trap'] && verdict.verdict === 'TRAP FLAGGED' ? 1 : 0);
} else if (cmd === 'card') {
  const dir = positionals[0] || o.replay;
  if (!dir) { console.log(help); process.exit(2); }
  const { readJSON } = await import('../src/paths.js');
  const { writeCard } = await import('../src/card.js');
  const path = await import('node:path');
  const verdict = readJSON(path.join(dir, 'verdict.json'));
  const file = writeCard(dir, verdict);
  console.log(file);
} else if (cmd === 'ui') {
  const { startUI } = await import('../src/ui/server.js');
  await startUI(Number(o.port || 4200));
} else if (cmd === 'loop') {
  const { runLoop } = await import('../src/loop/loop.js');
  await runLoop({ rounds: Number(o.rounds || 2), promote: o.promote, fresh: o.fresh, maxSteps: o['max-steps'] && Number(o['max-steps']) });
  process.exit(0);
} else {
  console.log(help);
}
