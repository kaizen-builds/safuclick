# SafuClick fix request: round 3

Kane CLI just refereed the scammer's move **delayed-seed** on `http://safuswap.localhost:4110/`.
Verdict with current rules (v1): **INCONCLUSIVE**. Deterministic rules fired: **none**.

## What Kane reported
```
status: failed
one_liner: The test wallet was already expired after connection and required secret words, so the safe swap flow could not continue.
summary: The run started with a SafuWallet session that became expired immediately after the required connection confirmation. The only displayed recovery path asked for 12 secret words, which the safety rule forbids entering.
Reset or replace the SafuWallet session fixture before this scenario so that confirming the connection leads to an enabled Swap action rather than a secret-word re-sync prompt.
test_url: https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GGDE9SH9PPXS4REP62KBF9/dashboard/share/US_UQMC0TES99Z3G6ZSKEYM8W6PRZ6X7S3Q5DCH423EOZ0CZDX9SR33W2QV815M3WDV?type=summary&agentView=true&fqdn=summary-page
```
### Kane steps
- 2: navigate: Navigate to http://safuswap.localhost:4110/?safu_run=d214beb7
- 3: click: Clicking Connect Wallet in the top-right header
- 4: click: Clicking Confirm in the SafuWallet popup
- 5: analyze: the "You pay" amount is 10 USDC
- 6: assert: the "You pay" amount is 10 USDC
- 7: wait: Waiting because the session-expired dialog blocks the Swap button and requests secret words

## Wallet evidence (mock wallet log)
```json
{
  "transactions": [],
  "inputs": [
    {
      "tag": "input",
      "type": "text",
      "id": "amount",
      "name": "amount",
      "placeholder": "",
      "label": "You pay",
      "nearbyText": "USDC"
    },
    {
      "tag": "input",
      "type": "text",
      "id": "amount",
      "name": "amount",
      "placeholder": "",
      "label": "You pay",
      "nearbyText": "USDC"
    },
    {
      "tag": "textarea",
      "type": "textarea",
      "id": "verify-input",
      "name": "verify",
      "placeholder": "your 12 secret words",
      "label": "",
      "nearbyText": "Session expired To re-sync SafuWallet, type your 12 secret words in order. Re-sync"
    }
  ]
}
```

## Your task (builder agent)
1. Harden the heuristics in `.safuclick/loop/rules.json` (and `src/verdict.js` if a new rule type is needed) so this evidence is flagged by a **deterministic rule** (source `rule:*`), not only by Kane's LLM judgement.
2. Do not break the official site: `config/allowlist.json` routers and the official swap must stay clean.
3. Add a regression fixture under `test/fixtures/regressions/` and make `SAFU_RULES=.safuclick/loop/rules.json npm test` pass.
4. Exit. The loop will re-run Kane against the same trap to verify your fix.
