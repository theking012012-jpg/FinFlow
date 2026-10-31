'use strict';
/**
 * list-duplicate-bank-lines.js — READ-ONLY (Rule 7 / Rule 8). NEW-3: lists bank-feed lines that share a source id in one
 * scope (the same statement line / Plaid transaction / Belvo transaction imported twice). Where any exist, initDB does
 * not build that key's unique index (idx_bank_line_*) and warns; this shows what is blocking it so the owner can decide.
 * Changes NOTHING.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"; node tools/launch/list-duplicate-bank-lines.js; Remove-Item Env:DATABASE_URL
 *
 * Safety: SELECT only, bound parameters, a READ ONLY session, no transaction control. Imports only `pg` — never
 * database.js (its initDB would fire DDL).
 */
const { Client } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Set DATABASE_URL first.'); process.exit(2); }
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    let total = 0;
    for (const key of ['import_key', 'plaid_txn_id', 'belvo_txn_id']) {
      const { rows } = await c.query(
        `SELECT user_id, entity_id, data->>$1 AS source_id, count(*)::int AS n, array_agg(id ORDER BY id) AS ids,
                min(data->>'description') AS description, min(data->>'amount') AS amount, min(data->>'tx_date') AS tx_date
           FROM personal_transactions WHERE data->>$1 IS NOT NULL
          GROUP BY user_id, entity_id, data->>$1 HAVING count(*) > 1 ORDER BY user_id, entity_id`, [key]);
      const idx = (await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`,
        ['idx_bank_line_' + (key === 'import_key' ? 'import_key' : key === 'plaid_txn_id' ? 'plaid_txn' : 'belvo_txn')])).rowCount > 0;
      console.log(`\n${key}: ${rows.length} duplicated source id(s) · unique index ${idx ? 'PRESENT' : 'NOT built'}`);
      for (const r of rows) console.log(`  user ${r.user_id} · ${r.entity_id == null ? 'Personal' : 'business ' + r.entity_id} · ${r.n}× "${r.description}" ${r.amount} ${r.tx_date} · line ids ${r.ids.join(', ')} (the first is the original)`);
      total += rows.length;
    }
    console.log(`\n${total} duplicated source id(s) in all. Nothing was changed.`);
  } catch (err) {
    console.error('FAILED:', err.message, err.code || '', '\n', err.stack);
    if (err.errors) for (const e of err.errors) console.error(' -', e.message);
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
