'use strict';
/**
 * M24 (money audit 2026-10-09): the dashboard's overdue (/api/reports) and the AR report / portal / reminders
 * (computeBooks.arSummary) must be the SAME figure.
 * BUG: /api/reports filtered by status, so a past-due invoice whose status reads 'paid' with a balance still
 * owing (the legacy M5 shape) counted on the AR report but not on the dashboard.
 * Seed (today pinned 2026-07-25): A 'paid' with amount_paid 0, 500, due 2026-06-30 (legacy SQL row)
 *                                 B pending 200 due 2026-07-01 · C pending 100 due 2026-08-15 (not yet due)
 *   correct overdue on BOTH = 700 · bug: dashboard 200, AR report 700
 */
const { run } = require('./moneyFixKit.js');

run('M24 — one overdue definition', async ({ newOwner, c, eq }) => {
  const { uid, J, ids } = await newOwner('M24');
  await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
    [uid, ids[0], { client: 'Legacy', amount: 500, amount_paid: 0, status: 'paid', issue_date: '2026-06-01', due_date: '2026-06-30' }]);
  await J('POST', '/api/invoices', { client: 'Beta', amount: 200, status: 'pending', issue_date: '2026-06-05', due_date: '2026-07-01', idempotency_key: 'm24-b' });
  await J('POST', '/api/invoices', { client: 'Gamma', amount: 100, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-15', idempotency_key: 'm24-c' });
  const rep = await J('GET', '/api/reports');
  const ar = await J('GET', '/api/reports/ar-by-customer');
  eq('dashboard overdue (/api/reports)', rep.overdue, 700, 200);
  eq('AR report overdue (control)', ar.overdueTotal, 700);
  eq('the two agree', rep.overdue === ar.overdueTotal, true, false);
  eq('outstanding (control)', rep.outstanding, 800);
});
