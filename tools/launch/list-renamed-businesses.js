'use strict';
/**
 * list-renamed-businesses.js — READ-ONLY (Rule 7 / Rule 8). NEW-28: on an account with several businesses, saving
 * Settings while a business WITHOUT its own letterhead name was active renamed it to the account-wide business name
 * (the Settings box showed the account's name, and saving renames the active business from that box). Fixed
 * 2026-11-06. This lists the evidence so the owner can decide which to rename back; it changes NOTHING.
 *
 *   1. Every recorded business rename (audit trail: old name → new name, when, how). COMPLETE ONLY FROM 2026-11-03,
 *      when the database began recording every row change (F90); before that this rename path wrote no audit entry.
 *   2. On accounts with 2+ businesses: every business whose name EQUALS the account-wide business name — the ones the
 *      bug can have produced (a business legitimately named that way is also listed: the owner judges).
 * Prints ids and business names only — no people's names, no e-mail addresses.
 *
 *   PowerShell (copy the address in Railway first — never paste it into chat):
 *     $env:DATABASE_URL = (Get-Clipboard).Trim(); $env:DATABASE_URL.StartsWith("postgres")
 *     node tools/launch/list-renamed-businesses.js
 *     Remove-Item Env:DATABASE_URL
 *
 * SELECT statements only, no transaction control, no write mode. Imports only `pg` — never database.js (Rule 7).
 */
const { Client } = require('pg');
(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-renamed-businesses.js'); process.exit(2); }
  const url = process.env.DATABASE_URL;
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows: renames } = await c.query(
      `SELECT a.user_id, a.record_id, a.old_data->>'name' AS old_name, a.new_data->>'name' AS new_name, a.changed_at, a.source
         FROM audit_trail a
        WHERE a.table_name = 'entities' AND a.old_data ? 'name' AND a.new_data ? 'name'
          AND a.old_data->>'name' IS DISTINCT FROM a.new_data->>'name'
        ORDER BY a.user_id, a.changed_at`);
    console.log('1. Recorded business renames (complete from 2026-11-03):');
    for (const r of renames) console.log(`   account #${r.user_id}  business #${r.record_id}  "${r.old_name}" → "${r.new_name}"  ${r.changed_at.toISOString().slice(0, 16).replace('T', ' ')} UTC${r.source ? '  (' + r.source + ')' : ''}`);
    if (!renames.length) console.log('   none');

    const { rows: cand } = await c.query(
      `WITH acct AS (SELECT user_id, btrim(data->>'business_name') AS bn FROM user_settings WHERE data->>'key' IS NULL),
            multi AS (SELECT user_id FROM entities GROUP BY user_id HAVING count(*) > 1)
       SELECT e.user_id, e.id, e.data->>'name' AS name, e.updated_at
         FROM entities e JOIN multi m ON m.user_id = e.user_id JOIN acct a ON a.user_id = e.user_id
        WHERE a.bn <> '' AND lower(btrim(e.data->>'name')) = lower(a.bn)
        ORDER BY e.user_id, e.id`);
    console.log('\n2. On accounts with 2+ businesses — businesses named exactly like the account-wide business name:');
    for (const r of cand) console.log(`   account #${r.user_id}  business #${r.id}  "${r.name}"  (last changed ${r.updated_at.toISOString().slice(0, 10)})`);
    if (!cand.length) console.log('   none');
    console.log(`\n${renames.length} recorded rename(s) · ${cand.length} candidate business(es). Nothing was changed.`);
  } catch (e) {
    console.error('FAILED:', e && e.message, e && e.code, '\n', e && e.stack);
    if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message, x && x.code);
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
