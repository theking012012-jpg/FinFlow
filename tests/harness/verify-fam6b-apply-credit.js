'use strict';
/*
 * verify-fam6b-apply-credit.js — FA-M6b. A credit note could not be applied to an invoice (nor a vendor credit to a bill):
 * the credit only ever reduced the customer's total, the invoice it was for still showed its full balance, still got
 * reminders, and "Applied" could only be typed. After: a credit is applied to a specific invoice / bill of the SAME
 * customer / vendor, for up to what both have left; the document's balance due falls by it; the credit keeps only what is
 * left; total AR / AP do not move (the customer owed that much less already) and no ledger entry is written (AR to AR).
 * Every settle path (record payment, mark paid, the backfill's paid-gap) counts the credit, so cash is never invented.
 *
 * Real Postgres + real routes. Today pinned 2026-07-25. Hand-computed:
 *   A Acme 1,000 (due 10 Jul, overdue) paid 200 · B Acme 400 (due 30 Aug) · C Bright 500 (due 10 Jul, overdue)
 *   CN1 Acme 300 (15 Jul) · bill X Vee 600 · VC1 Vee 200
 *   before: AR 800 + 400 + 500 − 300 = 1,400 · overdue (800 − 300) + 500 = 1,000 · AP 600 − 200 = 400
 *   1  apply CN1 → A 250: A settled 450 (cash 200 + credit 250), balance 550 · CN1 left 50 · AR 1,400 (bug: 1,150 — the
 *      credit counted twice) · Acme AR 550 + 400 − 50 = 900 (bug 650) · overdue 500 + 500 = 1,000 (bug 750) · no GL entry
 *   2  the same request again (same key) → one application
 *   3  100 more from CN1 (50 left) → refused · 4  CN1 onto Bright's invoice → refused
 *   5  a 600 payment on A (550 owed) → refused (bug: allowed, 800 "owed")
 *   6  three concurrent 50 applications CN1 → B → exactly one lands; CN1 fully used → status Applied
 *   7  void / delete CN1, delete B → refused while applied · 8  unapply B → CN1 Open with 50 left, B balance 400
 *   9  A marked paid → the settling payment is 550 (bug: 800 → cash 250 invented)
 *  10  ledger backfill → no "paid-gap" cash for A (bug: 250) · balance sheet still served from the ledger, AR 850
 *  11  apply VC1 → X 150: X balance 450 · AP 400 unchanged (bug 250) · 12 a 500 payment on X → refused
 *  13  X marked paid → settling payment 450 (bug 600)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam6b-apply-credit.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
const J = r => { try { return JSON.parse(r.text); } catch (_) { return {}; } };
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  FA-M6b — apply a credit to the invoice / bill it is for\n' + '='.repeat(78) + '\n');
    const email = 'm6b@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'M6b Co', currency: 'USD', timezone: 'UTC', is_active: 1 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.98' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const inv = async (client, amount, issue, due) => J(await http.post('/api/invoices', { client, amount, status: 'pending', issue_date: issue, due_date: due, entity_id: eid }));
    const a = await inv('Acme', 1000, '2026-07-01', '2026-07-10'), b = await inv('Acme', 400, '2026-07-05', '2026-08-30'), cc = await inv('Bright', 500, '2026-07-01', '2026-07-10');
    A('setup: 200 paid on A', (await http.post('/api/invoice-payments', { invoice_id: a.id, amount: 200, payment_date: '2026-07-12' })).status < 300);
    const cn = J(await http.post('/api/credit-notes', { customer: 'Acme', amount: 300, date: '2026-07-15', idempotency_key: 'm6b-cn1' }));
    const x = J(await http.post('/api/bills', { vendor: 'Vee', amount: 600, issue_date: '2026-07-01', due_date: '2026-08-15', status: 'unpaid' }));
    const vc = J(await http.post('/api/vendor-credits', { vendor: 'Vee', amount: 200, date: '2026-07-10', idempotency_key: 'm6b-vc1' }));
    A('setup: every document created', a.id && b.id && cc.id && cn.id && x.id && vc.id, JSON.stringify({ a: a.id, b: b.id, c: cc.id, cn: cn.id, x: x.id, vc: vc.id }));
    const books = () => app.computeBooks(uid, eid, 'year');
    const invRow = async id => (J(await http.get('/api/invoices')) || []).find(r => r.id === id) || {};
    const billRow = async id => (J(await http.get('/api/bills')) || []).find(r => r.id === id) || {};
    const cnRow = async () => (J(await http.get('/api/credit-notes')) || []).find(r => r.id === cn.id) || {};
    const vcRow = async () => (J(await http.get('/api/vendor-credits')) || []).find(r => r.id === vc.id) || {};
    const glCount = async () => (await c.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n;
    const apply = (kind, credit_id, doc_id, amount, key) => http.post('/api/credit-applications', { kind, credit_id, doc_id, amount, date: '2026-07-20', idempotency_key: key });
    const b0 = await books();
    A('premise: AR 1,400 · overdue 1,000 · AP 400 before any application', near(b0.outstanding, 1400) && near(b0.arSummary.overdueTotal, 1000) && near(b0.accountsPayable, 400), JSON.stringify({ ar: b0.outstanding, ovd: b0.arSummary.overdueTotal, ap: b0.accountsPayable }));

    const gl0 = await glCount();
    const r1 = await apply('credit_note', cn.id, a.id, 250, 'm6b-k1');
    A('1  CN1 → A 250 accepted', r1.status < 300, r1.status + ' ' + r1.text.slice(0, 200));
    const a1 = await invRow(a.id), cn1 = await cnRow(), b1 = await books();
    A('1a A: settled 450 (cash 200 + credit 250), credit 250, part-paid — balance 550', near(a1.amount_paid, 450) && near(a1.credit_applied, 250) && String(a1.status).toLowerCase() === 'partial', JSON.stringify({ paid: a1.amount_paid, cr: a1.credit_applied, st: a1.status }));
    A('1b CN1 keeps 50, still Open', near(cn1.applied, 250) && cn1.status === 'Open', JSON.stringify({ applied: cn1.applied, st: cn1.status }));
    A('1c AR unchanged at 1,400 (bug: 1,150 — the credit counted twice)', near(b1.outstanding, 1400), String(b1.outstanding));
    const acme = (b1.arByCustomer || []).find(r => r.customer === 'Acme') || {};
    A('1d Acme owes 550 + 400 − 50 = 900 (bug: 650)', near(acme.amount, 900), JSON.stringify(b1.arByCustomer));
    A('1e overdue 1,000: Acme 550 − its 50 left + Bright 500 (bug: 750)', near(b1.arSummary.overdueTotal, 1000), String(b1.arSummary.overdueTotal));
    A('1f no ledger entry for an application (AR to AR)', (await glCount()) === gl0, (await glCount()) + ' vs ' + gl0);

    const r2 = await apply('credit_note', cn.id, a.id, 250, 'm6b-k1');
    const nApps = async () => (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float s FROM credit_applications WHERE user_id=$1 AND kind='credit_note' AND credit_id=$2`, [uid, cn.id])).rows[0];
    const n2 = await nApps();
    A('2  the same request again → still one application of 250', r2.status < 300 && n2.n === 1 && near(n2.s, 250), JSON.stringify(n2));
    const r3 = await apply('credit_note', cn.id, b.id, 100, 'm6b-k3');
    A('3  100 more from CN1 (50 left) → refused', r3.status >= 400 && /50\.00/.test(r3.text), r3.status + ' ' + r3.text.slice(0, 160));
    const r4 = await apply('credit_note', cn.id, cc.id, 10, 'm6b-k4');
    A('4  CN1 (Acme) onto Bright\'s invoice → refused', r4.status >= 400 && /customer/i.test(r4.text), r4.status + ' ' + r4.text.slice(0, 160));
    const r5 = await http.post('/api/invoice-payments', { invoice_id: a.id, amount: 600, payment_date: '2026-07-21' });
    A('5  a 600 payment on A (550 owed) → refused (bug: allowed)', r5.status >= 400, r5.status + ' ' + r5.text.slice(0, 160));

    const r6 = await Promise.all([1, 2, 3].map(i => apply('credit_note', cn.id, b.id, 50, 'm6b-k6-' + i)));
    const n6 = await nApps(), cn6 = await cnRow(), bb6 = await invRow(b.id);
    A('6  three concurrent 50s onto B → exactly one lands; CN1 used up → Applied', r6.filter(r => r.status < 300).length === 1 && n6.n === 2 && near(n6.s, 300) && cn6.status === 'Applied' && near(bb6.amount_paid, 50), JSON.stringify({ codes: r6.map(r => r.status), n6, st: cn6.status, bPaid: bb6.amount_paid }));
    const r7a = await http.put('/api/credit-notes/' + cn.id, { status: 'Void' });
    const r7b = await http.request('DELETE', '/api/credit-notes/' + cn.id);
    const r7c = await http.request('DELETE', '/api/invoices/' + b.id);
    A('7  void CN1 / delete CN1 / delete B → each refused while the credit is applied', r7a.status === 409 && r7b.status === 409 && r7c.status === 409, [r7a.status, r7b.status, r7c.status].join(','));
    const appB = (await c.query(`SELECT id FROM credit_applications WHERE user_id=$1 AND doc_id=$2 AND kind='credit_note'`, [uid, b.id])).rows[0];
    const r8 = await http.request('DELETE', '/api/credit-applications/' + (appB && appB.id));
    const cn8 = await cnRow(), bb8 = await invRow(b.id);
    A('8  unapply B → CN1 Open with 50 left; B owes 400 again', r8.status < 300 && cn8.status === 'Open' && near(cn8.applied, 250) && near(bb8.amount_paid, 0) && String(bb8.status).toLowerCase() === 'pending', JSON.stringify({ code: r8.status, st: cn8.status, applied: cn8.applied, bPaid: bb8.amount_paid, bSt: bb8.status }));

    A('9  A marked paid', (await http.put('/api/invoices/' + a.id, { status: 'paid' })).status < 300);
    const cash9 = (await c.query(`SELECT COALESCE(SUM(amount),0)::float s FROM invoice_payments WHERE user_id=$1 AND invoice_id=$2`, [uid, a.id])).rows[0].s;
    A('9a the settling payment is 550 — cash on A 750 (bug: 1,000, 250 invented)', near(cash9, 750), String(cash9));
    await app.backfillLedgerForUser(uid);
    const gap = (await c.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE user_id=$1 AND source_type='invoice_paidgap'`, [uid])).rows[0].n;
    A('10 backfill: no paid-gap cash for the credited invoice (bug: 250)', gap === 0, String(gap));
    const bs10 = await app.glBalanceSheet(uid, eid);
    A('10b balance sheet served from the ledger, AR 400 + 500 − 50 = 850', bs10.source === 'gl' && near(bs10.accountsReceivable, 850), JSON.stringify({ src: bs10.source, ar: bs10.accountsReceivable, failed: bs10.gateFailed }));

    const r11 = await apply('vendor_credit', vc.id, x.id, 150, 'm6b-v1');
    const x11 = await billRow(x.id), vc11 = await vcRow(), b11 = await books();
    A('11 VC1 → X 150: X settled 150, VC1 keeps 50, AP still 400 (bug: 250)', r11.status < 300 && near(x11.amount_paid, 150) && near(vc11.applied, 150) && near(b11.accountsPayable, 400), JSON.stringify({ code: r11.status, xPaid: x11.amount_paid, vcApplied: vc11.applied, ap: b11.accountsPayable, t: r11.text.slice(0, 120) }));
    const r12 = await http.post('/api/payments-made', { vendor: 'Vee', amount: 500, date: '2026-07-21', bill_id: x.id });
    A('12 a 500 payment on X (450 owed) → refused', r12.status >= 400, r12.status + ' ' + r12.text.slice(0, 160));
    A('13 X marked paid', (await http.put('/api/bills/' + x.id, { status: 'paid' })).status < 300);
    const cash13 = (await c.query(`SELECT COALESCE(SUM((data->>'amount')::numeric),0)::float s FROM payments_made WHERE user_id=$1 AND data->>'bill_id'=$2`, [uid, String(x.id)])).rows[0].s;
    A('13a the settling payment is 450 (bug: 600)', near(cash13, 450), String(cash13));
    const bs13 = await app.glBalanceSheet(uid, eid);
    A('13b balance sheet still served from the ledger', bs13.source === 'gl', JSON.stringify({ src: bs13.source, failed: bs13.gateFailed }));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (FA-M6b apply credit)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
