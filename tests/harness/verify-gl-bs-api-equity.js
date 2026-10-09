'use strict';
/**
 * verify-gl-bs-api-equity.js — L40. GET /api/gl/balance-sheet returns raw ledger accounts grouped by type plus
 * `totals` (glFinancials.balanceSheet). totals.equity = posted equity accounts + accumulated (un-closed) net income,
 * but the `equity` group listed only the equity ACCOUNTS — so for any API consumer Σ equity rows ≠ totals.equity
 * whenever income or expense exist (the class L6c fixed on /api/reports/balance-sheet). Fix: the equity group carries
 * one synthetic row for accumulated net income (code null, synthetic true), read from the SAME partition the main
 * balance sheet uses (balanceSheetLines), so the two endpoints cannot disagree. Account rows are unchanged.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes:
 *   invoice 1,000 pending (06-01) · bill 400 unpaid (06-02) · JE 07-01 Dr 1010 Checking 5,000 / Cr 3000 Owner's Equity 5,000
 * HAND-COMPUTED: assets 6,000 (AR 1,000 + cash 5,000) · liabilities 400 · equity 5,600 = Owner's Equity 5,000 +
 *   accumulated net income 600 (1,000 − 400).  6,000 = 400 + 5,600.
 * BUGGY (pre-fix): Σ equity rows 5,000 ≠ totals.equity 5,600; no net-income row.
 * DISCRIMINATING PERIOD CHECK (Rule 4): ?period=month (July) — the July P&L is 0 (both documents are June), so a fix
 *   that used the PERIOD net profit would show 0 here; accumulated net income is 600 in every view.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-gl-bs-api-equity.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const sum = arr => Math.round((arr || []).reduce((s, r) => s + Number(r.balance || 0), 0) * 100) / 100;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L40 — GET /api/gl/balance-sheet: the equity group foots to totals.equity\n' + '='.repeat(78) + '\n');
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: 'l40@finflow.test', name: 'L40', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.140' });
    if ((await http.post('/api/auth/login', { email: 'l40@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
    const ent = await J('/api/entities', { name: 'L40 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('/api/entities/' + ent.id + '/activate', {});
    await J('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-08-01' });
    await J('/api/bills', { vendor: 'Supplier', amount: 400, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-08-02' });
    await J('/api/journals', { date: '2026-07-01', description: 'Owner investment', status: 'Posted',
      lines: [{ code: '1010', name: 'Checking Account', debit: 5000, credit: 0 }, { code: '3000', name: "Owner's Equity", debit: 0, credit: 5000 }] });

    const reportBs = (await http.post('/api/reports/balance-sheet', {})).json || {};
    const mainEarn = ((reportBs.lines && reportBs.lines.equity) || []).find(l => l.key === 'earnings');

    for (const period of ['year', 'month']) {
      const bs = (await http.get('/api/gl/balance-sheet?period=' + period)).json || {};
      const T = bs.totals || {};
      const tag = 'period=' + period;
      A(`${tag}: CONTROL — totals 6,000 / 400 / 5,600, balanced (right before and after the fix)`,
        near(T.assets, 6000) && near(T.liabilities, 400) && near(T.equity, 5600) && T.balanced === true, JSON.stringify(T));
      A(`${tag}: CONTROL — Σ asset rows = totals.assets, Σ liability rows = totals.liabilities`,
        near(sum(bs.assets), T.assets) && near(sum(bs.liabilities), T.liabilities), JSON.stringify({ a: sum(bs.assets), l: sum(bs.liabilities) }));
      const earn = (bs.equity || []).filter(r => r.synthetic === true);
      A(`${tag}: equity group carries exactly one synthetic "accumulated net income" row = 600 (bug: absent)`,
        earn.length === 1 && near(earn[0].balance, 600) && earn[0].code === null && /net income/i.test(String(earn[0].name || '')),
        JSON.stringify(bs.equity));
      A(`${tag}: Σ equity rows = totals.equity 5,600 (bug: 5,000)`, near(sum(bs.equity), 5600) && near(sum(bs.equity), T.equity), 'Σ=' + sum(bs.equity));
      A(`${tag}: account rows unchanged — "Owner's Equity" 5,000 is still a real account row (code 3000 / J3000)`,
        (bs.equity || []).some(r => r.synthetic !== true && /3000$/.test(String(r.code)) && near(r.balance, 5000)), JSON.stringify(bs.equity));
      A(`${tag}: the net-income row equals /api/reports/balance-sheet's (one writer: 600)`,
        earn.length === 1 && mainEarn && near(earn[0].balance, mainEarn.amount), JSON.stringify({ api: earn[0] && earn[0].balance, report: mainEarn && mainEarn.amount }));
    }
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (GL balance-sheet API equity foots)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
