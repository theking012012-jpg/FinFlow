'use strict';
/**
 * verify-a6-test-data-purge.js — A6 (§1.6). The read-only lister and the owner-run purge, run as child processes against
 * a real scratch Postgres seeded through the REAL routes (so every GL entry is the app's own).
 *
 * Seed — one Cowork-style account (e-mail contains "+cowork"), business Northwind:
 *   REAL  invoice Acme 1,000 (+ payment 400) · expense Rent 300 · bill Paper Co 200 · receipt 150 ·
 *         payroll run "October 2026" paid (owner on it → an owner-salary row in Personal) · budget Rent 60,000 ·
 *         personal "Groceries" 120
 *   TEST  invoice "ZZ-LIVECHECK flow" 777 (+ payment 40) · invoice "AUDIT TEST ZZ" 7,777 · expense "AUDIT TEST EXP" 888 ·
 *         bill "AUDIT TEST VENDOR" 444 · bill "ZZ-LIVECHECK bill C4" 30 (+ payment 30) · receipt "ZZ-LIVECHECK receipt" 50
 *         · project "ZZ-LIVECHECK P1" + 1.5 h on it · quote "ZZ-LIVECHECK quote" · run "November 2026" PAID (+ owner
 *         salary) · budget key Software 600 · FreshBooks request · personal "ZZ-LIVECHECK personal" 5 · link to
 *         accountant "QA Tester"
 * The ledger's per-account balances are measured BEFORE any test record exists — the independent expectation (Rule 6).
 *   1  lister: finds every test record, none of the real ones; changes nothing
 *   2  dry run changes nothing; --apply without --expect → refused; wrong fingerprint → refused
 *   3  a test record inside a LOCKED period → refused, nothing changed
 *   4  apply: every business account balance back to the pre-test baseline, to the cent      (a raw delete leaves
 *      the ledger with the test entries still posted — the books would not tie)
 *   5  the November run is VOIDED (not deleted) and its owner salary is out of Personal; October's run and salary stay
 *   6  every real row is byte-identical; budget row keeps Rent 60,000 and loses only Software
 *   7  the lister now finds 0; each business removal has an audit row; the personal removals are in personal history
 */
