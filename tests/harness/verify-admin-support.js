'use strict';
/**
 * verify-admin-support.js — the admin Support Inbox (Pillar D).
 *
 * Tickets arrive from BOTH a client (session.userId) and an accountant (session.accountantId) via
 * POST /api/support. The admin endpoints must: list them all (newest first) with an accurate open
 * count, filter by actor, resolve/reopen a ticket (status stamped server-side), and be admin-gated
 * (a signed-in client must NOT reach them). Discriminating (Rule 14): actor=accountant returns ONLY
 * the accountant ticket; resolving flips status so a status=open refetch drops it.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-admin-support.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const ADMIN_PW = 'harness-admin-password';
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    process.env.ADMIN_PASSWORD = ADMIN_PW;   // read at request time by /api/admin/login

    // A client and a verified accountant, each files one ticket.
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: 'sup-client@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }]);
    await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                   VALUES ($1,$2,'Ada','Ledger','Ledger & Co','REF-ADM-SUP','verified',NOW(),NOW())`,
      ['sup-acct@finflow.test', bcrypt.hashSync(PW, 10)]);

    const client = new HarnessHttp(server.baseUrl, { xff: '203.0.113.20' });
    await client.post('/api/auth/login', { email: 'sup-client@finflow.test', password: PW });
    A('client files a ticket (201)', (await client.post('/api/support', { subject: 'Client Q', message: 'How do I export?', category: 'help-center' })).status === 201);

    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.21' });
    await acct.post('/api/accountants/login', { email: 'sup-acct@finflow.test', password: PW });
    A('accountant files a ticket (201)', (await acct.post('/api/support', { subject: 'Acct Q', message: 'Certify greyed out', category: 'accountant' })).status === 201);

    // A signed-in client must NOT reach the admin inbox.
    A('[GATE] client CANNOT read admin support (401)', (await client.get('/api/admin/support')).status === 401);

    // Admin logs in.
    const admin = new HarnessHttp(server.baseUrl, { xff: '203.0.113.22' });
    const al = await admin.post('/api/admin/login', { password: ADMIN_PW });
    A('admin login 200', al.status === 200, 'status=' + al.status + ' body=' + (al.text || '').slice(0, 120));

    const all = (await admin.get('/api/admin/support')).json;
    A('admin sees BOTH tickets', all && Array.isArray(all.requests) && all.requests.length === 2, JSON.stringify(all && all.requests && all.requests.map(r => r.actor)));
    A('openCount == 2', all && all.openCount === 2, 'openCount=' + (all && all.openCount));
    A('each ticket carries actor/subject/status', all.requests.every(r => r.actor && r.subject && r.status), JSON.stringify(all.requests));

    // Filter by actor — discriminating.
    const acctOnly = (await admin.get('/api/admin/support?actor=accountant')).json;
    A('filter actor=accountant → only the accountant ticket', acctOnly.requests.length === 1 && acctOnly.requests[0].actor === 'accountant', JSON.stringify(acctOnly.requests));
    const clientOnly = (await admin.get('/api/admin/support?actor=client')).json;
    A('filter actor=client → only the client ticket', clientOnly.requests.length === 1 && clientOnly.requests[0].actor === 'client', JSON.stringify(clientOnly.requests));

    // Resolve one ticket (with a reply note; no Resend configured so no email is sent — must still succeed).
    const target = all.requests.find(r => r.actor === 'client');
    const rr = await admin.post('/api/admin/support/' + target.id, { status: 'resolved', response: 'Use Settings > Your data > Download my data.' });
    A('resolve → 200', rr.status === 200, 'status=' + rr.status + ' body=' + (rr.text || '').slice(0, 120));
    A('resolve stamps status + reply', rr.json && rr.json.status === 'resolved' && /Download my data/.test(rr.json.response || ''), JSON.stringify(rr.json));

    const openNow = (await admin.get('/api/admin/support?status=open')).json;
    A('status=open now excludes the resolved ticket', openNow.requests.length === 1 && openNow.requests[0].actor === 'accountant', JSON.stringify(openNow.requests));
    A('openCount dropped to 1', openNow.openCount === 1, 'openCount=' + openNow.openCount);

    // The reply is visible to the client who filed it (their own inbox).
    const clientInbox = (await client.get('/api/support')).json;
    A('client sees the admin reply + resolved status on their ticket', clientInbox.requests[0].status === 'resolved' && /Download my data/.test(clientInbox.requests[0] && clientInbox.requests[0].response || ''), JSON.stringify(clientInbox.requests));

    // Reopen works.
    const ro = await admin.post('/api/admin/support/' + target.id, { status: 'open' });
    A('reopen → status open', ro.json && ro.json.status === 'open', JSON.stringify(ro.json));

    // Bad id / bad status guarded.
    A('unknown ticket id → 404', (await admin.post('/api/admin/support/999999', { status: 'resolved' })).status === 404);
    A('invalid status → 400', (await admin.post('/api/admin/support/' + target.id, { status: 'banana' })).status === 400);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (admin support inbox)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
