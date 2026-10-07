#!/usr/bin/env node
'use strict';
/**
 * verify-vendor-derived-balances.js — N24. A vendor's "owing" and "YTD paid" come from its bills and
 * payments — never from typed-in numbers.
 *
 * Defect: owing / ytd_paid were free-entry money fields on the vendor record (the New Vendor modal asked
 * for them). They were a second accounts-payable writer: paying a bill never changed the vendor's "owing",
 * and the typed figure agreed with nothing on the balance sheet.
 *
 * Seed (business A, January fiscal year, today 2026-07-25). Vendor "Acme" created through POST /api/vendors
 * with owing 9999 and ytd_paid 7777 typed in.
 *   bills: Acme 500 unpaid (2026-07-01) · Acme 300 paid in full (2026-05-01, amount_paid 300) ·
 *          "ACME " 200 dated 2026-09-01 (future — not yet owed)
 *   payments made: Acme 300 (2026-05-10, this FY) · Acme 1000 (2025-12-10, last FY)
 *   GET /api/vendors → Acme owing 500 (bug: 9999) · ytd_paid 300 (bug: 7777)
 *   a second vendor with no activity → owing 0, ytd 0
 *   node -r ./tests/harness/clock.js tests/harness/verify-vendor-derived-balances.js
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
    const PW = 'vendor-derived-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'vd@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const J = (t, d) => c.query(`INSERT INTO ${t} (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, d]);
    await J('bills', { vendor: 'Acme', amount: 500, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-08-01' });
    await J('bills', { vendor: 'Acme', amount: 300, amount_paid: 300, status: 'paid', issue_date: '2026-05-01', due_date: '2026-06-01' });
    await J('bills', { vendor: 'ACME ', amount: 200, amount_paid: 0, status: 'unpaid', issue_date: '2026-09-01', due_date: '2026-10-01' });
    await J('payments_made', { vendor: 'Acme', amount: 300, date: '2026-05-10' });
    await J('payments_made', { vendor: 'Acme', amount: 1000, date: '2025-12-10' });
    const h = new HarnessHttp(server.baseUrl, { xff: '10.24.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'vd@finflow.test', password: PW })).status === 200);
    const v = await h.post(`/api/vendors?entity_id=${eA}`, { name: 'Acme', contact: 'ap@acme.test', category: 'Software', owing: 9999, ytd_paid: 7777, status: 'active' });
    A('vendor created', v.status < 300, `status ${v.status}`);
    await h.post(`/api/vendors?entity_id=${eA}`, { name: 'Quiet Supplies', category: 'Other', status: 'active' });

    console.log('\n' + '='.repeat(78));
    console.log('  VENDOR OWING / YTD PAID — derived from bills and payments');
    console.log('='.repeat(78));
    const list = (await h.get(`/api/vendors?entity_id=${eA}`)).json || [];
    const acme = list.find(x => x.name === 'Acme') || {};
    A('Acme owing 500 — open bill balance, future bill excluded (bug: 9999 typed)', Number(acme.owing) === 500, 'owing ' + acme.owing);
    A('Acme YTD paid 300 — this fiscal year only (bug: 7777 typed)', Number(acme.ytd_paid) === 300, 'ytd ' + acme.ytd_paid);
    const q = list.find(x => x.name === 'Quiet Supplies') || {};
    A('vendor with no bills/payments: owing 0, YTD 0', Number(q.owing) === 0 && Number(q.ytd_paid) === 0, JSON.stringify(q));
    // Paying the open bill moves the vendor's owing — the point of deriving it.
    const bill = (await c.query(`SELECT id FROM bills WHERE user_id=$1 AND data->>'amount'='500'`, [uid])).rows[0].id;
    const pay = await h.post(`/api/payments-made?entity_id=${eA}`, { vendor: 'Acme', amount: 200, date: '2026-07-20', bill_id: bill });
    const acme2 = ((await h.get(`/api/vendors?entity_id=${eA}`)).json || []).find(x => x.name === 'Acme') || {};
    A('after paying 200 on the bill: owing 300, YTD paid 500 (bug: unchanged 9999 / 7777)', pay.status === 200 && Number(acme2.owing) === 300 && Number(acme2.ytd_paid) === 500, `pay ${pay.status} owing ${acme2.owing} ytd ${acme2.ytd_paid}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (vendor derived balances)` : `  ALL GREEN — ${pass} passed, 0 failed  (vendor derived balances)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
