'use strict';
/**
 * verify-v1-payroll-prepaid.js — V1 (competitor gap audit 2026-10-22; owner decision D1 = option A).
 *
 * Live: a "November 2026" run paid on 14 Oct showed Payroll Expense 0 (correct — accrual by period, decision 2 / F85)
 * and Payroll Liabilities −6,700 (wrong). The cash-out posted Dr 2200 / Cr 1000 on the pay date while the accrual
 * (Cr 2200) is dated the period start, which D2 hides until then — so 2200 carried a debit: a prepayment shown as a
 * negative liability. Nothing warned before paying a period that had not started.
 *
 * D1 (option A): cash for a run that leaves BEFORE its period starts is a prepayment — Dr 1250 Prepaid Payroll /
 * Cr 1000 on the cash date, released Dr 2200 / Cr 1250 on the period's first day. Mark-paid on a future period needs
 * an explicit confirmation (audited). Expense recognition is unchanged.
 *
 * Real Postgres + real routes; clock pinned 2026-07-25 (business in UTC). DISCRIMINATING seed (Rule 4):
 *   employee gross 8,000, withholding 16.25 % → net 6,700, withholdings 1,300
 *   run A "August 2026" (future period) — approved, paid early        → prepayment 6,700
 *   run B "July 2026"   (current period) — approved, paid             → withholdings 1,300 owed in 2200
 * A presentation-only fix nets both inside 2200 (debit 5,400 → "prepaid 5,400", hiding the 1,300 owed). EXPECTED:
 *   2200 Payroll Liabilities = 1,300 owed · 1250 Prepaid Payroll = 6,700 · 6100 = 8,000 (July only)
 *   bug: 2200 = −5,400 (debit), no 1250, mark-paid on August returns 200 with no confirmation
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-v1-payroll-prepaid.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const eq = (n, measured, expected, bug) => A(n + `  [measured ${JSON.stringify(measured)}, correct ${JSON.stringify(expected)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, JSON.stringify(measured) === JSON.stringify(expected));
const r2 = n => Math.round((+n || 0) * 100) / 100;
const PW = 'harness-password-not-a-secret';

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { backfillLedgerForUser } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  V1 — payroll paid before its period is a PREPAYMENT, never a negative liability\n' + '='.repeat(78) + '\n');
    const email = 'v1pay@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', name: 'V1 Owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`,
      [uid, { name: 'Prepay Co', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.87' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    // account balance (natural direction), all entries dated on or before today — what every statement shows
    const bal = async code => {
      const { rows: [r] } = await c.query(
        `SELECT COALESCE(SUM(ll.debit - ll.credit),0)::float AS n, MAX(la.normal) AS normal FROM ledger_accounts la
           LEFT JOIN ledger_lines ll ON ll.account_id = la.id
           LEFT JOIN ledger_entries le ON le.id = ll.entry_id AND le.status = 'posted' AND le.entry_date <= '2026-07-25'
          WHERE la.user_id=$1 AND la.entity_id=$2 AND la.code=$3 AND (ll.id IS NULL OR le.id IS NOT NULL)`, [uid, eid, code]);
      if (!r || r.normal == null) return null;                                   // account does not exist
      return r2(r.normal === 'debit' ? r.n : -r.n);
    };

    await http.post('/api/payroll', { fname: 'Ada', lname: 'Lovelace', gross: 8000, entity_id: eid, deductions: [{ label: 'Withholding', value: 16.25, type: 'percent' }] });
    const runA = (await http.post('/api/payroll-runs', { period: 'August 2026', idempotency_key: 'v1-run-a' })).json;
    const runB = (await http.post('/api/payroll-runs', { period: 'July 2026', idempotency_key: 'v1-run-b' })).json;
    const legs = (await c.query(`SELECT COALESCE(SUM(gross),0)::float AS g, COALESCE(SUM(net_pay),0)::float AS n FROM payroll_run_lines WHERE run_id=$1`, [runA.id])).rows[0];
    eq('premise: run lines gross 8,000 / net 6,700 (withholdings 1,300)', [r2(legs.g), r2(legs.n)], [8000, 6700]);
    A('approve both runs', (await http.put('/api/payroll-runs/' + runA.id + '/approve', {})).status < 300 && (await http.put('/api/payroll-runs/' + runB.id + '/approve', {})).status < 300);

    // ── 1. Paying a period that has not started needs a confirmation ──
    const early = await http.put('/api/payroll-runs/' + runA.id + '/mark-paid', {});
    eq('1  mark-paid on "August 2026" (starts after today) without confirmation → HTTP', early.status, 409, 200);
    eq('1b the refusal names the period start the expense lands on', (early.json || {}).recognised_on, '2026-08-01');
    A('1c the refusal explains itself (code FUTURE_PERIOD, message names the period)', (early.json || {}).code === 'FUTURE_PERIOD' && /August 2026/.test((early.json || {}).error || ''), JSON.stringify(early.json));
    const stA = (await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runA.id])).rows[0].status;
    eq('1d nothing changed on refusal: run A still approved', stA, 'approved', 'paid');
    eq('1e confirmed → paid', (await http.put('/api/payroll-runs/' + runA.id + '/mark-paid', { confirm_future: true })).status, 200);
    const aud = (await c.query(`SELECT COUNT(*)::int AS n FROM audit_trail WHERE user_id=$1 AND table_name='payroll_runs' AND action='PAY_IN_ADVANCE' AND record_id::text=$2::text`, [uid, runA.id])).rows[0].n;
    eq('1f the confirmed prepayment is audited (one PAY_IN_ADVANCE row)', aud, 1, 0);

    // ── 2. Run B: a normal July run, paid now (no confirmation needed) ──
    eq('2  mark-paid on "July 2026" (period started) → HTTP 200, no confirmation', (await http.put('/api/payroll-runs/' + runB.id + '/mark-paid', {})).status, 200);

    // ── 3. The ledger: prepayment and liability in their own accounts ──
    eq('3a 1250 Prepaid Payroll = 6,700 (August wages paid early)', await bal('1250'), 6700, null);
    eq('3b 2200 Payroll Liabilities = 1,300 (July withholdings owed)', await bal('2200'), 1300, -5400);
    eq('3c 6100 Payroll Expense = 8,000 (July only; August lands on 1 Aug)', await bal('6100'), 8000);
    eq('3d 1000 Cash = −13,400 (both runs\' net pay)', await bal('1000'), -13400);
    const rel = (await c.query(`SELECT entry_date::text AS d FROM ledger_entries WHERE user_id=$1 AND idempotency_key=$2`, [uid, 'payroll_paid_release:' + runA.id])).rows[0];
    eq('3e the release (Dr 2200 / Cr 1250) is dated the period start', rel && rel.d, '2026-08-01', undefined);

    // ── 4. Every surface (Rule 2) ──
    const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
    eq('4a balance sheet is ledger-sourced (premise)', bs.source, 'gl');
    eq('4b balance sheet Payroll Liabilities = 1,300', bs.payrollLiabilities, 1300, -5400);
    const pp = ((bs.lines || {}).assets || []).find(l => /prepaid payroll/i.test(l.label || ''));
    eq('4c balance sheet shows a "Prepaid Payroll" asset line of 6,700', pp ? pp.amount : null, 6700, null);
    A('4d balance sheet foots: assets = liabilities + equity', Math.abs(r2(bs.totalAssets) - r2(r2(bs.totalLiabilities) + r2(bs.equity))) < 0.01, JSON.stringify({ a: bs.totalAssets, l: bs.totalLiabilities, e: bs.equity }));
    const accts = ((await http.get('/api/gl/accounts')).json || {}).accounts || [];
    const ac = code => { const a = accts.find(x => x.code === code); return a ? r2(a.balance) : null; };
    eq('4e Chart of Accounts (/api/gl/accounts): 2200 = 1,300 and 1250 = 6,700', [ac('2200'), ac('1250')], [1300, 6700], [-5400, null]);
    const gl = (await http.get('/api/gl/balance-sheet')).json || {};
    const glL = (gl.liabilities || []).find(x => x.code === '2200'), glA = (gl.assets || []).find(x => x.code === '1250');
    eq('4f raw GL balance sheet: 2200 = 1,300, 1250 = 6,700', [glL ? r2(glL.balance) : null, glA ? r2(glA.balance) : null], [1300, 6700]);
    const pnl = (await http.get('/api/gl/pnl')).json || {};
    const p6100 = (pnl.lines || []).find(l => l.code === '6100');
    eq('4g P&L (year) payroll = 8,000 — August not yet recognised (control: unchanged by V1)', p6100 ? r2(p6100.amount) : null, 8000);

    // ── 5. Backfill rebuilds the identical ledger (Phase 4 byte identity) ──
    const snap = async () => (await c.query(
      `SELECT le.idempotency_key AS k, le.entry_date::text AS d, string_agg(la.code || ':' || ll.debit::text || '/' || ll.credit::text, ',' ORDER BY la.code, ll.debit) AS l
         FROM ledger_entries le JOIN ledger_lines ll ON ll.entry_id = le.id JOIN ledger_accounts la ON la.id = ll.account_id
        WHERE le.user_id=$1 GROUP BY le.id, le.idempotency_key, le.entry_date ORDER BY le.idempotency_key`, [uid])).rows.map(r => r.k + '@' + r.d + '=' + r.l).join('\n');
    const before = await snap();
    await c.query(`DELETE FROM ledger_lines WHERE user_id=$1`, [uid]);
    await c.query(`DELETE FROM ledger_entries WHERE user_id=$1`, [uid]);
    await backfillLedgerForUser(uid, { entityId: eid });
    const after = await snap();
    A('5  backfill rebuilds a byte-identical ledger (keys, dates, accounts, amounts)', before === after && before.length > 0,
      'live:\n' + before + '\n--- backfill:\n' + after);

    // ── 6. Remit July's withholdings → 2200 back to 0 ──
    eq('6  remit July withholdings → HTTP 200', (await http.put('/api/payroll-runs/' + runB.id + '/remit', {})).status, 200);
    eq('6b 2200 = 0 after remitting; 1250 still 6,700', [await bal('2200'), await bal('1250')], [0, 6700]);

    // ── 7. Void the prepaid run → every leg reverses, release included ──
    eq('7  void run A → HTTP 200', (await http.put('/api/payroll-runs/' + runA.id + '/void', {})).status, 200);
    const all = async code => r2((await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS n FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id JOIN ledger_entries le ON le.id=ll.entry_id WHERE ll.user_id=$1 AND la.code=$2`, [uid, code])).rows[0].n);
    eq('7b after void, all-time (incl. future-dated): 1250 = 0 and 2200 = 0', [await all('1250'), await all('2200')], [0, 0]);
    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1`, [uid])).rows[0];
    A('7c trial balance ties', Math.abs(tb.d - tb.cr) < 0.01, JSON.stringify(tb));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (V1 payroll prepaid)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
