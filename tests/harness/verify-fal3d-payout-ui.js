'use strict';
/**
 * verify-fal3d-payout-ui.js — FA-L3d: what the accountant and the admin SEE about referral pay sent by Stripe.
 * The pages run in jsdom with the REAL tier-config.js; the API is canned in the exact shape the routes return
 * (verify-fal3d-referral-payouts proves the routes on real Postgres). Checks:
 *   accountant: a paid referral row reads "Sent to Stripe · 3 Nov 2026" with the transfer id on hover; a row in a
 *     failed payout reads "Sending to Stripe"; a bill the client has not paid says so (bug: raw "awaiting_payment");
 *     the Pending card says the pay is sent automatically once Stripe transfers are on, else to finish connecting.
 *   admin: "Referral Pay Owed" is the PENDING referral total ($20.00), not every referral row ($50.00); the payouts
 *     table lists the failed transfer first with Stripe's reason; rows a transfer is paying have no mark-paid box.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal3d-payout-ui.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const settle = async (n) => { for (let i = 0; i < (n || 40); i++) await new Promise(r => setTimeout(r, 50)); };

function page(file, api, inject) {
  let html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
  const stub = `<script>window.fetch=function(u,o){var p=String(u).split('?')[0];var data=(${JSON.stringify(api)})[p];return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(data==null?{}:data);}});};window.open=function(){};</script>`;
  html = html.replace(/<head>/i, () => '<head>' + stub);
  // the REAL shared date helper (FA-L3f) — jsdom does not fetch <script src>
  html = html.replace('<script src="/finflow-dates.js"></script>', () => '<script>' + fs.readFileSync(path.join(ROOT, 'public', 'finflow-dates.js'), 'utf8') + '</script>');
  if (inject) html = inject(html);
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://finflow.test/' + file }).window;
}

const EARNINGS = [
  { id: 1, type: 'referral', amount_cents: 1000, description: 'Referral commission — month 1 of 3', status: 'paid', period_month: '2026-10-01', payout_id: 7, payout_status: 'sent', payout_transfer_id: 'tr_SENT1', payout_sent_at: '2026-11-03T09:00:00.000Z' },
  { id: 2, type: 'referral', amount_cents: 1000, description: 'Referral commission — month 2 of 3', status: 'pending', period_month: '2026-11-01', payout_id: 8, payout_status: 'failed', payout_transfer_id: null, payout_sent_at: null },
  { id: 3, type: 'service_commission', amount_cents: 43520, description: 'Q2 bookkeeping', status: 'awaiting_payment', period_month: null },
];

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  FA-L3d — referral pay sent by Stripe, as the accountant and the admin see it\n' + '='.repeat(78) + '\n');
  try {
    const tierSrc = fs.readFileSync(path.join(ROOT, 'tier-config.js'), 'utf8');
    for (const ready of [true, false]) {
      const api = {
        '/api/accountants/me': { first_name: 'Ada', last_name: 'Lovelace', status: 'verified', referral_code: 'ADA123', email: 'ada@x.test', conduct: { accepted: true, version: '1.0', current: '1.0', blocked: false } },
        '/api/accountants/clients': [], '/api/accountants/pending-requests': [], '/api/accountants/deadlines': [],
        '/api/accountants/earnings': { earnings: EARNINGS, totalFormatted: '$455.20' },
        '/api/accountants/stripe-status': { connected: ready, chargesEnabled: ready, payoutsEnabled: ready, transfersEnabled: ready },
      };
      const w = page('accountant-dashboard.html', api, h => h.replace('<script src="/tier-config.js"></script>', () => '<script>' + tierSrc + '</script>'));
      await settle();
      try { await w.loadEarnings(); await w.checkStripeStatus(); } catch (_) {}
      const d = w.document;
      const sub = (d.getElementById('earn-pending-sub') || {}).textContent || '';
      if (ready) {
        const rows = [...d.querySelectorAll('#earnings-tbody tr')].map(r => r.textContent.replace(/\s+/g, ' '));
        const badge1 = [...d.querySelectorAll('#earnings-tbody tr')][0];
        A('accountant: the paid referral row reads "Sent to Stripe · 3 Nov 2026" (bug: "paid")', /Sent to Stripe · 3 Nov 2026/.test(rows[0] || ''), rows[0]);
        A('  …with the Stripe transfer id on hover', !!badge1 && /tr_SENT1/.test((badge1.querySelector('[title]') || {}).title || ''), '');
        A('accountant: the row in a failed payout reads "Sending to Stripe" (bug: "pending")', /Sending to Stripe/.test(rows[1] || ''), rows[1]);
        A('accountant: the unpaid bill reads "Client has not paid yet" (bug: "awaiting_payment")', /Client has not paid yet/.test(rows[2] || '') && !/awaiting_payment/.test(rows[2] || ''), rows[2]);
        A('accountant (Stripe transfers on): Pending card says it is sent automatically each month', /sent to your Stripe account automatically/i.test(sub), sub);
      } else {
        A('accountant (Stripe not ready): Pending card says to finish connecting Stripe (bug: "Next payment: 1st of month")', /Finish connecting Stripe/.test(sub), sub);
      }
      w.close();
    }

    const adminApi = {
      '/api/admin/earnings': {
        records: [
          { id: 1, type: 'referral', amount_cents: 1000, description: 'month 1', status: 'paid', period_month: '2026-10-01', payout_id: 7, payout_status: 'sent', first_name: 'Ada', last_name: 'L', firm: 'F' },
          { id: 2, type: 'referral', amount_cents: 1000, description: 'month 2', status: 'pending', period_month: '2026-11-01', payout_id: 8, payout_status: 'failed', first_name: 'Ada', last_name: 'L', firm: 'F' },
          { id: 4, type: 'referral', amount_cents: 1000, description: 'no Stripe', status: 'pending', period_month: '2026-11-01', payout_id: null, first_name: 'Cy', last_name: 'C', firm: 'G' },
        ],
        summary: { commission_cents: '0', referral_cents: '5000', referral_owed_cents: '2000', paid_cents: '3000' },
        payouts: [
          { id: 8, period_month: '2026-11-01', amount_cents: 1000, currency: 'usd', status: 'failed', stripe_transfer_id: null, attempts: 3, last_error: 'Insufficient funds in Stripe account.', first_name: 'Ada', last_name: 'L', firm: 'F' },
          { id: 7, period_month: '2026-10-01', amount_cents: 3000, currency: 'usd', status: 'sent', stripe_transfer_id: 'tr_SENT1', attempts: 1, last_error: null, first_name: 'Ada', last_name: 'L', firm: 'F' },
        ],
      },
    };
    const w = page('admin.html', adminApi);
    await settle();
    try { await w.loadEarnings(); } catch (e) { A('admin loadEarnings ran', false, e.message); }
    const d = w.document;
    const owed = (d.getElementById('earn-referral') || {}).textContent || '';
    A('admin: "Referral Pay Owed" is the pending total $20.00 (bug: every referral row, $50.00)', owed === '$20.00', owed);
    const prow = [...d.querySelectorAll('#payouts-tbody tr')].map(r => r.textContent.replace(/\s+/g, ' '));
    A('admin: the failed payout is listed first with Stripe\'s reason and its 3 attempts', prow.length === 2 && /failed/.test(prow[0]) && /Insufficient funds/.test(prow[0]) && /\b3\b/.test(prow[0]), prow.join(' || '));
    A('admin: the sent payout shows its Stripe transfer and the month (Nov 2026 / Oct 2026, never the month before)', /tr_SENT1/.test(prow[1] || '') && /Oct 2026/.test(prow[1] || '') && /Nov 2026/.test(prow[0] || ''), prow.join(' || '));
    const boxes = [...d.querySelectorAll('#earnings-tbody .earn-check')].map(b => b.value);
    A('admin: only the row no transfer is paying (#4) can be ticked "mark paid by hand"', boxes.join() === '4', boxes.join());
    w.close();
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-L3d payout UI)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
