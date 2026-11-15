### ❔ SafuClick: INCONCLUSIVE

**URL:** `http://safuswap.localhost:4100/`

> Kane could not complete the flow (assertion_error.confirmed_product_bug): The popup has Contract rather than the required Spender line, so the required checkpoint cannot pass.

**Evidence**

| | |
|---|---|
| Domain | `safuswap.localhost` (official) |
| Wallet requests | eth_requestAccounts → eth_sendTransaction |
| Transaction | Swap: **10 USDC** (contract `0x5afe5afe00000000000000000000000000c0ffee`) |
| Kane CLI | failed: The SafuWallet swap confirmation shows a Contract field instead of the required Spender field, so the safety check cannot be completed. |
| Kane credits | 25.3 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GFTJZQ0HMKFSVGY3FVPVQC/dashboard/share/US_Z5U9OB4H8E2IF9QJ74H2TGAHBDH35T5GB5YGSJONK9AGL7JNOSN0QA04J9JR4N41?type=summary&agentView=true&fqdn=summary-page) |

_Rules v0. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
