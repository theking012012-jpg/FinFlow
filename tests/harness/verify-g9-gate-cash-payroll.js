'use strict';
/*
 * verify-g9-gate-cash-payroll.js — G9 (V1 class, Rule 6). The balance-sheet gate decides whether the balance sheet is
 * served from the LEDGER or falls back to computeBooks; it compared the trial balance, income, expenses, AR and AP — not
 * cash and not payroll liabilities. So a ledger holding a balanced entry no source document backs (or missing a payroll
 * cash leg) still passed, and the balance sheet showed its wrong cash and wrong payroll liability as the books.
 * After: the gate also compares Payroll Liabilities (2200) with the liability the payroll runs themselves give (gross from
 * the period start − wages paid − withholdings remitted; cash paid before the period sits in prepaid until it starts), and
 * requires every posted entry to trace to a live source document (or be netted out by its reversal).
 *
 * Real Postgres + real routes. Today is pinned to 2026-07-25 (clock.js). Hand-computed:
 *   invoice 1,000 paid 5 Jun (+1,000) · expense 200 (−200) · roster Ada gross 1,000 with a fixed 150 deduction (net 850)
 *   1  June run approved, not paid           → cash 800 · payroll liabilities 1,000 · served from the ledger
 *   2  June run marked paid 25 Jul (net 850) → cash −50 · liabilities 150 (the withholdings)    [a gross-basis oracle: 0 → false fallback]
 *   3  withholdings 150 remitted 25 Jul      → cash −200 · liabilities 0
 *   4  August run approved + paid early 850  → cash −1,050 · liabilities 0 (accrual + release are dated 1 Aug, after today)
 *                                              [an oracle that counts the cash on its pay date: −850 → false fallback]
 *   5  PHANTOM Dr 2200 600 / Cr 1000 600 (a type nothing posts): TB, P&L, AR, AP unchanged → the old gate served it
 *      (cash −1,650, liabilities −600); the new gate falls back, naming payroll liabilities and the untraced entry
 *   6  PHANTOM of a real type whose document does not exist (journal #999999, Dr 1250 300 / Cr 1000 300): payroll
 *      unchanged → only the trace check can catch it → falls back, naming journal:999999
 *   7  the expense deleted through its route (reversal posted, document gone): nets to zero → NOT a phantom → served,
 *      cash −850                                                                [a trace rule ignoring reversals: false fallback]
 *   node -r ./tests/harness/clock.js tests/harness/verify-g9-gate-cash-payroll.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { glBalanceSheet } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  G9 — the balance-sheet gate checks cash and payroll liabilities too\n' + '='.repeat(78) + '\n');
    const email = 'g9gate@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'G9 Co', currency: 'USD', timezone: 'UTC', is_active: 1 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.99' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const inv = JSON.parse((await http.post('/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', entity_id: eid })).text);
    A('invoice paid 1,000', (await http.post('/api/invoice-payments', { invoice_id: inv.id, amount: 1000, payment_date: '2026-06-05' })).status < 300);
    const exp = JSON.parse((await http.post('/api/expenses', { description: 'Supplies', amount: 200, expense_date: '2026-06-02', category: 'Office', entity_id: eid })).text);
    await http.post('/api/payroll', { fname: 'Ada', lname: 'L', gross: 1000, entity_id: eid, deductions: [{ label: 'Tax', value: 150, type: 'fixed' }] });
    const run = JSON.parse((await http.post('/api/payroll-runs', { period: '2026-06', entity_id: eid })).text);
    const net = (await c.query(`SELECT SUM(net_pay)::float n FROM payroll_run_lines WHERE run_id=$1`, [run.id])).rows[0].n;
    A('premise: the June run line carries net 850 (gross 1,000 − the 150 deduction)', near(net, 850), String(net));
    A('June run approved', (await http.put('/api/payroll-runs/' + run.id + '/approve', {})).status < 300);
    const show = b => JSON.stringify({ source: b.source, cash: b.cash, pl: b.payrollLiabilities, failed: b.gateFailed });
    const served = async (label, cash, pl) => { const b = await glBalanceSheet(uid, eid); A(label, b.source === 'gl' && near(b.cash, cash) && near(b.payrollLiabilities, pl), show(b)); return b; };

    await served('1  approved, unpaid → served from the ledger: cash 800, payroll liabilities 1,000', 800, 1000);
    A('June run marked paid', (await http.put('/api/payroll-runs/' + run.id + '/mark-paid', {})).status < 300);
    await served('2  paid on the net basis → cash −50, liabilities 150 (withholdings still owed)', -50, 150);
    A('withholdings remitted 25 Jul (the pay date — remitting before it is refused)', (await http.put('/api/payroll-runs/' + run.id + '/remit', { date: '2026-07-25' })).status < 300);
    await served('3  withholdings remitted → cash −200, liabilities 0', -200, 0);
    const aug = JSON.parse((await http.post('/api/payroll-runs', { period: '2026-08', entity_id: eid })).text);
    A('August run approved', (await http.put('/api/payroll-runs/' + aug.id + '/approve', {})).status < 300);
    A('August run paid in advance (confirmed)', (await http.put('/api/payroll-runs/' + aug.id + '/mark-paid', { confirm_future: true })).status < 300);
    await served('4  paid before its period → cash −1,050, liabilities still 0 (prepaid until 1 Aug) — no false fallback', -1050, 0);

    const acct = async code => (await c.query(`SELECT id FROM ledger_accounts WHERE user_id=$1 AND entity_id=$2 AND code=$3`, [uid, eid, code])).rows[0].id;
    const phantom = async (type, srcId, key, drCode, crCode, amt) => {
      const e = (await c.query(`INSERT INTO ledger_entries (user_id, entity_id, entry_date, description, source_type, source_id, currency, status, idempotency_key) VALUES ($1,$2,'2026-07-20','Phantom',$3,$4,'USD','posted',$5) RETURNING id`, [uid, eid, type, srcId, key])).rows[0].id;
      await c.query(`INSERT INTO ledger_lines (entry_id, user_id, entity_id, account_id, debit, credit, debit_base, credit_base) VALUES ($1,$2,$3,$4,$6,0,$6,0), ($1,$2,$3,$5,0,$6,0,$6)`, [e, uid, eid, await acct(drCode), await acct(crCode), amt]);
      return e;
    };
    const drop = async e => { await c.query(`DELETE FROM ledger_lines WHERE entry_id=$1`, [e]); await c.query(`DELETE FROM ledger_entries WHERE id=$1`, [e]); };
    const tbTies = async () => { const t = (await c.query(`SELECT COALESCE(SUM(debit),0)::float d, COALESCE(SUM(credit),0)::float cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0]; return near(t.d, t.cr); };

    const p1 = await phantom('manual_phantom', null, 'g9-phantom-1', '2200', '1000', 600);
    A('premise: the trial balance still ties (phantom 1 is balanced)', await tbTies());
    const b5 = await glBalanceSheet(uid, eid);
    A('5  phantom payroll "payment" → not served from the ledger (bug: served, cash −1,650, liabilities −600)', b5.source !== 'gl', show(b5));
    const why5 = (b5.gateFailed || []).join(' | ');
    A('5b …and says why: payroll liabilities disagree with the runs, and an entry has no source document', /payrollLiabilities\(gl=-600 books=0\)/.test(why5) && /untraced\(1 entry .*manual_phantom/.test(why5), why5);
    await drop(p1);

    const p2 = await phantom('journal', 999999, 'g9-phantom-2', '1250', '1000', 300);
    A('premise: the trial balance still ties (phantom 2 is balanced)', await tbTies());
    const b6 = await glBalanceSheet(uid, eid);
    const why6 = (b6.gateFailed || []).join(' | ');
    A('6  an entry claiming a journal that does not exist → not served; named (bug: served, cash −1,350)', b6.source !== 'gl' && /journal:999999 \(document gone\)/.test(why6) && !/payrollLiabilities/.test(why6), show(b6));
    await drop(p2);

    A('expense deleted through its route', (await http.request('DELETE', '/api/expenses/' + exp.id)).status < 300);
    const rev = (await c.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE user_id=$1 AND source_type='expense' AND source_id=$2`, [uid, exp.id])).rows[0].n;
    A('premise: its entry and its reversal are both in the ledger', rev === 2, String(rev));
    await served('7  a deleted document netted out by its reversal is not a phantom → served, cash −850', -850, 0);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (G9 gate)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
