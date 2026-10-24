'use strict';
/**
 * verify-b9-contacts.js — plan batch 9 (B2, owner decision D3 upgraded; gap audit 2026-10-22: "7 of 7 customers not saved
 * as a customer yet", "8 of 8 vendors not saved").
 * Before: invoices and bills carried a free-text name; nothing ever saved it as a customer / vendor (reminders need a saved
 * customer's e-mail — G12), and the "not saved" lists could only be cleared one by one.
 * After (better than standard):
 *   • every invoice / bill writer saves its name as a contact of THAT business, once (one matcher — case and spacing
 *     never make a second "Acme Ltd"); the document is linked to it
 *   • the invoice / bill forms pick from saved contacts
 *   • existing free-text names: "Save all" with a preview — a name that LOOKS LIKE an existing contact ("ACME Limited" vs
 *     "Acme Ltd") is flagged and not saved unless chosen; nothing is created without the owner's click (Rule 8)
 * The REAL SPA + real server. Seed: clientMoneyKit (invoices Acme Ltd ×2, Beta Co, Gamma; bill Supply Co — all through the
 * real routes) + raw rows from before this batch: invoices "ACME Limited", "Legacy Client"; bill "Old Vendor".
 */
const { run } = require('./clientMoneyKit.js');
let bizB = null, dbc = null;

