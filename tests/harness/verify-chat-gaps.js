#!/usr/bin/env node
'use strict';
/**
 * verify-chat-gaps.js — owner request 2026-11-11: close the gaps left by verify-accountant-writes-and-chat.
 *
 * Real server + scratch Postgres, real logins. The ONLY substitute is the e-mail provider: `resend` is replaced by a
 * capturing fake (the verify-accountant-billing pattern) so the e-mails the app would send are recorded, never sent.
 *
 * (A) OFFLINE E-MAIL. Recipient not watching the thread → one e-mail to THEIR address, subject "New message from <sender>",
 *     the message text HTML-escaped. Recipient watching live (SSE open) → no e-mail. A second message inside the 5-minute
 *     cooldown → no second e-mail. Both directions.
 * (B) TWO ACCOUNTANTS on one owner (A and B). With accountantId the owner reads / writes exactly that accountant's thread;
 *     A never sees B's thread. WITHOUT accountantId the owner's request is ambiguous — EXPECTED: refused 400
 *     WHICH_ACCOUNTANT (as PUT /my-accountant/access already does). BUG VALUE: silently delivered to whichever accountant
 *     was invited last.
 * (C) ENDING A LINK CLOSES OPEN CHAT STREAMS. Owner revoke, accountant suspend-client, accountant reject-client: the
 *     accountant's (and owner's) stream that was open before must END within 1.5 s. BUG VALUE: still open.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-chat-gaps.js
 */
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'mock' } }; } }; } },
} };
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let scratch, server; const aborts = [];
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock';
    process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    process.env.APP_URL = 'https://finflow-test.example';
    const database = require('../../database.js');
    await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    console.log('\n' + '='.repeat(78) + '\n  Chat gaps — offline e-mail · two accountants · ending a link closes live streams\n' + '='.repeat(78) + '\n');

    const mkUser = async (email, name) => (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email, name, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const mkAcc = async (email, first) => (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1, $2, $3, 'Ledger', 'Firm', $3, 'verified') RETURNING id`, [email, bcrypt.hashSync(PW, 10), first])).rows[0].id;
    const login = async (email, acc) => { const h = new HarnessHttp(base); const r = await h.post(acc ? '/api/accountants/login' : '/api/auth/login', { email, password: PW }); if (r.status !== 200) throw new Error('login ' + email + ' ' + r.status + ' ' + r.text.slice(0, 120)); return h; };
    const stream = (h, u) => { const ev = []; const ac = new AbortController(); aborts.push(ac); ev.ended = false;
      ev.p = (async () => { try { const r = await fetch(base + u, { headers: { cookie: h._cookieHeader() }, signal: ac.signal }); ev.status = r.status;
        const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; ev.push(Buffer.from(value).toString()); } } catch (_) {} ev.ended = true; })();
      return ev; };

    // ═══ (A) offline e-mail ═══
    const u1 = await mkUser('chat-owner@finflow.test', 'Olive Owner'), accA = await mkAcc('chat-acc-a@finflow.test', 'Ada');
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, invited_at) VALUES ($1,$2,'active','view', NOW() - interval '2 days')`, [accA, u1]);
    const owner = await login('chat-owner@finflow.test'), a = await login('chat-acc-a@finflow.test', true);
    const P = `/api/accountants/clients/${u1}`;
    sent.length = 0;
    await owner.post('/api/accountants/my-accountant/messages?accountantId=' + accA, { content: 'Hi <b>Ada</b> & team' }); await sleep(400);
    const e1 = sent.filter(m => m.to === 'chat-acc-a@finflow.test');
    A('owner → offline accountant: ONE e-mail to the accountant, "New message from Olive Owner", text escaped',
      e1.length === 1 && e1[0].subject === 'New message from Olive Owner' && e1[0].html.includes('Hi &lt;b&gt;Ada&lt;/b&gt; &amp; team') && !e1[0].html.includes('<b>Ada</b>'),
      JSON.stringify(sent.map(m => ({ to: m.to, subject: m.subject, html: (m.html || '').slice(0, 200) }))));
    await owner.post('/api/accountants/my-accountant/messages?accountantId=' + accA, { content: 'second' }); await sleep(400);
    A('a second message inside the 5-minute cooldown sends no second e-mail', sent.filter(m => m.to === 'chat-acc-a@finflow.test').length === 1, String(sent.length));
    const sA0 = stream(owner, '/api/accountants/my-accountant/stream?accountantId=' + accA); await sleep(300);
    sent.length = 0;
    await a.post(P + '/messages', { content: 'reply while you watch' }); await sleep(400);
    A('accountant → owner who is watching live: NO e-mail', sent.length === 0, JSON.stringify(sent.map(m => m.to)));
    aborts.pop().abort(); await sleep(300);
    await a.post(P + '/messages', { content: 'reply while you are away' }); await sleep(400);
    const e2 = sent.filter(m => m.to === 'chat-owner@finflow.test');
    A('accountant → owner who left: ONE e-mail to the owner, "New message from Ada Ledger…"', e2.length === 1 && /^New message from Ada/.test(e2[0].subject) && e2[0].html.includes('reply while you are away'),
      JSON.stringify(sent.map(m => ({ to: m.to, subject: m.subject }))));
    void sA0;

    // ═══ (B) two accountants ═══
    const accB = await mkAcc('chat-acc-b@finflow.test', 'Bea');
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, invited_at) VALUES ($1,$2,'active','view', NOW() - interval '1 day')`, [accB, u1]);
    const bb = await login('chat-acc-b@finflow.test', true);
    const toB = 'for Bea only ' + Date.now();
    const pb = await owner.post('/api/accountants/my-accountant/messages?accountantId=' + accB, { content: toB });
    const aThread = JSON.parse((await a.get(P + '/messages')).text || '{}').messages || [];
    const bThread = JSON.parse((await bb.get(P + '/messages')).text || '{}').messages || [];
    A('owner writes to B with accountantId → B has it, A does not', pb.status === 200 && bThread.some(m => m.content === toB) && !aThread.some(m => m.content === toB), pb.status + ' A:' + aThread.length + ' B:' + bThread.length);
    const oA = JSON.parse((await owner.get('/api/accountants/my-accountant/messages?accountantId=' + accA)).text || '{}').messages || [];
    A('owner reading A\'s thread does not see the message meant for B', !oA.some(m => m.content === toB), JSON.stringify(oA.map(m => m.content)));
    const amb = 'no accountant named ' + Date.now();
    const pAmb = await owner.post('/api/accountants/my-accountant/messages', { content: amb });
    const where = (await c.query(`SELECT accountant_id FROM accountant_messages WHERE message = $1`, [amb])).rows.map(r => r.accountant_id);
    A('two accountants, no accountantId → refused 400 WHICH_ACCOUNTANT, nothing stored (bug: delivered to the last-invited accountant)',
      pAmb.status === 400 && /WHICH_ACCOUNTANT/.test(pAmb.text) && where.length === 0, pAmb.status + ' ' + pAmb.text.slice(0, 120) + ' stored for accountant ' + JSON.stringify(where));
    const gAmb = await owner.get('/api/accountants/my-accountant/messages');
    A('…and reading without accountantId is refused the same way (no thread is guessed)', gAmb.status === 400 && /WHICH_ACCOUNTANT/.test(gAmb.text), gAmb.status + ' ' + gAmb.text.slice(0, 120));
    const att = await owner.post('/api/accountants/my-accountant/attach', { name: 'x.txt', mime: 'text/plain', dataB64: Buffer.from('x').toString('base64') });
    A('…and an attachment without accountantId is refused the same way', att.status === 400 && /WHICH_ACCOUNTANT/.test(att.text), att.status + ' ' + att.text.slice(0, 120));

    // ═══ (C) ending a link closes open streams ═══
    const cases = [
      ['owner revokes', async (uid, accId, accH, ownH) => ownH.post('/api/accountants/my-accountant/revoke', { accountantId: accId })],
      ['accountant suspends', async (uid, accId, accH) => accH.post('/api/accountants/suspend-client', { userId: uid })],
      ['accountant rejects', async (uid, accId, accH) => accH.post('/api/accountants/reject-client', { userId: uid })],
    ];
    let n = 0;
    for (const [label, act] of cases) {
      n++;
      const uid = await mkUser(`chat-end${n}@finflow.test`, 'End ' + n), accId = await mkAcc(`chat-end-acc${n}@finflow.test`, 'End' + n);
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','view')`, [accId, uid]);
      const ownH = await login(`chat-end${n}@finflow.test`), accH = await login(`chat-end-acc${n}@finflow.test`, true);
      const sAcc = stream(accH, `/api/accountants/clients/${uid}/stream`), sOwn = stream(ownH, '/api/accountants/my-accountant/stream');
      await sleep(400);
      const r = await act(uid, accId, accH, ownH);
      await sleep(1500);
      A(`${label}: the action succeeds (2xx)`, r.status >= 200 && r.status < 300, r.status + ' ' + r.text.slice(0, 120));
      A(`${label}: the accountant's open chat stream is CLOSED within 1.5 s (bug: stays open)`, sAcc.status === 200 && sAcc.ended, 'status ' + sAcc.status + ' ended ' + sAcc.ended);
      A(`${label}: the owner's open chat stream is CLOSED within 1.5 s`, sOwn.status === 200 && sOwn.ended, 'status ' + sOwn.status + ' ended ' + sOwn.ended);
      const re = await fetch(base + `/api/accountants/clients/${uid}/stream`, { headers: { cookie: accH._cookieHeader() } }).then(x => { try { x.body.cancel(); } catch (_) {} return x.status; });
      A(`${label}: re-opening the accountant stream is refused (403)`, re === 403, String(re));
    }
  } catch (e) {
    fail++; console.log('  FATAL: ' + e.message + ' ' + (e.code || '') + '\n' + e.stack); if (e.errors) e.errors.forEach(x => console.log('  - ' + x.message));
  } finally {
    for (const ac of aborts) try { ac.abort(); } catch (_) {}
    try { if (server) { server.closeAllConnections && server.closeAllConnections(); await new Promise(r => server.close(r)); } } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log('\n' + '-'.repeat(78)); console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed` : `  ALL GREEN — ${pass} passed, 0 failed  (chat gaps)`); process.exit(fail ? 1 : 0);
})();
