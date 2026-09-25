'use strict';
/*
 * verify-gl-consolidation.js - GL consolidation & multi-currency (beyond NetSuite/Intacct).
 * glConsolidated reads the GL across all of an owner's entities (or one), converting each ledger line at
 * ITS OWN entry-date rate to base (matches computeBooks F24 => reconciles), and also produces the ASC 830
 * supplementary view (income at period AVG rate, balance sheet at CLOSING rate, CTA = residual).
 * Scenarios (separate users, isolated):
 *   1. single-currency consolidation (2 USD entities) -> source gl, sums correct, TB ties, CTA 0.
 *   2. multi-currency (USD + TTD, hand-computed) -> per-leg base = 1900 rev, BS balanced, ASC 830 CTA = 120.
 *   3. missing rate (USD + EUR, no EUR->USD) -> coverage incomplete -> falls back to computeBooks.
 *   4. single-entity DISPLAY currency (USD entity -> TTD) -> source gl, converted revenue.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-consolidation.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
let XFF = 90;
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks, glProfitLoss, glBalanceSheet, glConsolidated } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL CONSOLIDATION & MULTI-CURRENCY (beyond NetSuite/Intacct)\n' + '='.repeat(78) + '\n');
    const mkUser = async (email, base) => (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [Object.assign({ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }, base ? { base_currency: base } : {})])).rows[0].id;
    const mkEnt = async (uid, name, ccy) => (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name, currency: ccy }])).rows[0].id;
    const fx = (uid, from, to, rate, d) => c.query(`INSERT INTO fx_rates (user_id, from_currency, to_currency, rate, rate_date) VALUES ($1,$2,$3,$4,$5)`, [uid, from, to, rate, d]);
    const httpFor = async email => { const h = new HarnessHttp(server.baseUrl, { xff: '203.0.113.' + (XFF++) }); await h.post('/api/auth/login', { email, password: PW }); return h; };

    // ── 1) single-currency consolidation ──
    { const uid = await mkUser('con1@finflow.test'); const eA = await mkEnt(uid, 'A', 'USD'), eB = await mkEnt(uid, 'B', 'USD');
      const h = await httpFor('con1@finflow.test');
      await h.post('/api/invoices', { client: 'CA', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eA });
      await h.post('/api/invoices', { client: 'CB', amount: 500, status: 'pending', issue_date: '2026-06-01', entity_id: eB });
      await h.post('/api/expenses', { description: 'x', amount: 100, expense_date: '2026-06-01', category: 'Office', entity_id: eB });
      const pl = await glProfitLoss(uid, null, {});
      A('1) single-ccy consolidated -> source gl', pl.source === 'gl', JSON.stringify(pl));
      A('1) consolidated revenue 1500 / expenses 100 / net 1400', near(pl.totalRevenue, 1500) && near(pl.totalExpenses, 100) && near(pl.netProfit, 1400), JSON.stringify(pl));
      const bs = await glBalanceSheet(uid, null);
      A('1) consolidated BS source gl, AR 1500, CTA 0, balanced', bs.source === 'gl' && near(bs.accountsReceivable, 1500) && near(bs.cta, 0) && near(bs.totalAssets, bs.totalLiabilities + bs.equity), JSON.stringify({ src: bs.source, ar: bs.accountsReceivable, cta: bs.cta, ta: bs.totalAssets }));
    }

    // ── 2) multi-currency (USD base + TTD entity), hand-computed ──
    { const uid = await mkUser('con2@finflow.test', 'USD'); const eA = await mkEnt(uid, 'A', 'USD'), eB = await mkEnt(uid, 'B', 'TTD');
      await fx(uid, 'TTD', 'USD', 0.15, '2026-06-01');   // transaction-date rate
      await fx(uid, 'TTD', 'USD', 0.20, '2026-07-01');   // later -> becomes the closing rate (carry-forward to today)
      const h = await httpFor('con2@finflow.test');
      await h.post('/api/invoices', { client: 'CA', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eA });
      await h.post('/api/expenses', { description: 'xa', amount: 200, expense_date: '2026-06-01', category: 'Office', entity_id: eA });
      await h.post('/api/invoices', { client: 'CB', amount: 6000, status: 'pending', issue_date: '2026-06-01', entity_id: eB });
      await h.post('/api/expenses', { description: 'xb', amount: 1200, expense_date: '2026-06-01', category: 'Office', entity_id: eB });
      const books = await computeBooks(uid, null, 'year');
      A('2) oracle computeBooks consolidated revenue = 1900 (per-leg @0.15)', near(books.revenue, 1900), 'rev=' + books.revenue);
      const pl = await glProfitLoss(uid, null, {});
      A('2) multi-ccy consolidated -> source gl', pl.source === 'gl', JSON.stringify(pl));
      A('2) consolidated rev 1900 / exp 380 / net 1520', near(pl.totalRevenue, 1900) && near(pl.totalExpenses, 380) && near(pl.netProfit, 1520), JSON.stringify(pl));
      const bs = await glBalanceSheet(uid, null);
      A('2) BS source gl: cash -380, AR 1900, assets 1520, balanced', bs.source === 'gl' && near(bs.cash, -380) && near(bs.accountsReceivable, 1900) && near(bs.totalAssets, 1520) && near(bs.totalAssets, bs.totalLiabilities + bs.equity), JSON.stringify({ src: bs.source, cash: bs.cash, ar: bs.accountsReceivable, ta: bs.totalAssets, eq: bs.equity }));
      A('2) ASC 830 CTA = 120 (assets@closing 1760 - RE@avg 1640)', bs.asc830 && near(bs.asc830.cta, 120) && near(bs.asc830.assetsClosing, 1760) && near(bs.asc830.retainedEarningsAvg, 1640), JSON.stringify(bs.asc830));
      A('2) fx coverage complete', bs.fxCoverage && bs.fxCoverage.complete === true, JSON.stringify(bs.fxCoverage));
    }

    // ── 3) missing rate -> coverage incomplete -> fallback ──
    { const uid = await mkUser('con3@finflow.test', 'USD'); const eA = await mkEnt(uid, 'A', 'USD'), eC = await mkEnt(uid, 'C', 'EUR');
      const h = await httpFor('con3@finflow.test');
      await h.post('/api/invoices', { client: 'CA', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eA });
      await h.post('/api/invoices', { client: 'CC', amount: 500, status: 'pending', issue_date: '2026-06-01', entity_id: eC });
      const con = await glConsolidated(uid, { entityId: null });
      A('3) glConsolidated flags coverage incomplete (no EUR->USD rate)', con.fxCoverage.complete === false, JSON.stringify(con.fxCoverage));
      const pl = await glProfitLoss(uid, null, {});
      A('3) missing rate -> P&L falls back to computeBooks', pl.source === 'computeBooks', JSON.stringify({ source: pl.source }));
    }

    // ── 4) single-entity display currency ──
    { const uid = await mkUser('con4@finflow.test'); const eA = await mkEnt(uid, 'A', 'USD');
      await fx(uid, 'USD', 'TTD', 6, '2026-06-01');
      const h = await httpFor('con4@finflow.test');
      await h.post('/api/invoices', { client: 'CA', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eA });
      const booksT = await computeBooks(uid, eA, 'year', 'TTD');
      A('4) oracle computeBooks display TTD revenue = 6000', near(booksT.revenue, 6000), 'rev=' + booksT.revenue);
      const pl = await glProfitLoss(uid, eA, { display: 'TTD' });
      A('4) single-entity display TTD -> source gl, revenue 6000', pl.source === 'gl' && near(pl.totalRevenue, 6000), JSON.stringify(pl));
    }

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (consolidation + multi-currency + ASC 830 CTA)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
