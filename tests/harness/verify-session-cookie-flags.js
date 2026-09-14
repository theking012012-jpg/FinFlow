'use strict';
/**
 * verify-session-cookie-flags.js — the session cookie set at login must carry the hardening flags:
 * HttpOnly (no JS access → XSS can't steal it) and SameSite=Lax (CSRF-write defense). Secure is
 * prod-only, so it must be ABSENT under test but PRESENT in the source cookie config.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-session-cookie-flags.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1)', [{ email: 'ck@finflow.test', role: 'owner', password: bcrypt.hashSync(PW, 10) }]);

    console.log('\n' + '='.repeat(78));
    console.log('  SESSION COOKIE FLAGS — HttpOnly + SameSite (Secure prod-only)');
    console.log('='.repeat(78) + '\n');

    const r = await new HarnessHttp(server.baseUrl).post('/api/auth/login', { email: 'ck@finflow.test', password: PW });
    A('login → 200', r.status === 200);
    const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [String(r.headers.get('set-cookie') || '')];
    const sess = setCookies.find(x => /connect\.sid=/.test(x)) || setCookies.join(' ');
    A('login sets a session cookie', /connect\.sid=/.test(sess), sess);
    A('cookie is HttpOnly', /HttpOnly/i.test(sess), sess);
    A('cookie is SameSite=Lax', /SameSite=Lax/i.test(sess), sess);
    A('cookie NOT Secure under test env (correct)', !/;\s*Secure/i.test(sess), sess);

    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
    A('cookie config sets httpOnly + sameSite lax + prod-secure in source', /httpOnly:\s*true/.test(src) && /sameSite:\s*'lax'/.test(src) && /secure:\s*process\.env\.NODE_ENV === 'production'/.test(src));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (session cookie flags)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
