'use strict';
/**
 * verify-fal3-accountant-tiers.js — FA-L3 (found 2026-10-23). The public accountants page advertised what the code does
 * not pay: three referral tiers (1–50 → $10 for 1 month · 50–500 → $30 over 3 months · 500+ → $120 over 12 months), "We
 * take 4%" commission, a $500 example keeping $480, and "Minimum bill: $50". The code's ONE tier source (tier-config.js)
 * pays $10 a month per active paying client for 3 / 6 / 9 / 12 / 12 months across five tiers (Bronze 1–24 … Elite 250+),
 * charges 0% commission on the first 3 clients then 10% → 2% by tier, takes Stripe's fee first, and has no minimum bill.
 * Now the page's tiers and the commission example are written by scripts/gen-tier-cards.js FROM tier-config.js; this
 * checks the page's rendered text against tier-config's executed values (splitBilling) and that the page is exactly what
 * the generator writes.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const T = require(path.join(ROOT, 'tier-config.js'));
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const html = fs.readFileSync(path.join(ROOT, 'public', 'accountants.html'), 'utf8');
const d = new JSDOM(html).window.document;
const text = d.body.textContent.replace(/\s+/g, ' ');
const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log('\n' + '='.repeat(78) + '\n  FA-L3 — the accountants page says what the code pays\n' + '='.repeat(78) + '\n');
const cards = [...d.querySelectorAll('.tier-card[data-tier]')];
A('1  one card per tier in tier-config (' + T.TIERS.length + '), in order (bug: 3 invented tiers)', cards.length === T.TIERS.length && cards.map(c => c.getAttribute('data-tier')).join() === T.TIERS.map(t => t.name).join(), cards.map(c => c.getAttribute('data-tier')).join());
T.TIERS.forEach((t, i) => {
  const c = (cards[i] || { textContent: '' }).textContent.replace(/\s+/g, ' ');
  const range = t.max === Infinity ? t.min + '+ active clients' : t.min + '–' + t.max + ' active clients';
  A('2  ' + t.name + ': "' + range + '", $10 a month for ' + t.referralMonths + ' months, ' + Math.round(t.commissionRate * 100) + '% commission', c.includes(range) && c.includes(t.referralMonths + ' months') && c.includes(Math.round(t.commissionRate * 100) + '% commission'), c.slice(0, 200));
});
A('3  the first ' + T.ONBOARDING_FREE_BELOW + ' clients are commission-free — stated', new RegExp('first ' + T.ONBOARDING_FREE_BELOW + ' clients', 'i').test(text) && /commission-free|no commission/i.test(text), '');
A('4  no "We take 4%", "4% FinFlow service commission", "96%", nor pre-launch "already earning" (none true)', !/We take 4%|96%|already earning/.test(text) && !/4%\s*FinFlow service commission/.test(text), (text.match(/We take 4%|96%[^.]{0,30}|already earning|4%\s*FinFlow service commission/) || [''])[0]);
// the minimum bill IS a rule (tier-config.MIN_BILL_MINOR; bill-client refuses below it) — stated from the same constant
A('4d the page states the minimum bill from tier-config (' + money(T.minBillMinor('usd')) + ')', text.includes('Minimum bill: ' + money(T.minBillMinor('usd'))), (text.match(/Minimum bill[^✓]{0,20}/) || ['none'])[0]);
// the top stat strip, computed from tier-config ($120 IS true: $10 × the longest referral period, 12 months)
const maxRef = '$' + (10 * Math.max(...T.TIERS.map(t => t.referralMonths)));
const stats = ((d.getElementById('acc-stats') || {}).textContent || '').replace(/\s+/g, ' ');
A('4b the stat strip: $0 monthly fee · 0% on your first ' + T.ONBOARDING_FREE_BELOW + ' clients · ' + T.TIERS.map(t => Math.round(t.commissionRate * 100) + '%')[0] + ' → ' + T.TIERS.map(t => Math.round(t.commissionRate * 100) + '%').slice(-1)[0] + ' commission · ' + maxRef + ' max referral per client',
  /\$0/.test(stats) && new RegExp('0%\\s*Commission on your first ' + T.ONBOARDING_FREE_BELOW).test(stats) && /10% → 2%/.test(stats) && stats.includes(maxRef), stats.slice(0, 200) || 'no #acc-stats');
A('4c Preferred Partner is described as awarded by the team, not automatic at 4.5 stars', !/with a 4\.5\+ star rating earn a Preferred Partner/.test(text) && /Preferred Partner/.test(text), (text.match(/[^.]*Preferred Partner[^.]*\./) || [''])[0]);
const ex = 50000, bronze = T.splitBilling(ex, T.TIERS[0].commissionRate, T.estimateStripeFeeCents(ex)), free = T.splitBilling(ex, 0, T.estimateStripeFeeCents(ex));
const calc = ((d.getElementById('commission-example') || {}).textContent || '').replace(/\s+/g, ' ');
A('5  the $500 example is tier-config\'s own split: Stripe ' + money(bronze.stripeFeeCents) + ' · FinFlow ' + money(bronze.commissionCents) + ' · you ' + money(bronze.accountantNetCents) + ' (bug: 4% → $480.00)',
  calc.includes(money(bronze.stripeFeeCents)) && calc.includes(money(bronze.commissionCents)) && calc.includes(money(bronze.accountantNetCents)), calc.slice(0, 300));
A('5b …and while commission-free, you keep ' + money(free.accountantNetCents), calc.includes(money(free.accountantNetCents)), calc.slice(0, 300));
let gen = null; try { gen = require(path.join(ROOT, 'scripts', 'gen-tier-cards.js')); } catch (_) {}
A('6  accountants.html is exactly what the generator writes from tier-config.js (nobody edits a tier by hand)', !!gen && gen.render(html) === html, gen ? 'run: node scripts/gen-tier-cards.js' : 'no generator');
console.log('\n' + '-'.repeat(78));
console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-L3 accountant tiers)'));
console.log('-'.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
