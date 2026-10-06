#!/usr/bin/env node
'use strict';
/**
 * verify-admin-suspend-enforced.js — N88. Admin "suspend user" and "delete user" must actually remove
 * access, including for a session that is already open; unsuspend restores it.
 *
 * Defect: the admin routes wrote users.data.suspended / deleted, but nothing enforced suspended, and the
 * login check compared deleted against the string 'true' while soft-delete stores a JSON boolean.
 *
 * Discriminating checks (Rule 4), driven through the real admin routes:
 *   suspended user's open session → 401        (bug: 200)
 *   suspended user logs in        → refused    (bug: 200)
 *   unsuspend → login 200 again
 *   soft-deleted user's open session → 401     (bug: 200)
 *   node -r ./tests/harness/clock.js tests/harness/verify-admin-suspend-enforced.js
 */

const bcrypt = require('bcryptjs');
process.env.ADMIN_PASSWORD = 'harness-admin-password';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'suspend-pw-1';
    const mk = async (email) => {
      const id = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
      await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [id, { name: 'Co', currency: 'USD', is_active: 1 }]);
      return id;
    };
    const u1 = await mk('suspend-me@finflow.test');
    const u2 = await mk('delete-me@finflow.test');
    let ip = 0;
    const H = () => new HarnessHttp(server.baseUrl, { xff: '10.8.4.' + (++ip) });
    const admin = H();
    A('admin login', (await admin.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  ADMIN SUSPEND / DELETE — enforced on live sessions and login');
    console.log('='.repeat(78));

    const s1 = H();
    A('user logs in', (await s1.post('/api/auth/login', { email: 'suspend-me@finflow.test', password: PW })).status === 200);
    A('session works before suspension', (await s1.get('/api/invoices')).status === 200);
    A('admin suspends (200)', (await admin.post(`/api/admin/users/${u1}/suspend`, { suspend: true })).status === 200);
    const live = await s1.get('/api/invoices');
    A('suspended user\'s open session → 401 (bug: 200)', live.status === 401, 'status ' + live.status);
    const relog = await H().post('/api/auth/login', { email: 'suspend-me@finflow.test', password: PW });
    A('suspended user cannot log in (bug: 200)', relog.status !== 200, 'status ' + relog.status);
    A('admin unsuspends (200)', (await admin.post(`/api/admin/users/${u1}/unsuspend`, {})).status === 200);
    const s1b = H();
    A('after unsuspend: login works again', (await s1b.post('/api/auth/login', { email: 'suspend-me@finflow.test', password: PW })).status === 200);
    A('after unsuspend: session works', (await s1b.get('/api/invoices')).status === 200);

    const s2 = H();
    A('second user logs in', (await s2.post('/api/auth/login', { email: 'delete-me@finflow.test', password: PW })).status === 200);
    A('admin soft-deletes (200)', (await admin.del(`/api/admin/users/${u2}`)).status === 200);
    const live2 = await s2.get('/api/invoices');
    A('soft-deleted user\'s open session → 401 (bug: 200)', live2.status === 401, 'status ' + live2.status);
    const t = (await c.query(`SELECT jsonb_typeof(data->'deleted') t FROM users WHERE id=$1`, [u2])).rows[0].t;
    A('soft-delete stored a JSON boolean (the shape the old string check missed)', t === 'boolean', 'type=' + t);

    const ok = H();
    await ok.post('/api/auth/login', { email: 'suspend-me@finflow.test', password: PW });
    A('control: an active user is unaffected', (await ok.get('/api/auth/me')).status === 200);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (admin suspend enforced)` : `  ALL GREEN — ${pass} passed, 0 failed  (admin suspend enforced)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
