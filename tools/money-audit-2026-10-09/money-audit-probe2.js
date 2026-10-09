'use strict';
/**
 * money-audit-probe.js — READ-ONLY AUDIT INSTRUMENT (scratch database only, never production).
 * Seeds real rows through the real routes on a throwaway embedded Postgres, then MEASURES each
 * candidate defect from the 2026-10-09 money audit against a hand-computed expected value.
 * Each check prints: MEASURED, EXPECTED (correct books), and the value the suspected bug produces.
 * It asserts nothing about production data and writes nothing outside its own scratch cluster.
 * money-audit-probe2.js runs on the REAL clock (no clock.js) so JS today == Postgres NOW().
 * CON1 drops chk_sales_receipts_entity_nn IN THE SCRATCH DB ONLY to reproduce the pre-F150 legacy data shape (F26-b).
 *   node tools/money-audit-2026-10-09/money-audit-probe2.js
 */
// REAL CLOCK (no clock.js): JS today == Postgres NOW(), so stock movements (moved_at = NOW()) are not 'future'.
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('../../tests/harness/pgScratch.js');
const { bootServer } = require('../../tests/harness/boot.js');
const { HarnessHttp } = require('../../tests/harness/httpClient.js');

const PW = 'audit-probe-pw-not-a-secret';
const out = [];
const R = (id, measured, expected, buggy, note) => {
  const m = JSON.stringify(measured), e = JSON.stringify(expected), b = JSON.stringify(buggy);
  const verdict = m === e ? 'CORRECT' : (m === b ? 'DEFECT CONFIRMED (matches predicted bug value)' : 'DIFFERS FROM BOTH');
  out.push({ id, verdict, measured, expected, buggy, note });
  console.log(`\n[${id}] ${verdict}\n   measured: ${m}\n   expected: ${e}\n   bug-pred: ${b}${note ? '\n   note:     ' + note : ''}`);
};
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server; let n = 0;
  const newOwner = async (tag, ents = [{ name: tag + ' Co', currency: 'USD' }]) => {
    n++;
    const email = `probe-${tag.toLowerCase()}@finflow.test`;
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: tag, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.' + (20 + n) });
    if ((await http.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + tag);
    const J = async (method, p, b) => { const r = await http.request(method, p, b); if (r.status >= 300) throw new Error(method + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
    const ids = [];
    for (const e of ents) ids.push((await J('POST', '/api/entities', Object.assign({ timezone: 'UTC', country: 'US' }, e))).id);
    await J('POST', '/api/entities/' + ids[0] + '/activate', {});
    return { uid, http, J, ids };
  };
  try {
    server = await bootServer(scratch.url);

    // ── C11 (real clock): inventory purchase cash vs cash-flow report ────────────────────────────
    {
      const { J } = await newOwner('C11');
      const item = await J('POST', '/api/inventory', { sku: 'W1', name: 'Widget', units: 0, max_units: 100, cost: 5 });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 5, idempotency_key: 'c11-buy' });
      const bs = await J('POST', '/api/reports/balance-sheet', {});
      const cf = await J('POST', '/api/reports/cash-flow', {});
      R('C11 stock-in 10 @ 5 = 50 cash out', { bsSource: bs.source, bsCash: bs.cash, bsInventory: bs.inventory, cashFlowNet: r2(cf.totalInflow - cf.totalOutflow) },
        { bsSource: 'gl', bsCash: -50, bsInventory: 50, cashFlowNet: -50 }, { bsSource: 'gl', bsCash: -50, bsInventory: 50, cashFlowNet: 0 },
        'balance-sheet cash falls by 50 but the cash-flow report shows no outflow');
    }
    // ── C5 (real clock): inventory adjustment (write-off) ────────────────────────────────────────
    {
      const { J } = await newOwner('C5');
      const item = await J('POST', '/api/inventory', { sku: 'G1', name: 'Gadget', units: 0, max_units: 100, cost: 10 });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 10, idempotency_key: 'c5-buy' });
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'adjustment', quantity: 4, idempotency_key: 'c5-adj' });
      const inv = (await J('GET', '/api/inventory')).find(i => i.id === item.id);
      const bs = await J('POST', '/api/reports/balance-sheet', {});
      const rep = await J('GET', '/api/reports');
      // then sell the 6 that physically remain
      await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 6, idempotency_key: 'c5-sale' });
      const cogs = await J('GET', '/api/cogs');
      const bs2 = await J('POST', '/api/reports/balance-sheet', {});
      R('C5 write off 4 of 10 units @ 10, then sell the remaining 6', { unitsOnHand: Number(inv.units), bsInventoryAfterWriteOff: bs.inventory, lossExpensed: r2(rep.expenses + rep.cogs), cogsOfSale: cogs.totalCOGS, bsInventoryAfterSale: bs2.inventory },
        { unitsOnHand: 6, bsInventoryAfterWriteOff: 60, lossExpensed: 40, cogsOfSale: 60, bsInventoryAfterSale: 0 },
        { unitsOnHand: 6, bsInventoryAfterWriteOff: 100, lossExpensed: 0, cogsOfSale: 60, bsInventoryAfterSale: 40 },
        'after every unit is gone the ledger still carries 40 of inventory that does not exist');
    }
    // ── CON1: legacy NULL-entity row across two entities (scratch: constraint dropped to reproduce the PRE-F150 data shape) ──
    {
      const { J, uid, ids } = await newOwner('CON1', [{ name: 'X Co', currency: 'USD' }, { name: 'Y Co', currency: 'USD' }]);
      await c.query(`ALTER TABLE sales_receipts DROP CONSTRAINT IF EXISTS chk_sales_receipts_entity_nn`);
      const today = new Date().toISOString().slice(0, 10);
      await c.query(`INSERT INTO sales_receipts (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { customer: 'Legacy', amount: 120, date: today.slice(0, 8) + '01', num: 'SR-L' }]);
      const a = await J('GET', '/api/reports?entity_id=' + ids[0]);
      const b = await J('GET', '/api/reports?entity_id=' + ids[1]);
      R('CON1 one legacy NULL-entity receipt of 120 (pre-F150 shape, F26-b)', { entityX: a.revenue, entityY: b.revenue, entitiesPagePlainSum: r2(a.revenue + b.revenue) },
        { entityX: 120, entityY: 120, entitiesPagePlainSum: 120 }, { entityX: 120, entityY: 120, entitiesPagePlainSum: 240 },
        'each entity view is null-inclusive by design; the Entities-page Consolidated card plain-sums them (index.html getConsolTotal)');
    }
    // ── CSV1b: two overdue definitions for a "paid"-status invoice with a balance ────────────────
    {
      const { J } = await newOwner('CSV1b');
      const csvInv = 'Customer,Amount,Status,Invoice Date,Due Date,Invoice Number\nOldCo,500,Paid,2026-05-01,2026-05-31,INV-OLD-1\n';
      await J('POST', '/api/import/csv', { type: 'invoices', content: csvInv, mapping: { date_order: 'mdy' } });
      const rep = await J('GET', '/api/reports');
      const ar = await J('GET', '/api/reports/ar-by-customer');
      R('CSV1b imported "Paid" invoice: overdue on two server surfaces', { reportsOutstanding: rep.outstanding, reportsOverdue: rep.overdue, arReportOverdue: ar.overdueTotal },
        { reportsOutstanding: 0, reportsOverdue: 0, arReportOverdue: 0 }, { reportsOutstanding: 500, reportsOverdue: 0, arReportOverdue: 500 },
        '/api/reports overdue filters by status (paid excluded); computeBooks.arSummary is arithmetic — two overdue definitions disagree on the same row');
    }
  } catch (e) {
    console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  console.log('\n==== SUMMARY ====');
  for (const o of out) console.log(o.verdict.padEnd(48) + ' ' + o.id);
})();
