'use strict';
/**
 * verify-dh1-support-sla.js — D-H part 1 (owner decision 2026-10-23: support promises upgraded and BUILT). The plan cards
 * promised "Priority email support" / "Priority support" / "Onboarding assistance" and nothing backed them: a ticket had
 * no reply target, nothing knew when one was late. Now (plans.js):
 *   Pro / trial: a reply within 1 business day (8 business hours) · Business: 4 business hours · Scale: 2 business hours
 *   + an onboarding call — business hours Mon–Fri 09:00–17:00 in the support timezone (SUPPORT_TZ, here UTC)
 *   • each ticket stores its plan and reply-by time, and the customer is told it
 *   • the admin queue is sorted by reply-by, counts overdue tickets, and the first reply records whether it was met
 *     (the clock is pinned: a ticket seeded with a reply-by already past stands in for "late")
 *   • the plan cards state the support line from plans.js
 * Clock pinned Saturday 2026-07-25 16:00Z → next opening Monday 27 July 09:00:
 *   Pro → Mon 17:00 · Business → Mon 13:00 · Scale → Mon 11:00   (bug, calendar hours: Sun 00:00 · Sat 20:00 · Sat 18:00)
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const Plans = require(path.join(__dirname, '..', '..', 'plans.js'));

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  D-H part 1 — support with stated reply times, kept\n' + '='.repeat(78) + '\n');
  process.env.SUPPORT_TZ = 'UTC';
  process.env.ADMIN_PASSWORD = 'harness-admin-password';
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  await initSchema(scratch.url);
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const mk = async (email, plan) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, name: email, plan, role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const login = async (email, xff) => { const h = new HarnessHttp(server.baseUrl, { xff }); await h.post('/api/auth/login', { email, password: PW }); return h; };
    await mk('sp@finflow.test', 'pro'); await mk('sb@finflow.test', 'business'); await mk('ss@finflow.test', 'scale');
    const P = Plans.PLANS;
    A('0  plans.js holds the targets: Pro 8 · Business 4 · Scale 2 business hours; Scale has an onboarding call', P.pro.support && P.pro.support.replyHours === 8 && P.business.support.replyHours === 4 && P.scale.support.replyHours === 2 && P.scale.support.onboardingCall === true,
      JSON.stringify(P.pro.support) + JSON.stringify(P.business.support) + JSON.stringify(P.scale.support));
    const want = { 'sp@finflow.test': '2026-07-27T17:00', 'sb@finflow.test': '2026-07-27T13:00', 'ss@finflow.test': '2026-07-27T11:00' };
    const hs = {};
    for (const [email, due] of Object.entries(want)) {
      const h = hs[email] = await login(email, '10.130.0.' + Object.keys(hs).length);
      const r = await h.post('/api/support', { subject: 'Help', message: 'Question from ' + email, category: 'general' });
      A('1  ' + email.split('@')[0] + ': ticket reply-by ' + due + 'Z (business hours; bug: calendar hours)', r.status === 201 && String((r.json || {}).replyBy || '').slice(0, 16) === due && /reply/i.test((r.json || {}).promise || ''), r.status + ' ' + String(r.text).slice(0, 200));
    }
    const mine = (await hs['sb@finflow.test'].get('/api/support')).json || {};
    A('2  the customer\'s own ticket list shows the reply-by time', ((mine.requests || [])[0] || {}).replyBy && String(mine.requests[0].replyBy).slice(0, 16) === '2026-07-27T13:00', JSON.stringify(mine.requests && mine.requests[0]));

    // the admin queue (ADMIN_PASSWORD is the admin sign-in)
    const admin = new HarnessHttp(server.baseUrl, { xff: '10.130.1.1' });
    const al = await admin.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    const q = await admin.get('/api/admin/support');
    const list = (q.json || {}).requests || [];
    A('3  the admin queue is sorted by reply-by (Scale first, then Business, then Pro)', al.status === 200 && list.length === 3 && list.map(t => t.plan).join() === 'scale,business,pro', al.status + '/' + q.status + ' ' + JSON.stringify(list.map(t => [t.plan, t.replyBy])));
    // an older Pro ticket whose reply-by (Tue 21 July 17:00) has passed, still unanswered
    const oldId = (await c.query(`INSERT INTO support_requests (user_id, entity_id, data, created_at) VALUES (NULL, NULL, $1, '2026-07-20T16:00:00Z') RETURNING id`, [{ actor: 'client', subject: 'Old', message: 'Older question', category: 'general', email: 'sp@finflow.test', status: 'open', plan: 'pro', reply_by: '2026-07-21T17:00:00.000Z' }])).rows[0].id;
    const q2 = (await admin.get('/api/admin/support')).json || {};
    A('4  the queue counts overdue tickets (the old Pro one, unanswered past its reply-by) and puts it first', q2.overdueCount === 1 && ((q2.requests || [])[0] || {}).id === oldId && (q2.requests[0] || {}).overdue === true, JSON.stringify({ overdue: q2.overdueCount, first: (q2.requests || [])[0] }));
    const sid = (list.find(t => t.plan === 'scale') || {}).id;
    const r1 = await admin.post('/api/admin/support/' + sid, { response: 'Hello', status: 'resolved' });
    const r2 = await admin.post('/api/admin/support/' + oldId, { response: 'Sorry for the wait' });
    const rows = (await c.query(`SELECT id, data FROM support_requests ORDER BY id`)).rows;
    const sd = rows.find(x => x.id === sid).data, od = rows.find(x => x.id === oldId).data;
    A('5  the first reply records whether the target was met (Scale answered now, before Mon 11:00 → met; the old one → missed)', r1.status === 200 && r2.status === 200 && !!sd.first_response_at && sd.sla_met === true && od.sla_met === false, JSON.stringify({ s: [sd.first_response_at, sd.sla_met], o: [od.first_response_at, od.sla_met] }));
    const q3 = (await admin.get('/api/admin/support')).json || {};
    A('5b once answered, a ticket is no longer overdue', q3.overdueCount === 0, JSON.stringify({ overdue: q3.overdueCount }));

    // the plan cards say it
    const lines = id => Plans.cardLines(id).join(' | ');
    A('6  the plan cards state the support from plans.js', /reply within 1 business day/.test(lines('pro')) && /reply within 4 business hours/.test(lines('business')) && /reply within 2 business hours/.test(lines('scale')) && /onboarding call/i.test(lines('scale')), lines('pro') + ' // ' + lines('scale'));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-H support SLA)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
