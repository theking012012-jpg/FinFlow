'use strict';
/*
 * verify-de-concern-promise.js — D-E. Reporting a concern about an accountant: the client was told "Our team reviews
 * reports within 24 hours", while the conduct policy (conduct.html §9, which accountants agree to) promises FinFlow
 * "acknowledges every report within 2 business days, tells you about it … and asks for your response". Nothing tracked
 * either: no deadline was stored, the admin queue had no acknowledge step and no way to tell the accountant.
 * After: one promise (the policy's) — the client is told the actual date; the report stores it (2 business days =
 * 16 business hours, Mon–Fri 09:00–17:00 in SUPPORT_TZ, support-sla.js); the admin queue shows it, flags it overdue,
 * and has Acknowledge (emails the client) and Tell the accountant (emails them for their response, never naming the
 * client) — each once, audited.
 *
 * Real Postgres + real routes + Resend recorded at the boundary. The clock is pinned to Sat 25 Jul 2026 16:00 UTC.
 * Hand-computed: Saturday and Sunday are not business days → 8 h Mon 27 Jul + 8 h Tue 28 Jul → due Tue 28 Jul 17:00 UTC
 * (bug: "within 24 hours", nothing stored).
 *   node -r ./tests/harness/clock.js tests/harness/verify-de-concern-promise.js
 */
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'mock' } }; } }; } } } };
require('./clock.js');
process.env.ADMIN_PASSWORD = 'harness-admin-password-not-a-secret';
delete process.env.ADMIN_TOTP_SECRET;
delete process.env.SUPPORT_TZ;
const fs = require('fs'), path = require('path');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock'; process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    process.env.ADMIN_PASSWORD = 'harness-admin-password-not-a-secret';
    const database = require('../../database.js'); await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    console.log('\n' + '='.repeat(78) + '\n  D-E — the concern-report promise is one promise, and it is tracked\n' + '='.repeat(78) + '\n');
    const PW = 'de-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'client@de.test', name: 'Casey Client', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status) VALUES ('ada@de.test','x','Ada','Ledger','DEREF1','approved') RETURNING id`)).rows[0].id;
    const user = new HarnessHttp(base, { xff: '203.0.113.61' });
    A('client login 200', (await user.post('/api/auth/login', { email: 'client@de.test', password: PW })).status === 200);
    const r = await user.post('/api/accountants/report', { accountantId: acc, reason: 'Missed two filing dates', category: 'service' });
    const j = r.json || {};
    A('1  the client is told the real date: by Tuesday 28 July, 17:00 (UTC) (bug: "within 24 hours")', r.status === 200 && /2 business days/.test(j.promise || '') && /Tuesday 28 July, 17:00 \(UTC\)/.test(j.promise || ''), JSON.stringify(j));
    const row = (await c.query(`SELECT * FROM accountant_reports WHERE accountant_id = $1`, [acc])).rows[0] || {};
    A('2  the report stores that deadline: 2026-07-28T17:00Z (bug: nothing stored)', row.respond_by && new Date(row.respond_by).toISOString() === '2026-07-28T17:00:00.000Z', String(row.respond_by));
    // STRUCTURAL (labelled, Rule 5): the words the client reads — no value can express that a sentence is gone
    const html = require('./appScripts.js').pageSource('index.html');
    A('3  [structural] the report dialog no longer promises "within 24 hours"; it states the policy\'s 2 business days', !/reviews reports within 24 hours|review within 24 hours/.test(html) && /acknowledge every report within 2 business days/.test(html), '');

    const admin = new HarnessHttp(base, { xff: '198.51.100.61' });
    A('admin login 200', (await admin.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const list = async () => ((await admin.get('/api/admin/reports')).json || []).find(x => x.id === row.id) || {};
    const l1 = await list();
    A('4  the admin queue shows the deadline, not overdue yet', l1.respond_by && new Date(l1.respond_by).toISOString() === '2026-07-28T17:00:00.000Z' && l1.overdue === false, JSON.stringify({ rb: l1.respond_by, od: l1.overdue }));
    await c.query(`UPDATE accountant_reports SET respond_by = '2026-07-24T17:00:00Z' WHERE id = $1`, [row.id]);
    const l2 = await list();
    A('5  past its deadline and not acknowledged → flagged overdue', l2.overdue === true, JSON.stringify({ od: l2.overdue }));
    const ack = await admin.post('/api/admin/reports/' + row.id + '/acknowledge', {});
    const ack2 = await admin.post('/api/admin/reports/' + row.id + '/acknowledge', {});
    const toClient = sent.filter(m => m.to === 'client@de.test');
    const l3 = await list();
    A('6  Acknowledge emails the client once (twice clicked) and clears overdue', ack.status === 200 && ack2.status === 200 && toClient.length === 1 && /received your report/i.test(toClient[0].subject) && l3.acknowledged_at && l3.overdue === false, JSON.stringify({ n: toClient.length, s: toClient[0] && toClient[0].subject, od: l3.overdue }));
    const tell = await admin.post('/api/admin/reports/' + row.id + '/notify-accountant', {});
    await admin.post('/api/admin/reports/' + row.id + '/notify-accountant', {});
    const toAcc = sent.filter(m => m.to === 'ada@de.test');
    const body = toAcc[0] ? String(toAcc[0].html) : '';
    A('7  Tell the accountant emails them once, asks for their response, and never names the client', tell.status === 200 && toAcc.length === 1 && /response/i.test(body) && !/Casey|client@de\.test/.test(body), JSON.stringify({ n: toAcc.length, body: body.slice(0, 200) }));
    const logged = (await c.query(`SELECT action FROM admin_log WHERE action IN ('report_acknowledge','report_notify_accountant') ORDER BY id`)).rows.map(x => x.action);
    A('8  both are on the admin log', logged.join(',') === 'report_acknowledge,report_notify_accountant', logged.join(','));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack || e); }
  finally { try { if (server) server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (D-E concern promise)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
