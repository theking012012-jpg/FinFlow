'use strict';
/**
 * verify-fam5b-bill-terms.js — FA-M5b (full app audit M5: "5 of 8 bills have no due date"). Batch 8 (B1c) gave
 * INVOICES a due date from the business's payment terms; bills kept none: a bill entered without a due date was never
 * due, never overdue, and missing from every "due" figure. After: a bill left without a due date is due on its issue
 * date + this business's payment terms (the same rule and the same Settings field as invoices); the bill form shows
 * that date live as you type; a typed due date is kept; an old bill with none says "No due date" (not "—").
 *
 * The REAL SPA + real server (clientMoneyKit); clock 2026-07-25. Terms set to Net 15 so the default (30) cannot pass.
 *   bill issued 2026-07-01, no due date → due 2026-07-16   (bug: no due date)
 *   bill issued 2026-06-01, no due date → due 2026-06-16; both are OVERDUE on 25 Jul → Overdue card $720 (bug: $400)
 */
const { run } = require('./clientMoneyKit.js');

run('FA-M5b — bills get a due date from the payment terms, like invoices', async ({ w, d, settle, eq, A, http }) => {
  // Net 15 through the real Settings screen (so the page holds what the server holds), as verify-b8-payment-terms does
  try { w.showPage('settings'); } catch (_) {}
  await settle(10, 50); try { w._ffApplyEntityProfile && w._ffApplyEntityProfile(); } catch (_) {}
  const t = d.getElementById('s-pay-terms'); if (t) t.value = '15';
  await w.saveSettings(); await settle(15, 60);
  const ent = ((await http.get('/api/entities')).json || []).find(e => e.is_active == 1 || e.is_active === true) || {};
  eq('setup: Net 15 saved on the business', Number(ent.payment_terms), 15, NaN);
  const mk = async (b) => (await http.post('/api/bills', Object.assign({ vendor: 'Terms Supplies', amount: 200, status: 'unpaid', idempotency_key: 'm5b-' + Math.random() }, b))).json || {};
  eq('1  a bill left without a due date is due on issue + 15 days (bug: none)', String((await mk({ issue_date: '2026-07-01' })).due_date || '').slice(0, 10), '2026-07-16', '');
  eq('2  a due date you type is kept', String((await mk({ issue_date: '2026-07-01', due_date: '2026-09-30' })).due_date || '').slice(0, 10), '2026-09-30');
  const old = await mk({ issue_date: '2026-06-01', amount: 120 });
  eq('3  a June bill with no due date is due 16 Jun', String(old.due_date || '').slice(0, 10), '2026-06-16', '');

  try { w.showPage('bills'); } catch (_) {}
  await settle(12, 50);
  try { if (typeof w.loadBillsFromDB === 'function') await w.loadBillsFromDB(); } catch (_) {}
  try { w.renderBills(); } catch (_) {} await settle(4, 40);
  const list = ((d.getElementById('bills-list') || d.getElementById('bill-list') || {}).textContent || '').replace(/\s+/g, ' ');
  A('4  the list shows the computed due date (Jul 16 2026) and the legacy bill says "No due date" (bug: "—")', /Jul 16,? 2026/.test(list) && /No due date/.test(list), list.slice(0, 400));
  const cards = [...d.querySelectorAll('#page-bills .mc-val')].map(e => e.textContent.trim());
  // hand-computed on 25 Jul: seed's overdue $400 + the $200 bill due 16 Jul + the $120 bill due 16 Jun = $720 (the
  // bill due 30 Sep and the legacy bill with no due date are not overdue)
  A('5  both new bills with computed due dates are overdue on 25 Jul: the Overdue card reads $720 (bug: $400)', cards[2] === '$720', cards.join(' | '));

  try { w.openNewBillModal(); } catch (_) {}
  await settle(4, 40);
  const iss = d.getElementById('bill-issue'); if (iss) { iss.value = '2026-08-01'; iss.dispatchEvent(new w.Event('input')); }
  await settle(2, 20);
  const hint = ((d.getElementById('bill-due-hint') || {}).textContent || '').replace(/\s+/g, ' ');
  A('6  the bill form says the due date live: Aug 16 2026 (Net 15)', /Aug 16,? 2026/.test(hint) && /Net 15/.test(hint), JSON.stringify(hint));
  try { w.closeModal('bill-modal'); } catch (_) {}
}, { extraSeed: async ({ client, userId }, r) => {
  await client.query(`INSERT INTO bills (user_id, entity_id, data) VALUES ($1, $2, $3)`, [userId, r.ent, { vendor: 'Legacy Vendor', amount: 40, status: 'unpaid', issue_date: '2026-05-01' }]);
} });
