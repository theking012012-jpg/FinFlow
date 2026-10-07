'use strict';
/**
 * verify-page-exports.js — Phase 1.1 / L16 (Rule 2: exports are a surface of every record they carry).
 * Executes the page Export (CSV) on each list page with real rows on the books and reads the file.
 *
 * Defects this catches (pre-fix behaviour in brackets):
 *   Vendors / Bills / Quotes exports read globals nothing assigns (allVendors, allBills, _quotes/allQuotes)
 *     → "No data to export." with rows on screen                       [no file]
 *   Items export read userItems/allItems (also never assigned)          [no file]
 *   Expenses "Tax Deductible" = (ded||deductible) ? 'Yes' : 'No' — the string 'no' is truthy
 *     → every expense "Yes"; 'half' also "Yes"                          [Rent 'no' → Yes, Office 'half' → Yes]
 *   Invoices / Expenses dates were the DISPLAY label without a year ("Aug 5", "Jun 9")   [no year]
 *
 * Seed: fullLegScenario + an extra non-deductible Rent expense (9, 2026-06-11), a vendor record for
 * "Supplier", a quote (Acme 50) and an item (Consulting 120). Expected file contents are read off the seed.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-page-exports.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function seed(a) {
  const ids = await postFullLegScenario(a);
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
  J(await a.http.post('/api/expenses', { description: 'Rent', category: 'Rent', amount: 9, expense_date: '2026-06-11', deductible: 'no' }));
  J(await a.http.post('/api/vendors', { name: 'Supplier', category: 'Software', contact: 'Sam' }));
  J(await a.http.post('/api/quotes', { client: 'Acme', amount: 50, expiry_date: '2026-08-30' }));
  J(await a.http.post('/api/items', { name: 'Consulting', type: 'service', price: 120 }));
  return ids;
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L16 — page exports carry the rows on screen, with correct values\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, settle } = ctx;
    await settle(60, 100);
    let blob = null; const notes = [];
    w.URL.createObjectURL = b => { blob = b; return 'blob:harness'; };
    w.HTMLAnchorElement.prototype.click = function () {};
    const _n = w.notify; w.notify = (m, e) => { notes.push(m); try { _n && _n(m, e); } catch (_) {} };
    const exp = async page => {
      w.showPage(page); await settle(20, 100); blob = null; notes.length = 0;
      w.exportAllCSV('csv'); await settle(3, 100);
      if (!blob) return { csv: null, note: notes.join(' | ') };
      const rows = (await blob.text()).replace(/^﻿/, '').split(/\r?\n/).map(l => (l.match(/"((?:[^"]|"")*)"/g) || []).map(c => c.slice(1, -1).replace(/""/g, '"')));
      return { csv: rows, note: '' };
    };
    const find = (rows, col, val) => { const h = rows[0], i = h.indexOf(col); return rows.slice(1).find(r => r[i] === val); };
    const cell = (rows, r, col) => r ? r[rows[0].indexOf(col)] : undefined;

    const inv = await exp('invoices');
    A('Invoices export produced', !!inv.csv, inv.note);
    const acme = inv.csv && find(inv.csv, 'Client', 'Acme');
    A('Invoices: Acme 700 · due 2026-08-05 (ISO, with year)', acme && cell(inv.csv, acme, 'Amount') === '700.00' && cell(inv.csv, acme, 'Due Date') === '2026-08-05',
      JSON.stringify(inv.csv && inv.csv.slice(0, 3)));

    const ex = await exp('expenses');
    A('Expenses export produced', !!ex.csv, ex.note);
    const rent = ex.csv && find(ex.csv, 'Description', 'Rent'), office = ex.csv && find(ex.csv, 'Description', 'Office supplies');
    A("Expenses: Rent (deductible 'no') exports Tax Deductible = No (bug: Yes)", cell(ex.csv, rent, 'Tax Deductible') === 'No', JSON.stringify(rent));
    A("Expenses: Office supplies ('half') exports Half (bug: Yes)", /^Half/.test(cell(ex.csv, office, 'Tax Deductible') || ''), JSON.stringify(office));
    A('Expenses: Office supplies date 2026-06-09 (ISO, with year)', cell(ex.csv, office, 'Date') === '2026-06-09', JSON.stringify(office));

    const ve = await exp('vendors');
    A('Vendors export produced (bug: "No data to export.")', !!ve.csv, ve.note);
    A('Vendors: Supplier row present', !!(ve.csv && find(ve.csv, 'Vendor', 'Supplier')), JSON.stringify(ve.csv));

    const bi = await exp('bills');
    A('Bills export produced (bug: "No data to export.")', !!bi.csv, bi.note);
    const bill = bi.csv && find(bi.csv, 'Vendor', 'Supplier');
    A('Bills: Supplier 40 · paid 15 · balance 25', bill && cell(bi.csv, bill, 'Amount') === '40.00' && cell(bi.csv, bill, 'Paid') === '15.00' && cell(bi.csv, bill, 'Balance') === '25.00', JSON.stringify(bi.csv));

    const qu = await exp('quotes');
    A('Quotes export produced (bug: "No data to export.")', !!qu.csv, qu.note);
    A('Quotes: Acme 50', !!(qu.csv && qu.csv.slice(1).some(r => r[0] === 'Acme' && r[1] === '50.00')), JSON.stringify(qu.csv));

    const it = await exp('items');
    A('Items export produced (bug: "No data to export.")', !!it.csv, it.note);
    A('Items: Consulting 120', !!(it.csv && it.csv.slice(1).some(r => r[0] === 'Consulting' && r[2] === '120.00')), JSON.stringify(it.csv));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (page exports)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
