'use strict';
/**
 * b2-owner-salary-idgaps.js — READ-ONLY (Rule 7). Live audit 2026-10-13 B2, third instrument.
 *
 * The timeline probe showed run #2 (October 2026) MARK_PAID at 2026-10-14 00:46:24 UTC and VOID at 00:50:58, with the
 * owner flagged since before run #1. Replaying that exact sequence on the deployed main code books the row and the
 * Personal page shows it — so either the live INSERT was attempted and failed (the deployed code only console.errors
 * it), or something stopped the sync before it reached the INSERT.
 *
 * Postgres hands out an id (sequence value) whenever an INSERT is attempted, and never gives it back — a row inserted
 * then deleted (by VOID), or an INSERT that failed, leaves a GAP in personal_transactions.id. This prints every gap in
 * the table with the creation times of the rows on either side (ids and timestamps only — no row contents, no other
 * user's data), plus the sequence's current value.
 *   A gap bracketing 00:46:24 (and one bracketing 18:23:23 on 2026-10-11 for run #1) → an INSERT was attempted then.
 *   No gap there                                                                    → the sync never reached the INSERT.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"; node tools/live-audit-2026-10-13/b2-owner-salary-idgaps.js; Remove-Item Env:DATABASE_URL
 *
 * SELECT statements only, no parameters needed, no transaction control, no write mode. Imports only `pg`.
 */
const { Client } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node b2-owner-salary-idgaps.js'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows: [seq] } = await c.query(`SELECT pg_get_serial_sequence('personal_transactions', 'id') AS name`);
    let last = null;
    if (seq && seq.name) { const { rows: [l] } = await c.query(`SELECT last_value, is_called FROM ${seq.name.replace(/[^\w."]/g, '')}`); last = l; }
    const { rows: [mx] } = await c.query(`SELECT COUNT(*)::int AS rows, MAX(id) AS max_id FROM personal_transactions`);
    console.log(`personal_transactions: ${mx.rows} rows, max id ${mx.max_id}; sequence ${seq && seq.name} last_value ${last && last.last_value} (is_called ${last && last.is_called})`);
    console.log('(ids above max id up to last_value were also handed out — inserted then deleted, or failed)\n');

    const { rows: gaps } = await c.query(
      `SELECT id + 1 AS missing_from, next_id - 1 AS missing_to,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS row_before_created_utc,
              to_char(next_created AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS row_after_created_utc
         FROM (SELECT id, created_at, LEAD(id) OVER (ORDER BY id) AS next_id, LEAD(created_at) OVER (ORDER BY id) AS next_created
                 FROM personal_transactions) t
        WHERE next_id > id + 1
        ORDER BY id`);
    console.log('GAPS in personal_transactions.id (each = ids handed out but no row now)'); console.table(gaps);

    const { rows: tail } = await c.query(
      `SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_utc
         FROM personal_transactions
        WHERE created_at BETWEEN '2026-10-11 17:00:00+00' AND '2026-10-11 22:00:00+00'
           OR created_at BETWEEN '2026-10-13 23:00:00+00' AND '2026-10-14 02:00:00+00'
        ORDER BY id`);
    console.log('ROWS created around the two mark-paid moments (11 Oct 18:23, 14 Oct 00:46 UTC) — ids and times only'); console.table(tail);
  } catch (err) {
    console.error('FAILED:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
