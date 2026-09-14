'use strict';
/**
 * verify-fx-consolidation.js — the REAL FX base-currency consolidation in computeBooks. The
 * consolidated (entityId=null) aggregate must convert EVERY leg from its own entity's currency to the
 * account base currency — not raw-sum unlike currencies. Single-currency accounts are byte-identical.
 * Tests computeBooks(null) directly (the middleware never yields null for a multi-entity account; the
 * consolidated aggregate is a server function reached by the accountant "all" view / server callers).
 *
 *   revenue (invoices) · expenses (sumFX) · COGS (_fxAccrual per item) all convert per entity.
 *   RED-proven: converted totals asserted to differ from the raw native sum.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fx-consolidation.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;

let _seq = 0;
async function mkOwner(c, baseCur) {
  const data = { email: 'fx' + (++_seq) + '@finflow.test', role: 'owner', password: bcrypt.hashSync(PW, 10) };
  if (baseCur) data.base_currency = baseCur;
  return (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL,NULL,$1) RETURNING id', [data])).rows[0].id;
}
const PW = 'x';
const mkEntity = async (c, uid, name, cur) => (await c.query('INSERT INTO entities (user_id, entity_id, data) VALUES ($1,NULL,$2) RETURNING id', [uid, { name, currency: cur }])).rows[0].id;
const mkInvoice = (c, uid, eid, amount) => c.query('INSERT INTO invoices (user_id, entity_id, data) VALUES ($1,$2,$3)', [uid, eid, { amount, status: 'paid', issue_date: '2026-06-01' }]);
const mkExpense = (c, uid, eid, amount) => c.query('INSERT INTO expenses (user_id, entity_id, data) VALUES ($1,$2,$3)', [uid, eid, { amount, date: '2026-06-01', category: 'Office' }]);
async function mkSaleCOGS(c, uid, eid, invId, qty, unitCost, saleQty) {
  await c.query("INSERT INTO inventory_movements (user_id, entity_id, inventory_id, type, quantity, unit_cost, moved_at) VALUES ($1,$2,$3,'purchase',$4,$5,'2026-05-01')", [uid, eid, invId, qty, unitCost]);
  await c.query("INSERT INTO inventory_movements (user_id, entity_id, inventory_id, type, quantity, unit_cost, moved_at) VALUES ($1,$2,$3,'sale',$4,0,'2026-06-01')", [uid, eid, invId, saleQty]);
}
const mkRate = (c, uid, from, to, rate) => c.query('INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date) VALUES ($1,NULL,$2,$3,$4,$5)', [uid, from, to, rate, '2026-01-01']);

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks } = require('../../server.js');   // same module instance bootServer wired to scratch

    console.log('\n' + '='.repeat(78));
    console.log('  FX CONSOLIDATION — computeBooks(null) converts every leg to base currency');
    console.log('='.repeat(78) + '\n');

    // Multi-currency: US (USD, base) + TT (TTD). rate TTD→USD = 0.15
    const mc = await mkOwner(c, 'USD');
    const US = await mkEntity(c, mc, 'US Co', 'USD');
    const TT = await mkEntity(c, mc, 'TT Co', 'TTD');
    await mkRate(c, mc, 'TTD', 'USD', 0.15);
    await mkInvoice(c, mc, US, 100);   // USD 100
    await mkInvoice(c, mc, TT, 100);   // TTD 100 → 15 USD
    await mkExpense(c, mc, US, 20);    // USD 20
    await mkExpense(c, mc, TT, 40);    // TTD 40 → 6 USD
    await mkSaleCOGS(c, mc, TT, 5001, 10, 5, 2);  // TT COGS 10 TTD → 1.5 USD

    console.log('-- consolidated (base USD): converted, NOT raw-summed --');
    const cons = await computeBooks(mc, null, 'year', null);
    A('revenue = 115 (100 + 15), NOT 200 (raw sum)', near(cons.revenue, 115) && !near(cons.revenue, 200), 'revenue=' + cons.revenue);
    A('opex = 26 (20 + 6), NOT 60 (raw sum)', near(cons.opex, 26) && !near(cons.opex, 60), 'opex=' + cons.opex);
    A('cogs = 1.5 (from 10 TTD), NOT 10 (raw)', near(cons.cogs, 1.5) && !near(cons.cogs, 10), 'cogs=' + cons.cogs);
    A('netProfit = 87.5 (115 - 1.5 - 26)', near(cons.netProfit, 87.5), 'netProfit=' + cons.netProfit);
    A('fxCoverage complete', cons.fxCoverage && cons.fxCoverage.complete === true, JSON.stringify(cons.fxCoverage));

    console.log('\n-- single-entity native (unchanged) --');
    const us = await computeBooks(mc, US, 'year', null);
    const tt = await computeBooks(mc, TT, 'year', null);
    A('US native revenue = 100', near(us.revenue, 100), 'revenue=' + us.revenue);
    A('TT native revenue = 100 (TTD, unconverted)', near(tt.revenue, 100), 'revenue=' + tt.revenue);
    A('TT native COGS = 10 (TTD, unconverted)', near(tt.cogs, 10), 'cogs=' + tt.cogs);

    console.log('\n-- missing rate → coverage incomplete, TTD legs excluded --');
    await c.query('DELETE FROM fx_rates WHERE user_id=$1', [mc]);
    const noRate = await computeBooks(mc, null, 'year', null);
    A('fxCoverage.complete === false', noRate.fxCoverage && noRate.fxCoverage.complete === false, JSON.stringify(noRate.fxCoverage));
    A('unconvertible TTD legs excluded → revenue = 100 (USD only)', near(noRate.revenue, 100), 'revenue=' + noRate.revenue);

    console.log('\n-- single-currency account: consolidated identity (byte-identical) --');
    const sc = await mkOwner(c, null);
    const A1 = await mkEntity(c, sc, 'US A', 'USD');
    const B1 = await mkEntity(c, sc, 'US B', 'USD');
    await mkInvoice(c, sc, A1, 100);
    await mkInvoice(c, sc, B1, 50);
    const scr = await computeBooks(sc, null, 'year', null);
    A('single-currency consolidated revenue = 150 (identity)', near(scr.revenue, 150), 'revenue=' + scr.revenue);
    A('single-currency fxCoverage complete', scr.fxCoverage && scr.fxCoverage.complete === true);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (FX base-currency consolidation)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
