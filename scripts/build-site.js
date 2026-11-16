// Builds the static website data (site/data/*.json + site/cards/*.svg) from REAL recorded Kane runs.
// No invented data: every field comes from verdict.json / kane.ndjson / probe.json / history.json.
import fs from 'node:fs';
import path from 'node:path';
import { p, readJSON, writeJSON } from '../src/paths.js';
import { loadKaneNdjson } from '../src/kane.js';
import { safuCard } from '../src/card.js';

const GALLERY = [
  { slug: 'official', dir: 'docs/runs/gym/13-official-v7', title: 'Official SafuSwap', kind: 'gym', blurb: 'The real practice dApp. Baseline: a normal 10 USDC swap, re-checked by Kane with rules v7 (false-positive check).' },
  { slug: 'clone', dir: 'docs/runs/gym/08-clone-final', title: 'Lookalike clone · safuswep', kind: 'gym', blurb: 'Pixel-perfect copy on a domain one letter off. Kane completed the swap — the trap is in the domain and the contract the wallet was asked to pay.', star: true },
  { slug: 'seed', dir: 'docs/runs/gym/03-seed', title: 'Seed-phrase "verification"', kind: 'gym', blurb: 'A "verify your wallet" box asking for your 12 recovery words. No real dApp ever asks this.' },
  { slug: 'approval', dir: 'docs/runs/gym/02-approval', title: 'Hidden unlimited approval', kind: 'gym', blurb: 'Real domain, compromised frontend. The button says "Swap 10 USDC"; the wallet is asked for UNLIMITED.' },
  { slug: 'claim', dir: 'docs/runs/loop2/01-permit-claim-recheck', title: 'Sign-to-claim permit', kind: 'new', blurb: 'Gas-free "sign to verify eligibility" on the real domain. The signature is a Permit2 PermitSingle: unlimited USDC to an unknown spender for three years. The biggest loss type of 2025.' },
  { slug: 'allowance', dir: 'docs/runs/loop2/02-ice-allowance-recheck', title: 'increaseAllowance ice phishing', kind: 'new', blurb: 'The swap button calls increaseAllowance(attacker, max) instead of approve(), which approve-only checks never decode.' },
  { slug: 'revoke', dir: 'docs/runs/gym/10-revoke-kane', title: 'Fake revoke site', kind: 'new', blurb: 'A "revoke your approvals" page on a revoke.cash lookalike. The Revoke button calls setApprovalForAll(attacker, true): it GRANTS access to every Uniswap V3 position NFT instead of revoking.' },
  { slug: 'batch', dir: 'docs/runs/gym/11-batch-kane', title: 'Hidden batch swap', kind: 'new', blurb: 'Real domain, compromised frontend. "Swap 10 USDC" sends one wallet_sendCalls batch hiding two unlimited approvals and an NFT setApprovalForAll. Kane rejected it.' },
  { slug: 'cloak', dir: 'docs/runs/gym/09-cloak-two-views', title: 'Cloaking lab: two views', kind: 'new', blurb: 'A plain HTTP peek gets "Coming soon". Kane\'s browser with a wallet present gets an EIP-2612 Permit drainer. The trap only shows itself to wallets.', cloak: true },
  { slug: 'cloak-strict', dir: 'docs/runs/gym/12-cloak-strict-kane', title: 'Cloaking lab: hides from everyone', kind: 'new', blurb: 'A stricter cloak: both the HTTP peek and Kane\'s browser only got "Coming soon". SafuClick cannot see a trap it is never shown, so the honest answer is INCONCLUSIVE, never safe.', cloak: true },
  { slug: 'uniswap', dir: 'docs/runs/real/01-uniswap', title: 'app.uniswap.org', kind: 'real', blurb: 'Live, legit DEX. Observe-only run, no wallet, no signing.' },
  { slug: 'curvegov', dir: 'docs/runs/real/02-curvegov', title: 'curvegov.icu', kind: 'real', blurb: 'Live fake Curve page reported on Nov 7, 2026. Lookalike domain plus a Connect Wallet prompt.' },
  { slug: 'usdc082', dir: 'docs/runs/real/05-usdc082-fixed', title: 'usdc082.com (real DM)', kind: 'real', blurb: 'From a real X DM scam: fake exchange with bait login details and a fake 2.3M balance. Missed at first; the loop added a ticker-plus-digits domain rule and Kane re-checked the live site. Kane never logs in.' },
  { slug: 'aave-fi', dir: 'docs/runs/real/03-aave-fi', title: 'aave-fi.info', kind: 'real', blurb: 'Live fake Aave page. Kane\'s browser saw a blank page while a plain HTTP request got the full fake site: cloaking, caught live.', cloak: true },
];

