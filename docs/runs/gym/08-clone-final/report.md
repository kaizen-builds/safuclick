### 🚨 SafuClick: TRAP FLAGGED

**URL:** `http://safuswep.localhost:4101/`

**Why:**
- safuswep.localhost is 1 edit away from official safuswap.localhost `lookalike_domain` (rule:domain)
- Transaction sent to unknown contract 0xc10ec1…d000 (not in allowlist) `unknown_contract` (rule:wallet)

**Evidence**

| | |
|---|---|
| Domain | `safuswep.localhost` (not on allowlist) |
| Wallet requests | eth_requestAccounts → eth_sendTransaction |
| Transaction | Swap: **10 USDC** (contract `0xc10ec10e00000000000000000000000000bad000`) |
| Kane CLI | passed: completed a 10 USDC swap on SafuSWEp |
| Kane credits | 35.9 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GG38W2E3TVKPSAXRSGDG5M/dashboard/share/US_MG0PQC7NPK1FC5NV989FEWN46QICJ3UQIA2AHXZG5QCF395CGZPAKJZWQ2BT449F?type=summary&agentView=true&fqdn=summary-page) |

_Rules v0. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
