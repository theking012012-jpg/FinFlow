'use strict';
/**
 * C15 (Cowork end-to-end test 8.1): the Profit & Loss exports as a real CSV and a real PDF, with the report's figures.
 * BUG: the report window had only Print. The page's CSV said "Nothing to export on this page.", and its PDF opened
 * the browser's print dialog.
 * Seed: clientMoneyKit (Business A, Year): revenue 1,820 (1,000 + 600 + 300 − 80 credit) · cost of goods 30 ·
 * operating expenses 2,900 (rent 500 + payroll 2,000 + bill 400) · net 1,820 − 30 − 2,900 = −1,110 (hand-computed).
 * Executed: the report's own CSV button → the downloaded file's text is read back; its PDF button → the real
 * _ffExportPdf runs with a recording stand-in for the jsPDF library (the CDN library cannot load in jsdom; so the
 * PDF's TABLE ROWS are verified, not its drawing); the top-bar Export with the report open → the same CSV.
 *   CSV "Revenue","1820.00" … "Net profit","-1110.00" + By month "Jan '26","1000.00"   bug: no CSV button / "Nothing to export"
 *   PDF file profit-and-loss.pdf, 2 tables (statement + by month)                     bug: print dialog
 */
const { run } = require('./clientMoneyKit.js');

run('C15 — P&L exports as CSV and PDF', async ({ w, d, ev, settle, eq, A }) => {
  const files = [];
  w.URL.createObjectURL = blob => { files.push(blob); return 'blob:c15-' + files.length; };
  w.URL.revokeObjectURL = () => {};
  const pdf = { tables: [], saved: null };
  class FakePdf { constructor() { this.lastAutoTable = null; } setFontSize() {} setTextColor() {} text() {}
    autoTable(o) { pdf.tables.push([...(o.head || []), ...(o.body || [])]); this.lastAutoTable = { finalY: 100 * pdf.tables.length }; }
    save(n) { pdf.saved = n; } }
  w.jspdf = { jsPDF: FakePdf };
  const blobText = b => new Promise(res => { const r = new w.FileReader(); r.onload = () => res(String(r.result)); r.readAsText(b); });

  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(20, 60);
  await w.generateReport('Profit & Loss Statement'); await settle(20, 60);

  const csvBtn = d.getElementById('rpt-csv-btn');
  A('the report has a CSV button', !!csvBtn);
  if (csvBtn) csvBtn.click();
  await settle(5, 30);
  const csv = files[0] ? (await blobText(files[0])).replace(/^﻿/, '') : '';
  const line = label => (csv.split(/\r\n/).find(l => l.startsWith('"' + label + '"')) || '').split('","').map(x => x.replace(/"/g, ''));
  eq('CSV Revenue', line('Revenue')[1], '1820.00', undefined);
  eq('CSV Cost of goods sold', line('Cost of goods sold')[1], '30.00');
  eq('CSV Total operating expenses', line('Total operating expenses')[1], '2900.00');
  eq('CSV Net profit (hand: 1,820 − 30 − 2,900)', line('Net profit')[1], '-1110.00');
  eq("CSV By month: Jan '26 revenue", line("Jan '26")[1], '1000.00');
  eq('CSV By month: Total row = statement totals', line('Total').slice(1), ['1820.00', '30.00', '2900.00', '-1110.00']);

  const pdfBtn = d.getElementById('rpt-pdf-btn');
  A('the report has a PDF button', !!pdfBtn);
  if (pdfBtn) pdfBtn.click();
  await settle(5, 30);
  eq('PDF saved as a file', pdf.saved, 'profit-and-loss.pdf', null);
  eq('PDF has the statement and the monthly table', pdf.tables.length, 2, 0);
  A('PDF statement carries Net profit -1110.00', (pdf.tables[0] || []).some(r => r[0] === 'Net profit' && r[1] === '-1110.00'), JSON.stringify(pdf.tables[0]));

  const before = files.length;
  w.exportAllCSV(); await settle(5, 30);
  const topCsv = files[before] ? (await blobText(files[before])).replace(/^﻿/, '') : '';
  A('top-bar Export with the report open exports the same CSV (bug: "Nothing to export")', topCsv === csv && csv.length > 0, topCsv.slice(0, 80));
});
