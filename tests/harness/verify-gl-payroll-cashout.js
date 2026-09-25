'use strict';
/*
 * verify-gl-payroll-cashout.js - GL cash completeness: payroll now posts BOTH legs of its life-cycle so
 * the ledger's cash is real (prereq for the balance-sheet cash upgrade).
 *   - approve  -> Dr Payroll Expense (6100) / Cr Payroll Liabilities (2200)  [accrual]
 *   - mark-paid-> Dr Payroll Liabilities (2200) / Cr Cash (1000)             [cash-out] => 2200 nets to 0
 *   - trial balance ties; cash (1000) reflects the payment.
 *   - void reverses BOTH legs -> 6100, 2200 and 1000 all net to 0.
 *   - backfill posts the cash-out for a PAID run and is idempotent (re-run posts nothing new).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-payroll-cashout.js
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
    const { backfillLedgerForUser } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL cash completeness - payroll cash-out (mark-paid clears the liability, reduces cash)\n' + '='.repeat(78) + '\n');
    const email = 'glpay@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Pay Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.86' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const net = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS n FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].n;
    const tbDiff = async () => { const r = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0]; return r.d - r.cr; };
    const entries = async () => (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE user_id=$1`, [uid])).rows[0].n;

    // Seed employee + run, backdate run_date in-period, approve.
    await http.post('/api/payroll', { fname: 'Ada', lname: 'L', gross: 1350, entity_id: eid });
    const run = JSON.parse((await http.post('/api/payroll-runs', { period: '2026-06', entity_id: eid })).text);
    await c.query(`UPDATE payroll_runs SET run_date='2026-06-15' WHERE id=$1`, [run.id]);
    A('approve run', (await http.put('/api/payroll-runs/' + run.id + '/approve', {})).status < 300);
    A('after approve: Payroll Exp (6100) debit 1350', near(await net('6100'), 1350), 'net=' + (await net('6100')));
    A('after approve: Payroll Liab (2200) credit 1350 (net -1350)', near(await net('2200'), -1350), 'net=' + (await net('2200')));
    A('after approve: Cash (1000) untouched (0)', near(await net('1000'), 0), 'net=' + (await net('1000')));

    // Mark paid -> cash-out.
    A('mark-paid', (await http.put('/api/payroll-runs/' + run.id + '/mark-paid', {})).status < 300);
    A('after paid: Payroll Liab (2200) nets to 0 (accrual settled)', near(await net('2200'), 0), 'net=' + (await net('2200')));
    A('after paid: Cash (1000) reduced by 1350 (net -1350)', near(await net('1000'), -1350), 'net=' + (await net('1000')));
    A('after paid: Payroll Exp (6100) still 1350 (expense unchanged)', near(await net('6100'), 1350), 'net=' + (await net('6100')));
    A('after paid: trial balance ties', near(await tbDiff(), 0), 'diff=' + (await tbDiff()));

    // Void -> both legs reverse.
    A('void run', (await http.put('/api/payroll-runs/' + run.id + '/void', {})).status < 300);
    A('after void: 6100, 2200, 1000 all net to 0', near(await net('6100'), 0) && near(await net('2200'), 0) && near(await net('1000'), 0), '6100=' + (await net('6100')) + ' 2200=' + (await net('2200')) + ' 1000=' + (await net('1000')));
    A('after void: trial balance ties', near(await tbDiff(), 0));

    // Backfill posts the cash-out for a PAID run seeded WITHOUT postings, then is idempotent.
    const run2 = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status) VALUES ($1,$2,'2026-05','2026-05-15','paid') RETURNING id`, [uid, eid])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime) VALUES ($1, 800, 0, 0)`, [run2]);
    await backfillLedgerForUser(uid, { entityId: eid });
    A('backfill posts PAID run accrual (6100 += 800 -> 800)', near(await net('6100'), 800), 'net=' + (await net('6100')));
    A('backfill posts PAID run cash-out (2200 net 0, 1000 net -800)', near(await net('2200'), 0) && near(await net('1000'), -800), '2200=' + (await net('2200')) + ' 1000=' + (await net('1000')));
    const before = await entries();
    await backfillLedgerForUser(uid, { entityId: eid });
    A('backfill re-run is idempotent (no new entries)', (await entries()) === before, 'before=' + before + ' after=' + (await entries()));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (payroll cash-out completes the GL cash flow)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
