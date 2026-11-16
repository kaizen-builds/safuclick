# SafuClick

Paste a crypto link before you connect your wallet. Kane CLI walks the page with a throwaway mock wallet, and SafuClick flags known trap patterns: lookalike domains, seed-phrase prompts, and a "Swap 10 USDC" button that actually asks for an unlimited approval.

Built for the [KaneCLI Online Hackathon](https://www.kaneclihack.sh/). Try it at [safuclick.vercel.app](https://safuclick.vercel.app): 14 recorded Kane checks (10 gym, 4 live), the Agent <-> Kane transcripts in Scam Arena, and a few live observe-only checks each day. This repo runs locally against a phishing gym: no chain, no real funds.

![Hidden approval: the UI says "Swap 10 USDC", the wallet is asked for UNLIMITED](docs/img/gym-approval-popup.png)

## Quickstart

```bash
# Node 20+ and Kane CLI (one-time)
npm install -g @testmuai/kane-cli && kane-cli login

git clone https://github.com/kaizen-builds/safuclick && cd safuclick
npm run gym                                      # terminal 1, no npm install needed

# terminal 2
npm run check -- http://safuswap.localhost:4100/        # official
npm run check -- http://safuswap.localhost:4103/        # hidden unlimited approval
npm run check -- http://safuswep.localhost:4101/        # lookalike clone

npm test
npm run check -- --replay docs/runs/loop/02-poisoned-approve-first
```

`*.localhost` resolves to 127.0.0.1, so the gym needs no DNS. A typical check uses about 10 to 40 Kane credits. Local UI: `npm run ui`, then http://127.0.0.1:4200 (Scam Arena is at `/arena`). Observe a live site with `npm run check -- --real-site https://app.uniswap.org` (no mock wallet, no signing).

## How it works

1. Kane CLI (`kane-cli run --agent --headless`) opens the page, clicks Connect and Swap, and reads the wallet popup.
2. SafuWallet (`src/wallet/mock-wallet.js`) is an in-page EIP-1193 mock with no keys and no chain. It logs every request, decoded approval, signature, batch call and secret-looking field.
3. The verdict engine (`src/verdict.js`) combines that wallet evidence, DOM prompts, lookalike-domain checks, and Kane's own assertions.

Three verdicts: `TRAP FLAGGED`, `INCONCLUSIVE`, and `NO KNOWN TRAPS FOUND`. The last one only means this run showed none of the patterns SafuClick knows about.

## The phishing gym (`npm run gym`)

| Site | URL | Trap |
|---|---|---|
| official | `http://safuswap.localhost:4100/` | none |
| clone | `http://safuswep.localhost:4101/` | lookalike domain; swap goes to an attacker router |
| seed | `http://safuswap-verify.localhost:4102/` | asks for a 12-word recovery phrase |
| approval | `http://safuswap.localhost:4103/` | real domain: "Swap 10 USDC" sends `approve(drainer, MAX)` |
| claim | `http://claim.safuswap-airdrop.localhost:4104/` | Permit2 signature, unlimited USDC, 3 years |
| revoke | `http://revoke-cash.localhost:4105/` | fake revoke: `setApprovalForAll(attacker, true)` |
| batch | `http://safuswap.localhost:4106/` | one `wallet_sendCalls` hides extra unlimited approvals |
| allowance | `http://safuswap.localhost:4107/` | `increaseAllowance(attacker, MAX)` instead of `approve` |
| cloak | `http://safuswap.localhost:4108/` | "Coming soon" to crawlers; Permit drainer if a wallet is present |
| cloak-strict | `http://safuswap.localhost:4109/` | also hides from automation; verdict is INCONCLUSIVE |
| loop slot | `http://*.localhost:4110/` | whatever the scammer agent plants |

Variants live in `gym/variants.json` and reload on each request. Pick Kane's flow with `--scenario swap|claim|revoke|batch|allowance|cloak`. `--two-views` compares a no-JS HTTP peek with Kane's view.

## Agent <-> Kane loop (`npm run agent-loop`)

A real LLM **scammer** reads the current rules and writes a new gym variant inside an existing trap family (local `*.localhost` only; `src/agents/variant-guard.js` rejects anything else). **Kane CLI** runs it. A real LLM **builder** reads Kane's NDJSON, the wallet evidence and the verdict, and may write a `config/rules.json` fix. Kane then re-checks the same trap.

Before a fix is applied it must pass the rules schema, a hardening-only check (no flags switched off, no deletions, thresholds only tighten), a `--replay` of every recorded run with no verdict changes, a check that the missed trap now flags, and the full test suite. Failures are rolled back and logged. Only a Kane-confirmed fix is kept; `--promote` locks it in.

Recorded run (16 Nov 2026), scammer and builder = `anthropic/claude-sonnet-5` via NEAR AI Cloud, 70.7 Kane credits billed:

| Round | Trick | First check | Builder | Recheck |
|---|---|---|---|---|
| 1 | "backup phrase" on `safuswap-restore.localhost` | TRAP FLAGGED | no fix | — |
| 2 | "recovery key" on `wallet-securitycheck.localhost` | INCONCLUSIVE | added `recovery[- ]key` to seed patterns | TRAP FLAGGED (rules v8) |
| 3 | "sync code" on `safuswap-relink.localhost` | TRAP FLAGGED | no fix | — |

Transcripts are in `docs/runs/agent-loop/round-N/transcript.md`, and on the site under "Agent <-> Kane transcript".

```bash
npm run agent-loop -- --rounds 3 --budget 250 --promote     # live LLM + Kane
npm run agent-loop -- --agent replay --kane replay          # recorded answers, 0 credits, no network
```

Set a provider with `NEARAI_API_KEY`, `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY`. If none is set, or it errors mid-run, the loop falls back to the recorded answers and marks that turn `fallback`. `--kane replay` re-judges the recorded Kane runs instead of calling Kane.

`npm run loop` is a scripted, no-API-key version of the same idea. It started from `config/rules.baseline.json` (v0) and produced the earlier hardenings. Those runs are in `docs/runs/loop` and `docs/runs/loop2`.

## What Kane caught

Real `kane-cli` 0.10.4 runs. Full logs are in [`docs/runs/`](docs/runs).

| Target | Verdict | Flagged | Credits |
|---|---|---|---|
| official SafuSwap | NO KNOWN TRAPS FOUND | — | 34.3 |
| hidden approval | TRAP FLAGGED | `unlimited_approval` | 25.2 |
| seed prompt | TRAP FLAGGED | `seed_phrase_prompt` | 16.6 |
| lookalike clone (`safuswep`) | TRAP FLAGGED | `lookalike_domain` (Kane still completed the swap) | 35.9 |
| strict cloak | INCONCLUSIVE | both views saw "Coming soon" | 27.4 |
| app.uniswap.org | NO KNOWN TRAPS FOUND | observe-only | 29.7 |
| curvegov.icu / aave-fi.info | TRAP FLAGGED | `brand_impersonation` | 35.6 / 31.7 |
| usdc082.com | TRAP FLAGGED | `ticker_digits_domain` (missed on v5) | 60.5 |

The clone is the useful case: Kane completes the swap because the page looks right. SafuClick flags it from the wallet evidence and the typosquat.

## Known limitations

- It flags known trap patterns. It is not a safety guarantee. A clean result only means this run, with this wallet and browser, showed none of the patterns SafuClick knows about.
- Real drainers can cloak: detect automation or test wallets, serve a clean page to scanners, or arm the trap later.
- SafuWallet is injected by the gym, so on real sites SafuClick cannot see what a page would ask a wallet to sign. Injecting the mock wallet into third-party pages is not built yet.
- Kane's wording varies run to run, so wallet and DOM rules carry the verdict. Stuck or max-step Kane runs are INCONCLUSIVE, not a trap.

## Layout

```
bin/safuclick.js           CLI: gym, check, ui, loop, agent-loop
src/gym/                   phishing gym + SafuSwap mini dApp
src/wallet/mock-wallet.js  SafuWallet mock + evidence logging
src/verdict.js             verdict engine (wallet, DOM, domain, Kane)
src/agents/                LLM scammer and builder (agent-loop)
src/loop/                  scripted scammer / builder
config/                    allowlist, rules.json (v8), rules.baseline.json (v0)
docs/runs/                 Kane logs and agent-loop transcripts
site/                      website at safuclick.vercel.app
```

MIT licensed. No real keys or funds are used in the gym. SafuWallet's account `0x7e57…0001` is a placeholder.
