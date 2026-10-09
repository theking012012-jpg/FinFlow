'use strict';
/**
 * verify-forecast-credits-payroll.js — L47. The 13-week cash forecast (GET /api/cashflow-forecast) built inflows from every
 * open invoice balance and outflows from every open bill balance, ignoring open credit notes and vendor credits (live week 1:
 * in $14,300 of gross overdue AR while Outstanding net of $1,250 credit notes was $13,550), and it had NO payroll at all —
 * its run-rate covered directly-logged expenses only (live: $144/week while payroll was $7,000 a month), so "runway 13+
 * weeks" ignored the largest outflow. Fix (Rule 13, the class):
 *   · open|applied credit notes (dated ≤ today) reduce the forecast AR — the customer's own invoices first, earliest due
 *     date first, any remainder against the earliest-due invoices — so Σ forecast AR = AR Outstanding; vendor credits
 *     likewise against bills, so Σ forecast AP = Accounts Payable;
 *   · an APPROVED, unpaid payroll run is an outflow due now (Σ run lines);
 *   · future payroll is a run-rate of PAID runs over the last 90 days (the method the expense run-rate already uses) —
 *     never the roster (Rule 12).
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes:
 *   invoices  A Acme 1,000 due 07-20 · B Acme 600 due 08-10 · C Bolt 500 due 08-20 (all pending)
 *   credit notes  Acme 400 Open 07-05 · "Unknown Co" 100 Open 07-06 (no matching customer)
 *   bills  X Xeno 300 due 07-15 · Y Yarrow 200 due 08-05 (unpaid)   vendor credit  Xeno 300 Open 07-01
 *   payroll  one employee 1,300; run 2026-06 approved (NOT paid); run 2026-07 approved + paid (paid 07-25)
 * HAND-COMPUTED: AR inflows A 500 (1,000 − 400 Acme − 100 unattributed) · B 600 · C 500 = 1,600 = Outstanding
 *   AP outflows X 0 · Y 200 = 200 = Payables · payroll due now 1,300 (June run) · payroll run-rate 1,300 / 90 × 7 = 101.11
 *   per week × 13 = 1,314.44
 * BUGGY (pre-fix): AR 2,100 · AP 500 · payroll 0 (no payroll items at all).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-forecast-credits-payroll.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const near = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) < tol;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L47 — the 13-week forecast nets credits and includes payroll\n' + '='.repeat(78) + '\n');
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: 'l47@finflow.test', name: 'L47', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.147' });
    if ((await http.post('/api/auth/login', { email: 'l47@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (p, b, m) => { const r = await (m === 'PUT' ? http.put(p, b) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return r.text ? JSON.parse(r.text) : {}; };
    const ent = await J('/api/entities', { name: 'L47 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('/api/entities/' + ent.id + '/activate', {});
    await J('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-20' });
    await J('/api/invoices', { client: 'Acme', amount: 600, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-10' });
    await J('/api/invoices', { client: 'Bolt', amount: 500, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-20' });
    await J('/api/credit-notes', { customer: 'Acme', num: 'CN-1', amount: 400, date: '2026-07-05' });
    await J('/api/credit-notes', { customer: 'Unknown Co', num: 'CN-2', amount: 100, date: '2026-07-06' });
    await J('/api/bills', { vendor: 'Xeno', num: 'BX', amount: 300, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-15' });
    await J('/api/bills', { vendor: 'Yarrow', num: 'BY', amount: 200, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-08-05' });
    await J('/api/vendor-credits', { vendor: 'Xeno', num: 'VC-1', amount: 300, date: '2026-07-01', status: 'Open' });
    await J('/api/payroll', { fname: 'Ada', lname: 'L', gross: 1300 });
    const runJun = await J('/api/payroll-runs', { period: '2026-06' });
    await J('/api/payroll-runs/' + runJun.id + '/approve', {}, 'PUT');
    const runJul = await J('/api/payroll-runs', { period: '2026-07' });
    await J('/api/payroll-runs/' + runJul.id + '/approve', {}, 'PUT');
    await J('/api/payroll-runs/' + runJul.id + '/mark-paid', {}, 'PUT');

    const rep = (await http.get('/api/reports?period=year&fyStart=0')).json || {};
    const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
    A('CONTROL: Outstanding 1,600 (2,100 − 500 credit notes) · Payables 200 (500 − 300 vendor credit)', near(rep.outstanding, 1600) && near(bs.accountsPayable, 200),
      JSON.stringify({ outstanding: rep.outstanding, ap: bs.accountsPayable }));

    const fc = (await http.get('/api/cashflow-forecast')).json || {};
    const items = (fc.periods || []).flatMap(p => p.items || []);
    const sumKind = k => Math.round(items.filter(i => i.kind === k).reduce((s, i) => s + Number(i.amount || 0), 0) * 100) / 100;
    console.log('  [forecast by kind] ' + JSON.stringify(['ar', 'ap', 'payroll', 'payroll_estimate', 'opex_estimate'].map(k => [k, sumKind(k)])));
    A('forecast AR inflows 1,600 = Outstanding (bug: 2,100 — credit notes ignored)', near(sumKind('ar'), 1600) && near(sumKind('ar'), rep.outstanding), 'ar=' + sumKind('ar'));
    const arA = items.filter(i => i.kind === 'ar' && /Acme/.test(i.label || '')).map(i => Number(i.amount)).sort((a, b) => a - b);
    A('Acme\'s earliest invoice carries both credits: 500 and 600 (bug: 1,000 and 600)', JSON.stringify(arA) === JSON.stringify([500, 600]), JSON.stringify(arA));
    A('forecast AP outflows 200 = Payables (bug: 500 — vendor credit ignored)', near(sumKind('ap'), 200) && near(sumKind('ap'), bs.accountsPayable), 'ap=' + sumKind('ap'));
    A('the approved, unpaid June payroll run is an outflow due now: 1,300 (bug: 0)', near(sumKind('payroll'), 1300), 'payroll=' + sumKind('payroll'));
    A('future payroll run-rate from PAID runs: 1,300 / 90 × 7 × 13 = 1,314.44 (bug: 0)', near(sumKind('payroll_estimate'), 1314.44, 0.05), 'payroll_estimate=' + sumKind('payroll_estimate'));
    const wk1 = (fc.periods || [])[0] || {};
    A('the unpaid run lands in the first week', (wk1.items || []).some(i => i.kind === 'payroll' && near(i.amount, 1300)), JSON.stringify(wk1.items || []).slice(0, 200));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (forecast credits + payroll)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
