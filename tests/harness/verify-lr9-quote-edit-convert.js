'use strict';
/**
 * LR9 (decision 2026-10-21: option A — build Edit + Convert to invoice). Quotes had only View and ✕: PUT /api/quotes/:id
 * existed with no caller, and there was no way to turn an accepted quote into an invoice.
 *   Edit    — the quote form opens pre-filled, INCLUDING its line items (the total stays derived from them, Rule 2);
 *             Save sends PUT for that quote.
 *   Convert — creates the invoice through the ONE invoice writer (POST /api/invoices) as a DRAFT (not revenue until the
 *             user issues it), with the quote's client / lines / total, idempotency key "quote-<id>" (Rule 9: a double
 *             click or a second tab makes ONE invoice); the quote becomes "converted" and records the invoice id.
 * Real SPA in jsdom → real server → scratch Postgres (clientMoneyKit seed). Values chosen so each wrong outcome differs:
 *   Quote A: lines 2 × 150 + 1 × 400 = 700.   Quote B: single amount 250.
 *   1  Edit A opens pre-filled: client, 2 line rows, amount 700                         bug: no Edit
 *   2  change A's second line rate 400 → 500, Save → one quote, amount 800, lines kept  bug: unchanged / 2nd quote / lines lost
 *   3  Edit B (no lines) 250 → 300 → amount 300                                          bug: unchanged
 *   4  Convert A (clicked twice) → exactly ONE invoice: draft, client, 800, 2 lines      bug: none (or 2)
 *   5  quote A → status "converted", invoice_id = that invoice                            bug: still pending
 *   6  revenue (GET /api/reports, year) unchanged by the conversion (draft)               a "pending" invoice would add 800
 *   7  converting A again makes no new invoice                                           (idempotent)
 */
const { run } = require('./clientMoneyKit.js');
run('LR9 — quotes can be edited and converted to an invoice', async ({ w, d, settle, eq, A, http }) => {
  const qa = (await http.post('/api/quotes', { client: 'Quote Client A', amount: 700, expiry_date: '2026-08-30', line_items: [{ desc: 'Design', qty: 2, rate: 150 }, { desc: 'Build', qty: 1, rate: 400 }] })).json;
  const qb = (await http.post('/api/quotes', { client: 'Quote Client B', amount: 250, expiry_date: '2026-08-30' })).json;
  try { w.showPage('quotes'); } catch (_) {}
  await settle(30, 60);
  const val = id => (d.getElementById(id) || {}).value;
  const rowsIn = () => [...d.querySelectorAll('#quote-li-rows .quote-li-row')];
  // 1
  if (typeof w.editQuote === 'function') { await w.editQuote(qa.id); await settle(10, 40); }
  A('1  Edit A opens pre-filled (client, 2 line rows, amount 700)', typeof w.editQuote === 'function' && val('quote-client') === 'Quote Client A' && rowsIn().length === 2 && Number(val('quote-amount')) === 700,
    JSON.stringify({ fn: typeof w.editQuote, client: val('quote-client'), rows: rowsIn().length, amount: val('quote-amount') }));
  // 2
  if (typeof w.editQuote === 'function') {
    const r2 = rowsIn()[1]; const rate = r2 && r2.querySelector('.quote-li-rate');
    if (rate) { rate.value = '500'; rate.dispatchEvent(new w.Event('input', { bubbles: true })); }
    await w.saveQuote(); await settle(20, 60);
  }
  let quotes = (await http.get('/api/quotes')).json || [];
  const A1 = quotes.find(q => q.id === qa.id) || {};
  eq('2  one quote A, amount 800, lines kept (rate 500)', [quotes.filter(q => q.client === 'Quote Client A').length, Number(A1.amount), (A1.line_items || []).map(l => Number(l.rate))], [1, 800, [150, 500]], [1, 700, [150, 400]]);
  // 3
  if (typeof w.editQuote === 'function') { await w.editQuote(qb.id); await settle(10, 40); d.getElementById('quote-amount').value = '300'; await w.saveQuote(); await settle(20, 60); }
  quotes = (await http.get('/api/quotes')).json || [];
  eq('3  quote B 250 → 300', Number((quotes.find(q => q.id === qb.id) || {}).amount), 300, 250);
  // 4–6
  const revBefore = Number(((await http.get('/api/reports?period=year')).json || {}).revenue);
  const invBefore = ((await http.get('/api/invoices')).json || []).length;
  if (typeof w.convertQuote === 'function') { await Promise.all([w.convertQuote(qa.id), w.convertQuote(qa.id)]); await settle(20, 60); }
  const invs = (await http.get('/api/invoices')).json || [];
  const made = invs.filter(i => i.client === 'Quote Client A');
  eq('4  exactly ONE invoice, draft, 800, 2 lines', [invs.length - invBefore, made.map(i => [i.status, Number(i.amount), (i.line_items || []).length])], [1, [['draft', 800, 2]]], [0, []]);
  const A2 = ((await http.get('/api/quotes')).json || []).find(q => q.id === qa.id) || {};
  eq('5  quote A converted, linked to that invoice', [A2.status, Number(A2.invoice_id)], ['converted', made[0] ? made[0].id : -1], ['pending', NaN]);
  const revAfter = Number(((await http.get('/api/reports?period=year')).json || {}).revenue);
  eq('6  revenue unchanged by the conversion (draft)', revAfter, revBefore, revBefore + 800);
  if (typeof w.convertQuote === 'function') { await w.convertQuote(qa.id); await settle(10, 40); }
  eq('7  converting again makes no new invoice', ((await http.get('/api/invoices')).json || []).length, invBefore + 1);
});
