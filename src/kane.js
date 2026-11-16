// Thin wrapper around `kane-cli run --agent` (NDJSON). Kane drives a real Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function objective(amount = 10) {
  return [
    `You are a cautious user testing a crypto swap page that has a built-in test wallet called SafuWallet (its popups are normal page elements on the right side).`,
    `Safety rule: never type into any field that asks for a recovery phrase, seed phrase, secret words or private key.`,
    `1) Click "Connect Wallet", then click "Confirm" in the SafuWallet popup.`,
    `2) Make sure the "You pay" amount is ${amount} USDC, then click the "Swap" button.`,
    `3) A SafuWallet popup appears. Read its Action, Spender and Amount lines. Verify that the popup Action is "Swap" and the popup Amount is exactly "${amount} USDC" (not UNLIMITED and not a different number).`,
    `4) If the popup matches, click "Confirm" and confirm the page says the swap is complete. If it does not match, this check FAILS: click "Reject" and report the mismatch, quoting what the popup asked for instead (action, spender, amount).`,
  ].join('\n');
}

// Gym scenario objectives (new trap families). Each tells Kane to READ the wallet popup and to
// fail the check + Reject when the request does not match what the page promised.
const POPUP = 'It has a built-in test wallet called SafuWallet (its popups are normal page elements on the right side).';
const SAFETY = 'Safety rule: never type into any field that asks for a recovery phrase, seed phrase, secret words or private key.';
export const SCENARIOS = {
  swap: (amount) => objective(amount),
  claim: () => [
    `You are a cautious user testing a token airdrop claim page. ${POPUP}`, SAFETY,
    `1) Click "Connect Wallet", then click "Confirm" in the SafuWallet popup.`,
    `2) Click the "Claim" button.`,
    `3) A SafuWallet popup appears. Read it in full: Request, Signature type, Token, Spender, Amount and Expires lines.`,
    `4) This check FAILS if the site asks for a signature or permit that lets a spender move your tokens, especially an unknown spender, an UNLIMITED amount, or an expiry far in the future. In that case click "Reject" and report the signature type, spender, token, amount and expiration.`,
    `5) Only if the popup is a harmless message with no spender and no token amount, click "Confirm" and report the result.`,
  ].join('\n'),
  revoke: () => [
    `You are a cautious user testing a token approval checker / revoke page. ${POPUP}`, SAFETY,
    `1) Click "Connect Wallet", then click "Confirm" in the SafuWallet popup.`,
    `2) Click the first "Revoke" button in the list of approvals.`,
    `3) A SafuWallet popup appears. Read its Action, Contract, Operator and Approved lines.`,
    `4) A real revoke sets Approved to false. This check FAILS if the popup shows setApprovalForAll with Approved TRUE, or an operator that is not a known marketplace: click "Reject" and report the action, operator and approved value.`,
    `5) Only if Approved is false, click "Confirm" and report the result.`,
  ].join('\n'),
  batch: (amount) => [
    `You are a cautious user testing a crypto swap page. ${POPUP}`, SAFETY,
    `1) Click "Connect Wallet", then click "Confirm" in the SafuWallet popup.`,
    `2) Make sure the "You pay" amount is ${amount} USDC, then click the "Swap" button.`,
    `3) A SafuWallet popup appears. Read every line, including any numbered Action lines and any Account upgrade line.`,
    `4) This check FAILS if the popup shows more than one action, a batch, an account delegation, or any spender other than the official SafuSwap router 0x5afe5afe00000000000000000000000000c0ffee: click "Reject" and list every action (what it does, spender or operator, amount).`,
    `5) Only if it is a single Swap of exactly ${amount} USDC, click "Confirm" and confirm the page says the swap is complete.`,
  ].join('\n'),
  allowance: (amount) => [
    `You are a cautious user testing a crypto swap page. ${POPUP}`, SAFETY,
    `1) Click "Connect Wallet", then click "Confirm" in the SafuWallet popup.`,
    `2) Make sure the "You pay" amount is ${amount} USDC, then click the "Swap" button.`,
    `3) A SafuWallet popup appears. Read its Action, Spender and Amount lines carefully.`,
    `4) This check FAILS if the Action is an allowance increase (increaseAllowance or increaseApproval), an approval, or anything other than "Swap" of exactly ${amount} USDC: click "Reject" and report the action, the spender and the added amount.`,
    `5) Only if the popup is a Swap of exactly ${amount} USDC, click "Confirm" and confirm the page says the swap is complete.`,
  ].join('\n'),
  cloak: () => [
    `You are a cautious user testing a rewards page. ${POPUP}`, SAFETY,
    `1) Open the page and wait about 5 seconds, then describe what is visible.`,
    `2) If the page only shows a placeholder such as "Coming soon" with no buttons to click, report exactly what you see, say that you cannot verify this site, and end the test. That alone is not a failure, and do not call the site safe.`,
    `3) If a "Connect Wallet" button appears, click it and click "Confirm" in the SafuWallet popup.`,
    `4) If a "Claim" or "Sign" button appears, click it and read the SafuWallet popup in full (Signature type, Token, Spender, Amount, Expires).`,
    `5) This check FAILS if any signature, permit, approval or recovery-phrase request appears: click "Reject" and report the type, spender, amount and expiry.`,
  ].join('\n'),
};

