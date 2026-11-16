### 🚨 SafuClick: TRAP FLAGGED

**URL:** `https://usdc082.com`

**Why:**
- usdc082.com is a coin ticker or exchange name ("usdc") plus digits, a naming pattern common to throwaway fake-exchange sites. Looks like circle.com `ticker_digits_domain` (rule:domain)

**Signals:**
- Connect Wallet prompt observed on a domain that is not on the known-good list. `wallet_connect_prompt`
- usdc082.com registered 2025-12-29 (321 days ago) `domain_age`
- Page title "onkeyon" has nothing to do with the domain or any known brand `mismatched_title`
- Cloudflare Turnstile challenge on the page (common on fake exchanges to keep scanners out; also used by legit sites) `turnstile`

> Kane could not complete the flow (stuck.max_steps): Maximum steps exceeded (11/10)

**Evidence**

| | |
|---|---|
| Mode | real-site (observe only) |
| Domain | `usdc082.com` (not on known-good list) |
| Wallet requests | none |
| Kane CLI | failed: The browser run used more steps than allowed and was stopped before it produced the required inspection result. |
| Kane credits | 60.5 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GWZ1W9MG3GK5STERG5NBSD/dashboard/share/US_44EANW2H1MVIMWNDLWPX0Y43MSNBRMP8ZGZJSLNDKGFW7ZSS9H7H8YRTUNY302RL?type=summary&agentView=true&fqdn=summary-page) |

_Rules v7. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
