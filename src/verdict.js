// Combines Kane's run, the mock-wallet evidence log and the domain check into a verdict.
// Pure function: (evidence, rules, allowlist) -> verdict. Fixture-testable without Kane.
import { checkDomain } from './domain.js';

const MAX = (1n << 256n) - 1n;
const INCREASE = ['increaseAllowance', 'increaseApproval'];
const rx = (s) => new RegExp(s.startsWith('\\') || /[()[\]|?+*]/.test(s) ? s : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const short = (a) => (a ? a.slice(0, 8) + '…' + a.slice(-4) : '?');

function looksLike(addr, known) {
  addr = addr.toLowerCase(); known = known.toLowerCase();
  return addr !== known && addr.slice(2, 6) === known.slice(2, 6) && addr.slice(-4) === known.slice(-4);
}

export function kaneText(kane) {
  if (!kane) return '';
  return [kane.summary, kane.one_liner, kane.reason, JSON.stringify(kane.final_state || {}),
    ...(kane.steps || []).map((s) => s.remark)].filter(Boolean).join('\n');
}

export function evaluate({ url, intendedAmount = 10, kane, walletLog = [], probe, mode = 'gym' }, rules, allowlist) {
  const reasons = [];
  const signals = [];
  const add = (id, source, detail, evidence) => reasons.push({ id, source, detail, evidence });
  const note = (id, source, detail) => signals.push({ id, source, detail });
  const known = Object.fromEntries(Object.entries(allowlist.contracts).map(([k, v]) => [k.toLowerCase(), v]));
  const knownSpenders = Object.fromEntries(Object.entries(allowlist.spenders).map(([k, v]) => [k.toLowerCase(), v]));
  const knownOperators = Object.fromEntries(Object.entries(allowlist.operators || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const knownDelegators = Object.fromEntries(Object.entries(allowlist.delegators || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const pageText = walletLog.filter((e) => e.type === 'page_loaded' || e.type === 'page_snapshot').map((e) => [e.title, e.text].join(' ')).join(' ');
  const claimsRevoke = (rules.nft?.revokeWords || []).some((w) => new RegExp(w, 'i').test(pageText));
  const seedRx = (rules.seed?.patterns || []).map(rx);
  const real = rules.realSite || {};
  // Avoid "No seed phrase fields" style false positives when Kane reports a clean page.
  const negatedSecret = (text) => /\b(no|not|without|never|doesn't|does not|didn't|did not|none)\b[\s\S]{0,50}(seed|recovery|mnemonic|secret words|private key)|\b(seed|recovery|mnemonic|secret words|private key)[\s\S]{0,40}\b(not (found|present|visible|shown|asked)|absent|fields)\b/i.test(text);

  // 1. Domain (pasted URL, plus the post-redirect host in real-site mode)
  const dom = checkDomain(url, allowlist, rules);
  for (const f of dom.findings) add(f.id, 'rule:domain', f.detail, { resembles: f.resembles || null });
  let dest = null;
  if (probe?.finalUrl) {
    try {
      const startHost = new URL(url).hostname.toLowerCase();
      const endHost = new URL(probe.finalUrl).hostname.toLowerCase();
      if (endHost !== startHost) {
        dest = checkDomain(probe.finalUrl, allowlist, rules);
        for (const f of dest.findings) add(f.id, 'rule:domain', `After redirect: ${f.detail}`, { resembles: f.resembles || null });
        const bothOfficial = dom.official && dest.official;
        const hops = (probe.hops || []).length;
        if (!bothOfficial && real.flagSuspiciousRedirect !== false && (dest.findings.length || hops > 1)) {
          add('suspicious_redirect', 'rule:redirect',
            `Redirected from ${startHost} to ${endHost}` + (dest.findings[0] ? ` (${dest.findings[0].detail})` : ''),
            { from: url, to: probe.finalUrl, hops: probe.hops });
        } else {
          note('redirect', 'rule:redirect', `Redirected from ${startHost} to ${endHost}`);
        }
      }
    } catch { /* ignore invalid finalUrl */ }
  }

  // 2. Wallet transactions (the part a visual check can't see) — gym / mock wallet only
  const txs = walletLog.filter((e) => e.type === 'tx_decoded').map((e) => e.decoded);
  const intendedRaw = BigInt(Math.round(intendedAmount * 1e6));
  for (const d of txs) {
    if (rules.contracts.requireKnownContract && !known[d.to])
      add('unknown_contract', 'rule:wallet', `Transaction sent to unknown contract ${short(d.to)} (not in allowlist)`, d);
    const increase = INCREASE.includes(d.kind);
    if (increase && rules.approval.includeIncrease)
      add('increase_allowance', 'rule:wallet', `Page called ${d.kind}(${short(d.spender)}, ${d.amountHuman}) while the UI said "swap ${intendedAmount} USDC". It ADDS to any existing allowance and dodges approve-only checks (ice phishing)`, d);
    if (d.kind === 'approve' || (increase && rules.approval.includeIncrease)) {
      const amt = BigInt(d.amountRaw);
      const verb = increase ? 'allowance increase' : 'approval';
      if (rules.approval.flagMaxUint && (amt === MAX || d.unlimited))
        add('unlimited_approval', 'rule:wallet', `Page asked the wallet for UNLIMITED ${d.token} ${verb} to ${short(d.spender)} while the UI said "swap ${intendedAmount} USDC"`, d);
      else if (rules.approval.maxAllowanceRatio && amt > intendedRaw * BigInt(rules.approval.maxAllowanceRatio))
        add('excessive_approval', 'rule:wallet', `${increase ? 'Allowance increase' : 'Approval'} of ${d.amountHuman} is ${amt / (intendedRaw || 1n)}x the ${intendedAmount} USDC the user intended`, d);
      if (rules.approval.flagAddressPoisoning) {
        const twin = Object.keys(knownSpenders).find((k) => looksLike(d.spender, k));
        if (twin) add('address_poisoning', 'rule:wallet', `Spender ${short(d.spender)} imitates ${knownSpenders[twin]} ${short(twin)} (same prefix/suffix, different address)`, d);
      }
      if (rules.approval.requireKnownSpender && !knownSpenders[d.spender])
        add('unknown_spender', 'rule:wallet', `Approval spender ${short(d.spender)} is not a known router`, d);
    }
    if (d.kind === 'setApprovalForAll' && rules.nft?.flagApprovalForAll && d.approved && !knownOperators[d.operator]) {
      add('nft_approval_for_all', 'rule:wallet', `setApprovalForAll(${short(d.operator)}, TRUE) on ${d.collection}: the operator could move EVERY NFT in that collection`, d);
      if (claimsRevoke) add('fake_revoke', 'rule:wallet', `Page says "Revoke" but the wallet call GRANTS access (approved = true). A real revoke sends approved = false`, d);
    }
  }

  // 2b. Off-chain signatures (eth_signTypedData_v4): Permit / Permit2 "sign to claim", eth_sign.
  const S = rules.signatures;
  const sigEntries = walletLog.filter((e) => e.type === 'sig_decoded');
  const sigs = sigEntries.map((e) => e.decoded);
  if (S?.decodeTypedData) {
    for (const e of sigEntries) {
      const s = e.decoded;
      const at = e.ts ? Date.parse(e.ts) / 1000 : Date.now() / 1000;
      if (s.kind === 'eth_sign') { if (S.flagEthSign) add('blind_signature', 'rule:signature', 'Page asked for eth_sign: a blind signature over an unreadable hash', s); continue; }
      for (const pm of s.permits || []) {
        const unknown = S.flagUnknownSpender && !knownSpenders[pm.spender];
        const big = S.flagLargeAmount && (pm.unlimited || BigInt(pm.amountRaw || 0) > intendedRaw * BigInt(rules.approval.maxAllowanceRatio || 10));
        const days = pm.expiry ? Math.round((pm.expiry - at) / 86400) : null;
        const long = S.maxDeadlineDays != null && (days == null || days > S.maxDeadlineDays);
        if (!(unknown || big || long)) continue;
        const why = [unknown && 'unknown spender', big && (pm.unlimited ? 'UNLIMITED amount' : 'amount far above the swap'), long && (days == null ? 'no expiry' : `valid ${days} days`)].filter(Boolean).join(', ');
        add('permit_signature', 'rule:signature', `Gas-free ${s.scheme} signature would let ${short(pm.spender)} move ${pm.amountHuman}${pm.expiryIso ? ' until ' + pm.expiryIso : ''} (${why}). No transaction needed: one signature is enough to drain`, { scheme: s.scheme, primaryType: s.primaryType, verifyingContract: s.verifyingContract, ...pm });
      }
    }
  }

  // 2c. Batched calls (EIP-5792 wallet_sendCalls) and EIP-7702 delegation.
  const B = rules.batch;
  const batches = walletLog.filter((e) => e.type === 'batch_decoded').map((e) => e.decoded);
  const auths = walletLog.filter((e) => e.type === 'auth_decoded').map((e) => e.decoded);
  if (B) {
    for (const b of batches) {
      const calls = b.calls || [];
      const risky = calls.filter((c) => ((c.kind === 'approve' || INCREASE.includes(c.kind)) && (!knownSpenders[c.spender] || c.unlimited))
        || (c.kind === 'setApprovalForAll' && c.approved && !knownOperators[c.operator])
        || ((c.kind === 'transfer' || c.kind === 'transferFrom') && !knownSpenders[c.recipient]));
      if (B.flagMultiCallForSingleAction && calls.length > 1)
        add('hidden_batch', 'rule:batch', `One confirm bundled ${calls.length} actions while the UI said "swap ${intendedAmount} USDC": ${calls.map((c) => c.kind).join(' + ')}`, { callCount: calls.length, kinds: calls.map((c) => c.kind) });
      if (B.flagBulkApprovals && risky.length)
        add('batch_hidden_approvals', 'rule:batch', `${risky.length} hidden grant(s) inside the batch: ${risky.map((c) => `${c.kind} ${c.amountHuman} to ${short(c.spender)}`).join('; ')}`, { calls: risky });
      if (b.delegation) {
        if (B.flagUnknownDelegator && !knownDelegators[b.delegation.delegator])
          add('unknown_delegator', 'rule:batch', `Batch upgrades the account via EIP-7702 to an unknown delegator ${short(b.delegation.delegator)}`, b.delegation);
        else note('eip7702_delegation', 'rule:batch', `Batch runs through ${knownDelegators[b.delegation.delegator] || 'an EIP-7702 delegator'}. A known delegator does not make the batch contents safe.`);
      }
    }
    for (const a of auths) {
      if (B.flagUnknownDelegator && !knownDelegators[a.delegator])
        add('unknown_delegator', 'rule:batch', `Page asked for an EIP-7702 authorization delegating the account to unknown contract ${short(a.delegator)}`, a);
    }
  }

  // 3. Secret-harvesting prompts (seed phrase etc.) from wallet DOM log, HTML probe, or Kane
  const considerSeed = (text, field, source, lead) => {
    const hit = seedRx.find((r) => r.test(text));
    if (hit && !negatedSecret(text) && !reasons.some((r) => r.id === 'seed_phrase_prompt')) {
      add('seed_phrase_prompt', source, `${lead}: "${String(text).replace(/\s+/g, ' ').slice(0, 120)}"`, field);
    }
    return !!hit && !negatedSecret(text);
  };
  for (const e of walletLog.filter((x) => x.type === 'input_seen')) {
    const f = e.field; const text = [f.label, f.placeholder, f.nearbyText].join(' ');
    considerSeed(text, f, 'rule:dom', 'Page shows a field asking for secrets');
  }
  for (const f of probe?.fields || []) {
    considerSeed([f.label, f.placeholder, f.nearbyText].join(' '), f, 'rule:html', 'Page HTML shows a field asking for secrets');
  }
  if (probe && real.flagSeedInKaneOrHtml !== false) {
    considerSeed([probe.title, probe.textSnippet].join(' '), null, 'rule:html', 'Page copy mentions secrets');
  }
  const typed = walletLog.filter((e) => e.type === 'input_typed' && e.field.id !== 'amount');
  if (typed.length && reasons.some((r) => r.id === 'seed_phrase_prompt'))
    add('secret_typed', 'rule:dom', 'Something was typed into the secret-harvesting field', typed[0]);

  if (mode === 'real-site' && kane && real.flagSeedInKaneOrHtml !== false) {
    const text = kaneText(kane);
    if (seedRx.some((r) => r.test(text)) && !negatedSecret(text) && !reasons.some((r) => r.id === 'seed_phrase_prompt')) {
      const sentences = [...String(kane.summary || '').split(/(?<=[.!?])\s+|\n+/), kane.one_liner || '', text];
      const quote = sentences.find((x) => seedRx.some((r) => r.test(x)) && !negatedSecret(x)) || text;
      add('seed_phrase_prompt', 'kane', `Kane: "${String(quote).replace(/\s+/g, ' ').trim().slice(0, 220)}"`, { matched: 'seed' });
    }
  }

  // 4. What Kane itself reported. Kane's objective asserts the wallet popup matches the
  //    swap the user asked for; a failed assertion that talks about traps is a trap signal.
  let kaneNote = null;
  if (kane && kane.status && kane.status !== 'passed' && rules.kane.flagFailedFlow) {
    const text = kaneText(kane);
    const kHit = (rules.kane.textPatterns || []).map(rx).find((r) => r.test(text));
    const said = (kane.summary || kane.one_liner || kane.reason || '').replace(/\s+/g, ' ').slice(0, 260);
    // Only assertion failures / confirmed product bugs count as Kane trap signals;
    // stuck.max_steps, timeouts etc. are inconclusive (Kane's summary can over-narrate those).
    const assertive = !kane.reason_code || /^assertion_error/.test(kane.reason_code);
    // Quote the sentence where Kane actually describes the trap (not its meta commentary).
    const sentences = [...String(kane.summary || '').split(/(?<=[.!?])\s+|\n+/), kane.one_liner || ''];
    const pats = (rules.kane.textPatterns || []).map(rx);
    const quote = sentences.find((x) => pats.some((r) => r.test(x))) || said;
    // Kane's text alone is not trap evidence when there is nothing to judge: an official domain with no
    // other rule hits (objective/flow bugs), or a gym run where the wallet was never asked to sign anything
    // and the page showed no secret prompt (e.g. a cloaked placeholder). Those are inconclusive, not traps.
    const signingAsks = walletLog.filter((e) => e.type === 'wallet_request' && !['eth_chainId', 'eth_accounts', 'eth_requestAccounts', 'wallet_switchEthereumChain'].includes(e.method));
    const kaneSawSecret = seedRx.some((r) => r.test(text)) && !negatedSecret(text);
    const nothingToJudge = !reasons.length && (dom.official || (mode === 'gym' && !signingAsks.length && !kaneSawSecret));
    if (kHit && assertive && !nothingToJudge) add('kane_assertion_failed', 'kane', `Kane: "${quote.trim().slice(0, 220)}"`, { status: kane.status, reason_code: kane.reason_code, matched: kHit.source });
    else kaneNote = `Kane could not complete the flow (${kane.reason_code || kane.status}): ${(kane.reason || said).slice(0, 160)}`;
  }

  // 4b. Kane "passed" because it followed the objective and REJECTED the wallet request: that is Kane flagging it.
  if (kane && kane.status === 'passed' && mode === 'gym' && rules.kane.flagRejectedPass) {
    const first = [kane.one_liner || '', String(kane.summary || '').split(/(?<=[.!?])\s+|\n+/)[0] || ''].join(' ');
    const pats = (rules.kane.textPatterns || []).map(rx);
    if (new RegExp(rules.kane.rejectPattern, 'i').test(first) && !/\b(no need|nothing) to reject\b/i.test(first) && (pats.some((r) => r.test(kaneText(kane))) || /unsafe/i.test(first)))
      add('kane_rejected_request', 'kane', `Kane: "${first.trim().slice(0, 200)}"`, { status: kane.status });
  }

  // 5. Page-level observations (real-site mode, also harmless in gym)
  const connectSeen = !!(probe?.walletConnect) || /connect([\s-]?wallet|\s+metamask)|import\s+(your\s+)?wallet/i.test(kaneText(kane));
  if (connectSeen && mode === 'real-site') {
    note('wallet_connect_prompt', 'observe',
      dom.official
        ? 'Connect Wallet prompt observed on a known-good domain (expected for a dApp).'
        : 'Connect Wallet prompt observed on a domain that is not on the known-good list.');
  }
  if (probe?.blocked) note('cloaking_or_block', 'observe', 'Page looks like a captcha, 403, or anti-bot wall. Sites can cloak test browsers — this is inconclusive, not "safe".');
  if (probe?.error) note('probe_error', 'observe', `HTTP peek failed: ${probe.error}`);

  // 6. Cloaking lab (gym two-view mode): compare the plain HTTP peek with what Kane's browser + wallet saw.
  const C = rules.cloak;
  let cloakInconclusive = false;
  if (C && mode === 'gym') {
    const ph = (C.placeholderPatterns || []).map(rx);
    const peekQuiet = probe && !probe.error && !(probe.fields || []).length && !probe.walletConnect;
    const walletTrap = reasons.filter((r) => /^rule:(wallet|signature|batch|dom)$/.test(r.source));
    const snaps = walletLog.filter((e) => e.type === 'page_snapshot');
    const requests = walletLog.filter((e) => e.type === 'wallet_request' && !['eth_chainId', 'eth_accounts'].includes(e.method));
    if (C.flagViewMismatch && peekQuiet && walletTrap.length) {
      const peekText = String(probe.textSnippet || probe.title || '').replace(/\s+/g, ' ').trim();
      const hit = ph.map((r) => peekText.search(r)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
      const quote = hit != null ? peekText.slice(Math.max(0, hit - 18), hit + 40).trim() : peekText.slice(0, 60);
      const LABEL = { permit_signature: 'a Permit signature request', unlimited_approval: 'an unlimited approval', increase_allowance: 'an allowance increase', nft_approval_for_all: 'an NFT setApprovalForAll', hidden_batch: 'a hidden batch', batch_hidden_approvals: 'hidden batch approvals', seed_phrase_prompt: 'a seed-phrase prompt', blind_signature: 'an eth_sign request' };
      add('cloaking_suspected', 'rule:cloak', `Two views differ: the plain HTTP peek (no JS, no wallet) saw "...${quote}..." with no wallet prompt, but Kane's browser with a wallet present got ${LABEL[walletTrap[0].id] || walletTrap[0].id}. The trap only shows itself to wallets`, { peek: { title: probe.title, text: (probe.textSnippet || '').slice(0, 160) }, walletView: walletTrap.map((r) => r.id) });
    }
    const placeholderOnly = snaps.length && snaps.every((e) => ph.some((r) => r.test(e.text || '')) || (e.textLength || 0) < (C.minTextLength || 0));
    if (C.placeholderIsInconclusive && placeholderOnly && !requests.length && !reasons.length) {
      cloakInconclusive = true;
      const wd = snaps.some((e) => e.webdriver);
      note('cloaking_suspected', 'rule:cloak', `Kane's browser${wd ? ' (navigator.webdriver = true)' : ''} only saw a placeholder ("${String(snaps[snaps.length - 1].text || '').slice(0, 60)}")${probe ? ' and so did the HTTP peek' : ''}. A page that hides from automated browsers cannot be verified: inconclusive, not safe`);
    }
  }

  // 7. Fake exchange / withdrawal-fee ("pig butchering") landing pages. Learned from a real miss (usdc082.com).
  const FX = rules.fakeExchange;
  if (FX && mode === 'real-site' && !dom.official) {
    const host = (dest?.host || dom.host || '').toLowerCase();
    const tick = (FX.tickers || []).join('|');
    const lbl = host.replace(/^www\./, '').split('.').slice(0, -1).join('.');
    const tickerDigits = tick && new RegExp(`(^|[.-])(${tick})[-_]?\\d{2,}|\\d{2,}[-_]?(${tick})([.-]|$)`, 'i').test(lbl);
    if (FX.flagTickerDigitsDomain && tickerDigits && !reasons.some((r) => r.id === 'ticker_digits_domain'))
      add('ticker_digits_domain', 'rule:domain', `${host} is a coin ticker or exchange name plus digits, a naming pattern common to throwaway fake-exchange sites`, { host });
    const age = probe?.rdap?.ageDays;
    if (FX.newDomainDays && age != null && age <= FX.newDomainDays)
      add('new_domain', 'rule:domain', `${probe.rdap.domain} was registered ${probe.rdap.registered.slice(0, 10)}, only ${age} days ago (RDAP)`, probe.rdap);
    else if (age != null) note('domain_age', 'rule:domain', `${probe.rdap.domain} registered ${probe.rdap.registered.slice(0, 10)} (${age} days ago)`);
    else if (probe?.rdap?.error) note('domain_age', 'rule:domain', `Domain age unknown (${probe.rdap.error})`);
    // Only Kane's finished observations count (a stuck run's summary is meta talk about what it should have checked).
    const kaneSaw = kane && kane.status === 'passed' ? [kane.summary, kane.one_liner].filter(Boolean).join('\n') : '';
    const text = [kaneSaw, probe?.title, probe?.textSnippet].join('\n');
    const login = new RegExp(FX.loginPattern, 'i').test(text) && !/\b(no|not|without)\b[^.]{0,30}\b(log ?in|sign ?in|register)/i.test(text);
    const words = (FX.exchangeWords || []).filter((w) => new RegExp(`\\b${w}`, 'i').test(text));
    const title = String(probe?.title || '').trim();
    const brandInTitle = (allowlist.brands || []).some((b) => title.toLowerCase().includes(b)) || (lbl && title.toLowerCase().includes(lbl.split('.').pop()));
    const genericTitle = !!title && !brandInTitle && /^[a-z0-9 ]{3,14}$/i.test(title) && !/swap|exchange|wallet|finance|trade/i.test(title) && !title.toLowerCase().includes(lbl.split('.').pop());
    if (genericTitle) note('mismatched_title', 'observe', `Page title "${title}" has nothing to do with the domain or any known brand`);
    if (probe?.turnstile) note('turnstile', 'observe', 'Cloudflare Turnstile challenge on the page (common on fake exchanges to keep scanners out; also used by legit sites)');
    const score = (login ? 1 : 0) + (words.length ? 1 : 0) + (probe?.turnstile && login ? 1 : 0) + (genericTitle ? 1 : 0) + (tickerDigits ? 1 : 0) + (age != null && age <= (FX.newDomainDays || 0) ? 1 : 0);
    if (FX.flagFakeExchangeSignals && login && score >= (FX.minSignals || 3))
      add('fake_exchange_login', 'rule:fake-exchange', `Login / register page for an unknown "exchange" on a non-listed domain${words.length ? ` with ${words.slice(0, 4).map((w) => `"${w}"`).join(', ')} wording` : ''}${probe?.turnstile ? ', behind Turnstile' : ''}${genericTitle ? `, generic title "${title}"` : ''}. Classic withdrawal-fee scam setup: never log in with credentials someone sent you`, { login, words, turnstile: !!probe?.turnstile, genericTitle, score });
  }

  const blockedInconclusive = mode === 'real-site' && (probe?.blocked || probe?.error) && !reasons.length;
  const noEvidence = !kane && walletLog.length === 0 && !probe;
  const verdict = reasons.length ? 'TRAP FLAGGED' : (blockedInconclusive || kaneNote || noEvidence || cloakInconclusive) ? 'INCONCLUSIVE' : 'NO KNOWN TRAPS FOUND';
  const traps = reasons;
  return {
    verdict, url, host: dom.host, officialDomain: dom.official, resembles: dom.resembles || dest?.resembles || null, reasons: traps, signals, mode,
    walletSummary: { requests: walletLog.filter((e) => e.type === 'wallet_request').map((e) => e.method), transactions: txs, signatures: sigs, batches, authorizations: auths },
    kane: kane ? { status: kane.status, one_liner: kane.one_liner, summary: kane.summary, credits: kane.credits_consumed, test_url: kane.test_url, reason_code: kane.reason_code, steps: kane.steps || [] } : null,
    probe: probe ? { finalUrl: probe.finalUrl, status: probe.status, title: probe.title, hops: probe.hops || [], blocked: !!probe.blocked, error: probe.error || null, walletConnect: !!probe.walletConnect, turnstile: !!probe.turnstile, rdap: probe.rdap || null, textSnippet: (probe.textSnippet || '').slice(0, 300) } : null,
    rulesVersion: rules.version, note: kaneNote,
    disclaimer: 'Flags known trap patterns seen on this run. A clean result is not a guarantee of safety: sites can cloak or fingerprint test wallets.',
  };
}
