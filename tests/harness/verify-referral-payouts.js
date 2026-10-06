#!/usr/bin/env node
'use strict';
/**
 * verify-referral-payouts.js — N79 / N79b / N82. Referral commission: at most one month booked per client
 * per calendar month, only while the client is PAYING, and never twice for the same month.
 *
 * Defects:
 *   N79/N79b — activating a link (approve-request / activate-client) booked "$10 month 1" without
 *              checking the client's subscription and without advancing referral_month, so the monthly
 *              run then paid month 1 AGAIN.
 *   N82      — the monthly run had no transaction and ON CONFLICT DO NOTHING with no unique index behind
 *              it: a second run in the same month paid every link again and advanced referral_month twice.
 *
 * Executed against the real server + Postgres (real approve-request, real cron route with CRON_SECRET).
 * P = paying client, T = trialing client, both client-initiated requests. Tier: 3 referral months.
 * Bug value stated:
 *   approve P                         → P: 1 earning, referral_month 1     (bug: 1 earning, referral_month 0)
 *   approve T (trialing)              → T: 0 earnings                      (bug: 1)
 *   monthly run, same month           → P: still 1                         (bug: 2 — month 1 paid again)
 *   monthly run again                 → P: still 1                         (bug: 3)
 *   3 concurrent runs                 → P: still 1                         (bug: more)
 *   next month (P's booking moved back a month) → P: exactly 2, referral_month 2   (control)
 *   T starts paying, run              → T: 1, referral_month 1             (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-referral-payouts.js
 */
process.env.CRON_SECRET = 'harness-cron-secret';
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'referral-payouts-pw';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('pay-acc@finflow.test', $1, 'Pay', 'Acc', 'Firm', 'PAYREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    const mkClient = async (email, sub) => {
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', subscriptionStatus: sub }])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, referral_months_total, requested_by) VALUES ($1,$2,'pending',0,'client')`, [accId, uid]);
      return uid;
    };
    const P = await mkClient('pay-p@finflow.test', 'active');
    const T = await mkClient('pay-t@finflow.test', 'trialing');
    const acc = new HarnessHttp(server.baseUrl, { xff: '10.79.0.1' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'pay-acc@finflow.test', password: PW })).status === 200);
    const earn = async (uid) => Number((await c.query(`SELECT COUNT(*) n FROM accountant_earnings WHERE accountant_id=$1 AND client_id=$2 AND type='referral'`, [accId, uid])).rows[0].n);
    const rmonth = async (uid) => Number((await c.query(`SELECT referral_month m FROM accountant_clients WHERE accountant_id=$1 AND user_id=$2`, [accId, uid])).rows[0].m);
    const cron = () => fetch(server.baseUrl + '/api/accountants/run-monthly-payouts', { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET, 'Content-Type': 'application/json', 'X-Forwarded-For': '10.79.0.9' }, body: '{}' }).then(r => r.status);

    console.log('\n' + '='.repeat(78));
    console.log('  REFERRAL COMMISSION — once per month, paying clients only');
    console.log('='.repeat(78));
    A('approve P → 200', (await acc.post('/api/accountants/approve-request', { userId: P })).status === 200);
    A('P: 1 referral earning, referral_month 1 (bug: referral_month 0)', (await earn(P)) === 1 && (await rmonth(P)) === 1, `earnings=${await earn(P)} month=${await rmonth(P)}`);
    A('approve T (trialing) → 200', (await acc.post('/api/accountants/approve-request', { userId: T })).status === 200);
    A('T (not paying): 0 earnings (bug: 1)', (await earn(T)) === 0, 'earnings=' + await earn(T));

    A('monthly run → 200', (await cron()) === 200);
    A('same month: P still 1 earning (bug: 2 — month 1 paid again)', (await earn(P)) === 1, 'earnings=' + await earn(P));
    await cron();
    A('second run same month: P still 1 (bug: 3)', (await earn(P)) === 1 && (await rmonth(P)) === 1, `earnings=${await earn(P)} month=${await rmonth(P)}`);
    await Promise.all([cron(), cron(), cron()]);
    A('3 concurrent runs: P still 1', (await earn(P)) === 1, 'earnings=' + await earn(P));

    // Next month: move P's existing booking back one calendar month, then run.
    await c.query(`UPDATE accountant_earnings SET period_month = (date_trunc('month', NOW()) - INTERVAL '1 month')::date WHERE accountant_id=$1 AND client_id=$2`, [accId, P]);
    await cron();
    A('control: next month → P exactly 2 earnings, referral_month 2', (await earn(P)) === 2 && (await rmonth(P)) === 2, `earnings=${await earn(P)} month=${await rmonth(P)}`);

    await c.query(`UPDATE users SET data = data || '{"subscriptionStatus":"active"}' WHERE id=$1`, [T]);
    await cron();
    A('control: T starts paying → 1 earning, referral_month 1', (await earn(T)) === 1 && (await rmonth(T)) === 1, `earnings=${await earn(T)} month=${await rmonth(T)}`);
    const total = Number((await c.query(`SELECT COALESCE(SUM(amount_cents),0) s FROM accountant_earnings WHERE accountant_id=$1 AND type='referral'`, [accId])).rows[0].s);
    A('total referral commission = 3 months × $10 = 3000 cents', total === 3000, 'total=' + total);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (referral payouts)` : `  ALL GREEN — ${pass} passed, 0 failed  (referral payouts)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
