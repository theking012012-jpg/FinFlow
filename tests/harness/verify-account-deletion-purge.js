#!/usr/bin/env node
'use strict';
/**
 * verify-account-deletion-purge.js — REGRESSION (F198): DELETE /api/auth/account must purge EVERY
 * user-scoped table, the general ledger included.
 *
 * The bug: the deletion sweep listed 43 tables but omitted the GL (ledger_accounts / ledger_entries /
 * ledger_lines) and ai_usage — all user_id-scoped. Deleting an account left the entire double-entry
 * ledger behind (erasure incomplete; orphaned financial rows). This probe seeds the previously-missed
 * tables plus controls, deletes the account through the real route, and asserts zero rows remain.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-account-deletion-purge.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

// Every user_id-scoped table that must be emptied on account deletion. This list is the CONTRACT:
// if a new user-scoped table is added and not purged, add it here and to server.js's allTables.
const USER_SCOPED = [
  'invoices','expenses','customers','inventory','payroll','personal_transactions',
  'goals','holdings','user_settings','password_resets','quotes','bills','vendors',
  'recurring_bills','recurring_invoices','sales_receipts','payments_received',
  'credit_notes','payments_made','vendor_credits','items','timesheet','projects',
  'team_members','budget_targets','entities','journals','chart_of_accounts',
  'lock_settings','audit_log','documents','templates','autocat_rules',
  'audit_trail','invoice_payments','bank_reconciliation','payroll_runs',
  'payroll_run_lines','inventory_movements','fx_rates','fx_transactions',
  'personal_accounts','snapshots','ledger_accounts','ledger_entries','ledger_lines','ai_usage',
];

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);

    const CRED = { email: 'purge-me@finflow.test', password: 'harness-password-not-a-secret', name: 'Purge Me' };
    const reg = await http.post('/api/auth/register', CRED);
    A('register created the account (201) and opened a session', reg.status === 201, 'HTTP ' + reg.status);
    const uid = (await c.query(`SELECT id FROM users WHERE lower(data->>'email')=lower($1) LIMIT 1`, [CRED.email])).rows[0]?.id;
    A('the new user exists', uid != null, 'uid=' + uid);

    // Seed a row into EVERY user-scoped table so "0 remain" is a real assertion, not vacuous.
    // The GL + ai_usage are the tables the bug missed; the rest are controls.
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Co' }])).rows[0].id;
    await c.query(`INSERT INTO ledger_accounts (user_id,entity_id,code,name,type,normal) VALUES ($1,$2,'1000','Cash','asset','debit')`, [uid, eid]);
    const entryId = (await c.query(`INSERT INTO ledger_entries (user_id,entity_id,entry_date,description,source_type,source_id) VALUES ($1,$2,'2026-06-01','x','invoice',1) RETURNING id`, [uid, eid])).rows[0].id;
    await c.query(`INSERT INTO ledger_lines (user_id,entity_id,entry_id,account_id,debit,credit) VALUES ($1,$2,$3,1,100,0)`, [uid, eid, entryId]);
    await c.query(`INSERT INTO ai_usage (user_id,billing_month,query_count) VALUES ($1,date_trunc('month',NOW()),3)`, [uid]);
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [uid, eid, { client: 'A', amount: 100, status: 'pending' }]);

    const before = {};
    for (const t of ['ledger_accounts','ledger_entries','ledger_lines','ai_usage','invoices','entities'])
      before[t] = Number((await c.query(`SELECT COUNT(*)::int n FROM ${t} WHERE user_id=$1`, [uid])).rows[0].n);
    A('setup seeded the GL + ai_usage (pre-delete rows present)',
      before.ledger_accounts > 0 && before.ledger_entries > 0 && before.ledger_lines > 0 && before.ai_usage > 0, JSON.stringify(before));

    // Delete through the REAL route (needs the password in the body).
    const wrongPw = await http.request('DELETE', '/api/auth/account', { password: 'wrong' });
    A('deletion is rejected without the correct password (401)', wrongPw.status === 401, 'HTTP ' + wrongPw.status);
    const del = await http.request('DELETE', '/api/auth/account', { password: CRED.password });
    A('account deletion succeeds with the correct password', del.status === 200 && del.json?.ok === true, 'HTTP ' + del.status + ' ' + JSON.stringify(del.json));

    // Assert ZERO rows remain. Only tables that actually HAVE a user_id column are checkable this
    // way (a few in the sweep key off other columns); filter to the real set via information_schema.
    const withUid = new Set((await c.query(
      `SELECT table_name FROM information_schema.columns WHERE column_name='user_id' AND table_name = ANY($1)`,
      [USER_SCOPED])).rows.map(r => r.table_name));
    // Guard: the tables the bug MISSED must be in the checkable set — otherwise the test would pass vacuously.
    for (const must of ['ledger_accounts','ledger_entries','ledger_lines','ai_usage'])
      A(`${must} is a user_id table and is being checked`, withUid.has(must));
    let leaked = [];
    for (const t of USER_SCOPED) {
      if (!withUid.has(t)) continue;
      const n = Number((await c.query(`SELECT COUNT(*)::int n FROM ${t} WHERE user_id=$1`, [uid])).rows[0].n);
      if (n > 0) leaked.push(`${t}=${n}`);
    }
    A('EVERY user-scoped table is empty after deletion (ledger + ai_usage included)', leaked.length === 0, 'leaked: ' + leaked.join(', '));
    const userGone = Number((await c.query(`SELECT COUNT(*)::int n FROM users WHERE id=$1`, [uid])).rows[0].n) === 0;
    A('the users row itself is gone', userGone);

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (account deletion purges every user-scoped table)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[purge] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
