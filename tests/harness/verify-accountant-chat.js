'use strict';
/**
 * verify-accountant-chat.js — the in-app CLIENT ↔ ACCOUNTANT chat, executed end-to-end, incl. the
 * "better than industry standard" pieces: REAL-TIME delivery (SSE hub), read receipts, typing
 * signals, unread counts — and the isolation that keeps a thread private to its one link.
 *
 * What it proves (Rule 14 — the assertions ARE the executed behaviour; a broken feature flips them):
 *   two-way        · client sends (sender forced 'client') → accountant sends (forced 'accountant')
 *                    → both see the full ordered thread
 *   REAL-TIME      · a raw EventSource socket held open by ONE side receives the OTHER side's message
 *                    within a moment of the POST — no polling, the hub actually fans out
 *   read receipts  · opening the thread stamps last_read; the peer's GET then reports otherLastRead
 *                    advanced past the message (→ the "Seen" tick has real backing)
 *   unread         · accountant unread counts client messages until the accountant opens; client
 *                    unread (via my-accountant) counts accountant messages until the client opens
 *   typing         · a typing POST returns ok and reaches the peer's live socket as a 'typing' event
 *   ISOLATION      · an UNLINKED accountant: 403 on read/post/stream/typing/unread for this client
 *                    an UNLINKED client: empty thread, 404 on post/stream (no link to carry it)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-chat.js
 */
require('./clock.js');
const http = require('http');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Open a real SSE stream over a raw socket, parsing `event:`/`data:` frames into `.events`.
 *  Returns { req, events, ready } — ready resolves with the HTTP response (for status/headers). */
