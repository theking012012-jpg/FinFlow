'use strict';
/**
 * verify-new23-app-role-real-schema — NEW-23. The web process runs as finflow_app (scripts/db-app-role.sql) on the REAL
 * schema, built beforehand by the owner step (scripts/migrate.js), with SKIP_INIT_DDL=1. It must:
 *   - do everything the app does: sign in, books writes, payments, the 90-day sign-in IP removal, account deletion,
 *     with the audit trail written by the database and its hash chain verifying;
 *   - be unable to switch off, replace, bypass or erase the audit trail or the admin log, or change the schema;
 *   - say loudly at boot when the owner step was not run for this code.
 * F202's verify-db-app-role proved the role on a one-table stand-in; this is the real schema and the real app.
 *
 * Executed: real migrate.js and db-app-role.js (child processes, owner), real server as finflow_app, scratch Postgres.
 * Bug values (old code): DELETE on audit_trail / UPDATE + DELETE on admin_log were GRANTED (only a trigger stood in the
 * way); no record of which schema code ran, so a skipped owner step was silent.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new23-app-role-real-schema.js
 */
require('./clock.js');
const path = require('path');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  let scratch, server, app;
  console.log('\nNEW-23 — the app runs as a login that cannot alter the schema or the audit trail\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const su = scratch.client;   // the owner (here: the cluster superuser)

    // 1. The owner step — the real entry point, in its own process, as the owner.
    const mig = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js')], {
      cwd: ROOT, encoding: 'utf8', timeout: 240000,
      env: Object.assign({}, process.env, { DATABASE_URL: scratch.url, NODE_ENV: 'test', SESSION_SECRET: 'x' }) });
    A('owner step (scripts/migrate.js) builds the schema and exits 0', mig.status === 0, (mig.stdout || '').slice(-400) + (mig.stderr || '').slice(-600));

    // 2. The restricted login — the real owner tool (scripts/db-app-role.js → db-app-role.sql), which also proves it.
    const role = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'db-app-role.js')], {
      cwd: ROOT, encoding: 'utf8', timeout: 60000,
      env: Object.assign({}, process.env, { DATABASE_URL: scratch.url, FF_PRINT_APP_URL: '1' }) });
    const appUrl = ((role.stdout || '').match(/^postgres(ql)?:\/\/\S+$/m) || [])[0];
    A('owner tool (scripts/db-app-role.js) creates the login, proves it refuses to switch off the audit trail, exits 0',
      role.status === 0 && /REFUSED \(correct\)/.test(role.stdout) && !!appUrl, (role.stdout || '').replace(/:\/\/[^@\s]+@/g, '://***@') + (role.stderr || '').slice(-400));
    if (!appUrl) throw new Error('no app address from db-app-role.js');

    // Seed two people (the owner's client; the app cannot sign anyone up without e-mail).
    const PW = 'harness-password-not-a-secret';
    const mk = async (email) => (await su.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const uid = await mk('n23@finflow.test');
    const goneUid = await mk('n23-leaving@finflow.test');

    // 3. The real app as finflow_app, no DDL in this process.
    process.env.SKIP_INIT_DDL = '1';
    server = await bootServer(appUrl, { skipInitDB: true });
    app = require('../../server.js');
    const who = (await require('../../database.js').pool.query('SELECT current_user AS u')).rows[0].u;
    A('the app\'s own pool is connected as finflow_app', who === 'finflow_app', `current_user=${who}`);
    const check = async () => (typeof app._reportSchemaState === 'function' ? app._reportSchemaState() : { current: false, reason: 'no boot schema check exists' });
    const st = await check();
    A('boot check: the schema the owner step built is current for this code', st.current === true, JSON.stringify(st));

    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.23' });
    A('sign in', (await http.post('/api/auth/login', { email: 'n23@finflow.test', password: PW })).status === 200);
    const ent = (await http.post('/api/entities', { name: 'Least Co', currency: 'USD', timezone: 'UTC', country: 'US' })).json;
    await http.post('/api/entities/' + ent.id + '/activate', {});
    const inv = await http.post('/api/invoices', { client: 'Role Co', amount: 1200, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01' });
    const invId = inv.json && inv.json.id;
    const put = await http.request('PUT', '/api/invoices/' + invId, { amount: 1250 });
    const pay = await http.post('/api/invoice-payments', { invoice_id: invId, amount: 400, payment_date: '2026-07-10', method: 'Bank' });
    A('books writes work: invoice created, edited, paid', inv.status < 300 && put.status < 300 && pay.status < 300, `${inv.status} ${put.status} ${pay.status} ${String(pay.text).slice(0, 120)}`);
    const trail = (await su.query(`SELECT action FROM audit_trail WHERE table_name = 'invoices' AND record_id = $1 ORDER BY id`, [invId])).rows.map(r => r.action);
    A('the database wrote the invoice\'s audit trail (create + edits)', trail.length >= 2 && trail[0] === 'CREATE', JSON.stringify(trail));
    const v = (await su.query(`SELECT * FROM ff_audit_verify($1)`, [uid])).rows[0];
    A('the hash chain verifies', v && v.bad_id === null && Number(v.entries) > 0, JSON.stringify(v));

    // 90-day sign-in IP removal — the one UPDATE the app may make on audit_trail.
    // Dated explicitly: clock.js pins the app's Date to 2026-07-25 while the database's NOW() is real.
    await su.query(`INSERT INTO audit_trail (user_id, table_name, action, ip_address, user_agent, changed_at) VALUES (987654, 'users', 'ACCOUNT_DELETED', '198.51.100.9', 'UA', '2026-01-02T00:00:00Z')`);
    await app.stripDeletedAccountDevices(new Date('2026-07-25T00:00:00Z'));   // 204 days later (> 90)
    const ip = (await su.query(`SELECT ip_address, user_agent FROM audit_trail WHERE user_id = 987654 AND action = 'ACCOUNT_DELETED'`)).rows[0];
    A('the 90-day IP / device removal still works', ip && ip.ip_address === null && ip.user_agent === null, JSON.stringify(ip));

    // Account deletion — DELETE on every user_id table, personal_history included.
    const h2 = new HarnessHttp(server.baseUrl, { xff: '203.0.113.24' });
    await h2.post('/api/auth/login', { email: 'n23-leaving@finflow.test', password: PW });
    const del = await h2.request('DELETE', '/api/auth/account', { password: PW });
    const still = (await su.query(`SELECT count(*)::int n FROM users WHERE id = $1`, [goneUid])).rows[0].n;
    A('account deletion works (every table it erases is deletable)', del.status === 200 && still === 0, `${del.status} ${String(del.text).slice(0, 160)} remaining=${still}`);

    // 4. What a compromised app server could try, as finflow_app.
    const ac = new Client({ connectionString: appUrl }); await ac.connect();
    const tryq = async (q) => { try { await ac.query(q); return 'ok'; } catch (e) { return e.code || e.message; } };
    const n0 = (await su.query(`SELECT count(*)::int n FROM audit_trail`)).rows[0].n;
    const firstId = (await su.query(`SELECT min(id) AS id FROM audit_trail`)).rows[0].id;
    const ATTACKS = [
      ['switch off the audit trail\'s append-only trigger', `ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_mutate`, '42501'],
      ['switch off the books\' audit trigger', `ALTER TABLE invoices DISABLE TRIGGER ff_audit`, '42501'],
      ['drop the books\' audit trigger', `DROP TRIGGER ff_audit ON invoices`, '42501'],
      ['replace the append-only function', `CREATE OR REPLACE FUNCTION audit_trail_immutable() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql`, '42501'],
      ['skip every trigger for the session', `SET session_replication_role = replica`, '42501'],
      ['delete audit entries (bug: granted, only the trigger refused)', `DELETE FROM audit_trail WHERE id = ${firstId}`, '42501'],
      ['empty the audit trail', `TRUNCATE audit_trail`, '42501'],
      ['edit an audit entry', `UPDATE audit_trail SET action = 'EDITED' WHERE id = ${firstId}`, 'P0001'],
      ['edit the admin log (bug: granted)', `UPDATE admin_log SET notes = 'x'`, '42501'],
      ['delete from the admin log (bug: granted)', `DELETE FROM admin_log`, '42501'],
      ['create a table', `CREATE TABLE evil (id int)`, '42501'],
      ['alter a books table', `ALTER TABLE invoices ADD COLUMN evil int`, '42501'],
      ['drop a books table', `DROP TABLE invoices`, '42501'],
      ['create a login', `CREATE ROLE evil LOGIN`, '42501'],
    ];
    for (const [what, q, want] of ATTACKS) { const got = await tryq(q); A(`refused: ${what} (${want})`, got === want, `got ${got}`); }
    const n1 = (await su.query(`SELECT count(*)::int n FROM audit_trail`)).rows[0].n;
    A('the audit trail is intact after every attempt', n1 === n0, `${n0} → ${n1}`);
    await ac.end();

    // 5. A release whose owner step was NOT run is reported at boot.
    await su.query(`UPDATE schema_state SET value = 'an-older-schema' WHERE key = 'fingerprint'`);
    const errs = []; const oe = console.error; console.error = (...a) => { errs.push(a.join(' ')); };
    let st2; try { st2 = await check(); } finally { console.error = oe; }
    A('owner step skipped → boot reports "SCHEMA NOT CURRENT" with the command to run', st2 && st2.current === false && errs.some(e => /SCHEMA NOT CURRENT/.test(e) && /scripts\/migrate\.js/.test(e)), errs.join(' | '));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (server) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (NEW-23 restricted app login, real schema)\n`);
  process.exit(fail ? 1 : 0);
})();
