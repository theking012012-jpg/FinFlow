'use strict';
/**
 * verify-gl-post-payroll.js — GL Phase 2: payroll posting (Dr Payroll Expense / Cr Payroll Liabilities).
 * Drives POST /api/payroll (employee) → POST /api/payroll-runs → PUT approve. Proves:
 *   - NO entry while the run is draft (recognition is at APPROVE, mirroring PAYROLL_RECOGNIZED);
 *   - a balanced entry appears on approve, Dr 6100 / Cr 2200, for gross+bonus+overtime (basis C, Rule 12
 *     — reads the LINES, not the header), dated at the run's PERIOD (payrollPeriodYmd), not run_date;
 *   - ledger Payroll Expense == computeBooks.opex (oracle; payroll is the only opex here);
 *   - mark-paid adds NOTHING further (already recognised at approve);
 *   - trial balance ties to zero.
 * Discriminating seed (Rule 4): gross 1000 + bonus 250 + overtime 100 = 1350, so a gross-only or
 * net-only posting cannot pass.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-payroll.js
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
    const { computeBooks } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — payroll (Dr Payroll Expense 6100 / Cr Payroll Liabilities 2200)\n' + '='.repeat(78) + '\n');
    const email = 'glpayroll@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.71' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    // Employee scoped to the entity.
    const empR = await http.post('/api/payroll', { fname: 'Ada', lname: 'Lovelace', gross: 1000, entity_id: eid });
    A('POST employee 2xx', empR.status >= 200 && empR.status < 300, 'status=' + empR.status + ' ' + (empR.text || '').slice(0, 140));
    const emp = JSON.parse(empR.text);

    // Run for period 2026-06 with a bonus + overtime override → gross 1000 + bonus 250 + ot 100 = 1350.
    const runR = await http.post('/api/payroll-runs', { period: '2026-06', entity_id: eid, bonus_overrides: { [emp.id]: 250 }, overtime_overrides: { [emp.id]: 100 } });
    A('POST payroll-run 2xx', runR.status >= 200 && runR.status < 300, 'status=' + runR.status + ' ' + (runR.text || '').slice(0, 160));
    const run = JSON.parse(runR.text);
    A('run line total = 1350 (gross+bonus+overtime)', run.lines && near((parseFloat(run.lines[0].gross) || 0) + (parseFloat(run.lines[0].bonus) || 0) + (parseFloat(run.lines[0].overtime) || 0), 1350), JSON.stringify(run.lines && run.lines[0]));

    // Draft → NO ledger entry yet (recognition is at approve).
    const draftEntries = (await c.query(`SELECT id FROM ledger_entries WHERE source_type='payroll_run' AND source_id=$1`, [run.id])).rows;
    A('NO entry while draft (recognised at approve)', draftEntries.length === 0, 'got ' + draftEntries.length);

    // Approve → the entry posts.
    const apR = await http.put('/api/payroll-runs/' + run.id + '/approve', {});
    A('PUT approve 2xx', apR.status >= 200 && apR.status < 300, 'status=' + apR.status + ' ' + (apR.text || '').slice(0, 140));
    const entry = (await c.query(`SELECT id, entry_date::text AS entry_date FROM ledger_entries WHERE source_type='payroll_run' AND source_id=$1`, [run.id])).rows;
    A('one ledger entry posted on approve', entry.length === 1, 'got ' + entry.length);
    const lines = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.entry_id=$1`, [entry[0] ? entry[0].id : -1])).rows;
    const byCode = Object.fromEntries(lines.map(l => [l.code, l]));
    A('Dr Payroll Expense (6100) = 1350', byCode['6100'] && near(byCode['6100'].debit, 1350) && near(byCode['6100'].credit, 0), JSON.stringify(byCode['6100']));
    A('Cr Payroll Liabilities (2200) = 1350', byCode['2200'] && near(byCode['2200'].credit, 1350) && near(byCode['2200'].debit, 0), JSON.stringify(byCode['2200']));
    A('entry balances', near(lines.reduce((s, l) => s + +l.debit, 0), lines.reduce((s, l) => s + +l.credit, 0)));
    A('posted at PERIOD date 2026-06-01 (not run_date)', entry[0] && entry[0].entry_date === '2026-06-01', entry[0] && entry[0].entry_date);

    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger Payroll Expense (1350) == computeBooks.opex', near(await bal('6100'), books.opex) && near(books.opex, 1350), 'ledger6100=' + (await bal('6100')) + ' opex=' + books.opex);
    A('ledger Payroll Liabilities balance == 1350 (credit)', near(await bal('2200'), -1350), 'liab=' + (await bal('2200')));

    // mark-paid adds NOTHING further (already recognised at approve).
    const mpR = await http.put('/api/payroll-runs/' + run.id + '/mark-paid', {});
    A('PUT mark-paid 2xx', mpR.status >= 200 && mpR.status < 300, 'status=' + mpR.status);
    const afterPaid = (await c.query(`SELECT id FROM ledger_entries WHERE source_type='payroll_run' AND source_id=$1`, [run.id])).rows;
    A('mark-paid adds NO further entry (still 1)', afterPaid.length === 1, 'got ' + afterPaid.length);
    const books2 = await computeBooks(uid, eid, 'year');
    A('opex unchanged after mark-paid (still 1350)', near(books2.opex, 1350) && near(await bal('6100'), 1350), 'opex=' + books2.opex);

    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));
    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL payroll == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
