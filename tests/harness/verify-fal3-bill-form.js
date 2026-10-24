'use strict';
/**
 * verify-fal3-bill-form.js — FA-L3: the accountant dashboard's bill form takes its minimum from tier-config.js,
 * the same rule bill-client enforces (verify-accountant-billing proves the server side on real Postgres).
 * Before: the form hard-coded $50 (label, input min, the preview and the submit check) while the server had none.
 *
 * The page runs in jsdom with the REAL tier-config.js inlined (not a stub). The API is canned — this checks only
 * what the form shows and sends. Discriminating (Rule 4): run 2 raises tier-config's USD minimum to $75.00; a
 * hard-coded 50 would still label "$50", hide no preview at $60 and send a $60 bill.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal3-bill-form.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');

const API = {
  '/api/accountants/me': { first_name: 'Ada', last_name: 'Lovelace', status: 'verified', referral_code: 'ADA123', avg_rating: 0, firm: 'Lovelace & Co', specialisation: 'Tax', email: 'ada@x.test', country: 'United Kingdom', conduct: { accepted: true, version: '1.0', current: '1.0', blocked: false } },
  '/api/accountants/clients': [{ id: 7, client_name: 'Cara Client', client_email: 'cara@x.test', client_plan: 'business', status: 'active', subscription_status: 'active', referral_month: 1, referral_months_total: 3 }],
  '/api/accountants/earnings': { earnings: [], totalFormatted: '$0.00' },
  '/api/accountants/pending-requests': [],
  '/api/accountants/deadlines': [],
  '/api/accountants/stripe-status': { connected: true },
};

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function boot(tierSrc) {
  let html = fs.readFileSync(path.join(ROOT, 'public', 'accountant-dashboard.html'), 'utf8');
  const fetchStub = `<script>window.__calls=[];window.open=function(){};window.fetch=function(u,o){var p=String(u).split('?')[0];window.__calls.push({p:p,body:o&&o.body||null});var data=(${JSON.stringify(API)})[p];if(p==='/api/accountants/bill-client')data={url:'https://checkout.stripe.test/c/x',emailed:true};return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(data==null?{}:data);}});};</script>`;
  if (html.split('<script src="/tier-config.js"></script>').length !== 2) throw new Error('tier-config <script> tag not found once');
  html = html.replace('<script src="/tier-config.js"></script>', () => fetchStub + '<script>' + tierSrc + '</script>');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://finflow.test/accountant-dashboard.html' });
  for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 50));
  const w = dom.window;
  w.__toasts = [];
  w.toast = (m) => w.__toasts.push(String(m));
  return w;
}

async function scenario(label, tierSrc, minCents, below, at) {
  const w = await boot(tierSrc);
  const d = w.document;
  const money = c => '$' + (c / 100).toFixed(2);
  try { w.openBillModal(); } catch (e) { A(label + ': openBillModal ran', false, e.message); return; }
  const lbl = (d.getElementById('bill-amount-label') || {}).textContent || '';
  A(label + ': the label reads "minimum ' + money(minCents) + '"', lbl.includes('minimum ' + money(minCents)), lbl);
  A(label + ': the input\'s min is ' + (minCents / 100), d.getElementById('bill-amount').min === String(minCents / 100), d.getElementById('bill-amount').min);
  const amt = d.getElementById('bill-amount');
  const type = v => { amt.value = String(v); amt.dispatchEvent(new w.Event('input', { bubbles: true })); };
  type(below);
  A(label + ': no fee preview at $' + below + ' (below the minimum)', d.getElementById('bill-breakdown').style.display === 'none', d.getElementById('bill-breakdown').style.display);
  d.getElementById('bill-client-select').value = '7';
  d.getElementById('bill-description').value = 'Q2 bookkeeping';
  await w.submitBill();
  const sentBelow = w.__calls.filter(c => c.p === '/api/accountants/bill-client');
  A(label + ': $' + below + ' is refused with "Minimum bill is ' + money(minCents) + '" and nothing is sent', sentBelow.length === 0 && w.__toasts.includes('Minimum bill is ' + money(minCents)), JSON.stringify({ toasts: w.__toasts, sent: sentBelow.length }));
  type(at);
  A(label + ': the fee preview shows at $' + at, d.getElementById('bill-breakdown').style.display === 'block', d.getElementById('bill-breakdown').style.display);
  await w.submitBill();
  const sent = w.__calls.filter(c => c.p === '/api/accountants/bill-client');
  const body = sent[0] ? JSON.parse(sent[0].body) : {};
  A(label + ': $' + at + ' is sent as amountCents ' + Math.round(at * 100), sent.length === 1 && body.amountCents === Math.round(at * 100), JSON.stringify(body));
  w.close();
}

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  FA-L3 — the bill form\'s minimum is tier-config\'s (the server\'s rule)\n' + '='.repeat(78) + '\n');
  try {
    const real = fs.readFileSync(path.join(ROOT, 'tier-config.js'), 'utf8');
    const T = require(path.join(ROOT, 'tier-config.js'));
    A('tier-config: the USD minimum bill is 5000 cents ($50.00)', T.minBillMinor('usd') === 5000, String(T.minBillMinor && T.minBillMinor('usd')));
    await scenario('run 1 (real tier-config, $50.00)', real, 5000, 49.99, 50);
    const raised = real.replace('const MIN_BILL_MINOR = { usd: 5000 };', 'const MIN_BILL_MINOR = { usd: 7500 };');
    A('run 2 setup: tier-config raised to $75.00', raised !== real);
    await scenario('run 2 (tier-config raised to $75.00)', raised, 7500, 60, 75);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-L3 bill form)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
