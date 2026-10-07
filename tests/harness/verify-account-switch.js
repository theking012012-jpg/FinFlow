#!/usr/bin/env node
'use strict';
/**
 * verify-account-switch.js — N36. A user who owns books AND belongs to another account can reach both,
 * and chooses which one the session works in.
 *
 * Defect: the account resolver scoped EVERY request into the user's first active membership. A user with
 * their own books who accepted an invite elsewhere could no longer reach their own books at all — no
 * switcher existed.
 *
 * Executed against the real server + Postgres. U owns "U-inv"; U is an active member of O's account
 * ("O-inv"). F is a fresh invitee with no books of their own. Bug value stated:
 *   U logs in → GET /api/invoices = [U-inv]                        (bug: [O-inv] — own books unreachable)
 *   U switches to O → [O-inv]; my-access scopedIntoOther = true    (control)
 *   U switches back → [U-inv]                                      (bug: no way back)
 *   U switches to X (not a member) → 403, stays put
 *   F (no own books) lands in O by default                         (control — unchanged)
 *   O revokes U while U is switched in → U's next request is back in U's own books, not O's
 *   node -r ./tests/harness/clock.js tests/harness/verify-account-switch.js
 */
const bcrypt = require('bcryptjs');
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
    const PW = 'switch-pw-1';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const U = await mk('sw-u@finflow.test'), O = await mk('sw-o@finflow.test'), X = await mk('sw-x@finflow.test'), F = await mk('sw-f@finflow.test');
    for (const [u, n] of [[U, 'U-inv'], [O, 'O-inv'], [X, 'X-inv']]) {
      const e = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [u, { name: 'Co ' + n, currency: 'USD', is_active: 1 }])).rows[0].id;
      await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [u, e, { client: n, amount: 10, status: 'pending', issue_date: '2026-07-01' }]);
    }
    const tmU = (await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [O, { email: 'sw-u@finflow.test', role: 'admin', status: 'active', member_user_id: String(U) }])).rows[0].id;
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [O, { email: 'sw-f@finflow.test', role: 'viewer', status: 'active', member_user_id: String(F) }]);
    let ip = 1; const login = async (email) => { const h = new HarnessHttp(server.baseUrl, { xff: '10.36.0.' + (ip++) }); if ((await h.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login'); return h; };
    const inv = async (h) => ((await h.get('/api/invoices')).json || []).map(i => i.client).sort().join(',');

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNT SWITCH — own books and joined accounts both reachable');
    console.log('='.repeat(78));
    const hu = await login('sw-u@finflow.test');
    A('U logs in → own books [U-inv] (bug: [O-inv], own books unreachable)', (await inv(hu)) === 'U-inv', 'invoices=' + await inv(hu));
    const acc = (await hu.get('/api/my-access')).json || {};
    A('my-access lists own + O, currently own', (acc.accounts || []).length === 2 && acc.currentAccountId === U, JSON.stringify(acc));
    A('switch to O → 200', (await hu.post('/api/my-access/switch', { accountOwnerId: O })).status === 200);
    A('  now in O: [O-inv]; scopedIntoOther = true', (await inv(hu)) === 'O-inv' && ((await hu.get('/api/my-access')).json || {}).scopedIntoOther === true);
    A('switch back to own → [U-inv] (bug: no way back)', (await hu.post('/api/my-access/switch', { accountOwnerId: U })).status === 200 && (await inv(hu)) === 'U-inv');
    const sx = await hu.post('/api/my-access/switch', { accountOwnerId: X });
    A('switch to a non-member account → 403', sx.status === 403, 'status ' + sx.status);
    A('  still in own books', (await inv(hu)) === 'U-inv');
    const hf = await login('sw-f@finflow.test');
    A('control: fresh invitee (no own books) lands in O', (await inv(hf)) === 'O-inv', 'invoices=' + await inv(hf));
    await hu.post('/api/my-access/switch', { accountOwnerId: O });
    await c.query(`UPDATE team_members SET data = data || '{"status":"revoked"}' WHERE id=$1`, [tmU]);
    A('membership revoked while switched in → next request back in own books, not O', (await inv(hu)) === 'U-inv', 'invoices=' + await inv(hu));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (account switch)` : `  ALL GREEN — ${pass} passed, 0 failed  (account switch)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
