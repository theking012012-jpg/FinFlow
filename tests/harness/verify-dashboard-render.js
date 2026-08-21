'use strict';
/**
 * verify-dashboard-render.js — the RENDER/BEHAVIOUR half of the unstamped cells: the actual
 * dashboard DOM after a real jsdom boot (A1 rendered Net), A4 (transactions list), B2 (live update
 * without reload), and B5 (cross-cutting: period switch + blocked /api/reports → "—").
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-dashboard-render.js
 *
 * Reads DOM textContent — never calls a client compute fn to READ a value (Rule 1). Oracle =
 * expected.js. The rendered Net check is the one that catches the all-time-COGS render bug the
 * engine-level probe cannot see (the engine is correct; the paint is not).
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');
const EXPECTED = require('./expected.js');
process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  // jsdom teardown + pg pool shutdown are post-test noise, never a result.
  if (/_location|pool after (calling )?end|terminating connection due to administrator command|Client was closed/.test(m)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
// parse "$8.8K" / "-$1.7K" / "$8,500" → number
function num(s) {
  if (s == null) return NaN;
  s = String(s).replace(/[$,\s]/g, '');
  let mult = 1;
  if (/K$/i.test(s)) { mult = 1000; s = s.replace(/K$/i, ''); }
  else if (/M$/i.test(s)) { mult = 1e6; s = s.replace(/M$/i, ''); }
  return parseFloat(s) * mult;
}

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({});
    const { window: w, settle, text } = boot;
    for (let i = 0; i < 250 && typeof w.updateDashboard !== 'function'; i++) await settle(1, 100);
    await settle(60, 100);   // let boot data + async COGS refetch settle

    // ── A1 · rendered KPI cards (default = year / FY) ──
    console.log('\n── A1 · rendered dashboard KPI cards (FY / year view) ──');
    const rev = num(text('d-rev')), exp = num(text('d-exp')), prof = num(text('d-profit')),
          out = num(text('d-outstanding')), inv = num(text('d-invest'));
    // FY oracle: rev 8800, exp 9100, net -1700, out 8500, inv 6000. Rounded display tolerance ±60.
    A('A1.3  rendered Revenue (FY) ≈ 8,800', Math.abs(rev - 8800) <= 60, `d-rev="${text('d-rev')}" → ${rev}`);
    A('A1.6  rendered Expenses (FY) ≈ 9,100', Math.abs(exp - 9100) <= 60, `d-exp="${text('d-exp')}" → ${exp}`);
    A('A1.9  rendered Net Profit (FY) ≈ −1,700 (oracle)', Math.abs(prof - EXPECTED.PL.fy.netProfit) <= 60,
      `d-profit="${text('d-profit')}" → ${prof} · oracle ${EXPECTED.PL.fy.netProfit} · _cogsTotal=${w._cogsTotal} (all-time 1650 ⇒ −1950 is the render bug)`);
    A('A1.12 rendered Outstanding ≈ 8,500', Math.abs(out - 8500) <= 5, `d-outstanding="${text('d-outstanding')}" → ${out}`);
    A('A1.15 rendered Investments ≈ 6,000', Math.abs(inv - 6000) <= 5, `d-invest="${text('d-invest')}" → ${inv}`);

    // ── A4 · transactions list ──
    console.log('\n── A4 · business transactions list ──');
    const txRows = w.document.querySelectorAll('#d-txns .tx-row');
    A('A4.1 transactions list renders rows', txRows.length > 0, `rows=${txRows.length}`);
    const txText = w.document.getElementById('d-txns') ? w.document.getElementById('d-txns').textContent : '';
    A('A4.2 the draft invoice (INV-4, 9,999) is NOT listed as revenue', !/9,?999/.test(txText), `txns text contains 9999? ${/9,?999/.test(txText)}`);

    // ── B2 · live update without reload (log an expense → Expenses card moves) ──
    console.log('\n── B2 · live update without reload ──');
    const expBefore = num(text('d-exp'));
    if (typeof w.saveExpense === 'function') {
      try {
        const set = (id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };
        if (typeof w.openExpenseModal === 'function') { try { w.openExpenseModal(); } catch (_) {} }
        // CREATE-path modal fields (finflow-api-wiring-medium.js saveExpense): bexp-desc (required),
        // bexp-amount, bexp-cat, bexp-ded, bexp-date. (exp-* are the EDIT modal — a different form.)
        set('bexp-desc', 'B2 probe expense'); set('bexp-amount', '333');
        set('bexp-cat', 'Marketing'); set('bexp-ded', 'no'); set('bexp-date', '2026-07-15');
        await w.saveExpense();
        await settle(40, 100);
        const expAfter = num(text('d-exp'));
        A('B2.2 logging an expense moves the Expenses card live (no reload)', expAfter > expBefore,
          `before=${expBefore} after=${expAfter} (expected +≈333)`);
      } catch (e) { A('B2.2 logging an expense moves the Expenses card live', false, 'threw: ' + (e && e.message)); }
    } else {
      A('B2.2 logging an expense moves the Expenses card live', false, 'no saveExpense on window');
    }

    // ── B5 · cross-cutting: period switch + blocked reports ──
    console.log('\n── B5 · cross-cutting ──');
    // B5.2 — switch year → month; the KPI figures must change (year FY ≠ single month)
    const revYear = num(text('d-rev'));
    if (typeof w.setPeriod === 'function') {
      try {
        const pMonth = w.document.getElementById('pMonth');
        w.setPeriod(pMonth || { classList: { add() {}, remove() {} } }, 'month');
        await settle(30, 100);
        const revMonth = num(text('d-rev'));
        A('B5.2 switching Year→Month changes the figures', revMonth !== revYear, `year=${revYear} month=${revMonth}`);
      } catch (e) { A('B5.2 switching Year→Month changes the figures', false, 'threw: ' + (e && e.message)); }
    } else {
      A('B5.2 switching Year→Month changes the figures', false, 'no setPeriod on window');
    }
    // NOTE: B5.3 (blocked /api/reports → "—") needs its own PROCESS — server.js has a module-global
    // `pool`, so a second bootServer in this process collides with the first's teardown. Run it as a
    // separate harness rather than a second boot here.
    await boot.stop();
    console.log('\n' + (fail === 0 ? '  ALL GREEN' : '  ' + fail + ' FAILED') + ` — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++;
    try { if (boot) await boot.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
