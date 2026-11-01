'use strict';
/**
 * list-multi-active-accountants.js — READ-ONLY (Rule 7 / Rule 8). NEW-12: lists clients who have MORE THAN ONE active
 * accountant link. Where any exist, initDB does not build idx_acc_clients_one_active and warns; this shows what is
 * blocking it so the owner can decide (the client keeps one, the rest are revoked by the client or by an owner-run fix).
 * My Accountant shows only the newest link, so the older active one is invisible to the client. Changes NOTHING.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"; node tools/launch/list-multi-active-accountants.js; Remove-Item Env:DATABASE_URL
 *
 * Safety: SELECT only, a READ ONLY session, no transaction control. Imports only `pg` — never database.js (its initDB
 * would fire DDL).
 */
const { Client } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Set DATABASE_URL first.'); process.exit(2); }
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const { rows } = await c.query(
      `SELECT ac.user_id, count(*)::int AS n,
              array_agg(ac.accountant_id || ' ' || trim(a.first_name || ' ' || a.last_name) || ' (activated ' || COALESCE(to_char(ac.activated_at, 'YYYY-MM-DD'), '?') || ')'
                        ORDER BY ac.activated_at DESC NULLS LAST) AS links
         FROM accountant_clients ac JOIN accountants a ON a.id = ac.accountant_id
        WHERE ac.status = 'active' GROUP BY ac.user_id HAVING count(*) > 1 ORDER BY ac.user_id`);
    const idx = (await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, ['idx_acc_clients_one_active'])).rowCount > 0;
    console.log(`\n${rows.length} client(s) with more than one active accountant · unique index ${idx ? 'PRESENT' : 'NOT built'}`);
    for (const r of rows) console.log(`  user ${r.user_id} · ${r.n} active: ${r.links.join(' | ')}  (the client sees only one of them in My Accountant)`);
    console.log('\nNothing was changed.');
  } catch (err) {
    console.error('FAILED:', err.message, err.code || '', '\n', err.stack);
    if (err.errors) for (const e of err.errors) console.error(' -', e.message);
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
