'use strict';
/**
 * verify-n102-entity-record-dates.js — N102 (prior audit; the C3/F88 residual). A business record whose date the
 * SERVER fills in must carry the ENTITY's calendar date — books have a timezone, the server's UTC does not
 * (CLAUDE.md Rule 10, F88). F88 fixed this for expenses / journals / receipts / payments-received / credit notes /
 * payments made / vendor credits (`x || await entityTodayYmd(eid)`), but every path below still stamped the UTC
 * day — and the period-lock guard already assumed "no date ⇒ the route defaults to the entity's today", so the
 * lock checked one day and the row was written on another.
 *
 * Pinned instant 2026-07-25T16:00Z = 2026-07-26 01:00 in Asia/Tokyo. Tokyo entity, no date sent:
 *   expected 2026-07-26 · bug 2026-07-25 (UTC)
 * Stripe instants are genuine timestamps and resolve in the entity zone too:
 *   charge created 2026-07-20T20:00Z ⇒ 2026-07-21 (bug 07-20) · refund created 2026-07-22T18:00Z ⇒ 07-23 (bug 07-22)
 *   match-invoice books the payment ON THE CHARGE's date (07-21), like its own fee row — bug: today (UTC 07-25)
 * FX settlement GL entry: settled now ⇒ 07-26; GL backfill of a settlement at 2026-07-20T20:00Z ⇒ 07-21 (bug 07-20).
 * Control: a UTC (no-timezone) entity still gets 2026-07-25 — the default is not shifted unconditionally.
 *
 * EXECUTED: real Postgres, the real routes over HTTP; only Stripe's HTTP API is mocked (global.fetch), webhooks
 * are signed with the real stripe library.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-n102-entity-record-dates.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_secret';
process.env.STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || 'ca_harness';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const T = s => Math.floor(Date.parse(s) / 1000);
const CH = {
  ch_imp: { id: 'ch_imp', amount: 5000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Order 1', balance_transaction: { fee: 175, currency: 'usd' },
            created: T('2026-07-20T20:00:00Z'), amount_refunded: 1000, refunds: { data: [{ id: 're_1', created: T('2026-07-22T18:00:00Z') }] } },
  ch_mat: { id: 'ch_mat', amount: 30000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Invoice payment', balance_transaction: { fee: 900, currency: 'usd' },
            created: T('2026-07-20T20:00:00Z') },
};

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server; const realFetch = global.fetch;
  try {
    server = await bootServer(scratch.url);
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith('https://api.stripe.com/v1/charges/')) {
        const id = decodeURIComponent(u.split('/v1/charges/')[1].split('?')[0]);
        return CH[id] ? { ok: true, status: 200, json: async () => CH[id] } : { ok: false, status: 404, json: async () => ({ error: { message: 'no such charge' } }) };
      }
      return realFetch(url, opts);
    };
    const mkUser = async (email, tz) => {
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
        [{ email, name: 'N102', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
      const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
        [uid, Object.assign({ name: 'N102 Co', currency: 'USD', is_active: 1 }, tz ? { timezone: tz } : {})])).rows[0].id;
      const http = new HarnessHttp(server.baseUrl);
      if ((await http.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + email);
      return { uid, eid, http };
    };
    const J = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
    const ymd = v => (v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)));
    const dataField = async (table, id, key) => ymd((await c.query(`SELECT data->>$2 AS v FROM ${table} WHERE id=$1`, [id, key])).rows[0]?.v);

    console.log('\n' + '='.repeat(78) + '\n  N102 — server-filled business dates are the ENTITY\'s calendar date\n' + '='.repeat(78) + '\n');
    const tk = await mkUser('n102-tokyo@finflow.test', 'Asia/Tokyo');
    const E = '2026-07-26';

    // invoices / bills with no issue_date
    const inv = J(await tk.http.post('/api/invoices', { client: 'Kyoto KK', amount: 400, status: 'pending' }), 'invoice');
    A('invoice, no issue_date ⇒ issue_date ' + E + ' (bug: null ⇒ dated by UTC created_at 07-25)', await dataField('invoices', inv.id, 'issue_date') === E,
      'issue_date=' + await dataField('invoices', inv.id, 'issue_date'));
    const le = (await c.query(`SELECT entry_date FROM ledger_entries WHERE source_type='invoice' AND source_id=$1`, [inv.id])).rows[0];
    A('…its GL entry is dated ' + E, le && ymd(le.entry_date) === E, 'entry_date=' + (le && ymd(le.entry_date)));
    const invP = J(await tk.http.post('/api/invoices', { client: 'Osaka KK', amount: 120, status: 'paid' }), 'paid invoice');
    const pp = (await c.query(`SELECT payment_date FROM invoice_payments WHERE invoice_id=$1`, [invP.id])).rows[0];
    A('invoice created paid ⇒ settling payment dated ' + E, pp && ymd(pp.payment_date) === E, 'payment_date=' + (pp && ymd(pp.payment_date)));
    const bill = J(await tk.http.post('/api/bills', { vendor: 'Tokyo Gas', amount: 90, due_date: '2026-08-20', status: 'unpaid' }), 'bill');
    A('bill, no issue_date ⇒ issue_date ' + E, await dataField('bills', bill.id, 'issue_date') === E, 'issue_date=' + await dataField('bills', bill.id, 'issue_date'));

    // manual invoice payment, timesheet, FX rate with no date
    const inv2 = J(await tk.http.post('/api/invoices', { client: 'Nagoya KK', amount: 300, status: 'pending', issue_date: '2026-07-01' }), 'invoice2');
    const ip = J(await tk.http.post('/api/invoice-payments', { invoice_id: inv2.id, amount: 100 }), 'invoice-payment');
    A('manual invoice payment, no payment_date ⇒ ' + E, ymd(ip.payment_date) === E, 'payment_date=' + ymd(ip.payment_date));
    const ts = J(await tk.http.post('/api/timesheet', { employee: 'Aiko', project: 'Audit', hours: 3 }), 'timesheet');
    A('timesheet, no date ⇒ ' + E, await dataField('timesheet', ts.id, 'date') === E, 'date=' + await dataField('timesheet', ts.id, 'date'));
    const fx = J(await tk.http.post('/api/fx-rates', { from_currency: 'JPY', to_currency: 'USD', rate: 0.0067 }), 'fx-rate');
    const fxd = (await c.query(`SELECT rate_date FROM fx_rates WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [tk.uid])).rows[0];
    A('FX rate, no rate_date ⇒ ' + E, fxd && ymd(fxd.rate_date) === E, 'rate_date=' + (fxd && ymd(fxd.rate_date)) + ' resp=' + JSON.stringify(fx).slice(0, 80));

    // accountant journal for the client, no date
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('n102-acc@finflow.test',$1,'Acc','N102','Firm','CODEN102','verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, tk.uid]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '203.0.113.102' });
    if ((await acc.post('/api/accountants/login', { email: 'n102-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login');
    const jr = J(await acc.post('/api/accountants/clients/' + tk.uid + '/journal', { description: 'Accrual', lines: [{ account: '6000', debit: 50, credit: 0 }, { account: '2000', debit: 0, credit: 50 }] }), 'acc journal');
    const jid = jr.id || (jr.journal && jr.journal.id);
    A('accountant journal, no date ⇒ ' + E, await dataField('journals', jid, 'date') === E, 'date=' + await dataField('journals', jid, 'date') + ' resp=' + JSON.stringify(jr).slice(0, 100));

    // Stripe webhooks: invoice "Pay now" checkout + charge.refunded
    const post = (evt) => { const payload = JSON.stringify(evt);
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return realFetch(server.baseUrl + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload }); };
    const inv3 = J(await tk.http.post('/api/invoices', { client: 'Sendai KK', amount: 200, status: 'pending', issue_date: '2026-07-02' }), 'invoice3');
    const w1 = await post({ id: 'evt_n102_co', type: 'checkout.session.completed', data: { object: { id: 'cs_n102', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      client_reference_id: String(inv3.id), amount_total: 20000, currency: 'usd', metadata: { kind: 'invoice_payment', invoice_id: String(inv3.id) } } } });
    const wp = (await c.query(`SELECT payment_date FROM invoice_payments WHERE invoice_id=$1 ORDER BY id`, [inv3.id])).rows;
    A('webhook "Pay now" payment ⇒ dated ' + E, w1.status === 200 && wp.length === 1 && ymd(wp[0].payment_date) === E, 'status=' + w1.status + ' rows=' + JSON.stringify(wp.map(r => ymd(r.payment_date))));
    await c.query(`INSERT INTO invoice_payments (user_id,entity_id,invoice_id,amount,payment_date,method,reference,notes,idempotency_key)
      VALUES ($1,$2,$3,50,'2026-07-03','Card (Stripe)','stripe-invpay:ch_wh','orig','stripe-invpay:ch_wh')`, [tk.uid, tk.eid, inv2.id]);
    const w2 = await post({ id: 'evt_n102_rf', type: 'charge.refunded', data: { object: { id: 'ch_wh', object: 'charge', currency: 'usd', amount_refunded: 2000, refunds: { data: [{ id: 're_wh' }] } } } });
    const rf = (await c.query(`SELECT payment_date FROM invoice_payments WHERE invoice_id=$1 AND amount < 0`, [inv2.id])).rows;
    A('webhook refund row ⇒ dated ' + E, w2.status === 200 && rf.length === 1 && ymd(rf[0].payment_date) === E, 'status=' + w2.status + ' rows=' + JSON.stringify(rf.map(r => ymd(r.payment_date))));

    // Stripe Connect: import charge / refund / match to invoice (genuine instants ⇒ entity-zone dates)
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [tk.uid, tk.eid, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_n102', linked_at: '2026-07-01T00:00:00Z' }) }]);
    const imp = J(await tk.http.post('/api/stripe/import-charge', { charge_id: 'ch_imp' }), 'import-charge');
    const rid = (imp.receipt && imp.receipt.id) || imp.id;
    A('Stripe import: receipt dated 2026-07-21 (charge 07-20T20:00Z in Tokyo; bug 07-20)', await dataField('sales_receipts', rid, 'date') === '2026-07-21', 'date=' + await dataField('sales_receipts', rid, 'date'));
    const fee1 = (await c.query(`SELECT data->>'expense_date' d FROM expenses WHERE user_id=$1 AND data->>'idempotency_key'='stripe-fee:ch_imp'`, [tk.uid])).rows[0];
    A('Stripe import: fee expense dated 2026-07-21', fee1 && fee1.d === '2026-07-21', 'expense_date=' + (fee1 && fee1.d));
    const ref = J(await tk.http.post('/api/stripe/import-refund', { charge_id: 'ch_imp' }), 'import-refund');
    const rrid = (ref.receipt && ref.receipt.id) || ref.id;
    A('Stripe refund import: dated 2026-07-23 (refund 07-22T18:00Z in Tokyo; bug 07-22)', await dataField('sales_receipts', rrid, 'date') === '2026-07-23', 'date=' + await dataField('sales_receipts', rrid, 'date'));
    const inv4 = J(await tk.http.post('/api/invoices', { client: 'Kobe KK', amount: 300, status: 'pending', issue_date: '2026-07-05' }), 'invoice4');
    const mt = await tk.http.post('/api/stripe/match-invoice', { charge_id: 'ch_mat', invoice_id: inv4.id });
    const mp = (await c.query(`SELECT payment_date FROM invoice_payments WHERE invoice_id=$1`, [inv4.id])).rows;
    A('Stripe match-invoice: payment dated on the CHARGE, 2026-07-21 (bug: UTC today 07-25)', mt.status === 200 && mp.length === 1 && ymd(mp[0].payment_date) === '2026-07-21',
      'status=' + mt.status + ' ' + String(mt.text).slice(0, 120) + ' rows=' + JSON.stringify(mp.map(r => ymd(r.payment_date))));
    const fee2 = (await c.query(`SELECT data->>'expense_date' d FROM expenses WHERE user_id=$1 AND data->>'idempotency_key'='stripe-fee:ch_mat'`, [tk.uid])).rows[0];
    A('Stripe match-invoice: fee expense dated 2026-07-21 (same day as its payment)', fee2 && fee2.d === '2026-07-21', 'expense_date=' + (fee2 && fee2.d));

    // FX settlement: realised gain/loss posts to the GL on the settlement INSTANT, in the entity's zone
    const fxt = J(await tk.http.post('/api/fx-transactions', { foreign_currency: 'EUR', foreign_amount: 1000, rate_at_transaction: 1.10 }), 'fx-tx');
    J(await tk.http.post('/api/fx-transactions/' + fxt.id + '/settle', { rate_at_settlement: 1.15 }), 'fx-settle');
    const fxe = (await c.query(`SELECT entry_date FROM ledger_entries WHERE source_type='fx_settle' AND source_id=$1`, [fxt.id])).rows[0];
    A('FX settle: GL entry dated ' + E + ' (settled now; bug: UTC day / DB clock)', fxe && ymd(fxe.entry_date) === E, 'entry_date=' + (fxe && ymd(fxe.entry_date)));
    await c.query(`UPDATE fx_transactions SET settled_at = '2026-07-20T20:00:00Z' WHERE id=$1`, [fxt.id]);
    await c.query(`DELETE FROM ledger_lines WHERE entry_id IN (SELECT id FROM ledger_entries WHERE source_type='fx_settle' AND source_id=$1)`, [fxt.id]);
    await c.query(`DELETE FROM ledger_entries WHERE source_type='fx_settle' AND source_id=$1`, [fxt.id]);
    const bf = await tk.http.post('/api/gl/backfill?entity_id=' + tk.eid, {});
    const fxb = (await c.query(`SELECT entry_date FROM ledger_entries WHERE source_type='fx_settle' AND source_id=$1`, [fxt.id])).rows[0];
    A('GL backfill: FX settlement (settled 07-20T20:00Z) dated 2026-07-21 in Tokyo (bug 07-20)', fxb && ymd(fxb.entry_date) === '2026-07-21',
      'status=' + bf.status + ' entry_date=' + (fxb && ymd(fxb.entry_date)) + ' ' + String(bf.text).slice(0, 120));

    // control — a UTC entity keeps the UTC day
    const ut = await mkUser('n102-utc@finflow.test', null);
    const uinv = J(await ut.http.post('/api/invoices', { client: 'Ldn Ltd', amount: 80, status: 'pending', issue_date: '2026-07-01' }), 'utc invoice');
    const uip = J(await ut.http.post('/api/invoice-payments', { invoice_id: uinv.id, amount: 10 }), 'utc payment');
    A('control: UTC entity, no payment_date ⇒ 2026-07-25 (not shifted unconditionally)', ymd(uip.payment_date) === '2026-07-25', 'payment_date=' + ymd(uip.payment_date));
    const uts = J(await ut.http.post('/api/timesheet', { employee: 'Sam', hours: 1 }), 'utc ts');
    A('control: UTC entity timesheet ⇒ 2026-07-25', await dataField('timesheet', uts.id, 'date') === '2026-07-25', 'date=' + await dataField('timesheet', uts.id, 'date'));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { global.fetch = realFetch; if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N102 entity record dates)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
