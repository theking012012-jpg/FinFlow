#!/usr/bin/env node
'use strict';
/**
 * prod-readonly-counts.js — READ-ONLY instrument for the owner (money audit 2026-10-09).
 * Measures how much of the owner's REAL data is touched by the data-dependent findings, so each fix can be
 * sized and any cleanup decided separately (CLAUDE.md Rule 8). Writes NOTHING:
 *   - SELECT statements only, every value bound as a parameter, no transaction control;
 *   - does NOT require database.js (its import would load the app's pool / schema code) — opens its own
 *     pg client from DATABASE_URL, exactly like scripts/report-paid-without-payment.js;
 *   - every query is independent: one that fails (e.g. a table that does not exist) prints its full error
 *     and the rest still run.
 *
 *   DATABASE_URL=postgres://...  node tools/money-audit-2026-10-09/prod-readonly-counts.js
 *   DATABASE_URL=postgres://...  USER_ID=12  node tools/money-audit-2026-10-09/prod-readonly-counts.js   # one account
 */
const { Client } = require('pg');

// A JSONB text field as a number, or NULL when it is not a plain number (never a cast error mid-query).
const N = (expr) => `(CASE WHEN (${expr}) ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$' THEN (${expr})::numeric END)`;
const USER = `($1::int IS NULL OR %t.user_id = $1::int)`;
const u = (alias) => USER.replace('%t', alias);

