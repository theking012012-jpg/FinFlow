'use strict';
/**
 * list-embargoed-country-records.js — READ-ONLY (Rule 7 / Rule 8). Lists every business, and every personal bank
 * setting, whose country is on the comprehensive-embargo list in sanctions.js (Cuba, Iran, North Korea). New ones are
 * refused by the server since this commit; this reports any that already exist so the owner can decide. It changes
 * NOTHING: SELECT statements only, parameters bound, no transaction control, no write mode.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"
 *     node tools/launch/list-embargoed-country-records.js
 *     Remove-Item Env:DATABASE_URL
 *
 * Imports only `pg` and sanctions.js (a constant table, no side effects) — never database.js, whose import would
 * run initDB() DDL (Rule 7).
 */
const { Client } = require('pg');
const { EMBARGOED } = require('../../sanctions.js');
(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-embargoed-country-records.js'); process.exit(2); }
  const codes = Object.keys(EMBARGOED);
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const ents = (await c.query(
      `SELECT e.id, e.user_id, e.data->>'name' AS name, upper(e.data->>'country') AS country, u.data->>'email' AS owner_email, e.created_at
         FROM entities e LEFT JOIN users u ON u.id = e.user_id
        WHERE upper(e.data->>'country') = ANY($1::text[]) ORDER BY e.id`, [codes])).rows;
    const banks = (await c.query(
      `SELECT s.user_id, upper(btrim(s.data->>'value', '"')) AS country, u.data->>'email' AS email
         FROM user_settings s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.data->>'key' = 'pers_bank_country' AND upper(btrim(s.data->>'value', '"')) = ANY($1::text[]) ORDER BY s.user_id`, [codes])).rows;   // value is stored JSON-encoded ("CU")
    console.log(`Embargoed countries checked: ${codes.map(k => k + ' ' + EMBARGOED[k]).join(', ')}\n`);
    console.log(`Businesses: ${ents.length}`);
    for (const r of ents) console.log(`  entity ${r.id} · "${r.name}" · ${r.country} ${EMBARGOED[r.country]} · owner user ${r.user_id} <${r.owner_email || '?'}> · created ${new Date(r.created_at).toISOString().slice(0, 10)}`);
    console.log(`Personal bank country settings: ${banks.length}`);
    for (const r of banks) console.log(`  user ${r.user_id} <${r.email || '?'}> · ${r.country} ${EMBARGOED[r.country]}`);
    console.log('\nNothing was changed.');
  } catch (e) {
    console.error('FAILED:', e && e.message, e && e.code, '\n', e && e.stack);
    if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message, x && x.code);
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
