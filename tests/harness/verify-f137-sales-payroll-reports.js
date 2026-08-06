'use strict';
/**
 * verify-f137-sales-payroll-reports.js — PROVE (Rule 14) that the Sales by Customer (F137-e) and
 * Payroll Summary (F137-f) reports render their OWN content — not the generic P&L overview — with
 * canonical totals.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f137-sales-payroll-reports.js
 *
 * Real SPA in jsdom + real bundle + real seeded scratch Postgres. Seeds two invoices (distinct
 * customers) and one payroll run with two line items, drives each report, and checks the modal.
 *
 * EXPECTED:
 *   CURRENT bundle — generic modal ("incl. bills & payroll") → FAIL.
 *   FIXED bundle — Sales by Customer shows Revenue by customer + Total Revenue (== server P&L
 *     totalRevenue); Payroll Summary lists the run + Total Gross/Net (Σ line items, basis C) → GREEN.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const s = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(s)) return;
  throw e;
});

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
          [uid, { client: 'Cust Alpha', amount: 3000, status: 'pending', issue_date: '2026-07-05' }]);
        await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
          [uid, { client: 'Cust Beta', amount: 1000, status: 'paid', issue_date: '2026-07-06', amount_paid: 1000 }]);
        // A payroll run (typed table) + two line items (basis C source of truth). gross 2000/1000, net 1600/800.
        const run = (await c.query(
          `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net, notes)
           VALUES ($1,NULL,$2,NOW(),$3,$4,$5,$6,'') RETURNING id`,
          [uid, '2026-07', 'approved', 3000, 600, 2400]
        )).rows[0].id;
        await c.query(`INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,$2,$3,$4,0,0,'[]'::jsonb,$5)`,
          [run, 1, 'Alice A', 2000, 1600]);
        await c.query(`INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,$2,$3,$4,0,0,'[]'::jsonb,$5)`,
          [run, 2, 'Bob B', 1000, 800]);
      },
    });
    const { window, http, settle } = boot;

    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    A('runtime winner present: window.generateReport', typeof window.generateReport === 'function');

    const fmt = (typeof window._fmtMoneyNative === 'function')
      ? window._fmtMoneyNative
      : (n) => '$' + (parseFloat(n) || 0).toFixed(2);
    const flatten = s => (s || '').replace(/\s+/g, '');
    const bodyOf = async (reportName) => {
      await window.generateReport(reportName);
      await settle(25, 60);
      const el = window.document.getElementById('rpt-body');
      return { raw: el ? (el.textContent || '') : '', flat: flatten(el ? el.textContent : '') };
    };

    const pl = await http.post('/api/reports/profit-loss', {});
    const srvRev = Number(pl.json?.totalRevenue);
    console.log(`  [server] totalRevenue=${srvRev}`);

    // ── F137-e Sales by Customer ──
    const sb = await bodyOf('Sales by Customer');
    console.log(`  [Sales] ${sb.raw.replace(/\s+/g, ' ').trim().slice(0, 150)}`);
    A('Sales: shows "Revenue by customer" + "Total Revenue" (own content)',
      /Revenue by customer/i.test(sb.raw) && /Total Revenue/i.test(sb.raw));
    A('Sales: NOT the generic P&L modal', !/incl\.\s*bills/i.test(sb.raw));
    A('Sales: Total Revenue === canonical revenue (server P&L totalRevenue)',
      sb.flat.includes('TotalRevenue' + flatten(fmt(srvRev))), `want TotalRevenue${flatten(fmt(srvRev))} (rev=${srvRev})`);
    A('Sales: seeded customer "Cust Alpha" appears in the breakdown', /Cust Alpha/.test(sb.raw));

    // ── F137-f Payroll Summary ──
    const py = await bodyOf('Payroll Summary');
    console.log(`  [Payroll] ${py.raw.replace(/\s+/g, ' ').trim().slice(0, 150)}`);
    A('Payroll: shows "Payroll runs" + "Total Gross / Net" (own content)',
      /Payroll runs/i.test(py.raw) && /Total Gross/i.test(py.raw));
    A('Payroll: NOT the generic P&L modal', !/incl\.\s*bills/i.test(py.raw));
    A('Payroll: seeded run period "2026-07" appears', /2026-07/.test(py.raw));
    A('Payroll: seeded run net (Σ line net_pay = 2400) appears via native formatter',
      py.flat.includes(flatten(fmt(2400))), `want ${flatten(fmt(2400))} in body`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
