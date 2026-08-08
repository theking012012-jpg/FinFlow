'use strict';
/**
 * f79-status-inventory.js — READ-ONLY status-value inventory for F79.
 *
 * WHY THIS EXISTS (CLAUDE.md Rule 8): F79 asks whether to add DB-level CHECK constraints on
 * status columns. A CHECK is validated against EXISTING rows at ALTER time — so a constraint
 * that omits a value some legacy row already holds makes the migration FAIL (or, worse, is
 * written to reject a real historical state). We cannot know the safe allowlist until we know
 * what values the live data actually contains. This tool answers exactly that and nothing else.
 *
 * WHAT IT DOES: for every relation with a real `status` column, and every generic table with a
 * JSONB `data` column, it reports the DISTINCT status values and their row counts. It discovers
 * the relations from the catalog (information_schema), so no table can be missed or assumed.
 *
 * SAFETY (CLAUDE.md Rule 7):
 *   - SELECT / information_schema ONLY. No INSERT/UPDATE/DELETE, no DDL, no transaction control.
 *   - No apply/write mode exists.
 *   - Does NOT require('./database.js') or ('./server.js') — it builds its own pg Pool, so
 *     importing an app module cannot fire initDB()/DDL as a side effect.
 *   - Prints real error detail (message, code, stack) on failure.
 *
 * USAGE (owner, against production or any DB — it only reads):
 *   DATABASE_URL="postgres://…" node tools/f79-status-inventory.js
 */

/**
 * Run the inventory against an already-connected pg client/pool. Returns an array of
 * { rel, kind, rows:[{value,n}] }. Pure reads.
 */
async function inventory(db) {
  const out = [];

  // 1) Real status columns (VARCHAR/TEXT) — these CAN take a CHECK constraint.
  const cols = await db.query(
    `SELECT table_name FROM information_schema.columns
      WHERE column_name = 'status' AND table_schema = 'public'
      ORDER BY table_name`
  );
  for (const { table_name } of cols.rows) {
    const r = await db.query(
      `SELECT status AS value, COUNT(*)::int AS n FROM "${table_name}" GROUP BY status ORDER BY n DESC, value`
    );
    out.push({ rel: `${table_name}.status`, kind: 'column', rows: r.rows });
  }

  // 2) JSONB statuses (status lives inside data) — a column CHECK is not expressible; only an
  //    expression CHECK on (data->>'status') is, and it must match the real casing/values below.
  const jcols = await db.query(
    `SELECT table_name FROM information_schema.columns
      WHERE column_name = 'data' AND data_type = 'jsonb' AND table_schema = 'public'
      ORDER BY table_name`
  );
  for (const { table_name } of jcols.rows) {
    const r = await db.query(
      `SELECT data->>'status' AS value, COUNT(*)::int AS n
         FROM "${table_name}" WHERE data ? 'status'
        GROUP BY data->>'status' ORDER BY n DESC, value`
    );
    if (r.rows.length) out.push({ rel: `${table_name}.data->>'status'`, kind: 'jsonb', rows: r.rows });
  }

  return out;
}

function print(out) {
  if (!out.length) { console.log('(no status-bearing relations found)'); return; }
  for (const s of out) {
    console.log(`\n== ${s.rel}  [${s.kind}] ==`);
    for (const r of s.rows) {
      const v = r.value === null ? '(null)' : `'${r.value}'`;
      console.log(`  ${v.padEnd(22)} ${r.n}`);
    }
  }
  console.log('');
}

if (require.main === module) {
  (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error('Set DATABASE_URL (this tool only reads).'); process.exit(1); }
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url });
    try {
      print(await inventory(pool));
    } catch (e) {
      console.error('ERROR:', e && e.message, e && e.code ? `(code ${e.code})` : '');
      if (e && e.stack) console.error(e.stack);
      process.exitCode = 1;
    } finally {
      await pool.end().catch(() => {});
    }
  })();
}

module.exports = { inventory, print };
