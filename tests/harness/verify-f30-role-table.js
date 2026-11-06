'use strict';
/**
 * verify-f30-role-table — F30, decided 2026-11-06: the role table on the Settings page is the one rbac.js ENFORCES,
 * read-only; the per-account "save" that nothing enforced is gone. (The page itself: verify-f30b-role-grid.)
 *
 * Executed: real server + scratch Postgres (Rule 3) for the API and for enforcement (an accountant member really is
 * refused a delete; an admin member really can make an API key).
 * The expected table is written out here by hand (Rule 6 — not read from rbac.js).
 * Bug values (old code): POST /api/permissions → 200 and stored (enforced nowhere); the page's own copy showed an
 * accountant deleting expenses (the server refuses) and API keys as owner-only (admins can).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f30-role-table.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
// owner · admin · accountant · viewer — by hand.
const EXPECTED = {
  'books:read': [1, 1, 1, 1], 'books:write': [1, 1, 1, 0], 'records:delete': [1, 1, 0, 0], 'payroll:write': [1, 1, 0, 0],
  'team:manage': [1, 1, 0, 0], 'audit:read': [1, 1, 0, 0], 'settings:manage': [1, 1, 0, 0], 'ai:use': [1, 1, 1, 0],
  'bank:manage': [1, 0, 0, 0], 'entities:manage': [1, 0, 0, 0],
};

(async () => {
  let scratch, server;
  console.log('\nF30 — the role table shown is the one enforced\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ownerId = await mk('f30-owner@finflow.test'), accId = await mk('f30-acc@finflow.test'), admId = await mk('f30-adm@finflow.test');
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [ownerId, { name: 'F30 Co', currency: 'USD', country: 'US', timezone: 'UTC', is_active: 1 }])).rows[0].id;
    const exp = (await c.query(`INSERT INTO expenses (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [ownerId, eid, { description: 'Paper', amount: 12, category: 'Office', expense_date: '2026-07-01' }])).rows[0].id;
    for (const [mid, role, em] of [[accId, 'accountant', 'f30-acc@finflow.test'], [admId, 'admin', 'f30-adm@finflow.test']])
      await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [ownerId, { email: em, role, status: 'active', member_user_id: String(mid) }]);
    const login = async (email, xff) => { const h = new HarnessHttp(server.baseUrl, { xff }); await h.post('/api/auth/login', { email, password: PW }); return h; };
    const owner = await login('f30-owner@finflow.test', '203.0.113.30');

    const t = (await owner.get('/api/permissions')).json || {};
    A('GET /api/permissions: the four roles in grid order', JSON.stringify(t.roles) === '["owner","admin","accountant","viewer"]', JSON.stringify(t.roles));
    const got = Object.fromEntries((t.rows || []).map(r => [r.cap, ['owner', 'admin', 'accountant', 'viewer'].map(k => (r.grants[k] ? 1 : 0))]));
    A('the table equals the hand-written one, row for row', JSON.stringify(got) === JSON.stringify(EXPECTED), JSON.stringify(got));
    const MATRIX = require('../../rbac.js').MATRIX;
    const missing = Object.keys(MATRIX).filter(k => k !== 'permissions:manage' && !got[k]);
    A('every enforced capability has a row (a new one cannot hide)', missing.length === 0, missing.join(', '));

    // What the table says is what happens.
    const acc = await login('f30-acc@finflow.test', '203.0.113.31');
    await acc.post('/api/my-access/switch', { accountOwnerId: ownerId });
    const del = await acc.request('DELETE', '/api/expenses/' + exp);
    A('accountant: "Delete records" unticked — and a delete is really refused (403) (the old grid said yes)', del.status === 403 && !got['records:delete'][2], `status ${del.status}`);
    const adm = await login('f30-adm@finflow.test', '203.0.113.32');
    await adm.post('/api/my-access/switch', { accountOwnerId: ownerId });
    const key = await adm.post('/api/api-keys', { name: 'Admin key' });
    A('admin: "Settings and API keys" ticked — and an API key is really made (the old grid said owner only)', key.status < 300 && got['settings:manage'][1] === 1, `status ${key.status} ${String(key.text).slice(0, 120)}`);

    const post = await owner.post('/api/permissions', [{ role: 'viewer', perms: ['books:write'] }]);
    const stored = (await c.query(`SELECT count(*)::int n FROM user_settings WHERE data->>'key' = 'permissions'`)).rows[0].n;
    A('POST /api/permissions no longer exists — nothing pretends to save (bug: 200, stored)', post.status === 404 && stored === 0, `status ${post.status}, stored ${stored}`);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (server) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }

  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F30 the role table shown is the one enforced)\n`);
  process.exit(fail ? 1 : 0);
})();
