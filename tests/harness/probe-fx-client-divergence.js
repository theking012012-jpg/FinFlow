'use strict';
/**
 * probe-fx-client-divergence.js  — READ-ONLY verification instrument (Rule 7).
 *
 * Purpose: settle whether the docs' claim "the client consolidated still RAW-SUMS native"
 * (HANDOVER_2026-09-14 + FX_CONSOLIDATION_DESIGN STATUS) matches the code, by EXECUTING
 * the REAL pieces on a discriminating multi-currency seed (Rule 4) rather than reasoning.
 *
 * It runs:
 *   - the REAL server engine  computeBooks(...)  (imported from server.js, wired to scratch PG)
 *     — the same function /api/reports and the dashboard use.
 *   - the REAL client functions  fxConvert / getConsolTotal  + the REAL static CURRENCIES table,
 *     marker-sliced from public/app-main.js + public/index.html (the golden-master / step4 technique;
 *     these are the runtime copies — index.html defines them inline and no wiring file overrides).
 *
 * Discriminating seed: US(USD) + TT(TTD). DB fx rate 1 TTD = 0.50 USD, deliberately FAR from the
 * static client table (TTD.rate = 6.80 ⇒ 1 TTD = 0.147 USD) so a divergence CANNOT hide.
 *
 * NOTHING is written to any real book. Scratch Postgres only. No commit, no fix — measurement only.
 *
 *   node -r ./tests/harness/clock.js tests/harness/probe-fx-client-divergence.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const money = v => (Math.round((+v) * 100) / 100);

// ── brace-balanced slice from `header` (the golden-master technique step4-client-gate uses) ──
function sliceBalanced(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('marker not found: ' + header);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // include a trailing ; or ] if present
  while (i < src.length && /[;\s]/.test(src[i])) { if (src[i] === ';') { i++; break; } i++; }
  return src.slice(start, i);
}

// Load the REAL client functions into an executable sandbox (no re-implementation).
function loadRealClient() {
  const appMain = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  const curDef = sliceBalanced(appMain, 'const CURRENCIES = {');       // app-main.js:61  (real static table)

  // index.html client block: consolCurrency + fxConvert + fmtConsol + getConsolTotal
  const consolDeclIdx = indexHtml.indexOf("let consolCurrency");
  const getConsolFn = sliceBalanced(indexHtml, 'function getConsolTotal');
  const getConsolEnd = indexHtml.indexOf(getConsolFn) + getConsolFn.length;
  const clientBlock = indexHtml.slice(consolDeclIdx, getConsolEnd);     // real consolCurrency + fxConvert + getConsolTotal

  const win = {};
  const wrapper = new Function('window', `
    var ENTITIES = [];
    ${curDef}
    window.CURRENCIES = CURRENCIES;
    ${clientBlock}
    return {
      getConsolTotal: getConsolTotal,
      fxConvert: fxConvert,
      staticTTD: CURRENCIES.TTD.rate,
      setEntities: function(e){ ENTITIES = e; },
      setConsolCurrency: function(v){ consolCurrency = v; }
    };
  `);
  return wrapper(win);
}

let _seq = 0;
const PW = 'x';
const mkOwner  = async (c, baseCur) => (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL,NULL,$1) RETURNING id',
  [{ email: 'p' + (++_seq) + '@finflow.test', role: 'owner', password: bcrypt.hashSync(PW, 10), ...(baseCur ? { base_currency: baseCur } : {}) }])).rows[0].id;
const mkEntity = async (c, uid, name, cur) => (await c.query('INSERT INTO entities (user_id, entity_id, data) VALUES ($1,NULL,$2) RETURNING id', [uid, { name, currency: cur }])).rows[0].id;
const mkInvoice = (c, uid, eid, amount) => c.query('INSERT INTO invoices (user_id, entity_id, data) VALUES ($1,$2,$3)', [uid, eid, { amount, status: 'paid', issue_date: '2026-06-01' }]);
const mkRate = (c, uid, from, to, rate) => c.query('INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date) VALUES ($1,NULL,$2,$3,$4,$5)', [uid, from, to, rate, '2026-01-01']);

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks } = require('../../server.js');
    const cli = loadRealClient();

    console.log('\n' + '='.repeat(78));
    console.log('  FX CLIENT DIVERGENCE PROBE — does the client consolidated match the server?');
    console.log('='.repeat(78) + '\n');
    console.log('  static client TTD.rate = ' + cli.staticTTD + '  (⇒ 1 TTD = ' + (1 / cli.staticTTD).toFixed(4) + ' USD, client)');
    console.log('  DB fx rate           = 0.50  (⇒ 1 TTD = 0.50 USD, server)\n');

    // Seed: US(USD) 100, TT(TTD) 100, DB rate 1 TTD = 0.50 USD.
    const uid = await mkOwner(c, 'USD');
    const US = await mkEntity(c, uid, 'US Co', 'USD');
    const TT = await mkEntity(c, uid, 'TT Co', 'TTD');
    await mkRate(c, uid, 'TTD', 'USD', 0.50);
    await mkInvoice(c, uid, US, 100);   // USD 100
    await mkInvoice(c, uid, TT, 100);   // TTD 100

    // ── SERVER truth (the proven per-leg conversion) ──
    const serverCons = await computeBooks(uid, null, 'year', null);       // computeBooks(null) = consolidated base
    console.log('-- SERVER computeBooks(null) consolidated (correct, per-leg @ DB rate) --');
    console.log('     revenue = ' + money(serverCons.revenue) + '   (100 USD + 100 TTD×0.50 = 150)\n');
    A('server consolidated revenue = 150', near(serverCons.revenue, 150), 'got ' + serverCons.revenue);

    // ── CLIENT path, DEFAULT (no display currency): per-entity native from the server, client sums ──
    // This is exactly what medium.js does: fetch /api/reports?entity_id=<id> (native) → e.data, then getConsolTotal.
    const usNative = await computeBooks(uid, US, 'year', null);           // = /api/reports?entity_id=US
    const ttNative = await computeBooks(uid, TT, 'year', null);           // = /api/reports?entity_id=TT
    cli.setConsolCurrency('USD');
    cli.setEntities([
      { currency: 'USD', data: { rev: usNative.revenue, cogs: usNative.cogs, grossProfit: usNative.grossProfit, opex: usNative.opex, netProfit: usNative.netProfit } },
      { currency: 'TTD', data: { rev: ttNative.revenue, cogs: ttNative.cogs, grossProfit: ttNative.grossProfit, opex: ttNative.opex, netProfit: ttNative.netProfit } },
    ]);
    const clientDefault = cli.getConsolTotal('rev');
    const expectClientDefault = 100 + 100 / cli.staticTTD;               // static-rate conversion, NOT the DB rate
    console.log('-- CLIENT getConsolTotal (default: entity-native figures, static-rate fxConvert) --');
    console.log('     revenue = ' + money(clientDefault) + '   (100 + 100/' + cli.staticTTD + ' = ' + money(expectClientDefault) + ')\n');
    A('client is NOT a raw native sum (would be 200)', !near(clientDefault, 200), 'got ' + clientDefault);
    A('client DID convert, via the STATIC table (≈114.71), not the DB rate', near(clientDefault, expectClientDefault), 'got ' + clientDefault);
    A('CLAIM UNDER TEST → client (≈114.71) DIVERGES from server (150)', !near(clientDefault, serverCons.revenue),
      'client=' + money(clientDefault) + ' server=' + money(serverCons.revenue) + '  gap=' + money(serverCons.revenue - clientDefault));

    // ── CLIENT path, DISPLAY CURRENCY SET (F34): per-entity figures come back ALREADY converted to USD ──
    // medium.js sends &display=<_displayCurrency>; server returns USD figures; client fxConverts AGAIN as if native.
    const ttDisplayUSD = await computeBooks(uid, TT, 'year', 'USD');      // = /api/reports?entity_id=TT&display=USD  → USD already
    const usDisplayUSD = await computeBooks(uid, US, 'year', 'USD');
    cli.setEntities([
      { currency: 'USD', data: { rev: usDisplayUSD.revenue } },
      { currency: 'TTD', data: { rev: ttDisplayUSD.revenue } },          // this is ALREADY 50 USD, but e.currency is still 'TTD'
    ]);
    const clientDisplay = cli.getConsolTotal('rev');
    const doubleConverted = 100 + (ttDisplayUSD.revenue) / cli.staticTTD; // 50 USD wrongly ÷ 6.80 again
    console.log('\n-- CLIENT getConsolTotal with _displayCurrency=USD (server already converted TT→' + money(ttDisplayUSD.revenue) + ' USD) --');
    console.log('     revenue = ' + money(clientDisplay) + '   (100 + ' + money(ttDisplayUSD.revenue) + '/' + cli.staticTTD + ' = ' + money(doubleConverted) + ')\n');
    A('server TT@display=USD = 50 (converted once, correctly)', near(ttDisplayUSD.revenue, 50), 'got ' + ttDisplayUSD.revenue);
    A('DOUBLE-CONVERSION → client re-divides the already-USD 50 by 6.80', near(clientDisplay, doubleConverted), 'got ' + clientDisplay);
    A('client-with-display (≈107.35) is WRONG vs correct 150', !near(clientDisplay, 150), 'got ' + money(clientDisplay));

    console.log('\n' + '-'.repeat(78));
    console.log('  VERDICT: the "raw-sums native" description is INACCURATE. The client converts —');
    console.log('  with a STATIC table (default) or DOUBLE-converts (display set) — and in both cases');
    console.log('  diverges from the server engine. Every assertion above is PASS = claim confirmed.');
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
