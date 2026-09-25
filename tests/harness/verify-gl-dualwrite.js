'use strict';
/*
 * verify-gl-dualwrite.js - GL hardening: NON-primary write paths post to the ledger LIVE (not only via
 * backfill), so the books are correct the moment the row is created:
 *   - the recurring scheduler (runRecurringScheduler) materialises an invoice + a bill and each posts
 *     its canonical GL entry (Dr AR/Cr Revenue ; Dr Opex/Cr AP), keyed exactly as backfill.
 *   - a subsequent backfill posts NOTHING new (real-time + backfill are mutually idempotent).
 *   - recordExternalInvoicePayment (Stripe pay-link / webhook path) settles the receivable live
 *     (Dr Cash / Cr AR), idempotent on the processor id - a replay books no second entry.
 *   - reconciliation to the reports holds throughout.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-dualwrite.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks, glReconcile, backfillLedgerForUser, runRecurringScheduler, recordExternalInvoicePayment } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL HARDENING - non-primary write paths post to the ledger LIVE\n' + '='.repeat(78) + '\n');
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: 'gldw@finflow.test', role: 'owner', plan: 'business' }])).rows[0].id;
    const e1 = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Sched Co', currency: 'USD' }])).rows[0].id;
    const e2 = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Pay Co', currency: 'USD' }])).rows[0].id;
    const legs = async (st, sid) => Object.fromEntries((await c.query(`SELECT la.code, ll.debit::float AS debit, ll.credit::float AS credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id JOIN ledger_entries le ON le.id=ll.entry_id WHERE le.user_id=$1 AND le.source_type=$2 AND le.source_id=$3`, [uid, st, sid])).rows.map(l => [l.code, l]));
    const tbDiff = async (eid) => { const r = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0]; return r.d - r.cr; };
    const entryCount = async () => (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n;

    // ── 1) Recurring scheduler → live dual-write ──────────────────────────────────────────────
    await c.query(`INSERT INTO recurring_invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, e1, { status: 'active', client: 'RecCust', amount: 1000, next_run: '2026-06-01', frequency: 'monthly' }]);
    await c.query(`INSERT INTO recurring_bills (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, e1, { status: 'active', vendor: 'RecVendor', amount: 300, next_run: '2026-06-01', frequency: 'monthly' }]);
    await runRecurringScheduler();
    const invId = (await c.query(`SELECT id FROM invoices WHERE user_id=$1 AND data->>'client'='RecCust' ORDER BY id ASC LIMIT 1`, [uid])).rows[0] && (await c.query(`SELECT id FROM invoices WHERE user_id=$1 AND data->>'client'='RecCust' ORDER BY id ASC LIMIT 1`, [uid])).rows[0].id;
    const billId = (await c.query(`SELECT id FROM bills WHERE user_id=$1 AND data->>'vendor'='RecVendor' ORDER BY id ASC LIMIT 1`, [uid])).rows[0] && (await c.query(`SELECT id FROM bills WHERE user_id=$1 AND data->>'vendor'='RecVendor' ORDER BY id ASC LIMIT 1`, [uid])).rows[0].id;
    A('scheduler materialised the recurring invoice', !!invId);
    A('scheduler materialised the recurring bill', !!billId);
    const il = await legs('invoice', invId);
    A('recurring invoice posted LIVE: Dr AR(1100)=1000 / Cr Revenue(4000)=1000', il['1100'] && near(il['1100'].debit, 1000) && il['4000'] && near(il['4000'].credit, 1000), JSON.stringify(il));
    const bl = await legs('bill', billId);
    A('recurring bill posted LIVE: Dr Opex(6000)=300 / Cr AP(2000)=300', bl['6000'] && near(bl['6000'].debit, 300) && bl['2000'] && near(bl['2000'].credit, 300), JSON.stringify(bl));
    A('scheduler entity trial balance ties to zero', near(await tbDiff(e1), 0), 'diff=' + (await tbDiff(e1)));

    // Backdate issue + entry dates into the FY window, then reconcile to reports.
    await c.query(`UPDATE invoices SET data = data || '{"issue_date":"2026-06-15"}'::jsonb WHERE id=$1`, [invId]);
    await c.query(`UPDATE bills SET data = data || '{"issue_date":"2026-06-15"}'::jsonb WHERE id=$1`, [billId]);
    await c.query(`UPDATE ledger_entries SET entry_date='2026-06-15' WHERE user_id=$1 AND source_type IN ('invoice','bill') AND source_id IN ($2,$3)`, [uid, invId, billId]);
    let books = await computeBooks(uid, e1, 'year');
    A('scheduler: computeBooks revenue=1000, opex=300', near(books.revenue, 1000) && near(books.opex, 300), 'rev=' + books.revenue + ' opex=' + books.opex);
    let rec = await glReconcile(uid, e1);
    A('scheduler: GL reconciles to reports + booksBalanced', rec.reconciledToReports === true && rec.booksBalanced === true, JSON.stringify(rec.detail));

    // Backfill posts nothing new (real-time + backfill mutually idempotent).
    const before = await entryCount();
    await backfillLedgerForUser(uid, { entityId: e1 });
    A('backfill after live posting adds NO new entries', (await entryCount()) === before, 'before=' + before + ' after=' + (await entryCount()));

    // ── 2) recordExternalInvoicePayment → live cash leg ───────────────────────────────────────
    const inv2 = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, e2, { client: 'PayCust', amount: 1000, status: 'pending', issue_date: '2026-06-10', amount_paid: 0 }])).rows[0].id;
    // accrue the invoice on the ledger (as the create path would)
    await backfillLedgerForUser(uid, { entityId: e2 });
    A('invoice2 accrual present (Cr Revenue 1000)', (await legs('invoice', inv2))['4000'] && near((await legs('invoice', inv2))['4000'].credit, 1000));
    const before2 = await entryCount();
    const r1 = await recordExternalInvoicePayment({ invoiceId: inv2, amountMinor: 40000, method: 'Card (Stripe)', idemKey: 'stripe:sess_test_1' });
    A('external payment recorded (400)', r1 && r1.recorded === true && near(r1.amount, 400), JSON.stringify(r1));
    const pid = r1.id;
    const pl = await legs('invoice_payment', pid);
    A('external payment posted LIVE: Dr Cash(1000)=400 / Cr AR(1100)=400', pl['1000'] && near(pl['1000'].debit, 400) && pl['1100'] && near(pl['1100'].credit, 400), JSON.stringify(pl));
    // replay same processor id → idempotent, no second payment, no second ledger entry
    const cntAfter1 = await entryCount();
    const r2 = await recordExternalInvoicePayment({ invoiceId: inv2, amountMinor: 40000, method: 'Card (Stripe)', idemKey: 'stripe:sess_test_1' });
    A('replay of same processor id books nothing new', r2 && r2.recorded === false && (await entryCount()) === cntAfter1, JSON.stringify(r2) + ' entries ' + cntAfter1 + '->' + (await entryCount()));
    // backdate the payment ledger date in-period, reconcile (payment is P&L-neutral)
    await c.query(`UPDATE ledger_entries SET entry_date='2026-06-15' WHERE user_id=$1 AND source_type='invoice_payment' AND source_id=$2`, [uid, pid]);
    rec = await glReconcile(uid, e2);
    A('external payment: still reconciled + TB ties', rec.reconciledToReports === true && near(await tbDiff(e2), 0), JSON.stringify(rec.detail));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (non-primary paths post to the ledger live)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
