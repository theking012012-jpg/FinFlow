'use strict';
/**
 * C16 (Cowork end-to-end test 2.5a): a bill past its due date with a balance shows "overdue" on its row — the same
 * rule the Overdue card uses.
 * BUG: the row badge printed the stored status, "unpaid" (nothing stores "overdue"), while the summary card counted the
 * bill as overdue.
 * Seed: clientMoneyKit (today 2026-07-25): bill Supply Co 400, due 2026-07-10, unpaid  → "overdue"   bug: "unpaid"
 *   + bill Later Co 90, due 2026-08-30 (control) → "unpaid"
 */
const { run } = require('./clientMoneyKit.js');

run('C16 — overdue bills say overdue', async ({ w, d, settle, eq }) => {
  try { w.showPage('bills'); } catch (_) {}
  await settle(25, 60);
  if (typeof w.renderBills === 'function') { w.renderBills(); await settle(10, 40); }
  const badge = vendor => { const row = Array.from(d.querySelectorAll('#bills-list .table-row')).find(r => r.textContent.includes(vendor)); const b = row && Array.from(row.querySelectorAll('.badge')).pop(); return b ? b.textContent.trim() : null; };
  eq('Supply Co (past due, unpaid) shows overdue', badge('Supply Co'), 'overdue', 'unpaid');
  eq('control: Later Co (not yet due) shows unpaid', badge('Later Co'), 'unpaid');
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/bills', { vendor: 'Later Co', amount: 90, status: 'unpaid', issue_date: '2026-07-20', due_date: '2026-08-30', idempotency_key: 'c16-b' });
  if (r.status >= 300) throw new Error('bill ' + r.status);
} });
