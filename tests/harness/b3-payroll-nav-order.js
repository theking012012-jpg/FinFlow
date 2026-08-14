'use strict';
/**
 * b3-payroll-nav-order.js — VERIFICATION checks **B3.1 / B3.2 / B3.3**, executed in jsdom.
 *
 *   node -r ./tests/harness/clock.js tests/harness/b3-payroll-nav-order.js
 *
 * THE DEFECT B3 GUARDS (the load-order KPI, CLAUDE.md failure #? / F102)
 *   `window.payrollRuns` was populated ONLY when the Payroll page was visited, so the dashboard
 *   Expenses KPI depended on WHERE the user clicked first: dashboard-first showed opex WITHOUT
 *   payroll (too low); payroll-first showed it WITH payroll (correct). The two routes disagreed.
 *   F102 fixed it by loading payroll at boot. B3 asserts the figure is now nav-order-INDEPENDENT.
 *
 *   B3.1  Fresh reload → dashboard first (no Payroll visit) → Expenses is the CORRECT figure.
 *   B3.2  Then visit Payroll → return to dashboard → figure UNCHANGED.
 *   B3.3  Visit Payroll again → return → still the SAME figure via both routes.
 *
 * WHY THIS IS A PROBE, NOT A step-gate row (F110)
 *   drift.js listed B3.1-3 as clock-drift BLOCKED. They are NOT actually drift-sensitive: they read
 *   the SEEDED payroll runs (explicit run_dates), never a NOW()-stamped app-created run, and every
 *   assertion here is an EQUALITY between two client reads in one process — nav-order independence,
 *   not an absolute pinned-period figure. So they belong in a probe, exactly like B4.4 / B4.2-3.
 *
 * ORACLE (Rule 6): the correct figure is the HAND-DERIVED expected.js FY opex (9,400), and the card
 *   is asserted to be NEITHER the payroll-missing (3,200, F102 bug) NOR the draft-counted (12,700,
 *   F80 bug) value — the same discrimination f102 uses — so a green here needs the real fixes, not
 *   mere self-consistency. Nav-order independence is then the EQUALITY of every read to that oracle.
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');
const EXPECTED = require('./expected.js');

(async () => {
  let h, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    // Cold boot: dashboard-first, we NEVER navigate to Payroll before the first read (B3.1).
    h = await bootSpaInJsdom({});
    await h.settle(50, 100);
    const w = h.window;
    const fmt = (n) => (typeof w._fmtMoney === 'function') ? w._fmtMoney(n, '$') : String(n);
    const nav = (id) => {
      if (typeof w.showPage !== 'function') throw new Error('window.showPage unavailable in jsdom');
      w.showPage(id, (w.document.getElementById('nav-' + id) || null));
    };

    console.log('\n' + '='.repeat(78));
    console.log('  B3 — NAV-ORDER INDEPENDENCE of the dashboard Expenses KPI (jsdom)');
    console.log('='.repeat(78));

    // ── B3.1 — dashboard-first read, and it must be the CORRECT figure (f102 oracle) ──
    const base = h.text('d-exp');
    A('B3.1  d-exp is a rendered native figure at boot (not the FX "…" placeholder)',
      base && base !== '…', `d-exp=${JSON.stringify(base)} _displayCurrency=${JSON.stringify(w._displayCurrency)}`);

    // Build the same window the client used and ask the server for opex on it (oracle cross-check).
    const win = (typeof w._periodWindow === 'function') ? w._periodWindow('year', null) : null;
    if (!win || !win.start || !win.end) throw new Error('client _periodWindow("year") unavailable');
    const qs = new URLSearchParams({
      start: new Date(win.start).toISOString(),
      end: new Date(win.end).toISOString(),
      elapsedMonths: String(win.elapsedMonths || 0),
    });
    const rep = await h.http.get('/api/reports?' + qs.toString());
    if (rep.status !== 200) throw new Error(`/api/reports HTTP ${rep.status}: ${rep.text.slice(0, 200)}`);
    const serverOpex = JSON.parse(rep.text).expenses;

    const byStatus = (await h.client.query(
      `SELECT pr.status, COALESCE(SUM(prl.gross + prl.bonus + prl.overtime),0) AS total
         FROM payroll_run_lines prl JOIN payroll_runs pr ON pr.id = prl.run_id
        WHERE pr.run_date >= $1::date AND pr.run_date < $2::date
        GROUP BY pr.status`,
      [win.start, win.end]
    )).rows;
    const sumAll = byStatus.reduce((s, r) => s + Number(r.total), 0);
    const draftSum = byStatus.filter(r => r.status === 'draft').reduce((s, r) => s + Number(r.total), 0);
    const recognisedPayroll = sumAll - draftSum;
    const correctOpex = EXPECTED.PL.fy.opex;                 // 9,400, hand-derived (Rule 6)
    const payrollMissingOpex = serverOpex - recognisedPayroll;  // 3,200 (F102 bug)
    const draftCountedOpex = correctOpex + draftSum;         // 12,700 (F80 bug)

    console.log(`\n  d-exp(boot) ${JSON.stringify(base)}  server opex ${serverOpex} → ${JSON.stringify(fmt(serverOpex))}  oracle ${correctOpex} → ${JSON.stringify(fmt(correctOpex))}`);
    console.log(`  bug values: payroll-missing ${payrollMissingOpex} → ${JSON.stringify(fmt(payrollMissingOpex))} | draft-counted ${draftCountedOpex} → ${JSON.stringify(fmt(draftCountedOpex))}\n`);

    A('B3.1  d-exp(dashboard-first) === _fmtMoney(expected.js FY opex) [oracle, Rule 6]',
      base === fmt(correctOpex), `base ${JSON.stringify(base)} vs ${JSON.stringify(fmt(correctOpex))}`);
    A('B3.1  d-exp is NOT the payroll-missing figure (F102 bug)',
      base !== fmt(payrollMissingOpex), `base ${JSON.stringify(base)} vs ${JSON.stringify(fmt(payrollMissingOpex))}`);
    A('B3.1  d-exp is NOT the draft-counted figure (F80 bug)',
      draftSum > 0 && base !== fmt(draftCountedOpex), `draftSum ${draftSum} base ${JSON.stringify(base)} vs ${JSON.stringify(fmt(draftCountedOpex))}`);

    // ── B3.2 — visit Payroll, return to dashboard → figure UNCHANGED ──
    nav('payroll');   await h.settle(50, 100);
    nav('dashboard'); await h.settle(50, 100);
    const afterRoundTrip = h.text('d-exp');
    A('B3.2  d-exp unchanged after Payroll → dashboard round-trip',
      afterRoundTrip === base, `after ${JSON.stringify(afterRoundTrip)} vs base ${JSON.stringify(base)}`);
    A('B3.2  …and still the correct oracle value (not silently restated)',
      afterRoundTrip === fmt(correctOpex), `after ${JSON.stringify(afterRoundTrip)} vs ${JSON.stringify(fmt(correctOpex))}`);

    // ── B3.3 — a SECOND Payroll→dashboard route → same figure via both routes ──
    nav('payroll');   await h.settle(50, 100);
    nav('dashboard'); await h.settle(50, 100);
    const secondRoute = h.text('d-exp');
    A('B3.3  d-exp identical via both nav routes (nav-order independent)',
      secondRoute === base, `secondRoute ${JSON.stringify(secondRoute)} vs base ${JSON.stringify(base)}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (B3 nav-order independence)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } catch (e) {
    console.error('\n[b3] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
    fail++;
  } finally {
    try { if (h && h.stop) await h.stop(); } catch (_) { /* already closed */ }
  }
  process.exit(fail === 0 ? 0 : 1);
})();
