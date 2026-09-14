'use strict';
/**
 * verify-fx-client-consolidation.js — the CLIENT consolidated total must equal the SERVER engine.
 *
 * This puts the client consolidation path ON the VERIFICATION list (it was off it — the reason the
 * 239-sweep was green while the dashboard total was wrong). It executes the REAL client getConsolTotal
 * (marker-sliced from index.html, the runtime copy; golden-master / step4 technique) and asserts it
 * matches the REAL server computeBooks(null) on a discriminating multi-currency seed (Rule 4: DB rate
 * far from the static client table so a divergence cannot hide).
 *
 * RED on the pre-fix code (getConsolTotal re-converts via static window.CURRENCIES rates → 114.71 ≠ 150).
 * GREEN after the fix (getConsolTotal returns the server consolidated from window._consolServer → 150).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fx-client-consolidation.js
 * Scratch Postgres only.
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

function sliceBalanced(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('marker not found: ' + header);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  while (i < src.length && /[;\s]/.test(src[i])) { if (src[i] === ';') { i++; break; } i++; }
  return src.slice(start, i);
}
function loadRealClient() {
  const appMain = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const curDef = sliceBalanced(appMain, 'const CURRENCIES = {');
  const consolDeclIdx = indexHtml.indexOf('let consolCurrency');
  const getConsolFn = sliceBalanced(indexHtml, 'function getConsolTotal');
  const clientBlock = indexHtml.slice(consolDeclIdx, indexHtml.indexOf(getConsolFn) + getConsolFn.length);
  const win = {};
  const wrapper = new Function('window', `
    var ENTITIES = [];
    ${curDef}
    window.CURRENCIES = CURRENCIES;
    ${clientBlock}
    return {
      getConsolTotal: getConsolTotal,
      setEntities: function(e){ ENTITIES = e; },
      setConsolCurrency: function(v){ consolCurrency = v; },
      setConsolServer: function(o){ window._consolServer = o; }
    };
  `);
  return wrapper(win);
}

let _seq = 0; const PW = 'x';
const mkOwner  = async (c, baseCur) => (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL,NULL,$1) RETURNING id',
  [{ email: 'fxc' + (++_seq) + '@finflow.test', role: 'owner', password: bcrypt.hashSync(PW, 10), ...(baseCur ? { base_currency: baseCur } : {}) }])).rows[0].id;
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
    console.log('  FX CLIENT CONSOLIDATION — client total must equal server computeBooks(null)');
    console.log('='.repeat(78) + '\n');

    const uid = await mkOwner(c, 'USD');
    const US = await mkEntity(c, uid, 'US Co', 'USD');
    const TT = await mkEntity(c, uid, 'TT Co', 'TTD');
    await mkRate(c, uid, 'TTD', 'USD', 0.50);           // 1 TTD = 0.50 USD (static client table has 6.80 ⇒ 0.147)
    await mkInvoice(c, uid, US, 100);
    await mkInvoice(c, uid, TT, 100);

    const srv = await computeBooks(uid, null, 'year', null);          // server consolidated (base USD)
    const usDisp = await computeBooks(uid, US, 'year', 'USD');        // per-entity in consolCurrency — what the loop fetches
    const ttDisp = await computeBooks(uid, TT, 'year', 'USD');
    A('server consolidated revenue = 150 (100 + 100 TTD@0.50)', near(srv.revenue, 150), 'got ' + srv.revenue);

    // Drive the REAL client exactly as the app does post-fix: e.data is per-entity ALREADY in the
    // consolidation currency (server per-leg conversion), and getConsolTotal PLAIN-SUMS across entities.
    cli.setConsolCurrency('USD');
    cli.setEntities([
      { currency: 'USD', data: { rev: usDisp.revenue, cogs: usDisp.cogs, grossProfit: usDisp.grossProfit, opex: usDisp.opex, netProfit: usDisp.netProfit } },
      { currency: 'TTD', data: { rev: ttDisp.revenue, cogs: ttDisp.cogs, grossProfit: ttDisp.grossProfit, opex: ttDisp.opex, netProfit: ttDisp.netProfit } },
    ]);

    const cliRev = cli.getConsolTotal('rev');
    const cliNet = cli.getConsolTotal('netProfit');
    console.log('  client getConsolTotal(rev) = ' + money(cliRev) + '   (server = ' + money(srv.revenue) + ')');
    console.log('  client getConsolTotal(netProfit) = ' + money(cliNet) + '   (server = ' + money(srv.netProfit) + ')\n');
    A('client consolidated revenue == server (sum of server-converted per-entity)', near(cliRev, srv.revenue), 'client=' + money(cliRev) + ' server=' + money(srv.revenue));
    A('client consolidated netProfit == server', near(cliNet, srv.netProfit), 'client=' + money(cliNet) + ' server=' + money(srv.netProfit));
    A('client is NOT a static-rate re-conversion (would be ~107.35)', !near(cliRev, 100 + 50 / 6.80), 'got ' + money(cliRev));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (FX client consolidation == server)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
