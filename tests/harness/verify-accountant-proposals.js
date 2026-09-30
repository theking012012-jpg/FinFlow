'use strict';
/**
 * verify-accountant-proposals.js — marketplace engagement proposals lifecycle.
 *
 * An accountant sends an actively-linked client a proposal (scope + fee); the client accepts or
 * declines. Accepting stamps the engagement of record. Covers the full lifecycle plus the gates:
 * only the accountant creates, only for a linked client; only the owning client responds, and only
 * while pending. Discriminating (Rule 14): accept flips status→accepted AND stamps accepted_at; a
 * non-owner's respond is 404; a second response is 409; an unlinked client sees no proposals.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-proposals.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
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
    server = await bootServer(scratch.url);

    const clientId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'prop-client@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const otherId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'prop-other@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                    VALUES ($1,$2,'Ada','Ledger','Ledger & Co','REF-PROP','verified',NOW(),NOW()) RETURNING id`,
      ['prop-acct@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, clientId]);

    const client = new HarnessHttp(server.baseUrl, { xff: '203.0.113.40' });
    A('client login', (await client.post('/api/auth/login', { email: 'prop-client@finflow.test', password: PW })).status === 200);
    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.41' });
    A('accountant login', (await acct.post('/api/accountants/login', { email: 'prop-acct@finflow.test', password: PW })).status === 200);
    const other = new HarnessHttp(server.baseUrl, { xff: '203.0.113.42' });
    A('unrelated client login', (await other.post('/api/auth/login', { email: 'prop-other@finflow.test', password: PW })).status === 200);

    // ── gates on creation ────────────────────────────────────────────────────────
    A('[GATE] a client cannot create a proposal (needs accountant session) → 401', (await client.post('/api/accountants/clients/' + clientId + '/proposals', { title: 'x' })).status === 401);
    A('[GATE] accountant cannot propose to a NON-linked client → 403', (await acct.post('/api/accountants/clients/' + otherId + '/proposals', { title: 'x' })).status === 403);
    A('empty title → 400', (await acct.post('/api/accountants/clients/' + clientId + '/proposals', { title: '   ' })).status === 400);

    // ── accountant creates a proposal ──────────────────────────────────────────────
    const p1 = await acct.post('/api/accountants/clients/' + clientId + '/proposals', { title: 'Monthly bookkeeping', scope: 'Full monthly close + VAT return.', fee: 300, currency: 'gbp', billing: 'monthly' });
    A('accountant creates proposal → 200', p1.status === 200, 'status=' + p1.status + ' body=' + (p1.text || '').slice(0, 160));
    A('proposal stored: status pending, fee in cents, currency upcased, billing kept', p1.json && p1.json.status === 'pending' && p1.json.fee_cents === 30000 && p1.json.currency === 'GBP' && p1.json.billing === 'monthly', JSON.stringify(p1.json));
    const pid = p1.json && p1.json.id;

    A('accountant lists the client’s proposals', (await acct.get('/api/accountants/clients/' + clientId + '/proposals')).json.proposals.some(p => p.id === pid));

    // ── client sees it; unlinked client does not ───────────────────────────────────
    const cliList = (await client.get('/api/accountants/my-accountant/proposals')).json;
    A('client sees the pending proposal', cliList.proposals.some(p => p.id === pid && p.status === 'pending'), JSON.stringify(cliList.proposals));
    const otherList = (await other.get('/api/accountants/my-accountant/proposals')).json;
    A('[GATE] unlinked client sees NO proposals (tenant-scoped)', Array.isArray(otherList.proposals) && otherList.proposals.length === 0, JSON.stringify(otherList));
    A('[GATE] a non-owner cannot respond to it → 404', (await other.post('/api/accountants/my-accountant/proposals/' + pid + '/respond', { action: 'accept' })).status === 404);

    // ── client accepts → engagement of record ──────────────────────────────────────
    const acc1 = await client.post('/api/accountants/my-accountant/proposals/' + pid + '/respond', { action: 'accept' });
    A('client accepts → 200', acc1.status === 200, 'status=' + acc1.status);
    A('accept flips status=accepted AND stamps accepted_at', acc1.json && acc1.json.status === 'accepted' && !!acc1.json.accepted_at, JSON.stringify(acc1.json));
    A('accountant now sees it accepted', (await acct.get('/api/accountants/clients/' + clientId + '/proposals')).json.proposals.find(p => p.id === pid).status === 'accepted');
    A('re-responding to a settled proposal → 409', (await client.post('/api/accountants/my-accountant/proposals/' + pid + '/respond', { action: 'decline' })).status === 409);
    A('bad action → 400', (await client.post('/api/accountants/my-accountant/proposals/' + pid + '/respond', { action: 'maybe' })).status === 400);

    // ── decline path ───────────────────────────────────────────────────────────────
    const p2 = await acct.post('/api/accountants/clients/' + clientId + '/proposals', { title: 'One-off cleanup', fee: 150 });
    const dec = await client.post('/api/accountants/my-accountant/proposals/' + p2.json.id + '/respond', { action: 'decline' });
    A('client declines → status declined + declined_at', dec.json && dec.json.status === 'declined' && !!dec.json.declined_at, JSON.stringify(dec.json));

    // ── withdraw path ────────────────────────────────────────────────────────────────
    const p3 = await acct.post('/api/accountants/clients/' + clientId + '/proposals', { title: 'Draft — ignore', fee: 1 });
    A('accountant withdraws a pending proposal → 200', (await acct.post('/api/accountants/proposals/' + p3.json.id + '/withdraw', {})).status === 200);
    A('client cannot respond to a withdrawn proposal → 409', (await client.post('/api/accountants/my-accountant/proposals/' + p3.json.id + '/respond', { action: 'accept' })).status === 409);
    A('withdrawing an already-settled proposal → 404', (await acct.post('/api/accountants/proposals/' + pid + '/withdraw', {})).status === 404);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (marketplace engagement proposals)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
