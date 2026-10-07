#!/usr/bin/env node
'use strict';
/**
 * verify-csp-report.js — F207: the CSP nonce/hash migration MEASUREMENT phase is safe and works.
 *   • CSP_REPORT_ONLY=1 adds a STRICT report-only policy (no 'unsafe-inline') that BLOCKS NOTHING
 *   • the enforced CSP is UNCHANGED (still has 'unsafe-inline' — nothing breaks)
 *   • POST /api/csp-report accepts the browsers' real report content types and aggregates them;
 *     only the platform admin reads the aggregate (N71)
 *
 *   CSP_REPORT_ONLY=1 node -r ./tests/harness/clock.js tests/harness/verify-csp-report.js
 */
process.env.CSP_REPORT_ONLY = '1';
process.env.ADMIN_PASSWORD = 'harness-admin-password';
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
    A('report-only uses the Reporting API (report-to)', /report-to csp-endpoint/.test(ro), ro.slice(0,160));
    A('Reporting-Endpoints header names the collector', /csp-endpoint="\/api\/csp-report"/.test(res.headers.get('reporting-endpoints') || ''), res.headers.get('reporting-endpoints'));
    A('ENFORCED CSP is unchanged (still unsafe-inline — nothing blocked)', /script-src[^;]*'unsafe-inline'/.test(enforced));

    // Collector accepts an unauthenticated report and aggregates it — with the content types BROWSERS
    // actually send (N71: the F22 JSON-only gate used to 415 them, so no real report ever arrived).
    const raw = (ct, body) => fetch(server.baseUrl + '/api/csp-report', { method: 'POST', headers: { 'Content-Type': ct, 'X-Forwarded-For': '10.71.0.1' }, body: JSON.stringify(body) });
    const rep = { 'csp-report': { 'violated-directive': 'script-src-elem', 'blocked-uri': 'inline', 'source-file': 'https://app/index.html', 'line-number': 42, 'script-sample': 'onclick handler' } };
    const p1 = await raw('application/csp-report', rep);
    A('report-uri delivery (application/csp-report) → 204 (bug: 415)', p1.status === 204, 'HTTP ' + p1.status);
    const p2 = await raw('application/reports+json', [{ type: 'csp-violation', body: { effectiveDirective: 'script-src-elem', blockedURL: 'inline', sourceFile: 'https://app/index.html', lineNumber: 42, sample: 'onclick handler' } }]);
    A('Reporting API delivery (application/reports+json) → 204 (bug: 415)', p2.status === 204, 'HTTP ' + p2.status);

    // A tenant owner cannot read the platform-wide aggregate; the platform admin can.
    await http.post('/api/auth/register', { email: 'csp-owner@finflow.test', password: 'harness-password-not-a-secret', name: 'CSP' });
    const ten = await http.get('/api/csp-report');
    A('tenant owner cannot read the global aggregate (bug: 200 with every tenant\'s reports)', ten.status !== 200 || !(ten.json && ten.json.rows), 'HTTP ' + ten.status);
    A('tenant owner cannot read the admin aggregate', [401, 403].includes((await http.get('/api/admin/csp-report')).status));
    const adm = new HarnessHttp(server.baseUrl, { xff: '10.71.0.9' });
    A('platform admin login', (await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const rd = await adm.get('/api/admin/csp-report');
    A('admin GET /api/admin/csp-report returns 200', rd.status === 200, 'HTTP ' + rd.status);
    A('both browser formats aggregated into one row with count 2', (rd.json?.rows || []).some(r => r.count === 2 && r.directive === 'script-src-elem'), JSON.stringify(rd.json?.rows));
    A('by-directive summary present', rd.json?.byDirective && rd.json.byDirective['script-src-elem'] === 2, JSON.stringify(rd.json?.byDirective));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (CSP report-only measurement: safe, collects, admin-readable)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[csp] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
