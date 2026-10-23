'use strict';
/**
 * verify-lc3f-accountant-audit.js — LC3f (owner decision 2026-10-20: "industry standard, but better").
 *
 * The accountant portal recorded the ACCOUNTANT's side of the client relationship (their messages, proposals, tasks,
 * journals …) but not the CLIENT's: a client accepting a paid proposal, sending a message or file, marking a task
 * done, requesting access, reviewing or reporting an accountant left no record — nor did an accountant withdrawing a
 * proposal or deleting a task. The accountant's own account events (sign-up, sign-out, 2FA on / off / wrong code,
 * identity check, linking a payout account, deadlines) and the monthly payout run were not recorded at all.
 *
 * Standard: both parties' actions on a shared relationship are on its record, with who did it; every account event of
 * the accountant (success and failure). Better: every client-relationship row lands on the CLIENT's own audit trail —
 * the person whose books the accountant works on sees exactly what was done in their relationship, by whom — and
 * never the content of a message (only that one was sent, by which side).
 *
 * Real scratch Postgres, real server, real client + accountant sessions, real routes.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3f-accountant-audit.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const totp = require('../../totp.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const PW = 'harness-password-not-a-secret';

(async () => {
  let scratch, server;
  console.log('\nLC3f — both sides of the accountant relationship are on the client\'s trail; accountant account events recorded\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    try { const { runMigrations, pool } = require('../../database.js'); await runMigrations(pool); } catch (_) {}
    process.env.CRON_SECRET = 'harness-cron-secret';
    const clientId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'lc3f-client@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                    VALUES ('lc3f-acct@finflow.test',$1,'Ada','Ledger','Ledger & Co','REF-LC3F','verified',NOW(),NOW()) RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    const acc2 = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                    VALUES ('lc3f-acct2@finflow.test',$1,'Bo','Books','Books Ltd','REF-LC3F2','verified',NOW(),NOW()) RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, clientId]);

    const client = new HarnessHttp(server.baseUrl, { xff: '203.0.113.60', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36' });
    eq('client signs in', (await client.post('/api/auth/login', { email: 'lc3f-client@finflow.test', password: PW })).status, 200);
    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.61', ua: 'Mozilla/5.0 (Macintosh; Mac OS X 14_5) Safari/605.1.15' });
    eq('accountant signs in', (await acct.post('/api/accountants/login', { email: 'lc3f-acct@finflow.test', password: PW })).status, 200);
    let mark = 0;
    const since = async () => { mark = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM audit_trail`)).rows[0].m; };
    const trail = async uid => (await c.query(`SELECT table_name, action, actor_type, actor_id, old_value, new_value, old_data, new_data FROM audit_trail WHERE id > $1 AND user_id IS NOT DISTINCT FROM $2 ORDER BY id`, [mark, uid])).rows;
    const who = r => [r.table_name, r.action, r.actor_type];

    // ── client side → the client's own trail ──
    await since();
    await client.post('/api/accountants/my-accountant/messages', { content: 'Here are my Q3 numbers — secret detail 4711' });
    await client.post('/api/accountants/my-accountant/attach', { name: 'q3.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 q3').toString('base64') });
    await client.post('/api/accountant-messages', { content: 'Second route — secret detail 4712' });
    let t = await trail(clientId);
    eq('the other client-message route (server.js /api/accountant-messages) → MESSAGE, actor the client, no text', [t.length && t[t.length - 1].action, t.length && t[t.length - 1].actor_type, JSON.stringify(t).includes('4712')], ['MESSAGE', 'user', false], ['MESSAGE_ATTACH', 'user', false]);
    t = t.slice(0, 2);
    eq('client message + attachment → MESSAGE / MESSAGE_ATTACH on the client trail, actor = the client', t.map(who), [['accountant_messages', 'MESSAGE', 'user'], ['accountant_messages', 'MESSAGE_ATTACH', 'user']], []);
    eq('…the side that sent it is recorded, the message text is not', [t[0] && t[0].new_data && t[0].new_data.sender, JSON.stringify(t).includes('4711')], ['client', false], [null, false]);

    const p = await acct.post('/api/accountants/clients/' + clientId + '/proposals', { title: 'Year-end accounts', fee: 450, currency: 'USD' });
    const p2 = await acct.post('/api/accountants/clients/' + clientId + '/proposals', { title: 'Bookkeeping clean-up', fee: 120, currency: 'USD' });
    await since();
    await client.post('/api/accountants/my-accountant/proposals/' + p.json.id + '/respond', { action: 'accept' });
    await acct.post('/api/accountants/proposals/' + p2.json.id + '/withdraw', {});
    t = await trail(clientId);
    eq('client accepts a paid proposal → PROPOSAL_ACCEPTED (actor client); accountant withdraws another → PROPOSAL_WITHDRAWN (actor accountant)', t.map(who), [['accountant_proposals', 'PROPOSAL_ACCEPTED', 'user'], ['accountant_proposals', 'PROPOSAL_WITHDRAWN', 'accountant']], []);
    eq('…with the proposal and its fee', t[0] && t[0].new_data ? [t[0].new_data.title, t[0].new_data.fee_cents] : null, ['Year-end accounts', 45000], null);

    const tk = await acct.post('/api/accountants/clients/' + clientId + '/tasks', { title: 'Upload bank statements' });
    await since();
    await client.post('/api/accountants/my-accountant/tasks/' + tk.json.id + '/done', {});
    await client.post('/api/accountants/my-accountant/tasks/' + tk.json.id + '/done', { done: false });
    await acct.del('/api/accountants/tasks/' + tk.json.id);
    t = await trail(clientId);
    eq('task done → reopened (client), deleted (accountant)', t.map(who), [['accountant_tasks', 'TASK_DONE', 'user'], ['accountant_tasks', 'TASK_REOPENED', 'user'], ['accountant_tasks', 'TASK_DELETED', 'accountant']], []);
    eq('…the deleted task kept on the record', t[2] && t[2].old_data && t[2].old_data.title, 'Upload bank statements', null);

    await since();
    await client.post('/api/accountants/review', { accountantId: accId, rating: 4, comment: 'Quick and clear' });
    await client.post('/api/accountants/report', { accountantId: accId, reason: 'Missed a deadline', category: 'service' });
    await client.post('/api/accountants/request-access', { accountantId: acc2 });
    t = await trail(clientId);
    eq('review, report, access request → on the client trail', t.map(who), [['accountant_reviews', 'REVIEW', 'user'], ['accountant_reports', 'REPORT', 'user'], ['accountant_clients', 'ACCESS_REQUESTED', 'user']], []);
    eq('…naming the accountant and the rating / category', [t[0] && t[0].new_data && [t[0].new_data.accountant_id, t[0].new_data.rating], t[1] && t[1].new_data && t[1].new_data.category, t[2] && t[2].new_data && t[2].new_data.accountant_id], [[accId, 4], 'service', acc2], null);

    // ── the accountant's own account (no client trail) ──
    await since();
    const s = await acct.post('/api/accountants/mfa/setup', {});
    await acct.post('/api/accountants/mfa/enable', { token: '000000' });
    await acct.post('/api/accountants/mfa/enable', { token: totp.generate(s.json.secret) });
    const fresh = new HarnessHttp(server.baseUrl, { xff: '203.0.113.62' });
    await fresh.post('/api/accountants/login', { email: 'lc3f-acct@finflow.test', password: PW, token: '111111' });
    await acct.post('/api/accountants/mfa/disable', { token: totp.generate(s.json.secret) });
    await acct.post('/api/accountants/deadlines', { client_name: 'Client A', filing_type: 'VAT return', due_date: '2026-11-30' });
    const dl = (await c.query(`SELECT id FROM accountant_deadlines WHERE accountant_id = $1 ORDER BY id DESC LIMIT 1`, [accId])).rows[0];
    if (dl) await acct.del('/api/accountants/deadlines/' + dl.id);
    await acct.post('/api/accountants/logout', {});
    const own = (await c.query(`SELECT table_name, action, actor_type, actor_id, record_id, new_data FROM audit_trail WHERE id > $1 AND user_id IS NULL AND (record_id = $2 OR actor_id = $2) ORDER BY id`, [mark, accId])).rows;
    eq("accountant's own events: 2FA set-up / wrong code / on, failed sign-in (2FA code), 2FA off, deadline added / removed, sign-out",
      own.map(r => r.action), ['MFA_SETUP_STARTED', 'MFA_CODE_REJECTED', 'MFA_ENABLED', 'LOGIN_FAILED', 'MFA_DISABLED', 'CREATE', 'DELETE', 'LOGOUT'], []);
    eq('…the failed sign-in is the wrong 2FA code (never the code itself)', own.find(r => r.action === 'LOGIN_FAILED') && own.find(r => r.action === 'LOGIN_FAILED').new_data, { reason: 'mfa_code' }, null);
    eq('…none of them on a client\'s trail', (await trail(clientId)).length, 0);

    // sign-up of a new accountant
    await since();
    const reg = new HarnessHttp(server.baseUrl, { xff: '203.0.113.63' });
    const rr = await reg.post('/api/accountants/register', { conductAccepted: true, conductVersion: require('../../conduct-policy').VERSION, firstName: 'Cy', lastName: 'Count', email: 'lc3f-new@finflow.test', password: PW, firm: 'Count & Co', country: 'US',
      specialisation: 'Small business', verification: { method: 'membership', membershipNumber: 'AICPA-123456' } });
    const newId = (await c.query(`SELECT id FROM accountants WHERE email = 'lc3f-new@finflow.test'`)).rows[0];
    eq('accountant sign-up succeeds', rr.status < 300, true);
    eq('…and is recorded (SIGNUP, the new accountant)', newId ? (await c.query(`SELECT action FROM audit_trail WHERE id > $1 AND table_name = 'accountants' AND record_id = $2 ORDER BY id`, [mark, newId.id])).rows.map(r => r.action) : null, ['SIGNUP'], []);

    // the monthly payout run (system)
    await since();
    const pr = await new HarnessHttp(server.baseUrl).request('POST', '/api/accountants/run-monthly-payouts', {});
    const cron = await fetch(server.baseUrl + '/api/accountants/run-monthly-payouts', { method: 'POST', headers: { 'x-cron-secret': 'harness-cron-secret', 'Content-Type': 'application/json' }, body: '{}' });
    const run = (await c.query(`SELECT action, actor_type, new_data FROM audit_trail WHERE id > $1 AND action = 'PAYOUT_RUN'`, [mark])).rows;
    eq('the monthly payout run (cron) is recorded once, as the system, with its counts', [cron.status, pr.status, run.length, run[0] && run[0].actor_type, run[0] && run[0].new_data && typeof run[0].new_data.created], [200, 401, 1, 'system', 'number'], [200, 401, 0, null, null]);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
