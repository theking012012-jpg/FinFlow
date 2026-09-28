'use strict';
/**
 * verify-support-request.js — in-app support channel for BOTH clients and accountants.
 *
 * POST /api/support stores a request server-side (and emails ADMIN_EMAIL when configured —
 * best-effort), GET /api/support returns the caller's OWN requests. It must:
 *   - work for a signed-in CLIENT (req.session.userId) and store actor='client', user_id set;
 *   - work for a signed-in ACCOUNTANT (req.session.accountantId) and store actor='accountant',
 *     accountant_id set, user_id null;
 *   - work BEFORE Resend/ADMIN_EMAIL are configured (the request is always stored);
 *   - reject an empty message (400) and require auth (401/403);
 *   - keep the two audiences' inboxes ISOLATED — a client's GET never returns an accountant's
 *     request and vice-versa.
 *
 * Discriminating (Rule 14): the accountant POST would 401 under the old client-only guard, and the
 * isolation checks would fail if GET keyed on the wrong column. Clock pinned 2026-07-25.
 *   node -r ./tests/harness/clock.js tests/harness/verify-support-request.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);   // no RESEND_API_KEY in harness env → email path is skipped gracefully

    // ── a CLIENT ─────────────────────────────────────────────────────────────
    const email = 'support-user@finflow.test';
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.99' });
    A('client login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    // Submit a support request — must succeed even though Resend isn't configured.
    const sub = await http.post('/api/support', { subject: 'Cannot export P&L', message: 'The P&L PDF export button does nothing on Safari.' });
    A('client POST /api/support → 201 (works with no Resend configured)', sub.status === 201, 'status=' + sub.status + ' body=' + (sub.text || '').slice(0, 120));
    const subId = sub.json && sub.json.id;
    A('response carries the new request id', !!subId, JSON.stringify(sub.json));

    // Stored in the DB with client shape.
    const rowN = (await c.query(`SELECT COUNT(*)::int n FROM support_requests`)).rows[0].n;
    A('request stored in support_requests', rowN === 1, 'rows=' + rowN);
    const stored = (await c.query(`SELECT data FROM support_requests LIMIT 1`)).rows[0].data;
    A('stored client row: message, status open, actor=client, email present',
      stored && stored.message && stored.status === 'open' && stored.actor === 'client' && stored.email === email, JSON.stringify(stored));

    // Retrievable by the client.
    const list = (await http.get('/api/support')).json;
    A('client GET /api/support returns the client’s request', list && Array.isArray(list.requests) && list.requests.length === 1 && list.requests[0].subject === 'Cannot export P&L', JSON.stringify(list));

    // Empty message rejected.
    A('empty message → 400', (await http.post('/api/support', { subject: 'x', message: '   ' })).status === 400);

    // Auth required.
    const anon = new HarnessHttp(server.baseUrl, { xff: '203.0.113.100' });
    const anonRes = await anon.post('/api/support', { message: 'hi' });
    A('unauthenticated → 401/403 (auth required)', anonRes.status === 401 || anonRes.status === 403, 'status=' + anonRes.status);

    // ── an ACCOUNTANT ────────────────────────────────────────────────────────
    const accEmail = 'support-acct@finflow.test';
    await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'verified',NOW(),NOW())`,
      [accEmail, bcrypt.hashSync(PW, 10), 'Ada', 'Ledger', 'Ledger & Co', 'REF-SUP-ACCT']
    );
    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.101' });
    const accLogin = await acct.post('/api/accountants/login', { email: accEmail, password: PW });
    A('accountant login 200 (verified, no MFA)', accLogin.status === 200, 'status=' + accLogin.status + ' body=' + (accLogin.text || '').slice(0, 160));

    const accSub = await acct.post('/api/support', { subject: 'Client books won’t certify', message: 'Certify button greys out after KYC.', category: 'accountant' });
    A('accountant POST /api/support → 201 (accountant session accepted)', accSub.status === 201, 'status=' + accSub.status + ' body=' + (accSub.text || '').slice(0, 160));

    const accStored = (await c.query(`SELECT data FROM support_requests WHERE data->>'actor'='accountant' LIMIT 1`)).rows[0];
    A('stored accountant row: actor=accountant, accountant_id set, user_id null',
      accStored && accStored.data.actor === 'accountant' && accStored.data.accountant_id != null && accStored.data.user_id == null,
      JSON.stringify(accStored && accStored.data));

    // Isolation both ways.
    const accList = (await acct.get('/api/support')).json;
    A('accountant GET returns ONLY the accountant’s request (isolation)',
      accList && Array.isArray(accList.requests) && accList.requests.length === 1 && accList.requests[0].subject === 'Client books won’t certify',
      JSON.stringify(accList));
    const clientListAfter = (await http.get('/api/support')).json;
    A('client GET still returns ONLY the client’s request (isolation)',
      clientListAfter && clientListAfter.requests.length === 1 && clientListAfter.requests[0].subject === 'Cannot export P&L',
      JSON.stringify(clientListAfter));

    // UI wiring present (both audiences).
    const idx = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    A('[STRUCTURAL] client Help Center has a contact form that posts to /api/support', /renderHelpCenter/.test(idx) && /'\/api\/support'/.test(idx));
    const acctHtml = fs.readFileSync(path.join(process.cwd(), 'public', 'accountant-dashboard.html'), 'utf8');
    A('[STRUCTURAL] accountant dashboard has acctHelp that posts to /api/support', /acctHelp/.test(acctHtml) && /\/api\/support/.test(acctHtml));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (in-app support channel — clients + accountants)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
