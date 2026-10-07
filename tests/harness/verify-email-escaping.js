'use strict';
/**
 * verify-email-escaping.js — N85. Text a user typed (names, firm, notes) can never become markup in an
 * email FinFlow sends from its own domain.
 *
 * Defect: accountant-application admin alert, accountant → client invite (to ANY address), client
 * request-access alert, approve-request confirmation and the admin verify/reject email interpolated
 * names/firm/notes straight into HTML. Any accountant could put a link or form into an email that FinFlow
 * delivers to an arbitrary inbox.
 *
 * Executed against the real routes; Resend replaced in the require cache with a mock that captures every
 * send. Every user-entered field below carries a live payload. For EVERY captured email:
 *   no live <a href="https://evil.test">, <img, <script        (bug: present in 5 emails)
 *   the payload appears escaped (&lt;…)                        (proves the text still arrives)
 *   node -r ./tests/harness/clock.js tests/harness/verify-email-escaping.js
 */
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'mock' } }; } }; } },
} };
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const EVIL_A = '<a href="https://evil.test">Click to verify</a>';
const EVIL_IMG = '<img src=x onerror=alert(1)>';
const EVIL_S = '<script>alert(1)</script>';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock';
    process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    process.env.APP_URL = 'https://finflow-test.example';
    process.env.ADMIN_EMAIL = 'admin@test.example';
    process.env.ADMIN_PASSWORD = 'harness-admin-password';
    const database = require('../../database.js');
    await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    let ip = 1; const H = () => new HarnessHttp(base, { xff: '10.85.0.' + (ip++) });
    const PW = 'email-esc-pw-1';

    console.log('\n' + '='.repeat(78));
    console.log('  OUTBOUND EMAIL — user text is escaped, never markup');
    console.log('='.repeat(78));

    // 1. accountant application → admin alert (name / firm / specialisation carry payloads)
    const reg = await H().post('/api/accountants/register', { firstName: EVIL_A, lastName: 'Lee', email: 'esc-acc@finflow.test', password: PW, firm: EVIL_IMG, country: 'US', specialisation: EVIL_S, verification: { method: 'membership', membershipNumber: 'M-1' } });
    A('accountant application → 201', reg.status === 201, `status ${reg.status}: ${reg.text.slice(0, 120)}`);
    const accId = (await c.query(`SELECT id FROM accountants WHERE email='esc-acc@finflow.test'`)).rows[0].id;
    // 5. admin approves with notes (email to the accountant)
    const adm = H();
    A('admin login', (await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const v = await adm.post(`/api/admin/accountants/${accId}/verify`, { action: 'reject', notes: EVIL_A });
    A('admin reject with notes → 200', v.status === 200, `status ${v.status}: ${v.text.slice(0, 120)}`);
    await c.query(`UPDATE accountants SET status='verified', password_hash=$2 WHERE id=$1`, [accId, bcrypt.hashSync(PW, 10)]);
    const acc = H();
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'esc-acc@finflow.test', password: PW })).status === 200);
    // 2. invite to an arbitrary address, invitee name carries a payload
    const inv = await acc.post('/api/accountants/invite', { email: 'victim@elsewhere.test', name: EVIL_IMG });
    A('accountant invite → 2xx', inv.status >= 200 && inv.status < 300, `status ${inv.status}: ${inv.text.slice(0, 120)}`);
    // 3. client (name payload) requests access → accountant alert
    const cli = H();
    A('client register', (await cli.post('/api/auth/register', { email: 'esc-client@finflow.test', password: PW, name: EVIL_S })).status === 201);
    const ra = await cli.post('/api/accountants/request-access', { accountantId: accId });
    A('client request-access → 200', ra.status === 200, `status ${ra.status}: ${ra.text.slice(0, 120)}`);
    // 4. accountant approves → client confirmation (accountant name/firm payloads)
    const cuid = (await c.query(`SELECT id FROM users WHERE data->>'email'='esc-client@finflow.test'`)).rows[0].id;
    const ap = await acc.post('/api/accountants/approve-request', { userId: cuid });
    A('accountant approve-request → 200', ap.status === 200, `status ${ap.status}: ${ap.text.slice(0, 120)}`);
    await new Promise(r => setTimeout(r, 200));   // fire-and-forget sends

    const kinds = {
      'admin alert':       sent.find(m => m.to === 'admin@test.example'),
      'reject email':      sent.find(m => m.to === 'esc-acc@finflow.test'),
      'client invite':     sent.find(m => m.to === 'victim@elsewhere.test'),
      'request alert':     sent.find(m => m.to === 'esc-acc@finflow.test' && /request/i.test(m.subject || '')),
      'approve email':     sent.find(m => m.to === 'esc-client@finflow.test' && /approved/i.test(m.subject || '')),
    };
    for (const [k, m] of Object.entries(kinds)) {
      const html = m ? String(m.html) : '';
      A(`${k}: sent`, !!m, JSON.stringify(sent.map(x => [x.to, x.subject])));
      A(`${k}: no live <a href="https://evil.test">, <img, <script (bug: present)`, !!m && !/<a href="https:\/\/evil\.test"|<img |<script>/i.test(html), html.slice(0, 260));
      A(`${k}: the user text still arrives, escaped`, !!m && /&lt;(a|img|script)/.test(html), html.slice(0, 200));
    }
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await new Promise(r => server.close(r)); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (email escaping)` : `  ALL GREEN — ${pass} passed, 0 failed  (email escaping)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
