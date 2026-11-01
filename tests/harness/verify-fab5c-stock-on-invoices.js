'use strict';
/**
 * verify-fab5c-stock-on-invoices — FA-B5c (owner decision 2026-11-01): ONE product list. An invoice line can be a STOCKED
 * product; an ISSUED invoice takes the stock out at FIFO cost (Dr COGS / Cr Inventory on its issue date), a draft takes
 * nothing, and deleting the invoice / returning it to draft / editing its stocked lines puts the stock back or swaps it —
 * with every later sale of that product re-costed so the ledger keeps matching FIFO. Real server, scratch Postgres
 * (Rule 3), and the real invoice line editor in a browser.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab5c-stock-on-invoices.js
 *
 * Seed (Rule 4 — two layers at different costs, so the FIFO order and a stale ledger cost change the numbers):
 *   Widget: Stock In 4 @ 100 on 07-01, then 10 @ 200 on 07-02 (14 on hand).
 * Hand-computed (Rule 6):
 *   A issued 07-10, 6 Widgets → 4×100 + 2×200 = 800; stock 8.            (old code: inventory_id dropped — stock 14, cost 0)
 *   B draft 07-15, 3 Widgets → nothing; issued → 3×200 = 600; stock 5.
 *   A edited to 2 → stock 9; FIFO by date: A 2×100 = 200, B 2×100 + 1×200 = 400 → ledger COGS 600.  (no re-cost: 800)
 *   B back to draft → stock 12, ledger 200.   A deleted → stock 14, ledger 0.
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('FA-B5c — stocked products on invoices', async ({ open, A, eq, J, http, c, uid }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ent = (await J('GET', '/api/entities'))[0];
  const w = await J('POST', '/api/inventory', { name: 'Widget', qty: 0, cost: 100 });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 4, unit_cost: 100, date: '2026-07-01', idempotency_key: 'p1' });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 10, unit_cost: 200, date: '2026-07-02', idempotency_key: 'p2' });
  const units = async () => Number((await c.query(`SELECT data->>'units' AS u FROM inventory WHERE id = $1`, [w.id])).rows[0].u);
  const cogsGL = async () => Number((await c.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS s FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id WHERE l.user_id = $1 AND a.code = '5000'`, [uid])).rows[0].s);
  const cogsOf = async (invId) => Number((await c.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS s FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id JOIN ledger_entries e ON e.id = l.entry_id
      JOIN inventory_movements m ON e.source_type = 'inventory_movement' AND e.source_id = m.id
      WHERE l.user_id = $1 AND a.code = '5000' AND m.idempotency_key LIKE $2`, [uid, 'invoice-stock:' + invId + ':%'])).rows[0].s);
  const cogsPage = async () => { const r = (await http.get('/api/cogs')).json || {}; return Math.round(Number(r.totalCOGS) * 100) / 100; };
  eq('premise: 14 Widgets on hand', await units(), 14);

  // ── A: issued, 6 Widgets + a service line ────────────────────────────────────────────────────────────────────
  const invA = await J('POST', '/api/invoices', { client: 'Acme', status: 'pending', issue_date: '2026-07-10', idempotency_key: 'fa-a',
    line_items: [{ desc: 'Widget', qty: 6, rate: 300, inventory_id: w.id }, { desc: 'Setup', qty: 1, rate: 50 }] });
  eq('A: the line keeps its stocked product', (invA.line_items || []).map(l => l.inventory_id || null), [w.id, null], [null, null]);
  eq('A issued → 6 out: 8 on hand', await units(), 8, 14);
  eq('A\'s cost of goods = 4×100 + 2×200 = 800 (FIFO, oldest first)', await cogsOf(invA.id), 800, 0);
  eq('A\'s stock leaves on its issue date', (await c.query(`SELECT movement_date::text d FROM inventory_movements WHERE idempotency_key LIKE $1`, ['invoice-stock:' + invA.id + ':%'])).rows.map(r => r.d), ['2026-07-10']);

  // ── B: draft takes nothing; issuing it takes 3 ──────────────────────────────────────────────────────────────
  const invB = await J('POST', '/api/invoices', { client: 'Bolt', status: 'draft', issue_date: '2026-07-15', idempotency_key: 'fa-b', line_items: [{ desc: 'Widget', qty: 3, rate: 300, inventory_id: w.id }] });
  eq('B draft: nothing leaves (8)', await units(), 8);
  await J('PUT', '/api/invoices/' + invB.id, { status: 'pending' });
  eq('B issued → 5 on hand', await units(), 5, 8);
  eq('B\'s cost = 3×200 = 600', await cogsOf(invB.id), 600);
  eq('ledger COGS = 1,400', await cogsGL(), 1400);
  eq('the COGS page agrees (1,400)', await cogsPage(), 1400);

  // ── edit A 6 → 2: stock swaps, and B is RE-COSTED by FIFO ───────────────────────────────────────────────────
  await J('PUT', '/api/invoices/' + invA.id, { line_items: [{ desc: 'Widget', qty: 2, rate: 300, inventory_id: w.id }, { desc: 'Setup', qty: 1, rate: 50 }] });
  eq('A edited to 2 → 9 on hand', await units(), 9, 5);
  eq('A now costs 2×100 = 200', await cogsOf(invA.id), 200);
  eq('B re-costed: 2×100 + 1×200 = 400 (it was 600 before A changed)', await cogsOf(invB.id), 400, 600);
  eq('ledger COGS = 600 = FIFO (no re-cost would leave 800)', await cogsGL(), 600, 800);
  eq('the COGS page agrees (600)', await cogsPage(), 600);
  const rc = (await http.get('/api/gl/reconcile-check')).json || {};
  A('GL reconcile check: the ledger ties to the books', rc.ok === true, JSON.stringify(rc.problems || rc).slice(0, 300));

  // ── B back to draft, A deleted: stock comes back ────────────────────────────────────────────────────────────
  await J('PUT', '/api/invoices/' + invB.id, { status: 'draft' });
  eq('B back to draft → 12 on hand', await units(), 12, 9);
  eq('ledger COGS = 200 (A only)', await cogsGL(), 200);
  await J('DELETE', '/api/invoices/' + invA.id);
  eq('A deleted → 14 on hand', await units(), 14, 12);
  eq('ledger COGS = 0', await cogsGL(), 0);
  eq('no invoice-linked movements left', (await c.query(`SELECT count(*)::int n FROM inventory_movements WHERE idempotency_key LIKE 'invoice-stock:%'`)).rows[0].n, 0);

  // ── refusals ────────────────────────────────────────────────────────────────────────────────────────────────
  const nBefore = (await c.query(`SELECT count(*)::int n FROM invoices WHERE user_id = $1`, [uid])).rows[0].n;
  const big = await http.post('/api/invoices', { client: 'Big', status: 'pending', issue_date: '2026-07-20', idempotency_key: 'fa-c', line_items: [{ desc: 'Widget', qty: 20, rate: 300, inventory_id: w.id }] });
  eq('20 Widgets with 14 on hand → 400 INSUFFICIENT_STOCK', [big.status, (big.json || {}).code], [400, 'INSUFFICIENT_STOCK']);
  A('…saying how many are in stock', /Only 14 of Widget in stock/.test((big.json || {}).error || ''), JSON.stringify(big.json));
  eq('…no invoice written, stock unchanged', [(await c.query(`SELECT count(*)::int n FROM invoices WHERE user_id = $1`, [uid])).rows[0].n, await units()], [nBefore, 14]);
  const invD = await J('POST', '/api/invoices', { client: 'Dyn', status: 'pending', issue_date: '2026-07-20', idempotency_key: 'fa-d', line_items: [{ desc: 'Widget', qty: 10, rate: 300, inventory_id: w.id }] });
  eq('D takes 10 → 4 on hand', await units(), 4);
  eq('editing D to 15 (4 on hand + its own 10 = 14) → 400', (await http.put('/api/invoices/' + invD.id, { line_items: [{ desc: 'Widget', qty: 15, rate: 300, inventory_id: w.id }] })).status, 400);
  eq('…D and the stock unchanged', [await units(), (await c.query(`SELECT data->'line_items'->0->>'qty' q FROM invoices WHERE id = $1`, [invD.id])).rows[0].q], [4, '10']);
  eq('editing D to 14 → 200, 0 on hand', [(await http.put('/api/invoices/' + invD.id, { line_items: [{ desc: 'Widget', qty: 14, rate: 300, inventory_id: w.id }] })).status, await units()], [200, 0]);
  const bill = await http.post('/api/bills', { vendor: 'Supplier', status: 'unpaid', issue_date: '2026-07-20', due_date: '2026-08-20', line_items: [{ desc: 'Widget', qty: 1, rate: 100, inventory_id: w.id }] });
  A('a bill cannot carry a stocked product (Stock In buys stock) → 400', bill.status === 400 && /Stock In/.test((bill.json || {}).error || ''), bill.status + ' ' + JSON.stringify(bill.json));
  const quote = await http.post('/api/quotes', { client: 'Q', status: 'pending', expiry_date: '2026-08-30', line_items: [{ desc: 'Widget', qty: 2, rate: 300, inventory_id: w.id }] });
  eq('a quote may name a stocked product (nothing moves until it is invoiced)', [quote.status < 300, await units()], [true, 0]);
  const e2 = await J('POST', '/api/entities', { name: 'Other Biz', currency: 'USD', country: 'US', timezone: 'UTC' });
  const foreign = (await c.query(`INSERT INTO inventory (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, '{"name":"Gadget","units":5}', NOW(), NOW()) RETURNING id`, [uid, e2.id])).rows[0].id;
  const fx = await http.post('/api/invoices', { client: 'X', status: 'pending', issue_date: '2026-07-20', idempotency_key: 'fa-e', line_items: [{ desc: 'Gadget', qty: 1, rate: 10, inventory_id: foreign }] });
  eq('another business\'s product → 400 LINE_ITEM', [fx.status, (fx.json || {}).code], [400, 'LINE_ITEM']);

  // ── the invoice line editor offers stocked products (one list) ───────────────────────────────────────────────
  await J('DELETE', '/api/invoices/' + invD.id);   // stock back to 14 for the picker label
  const page = await open({ width: 1280, height: 900 });
  const ui = await page.evaluate(async (wid) => {
    openInvoiceModal(); await new Promise(r => setTimeout(r, 1200));
    const opts = [...document.querySelectorAll('#ff-items-dl option')].map(o => [o.value, o.label]);
    window.ffInvLineItems.addRow();
    const row = document.querySelector('.inv-li-row'); const d = row.querySelector('.inv-li-desc');
    d.value = 'Widget'; d.dispatchEvent(new Event('input', { bubbles: true }));
    row.querySelector('.inv-li-rate').value = '300'; row.querySelector('.inv-li-rate').dispatchEvent(new Event('input', { bubbles: true }));
    const billOpts = [...document.querySelectorAll('#ff-items-bill-dl option')].map(o => o.value);
    return { opts, attr: row.getAttribute('data-inventory-id'), got: window.ffInvLineItems.get(), billOpts };
  }, w.id);
  A('the invoice line list offers Widget as a stocked product with its count', ui.opts.some(([v, l]) => v === 'Widget' && /Stocked · 14 in stock/.test(l || '')), JSON.stringify(ui.opts));
  eq('picking it links the line to the stocked product', [ui.attr, (ui.got || [])[0] && ui.got[0].inventory_id, (ui.got || [])[0] && ui.got[0].qty], [String(w.id), w.id, 1]);
  A('the bill list does not offer stocked products', !ui.billOpts.includes('Widget'), JSON.stringify(ui.billOpts));
  await wait(100);
}, {});
