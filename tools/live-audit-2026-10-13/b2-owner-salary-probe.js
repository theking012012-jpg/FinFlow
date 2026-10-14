'use strict';
/**
 * b2-owner-salary-probe.js — READ-ONLY (Rule 7). Live audit 2026-10-13 B2: "the owner salary did not reach Personal".
 *
 * Answers, for one account: which roster entries are flagged as the owner (per business), which payroll runs exist and
 * whether each has an owner line, and which owner-salary rows exist on Personal. If no roster entry is flagged
 * is_owner in the business, a paid run crosses nothing by design — that is the suspected cause (LA3).
 *
 *   PowerShell:  $env:DATABASE_URL="<prod url>"; node tools/live-audit-2026-10-13/b2-owner-salary-probe.js you@example.com
 *
 * SELECT statements only, parameters bound, no transaction control, no write mode. Imports only `pg` — NOT
 * ../../database.js (whose import side effects could run DDL).
 */
const { Client } = require('pg');

(async () => {
  const email = process.argv[2];
  if (!email || !process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node b2-owner-salary-probe.js <account email>'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows: [u] } = await c.query(`SELECT id, data->>'name' AS name FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]);
    if (!u) { console.log('No user with that email.'); return; }
    console.log(`user ${u.id} (${u.name})\n`);

    const { rows: ents } = await c.query(`SELECT id, data->>'name' AS name, data->>'currency' AS cur FROM entities WHERE user_id = $1 ORDER BY id`, [u.id]);
    console.log('BUSINESSES'); console.table(ents);

    const { rows: roster } = await c.query(
      `SELECT id, entity_id, data->>'fname' AS fname, data->>'lname' AS lname, data->>'gross' AS gross,
              COALESCE(data->>'is_owner','(absent)') AS is_owner, data->>'emp_type' AS emp_type
         FROM payroll WHERE user_id = $1 ORDER BY entity_id, id`, [u.id]);
    console.log('ROSTER (is_owner must be true on exactly one entry per business for the salary to cross)'); console.table(roster);

    const { rows: runs } = await c.query(
      `SELECT r.id, r.entity_id, r.period, r.status, r.paid_date, r.total_gross,
              (SELECT COUNT(*)::int FROM payroll_run_lines l JOIN payroll p ON p.id = l.payroll_id
                WHERE l.run_id = r.id AND COALESCE(p.data->>'is_owner','false') IN ('true','1')) AS owner_lines,
              (SELECT string_agg(l.employee_name || ' net ' || COALESCE(l.net_pay::text,'NULL'), '; ') FROM payroll_run_lines l WHERE l.run_id = r.id) AS lines
         FROM payroll_runs r WHERE r.user_id = $1 ORDER BY r.id`, [u.id]);
    console.log('PAYROLL RUNS (owner_lines = lines whose roster entry is flagged owner)'); console.table(runs);

    const { rows: pers } = await c.query(
      `SELECT id, entity_id, data->>'description' AS description, data->>'amount' AS amount, data->>'currency' AS cur,
              data->>'tx_date' AS tx_date, data->>'payroll_run_id' AS run_id
         FROM personal_transactions WHERE user_id = $1 AND data->>'source' = 'payroll' ORDER BY id`, [u.id]);
    console.log('PERSONAL owner-salary rows'); console.table(pers);
  } catch (err) {
    console.error('FAILED:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