run('Batch 9 — contacts saved from invoices and bills, picked in forms, legacy names saved with a preview', async ({ w, d, settle, eq, A, http }) => {
  const custs = async () => ((await http.get('/api/customers')).json || []);
  const cname = c => (c.company || ((c.fname || '') + ' ' + (c.lname || '')).trim());
  const c0 = await custs();
  eq('1  invoices made through the app saved their customers — once each (Acme Ltd ×2 → 1)', ['Acme Ltd', 'Beta Co', 'Gamma'].map(n => c0.filter(c => cname(c) === n).length), [1, 1, 1], [0, 0, 0]);
  const vend = async () => ((await http.get('/api/vendors')).json || []);
  eq('1b the bill saved its vendor (Supply Co)', (await vend()).filter(v => v.name === 'Supply Co').length, 1, 0);

  const inv = (await http.post('/api/invoices', { client: '  acme   LTD ', amount: 40, status: 'pending', issue_date: '2026-07-20', idempotency_key: 'b9-1' })).json || {};
  const acme = (await custs()).filter(c => cname(c).toLowerCase() === 'acme ltd');
  eq('2  "  acme   LTD " matches the saved Acme Ltd — still one customer, and the invoice is linked to it', [acme.length, inv.customer_id === (acme[0] || {}).id], [1, true], [2, false]);

  const unsaved = (await http.get('/api/customers/unsaved')).json || [];
  const names = unsaved.map(u => u.name).sort();
  eq('3  the "not saved" list holds only the names from before (ACME Limited, Legacy Client)', names, ['ACME Limited', 'Legacy Client']);
  const near = unsaved.find(u => u.name === 'ACME Limited') || {};
  eq('3b ACME Limited is flagged as looking like the saved "Acme Ltd"', near.similar_to, 'Acme Ltd', undefined);
  eq('3c Legacy Client is not flagged', (unsaved.find(u => u.name === 'Legacy Client') || {}).similar_to || null, null);

  const sv = await http.post('/api/customers/save-unsaved', { names: ['Legacy Client'] });
  eq('4  "Save all" (the owner chose Legacy Client) → created 1', [sv.status, (sv.json || {}).created], [200, 1], [404, undefined]);
  eq('4b ACME Limited was not chosen → not created; still listed', ((await http.get('/api/customers/unsaved')).json || []).map(u => u.name), ['ACME Limited']);
  const aud = dbc ? (await dbc.query(`SELECT count(*)::int AS n FROM audit_trail WHERE table_name = 'customers' AND action = 'CREATE' AND COALESCE(new_data::text, new_value, '') LIKE '%Legacy Client%'`)).rows[0].n : -1;
  eq('4c "Save all" writes an audit row for each contact it creates (Legacy Client: 1)', aud, 1, 0);

  const bill = (await http.post('/api/bills', { vendor: 'Fresh Vendor', amount: 60, status: 'unpaid', issue_date: '2026-07-21', idempotency_key: 'b9-b1' })).json || {};
  eq('5  a bill to a new vendor saves the vendor, linked', [(await vend()).filter(v => v.name === 'Fresh Vendor').length, !!((bill.row || bill).vendor_id)], [1, true], [0, false]);
  const vu = (await http.get('/api/vendors/unsaved')).json || [];
  eq('5b the vendors "not saved" list holds only the old bill\'s vendor', vu.map(v => v.name), ['Old Vendor']);
  eq('5c "Save all" for vendors → created 1', ((await http.post('/api/vendors/save-unsaved', { names: ['Old Vendor'] })).json || {}).created, 1, undefined);

  // per business: the same name in another business is its own contact
  await http.post('/api/entities/' + bizB + '/activate', {});
  await http.post('/api/invoices', { client: 'Acme Ltd', amount: 10, status: 'pending', issue_date: '2026-07-22', idempotency_key: 'b9-B1' });
  eq('6  in business B, "Acme Ltd" becomes B\'s own customer', (await custs()).filter(c => cname(c) === 'Acme Ltd' && c.entity_id === bizB).length, 1, 0);
  const allRaw = await http.get('/api/customers');
  await http.post('/api/entities/' + (await (async () => ((await http.get('/api/entities')).json || []).find(e => e.id !== bizB).id)()) + '/activate', {});
  eq('6b back in business A: still one Acme Ltd there', (await custs()).filter(c => cname(c) === 'Acme Ltd').length, 1);

  // a contact's display name is unique in its business (the industry rule) — a second "Acme Ltd" is refused, two people at
  // one company are fine, and a rename cannot take another contact's name
  const dupC = await http.post('/api/customers', { company: 'acme  ltd', fname: '', lname: '' });
  eq('9  a second customer called "Acme Ltd" is refused, naming the existing one', [dupC.status, (dupC.json || {}).code], [409, 'DUPLICATE_CONTACT'], [201, undefined]);
  eq('9b two people at the same company are fine (Ada One @ Acme Ltd)', (await http.post('/api/customers', { fname: 'Ada', lname: 'One', company: 'Acme Ltd' })).status, 201);
  const vs = await vend(); const fv = vs.find(v => v.name === 'Fresh Vendor') || {};
  eq('9c renaming a vendor to another vendor\'s name ("Supply Co") is refused', (await http.put('/api/vendors/' + fv.id, { name: 'Supply Co' })).status, 409, 200);

  // the forms pick from saved contacts
  await settle(10, 50);
  if (typeof w.loadCustomersFromDB === 'function') { try { await w.loadCustomersFromDB(); } catch (_) {} }
  try { w.openInvoiceModal(); } catch (_) {}
  await settle(6, 40);
  const ic = d.getElementById('inv-client'); const dl = ic && ic.getAttribute('list') && d.getElementById(ic.getAttribute('list'));
  A('7  the invoice form offers saved customers to pick (Acme Ltd, Beta Co, Legacy Client)', !!dl && ['Acme Ltd', 'Beta Co', 'Legacy Client'].every(n => [...dl.options].some(o => o.value === n)), dl ? [...dl.options].map(o => o.value).join(', ') : 'no list');
  try { w.closeModal('invoice-modal'); } catch (_) {}
  try { w.openNewBillModal(); } catch (_) {}
  await settle(6, 40);
  const bv = d.getElementById('bill-vendor'); const bdl = bv && bv.getAttribute('list') && d.getElementById(bv.getAttribute('list'));
  A('7b the bill form offers saved vendors (Supply Co, Fresh Vendor, Old Vendor)', !!bdl && ['Supply Co', 'Fresh Vendor', 'Old Vendor'].every(n => [...bdl.options].some(o => o.value === n)), bdl ? [...bdl.options].map(o => o.value).join(', ') : 'no list');
  try { w.closeModal('bill-modal'); } catch (_) {}

  // the Customers page: Save all with a preview that warns about the near-duplicate
  try { w.showPage('customers'); } catch (_) {}
  await settle(15, 50); try { w.renderCustomers && w.renderCustomers(); } catch (_) {} await settle(6, 40);
  if (typeof w.openSaveAllContacts === 'function') { w.openSaveAllContacts('customer'); await settle(6, 40); }
  const pv = ((d.getElementById('ff-saveall') || {}).textContent || '').replace(/\s+/g, ' ');
  A('8  "Save all" previews every name and warns: ACME Limited looks like Acme Ltd (unticked)', /ACME Limited/.test(pv) && /looks like/i.test(pv) && /Acme Ltd/.test(pv), JSON.stringify(pv.slice(0, 300)));
  const box = d.querySelector('#ff-saveall input[type=checkbox][data-name="ACME Limited"]');
  eq('8b …and the near-duplicate starts unticked', box ? box.checked : 'missing', false);
}, { extraSeed: async ({ client, userId }, r) => {
  const raw = (t, d) => client.query(`INSERT INTO ${t} (user_id, entity_id, data) VALUES ($1,$2,$3)`, [userId, r.ent, d]);
  await raw('invoices', { client: 'ACME Limited', amount: 120, status: 'pending', issue_date: '2026-06-02', due_date: '2026-07-02', number: 'OLD-1' });
  await raw('invoices', { client: 'Legacy Client', amount: 80, status: 'pending', issue_date: '2026-06-03', due_date: '2026-07-03', number: 'OLD-2' });
  await raw('bills', { vendor: 'Old Vendor', amount: 90, status: 'unpaid', issue_date: '2026-06-04', due_date: '2026-07-04' });
  dbc = client;
  bizB = (await client.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2) RETURNING id`, [userId, { name: 'Business B', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 0 }])).rows[0].id;
} });
