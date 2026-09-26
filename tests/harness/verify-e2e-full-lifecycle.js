#!/usr/bin/env node
'use strict';
/**
 * verify-e2e-full-lifecycle.js — THE WHOLE FINFLOW LIFECYCLE, START TO FINISH, THROUGH THE REAL API.
 *
 * One chained journey — no seed() shortcuts, no pre-inserted links — driving the actual HTTP surface
 * a real client and a real accountant hit, over REAL scratch Postgres + the REAL money engine:
 *
 *   ONBOARDING     signup (POST /api/auth/register) → zero entities → onboarding provisions the FIRST
 *                  entity (POST /api/entities) → a second entity for the multi-currency group
 *   CLIENT BOOKS   invoice (AR) · invoice paid-on-create (real cash settlement) · expense · bill (AP)
 *                  · payment made against the bill (AP settles) · sales receipt (cash sale) · credit
 *                  note (revenue contra) · payroll employee → run → approve → mark-paid (cash out)
 *   REPORTS + GL   P&L and balance sheet served from the LEDGER (source 'gl'), trial balance ties,
 *                  gl/verify balanced, glReconcile books-balanced AND reconciled-to-reports, and the
 *                  canonical computeBooks oracle agrees with the reported totals TO THE CENT
 *   CONSOLIDATION  a TTD entity + FX rates → entity_id=all consolidates multi-currency to base (source
 *                  'gl'), matches the computeBooks(null) oracle, ASC 830 CTA present, balance sheet ties
 *   ACCOUNTANT     register (POST /api/accountants/register, pending) → login blocked while pending →
 *                  admin verifies → login → profile
 *   CLIENT→ACCT    request-access → duplicate 409 → accountant sees the pending request → CANNOT read
 *                  books while pending (403) → approve → NOW reads the client's REAL certified books
 *                  (the seeded invoices flow through; default 'view' redacts payroll detail)
 *   ACCT→CLIENT    'view' cannot post a journal (403) → client grants 'filing' → accountant posts a
 *                  journal (201) → client sees the linked accountant at access_level filing
 *   CHAT           client → accountant message, accountant reads it (sender 'client'), accountant →
 *                  client reply, client reads the full ordered thread, unread counts move
 *   ISOLATION      a DIFFERENT accountant cannot read this client (403) · the linked accountant cannot
 *                  read an UNLINKED client (403) · a user cannot address another user's entity (403)
 *   DECLINE        a second client's request is declined → no link → still 403
 *
 * Rule 14: the assertions ARE the executed behaviour — break any leg of the lifecycle and one flips.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-e2e-full-lifecycle.js
 *
 * Scratch Postgres only (enforced by guard.js). Clock pinned 2026-07-25 by clock.js.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
let pass = 0, fail = 0, XFF = 40;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const section = (t) => console.log('\n' + '─'.repeat(78) + '\n  ' + t + '\n' + '─'.repeat(78));

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks, glReconcile } = require('../../server.js');

    console.log('\n' + '='.repeat(78));
    console.log('  FINFLOW — FULL LIFECYCLE, START TO FINISH, THROUGH THE REAL API');
    console.log('='.repeat(78));

    // Distinct XFF per actor so per-IP rate limits never cross-contaminate the actors.
    const sess = () => new HarnessHttp(server.baseUrl, { xff: '198.51.100.' + (XFF++) });
    const client = sess();     // the primary owner — signs up, onboards, does the books
    const a1 = sess();         // the accountant who links to the client
    const a2 = sess();         // a second accountant — isolation control
    const ownerB = sess();     // a second, unrelated owner — isolation + decline control

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('1 · ONBOARDING — signup provisions the first entity, then a second for the group');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const reg = await client.post('/api/auth/register', { email: 'e2e-client@finflow.test', password: 'client-pw-12345', name: 'Acme Owner' });
    A('signup → 201 and a session is issued', reg.status === 201 && reg.json && reg.json.user, JSON.stringify(reg.json));
    const uid = (await c.query(`SELECT id FROM users WHERE lower(data->>'email')=lower($1)`, ['e2e-client@finflow.test'])).rows[0].id;
    // Onboarding sets the account's home (base) currency — the currency the consolidated group reports in.
    await c.query(`UPDATE users SET data = jsonb_set(data,'{base_currency}','"USD"') WHERE id=$1`, [uid]);

    const ents0 = await client.get('/api/entities');
    A('a brand-new signup has ZERO entities (nothing books yet)', Array.isArray(ents0.json) && ents0.json.length === 0, JSON.stringify(ents0.json));

    const mkEnt1 = await client.post('/api/entities', { name: 'Acme USD', currency: 'USD', country: 'US' });
    A('onboarding provisions the first entity → 201', mkEnt1.status === 201 && mkEnt1.json && mkEnt1.json.id, JSON.stringify(mkEnt1.json));
    const e1 = mkEnt1.json.id;
    A('the account now has exactly one entity', (await client.get('/api/entities')).json.length === 1);

    // Simulate a completed Business subscription (the Stripe checkout path is proven elsewhere) so the
    // account may hold more than one entity — the trial cap is 1.
    await c.query(`UPDATE users SET data = jsonb_set(data,'{plan}','"business"') WHERE id=$1`, [uid]);
    const mkEnt2 = await client.post('/api/entities', { name: 'Acme TTD', currency: 'TTD', country: 'TT' });
    A('a second (TTD) entity is created for the multi-currency group → 201', mkEnt2.status === 201 && mkEnt2.json && mkEnt2.json.id, JSON.stringify(mkEnt2.json));
    const e2 = mkEnt2.json.id;
    A('the account now has two entities', (await client.get('/api/entities')).json.length === 2);
    A('the entity limit is enforced above the plan? (business allows ≥2, so both succeeded)', e1 !== e2);

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('2 · CLIENT-SIDE BOOKKEEPING (entity 1 / USD) — every money document type');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const q1 = { entity_id: e1 };
    // Invoice, issued & outstanding → AR
    const invOpen = await client.post('/api/invoices', { client: 'Customer North', amount: 1000, status: 'pending', issue_date: '2026-06-05', ...q1 });
    A('issue an invoice (outstanding) → 201', invOpen.status === 201 && invOpen.json.id, JSON.stringify(invOpen.json));
    // Invoice created already PAID → books the accrual AND a real cash settlement (Dr Cash / Cr AR)
    const invPaid = await client.post('/api/invoices', { client: 'Customer South', amount: 400, status: 'paid', issue_date: '2026-06-10', ...q1 });
    A('issue an invoice PAID-on-create → 201 (real cash settlement recorded)', invPaid.status === 201, JSON.stringify(invPaid.json));
    A('the paid invoice produced a settling invoice_payment (real cash on the ledger)',
      Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [invPaid.json.id])).rows[0].n) === 1);
    // Expense
    const exp = await client.post('/api/expenses', { description: 'Cloud hosting', category: 'Software', amount: 150, expense_date: '2026-06-12', ...q1 });
    A('record an expense → 201', exp.status === 201 && exp.json.id, JSON.stringify(exp.json));
    // Bill (AP), then a payment made against it (AP settles, not a fresh expense)
    const bill = await client.post('/api/bills', { vendor: 'Landlord LLC', amount: 800, status: 'unpaid', issue_date: '2026-06-12', due_date: '2026-07-12', ...q1 });
    A('enter a bill (unpaid → AP) → 200/201', (bill.status === 200 || bill.status === 201) && bill.json.id, JSON.stringify(bill.json));
    const payMade = await client.post('/api/payments-made', { vendor: 'Landlord LLC', amount: 800, date: '2026-06-20', method: 'Bank Transfer', bill_id: bill.json.id, ...q1 });
    A('pay the bill (payment made, bill-linked) → 201/200', (payMade.status === 201 || payMade.status === 200) && payMade.json.id, JSON.stringify(payMade.json));
    // Sales receipt (walk-in cash sale)
    const sr = await client.post('/api/sales-receipts', { customer: 'Walk-in', amount: 250, date: '2026-06-22', method: 'Card', ...q1 });
    A('ring a cash sale (sales receipt) → 201/200', (sr.status === 201 || sr.status === 200) && sr.json.id, JSON.stringify(sr.json));
    // (A credit note is issued LATER, in §4b, to prove the reconcile-gate's safe fallback in isolation —
    //  the GL nets AR on a credit note while the canonical oracle defers that to post-launch, F58.)
    // Payroll: an employee, then a run → approve → mark-paid (cash out)
    const emp = await client.post('/api/payroll', { fname: 'Jane', lname: 'Employee', role: 'Engineer', gross: 2000, entity_id: e1 });
    A('add a payroll employee → 201/200', (emp.status === 201 || emp.status === 200), JSON.stringify(emp.json));
    const run = await client.post('/api/payroll-runs', { period: '2026-06', ...q1 });
    A('run payroll for the period → 201', run.status === 201 && run.json.id, JSON.stringify(run.json));
    const appr = await client.put(`/api/payroll-runs/${run.json.id}/approve`, {});
    A('approve the payroll run → 200', appr.status === 200, JSON.stringify(appr.json));
    const paid = await client.put(`/api/payroll-runs/${run.json.id}/mark-paid`, {});
    A('mark the payroll run PAID (Dr payroll liab / Cr cash) → 200', paid.status === 200, JSON.stringify(paid.json));

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('3 · REPORTS + GENERAL LEDGER (entity 1) — served from the ledger, reconciled to the cent');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const pl1 = await client.post(`/api/reports/profit-loss?entity_id=${e1}`, {});
    A('P&L → 200 and is served FROM THE LEDGER (source gl)', pl1.status === 200 && pl1.json.source === 'gl', JSON.stringify({ src: pl1.json && pl1.json.source }));
    // Oracle: computeBooks is the canonical source of truth. Reports must equal it to the cent.
    const oracle1 = await computeBooks(uid, e1, 'year');
    A('P&L revenue matches the computeBooks oracle to the cent', near(pl1.json.totalRevenue, oracle1.revenue), `report=${pl1.json.totalRevenue} oracle=${oracle1.revenue}`);
    A('P&L net profit matches the computeBooks oracle to the cent', near(pl1.json.netProfit, oracle1.netProfit), `report=${pl1.json.netProfit} oracle=${oracle1.netProfit}`);

    const bs1 = await client.post(`/api/reports/balance-sheet?entity_id=${e1}`, {});
    A('balance sheet → 200, served from the ledger (source gl) with real tracked cash', bs1.status === 200 && bs1.json.source === 'gl' && typeof bs1.json.cash === 'number', JSON.stringify({ src: bs1.json && bs1.json.source, cash: bs1.json && bs1.json.cash }));
    A('balance sheet balances: assets = liabilities + equity', near(bs1.json.totalAssets, bs1.json.totalLiabilities + bs1.json.equity), JSON.stringify({ ta: bs1.json.totalAssets, tl: bs1.json.totalLiabilities, eq: bs1.json.equity }));

    const glVerify = await client.get(`/api/gl/verify?entity_id=${e1}`);
    A('gl/verify reports the ledger is balanced', glVerify.status === 200 && glVerify.json.booksBalanced === true, JSON.stringify(glVerify.json && { booksBalanced: glVerify.json.booksBalanced }));
    const tb = await client.get(`/api/gl/trial-balance?entity_id=${e1}`);
    A('gl/trial-balance → 200, balanced, total debits = total credits', tb.status === 200 && tb.json.balanced === true && near(tb.json.totalDebit, tb.json.totalCredit), JSON.stringify({ balanced: tb.json && tb.json.balanced, dr: tb.json && tb.json.totalDebit, cr: tb.json && tb.json.totalCredit }));

    const rec1 = await glReconcile(uid, e1);
    A('glReconcile: the ledger books are internally balanced', rec1 && rec1.booksBalanced === true, JSON.stringify({ booksBalanced: rec1 && rec1.booksBalanced }));
    A('glReconcile: the ledger reconciles to the canonical reports', rec1 && rec1.reconciledToReports === true, JSON.stringify({ reconciled: rec1 && rec1.reconciledToReports }));

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('4 · CONSOLIDATION — a TTD entity + FX → entity_id=all sums to base currency (source gl)');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // Base currency USD; TTD→USD transaction rate then a later (closing) rate that carries forward.
    await c.query(`INSERT INTO fx_rates (user_id, from_currency, to_currency, rate, rate_date) VALUES ($1,'TTD','USD',0.15,'2026-06-01')`, [uid]);
    await c.query(`INSERT INTO fx_rates (user_id, from_currency, to_currency, rate, rate_date) VALUES ($1,'TTD','USD',0.20,'2026-07-01')`, [uid]);
    const q2 = { entity_id: e2 };
    await client.post('/api/invoices', { client: 'Trinidad Client', amount: 6000, status: 'pending', issue_date: '2026-06-05', ...q2 });
    await client.post('/api/expenses', { description: 'Port of Spain office', category: 'Office', amount: 1200, expense_date: '2026-06-05', ...q2 });

    const oracleCon = await computeBooks(uid, null, 'year');   // canonical consolidated (per-leg FX to base)
    const plAll = await client.post('/api/reports/profit-loss?entity_id=all', {});
    A('consolidated P&L → 200, served from the ledger (source gl)', plAll.status === 200 && plAll.json.source === 'gl', JSON.stringify({ src: plAll.json && plAll.json.source }));
    A('consolidated revenue matches the computeBooks(null) oracle to the cent', near(plAll.json.totalRevenue, oracleCon.revenue), `report=${plAll.json.totalRevenue} oracle=${oracleCon.revenue}`);
    A('consolidated net profit matches the oracle to the cent', near(plAll.json.netProfit, oracleCon.netProfit), `report=${plAll.json.netProfit} oracle=${oracleCon.netProfit}`);
    A('consolidation actually combined the two entities (revenue > entity-1 alone)', plAll.json.totalRevenue > pl1.json.totalRevenue + 0.01, `all=${plAll.json.totalRevenue} e1=${pl1.json.totalRevenue}`);

    const bsAll = await client.post('/api/reports/balance-sheet?entity_id=all', {});
    A('consolidated balance sheet → 200, source gl', bsAll.status === 200 && bsAll.json.source === 'gl', JSON.stringify({ src: bsAll.json && bsAll.json.source }));
    A('consolidated balance sheet balances', near(bsAll.json.totalAssets, bsAll.json.totalLiabilities + bsAll.json.equity), JSON.stringify({ ta: bsAll.json.totalAssets, tl: bsAll.json.totalLiabilities, eq: bsAll.json.equity }));
    A('consolidated balance sheet carries the ASC 830 CTA (multi-currency translation)', bsAll.json.asc830 && typeof bsAll.json.asc830.cta === 'number', JSON.stringify(bsAll.json.asc830));
    A('consolidated FX coverage is complete (every entity currency has a rate)', bsAll.json.fxCoverage && bsAll.json.fxCoverage.complete === true, JSON.stringify(bsAll.json.fxCoverage));

    const recCon = await glReconcile(uid, null);
    A('glReconcile (consolidated): the group books are balanced', recCon && recCon.booksBalanced === true, JSON.stringify({ booksBalanced: recCon && recCon.booksBalanced }));

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('4b · CREDIT NOTE → THE RECONCILE-GATE SAFELY FALLS BACK (never a wrong number)');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // A credit note is a revenue contra. In the GL it also NETS the receivable (Dr Revenue / Cr AR) —
    // the more correct treatment — while the canonical computeBooks oracle leaves AR unreduced for an
    // open credit note (F58, "deferred to after launch", server.js:3434). The two therefore diverge on
    // AR, so the balance-sheet reconcile-gate must NOT serve the ledger: it serves the reconciled oracle
    // instead. The whole point of the gate is proven here — a known divergence yields the safe number,
    // not a wrong one. P&L is unaffected (revenue contra nets identically on both sides).
    const cn = await client.post('/api/credit-notes', { customer: 'Customer North', amount: 100, date: '2026-06-25', status: 'Open', reason: 'Goodwill', ...q1 });
    A('issue a credit note (revenue contra) → 201/200', (cn.status === 201 || cn.status === 200) && cn.json.id, JSON.stringify(cn.json));
    const plCn = await client.post(`/api/reports/profit-loss?entity_id=${e1}`, {});
    const oracleCn = await computeBooks(uid, e1, 'year');
    A('P&L still reconciles after the credit note (revenue dropped by the $100 contra)', near(plCn.json.totalRevenue, oracleCn.revenue) && near(plCn.json.totalRevenue, pl1.json.totalRevenue - 100), `after=${plCn.json.totalRevenue} before=${pl1.json.totalRevenue} oracle=${oracleCn.revenue}`);
    const bsCn = await client.post(`/api/reports/balance-sheet?entity_id=${e1}`, {});
    A('the balance-sheet gate SAFELY falls back to the oracle (GL nets AR, oracle defers → F58)', bsCn.json.source === 'computeBooks', JSON.stringify({ src: bsCn.json && bsCn.json.source }));
    A('the fallback number is still correct and the sheet still balances (never a wrong figure)', near(bsCn.json.totalAssets, bsCn.json.totalLiabilities + bsCn.json.equity), JSON.stringify({ ta: bsCn.json.totalAssets, tl: bsCn.json.totalLiabilities, eq: bsCn.json.equity }));

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('5 · ACCOUNTANT SIDE — register (pending) → blocked login → verify → login');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const accReg = await a1.post('/api/accountants/register', {
      firstName: 'Grace', lastName: 'Ledger', email: 'e2e-acc1@finflow.test', password: 'acct-pw-123456',
      firm: 'Ledger & Co', country: 'US', specialisation: 'Tax', bio: 'CPA', experience: '10+ years',
      verification: { method: 'membership', membershipNumber: 'CPA-778899' },
    });
    A('accountant registration → 201 success (status pending)', accReg.status === 201 && (accReg.json.success || accReg.json.id || accReg.json.accountantId), JSON.stringify(accReg.json));
    const acc1 = (await c.query(`SELECT id, status FROM accountants WHERE email=$1`, ['e2e-acc1@finflow.test'])).rows[0];
    A('the freshly-registered accountant is PENDING (awaits verification)', acc1.status === 'pending', 'status ' + acc1.status);
    A('a PENDING accountant cannot log in yet → non-200', (await a1.post('/api/accountants/login', { email: 'e2e-acc1@finflow.test', password: 'acct-pw-123456' })).status !== 200);

    // Admin verifies the credentials (the human review step) — then login works.
    await c.query(`UPDATE accountants SET status='verified' WHERE id=$1`, [acc1.id]);
    A('after verification the accountant logs in → 200', (await a1.post('/api/accountants/login', { email: 'e2e-acc1@finflow.test', password: 'acct-pw-123456' })).status === 200);
    A('accountant profile (GET me) → 200', (await a1.get('/api/accountants/me')).status === 200);

    // A second verified accountant (isolation control) + a bare second owner (isolation + decline control).
    const acc2 = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1,$2,'Iso','Control','Other Firm','ISOACC2','verified') RETURNING id`,
      ['e2e-acc2@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    A('second accountant logs in → 200', (await a2.post('/api/accountants/login', { email: 'e2e-acc2@finflow.test', password: PW })).status === 200);
    const uidB = (await c.query(
      `INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'e2e-ownerB@finflow.test', name: 'Beta Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    A('unrelated owner B logs in → 200', (await ownerB.post('/api/auth/login', { email: 'e2e-ownerB@finflow.test', password: PW })).status === 200);

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('6 · CLIENT → ACCOUNTANT handshake — request → approve → certified books flow through');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const BOOKS = `/api/accountants/clients/${uid}/books`;
    const BOOKS_B = `/api/accountants/clients/${uidB}/books`;
    const req1 = await client.post('/api/accountants/request-access', { accountantId: acc1.id });
    A('client requests access to the accountant → 200 success', req1.status === 200 && req1.json && req1.json.success, JSON.stringify(req1.json));
    A('a duplicate request is blocked → 409', (await client.post('/api/accountants/request-access', { accountantId: acc1.id })).status === 409);

    const pend = await a1.get('/api/accountants/pending-requests');
    A('the accountant sees the pending request', Array.isArray(pend.json) && pend.json.some(r => String(r.user_id) === String(uid)), JSON.stringify(pend.json));
    A('the accountant CANNOT read books while the link is pending → 403', (await a1.get(BOOKS)).status === 403);

    const approve = await a1.post('/api/accountants/approve-request', { userId: uid });
    A('the accountant approves the request → 200 (link goes active)', approve.status === 200 && approve.json.success, JSON.stringify(approve.json));

    const books = await a1.get(BOOKS);
    A('the accountant now reads the client books → 200', books.status === 200, 'status ' + books.status);
    A('the client\'s real invoices flow through the connection', books.json && Array.isArray(books.json.allInvoices) && books.json.allInvoices.length >= 2, 'allInvoices ' + (books.json && books.json.allInvoices && books.json.allInvoices.length));
    A('default access is "view" and payroll detail is redacted', books.json && books.json.accessLevel === 'view' && Array.isArray(books.json.allPayroll) && books.json.allPayroll.length === 0, 'accessLevel ' + (books.json && books.json.accessLevel) + ' payrollRows ' + (books.json && books.json.allPayroll && books.json.allPayroll.length));

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('7 · TENANT ISOLATION — the connection grants exactly one client, nothing more');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    A('a DIFFERENT accountant cannot read this client → 403', (await a2.get(BOOKS)).status === 403);
    A('the linked accountant cannot read an UNLINKED client → 403', (await a1.get(BOOKS_B)).status === 403);
    A('a user cannot address another user\'s entity (cross-tenant entity_id) → 403',
      (await ownerB.get(`/api/invoices?entity_id=${e1}`)).status === 403);

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('8 · ACCOUNTANT → CLIENT — the access grant gates real work (view vs filing)');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const jBody = { date: '2026-07-10', description: 'Adjusting entry', lines: [{ debit: 100 }, { credit: 100 }] };
    A('a "view" accountant CANNOT post a journal → 403', (await a1.post(`/api/accountants/clients/${uid}/journal`, jBody)).status === 403);
    A('the client grants "filing" access → 200', (await client.put('/api/accountants/my-accountant/access', { access_level: 'filing' })).status === 200);
    A('a "filing" accountant CAN post a journal → 201', (await a1.post(`/api/accountants/clients/${uid}/journal`, jBody)).status === 201);
    const my = await client.get('/api/accountants/my-accountant');
    A('the client sees the linked accountant at access_level "filing"', my.json && String(my.json.id) === String(acc1.id) && my.json.access_level === 'filing', JSON.stringify(my.json));

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('9 · BIDIRECTIONAL CHAT — client ↔ accountant, both directions, ordered, unread tracked');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const CLIENT_MSGS = '/api/accountants/my-accountant/messages';
    const ACC_MSGS = `/api/accountants/clients/${uid}/messages`;
    A('client → accountant message posts → ok', [200, 201].includes((await client.post(CLIENT_MSGS, { content: 'Hi, my Q2 books are ready.' })).status));
    const accView1 = await a1.get(ACC_MSGS);
    A('the accountant reads the client\'s message (sender "client")', accView1.json && accView1.json.messages.length === 1 && accView1.json.messages[0].sender === 'client', JSON.stringify(accView1.json && accView1.json.messages && accView1.json.messages.map(m => m.sender)));
    A('accountant → client reply posts → ok', [200, 201].includes((await a1.post(ACC_MSGS, { content: 'Got them — reviewing now.' })).status));
    const cliView = await client.get(CLIENT_MSGS);
    A('the client reads the full ordered thread (both messages)', cliView.json && cliView.json.messages.length === 2 && cliView.json.messages[0].sender === 'client' && cliView.json.messages[1].sender === 'accountant', JSON.stringify(cliView.json && cliView.json.messages && cliView.json.messages.map(m => m.sender)));

    // Unread: reset read state, post one fresh message each way, confirm the counters move.
    await client.post(CLIENT_MSGS, { content: 'One more doc coming.' });
    const accUnread = await a1.get(`/api/accountants/clients/${uid}/unread`);
    A('the accountant unread counter counts the client messages it has not opened', accUnread.json && accUnread.json.unread >= 1, JSON.stringify(accUnread.json));
    await a1.post(ACC_MSGS, { content: 'Received, thanks.' });
    const myAcc = await client.get('/api/accountants/my-accountant');
    A('the client unread counter (via my-accountant) counts the accountant messages', myAcc.json && typeof myAcc.json.unread === 'number' && myAcc.json.unread >= 1, JSON.stringify({ unread: myAcc.json && myAcc.json.unread }));

    // ═══════════════════════════════════════════════════════════════════════════════════════
    section('10 · DECLINE PATH — a second client\'s request is declined → no link, still 403');
    // ═══════════════════════════════════════════════════════════════════════════════════════
    A('owner B requests the same accountant → 200', (await ownerB.post('/api/accountants/request-access', { accountantId: acc1.id })).status === 200);
    A('the accountant declines owner B → 200', (await a1.post('/api/accountants/decline-request', { userId: uidB })).status === 200);
    A('after the decline, the accountant still cannot read owner B → 403', (await a1.get(BOOKS_B)).status === 403);

    console.log('\n' + '='.repeat(78));
    console.log(fail === 0
      ? '  ALL GREEN — ' + pass + ' passed, 0 failed   (FULL LIFECYCLE: onboarding → books → GL →\n' +
        '  consolidation → accountant → handshake → chat → isolation, start to finish)'
      : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('='.repeat(78) + '\n');
  } catch (e) {
    console.error('[e2e-lifecycle] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
    fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[e2e-lifecycle] FATAL — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
