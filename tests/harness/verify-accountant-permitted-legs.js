#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-permitted-legs.js — N65. An accountant restricted to some of a client's businesses sees,
 * in the "all businesses" view, money from those businesses only — on EVERY leg, payroll and COGS included.
 *
 * Defect: computeBooks(…, permittedEntityIds) filtered the JSONB legs (invoices, expenses, bills, …) by the
 * permitted set, but the payroll_runs and inventory (COGS) queries ignored it, so a hidden business's payroll
 * and cost of sales flowed into the restricted consolidated view.
 *
 * Seed: client businesses A (accountant: view) and B (accountant: none).
 *   A: invoice 1000, approved June payroll run lines 500.       B: invoice 9000, approved June run 7000,
 *   B inventory: purchase 10 @ 100, sale 3 → COGS 300.
 *   accountant /books (all businesses): revenue 1000, payroll 500, opex 500, COGS 0, net 500
 *   bug: payroll 7500, opex 7500, COGS 300, net −6800
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-permitted-legs.js
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
    const PW = 'acc-legs-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'al-client@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    for (const [e, amt] of [[eA, 1000], [eB, 9000]]) {
      await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-10T16:00:00Z','2026-06-10T16:00:00Z')`, [uid, e, { client: 'C', amount: amt, amount_paid: 0, status: 'pending', issue_date: '2026-06-10', due_date: '2026-07-10' }]);
    }
    for (const [e, gross] of [[eA, 500], [eB, 7000]]) {
      const run = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net) VALUES ($1,$2,'2026-06','2026-06-28','approved',$3,0,$3) RETURNING id`, [uid, e, gross])).rows[0].id;
      await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime, net_pay) VALUES ($1,$2,0,0,$2)`, [run, gross]);
    }
    const item = (await c.query(`INSERT INTO inventory (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eB, { name: 'B widget', units: 7, max_units: 50, cost: 100 }])).rows[0].id;
    await c.query(`INSERT INTO inventory_movements (user_id,entity_id,inventory_id,type,quantity,unit_cost,moved_at) VALUES ($1,$2,$3,'purchase',10,100,'2026-05-01T16:00:00Z'),($1,$2,$3,'sale',3,NULL,'2026-06-15T16:00:00Z')`, [uid, eB, item]);
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('al-acc@finflow.test', $1, 'Acc', 'Legs', 'Firm', 'ALREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, entity_access) VALUES ($1,$2,'active','view',$3)`,
      [accId, uid, JSON.stringify({ entities: { [eA]: 'view', [eB]: 'none' }, personal: 'none' })]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '10.65.0.1' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'al-acc@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT RESTRICTED "ALL" VIEW — every leg filtered to permitted businesses');
    console.log('='.repeat(78));
    const r = await acc.get('/api/accountants/clients/' + uid + '/books?period=year');
    const s = (r.json && r.json.summary) || {};
    A('books 200', r.status === 200, 'status ' + r.status);
    A('revenue 1000 (A only)', Number(s.revenue) === 1000, 'revenue ' + s.revenue);
    A('payroll 500 (bug: 7500 — B\'s run included)', Number(s.parts && s.parts.payroll) === 500, 'payroll ' + (s.parts && s.parts.payroll));
    A('opex 500 (bug: 7500)', Number(s.opex) === 500, 'opex ' + s.opex);
    A('COGS 0 (bug: 300 — B\'s cost of sales)', Number(s.cogs) === 0, 'cogs ' + s.cogs);
    A('net profit 500 (bug: −6800)', Number(s.netProfit) === 500, 'net ' + s.netProfit);
    const sA = (r.json && r.json.summariesByEntity && r.json.summariesByEntity[eA]) || {};
    A('control: the all view equals A\'s own summary', Number(sA.netProfit) === Number(s.netProfit) && Number(sA.revenue) === Number(s.revenue), JSON.stringify({ a: sA.netProfit, all: s.netProfit }));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant permitted legs)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant permitted legs)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
