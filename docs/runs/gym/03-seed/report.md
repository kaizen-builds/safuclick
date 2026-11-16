### 🚨 SafuClick: TRAP FLAGGED

**URL:** `http://safuswap-verify.localhost:4102/`

**Why:**
- safuswap-verify.localhost uses the brand "safuswap" but is not an official domain. Looks like safuswap.localhost `brand_impersonation` (rule:domain)
- Page shows a field asking for secrets: " word1 word2 word3 ... Wallet verification required Enter your 12-word recovery phrase to verify your wallet and continu" `seed_phrase_prompt` (rule:dom)
- Kane: "The page presented a request for wallet recovery credentials before the user could proceed with the intended wallet connection and swap." `kane_assertion_failed` (kane)

**Evidence**

| | |
|---|---|
| Mode | gym / mock wallet |
| Domain | `safuswap-verify.localhost` (not on known-good list) |
| Wallet requests | none |
| Kane CLI | failed: The swap page showed a wallet-verification dialog asking for secret recovery words instead of allowing the normal SafuWallet connection flow. |
| Kane credits | 16.6 |
| Kane report | [open](https://test-manager.lambdatest.com/projects/01M7GDZEFJNXFZYH5GE7SH5EMF/test-cases/01M7GFMCG0KKJRABKZQKMZ1547/dashboard/share/US_E4GGAZASBQRGW7D5M2TGTUT3XK3V8TS0CURY5AOZ2O179MQ9D57YGOCVW0TEGOQH?type=summary&agentView=true&fqdn=summary-page) |

_Rules v7. Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets. SafuClick, powered by Kane CLI._
