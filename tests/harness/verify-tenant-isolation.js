#!/usr/bin/env node
'use strict';
/**
 * verify-tenant-isolation.js — the SECURITY test: cross-tenant data isolation (IDOR / broken
 * object-level authorization), the way a grey-box pentester probes a multi-tenant SaaS.
 *
 * db.updateById/deleteById operate by PRIMARY KEY ONLY (no user_id) — so isolation depends on
 * EVERY route ownership-checking first. This harness proves it holds by ATTACKING: tenant B logs
 * in and tries to read, modify, and delete tenant A's rows across every money resource. For each,
 * the DENY must be real three ways over: a non-2xx status, A's row still present, and A's row
 * byte-for-byte unchanged (a route that 404s but still mutated would be caught by the DB re-read,
 * not the status). Also: unauthenticated access → 401; an accountant with no link → 403.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-tenant-isolation.js
 *
 * Scratch Postgres only.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed, localNoonUtc } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const is4xx = s => s === 401 || s === 403 || s === 404;

async function mkUser(c, email) {
  return (await c.query(
    `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
    [{ email, name: 'Co', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
  )).rows[0].id;
}
async function oneId(c, table, uid) {
  const r = await c.query(`SELECT id FROM ${table} WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid]);
  return r.rows[0] && r.rows[0].id;
}
async function rowData(c, table, id) {
  const r = await c.query(`SELECT data FROM ${table} WHERE id=$1`, [id]);
  return r.rows[0] ? JSON.stringify(r.rows[0].data) : null;
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    // ── Victim tenant A: full seeded books + extra rows for every target resource ──
    const A_uid = await mkUser(c, 'victim@finflow.test');
    const { entityId: A_ent } = await seed(c, A_uid);
    await c.query(`INSERT INTO journals (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz)`,
      [A_uid, A_ent, { description: 'A private journal', lines: [{debit:10},{credit:10}], date: '2026-03-01' }, localNoonUtc('2026-03-01')]);
    await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,$3::timestamptz,$3::timestamptz)`,
      [A_uid, { description: 'A private salary', amount: 9999, tx_type: 'income', tx_date: '2026-02-01' }, localNoonUtc('2026-02-01')]);
    await c.query(`INSERT INTO personal_accounts (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,$3::timestamptz,$3::timestamptz)`,
      [A_uid, { kind: 'asset', name: 'A secret savings', value: 123456 }, localNoonUtc('2026-01-05')]);
    await c.query(`INSERT INTO documents (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz)`,
      [A_uid, A_ent, { name: 'A private doc', type: 'other', media_type: 'text/plain', file_data: 'c2VjcmV0' }, localNoonUtc('2026-01-06')]);

    // ── Attacker tenant B (own account) + an unlinked accountant ──
    const B_uid = await mkUser(c, 'attacker@finflow.test');
    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('nolink@finflow.test',$1,'No','Link','F','NOLINK','verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;

    const B   = new HarnessHttp(server.baseUrl);
    const acc = new HarnessHttp(server.baseUrl);
    const anon = new HarnessHttp(server.baseUrl);
    if ((await B.post('/api/auth/login', { email: 'attacker@finflow.test', password: PW })).status !== 200) throw new Error('B login failed');
    if ((await acc.post('/api/accountants/login', { email: 'nolink@finflow.test', password: PW })).status !== 200) throw new Error('acc login failed');

    console.log('\n' + '='.repeat(78));
    console.log('  TENANT ISOLATION / IDOR — attacker tenant B vs victim tenant A');
    console.log('='.repeat(78));

    // resource: [apiPath, dbTable, hasPUT, poisonBody]
    const RES = [
      ['/api/invoices',              'invoices',              true,  { notes: 'HACKED', amount: 1 }],
      ['/api/expenses',              'expenses',              true,  { amount: 1, description: 'HACKED' }],
      ['/api/bills',                 'bills',                 true,  { notes: 'HACKED' }],
      ['/api/customers',             'customers',             true,  { notes: 'HACKED' }],
      ['/api/journals',              'journals',              true,  { description: 'HACKED' }],
      ['/api/personal-transactions', 'personal_transactions', true,  { description: 'HACKED', amount: 1 }],
      ['/api/personal-accounts',     'personal_accounts',     true,  { name: 'HACKED' }],
      ['/api/entities',              'entities',              true,  { name: 'HACKED' }],
      ['/api/documents',             'documents',             false, null ],
    ];

    console.log('\n-- cross-tenant WRITE/DELETE (B attacking A rows) --');
    for (const [path, table, hasPut, poison] of RES) {
      const id = await oneId(c, table, A_uid);
      if (id == null) { A(`${table}: victim row exists to attack`, false, 'no seed row'); continue; }
      const before = await rowData(c, table, id);

      if (hasPut) {
        const put = await B.put(`${path}/${id}`, poison);
        A(`${table}: B PUT A/${id} → 401/403/404 (not 2xx)`, is4xx(put.status), `status ${put.status}`);
        A(`${table}: A row UNCHANGED after B PUT (ground truth)`, (await rowData(c, table, id)) === before, 'row mutated cross-tenant!');
      }
      const del = await B.del(`${path}/${id}`);
      A(`${table}: B DELETE A/${id} → 401/403/404 (not 2xx)`, is4xx(del.status), `status ${del.status}`);
      A(`${table}: A row STILL EXISTS after B DELETE (ground truth)`, (await rowData(c, table, id)) !== null, 'row deleted cross-tenant!');
    }

    console.log('\n-- cross-tenant READ (B listing must not contain A rows) --');
    for (const [path, table] of RES) {
      const aid = await oneId(c, table, A_uid);
      const list = await B.get(path);
      let arr = Array.isArray(list.json) ? list.json : (list.json && Array.isArray(list.json.rows) ? list.json.rows : []);
      const leaked = arr.some(r => String(r.id) === String(aid));
      A(`${table}: B list does NOT contain A row ${aid}`, list.status === 200 && !leaked, `status ${list.status} leaked ${leaked}`);
    }

    console.log('\n-- auth boundary --');
    A('unauthenticated GET /api/invoices → 401', (await anon.get('/api/invoices')).status === 401);
    A('unauthenticated PUT /api/invoices/1 → 401', (await anon.put('/api/invoices/1', { notes: 'x' })).status === 401);
    A('accountant with NO link → GET client books = 403', (await acc.get(`/api/accountants/clients/${A_uid}/books`)).status === 403);
    A('accountant with NO link → POST journal = 403', (await acc.post(`/api/accountants/clients/${A_uid}/journal`, { date:'2026-01-01', description:'x', lines:[{debit:1},{credit:1}] })).status === 403);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (tenant isolation / IDOR)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed  ← SECURITY REGRESSION');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('\n[tenant-isolation] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
