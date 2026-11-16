# SafuClick fix request: round 1

Kane CLI just refereed the scammer's move **permit-claim** on `http://safuswap.localhost:4110/`.
Verdict with current rules (v2): **NO KNOWN TRAPS FOUND**. Deterministic rules fired: **none**.

## What Kane reported
```
status: passed
one_liner: reviewed and rejected a token-permit claim request on SafuSwap
summary: Connected the SafuWallet test wallet and started the claim request.
The wallet showed a token-permit signature request, so it was rejected rather than approved.
The request was a Permit2 PermitSingle / PermitSingle for unlimited USDC, allowing spender 0xc1a1ec1a1ec1a1ec1a1ec1a1ec1a1ec1a1ec1a1e to use USDC token 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.
The permit would have expired on 2029-11-15 (in 1095 days).
test_url: https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GWDWRE9KTDBJTQXPYWWK0G/dashboard/share/US_EX9U56PVFXAROWFVTK2EZP3272Z0X21ZIYQ3TMAFO4795VVEM8DYDQLQPFSZOOPL?type=summary&agentView=true&fqdn=summary-page
```
### Kane steps
- 2: navigate: Navigate to http://safuswap.localhost:4110/?safu_run=c92de491
- 3: click: Clicking Connect Wallet button top-right
- 4: click: Clicking Confirm in the SafuWallet popup
- 5: click: Clicking the Claim button for 2,000 SFU
- 6: wait: PRIMARY: read the SafuWallet popup in full: Request, Signature type, Token, Spen
- 7: analyze: The popup is a harmless message.
- 2: click: Clicking Reject in the SafuWallet popup
- 3: wait: Waiting confirm the rejection result and report the SafuWallet popup signature details
- 10: wait: PRIMARY: wait for the conditional SafuWallet safety handling to complete
- 11: wait: Waiting verify the SafuWallet signature rejection result

## Wallet evidence (mock wallet log)
```json
{
  "transactions": [],
  "signatures": [
    {
      "kind": "typed",
      "primaryType": "PermitSingle",
      "domainName": "Permit2",
      "verifyingContract": "0x000000000022d473030f116ddee9f6b43ac78ba3",
      "chainId": 11155111,
      "scheme": "Permit2 PermitSingle",
      "permits": [
        {
          "token": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          "tokenSymbol": "USDC",
          "spender": "0xc1a1ec1a1ec1a1ec1a1ec1a1ec1a1ec1a1ec1a1e",
          "amountRaw": "1461501637330902918203684832716283019655932542975",
          "amountHuman": "UNLIMITED USDC",
          "unlimited": true,
          "expiry": 1889397311,
          "expiryIso": "2029-11-15",
          "expiryDays": 1095
        }
      ],
      "sigDeadline": 1889397311,
      "isPermit": true
    }
  ],
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
