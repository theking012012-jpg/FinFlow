'use strict';
/**
 * verify-la19-gl-gate-reason.js — LA19 (owner's PowerShell run, 2026-10-14): the GL 5b reconcile gates log
 * "[GL 5b] P&L divergence" / "balance-sheet divergence" when the ledger is not served, but the P&L line printed only
 * rev/cogs/opex/net + tb and the balance-sheet line only AR/AP/tb/cov. The gates ALSO compare gross profit, payroll,
 * FX coverage (P&L) and income + non-FX expenses (balance sheet) — so a failure on one of those printed two IDENTICAL
 * sides and no reason. The fix: each gate lists the checks that failed, by name, with both values; `reconciled` is
 * derived from that same list, so the log cannot disagree with the decision. Served figures are unchanged.
 *
 * Real scratch Postgres, real glProfitLoss / glBalanceSheet. Each case breaks the SCRATCH ledger (failure injection)
 * so that exactly one check the old message never printed fails, and every value it did print stays identical:
 *   A  P&L, payroll leg   — invoice 1,000 · expense 200; the expense's ledger debit moved 6000 → 6100.
 *                           GL payroll 200 vs books 0; rev/cogs/opex/net identical (1,000/0/200/800), tb ties.
 *                           old log: gl{…800} books{…800} tb=true — no reason.   fix: names payroll(gl=200 books=0)
 *   B  P&L, FX coverage   — consolidated: USD business invoice 1,000, then TTD business invoice 500, no USD↔TTD rate.
 *                           No reporting currency chosen ⇒ the base is the OLDEST business's currency (LA21) — USD —
 *                           and the TTD invoice is the unconvertible one. old log: identical gl{} / books{}, no reason.
 *                           fix: names fxCoverage, TTD→USD
 *   C  balance sheet, expenses — invoice 1,000 · expense 200; the expense's whole ledger entry deleted (tb ties).
 *                           GL non-FX expenses 0 vs books 200; AR/AP identical.  fix: names expenses(gl=0 books=200)
 *   D  healthy ledger     — no warning, source 'gl' (the gate's decision is unchanged).
 * Served figures in A–C are computeBooks' (hand-computed: rev 1,000 · opex 200 · net 800) — before and after.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la19-gl-gate-reason.js
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

// Capture the [GL 5b] warnings one call emits.
async function capture(fn) {
  const lines = [], orig = console.warn;
  console.warn = (...a) => { const s = a.map(String).join(' '); if (s.includes('[GL 5b]')) lines.push(s); else orig(...a); };
  try { return { result: await fn(), lines }; } finally { console.warn = orig; }
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { glProfitLoss, glBalanceSheet } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  LA19 — the GL 5b gate log names the check that failed\n' + '='.repeat(78) + '\n');

    let seq = 0;
    const mkUser = async () => {
      const email = 'la19-' + (++seq) + '@finflow.test';
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
        [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
      const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.' + (90 + seq) });
      if ((await http.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login');
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      return { uid, J };
    };
    const mkEntity = async (J, name, currency) => {
      const e = await J('POST', '/api/entities', { name, currency, timezone: 'UTC', country: currency === 'TTD' ? 'TT' : 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      return e.id;
    };
    const seedBasic = async (J) => {
      await J('POST', '/api/invoices', { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-07-01', idempotency_key: 'la19-i-' + seq });
      return J('POST', '/api/expenses', { description: 'Supplies', category: 'Office', amount: 200, deductible: 'yes', expense_date: '2026-06-01', idempotency_key: 'la19-e-' + seq });
    };
    const expenseEntry = async (uid, eid, expId) => (await c.query(
      `SELECT id FROM ledger_entries WHERE user_id=$1 AND entity_id=$2 AND source_type='expense' AND source_id=$3 AND status='posted'`, [uid, eid, expId])).rows.map(r => r.id);

    // ── D: healthy ledger ────────────────────────────────────────────────────────────────
    {
      const { uid, J } = await mkUser(); const eid = await mkEntity(J, 'Healthy Co', 'USD'); await seedBasic(J);
      const { result, lines } = await capture(() => glProfitLoss(uid, eid, { period: 'year' }));
      A('D healthy: P&L served from the ledger, no warning (gate decision unchanged)', result.source === 'gl' && lines.length === 0, JSON.stringify({ source: result.source, lines }));
    }

    // ── A: P&L, payroll leg only ─────────────────────────────────────────────────────────
    {
      const { uid, J } = await mkUser(); const eid = await mkEntity(J, 'Payroll Leg Co', 'USD'); const exp = await seedBasic(J);
      const entries = await expenseEntry(uid, eid, exp.id);
      let acct6100 = (await c.query(`SELECT id FROM ledger_accounts WHERE user_id=$1 AND entity_id=$2 AND code='6100'`, [uid, eid])).rows[0];
      if (!acct6100) acct6100 = (await c.query(`INSERT INTO ledger_accounts (user_id,entity_id,code,name,type,normal,currency,is_system) VALUES ($1,$2,'6100','Payroll Expense','expense','debit','USD',true) RETURNING id`, [uid, eid])).rows[0];
      const mv = await c.query(`UPDATE ledger_lines SET account_id=$1 WHERE entry_id = ANY($2::int[]) AND debit > 0
        AND account_id = (SELECT id FROM ledger_accounts WHERE user_id=$3 AND entity_id=$4 AND code='6000')`, [acct6100.id, entries, uid, eid]);
      A('A setup: moved the expense\'s debit line 6000 → 6100 (scratch ledger)', mv.rowCount === 1, 'moved ' + mv.rowCount + ' entries=' + JSON.stringify(entries));
      const { result, lines } = await capture(() => glProfitLoss(uid, eid, { period: 'year' }));
      A('A served figures are computeBooks\' (rev 1,000 · opex 200 · net 800 · payroll 0)', result.source === 'computeBooks' && near(result.totalRevenue, 1000) && near(result.totalExpenses, 200) && near(result.netProfit, 800) && near(result.payroll, 0), JSON.stringify(result));
      const l = lines.join('\n');
      console.log('     log: ' + (l || '(none)'));
      A('A log names the failing check: payroll(gl=200 books=0)', /payroll\(gl=200 books=0\)/.test(l), 'old message prints rev/cogs/opex/net only — identical here');
      A('A log does not blame a check that passed (rev / net / tb)', l !== '' && !/\brev\(|\bnet\(|\btb\(/.test(l));
    }

    // ── B: P&L, consolidated, FX coverage ────────────────────────────────────────────────
    {
      const { uid, J } = await mkUser();
      await mkEntity(J, 'Dollar Co', 'USD');
      await J('POST', '/api/invoices', { client: 'US Cust', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-07-01', idempotency_key: 'la19-us' });
      await mkEntity(J, 'Island Co', 'TTD');
      await J('POST', '/api/invoices', { client: 'TT Cust', amount: 500, status: 'pending', issue_date: '2026-06-01', due_date: '2026-07-01', idempotency_key: 'la19-tt' });
      const { result, lines } = await capture(() => glProfitLoss(uid, null, { period: 'year' }));
      const l = lines.join('\n');
      console.log('     log: ' + (l || '(none)'));
      A('B consolidated with an unconvertible TTD business: not served from the ledger', result.source === 'computeBooks', JSON.stringify({ source: result.source, rev: result.totalRevenue }));
      A('B log names the failing check: fxCoverage, with the missing pair TTD→USD (base = the oldest business, USD — LA21)', /fxCoverage\([^)]*TTD→USD/.test(l), 'old message: identical gl{} / books{} and tb=true');
    }

    // ── C: balance sheet, non-FX expenses ────────────────────────────────────────────────
    {
      const { uid, J } = await mkUser(); const eid = await mkEntity(J, 'BS Co', 'USD'); const exp = await seedBasic(J);
      const entries = await expenseEntry(uid, eid, exp.id);
      const del = await c.query(`DELETE FROM ledger_entries WHERE id = ANY($1::int[])`, [entries]);
      A('C setup: deleted the expense\'s whole ledger entry (both legs — trial balance still ties)', del.rowCount === 1, 'deleted ' + del.rowCount);
      const { result, lines } = await capture(() => glBalanceSheet(uid, eid));
      const l = lines.filter(s => s.includes('balance-sheet')).join('\n');
      console.log('     log: ' + (l || '(none)'));
      A('C balance sheet falls back to the oracle (AR 1,000)', result.source === 'computeBooks' && near(result.accountsReceivable, 1000), JSON.stringify({ source: result.source, ar: result.accountsReceivable }));
      A('C log names the failing check: expenses(gl=0 books=200)', /expenses\(gl=0 books=200\)/.test(l), 'old message prints AR/AP/tb/cov only — all equal here');
    }

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (GL 5b gate log names the failed check)'));
    console.log('-'.repeat(78) + '\n');
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); console.log(`\n  ${fail} FAILED — ${pass} passed, ${fail} failed\n`); }
  finally { try { if (server && server.close) await server.close(); } catch (_) {} await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main();
