#!/usr/bin/env node
'use strict';
// FA-L3: writes the accountants page's referral tiers and service-commission example FROM tier-config.js — the one tier
// source the server pays from. Runs in `npm run gen` / `npm run build`. Idempotent: only the <!-- gen:… --> regions change.
// verify-fal3-accountant-tiers fails if public/accountants.html is not what this script produces.
const fs = require('fs');
const path = require('path');
const T = require('../tier-config');

const FILE = path.join(__dirname, '..', 'public', 'accountants.html');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const REFERRAL_MONTHLY = 10;   // $10 a month per active paying client (accountant-routes.js referral writer: 1000 cents)

function between(s, name, body) {
  const open = '<!-- gen:' + name + ' -->', close = '<!-- /gen:' + name + ' -->';
  const i = s.indexOf(open), j = s.indexOf(close);
  if (i < 0 || j < i) throw new Error('accountants.html: missing markers for ' + name);
  return s.slice(0, i + open.length) + '\n' + body + s.slice(j);
}

function render(src) {
  let s = src;
  const cards = T.TIERS.map((t, i) => {
    const range = t.max === Infinity ? t.min + '+ active clients' : t.min + '–' + t.max + ' active clients';
    const top = i === T.TIERS.length - 1;
    return '      <div class="tier-card' + (top ? ' featured' : '') + ' reveal" data-tier="' + esc(t.name) + '">\n'
      + '        <div class="tier-badge-label"' + (top ? ' data-style="color:var(--acc)"' : '') + '>Tier ' + (i + 1) + '</div>\n'
      + '        <div class="tier-name"' + (top ? ' data-style="color:var(--acc-light)"' : '') + '>' + esc(t.name) + '</div>\n'
      + '        <div class="tier-clients">' + esc(range) + '</div>\n'
      + '        <div class="tier-earn">$' + REFERRAL_MONTHLY + '</div>\n'
      + '        <div class="tier-earn-sub">a month per client, for ' + t.referralMonths + ' months</div>\n'
      + '        <div class="tier-duration">' + Math.round(t.commissionRate * 100) + '% commission on what you bill</div>\n'
      + '      </div>';
  }).join('\n');
  s = between(s, 'tiers', cards + '\n');
  const ex = 50000, fee = T.estimateStripeFeeCents(ex);
  const first = T.splitBilling(ex, T.TIERS[0].commissionRate, fee), free = T.splitBilling(ex, 0, fee);
  const rates = T.TIERS.map(t => Math.round(t.commissionRate * 100) + '%').join(' → ');
  const box =
    '      <div>\n'
    + '        <div class="section-label">Service commission</div>\n'
    + '        <h3 data-style="font-family:var(--font-d);font-size:32px;font-style:italic;color:var(--t1);margin-bottom:12px">You set the rate.<br><em data-style="color:var(--acc-light)">Our share falls as you grow.</em></h3>\n'
    + '        <p data-style="font-size:14px;color:var(--t2);line-height:1.8;margin-bottom:20px">Bill clients for tax filing, bookkeeping, advisory or anything else, directly through FinFlow. Your first ' + T.ONBOARDING_FREE_BELOW + ' clients are commission-free; after that FinFlow\'s commission is ' + esc(rates) + ' by tier. The card processor\'s fee is taken first, at its real cost.</p>\n'
    + '        <ul data-style="list-style:none;display:flex;flex-direction:column;gap:10px">\n'
    + '          <li data-style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--t2)"><span data-style="color:var(--green)">✓</span> Client pays by card — secure Stripe checkout</li>\n'
    + '          <li data-style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--t2)"><span data-style="color:var(--green)">✓</span> Payment receipt sent to the client automatically</li>\n'
    + (T.minBillMinor('usd') != null ? '          <li data-style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--t2)"><span data-style="color:var(--green)">✓</span> Minimum bill: ' + money(T.minBillMinor('usd')) + '</li>\n' : '')
    + '          <li data-style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--t2)"><span data-style="color:var(--green)">✓</span> Referral pay: $' + REFERRAL_MONTHLY + ' a month per active, paying client, for the months your tier gives — it stops if the client stops paying</li>\n'
    + '        </ul>\n'
    + '      </div>\n'
    + '      <div id="commission-example">\n'
    + '        <div data-style="font-size:12px;color:var(--t2);text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px">Example: a ' + money(ex) + ' bill at the ' + esc(T.TIERS[0].name) + ' tier</div>\n'
    + '        <div class="commission-calc">\n'
    + '          <div class="calc-row"><span data-style="color:var(--t2)">Your fee</span><span class="calc-val dim">' + money(first.billedCents) + '</span></div>\n'
    + '          <div class="calc-row"><span data-style="color:var(--t2)">Card processing (est. 2.9% + 30¢)</span><span class="calc-val amber">− ' + money(first.stripeFeeCents) + '</span></div>\n'
    + '          <div class="calc-row"><span data-style="color:var(--t2)">FinFlow commission (' + Math.round(T.TIERS[0].commissionRate * 100) + '%)</span><span class="calc-val amber">− ' + money(first.commissionCents) + '</span></div>\n'
    + '          <div class="calc-row"><span data-style="color:var(--t1);font-weight:600">You receive</span><span class="calc-val green">' + money(first.accountantNetCents) + '</span></div>\n'
    + '        </div>\n'
    + '        <div data-style="margin-top:12px;font-size:12px;color:var(--t2);text-align:center">While you have fewer than ' + T.ONBOARDING_FREE_BELOW + ' clients, you keep <span data-style="color:var(--acc)">' + money(free.accountantNetCents) + '</span> of the same bill.</div>\n'
    + '      </div>\n';
  s = between(s, 'commission', box);
  const maxRef = REFERRAL_MONTHLY * Math.max(...T.TIERS.map(t => t.referralMonths));
  const stat = (num, lbl) => '  <div class="stat-item">\n    <div class="stat-num">' + esc(num) + '</div>\n    <div class="stat-lbl">' + esc(lbl) + '</div>\n  </div>';
  s = between(s, 'stats', [stat('$0', 'Monthly fee to list'), stat('0%', 'Commission on your first ' + T.ONBOARDING_FREE_BELOW + ' clients'),
    stat(Math.round(T.TIERS[0].commissionRate * 100) + '% → ' + Math.round(T.TIERS[T.TIERS.length - 1].commissionRate * 100) + '%', 'Commission after that, falling by tier'),
    stat('$' + maxRef, 'Max referral pay per client')].join('\n') + '\n');
  return s;
}

if (require.main === module) {
  const before = fs.readFileSync(FILE, 'utf8');
  const after = render(before);
  if (after !== before) { fs.writeFileSync(FILE, after); console.log('[gen-tier-cards] accountants.html tiers + commission written from tier-config.js'); }
  else console.log('[gen-tier-cards] accountants.html already matches tier-config.js');
}
module.exports = { render };
