'use strict';
/**
 * verify-fab13-not-found.js — FA-B13 (full app audit B13: "Unknown URLs return the home page with HTTP 200, never a 404,
 * e.g. /app/nonexistent-xyz"). After: an address with no page answers 404 with a "Page not found" page linking home and
 * the app. Every real page still answers 200 (each extension-less link the app uses has its own route; the rest are
 * files), and unknown API paths stay JSON 404.
 * Real server + real Postgres.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab13-not-found.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false }); let server = null;
  try {
    server = await bootServer(scratch.url);
    const get = async p => { const r = await fetch(server.baseUrl + p, { redirect: 'manual' }); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' }; };
    console.log('\n' + '='.repeat(78) + '\n  FA-B13 — an address with no page is a 404, every real page is still 200\n' + '='.repeat(78) + '\n');
    for (const p of ['/app/nonexistent-xyz', '/pricing-old', '/blog/2024/hello']) {
      const r = await get(p);
      A('1  ' + p + ' → 404 "Page not found" (bug: 200 with the home page)', r.status === 404 && /Page not found/.test(r.text) && !/<title>[^<]*FinFlow[^<]*<\/title>[\s\S]*hero/i.test(r.text), 'status ' + r.status);
    }
    for (const p of ['/', '/app', '/join', '/accountant', '/accountant-login', '/accountants', '/privacy.html', '/terms.html', '/security.html', '/conduct.html', '/reset-password.html', '/team-accept.html', '/pay-received.html', '/accountant-register.html']) {
      const r = await get(p);
      A('2  ' + p + ' → a real page (200, or 302 to sign in)', (r.status === 200 && /text\/html/.test(r.type) && !/Page not found/.test(r.text)) || r.status === 302, 'status ' + r.status);
    }
    const api = await get('/api/no-such-route');
    A('3  an unknown API path stays a JSON 404', api.status === 404 && /json/.test(api.type), 'status ' + api.status + ' ' + api.type);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack || e); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-B13 not found)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
