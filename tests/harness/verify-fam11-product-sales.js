'use strict';
/**
 * verify-fam11-product-sales — FA-M11 (owner decision 2026-11-01): the Inventory / COGS page shows what the STOCKED
 * PRODUCTS sold for, their cost and margin — per product and in total — not the business's whole revenue.
 * Real server + the real page, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam11-product-sales.js
 *
 * Seed (Rule 4): Widget 4 @ 10 (07-01), 6 @ 30 (07-02). Invoice 2 Widgets @ 50 issued 07-10 (sales 100, cost 2×10 = 20) ·
 * Stock Out sale 3 @ 40 on credit 07-12 (sales 120, cost 2×10 + 1×30 = 50) · a service invoice 999 (not a product) · a
 * DRAFT invoice 1 Widget @ 70 (not a sale) · a write-off of 1 on 07-15 (cost 30 — shrinkage, not a sale's cost).
 * Hand-computed: product sales 220 · cost of sales 70 · product gross profit 150 · margin 68.2%. Total COGS 100.
 * Old tile: the business's revenue 1,219 (100 + 120 + 999) and gross profit 1,119.
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('FA-M11 — product sales, cost and margin on the Inventory page', async ({ open, eq, A, J, http }) => {
  const w = await J('POST', '/api/inventory', { name: 'Widget', qty: 0, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 4, unit_cost: 10, date: '2026-07-01', idempotency_key: 'p1' });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 6, unit_cost: 30, date: '2026-07-02', idempotency_key: 'p2' });
  await J('POST', '/api/invoices', { client: 'Acme', status: 'pending', issue_date: '2026-07-10', idempotency_key: 'm11-a', line_items: [{ desc: 'Widget', qty: 2, rate: 50, inventory_id: w.id }] });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'sale', quantity: 3, date: '2026-07-12', idempotency_key: 'm11-s', sale: { price: 40, customer: 'Bo', paid: 'invoice' } });
  await J('POST', '/api/invoices', { client: 'Consult', amount: 999, status: 'pending', issue_date: '2026-07-11', idempotency_key: 'm11-svc' });
  await J('POST', '/api/invoices', { client: 'Later', status: 'draft', issue_date: '2026-07-13', idempotency_key: 'm11-d', line_items: [{ desc: 'Widget', qty: 1, rate: 70, inventory_id: w.id }] });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'adjustment', quantity: 1, date: '2026-07-15', idempotency_key: 'm11-wo' });
  const d = (await http.get('/api/cogs')).json || {};
  eq('product sales = 100 + 120 = 220 (not the service, not the draft)', d.productRevenue, 220, 1219);
  eq('cost of those sales = 20 + 50 = 70 (the write-off is not a sale\'s cost)', d.productCostOfSales, 70);
  eq('product gross profit 150, margin 68.2%', [d.productGrossProfit, d.productMarginPct], [150, 68.2]);
  eq('total COGS still includes the write-off (100)', d.totalCOGS, 100);
  const row = (d.breakdown || []).find(b => b.inventory_id === w.id) || {};
  eq('Widget row: 5 sold · sales 220 · cost 70 · margin 150', [row.units_sold, row.sales, row.cost_of_sales, row.margin], [5, 220, 70, 150]);
  const page = await open({ width: 1280, height: 900 });
  await new Promise(r => setTimeout(r, 3000));   // the boot's own loads (and its COGS load) settle first
  const ui = await page.evaluate(async () => { showPage('inventory'); while (window._cogsLoading) await new Promise(r => setTimeout(r, 100));
    await loadCOGS(); await new Promise(r => setTimeout(r, 2000));   // the tiles count up to their value
    const t = id => (document.getElementById(id) || {}).innerText || '';
    return { rev: t('cogs-revenue'), gp: t('cogs-gross-profit'), sub: t('cogs-gp-sub'), bd: t('cogs-breakdown').replace(/\s+/g, ' '),
      want: { s220: S(220), s150: S(150), s70: S(70), s30: S(30) } }; });   // the app's own money formatter (display currency)
  eq('page: Product sales = S(220)', ui.rev, ui.want.s220);
  eq('page: Product gross profit = S(150), Margin 68.2%', [ui.gp, ui.sub], [ui.want.s150, 'Margin 68.2%']);
  A('page: the Widget row — sold 220 · cost 70 · margin 150 (68.2%) · written off 30', ui.bd.includes('sold ' + ui.want.s220 + ' · cost ' + ui.want.s70 + ' · margin ' + ui.want.s150 + ' (68.2%) · written off ' + ui.want.s30), ui.bd);
}, {});
