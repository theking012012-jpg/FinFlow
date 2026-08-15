#!/usr/bin/env node
'use strict';
/**
 * verify-export-csv.js — the CSV export surface (Appendix A: previously UNVERIFIED). Exports are
 * built CLIENT-side (app-main.js window.exportAllCSV → Blob download); there is no server export
 * endpoint. This drives the real function in jsdom, capturing the Blob content, and asserts the CSV
 * has the right header + data + RFC-style quoting (a comma/quote in a field must not corrupt it).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-export-csv.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let h, pass = 0, fail = 0;
  const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
  try {
    h = await bootSpaInJsdom({});
    await h.settle(40, 100);
    const w = h.window;

    console.log('\n' + '='.repeat(78));
    console.log('  CSV EXPORT — window.exportAllCSV produces correct, well-quoted output (jsdom)');
    console.log('='.repeat(78));

    A('window.exportAllCSV is callable', typeof w.exportAllCSV === 'function');

    // Capture the CSV that would be downloaded (stub Blob + object URL, which jsdom doesn't implement).
    let captured = null;
    w.Blob = function (parts) { captured = (parts || []).join(''); this.type = 'text/csv'; };
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};

    // Navigate to the Invoices page FIRST (exportAllCSV branches on the active page and the page
    // load repopulates window.userInvoices), THEN set deterministic data so the export is exact.
    if (typeof w.showPage === 'function') w.showPage('invoices', w.document.getElementById('nav-invoices') || null);
    await h.settle(10, 100);
    w.userInvoices = [
      { client: 'Acme, Inc.', amount: 1234.5, status: 'pending', due_date: '2026-07-01', notes: 'first' },
      { client: 'Beta "Quoted" Co', amount: 900, status: 'paid', due_date: '2026-06-10', notes: 'x' },
    ];

    w.exportAllCSV();
    await h.settle(5, 100);

    A('a CSV blob was produced', typeof captured === 'string' && captured.length > 0, `captured=${JSON.stringify((captured || '').slice(0, 60))}`);
    const csv = captured || '';
    A('CSV has the invoice header row', /"Client","Amount","Status","Due Date","Notes"/.test(csv), `head=${csv.split('\r\n')[0]}`);
    A('CSV includes the seeded rows (amounts formatted 2dp)', /"1234\.50"/.test(csv) && /"900\.00"/.test(csv), `csv=${csv.slice(0,160)}`);
    A('a field containing a COMMA is quoted (not split into columns)', /"Acme, Inc\."/.test(csv), 'comma field must stay one column');
    A('a field containing a QUOTE is escaped ("" )', /"Beta ""Quoted"" Co"/.test(csv), `csv=${csv}`);
    A('row count = header + 2 data rows', csv.split('\r\n').length === 3, `rows=${csv.split('\r\n').length}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (CSV export)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } catch (e) {
    console.error('[export] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail++;
  } finally {
    try { if (h && h.stop) await h.stop(); } catch (_) {}
  }
  process.exit(fail === 0 ? 0 : 1);
})();
