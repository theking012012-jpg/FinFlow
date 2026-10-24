'use strict';
/**
 * verify-fab1-auto-emails.js — FA-B1 (full app audit B1: the Email Templates page promised "Auto — 7 days after due",
 * "Auto — on payment", "Auto — 14 days overdue", "Auto — 1st of month", and Settings "Email alerts — notify on overdue
 * invoices" — nothing sent any of them). After: per business, opt-in automatic emails run by the hourly job; every send
 * claimed once in auto_email_log first (Rule 9); a failed send is retried; templates editable with only the
 * placeholders FinFlow can fill; "Send test" mails the owner a sample.
 *
 * Real Postgres + the real server; Resend replaced by a recorder (no network). Clock 2026-07-25.
 *   customers: Acme (acme@x.test) · Beta (beta@x.test) · NoMail Co (no email)
 *   invoices (open): Acme INV-A due 18 Jul (7 days late) · Beta INV-B due 11 Jul (14 late) · NoMail INV-N due 18 Jul ·
 *                    Old Co due 2025-01-01 (570 late) · Acme INV-P PAID, due 18 Jul
 *   payment: Acme INV-C, 300 on 24 Jul
 *   EXPECTED with reminder@7, overdue@14, receipt and owner alert on (statement off):
 *     reminder → acme (INV-A) · overdue notice → beta (INV-B) · receipt → acme (INV-C, 300) · owner digest → INV-A + INV-N
 *     = 4 emails; nothing to NoMail (no address), nothing for Old Co (outside the catch-up week), nothing for the paid one.
 *     A second run and 3 concurrent runs send nothing more. (bug: the job does not exist — 0 emails, ever.)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab1-auto-emails.js
 */
