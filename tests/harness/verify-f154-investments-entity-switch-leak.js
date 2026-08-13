'use strict';
/**
 * verify-f154-investments-entity-switch-leak.js
 *
 * PROVES (Rules 3/4/6/13/14) two distinct defects on the BUSINESS investments surfaces, by
 * EXECUTION against a real scratch Postgres + the real /api/holdings endpoint + the real,
 * source-extracted client render functions — never a stub, never a re-implementation.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f154-investments-entity-switch-leak.js
 *
 * F154  ENTITY-SWITCH LEAK (F150/F151 isolation class, un-enumerated for holdings — Rule 13).
 *       loadEntityData() reloads invoices/expenses/customers/inventory/payroll for the switched
 *       entity but NEVER window.bizHoldings. The dashboard Investments card
 *       (finflow-api-wiring-dashboard.js:182) and renderBizInvestments() both read
 *       window.bizHoldings, so after a switch they keep the PREVIOUS entity's portfolio. Root of
 *       the leak: loadBizHoldingsFromDB() ignores the switched entity and fetches ?scope=business
 *       with NO entity_id, so the server resolves it against the ACTIVE entity (server.js:744-751).
 *
 * F155  CROSS-WIRE COST BASIS. #biz-perf-port / #biz-perf-summary (page-biz-investments) are
 *       written ONLY by the PERSONAL renderInvestments() from the personal holdings array
 *       (app-main.js:4407-4420); renderBizInvestments() never writes them. So the business page
 *       shows the personal cost basis — identical on every entity, matching no business entity.
 *
 * SEED — DISCRIMINATING (Rule 4), three distinct cost bases + empty switch target:
 *   PERSONAL (NULL) : ACME 100u @800/880  -> value 88,000 cost 80,000
 *   E1 (active)     : TESTCO 50u @100/120 + TCOIN 10u @100/100 -> value 7,000 cost 6,000
 *   E2 (target)     : (empty) -> 0
 *
 * OWNER-EXPECTED (hand-computed, independent of code under test — Rule 6):
 *   switch->E2 => every business surface $0 / "No holdings"; Performance box reads BUSINESS
 *   cost basis ($6,000 for E1), never personal $80,000.
 *
 * FAIL-THEN-PASS: unfixed source => leak + cross-wire assertions FAIL; fixed => GREEN.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'owner-f154@finflow.test', password: 'harness-password-not-a-secret' };
const EXPECT = { e1Value: 7000, e1Cost: 6000, e2Value: 0, personalCost: 80000 };
const num = s => parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')) || 0;

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };
  const AS = (name, ok, detail) => A('[STRUCTURAL] ' + name, ok, detail);

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'F154 Owner', plan: 'business', role: 'owner',
         password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    const mkEnt = async (name, active) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [uid, { name, currency: 'USD', is_active: active ? 1 : 0, sort_order: 0 }]
    )).rows[0].id;
    const E1 = await mkEnt('Saige (E1)', true);
    const E2 = await mkEnt('Acme (E2)', false);

    const mkHold = (eid, t, name, shares, cost, price) => c.query(
      `INSERT INTO holdings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, eid, { ticker: t, name, asset_type: 'Stock', shares, cost_per: cost, price, dividend: 0, color: '#c9a84c' }]);
    await mkHold(null, 'ACME', 'Acme Personal', 100, 800, 880);
    await mkHold(E1, 'TESTCO', 'Test Co', 50, 100, 120);
    await mkHold(E1, 'TCOIN', 'Test Coin', 10, 100, 100);

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const rE1 = await http.get(`/api/holdings?scope=business&entity_id=${E1}`);
    const rE2 = await http.get(`/api/holdings?scope=business&entity_id=${E2}`);
    const rActive = await http.get(`/api/holdings?scope=business`);
    A('server: E1 business holdings = 2 rows', Array.isArray(rE1.json) && rE1.json.length === 2, `got ${JSON.stringify(rE1.json).slice(0,120)}`);
    A('server: E2 business holdings = 0 rows (empty)', Array.isArray(rE2.json) && rE2.json.length === 0, `got ${JSON.stringify(rE2.json).slice(0,120)}`);
    A('server: no-entity_id resolves to ACTIVE entity E1 (2 rows) — the switch-away trap',
      Array.isArray(rActive.json) && rActive.json.length === 2, `got ${rActive.json && rActive.json.length}`);

    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    const startR = html.indexOf('function renderBizInvestments()');
    const endMark = html.indexOf('}', html.indexOf("console.warn('[BizHoldings]'"));
    const end = html.indexOf('}', endMark + 1) + 1;
    A('extracted renderBizInvestments + loadBizHoldingsFromDB from index.html', startR >= 0 && end > startR,
      `startR=${startR} end=${end}`);
    const clientSrc = html.slice(startR, end);

    const dom = new JSDOM(`
      <div id="biz-inv-holdings-list"></div>
      <div id="biz-inv-total">$0</div><div id="biz-inv-total-chg"></div>
      <div id="biz-inv-gain">$0</div><div id="biz-inv-gain-chg"></div>
      <div id="biz-inv-daychg">$0</div><div id="biz-inv-daychg-chg"></div>
      <div id="biz-inv-income">$0/yr</div>
      <div id="biz-perf-port">-</div>
      <div id="biz-perf-summary">No holdings yet - add positions to see performance.</div>
    `);
    const document = dom.window.document;
    const win = { bizHoldings: [], _fmtMoney: (n, sym) => (sym || '$') + Math.round(n).toLocaleString(),
                  _refreshDashboardUI: () => {} };
    const esc = s => String(s == null ? '' : s);
    const fetchShim = async (url) => {
      const r = await http.get(url.replace(/^https?:\/\/[^/]+/, ''));
      return { ok: r.status === 200, status: r.status, json: async () => r.json };
    };

    const api = new Function('document', 'window', 'fetch', 'esc',
      clientSrc + '\n; return { renderBizInvestments, loadBizHoldingsFromDB };'
    )(document, win, fetchShim, esc);

    const dashCardValue = () => (win.bizHoldings || []).reduce(
      (s, h) => s + (parseFloat(h.shares) || 0) * (parseFloat(h.price) || parseFloat(h.cost) || 0), 0);

    // STEP 1 — view E1 (active)
    await api.loadBizHoldingsFromDB(E1);
    A('E1 view: business Portfolio Value === $7,000', num(document.getElementById('biz-inv-total').textContent) === EXPECT.e1Value,
      `got ${document.getElementById('biz-inv-total').textContent}`);
    A('E1 view: dashboard card (same bizHoldings) === $7,000', dashCardValue() === EXPECT.e1Value, `got ${dashCardValue()}`);

    // STEP 2 — SWITCH to E2 (empty). loadBizHoldingsFromDB(E2): unfixed ignores arg -> active E1 (leak); fixed -> E2 empty
    await api.loadBizHoldingsFromDB(E2);
    const afterSwitchTotal = num(document.getElementById('biz-inv-total').textContent);
    const afterSwitchCard = dashCardValue();
    A('F154 switch->E2: business Portfolio Value === $0 (NOT E1 $7,000 leaked)',
      afterSwitchTotal === EXPECT.e2Value, `got ${document.getElementById('biz-inv-total').textContent} — E1 leaked into empty E2`);
    A('F154 switch->E2: dashboard Investments card === $0 (NOT E1 leaked)',
      afterSwitchCard === EXPECT.e2Value, `got ${afterSwitchCard} — E1 leaked onto the dashboard card`);
    A('F154 switch->E2: bizHoldings array empty (len 0)', (win.bizHoldings || []).length === 0,
      `got len ${(win.bizHoldings || []).length}`);

    // STEP 3 — F155 cross-wire
    await api.loadBizHoldingsFromDB(E1);
    const perf = document.getElementById('biz-perf-summary').textContent;
    // Extract the cost-basis figure specifically ("... on $6,000 cost basis.") — the sentence also
    // contains the gain, so a blanket digit-strip would concatenate the two numbers.
    const cbM = perf.match(/on\s*\$?([\d,]+)\s*cost basis/i);
    const costBasis = cbM ? parseFloat(cbM[1].replace(/,/g, '')) : NaN;
    A('F155: business Performance box shows BUSINESS cost basis $6,000',
      costBasis === EXPECT.e1Cost, `#biz-perf-summary="${perf}" (parsed cost basis ${costBasis})`);
    A('F155: business Performance box does NOT show personal $80,000 cost basis',
      costBasis !== EXPECT.personalCost, `#biz-perf-summary="${perf}" (parsed cost basis ${costBasis})`);

    // STRUCTURAL (Rule 5)
    const appMain = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8');
    const led = appMain.slice(appMain.indexOf('async function loadEntityData'), appMain.indexOf('window.loadEntityData = loadEntityData'));
    AS('loadEntityData reloads holdings for the switched entity (_loadBizHoldingsFromDB(_eid))',
      /_loadBizHoldingsFromDB\s*\(\s*_eid/.test(led), 'no _loadBizHoldingsFromDB(_eid) call found in loadEntityData');
    const ri = appMain.slice(appMain.indexOf('function renderInvestments()'), appMain.indexOf('function renderPersSpendDonut'));
    AS('personal renderInvestments no longer writes business #biz-perf-* elements',
      !/getElementById\(['\"]biz-perf-(port|summary)/.test(ri), 'renderInvestments still WRITES biz-perf-* via getElementById (the cross-wire)');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed`);
    const blocked = global.__FF_HARNESS_BLOCKED_REQUESTS__ || [];
    if (blocked.length) console.log('  blocked outbound requests: ' + blocked.map(b => b.target).join(', '));
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
