# SafuClick fix request: round 2

Kane CLI just refereed the scammer's move **poisoned-approve** on `http://safuswap.localhost:4110/`.
Verdict with current rules (v0): **TRAP FLAGGED**. Deterministic rules fired: **none**.

## What Kane reported
```
status: failed
one_liner: The run stopped on the popup check instead of following the required mismatch path and rejecting the unsafe request.
summary: The SafuWallet request did not match the requested 10 USDC swap: it asked to approve token spending for 5,000,000 USDC. The automation treated that expected safety-check outcome as a terminal assertion, rather than taking the instructed next step to reject it and record the mismatch.
Change the checkpoint into conditional logic: when the popup is not Action “Swap” with Amount “10 USDC,” capture its details, click Reject, and report the mismatch rather than raising a terminal assertion immediately.
test_url: https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GG97KZZSBQ2XGVQK4THC1S/dashboard/share/US_T9ZMITPYTW4LFP4G804JV55KMU7EWU9MUV1VCMAV5GTBY22FFXCDS0Y5ZH5WO7A6?type=summary&agentView=true&fqdn=summary-page
```
### Kane steps
- 2: navigate: Navigate to http://safuswap.localhost:4110/?safu_run=15aae9b8
- 3: click: Clicking Connect Wallet in the top-right corner
- 4: click: Clicking Confirm in the SafuWallet popup
- 5: click: Clicking the Swap button beneath the You pay amount
- 6: analyze: ANALYZE(textual_visual, 'the popup Action, Spender and Amount lines are saved as

## Wallet evidence (mock wallet log)
```json
{
  "transactions": [
    {
      "kind": "approve",
      "label": "Approve token spending",
      "to": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "token": "USDC",
      "spender": "0x5afe9d1b7c3e2a4f6b8d0e1c3a5f7b9d1ec0ffee",
      "amountRaw": "5000000000000",
      "amountHuman": "5,000,000 USDC",
      "unlimited": false
    }
  ],
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
    }
  ]
}
```

## Your task (builder agent)
1. Harden the heuristics in `.safuclick/loop/rules.json` (and `src/verdict.js` if a new rule type is needed) so this evidence is flagged by a **deterministic rule** (source `rule:*`), not only by Kane's LLM judgement.
2. Do not break the official site: `config/allowlist.json` routers and the official swap must stay clean.
3. Add a regression fixture under `test/fixtures/regressions/` and make `SAFU_RULES=.safuclick/loop/rules.json npm test` pass.
4. Exit. The loop will re-run Kane against the same trap to verify your fix.
