'use strict';
/**
 * verify-a5-sentry-indexing.js — A5 (§2.2 error monitoring, §1.8 search indexing). Executed against the real server on a
 * real scratch Postgres, each mode in its OWN child process (both settings are read once, at module load).
 *
 *   SENTRY (server.js: `if (SENTRY_DSN) require('@sentry/node')…init`, every unhandled route error → captureErr)
 *   S1  SENTRY_DSN unset → @sentry/node is never loaded; a route error still returns the JSON 500     (clean no-op)
 *   S2  SENTRY_DSN set   → boot logs "[Sentry] Initialized" (NOT "Package not installed")             bug: the package is
 *                          not a dependency, so require() throws → caught → error tracking silently OFF
 *   S3  SENTRY_DSN set   → a route error reaches Sentry.captureException with the route's path        bug: never called
 *       (the error is forced by renaming vendors.user_id — 42703 — so GET /api/vendors throws inside its handler; the SDK's
 *       send is blocked by clock.js's offline guard — nothing leaves the machine)
 *   INDEXING (server.js: ALLOW_INDEXING gates X-Robots-Tag + robots.txt)
 *   I1  unset → X-Robots-Tag "noindex, nofollow" and robots.txt "Disallow: /"                      (pre-launch default)
 *   I2  ALLOW_INDEXING=1 → NO X-Robots-Tag header and robots.txt "Allow: /"                         (the launch switch)
 */
require('./clock.js');
const path = require('path');
const { spawnSync } = require('child_process');

const MODE = process.env.A5_CHILD;
if (MODE) {
  // ── child: one boot ──
  const bcrypt = require('bcryptjs');
  const { startScratchPostgres } = require('./pgScratch.js');
  const { bootServer } = require('./boot.js');
  const { HarnessHttp } = require('./httpClient.js');
  (async () => {
    let scratch, server; const out = { mode: MODE };
    const logs = [];
    for (const k of ['log', 'warn', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(a.map(String).join(' ')); if (k !== 'error') o(...a); }; }
    try {
      scratch = await startScratchPostgres({ keep: false });
      server = await bootServer(scratch.url);
      const http = new HarnessHttp(server.baseUrl);
      if (MODE === 'index-unset' || MODE === 'index-on') {
        const r = await http.get('/robots.txt');
        out.robots = String(r.text || '').trim();
        out.xrobots = (r.headers && (r.headers['x-robots-tag'] || (typeof r.headers.get === 'function' && r.headers.get('x-robots-tag')))) || null;
      } else {
        out.sentryLoaded = Object.keys(require.cache).some(k => /[\\/]@sentry[\\/]node[\\/]/.test(k));
        out.initLogged = logs.some(l => /\[Sentry\] Initialized/.test(l));
        out.notInstalledLogged = logs.some(l => /\[Sentry\] Package not installed/.test(l));
        const captured = [];
        if (out.sentryLoaded) {
          const S = require('@sentry/node');
          const orig = S.captureException;
          try { S.captureException = (e, ctx) => { captured.push({ msg: e && e.message, path: ctx && ctx.extra && ctx.extra.path }); return orig.call(S, e, ctx); }; } catch (_) { out.spyFailed = true; }
        }
        const uid = (await scratch.client.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
          [{ email: 'a5@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync('harness-password-not-a-secret', 10) }])).rows[0].id;
        if ((await http.post('/api/auth/login', { email: 'a5@finflow.test', password: 'harness-password-not-a-secret' })).status !== 200) throw new Error('login ' + uid);
        await scratch.client.query(`ALTER TABLE vendors RENAME COLUMN user_id TO user_id_a5_hidden`);   // 42703 — a missing TABLE (42P01) self-heals in db.allByUser
        const r = await http.get('/api/vendors');
        out.status = r.status; out.body = r.json;
        out.captured = captured;
      }
    } catch (e) { out.fatal = e && e.stack ? e.stack : String(e); }
    finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
    process.stdout.write('\nA5RESULT ' + JSON.stringify(out) + '\n');
    process.exit(0);
  })();
} else {
  // ── parent ──
  let pass = 0, fail = 0;
  const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
  const child = (mode, env) => {
    const e = Object.assign({}, process.env, { A5_CHILD: mode }); delete e.SENTRY_DSN; delete e.ALLOW_INDEXING; Object.assign(e, env);
    const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'clock.js'), __filename], { env: e, encoding: 'utf8', timeout: 240000 });
    const m = ((r.stdout || '') + (r.stderr || '')).match(/A5RESULT (.*)/);
    const res = m ? JSON.parse(m[1]) : { fatal: 'no result; exit ' + r.status + '\n' + String(r.stderr || '').slice(-1500) };
    if (res.fatal) console.log('    child ' + mode + ' FATAL-ish: ' + String(res.fatal).split('\n')[0]);
    return res;
  };
  console.log('\nA5 — Sentry wiring (off / on) and the ALLOW_INDEXING switch\n');
  const off = child('sentry-off', {});
  eq('S1 DSN unset → @sentry/node never loaded', off.sentryLoaded, false);
  eq('S1 DSN unset → route error still a JSON 500', [off.status, off.body && off.body.error], [500, 'An unexpected error occurred. Please try again.']);
  const on = child('sentry-on', { SENTRY_DSN: 'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/0' });
  eq('S2 DSN set → "[Sentry] Initialized" (package present)', [on.sentryLoaded, on.initLogged, on.notInstalledLogged], [true, true, false], [false, false, true]);
  eq('S3 DSN set → the route error reaches captureException with its path', (on.captured || []).map(c => c.path), ['/api/vendors'], []);
  eq('S3 … and the user still gets the JSON 500', on.status, 500);
  const iu = child('index-unset', {});
  eq('I1 unset → X-Robots-Tag noindex + robots Disallow', [iu.xrobots, iu.robots], ['noindex, nofollow', 'User-agent: *\nDisallow: /']);
  const io = child('index-on', { ALLOW_INDEXING: '1' });
  eq('I2 ALLOW_INDEXING=1 → no X-Robots-Tag + robots Allow', [io.xrobots, io.robots], [null, 'User-agent: *\nAllow: /']);
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
