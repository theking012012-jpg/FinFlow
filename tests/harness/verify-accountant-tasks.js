'use strict';
/**
 * verify-accountant-tasks.js — marketplace client tasks / document requests.
 *
 * An accountant assigns a linked client tasks (title, detail, optional due date); the client marks
 * them done/undone. Covers the lifecycle + gates: only the accountant creates (only for a linked
 * client), only the owning client completes, delete is accountant-scoped. Discriminating (Rule 14):
 * marking done flips status + stamps done_at; an unlinked client sees none; a non-owner can't complete.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-tasks.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const clientId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'task-client@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const otherId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'task-other@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                    VALUES ($1,$2,'Ada','Ledger','Ledger & Co','REF-TASK','verified',NOW(),NOW()) RETURNING id`,
      ['task-acct@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, clientId]);

    const client = new HarnessHttp(server.baseUrl, { xff: '203.0.113.50' });
    A('client login', (await client.post('/api/auth/login', { email: 'task-client@finflow.test', password: PW })).status === 200);
    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.51' });
    A('accountant login', (await acct.post('/api/accountants/login', { email: 'task-acct@finflow.test', password: PW })).status === 200);
    const other = new HarnessHttp(server.baseUrl, { xff: '203.0.113.52' });
    A('unrelated client login', (await other.post('/api/auth/login', { email: 'task-other@finflow.test', password: PW })).status === 200);

    // Gates on creation
    A('[GATE] client cannot assign a task (needs accountant) → 401', (await client.post('/api/accountants/clients/' + clientId + '/tasks', { title: 'x' })).status === 401);
    A('[GATE] accountant cannot assign to a non-linked client → 403', (await acct.post('/api/accountants/clients/' + otherId + '/tasks', { title: 'x' })).status === 403);
    A('empty title → 400', (await acct.post('/api/accountants/clients/' + clientId + '/tasks', { title: '  ' })).status === 400);

    // Create
    const t1 = await acct.post('/api/accountants/clients/' + clientId + '/tasks', { title: 'Upload Q3 bank statements', detail: 'PDF or CSV, all accounts.', due_date: '2026-10-15' });
    A('accountant creates task → 200', t1.status === 200, 'status=' + t1.status + ' body=' + (t1.text || '').slice(0, 140));
    A('task stored open with due date', t1.json && t1.json.status === 'open' && String(t1.json.due_date).slice(0, 10) === '2026-10-15', JSON.stringify(t1.json));
    const tid = t1.json && t1.json.id;
    A('bad due date is ignored, not stored', (await acct.post('/api/accountants/clients/' + clientId + '/tasks', { title: 'no date', due_date: 'soon' })).json.due_date == null);

    // Client sees; unlinked doesn't
    const cliList = (await client.get('/api/accountants/my-accountant/tasks')).json;
    A('client sees the assigned task', cliList.tasks.some(t => t.id === tid && t.status === 'open'), JSON.stringify(cliList.tasks && cliList.tasks.map(t => t.title)));
    A('[GATE] unlinked client sees no tasks', (await other.get('/api/accountants/my-accountant/tasks')).json.tasks.length === 0);
    A('[GATE] non-owner cannot complete it → 404', (await other.post('/api/accountants/my-accountant/tasks/' + tid + '/done', {})).status === 404);

    // Complete + reopen
    const done = await client.post('/api/accountants/my-accountant/tasks/' + tid + '/done', {});
    A('client marks done → status done + done_at', done.json && done.json.status === 'done' && !!done.json.done_at, JSON.stringify(done.json));
    A('accountant sees it done', (await acct.get('/api/accountants/clients/' + clientId + '/tasks')).json.tasks.find(t => t.id === tid).status === 'done');
    const reopen = await client.post('/api/accountants/my-accountant/tasks/' + tid + '/done', { done: false });
    A('client reopens → status open + done_at cleared', reopen.json && reopen.json.status === 'open' && !reopen.json.done_at, JSON.stringify(reopen.json));

    // Delete (accountant-scoped)
    A('accountant deletes a task → 200', (await acct.del('/api/accountants/tasks/' + tid)).status === 200);
    A('deleted task no longer listed', !(await acct.get('/api/accountants/clients/' + clientId + '/tasks')).json.tasks.some(t => t.id === tid));
    A('deleting an unknown task → 404', (await acct.del('/api/accountants/tasks/999999')).status === 404);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (marketplace client tasks / requests)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
