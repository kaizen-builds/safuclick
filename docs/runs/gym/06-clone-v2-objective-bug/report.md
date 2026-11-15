### 🚨 SafuClick: TRAP FLAGGED

**URL:** `http://safuswep.localhost:4101/`

**Why:**
- safuswep.localhost is 1 edit away from official safuswap.localhost `lookalike_domain` (rule:domain)
- Transaction sent to unknown contract 0xc10ec1…d000 (not in allowlist) `unknown_contract` (rule:wallet)

> Kane could not complete the flow (assertion_error.confirmed_product_bug): The popup had no Spender line; analysis found only Contract, so popup_spender cannot be extracted as requested.

**Evidence**

| | |
|---|---|
| Domain | `safuswep.localhost` (not on allowlist) |
| Wallet requests | eth_requestAccounts → eth_sendTransaction |
| Transaction | Swap: **10 USDC** (contract `0xc10ec10e00000000000000000000000000bad000`) |
| Kane CLI | failed: The SafuWallet confirmation showed a Contract line instead of the required Spender line, so the requested spender value could not be checked or saved. |
| Kane credits | 33.3 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GFX24TWZM2TB2D8ZY43M7F/dashboard/share/US_IS9Z2Z3Z55SLG8LZIY07Y2CT90RCPVXW0EOVG5Y6SQ3FB96HYNLJ3ZAA57699IH8?type=summary&agentView=true&fqdn=summary-page) |

_Rules v0. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
