'use strict';
/**
 * verify-b8-payment-terms.js — plan batch 8 (B1c + rest of G1; gap audit 2026-10-22: "Due TBD" on most invoices).
 * Before: the due date was optional and stayed empty ("TBD" everywhere, never overdue); Settings "Payment terms (days)"
 * and "Default tax rate (%)" were read and saved by nothing; the invoice template printed a fixed "Due within 30 days".
 * After (better than standard): payment terms per business (Settings, validated); an invoice left without a due date is
 * due on issue date + terms; the form shows that due date LIVE as you type; the printed terms follow the business; an
 * old invoice with no due date says "No due date" (never "TBD"); the tax-rate field is gone (D6 — no VAT engine).
 *
 * The REAL SPA + real server; clock 2026-07-25. Extra seed: a legacy invoice inserted with NO due date.
 */
const { run } = require('./clientMoneyKit.js');

run('Batch 8 — payment terms per business, due dates computed, shown live, printed truthfully', async ({ w, d, settle, eq, A, http }) => {
  try { w.showPage('settings'); } catch (_) {}
  await settle(10, 50); try { w._ffApplyEntityProfile && w._ffApplyEntityProfile(); } catch (_) {}
  eq('1  Settings: the tax-rate field is gone (no VAT/GST engine — D6)', !!d.getElementById('s-tax-rate'), false, true);
  const t = d.getElementById('s-pay-terms');
  eq('1b Settings shows this business\'s terms (30 by default)', t && t.value, '30');
  if (t) t.value = '15';
  await w.saveSettings(); await settle(15, 60);
  const ent = ((await http.get('/api/entities')).json || []).find(e => e.is_active == 1 || e.is_active === true) || {};
  eq('1c saving stores Net 15 on the business', Number(ent.payment_terms), 15, NaN);

  const mk = async (b) => (await http.post('/api/invoices', Object.assign({ client: 'Terms Co', amount: 100, status: 'pending', idempotency_key: 'b8-' + Math.random() }, b))).json || {};
  eq('2  an invoice left without a due date is due on issue + 15 days', String((await mk({ issue_date: '2026-07-01' })).due_date || '').slice(0, 10), '2026-07-16', '');
  eq('3  a due date you type is kept', String((await mk({ issue_date: '2026-07-01', due_date: '2026-09-01' })).due_date || '').slice(0, 10), '2026-09-01');
  eq('4  terms that are not 0–365 whole days are refused', (await http.put('/api/entities/' + ent.id, { payment_terms: 'soon' })).status, 400, 200);

  try { w.showPage('invoices'); } catch (_) {}
  await settle(10, 50);
  if (typeof w.loadInvoicesFromDB === 'function') { try { await w.loadInvoicesFromDB(); } catch (_) {} }
  try { w.renderInvoices(); } catch (_) {} await settle(4, 40);
  const list = ((d.getElementById('invoice-list') || {}).textContent || '').replace(/\s+/g, ' ');
  A('5  the list shows real due dates; the old invoice with none says "No due date" — never "TBD"', /No due date/.test(list) && !/TBD/.test(list) && /Jul 16/.test(list), list.slice(0, 300));

  try { w.openInvoiceModal(); } catch (_) {}
  await settle(4, 40);
  const iss = d.getElementById('inv-issue'); if (iss) { iss.value = '2026-08-01'; iss.dispatchEvent(new w.Event('input')); }
  await settle(2, 20);
  const hint = ((d.getElementById('inv-due-hint') || {}).textContent || '').replace(/\s+/g, ' ');
  A('6  the form says the due date live as you type: Aug 16 2026 (Net 15)', /Aug 16 2026/.test(hint) && /Net 15/.test(hint), JSON.stringify(hint));
  try { w.closeModal('invoice-modal'); } catch (_) {}

  const tpl = typeof w.buildInvoiceHTML === 'function' ? String(w.buildInvoiceHTML('classic', null, {})) : '';
  A('7  the invoice template prints this business\'s terms (15 days), not a fixed 30', /15 days/.test(tpl) && !/30 days/.test(tpl), (tpl.match(/Payment terms:[^<]*<\/strong>[^<]*/) || [''])[0]);
}, { extraSeed: async ({ client, userId }, r) => {
  await client.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1, $2, $3)`, [userId, r.ent, { client: 'Legacy No Due', amount: 75, status: 'pending', issue_date: '2026-05-01', number: 'LEG-1' }]);
} });
