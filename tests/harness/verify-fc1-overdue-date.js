'use strict';
/**
 * verify-fc1-overdue-date.js — F-C1. "Overdue" must be computed from the DUE DATE (unpaid-ish rows
 * whose due_date < entity-today), NOT a literal status==='overdue' that nothing ever sets. A pending
 * invoice past its due date is overdue.
 *
 * EXECUTED against real Postgres + real /api/reports. Discriminating (Rule 14): pre-fix the server sums
 * only status==='overdue' rows, so the past-due PENDING/PARTIAL invoices contribute 0 and overdue=100
 * (only the one literal-overdue row). Post-fix overdue=1400 (1000 pending + 300 partial balance + 100).
 * Clock pinned to 2026-07-25 (America/Port_of_Spain).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fc1-overdue-date.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'fc1-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'FC1 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    const E = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'USD Co', currency: 'USD', is_active: 1, sort_order: 0 }])).rows[0].id;

    const ins = (d) => c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [uid, E, { user_id: uid, ...d }]);
    // today (pinned) = 2026-07-25. issue_date in the past so none are "scheduled".
    await ins({ client: 'PastDuePending', amount: 1000, amount_paid: 0,   status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-20' }); // OVERDUE 1000
    await ins({ client: 'PastDuePartial', amount: 500,  amount_paid: 200, status: 'partial', issue_date: '2026-07-01', due_date: '2026-07-18' }); // OVERDUE balance 300
    await ins({ client: 'LiteralOverdue', amount: 100,  amount_paid: 0,   status: 'overdue', issue_date: '2026-07-01', due_date: '2026-07-19' }); // OVERDUE 100 (both pre & post)
    await ins({ client: 'PaidPastDue',    amount: 2000, amount_paid: 2000,status: 'paid',    issue_date: '2026-07-01', due_date: '2026-07-10' }); // NOT overdue (paid)
    await ins({ client: 'FuturePending',  amount: 9999, amount_paid: 0,   status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-15' }); // NOT overdue (future)
    await ins({ client: 'NoDueDate',      amount: 777,  amount_paid: 0,   status: 'pending', issue_date: '2026-07-01' });                         // NOT overdue (no due date)

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const rep = (await http.get('/api/reports')).json;
    // 1000 (pending) + 300 (partial balance) + 100 (literal overdue) = 1400
    A('reports.overdue = 1400 (past-due unpaid balance, date-based)', Number(rep.overdue) === 1400, `overdue=${rep.overdue}`);
    A('reports.overdue is NOT 0 (regression guard for the status-literal bug)', Number(rep.overdue) !== 0, `overdue=${rep.overdue}`);
    A('outstanding still includes all unpaid (sanity)', Number(rep.outstanding) > Number(rep.overdue), `outstanding=${rep.outstanding} overdue=${rep.overdue}`);

    // STRUCTURAL — every overdue computation is date-based, not a literal status match.
    const srv = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
    AS('server reports.overdue uses entityTodayYmd + due_date (not just status===overdue)',
      /entityTodayYmd\(eid\)[\s\S]{0,500}const overdue[\s\S]{0,400}due_date/.test(srv));
    const am = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8');
    AS('app-main arOutstanding overdue is due_date-based',
      /function arOutstanding[\s\S]{0,1400}i\.due_date[\s\S]{0,200}overdueTotal/.test(am));
    const wp = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-api-wiring-pages.js'), 'utf8');
    AS('wiring-pages bills/vendors overdue via _billsOverdueSum (due_date-based)',
      /_billsOverdueSum[\s\S]{0,400}due_date/.test(wp));
    AS('wiring-pages vendors overdue is computed (no longer null)',
      /setKpiCards\('page-vendors',\s*\[[^\]]*_vOverdue/.test(wp));
    const bundle = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-bundle.js'), 'utf8');
    AS('bundle rebuilt with date-based overdue helper', /_billsOverdueSum[\s\S]{0,400}due_date/.test(bundle));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-C1 date-based overdue)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
