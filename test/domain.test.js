// Lookalike-domain detection: every trick class, with the official domain it resembles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainToASCII } from 'node:url';
import { checkDomain, damerau, skeleton } from '../src/domain.js';
import { p, readJSON } from '../src/paths.js';

const rules = readJSON(process.env.SAFU_RULES || p('config', 'rules.json'));
const allow = readJSON(p('config', 'allowlist.json'));
const strong = !!(rules.domain?.flagHomoglyphs && rules.domain?.flagWrongTld && rules.domain?.flagSubdomainTrick && rules.domain?.flagTickerDigits);
const check = (host) => checkDomain(`https://${host}/`, allow, rules);
const expectHit = (host, id, resembles) => {
  const d = check(host);
  assert.equal(d.official, false, host);
  const f = d.findings.find((x) => x.id === id);
  assert.ok(f, `${host} should be ${id}; got ${JSON.stringify(d.findings)}`);
  if (resembles) { assert.equal(f.resembles, resembles); assert.match(f.detail, new RegExp(`Looks like ${resembles.replace(/\./g, '\\.')}`)); }
};

test('damerau counts an adjacent swap as one edit; skeleton folds look-alikes', () => {
  assert.equal(damerau('unsiwap', 'uniswap'), 1);
  assert.equal(skeleton('rnetamask'), skeleton('metamask'));
  assert.equal(skeleton('0pensea'), skeleton('opensea'));
  assert.equal(skeleton('1ido'), skeleton('lido'));
});

const cases = [
  ['one-letter substitution', 'uniswqp.org', 'lookalike_domain', 'app.uniswap.org'],
  ['adjacent swap (transposition)', 'unsiwap.org', 'lookalike_domain', 'app.uniswap.org'],
  ['insertion', 'uniiswap.org', 'lookalike_domain', 'app.uniswap.org'],
  ['deletion', 'opnsea.io', 'lookalike_domain', 'opensea.io'],
  ['two edits on a long name', 'pancakeswqp.finance', 'lookalike_domain', 'pancakeswap.finance'],
  ['short name typo', 'aavee.com', 'lookalike_domain', 'app.aave.com'],
  ['revoke.cash typo', 'rev0ke.cash', 'homoglyph_domain', 'revoke.cash'],
  ['punycode Cyrillic a', domainToASCII('uniswаp.org'), 'punycode_domain', 'app.uniswap.org'],
  ['rn for m', 'rnetamask.io', 'homoglyph_domain', 'metamask.io'],
  ['0 for o', '0pensea.io', 'homoglyph_domain', 'opensea.io'],
  ['1 for l', 'stake.1ido.fi', 'homoglyph_domain', 'stake.lido.fi'],
  ['brand + hyphen word', 'uniswap-app.com', 'brand_impersonation', 'app.uniswap.org'],
  ['brand + -fi', 'aave-fi.info', 'brand_impersonation', 'app.aave.com'],
  ['brand + glued word', 'curvegov.icu', 'brand_impersonation', 'curve.fi'],
  ['wrong TLD', 'uniswap.icu', 'wrong_tld', 'app.uniswap.org'],
  ['wrong TLD (.app)', 'binance.app', 'wrong_tld', 'binance.com'],
  ['official domain as subdomain prefix', 'uniswap.org.evil.com', 'subdomain_trick', 'app.uniswap.org'],
  ['official host as subdomain prefix', 'app.aave.com.claim-rewards.xyz', 'subdomain_trick', 'app.aave.com'],
  ['ticker + digits', 'usdc082.com', 'ticker_digits_domain', 'circle.com'],
  ['exchange + digits', 'binance123.com', 'ticker_digits_domain', 'binance.com'],
];
for (const [name, host, id, resembles] of cases) {
  test(`lookalike: ${name} (${host}) → ${id}, looks like ${resembles}`, { skip: !strong && 'needs strong domain rules' }, () => expectHit(host, id, resembles));
}

test('official domains and their subdomains stay clean; unrelated short names are not "aave"', { skip: !strong && 'needs strong domain rules' }, () => {
  for (const h of ['app.uniswap.org', 'docs.uniswap.org', 'revoke.cash', 'stake.lido.fi', 'www.coinbase.com', 'safuswap.localhost'])
    assert.equal(check(h).official, true, h);
  for (const h of ['dave.com', 'example.com', 'github.com', 'vercel.app', 'google.com'])
    assert.deepEqual(check(h).findings, [], h + ' ' + JSON.stringify(check(h).findings));
});