const sent = []; let failFor = null;
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { if (failFor && m.to === failFor) { failFor = null; throw new Error('Resend 500'); } sent.push(m); return { data: { id: 'mock' } }; } }; } },
} };
require('./clock.js');
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
    const database = require('../../database.js'); await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const PW = 'fab1-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'owner@fab1.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ent = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
    const ins = async (t, d) => (await c.query(`INSERT INTO ${t} (user_id, entity_id, data) VALUES ($1,$2,$3) RETURNING id`, [uid, ent, d])).rows[0].id;
    await ins('customers', { company: 'Acme', fname: '', lname: '', email: 'acme@x.test', status: 'active' });
    await ins('customers', { company: 'Beta', fname: '', lname: '', email: 'beta@x.test', status: 'active' });
    await ins('customers', { company: 'NoMail Co', fname: '', lname: '', email: '', status: 'active' });
    await ins('customers', { company: 'Old Co', fname: '', lname: '', email: 'old@x.test', status: 'active' });
    await ins('invoices', { client: 'Acme', number: 'INV-A', amount: 500, status: 'pending', issue_date: '2026-06-18', due_date: '2026-07-18' });
    await ins('invoices', { client: 'Beta', number: 'INV-B', amount: 800, status: 'pending', issue_date: '2026-06-11', due_date: '2026-07-11' });
    await ins('invoices', { client: 'NoMail Co', number: 'INV-N', amount: 90, status: 'pending', issue_date: '2026-06-18', due_date: '2026-07-18' });
    await ins('invoices', { client: 'Old Co', number: 'INV-O', amount: 70, status: 'overdue', issue_date: '2024-12-01', due_date: '2025-01-01' });
    await ins('invoices', { client: 'Acme', number: 'INV-P', amount: 60, status: 'paid', amount_paid: 60, issue_date: '2026-06-18', due_date: '2026-07-18' });
    const invC = await ins('invoices', { client: 'Acme', number: 'INV-C', amount: 1000, status: 'partial', amount_paid: 300, issue_date: '2026-07-01', due_date: '2026-07-31' });
    await c.query(`INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date, method, notes, idempotency_key) VALUES ($1,$2,$3,300,'2026-07-24','bank','','fab1-pay')`, [uid, ent, invC]);
    const http = new HarnessHttp(base, { xff: '10.97.0.1' });
    A('login', (await http.post('/api/auth/login', { email: 'owner@fab1.test', password: PW })).status === 200);
    console.log('\n' + '='.repeat(78) + '\n  FA-B1 — automatic customer emails, sent once each\n' + '='.repeat(78) + '\n');

    A('0  the job exists (bug: nothing sends these emails)', typeof app.runAutoEmails === 'function', '');
    if (typeof app.runAutoEmails !== 'function') throw new Error('no job');
    await app.runAutoEmails();
    A('1  with every automatic email off (the default), nothing is sent', sent.length === 0, JSON.stringify(sent.map(m => m.to)));

    const bad = await http.put('/api/auto-emails', { templates: { reminder: { subject: 'Pay {{invoice_number}}', body: 'Pay here: {{portal_link}}' } } });
    A('2  a template using a placeholder FinFlow cannot fill ({{portal_link}}) is refused', bad.status === 400 && /portal_link/.test(bad.text), 'status ' + bad.status);
    const put = await http.put('/api/auto-emails', { settings: { reminder: { on: true, days_after_due: 7 }, overdue: { on: true, days_overdue: 14 }, receipt: { on: true }, owner_alert: { on: true } },
      templates: { reminder: { subject: 'Nudge: {{invoice_number}} ({{amount_due}})', body: 'Hi {{customer_name}}, {{invoice_number}} was due {{due_date}}. {{business_name}}' } } });
    A('3  turning them on and saving a custom reminder → 200', put.status === 200, put.text.slice(0, 160));

    failFor = 'beta@x.test';   // the first try at Beta's overdue notice fails at the email service
    await app.runAutoEmails();
    const summary = () => sent.map(m => m.to + ' ' + m.subject).sort();
    console.log('  [sent] ' + JSON.stringify(summary()));
    A('4  reminder to Acme for INV-A with the custom subject "Nudge: INV-A (USD 500.00)"', sent.some(m => m.to === 'acme@x.test' && m.subject === 'Nudge: INV-A (USD 500.00)'), '');
    A('5  receipt to Acme for the 300 payment on INV-C, saying 700 is still owed', sent.some(m => m.to === 'acme@x.test' && /INV-C/.test(m.subject) && /USD 300\.00/.test(m.text) && /USD 700\.00/.test(m.text)), '');
    A('6  owner digest lists INV-A and INV-N (newly overdue), not Old Co', sent.some(m => m.to === 'owner@fab1.test' && /INV-A/.test(m.text) && /INV-N/.test(m.text) && !/INV-O/.test(m.text)), '');
    A('7  Beta\'s overdue notice failed at the email service → not sent yet, claim released', !sent.some(m => m.to === 'beta@x.test'), '');
    A('8  nothing to NoMail (no address), Old Co (570 days late — outside the catch-up week) or the paid invoice', !sent.some(m => /old@|INV-P|INV-O/.test(m.to + m.subject + m.text)), '');
    await app.runAutoEmails();
    A('9  the next run sends Beta\'s overdue notice (INV-B, 14 days)', sent.some(m => m.to === 'beta@x.test' && /INV-B/.test(m.subject) && /14 days/.test(m.subject)), '');
    A('10 in all: 4 emails, one each', sent.length === 4, JSON.stringify(summary()));
    await app.runAutoEmails();
    await Promise.all([app.runAutoEmails(), app.runAutoEmails(), app.runAutoEmails()]);
    A('11 a third run and 3 concurrent runs send nothing more (each email claimed once)', sent.length === 4, String(sent.length));

    const test = await http.post('/api/auto-emails/test', { kind: 'reminder' });
    const last = sent[sent.length - 1] || {};
    A('12 "Send test" mails the OWNER a sample of the saved reminder, marked [Test]', test.status === 200 && last.to === 'owner@fab1.test' && /^\[Test\] Nudge: INV-0042/.test(last.subject), (last.subject || '') + ' → ' + (last.to || ''));
    const AE = require('../../auto-emails');
    A('13 the statement is due on the 1st of the business month (catching up to the 7th), not on the 25th',
      AE.statementDue({ statement: { on: true } }, '2026-08-01') && AE.statementDue({ statement: { on: true } }, '2026-08-07') && !AE.statementDue({ statement: { on: true } }, '2026-07-25'), '');
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await new Promise(r => server.close(r)); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-B1 automatic emails)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
