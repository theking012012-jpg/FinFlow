'use strict';
/**
 * FA-P1b (2026-10-27) — the boot fetch coalescer shares a round trip only between CONCURRENT duplicate GETs; a GET made
 * after the first one has finished goes to the server and gets the current data.
 *
 * BUG (executed on the old code, this harness): it kept every successful response for its whole 10-second boot window,
 * so a repeat GET in that window was answered with the FIRST response — stale after any change the page did not make
 * through window.fetch (another tab, a server-side job, an http client). Hidden from the jsdom harnesses until FA-P1
 * step C: jsdomBoot replaced window.fetch after the (then inline) script had wrapped it; once scripts became files it
 * wrapped the harness's fetch and six page harnesses read stale lists (c8, fab8-ui, m36, client-accountant-xss, fap2, la4).
 *
 * Executed: the real public/js/app-03-ff-fetch-coalesced.js in a bare jsdom, over a counting fake server whose data
 * changes between reads (v1 → v2), so a stale answer is distinguishable from a fresh one (Rule 4).
 *   1 two concurrent GETs of one URL → 1 request, both read v1                 (the coalescer's purpose — kept)
 *   2 the server moves to v2; a GET after the first finished → a 2nd request, reads v2      bug: 1 request, reads v1
 *   3 a failed response is never shared; a write passes straight through
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const eq = (n, got, want, bug) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(got)}, correct ${JSON.stringify(want)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  console.log('\nFA-P1b — the boot fetch coalescer never answers with a finished response\n');
  const file = path.join(__dirname, '..', '..', 'public', 'js', 'app-03-ff-fetch-coalesced.js');
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  let version = 'v1', calls = 0, failNext = false;
  w.fetch = (url, init) => {
    calls++;
    const ok = !failNext; failNext = false;
    const body = { v: version, url: String(url), method: (init && init.method) || 'GET' };
    const res = { ok, status: ok ? 200 : 500, clone() { return Object.assign({}, res); }, json() { return Promise.resolve(body); } };
    return new Promise(r => setTimeout(() => r(res), 20));
  };
  w.eval(fs.readFileSync(file, 'utf8'));
  const get = u => w.fetch(u).then(r => r.json());

  const [a, b] = await Promise.all([get('/api/customers'), get('/api/customers')]);
  eq('1  two concurrent GETs of one URL share one request', calls, 1);
  eq('1  …and both read the server\'s data', [a.v, b.v], ['v1', 'v1']);

  version = 'v2';
  const c = await get('/api/customers');
  eq('2  a GET after the first finished goes to the server (2nd request)', calls, 2, 1);
  eq('2  …and reads the CURRENT data', c.v, 'v2', 'v1');

  failNext = true; await get('/api/invoices').catch(() => {});
  const d = await get('/api/invoices');
  eq('3  a failed response is never shared (the retry is a new request)', [calls, d.v], [4, 'v2']);
  const e = await w.fetch('/api/customers', { method: 'POST', body: '{}' }).then(r => r.json());
  eq('3  a write passes straight through', [calls, e.method], [5, 'POST']);

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
