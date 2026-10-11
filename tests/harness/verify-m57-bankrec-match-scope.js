'use strict';
/**
 * M57 (personal/business wall, 2026-10-10): bank reconciliation matches only a bank line of the business in view to that
 * business's payment. Personal → business: NOTHING.
 * BUG: POST /api/bank-reconciliation/match and /match-batch accepted ANY of the user's transactions by id — a PERSONAL
 * transaction (incl. a personal-feed bank deposit) could be matched to a business invoice payment, and another
 * business's bank line too; the "matched" list (GET /api/bank-reconciliation) was not filtered by business, so it
 * showed personal rows and other businesses' matches.
 * Seed (Rule 4 — 500 / 510 / 520 / 530 all differ): businesses A and B.
 *   personal-feed deposit 500 (no business) · A: bank credit 510 + invoice payment 510 · B: bank credit 520 +
 *   invoice payment 520 · A: second invoice payment 530 (the target the bad matches try to use)
 *   match personal → A's 530 payment → refused (bug 201) · batch with it → refused (bug 201)
 *   match B's bank line → A's 530 payment (from A) → refused (bug 201)
 *   control: A line 510 ↔ A payment 510 (201); B line ↔ B payment from B (201)
 *   A's matched list: [510] only (bug: + the personal and B matches)
 */
const { run } = require('./moneyFixKit.js');

run('M57 — bank reconcile matches stay inside one business', async ({ newOwner, c, eq, A }) => {
  const o = await newOwner('M57', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'USD' }]);
  const [eA, eB] = o.ids;
  const pay = async (eid, amt, k) => {
    const inv = await o.J('POST', '/api/invoices?entity_id=' + eid, { client: 'Cust ' + k, amount: amt, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-30', idempotency_key: 'm57-i' + k });
    return o.J('POST', '/api/invoice-payments?entity_id=' + eid, { invoice_id: inv.id, amount: amt, payment_date: '2026-07-05', idempotency_key: 'm57-p' + k });
  };
  const pA = await pay(eA, 510, 'a'), pB = await pay(eB, 520, 'b'), pA2 = await pay(eA, 530, 'a2');
  const lineA = await o.J('POST', '/api/banking?entity_id=' + eA, { desc: 'DEPOSIT A', amount: 510, type: 'credit', date: '2026-07-06' });
  const lineB = await o.J('POST', '/api/banking?entity_id=' + eB, { desc: 'DEPOSIT B', amount: 520, type: 'credit', date: '2026-07-06' });
  const personal = (await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
    [o.uid, { description: 'SALARY DEPOSIT', amount: 500, tx_type: 'credit', tx_date: '2026-07-06', source: 'banking' }])).rows[0].id;

  const match = (eid, b, p) => o.http.post('/api/bank-reconciliation/match?entity_id=' + eid, { banking_id: b, invoice_payment_id: p });
  eq('personal transaction matched to a business payment: refused', (await match(eA, personal, pA2.id)).status >= 400, true, false);
  eq('batch containing a personal transaction: refused', (await o.http.post('/api/bank-reconciliation/match-batch?entity_id=' + eA, { matches: [{ banking_id: personal, invoice_payment_id: pA2.id }] })).status >= 400, true, false);
  eq("business B's bank line matched from business A: refused", (await match(eA, lineB.id, pA2.id)).status >= 400, true, false);
  A('control: A matches its own line to its own payment', (await match(eA, lineA.id, pA.id)).status === 201);
  A('control: B matches its own line from B', (await match(eB, lineB.id, pB.id)).status === 201);
  const { rows: [{ n }] } = await c.query(`SELECT COUNT(*)::int AS n FROM bank_reconciliation WHERE user_id = $1 AND banking_id = $2`, [o.uid, personal]);
  eq('no match row exists for the personal transaction', n, 0, 1);
  const recA = await o.J('GET', '/api/bank-reconciliation?entity_id=' + eA);
  const amts = (recA.matched || []).map(m => Number(m.bank_amount != null ? m.bank_amount : (m.amount != null ? m.amount : m.payment_amount))).sort((a, b) => a - b);
  eq("A's matched list: A's match only", (recA.matched || []).length, 1, 3);
  A("A's matched list never shows the personal deposit", !JSON.stringify(recA.matched || []).includes('SALARY DEPOSIT'), JSON.stringify(recA.matched).slice(0, 300));
});
