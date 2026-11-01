'use strict';
/**
 * verify-new14-stale-bank-match — NEW-14 (found 2026-11-01 building G15): a Bank Rec match (bank_reconciliation) outlived
 * the records it joined. Delete the matched INVOICE PAYMENT and the bank line stayed "matched" to nothing — it vanished
 * from both the to-match list and the matched list. Delete the matched BANK LINE and the payment stayed "matched" — it
 * vanished from the payments to match, for good. Now a match goes with either side (and G15's cash move with it).
 * Real server, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new14-stale-bank-match.js
 *
 * Bug values: the line / payment is in neither list after the other side is deleted.
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('NEW-14 — a bank match goes with the payment or the bank line', async ({ eq, J, http, c, uid }) => {
  const ent = (await J('GET', '/api/entities'))[0];
  const line = async (desc, amt) => (await J('POST', '/api/banking', { desc, amount: amt, type: 'credit', date: '2026-07-20' })).id;
  const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 700, status: 'pending', issue_date: '2026-07-01', idempotency_key: 'n14-i' });
  const p1 = await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 300, payment_date: '2026-07-20', idempotency_key: 'n14-p1' });
  const p2 = await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-07-20', idempotency_key: 'n14-p2' });
  const l1 = await line('Acme part 1', 300), l2 = await line('Acme part 2', 400);
  await J('POST', '/api/bank-reconciliation/match', { banking_id: l1, invoice_payment_id: p1.id });
  await J('POST', '/api/bank-reconciliation/match', { banking_id: l2, invoice_payment_id: p2.id });
  const rec = async () => { const r = await J('GET', '/api/bank-reconciliation'); return { lines: r.unmatchedBanking.map(x => x.id), pays: r.unmatchedPayments.map(x => x.id), matched: r.matched.length }; };
  eq('premise: both matched', (await rec()).matched, 2);
  eq('delete payment 1 → 200', (await http.del('/api/invoice-payments/' + p1.id)).status, 200);
  const a = await rec();
  eq('its bank line is back in the lines to match', a.lines.includes(l1), true, false);
  eq('no match row is left pointing at the deleted payment', (await c.query(`SELECT count(*)::int n FROM bank_reconciliation WHERE invoice_payment_id = $1`, [p1.id])).rows[0].n, 0, 1);
  eq('delete bank line 2 → 200', (await http.del('/api/banking/' + l2)).status, 200);
  const b = await rec();
  eq('its payment is back in the payments to match', b.pays.includes(p2.id), true, false);
  eq('no match rows left', (await c.query(`SELECT count(*)::int n FROM bank_reconciliation WHERE user_id = $1`, [uid])).rows[0].n, 0, 2);
}, {});
