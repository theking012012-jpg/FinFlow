'use strict';
/**
 * verify-f90-accountant-residual.js — PROVE (Rule 14) the F90 residual: the remaining accountant
 * workflow handlers on a CLIENT's books/relationship now write the immutable trail, ATTRIBUTED to
 * the accountant (actor_type='accountant', actor_id=accountantId), user_id = the client.
 *
 * Covers: notes, flag, checklist, message (singular + plural), notify, record-commission,
 * approve-request (access grant), decline-request. bill-client is Stripe-gated (503 without a
 * Stripe key in the harness) so its audit line can't execute here — noted, not silently skipped.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90-accountant-residual.js
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const ACC = { email: 'f90r-acc@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const mkClient = async (email, status) => {
      const uid = (await c.query(
        `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
        [{ email, name: email, plan: 'trial', role: 'owner', subscriptionStatus: 'active' }]
      )).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, referral_month, referral_months_total)
                     VALUES ($1,$2,$3,'edit',0,6)`, [accId, uid, status]);
      return uid;
    };

    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status, stripe_account_id)
       VALUES ($1,$2,'A','B','F90RREF','verified',NULL) RETURNING id`, [ACC.email, bcrypt.hashSync(ACC.password, 10)]
    )).rows[0].id;

    const active  = await mkClient('f90r-active@finflow.test', 'active');   // handlers that require an active link
    const pendA   = await mkClient('f90r-approve@finflow.test', 'pending'); // approve-request
    const pendD   = await mkClient('f90r-decline@finflow.test', 'pending'); // decline-request

    const http = new HarnessHttp(server.baseUrl);
    A('accountant login 200', (await http.post('/api/accountants/login', ACC)).status === 200);

    // ── exercise each residual handler ──
    const calls = [
      ['notes',        () => http.post(`/api/accountants/clients/${active}/notes`,     { note: 'review Q2 payroll' })],
      ['flag',         () => http.post(`/api/accountants/clients/${active}/flag`,      { type: 'invoice', ref: 'INV-1', message: 'looks off' })],
      ['checklist',    () => http.post(`/api/accountants/clients/${active}/checklist`, { checklist: { vat: true, payroll: false } })],
      ['message',      () => http.post(`/api/accountants/clients/${active}/message`,   { message: 'hi client' })],
      ['messages',     () => http.post(`/api/accountants/clients/${active}/messages`,  { content: 'follow-up' })],
      ['notify',       () => http.post(`/api/accountants/clients/${active}/notify`,    { message: 'your report is ready' })],
      ['commission',   () => http.post('/api/accountants/record-commission',           { userId: active, billedAmountCents: 10000, description: 'Q2 services' })],
      ['approve-req',  () => http.post('/api/accountants/approve-request',             { userId: pendA })],
      ['decline-req',  () => http.post('/api/accountants/decline-request',             { userId: pendD })],
    ];
    for (const [name, fn] of calls) {
      const r = await fn();
      A(`${name} handler 2xx`, r.status >= 200 && r.status < 300, `status ${r.status} ${JSON.stringify(r.json)}`);
    }

    // ── assert each landed on the immutable trail, attributed to the accountant ──
    const rows = (await c.query(`SELECT table_name, action, actor_type, actor_id, user_id FROM audit_trail WHERE actor_type='accountant'`)).rows;
    const has = (t, a, uid) => rows.find(r => r.table_name === t && r.action === a && r.user_id === uid && r.actor_id === accId);
    const expect = [
      ['notes → NOTE_UPDATE',        'accountant_clients',  'NOTE_UPDATE',       active],
      ['flag → FLAG',                'accountant_reports',  'FLAG',              active],
      ['checklist → CHECKLIST_UPDATE','accountant_clients', 'CHECKLIST_UPDATE',  active],
      ['message → MESSAGE',          'accountant_messages', 'MESSAGE',           active],
      ['notify → NOTIFY_CLIENT',     'accountant_clients',  'NOTIFY_CLIENT',     active],
      ['commission → COMMISSION_RECORD','accountant_earnings','COMMISSION_RECORD', active],
      ['approve → CLIENT_ACTIVATE',  'accountant_clients',  'CLIENT_ACTIVATE',   pendA],
      ['decline → CLIENT_DECLINE',   'accountant_clients',  'CLIENT_DECLINE',    pendD],
    ];
    for (const [label, t, a, uid] of expect) {
      A(`${label} audited + attributed to accountant`, !!has(t, a, uid),
        `trail=${JSON.stringify(rows.map(x => x.table_name + '/' + x.action + '/u' + x.user_id))}`);
    }
    // both message routes write MESSAGE rows → at least 2 for the active client
    A('both message routes (singular + plural) audited',
      rows.filter(r => r.table_name === 'accountant_messages' && r.action === 'MESSAGE' && r.user_id === active).length >= 2);

    // immutability still holds (the trail is append-only)
    let blocked = false;
    try { await c.query(`UPDATE audit_trail SET action='X' WHERE actor_type='accountant'`); }
    catch { blocked = true; }
    A('audit_trail remains append-only (UPDATE rejected)', blocked);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F90 accountant residual)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
