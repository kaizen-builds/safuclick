// Safe gym bounds for the scammer agent. It may only plant a variant of an EXISTING trap family on the
// local loop slot (http://<name>.localhost:4110, mock wallet, mock contracts, Sepolia chain id, no real
// funds). Anything else (new trap types, real domains, URLs, HTML/script in copy) is rejected.
import { SCENARIOS } from '../kane.js';

export const FAMILIES = ['approve', 'increaseAllowance', 'permit2', 'permit', 'setApprovalForAll', 'batch', 'cloak', 'seed_prompt', 'lookalike_domain'];
const SKINS = ['swap', 'claim', 'revoke', 'cloak'];
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = (v) => v === 'max' || (typeof v === 'string' && /^[0-9]{1,40}$/.test(v));
const TEXT_BAD = /[<>"'`\\]|https?:|www\.|javascript:|\.(com|io|org|xyz|net|app|finance)\b|on\w+=/i;

const FIELDS = {
  approve: { spender: 'addr', amount: 'amount' },
  increaseAllowance: { spender: 'addr', amount: 'amount', method: ['increaseAllowance', 'increaseApproval'] },
  permit2: { spender: 'addr', amount: 'amount', expirationDays: 'days', batch: 'bool', token: 'addr' },
  permit: { spender: 'addr', amount: 'amount', expirationDays: 'days', token: 'addr' },
  setApprovalForAll: { operator: 'addr', collection: 'addr', approved: 'bool' },
  batch: { calls: 'calls', delegator: 'addr' },
  cloak: { hideFromAutomation: 'bool', revealDelayMs: 'ms' },
  seed_prompt: { when: ['load', 'after_connect'], delayMs: 'ms', title: 'text', wording: 'text', placeholder: 'text', button: 'text' },
  lookalike_domain: {},
};
const CALL_FIELDS = { swap: {}, approve: { token: 'addr', spender: 'addr', amount: 'amount' }, setApprovalForAll: { collection: 'addr', operator: 'addr' }, transfer: { token: 'addr', to: 'addr', amount: 'amount' } };

function checkField(kind, v, at, errors) {
  if (Array.isArray(kind)) { if (!kind.includes(v)) errors.push(`${at}: must be one of ${kind.join('|')}`); return; }
  if (kind === 'addr' && !(typeof v === 'string' && ADDR.test(v))) errors.push(`${at}: must be a 0x + 40 hex address`);
  if (kind === 'amount' && !AMOUNT(v)) errors.push(`${at}: must be "max" or a base-unit integer string (USDC has 6 decimals)`);
  if (kind === 'days' && !(Number.isInteger(v) && v >= 0 && v <= 36500)) errors.push(`${at}: integer days 0..36500`);
  if (kind === 'ms' && !(Number.isInteger(v) && v >= 0 && v <= 5000)) errors.push(`${at}: integer ms 0..5000`);
  if (kind === 'bool' && typeof v !== 'boolean') errors.push(`${at}: true/false`);
  if (kind === 'text' && !(typeof v === 'string' && v.length <= 200 && !TEXT_BAD.test(v))) errors.push(`${at}: plain text up to 200 chars, no quotes, angle brackets, URLs or domains`);
}

export function validateVariant(site, { port = 4110 } = {}) {
  const errors = [];
  if (!site || typeof site !== 'object' || Array.isArray(site)) return { errors: ['site must be an object'] };
  const allowed = ['id', 'host', 'title', 'router', 'skin', 'scenario', 'traps'];
  for (const k of Object.keys(site)) if (!allowed.includes(k) && !k.startsWith('_')) errors.push(`site.${k}: unknown key`);
  if (!/^[a-z0-9-]{3,40}$/.test(site.id || '')) errors.push('site.id: 3-40 chars of a-z 0-9 -');
  const host = String(site.host || '').toLowerCase();
  if (!/^([a-z0-9-]{1,40}\.){1,3}localhost$/.test(host) || host.length > 70) errors.push('site.host: must be a local *.localhost name (gym only, never a real domain)');
  if (!(typeof site.title === 'string' && site.title.length >= 2 && site.title.length <= 40 && !TEXT_BAD.test(site.title))) errors.push('site.title: plain text, 2-40 chars');
  if (!ADDR.test(site.router || '')) errors.push('site.router: 0x + 40 hex address');
  const skin = site.skin || 'swap';
  if (!SKINS.includes(skin)) errors.push(`site.skin: one of ${SKINS.join('|')}`);
  const scenario = site.scenario || 'swap';
  if (!SCENARIOS[scenario]) errors.push(`site.scenario: one of ${Object.keys(SCENARIOS).join('|')}`);
  const traps = site.traps;
  if (!Array.isArray(traps) || !traps.length || traps.length > 4) errors.push('site.traps: 1-4 traps');
  for (const [i, t] of (Array.isArray(traps) ? traps : []).entries()) {
    const spec = FIELDS[t?.type];
    if (!spec) { errors.push(`traps[${i}].type: "${t?.type}" is not an existing trap family (${FAMILIES.join(', ')})`); continue; }
    for (const [k, v] of Object.entries(t)) {
      if (k === 'type') continue;
      if (!(k in spec)) { errors.push(`traps[${i}].${k}: unknown field for ${t.type}`); continue; }
      if (spec[k] === 'calls') {
        if (!Array.isArray(v) || !v.length || v.length > 6) { errors.push(`traps[${i}].calls: 1-6 calls`); continue; }
        v.forEach((c, j) => {
          const cs = CALL_FIELDS[c?.kind];
          if (!cs) return errors.push(`traps[${i}].calls[${j}].kind: one of ${Object.keys(CALL_FIELDS).join('|')}`);
          for (const [ck, cv] of Object.entries(c)) if (ck !== 'kind') (ck in cs ? checkField(cs[ck], cv, `traps[${i}].calls[${j}].${ck}`, errors) : errors.push(`traps[${i}].calls[${j}].${ck}: unknown field`));
        });
      } else checkField(spec[k], v, `traps[${i}].${k}`, errors);
    }
    if (['approve', 'increaseAllowance', 'permit2', 'permit'].includes(t.type) && !t.spender) errors.push(`traps[${i}]: ${t.type} needs a spender`);
    if (t.type === 'setApprovalForAll' && !t.operator) errors.push(`traps[${i}]: setApprovalForAll needs an operator`);
    if (t.type === 'seed_prompt' && !(t.title && t.wording)) errors.push(`traps[${i}]: seed_prompt needs title and wording`);
  }
  const types = (Array.isArray(traps) ? traps : []).map((t) => t?.type);
  // Wiring rules of the gym page (src/gym/public/app.js): which skin can fire which trap.
  if (types.some((t) => t === 'permit' || t === 'permit2') && !['claim', 'cloak'].includes(skin)) errors.push('permit/permit2 traps only fire on the claim or cloak skin');
  if (types.includes('setApprovalForAll') && skin !== 'revoke') errors.push('setApprovalForAll only fires on the revoke skin');
  if (types.includes('cloak') !== (skin === 'cloak')) errors.push('the cloak trap and the cloak skin go together');
  const want = { claim: ['claim'], revoke: ['revoke'], cloak: ['cloak'], swap: ['swap', 'batch', 'allowance'] }[skin] || [];
  if (!want.includes(scenario)) errors.push(`scenario "${scenario}" does not fit skin "${skin}" (use ${want.join('|')})`);
  const clean = { id: `agent-${String(site.id || 'variant').replace(/^agent-/, '')}`.slice(0, 46), host, title: site.title, router: site.router, skin, scenario, traps };
  return { errors, site: clean, url: `http://${host}:${port}/` };
}
