'use strict';
/**
 * verify-stock-returns-credit-notes — owner decision 2026-11-01: a credit note can bring stock back; the units return at
 * their ORIGINAL cost (what they left at on that invoice) and that cost comes off cost of goods sold; voiding / deleting
 * the credit note takes them out again. Real server + the real form, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-stock-returns-credit-notes.js
 *
 * Seed (Rule 4): Widget 4 @ 10 (07-01), 6 @ 30 (07-02). Invoice A 3 Widgets 07-10 (cost 3×10 = 30); invoice B 2 Widgets
 * 07-11 (cost 1×10 + 1×30 = 40). Credit note 07-15 returns 2 from A → back at 10 each: +20 stock, COGS 70 − 20 = 50, 7 on
 * hand (old code: nothing comes back — 5 on hand, COGS 70). Then sale C 6 Widgets 07-20: FIFO takes the 5 left @ 30 and 1
 * of the returned @ 10 = 160 → COGS 210. Voiding the credit note with only 1 on hand is refused.
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('Returned stock on a credit note', async ({ open, eq, A, J, http, c, uid }) => {
  const w = await J('POST', '/api/inventory', { name: 'Widget', qty: 0, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 4, unit_cost: 10, date: '2026-07-01', idempotency_key: 'p1' });
  await J('POST', '/api/inventory-movements', { inventory_id: w.id, type: 'purchase', quantity: 6, unit_cost: 30, date: '2026-07-02', idempotency_key: 'p2' });
  const A1 = await J('POST', '/api/invoices', { client: 'Acme', status: 'pending', issue_date: '2026-07-10', idempotency_key: 'r-a', line_items: [{ desc: 'Widget', qty: 3, rate: 50, inventory_id: w.id }] });
  await J('POST', '/api/invoices', { client: 'Bolt', status: 'pending', issue_date: '2026-07-11', idempotency_key: 'r-b', line_items: [{ desc: 'Widget', qty: 2, rate: 50, inventory_id: w.id }] });
  const units = async () => Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id = $1`, [w.id])).rows[0].u);
  const cogsGL = async () => Number((await c.query(`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float s FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id WHERE l.user_id = $1 AND a.code = '5000'`, [uid])).rows[0].s);
  const cogsPage = async () => Number(((await http.get('/api/cogs')).json || {}).totalCOGS);
  eq('premise: 5 on hand, COGS 70', [await units(), await cogsGL()], [5, 70]);

  const cn = await J('POST', '/api/credit-notes', { customer: 'Acme', amount: 100, date: '2026-07-15', idempotency_key: 'r-cn', returns: [{ inventory_id: w.id, qty: 2, invoice_id: A1.id }] });
  eq('the credit note records the return at A\'s cost (10 each)', (cn.stock_returns || []).map(r => [r.qty, r.unit_cost]), [[2, 10]], []);
  eq('2 come back: 7 on hand', await units(), 7, 5);
  eq('their cost comes off COGS: ledger 70 − 20 = 50', await cogsGL(), 50, 70);
  eq('…and the COGS page agrees (50)', await cogsPage(), 50, 70);
  const more = await http.post('/api/credit-notes', { customer: 'Acme', amount: 50, date: '2026-07-16', idempotency_key: 'r-cn2', returns: [{ inventory_id: w.id, qty: 2, invoice_id: A1.id }] });
  eq('returning 2 more from A (only 1 of its 3 left to return) → 400 RETURN_TOO_MANY, no credit note kept', [more.status, (more.json || {}).code, (await c.query(`SELECT count(*)::int n FROM credit_notes WHERE data->>'idempotency_key' = 'r-cn2'`)).rows[0].n], [400, 'RETURN_TOO_MANY', 0]);

  const C1 = await J('POST', '/api/invoices', { client: 'Cara', status: 'pending', issue_date: '2026-07-20', idempotency_key: 'r-c', line_items: [{ desc: 'Widget', qty: 6, rate: 50, inventory_id: w.id }] });
  eq('sale C of 6 takes the 5 left @ 30 + 1 returned @ 10 = 160 → COGS 210', await cogsGL(), 210);
  eq('…the COGS page agrees (210)', await cogsPage(), 210);
  const v1 = await http.put('/api/credit-notes/' + cn.id, { status: 'Void' });
  eq('voiding the credit note with only 1 on hand → 409 RETURN_SOLD', [v1.status, (v1.json || {}).code], [409, 'RETURN_SOLD']);
  await J('DELETE', '/api/invoices/' + C1.id);
  eq('after C is deleted (7 on hand), voiding → 200', (await http.put('/api/credit-notes/' + cn.id, { status: 'Void' })).status, 200);
  eq('the returned 2 go out again: 5 on hand, COGS 70', [await units(), await cogsGL(), await cogsPage()], [5, 70, 70]);
  const rc = (await http.get('/api/gl/reconcile-check')).json || {};
  A('GL reconcile check ok', rc.ok === true, JSON.stringify(rc.problems || rc).slice(0, 300));

  // the form offers the stocked products
  const page = await open({ width: 1280, height: 900 });
  const opts = await page.evaluate(async () => { openNewCreditNoteModal(); await new Promise(r => setTimeout(r, 1200)); return [...document.querySelectorAll('#cn-return-item option')].map(o => o.textContent); });
  A('the credit note form offers "Stock returned" with Widget (5 in stock)', opts.some(t => /Widget \(5 in stock\)/.test(t)), JSON.stringify(opts));
}, {});
