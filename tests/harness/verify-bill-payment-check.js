#!/usr/bin/env node
'use strict';
/**
 * verify-bill-payment-check.js — N57 class. Every bill-linked payment (POST / PUT /api/payments-made, bank
 * match-bill) is refused unless the bill is this account's, belongs to the payment's business, and the
 * payment fits in what is still owed.
 *
 * Defects: none of the three writers checked the remaining balance (amount_paid could exceed the bill —
 * AP goes negative, the overpayment is invisible) or the business (a payment stored under B settled A's
 * bill and posted to A's ledger); POST accepted another account's bill id.
 *
 * Seed: businesses A and B; bill in A for 500.
 *   POST 300 → 200; POST 300 more → 400 EXCEEDS_BILL_BALANCE, bill amount_paid stays 300   (bug: 200, 600)
 *   replay of the first POST (same idempotency key) → 200, the original row                 (control)
 *   POST from business B against A's bill → 400 BILL_ENTITY_MISMATCH                         (bug: 200)
 *   POST against another account's bill → 404                                                (bug: 200)
 *   PUT the 300 payment to 600 → 400; PUT to 250 → 200 (amount_paid 250)                     (bug: 200 → 600)
 *   bank debit (A) 300 matched to the bill (remaining 250) → 400, bank row still unreconciled (bug: 200)
 *   bank debit (B) 100 matched to A's bill → 400                                              (bug: 200)
 *   bank debit (A) 250 matched → 200, bill paid, amount_paid 500                              (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-bill-payment-check.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'bill-pay-pw-1';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const uid = await mk('bp@finflow.test'), other = await mk('bp-other@finflow.test');
    const ent = async (u, name, active) => (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [u, { name, currency: 'USD', is_active: active }])).rows[0].id;
    const eA = await ent(uid, 'A Co', 1), eB = await ent(uid, 'B Co', 0), eO = await ent(other, 'Other Co', 1);
    const bill = (await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { vendor: 'Supplier', amount: 500, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-08-01' }])).rows[0].id;
    const otherBill = (await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [other, eO, { vendor: 'X', amount: 900, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-01' }])).rows[0].id;
    const bank = async (e, amt) => (await c.query(`INSERT INTO personal_transactions (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, e, { source: 'banking', tx_type: 'debit', amount: amt, tx_date: '2026-07-20', description: 'Bank debit ' + amt }])).rows[0].id;
    const paid = async () => Number((await c.query(`SELECT data->>'amount_paid' p FROM bills WHERE id=$1`, [bill])).rows[0].p);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.57.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'bp@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  BILL-LINKED PAYMENTS — owned, same business, within the balance');
    console.log('='.repeat(78));
    const p1 = await h.post(`/api/payments-made?entity_id=${eA}`, { vendor: 'Supplier', amount: 300, date: '2026-07-10', bill_id: bill, idempotency_key: 'bp-key-1' });
    A('POST 300 against the 500 bill → 200', p1.status === 200 && p1.json && p1.json.id, `status ${p1.status} ${p1.text.slice(0, 120)}`);
    const p2 = await h.post(`/api/payments-made?entity_id=${eA}`, { vendor: 'Supplier', amount: 300, date: '2026-07-11', bill_id: bill, idempotency_key: 'bp-key-2' });
    A('POST 300 more → 400 EXCEEDS_BILL_BALANCE (bug: 200, overpaid)', p2.status === 400 && p2.json && p2.json.code === 'EXCEEDS_BILL_BALANCE', `status ${p2.status} ${p2.text.slice(0, 120)}`);
    A('  bill amount_paid stays 300 (bug: 600)', (await paid()) === 300, 'paid=' + await paid());
    const p1r = await h.post(`/api/payments-made?entity_id=${eA}`, { vendor: 'Supplier', amount: 300, date: '2026-07-10', bill_id: bill, idempotency_key: 'bp-key-1' });
    A('control: replay of the first POST (same key) → 200, the original row', p1r.status === 200 && p1r.json && p1r.json.id === p1.json.id, `status ${p1r.status} id ${p1r.json && p1r.json.id}`);
    const pB = await h.post(`/api/payments-made?entity_id=${eB}`, { vendor: 'Supplier', amount: 50, date: '2026-07-12', bill_id: bill });
    A("POST from business B against A's bill → 400 BILL_ENTITY_MISMATCH (bug: 200)", pB.status === 400 && pB.json && pB.json.code === 'BILL_ENTITY_MISMATCH', `status ${pB.status}`);
    const pO = await h.post(`/api/payments-made?entity_id=${eA}`, { vendor: 'X', amount: 10, date: '2026-07-12', bill_id: otherBill });
    A("POST against another account's bill → 404 (bug: 200)", pO.status === 404, `status ${pO.status}`);
    const u1 = await h.put(`/api/payments-made/${p1.json.id}?entity_id=${eA}`, { amount: 600 });
    A('PUT the payment to 600 → 400 (bug: 200, amount_paid 600)', u1.status === 400 && (await paid()) === 300, `status ${u1.status} paid=${await paid()}`);
    const u2 = await h.put(`/api/payments-made/${p1.json.id}?entity_id=${eA}`, { amount: 250 });
    A('control: PUT to 250 → 200, amount_paid 250', u2.status === 200 && (await paid()) === 250, `status ${u2.status} paid=${await paid()}`);

    const bk1 = await bank(eA, 300);
    const m1 = await h.post(`/api/bank-reconciliation/match-bill?entity_id=${eA}`, { banking_id: bk1, bill_id: bill });
    A('bank debit 300 matched to the bill (remaining 250) → 400 (bug: 200, overpaid)', m1.status === 400 && m1.json && m1.json.code === 'EXCEEDS_BILL_BALANCE', `status ${m1.status} ${m1.text.slice(0, 100)}`);
    const st1 = (await c.query(`SELECT data->>'reconcile_state' s FROM personal_transactions WHERE id=$1`, [bk1])).rows[0].s;
    A('  bank row still unreconciled; amount_paid still 250', st1 == null && (await paid()) === 250, `state ${st1} paid ${await paid()}`);
    const bk2 = await bank(eB, 100);
    const m2 = await h.post(`/api/bank-reconciliation/match-bill?entity_id=${eB}`, { banking_id: bk2, bill_id: bill });
    A("bank debit from business B matched to A's bill → 400 (bug: 200)", m2.status === 400 && m2.json && m2.json.code === 'BILL_ENTITY_MISMATCH', `status ${m2.status}`);
    const bk3 = await bank(eA, 250);
    const m3 = await h.post(`/api/bank-reconciliation/match-bill?entity_id=${eA}`, { banking_id: bk3, bill_id: bill });
    const st = (await c.query(`SELECT data->>'status' s FROM bills WHERE id=$1`, [bill])).rows[0].s;
    A('control: bank debit 250 matched → 200, bill paid, amount_paid 500', m3.status === 200 && st === 'paid' && (await paid()) === 500, `status ${m3.status} bill ${st} paid ${await paid()}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (bill payment check)` : `  ALL GREEN — ${pass} passed, 0 failed  (bill payment check)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
