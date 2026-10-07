#!/usr/bin/env node
'use strict';
/**
 * verify-pl-period-rows.js — N41. The P&L report answers for ONE period — the fiscal year / quarter /
 * month the user is looking at — and its monthly rows sum to its totals.
 *
 * Defects:
 *   (a) POST /api/reports/profit-loss ignored the fiscal-year start and the selected period: totals were
 *       always the January–December calendar year (fyStartIdx defaulted to 0, period hardcoded 'year').
 *   (b) its monthly `rows` were a second implementation over ALL TIME (every source document ever), so
 *       Σrows ≠ totals as soon as the books span more than one year.
 *   (c) the P&L Statement modal posted {} — no period, no fiscal-year start — so it showed calendar-year
 *       totals over an Operating-Expenses breakdown computed for the selected period.
 *
 * Seed (hand-computed, independent of the code; pinned today 2026-07-25):
 *   invoices (pending): 2025-11-10 7000 · 2026-02-10 1000 · 2026-05-10 300 · 2026-07-05 50
 *   credit note (Open): 2026-07-10 20      expense: 2026-06-15 40      payroll run (approved) 2026-05: lines 500
 *   Fiscal year starting APRIL (fyStart=3) → FY = [2026-04-01, 2027-04-01):
 *     revenue 300 + 50 − 20 = 330 · expenses 40 + 500 = 540 · net −210
 *     rows Apr (0,0) · May (300,500) · Jun (0,40) · Jul (30,0) — no row after the current month
 *   Bug values: totals 1330 (Jan–Dec 2026: 1000+300+50−20); Σrows revenue 8330 (all time).
 *   Quarter (monthIdx 3 → Jul–Sep): revenue 30, expenses 0, rows [Jul].   Bug: totals 1330.
 *   Month (monthIdx 2 → June): revenue 0, expenses 40, rows [Jun].          Bug: totals 1330 / 540.
 *   No params (legacy callers): January FY → revenue 1330, expenses 540, Σrows 1330 (bug Σrows 8330).
 *
 * The P&L Statement modal's request (part c) is verified by verify-pl-statement-period-ui.js.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-pl-period-rows.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

process.on('uncaughtException', (e) => {
  const s = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(s)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, k) => r2((rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0));

async function apiPart() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'pl-period-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'plp@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'PLP Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const J = (t, ymd, d) => c.query(`INSERT INTO ${t} (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz)`, [uid, eid, d, ymd + 'T16:00:00Z']);
    for (const [ymd, amt] of [['2025-11-10', 7000], ['2026-02-10', 1000], ['2026-05-10', 300], ['2026-07-05', 50]]) {
      await J('invoices', ymd, { client: 'Cust', amount: amt, amount_paid: 0, status: 'pending', issue_date: ymd, due_date: ymd });
    }
    await J('credit_notes', '2026-07-10', { customer: 'Cust', amount: 20, date: '2026-07-10', status: 'Open' });
    await J('expenses', '2026-06-15', { description: 'Rent', category: 'Rent', amount: 40, expense_date: '2026-06-15' });
    const run = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net)
      VALUES ($1,$2,'2026-05','2026-05-28','approved',500,0,500) RETURNING id`, [uid, eid])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime, net_pay) VALUES ($1,500,0,0,500)`, [run]);

    const h = new HarnessHttp(server.baseUrl, { xff: '10.41.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'plp@finflow.test', password: PW })).status === 200);
    const pl = async (qs) => { const r = await h.post('/api/reports/profit-loss' + (qs ? '?' + qs : ''), {}); return r.json || {}; };

    console.log('\n' + '='.repeat(78));
    console.log('  P&L REPORT — one period, rows sum to totals');
    console.log('='.repeat(78));

    const y = await pl('period=year&fyStart=3');
    A('April FY: totalRevenue 330 (bug: 1330 calendar year)', r2(y.totalRevenue) === 330, 'got ' + y.totalRevenue);
    A('April FY: totalExpenses 540', r2(y.totalExpenses) === 540, 'got ' + y.totalExpenses);
    A('April FY: netProfit −210', r2(y.netProfit) === -210, 'got ' + y.netProfit);
    A('April FY: Σrows revenue = 330 = totalRevenue (bug: 8330, all time)', sum(y.rows, 'revenue') === 330 && sum(y.rows, 'revenue') === r2(y.totalRevenue), 'Σ=' + sum(y.rows, 'revenue'));
    A('April FY: Σrows expenses = 540 = totalExpenses', sum(y.rows, 'expenses') === 540, 'Σ=' + sum(y.rows, 'expenses'));
    A('April FY: Σrows netProfit = netProfit', sum(y.rows, 'netProfit') === r2(y.netProfit), 'Σ=' + sum(y.rows, 'netProfit'));
    A('April FY: rows are Apr..Jul 2026 in order (no prior-year month, nothing after the current month)',
      JSON.stringify((y.rows || []).map(r => r.key)) === JSON.stringify(['2026-04', '2026-05', '2026-06', '2026-07']), JSON.stringify((y.rows || []).map(r => r.key)));
    const may = (y.rows || []).find(r => r.key === '2026-05') || {};
    A('April FY: May row = revenue 300, expenses 500 (payroll in its period month)', r2(may.revenue) === 300 && r2(may.expenses) === 500, JSON.stringify(may));
    const jul = (y.rows || []).find(r => r.key === '2026-07') || {};
    A('April FY: Jul row = revenue 30 (50 − credit note 20)', r2(jul.revenue) === 30, JSON.stringify(jul));

    const q = await pl('period=quarter&monthIdx=3&fyStart=3');
    A('Quarter (Jul–Sep): totalRevenue 30, expenses 0 (bug: 1330 / 540)', r2(q.totalRevenue) === 30 && r2(q.totalExpenses) === 0, `rev ${q.totalRevenue} exp ${q.totalExpenses}`);
    A('Quarter: rows = [Jul] and sum to the totals', JSON.stringify((q.rows || []).map(r => r.key)) === '["2026-07"]' && sum(q.rows, 'revenue') === 30, JSON.stringify(q.rows));

    const m = await pl('period=month&monthIdx=2&fyStart=3');
    A('Month (June): totalRevenue 0, expenses 40 (bug: 1330 / 540)', r2(m.totalRevenue) === 0 && r2(m.totalExpenses) === 40, `rev ${m.totalRevenue} exp ${m.totalExpenses}`);
    A('Month: rows = [Jun] and sum to the totals', JSON.stringify((m.rows || []).map(r => r.key)) === '["2026-06"]' && sum(m.rows, 'expenses') === 40, JSON.stringify(m.rows));

    const d = await pl('');
    A('No params (legacy callers): January FY totals 1330 / 540', r2(d.totalRevenue) === 1330 && r2(d.totalExpenses) === 540, `rev ${d.totalRevenue} exp ${d.totalExpenses}`);
    A('No params: Σrows revenue = 1330 = totalRevenue (bug: 8330)', sum(d.rows, 'revenue') === 1330, 'Σ=' + sum(d.rows, 'revenue'));

    const bad = await h.post('/api/reports/profit-loss?period=decade', {});
    A('invalid period → 400', bad.status === 400, 'status ' + bad.status);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
}

(async () => {
  try { await apiPart(); }
  catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e, e && e.code ? 'code ' + e.code : ''); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (P&L period + rows)` : `  ALL GREEN — ${pass} passed, 0 failed  (P&L period + rows)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
