'use strict';
/**
 * verify-dg4-retention.js — D-G step 4 (owner decision 2026-10-23: "read-only 90 days after cancellation; a deletion
 * warning 14 days before removal"). Before: an account whose plan ended stayed read-only FOR EVER — nothing was ever
 * deleted and nobody was told anything (FA-C1).
 * Now the billing job, for an account whose paid plan ended (billing.access_ended_at) and which is not paying again:
 *   • day 76 → one e-mail: the deletion date, how to export, how to keep it (choose a plan) — sent once
 *   • day 90 → the account's data is erased exactly as "Delete my account" does (the audit trail of the books is kept),
 *              recorded as an ACCOUNT_DELETED audit row by the system
 *   • NEVER deleted without the 14-day warning having been sent: a missed warning is sent now and pushes the deletion to
 *     14 days after it
 *   • a paying account, a trial that never paid, and an account inside its 90 days are untouched
 *   • subscribing again stops the clock
 * Clock pinned 2026-07-25. Seed (days since access ended): U1 77 (warn) · U2 91, warned 20 days ago (delete) ·
 *   U3 91, never warned (warn now, keep) · U4 100 but paying again (keep) · U5 trial ended long ago, never paid (keep) ·
 *   U6 50 (nothing).
 * Real server + Postgres; the `resend` module is replaced in the require cache to capture every e-mail.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor(key) { this.key = key; this.emails = { send: async (msg) => { sent.push(msg); return { data: { id: 'mock-' + sent.length } }; } }; } },
} };
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const DAY = 86400000;
const NOW = Date.parse('2026-07-25T16:00:00Z');
const ago = d => new Date(NOW - d * DAY).toISOString();

(async () => {
  let scratch, server;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock_dg4';
    process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    process.env.APP_URL = 'https://finflow-test.example';
    const database = require('../../database.js');
    await database.initDB();
    const PW = 'dg4-pw-123';
    const mk = async (email, extra) => {
      const id = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [Object.assign({ email, name: email.split('@')[0], role: 'owner', password: bcrypt.hashSync(PW, 10) }, extra)])).rows[0].id;
      const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [id, { name: email + ' Co', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
      await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [id, eid, { client: 'C', amount: 10, status: 'pending', issue_date: '2026-01-05' }]);
      return id;
    };
    const ended = (d, more) => Object.assign({ plan: 'trial', trial_ends: ago(d), billing: Object.assign({ access_ended_at: ago(d), plan: 'pro', interval: 'month' }, more || {}) });
    const u1 = await mk('u1@finflow.test', ended(77));
    const u2 = await mk('u2@finflow.test', ended(91, { deletion_warned_at: ago(20) }));
    const u3 = await mk('u3@finflow.test', ended(91));
    const u4 = await mk('u4@finflow.test', Object.assign(ended(100), { plan: 'business', trial_ends: null }));
    const u5 = await mk('u5@finflow.test', { plan: 'trial', trial_ends: ago(300) });
    const u6 = await mk('u6@finflow.test', ended(50));
    await c.query(`INSERT INTO audit_trail (user_id, table_name, record_id, action, actor_type) VALUES ($1, 'invoices', 1, 'CREATE', 'user')`, [u2]);

    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    console.log('\n' + '='.repeat(78) + '\n  D-G step 4 — 90 days read-only, a 14-day warning, then deletion\n' + '='.repeat(78) + '\n');

    const h1 = new HarnessHttp(base, { xff: '10.124.0.1' });
    await h1.post('/api/auth/login', { email: 'u1@finflow.test', password: PW });
    const b1 = (await h1.get('/api/billing')).json || {};
    A('0  the Billing panel data says when the books will be deleted: 2026-08-07 (ended 2026-05-09 + 90 days; bug: never)', String(b1.deleteOn || '').slice(0, 10) === '2026-08-07' && !!b1.accessEndedAt, JSON.stringify(b1));

    await app.runBillingJob(NOW);
    const to = addr => sent.filter(m => [].concat(m.to).includes(addr));
    const m1 = to('u1@finflow.test');
    // u1 is warned on day 77 — one day after the day-76 schedule — so the 14-day rule moves the deletion to 25 Jul + 14
    // = 8 August (not the 7 August the 90 days alone would give): the customer always gets the full 14 days.
    A('1  day 77: one warning e-mail to u1 — deletion on 8 August 2026 (a full 14 days after the warning), export, how to keep it', m1.length === 1 && /8 August 2026/.test(m1[0].html || '') && /8 August 2026/.test(m1[0].subject || '') && /export/i.test(m1[0].html || '') && /plan/i.test(m1[0].html || ''), JSON.stringify(m1.map(m => [m.subject, String(m.html || '').slice(0, 200)])));
    const gone = async id => (await c.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [id])).rows[0].n === 0;
    A('2  day 91, warned 20 days ago: u2\'s account and books are erased', await gone(u2) && (await c.query(`SELECT count(*)::int AS n FROM invoices WHERE user_id = $1`, [u2])).rows[0].n === 0, 'u2 still there');
    const a2 = (await c.query(`SELECT action, actor_type FROM audit_trail WHERE user_id = $1 ORDER BY id`, [u2])).rows;
    A('2b …the audit trail of the books is kept, plus an ACCOUNT_DELETED row by the system', a2.some(r => r.action === 'CREATE') && a2.some(r => r.action === 'ACCOUNT_DELETED' && r.actor_type === 'system'), JSON.stringify(a2));
    const d3 = (await c.query(`SELECT data FROM users WHERE id = $1`, [u3])).rows[0];
    A('3  day 91 but NEVER warned: u3 is NOT deleted; the warning goes now and the deletion moves 14 days after it', !!d3 && to('u3@finflow.test').length === 1 && !!(d3.data.billing || {}).deletion_warned_at, JSON.stringify(d3 && d3.data.billing));
    A('4  a paying account (u4), a never-paid trial (u5) and one inside its 90 days with no warning due (u6) are untouched', !(await gone(u4)) && !(await gone(u5)) && !(await gone(u6)) && to('u4@finflow.test').length + to('u5@finflow.test').length + to('u6@finflow.test').length === 0,
      JSON.stringify(sent.map(m => m.to)));

    const before = sent.length;
    await app.runBillingJob(NOW);
    A('5  running the job again sends nothing more and deletes nothing more', sent.length === before && !(await gone(u1)) && !(await gone(u3)), 'sent ' + (sent.length - before));

    await app.runBillingJob(NOW + 15 * DAY);
    A('6  15 days after u3\'s warning, u3 is erased', await gone(u3), 'u3 still there');

    // subscribing again stops the clock
    const Billing = require('../../billing.js');
    await Billing.syncSubscription(require('../../database.js').pool, u6, { id: 'sub_back', status: 'active', metadata: { plan: 'pro' }, items: { data: [{ id: 'si_b', price: { id: 'p', recurring: { interval: 'month' } } }] } }, {}, NOW);
    const d6 = (await c.query(`SELECT data FROM users WHERE id = $1`, [u6])).rows[0].data;
    A('7  subscribing again stops the clock (access_ended_at and the warning cleared; on Pro)', d6.plan === 'pro' && !(d6.billing || {}).access_ended_at && !(d6.billing || {}).deletion_warned_at, JSON.stringify(d6.billing));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-G retention)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
