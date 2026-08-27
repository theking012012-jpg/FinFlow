'use strict';
/**
 * verify-date-label-tz.js — F195. Calendar-date DISPLAY labels must not shift a day west of UTC.
 *
 * The bug: list-row dates were formatted with `new Date('2026-08-16').toLocaleDateString()`, which parses
 * a date-only string as UTC midnight and renders it in the VIEWER's zone — so a GMT-4 owner saw an invoice
 * due 2026-08-16 as "Aug 15" in the list, while the document view (which slices the string) showed "16 Aug".
 * This is Rule 10 on the display side. The fix: `FinFlowDates.fmtLabel`, which reduces via `_toYmd`
 * (string slice — no Date, no TZ for a date-only / …Z value) and builds the label from the YMD parts.
 *
 * Part A proves the formatter across the UTC SIGN BOUNDARY (Rule 10 corollary — a western-only matrix goes
 * green on this very bug). Part B proves the invoice-list mapper is actually wired to it.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-date-label-tz.js
 */
const FinFlowDates = require('../../public/finflow-dates.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    // ── Part A: the formatter itself, across the sign boundary (no boot needed) ──
    const stored = '2026-08-16';
    const good = FinFlowDates.fmtLabel(stored);
    A('fmtLabel keeps the stored calendar day (Aug 16)', good === 'Aug 16', `got="${good}"`);

    // The OLD path, simulated for a western and an eastern viewer via explicit timeZone (independent of the
    // runner's own TZ). West of UTC it rolls back a day; east it does not — the asymmetry Rule 10 warns of.
    const west = new Date(stored).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });
    const east = new Date(stored).toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo', month: 'short', day: 'numeric' });
    A('[discriminator] OLD toLocaleDateString shifts a WESTERN viewer to Aug 15 (the reported bug)', west === 'Aug 15', `west="${west}"`);
    A('[discriminator] OLD path does NOT shift an EASTERN viewer (Aug 16) — spans the sign boundary', east === 'Aug 16', `east="${east}"`);
    A('fmtLabel is TZ-invariant: FIXES the west viewer and still matches the east viewer', good !== west && good === east, `good="${good}" west="${west}" east="${east}"`);

    // options + edge cases
    A('fmtLabel year option → "Aug 16 2026"', FinFlowDates.fmtLabel(stored, { year: true }) === 'Aug 16 2026', `got="${FinFlowDates.fmtLabel(stored, { year: true })}"`);
    A('fmtLabel long month → "August 16"', FinFlowDates.fmtLabel(stored, { month: 'long' }) === 'August 16', `got="${FinFlowDates.fmtLabel(stored, { month: 'long' })}"`);
    A('fmtLabel on a …Z timestamp uses the UTC calendar date (Jan 1)', FinFlowDates.fmtLabel('2026-01-01T00:30:00Z') === 'Jan 1', `got="${FinFlowDates.fmtLabel('2026-01-01T00:30:00Z')}"`);
    A('fmtLabel(null) → empty string', FinFlowDates.fmtLabel(null) === '', 'not empty');
    A('fmtLabel on 1 Jan does NOT fall into the previous year', FinFlowDates.fmtLabel('2026-01-01', { year: true }) === 'Jan 1 2026', `got="${FinFlowDates.fmtLabel('2026-01-01', { year: true })}"`);

    // ── Part B: the invoice-list mapper is wired to fmtLabel (row `due` == fmtLabel(raw due_date)) ──
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(50, 60);
    // Refresh through the canonical postgres mapper (sets both `due` via fmtLabel AND `due_date` + _realInvoices).
    if (typeof window.refreshFinancials === 'function') { await window.refreshFinancials('invoices'); await settle(20, 60); }
    A('FinFlowDates.fmtLabel is present in the booted app', typeof window.FinFlowDates.fmtLabel === 'function', 'export missing after boot');
    const raw = (window._realInvoices || []).find(r => r && r.due_date);
    A('a raw invoice with a due_date is available', !!raw, `realInvoices=${(window._realInvoices || []).length}`);
    if (raw) {
      const expected = window.FinFlowDates.fmtLabel(raw.due_date);
      const mapped = (window.userInvoices || []).find(i => i && i.due_date === raw.due_date);
      A('invoice-list mapper formats `due` via the TZ-safe fmtLabel (wired to the fix)',
        !!mapped && mapped.due === expected, `due="${mapped && mapped.due}" expected="${expected}" raw_due_date="${raw.due_date}"`);
    }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (calendar-date labels don't shift west of UTC)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
