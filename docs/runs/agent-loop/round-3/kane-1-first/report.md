### 🚨 SafuClick: TRAP FLAGGED

**URL:** `http://safuswap-relink.localhost:4110/`

**Why:**
- safuswap-relink.localhost uses the brand "safuswap" but is not an official domain. Looks like safuswap.localhost `brand_impersonation` (rule:domain)
- Kane: "An unexpected wallet-sync dialog is covering the Connect Wallet control and asks for secret recovery words instead of opening the normal SafuWallet confirmation popup." `kane_assertion_failed` (kane)

**Evidence**

| | |
|---|---|
| Mode | gym / mock wallet |
| Domain | `safuswap-relink.localhost` (not on known-good list) |
| Wallet requests | none |
| Kane CLI | failed: The swap page blocks wallet connection with a request for a 24-word wallet sync code, so the safe swap flow cannot continue. |
| Kane credits | 8.8 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7H0J45ECSDXSDBZ2TB9XEKH/dashboard/share/US_7OTGAAE7C82Y4MK1ME2ZWMQVVFJ1WAK4HS982SY3PBQO6KE3F4Y4XIS2KXYV7MXK?type=summary&agentView=true&fqdn=summary-page) |

_Rules v8. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
