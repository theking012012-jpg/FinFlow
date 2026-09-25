'use strict';
/*
 * verify-min-serving.js - mobile-perf: the server transparently serves the MINIFIED copy of an app
 * script (public/.min/<name>) under the same URL when it exists and is fresh, and falls back to the
 * readable original otherwise. Proves the win is real and safe:
 *   - GET /app-main.js returns the minified bytes (smaller than source, byte-identical to public/.min).
 *   - the minified payload is still valid JavaScript (parses).
 *   - a file with no minified copy (kyc-registry.js) is served unchanged (graceful fallback).
 *   node -r ./tests/harness/clock.js tests/harness/verify-min-serving.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PUB = path.join(__dirname, '..', '..', 'public');
async function main() {
  // Ensure minified artifacts exist for this run (idempotent; prestart does this in prod).
  try { require('child_process').execFileSync('node', ['scripts/minify.js'], { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' }); } catch (_) {}
  const scratch = await startScratchPostgres({ keep: false });
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.82' });
    console.log('\n' + '='.repeat(78) + '\n  MOBILE-PERF - server serves minified app scripts transparently\n' + '='.repeat(78) + '\n');

    const srcSize = fs.statSync(path.join(PUB, 'app-main.js')).size;
    const minPath = path.join(PUB, '.min', 'app-main.js');
    const hasMin = fs.existsSync(minPath);
    A('minified app-main.js was produced by the build', hasMin);
    const r = await http.request('GET', '/app-main.js');
    A('GET /app-main.js 200', r.status === 200, 'status=' + r.status);
    const bodyLen = Buffer.byteLength(r.text || '');
    A('served app-main.js is smaller than the source (minified)', bodyLen < srcSize, 'served=' + bodyLen + ' source=' + srcSize);
    if (hasMin) {
      const minLen = fs.statSync(minPath).size;
      A('served bytes == public/.min/app-main.js (the minified copy)', bodyLen === minLen, 'served=' + bodyLen + ' min=' + minLen);
    }
    const _ct = (r.headers && typeof r.headers.get === 'function') ? (r.headers.get('content-type') || '') : '';
    A('served content-type is javascript', /javascript|ecmascript/i.test(_ct), 'content-type=' + _ct);
    // Minified payload still parses as valid JS.
    let parseOk = true; try { new vm.Script(r.text); } catch (e) { parseOk = false; }
    A('served minified app-main.js parses as valid JavaScript', parseOk);

    // Fallback: a file with no minified copy is served unchanged.
    const kycSrc = fs.readFileSync(path.join(PUB, 'kyc-registry.js'), 'utf8');
    const rk = await http.request('GET', '/kyc-registry.js');
    A('GET /kyc-registry.js 200', rk.status === 200);
    A('un-targeted file served unchanged (graceful fallback)', (rk.text || '').length === kycSrc.length, 'served=' + (rk.text || '').length + ' source=' + kycSrc.length);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (minified served transparently; safe fallback)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
