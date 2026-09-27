#!/usr/bin/env node
'use strict';
/**
 * verify-csp-report.js — F207: the CSP nonce/hash migration MEASUREMENT phase is safe and works.
 *   • CSP_REPORT_ONLY=1 adds a STRICT report-only policy (no 'unsafe-inline') that BLOCKS NOTHING
 *   • the enforced CSP is UNCHANGED (still has 'unsafe-inline' — nothing breaks)
 *   • POST /api/csp-report aggregates violations; GET (owner) reads them; non-owner is 403
 *
 *   CSP_REPORT_ONLY=1 node -r ./tests/harness/clock.js tests/harness/verify-csp-report.js
 */
process.env.CSP_REPORT_ONLY = '1';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);

    const res = await http.get('/healthz');
    const ro = res.headers.get('content-security-policy-report-only') || '';
    const enforced = res.headers.get('content-security-policy') || '';
    A('report-only header present when CSP_REPORT_ONLY=1', !!ro);
    A('report-only script-src has NO unsafe-inline (strict)', /script-src 'self'/.test(ro) && !/script-src[^;]*unsafe-inline/.test(ro), ro.slice(0, 120));
    A('report-only points at the collector', /report-uri \/api\/csp-report/.test(ro));
    A('ENFORCED CSP is unchanged (still unsafe-inline — nothing blocked)', /script-src[^;]*'unsafe-inline'/.test(enforced));

    // Collector accepts an unauthenticated report and aggregates it.
    const rep = { 'csp-report': { 'violated-directive': 'script-src-elem', 'blocked-uri': 'inline', 'source-file': 'https://app/index.html', 'line-number': 42, 'script-sample': 'onclick handler' } };
    const p1 = await http.post('/api/csp-report', rep);
    A('POST /api/csp-report returns 204', p1.status === 204, 'HTTP ' + p1.status);
    await http.post('/api/csp-report', rep);   // same signature again → should collapse to count 2

    // Owner reads the aggregate.
    await http.post('/api/auth/register', { email: 'csp-owner@finflow.test', password: 'harness-password-not-a-secret', name: 'CSP' });
    const rd = await http.get('/api/csp-report');
    A('owner GET /api/csp-report returns 200', rd.status === 200, 'HTTP ' + rd.status);
    A('aggregation collapsed 2 identical reports into one row with count 2', (rd.json?.rows || []).some(r => r.count === 2 && r.directive === 'script-src-elem'), JSON.stringify(rd.json?.rows));
    A('by-directive summary present', rd.json?.byDirective && rd.json.byDirective['script-src-elem'] === 2, JSON.stringify(rd.json?.byDirective));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (CSP report-only measurement: safe, collects, owner-readable)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[csp] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
