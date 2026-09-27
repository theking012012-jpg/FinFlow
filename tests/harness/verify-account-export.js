#!/usr/bin/env node
'use strict';
/**
 * verify-account-export.js — GET /api/auth/export (GDPR Art. 20 portability): the caller gets a full
 * JSON dump of their OWN data, correctly framed as a download, and NEVER another tenant's rows.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-account-export.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    // Two isolated tenants. A has the data we expect back; B must never appear in A's export.
    const httpA = new HarnessHttp(server.baseUrl);
    await httpA.post('/api/auth/register', { email: 'exp-a@finflow.test', password: 'harness-password-not-a-secret', name: 'A' });
    const uidA = (await c.query(`SELECT id FROM users WHERE lower(data->>'email')='exp-a@finflow.test'`)).rows[0].id;
    const httpB = new HarnessHttp(server.baseUrl);
    await httpB.post('/api/auth/register', { email: 'exp-b@finflow.test', password: 'harness-password-not-a-secret', name: 'B' });
    const uidB = (await c.query(`SELECT id FROM users WHERE lower(data->>'email')='exp-b@finflow.test'`)).rows[0].id;

    const eidA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uidA, { name: 'CoA' }])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [uidA, eidA, { client: 'ACME-A', amount: 4242, status: 'pending' }]);
    await c.query(`INSERT INTO ledger_accounts (user_id,entity_id,code,name,type,normal) VALUES ($1,$2,'1000','Cash','asset','debit')`, [uidA, eidA]);
    const eidB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uidB, { name: 'CoB' }])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [uidB, eidB, { client: 'SECRET-B', amount: 9999, status: 'pending' }]);

    const unauth = await new HarnessHttp(server.baseUrl).get('/api/auth/export');
    A('export requires auth (401 when logged out)', unauth.status === 401, 'HTTP ' + unauth.status);

    const exp = await httpA.get('/api/auth/export');
    A('export returns 200', exp.status === 200, 'HTTP ' + exp.status);
    A('served as a JSON file download (Content-Disposition attachment)',
      /attachment; *filename=.*finflow-export/.test(exp.headers.get('content-disposition') || ''), exp.headers.get('content-disposition'));
    const doc = exp.json;
    A('has a versioned format + exported_at + account block', doc && doc.export_format === 'finflow.account.v1' && !!doc.exported_at && doc.account && doc.account.id === uidA, JSON.stringify(doc && { f: doc.export_format, acct: doc.account }));
    A('account block carries NO password hash', doc && doc.account && !('password' in doc.account));
    A('includes the caller invoice (ACME-A, 4242)', JSON.stringify(doc.data.invoices || []).includes('ACME-A'), JSON.stringify(doc.data.invoices));
    A('includes the caller ledger accounts', (doc.data.ledger_accounts || []).length >= 1, JSON.stringify(doc.data.ledger_accounts));
    const dump = JSON.stringify(doc);
    A('does NOT contain the other tenant data (SECRET-B / 9999)', !dump.includes('SECRET-B') && !dump.includes('9999'));
    A('every returned row belongs to the caller (user_id === uidA where present)',
      Object.values(doc.data).flat().every(r => r.user_id === undefined || r.user_id === uidA));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (account export: own data only, download-framed)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[export] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
