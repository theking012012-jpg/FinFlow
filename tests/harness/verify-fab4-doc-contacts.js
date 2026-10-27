'use strict';
/**
 * FA-B4 / FA-B4b (2026-10-27) — every document that names a customer or vendor saves and links the contact; a rename moves
 * the link; a customer may be a company with no email.
 *
 * BUG (read 2026-10-24, executed here on the old code): only invoices and bills (batch 9) saved / linked their contact.
 * Quotes, sales receipts, credit notes, recurring invoices, payments made, vendor credits and recurring bills kept a typed
 * name only (no customer_id / vendor_id, no contact saved); an edit that renamed an invoice's client or a bill's vendor
 * left the link on the OLD contact; a nameless customer could be saved.
 *
 * Seed: business "B4 Co" with saved customer "Acme Ltd" and vendor "Paper Co" (made by an invoice and a bill). Then:
 *   quote "Acme Ltd" · receipt "Walk-in" · credit note "acme ltd" (same key) · recurring invoice "Beta Co"
 *   payment made "Paper Co" · vendor credit "Paper Co" · recurring bill "AWS"
 * Expected: customers Acme Ltd, Walk-in, Beta Co (3; bug 1) · vendors Paper Co, AWS (2; bug 1); every document linked to
 * the contact of its name (bug: no link). Renames: invoice → "Gamma" links Gamma (bug: still Acme); bill → "Ink Co" links
 * Ink Co (bug: still Paper Co); payment made on a bill → "Ink Co" links Ink Co. A second business: "Acme Ltd" there is a
 * new customer of that business (never business 1's Acme).
 */
const { run } = require('./moneyFixKit.js');

