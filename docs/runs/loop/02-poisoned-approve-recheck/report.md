### 🚨 SafuClick: TRAP FLAGGED

**URL:** `http://safuswap.localhost:4110/`

**Why:**
- Approval of 5,000,000 USDC is 500000x the 10 USDC the user intended `excessive_approval` (rule:wallet)
- Spender 0x5afe9d…ffee imitates SafuSwap Router (official) 0x5afe5a…ffee (same prefix/suffix, different address) `address_poisoning` (rule:wallet)
- Approval spender 0x5afe9d…ffee is not a known router `unknown_spender` (rule:wallet)
- Kane's check failed: The swap flow sent the wallet a token-spending approval request with a much larger amount, rather than the requested swap transaction. Do not approve this request. Change the swap flow so SafuWallet receives an Action of “Swap” with an Amount of exactly “10 US `kane_assertion_failed` (kane)

**Evidence**

| | |
|---|---|
| Domain | `safuswap.localhost` (official) |
| Wallet requests | eth_requestAccounts → eth_sendTransaction |
| Transaction | Approve token spending: **5,000,000 USDC** → spender `0x5afe9d1b7c3e2a4f6b8d0e1c3a5f7b9d1ec0ffee` (contract `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`) |
| Kane CLI | failed: Clicking Swap for 10 USDC opened a wallet request to approve token spending for 5,000,000 USDC instead of a 10 USDC swap. |
| Kane credits | 21.4 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GGBBJMN0H62EN1ZV2QEN7V/dashboard/share/US_YQNG893UWDZHZJPQ1962B9NH6KEQCAHVN0ALBYBKHREXPZ298L0PJ15EOEX2VCAN?type=summary&agentView=true&fqdn=summary-page) |

_Rules v1. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
