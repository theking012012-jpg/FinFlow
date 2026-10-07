#!/usr/bin/env node
'use strict';
/**
 * verify-display-chart-basis.js — N104. The display-currency overview chart (computeBooks `monthly`) has the same
 * basis as the native chart and the P&L: credit notes reduce revenue, vendor credits reduce expenses, payroll
 * is an expense.
 *
 * Defect: the converted monthly buckets included invoices, receipts, expenses, bills and orphan payments only —
 * no credit-note / vendor-credit contras, no payroll — while the native client chart includes all three. Picking
 * a display currency changed the chart's shape.
 * Seed (TTD business, display USD, TTD→USD 0.15; all in June 2026): invoice 1000, credit note 100, expense 50,
 * vendor credit 20, approved payroll run 300.
 *   June revenue = (1000 − 100) × 0.15 = 135      (bug: 150)
 *   June expenses = (50 − 20 + 300) × 0.15 = 49.5  (bug: 7.5)
 *   control: Σ monthly revenue (USD) = /api/reports revenue (USD) for the year
 *   node -r ./tests/harness/clock.js tests/harness/verify-display-chart-basis.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'chart-basis-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'dc@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eT = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'TT Co', currency: 'TTD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO fx_rates (user_id,entity_id,from_currency,to_currency,rate,rate_date) VALUES ($1,NULL,'TTD','USD',0.15,'2026-01-01')`, [uid]);
    const J = (t, d) => c.query(`INSERT INTO ${t} (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-10T16:00:00Z','2026-06-10T16:00:00Z')`, [uid, eT, d]);
    await J('invoices', { client: 'C', amount: 1000, amount_paid: 0, status: 'pending', issue_date: '2026-06-05', due_date: '2026-07-05' });
    await J('credit_notes', { customer: 'C', amount: 100, date: '2026-06-08', status: 'Open' });
    await J('expenses', { description: 'Fuel', category: 'Travel', amount: 50, expense_date: '2026-06-09' });
    await J('vendor_credits', { vendor: 'V', amount: 20, date: '2026-06-11', status: 'Open' });
    const run = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net) VALUES ($1,$2,'2026-06','2026-06-28','approved',300,0,300) RETURNING id`, [uid, eT])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime, net_pay) VALUES ($1,300,0,0,300)`, [run]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.104.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'dc@finflow.test', password: PW })).status === 200);
    const rep = (await h.get(`/api/reports?entity_id=${eT}&period=year&fyStart=0&display=USD`)).json || {};
    const m = rep.monthly || {};
    const jun = (m.labels || []).indexOf('Jun');
    A('June revenue (USD) = (1000 − 100) × 0.15 = 135 (bug: 150 — credit note ignored)', jun >= 0 && r2(m.revByMonth[jun]) === 135, JSON.stringify({ rev: m.revByMonth && m.revByMonth[jun] }));
    A('June expenses (USD) = (50 − 20 + 300) × 0.15 = 49.5 (bug: 7.5 — payroll and vendor credit ignored)', jun >= 0 && r2(m.expByMonth[jun]) === 49.5, JSON.stringify({ exp: m.expByMonth && m.expByMonth[jun] }));
    A('control: Σ monthly revenue = the year\'s revenue (USD)', r2((m.revByMonth || []).reduce((t, x) => t + x, 0)) === r2(rep.revenue), `Σ ${r2((m.revByMonth || []).reduce((t, x) => t + x, 0))} vs revenue ${rep.revenue}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (display chart basis)` : `  ALL GREEN — ${pass} passed, 0 failed  (display chart basis)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
