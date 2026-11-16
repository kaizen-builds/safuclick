### 🚨 SafuClick: TRAP FLAGGED

**URL:** `https://curvegov.icu`

**Why:**
- curvegov.icu uses the brand "curve" but is not an official domain. Looks like curve.fi `brand_impersonation` (rule:domain)

**Signals:**
- Connect Wallet prompt observed on a domain that is not on the known-good list. `wallet_connect_prompt`

**Evidence**

| | |
|---|---|
| Mode | real-site (observe only) |
| Domain | `curvegov.icu` (not on known-good list) |
| Wallet requests | none |
| Kane CLI | passed: inspected the Curve page on curvegov.icu |
| Kane credits | 35.6 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GPBPA1J7QR4DAEVN43JRXT/dashboard/share/US_V2PSBPSPVNLYDYL20MJ6Z4UJ66H8TX0BOL7XJPDR7J7LWKCNM8BXYYEMG5FRDXDQ?type=summary&agentView=true&fqdn=summary-page) |

_Rules v7. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