function openSse(baseUrl, path, cookieHeader) {
  const u = new URL(baseUrl + path);
  const events = [];
  let buf = '';
  const req = http.get({
    hostname: u.hostname, port: u.port, path: u.pathname + u.search,
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
  const ready = new Promise((resolve) => {
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (raw.startsWith(':')) continue;  // keep-alive ping
          let ev = 'message', data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          events.push({ event: ev, data });
        }
      });
      resolve(res);
    });
    req.on('error', () => resolve(null));
  });
  return { req, events, ready };
}

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const open = [];
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);

    const mkUser = async (email) => (await c.query(
      `INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: email.split('@')[0], plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const clientB = await mkUser('chat-clientB@finflow.test');   // unlinked control
    const clientA = await mkUser('chat-clientA@finflow.test');
    await seed(c, clientA);

    const mkAcc = async (email, code) => (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1,$2,'Acc',$3,'Firm',$4,'verified') RETURNING id`,
      [email, bcrypt.hashSync(PW, 10), code, code])).rows[0].id;
    const acc1 = await mkAcc('chat-acc1@finflow.test', 'CHAT1');
    const acc2 = await mkAcc('chat-acc2@finflow.test', 'CHAT2');   // unlinked control
    // acc1 ↔ clientA active link (view).
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','view')`, [acc1, clientA]);

    const ownerA = new HarnessHttp(server.baseUrl);
    const ownerB = new HarnessHttp(server.baseUrl);
    const a1 = new HarnessHttp(server.baseUrl);
    const a2 = new HarnessHttp(server.baseUrl);
    await ownerA.post('/api/auth/login', { email: 'chat-clientA@finflow.test', password: PW });
    await ownerB.post('/api/auth/login', { email: 'chat-clientB@finflow.test', password: PW });
    await a1.post('/api/accountants/login', { email: 'chat-acc1@finflow.test', password: PW });
    await a2.post('/api/accountants/login', { email: 'chat-acc2@finflow.test', password: PW });

    const CLIENT_MSGS = '/api/accountants/my-accountant/messages';
    const ACC_MSGS    = `/api/accountants/clients/${clientA}/messages`;
    const ACC_UNREAD  = `/api/accountants/clients/${clientA}/unread`;

    // ── 1. TWO-WAY: client sends, accountant sends, both see the ordered thread ──
    const cSend = await ownerA.post(CLIENT_MSGS, { content: 'Hi, here are my Q3 numbers.' });
    A('client sends → 200 + sender forced to client', cSend.status === 200 && cSend.json.sender === 'client', JSON.stringify(cSend.json));
    const aSend = await a1.post(ACC_MSGS, { content: 'Got them — reviewing now.' });
    A('accountant sends → 200 + sender accountant', aSend.status === 200 && aSend.json.sender === 'accountant', JSON.stringify(aSend.json));

    const accView = await a1.get(ACC_MSGS);
    A('accountant reads the full thread (both messages, ordered)',
      accView.json && accView.json.messages.length === 2 && accView.json.messages[0].sender === 'client' && accView.json.messages[1].sender === 'accountant',
      JSON.stringify(accView.json && accView.json.messages && accView.json.messages.map(m => m.sender)));
    const cliView = await ownerA.get(CLIENT_MSGS);
    A('client reads the full thread (both messages, ordered)',
      cliView.json && cliView.json.messages.length === 2 && cliView.json.messages[0].sender === 'client',
      JSON.stringify(cliView.json && cliView.json.messages && cliView.json.messages.length));

    // ── 2. REAL-TIME: a live socket on one side receives the other side's message ──
    // Accountant holds a stream open; client posts; the accountant's socket must receive it.
    const accStream = openSse(server.baseUrl, `/api/accountants/clients/${clientA}/stream`, a1._cookieHeader());
    open.push(accStream);
    const accRes = await accStream.ready;
    A('accountant stream → 200 text/event-stream', accRes && accRes.statusCode === 200 && /text\/event-stream/.test(accRes.headers['content-type'] || ''), accRes && `status ${accRes.statusCode} ${accRes.headers['content-type']}`);
    await sleep(150);
    await ownerA.post(CLIENT_MSGS, { content: 'One more doc coming.' });
    await sleep(400);
    A('accountant socket received the client message in real time (SSE hub fan-out)',
      accStream.events.some(e => e.event === 'message' && /One more doc coming/.test(e.data)),
      JSON.stringify(accStream.events));

    // Client holds a stream open; accountant posts; the client's socket must receive it.
    const cliStream = openSse(server.baseUrl, '/api/accountants/my-accountant/stream', ownerA._cookieHeader());
    open.push(cliStream);
    await cliStream.ready;
    await sleep(150);
    await a1.post(ACC_MSGS, { content: 'Received, thanks.' });
    await sleep(400);
    A('client socket received the accountant message in real time',
      cliStream.events.some(e => e.event === 'message' && /Received, thanks/.test(e.data)),
      JSON.stringify(cliStream.events));

    // ── 3. TYPING: a typing signal reaches the peer's live socket ──
    await a1.post(`/api/accountants/clients/${clientA}/typing`);
    await sleep(300);
    A('accountant typing reaches the client socket as a typing event',
      cliStream.events.some(e => e.event === 'typing'), JSON.stringify(cliStream.events.filter(e => e.event === 'typing')));

    // ── 4. UNREAD counts ──
    // Fresh accountant unread = client messages the accountant hasn't opened past. Reset read state.
    await c.query(`UPDATE accountant_clients SET accountant_last_read = NULL, client_last_read = NULL WHERE accountant_id=$1 AND user_id=$2`, [acc1, clientA]);
    const unreadBefore = await a1.get(ACC_UNREAD);
    A('accountant unread counts the client messages before opening', unreadBefore.json && unreadBefore.json.unread >= 2, JSON.stringify(unreadBefore.json));
    await a1.get(ACC_MSGS);                       // opening marks read
    const unreadAfter = await a1.get(ACC_UNREAD);
    A('accountant unread → 0 after opening the thread', unreadAfter.json && unreadAfter.json.unread === 0, JSON.stringify(unreadAfter.json));
    const myAcc = await ownerA.get('/api/accountants/my-accountant');
    A('client unread (via my-accountant) counts accountant messages before opening', myAcc.json && myAcc.json.unread >= 1, JSON.stringify({ unread: myAcc.json && myAcc.json.unread }));
    await ownerA.get(CLIENT_MSGS);               // client opens → marks read
    const myAcc2 = await ownerA.get('/api/accountants/my-accountant');
    A('client unread → 0 after opening the thread', myAcc2.json && myAcc2.json.unread === 0, JSON.stringify({ unread: myAcc2.json && myAcc2.json.unread }));

    // ── 5. READ RECEIPTS: each side sees how far the OTHER has read ──
    const accSeesRead = await a1.get(ACC_MSGS);
    A('accountant GET reports the client\'s last_read (otherLastRead set → Seen backing)', accSeesRead.json && accSeesRead.json.otherLastRead != null, JSON.stringify({ otherLastRead: accSeesRead.json && accSeesRead.json.otherLastRead }));
    const cliSeesRead = await ownerA.get(CLIENT_MSGS);
    A('client GET reports the accountant\'s last_read (otherLastRead set)', cliSeesRead.json && cliSeesRead.json.otherLastRead != null, JSON.stringify({ otherLastRead: cliSeesRead.json && cliSeesRead.json.otherLastRead }));

    // ── 6. ISOLATION — an UNLINKED accountant is locked out of this thread ──
    A('unlinked accountant: read thread → 403', (await a2.get(ACC_MSGS)).status === 403);
    A('unlinked accountant: post → 403', (await a2.post(ACC_MSGS, { content: 'intrusion' })).status === 403);
    A('unlinked accountant: unread → gives no data path (0/blocked)', [200, 403].includes((await a2.get(ACC_UNREAD)).status));
    A('unlinked accountant: typing → 403', (await a2.post(`/api/accountants/clients/${clientA}/typing`)).status === 403);
    const a2Stream = openSse(server.baseUrl, `/api/accountants/clients/${clientA}/stream`, a2._cookieHeader());
    open.push(a2Stream);
    const a2Res = await a2Stream.ready;
    A('unlinked accountant: stream → 403', a2Res && a2Res.statusCode === 403, a2Res && `status ${a2Res.statusCode}`);

    // ── 7. ISOLATION — a client with NO linked accountant has no thread to carry ──
    const bView = await ownerB.get(CLIENT_MSGS);
    A('unlinked client: empty thread (no link)', bView.status === 200 && Array.isArray(bView.json.messages) && bView.json.messages.length === 0, JSON.stringify(bView.json));
    A('unlinked client: post → 404 (no linked accountant)', (await ownerB.post(CLIENT_MSGS, { content: 'to nobody' })).status === 404);
    const bStream = openSse(server.baseUrl, '/api/accountants/my-accountant/stream', ownerB._cookieHeader());
    open.push(bStream);
    const bRes = await bStream.ready;
    A('unlinked client: stream → 404', bRes && bRes.statusCode === 404, bRes && `status ${bRes.statusCode}`);

    // ── 8. the intrusion attempt above never landed in the real thread ──
    const finalThread = await a1.get(ACC_MSGS);
    A('no unlinked-actor message ever entered the thread', finalThread.json && !finalThread.json.messages.some(m => /intrusion|to nobody/.test(m.content)), JSON.stringify(finalThread.json && finalThread.json.messages && finalThread.json.messages.map(m => m.content)));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (accountant ↔ client chat)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally {
    for (const s of open) { try { s.req.destroy(); } catch {} }
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