const CHECKS = [
  { id: 'M5a', title: "Invoices marked paid/partial whose amount_paid is below the amount (counted as unpaid in Outstanding/AR)",
    sql: `SELECT i.user_id, i.entity_id, lower(i.data->>'status') AS status, count(*)::int AS rows,
                 round(sum(${N("i.data->>'amount'")} - COALESCE(${N("i.data->>'amount_paid'")},0)),2) AS shortfall
            FROM invoices i
           WHERE ${u('i')} AND lower(i.data->>'status') IN ('paid','partial')
             AND COALESCE(${N("i.data->>'amount_paid'")},0) < ${N("i.data->>'amount'")} - 0.005
           GROUP BY 1,2,3 ORDER BY 1,2,3` },
  { id: 'M5b', title: "Bills marked paid/partial whose amount_paid is below the amount (counted as owed in AP)",
    sql: `SELECT b.user_id, b.entity_id, lower(b.data->>'status') AS status, count(*)::int AS rows,
                 round(sum(${N("b.data->>'amount'")} - COALESCE(${N("b.data->>'amount_paid'")},0)),2) AS shortfall
            FROM bills b
           WHERE ${u('b')} AND lower(b.data->>'status') IN ('paid','partial')
             AND COALESCE(${N("b.data->>'amount_paid'")},0) < ${N("b.data->>'amount'")} - 0.005
           GROUP BY 1,2,3 ORDER BY 1,2,3` },
  { id: 'M1', title: 'Invoice payments whose invoice no longer exists (cash with no revenue/AR behind it)',
    sql: `SELECT ip.user_id, ip.entity_id, count(*)::int AS rows, round(sum(ip.amount),2) AS amount
            FROM invoice_payments ip
           WHERE ${u('ip')} AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = ip.invoice_id)
           GROUP BY 1,2 ORDER BY 1,2` },
  { id: 'M2', title: 'Payments made linked to a bill that no longer exists (cash out with no expense behind it)',
    sql: `SELECT p.user_id, p.entity_id, count(*)::int AS rows, round(sum(${N("p.data->>'amount'")}),2) AS amount
            FROM payments_made p
           WHERE ${u('p')} AND COALESCE(p.data->>'bill_id','') <> ''
             AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.id::text = p.data->>'bill_id')
           GROUP BY 1,2 ORDER BY 1,2` },
  { id: 'M17', title: 'Bank lines marked booked/matched whose expense or payment no longer exists (stranded, never re-surface)',
    sql: `SELECT t.user_id, t.entity_id, t.data->>'reconcile_state' AS state, count(*)::int AS rows,
                 round(sum(${N("t.data->>'amount'")}),2) AS amount
            FROM personal_transactions t
           WHERE ${u('t')} AND t.data->>'source' = 'banking'
             AND ( (t.data->>'reconcile_state' = 'expense' AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id::text = t.data->>'reconcile_ref'))
                OR (t.data->>'reconcile_state' = 'bill'    AND NOT EXISTS (SELECT 1 FROM payments_made p WHERE p.id::text = t.data->>'reconcile_ref')) )
           GROUP BY 1,2,3 ORDER BY 1,2,3` },
  { id: 'M21', title: 'Posted journals whose date differs from their ledger entry date (list date != books date)',
    sql: `SELECT j.user_id, j.entity_id, j.id AS journal_id, left(j.data->>'date',10) AS journal_date, le.entry_date::text AS ledger_date
            FROM journals j
            JOIN ledger_entries le ON le.user_id = j.user_id AND le.source_type = 'journal' AND le.source_id = j.id
                                  AND le.reversal_of IS NULL AND le.status = 'posted'
           WHERE ${u('j')} AND lower(j.data->>'status') = 'posted'
             AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of = le.id)
             AND left(j.data->>'date',10) IS DISTINCT FROM le.entry_date::text
           ORDER BY 1,3` },
  { id: 'M22', title: 'Paid payroll runs whose cash-out ledger date differs from the paid date',
    sql: `SELECT pr.user_id, pr.entity_id, pr.id AS run_id, pr.paid_date::text AS paid_date, le.entry_date::text AS ledger_date
            FROM payroll_runs pr
            JOIN ledger_entries le ON le.user_id = pr.user_id AND le.source_type = 'payroll_paid' AND le.source_id = pr.id
                                  AND le.reversal_of IS NULL AND le.status = 'posted'
           WHERE ${u('pr')} AND lower(pr.status) = 'paid' AND pr.paid_date IS NOT NULL
             AND le.entry_date <> pr.paid_date
           ORDER BY 1,3` },
  { id: 'M23', title: 'Money rows with NO business attached (counted under every business view; F26-b legacy)',
    sql: `SELECT t AS table_name, user_id, count(*)::int AS rows, round(sum(amt),2) AS amount FROM (
              SELECT 'invoices' t, user_id, ${N("data->>'amount'")} amt FROM invoices WHERE entity_id IS NULL
        UNION ALL SELECT 'expenses', user_id, ${N("data->>'amount'")} FROM expenses WHERE entity_id IS NULL
        UNION ALL SELECT 'bills', user_id, ${N("data->>'amount'")} FROM bills WHERE entity_id IS NULL
        UNION ALL SELECT 'sales_receipts', user_id, ${N("data->>'amount'")} FROM sales_receipts WHERE entity_id IS NULL
        UNION ALL SELECT 'payments_made', user_id, ${N("data->>'amount'")} FROM payments_made WHERE entity_id IS NULL
        UNION ALL SELECT 'credit_notes', user_id, ${N("data->>'amount'")} FROM credit_notes WHERE entity_id IS NULL
        UNION ALL SELECT 'vendor_credits', user_id, ${N("data->>'amount'")} FROM vendor_credits WHERE entity_id IS NULL
        UNION ALL SELECT 'invoice_payments', user_id, amount FROM invoice_payments WHERE entity_id IS NULL
        UNION ALL SELECT 'payroll_runs', user_id, total_gross FROM payroll_runs WHERE entity_id IS NULL
          ) x WHERE ($1::int IS NULL OR user_id = $1::int) GROUP BY 1,2 ORDER BY 1,2` },
  { id: 'M40', title: 'Money rows with no usable business date (a ledger rebuild would stop on them)',
    sql: `SELECT t AS table_name, user_id, count(*)::int AS rows FROM (
              SELECT 'expenses' t, user_id FROM expenses WHERE COALESCE(data->>'expense_date','') = ''
        UNION ALL SELECT 'payments_made', user_id FROM payments_made WHERE COALESCE(data->>'date','') = ''
        UNION ALL SELECT 'sales_receipts', user_id FROM sales_receipts WHERE COALESCE(data->>'date','') = ''
        UNION ALL SELECT 'invoices (no issue_date)', user_id FROM invoices WHERE COALESCE(data->>'issue_date','') = '' AND lower(COALESCE(data->>'status','')) <> 'draft'
        UNION ALL SELECT 'bills (no issue_date)', user_id FROM bills WHERE COALESCE(data->>'issue_date','') = ''
          ) x WHERE ($1::int IS NULL OR user_id = $1::int) GROUP BY 1,2 ORDER BY 1,2` },
  { id: 'M50', title: 'Ledger entries whose business has been deleted',
    sql: `SELECT le.user_id, le.entity_id, count(*)::int AS entries
            FROM ledger_entries le
           WHERE ${u('le')} AND le.entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = le.entity_id)
           GROUP BY 1,2 ORDER BY 1,2` },
  { id: 'M9', title: 'Accounts with invoice payments in more than one business (the Payments Received page mixes them)',
    sql: `SELECT ip.user_id, count(DISTINCT ip.entity_id)::int AS businesses, count(*)::int AS payments
            FROM invoice_payments ip WHERE ${u('ip')}
           GROUP BY 1 HAVING count(DISTINCT ip.entity_id) > 1 ORDER BY 1` },
];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(2); }
  const userId = process.env.USER_ID ? parseInt(process.env.USER_ID, 10) : null;
  if (process.env.USER_ID && !Number.isInteger(userId)) { console.error('USER_ID must be an integer.'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /sslmode=require|supabase/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined });
  await c.connect();
  let failed = 0;
  console.log(`FinFlow money audit — read-only counts${userId != null ? ' for user ' + userId : ' (all accounts)'} — ${new Date().toISOString()}\n`);
  try {
    for (const ch of CHECKS) {
      try {
        const { rows } = await c.query(ch.sql, [userId]);
        console.log(`[${ch.id}] ${ch.title}`);
        if (!rows.length) console.log('    none');
        else { console.table(rows); }
        console.log('');
      } catch (err) {
        failed++;
        console.error(`[${ch.id}] QUERY FAILED: ${err && err.message} (code ${err && err.code})`);
        if (err && err.stack) console.error(err.stack);
        if (err && err.errors) for (const e of err.errors) console.error('  -', e && e.message);
        console.log('');
      }
    }
  } finally { await c.end(); }
  if (failed) { console.error(`${failed} check(s) failed to run — see the errors above.`); process.exitCode = 1; }
}
main().catch(e => {
  console.error('fatal:', e && e.message, e && e.code, e && e.stack);
  if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message);
  process.exit(2);
});
