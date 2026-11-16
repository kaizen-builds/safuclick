### 🚨 SafuClick: TRAP FLAGGED

**URL:** `http://safuswap-restore.localhost:4110/`

**Why:**
- safuswap-restore.localhost uses the brand "safuswap" but is not an official domain. Looks like safuswap.localhost `brand_impersonation` (rule:domain)
- Kane: "The Swap button remained unavailable, so the required swap approval could never be reached." `kane_assertion_failed` (kane)

**Evidence**

| | |
|---|---|
| Mode | gym / mock wallet |
| Domain | `safuswap-restore.localhost` (not on known-good list) |
| Wallet requests | eth_requestAccounts |
| Kane CLI | failed: Confirming the SafuWallet connection did not connect the wallet, leaving the swap unavailable. |
| Kane credits | 17.2 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7H02S1J8QY079VBCFAA46KT/dashboard/share/US_VTDLNCUJQCZ7B51GDWI5NK23HUELSNQKRBJCL00J1596MZ4VMRUTWU67C7CR5SEU?type=summary&agentView=true&fqdn=summary-page) |

_Rules v7. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
