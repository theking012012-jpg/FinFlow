#!/usr/bin/env node
'use strict';
/**
 * verify-reminder-reply-to.js — N29. A payment reminder's Reply-To is the sender's email, so the customer's
 * reply reaches the business.
 *
 * Defect: POST /api/payment-reminders/send set reply_to from req.session.email, which the session never
 * holds (it stores userEmail) — reply_to was always empty and replies went to the no-reply address.
 * Executed: real server + Postgres; Resend replaced in the require cache to capture the message.
 *   reminder sent → reply_to = 'owner-rt@finflow.test'     (bug: undefined)
 *   node -r ./tests/harness/clock.js tests/harness/verify-reminder-reply-to.js
 */
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'mock' } }; } }; } },
} };
process.env.RESEND_API_KEY = 're_mock';
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    // Resend must be configured when server.js loads (it builds its client at module load) — the
    // installEnv boot keeps RESEND_API_KEY (bootServer clears it). Resend itself is the require-cache mock above.
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock';
    await require('../../database.js').initDB();
    const app = require('../../server.js');
    const srv = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    server = { baseUrl: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => srv.close(r)) };
    const PW = 'reply-to-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'owner-rt@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'RT Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO customers (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { fname: 'Pat', lname: 'Payer', company: 'Payer Ltd', email: 'payer@customer.test' }]);
    const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { client: 'Payer Ltd', amount: 500, amount_paid: 0, status: 'overdue', issue_date: '2026-06-01', due_date: '2026-07-01' }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.29.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'owner-rt@finflow.test', password: PW })).status === 200);
    const r = await h.post(`/api/payment-reminders/send?entity_id=${eA}`, { invoice_id: inv, subject: 'Reminder', body: 'Please pay.' });
    A('reminder sent → 200', r.status === 200, `status ${r.status} ${r.text.slice(0, 120)}`);
    const m = sent[sent.length - 1] || {};
    A('reply_to = the sender\'s email (bug: undefined)', m.reply_to === 'owner-rt@finflow.test', 'reply_to=' + JSON.stringify(m.reply_to));
    A('control: sent to the customer on file', m.to === 'payer@customer.test', 'to=' + JSON.stringify(m.to));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (reminder reply-to)` : `  ALL GREEN — ${pass} passed, 0 failed  (reminder reply-to)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
