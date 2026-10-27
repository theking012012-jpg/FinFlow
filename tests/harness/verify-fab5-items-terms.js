'use strict';
/**
 * FA-B5 / FA-B5b (2026-10-27) — invoice / bill / quote lines pick a saved item; each invoice and bill has its own terms;
 * the printed Terms line is the document's own. (Per-line tax is NOT built, by design: FinFlow's tax is an estimate only,
 * with no VAT / GST engine — CLAUDE.md product fact.)
 *
 * Seed: clientMoneyKit (business terms unset → 30) + items "Consulting" (price 150) and "Widget" (price 20, cost 8);
 * a second owner's item "Foreign".
 * Hand-computed:
 *   invoice line typed "Consulting" → rate 150, qty 1 (bug: empty — no picker); saved line carries Consulting's id
 *   bill line "Widget" → rate 8 (its cost, not its price 20)
 *   Terms Net 15 on issue 2026-07-01 → due 2026-07-16; issue moved to 2026-07-05 → due 2026-07-20; a typed due → "Custom"
 *   printed: issue 2026-07-01, due 2026-07-11 → "Net 10" (bug: "Net 30", the business setting beside a 10-day due date)
 *   a line naming another owner's item → 400 (bug: 201, the id dropped silently)
 */
const bcrypt = require('bcryptjs');
const { run } = require('./clientMoneyKit.js');

run('FA-B5 — item picker on lines; per-document terms; printed terms are the document\'s own', async ({ w, d, settle, http, eq }) => {
  const items = (await http.get('/api/items')).json || [];
  const consult = items.find(i => i.name === 'Consulting'), widget = items.find(i => i.name === 'Widget');

  // ── 1 · invoice line picks an item ──
  w.openInvoiceModal(); await settle(20, 30);
  w.ffInvLineItems.addRow(); await settle(2, 10);
  const row = d.querySelector('#inv-li-rows .inv-li-row');
  const desc = row.querySelector('.inv-li-desc'); desc.value = 'Consulting'; desc.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(2, 10);
  eq('1  typing a saved item fills its price and qty 1', [row.querySelector('.inv-li-rate').value, row.querySelector('.inv-li-qty').value, d.getElementById('inv-amount').value], ['150', '1', '150.00'], ['', '', '']);
  eq('1  the line carries the item', w.ffInvLineItems.get(), [{ desc: 'Consulting', qty: 1, rate: 150, item_id: consult.id }], [{ desc: 'Consulting', qty: 0, rate: 0 }]);

  // ── 2 · terms on the invoice ──
  d.getElementById('inv-client').value = 'Acme Ltd';
  d.getElementById('inv-issue').value = '2026-07-01';
  const sel = d.getElementById('inv-terms');
  eq('2  the Terms list starts at the business\'s terms', sel ? [sel.value, sel.options[0].textContent] : null, ['', 'Your terms (Net 30)'], null);
  if (!sel || !w._docTermsChange) { eq('2  (no Terms list on the old code — the terms checks below are skipped)', true, false); } else {
  sel.value = '15'; w._docTermsChange('inv'); await settle(1, 10);
  eq('2  Net 15 on 2026-07-01 → due 2026-07-16', d.getElementById('inv-due').value, '2026-07-16', '');
  d.getElementById('inv-issue').value = '2026-07-05'; w._docTermsChange('inv', true);
  eq('2  moving the issue date to 2026-07-05 moves the due date → 2026-07-20', d.getElementById('inv-due').value, '2026-07-20', '2026-07-16');
  d.getElementById('inv-issue').value = '2026-07-01'; w._docTermsChange('inv', true);
  w.saveInvoice(); await settle(25, 40);
  const saved = ((await http.get('/api/invoices')).json || []).find(i => Array.isArray(i.line_items) && i.line_items.some(l => l.item_id));
  eq('2  the saved invoice: due 2026-07-16, line linked to Consulting', saved ? [String(saved.due_date).slice(0, 10), saved.line_items[0].item_id, Number(saved.amount)] : null, ['2026-07-16', consult.id, 150], null);
  d.getElementById('inv-due').value = '2026-07-25'; w._docDueTyped('inv');
  eq('2  typing a due date makes the terms "Custom"', sel.value, 'custom', '15');
  }
  try { d.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden')); } catch (_) {}

  // ── 3 · bill line uses the item's cost ──
  w.openNewBillModal(); await settle(20, 30);
  w.ffBillLineItems.addRow(); await settle(2, 10);
  const brow = d.querySelector('#bill-li-rows .bill-li-row');
  const bdesc = brow.querySelector('.bill-li-desc'); bdesc.value = 'widget'; bdesc.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(2, 10);
  eq('3  a bill line takes the item\'s cost (8), not its price (20)', [brow.querySelector('.bill-li-rate').value, (w.ffBillLineItems.get() || [])[0] && w.ffBillLineItems.get()[0].item_id], ['8', widget.id], ['', undefined]);

  // ── 4 · the printed terms are the document's own ──
  const html = w.buildDocumentHTML({ number: 'INV-9', party: 'Acme Ltd', issue_date: '2026-07-01', due_date: '2026-07-11', status: 'pending', line_items: [{ desc: 'x', qty: 1, rate: 10 }] }, 'invoice', {});
  const t = (/Terms:<\/span>\s*([^<]+)</.exec(html) || [])[1];
  eq('4  an invoice due 10 days after issue prints "Net 10" (business terms are 30)', t && t.trim(), 'Net 10 — due within 10 days', 'Net 30 — due within 30 days');
  const html0 = w.buildDocumentHTML({ number: 'INV-10', party: 'Acme Ltd', issue_date: '2026-07-01', due_date: '2026-07-01', status: 'pending', line_items: [{ desc: 'x', qty: 1, rate: 10 }] }, 'invoice', {});
  eq('4  due the same day prints "Due on receipt"', ((/Terms:<\/span>\s*([^<]+)</.exec(html0) || [])[1] || '').trim(), 'Due on receipt', 'Net 30 — due within 30 days');

  // ── 5 · the server only keeps an item of this business ──
  const bad = await http.request('POST', '/api/invoices', { client: 'Acme Ltd', status: 'pending', issue_date: '2026-07-02', line_items: [{ desc: 'Foreign', qty: 1, rate: 5, item_id: global.__b5ForeignItemId }], idempotency_key: 'b5-bad' });
  eq('5  a line naming another owner\'s item is refused (400)', [bad.status, /not in this business/i.test(String(bad.text))], [400, true], [201, false]);
}, { extraSeed: async ({ http, client }) => {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
  await J('POST', '/api/items', { name: 'Consulting', type: 'Service', price: 150, unit: 'hr', status: 'Active' });
  await J('POST', '/api/items', { name: 'Widget', type: 'Product', price: 20, cost: 8, unit: 'each', status: 'Active' });
  const other = (await client.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
    [{ email: 'b5-other@finflow.test', name: 'Other', plan: 'business', role: 'owner', password: bcrypt.hashSync('x-not-a-secret', 4) }])).rows[0].id;
  const oe = (await client.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`, [other, { name: 'Other Co', currency: 'USD' }])).rows[0].id;
  const fi = (await client.query(`INSERT INTO items (user_id, entity_id, data) VALUES ($1, $2, $3) RETURNING id`, [other, oe, { name: 'Foreign', price: 5, status: 'Active' }])).rows[0].id;
  global.__b5ForeignItemId = fi;
} });