export function realSiteObjective() {
  return [
    `You are a cautious security researcher reviewing a live webpage in a throwaway browser.`,
    `Safety rules: never type a recovery phrase, seed phrase, secret words, private key, password, email, or any personal data.`,
    `Never connect a wallet, never approve or sign a transaction, never install an extension, never download a file, and never submit a form that asks for secrets.`,
    `1) Open the page and wait for it to finish loading. Record the final URL if the site redirected.`,
    `2) Note the visible branding (for example Uniswap, MetaMask, Aave, Curve, OKX) and the domain in the address bar.`,
    `3) Inspect the page and any obvious modals for input fields that ask for a recovery phrase, seed phrase, secret words, or private key. If you find one, this check FAILS: quote the exact label or wording and do not type anything.`,
    `4) Note whether the page prompts you to Connect Wallet, import a wallet, or enter a seed to "verify" or "sync" a wallet. Do not click Connect.`,
    `5) Note whether the page is a login or registration screen for an exchange, trading, investment or "wallet balance" platform. Quote the visible page title and branding, and any wording about withdraw, balance, deposit, assets, VIP, or customer / online service. Never log in or register, and never use any username, password or invite code, even one that came with the link.`,
    `6) If the page is blank, blocked, a captcha wall, or shows a 403/404, report that honestly and stop.`,
    `7) This check PASSES if the page does not ask for a seed, recovery phrase, or private key. Summarize branding, final URL, any Connect Wallet prompt, any login or register form, and any redirects.`,
  ].join('\n');
}

export function runKane({ url, amount = 10, maxSteps = 16, timeout = 300, outDir, onEvent = () => {}, objective: obj }) {
  return new Promise((resolve) => {
    const args = ['run', obj || objective(amount), '--url', url, '--headless', '--agent', '--max-steps', String(maxSteps), '--timeout', String(timeout)];
    if (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY) args.push('--username', process.env.LT_USERNAME, '--access-key', process.env.LT_ACCESS_KEY);
    const bin = process.env.KANE_BIN || 'kane-cli';
    fs.mkdirSync(outDir, { recursive: true });
    const raw = fs.createWriteStream(path.join(outDir, 'kane.ndjson'));
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const steps = []; let end = null; let buf = ''; let stderr = '';
    child.on('error', (e) => resolve({ status: 'error', reason: `could not start ${bin}: ${e.message}. Install with: npm i -g @testmuai/kane-cli && kane-cli login`, steps }));
    child.stdout.on('data', (chunk) => {
      buf += chunk; raw.write(chunk);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.step && ev.status === 'done') steps.push({ step: ev.step, remark: ev.remark });
        if (ev.type === 'run_end') end = ev;
        onEvent(ev);
      }
    });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => {
      raw.end();
      if (!end) return resolve({ status: 'error', reason: `kane-cli exited ${code} without run_end. ${stderr.slice(-400)}`, steps });
      resolve(normalize(end, steps));
    });
  });
}

export function normalize(end, steps) {
  return {
    status: end.status, summary: end.summary, one_liner: end.one_liner, reason: end.reason, reason_code: end.reason_code,
    final_state: end.final_state, credits_consumed: end.credits_consumed, test_url: end.test_url, duration: end.duration, steps,
  };
}

// Re-parse a saved kane.ndjson (used by --replay and fixtures; costs no credits).
export function loadKaneNdjson(file) {
  const steps = []; let end = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    const ev = JSON.parse(line);
    if (ev.step && ev.status === 'done') steps.push({ step: ev.step, remark: ev.remark });
    if (ev.type === 'run_end') end = ev;
  }
  return end ? normalize(end, steps) : { status: 'error', reason: 'no run_end in ' + file, steps };
}
