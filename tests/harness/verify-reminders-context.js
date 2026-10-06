#!/usr/bin/env node
'use strict';
/**
 * verify-reminders-context.js — N113. The payment-reminder agent predicts lateness from the customer's REAL
 * payment history and signs its drafts with the business's name.
 *
 * Defect: _reminderContext read three keys no writer ever writes —
 *   invoice_payments.data->>'payment_date'  (a typed table: there is no data column → SQL error, swallowed by
 *                                            .catch(() => []) → the payment history was ALWAYS empty)
 *   entities.data->>'business_name'          (entities store `name`)
 *   user_settings.data->>'company_name'      (settings store `business_name`)
 * so every customer looked punctual (no "predicted late" ever) and every draft was signed "Our team".
 *
 * Executed: real server + Postgres, real GET /api/payment-reminders. Clock pinned 2026-07-25.
 * Business "Harbor Supplies Ltd" (entity name); account settings business_name "Account Name Inc" (a different
 * value, so the test can tell which source was read).
 *   Slow Co:   I1 due 2026-06-01 paid 2026-06-20 (19 days late) · I2 400 due 2026-07-30 (upcoming)
 *   Prompt Co: I3 due 2026-06-01 paid 2026-05-28 (early)        · I4 300 due 2026-07-29 (upcoming)
 *   I2 → chronic_late + predicted_late true      (bug: false — history never loaded)
 *   I4 → predicted_late false                     (control: a punctual payer)
 *   drafts signed "Harbor Supplies Ltd"           (bug: "Our team")
 * Failure path (the class — a failed money read swallowed into "no data"), injected at pool.query:
 *   payment-history read fails → GET /api/payment-reminders 500   (bug: 200, everyone punctual)
 *   payroll read fails → POST /api/reports/cash-flow 500           (bug: 200, payroll cash out missing)
 *   node -r ./tests/harness/clock.js tests/harness/verify-reminders-context.js
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
    const PW = 'reminders-ctx-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'rc@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Harbor Supplies Ltd', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { business_name: 'Account Name Inc' }]);
    for (const [co, em] of [['Slow Co', 'ap@slow.test'], ['Prompt Co', 'ap@prompt.test']])
      await c.query(`INSERT INTO customers (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { company: co, email: em }]);
    const inv = async (d) => (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, d])).rows[0].id;
    const i1 = await inv({ client: 'Slow Co', amount: 500, amount_paid: 500, status: 'paid', issue_date: '2026-05-01', due_date: '2026-06-01' });
    const i2 = await inv({ client: 'Slow Co', amount: 400, amount_paid: 0, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-30' });
    const i3 = await inv({ client: 'Prompt Co', amount: 200, amount_paid: 200, status: 'paid', issue_date: '2026-05-01', due_date: '2026-06-01' });
    const i4 = await inv({ client: 'Prompt Co', amount: 300, amount_paid: 0, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-29' });
    await c.query(`INSERT INTO invoice_payments (user_id,entity_id,invoice_id,amount,payment_date,method) VALUES ($1,$2,$3,500,'2026-06-20','bank'),($1,$2,$4,200,'2026-05-28','bank')`, [uid, eid, i1, i3]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.113.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'rc@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  PAYMENT REMINDERS — real payment history and the business name');
    console.log('='.repeat(78));
    const r = await h.get(`/api/payment-reminders?entity_id=${eid}`);
    A('GET /api/payment-reminders → 200', r.status === 200, `status ${r.status} ${r.text.slice(0, 120)}`);
    const items = (r.json && r.json.items) || [];
    const it2 = items.find(i => i.invoice_id === i2), it4 = items.find(i => i.invoice_id === i4);
    A('Slow Co (paid 19 days late before): upcoming I2 is chronic_late + predicted_late (bug: false — history never loaded)',
      it2 && it2.chronic_late === true && it2.predicted_late === true, JSON.stringify(it2 && { chronic: it2.chronic_late, predicted: it2.predicted_late }));
    A('control: Prompt Co (paid early): upcoming I4 is not predicted late', it4 && it4.predicted_late === false && it4.chronic_late === false, JSON.stringify(it4 && { chronic: it4.chronic_late, predicted: it4.predicted_late }));
    A('summary counts 1 predicted-late invoice (bug: 0)', r.json && r.json.summary && r.json.summary.predicted_late === 1, JSON.stringify(r.json && r.json.summary));
    A('business_name = the business (entity) name "Harbor Supplies Ltd" (bug: "")', r.json && r.json.business_name === 'Harbor Supplies Ltd', JSON.stringify(r.json && r.json.business_name));
    const body = it2 && it2.draft && it2.draft.body || '';
    A('the draft is signed "Harbor Supplies Ltd" (bug: "Our team")', /Thank you,\nHarbor Supplies Ltd$/.test(body), JSON.stringify(body.slice(-60)));

    console.log('\n-- failure path (Rule 14): a failed money read fails the request, never "no data" --');
    const { pool } = require('../../database.js');
    const realQ = pool.query.bind(pool);
    const injectOn = (re) => { pool.query = (text, ...rest) => (re.test(String(text && text.text || text)) ? Promise.reject(Object.assign(new Error('injected failure'), { code: 'XX000' })) : realQ(text, ...rest)); };
    injectOn(/FROM invoice_payments WHERE user_id/);
    const fr = await h.get(`/api/payment-reminders?entity_id=${eid}`);
    pool.query = realQ;
    A('payment history read fails → reminders 500 (bug: 200, every customer shown as punctual)', fr.status === 500, `status ${fr.status}`);
    const run = (await c.query(`INSERT INTO payroll_runs (user_id,entity_id,period,run_date,status,total_gross) VALUES ($1,$2,'July 2026','2026-07-10','paid',800) RETURNING id`, [uid, eid])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime) VALUES ($1, 800, 0, 0)`, [run]);   // basis C: cash out = Σ lines
    const cfOk = await h.post(`/api/reports/cash-flow?entity_id=${eid}`, {});
    A('control: cash flow with the payroll read working → 200, outflow includes the paid run (800)', cfOk.status === 200 && cfOk.json && cfOk.json.totalOutflow === 800, `status ${cfOk.status} ${JSON.stringify(cfOk.json && cfOk.json.totalOutflow)}`);
    injectOn(/FROM payroll_runs pr/);
    const cf = await h.post(`/api/reports/cash-flow?entity_id=${eid}`, {});
    pool.query = realQ;
    A('payroll read fails → cash flow 500 (bug: 200 with payroll cash out silently missing)', cf.status === 500, `status ${cf.status} ${JSON.stringify(cf.json && cf.json.totalOutflow)}`);
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (reminders context)` : `  ALL GREEN — ${pass} passed, 0 failed  (reminders context)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main();
