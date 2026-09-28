'use strict';
/**
 * verify-chat-attachments.js — client↔accountant chat file attachments.
 *
 * A message can carry one file (≤5MB), stored inline. Either party of the conversation can download
 * it; nobody else can. Covers: client→accountant attach, accountant→client attach, both list the
 * attachment metadata (never the raw base64), authorized download returns the exact bytes, an
 * unrelated user is refused (404, no existence leak), and the 5MB cap is enforced (413).
 * Discriminating (Rule 14): a stranger's download is 404 not 200; the messages list JSON never
 * contains att_data; the download body equals the uploaded bytes.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-chat-attachments.js
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
      [{ email: 'att-client@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const otherId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'att-other@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                    VALUES ($1,$2,'Ada','Ledger','Ledger & Co','REF-ATT','verified',NOW(),NOW()) RETURNING id`,
      ['att-acct@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, clientId]);

    const client = new HarnessHttp(server.baseUrl, { xff: '203.0.113.30' });
    A('client login', (await client.post('/api/auth/login', { email: 'att-client@finflow.test', password: PW })).status === 200);
    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.31' });
    A('accountant login', (await acct.post('/api/accountants/login', { email: 'att-acct@finflow.test', password: PW })).status === 200);
    const other = new HarnessHttp(server.baseUrl, { xff: '203.0.113.32' });
    A('unrelated client login', (await other.post('/api/auth/login', { email: 'att-other@finflow.test', password: PW })).status === 200);

    // ── client → accountant attachment ──────────────────────────────────────────
    const payload = 'hello attachment — receipt contents';
    const b64 = Buffer.from(payload, 'utf8').toString('base64');
    const up1 = await client.post('/api/accountants/my-accountant/attach', { name: 'receipt.txt', mime: 'text/plain', dataB64: b64 });
    A('client attach → 200', up1.status === 200, 'status=' + up1.status + ' body=' + (up1.text || '').slice(0, 160));
    A('attach response has att metadata, NOT the data', up1.json && up1.json.att_name === 'receipt.txt' && up1.json.att_size > 0 && !('att_data' in up1.json), JSON.stringify(up1.json));
    const msgId1 = up1.json && up1.json.id;

    // accountant sees it in the thread with metadata only
    const accThread = (await acct.get('/api/accountants/clients/' + clientId + '/messages')).json;
    const accMsg = (accThread.messages || []).find(m => m.id === msgId1);
    A('accountant sees the attachment message (metadata)', !!accMsg && accMsg.att_name === 'receipt.txt', JSON.stringify(accMsg));
    A('messages list JSON never leaks att_data', JSON.stringify(accThread).indexOf('att_data') === -1);

    // accountant downloads it — exact bytes
    const dl1 = await acct.get('/api/accountants/chat-attachment/' + msgId1);
    A('accountant downloads the file → 200', dl1.status === 200, 'status=' + dl1.status);
    A('downloaded bytes match what was uploaded', dl1.text === payload, 'got=' + JSON.stringify((dl1.text || '').slice(0, 60)));
    A('download sets a filename (Content-Disposition)', /receipt\.txt/.test(dl1.headers.get('content-disposition') || ''), dl1.headers.get('content-disposition'));

    // ── accountant → client attachment ──────────────────────────────────────────
    const b64b = Buffer.from('signed engagement letter', 'utf8').toString('base64');
    const up2 = await acct.post('/api/accountants/clients/attach', { userId: clientId, name: 'letter.pdf', mime: 'application/pdf', dataB64: b64b });
    A('accountant attach → 200', up2.status === 200, 'status=' + up2.status + ' body=' + (up2.text || '').slice(0, 160));
    const msgId2 = up2.json && up2.json.id;
    const cliThread = (await client.get('/api/accountants/my-accountant/messages')).json;
    A('client sees the accountant’s attachment', (cliThread.messages || []).some(m => m.id === msgId2 && m.att_name === 'letter.pdf'), JSON.stringify(cliThread.messages && cliThread.messages.map(m => m.att_name)));
    A('client downloads it → 200', (await client.get('/api/accountants/chat-attachment/' + msgId2)).status === 200);

    // ── isolation: an unrelated user cannot download either file ─────────────────
    A('[GATE] stranger download of client’s file → 404 (no leak)', (await other.get('/api/accountants/chat-attachment/' + msgId1)).status === 404);
    A('[GATE] stranger download of accountant’s file → 404', (await other.get('/api/accountants/chat-attachment/' + msgId2)).status === 404);
    A('[GATE] anonymous download → 401', (await new HarnessHttp(server.baseUrl, { xff: '203.0.113.33' }).get('/api/accountants/chat-attachment/' + msgId1)).status === 401);

    // ── size cap ────────────────────────────────────────────────────────────────
    const bigB64 = Buffer.alloc(6 * 1024 * 1024, 0x41).toString('base64');   // ~6MB decoded
    A('oversized attachment → 413', (await client.post('/api/accountants/my-accountant/attach', { name: 'big.bin', mime: 'application/octet-stream', dataB64: bigB64 })).status === 413);

    // ── text messages still work (regression) ───────────────────────────────────
    A('plain text message still posts', (await client.post('/api/accountants/my-accountant/messages', { content: 'just text' })).status === 200);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (chat file attachments)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
