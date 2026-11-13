#!/usr/bin/env node
'use strict';
/**
 * seed-load-users.js — creates the test accounts the capacity test signs in as. STAGING ONLY.
 *
 *   DATABASE_URL="<staging Supabase URL>" STAGING_CONFIRM=yes node tests/load/seed-load-users.js 200
 *
 * Creates N owners  loadtest+1@finflow.test … loadtest+N@finflow.test  (password in LOAD_PASSWORD, default below),
 * each with one business (USD), 1 customer, 20 invoices, 10 expenses and 2 payroll employees — a realistic small book.
 * Accounts are created straight in the database (sign-up is rate-limited to 20 per 15 minutes per IP, by design).
 *
 * Safety: refuses to run unless STAGING_CONFIRM=yes, and refuses any DATABASE_URL that looks like production (contains
 * "prod" or the production project ref you put in PROD_DB_HINT). Re-running is safe: existing loadtest users are skipped.
 * Remove them afterwards with:  node tests/load/seed-load-users.js --remove
 */
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
const prodHint = (process.env.PROD_DB_HINT || '').trim();
if (process.env.STAGING_CONFIRM !== 'yes') { console.error('Refusing: set STAGING_CONFIRM=yes (and point DATABASE_URL at STAGING).'); process.exit(2); }
if (!url || /prod/i.test(url) || (prodHint && url.includes(prodHint))) { console.error('Refusing: DATABASE_URL is empty or looks like production.'); process.exit(2); }

const PASSWORD = process.env.LOAD_PASSWORD || 'LoadTest-pw-2026!';
const remove = process.argv.includes('--remove');
const N = Math.max(1, Math.min(2000, parseInt(process.argv.find(a => /^\d+$/.test(a)) || '100', 10)));
const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 4 });

(async () => {
  const c = await pool.connect();
  try {
    if (remove) {
      const { rows } = await c.query(`SELECT id FROM users WHERE data->>'email' LIKE 'loadtest+%@finflow.test'`);
      const ids = rows.map(r => r.id);
      if (!ids.length) { console.log('No loadtest users.'); return; }
      const tables = (await c.query(`SELECT table_name FROM information_schema.columns WHERE column_name = 'user_id' AND table_schema = 'public' AND table_name <> 'users'`)).rows.map(r => r.table_name);
      for (const t of tables) await c.query(`DELETE FROM ${t} WHERE user_id = ANY($1::int[])`, [ids]).catch(e => console.warn('  skip', t, e.message));
      await c.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids]);
      console.log(`Removed ${ids.length} loadtest users and their rows.`);
      return;
    }
    const hash = bcrypt.hashSync(PASSWORD, 10);
    let made = 0;
    for (let i = 1; i <= N; i++) {
      const email = `loadtest+${i}@finflow.test`;
      const ex = await c.query(`SELECT id FROM users WHERE data->>'email' = $1`, [email]);
      if (ex.rows.length) continue;
      await c.query('BEGIN');
      const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
        [{ email, name: 'Load Test ' + i, plan: 'business', role: 'owner', password: hash, onboarding_done: 1 }])).rows[0].id;
      const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
        [uid, { name: 'Load Co ' + i, currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1, color: '#c9a84c', tag: 'Business' }])).rows[0].id;
      await c.query(`INSERT INTO customers (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`, [uid, eid, { company: 'Load Customer ' + i }]);
      for (let k = 0; k < 20; k++) {
        const d = `2026-${String(1 + (k % 10)).padStart(2, '0')}-${String(1 + (k % 27)).padStart(2, '0')}`;
        await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
          [uid, eid, { client: 'Load Customer ' + i, amount: 100 + k * 25, amount_paid: 0, status: 'pending', issue_date: d, due_date: d }]);
      }
      for (let k = 0; k < 10; k++)
        await c.query(`INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
          [uid, eid, { description: 'Load expense ' + k, category: 'Rent', amount: 20 + k * 5, deductible: 'yes', expense_date: `2026-0${1 + (k % 9)}-15` }]);
      await c.query(`INSERT INTO payroll (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()), ($1, $2, $4, NOW(), NOW())`,
        [uid, eid, { fname: 'Load', lname: 'Owner', gross: 3000, deductions: [] }, { fname: 'Load', lname: 'Staff', gross: 2000, deductions: [] }]);
      await c.query('COMMIT');
      made++;
      if (made % 25 === 0) console.log(`  ${made} made…`);
    }
    console.log(`Done: ${made} new loadtest users (of ${N}). Password: LOAD_PASSWORD (default in this file).`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAILED:', e.message, e.code || '', e.stack);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
})();
