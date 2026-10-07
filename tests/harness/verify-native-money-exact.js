'use strict';
/**
 * verify-native-money-exact.js — L29 (prior audit F64 / F129 residue). `_fmtMoneyNative` — the renderer for the
 * ENTITY's own (unconverted) money — delegated to the K/M/B abbreviator, so every figure ≥ 1,000 on the surfaces
 * that use it read like "TT$12.3K": all generated reports (P&L statement, AR aging, …), the Reports page tiles,
 * the Scenario planner and the budget rows. F64 (launch blocker B2) was fixed for window.S only. The shared
 * full-leg seed keeps every amount < 1,000 precisely so abbreviation can't show — so nothing caught it.
 * Same class, two literal '$' left by F129: bank reconciliation difference (and a NEGATIVE difference lost its
 * minus sign) and the timesheet rate.
 *
 * Seed (TTD entity — symbol TT$, so a literal '$' is visible): invoice 12,345.67 (2026-06-05), expense Office
 * 2,500.50 (2026-06-09), budget target Office 30,000, timesheet rate 150. "Show cents" off ⇒ whole units.
 * EXPECTED (by hand): P&L shows TT$12,346 revenue / TT$2,501 expense / TT$9,845 net (bug: TT$12.3K, TT$2.5K, TT$9.8K)
 *   Office budget row TT$2,501 / TT$30,000 · Scenario projected revenue TT$12,346 · recon diff −5 ⇒ "-TT$5.00"
 *   (bug "$5.00") · timesheet rate "TT$150/h" (bug "$150/h") · chart axes stay compact (TT$12.3K).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-native-money-exact.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const flat = s => String(s || '').replace(/\s+/g, ' ');

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L29 — entity-currency money renders EXACT (no K/M/B) on itemized surfaces\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b, m) => { const r = await (m === 'PUT' ? http.put(p, b) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'Exact Co', currency: 'TTD', timezone: 'UTC', country: 'TT' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/invoices', { client: 'Big Client', amount: 12345.67, status: 'pending', issue_date: '2026-06-05', due_date: '2026-08-05' });
      await J('/api/expenses', { description: 'Fit-out', category: 'Office', amount: 2500.50, expense_date: '2026-06-09' });
      await J('/api/budget-targets', { Office: 30000 }, 'PUT');
      await J('/api/timesheet', { employee: 'Ana', project: 'Audit', date: '2026-07-20', hours: 2, rate: 150 });
    } });
    const { window: w, settle } = ctx;
    await settle(60, 100);
    const sym = w._nativeSymbol();
    A('premise: entity symbol is TT$', sym === 'TT$', 'sym=' + sym);

    await w.generateReport('Profit & Loss Statement'); await settle(22, 60);
    const pl = flat((w.document.getElementById('rpt-body') || {}).textContent);
    A('P&L statement: revenue TT$12,346 (bug TT$12.3K)', /TT\$12,346(?![\d,.])/.test(pl), pl.slice(0, 300));
    A('P&L statement: expense TT$2,501 and net TT$9,845', /TT\$2,501(?![\d,.])/.test(pl) && /TT\$9,845(?![\d,.])/.test(pl), pl.slice(0, 400));
    A('P&L statement: no K/M/B-abbreviated amount anywhere', !/\d\.\d[KMB]\b/.test(pl), (pl.match(/\S*\d\.\d[KMB]\b/g) || []).join(' '));

    w.showPage('budget'); await settle(30, 100);
    const brow = flat((w.document.getElementById('budget-rows') || {}).textContent);
    A('budget row: Office TT$2,501 / TT$30,000 (bug TT$2.5K / TT$30.0K)', /TT\$2,501 \/ TT\$30,000/.test(brow), brow.slice(0, 200));

    w.showPage('scenario'); await settle(10, 100); if (w._scenarioBaseReady) await w._scenarioBaseReady;
    const scr = (w.document.getElementById('sc-rev') || {}).textContent;
    A('scenario: projected revenue TT$12,346 (bug TT$12.3K)', scr === 'TT$12,346', 'sc-rev=' + scr);

    // bank reconciliation difference: statement 0 vs book 5 ⇒ diff −5
    w.eval('bankTxns = [{ amount: 5, date: "2026-07-01", description: "x" }]');
    const sb = w.document.getElementById('recon-stmt-bal'); if (sb) sb.value = '0';
    w.updateReconSummary();
    const rd = (w.document.getElementById('recon-diff') || {}).textContent;
    A('reconciliation difference −5 renders "-TT$5.00" (bug "$5.00" — symbol AND sign wrong)', rd === '-TT$5.00', 'recon-diff=' + rd);

    w.showPage('timesheet'); await settle(25, 100);
    if (typeof w.renderTimesheet === 'function') { await w.renderTimesheet(); await settle(10, 100); }
    const ts = flat((w.document.getElementById('page-timesheet') || {}).textContent);
    A('timesheet rate reads "TT$150/h" (bug "$150/h")', /TT\$150\/h/.test(ts) && !/(^|[^T])\$150\/h/.test(ts), (ts.match(/.{0,12}150\/h/) || [ts.slice(0, 120)])[0]);

    A('chart axes stay compact: _fmtMoneyNativeAbbr(12345.67) = TT$12.3K', typeof w._fmtMoneyNativeAbbr === 'function' && w._fmtMoneyNativeAbbr(12345.67) === 'TT$12.3K',
      typeof w._fmtMoneyNativeAbbr === 'function' ? w._fmtMoneyNativeAbbr(12345.67) : 'missing');
    const cents = w.document.getElementById('s-cents');
    if (cents) { cents.checked = true; A('"Show cents" on ⇒ _fmtMoneyNative(12345.67) = TT$12,345.67', w._fmtMoneyNative(12345.67) === 'TT$12,345.67', w._fmtMoneyNative(12345.67)); cents.checked = false; }
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (native money exact)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
