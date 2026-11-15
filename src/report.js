// Verdict rendering: terminal card, markdown (PR comments / fix prompts), JSON.
const c = (n) => (s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
export const red = c('31;1'), green = c('32;1'), yellow = c('33;1'), dim = c('2'), bold = c('1'), cyan = c('36');

export function terminalCard(v) {
  const color = v.verdict === 'TRAP FLAGGED' ? red : v.verdict === 'INCONCLUSIVE' ? yellow : green;
  const icon = v.verdict === 'TRAP FLAGGED' ? '🚨' : v.verdict === 'INCONCLUSIVE' ? '❔' : '✅';
  const out = [];
  out.push('', '  ' + '━'.repeat(64));
  out.push(`  ${icon}  ${color(v.verdict === 'NO KNOWN TRAPS FOUND' ? 'NO KNOWN TRAPS FOUND' : v.verdict)}   ${dim(v.url)}`);
  out.push('  ' + '━'.repeat(64));
  if (v.reasons.length) {
    out.push(bold('  Why:'));
    for (const r of v.reasons) out.push(`   ${red('✖')} ${r.detail} ${dim('[' + r.id + ' · ' + r.source + ']')}`);
  }
  if (v.signals && v.signals.length) {
    out.push(bold('  Signals:'));
    for (const s of v.signals) out.push(`   ${cyan('·')} ${s.detail} ${dim('[' + s.id + ']')}`);
  }
  if (v.note) out.push(`   ${yellow('?')} ${v.note}`);
  out.push(bold('  Evidence:'));
  if (v.mode === 'real-site') out.push(`   mode       ${cyan('real-site')} (observe only, no mock wallet)`);
  out.push(`   domain     ${v.host} ${v.officialDomain ? green('(official allowlist)') : yellow('(not on known-good list)')}`);
  if (v.probe) {
    if (v.probe.finalUrl && v.probe.finalUrl !== v.url) out.push(`   final url  ${v.probe.finalUrl}`);
    if (v.probe.title) out.push(`   title      ${v.probe.title}`);
    if (v.probe.status) out.push(`   http       ${v.probe.status}${v.probe.blocked ? yellow('  (cloaked/blocked?)') : ''}`);
  }
  out.push(`   wallet     ${v.walletSummary.requests.join(' → ') || 'no wallet requests'}`);
  for (const t of v.walletSummary.transactions) out.push(`   tx         ${t.label}: ${t.amountHuman}${t.kind === 'approve' ? ' → spender ' + t.spender : ''} (contract ${t.to})`);
  if (v.kane) {
    out.push(`   kane       ${v.kane.status === 'passed' ? green('passed') : red(v.kane.status)} · ${v.kane.one_liner || ''}`);
    if (v.kane.credits) out.push(`   credits    ${Number(v.kane.credits).toFixed(1)}`);
    if (v.kane.test_url) out.push(`   replay     ${cyan(v.kane.test_url)}`);
  }
  out.push(dim(`  rules v${v.rulesVersion} · ${v.disclaimer}`));
  out.push('  ' + '━'.repeat(64), '');
  return out.join('\n');
}

export function markdown(v) {
  const icon = v.verdict === 'TRAP FLAGGED' ? '🚨' : v.verdict === 'INCONCLUSIVE' ? '❔' : '✅';
  const l = [`### ${icon} SafuClick: ${v.verdict}`, '', `**URL:** \`${v.url}\``, ''];
  if (v.reasons.length) { l.push('**Why:**'); for (const r of v.reasons) l.push(`- ${r.detail} \`${r.id}\` (${r.source})`); l.push(''); }
  if (v.signals && v.signals.length) { l.push('**Signals:**'); for (const s of v.signals) l.push(`- ${s.detail} \`${s.id}\``); l.push(''); }
  if (v.note) l.push(`> ${v.note}`, '');
  l.push('**Evidence**', '', `| | |`, `|---|---|`, `| Mode | ${v.mode === 'real-site' ? 'real-site (observe only)' : 'gym / mock wallet'} |`, `| Domain | \`${v.host}\` ${v.officialDomain ? '(official)' : '(not on known-good list)'} |`,
    `| Wallet requests | ${v.walletSummary.requests.join(' → ') || 'none'} |`);
  for (const t of v.walletSummary.transactions) l.push(`| Transaction | ${t.label}: **${t.amountHuman}**${t.kind === 'approve' ? ` → spender \`${t.spender}\`` : ''} (contract \`${t.to}\`) |`);
  if (v.kane) l.push(`| Kane CLI | ${v.kane.status}: ${v.kane.one_liner || ''} |`, `| Kane credits | ${v.kane.credits ? Number(v.kane.credits).toFixed(1) : 'n/a'} |`, `| Kane report | ${v.kane.test_url ? `[open](${v.kane.test_url})` : 'n/a'} |`);
  l.push('', `_Rules v${v.rulesVersion}. ${v.disclaimer} SafuClick, powered by Kane CLI._`);
  return l.join('\n');
}
