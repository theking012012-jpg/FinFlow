'use strict';
/**
 * b2-owner-salary-timeline.js — READ-ONLY (Rule 7). Live audit 2026-10-13 B2, second instrument.
 *
 * The first probe (b2-owner-salary-probe.js) found, on the owner's account: Sam Owner flagged is_owner = true, both
 * payroll runs carry an owner line, both runs are now VOIDED, and Personal has no owner-salary row. Voiding DELETES
 * that row (syncOwnerSalaryFromRun 'void'), so the current state cannot say whether the salary crossed when the runs
 * were marked paid. This prints the account's TIMELINE from the audit trail, oldest first:
 *   - every roster change (payroll CREATE / UPDATE / DELETE) with is_owner before → after
 *   - every payroll-run event (APPROVE / MARK_PAID / VOID …)
 * and, next to it, the ledger entries for the runs and every Personal row that looks like an owner salary.
 * The question it answers: at the moment each run was MARK_PAID, was the owner's roster entry already is_owner = true?
 *   yes → the crossing should have booked a row (and VOID later removed it) — check the timestamps of both events.
 *   no  → nothing could cross at mark-paid by design (the flag came later) — the LA3 explanation.
 *
 *   PowerShell (a NEW window; never paste the URL into chat — it contains the database password):
 *     $env:DATABASE_URL="<prod url>"; node tools/live-audit-2026-10-13/b2-owner-salary-timeline.js "you@example.com"; Remove-Item Env:DATABASE_URL
 *
 * SELECT statements only, parameters bound, no transaction control, no write mode. Imports only `pg` — NOT
 * ../../database.js (whose import side effects could run DDL).
 */
const { Client } = require('pg');

(async () => {
  const email = process.argv[2];
  if (!email || !process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node b2-owner-salary-timeline.js <account email>'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows: [u] } = await c.query(`SELECT id, data->>'name' AS name FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]);
    if (!u) { console.log('No user with that email.'); return; }
    console.log(`user ${u.id} (${u.name})\n`);

    const { rows: tl } = await c.query(
      `SELECT id, to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS utc, table_name AS tbl, record_id AS rec, action,
              COALESCE(new_data->>'fname', old_data->>'fname', '') || ' ' || COALESCE(new_data->>'lname', old_data->>'lname', '') AS who,
              COALESCE(old_data->>'is_owner', '') AS owner_before, COALESCE(new_data->>'is_owner', '') AS owner_after,
              COALESCE(new_value, '') AS new_value
         FROM audit_trail
        WHERE user_id = $1 AND table_name IN ('payroll', 'payroll_runs')
        ORDER BY changed_at, id`, [u.id]);
    console.log('TIMELINE — roster (payroll) and payroll-run events, oldest first (UTC)'); console.table(tl);

    const { rows: led } = await c.query(
      `SELECT e.id, to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_utc, e.source_type, e.source_id AS run_id,
              to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.status, e.reversal_of
         FROM ledger_entries e
        WHERE e.user_id = $1 AND e.source_type IN ('payroll_run', 'payroll_paid')
        ORDER BY e.created_at, e.id`, [u.id]);
    console.log('LEDGER — payroll accrual (payroll_run) and cash-out (payroll_paid) entries, with reversals'); console.table(led);

    const { rows: pers } = await c.query(
      `SELECT id, entity_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_utc,
              data->>'description' AS description, data->>'amount' AS amount, data->>'source' AS source,
              data->>'payroll_run_id' AS run_id, data->>'recurring_profile_id' AS profile_id
         FROM personal_transactions
        WHERE user_id = $1 AND (data->>'source' = 'payroll' OR data->>'description' ILIKE '%owner salary%' OR data->>'category' = 'Salary')
        ORDER BY id`, [u.id]);
    console.log('PERSONAL — every row that could be an owner salary (any source, any entity_id)'); console.table(pers);
  } catch (err) {
    console.error('FAILED:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