require('./clock.js');
const path = require('path');
const bcrypt = require('bcryptjs');
const { spawnSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const ROOT = path.join(__dirname, '..', '..');
const LIST = path.join(ROOT, 'tools', 'launch', 'list-test-data.js');
const PURGE = path.join(ROOT, 'tools', 'launch', 'purge-test-data.js');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nA6 — test-data lister + purge keep the books tied\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'owner+cowork1@finflow.test', name: 'Sam Owner', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'owner+cowork1@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 300)); return r.json; };
    const eid = (await J('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
    await J('POST', '/api/entities/' + eid + '/activate', {});

    // ── REAL ──
    const iR = await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-02', idempotency_key: 'r-i' });
    await J('POST', '/api/invoice-payments', { invoice_id: iR.id, amount: 400, payment_date: '2026-07-05', idempotency_key: 'r-p' });
    await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 300, expense_date: '2026-07-03', idempotency_key: 'r-e' });
    await J('POST', '/api/bills', { vendor: 'Paper Co', amount: 200, status: 'unpaid', issue_date: '2026-07-04', due_date: '2026-08-04', idempotency_key: 'r-b' });
    await J('POST', '/api/sales-receipts', { customer: 'Walk-in', amount: 150, date: '2026-07-06', method: 'Cash', idempotency_key: 'r-s' });
    await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Owner', gross: 2000, is_owner: true, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
    const octRun = await J('POST', '/api/payroll-runs', { period: 'October 2026', idempotency_key: 'r-run' });
    await J('PUT', '/api/payroll-runs/' + octRun.id + '/approve', {}); await J('PUT', '/api/payroll-runs/' + octRun.id + '/mark-paid', {});
    await J('PUT', '/api/budget-targets', { Rent: 60000 });   // the body IS the map (as the app sends it)
    await J('POST', '/api/personal-transactions', { description: 'Groceries', amount: 120, currency: 'USD', category: 'Food', tx_type: 'expense', tx_date: '2026-07-07' });

    const TABLES = ['invoices', 'invoice_payments', 'expenses', 'bills', 'payments_made', 'sales_receipts', 'payroll_runs', 'payroll_run_lines', 'projects', 'timesheet', 'quotes', 'personal_transactions', 'support_requests'];
    const snap = async () => { const o = {}; for (const t of TABLES) o[t] = (await c.query(`SELECT * FROM ${t} ORDER BY id`)).rows.map(r => JSON.stringify(Object.assign({}, r, { updated_at: undefined }))); return o; };
    const realRows = await snap();
    const ledger = async () => Object.fromEntries((await c.query(
      `SELECT la.code AS code, ROUND(SUM(l.debit - l.credit)::numeric, 2)::text AS net FROM ledger_lines l JOIN ledger_accounts la ON la.id = l.account_id
        WHERE l.user_id = $1 AND l.entity_id = $2 GROUP BY 1 ORDER BY 1`, [uid, eid])).rows.map(r => [r.code, r.net]));
    const baseline = await ledger();

    // ── TEST ──
    const iT = await J('POST', '/api/invoices', { client: 'ZZ-LIVECHECK flow', amount: 777, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: 't-i1' });
    await J('POST', '/api/invoice-payments', { invoice_id: iT.id, amount: 40, payment_date: '2026-07-11', notes: 'ZZ-LIVECHECK payment C3', idempotency_key: 't-p1' });
    await J('POST', '/api/invoices', { client: 'AUDIT TEST ZZ', amount: 7777, status: 'pending', issue_date: '2026-07-12', due_date: '2026-08-12', idempotency_key: 't-i2' });
    await J('POST', '/api/expenses', { description: 'AUDIT TEST EXP', category: 'Other', amount: 888, expense_date: '2026-07-13', idempotency_key: 't-e' });
    await J('POST', '/api/bills', { vendor: 'AUDIT TEST VENDOR', amount: 444, status: 'unpaid', issue_date: '2026-07-14', due_date: '2026-08-14', idempotency_key: 't-b1' });
    const bT = await J('POST', '/api/bills', { vendor: 'ZZ-LIVECHECK bill C4', amount: 30, status: 'unpaid', issue_date: '2026-07-15', due_date: '2026-08-15', idempotency_key: 't-b2' });
    await J('POST', '/api/payments-made', { vendor: 'ZZ-LIVECHECK bill C4', bill_id: bT.id, amount: 30, date: '2026-07-16', method: 'Bank', idempotency_key: 't-pm' });
    await J('POST', '/api/sales-receipts', { customer: 'ZZ-LIVECHECK receipt', amount: 50, date: '2026-07-17', method: 'Card', idempotency_key: 't-s' });
    const prT = await J('POST', '/api/projects', { name: 'ZZ-LIVECHECK P1', budget: 500 });
    await J('POST', '/api/timesheet', { employee: 'Sam Owner', project_id: prT.id, date: '2026-07-18', hours: 1.5, billable: 'Yes', rate: 80 });
    await J('POST', '/api/quotes', { client: 'ZZ-LIVECHECK quote', amount: 100, expiry_date: '2026-08-30' });
    const novRun = await J('POST', '/api/payroll-runs', { period: 'November 2026', idempotency_key: 't-run' });
    await J('PUT', '/api/payroll-runs/' + novRun.id + '/approve', {}); await J('PUT', '/api/payroll-runs/' + novRun.id + '/mark-paid', {});
    await J('PUT', '/api/budget-targets', { Rent: 60000, Software: 600 });
    await c.query(`INSERT INTO support_requests (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [uid, eid, { subject: 'Integration request', message: 'Please add FreshBooks', status: 'open' }]);
    await J('POST', '/api/personal-transactions', { description: 'ZZ-LIVECHECK personal', amount: 5, currency: 'USD', category: 'Other', tx_type: 'expense', tx_date: '2026-07-19' });
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code) VALUES ('qa@finflow.test', 'x', 'QA', 'Tester', 'QA-TESTER-A6') RETURNING id`)).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id) VALUES ($1, $2)`, [accId, uid]);
    const ledgerWithTest = await ledger();

    const env = Object.assign({}, process.env, { DATABASE_URL: scratch.url });
    const run = (f, args = []) => { const r = spawnSync(process.execPath, [f, ...args], { env, encoding: 'utf8', timeout: 120000 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
    const fullFp = async () => JSON.stringify(await snap()) + JSON.stringify(await ledger()) + (await c.query(`SELECT COUNT(*) n FROM audit_trail`)).rows[0].n;

    // 1 lister
    const f0 = await fullFp();
    const L = run(LIST, ['--json']);
    let listed = null; try { listed = JSON.parse(L.out.slice(L.out.indexOf('{'))); } catch (_) {}
    const keys = listed ? [...listed.marked, ...listed.linked, ...listed.named, ...listed.review].map(x => x.table).sort() : null;
    eq('1  lister finds the 17 test records by table', keys, ['accountant_clients', 'bills', 'bills', 'budget_targets', 'expenses', 'invoice_payments', 'invoices', 'invoices',
      'payments_made', 'payroll_runs', 'personal_transactions', 'personal_transactions', 'projects', 'quotes', 'sales_receipts', 'support_requests', 'timesheet'].concat([]).sort());
    eq('1  lister names none of the real records (Acme / Rent / Paper Co / Walk-in / Groceries / October)', /Acme|"Rent"|Paper Co|Walk-in|Groceries|October/.test(L.out), false);
    eq('1  lister changed nothing', await fullFp() === f0, true);

    // 2 dry run + refusals
    const D = run(PURGE);
    const fp = (D.out.match(/fingerprint ([0-9a-f]{16})/) || [])[1];
    eq('2  dry run prints a fingerprint, changes nothing', [!!fp, await fullFp() === f0], [true, true]);
    eq('2  --apply without --expect → refused (2), nothing changed', [run(PURGE, ['--apply']).status, await fullFp() === f0], [2, true]);
    eq('2  wrong fingerprint → refused (3), nothing changed', [run(PURGE, ['--apply', '--expect', '0000000000000000']).status, await fullFp() === f0], [3, true]);

    // 3 lock
    const lockId = (await c.query(`INSERT INTO lock_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`, [uid, eid, { enabled: 1, lock_date: '2026-07-12' }])).rows[0].id;
    const Lk = run(PURGE, ['--apply', '--expect', fp]);
    eq('3  record inside a LOCKED period → refused (4), nothing changed', [Lk.status, /LOCKED period/.test(Lk.out), await fullFp() === f0], [4, true, true]);
    await c.query(`DELETE FROM lock_settings WHERE id = $1`, [lockId]);

    // 4–7 apply
    const P = run(PURGE, ['--apply', '--expect', fp]);
    eq('4  apply exits 0', P.status, 0);
    if (P.status !== 0) console.log(P.out.split('\n').slice(-25).join('\n'));
    eq('4  ledger balances back to the pre-test baseline, account by account', await ledger(), baseline, ledgerWithTest);
    const nov = (await c.query(`SELECT status FROM payroll_runs WHERE id = $1`, [novRun.id])).rows[0];
    const sal = (await c.query(`SELECT data->>'payroll_run_id' r FROM personal_transactions WHERE user_id = $1 AND data->>'source' = 'payroll' ORDER BY id`, [uid])).rows.map(r => Number(r.r));
    eq('5  November run VOIDED (kept), its owner salary removed; October\'s salary stays', [nov && nov.status, sal], ['voided', [octRun.id]]);
    const after = await snap();
    const missing = []; for (const t of TABLES) for (const r of realRows[t]) if (!after[t].includes(r)) missing.push(t + ':' + JSON.parse(r).id);
    eq('6  every real row byte-identical after the purge', missing, []);
    eq('6  budget row: Rent 60,000 kept, Software gone', (await c.query(`SELECT data->'targets' t FROM budget_targets WHERE user_id = $1`, [uid])).rows.map(r => r.t), [{ Rent: 60000 }]);
    const L2 = run(LIST);
    eq('7  lister now finds 0', (L2.out.match(/(\d+) test records/) || [])[1], '0');
    const au = (await c.query(`SELECT table_name, action FROM audit_trail WHERE actor_type = 'system' AND (old_data->>'purge' IS NOT NULL OR table_name = 'budget_targets') ORDER BY table_name, action`)).rows.map(r => r.table_name + ' ' + r.action);
    eq('7  audit rows for the business removals', au.sort(), ['accountant_clients DELETE', 'bills DELETE', 'bills DELETE', 'budget_targets UPDATE', 'expenses DELETE', 'invoice_payments DELETE',
      'invoices DELETE', 'invoices DELETE', 'payments_made DELETE', 'payroll_runs VOID', 'projects DELETE', 'quotes DELETE', 'sales_receipts DELETE', 'support_requests DELETE', 'timesheet DELETE']);
    const ph = (await c.query(`SELECT kind, action FROM personal_history WHERE actor_type = 'system' ORDER BY id`)).rows.map(r => r.kind + ' ' + r.action);
    eq('7  personal removals recorded in personal history (never the business trail)', ph.filter(x => /DELETE/.test(x)).sort(), ['owner_salary DELETE', 'personal_transactions DELETE']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
