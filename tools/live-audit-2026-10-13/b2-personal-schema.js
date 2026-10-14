'use strict';
/**
 * b2-personal-schema.js — READ-ONLY (Rule 7). Live audit 2026-10-13 B2, fourth instrument.
 *
 * The id-gap probe showed run #2's mark-paid DID attempt the owner-salary INSERT (sequence value 112 handed out, no
 * row now). Replaying the same steps on the deployed code against a scratch database books the row fine. If the
 * live INSERT failed, the live table must differ from the scratch one. This prints how personal_transactions is built
 * on the database it is pointed at — columns (type, NOT NULL, default), constraints, triggers and indexes — so the
 * two can be compared line by line. Catalog reads only: no row data at all.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"; node tools/live-audit-2026-10-13/b2-personal-schema.js; Remove-Item Env:DATABASE_URL
 *
 * SELECT statements only, no transaction control, no write mode. Imports only `pg`.
 */
const { Client } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node b2-personal-schema.js'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows: cols } = await c.query(
      `SELECT column_name AS col, data_type AS type, is_nullable AS nullable, COALESCE(column_default, '') AS dflt
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'personal_transactions' ORDER BY ordinal_position`);
    console.log('COLUMNS'); console.table(cols);
    const { rows: cons } = await c.query(
      `SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conrelid = 'public.personal_transactions'::regclass ORDER BY conname`);
    console.log('CONSTRAINTS (c = check, f = foreign key, p = primary key, u = unique)'); console.table(cons);
    const { rows: trg } = await c.query(
      `SELECT tgname AS name, tgenabled AS enabled, pg_get_triggerdef(oid) AS definition
         FROM pg_trigger WHERE tgrelid = 'public.personal_transactions'::regclass AND NOT tgisinternal ORDER BY tgname`);
    console.log('TRIGGERS'); console.table(trg);
    const { rows: idx } = await c.query(
      `SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'personal_transactions' ORDER BY indexname`);
    console.log('INDEXES'); console.table(idx);
    const { rows: pol } = await c.query(
      `SELECT polname AS name, polcmd AS cmd, pg_get_expr(polqual, polrelid) AS using_expr, pg_get_expr(polwithcheck, polrelid) AS check_expr
         FROM pg_policy WHERE polrelid = 'public.personal_transactions'::regclass ORDER BY polname`);
    const { rows: [rls] } = await c.query(`SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced FROM pg_class WHERE oid = 'public.personal_transactions'::regclass`);
    console.log('ROW-LEVEL SECURITY', JSON.stringify(rls)); console.table(pol);
  } catch (err) {
    console.error('FAILED:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
