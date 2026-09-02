'use strict';
/**
 * verify-inv-updating-no-stale.js — Investments cards must NOT flash a stale STORED (entry-time)
 * price as the live portfolio value on a cold page load / refresh.
 *
 * The bug (owner-reported 2026-09-01): holdings load from the DB carrying a STORED price, and the
 * render painted Σ price×shares immediately → a wrong figure (e.g. $180K) shown under the "Updating…"
 * pill, replaced by the correct live figure (e.g. $1.1M) ~1s later when quotes land. On refresh the
 * wrong figure flashes again. Fix: while the app is booting (`window._invBootPending`, set by the
 * investments init() and cleared when the first refresh pass finishes) the value/gain/day cards show a
 * neutral "Fetching live prices…" loading state until a live quote is applied (`_bizInvLive`/`_invLive`).
 *
 * EXECUTED against a real scratch Postgres + real /api/holdings + the real, source-extracted business
 * render functions (renderBizInvestments/applyBizQuotes/loadBizHoldingsFromDB from index.html). The
 * personal side (renderInvestments in app-main.js) is checked STRUCTURALLY — it shares the exact gate.
 *
 * SEED (discriminating — stored value must differ hugely from live):
 *   E1 business: TESTCO 10u, cost 100, STORED price 100  → stored value $1,000
 *   live quote  : TESTCO @ 500                            → live   value $5,000
 *
 * FAIL-THEN-PASS: pre-fix render paints $1,000 during boot (no gate) → assertion A2 RED; fixed → '—'.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-inv-updating-no-stale.js
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'owner-invupd@finflow.test', password: 'harness-password-not-a-secret' };
const num = s => parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')) || 0;

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : ''))); };
  const AS = (name, ok, detail) => A('[STRUCTURAL] ' + name, ok, detail);
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'InvUpd Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    const E1 = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name: 'Biz (E1)', currency: 'USD', is_active: 1, sort_order: 0 }]
    )).rows[0].id;
    await c.query(
      `INSERT INTO holdings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E1, { ticker: 'TESTCO', name: 'Test Co', asset_type: 'Stock', shares: 10, cost_per: 100, price: 100, dividend: 0, color: '#c9a84c' }]);

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    // Extract the real business render functions (incl. _reseedLive + the window._reseedLive export).
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    // Anchor on renderBizInvestments (present pre- AND post-fix) so the PRE-FIX build reaches the
    // behavioural assertions (and fails there) instead of bailing at extraction. Pull in the real
    // _reseedLive only when this build has it (post-fix); pre-fix simply runs without it.
    const rbStart = html.indexOf('function renderBizInvestments()');
    const endMark = html.indexOf("console.warn('[BizHoldings]'");
    const end = html.indexOf('}', html.indexOf('}', endMark) + 1) + 1;
    A('extracted business render slice from index.html', rbStart >= 0 && end > rbStart, `rbStart=${rbStart} end=${end}`);
    let clientSrc = html.slice(rbStart, end);
    const rsStart = html.indexOf('function _reseedLive');
    if (rsStart >= 0 && rsStart < rbStart) {
      const asg = html.indexOf('window._reseedLive = _reseedLive;', rsStart);
      const rsEnd = asg >= 0 ? html.indexOf('\n', asg) + 1 : html.indexOf('\n', html.indexOf('}', rsStart)) + 1;
      clientSrc = html.slice(rsStart, rsEnd) + '\n' + clientSrc;
    }

    const dom = new JSDOM(`
      <div id="biz-inv-holdings-list"></div>
      <div id="biz-inv-total">$0</div><div id="biz-inv-total-chg"></div>
      <div id="biz-inv-gain">$0</div><div id="biz-inv-gain-chg"></div>
      <div id="biz-inv-daychg">$0</div><div id="biz-inv-daychg-chg"></div>
      <div id="biz-inv-income">$0/yr</div>
      <div id="biz-perf-port">-</div><div id="biz-perf-summary">x</div>
    `);
    const document = dom.window.document;
    const win = { bizHoldings: [], _fmtMoney: (n, sym) => (sym || '$') + Math.round(n).toLocaleString(),
                  _refreshDashboardUI: () => {}, _kickMarketRefresh: () => {} };
    const esc = s => String(s == null ? '' : s);
    const fetchShim = async (url) => { const r = await http.get(String(url).replace(/^https?:\/\/[^/]+/, '')); return { ok: r.status === 200, status: r.status, json: async () => r.json }; };
    const api = new Function('document', 'window', 'fetch', 'esc',
      clientSrc + '\n; return { renderBizInvestments, loadBizHoldingsFromDB, applyBizQuotes };'
    )(document, win, fetchShim, esc);

    const totalTxt = () => document.getElementById('biz-inv-total').textContent.trim();
    const chgTxt   = () => document.getElementById('biz-inv-total-chg').textContent.trim();

    // STEP A — COLD BOOT: pending flag set, no live quote yet. Must show loading, NOT the stored $1,000.
    win._invBootPending = true;
    await api.loadBizHoldingsFromDB(E1);
    A('A1: business holdings loaded (1 row, TESTCO)', (win.bizHoldings || []).length === 1 && win.bizHoldings[0].ticker === 'TESTCO', `got ${JSON.stringify(win.bizHoldings).slice(0,120)}`);
    A('A2: DURING boot the Portfolio Value shows loading "—", NOT the stale stored $1,000',
      totalTxt() === '—', `#biz-inv-total="${totalTxt()}" (stored value $1,000 must not paint pre-live)`);
    A('A3: the change label reads "Fetching live prices…" (not a % on stale data)',
      /Fetching live prices/i.test(chgTxt()), `#biz-inv-total-chg="${chgTxt()}"`);

    // STEP B — LIVE QUOTE LANDS: apply TESTCO @ 500 → value must become $5,000.
    api.applyBizQuotes({ TESTCO: { price: 500, dayChange: 0, resolved: 'TESTCO', dividend: 0 } });
    A('B1: after live quote the Portfolio Value shows the LIVE $5,000', num(totalTxt()) === 5000, `#biz-inv-total="${totalTxt()}"`);
    A('B2: _bizInvLive flag set true by applyBizQuotes', win._bizInvLive === true, `got ${win._bizInvLive}`);

    // STEP C — POST-BOOT reload (nav/switch): boot flag cleared; reseed from this session's last live
    // quote must keep the value LIVE ($5,000), never flash back to the stored $1,000.
    win._invBootPending = false;
    await api.loadBizHoldingsFromDB(E1);
    A('C1: post-boot reload keeps the LIVE $5,000 (reseed), no stale flash', num(totalTxt()) === 5000, `#biz-inv-total="${totalTxt()}"`);

    // STEP D — an all-cash / empty-ticker book has nothing to wait for → shows value even while booting.
    win._invBootPending = true; win._bizInvLive = false; win._lastLive = {};
    win.bizHoldings = [{ ticker: 'CASH', name: 'Cash', type: 'Cash', shares: 1, cost: 2500, price: 2500 }];
    api.renderBizInvestments();
    A('D1: all-cash book paints its value while booting (needsQuote=false)', num(totalTxt()) === 2500, `#biz-inv-total="${totalTxt()}"`);

    // STRUCTURAL — the personal renderInvestments (app-main.js) shares the identical gate.
    const appMain = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8');
    const ri = appMain.slice(appMain.indexOf('function renderInvestments()'), appMain.indexOf('function renderInvestments()') + 1600);
    AS('personal renderInvestments has the boot-pending loading gate', /invLoading\s*=\s*needsQuote\s*&&\s*window\._invBootPending\s*&&\s*!window\._invLive/.test(ri), 'gate expression not found');
    AS('personal renderInvestments renders the "—" loading branch (no stale figure)', /if\(invLoading\)\{[\s\S]*inv-total-val[\s\S]*'—'/.test(ri), 'loading branch not found');
    AS('personal applyPersonalQuotes sets _invLive on a live quote', /if\(updated\s*>\s*0\)\s*window\._invLive\s*=\s*true/.test(html), 'not found in index.html');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (investments: no stale flash while updating)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
