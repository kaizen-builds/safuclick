# SafuClick fix request: round real-1

Kane CLI just refereed the scammer's move **usdc082-fake-exchange** on `https://usdc082.com`.
Verdict with current rules (v5): **NO KNOWN TRAPS FOUND**. Deterministic rules fired: **none**.

## What Kane reported
```
status: passed
one_liner: inspected a cryptocurrency-themed page on usdc082.com
summary: Reviewed the loaded page as requested without entering any information, connecting a wallet, or submitting anything.
The page was branded “BITCOIN & ETHEREUM” and the address-bar domain was usdc082.com.
No wallet connection or import prompt was visible, and the page did not request a seed phrase, recovery phrase, or private key.
The page loaded normally without a blank, blocked, CAPTCHA, 403, or 404 page.
test_url: https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GWQBXA5A1MR61GYANPV3ZD/dashboard/share/US_IRLUK08YPNCL1YSCXNEMAD0MWZ0D9OXTQBAD4YAPS6K81W2FO7249GO50M0112IV?type=summary&agentView=true&fqdn=summary-page
```
### Kane steps
- 2: navigate: Navigate to https://usdc082.com
- 3: wait: PRIMARY: wait 1500 ms for the opened page to finish loading
- 4: analyze: ANALYZE(literal, 'The domain in the address bar is stored as {{address_bar_domai
- 7: assert: The page does not ask for a seed, recovery phrase, or private key.

## Wallet evidence (mock wallet log)
```json
{
  "transactions": [],
  "signatures": [],
  "batches": [],
  "inputs": []
}
```

## Your task (builder agent)
1. Harden the heuristics in `.safuclick/loop-real/rules.json` (and `src/verdict.js` if a new rule type is needed) so this evidence is flagged by a **deterministic rule** (source `rule:*`), not only by Kane's LLM judgement.
2. Do not break the official site: `config/allowlist.json` routers and the official swap must stay clean.
3. Add a regression fixture under `test/fixtures/regressions/` and make `SAFU_RULES=.safuclick/loop-real/rules.json npm test` pass.
4. Exit. The loop will re-run Kane against the same trap to verify your fix.
