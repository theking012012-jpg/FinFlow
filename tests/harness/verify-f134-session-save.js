'use strict';
/**
 * verify-f134-session-save.js — PROVE (Rule 14) that awaiting req.session.save() before the auth
 * response closes the fresh-login 401 race. DETERMINISTIC: every session-table INSERT (the store's
 * set() upsert) is delayed ~400ms, so the async-durability window is wide and the result never
 * depends on localhost scheduling.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f134-session-save.js
 *
 * WHY A HEADER-EARLY CLIENT (this is load-bearing): express-session flushes the response HEADERS +
 * body at `writetop` — BEFORE the async connect-pg-simple store.set INSERT commits — and only calls
 * the real `res.end()` later, in the save callback. A browser's fetch resolves and acts on the
 * response the moment the headers/body arrive (writetop), so it fires its authenticated GETs before
 * the session row is durable. A body-awaiting client (`await res.text()`) instead blocks until the
 * stream ENDS (res.end, after the save), hiding the race. So this probe reads the Set-Cookie from
 * the response HEADERS (resolved by `await fetch()`) and fires the GET WITHOUT consuming the body —
 * exactly what the browser does.
 *
 * With the 400ms store-set delay:
 *   CURRENT code (sets req.session.userId, responds with NO save): headers arrive ~400ms before the
 *     store.set commits -> session row ABSENT at header time AND the immediate GET -> 401.  => FAILS.
 *   FIXED code (await saveSession(req) before the response): the response is HELD until the delayed
 *     INSERT commits -> row present at header time AND the immediate GET -> 200.             => PASSES.
 *
 * Run against the CURRENT code first (fails), apply the fix, run again (passes).
 */

const bcrypt = require('bcryptjs');
const { RealDate } = require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

const SET_DELAY_MS = 400;

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    // Instrument the store: delay every session-table INSERT (store.set upsert) so durability is
    // DETERMINISTICALLY slow. connect-pg-simple runs its set() via this exact pool.query (promise
    // form: this.#pool.query(query, params)); SELECT get / DELETE prune / UPDATE touch / CREATE TABLE
    // are NOT matched, so only the durability write is widened.
    let _sessInserts = 0;
    const realQuery = server.pool.query.bind(server.pool);
    server.pool.query = function (text, params, cb) {
      const sql = typeof text === 'string' ? text : (text && text.text) || '';
      if (/insert into\s+"?session"?/i.test(sql)) {
        _sessInserts++;
        console.log(`  [instrument] session INSERT (store.set) intercepted #${_sessInserts} — delaying ${SET_DELAY_MS}ms`);
        if (typeof cb === 'function') { setTimeout(() => realQuery(text, params, cb), SET_DELAY_MS); return undefined; }
        if (typeof params === 'function') { const only = params; setTimeout(() => realQuery(text, only), SET_DELAY_MS); return undefined; }
        return new Promise((resolve, reject) => setTimeout(() => realQuery(text, params).then(resolve, reject), SET_DELAY_MS));
      }
      return realQuery(text, params, cb);
    };

    const sessionRows = async (uid) => {
      if (uid == null) return -1;
      try {
        return Number((await c.query(`SELECT COUNT(*)::int n FROM session WHERE sess->>'userId' = $1`, [String(uid)])).rows[0].n);
      } catch (e) { if (e.code === '42P01') return 0; throw e; }
    };

    // Header-early probe: resolve on HEADERS (like a browser), read the session cookie, check the
    // store, fire the authed GET — all BEFORE consuming the response body (which would block to res.end).
    async function probe(label, path, body, resolveUid) {
      const t0 = RealDate.now();
      const resp = await fetch(server.baseUrl + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const tHeaders = RealDate.now() - t0;
      const sc = typeof resp.headers.getSetCookie === 'function'
        ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie')].filter(Boolean);
      const cookie = (sc.find(x => x && x.startsWith('connect.sid=')) || sc[0] || '').split(';')[0];
      const uid = await resolveUid(resp);
      const rowAtHeaders = await sessionRows(uid);
      const getResp = await fetch(server.baseUrl + '/api/entities', { headers: { Cookie: cookie } });
      const bodyText = await resp.text();     // now drain the body (blocks to res.end / after the save)
      console.log(`  [diag ${label}] tHeaders=${tHeaders}ms rowAtHeaders=${rowAtHeaders} getStatus=${getResp.status} (delay=${SET_DELAY_MS})`);
      return { status: resp.status, cookie, uid, rowAtHeaders, getStatus: getResp.status, bodyText };
    }

    // ── LOGIN ── pre-insert a user (plan 'pro' so checkPlan passes), then log in.
    const LOGIN = { email: 'f134-login@finflow.test', password: 'harness-password-not-a-secret' };
    const uidL = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F134 Login', plan: 'pro', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    const L = await probe('login', '/api/auth/login', LOGIN, async () => uidL);
    A('login: response 200', L.status === 200, `status ${L.status}: ${L.bodyText.slice(0, 150)}`);
    A('login: session row committed BEFORE the response headers resolved',
      L.rowAtHeaders >= 1, `rows=${L.rowAtHeaders}  (buggy=0: headers flushed before the delayed store.set)`);
    A('login: immediate authed GET /api/entities -> 200, not 401', L.getStatus === 200, `status=${L.getStatus}`);

    // ── REGISTER ── a fresh user; register also establishes a session (same class, server.js:500).
    const regEmail = `f134-reg-${Date.now()}@finflow.test`;
    const R = await probe('register', '/api/auth/register', { email: regEmail, password: 'testpass123', name: 'F134 Reg' },
      async () => (await c.query(`SELECT id FROM users WHERE lower(data->>'email')=lower($1)`, [regEmail])).rows[0]?.id);
    A('register: response 201', R.status === 201, `status ${R.status}: ${R.bodyText.slice(0, 150)}`);
    A('register: session row committed BEFORE the response headers resolved',
      R.rowAtHeaders >= 1, `rows=${R.rowAtHeaders} uid=${R.uid}  (buggy=0)`);
    A('register: immediate authed GET /api/entities -> 200, not 401', R.getStatus === 200, `status=${R.getStatus}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (store-set delay ${SET_DELAY_MS}ms)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    fail++;
  } finally {
    try { if (server) await server.close(); } catch { /* ignore */ }
    try { if (scratch) await scratch.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
