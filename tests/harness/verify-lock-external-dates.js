#!/usr/bin/env node
'use strict';
/**
 * verify-lock-external-dates.js — N9b (N9 class). A money row whose date comes from OUTSIDE the request —
 * the bank transaction or the Stripe charge — is refused when that date is in a closed period.
 *
 * Defect: the period-lock guard reads dates from the request body. Bank book-expense / match-bill and
 * Stripe import-charge / import-refund / match-invoice take the date from the bank row or the charge, so
 * they booked straight into closed periods. Stripe match-invoice also accepted an invoice of a different
 * business than the one the Stripe account books to.
 *
 * Seed: business A, books closed through 2026-06-30 (today 2026-07-25). Bank debits dated 2026-06-15 and
 * 2026-07-20; Stripe charges created 2026-06-15 and 2026-07-20 (mocked at the Stripe HTTP boundary only).
 *   June-dated: book-expense / match-bill / import-charge / import-refund → 403 PERIOD_LOCKED, no row   (bug: 200, row in a closed month)
 *   July-dated: the same four → 200                                                                     (control)
 *   match-invoice with the books closed through today → 403; reopened → 200                             (bug: 200)
 *   match-invoice against business B's invoice → 400 INVOICE_ENTITY_MISMATCH                            (bug: 200)
 *   node -r ./tests/harness/clock.js tests/harness/verify-lock-external-dates.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || 'ca_harness';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const JUNE = Math.floor(Date.UTC(2026, 5, 15, 16) / 1000), JULY = Math.floor(Date.UTC(2026, 6, 20, 16) / 1000);
const CH = {
  ch_june: { id: 'ch_june', amount: 1000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'June sale', created: JUNE },
  ch_july: { id: 'ch_july', amount: 2000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'July sale', created: JULY },
  ch_rfjune: { id: 'ch_rfjune', amount: 500, amount_refunded: 500, currency: 'usd', status: 'succeeded', paid: true, refunded: true, created: JUNE, refunds: { data: [{ created: JUNE }] } },
  ch_rfjuly: { id: 'ch_rfjuly', amount: 700, amount_refunded: 700, currency: 'usd', status: 'succeeded', paid: true, refunded: true, created: JULY, refunds: { data: [{ created: JULY }] } },
  ch_inv: { id: 'ch_inv', amount: 30000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Invoice payment', created: JULY },
  ch_invb: { id: 'ch_invb', amount: 40000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Invoice payment B', created: JULY },
};

(async () => {
  let scratch, server;
  const realFetch = global.fetch;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith('https://api.stripe.com/v1/charges/')) {
        const id = decodeURIComponent(u.split('/v1/charges/')[1].split('?')[0]);
        if (CH[id]) return { ok: true, status: 200, json: async () => CH[id] };
        return { ok: false, status: 404, json: async () => ({ error: { message: 'No such charge' } }) };
      }
      return realFetch(url, opts);
    };
    const PW = 'lock-ext-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'lx@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_lx', linked_at: '2026-07-01T00:00:00Z' }) }]);
    const lockId = (await c.query(`INSERT INTO lock_settings (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { enabled: 1, lock_date: '2026-06-30' }])).rows[0].id;
    const bank = async (ymd, amt) => (await c.query(`INSERT INTO personal_transactions (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { source: 'banking', tx_type: 'debit', amount: amt, tx_date: ymd, description: 'Debit ' + ymd }])).rows[0].id;
    const bill = (await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { vendor: 'V', amount: 1000, amount_paid: 0, status: 'unpaid', issue_date: '2026-05-01' }])).rows[0].id;
    for (const ch of ['ch_rfjune', 'ch_rfjuly']) await c.query(`INSERT INTO sales_receipts (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { customer: 'C', amount: CH[ch].amount / 100, date: '2026-05-10', idempotency_key: 'stripe-charge:' + ch }]);
    const invA = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { client: 'C', amount: 300, amount_paid: 0, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01' }])).rows[0].id;
    const invB = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eB, { client: 'C', amount: 400, amount_paid: 0, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01' }])).rows[0].id;
    const count = async (t) => Number((await c.query(`SELECT COUNT(*) n FROM ${t} WHERE user_id=$1`, [uid])).rows[0].n);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.92.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'lx@finflow.test', password: PW })).status === 200);
    const q = `?entity_id=${eA}`;

    console.log('\n' + '='.repeat(78));
    console.log('  CLOSED PERIOD — dates taken from the bank row / the Stripe charge');
    console.log('='.repeat(78));
    const exp0 = await count('expenses');
    const r1 = await h.post('/api/bank-reconciliation/book-expense' + q, { banking_id: await bank('2026-06-15', 40) });
    A('book-expense of a June bank debit → 403 PERIOD_LOCKED (bug: 200)', r1.status === 403 && r1.json && r1.json.code === 'PERIOD_LOCKED', `status ${r1.status}`);
    A('  no expense row created', (await count('expenses')) === exp0);
    const r2 = await h.post('/api/bank-reconciliation/book-expense' + q, { banking_id: await bank('2026-07-20', 41) });
    A('control: book-expense of a July bank debit → 200', r2.status === 200, `status ${r2.status} ${r2.text.slice(0, 100)}`);
    const pm0 = await count('payments_made');
    const r3 = await h.post('/api/bank-reconciliation/match-bill' + q, { banking_id: await bank('2026-06-16', 100), bill_id: bill });
    A('match-bill of a June bank debit → 403 (bug: 200)', r3.status === 403, `status ${r3.status}`);
    A('  no payment row created', (await count('payments_made')) === pm0);
    const r4 = await h.post('/api/bank-reconciliation/match-bill' + q, { banking_id: await bank('2026-07-21', 100), bill_id: bill });
    A('control: match-bill of a July bank debit → 200', r4.status === 200, `status ${r4.status} ${r4.text.slice(0, 100)}`);
    const sr0 = await count('sales_receipts');
    const r5 = await h.post('/api/stripe/import-charge' + q, { charge_id: 'ch_june', confirm: true });
    A('import-charge of a June Stripe charge → 403 (bug: 200)', r5.status === 403, `status ${r5.status} ${r5.text.slice(0, 100)}`);
    A('  no receipt created', (await count('sales_receipts')) === sr0);
    const r6 = await h.post('/api/stripe/import-charge' + q, { charge_id: 'ch_july', confirm: true });
    A('control: import-charge of a July charge → 200', r6.status === 200 && r6.json && r6.json.imported, `status ${r6.status} ${r6.text.slice(0, 100)}`);
    const r7 = await h.post('/api/stripe/import-refund' + q, { charge_id: 'ch_rfjune' });
    A('import-refund dated June → 403 (bug: 200)', r7.status === 403, `status ${r7.status} ${r7.text.slice(0, 100)}`);
    const r8 = await h.post('/api/stripe/import-refund' + q, { charge_id: 'ch_rfjuly' });
    A('control: import-refund dated July → 200', r8.status === 200, `status ${r8.status} ${r8.text.slice(0, 100)}`);
    const rB = await h.post('/api/stripe/match-invoice' + q, { charge_id: 'ch_invb', invoice_id: invB });
    A("match-invoice against business B's invoice → 400 INVOICE_ENTITY_MISMATCH (bug: 200)", rB.status === 400 && rB.json && rB.json.code === 'INVOICE_ENTITY_MISMATCH', `status ${rB.status} ${rB.text.slice(0, 100)}`);
    await c.query(`UPDATE lock_settings SET data = data || '{"lock_date":"2026-07-31"}'::jsonb WHERE id=$1`, [lockId]);
    const ip0 = await count('invoice_payments');
    const r9 = await h.post('/api/stripe/match-invoice' + q, { charge_id: 'ch_inv', invoice_id: invA });
    A('match-invoice with the books closed through today → 403 (bug: 200)', r9.status === 403, `status ${r9.status} ${r9.text.slice(0, 100)}`);
    A('  no invoice payment recorded', (await count('invoice_payments')) === ip0);
    await c.query(`UPDATE lock_settings SET data = data || '{"lock_date":"2026-06-30"}'::jsonb WHERE id=$1`, [lockId]);
    const r10 = await h.post('/api/stripe/match-invoice' + q, { charge_id: 'ch_inv', invoice_id: invA });
    A('control: reopened → match-invoice 200', r10.status === 200, `status ${r10.status} ${r10.text.slice(0, 100)}`);
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (lock: external dates)` : `  ALL GREEN — ${pass} passed, 0 failed  (lock: external dates)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
