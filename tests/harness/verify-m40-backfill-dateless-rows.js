'use strict';
/**
 * M40 (money audit 2026-10-09): a ledger rebuild must not abort on a legacy row with no business date.
 * BUG: the backfill dated expenses / payments made / sales receipts by their date field only; a dateless row
 * threw inside postLedgerEntry AFTER the reset had cleared the ledger, leaving it part-built.
 * Seed: invoice 900 (dated) + legacy rows with NO date field: expense 40, payment made 15, sales receipt 25.
 *   correct: rebuild succeeds, every row has a ledger entry, balance sheet ties (source 'gl')
 *   bug: rebuild fails part-way (entries missing).
 */
const { run } = require('./moneyFixKit.js');

run('M40 — ledger rebuild survives legacy dateless rows', async ({ newOwner, c, eq, A }) => {
  const { uid, J, http, ids } = await newOwner('M40');
  await J('POST', '/api/invoices', { client: 'Acme', amount: 900, status: 'pending', issue_date: '2026-06-02', due_date: '2026-06-30', idempotency_key: 'm40-inv' });
  const ins = (t, data) => c.query(`INSERT INTO ${t} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,'2026-06-20T12:00:00Z','2026-06-20T12:00:00Z') RETURNING id`, [uid, ids[0], data]);
  const e = (await ins('expenses', { description: 'Legacy expense', category: 'Office', amount: 40 })).rows[0].id;
  const p = (await ins('payments_made', { vendor: 'Legacy vendor', amount: 15 })).rows[0].id;
  const s = (await ins('sales_receipts', { customer: 'Walk-in', amount: 25 })).rows[0].id;
  const r = await http.post('/api/gl/backfill?reset=1', {});
  eq('rebuild succeeds', r.status, 200, 500);
  const has = async (type, id) => (await c.query(`SELECT 1 FROM ledger_entries WHERE user_id=$1 AND source_type=$2 AND source_id=$3`, [uid, type, id])).rows.length === 1;
  eq('legacy expense / payment made / receipt each have a ledger entry', [await has('expense', e), await has('bill_payment', p), await has('sales_receipt', s)], [true, true, true], [false, false, false]);
  const { rows: [d] } = await c.query(`SELECT entry_date::text AS d FROM ledger_entries WHERE user_id=$1 AND source_type='expense' AND source_id=$2`, [uid, e]);
  eq('the dateless expense is dated by its creation day', d && d.d, '2026-06-20');
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  eq('balance sheet is GL-sourced after the rebuild', bs.source, 'gl', 'computeBooks');
});
