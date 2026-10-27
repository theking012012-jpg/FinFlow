'use strict';
/**
 * list-chart-accounts.js — READ-ONLY (Rule 7 / Rule 8). FA-M7: the business's own chart-of-accounts rows that the
 * one-chart change shows differently, so the owner can decide what (if anything) to do. Changes NOTHING.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"; node tools/launch/list-chart-accounts.js; Remove-Item Env:DATABASE_URL
 *
 * Lists:
 *   TYPED BALANCE  an own account whose stored "opening balance" is not 0. That number was never in the books; the
 *                  Chart of Accounts page now shows the ledger balance (0 until something is posted). To keep it as an
 *                  opening balance, post a journal to the account in the app.
 *   SAME CODE      an own account whose code is a built-in account's (1000, 4000 …). The page has always shown only the
 *                  built-in one, and a journal cannot pick it. If it matters, add a new account with a free code.
 *   NO BUSINESS    an own account with no business (entity_id NULL) — shown in every business of that account.
 *   DUPLICATE CODE two own accounts with the same code in one business (the old code allowed it). While any exist, the
 *                  database's unique-code index (idx_chart_of_accounts_code) is not built — boot logs a warning.
 *
 * Safety: SELECT only, bound parameters, a READ ONLY session, no transaction control. Imports only `pg` — never
 * database.js (its initDB would fire DDL). The built-in codes are listed here, not imported, for the same reason.
 */
const { Client } = require('pg');

const BUILT_IN = ['1000', '1100', '1200', '1250', '2000', '2100', '2200', '3000', '3100', '4000', '5000', '6000', '6100', '7000'];

async function listChartAccounts(c) {
  const { rows } = await c.query(
    `SELECT ca.id, ca.user_id, ca.entity_id, ca.data->>'code' AS code, ca.data->>'name' AS name, ca.data->>'category' AS category,
            ca.data->>'balance' AS balance, u.data->>'email' AS email,
            (SELECT count(*) FROM chart_of_accounts d WHERE d.user_id = ca.user_id AND COALESCE(d.entity_id, 0) = COALESCE(ca.entity_id, 0) AND d.data->>'code' = ca.data->>'code')::int AS same
       FROM chart_of_accounts ca LEFT JOIN users u ON u.id = ca.user_id
      WHERE COALESCE(NULLIF(ca.data->>'balance', '')::numeric, 0) <> 0 OR ca.data->>'code' = ANY($1::text[]) OR ca.entity_id IS NULL
         OR (SELECT count(*) FROM chart_of_accounts d WHERE d.user_id = ca.user_id AND COALESCE(d.entity_id, 0) = COALESCE(ca.entity_id, 0) AND d.data->>'code' = ca.data->>'code') > 1
      ORDER BY ca.user_id, ca.entity_id NULLS FIRST, ca.data->>'code'`, [BUILT_IN]);
  return rows.map(r => ({ id: r.id, account: r.user_id + ' ' + (r.email || ''), business: r.entity_id, code: r.code, name: r.name, category: r.category,
    why: [Number(r.balance) ? 'TYPED BALANCE ' + r.balance : null, BUILT_IN.includes(r.code) ? 'SAME CODE as a built-in account' : null, r.entity_id == null ? 'NO BUSINESS' : null, r.same > 1 ? 'DUPLICATE CODE (' + r.same + ' accounts)' : null].filter(Boolean).join(' · ') }));
}

module.exports = { listChartAccounts, BUILT_IN };

if (require.main === module) {
  (async () => {
    if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-chart-accounts.js'); process.exit(2); }
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    try {
      await c.connect();
      await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      const rows = await listChartAccounts(c);
      if (rows.length) console.table(rows); else console.log('Nothing to review: no own account has a typed balance, a built-in code, or no business.');
      console.log(rows.length + ' own account(s) to review. Nothing was changed.');
    } catch (err) {
      console.error('FAILED:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
      if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
      process.exitCode = 1;
    } finally { try { await c.end(); } catch (_) {} }
  })();
}
