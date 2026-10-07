#!/usr/bin/env node
'use strict';
/**
 * verify-pg-date-strings.js — N107 (Rule 10). A Postgres DATE column (invoice_payments.payment_date,
 * payroll_runs.run_date, fx_rates.rate_date, ledger_entries.entry_date, …) is a calendar date and reaches
 * the app as the 'YYYY-MM-DD' string it is — whatever timezone the server process runs in.
 *
 * Defect: node-pg parsed every DATE into a JS Date at the SERVER's local midnight. FinFlowDates._toYmd(Date)
 * then formats it in UTC, so on a server east of UTC every DATE read one day EARLY: a payment dated 1 July
 * was posted to the ledger on 30 June, reported in June's cash flow, and served to the client as
 * "2026-06-30T15:00:00.000Z". Production runs in UTC today, so nothing shows — until TZ is ever set.
 * (Executed probe: SELECT '2026-07-01'::date → TZ=UTC 2026-07-01T00:00Z; TZ=Asia/Tokyo 2026-06-30T15:00Z.)
 *
 * Executed in-process with TZ=Asia/Tokyo (UTC+9 — Rule 10: a western-only matrix cannot see this; UTC-x
 * zones read the right day by accident). Real server + Postgres. USD business; invoice 900 issued 2026-06-15.
 *   payment 300 dated 2026-07-01 → GET /api/invoice-payments payment_date '2026-07-01' (bug: '2026-06-30T15:00:00.000Z')
 *   control: a stored payment dated 2026-08-01, posted by GL backfill → ledger 2026-08-01 (right before and after)
 *                                → cash flow: Jul '26 inflow 300, nothing in June     (bug: Jun '26 300)
 *   paid payroll run dated 2026-07-01, lines 1000 → cash flow Jul '26 outflow 1000      (bug: Jun '26)
 *   node -r ./tests/harness/clock.js tests/harness/verify-pg-date-strings.js
 */
process.env.TZ = 'Asia/Tokyo';
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
    A('the server process runs at UTC+9 (the condition under test)', new Date(2026, 6, 1).getTimezoneOffset() === -540, 'offset ' + new Date(2026, 6, 1).getTimezoneOffset());
    const PW = 'pg-date-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'pd@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'PD Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const inv = (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [uid, eid, { client: 'Acme', amount: 900, amount_paid: 0, status: 'pending', issue_date: '2026-06-15', due_date: '2026-07-15' }])).rows[0].id;
    const run = (await c.query(`INSERT INTO payroll_runs (user_id,entity_id,period,run_date,status,total_gross) VALUES ($1,$2,'July 2026','2026-07-01','paid',1000) RETURNING id`, [uid, eid])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime) VALUES ($1, 1000, 0, 0)`, [run]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.107.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'pd@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  POSTGRES DATE COLUMNS ARE CALENDAR DATES — server at UTC+9');
    console.log('='.repeat(78));
    const p = await h.post(`/api/invoice-payments?entity_id=${eid}`, { invoice_id: inv, amount: 300, payment_date: '2026-07-01', method: 'bank' });
    A('payment 300 dated 2026-07-01 → 201', p.status === 201, `status ${p.status} ${p.text.slice(0, 120)}`);
    const list = (await h.get(`/api/invoice-payments?entity_id=${eid}`)).json || [];
    const mine = (Array.isArray(list) ? list : (list.payments || [])).find(x => Number(x.invoice_id) === inv);
    A('GET /api/invoice-payments → payment_date "2026-07-01" (bug: "2026-06-30T15:00:00.000Z")', mine && mine.payment_date === '2026-07-01', JSON.stringify(mine && mine.payment_date));
    const le = (await c.query(`SELECT entry_date::text d FROM ledger_entries WHERE user_id=$1 AND source_type='invoice_payment'`, [uid])).rows;
    A('control: posted from the request, its ledger entry is dated 2026-07-01', le.length === 1 && le[0].d === '2026-07-01', JSON.stringify(le));
    // A payment that reaches the ledger from a row READ BACK from Postgres (GL backfill — the same read the
    // processor-webhook payment writer and the refund reversal post from).
    const p2 = (await c.query(`INSERT INTO invoice_payments (user_id,entity_id,invoice_id,amount,payment_date,method) VALUES ($1,$2,$3,200,'2026-08-01','bank') RETURNING id`, [uid, eid, inv])).rows[0].id;
    const bf = await h.post(`/api/gl/backfill?entity_id=${eid}`, {});
    const le2 = (await c.query(`SELECT entry_date::text d FROM ledger_entries WHERE user_id=$1 AND source_type='invoice_payment' AND source_id=$2`, [uid, p2])).rows;
    A('backfilled from the stored row, the payment dated 2026-08-01 posts on 2026-08-01 (control: correct before and after)', bf.status === 200 && le2.length === 1 && le2[0].d === '2026-08-01', `status ${bf.status} ${bf.text.slice(0, 100)} ${JSON.stringify(le2)}`);
    const cf = (await h.post(`/api/reports/cash-flow?entity_id=${eid}`, {})).json || {};
    const row = (lbl) => (cf.rows || []).find(r => r.month === lbl || r.label === lbl || r.key === lbl) || null;
    const jul = row("Jul '26"), jun = row("Jun '26");   // (the Aug payment lands in Aug — not asserted here)
    A('cash flow: the payment is July\'s inflow (300), June has none (bug: June 300)', jul && jul.inflow === 300 && (!jun || !jun.inflow), JSON.stringify(cf.rows));
    A('cash flow: the paid payroll run dated 2026-07-01 is July\'s outflow (1000) (bug: June)', jul && jul.outflow === 1000 && (!jun || !jun.outflow), JSON.stringify(cf.rows));
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (pg DATE strings)` : `  ALL GREEN — ${pass} passed, 0 failed  (pg DATE strings)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main();
