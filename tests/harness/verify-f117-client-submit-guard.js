'use strict';
/**
 * verify-f117-client-submit-guard.js
 *
 * PROVES the shared client double-submit guard (withSubmitGuard) by EXECUTION:
 *   (A) UNIT — the real extracted withSubmitGuard: refuses re-entry while in flight, ALWAYS
 *       re-enables the button in finally (even when fn throws), restores the label, returns fn's
 *       value, and tolerates a null button.
 *   (B) INTEGRATION — the real extracted addFXRate (now routed through the guard) fired twice in
 *       rapid succession against a REAL scratch Postgres: the guard blocks the SECOND request, so
 *       exactly ONE POST reaches /api/fx-rates. (The server also has a 5s dedup, so the row count is
 *       1 either way — that is why the CLIENT guard must be measured on REQUESTS SENT, not rows.)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f117-client-submit-guard.js
 *
 * FAIL-THEN-PASS: against the UNGUARDED source addFXRate sends 2 requests → (B) fails; guarded → 1.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'owner-f117@finflow.test', password: 'harness-password-not-a-secret' };

function sliceFn(src, header){
  const start = src.indexOf(header);
  if (start < 0) return null;
  const end = src.indexOf('\n}\n', start);
  return end < 0 ? null : src.slice(start, end + 2);
}

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    // ── Extract the REAL functions from source ──
    const appMain = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8').replace(/\r\n/g, '\n');
    const html    = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
    const guardSrc = sliceFn(appMain, 'async function withSubmitGuard(btn, fn, opts){');
    const fxSrc    = sliceFn(html, 'async function addFXRate(btn){');
    A('extracted withSubmitGuard from app-main.js', !!guardSrc, 'header not found');
    A('extracted addFXRate from index.html', !!fxSrc, 'header not found');

    // ── Boot server + Postgres, login (needed for integration) ──
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: OWNER.email, name: 'F117', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]);
    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    // ── jsdom + stubs; wire the extracted functions ──
    const dom = new JSDOM(`<button id="b">Save rate</button>
      <input id="fxr-from" value="USD"><input id="fxr-to" value="EUR">
      <input id="fxr-rate" value="1.1"><input id="fxr-date" value="2026-07-20">`);
    const document = dom.window.document;
    let postCount = 0;
    const fetchShim = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const p = String(url).replace(/^https?:\/\/[^/]+/, '');
      if (method === 'POST') postCount++;
      const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
      const r = method === 'POST' ? await http.post(p, body) : await http.get(p);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    };
    const noop = () => {};
    const factory = new Function('document','window','fetch','notify','closeModal','loadFXData',
      guardSrc + '\n' + fxSrc + '\n; return { withSubmitGuard, addFXRate };');
    const { withSubmitGuard, addFXRate } = factory(document, {}, fetchShim, noop, noop, noop);

    // ══ (A) UNIT — withSubmitGuard ══
    const mkBtn = () => ({ disabled: false, innerHTML: 'Save', textContent: 'Save', dataset: {} });

    // re-entry while in flight
    {
      const btn = mkBtn(); let calls = 0; let release; const gate = new Promise(r => release = r);
      const p1 = withSubmitGuard(btn, async () => { calls++; await gate; return 'first'; });
      const p2 = withSubmitGuard(btn, async () => { calls++; return 'second'; });
      A('unit: btn disabled during flight', btn.disabled === true);
      const r2 = await p2;
      A('unit: re-entrant call refused (returns undefined)', r2 === undefined);
      A('unit: second fn NEVER ran (calls still 1)', calls === 1, `calls=${calls}`);
      release(); const r1 = await p1;
      A('unit: first call returns its value', r1 === 'first', `got ${r1}`);
      A('unit: btn re-enabled after completion', btn.disabled === false);
      A('unit: in-flight flag cleared after', btn.dataset.ffSubmitting === '');
    }
    // throws → still re-enabled (finally)
    {
      const btn = mkBtn(); let threw = false;
      try { await withSubmitGuard(btn, async () => { throw new Error('boom'); }); } catch (_) { threw = true; }
      A('unit: error propagates', threw === true);
      A('unit: btn re-enabled after THROW (finally)', btn.disabled === false);
      A('unit: flag cleared after throw', btn.dataset.ffSubmitting === '');
    }
    // label restore
    {
      const btn = mkBtn(); btn.innerHTML = '<b>Save</b>'; let during;
      await withSubmitGuard(btn, async () => { during = btn.textContent; }, { label: 'Saving…' });
      A('unit: label set during flight', during === 'Saving…', `during=${during}`);
      A('unit: innerHTML restored after', btn.innerHTML === '<b>Save</b>', `got ${btn.innerHTML}`);
    }
    // null button tolerated
    A('unit: null btn — fn still runs & returns', (await withSubmitGuard(null, async () => 42)) === 42);

    // ══ (B) INTEGRATION — addFXRate double-fire against real Postgres ══
    postCount = 0;
    const btn = document.getElementById('b');
    const a = addFXRate(btn); const b = addFXRate(btn);   // rapid double-click
    await Promise.allSettled([a, b]);
    A('integration: exactly ONE POST reached /api/fx-rates (2nd click blocked)', postCount === 1, `postCount=${postCount}`);
    A('integration: btn re-enabled after submit', btn.disabled === false);
    const { rows } = await c.query(`SELECT COUNT(*)::int n FROM fx_rates`);
    A('integration: server holds 1 fx_rates row (server dedup backstop intact)', rows[0].n === 1, `rows=${rows[0].n}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed`);
    const blocked = global.__FF_HARNESS_BLOCKED_REQUESTS__ || [];
    if (blocked.length) console.log('  blocked outbound: ' + blocked.map(x => x.target).join(', '));
    console.log('');
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
