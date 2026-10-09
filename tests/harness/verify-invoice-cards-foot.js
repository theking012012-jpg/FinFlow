'use strict';
/**
 * verify-invoice-cards-foot.js — L52. Invoices page cards: Billed − Collected ≠ Outstanding whenever an open credit note exists —
 * Outstanding is net of credit notes (F58 / L35) but no card shows them (live: 44,350 − 29,550 = 14,800 vs Outstanding 13,550,
 * the $1,250 of credits invisible). And Billed / Collected are ALL recognised invoices to date (deliberately — the same set as
 * Outstanding, so the cards reconcile) but were labelled with the active period ("Full Year · Jan – Dec"), which they are not.
 * Fix: the Outstanding sub-line states the credits it nets ("· net of $X credits"), and Billed is labelled "All time · issued to
 * date". Billed − Collected − credits = Outstanding on screen.
 *
 * Seed (UTC entity, January FY, pinned 2026-07-25), real routes:
 *   invoice A 1,000 pending issued 2025-12-10 (PRIOR fiscal year) · invoice B 2,000 issued 07-01 then paid in full (07-05)
 *   credit note 300 Open (07-06, customer of A)
 * HAND-COMPUTED: Billed 3,000 · Collected 2,000 · Outstanding 700 (1,000 − 300) · sub-line mentions 300 · Billed label "All time".
 * BUGGY (pre-fix): no credits on any card (3,000 − 2,000 ≠ 700) · Billed labelled "Full Year …" although it includes a 2025 invoice.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-invoice-cards-foot.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const num = t => parseFloat(String(t || '').replace(/[^\d.\-]/g, ''));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L52 — Invoices page cards foot: Billed − Collected − credits = Outstanding\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L52 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/invoices', { client: 'Alpha', amount: 1000, status: 'pending', issue_date: '2025-12-10', due_date: '2026-01-10' });
      const b = await J('/api/invoices', { client: 'Beta', amount: 2000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01' });
      await J('/api/invoice-payments', { invoice_id: b.id, amount: 2000, payment_date: '2026-07-05', method: 'bank' });
      await J('/api/credit-notes', { customer: 'Alpha', num: 'CN-1', amount: 300, date: '2026-07-06' });
    } });
    const { window: w, settle } = ctx;
    await settle(60, 100);
    w.showPage('invoices'); await settle(30, 100);
    if (typeof w.updateInvoices === 'function') { try { w.updateInvoices(); } catch (_) {} await settle(10, 100); }
    const d = w.document;
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    const billed = num(t('inv-billed')), paid = num(t('inv-paid')), out = num(t('inv-out'));
    console.log('  [cards] billed=' + t('inv-billed') + ' (' + t('inv-billed-lbl') + ') paid=' + t('inv-paid') + ' out=' + t('inv-out') + ' (' + t('inv-out-cnt') + ')');
    A('CONTROL: Billed 3,000 · Collected 2,000 · Outstanding 700', near(billed, 3000) && near(paid, 2000) && near(out, 700), JSON.stringify({ billed, paid, out }));
    const credits = num((t('inv-out-cnt').match(/net of\s*([-$\d,.\s]+)/i) || [])[1]);
    A('Outstanding sub-line states the credits it nets: 300 (bug: absent)', near(credits, 300), 'inv-out-cnt="' + t('inv-out-cnt') + '"');
    A('cards foot on screen: Billed − Collected − credits = Outstanding', near(billed - paid - credits, out), JSON.stringify({ billed, paid, credits, out }));
    A('Billed is labelled "All time" — it includes a prior-fiscal-year invoice (bug: "Full Year …")', /all time/i.test(t('inv-billed-lbl')), 'inv-billed-lbl="' + t('inv-billed-lbl') + '"');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (invoice cards foot)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
