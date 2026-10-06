#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-ai-insights.js — N83. The figures an accountant's AI insights send to the model are
 * the canonical books over the entities the accountant may see — not every entity, not paid-only
 * revenue, not the payroll roster.
 *
 * Defect: ai-insights read every entity's last 50 invoices/expenses and the payroll ROSTER directly:
 * hidden entities leaked into the prompt, revenue was paid-only (not the owner's accrual basis, Rule 11),
 * payroll was Σ roster gross (a template — Rule 12 says it must produce no figure), all labelled '$'.
 *
 * Executed against the real server + Postgres; the Anthropic call is mocked at the fetch boundary and the
 * prompt the server builds is captured. Client grants entity A only (B 'none'). Seed (Rule 4 — every
 * source a distinct number), hand-computed for entity A (Rule 6):
 *   invoices A: pending 1000 + paid 300 → revenue 1300 (accrual), outstanding 1000
 *   payroll run A (approved, line gross 3000) → payroll 3000; roster gross 9999 → must NOT appear
 *   entity B: pending invoice 50000 → must NOT appear anywhere
 *   prompt: revenue 1300.00 (bug: "Paid revenue: $300.00"), outstanding 1000.00 (bug: 51000.00),
 *           payroll 3000.00 (bug: 9999.00), no 50000 / 51000 / 9999
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-ai-insights.js
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
  const realFetch = global.fetch;
  const prompts = [];
  try {
    server = await bootServer(scratch.url);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-harness';   // after boot.js's scrub; the call itself is mocked
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://api.anthropic.com/')) {
        prompts.push(JSON.parse(opts.body).messages[0].content);
        return { ok: true, status: 200, json: async () => ({ content: [{ text: 'insight 1\ninsight 2\ninsight 3\ninsight 4\ninsight 5' }] }) };
      }
      return realFetch(url, opts);
    };
    const PW = 'ai-ins-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'ai-owner@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const inv = (eid, amount, status) => c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eid, { client: 'C', amount, status, issue_date: '2026-07-01', due_date: '2026-07-31', amount_paid: status === 'paid' ? amount : 0 }]);
    await inv(eA, 1000, 'pending'); await inv(eA, 300, 'paid'); await inv(eB, 50000, 'pending');
    await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { fname: 'Roster', lname: 'Only', gross: 9999, deductions: [] }]);
    const run = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net) VALUES ($1,$2,'2026-07','2026-07-10','approved',3000,0,3000) RETURNING id`, [uid, eA])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,'Pat',3000,0,0,'[]',3000)`, [run]);
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('ai-acc@finflow.test', $1, 'A', 'I', 'Firm', 'AIREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
    const O = new HarnessHttp(server.baseUrl, { xff: '10.83.0.1' });
    const ACC = new HarnessHttp(server.baseUrl, { xff: '10.83.0.2' });
    A('owner login', (await O.post('/api/auth/login', { email: 'ai-owner@finflow.test', password: PW })).status === 200);
    A('owner grants entity A only', (await O.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [eA]: 'view', [eB]: 'none' }, personal: 'none' } })).status === 200);
    A('accountant login', (await ACC.post('/api/accountants/login', { email: 'ai-acc@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT AI INSIGHTS — canonical figures, permitted entities only');
    console.log('='.repeat(78));
    const r = await ACC.post(`/api/accountants/clients/${uid}/ai-insights`, {});
    A('ai-insights → 200', r.status === 200, `status ${r.status}: ${r.text.slice(0, 120)}`);
    const p = prompts[0] || '';
    A('revenue sent = 1300.00 accrual (bug: "Paid revenue: $300.00")', /Revenue \(invoices issued\): 1300\.00 USD/.test(p), p);
    A('outstanding sent = 1000.00 (bug: 51000.00 incl. hidden entity B)', /Outstanding receivables: 1000\.00 USD/.test(p));
    A('payroll sent = 3000.00 from the run (bug: 9999.00 roster)', /Payroll \(approved\/paid runs\): 3000\.00 USD/.test(p));
    A('nothing from hidden entity B or the roster in the prompt (no 50000 / 51000 / 9999)', !/50000|51000|9999/.test(p));
    A('response carries the basis it sent', r.json && r.json.basis && Number(r.json.basis.revenue) === 1300 && Number(r.json.basis.payroll) === 3000, JSON.stringify(r.json && r.json.basis));
    const rb = await ACC.post(`/api/accountants/clients/${uid}/ai-insights`, { entity_id: eB });
    A('explicit hidden entity B → 403', rb.status === 403, 'status ' + rb.status);
  } finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant AI insights)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant AI insights)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
