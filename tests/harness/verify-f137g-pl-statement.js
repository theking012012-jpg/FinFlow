'use strict';
/**
 * verify-f137g-pl-statement.js — PROVE (Rule 14) that the Profit & Loss report renders a FULL
 * statement (Revenue → COGS → Gross Profit → Operating Expenses → Payroll → Net Profit + margins),
 * not the generic 4-card overview (F137-g); and that the Balance Sheet "Cash & Equivalents" label no
 * longer double-encodes to a literal "&amp;".
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f137g-pl-statement.js
 *
 * EXPECTED:
 *   CURRENT bundle — P&L is the generic modal ("incl. bills", no Gross Profit); Balance Sheet shows
 *     "Cash &amp; Equivalents" (literal) → FAIL.
 *   FIXED bundle — P&L shows COGS/Gross Profit/Net margin with canonical totals; Balance Sheet shows
 *     "Cash & Equivalents" and no literal "&amp;" → ALL GREEN.
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
    boot = await bootSpaInJsdom({});
    const { window, http, settle } = boot;
    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(12, 100);
    A('runtime winner present: window.generateReport', typeof window.generateReport === 'function');

    const fmt = (typeof window._fmtMoneyNative === 'function') ? window._fmtMoneyNative : (n) => '$' + (parseFloat(n) || 0).toFixed(2);
    const flatten = s => (s || '').replace(/\s+/g, '');
    const bodyOf = async (r) => { await window.generateReport(r); await settle(22, 60); const el = window.document.getElementById('rpt-body'); return { raw: el ? el.textContent || '' : '', flat: flatten(el ? el.textContent : ''), html: el ? el.innerHTML : '' }; };

    const pl = await http.post('/api/reports/profit-loss', {});
    const srvRev = Number(pl.json?.totalRevenue), srvNet = Number(pl.json?.netProfit), srvExp = Number(pl.json?.totalExpenses);
    console.log(`  [server P&L] totalRevenue=${srvRev} netProfit=${srvNet} totalExpenses=${srvExp} cogs=${pl.json?.cogs} grossProfit=${pl.json?.grossProfit}`);

    // ── F137-g full P&L statement ──
    const p = await bodyOf('Profit & Loss Statement');
    console.log(`  [P&L] ${p.raw.replace(/\s+/g, ' ').trim().slice(0, 170)}`);
    A('P&L: shows a full statement (Cost of Goods Sold + Gross Profit + Net Profit + margin)',
      /Cost of Goods Sold/i.test(p.raw) && /Gross Profit/i.test(p.raw) && /Net Profit/i.test(p.raw) && /margin/i.test(p.raw), p.raw.slice(0, 160));
    A('P&L: NOT the generic 4-card modal ("incl. bills" absent)', !/incl\.\s*bills/i.test(p.raw));
    A('P&L: no leaked/escaped HTML in the rendered text (e.g. a literal "<span")', !/<span/i.test(p.raw), `raw=${p.raw.slice(0, 120)}`);
    A('P&L: Total Revenue === canonical totalRevenue', p.flat.includes('TotalRevenue' + flatten(fmt(srvRev))), `want TotalRevenue${flatten(fmt(srvRev))}`);
    A('P&L: Net Profit === canonical netProfit', p.flat.includes(flatten(fmt(srvNet))), `want ${flatten(fmt(srvNet))} in body`);
    A('P&L: renders an inline SVG bar chart (print-safe visual)', /<svg/i.test(p.html) && /<rect/i.test(p.html), 'no <svg>/<rect> in report body');
    A('P&L: Total Operating Expenses === canonical totalExpenses (category bars reconcile)',
      p.flat.includes('TotalOperatingExpenses' + flatten(fmt(srvExp))), `want TotalOperatingExpenses${flatten(fmt(srvExp))} (exp=${srvExp})`);
    // The parts (manual categories + Payroll + "Bills & other" remainder) must SUM to the total —
    // the -$7.0K "Bills & other" bug was Σ(parts) ≠ total. Remainder = exp − payroll − Σ(manual cats).
    const bdc = (typeof window.computeExpenseBreakdown === 'function') ? window.computeExpenseBreakdown('year') : { byCategory: {} };
    const manualSum = Object.values(bdc.byCategory || {}).reduce((s, a) => s + (parseFloat(a) || 0), 0);
    const srvPay = Number(pl.json?.payroll) || 0;
    const expectRem = Math.round((srvExp - srvPay - manualSum) * 100) / 100;
    A('P&L: "Bills & other" remainder reconciles to exp − payroll − Σ(manual categories)',
      Math.abs(expectRem) < 0.01 || p.flat.includes('Bills&other' + flatten(fmt(expectRem))),
      `expected Bills&other ${flatten(fmt(expectRem))} (exp=${srvExp} payroll=${srvPay} manual=${manualSum})`);
    A('P&L: no negative amount among the Operating Expenses category bars',
      (() => { const s = p.raw.indexOf('Operating Expenses'); const en = p.raw.indexOf('Total Operating Expenses'); const seg = (s >= 0 && en > s) ? p.raw.slice(s, en) : ''; return !/[-−]\s*\$/.test(seg); })(),
      'a category bar shows a negative amount (parts do not reconcile)');

    // ── Report modal is scrollable so tall reports don't clip (structural — jsdom can't render layout) ──
    const shell = window.document.querySelector('#report-gen-modal .modal');
    const rb = window.document.getElementById('rpt-body');
    A('Report modal shell is height-capped (max-height set) [structural]', !!shell && /vh|px/.test(shell.style.maxHeight || ''), `maxHeight=${shell && shell.style.maxHeight}`);
    A('Report body scrolls (overflow-y:auto) so tall reports do not clip [structural]', !!rb && (rb.style.overflowY === 'auto'), `overflowY=${rb && rb.style.overflowY}`);

    // ── Balance Sheet &amp; fix ──
    const b = await bodyOf('Balance Sheet');
    A('Balance Sheet: label reads "Cash & Equivalents" (single-encoded)', /Cash & Equivalents/.test(b.raw), `raw=${b.raw.slice(0, 60)}`);
    A('Balance Sheet: no literal "&amp;" in the rendered text', !/&amp;/.test(b.raw), `raw=${b.raw.slice(0, 60)}`);

    // ── Print stylesheet (structural — on-paper appearance is owner-confirmed; jsdom can't render @media print) ──
    const pcss = window.document.getElementById('rpt-print-css');
    const pt = pcss ? (pcss.textContent || '') : '';
    A('print: @media print stylesheet injected', !!pcss && /@media\s+print/.test(pt), 'no #rpt-print-css');
    A('print: re-themes report to a light palette (redefines --bg2/--t1 on the modal)',
      /#report-gen-modal \.modal\{[^}]*--bg2:/.test(pt) && /--t1:/.test(pt), 'no light-palette var override');
    A('print: hides the rest of the app so only the report prints',
      /body > \*:not\(#report-gen-modal\)\{[^}]*display:\s*none/.test(pt), 'no hide-others rule');

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
