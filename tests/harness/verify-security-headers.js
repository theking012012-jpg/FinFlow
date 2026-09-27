#!/usr/bin/env node
'use strict';
/**
 * verify-security-headers.js — F203: the security posture is TESTED, not just configured. Boots the
 * real server and asserts every hardening header is present and correct on an API response, so a
 * future edit that weakens the CSP / drops a header fails CI instead of shipping silently.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-security-headers.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const res = await fetch(server.baseUrl + '/api/healthz').catch(() => null)
             || await fetch(server.baseUrl + '/');
    const h = (k) => res.headers.get(k) || '';

    const csp = h('content-security-policy');
    A('CSP present', !!csp);
    A("CSP default-src 'self'", /default-src 'self'/.test(csp), csp.slice(0,80));
    A("CSP frame-ancestors 'none' (clickjacking)", /frame-ancestors 'none'/.test(csp));
    A("CSP object-src 'none'", /object-src 'none'/.test(csp));
    A("CSP base-uri 'self'", /base-uri 'self'/.test(csp));
    A('X-Frame-Options DENY', h('x-frame-options') === 'DENY', h('x-frame-options'));
    A('X-Content-Type-Options nosniff', h('x-content-type-options') === 'nosniff', h('x-content-type-options'));
    A('Referrer-Policy set', /strict-origin/.test(h('referrer-policy')), h('referrer-policy'));
    A('Permissions-Policy locks camera', /camera=\(\)/.test(h('permissions-policy')), h('permissions-policy').slice(0,80));
    A('Permissions-Policy locks microphone + geolocation', /microphone=\(\)/.test(h('permissions-policy')) && /geolocation=\(\)/.test(h('permissions-policy')));
    A('X-Request-Id correlation header present', !!h('x-request-id'), h('x-request-id'));
    // Indexing gate: default (ALLOW_INDEXING unset) must serve noindex.
    A('X-Robots-Tag noindex by default (testing safety)', /noindex/.test(h('x-robots-tag')), h('x-robots-tag'));
    // HSTS is set by helmet in every env (safe for an HTTPS-only app) and reinforced in prod.
    A('HSTS present with a real max-age', /max-age=\d{7,}/.test(h('strict-transport-security')), h('strict-transport-security'));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (security headers present & correct)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[sec-hdr] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
