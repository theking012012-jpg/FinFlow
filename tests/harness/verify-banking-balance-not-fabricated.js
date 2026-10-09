'use strict';
/**
 * verify-banking-balance-not-fabricated.js — L46 (F123 principle: an untracked balance is shown as untracked, never as $0).
 * Banking "Total Balance" = Σ (parseFloat(a.balance) || 0) over `bankAccounts` (app-main.js renderBanking) — but
 * `bankAccounts` is a constant empty array that nothing populates (the feed carries transactions, not balances), so the card
 * read $0.00 for every user (live: $0.00 beside a list of transactions, while the books held $25,740 of cash).
 * Fix: with no known balance the card reads "—" and says it is not tracked; known balances (if any are ever loaded) are
 * summed and counted, unknown ones are never coerced to 0.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes: two bank-feed transactions in July — credit 500 (07-10), debit 120 (07-12).
 * EXPECTED: Total Balance "—" with a not-tracked note (bug: "$0.00"); CONTROL: Inflow (MTD) $500, Outflow (MTD) $120.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-banking-balance-not-fabricated.js
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
    console.log('\n' + '='.repeat(78) + '\n  L46 — Banking "Total Balance" is never a fabricated $0\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L46 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/banking', { desc: 'Client wire', amount: 500, type: 'credit', date: '2026-07-10', cat: 'Income' });
      await J('/api/banking', { desc: 'Office supplies', amount: 120, type: 'debit', date: '2026-07-12', cat: 'Office' });
    } });
    const { window: w, settle } = ctx;
    await settle(40, 100);
    w.showPage('banking'); await settle(40, 100);
    if (typeof w.renderBanking === 'function') { try { w.renderBanking(); } catch (_) {} await settle(10, 100); }
    const d = w.document;
    const tot = ((d.getElementById('bank-total-bal') || {}).textContent || '').trim();
    const card = (d.getElementById('bank-total-bal') || {}).parentElement;
    const cardText = ((card || {}).textContent || '').replace(/\s+/g, ' ');
    console.log('  [card] ' + cardText);
    A('CONTROL: Inflow (MTD) $500 · Outflow (MTD) $120', near(num((d.getElementById('bank-inflow') || {}).textContent), 500) && near(num((d.getElementById('bank-outflow') || {}).textContent), 120),
      'in=' + (d.getElementById('bank-inflow') || {}).textContent + ' out=' + (d.getElementById('bank-outflow') || {}).textContent);
    A('Total Balance is not a fabricated "$0.00" (no account balance is known)', !/\d/.test(tot), 'bank-total-bal="' + tot + '"');
    A('the card says the balance is not tracked', /not tracked/i.test(cardText), 'card="' + cardText + '"');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (banking balance not fabricated)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
