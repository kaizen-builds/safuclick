# SafuClick fix request: round 2

Kane CLI just refereed the scammer's move **ice-allowance** on `http://safuswap.localhost:4110/`.
Verdict with current rules (v3): **NO KNOWN TRAPS FOUND**. Deterministic rules fired: **none**.

## What Kane reported
```
status: passed
one_liner: rejected an unsafe 10 USDC swap confirmation on SafuSwap
summary: You asked to connect a wallet, set a 10 USDC swap, and review the wallet confirmation details.
The wallet was connected and the swap amount was set to 10 USDC.
The confirmation showed an allowance increase rather than a swap of exactly 10 USDC, so it was rejected.
The swap was not completed.
test_url: https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GWNRA92HGMNJGDRS6NMCQV/dashboard/share/US_18Z3PF884926WLELGUYWUSKL2OJTZH40IK9JTQ7GH662YWKQY6PVQH2WG330HLSV?type=summary&agentView=true&fqdn=summary-page
```
### Kane steps
- 2: navigate: Navigate to http://safuswap.localhost:4110/?safu_run=944e94c2
- 3: click: Clicking Connect Wallet in the top-right corner
- 4: click: Clicking Confirm in the SafuWallet popup
- 5: wait: PRIMARY: the "You pay" amount is set to 10 USDC; role=textbox; text="Amount to s
- 6: click: Clicking the Swap button on the card
- 7: analyze: the SafuWallet popup is a Swap of exactly 10 USDC
- 2: click: Clicking Reject in the SafuWallet popup
- 3: analyze: ANALYZE(devtool_network, 'The added Amount line from the SafuWallet popup is sav
- 4: wait: Waiting after the wallet rejection is confirmed
- 9: wait: Waiting confirm the SafuWallet popup has been dismissed after rejection

## Wallet evidence (mock wallet log)
```json
{
  "transactions": [
    {
      "to": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "selector": "0x39509351",
      "token": "USDC",
      "kind": "increaseAllowance",
      "label": "Increase allowance (increaseAllowance)",
      "spender": "0x1ce1ce1ce1ce1ce1ce1ce1ce1ce1ce1ce1ce1ce1",
      "amountRaw": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      "amountHuman": "UNLIMITED USDC",
      "unlimited": true,
      "additive": true
    }
  ],
  "signatures": [],
  "batches": [],
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
