'use strict';
/**
 * verify-la4-customers-from-invoices.js — LA4 (live audit 2026-10-13 M1): the Customers page read
 * "0 customers · $0 lifetime revenue" while the business had invoices, because an invoice's free-text client that
 * matches no saved customer was attributed to nobody.
 *
 * Real SPA in jsdom, real scratch Postgres, clientMoneyKit seed (clock 2026-07-25). No customer records are seeded.
 * HAND-COMPUTED from the seed's invoices (recognised = pending/overdue/partial/paid, issued on or before today):
 *   Acme Ltd   1,000 (Jan) + 600 (Jul) = 1,600 · 2 invoices
 *   Beta Co    300                       ·  1 invoice
 *   Gamma      9,999 DRAFT → excluded (bug if counted: 11,899)
 *   − the seed's Open credit note to Acme Ltd, 80 (7 Jul): FA-M12d counts the same legs as Sales by Customer
 *     (invoices + named cash sales − credit notes), so Acme Ltd = 1,520 and the total 1,820 (it was 1,900, invoices only)
 *   → Total Customers 2 (bug: 0) · Lifetime Revenue $1,820 (bug: $0)
 * Then Acme Ltd is saved as a customer (company = "Acme Ltd", as the Save button pre-fills): it moves from the
 * unsaved list to the saved one with its 1,520, and the totals stay 2 / $1,820 (no double count: bug would be $3,340).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la4-customers-from-invoices.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA4 — Customers page counts invoice clients that are not saved as customers yet', async ({ w, d, all, settle, http, eq }) => {
  const openCustomers = async () => { w.showPage('customers'); await settle(40, 50); };
  await openCustomers();
  eq('Total Customers', all('cust-total'), '2', '0');
  eq('Lifetime Revenue', all('cust-revenue'), '$1,820', '$0');
  eq('caption says they are not saved yet', all('cust-total-sub'), '0 saved · 2 from invoices, not saved yet');
  const rows = [...d.querySelectorAll('#customers-list .cust-row')].map(r => r.querySelector('.cust-name').textContent.trim());
  eq('rows: the two invoice clients, largest first; the draft-only client is not listed', rows, ['Acme Ltd', 'Beta Co']);

  // The Save button pre-fills the add form from the invoice name.
  w.openCustomerModalFromUnsaved(0);
  eq('Save pre-fills first name / last name / company', ['cust-fname', 'cust-lname', 'cust-company'].map(id => d.getElementById(id).value), ['Acme', 'Ltd', 'Acme Ltd']);
  w.closeModal && w.closeModal('customer-modal');

  // Save it (the route the form's save posts to), then reopen the page.
  const ent = (w.ENTITIES || []).find(e => e.active);
  const r = await http.request('POST', '/api/customers', { fname: 'Acme', lname: 'Ltd', company: 'Acme Ltd', email: 'ap@acme.test', status: 'active', entity_id: ent && ent._dbId });
  eq('customer saved', r.status, 201);
  if (typeof w.loadEntityData === 'function') await w.loadEntityData((w.ENTITIES || []).findIndex(e => e.active));
  await openCustomers();
  eq('after saving: Total Customers still 2', all('cust-total'), '2');
  eq('after saving: Lifetime Revenue still $1,820 (no double count)', all('cust-revenue'), '$1,820', '$3,340');
  eq('after saving: caption', all('cust-total-sub'), '1 saved · 1 from invoices, not saved yet');
  const badges = [...d.querySelectorAll('#customers-list .cust-row')].map(r => [r.querySelector('.cust-name').textContent.trim(), r.querySelector('.badge').textContent.trim()]);
  eq('after saving: Acme is a saved customer, Beta still unsaved', badges, [['Acme Ltd', 'active'], ['Beta Co', 'Not saved']]);
}, { extraSeed: async ({ client, userId }) => {
  // Batch 9 (D3): invoices made through the app now save their customer automatically, so the "not saved" flow this test
  // covers only exists for data from BEFORE that — recreated here: the seed's auto-saved customers removed, links dropped.
  await client.query(`DELETE FROM customers WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE invoices SET data = data - 'customer_id' WHERE user_id = $1`, [userId]);
} });
