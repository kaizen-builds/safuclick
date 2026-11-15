# 🛡️ SafuClick

**Paste a crypto link before you connect your wallet.** SafuClick uses **Kane CLI** to walk through the site like a real user, with a throwaway mock wallet. It records exactly what the page asks that wallet to sign, then flags known trap patterns: lookalike domains, seed-phrase prompts, and "Swap 10 USDC" buttons that actually request an **unlimited approval**.

> **SafuClick, powered by Kane CLI.** Built for the [KaneCLI Online Hackathon](https://www.kaneclihack.sh/).
> Everything runs locally against a built-in **phishing gym**: mock wallet, mock contracts, no chain, no real funds, no live drainer sites.

![Hidden approval: the UI says "Swap 10 USDC", the wallet is asked for UNLIMITED](docs/img/gym-approval-popup.png)

---

## 🌐 Website: [safuclick.vercel.app](https://safuclick.vercel.app)

Try it without installing anything:

- **Recorded checks** are 7 real Kane runs you can replay for free. Four are on the practice gym (official, clone, seed prompt, hidden approval) and three are on live sites (Uniswap, curvegov.icu, aave-fi.info).
- **Scam Arena** replays the recorded 3-round scammer vs builder fight, where the rules go from v0 to v2.
- **Live check**: paste a link and Kane CLI runs a real observe-only check. It doesn't use the mock wallet, sign anything or type anything.

How the live check is hosted: the site runs on Vercel, but Kane needs a browser and a logged-in Kane account, so the runs happen on a machine that's logged in to Kane. Vercel's `/api/check` validates the URL (http/https only, no localhost or private IPs) and posts the job to a secret [ntfy.sh](https://ntfy.sh) topic. `scripts/live-worker.sh` (`src/live-api/relay-worker.js`) runs on the Kane machine, subscribes over outbound HTTPS, runs `safuclick check --real-site` and posts the verdict back. No inbound port or tunnel is needed, and Kane credentials never leave that machine. Caps: 3 live checks per visitor per day, 40 per day overall, one Kane run at a time (queue of 5) and a 150 s Kane timeout. If the worker is down, the site says live checks are offline and points to the recorded checks.

Rebuild the site data from run files with `npm run site:data`. The site lives in `site/`.

## ⚡ 60-second quickstart

```bash
# 0. Node 20+ and Kane CLI (one-time)
npm install -g @testmuai/kane-cli && kane-cli login        # TestMu AI account

# 1. Clone & start the phishing gym (no npm install needed: zero dependencies)
git clone https://github.com/kaizen-builds/safuclick && cd safuclick
npm run gym                                                 # terminal 1

# 2. Check links (terminal 2): Kane drives headless Chrome
npm run check -- http://safuswap.localhost:4100/            # ✅ official
npm run check -- http://safuswap.localhost:4103/            # 🚨 hidden unlimited approval
npm run check -- http://safuswep.localhost:4101/            # 🚨 lookalike clone
npm run check -- http://safuswap-verify.localhost:4102/     # 🚨 seed-phrase prompt

# 3. Watch the closed loop: scammer vs builder, refereed by Kane
npm run loop -- --rounds 3 --fresh

# No Kane credits? Re-judge the real recorded runs, offline:
npm test
npm run check -- --replay docs/runs/loop/02-poisoned-approve-first
```

`*.localhost` resolves to 127.0.0.1 in Chrome, so the gym can serve "different domains" with no DNS setup. Each check costs about **10 to 36 Kane credits** (see [real runs](#-what-kane-caught-real-runs)).

Web UI: `npm run ui`, then open http://127.0.0.1:4200. The Scam Arena (scammer vs builder scoreboard + Kane step timeline) is at http://127.0.0.1:4200/arena.

Real-site mode (no mock wallet — Kane only *observes* a live page, never connects or types secrets):

```bash
npm run check -- --real-site https://app.uniswap.org
```

Every check also writes a shareable SafuCard (`card.svg`) into the run folder. Re-render one with `npx safuclick card <runDir>`. A clean real-site result is still not a guarantee of safety: sites can cloak or fingerprint test browsers.


![Web UI verdict](docs/img/ui-verdict.png)

---

## 🧠 How it works

```mermaid
flowchart LR
  U[URL to check] --> C[safuclick check]
  C -->|objective + --url| K[Kane CLI<br/>headless Chrome]
  K -->|clicks Connect, Swap,<br/>reads wallet popup| P[Target page]
  P -->|window.ethereum.request| W[SafuWallet mock<br/>EIP-1193, DOM popup]
  W -->|every request, decoded tx,<br/>secret-input fields| L[(Evidence collector<br/>:4199)]
  K -->|NDJSON: steps, assertions,<br/>status, test_url, credits| C
  L --> V{Verdict engine<br/>config/rules.json}
  D[Domain check vs<br/>allowlist] --> V
  C --> V
  V --> R[Verdict card<br/>terminal · web UI · PR markdown]
```

1. **Kane CLI drives the page** (`kane-cli run --agent --headless`): it connects the wallet, sets 10 USDC, clicks Swap, then **reads the wallet popup and asserts** that its Action is "Swap" and its Amount is exactly "10 USDC".
2. **SafuWallet** (`src/wallet/mock-wallet.js`) is an in-page, EIP-1193-style mock wallet. It has no keys, no extension and no chain. Each request opens a plain-DOM popup (site, method, action, contract, spender, amount), which Kane reads and clicks like any other web button. It decodes `approve(spender, amount)` calldata and logs every request, plus any text field that appears on the page (with its label and surrounding text), to the evidence collector.
3. **The verdict engine** (`src/verdict.js`, a pure function that is tested against fixtures) combines three sources:
   - **Wallet evidence:** unlimited or excessive approvals, unknown spenders, address poisoning, unknown contracts. A visual check can't see these.
   - **DOM evidence:** fields asking for a seed phrase, recovery phrase or secret words.
   - **Domain check:** typosquats (edit distance), brand-in-subdomain, punycode.
   - **Kane's own judgement:** a failed assertion (`assertion_error.*`) whose text describes a trap. Kane runs that get stuck or hit max steps are reported as **INCONCLUSIVE**, never as "safe".

Three verdicts are possible: `🚨 TRAP FLAGGED`, `❔ INCONCLUSIVE` and `✅ NO KNOWN TRAPS FOUND`. The last one deliberately doesn't say "safe".

### The phishing gym (`npm run gym`)

| Site | URL | Trap |
|---|---|---|
| ✅ official | `http://safuswap.localhost:4100/` | none |
| 🎣 clone | `http://safuswep.localhost:4101/` | pixel-perfect copy on a typosquatted domain; the swap goes to the attacker's router |
| 🎣 seed | `http://safuswap-verify.localhost:4102/` | "Enter your 12-word recovery phrase" modal |
| 🎣 approval | `http://safuswap.localhost:4103/` | **real domain**, compromised frontend: "Swap 10 USDC" sends `approve(drainer, MAX_UINT256)` |
| 🧪 loop slot | `http://*.localhost:4110/` | whatever the scammer agent plants (hot-reloaded) |

Variants are config-driven (`gym/variants.json`, re-read on every request), so the scammer agent can add or evolve traps without code changes. Supported traps: `approve {spender, amount|"max"}`, `seed_prompt {when: load|after_connect, wording, …}`, `swap_router`/lookalike `host`.

---

## 🔁 The closed loop (`npm run loop`)

```mermaid
sequenceDiagram
  participant S as 😈 Scammer agent
  participant G as Phishing gym
  participant K as 🤖 Kane CLI (referee)
  participant B as 🛠 Builder agent
  S->>G: plant / evolve trap (loop-variant.json, hot reload)
  K->>G: drive the page with the mock wallet
  K-->>B: verdict + Kane NDJSON + wallet log → fix prompt (round-N-fix.md)
  B->>B: harden rules, add regression fixture, run tests
  B->>K: re-run Kane against the same trap
  K-->>S: CAUGHT → scammer must evolve
```

Each round goes like this:
1. 😈 **The scammer** plants a trap on the loop slot.
2. 🤖 **Kane** referees it with the current rules.
3. If deterministic rules catch it, the result is **CAUGHT** and the scammer evolves.
4. If only Kane's LLM judgement caught it (**KANE-ONLY**), or nothing did (**MISSED**), Kane's report becomes a **fix prompt** ([example](docs/runs/loop/prompts/round-2-fix.md)) containing Kane's summary, steps, `test_url` and the wallet evidence.
5. 🛠 **The builder** hardens `rules.json`, writes a **regression fixture from the real Kane run**, and runs the tests.
6. 🤖 **Kane re-runs** the same trap live to verify the fix.

The loop starts from deliberately naive day-zero rules (`config/rules.baseline.json`). `--promote` copies the hardened rules into `config/rules.json`, which is how the shipped rules were produced.

### Plug in a real coding agent

Out of the box, the scammer and builder are **scripted, LLM-free roles**, so judges can run them with no API keys. The handoff is file-based, so any coding agent can take either seat:

```bash
# Builder = Claude Code (reads Kane's fix prompt, edits rules/verdict.js, adds tests)
SAFU_BUILDER_CMD='claude -p "$(cat $SAFU_FIX_PROMPT)" --allowedTools Edit,Write,Bash' npm run loop

# Builder = Codex / Cursor CLI work the same way: the prompt path is in $SAFU_FIX_PROMPT, the rules file in $SAFU_RULES
SAFU_BUILDER_CMD='codex exec "$(cat $SAFU_FIX_PROMPT)"' npm run loop

# Scammer = any LLM agent: gets the defender's current rules, writes a new variant to $SAFU_VARIANT_FILE
SAFU_SCAMMER_CMD='claude -p "$(cat $SAFU_SCAMMER_PROMPT)" --allowedTools Write' npm run loop
```

Also included:
- `kane-cli install skill` installs Kane's agent skill into Claude Code, Codex CLI or Gemini CLI, so the coding agent can call Kane itself.
- [`hooks/claude-code-stop-hook.sh`](hooks/claude-code-stop-hook.sh): when Claude Code says "done", Kane re-checks the dApp. A flagged trap exits with code 2, which feeds the Kane report back to the agent as its next instruction, with no human in between.
- [`hooks/pre-push`](hooks/pre-push): blocks a push if Kane flags your staging URL.
- [`docs/ci/safuclick.yml`](docs/ci/safuclick.yml): a GitHub Action that runs the gym checks on each PR and posts Kane's verdict as a PR comment. Copy it to `.github/workflows/` and add the `LT_USERNAME`/`LT_ACCESS_KEY` secrets.

---

## 🔬 What Kane caught (real runs)

All runs below are real `kane-cli` 0.10.4 headless runs on 15 Nov 2026. The full NDJSON, wallet logs and verdicts are in [`docs/runs/`](docs/runs). Credits are Kane's own `credits_consumed`.

**Gym checks**

| Target | Kane | SafuClick verdict | What was flagged | Credits |
|---|---|---|---|---|
| official | ✅ passed: "completed a 10 USDC swap on SafuSwap" | ✅ NO KNOWN TRAPS FOUND | nothing | 31.2 |
| hidden approval (real domain) | ❌ assertion failed: *"The wallet popup did not match the requested swap: it asked to approve token spending for an unlimited USDC amount."* | 🚨 TRAP FLAGGED | `unlimited_approval` to `0xd2a1…dead` + Kane assertion | 25.2 |
| seed prompt | ❌ refused to continue: *"A wallet verification dialog requests recovery words, so I will not fill it."* | 🚨 TRAP FLAGGED | `seed_phrase_prompt`, `brand_impersonation` (+ Kane) | 16.6 |
| lookalike clone | ✅ **passed**: "completed a 10 USDC swap on SafuSWEp" | 🚨 TRAP FLAGGED | `lookalike_domain` (1 edit from safuswap), `unknown_contract` (swap sent to attacker router `0xc10e…d000`) | 35.9 |

The clone row is the point of the whole project. A pixel-perfect clone **passes** a purely visual end-to-end test, because Kane happily completes the swap. SafuClick still flags it, because the wallet evidence that Kane's run produced shows the transaction going to an unknown contract on a typosquatted domain.

**Closed loop** ([transcript](docs/runs/loop/transcript.txt), [history](docs/runs/loop/history.json))

| Round | 😈 Scammer move | First Kane run | Builder patch (from Kane's report) | Kane re-check |
|---|---|---|---|---|
| R1 | `unlimited-approve`: MAX_UINT approval on the real domain | 🚨 caught by rules **and** Kane (25.0 cr) | none needed: **scammer must evolve** | n/a |
| R2 | `poisoned-approve`: 5,000,000 USDC (not MAX), spender `0x5afe9d…c0ffee` imitating router `0x5afe5a…c0ffee` | ⚠ **KANE-ONLY**: no rule fired, Kane caught it: *"The SafuWallet request did not match the requested 10 USDC swap: it asked to approve token spending for 5,000,000 USDC."* (20.5 cr) | rules v0→v1: `maxAllowanceRatio=10`, `requireKnownSpender`, `flagAddressPoisoning`, plus a regression fixture | 🚨 **FIXED**: `excessive_approval` (500000x), `address_poisoning`, `unknown_spender` + Kane (21.4 cr) |
| R3 | `delayed-seed`: clean on load, then after connect a "Session expired, type your 12 secret words" modal that avoids the words seed/recovery/mnemonic | ❔ **MISSED** (INCONCLUSIVE). Kane got blocked: *"required secret words, so the safe swap flow could not continue"*, but no rule matched (20.7 cr) | rules v1→v2: seed patterns `secret words`, `(12\|24) … words`, `re-sync`, plus a regression fixture | 🚨 **FIXED**: `seed_phrase_prompt` (10.0 cr) |

**Honest notes from building it:**
- One early clone run hit `stuck.max_steps`, and Kane's end-of-run summary claimed a recovery-phrase prompt was present. Its own analyze step had returned `false`. Since then SafuClick only counts Kane failures with `assertion_error.*` codes as trap evidence. Stuck runs are reported as INCONCLUSIVE.
- In one iteration, the objective asked Kane to read a "Spender" line that swap popups didn't have, and Kane correctly failed with `confirmed_product_bug`. The wallet now always shows the spender.
- `verdict.json` in each run folder is the verdict as judged at run time. Use `--replay` to re-judge any run with the current rules (0 credits).

---

## ⚠️ Known limitations

- **It flags known trap patterns. It is not a safety guarantee.** A clean result only means that *this run*, with *this* wallet and browser, showed none of the patterns SafuClick knows about.
- **Cloaking and fingerprinting:** real drainers can detect automation or test wallets (for example `isSafuWallet`, headless Chrome or the IP address), serve a clean page to scanners, or arm the trap after N visits, at certain times, or only for wallets with a balance.
- **Wallet injection:** SafuWallet is injected by the gym server. To check arbitrary third-party sites, the mock wallet has to be injected into Kane's browser, for example with a Chrome profile/extension (`--chrome-profile`) or over CDP (`--cdp-endpoint`). That's on the roadmap, not built yet.
- **Mock decoding:** only ERC-20 `approve` and the mock router `swap` are decoded. Permit/Permit2 signatures, `setApprovalForAll`, `increaseAllowance` and multicalls are next.
- **LLM variance:** Kane's assertions and summaries vary run to run. That's why deterministic wallet and DOM rules carry the verdict, and Kane-only catches are turned into rules by the loop.
- The scripted builder applies hardening from a small library keyed on the evidence. A real coding agent (`SAFU_BUILDER_CMD`) can write new rule *types*.

---

## 🎬 Demo video script (3 to 5 min)

1. **0:00 to 0:20, hook.** "Wallet drainers are one of the most common ways people lose crypto, and most of them start with one click on a link that looks legit." Show the clone and the official site side by side: they're identical.
2. **0:20 to 0:50, what SafuClick is.** "Paste a link before you connect. Kane CLI walks through it with a throwaway wallet and records what the site asks that wallet to sign." Show the architecture diagram.
3. **0:50 to 1:40, the hidden approval.** `npm run check -- http://safuswap.localhost:4103/`. Narrate Kane's steps as they stream. Show the popup screenshot ("Swap 10 USDC" vs UNLIMITED), then the 🚨 card: `unlimited_approval` plus Kane's assertion quote and test_url link. Open the Kane report in Test Manager.
4. **1:40 to 2:20, the clone.** Kane **passes** ("completed a 10 USDC swap"), but SafuClick flags `lookalike_domain` and `unknown_contract`. "A visual test says ship it. The wallet evidence says scam."
5. **2:20 to 3:40, the closed loop.** `npm run loop -- --rounds 3 --fresh`. R1 caught → the scammer evolves to address poisoning with a 5M approval → KANE-ONLY → show `round-2-fix.md` → the builder patches rules v0→v1 and adds a regression test → the Kane re-check is FIXED. Then R3's delayed "12 secret words" prompt: MISSED → patch → FIXED. End on the scoreboard.
6. **3:40 to 4:20, plug in your agent.** `SAFU_BUILDER_CMD='claude -p …'`, the Claude Code Stop hook and the PR comment Action.
7. **4:20 to 4:40, honesty and close.** "It flags known trap patterns, not guarantees. Cloaking is real." Then the repo link and "SafuClick, powered by Kane CLI."

---

## 📁 Layout

```
bin/safuclick.js           CLI: gym | check | ui | loop
src/gym/                   phishing gym server + SafuSwap mini dApp
src/wallet/mock-wallet.js  SafuWallet: EIP-1193 mock + DOM popup + evidence logging
src/kane.js                kane-cli run --agent wrapper (NDJSON)
src/verdict.js             pure verdict engine (wallet + DOM + domain + Kane)
src/loop/                  scammer, builder, playbook, loop orchestrator
config/                    allowlist, rules.json (hardened v2), rules.baseline.json (v0)
test/                      fixtures from real Kane runs + loop regressions (node --test)
docs/runs/                 real Kane run logs, wallet logs, verdicts, loop transcript
hooks/, docs/ci/           pre-push, Claude Code Stop hook, GitHub Action example
```

MIT licensed. No real keys, funds or live phishing sites are used anywhere. SafuWallet's account `0x7e57…0001` is a placeholder.
