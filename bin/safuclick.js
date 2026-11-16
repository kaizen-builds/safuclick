#!/usr/bin/env node
// SafuClick CLI, powered by Kane CLI.
import { parseArgs } from 'node:util';

const [cmd, ...rest] = process.argv.slice(2);
const { values: o, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
  rules: { type: 'string' }, allowlist: { type: 'string' }, amount: { type: 'string' }, 'max-steps': { type: 'string' },
  replay: { type: 'string' }, json: { type: 'boolean' }, markdown: { type: 'string' }, rounds: { type: 'string' },
  port: { type: 'string' }, 'fail-on-trap': { type: 'boolean' }, promote: { type: 'boolean' }, fresh: { type: 'boolean' },
  'real-site': { type: 'boolean' }, scenario: { type: 'string' }, 'two-views': { type: 'boolean' }, from: { type: 'string' }, moves: { type: 'string' }, real: { type: 'string' }, first: { type: 'string' }, agent: { type: 'string' }, kane: { type: 'string' }, budget: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
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
      --scenario swap|claim|revoke|batch|allowance|cloak   which gym flow Kane should drive
      --two-views                   also take a plain HTTP peek (no JS) and compare it with Kane's view (cloaking)
  safuclick card <runDir>           (re)write a shareable SafuCard SVG from a saved verdict
  safuclick ui [--port 4200]        web UI for checks + Scam Arena at /arena
  safuclick loop [--rounds 2]       scammer vs builder rounds refereed by Kane (closed loop)
      --fresh                       restart from config/rules.baseline.json
      --promote                     copy hardened loop rules to config/rules.json at the end
      --from config/rules.json      start the loop from this rules file instead of the baseline
      --moves a,b                   only play these scammer moves (see src/loop/playbook.json)
  safuclick agent-loop [--rounds 3] REAL LLM scammer + builder agents talk to Kane CLI (transcripts in docs/runs/agent-loop)
      --agent llm|replay            llm (default; NEARAI_API_KEY / AI_GATEWAY_API_KEY / OPENAI_API_KEY) or replay recorded answers
      --kane live|replay            live kane-cli runs (default) or re-judge the recorded Kane runs (0 credits)
      --from docs/runs/agent-loop   recorded run used by replay and as the fallback if the LLM provider errors
      --budget 250 --max-steps 14   Kane credit cap and step budget  --promote  copy Kane-confirmed rules to config/rules.json
  safuclick loop --real <url> --first <runDir>   real-world round: replay a missed live run, harden rules, Kane re-checks the live site
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
  const { verdict } = await check(positionals[0], { ...o, maxSteps: o['max-steps'] && Number(o['max-steps']), realSite: o['real-site'], twoViews: o['two-views'] });
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
  const { runLoop, runRealRound } = await import('../src/loop/loop.js');
  if (o.real) { await runRealRound({ url: o.real, first: o.first, from: o.from, promote: o.promote, maxSteps: o['max-steps'] && Number(o['max-steps']), name: positionals[0] || 'real-world miss' }); process.exit(0); }
  await runLoop({ rounds: Number(o.rounds || 2), promote: o.promote, fresh: o.fresh, maxSteps: o['max-steps'] && Number(o['max-steps']), from: o.from, only: o.moves ? o.moves.split(',') : null });
  process.exit(0);
} else if (cmd === 'agent-loop') {
  const { runAgentLoop } = await import('../src/agents/agent-loop.js');
  const r = await runAgentLoop({ rounds: o.rounds, agent: o.agent, kane: o.kane, from: o.from, outDir: o.out, maxSteps: o['max-steps'] && Number(o['max-steps']), budget: o.budget, promote: o.promote });
  console.log(`\n  ${r.history.map((h) => `R${h.round} ${h.name || '?'}: ${h.outcome}`).join('\n  ')}\n  Kane credits: ${r.kaneMode === 'live' ? (r.creditsBilled ?? r.creditsKaneReported) : '0 (re-judged recorded runs)'} · LLM calls: ${r.llmCalls} (${r.llmSources.join(', ')})`);
  process.exit(0);
} else {
  console.log(help);
}
