#!/usr/bin/env node
'use strict';
/**
 * verify-paylink-callbacks.js — N51. An invoice paid through a Mercado Pago or dLocal payment link is marked
 * paid — and only when the processor itself confirms the payment.
 *
 * Defects: neither processor had a callback (Mercado Pago preferences set no notification_url; dLocal's pointed at
 * the site root), so a paid invoice stayed open forever; dLocal links used a fake payer customer@example.com in
 * Brazil whatever the customer and business.
 * Executed: real server + Postgres; the processors mocked ONLY at their HTTP boundary. Business MX (MXN); customer
 * "Comprador SA" <pagos@comprador.mx>; invoices I-MP 500 and I-DL 800.
 *   Mercado Pago link: preference carries notification_url …/api/mercadopago/webhook?inv=<I-MP>     (bug: none)
 *   callback for payment 123 (MP reports approved, INV-<I-MP>-…, MXN 500) → invoice paid, 1 payment  (bug: stays open)
 *   same callback again → no second payment (idempotent)
 *   forged callback for payment 999 (MP reports 'pending') → nothing recorded
 *   callback naming payment 777 (MP reports another invoice's reference) → nothing recorded
 *   dLocal link: payer pagos@comprador.mx, country MX, notification_url …/api/dlocal/webhook          (bug: customer@example.com, BR, root)
 *   dLocal callback for PAID payment D-1 → invoice paid
 *   node -r ./tests/harness/clock.js tests/harness/verify-paylink-callbacks.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let scratch, server;
  const realFetch = global.fetch;
  const sent = { mpPref: null, dlPay: null };
  let invMP = null, invDL = null;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    const MP_PAY = () => ({
      '123': { id: 123, status: 'approved', external_reference: `INV-${invMP}-1`, currency_id: 'MXN', transaction_amount: 500 },
      '999': { id: 999, status: 'pending', external_reference: `INV-${invMP}-1`, currency_id: 'MXN', transaction_amount: 500 },
      '777': { id: 777, status: 'approved', external_reference: 'INV-424242-1', currency_id: 'MXN', transaction_amount: 500 },
    });
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u === 'https://api.mercadopago.com/checkout/preferences') { sent.mpPref = JSON.parse(opts.body); return { ok: true, status: 201, json: async () => ({ init_point: 'https://mp.test/pay/1' }) }; }
      const mp = /api\.mercadopago\.com\/v1\/payments\/(\d+)/.exec(u);
      if (mp) { const p = MP_PAY()[mp[1]]; return p ? { ok: true, status: 200, json: async () => p } : { ok: false, status: 404, json: async () => ({}) }; }
      if (u === 'https://api.dlocal.com/payments') { sent.dlPay = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ redirect_url: 'https://dl.test/pay/1' }) }; }
      const dl = /api\.dlocal\.com\/payments\/([A-Za-z0-9_-]+)/.exec(u);
      if (dl) return { ok: true, status: 200, json: async () => ({ id: dl[1], status: 'PAID', order_id: `INV-${invDL}-1`, currency: 'MXN', amount: 800 }) };
      return realFetch(url, opts);
    };
    const PW = 'paylink-cb-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'pl@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'MX SA', currency: 'MXN', country: 'MX', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO customers (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { fname: 'Ana', lname: 'Ruiz', company: 'Comprador SA', email: 'pagos@comprador.mx' }]);
    invMP = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { client: 'Comprador SA', amount: 500, amount_paid: 0, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01' }])).rows[0].id;
    invDL = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { client: 'Comprador SA', amount: 800, amount_paid: 0, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-02' }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { key: 'mercadopago_conn', value: JSON.stringify({ connected: true, access_token: app._encTok('mp-token') }) }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.51.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'pl@finflow.test', password: PW })).status === 200);
    const pays = async (inv) => (await c.query(`SELECT amount::float a FROM invoice_payments WHERE invoice_id=$1`, [inv])).rows.map(r => r.a);
    const st = async (inv) => (await c.query(`SELECT data->>'status' s FROM invoices WHERE id=$1`, [inv])).rows[0].s;
    const anon = new HarnessHttp(server.baseUrl, { xff: '10.51.0.9' });

    console.log('\n' + '='.repeat(78));
    console.log('  PAYMENT-LINK CALLBACKS — Mercado Pago / dLocal');
    console.log('='.repeat(78));
    const l1 = await h.post(`/api/invoices/${invMP}/payment-link?entity_id=${eA}`, { provider: 'mercadopago' });
    A('Mercado Pago link created', l1.status === 201, `status ${l1.status} ${l1.text.slice(0, 120)}`);
    A('  preference carries notification_url for this invoice (bug: none)', sent.mpPref && sent.mpPref.notification_url && sent.mpPref.notification_url.endsWith('/api/mercadopago/webhook?inv=' + invMP), JSON.stringify(sent.mpPref && sent.mpPref.notification_url));
    const w1 = await anon.post(`/api/mercadopago/webhook?inv=${invMP}`, { type: 'payment', data: { id: '123' } });
    A('callback for approved payment 123 → invoice paid, one payment of 500 (bug: no handler — stays open)', w1.status === 200 && (await st(invMP)) === 'paid' && JSON.stringify(await pays(invMP)) === '[500]', `status ${w1.status} ${w1.text.slice(0, 100)} → ${await st(invMP)} ${JSON.stringify(await pays(invMP))}`);
    await anon.post(`/api/mercadopago/webhook?inv=${invMP}`, { type: 'payment', data: { id: '123' } });
    A('  the same callback again → still one payment (idempotent)', (await pays(invMP)).length === 1);
    const before = (await c.query(`SELECT COUNT(*)::int n FROM invoice_payments`)).rows[0].n;
    await anon.post(`/api/mercadopago/webhook?inv=${invDL}`, { type: 'payment', data: { id: '999' } });
    await anon.post(`/api/mercadopago/webhook?inv=${invDL}`, { type: 'payment', data: { id: '777' } });
    A('forged callbacks (MP reports pending / another invoice\'s payment) → nothing recorded', (await c.query(`SELECT COUNT(*)::int n FROM invoice_payments`)).rows[0].n === before && (await st(invDL)) === 'pending');

    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { key: 'dlocal_conn', value: JSON.stringify({ connected: true, x_login: app._encTok('xl'), x_trans_key: app._encTok('xt'), secret_key: app._encTok('sk') }) }]);
    const l2 = await h.post(`/api/invoices/${invDL}/payment-link?entity_id=${eA}`, { provider: 'dlocal' });
    A('dLocal link created', l2.status === 201, `status ${l2.status} ${l2.text.slice(0, 120)}`);
    A('  payer = the customer\'s email, country MX (bug: customer@example.com, BR)', sent.dlPay && sent.dlPay.payer && sent.dlPay.payer.email === 'pagos@comprador.mx' && sent.dlPay.country === 'MX', JSON.stringify(sent.dlPay && { payer: sent.dlPay.payer, country: sent.dlPay.country }));
    A('  notification_url = the dLocal callback for this invoice (bug: the site root)', sent.dlPay && String(sent.dlPay.notification_url).endsWith('/api/dlocal/webhook?inv=' + invDL), JSON.stringify(sent.dlPay && sent.dlPay.notification_url));
    const w2 = await anon.post(`/api/dlocal/webhook?inv=${invDL}`, { id: 'D-1', status: 'PAID' });
    A('dLocal callback for PAID payment D-1 → invoice paid, one payment of 800', w2.status === 200 && (await st(invDL)) === 'paid' && JSON.stringify(await pays(invDL)) === '[800]', `status ${w2.status} ${w2.text.slice(0, 100)} → ${await st(invDL)} ${JSON.stringify(await pays(invDL))}`);
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (pay-link callbacks)` : `  ALL GREEN — ${pass} passed, 0 failed  (pay-link callbacks)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
