'use strict';
/**
 * list-status-violations.js — READ-ONLY (Rule 7 / Rule 8). F79: every status column and JSONB status now has a CHECK
 * constraint, added NOT VALID — new writes are checked, existing rows were never scanned. This lists every existing
 * row whose status a constraint would reject (by asking Postgres itself: each NOT VALID constraint's own expression),
 * so the owner can decide what to do. It changes NOTHING: SELECT statements only, no transaction control, no write mode.
 * Note: until such a row is corrected, ANY update to it (even of another field) is refused by its constraint.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"
 *     node tools/launch/list-status-violations.js
 *     Remove-Item Env:DATABASE_URL
 *
 * Imports only `pg` — never database.js, whose import would run initDB() DDL (Rule 7).
 */
const { Client } = require('pg');
(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-status-violations.js'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  let total = 0;
  try {
    await c.connect();
    const { rows: cons } = await c.query(
      `SELECT conrelid::regclass::text AS tbl, conname, pg_get_expr(conbin, conrelid) AS expr
         FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'chk\\_%\\_status' ORDER BY 1`);
    for (const k of cons) {
      // The expression comes from pg_constraint (the database's own definition), and the identifiers are quoted — no
      // user input is interpolated.
      const tbl = '"' + k.tbl.replace(/"/g, '""') + '"';
      const { rows } = await c.query(`SELECT id, ${/data/.test(k.expr) ? "data->>'status'" : 'status'} AS status FROM ${tbl} WHERE NOT (${k.expr}) ORDER BY id LIMIT 200`);
      const { rows: [n] } = await c.query(`SELECT count(*)::int n FROM ${tbl} WHERE NOT (${k.expr})`);
      total += n.n;
      console.log(`${k.tbl.padEnd(32)} ${String(n.n).padStart(5)} row(s)` + (n.n ? '  e.g. ' + rows.slice(0, 10).map(r => `#${r.id} "${r.status}"`).join(', ') : ''));
    }
    console.log(`\n${cons.length} status constraints checked · ${total} existing row(s) do not fit. Nothing was changed.`);
  } catch (e) {
    console.error('FAILED:', e && e.message, e && e.code, '\n', e && e.stack);
    if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message, x && x.code);
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
