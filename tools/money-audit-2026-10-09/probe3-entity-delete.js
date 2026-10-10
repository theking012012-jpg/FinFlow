'use strict';
// READ-ONLY AUDIT PROBE (scratch DB only): what happens to a business's money when the business is deleted.
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('../../tests/harness/pgScratch.js');
const { bootServer } = require('../../tests/harness/boot.js');
const { HarnessHttp } = require('../../tests/harness/httpClient.js');
const PW = 'probe3-pw';
(async () => {
  const scratch = await startScratchPostgres({ keep: false }); const c = scratch.client; let server;
  try {
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'p3@finflow.test', name: 'P3', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const O = new HarnessHttp(server.baseUrl, { xff: '203.0.113.71' });
    if ((await O.post('/api/auth/login', { email: 'p3@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (m, p, b) => { const r = await O.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text.slice(0, 160)); return r.json; };
    const today = new Date().toISOString().slice(0, 10);
    const real = (await J('POST', '/api/entities', { name: 'Real Co', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
    const test = (await J('POST', '/api/entities', { name: 'Business A (test)', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
    await J('POST', '/api/entities/' + real + '/activate', {});
    await J('POST', '/api/invoices?entity_id=' + real, { client: 'Real client', amount: 1000, status: 'pending', issue_date: today, entity_id: real, idempotency_key: 'r1' });
    await J('POST', '/api/entities/' + test + '/activate', {});
    await J('POST', '/api/invoices?entity_id=' + test, { client: 'Test client', amount: 9999, status: 'pending', issue_date: today, entity_id: test, idempotency_key: 't1' });
    await J('POST', '/api/bills?entity_id=' + test, { vendor: 'Test vendor', amount: 400, status: 'unpaid', issue_date: today, idempotency_key: 't2' });
    await J('POST', '/api/entities/' + real + '/activate', {});
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status) VALUES ('p3acc@finflow.test',$1,'P','A','F','P3ACC','verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id,user_id,status,access_level,requested_by) VALUES ($1,$2,'active','filing','client')`, [accId, uid]);
    const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.72' });
    if ((await ACC.post('/api/accountants/login', { email: 'p3acc@finflow.test', password: PW })).status !== 200) throw new Error('acc login');
    const portal = async () => { const r = await ACC.get(`/api/accountants/clients/${uid}/books`); return r.json; };
    const before = await portal();
    const del = await O.del('/api/entities/' + test);
    const after = await portal();
    const rowsLeft = (await c.query(`SELECT (SELECT count(*) FROM invoices WHERE entity_id=$1)::int AS inv, (SELECT count(*) FROM bills WHERE entity_id=$1)::int AS bills, (SELECT count(*) FROM ledger_entries WHERE entity_id=$1)::int AS gl`, [test])).rows[0];
    const own = await J('GET', '/api/reports');
    const out = { deleteStatus: del.status, rowsLeftAfterDelete: rowsLeft,
      portalAllEntitiesRevenue: { before: before.summary.revenue, after: after.summary.revenue },
      portalAllEntitiesOpex: { before: before.summary.opex, after: after.summary.opex },
      portalEntitiesListed: after.entities.map(e => e.name), ownerRealCoRevenue: own.revenue };
    console.log('\nRESULT ' + JSON.stringify(out, null, 2));
    console.log('\nEXPECTED (correct): after delete the portal all-entities revenue = 1000.00, opex = 0.00, and no orphan rows (or the delete is refused while the business holds documents).');
  } catch (e) { console.log('FATAL: ' + (e && e.stack || e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
})();
