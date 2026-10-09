'use strict';
/**
 * verify-cashflow-reconciles-bs-cash.js — L41 (live: Cash Flow net $1,740 vs balance-sheet Cash $25,740, opening 0 — a $24,000
 * gap). The ledger moves cash for legs the Cash Flow report never reads:
 *   · invoices / bills settled before the F133 / F135 payment-row fixes — `amount_paid` with no invoice_payments /
 *     payments_made row; the GL backfill books them (invoice_paidgap Dr 1000 / Cr 1100, bill_paidgap Dr 2000 / Cr 1000);
 *   · inventory purchases (Dr 1200 / Cr 1000);
 *   · (also FX settlements, 1000 ↔ 7000 — not seeded here: single-currency entity)
 * and the report has no D2 bound (a future-dated expense is counted as cash out). Fix: when the balance sheet itself is
 * served from the reconciled ledger, the Cash Flow report sums the ledger's CASH accounts (the same accounts as the
 * balance-sheet Cash line), netted per source document per month, up to the entity's today — so Σ net = balance-sheet cash
 * by construction.
 *
 * Seed (UTC entity, clock pinned 2026-07-25) through the real routes, plus two LEGACY rows reproduced by SQL (the state
 * the live data is in — Rule 4: without them the bug cannot show):
 *   invoice A 1,000 pending (06-01); invoice payment 400 (06-15)                       → cash in 400
 *   invoice B 3,000 pending (06-01), then LEGACY: amount_paid 3,000, status paid, no payment row → paidgap in 3,000
 *   invoice D 999 pending (06-01); payment 999 (06-16) then DELETED                    → nets to 0
 *   bill C 500 unpaid (06-02), then LEGACY: amount_paid 500, status paid, no payment row       → paidgap out 500
 *   inventory purchase 10 × 20 = 200 (moved 06-12)                                      → cash out 200
 *   expense 150 (06-20)                                                                 → cash out 150
 *   expense 77 dated 2026-08-10 (after today)                                           → excluded (D2)
 *   then POST /api/gl/backfill (as was run on live) so the legacy settlements reach the ledger.
 * HAND-COMPUTED: in 3,400 · out 850 · net 2,550 = balance-sheet Cash 2,550 (all in June; no August row).
 * BUGGY (pre-fix): in 400 · out 227 (150 + the future 77) · net 173 ≠ 2,550; an August row of 77.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-cashflow-reconciles-bs-cash.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L41 — the Cash Flow report reconciles to the balance-sheet cash\n' + '='.repeat(78) + '\n');
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: 'l41@finflow.test', name: 'L41', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.141' });
    if ((await http.post('/api/auth/login', { email: 'l41@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (p, b, m) => { const r = await (m === 'DELETE' ? http.del(p) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return r.text ? JSON.parse(r.text) : {}; };
    const ent = await J('/api/entities', { name: 'L41 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('/api/entities/' + ent.id + '/activate', {});
    const invA = await J('/api/invoices', { client: 'Alpha', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-07-01' });
    await J('/api/invoice-payments', { invoice_id: invA.id, amount: 400, payment_date: '2026-06-15', method: 'bank' });
    const invB = await J('/api/invoices', { client: 'Beta', amount: 3000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-07-01' });
    const invD = await J('/api/invoices', { client: 'Delta', amount: 999, status: 'pending', issue_date: '2026-06-01', due_date: '2026-07-01' });
    const payD = await J('/api/invoice-payments', { invoice_id: invD.id, amount: 999, payment_date: '2026-06-16', method: 'bank' });
    await J('/api/invoice-payments/' + payD.id, null, 'DELETE');
    const billC = await J('/api/bills', { vendor: 'Gamma Supplies', amount: 500, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-07-02' });
    const item = await J('/api/inventory', { name: 'Widget', sku: 'W41', cost: 20 });
    await J('/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 20 });
    await J('/api/expenses', { description: 'Courier', amount: 150, expense_date: '2026-06-20', category: 'Office', deductible: 'yes' });
    await J('/api/expenses', { description: 'Future rent', amount: 77, expense_date: '2026-08-10', category: 'Rent', deductible: 'yes' });
    // LEGACY rows (pre-F133 / F135): settled by amount_paid with NO payment row — the live data's shape.
    await c.query(`UPDATE invoices SET data = data || '{"amount_paid":3000,"status":"paid"}'::jsonb WHERE id = $1`, [invB.id]);
    await c.query(`UPDATE bills SET data = data || '{"amount_paid":500,"status":"paid"}'::jsonb WHERE id = $1`, [billC.id]);
    // the inventory movement is stamped with the real server clock; move it (and its ledger entry) into June
    await c.query(`UPDATE inventory_movements SET moved_at = '2026-06-12' WHERE inventory_id = $1`, [item.id]);
    await c.query(`UPDATE ledger_entries SET entry_date = '2026-06-12' WHERE source_type = 'inventory_movement'`);
    const bf = await http.post('/api/gl/backfill?entity_id=' + ent.id, {});
    A('premise: ledger backfill ran (as it was on live)', bf.status < 300, 'status=' + bf.status + ' ' + String(bf.text).slice(0, 160));

    const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
    A('premise: balance sheet served from the reconciled GL, Cash 2,550 (400 + 3,000 − 500 − 200 − 150)', bs.source === 'gl' && near(bs.cash, 2550),
      JSON.stringify({ source: bs.source, cash: bs.cash }));
    const cf = (await http.post('/api/reports/cash-flow', {})).json || {};
    const rows = cf.rows || [];
    const net = Math.round(((Number(cf.totalInflow) || 0) - (Number(cf.totalOutflow) || 0)) * 100) / 100;
    console.log('  [cash-flow] ' + JSON.stringify({ source: cf.source, in: cf.totalInflow, out: cf.totalOutflow, rows: rows.map(r => [r.key, r.inflow, r.outflow]) }));
    A('cash in 3,400 — incl. the legacy settlement 3,000 (bug: 400)', near(cf.totalInflow, 3400), 'totalInflow=' + cf.totalInflow);
    A('cash out 850 — incl. the legacy bill 500 and the inventory purchase 200; future expense excluded (bug: 227)', near(cf.totalOutflow, 850), 'totalOutflow=' + cf.totalOutflow);
    A('net cash flow = balance-sheet Cash 2,550 (bug: 173)', near(net, 2550) && near(net, bs.cash), 'net=' + net + ' bsCash=' + bs.cash);
    const jun = rows.find(r => r.key === '2026-06') || {};
    A('June row: in 3,400 · out 850', near(jun.inflow, 3400) && near(jun.outflow, 850), JSON.stringify(jun));
    A('no August row — a document dated after today is not cash yet (D2) (bug: Aug out 77)', !rows.some(r => r.key === '2026-08'), JSON.stringify(rows.map(r => r.key)));
    A('the response says where it came from (source: "ledger")', cf.source === 'ledger', 'source=' + cf.source);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (cash flow reconciles to balance-sheet cash)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
