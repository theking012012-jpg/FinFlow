'use strict';
/**
 * verify-accountant-client-handshake.js — the CLIENT↔ACCOUNTANT connection, end-to-end through the
 * REAL request→approve handshake (existing harnesses insert an already-'active' link and skip this).
 * Proves the whole linking lifecycle plus isolation:
 *   client requests  → duplicate blocked (409)
 *   accountant sees the pending request; CANNOT read books yet (pending ≠ active → 403)
 *   accountant approves → link goes active, first referral earning booked
 *   accountant can now READ the client's real books (the seeded invoice + revenue flow through)
 *   ISOLATION: a DIFFERENT accountant cannot read this client; the linked accountant cannot read an
 *              UNLINKED client
 *   client's view/filing grant actually gates the accountant's ability to post a journal
 *   decline path: a second client's request is declined → no link, still 403
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-client-handshake.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const PW = 'harness-password-not-a-secret';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);

    // ── Client A: a real FinFlow user with seeded books; Client B: isolation control ──
    const mkUser = async (email) => (await c.query(
      `INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: email.split('@')[0], plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    // NB: seed() TRUNCATEs all seeded tables, so only ONE client may be seeded — seed A (needs books
    // to read); B is a bare user (isolation/decline control, never reads real books).
    const clientB = await mkUser('hs-clientB@finflow.test');
    const clientA = await mkUser('hs-clientA@finflow.test');
    await seed(c, clientA);                              // gives A an active entity + real books

    // ── Two verified accountants ──
    const mkAcc = async (email, code) => (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1,$2,'Acc',$3,'Firm',$4,'verified') RETURNING id`,
      [email, bcrypt.hashSync(PW, 10), code, code])).rows[0].id;
    const acc1 = await mkAcc('hs-acc1@finflow.test', 'HSACC1');
    const acc2 = await mkAcc('hs-acc2@finflow.test', 'HSACC2');

    // Separate sessions per actor (cookie-per-client).
    const ownerA = new HarnessHttp(server.baseUrl);
    const ownerB = new HarnessHttp(server.baseUrl);
    const a1 = new HarnessHttp(server.baseUrl);
    const a2 = new HarnessHttp(server.baseUrl);
    A('client A login', (await ownerA.post('/api/auth/login', { email: 'hs-clientA@finflow.test', password: PW })).status === 200);
    A('client B login', (await ownerB.post('/api/auth/login', { email: 'hs-clientB@finflow.test', password: PW })).status === 200);
    A('accountant 1 login', (await a1.post('/api/accountants/login', { email: 'hs-acc1@finflow.test', password: PW })).status === 200);
    A('accountant 2 login', (await a2.post('/api/accountants/login', { email: 'hs-acc2@finflow.test', password: PW })).status === 200);

    const BOOKS_A = `/api/accountants/clients/${clientA}/books`;
    const BOOKS_B = `/api/accountants/clients/${clientB}/books`;

    // ── 1. client A requests access to accountant 1 ──
    const req1 = await ownerA.post('/api/accountants/request-access', { accountantId: acc1 });
    A('client requests accountant → 200 success', req1.status === 200 && req1.json && req1.json.success, JSON.stringify(req1.json));
    const dup = await ownerA.post('/api/accountants/request-access', { accountantId: acc1 });
    A('duplicate request blocked → 409', dup.status === 409, 'status ' + dup.status);

    // ── 2. accountant sees the pending request but CANNOT read books yet (pending ≠ active) ──
    const pend = await a1.get('/api/accountants/pending-requests');
    A('accountant sees the pending request', Array.isArray(pend.json) && pend.json.some(r => String(r.user_id) === String(clientA)), JSON.stringify(pend.json));
    A('accountant CANNOT read books while pending → 403', (await a1.get(BOOKS_A)).status === 403);

    // ── 3. accountant approves → link active ──
    const appr = await a1.post('/api/accountants/approve-request', { userId: clientA });
    A('approve-request → 200 success', appr.status === 200 && appr.json && appr.json.success, JSON.stringify(appr.json));
    A('approval froze a referral-months figure', appr.json && typeof appr.json.referralMonths === 'number');
    A('pending list now empty', ((await a1.get('/api/accountants/pending-requests')).json || []).length === 0);

    // ── 4. accountant can now READ the client's real books ──
    const books = await a1.get(BOOKS_A);
    A('accountant reads client books → 200', books.status === 200, 'status ' + books.status);
    A('the client\'s seeded invoices flow through the connection', books.json && Array.isArray(books.json.allInvoices) && books.json.allInvoices.length > 0, 'allInvoices ' + (books.json && books.json.allInvoices && books.json.allInvoices.length));
    A('default access is view (payroll detail redacted)', books.json && books.json.accessLevel === 'view' && Array.isArray(books.json.allPayroll) && books.json.allPayroll.length === 0, 'accessLevel ' + (books.json && books.json.accessLevel));

    // ── 5. ISOLATION ──
    A('a DIFFERENT accountant cannot read this client → 403', (await a2.get(BOOKS_A)).status === 403);
    A('the linked accountant cannot read an UNLINKED client → 403', (await a1.get(BOOKS_B)).status === 403);

    // ── 6. client sees the link + the grant gates real work ──
    const my = await ownerA.get('/api/accountants/my-accountant');
    A('client sees the linked accountant, access_level view', my.json && String(my.json.id) === String(acc1) && my.json.access_level === 'view', JSON.stringify(my.json));
    const jBody = { date: '2026-07-10', description: 'Adjusting entry', lines: [{ debit: 100 }, { credit: 100 }] };
    A('view accountant: post journal → 403', (await a1.post(`/api/accountants/clients/${clientA}/journal`, jBody)).status === 403);
    A('client grants filing → 200', (await ownerA.put('/api/accountants/my-accountant/access', { access_level: 'filing' })).status === 200);
    A('filing accountant: post journal → 201 (connection enables real work)', (await a1.post(`/api/accountants/clients/${clientA}/journal`, jBody)).status === 201);

    // ── 7. decline path ──
    A('client B requests accountant 1 → 200', (await ownerB.post('/api/accountants/request-access', { accountantId: acc1 })).status === 200);
    A('accountant declines B → 200', (await a1.post('/api/accountants/decline-request', { userId: clientB })).status === 200);
    A('after decline, accountant still cannot read B → 403', (await a1.get(BOOKS_B)).status === 403);
    A('after decline, B has no linked accountant', (await ownerB.get('/api/accountants/my-accountant')).json?.id == null);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (client↔accountant handshake)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
