#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-writes-and-chat.js — owner question 2026-11-11, follow-up to verify-accountant-personal-wall:
 *   (1) can any accountant WRITE route touch or reveal the owner's personal finances (Personal = none)?
 *   (2) does the owner ↔ accountant chat work, and is it walled to the two people in it?
 *
 * Real server + scratch Postgres, real logins (owner, accountant A linked to the owner, accountant B linked to a second
 * owner, the second owner), access set through the owner's own route. No stubs.
 *
 * (1) WRITES. Personal = none; business "Wall Biz" = view, "Hidden Biz" = none. Every write route an accountant has on a
 *     client is called (journal, lock, notes, flag, message, messages, typing, attach, checklist, notify, proposals, tasks,
 *     ai-insights) — with the personal MARKERS in the bodies where a body takes text. Measured on the database:
 *       · a fingerprint (count + md5 of every row) of the personal tables (personal_transactions / personal_accounts /
 *         holdings / goals / snapshots with entity_id NULL) is IDENTICAL before and after;
 *       · journal + lock are REFUSED (403) on view and on none; with Wall Biz = filing a journal posts — and lands on
 *         Wall Biz (entity_id set), never on personal (entity_id NULL) nor on Hidden Biz;
 *       · no response carries a personal marker.
 * (2) CHAT. Expected values are the exact strings / bytes each side sent:
 *       · owner → accountant and accountant → owner messages both arrive, on both sides, with the right sender;
 *       · live: each side's SSE stream receives the other side's message; typing reaches the other side only;
 *       · unread: accountant's count 1 after the owner writes, 0 after the accountant opens the thread;
 *       · attachments both ways download byte-exact for both parties; > 5 MB refused (413);
 *       · walls: accountant B gets 403 on A's thread (read / post / stream / typing) and 404 on its attachments; the
 *         second owner sees only their own thread and gets 404 on A's attachments; logged out → 401;
 *       · after the owner REVOKES accountant A: A gets 403 on the thread and 404 on the attachments;
 *       · HTML in a message is stored and returned as TEXT (rendering escapes it — by reading: accountant-client-01-data.js
 *         esc(), app-26-acc-group.js _acctEsc(); the renderers are not executed here).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-writes-and-chat.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const MARKERS = ['ZQXPERS-TX', '9137.41', 'ZQXPERS-ACCT', '52345.67', 'ZQXH', 'ZQXPERS-GOAL', '61234.56'];
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null; const streams = [];
  try {
    server = await bootServer(scratch.url);
    const base = server.baseUrl;
    console.log('\n' + '='.repeat(78) + '\n  Accountant writes never reach Personal · owner ↔ accountant chat works and is walled\n' + '='.repeat(78) + '\n');
    const mkUser = async email => { const id = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email, name: 'Owner ' + email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id; await seed(c, id); return id; };
    const mkAcc = async (email, code) => (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1, $2, 'Acc', $3, 'Firm', $3, 'verified') RETURNING id`, [email, bcrypt.hashSync(PW, 10), code])).rows[0].id;
    const uid = await mkUser('wc-owner@finflow.test'), uid2 = await mkUser('wc-owner2@finflow.test');
    const accA = await mkAcc('wc-acc-a@finflow.test', 'WCACCA'), accB = await mkAcc('wc-acc-b@finflow.test', 'WCACCB');
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','view'), ($3,$4,'active','view')`, [accA, uid, accB, uid2]);

    const OK = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 200)); return r; };
    const login = async (email, accountant) => { const h = new HarnessHttp(base); const r = await h.post(accountant ? '/api/accountants/login' : '/api/auth/login', { email, password: PW }); if (r.status !== 200) throw new Error('login ' + email + ' ' + r.status); return h; };
    const owner = await login('wc-owner@finflow.test'), owner2 = await login('wc-owner2@finflow.test');
    const a = await login('wc-acc-a@finflow.test', true), b = await login('wc-acc-b@finflow.test', true);
    const biz = JSON.parse(OK(await owner.post('/api/entities', { name: 'Wall Biz', currency: 'USD', timezone: 'UTC', country: 'US' })).text);
    const hid = JSON.parse(OK(await owner.post('/api/entities', { name: 'Hidden Biz', currency: 'USD', timezone: 'UTC', country: 'US' })).text);
    OK(await owner.post('/api/entities/' + biz.id + '/activate', {}));
    OK(await owner.post('/api/personal-transactions', { description: 'ZQXPERS-TX', amount: 9137.41, currency: 'USD', category: 'Freelance', tx_type: 'income', tx_date: '2026-07-10', idempotency_key: 'wc-p' }));
    for (const [t, d] of [['personal_accounts', { name: 'ZQXPERS-ACCT', kind: 'asset', value: 52345.67, value_usd: 52345.67, currency: 'USD' }],
      ['holdings', { ticker: 'ZQXH', shares: 7, cost_per: 200, price: 311.13 }], ['goals', { name: 'ZQXPERS-GOAL', target: 10000, saved: 2500 }],
      ['snapshots', { kind: 'networth', date: '2026-07-20', value: 61234.56 }]])
      await c.query(`INSERT INTO ${t} (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`, [uid, d]);
    const setAccess = async (bizLvl, personal) => OK(await owner.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [biz.id]: bizLvl, [hid.id]: 'none' }, personal } }));
    const fp = async () => { const out = {}; for (const t of ['personal_transactions', 'personal_accounts', 'holdings', 'goals', 'snapshots'])
      out[t] = (await c.query(`SELECT count(*)::int n, md5(COALESCE(string_agg(id::text || ':' || data::text || ':' || updated_at::text, '|' ORDER BY id), '')) h FROM ${t} WHERE user_id = $1 AND entity_id IS NULL`, [uid])).rows[0];
      return JSON.stringify(out); };
    const marks = t => MARKERS.filter(m => String(t || '').includes(m));

    // ═════════════ (1) WRITES with Personal = none ═════════════
    await setAccess('view', 'none');
    const before = await fp();
    const P = `/api/accountants/clients/${uid}`;
    const JL = { date: '2026-07-15', description: 'ZQXPERS-TX adj', lines: [{ code: '6000', name: 'Office', debit: 10 }, { code: '1000', name: 'Cash', credit: 10 }] };
    const calls = [
      ['journal (view)', 'post', P + '/journal', JL], ['journal → Hidden Biz (none)', 'post', P + '/journal', { ...JL, entity_id: hid.id }],
      ['lock (view)', 'post', P + '/lock', { period: '2026-06', locked: true }], ['lock → Hidden Biz (none)', 'post', P + '/lock', { period: '2026-06', locked: true, entity_id: hid.id }],
      ['notes', 'post', P + '/notes', { note: 'ZQXPERS-GOAL note' }], ['flag', 'post', P + '/flag', { type: 'expense', ref: 'ZQXH', note: 'check' }],
      ['message', 'post', P + '/message', { message: 'hello ZQXPERS-ACCT' }], ['messages', 'post', P + '/messages', { content: 'plural' }],
      ['typing', 'post', P + '/typing', {}], ['attach', 'post', '/api/accountants/clients/attach', { userId: uid, name: 'a.txt', mime: 'text/plain', dataB64: Buffer.from('acct file').toString('base64') }],
      ['checklist', 'post', P + '/checklist', { checklist: { bank: true } }], ['notify', 'post', P + '/notify', { message: 'please upload' }],
      ['proposals', 'post', P + '/proposals', { title: 'Year-end', scope: 'books', fee: 500, currency: 'USD', billing: 'fixed' }],
      ['tasks', 'post', P + '/tasks', { title: 'Send receipts', detail: 'July', due_date: '2026-08-01' }], ['ai-insights', 'post', P + '/ai-insights', {}],
    ];
    const res1 = {}, leak1 = [];
    for (const [n, m, u, body] of calls) { const r = await a[m](u, body); res1[n] = r.status;
      // markers the accountant typed itself are echoed back by notes/message — that is its own text, not personal data
      const own = JSON.stringify(body || {}); const h = marks(r.text).filter(x => !own.includes(x)); if (h.length) leak1.push(n + ' ' + JSON.stringify(h)); }
    console.log('  info  write statuses: ' + JSON.stringify(res1));
    A('journal + lock REFUSED on a view business and on a none business (403)', ['journal (view)', 'journal → Hidden Biz (none)', 'lock (view)', 'lock → Hidden Biz (none)'].every(k => res1[k] === 403), JSON.stringify(res1));
    A('the other write routes answer (2xx, or 503 for ai-insights with no AI key) — they were really exercised', ['notes', 'flag', 'message', 'messages', 'typing', 'attach', 'checklist', 'notify', 'proposals', 'tasks'].every(k => res1[k] >= 200 && res1[k] < 300) && [503, 200].includes(res1['ai-insights']), JSON.stringify(res1));
    A('no write response carries a personal value the accountant did not send itself', leak1.length === 0, leak1.join('; '));
    await setAccess('filing', 'none');
    const jf = await a.post(P + '/journal', { ...JL, description: 'filing adj' });
    const jRow = jf.status === 201 ? (await c.query(`SELECT entity_id FROM journals WHERE id = $1`, [JSON.parse(jf.text).id])).rows[0] : null;
    A('with Wall Biz = filing a journal posts (201) and lands on Wall Biz — never personal (NULL) nor Hidden Biz', jf.status === 201 && jRow && Number(jRow.entity_id) === Number(biz.id), jf.status + ' ' + jf.text.slice(0, 160) + ' entity ' + JSON.stringify(jRow));
    const jh = await a.post(P + '/journal', { ...JL, entity_id: hid.id });
    A('…still refused on Hidden Biz (none) — 403', jh.status === 403, jh.status + ' ' + jh.text.slice(0, 120));
    const after = await fp();
    A('personal tables UNCHANGED by every accountant write (count + md5 of every row)', before === after, 'before ' + before + '\n          after  ' + after);

    // ═════════════ (2) CHAT ═════════════
    // live streams first
    const openStream = (h, u) => { const ev = []; const ac = new AbortController(); streams.push(ac);
      (async () => { try { const r = await fetch(base + u, { headers: { cookie: h._cookieHeader() }, signal: ac.signal }); ev.status = r.status;
        const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; ev.push(Buffer.from(value).toString()); } } catch (_) {} })();
      return ev; };
    const sA = openStream(a, P + '/stream'), sO = openStream(owner, '/api/accountants/my-accountant/stream');
    await sleep(400);
    const oMsg = 'Owner → acct ' + Date.now(), aMsg = 'Acct → owner ' + (Date.now() + 1);
    const po = await owner.post('/api/accountants/my-accountant/messages', { content: oMsg });
    A('owner sends a message (200)', po.status === 200, po.status + ' ' + po.text.slice(0, 120));
    const un1 = JSON.parse((await a.get(P + '/unread')).text || '{}').unread;
    await owner.post('/api/accountants/my-accountant/typing', {});
    const pa = await a.post(P + '/messages', { content: aMsg });
    A('accountant replies (200)', pa.status === 200, pa.status);
    await sleep(500);
    const aThread = JSON.parse((await a.get(P + '/messages')).text || '{}').messages || [];
    const un2 = JSON.parse((await a.get(P + '/unread')).text || '{}').unread;
    const oThreadR = JSON.parse((await owner.get('/api/accountants/my-accountant/messages')).text || '{}');
    const oThread = oThreadR.messages || [];
    const has = (t, txt, sender) => t.some(m => m.content === txt && m.sender === sender);
    A('accountant sees both messages with the right senders (client / accountant)', has(aThread, oMsg, 'client') && has(aThread, aMsg, 'accountant'), JSON.stringify(aThread.slice(-3)));
    A('owner sees both messages with the right senders', has(oThread, oMsg, 'client') && has(oThread, aMsg, 'accountant'), JSON.stringify(oThread.slice(-3)));
    A('unread for the accountant: 1 after the owner wrote, 0 after opening the thread', un1 === 1 && un2 === 0, 'before ' + un1 + ' after ' + un2);
    A('owner sees the accountant has read up to now ("Seen": otherLastRead set)', !!oThreadR.otherLastRead, JSON.stringify(oThreadR.otherLastRead));
    const sAtxt = sA.join(''), sOtxt = sO.join('');
    A('LIVE: the accountant\'s stream received the owner\'s message', sAtxt.includes(oMsg), 'status ' + sA.status + ' ' + sAtxt.slice(0, 300));
    A('LIVE: the owner\'s stream received the accountant\'s message', sOtxt.includes(aMsg), 'status ' + sO.status + ' ' + sOtxt.slice(0, 300));
    A('typing reaches the accountant ("event: typing" by client) and is NOT echoed to the owner who typed', sAtxt.includes('event: typing\ndata: {"by":"client"}') && !sOtxt.includes('event: typing\ndata: {"by":"client"}'), 'acct ' + JSON.stringify(sAtxt.match(/event: typing[^\n]*\ndata: [^\n]*/g)) + ' owner ' + JSON.stringify(sOtxt.match(/event: typing[^\n]*\ndata: [^\n]*/g)));

    // attachments both ways — byte-exact
    const ownerBytes = Buffer.from([0, 1, 2, 250, 251, 252, 13, 10, 37, 80, 68, 70]); const accBytes = Buffer.from('statement,amount\nJuly,123.45\n');
    const oa = JSON.parse(OK(await owner.post('/api/accountants/my-accountant/attach', { name: 'receipt.pdf', mime: 'application/pdf', dataB64: ownerBytes.toString('base64') })).text);
    const aa = JSON.parse(OK(await a.post('/api/accountants/clients/attach', { userId: uid, name: 'adj.csv', mime: 'text/csv', dataB64: accBytes.toString('base64') })).text);
    const dl = async (h, id) => { const ck = h ? h._cookieHeader() : null; const r = await fetch(base + '/api/accountants/chat-attachment/' + id, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), cd: r.headers.get('content-disposition') }; };
    for (const [who, h] of [['owner', owner], ['accountant', a]]) for (const [what, id, bytes] of [['owner\'s receipt.pdf', oa.id, ownerBytes], ['accountant\'s adj.csv', aa.id, accBytes]]) {
      const r = await dl(h, id); A(`${who} downloads the ${what} byte-exact (as an attachment)`, r.status === 200 && r.buf.equals(bytes) && /attachment/.test(r.cd || ''), r.status + ' ' + r.buf.length + ' bytes ' + r.cd); }
    const big = await owner.post('/api/accountants/my-accountant/attach', { name: 'big.bin', mime: 'application/octet-stream', dataB64: Buffer.alloc(5 * 1024 * 1024 + 1024).toString('base64') });
    A('an attachment over 5 MB is refused (413)', big.status === 413, big.status + ' ' + big.text.slice(0, 80));

    // walls
    const bR = await b.get(P + '/messages'), bP = await b.post(P + '/messages', { content: 'intrude' }), bT = await b.post(P + '/typing', {});
    const bS = await fetch(base + P + '/stream', { headers: { cookie: b._cookieHeader() } }).then(r => { try { r.body.cancel(); } catch (_) {} return r.status; });
    A('accountant B (other client) gets 403 on A\'s thread: read / post / typing / stream', [bR.status, bP.status, bT.status, bS].every(s => s === 403), JSON.stringify([bR.status, bP.status, bT.status, bS]));
    A('accountant B gets 404 on both of A\'s attachments', (await dl(b, oa.id)).status === 404 && (await dl(b, aa.id)).status === 404);
    const o2 = JSON.parse((await owner2.get('/api/accountants/my-accountant/messages')).text || '{}').messages || [];
    A('the second owner\'s thread holds none of this conversation', !o2.some(m => [oMsg, aMsg].includes(m.content)), JSON.stringify(o2).slice(0, 160));
    A('the second owner gets 404 on both attachments', (await dl(owner2, oa.id)).status === 404 && (await dl(owner2, aa.id)).status === 404);
    A('logged out → 401 on an attachment', (await dl(null, oa.id)).status === 401);

    // HTML stays text
    const xss = '<img src=x onerror="alert(1)">';
    await owner.post('/api/accountants/my-accountant/messages', { content: xss });
    const back = (JSON.parse((await a.get(P + '/messages')).text || '{}').messages || []).find(m => m.content === xss);
    A('HTML in a message is stored and served unchanged as text (renderers escape it — by reading)', !!back, JSON.stringify(back).slice(0, 120));

    // revoke
    const rv = await owner.post('/api/accountants/my-accountant/revoke', { accountantId: accA });
    A('owner revokes accountant A (2xx)', rv.status >= 200 && rv.status < 300, rv.status + ' ' + rv.text.slice(0, 120));
    const rr = await a.get(P + '/messages'), rp = await a.post(P + '/messages', { content: 'after revoke' });
    A('after revoke: A gets 403 reading and posting in the thread', rr.status === 403 && rp.status === 403, rr.status + ' / ' + rp.status);
    A('after revoke: A gets 404 on both attachments', (await dl(a, oa.id)).status === 404 && (await dl(a, aa.id)).status === 404);
    A('after revoke: the owner can still download their own file', (await dl(owner, oa.id)).status === 200);
    // the accountant's LIVE stream was opened while linked — does it keep delivering after the revoke?
    const postRevoke = 'after-revoke secret ' + Date.now();
    const pr = await owner.post('/api/accountants/my-accountant/messages', { content: postRevoke });
    await sleep(600);
    // NOT a discriminating check of the open subscription itself: the owner's post is refused once the link is revoked
    // (no active link), so nothing is broadcast on that conversation any more — that refusal is what keeps the stream silent.
    A('after revoke: the owner can no longer post into that thread (404) and the accountant\'s already-open stream gets nothing', pr.status === 404 && !sA.join('').includes(postRevoke), 'post ' + pr.status + ' ' + 'stream got: ' + JSON.stringify((sA.join('').match(/after-revoke secret \d+/) || [])[0]));
  } finally {
    for (const ac of streams) try { ac.abort(); } catch (_) {}
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { await scratch.stop(); } catch (_) {}
  }
}
main().catch(e => { fail++; console.log('  FATAL: ' + e.message + ' ' + (e.code || '') + '\n' + e.stack); if (e.errors) e.errors.forEach(x => console.log('  - ' + x.message)); })
  .finally(() => { console.log('\n' + '-'.repeat(78)); console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant writes + chat)`); process.exit(fail ? 1 : 0); });