run('FA-B4 — every document saves and links its customer / vendor', async ({ newOwner, c, eq }) => {
  const { J, http, ids: [e1, e2] } = await newOwner('B4', [{ name: 'B4 Co', currency: 'USD' }, { name: 'B4 Two', currency: 'USD' }]);
  const link = async (t, id) => { const r = (await c.query(`SELECT data->>'customer_id' cu, data->>'vendor_id' ve FROM ${t} WHERE id = $1`, [id])).rows[0]; return r ? Number(r.cu || r.ve) || null : 'missing'; };
  const contacts = async (t, eid, nm) => (await c.query(`SELECT id, data->>${t === 'customers' ? `'company'` : `'name'`} AS n FROM ${t} WHERE entity_id = $1 ORDER BY id`, [eid])).rows.filter(r => !nm || r.n === nm);
  const idOf = async (t, eid, nm) => { const r = await contacts(t, eid, nm); return r.length === 1 ? r[0].id : r.length; };

  const inv = await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 500, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01', idempotency_key: 'b4-i' });
  const bill = await J('POST', '/api/bills', { vendor: 'Paper Co', amount: 300, status: 'unpaid', issue_date: '2026-07-02', due_date: '2026-08-01', idempotency_key: 'b4-b' });
  const acme = await idOf('customers', e1, 'Acme Ltd'), paper = await idOf('vendors', e1, 'Paper Co');

  const q = await J('POST', '/api/quotes', { client: 'Acme Ltd', amount: 120, expiry_date: '2026-08-30' });
  const sr = await J('POST', '/api/sales-receipts', { customer: 'Walk-in', amount: 40, date: '2026-07-05', method: 'Cash', idempotency_key: 'b4-sr' });
  const cn = await J('POST', '/api/credit-notes', { customer: 'acme ltd', amount: 30, date: '2026-07-06', idempotency_key: 'b4-cn' });
  const ri = await J('POST', '/api/recurring-invoices', { client: 'Beta Co', amount: 90, frequency: 'Monthly', next_run: '2026-08-01' });
  const pm = await J('POST', '/api/payments-made', { vendor: 'Paper Co', amount: 25, date: '2026-07-07', method: 'Bank', idempotency_key: 'b4-pm' });
  const vc = await J('POST', '/api/vendor-credits', { vendor: 'Paper Co', amount: 15, date: '2026-07-08', idempotency_key: 'b4-vc' });
  const rb = await J('POST', '/api/recurring-bills', { vendor: 'AWS', amount: 60, frequency: 'Monthly', next_run: '2026-08-01' });

  eq('1  customers of the business: Acme Ltd, Walk-in, Beta Co', (await contacts('customers', e1)).map(r => r.n), ['Acme Ltd', 'Walk-in', 'Beta Co'], ['Acme Ltd']);
  eq('1  vendors of the business: Paper Co, AWS', (await contacts('vendors', e1)).map(r => r.n), ['Paper Co', 'AWS'], ['Paper Co']);
  const walk = await idOf('customers', e1, 'Walk-in'), beta = await idOf('customers', e1, 'Beta Co'), aws = await idOf('vendors', e1, 'AWS');
  eq('2  each document is linked to the contact of its name (quote, receipt, credit note "acme ltd", recurring invoice)',
    [await link('quotes', q.id), await link('sales_receipts', sr.id), await link('credit_notes', cn.id), await link('recurring_invoices', ri.id)], [acme, walk, acme, beta], [null, null, null, null]);
  eq('2  …payment made, vendor credit, recurring bill', [await link('payments_made', pm.id), await link('vendor_credits', vc.id), await link('recurring_bills', rb.id)], [paper, paper, aws], [null, null, null]);

  // Renames move the link (FA-B4b).
  await J('PUT', '/api/invoices/' + inv.id, { client: 'Gamma' });
  const gamma = await idOf('customers', e1, 'Gamma');
  eq('3  invoice renamed to "Gamma" → linked to the (new) Gamma customer', await link('invoices', inv.id), gamma, acme);
  await J('PUT', '/api/bills/' + bill.id, { vendor: 'Ink Co' });
  const ink = await idOf('vendors', e1, 'Ink Co');
  eq('3  bill renamed to "Ink Co" → linked to Ink Co', await link('bills', bill.id), ink, paper);
  await J('PUT', '/api/quotes/' + q.id, { client: 'Beta Co' });
  eq('3  quote renamed to "Beta Co" → the saved Beta Co (no second Beta)', [await link('quotes', q.id), (await contacts('customers', e1, 'Beta Co')).length], [beta, 1], [acme, 1]);
  const pmOnBill = await J('POST', '/api/payments-made', { vendor: 'Ink Co', bill_id: bill.id, amount: 10, date: '2026-07-09', method: 'Bank', idempotency_key: 'b4-pm2' });
  await J('PUT', '/api/payments-made/' + pmOnBill.id, { vendor: 'Paper Co', bill_id: bill.id });
  eq('3  a payment on a bill, renamed → linked to the new name (the bill-linked edit path too)', await link('payments_made', pmOnBill.id), paper, ink);
  eq('3  renaming to blank is refused (400)', (await http.request('PUT', '/api/credit-notes/' + cn.id, { customer: '  ' })).status, 400, 200);

  // A customer is a person or a company; the email is optional.
  eq('4  a company-only customer with no email is saved', (await http.request('POST', '/api/customers', { company: 'Delta Traders' })).status, 201);
  eq('4  a nameless customer is refused (400)', (await http.request('POST', '/api/customers', { email: 'x@y.test' })).status, 400, 201);

  // Per business: the same name in business 2 is that business's own contact.
  await J('POST', '/api/entities/' + e2 + '/activate', {});
  const q2 = await J('POST', '/api/quotes', { client: 'Acme Ltd', amount: 70, expiry_date: '2026-08-30' });
  const acme2 = await idOf('customers', e2, 'Acme Ltd');
  eq('5  "Acme Ltd" in business 2 is business 2\'s own customer — never business 1\'s', [typeof acme2 === 'number' && acme2 !== acme, await link('quotes', q2.id)], [true, acme2], [false, null]);
});
