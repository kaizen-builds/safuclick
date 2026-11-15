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

export function realSiteObjective() {
  return [
    `You are a cautious security researcher reviewing a live webpage in a throwaway browser.`,
    `Safety rules: never type a recovery phrase, seed phrase, secret words, private key, password, email, or any personal data.`,
    `Never connect a wallet, never approve or sign a transaction, never install an extension, never download a file, and never submit a form that asks for secrets.`,
    `1) Open the page and wait for it to finish loading. Record the final URL if the site redirected.`,
    `2) Note the visible branding (for example Uniswap, MetaMask, Aave, Curve, OKX) and the domain in the address bar.`,
    `3) Inspect the page and any obvious modals for input fields that ask for a recovery phrase, seed phrase, secret words, or private key. If you find one, this check FAILS: quote the exact label or wording and do not type anything.`,
    `4) Note whether the page prompts you to Connect Wallet, import a wallet, or enter a seed to "verify" or "sync" a wallet. Do not click Connect.`,
    `5) If the page is blank, blocked, a captcha wall, or shows a 403/404, report that honestly and stop.`,
    `6) This check PASSES if the page does not ask for a seed, recovery phrase, or private key. Summarize branding, final URL, any Connect Wallet prompt, and any redirects.`,
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
