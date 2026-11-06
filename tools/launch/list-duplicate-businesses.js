'use strict';
/**
 * list-duplicate-businesses.js — READ-ONLY (Rule 7 / Rule 8). F108: one account may not hold two businesses with the
 * same name (ignoring case and outer spaces) in the same country. Lists every existing group that breaks it, so the owner
 * can decide which to rename. Until none are left, the ux_entities_user_name_country index is not created (boot logs it).
 * It changes NOTHING: SELECT statements only, no transaction control, no write mode. Prints ids only — no names of
 * people, no e-mail addresses.
 *
 *   PowerShell (copy the address in Railway first — never paste it into chat):
 *     $env:DATABASE_URL = (Get-Clipboard).Trim(); $env:DATABASE_URL.StartsWith("postgres")
 *     node tools/launch/list-duplicate-businesses.js
 *     Remove-Item Env:DATABASE_URL
 *
 * Imports only `pg` — never database.js, whose import would run initDB() DDL (Rule 7).
 */
const { Client } = require('pg');
(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-duplicate-businesses.js'); process.exit(2); }
  const url = process.env.DATABASE_URL;
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows } = await c.query(
      `SELECT user_id, upper(data->>'country') AS country, lower(btrim(data->>'name')) AS key,
              array_agg(id ORDER BY id) AS ids, array_agg(created_at::date ORDER BY id) AS created
         FROM entities
        WHERE COALESCE(data->>'country', '') <> ''
        GROUP BY user_id, upper(data->>'country'), lower(btrim(data->>'name'))
       HAVING count(*) > 1
        ORDER BY user_id, country`);
    for (const r of rows) console.log(`account #${r.user_id}  ${r.country}  ${r.ids.length} businesses with the same name: ids ${r.ids.join(', ')} (created ${r.created.map(d => d.toISOString().slice(0, 10)).join(', ')})`);
    const { rows: [idx] } = await c.query(`SELECT count(*)::int n FROM pg_indexes WHERE indexname = 'ux_entities_user_name_country'`);
    console.log(`\n${rows.length} group(s) share a name and country · the unique index is ${idx.n ? 'IN PLACE' : 'NOT in place yet'}. Nothing was changed.`);
  } catch (e) {
    console.error('FAILED:', e && e.message, e && e.code, '\n', e && e.stack);
    if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message, x && x.code);
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
