#!/usr/bin/env node
'use strict';
/**
 * verify-db-app-role.js — F202: prove scripts/db-app-role.sql produces a role that can read/write DATA
 * but CANNOT change schema (no CREATE/DROP), so a leaked app credential can't destroy the books.
 * Runs the actual SQL file (minus psql meta-commands) against a scratch cluster, then connects AS
 * finflow_app and checks what it can and cannot do.
 *
 *   node tests/harness/verify-db-app-role.js
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
const { startScratchPostgres, DB_NAME, PG_USER, PG_PASS } = require('./pgScratch.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const denied = async (cl, sql) => { try { await cl.query(sql); return false; } catch (e) { return /permission denied|must be owner/i.test(e.message); } };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const su = scratch.client;                       // superuser/owner
  let appCl = null;
  try {
    // A representative app table + row (owned by the superuser, like the real schema).
    await su.query(`CREATE TABLE demo_invoices (id serial primary key, amount numeric)`);
    await su.query(`INSERT INTO demo_invoices (amount) VALUES (100)`);

    // Run the ACTUAL file, minus psql-only meta-commands, with the password var substituted.
    let sql = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'db-app-role.sql'), 'utf8');
    sql = sql.replace(/^\\set.*$/gm, '')            // drop \set ON_ERROR_STOP
             .replace(/:'app_pw'/g, "'testpw123'"); // psql var → literal
    await su.query(sql);
    A('db-app-role.sql runs without error', true);

    const roleRow = (await su.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname='finflow_app'`)).rows[0];
    A('finflow_app exists and can log in', !!roleRow && roleRow.rolcanlogin === true);
    A('finflow_app is NOT superuser', roleRow && roleRow.rolsuper === false);
    A('finflow_app cannot create DBs or roles', roleRow && roleRow.rolcreatedb === false && roleRow.rolcreaterole === false);

    // Connect AS finflow_app.
    appCl = new Client({ host: '127.0.0.1', port: scratch.port, user: 'finflow_app', password: 'testpw123', database: DB_NAME });
    await appCl.connect();

    // CAN read + write data.
    A('finflow_app CAN SELECT data', (await appCl.query(`SELECT COUNT(*)::int n FROM demo_invoices`)).rows[0].n === 1);
    await appCl.query(`INSERT INTO demo_invoices (amount) VALUES (250)`);
    A('finflow_app CAN INSERT data', (await appCl.query(`SELECT COUNT(*)::int n FROM demo_invoices`)).rows[0].n === 2);
    await appCl.query(`UPDATE demo_invoices SET amount=1 WHERE amount=250`);
    await appCl.query(`DELETE FROM demo_invoices WHERE amount=1`);
    A('finflow_app CAN UPDATE + DELETE data', (await appCl.query(`SELECT COUNT(*)::int n FROM demo_invoices`)).rows[0].n === 1);

    // CANNOT change schema.
    A('finflow_app CANNOT CREATE TABLE', await denied(appCl, `CREATE TABLE evil (id int)`));
    A('finflow_app CANNOT DROP TABLE', await denied(appCl, `DROP TABLE demo_invoices`));
    A('finflow_app CANNOT ALTER TABLE (add column)', await denied(appCl, `ALTER TABLE demo_invoices ADD COLUMN x int`));
    A('finflow_app CANNOT TRUNCATE', await denied(appCl, `TRUNCATE demo_invoices`));

    // Default privileges: a table the owner creates LATER is usable by finflow_app (no re-grant needed).
    await su.query(`CREATE TABLE demo_later (id serial primary key)`);
    await su.query(`INSERT INTO demo_later DEFAULT VALUES`);
    A('finflow_app CAN read a table created AFTER the grant (default privileges)',
      (await appCl.query(`SELECT COUNT(*)::int n FROM demo_later`)).rows[0].n === 1);

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (least-privilege app role: data yes, schema no)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[db-role] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (appCl) await appCl.end().catch(() => {});
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