const strip = (v) => { const o = JSON.parse(JSON.stringify(v)); delete o.runDir; delete o.card; return o; };

const checks = GALLERY.map((g) => {
  const dir = p(g.dir);
  const v = readJSON(path.join(dir, 'verdict.json'));
  const kane = loadKaneNdjson(path.join(dir, 'kane.ndjson'));
  const wallet = readJSON(path.join(dir, 'wallet-log.json'), []);
  const probe = readJSON(path.join(dir, 'probe.json'), null);
  fs.writeFileSync(p('site', 'cards', `${g.slug}.svg`), safuCard(v));
  return {
    ...g, url: v.url, host: v.host, verdict: v.verdict, officialDomain: v.officialDomain, resembles: v.resembles || null, mode: v.mode || 'gym',
    reasons: (v.reasons || []).map((r) => ({ id: r.id, source: r.source, detail: r.detail })),
    signals: v.signals || [],
    wallet: (v.walletSummary?.transactions || []),
    signatures: v.walletSummary?.signatures || [],
    batches: v.walletSummary?.batches || [],
    walletRequests: v.walletSummary?.requests || [],
    walletEvents: wallet.length,
    kane: { status: kane.status, one_liner: kane.one_liner, summary: kane.summary, reason_code: kane.reason_code, credits: kane.credits_consumed, duration: kane.duration, test_url: kane.test_url, steps: kane.steps },
    probe: probe ? { status: probe.status, title: probe.title, finalUrl: probe.finalUrl, walletConnect: probe.walletConnect, blocked: probe.blocked, textSnippet: (probe.textSnippet || '').slice(0, 260) } : null,
    rulesVersion: v.rulesVersion ?? null,
    disclaimer: v.disclaimer || null,
    card: `cards/${g.slug}.svg`,
  };
});
writeJSON(p('site', 'data', 'checks.json'), { generatedAt: new Date().toISOString(), checks });

// Scam Arena: the recorded 3-round loop (docs/runs/loop), taunts from the scammer playbook.
const loop1 = readJSON(p('docs', 'runs', 'loop', 'history.json'));
const extra = ['loop2', 'loop-real'].map((d) => readJSON(p('docs', 'runs', d, 'history.json'), null)).filter(Boolean);
const loop = { finishedAt: extra.length ? extra[extra.length - 1].finishedAt : loop1.finishedAt, credits: loop1.credits + extra.reduce((a, x) => a + (x.credits || 0), 0), history: [] };
for (const h of [loop1, ...extra].flatMap((x) => x.history)) loop.history.push({ ...h, round: loop.history.length + 1 });
const playbook = readJSON(p('src', 'loop', 'playbook.json'));
const taunts = Object.fromEntries(playbook.moves.map((m) => [m.name, m.taunt]));
const side = (e) => {
  if (!e) return null;
  const k = e.runDir ? loadKaneNdjson(p(e.runDir, 'kane.ndjson')) : {};
  return { verdict: e.verdict, rulesVersion: e.rulesVersion, reasons: (e.reasons || []).map((r) => ({ id: r.id, source: r.source, detail: r.detail })), kane: { status: e.kane?.status, one_liner: e.kane?.one_liner, credits: e.kane?.credits, test_url: e.kane?.test_url, steps: k.steps || [] } };
};
const rounds = loop.history.map((h) => ({
  round: h.round, move: h.move, pitch: h.pitch, taunt: taunts[h.move] || h.taunt || null, real: !!h.real, outcome: String(h.outcome).replace(/\s*\u2192\s*/g, ', then '), rulesBefore: h.rulesBefore,
  first: side(h.first), builder: h.builder ? { changes: h.builder.changes, testsOk: h.builder.testsOk, rulesAfter: h.builder.rulesAfter } : null, recheck: side(h.recheck),
}));
writeJSON(p('site', 'data', 'arena.json'), { finishedAt: loop.finishedAt, credits: loop.credits, rounds });
console.log(`site data: ${checks.length} checks, ${rounds.length} arena rounds`);
