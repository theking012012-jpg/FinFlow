'use strict';
/**
 * verify-f102-payroll-boot.js — AD-HOC probe for the combined F102 (boot-load) + F80 (draft filter).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f102-payroll-boot.js
 *
 * ORACLE = expected.js, NOT the other engine (Rule 6: agreement is not correctness). The first cut of
 *   this probe asserted client d-exp == server opex and went green while BOTH included the 3,300 draft
 *   run — a number that is wrong by DECISION 2 (draft contributes 0). Two engines agreeing on a wrong
 *   figure is exactly Rule 6. The hand-derived correct FY opex is expected.js PL.fy.opex = 9,400.
 *
 * WHY F102 AND F80 ARE ONE CHANGE: verifying either alone requires the other. With payroll missing
 *   (F102 bug) opex is 3,200; with draft counted (F80 bug) opex is 12,700; only both fixes together
 *   give 9,400. So the probe asserts the card shows 9,400 and is NEITHER 3,200 NOR 12,700.
 *
 * PRIMARY (Rule 6):  d-exp == _fmtMoney(expected.js FY opex 9,400)   — card vs hand-derived truth.
 * SECONDARY:         d-exp == _fmtMoney(server opex)  AND  server opex == 9,400  — client==server, both right.
 * DISCRIMINATION:    d-exp is neither the payroll-missing (3,200) nor the draft-counted (12,700) figure.
 *
 * FAITHFUL WINDOW: native-currency d-exp filters locally through _periodWindow('year'); the paramless
 *   /api/reports uses legacy all-time 'year'. So we send the client's OWN window (start/end/elapsed).
 *
 * NOTE ON THE SEED IN THIS ENV: the sweep's revenue/outstanding rows are polluted by the clock pin
 *   moving INV-6 out of "future" — that touches REVENUE/AR only, not any opex leg, so the 9,400 opex
 *   oracle stands. (Do not extend this probe to revenue without re-pinning the clock.)
 *
 * This is AD-HOC. The permanent home is A6's client half (a jsdom cross-engine probe) — not yet built;
 * until it is, F102/F80 are verified by THIS script, not by the sweep. (Owner note in the task.)
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');
const EXPECTED = require('./expected.js');

// The dashboard card is ABBREVIATED (K→M→B via app-main _fmtMoney), so d-exp reads "$12.7K", not
// "$12,700". Comparing NUMBERS would need a lossy expand; instead we format the server value with the
// CLIENT'S OWN window._fmtMoney and string-compare — an exact "does the card show the server's opex?"
// The payroll leg comes from the DB (the /api/reports ENDPOINT reshapes computeBooks and drops .parts).

(async () => {
  let h, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    // Cold boot: no failMap, and we NEVER navigate to the Payroll page. loadEntityData runs at boot.
    h = await bootSpaInJsdom({});
    await h.settle(50, 100);

    const w = h.window;
    const fmt = (n) => (typeof w._fmtMoney === 'function') ? w._fmtMoney(n, '$') : String(n);

    // ── read the CLIENT figure from the DOM (never from a compute call — Rule 1 / F75) ──
    const dExpText = h.text('d-exp');
    A('d-exp is a rendered native figure (not the FX "…" placeholder)',
      dExpText && dExpText !== '…', `d-exp textContent = ${JSON.stringify(dExpText)}  _displayCurrency=${JSON.stringify(w._displayCurrency)}`);

    // ── build the SAME window the native client used, and ask the server for opex on it ──
    const win = (typeof w._periodWindow === 'function') ? w._periodWindow('year', null) : null;
    if (!win || !win.start || !win.end) throw new Error('client _periodWindow("year") unavailable in jsdom window');
    const qs = new URLSearchParams({
      start: new Date(win.start).toISOString(),
      end: new Date(win.end).toISOString(),
      elapsedMonths: String(win.elapsedMonths || 0),
    });
    const rep = await h.http.get('/api/reports?' + qs.toString());
    if (rep.status !== 200) throw new Error(`/api/reports HTTP ${rep.status}: ${rep.text.slice(0, 200)}`);
    const j = JSON.parse(rep.text);
    const serverOpex = j.expenses;

    // payroll leg for THIS window, straight from the DB (endpoint response drops computeBooks .parts)
    const byStatus = (await h.client.query(
      `SELECT pr.status, COALESCE(SUM(prl.gross + prl.bonus + prl.overtime),0) AS total
         FROM payroll_run_lines prl JOIN payroll_runs pr ON pr.id = prl.run_id
        WHERE pr.run_date >= $1::date AND pr.run_date < $2::date
        GROUP BY pr.status ORDER BY pr.status`,
      [win.start.toISOString().slice(0, 10), win.end.toISOString().slice(0, 10)]
    )).rows;
    const sumAll = byStatus.reduce((s, r) => s + Number(r.total), 0);                                        // incl draft
    const draftSum = byStatus.filter(r => r.status === 'draft').reduce((s, r) => s + Number(r.total), 0);      // draft only
    const recognisedPayroll = sumAll - draftSum;                                                              // approved + paid

    // The three figures the three states produce (derived from the DB + the now-correct server opex):
    const correctOpex = EXPECTED.PL.fy.opex;             // hand-derived truth, Rule 6 (9,400)
    const nonPayrollOpex = serverOpex - recognisedPayroll;   // expenses + bills + orphan payments
    const draftCountedOpex = correctOpex + draftSum;     // F80 bug (draft counted), boot-load present (12,700)
    const payrollMissingOpex = nonPayrollOpex;           // F102 bug (window.payrollRuns empty) (3,200)

    console.log(`\n  window            ${qs.get('start')} → ${qs.get('end')} (elapsed ${qs.get('elapsedMonths')})`);
    console.log(`  client d-exp      ${JSON.stringify(dExpText)}`);
    console.log(`  server opex       ${serverOpex}  → _fmtMoney ${JSON.stringify(fmt(serverOpex))}`);
    console.log(`  expected.js opex  ${correctOpex}  → _fmtMoney ${JSON.stringify(fmt(correctOpex))}   (ORACLE, hand-derived)`);
    console.log(`  recognised payroll (approved+paid) ${recognisedPayroll}   draft (excluded) ${draftSum}`);
    console.log(`  bug values: payroll-missing ${payrollMissingOpex} → ${JSON.stringify(fmt(payrollMissingOpex))} | draft-counted ${draftCountedOpex} → ${JSON.stringify(fmt(draftCountedOpex))}\n`);

    // ── PRIMARY (Rule 6): the card shows the HAND-DERIVED correct opex, not merely "the other engine's". ──
    A('client d-exp === _fmtMoney(expected.js FY opex)  [oracle = expected.js, 9,400]',
      dExpText === fmt(correctOpex), `d-exp ${JSON.stringify(dExpText)}  vs oracle ${JSON.stringify(fmt(correctOpex))}`);

    // ── SECONDARY: client == server, AND the server is itself correct (both land on 9,400). ──
    A('server opex === expected.js FY opex (draft filter applied server-side)',
      Math.abs(serverOpex - correctOpex) < 0.005, `server ${serverOpex} vs expected ${correctOpex}`);
    A('client d-exp === _fmtMoney(server opex)  [client == server, both correct]',
      dExpText === fmt(serverOpex), `d-exp ${JSON.stringify(dExpText)} vs ${JSON.stringify(fmt(serverOpex))}`);

    // ── DISCRIMINATION (Rule 4): the card is NEITHER bug's number. Requires BOTH fixes to pass. ──
    A('d-exp is NOT the payroll-missing figure (F102 bug)',
      dExpText !== fmt(payrollMissingOpex), `d-exp ${JSON.stringify(dExpText)} vs ${JSON.stringify(fmt(payrollMissingOpex))}`);
    A('d-exp is NOT the draft-counted figure (F80 bug)',
      draftSum > 0 && dExpText !== fmt(draftCountedOpex),
      `draftSum ${draftSum}  d-exp ${JSON.stringify(dExpText)} vs ${JSON.stringify(fmt(draftCountedOpex))}`);

    // ── SEQUENCE: every jsdom boot IS a cold "refresh"; the "refresh → drops payroll" leg of the
    //    owner's repro is exactly this cold boot, so a green cold boot kills it. ──
    const runsLoaded = Array.isArray(w.payrollRuns) ? w.payrollRuns.length : -1;
    A('window.payrollRuns populated at boot, no Payroll-page visit',
      runsLoaded > 0, `window.payrollRuns.length = ${runsLoaded}`);

    // ── FULL SEQUENCE (owner repro open→Payroll→back→refresh): the figure must not MOVE at any step.
    //    Cold boot == refresh (this whole probe). Now simulate the Payroll-page visit (loadPayrollRuns
    //    re-runs on nav) and confirm d-exp is UNCHANGED — the old bug jumped low→high here. ──
    const beforeVisit = h.text('d-exp');
    if (typeof w.loadPayrollRuns === 'function') { try { w.loadPayrollRuns(); } catch { /* ignore */ } }
    await h.settle(15, 100);
    const afterVisit = h.text('d-exp');
    A('d-exp UNCHANGED after a simulated Payroll-page visit (open→Payroll→back)',
      afterVisit === beforeVisit && afterVisit === fmt(correctOpex),
      `before ${JSON.stringify(beforeVisit)}  after ${JSON.stringify(afterVisit)}  oracle ${JSON.stringify(fmt(correctOpex))}`);

    console.log('\n  ── payroll leg composition (FY window) ─────────────────────────────');
    for (const r of byStatus) console.log(`     ${String(r.status).padEnd(10)} ${r.total}`);
    console.log(`     recognised (approved+paid) ${recognisedPayroll}   draft (F80: excluded) ${draftSum}`);

    // ── DRAFT VISIBILITY (F94 class): excluding draft from the BOOKS must NOT make it invisible in the
    //    UI. loadPayrollRuns renders the Run History list at boot from ALL runs; assert the draft run is
    //    still shown, with its status badge and its Approve call-to-action. ──
    const draftRun = w.payrollRuns.find(r => String(r.status || '').toLowerCase() === 'draft');
    A('seed carries a draft run (so visibility is testable)', !!draftRun,
      `run statuses = ${w.payrollRuns.map(r => r.status).join(', ')}`);
    const listHtml = ((w.document.getElementById('payroll-runs-list') || {}).innerHTML) || '';
    const showsDraftBadge = /\bdraft\b/i.test(listHtml);
    const showsApproveCTA = /approvePayrollRun\(/.test(listHtml);
    A('draft run VISIBLE in Payroll Run History at boot (badge + Approve CTA)',
      showsDraftBadge && showsApproveCTA,
      `draft badge=${showsDraftBadge}  Approve CTA=${showsApproveCTA}  list len=${listHtml.length}`);
    console.log('\n  ── what each surface shows for the draft run (R2: 2026-07, gross 3,300) ──');
    console.log(`     dashboard d-exp / Expenses / AI / health   EXCLUDED from the figure (books = 9,400)  [Decision 2]`);
    console.log(`     server /api/reports · /books · computeBooks EXCLUDED from opex`);
    console.log(`     Payroll Run History list                   VISIBLE — 'draft' badge + Approve button  [not hidden]`);
    console.log(`     payroll empty-state                        run present ⇒ NOT empty (rows.length counts it)`);
    console.log(`     breakdown.payrollRunCount                  counts it (in-period run count unchanged)`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e), '\n');
    fail++;
  } finally {
    if (h) { try { await h.stop(); } catch { /* ignore */ } }
  }
  process.exitCode = 0;
})();
