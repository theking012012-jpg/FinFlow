'use strict';
/**
 * verify-f137-cashflow-ar-ap-reports.js — PROVE (Rule 14) that the Cash Flow (F137-b), Accounts
 * Receivable (F137-c) and Accounts Payable (F137-d) reports each render their OWN content — not the
 * generic P&L overview — and that their totals equal the canonical sources.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f137-cashflow-ar-ap-reports.js
 *
 * Boots the REAL SPA in jsdom (real bundle → the shipped window.generateReport winner) against a real
 * seeded scratch Postgres + real server, seeds an unpaid invoice + an unpaid bill, drives each report,
 * and checks the rendered modal against the server's canonical figures.
 *
 * EXPECTED:
 *   CURRENT bundle — all three render the generic modal ("incl. bills & payroll", no report-specific
 *     headings) → FAIL.
 *   FIXED bundle — Cash Flow shows Monthly Cash Flow + Net (== Σ inflow−outflow); AR shows
 *     Outstanding by customer + Total Receivable (== balance-sheet AR); AP shows Outstanding by vendor
 *     + Total Payable (== balance-sheet AP) → ALL GREEN.
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
          [uid, { client: 'F137 Cust', amount: 2000, status: 'pending', issue_date: '2026-07-10' }]);
        await c.query(`INSERT INTO bills (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
          [uid, { vendor: 'F137 Vend', num: 'BILL-7100', amount: 500, status: 'unpaid', issue_date: '2026-07-10', due_date: '2026-07-31' }]);
      },
    });
    const { window, http, settle } = boot;

    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(12, 100);
    A('runtime winner present: window.generateReport', typeof window.generateReport === 'function');

    const fmt = (typeof window._fmtMoneyNative === 'function')
      ? window._fmtMoneyNative
      : (n) => '$' + (parseFloat(n) || 0).toFixed(2);
    const flatten = s => (s || '').replace(/\s+/g, '');
    const bodyFlat = async (reportName) => {
      await window.generateReport(reportName);
      await settle(25, 60);
      const el = window.document.getElementById('rpt-body');
      return { raw: el ? (el.textContent || '') : '', flat: flatten(el ? el.textContent : '') };
    };

    // Canonical oracles from the server.
    const bs = await http.post('/api/reports/balance-sheet', {});
    const srvAR = Number(bs.json?.accountsReceivable);
    const srvAP = Number(bs.json?.accountsPayable);
    const cf = await http.post('/api/reports/cash-flow', {});
    const cfRows = Array.isArray(cf.json?.rows) ? cf.json.rows : [];
    const srvNet = cfRows.reduce((s, r) => s + ((parseFloat(r.inflow) || 0) - (parseFloat(r.outflow) || 0)), 0);
    console.log(`  [server] AR=${srvAR}  AP=${srvAP}  cashNet=${srvNet}`);

    // ── F137-b Cash Flow ──
    const cfb = await bodyFlat('Cash Flow Statement');
    console.log(`  [Cash Flow] ${cfb.raw.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
    A('Cash Flow: shows "Monthly Cash Flow" + "Net Cash Flow" (own content)',
      /Monthly Cash Flow/i.test(cfb.raw) && /Net Cash Flow/i.test(cfb.raw), cfb.raw.slice(0, 120));
    A('Cash Flow: NOT the generic P&L modal ("incl. bills" absent)', !/incl\.\s*bills/i.test(cfb.raw));
    A('Cash Flow: Net === Σ(inflow − outflow) from /api/reports/cash-flow',
      cfb.flat.includes('NetCashFlow' + flatten(fmt(srvNet))), `want NetCashFlow${flatten(fmt(srvNet))}`);

    // ── F137-c Accounts Receivable ──
    const arb = await bodyFlat('Accounts Receivable');
    console.log(`  [AR] ${arb.raw.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
    A('AR: shows "Outstanding by customer" + "Total Receivable" (own content)',
      /Outstanding by customer/i.test(arb.raw) && /Total Receivable/i.test(arb.raw));
    A('AR: NOT the generic P&L modal', !/incl\.\s*bills/i.test(arb.raw));
    A('AR: Total Receivable === canonical AR (balance-sheet accountsReceivable)',
      arb.flat.includes('TotalReceivable' + flatten(fmt(srvAR))), `want TotalReceivable${flatten(fmt(srvAR))} (AR=${srvAR})`);
    A('AR: seeded customer "F137 Cust" appears in the breakdown', /F137 Cust/.test(arb.raw));

    // ── F137-d Accounts Payable ──
    const apb = await bodyFlat('Accounts Payable');
    console.log(`  [AP] ${apb.raw.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
    A('AP: shows "Outstanding by vendor" + "Total Payable" (own content)',
      /Outstanding by vendor/i.test(apb.raw) && /Total Payable/i.test(apb.raw));
    A('AP: NOT the generic P&L modal', !/incl\.\s*bills/i.test(apb.raw));
    A('AP: Total Payable === canonical AP (balance-sheet accountsPayable, F135)',
      apb.flat.includes('TotalPayable' + flatten(fmt(srvAP))), `want TotalPayable${flatten(fmt(srvAP))} (AP=${srvAP})`);
    A('AP: seeded vendor "F137 Vend" appears in the breakdown', /F137 Vend/.test(apb.raw));

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
