'use strict';
/**
 * verify-ledger-schema.js — GL Phase 1 (GL_DESIGN.md): schema + seeded chart of accounts.
 * Proves the three ledger tables exist, the default COA seeds correctly + idempotently with the right
 * account types/normal sides, a BALANCED entry ties the trial balance to zero, and (Rule 4) an
 * UNBALANCED entry makes it non-zero — so the trial-balance check actually discriminates.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-ledger-schema.js
 * Scratch Postgres only.
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);                 // runs initDB → GL tables created
    const dbmod = require('../../database.js');

    console.log('\n' + '='.repeat(78));
    console.log('  GL PHASE 1 — ledger schema + seeded chart of accounts');
    console.log('='.repeat(78) + '\n');

    for (const t of ['ledger_accounts', 'ledger_entries', 'ledger_lines']) {
      const { rows } = await c.query('SELECT to_regclass($1) AS r', ['public.' + t]);
      A('table ' + t + ' exists', rows[0].r !== null);
    }

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'gl@finflow.test', role: 'owner' }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;

    const accts = await dbmod.ensureLedgerAccountsForEntity(c, uid, eid, 'USD');
    A('seeds the full default COA', accts.length === dbmod.DEFAULT_COA.length, 'got ' + accts.length + ' want ' + dbmod.DEFAULT_COA.length);
    const again = await dbmod.ensureLedgerAccountsForEntity(c, uid, eid, 'USD');
    A('idempotent — re-seeding creates no duplicates', again.length === dbmod.DEFAULT_COA.length, 'got ' + again.length);

    const byCode = Object.fromEntries(accts.map(a => [a.code, a]));
    A('AR (1100) = asset / debit / system', byCode['1100'].type === 'asset' && byCode['1100'].normal === 'debit' && byCode['1100'].is_system === true);
    A('Revenue (4000) = income / credit', byCode['4000'].type === 'income' && byCode['4000'].normal === 'credit');
    A('AP (2000) = liability / credit', byCode['2000'].type === 'liability' && byCode['2000'].normal === 'credit');
    A('Cash (1000) present (bank-rec anchor)', !!byCode['1000'] && byCode['1000'].type === 'asset');

    // Balanced entry: Dr Cash 100 / Cr Revenue 100
    const entry = (await c.query(`INSERT INTO ledger_entries (user_id,entity_id,entry_date,description,source_type,currency) VALUES ($1,$2,'2026-06-01','test sale','manual','USD') RETURNING id`, [uid, eid])).rows[0].id;
    await c.query(`INSERT INTO ledger_lines (entry_id,user_id,entity_id,account_id,debit,credit,debit_base,credit_base) VALUES ($1,$2,$3,$4,100,0,100,0)`, [entry, uid, eid, byCode['1000'].id]);
    await c.query(`INSERT INTO ledger_lines (entry_id,user_id,entity_id,account_id,debit,credit,debit_base,credit_base) VALUES ($1,$2,$3,$4,0,100,0,100)`, [entry, uid, eid, byCode['4000'].id]);

    const tb = async () => (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    let t = await tb();
    A('per-entry balances: Σdebit == Σcredit == 100', near(t.d, t.cr) && near(t.d, 100), 'd=' + t.d + ' cr=' + t.cr);
    A('TRIAL BALANCE ties to zero (Σdebit − Σcredit == 0)', near(t.d - t.cr, 0), 'diff=' + (t.d - t.cr));

    // Rule 4 discriminator: a lopsided entry makes the trial balance non-zero.
    const bad = (await c.query(`INSERT INTO ledger_entries (user_id,entity_id,entry_date,description,source_type,currency) VALUES ($1,$2,'2026-06-02','lopsided','manual','USD') RETURNING id`, [uid, eid])).rows[0].id;
    await c.query(`INSERT INTO ledger_lines (entry_id,user_id,entity_id,account_id,debit,credit) VALUES ($1,$2,$3,$4,50,0)`, [bad, uid, eid, byCode['1000'].id]);
    t = await tb();
    A('DISCRIMINATOR: an unbalanced entry drives TB != 0 (the check truly catches imbalance)', !near(t.d - t.cr, 0), 'diff=' + (t.d - t.cr));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL schema + COA)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
