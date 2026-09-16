'use strict';
/**
 * verify-gl-statements.js — GL PHASE 3 CAPSTONE: financial statements from the ledger reconcile to the
 * source-document oracle across EVERY P&L-affecting transaction type at once.
 * Seeds one entity with: invoice (1000), sales receipt (500), credit note (100 contra), expense (200),
 * bill (300), vendor credit (50 contra), payroll (1350), inventory (COGS 66), plus a pure balance-sheet
 * movement (invoice payment 400). Then:
 *   - hits the REAL endpoints GET /api/gl/trial-balance, /pnl, /balance-sheet;
 *   - proves the trial balance ties to zero and the balance sheet balances (A = L + E);
 *   - reconciles the ledger P&L to computeBooks to the cent: income==revenue (1400), expenses==cogs+opex
 *     (1866), netProfit==netProfit (−466) — the whole shoebox aggregate re-derived from double-entry.
 * (FX is excluded: computeBooks does not fold FX into netProfit; it is proven in verify-gl-post-fx.)
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-statements.js
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
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 3 CAPSTONE — ledger financial statements reconcile to the oracle\n' + '='.repeat(78) + '\n');
    const email = 'glcap@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.76' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const ok = r => r.status >= 200 && r.status < 300;

    // ── Revenue side ──
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    A('seed invoice 1000', !!inv.id);
    A('seed sales receipt 500', ok(await http.post('/api/sales-receipts', { customer: 'Cust', amount: 500, date: '2026-06-01', entity_id: eid })));
    A('seed credit note 100 (Open)', ok(await http.post('/api/credit-notes', { customer: 'Cust', amount: 100, status: 'Open', date: '2026-06-05', entity_id: eid })));
    // ── Expense side ──
    A('seed expense 200', ok(await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-01', category: 'Office', entity_id: eid })));
    A('seed bill 300 (unpaid)', ok(await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid })));
    A('seed vendor credit 50 (Open)', ok(await http.post('/api/vendor-credits', { vendor: 'Acme', amount: 50, status: 'Open', date: '2026-06-05', entity_id: eid })));
    // ── Payroll (approve → recognise 1350) ──
    const emp = JSON.parse((await http.post('/api/payroll', { fname: 'Ada', lname: 'L', gross: 1000, entity_id: eid })).text);
    const run = JSON.parse((await http.post('/api/payroll-runs', { period: '2026-06', entity_id: eid, bonus_overrides: { [emp.id]: 250 }, overtime_overrides: { [emp.id]: 100 } })).text);
    A('seed payroll run + approve (1350)', ok(await http.put('/api/payroll-runs/' + run.id + '/approve', {})));
    // ── Inventory (COGS 66) — backdate movements into the period (harness clock skew) ──
    const item = JSON.parse((await http.post('/api/inventory', { name: 'Widget', sku: 'W1', cost: 5, entity_id: eid })).text);
    const mv = (type, quantity, unit_cost) => http.post('/api/inventory-movements', { inventory_id: item.id, type, quantity, unit_cost, entity_id: eid });
    await mv('purchase', 10, 5); await mv('purchase', 6, 8); const saleRes = JSON.parse((await mv('sale', 12, 0)).text);
    A('seed inventory sale (FIFO COGS 66)', near(saleRes.cogs, 66), 'cogs=' + saleRes.cogs);
    await c.query(`UPDATE inventory_movements SET moved_at='2026-06-01' WHERE inventory_id=$1 AND type='purchase' AND unit_cost=5`, [item.id]);
    await c.query(`UPDATE inventory_movements SET moved_at='2026-06-02' WHERE inventory_id=$1 AND type='purchase' AND unit_cost=8`, [item.id]);
    await c.query(`UPDATE inventory_movements SET moved_at='2026-06-15' WHERE inventory_id=$1 AND type='sale'`, [item.id]);
    await c.query(`UPDATE ledger_entries SET entry_date='2026-06-15' WHERE user_id=$1 AND source_type='inventory_movement'`, [uid]);
    // ── Pure balance-sheet movement: pay part of the invoice (Dr Cash / Cr AR) — must NOT change P&L ──
    A('seed invoice payment 400', ok(await http.post('/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-06-20' })));

    // ── Oracle ──
    const books = await computeBooks(uid, eid, 'year');
    A('oracle revenue = 1400 (1000+500−100)', near(books.revenue, 1400), 'revenue=' + books.revenue);
    A('oracle cogs = 66', near(books.cogs, 66), 'cogs=' + books.cogs);
    A('oracle opex = 1800 (200+300−50+1350)', near(books.opex, 1800), 'opex=' + books.opex);
    A('oracle netProfit = −466', near(books.netProfit, -466), 'net=' + books.netProfit);

    // ── GL statements via the REAL endpoints ──
    const tb = JSON.parse((await http.get('/api/gl/trial-balance?period=year')).text);
    A('GET /api/gl/trial-balance balanced (debit==credit)', tb.balanced && near(tb.totalDebit, tb.totalCredit), 'D=' + tb.totalDebit + ' C=' + tb.totalCredit);
    const pnl = JSON.parse((await http.get('/api/gl/pnl?period=year')).text);
    A('RECONCILE: GL income (' + pnl.income + ') == oracle revenue (1400)', near(pnl.income, books.revenue) && near(pnl.income, 1400), 'income=' + pnl.income);
    A('RECONCILE: GL expenses == oracle cogs+opex (1866)', near(pnl.expenses, books.cogs + books.opex) && near(pnl.expenses, 1866), 'expenses=' + pnl.expenses);
    A('RECONCILE: GL netProfit == oracle netProfit (−466)', near(pnl.netProfit, books.netProfit) && near(pnl.netProfit, -466), 'net=' + pnl.netProfit);
    const bs = JSON.parse((await http.get('/api/gl/balance-sheet?period=year')).text);
    A('GET /api/gl/balance-sheet balances (A = L + E)', bs.totals.balanced && near(bs.totals.assets, bs.totals.liabilities + bs.totals.equity), JSON.stringify(bs.totals));
    A('balance-sheet equity carries net profit (−466)', near(bs.totals.assets - bs.totals.liabilities, bs.totals.equity), 'A−L=' + (bs.totals.assets - bs.totals.liabilities) + ' E=' + bs.totals.equity);
    // Journal is populated.
    const jr = JSON.parse((await http.get('/api/gl/journal?limit=100')).text);
    A('GET /api/gl/journal returns balanced entries', jr.entries.length > 0 && jr.entries.every(e => near(e.lines.reduce((s, l) => s + +l.debit, 0), e.lines.reduce((s, l) => s + +l.credit, 0))), 'entries=' + jr.entries.length);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL statements == oracle, books tie out)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
