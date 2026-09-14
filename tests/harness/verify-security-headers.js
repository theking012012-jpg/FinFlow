'use strict';
/**
 * verify-security-headers.js — lock in the HTTP security headers so a future change can't silently
 * drop them. Asserts the env-independent headers over real HTTP, and confirms the prod-only HSTS line
 * is present in source. Regression guard for the app's hardening posture.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-security-headers.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const r = await new HarnessHttp(server.baseUrl).get('/healthz');
    const h = (k) => String(r.headers.get(k) || '');

    console.log('\n' + '='.repeat(78));
    console.log('  SECURITY HEADERS — hardening posture regression guard');
    console.log('='.repeat(78) + '\n');

    A('X-Frame-Options: DENY', h('x-frame-options') === 'DENY', h('x-frame-options'));
    A('X-Content-Type-Options: nosniff', h('x-content-type-options') === 'nosniff', h('x-content-type-options'));
    A('Referrer-Policy: strict-origin-when-cross-origin', h('referrer-policy') === 'strict-origin-when-cross-origin', h('referrer-policy'));

    const csp = h('content-security-policy');
    A('CSP present', !!csp);
    A("CSP: default-src 'self'", /default-src 'self'/.test(csp));
    A("CSP: frame-ancestors 'none' (clickjacking)", /frame-ancestors 'none'/.test(csp));
    A("CSP: object-src 'none'", /object-src 'none'/.test(csp));
    A("CSP: base-uri 'self'", /base-uri 'self'/.test(csp));

    // HSTS is ALWAYS on (helmet enables it by default ~180d); production upgrades it to 1 year.
    A('HSTS present with includeSubDomains', /max-age=\d+/.test(h('strict-transport-security')) && /includeSubDomains/.test(h('strict-transport-security')), h('strict-transport-security'));
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
    A('production upgrades HSTS to 1 year in source', /NODE_ENV === 'production'[\s\S]{0,120}Strict-Transport-Security[\s\S]{0,80}max-age=31536000/.test(src));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (security headers)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
