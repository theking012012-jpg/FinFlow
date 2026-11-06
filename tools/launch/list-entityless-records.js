'use strict';
/**
 * list-entityless-records.js — READ-ONLY (Rule 7 / Rule 8). F26-b, and its class (Rule 13): business records stored
 * with NO business (entity_id NULL) — legacy rows from before every write was stamped with its business (F150). Each
 * one shows under EVERY business of its account (the null-inclusive read), so a multi-business owner sees it counted in
 * each. Which business each belongs to is the OWNER's decision; this only lists them.
 *
 * The tables are the ones carrying the F150 invariant chk_<table>_entity_nn (read from the database itself, so the
 * list cannot drift from the schema): sales receipts, invoices, expenses, bills, payments, credit notes, … For each
 * account: per table, how many rows, their amount total, and their creation dates; then that account's businesses (id,
 * name, country) — an account with ONE business has an obvious home. Prints ids only — no people's names, no e-mails.
 * It changes NOTHING: SELECT statements only, no transaction control, no write mode.
 *
 *   PowerShell (copy the address in Railway first — never paste it into chat):
 *     $env:DATABASE_URL = (Get-Clipboard).Trim(); $env:DATABASE_URL.StartsWith("postgres")
 *     node tools/launch/list-entityless-records.js
 *     Remove-Item Env:DATABASE_URL
 *
 * Imports only `pg` — never database.js, whose import would run initDB() DDL (Rule 7).
 */
const { Client } = require('pg');
(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-entityless-records.js'); process.exit(2); }
  const url = process.env.DATABASE_URL;
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows: tables } = await c.query(
      `SELECT conrelid::regclass::text AS tbl, convalidated FROM pg_constraint
        WHERE contype = 'c' AND conname LIKE 'chk\\_%\\_entity\\_nn' ORDER BY 1`);
    const byAccount = new Map();
    let total = 0;
    for (const t of tables) {
      // The table name comes from pg_constraint and is quoted — nothing from outside is interpolated.
      const q = '"' + t.tbl.replace(/"/g, '""') + '"';
      const { rows } = await c.query(
        `SELECT user_id, count(*)::int AS n,
                COALESCE(sum(CASE WHEN (data->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (data->>'amount')::numeric END), 0) AS amount,
                min(created_at)::date AS first, max(created_at)::date AS last
           FROM ${q} WHERE entity_id IS NULL GROUP BY user_id ORDER BY user_id`);
      for (const r of rows) {
        total += r.n;
        if (!byAccount.has(r.user_id)) byAccount.set(r.user_id, []);
        byAccount.get(r.user_id).push(Object.assign({ tbl: t.tbl }, r));
      }
    }
    for (const [uid, list] of byAccount) {
      const { rows: biz } = await c.query(
        `SELECT id, data->>'name' AS name, upper(COALESCE(data->>'country', '')) AS country FROM entities WHERE user_id = $1 ORDER BY id`, [uid]);
      console.log(`account #${uid} — ${biz.length} business(es): ${biz.map(b => `#${b.id} ${b.name}${b.country ? ' (' + b.country + ')' : ''}`).join(' · ') || 'none'}`
        + (biz.length === 1 ? '  ← one business: the obvious home' : ''));
      for (const r of list) {
        const d = (x) => (x ? x.toISOString().slice(0, 10) : '?');
        console.log(`    ${r.tbl.padEnd(22)} ${String(r.n).padStart(5)} row(s) without a business · amounts ${Number(r.amount).toFixed(2)} · created ${d(r.first)} … ${d(r.last)}`);
      }
    }
    console.log(`\n${tables.length} business tables checked · ${total} record(s) in ${byAccount.size} account(s) have no business. Nothing was changed.`);
  } catch (e) {
    console.error('FAILED:', e && e.message, e && e.code, '\n', e && e.stack);
    if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message, x && x.code);
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
