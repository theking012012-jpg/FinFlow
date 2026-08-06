'use strict';
/**
 * verify-f138-accountant-taxlines.js — PROVE (Rule 14) that the accountant portal's Tax Summary sums
 * the client's Income Tax worksheet LINES (accurate for fixed/revenue lines), falling back to the
 * single derived rate for older clients.
 *
 *   node tests/harness/verify-f138-accountant-taxlines.js
 *
 * Runs the ACTUAL shipped renderTax() extracted from accountant-client.html in a minimal jsdom DOM
 * (no page boot → no hanging timers). Oracle: revenue 10000, deductible 2000 → taxable 8000.
 *   Lines: 30% of taxable (2400) + fixed 500 + 1% of revenue (100) = 3000.
 *   Fallback: no lines, rate 20% → 8000 × 20% = 1600.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

(async () => {
  let pass = 0, fail = 0;
  const A = (name, ok, detail) => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); } };
  const num = s => parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')) || 0;

  try {
    const src = fs.readFileSync(path.join(process.cwd(), 'public', 'accountant-client.html'), 'utf8');
    // Extract the shipped renderTax() — delimited by its declaration and the next section marker.
    const start = src.indexOf('function renderTax(invoices, expenses)');
    const end = src.indexOf('// ── NOTES', start);
    A('renderTax source extracted from accountant-client.html', start >= 0 && end > start, `start=${start} end=${end}`);
    if (start < 0 || end < 0) throw new Error('could not locate renderTax in accountant-client.html');
    const fnSrc = src.slice(start, end);

    const dom = new JSDOM('<div id="tax-liability"></div><div id="tax-deductible"></div><div id="tax-taxable"></div><div id="tax-rate-warning" style="display:none"></div><div id="tax-breakdown"></div>');
    const document = dom.window.document;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Build the real function with document/set/fmt/_data injected as scope.
    const make = (_data) => new Function('document', 'set', 'fmt', '_data', fnSrc + '\n; return renderTax;')(document, set, fmt, _data);
    const expenses = [{ deductible: 'yes', amount: 2000 }]; // dedFull 2000 → taxable 10000 − 2000 = 8000

    // ── Case A: worksheet lines summed ──
    make({ summary: { revenue: '10000' }, taxRate: 12, taxLines: [
      { label: 'Income tax', type: 'taxable', value: 30 },
      { label: 'Capital gains', type: 'fixed', value: 500 },
      { label: 'Business levy', type: 'revenue', value: 1 },
    ] })([], expenses);
    const liabA = num(document.getElementById('tax-liability').textContent);
    const bdA = document.getElementById('tax-breakdown').innerHTML;
    A('sums lines: 8000×30% + 500 + 10000×1% = 3000 (NOT the derived 12% rate)', liabA === 3000, `liability=${liabA}`);
    A('breakdown lists each line + a total', /Capital gains \(fixed\)/.test(bdA) && /Business levy \(1% of revenue\)/.test(bdA) && /Total estimated tax/.test(bdA), bdA.slice(0, 220));

    // ── Case B: no lines → fall back to single rate ──
    make({ summary: { revenue: '10000' }, taxRate: 20, taxLines: [] })([], expenses);
    A('fallback: no lines, rate 20% → 8000 × 20% = 1600', num(document.getElementById('tax-liability').textContent) === 1600, `liability=${document.getElementById('tax-liability').textContent}`);
    A('fallback breakdown shows the single rate row', /Tax rate \(20%\)/.test(document.getElementById('tax-breakdown').innerHTML));

    // ── Case C: nothing set → honest, no fabricated liability ──
    make({ summary: { revenue: '0' }, taxRate: 0, taxLines: [] })([], []);
    A('nothing set → "Not set up" (no fabricated liability) + warning shown',
      /not set up/i.test(document.getElementById('tax-liability').textContent) && document.getElementById('tax-rate-warning').style.display === 'flex');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  }
  process.exit(fail === 0 ? 0 : 1);
})();
