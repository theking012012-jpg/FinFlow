'use strict';
/**
 * list-invoice-numbers.js — B1b (2026-10-23). READ ONLY. For each business: how many invoices have NO number (made before
 * numbering existed), any DUPLICATE numbers (a CSV import used to store the file's own number unchecked — while one
 * exists the database's unique index idx_invoices_number is not built), and the business's current sequence + prefix.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"
 *     node tools/launch/list-invoice-numbers.js
 *     Remove-Item Env:DATABASE_URL
 *
 * SELECT only, inside a READ ONLY session. Imports only `pg` — no database.js, so no initDB DDL (Rule 7).
 * Next steps it points to: number-existing-invoices.js (dry run first) for the unnumbered ones; duplicates are the
 * owner's call (which invoice keeps the number) — this tool never changes anything.
 */
const { Client } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/list-invoice-numbers.js'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');   // cannot write, by construction
    const { rows: biz } = await c.query(`
      SELECT e.user_id, e.id AS entity_id, e.data->>'name' AS business,
             COALESCE(NULLIF(e.data->>'invoice_prefix', ''), 'INV-') AS prefix, COALESCE((e.data->>'invoice_seq')::int, 0) AS seq,
             (SELECT count(*)::int FROM invoices i WHERE i.user_id = e.user_id AND i.entity_id = e.id) AS invoices,
             (SELECT count(*)::int FROM invoices i WHERE i.user_id = e.user_id AND i.entity_id = e.id AND i.data->>'number' IS NULL) AS unnumbered
        FROM entities e ORDER BY e.user_id, e.id`);
    console.log('Invoices per business:');
    console.table(biz.map(b => ({ account: b.user_id, business_id: b.entity_id, business: b.business, prefix: b.prefix, sequence_at: b.seq, invoices: b.invoices, without_number: b.unnumbered })));
    const { rows: dups } = await c.query(`
      SELECT user_id, entity_id, data->>'number' AS number, array_agg(id ORDER BY id) AS invoice_ids
        FROM invoices WHERE data->>'number' IS NOT NULL
       GROUP BY user_id, entity_id, data->>'number' HAVING count(*) > 1 ORDER BY user_id, entity_id, number`);
    const { rows: [ix] } = await c.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_invoices_number'`);
    console.log(`Duplicate numbers: ${dups.length}`);
    if (dups.length) console.table(dups.map(d => ({ account: d.user_id, business_id: d.entity_id, number: d.number, invoice_ids: d.invoice_ids.join(', ') })));
    console.log(`Database guard idx_invoices_number: ${ix.n ? 'PRESENT' : 'NOT BUILT' + (dups.length ? ' (duplicates above must be resolved first — owner decision)' : ' (run the migration)')}`);
    const total = biz.reduce((s, b) => s + b.unnumbered, 0);
    console.log(`Invoices without a number: ${total}` + (total ? ' — dry run next: node tools/launch/number-existing-invoices.js' : ''));
  } catch (err) {
    console.error('FAILED (read-only — nothing changed):', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
