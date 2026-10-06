#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-consent.js — N78 + N80. An accountant cannot grant itself access to a client's books.
 *
 * Defects:
 *   N78 — a user who signs up through an accountant's ?ref link gets a PENDING link they never asked
 *         for; the accountant could flip it to 'active' (= full books access) with activate-client or
 *         approve-request, with no action by the client.
 *   N80 — when the client's subscription ended the webhook SUSPENDED the link; the accountant could
 *         call reactivate-client and regain books access without the client.
 *
 * Executed against the real server + Postgres, through the real routes (referral signup via
 * /api/auth/register with ref=<code>). Bug value stated:
 *   referral link: accountant approve-request        → 409 AWAITING_CLIENT_CONSENT, stays pending  (bug: 200, active)
 *   referral link: accountant activate-client        → 409, stays pending                          (bug: 200, active)
 *   referral link: accountant reads /books           → 403/404                                     (bug: 200 after self-activation)
 *   referral link: CLIENT approves                   → 200, active, accountant /books 200           (control)
 *   client-initiated request: accountant approves    → 200, active                                 (control)
 *   referral link: client declines                   → link removed, accountant cannot activate
 *   suspended link: accountant reactivate-client     → 403, stays suspended                        (bug: 200, active)
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-consent.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'consent-harness-pw-1';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('consent-acc@finflow.test', $1, 'Acc', 'Consent', 'Firm', 'CONSENTREF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    let ip = 1;
    const H = () => new HarnessHttp(server.baseUrl, { xff: '10.78.0.' + (ip++) });
    const acc = H();
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'consent-acc@finflow.test', password: PW })).status === 200);
    const status = async (uid) => { const r = (await c.query(`SELECT status FROM accountant_clients WHERE accountant_id=$1 AND user_id=$2`, [accId, uid])).rows[0]; return r ? r.status : null; };
    const register = async (email) => {
      const h = H();
      const r = await h.post('/api/auth/register', { email, password: PW, name: email.split('@')[0], ref: 'CONSENTREF' });
      if (r.status !== 201) throw new Error('register ' + email + ' ' + r.status + r.text);
      const uid = (await c.query(`SELECT id FROM users WHERE data->>'email'=$1`, [email])).rows[0].id;
      for (let i = 0; i < 50 && !(await status(uid)); i++) await new Promise(res => setTimeout(res, 20));   // referral link is written async after signup
      return { h, uid };
    };

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT ACCESS NEEDS THE CLIENT\'S CONSENT');
    console.log('='.repeat(78));

    const R = await register('consent-ref@finflow.test');
    A('referral signup created a PENDING link', (await status(R.uid)) === 'pending', 'status=' + await status(R.uid));
    const ap = await acc.post('/api/accountants/approve-request', { userId: R.uid });
    A('accountant approve-request on a referral link → 409 AWAITING_CLIENT_CONSENT (bug: 200)', ap.status === 409 && ap.json && ap.json.code === 'AWAITING_CLIENT_CONSENT', `status ${ap.status}: ${ap.text.slice(0, 120)}`);
    const act = await acc.post('/api/accountants/activate-client', { userId: R.uid });
    A('accountant activate-client on a referral link → 409 (bug: 200)', act.status === 409, `status ${act.status}`);
    A('  link still pending (bug: active)', (await status(R.uid)) === 'pending', 'status=' + await status(R.uid));
    const bk = await acc.get('/api/accountants/clients/' + R.uid + '/books');
    A('  accountant cannot read the books (bug: 200)', bk.status === 403 || bk.status === 404, 'status ' + bk.status);
    const pend = await acc.get('/api/accountants/pending-requests');
    A('  dashboard lists it as a referral awaiting the client', (pend.json || []).some(r => r.user_id === R.uid && r.requested_by === 'referral'), JSON.stringify(pend.json));
    const mine = await R.h.get('/api/accountants/my-accountant');
    A('  client sees the pending referral link', mine.json && mine.json.status === 'pending' && mine.json.requested_by === 'referral', JSON.stringify(mine.json));

    const cap = await R.h.post('/api/accountants/my-accountant/approve', { accountantId: accId });
    A('control: CLIENT approves the referral link → 200', cap.status === 200, `status ${cap.status}: ${cap.text.slice(0, 120)}`);
    A('control: link active, accountant can read the books', (await status(R.uid)) === 'active' && (await acc.get('/api/accountants/clients/' + R.uid + '/books')).status === 200);

    // Client-initiated request: the accountant accepts it.
    const Q = await (async () => { const h = H(); await h.post('/api/auth/register', { email: 'consent-req@finflow.test', password: PW, name: 'Req' }); const uid = (await c.query(`SELECT id FROM users WHERE data->>'email'='consent-req@finflow.test'`)).rows[0].id; return { h, uid }; })();
    A('client requests access (request-access) → 200', (await Q.h.post('/api/accountants/request-access', { accountantId: accId })).status === 200);
    const qa = await acc.post('/api/accountants/approve-request', { userId: Q.uid });
    A('control: accountant approves a CLIENT-initiated request → 200, active', qa.status === 200 && (await status(Q.uid)) === 'active', `status ${qa.status}: ${qa.text.slice(0, 100)}`);

    // Client declines a referral link.
    const D = await register('consent-decline@finflow.test');
    A('client declines a referral link → 200', (await D.h.post('/api/accountants/my-accountant/decline', { accountantId: accId })).status === 200);
    A('  link removed; accountant cannot activate it', (await status(D.uid)) === null && (await acc.post('/api/accountants/activate-client', { userId: D.uid })).status === 404);

    // N80: suspended by the webhook (subscription ended) → accountant cannot reactivate.
    await c.query(`UPDATE accountant_clients SET status='suspended', referral_months_total=6, referral_month=1 WHERE accountant_id=$1 AND user_id=$2`, [accId, Q.uid]);
    const re = await acc.post('/api/accountants/reactivate-client', { userId: Q.uid });
    A('accountant reactivate-client on a suspended link → 403 (bug: 200)', re.status === 403, `status ${re.status}`);
    A('  link still suspended (bug: active)', (await status(Q.uid)) === 'suspended', 'status=' + await status(Q.uid));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant consent)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant consent)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
