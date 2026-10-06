'use strict';
/**
 * verify-pdf-export.js — "Export PDF" must produce a REAL downloadable .pdf, not just open the browser
 * print dialog (Rule 14, real failure path).
 *
 * BUG/GAP: exportPDF() only ever called window.print() — so on a data page there was no .pdf file, just
 * a print-to-PDF dialog. Now exportPDF() routes data pages through exportAllCSV('pdf') → window._ffExportPdf,
 * which lazy-loads the vendored jsPDF + autotable and calls doc.save('<page>.pdf') to download a real file;
 * visual pages (dashboard/reports) still fall back to print.
 *
 * jsPDF is a heavy browser lib, so we fake it (window.jspdf) and short-circuit the loader — the code under
 * test is the REAL exportPDF / exportAllCSV('pdf') / _ffExportPdf routing + the page-aware row builder. The
 * real lib's output (a valid %PDF) is confirmed separately in the live browser.
 *
 * Discriminating: pre-change window._ffExportPdf is undefined and exportPDF() calls print() on the invoices
 * page (no save) → RED. Post-change a '.pdf' is saved with the invoice rows → GREEN. Fallback preserved:
 * on the dashboard (no table) exportPDF() still calls print().
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-pdf-export.js
 */
const fs = require('fs');
const path = require('path');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };
  try {
    // ── STRUCTURAL: vendored libs present + loader wired to them ──────────────────────
    A('jsPDF vendored at public/vendor/jspdf.umd.min.js', fs.existsSync(path.join(ROOT,'public','vendor','jspdf.umd.min.js')));
    A('autotable vendored at public/vendor/jspdf.plugin.autotable.min.js', fs.existsSync(path.join(ROOT,'public','vendor','jspdf.plugin.autotable.min.js')));
    const am = fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
    A('[STRUCTURAL] loader references the vendored jsPDF', /\/vendor\/jspdf\.umd\.min\.js/.test(am) && /jspdf\.plugin\.autotable\.min\.js/.test(am));

    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(60, 60);

    A('[DISCRIMINATING] window._ffExportPdf exists (the real-PDF exporter)', typeof window._ffExportPdf === 'function');

    // Fake the heavy jsPDF lib + short-circuit the loader, so the REAL export routing runs.
    let lastDoc = null;
    function FakeDoc(){ this.calls = { text: [], autoTable: [], save: [] }; }
    FakeDoc.prototype.setFontSize = function(){ return this; };
    FakeDoc.prototype.setTextColor = function(){ return this; };
    FakeDoc.prototype.text = function(t){ this.calls.text.push(String(t)); return this; };
    FakeDoc.prototype.autoTable = function(o){ this.calls.autoTable.push(o); return this; };
    FakeDoc.prototype.save = function(name){ this.calls.save.push(name); window.__savedPdf = name; };
    window.jspdf = { jsPDF: function(){ lastDoc = new FakeDoc(); return lastDoc; } };
    window._ffLoadPdfLib = function(cb){ cb(); };   // lib "ready"

    // Land on the invoices page with data.
    window.showPage('invoices'); await settle(20, 50);
    const invCount = (window.userInvoices || []).length;
    A('invoices page has data to export', invCount > 0, 'userInvoices=' + invCount);

    // ── THE EXPORT ── on a data page → a real .pdf, not print.
    window.__savedPdf = null;
    let printed = 0; const origPrint = window.print; window.print = () => { printed++; };
    window.exportPDF();
    await settle(15, 50);
    A('[DISCRIMINATING] data page saved a .pdf file (download), not print', !!window.__savedPdf && /\.pdf$/.test(window.__savedPdf) && printed === 0,
      'saved=' + window.__savedPdf + ' printed=' + printed);
    A('saved filename is page-aware (invoices.pdf)', /invoices\.pdf$/.test(window.__savedPdf || ''), window.__savedPdf);
    const at = lastDoc && lastDoc.calls.autoTable[0];
    A('PDF table carries the invoice header row', !!at && Array.isArray(at.head) && /Client/.test(JSON.stringify(at.head[0])), JSON.stringify(at && at.head));
    A('PDF table body has one row per invoice', !!at && Array.isArray(at.body) && at.body.length === invCount, 'body=' + (at && at.body && at.body.length) + ' inv=' + invCount);

    // ── FALLBACK ── on a visual page (dashboard, no table) → still print.
    window.__savedPdf = null; printed = 0;
    window.showPage('dashboard'); await settle(15, 50);
    window.exportPDF();
    await settle(10, 50);
    A('visual page (dashboard) falls back to print, no pdf save', printed === 1 && !window.__savedPdf, 'printed=' + printed + ' saved=' + window.__savedPdf);
    window.print = origPrint;

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (PDF export downloadable)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
