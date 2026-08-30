'use strict';
/* verify-connector-sync.js — Track A / A2: "Sync now" pulls the latest data through a connector's
 * existing /sync route, reports the count the server returns, and refreshes the owning surface —
 * WITHOUT writing to the books (sync is display/feed only). Honest failure on a non-ok /sync.
 *
 * Drives the REAL connections-hub IIFE (extracted from index.html) in jsdom against stubbed /sync
 * responses — it exercises window.connSyncNow, not a re-implementation.
 *
 * Discriminating (Rule 14): before A2 there was NO sync trigger — window.connSyncNow did not exist and
 * no card carried a Sync button. Assertion 1 (connSyncNow is a function) goes red on the pre-A2 code.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-connector-sync.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    // Extract the connections-hub inline <script> (the one that defines connSyncNow).
    const blocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    const iifeTag = blocks.find(b => b.includes('window.connSyncNow') && b.includes('INTEGRATIONS='));
    A('connections-hub script contains a Sync-now trigger (window.connSyncNow)', !!iifeTag,
      'no inline script defines window.connSyncNow — A2 not present');
    if (!iifeTag) { console.log('\n  RED — ' + pass + ' passed, ' + fail + ' failed  (A2 connector sync)'); process.exit(1); }
    const iife = iifeTag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

    const dom = new JSDOM('<!doctype html><body><div id="page-connections">' +
      '<input id="conn-search"><div id="conn-cat-pills"></div><div id="conn-results-ct"></div>' +
      '<div id="conn-catalog"></div><div id="cs-total"></div><div id="cs-connected"></div></body>',
      { runScripts: 'outside-only', url: 'https://x.test/app' });
    const { window } = dom;

    // ── instrumentation ──
    const calls = [];              // every fetch path + method
    const notes = [];              // every notify(msg, isError)
    const refreshed = [];          // finflow.refresh(pages)
    let syncResponse = { ok: true, json: async () => ({}) };   // default for hydrate/status probes
    window.fetch = (url, init) => {
      const p = String(url); const method = (init && init.method) || 'GET';
      calls.push({ p, method });
      if (/\/sync$/.test(p)) return Promise.resolve(syncResponse);
      return Promise.resolve({ ok: true, json: async () => ({}) });   // status/hydrate probes → empty
    };
    window.notify = (msg, isErr) => notes.push({ msg: String(msg), isErr: !!isErr });
    window.S = n => '$' + (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString();
    window.finflow = { refresh: pages => refreshed.push(pages) };

    window.eval(iife);   // runs buildPills/render/hydrateStates against the stubs

    A('window.connSyncNow is a function', typeof window.connSyncNow === 'function');

    // ── 1. Plaid sync success: reports the added count, refreshes bank surfaces, no books write ──
    calls.length = 0; notes.length = 0; refreshed.length = 0;
    syncResponse = { ok: true, json: async () => ({ ok: true, added: 6 }) };
    await window.connSyncNow('Plaid');
    await new Promise(r => setTimeout(r, 20));
    const hitPlaidSync = calls.some(c => c.p.endsWith('/api/plaid/sync') && c.method === 'POST');
    A('Plaid sync POSTs /api/plaid/sync', hitPlaidSync, JSON.stringify(calls));
    A('reports the added transaction count', notes.some(n => /6 transaction/.test(n.msg) && !n.isErr), JSON.stringify(notes));
    A('refreshes the owning bank surfaces', refreshed.some(p => p.includes('bank-rec') || p.includes('banking')), JSON.stringify(refreshed));
    A('never calls a books-import route during sync', !calls.some(c => /\/import(\b|$)/.test(c.p)), JSON.stringify(calls));

    // ── 2. Stripe sync: available-balance array summed to a money figure ──
    calls.length = 0; notes.length = 0;
    syncResponse = { ok: true, json: async () => ({ ok: true, available: [{ amount: 194170, currency: 'usd' }] }) };
    await window.connSyncNow('Stripe');
    await new Promise(r => setTimeout(r, 20));
    A('Stripe balance shown ($1,941.70), not "[object Object]"',
      notes.some(n => /1,941\.7/.test(n.msg)) && !notes.some(n => /\[object Object\]/.test(n.msg)), JSON.stringify(notes));

    // ── 3. Honest failure: a 502 /sync surfaces the server error as an error toast ──
    calls.length = 0; notes.length = 0;
    syncResponse = { ok: false, json: async () => ({ error: 'Payroll linking is not set up yet.' }) };
    await window.connSyncNow('Finch');
    await new Promise(r => setTimeout(r, 20));
    A('a failing sync surfaces the server error (red), not a fake success',
      notes.some(n => n.isErr && /not set up/.test(n.msg)) && !notes.some(n => /synced/.test(n.msg)), JSON.stringify(notes));

    // ── 4. Unknown connector is a no-op (no fetch) ──
    calls.length = 0;
    await window.connSyncNow('NotAConnector');
    A('unknown connector name is a safe no-op', calls.length === 0);

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : 'RED') + ` — ${pass} passed, ${fail} failed  (A2: connector "Sync now" trigger)`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('  HARNESS ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
