#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-chat-legacy-schema.js — the durable fix for the production chat 500.
 *
 * Production created accountant_messages with a `client_id INTEGER NOT NULL` column (the old
 * shape). A later repair added `user_id` and every route now writes user_id ONLY — so the
 * lingering NOT NULL on client_id made every message INSERT fail (23502), i.e. chat 500'd in
 * production while the harness stayed green (embedded-postgres builds the CURRENT schema, which
 * never had client_id at all). The harness was green against a reality prod did not share.
 *
 * This reconstructs the exact legacy shape on the scratch cluster and proves the fix, RED→GREEN,
 * across the SHIPPED database.initDB() — the same idempotent migration that runs on deploy:
 *
 *   BEFORE initDB (legacy client_id NOT NULL):  INSERT user_id-only  → 23502  (RED, the prod 500)
 *   AFTER  initDB (fix drops the NOT NULL):     INSERT user_id-only  → OK     (GREEN)
 *   AND    the legacy client_id row is backfilled into user_id.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-chat-legacy-schema.js
 *
 * Scratch Postgres only.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);            // builds the CURRENT schema (no client_id)
    const database = require('../../database.js');
    const pool = database.pool;

    // A real accountant to satisfy the FK.
    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('legacy-chat@finflow.test', $1, 'A', 'B', 'F', 'LEGCHAT', 'verified') RETURNING id`,
      [bcrypt.hashSync('x', 10)]
    )).rows[0].id;

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT CHAT — legacy client_id NOT NULL repair (RED → GREEN across initDB)');
    console.log('='.repeat(78));

    // ── Reconstruct the LEGACY production shape: user_id present (nullable) + client_id NOT NULL ──
    console.log('\n-- reconstruct legacy accountant_messages (client_id NOT NULL) --');
    await c.query(`DROP TABLE IF EXISTS accountant_messages CASCADE`);
    await c.query(`
      CREATE TABLE accountant_messages (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
        user_id       INTEGER,
        client_id     INTEGER NOT NULL,
        sender        VARCHAR(20) NOT NULL DEFAULT 'accountant',
        message       TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )`);
    // A legacy row written the OLD way (client_id set, user_id NULL) — must be backfilled.
    await c.query(`INSERT INTO accountant_messages (accountant_id, client_id, sender, message) VALUES ($1, 4242, 'accountant', 'legacy row')`, [accId]);

    const nullable = async () => (await c.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name='accountant_messages' AND column_name='client_id'`
    )).rows[0].is_nullable;
    A('legacy: client_id starts NOT NULL', (await nullable()) === 'NO');

    // ── RED — the exact prod insert (user_id only, no client_id) fails with 23502 ──
    console.log('\n-- RED: new-shape insert against legacy table --');
    let redCode = null;
    try {
      await c.query(`INSERT INTO accountant_messages (accountant_id, user_id, sender, message) VALUES ($1, 7, 'client', 'red')`, [accId]);
    } catch (e) { redCode = e.code; }
    A('RED: user_id-only INSERT → 23502 not-null violation (the prod 500)', redCode === '23502', `code ${redCode}`);

    // ── Run the SHIPPED migration ──
    console.log('\n-- run database.initDB() (the deploy-time migration) --');
    await database.initDB();
    A('AFTER initDB: client_id is now nullable', (await nullable()) === 'YES');
    const backfilled = (await c.query(`SELECT user_id FROM accountant_messages WHERE message = 'legacy row'`)).rows[0].user_id;
    A('AFTER initDB: legacy row backfilled user_id = client_id (4242)', backfilled === 4242, `user_id ${backfilled}`);

    // ── GREEN — the same insert now succeeds ──
    console.log('\n-- GREEN: new-shape insert after the fix --');
    let greenOk = false, greenErr = null;
    try {
      await pool.query(`INSERT INTO accountant_messages (accountant_id, user_id, sender, message) VALUES ($1, 7, 'client', 'green')`, [accId]);
      greenOk = true;
    } catch (e) { greenErr = e.message; }
    A('GREEN: user_id-only INSERT now succeeds', greenOk, greenErr);

    // Idempotent second run must not throw.
    let idem = true; try { await database.initDB(); } catch (_) { idem = false; }
    A('initDB is idempotent (second run clean)', idem);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (chat legacy-schema repair)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[acc-chat-legacy] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
