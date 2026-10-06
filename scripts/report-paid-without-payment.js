#!/usr/bin/env node
'use strict';
/**
 * report-paid-without-payment.js — N90. READ-ONLY. Lists invoices and bills marked 'paid' whose recorded
 * payments do not cover them (amount_paid below amount, and/or no payment rows), so the owner can decide on a
 * correction. Writes NOTHING: SELECT statements only, parameters bound, no transaction control, and it does
 * NOT require database.js (whose import would pull in the app's pool / schema code) — it opens its own pg
 * client from DATABASE_URL.
 *
 *   DATABASE_URL=postgres://... node scripts/report-paid-without-payment.js
 */
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /sslmode=require|supabase/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined });
  await c.connect();
  try {
    const inv = await c.query(`
      SELECT i.id, i.user_id, i.entity_id, i.data->>'client' AS client, (i.data->>'amount')::numeric AS amount,
             COALESCE((i.data->>'amount_paid')::numeric, 0) AS amount_paid,
             COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS payments
        FROM invoices i
       WHERE lower(i.data->>'status') = $1 AND jsonb_typeof(i.data->'amount') = 'number'
         AND COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) < (i.data->>'amount')::numeric
       ORDER BY i.user_id, i.id`, ['paid']);
    const bills = await c.query(`
      SELECT b.id, b.user_id, b.entity_id, b.data->>'vendor' AS vendor, (b.data->>'amount')::numeric AS amount,
             COALESCE((b.data->>'amount_paid')::numeric, 0) AS amount_paid,
             COALESCE((SELECT SUM((p.data->>'amount')::numeric) FROM payments_made p WHERE p.data->>'bill_id' = b.id::text), 0) AS payments
        FROM bills b
       WHERE lower(b.data->>'status') = $1 AND jsonb_typeof(b.data->'amount') = 'number'
         AND COALESCE((SELECT SUM((p.data->>'amount')::numeric) FROM payments_made p WHERE p.data->>'bill_id' = b.id::text), 0) < (b.data->>'amount')::numeric
       ORDER BY b.user_id, b.id`, ['paid']);
    console.log(`Invoices marked paid without covering payments: ${inv.rows.length}`);
    for (const r of inv.rows) console.log(`  invoice #${r.id} user ${r.user_id} entity ${r.entity_id} ${r.client}: amount ${r.amount}, amount_paid ${r.amount_paid}, payments ${r.payments}`);
    console.log(`Bills marked paid without covering payments: ${bills.rows.length}`);
    for (const r of bills.rows) console.log(`  bill #${r.id} user ${r.user_id} entity ${r.entity_id} ${r.vendor}: amount ${r.amount}, amount_paid ${r.amount_paid}, payments ${r.payments}`);
  } catch (err) {
    console.error('report failed:', err && err.message, err && err.code, err && err.stack);
    if (err && err.errors) for (const e of err.errors) console.error('  -', e && e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
}
main().catch(e => { console.error('fatal:', e && e.message, e && e.code, e && e.stack); process.exit(2); });
