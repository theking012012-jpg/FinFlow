#!/usr/bin/env node
'use strict';
/**
 * verify-account-delete.js — N18. Deleting an account erases everything the account owns, all at once,
 * or nothing at all.
 *
 * Defects (executed on the old code): DELETE /api/auth/account looped over a hand-kept table list with
 * every error swallowed, then deleted the users row — which CASCADES into audit_trail, whose append-only
 * trigger refuses DELETE. Result: HTTP 500, the user row and login survive, but the books were already
 * erased. The list also missed api_keys, accountant links/messages, support requests, … ; other devices
 * stayed logged in. Entity deletion hit the same audit cascade.
 *
 * Executed against the real server + Postgres. Bug value stated:
 *   delete with password → 200                               (bug: 500)
 *   users row gone; invoices, api_keys, support_requests, accountant link + messages,
 *     membership in ANOTHER account → 0 rows                  (bug: user row kept / rows left behind)
 *   audit_trail rows kept (append-only legal record)          (control)
 *   second device's session → 401; login fails               (bug: still logged in)
 *   injected failure mid-delete → 500, NOTHING deleted (user + invoices intact)   (bug: books erased)
 *   deleting an entity that has audit rows → 200              (bug: 500 via the audit cascade)
 *   node -r ./tests/harness/clock.js tests/harness/verify-account-delete.js
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
    const PW = 'delete-me-pw-1';
    let ip = 1; const H = () => new HarnessHttp(server.baseUrl, { xff: '10.18.0.' + (ip++) });
    const mk = async (email) => {
      const id = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
      const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [id, { name: 'Co ' + id, currency: 'USD', is_active: 1 }])).rows[0].id;
      return { id, eid };
    };
    const login = async (email) => { const h = H(); return (await h.post('/api/auth/login', { email, password: PW })).status === 200 ? h : null; };
    const D = await mk('del-user@finflow.test');
    const other = await mk('del-other@finflow.test');
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status) VALUES ('del-acc@finflow.test','x','A','B','F','DELREF1','verified') RETURNING id`)).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, requested_by) VALUES ($1,$2,'active','client')`, [accId, D.id]);
    await c.query(`INSERT INTO accountant_messages (accountant_id, user_id, sender, content) VALUES ($1,$2,'client','hello')`, [accId, D.id]).catch(() => {});
    const h1 = await login('del-user@finflow.test'), h2 = await login('del-user@finflow.test');
    A('two devices logged in', !!h1 && !!h2);
    await h1.post('/api/invoices', { client: 'C', amount: 100, status: 'pending', issue_date: '2026-07-01' });
    await h1.post('/api/api-keys', { name: 'k' });
    await h1.post('/api/support', { subject: 's', message: 'help' });
    // membership in ANOTHER account, added after D's own data (an active membership scopes D's requests into it — N36)
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [other.id, { email: 'del-user@finflow.test', role: 'viewer', status: 'active', member_user_id: String(D.id) }]);
    const count = async (t, col = 'user_id', v = D.id) => Number((await c.query(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = $1`, [v])).rows[0].n);
    A('seeded: invoice, api key, support request, accountant link, audit rows', (await count('invoices')) === 1 && (await count('api_keys')) === 1 && (await count('support_requests')) === 1 && (await count('accountant_clients')) === 1 && (await count('audit_trail')) > 0);

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNT DELETE — everything or nothing');
    console.log('='.repeat(78));
    // 1) injected failure: a trigger on api_keys refuses the delete mid-way
    await c.query(`CREATE OR REPLACE FUNCTION _harness_block_del() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected delete failure'; END $$ LANGUAGE plpgsql`);
    await c.query(`CREATE TRIGGER _harness_block_del BEFORE DELETE ON api_keys FOR EACH ROW EXECUTE FUNCTION _harness_block_del()`);
    const f = await h1.request('DELETE', '/api/auth/account', { password: PW });
    A('injected failure mid-delete → 500', f.status === 500, 'status ' + f.status);
    A('  NOTHING deleted: user row and invoice intact (bug: books erased)', (await count('users', 'id')) === 1 && (await count('invoices')) === 1, `user=${await count('users', 'id')} invoices=${await count('invoices')}`);
    await c.query(`DROP TRIGGER _harness_block_del ON api_keys`);

    // 2) the real delete
    const auditBefore = await count('audit_trail');
    const r = await h1.request('DELETE', '/api/auth/account', { password: PW });
    A('delete with password → 200 (bug: 500)', r.status === 200, `status ${r.status}: ${r.text.slice(0, 120)}`);
    A('users row gone (bug: kept)', (await count('users', 'id')) === 0);
    for (const t of ['invoices', 'entities', 'api_keys', 'support_requests', 'accountant_clients', 'user_settings']) A(`  ${t}: 0 rows`, (await count(t)) === 0, 'n=' + await count(t));
    A('  membership in another account removed', Number((await c.query(`SELECT COUNT(*) n FROM team_members WHERE data->>'member_user_id'=$1`, [String(D.id)])).rows[0].n) === 0);
    A('  accountant profile itself untouched', Number((await c.query(`SELECT COUNT(*) n FROM accountants WHERE id=$1`, [accId])).rows[0].n) === 1);
    A('control: audit_trail rows kept (append-only)', (await count('audit_trail')) === auditBefore && auditBefore > 0, `before=${auditBefore} after=${await count('audit_trail')}`);
    A('second device logged out (bug: still in)', (await h2.get('/api/auth/me')).status === 401);
    A('login no longer works', !(await login('del-user@finflow.test')));

    // 3) entity delete with audit rows referencing the entity
    const ho = await login('del-other@finflow.test');
    const e2 = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [other.id, { name: 'Second', currency: 'USD', is_active: 0 }])).rows[0].id;
    await c.query(`INSERT INTO audit_trail (user_id, entity_id, table_name, action, actor_type, actor_id) VALUES ($1,$2,'entities','CREATE','user',$1)`, [other.id, e2]);
    const de = await ho.del('/api/entities/' + e2);
    A('deleting an entity that has audit rows → 200 (bug: 500)', de.status === 200, `status ${de.status}: ${de.text.slice(0, 120)}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (account delete)` : `  ALL GREEN — ${pass} passed, 0 failed  (account delete)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
