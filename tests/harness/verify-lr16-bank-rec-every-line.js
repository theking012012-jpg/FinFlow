'use strict';
/**
 * verify-lr16-bank-rec-every-line.js — LR16: Bank Rec accounts for every feed line, and shows the book balance.
 *  • A bank line already dealt with (booked as an expense, paid a bill, ignored) carried reconcile_state and was in no
 *    list — live: 54 feed lines, 50 + 1 shown, 3 debits (TRANSFER TO SAVINGS, PAPER SUPPLY CO, BANK FEE) nowhere.
 *  • The page showed neither side of a reconciliation. The book side is now the ledger's cash, read through the balance
 *    sheet's own writer (glBalanceSheet); the statement side is not in the feed, and the page says so — never a guess.
 *  • Banking "TOTAL BALANCE $0" with a linked bank: nothing fills the account list (the feed carries no balance), so a
 *    confident $0 was made up. Now "—" · "Not supplied by the bank feed".
 *
 * Real scratch Postgres, real server, real SPA (bundle). Five feed lines: credit 300 (matched to a 300 payment),
 * credit 75 (unmatched), debit 40 (booked as expense), debit 12 (ignored), debit 650 (still to do).
 *   lines shown across the page's lists: 5                  (old: 3 — the two dealt-with debits vanish; measured)
 *   "Dealt with" names them: Booked as expense · Ignored    (old: no list)
 *   book balance = the Balance Sheet's cash, hand-derived: +300 payment − 40 expense = 260   (old: not shown)
 *   statement balance "—" · "Not supplied by the bank feed"  (old: not shown)
 *   Banking total balance "—"                                 (old: "$0")
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr16-bank-rec-every-line.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR16 — Bank Rec: every feed line in one list; book vs statement balance; no made-up $0\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR16 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      const line = async (desc, amount, tx_type, tx_date) => (await client.query(
        `INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
        [userId, e.id, { description: desc, amount, tx_type, tx_date, source: 'banking', category: 'Uncategorized' }])).rows[0].id;
      const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 300, date: '2026-07-01', due_date: '2026-07-31', status: 'pending' });
      const pay = await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 300, payment_date: '2026-07-10', method: 'Bank' });
      const c1 = await line('ACME PAYMENT', 300, 'credit', '2026-07-10');
      await line('UNKNOWN DEPOSIT', 75, 'credit', '2026-07-11');
      const d1 = await line('PAPER SUPPLY CO', 40, 'debit', '2026-07-12');
      const d2 = await line('TRANSFER TO SAVINGS', 12, 'debit', '2026-07-13');
      await line('BIG SUPPLIER', 650, 'debit', '2026-07-14');
      await J('POST', '/api/bank-reconciliation/match', { banking_id: c1, invoice_payment_id: (pay.payment || pay).id });
      await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: d1 });
      await J('POST', '/api/bank-reconciliation/ignore', { banking_id: d2 });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('bank-rec');
    await settle(40, 50);
    await w.loadBankRec(); await settle(20, 30);
    const rowsIn = id => d.querySelectorAll('#' + id + ' .tx-row').length;
    const shown = rowsIn('brec-bank-list') + rowsIn('brec-matched-list') + rowsIn('brec-debits-list') + (d.getElementById('brec-done-list') ? rowsIn('brec-done-list') : 0);
    eq('every one of the 5 feed lines is in a list', shown, 5, 3);
    const done = ((d.getElementById('brec-done-list') || {}).textContent || '');
    eq('"Dealt with" names what each became', [/PAPER SUPPLY CO[\s\S]*Booked as expense/.test(done), /TRANSFER TO SAVINGS[\s\S]*Ignored/.test(done)], [true, true], [false, false]);

    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    const bs = await (await w.fetch('/api/reports/balance-sheet', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    eq('the Balance Sheet cash is the hand-derived 260 (300 in − 40 booked)', [bs.cashTracked, bs.cash], [true, 260], undefined);
    eq('book balance = the Balance Sheet cash', t('brec-book-bal'), '$260', '');
    // LR31 (2026-10-21): the statement side is now entered from the bank statement — none entered here, so it says so.
    eq('statement balance is not invented', [t('brec-stmt-bal'), t('brec-stmt-sub')], ['—', 'Not entered — type it from your bank statement'], ['', '']);

    w.showPage('banking'); await settle(30, 40);
    if (typeof w.renderBanking === 'function') w.renderBanking();
    await settle(5, 10);
    // LR31 (2026-10-21): no bank linked on this seed — the caption names why there is no balance.
    eq('Banking total balance: no made-up $0', [t('bank-total-bal'), t('bank-total-sub')], ['—', 'No bank account linked'], ['$0', '']);   // old: the caption had no id → read ''
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
