'use strict';
/**
 * verify-gl-bs-lines-foot.js — L6c (class of L6b). A balance sheet whose LINES do not add up to its TOTALS is not a
 * balance sheet. glBalanceSheet's totals come from EVERY ledger account (glFinancials / glConsolidated), but it named
 * only cash / AR / inventory / AP / tax (system 2100) / payroll (system 2200). Any other account a posted journal can
 * reach — the JE picker's 1500 "Equipment", 2100 "Credit Card", 2200 "Tax Payable", 3000 "Owner's Equity", or any
 * typed code — sat inside a TOTAL with no line, so the rendered statement did not foot. The template 2100 / 2200
 * question held in L6b is one instance of this class; owner direction (2026-10-08, "do it right"): J2200 (template
 * "Tax Payable") → the Tax Payable line; J2100 (template "Credit Card") → its own line under its ledger name; every
 * other account → its own line; equity shows posted equity accounts + accumulated (un-closed) net income.
 *
 * Seed (UTC entity, clock pinned 2026-07-25), through the REAL routes:
 *   invoice 1,000 pending (06-01)                     ⇒ AR 1,000 · revenue 1,000
 *   bill      400 unpaid  (06-02)                     ⇒ AP   400 · expense   400
 *   JE-A 07-01  Dr 1010 Checking 5,000          / Cr 3000 Owner's Equity 5,000
 *   JE-B 07-05  Dr 1500 Equipment 1,200         / Cr 2100 Credit Card 1,200
 *   JE-C 07-06  Dr 1010 Checking 330            / Cr 4000 Service Revenue 300 · Cr 2200 Tax Payable 30
 *   JE-D 07-07  Dr 2100 Credit Card 200         / Cr 1010 Checking 200
 * HAND-COMPUTED (Rule 6 — derived from the seed, not from the code):
 *   ASSETS       Cash 5,130 (5,000 + 330 − 200) · Accounts Receivable 1,000 · Equipment 1,200      = 7,330
 *   LIABILITIES  Accounts Payable 400 · Credit Card 1,000 (1,200 − 200) · Tax Payable 30            = 1,430
 *   EQUITY       Owner's Equity 5,000 · accumulated net income 900 (1,000 + 300 − 400)              = 5,900
 *   7,330 = 1,430 + 5,900.
 * BUGGY (pre-fix) — every value differs (Rule 4):
 *   taxPayable 0 (the 30 sits in total liabilities only) · no `lines` · named asset lines sum 6,130 ≠ 7,330 ·
 *   named liability lines sum 400 ≠ 1,430 · rendered report: asset rows 6,130 vs "Total Assets" 7,330, liability
 *   rows 400 vs "Total Liabilities" 1,430, no equity breakdown · consolidated accounts carry no name.
 * The GL TOTALS are asserted too, as a CONTROL: they are right before AND after the fix (proves the seed).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-gl-bs-lines-foot.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const sum = arr => Math.round((arr || []).reduce((s, l) => s + Number(l.amount || 0), 0) * 100) / 100;
const byLabel = (arr, label) => (arr || []).filter(l => String(l.label || '').trim().toLowerCase() === label.toLowerCase());
const one = (arr, label) => { const f = byLabel(arr, label); return f.length === 1 ? Number(f[0].amount) : NaN; };
const EXP = {
  assets: { 'Cash & Equivalents': 5130, 'Accounts Receivable': 1000, 'Equipment': 1200 }, totalAssets: 7330,
  liabilities: { 'Accounts Payable': 400, 'Credit Card': 1000, 'Tax Payable': 30 }, totalLiabilities: 1430,
  equityAccounts: { "Owner's Equity": 5000 }, earnings: 900, equity: 5900,
};

function checkServer(tag, bs) {
  const L = bs.lines || {};
  A(`${tag}: served from the reconciled GL (premise)`, bs.source === 'gl', 'source=' + bs.source);
  A(`${tag}: CONTROL — GL totals 7,330 / 1,430 / 5,900 (right before and after the fix)`,
    near(bs.totalAssets, EXP.totalAssets) && near(bs.totalLiabilities, EXP.totalLiabilities) && near(bs.equity, EXP.equity),
    JSON.stringify({ ta: bs.totalAssets, tl: bs.totalLiabilities, eq: bs.equity }));
  A(`${tag}: taxPayable 30 — J2200 "Tax Payable" reaches the Tax Payable line (bug: 0)`, near(bs.taxPayable, 30), 'taxPayable=' + bs.taxPayable);
  A(`${tag}: response carries every line (bs.lines.assets / liabilities / equity) (bug: absent)`,
    Array.isArray(L.assets) && Array.isArray(L.liabilities) && Array.isArray(L.equity), 'lines=' + JSON.stringify(L).slice(0, 200));
  for (const [k, v] of Object.entries(EXP.assets)) A(`${tag}: asset line "${k}" = ${v}`, near(one(L.assets, k), v), JSON.stringify(L.assets));
  for (const [k, v] of Object.entries(EXP.liabilities)) A(`${tag}: liability line "${k}" = ${v} (exactly one such line — J2200 merged, not duplicated)`, near(one(L.liabilities, k), v), JSON.stringify(L.liabilities));
  for (const [k, v] of Object.entries(EXP.equityAccounts)) A(`${tag}: equity line "${k}" = ${v}`, near(one(L.equity, k), v), JSON.stringify(L.equity));
  const earn = (L.equity || []).filter(l => l.key === 'earnings');
  A(`${tag}: equity line "accumulated net income" = 900 (1,000 + 300 − 400)`, earn.length === 1 && near(earn[0].amount, EXP.earnings), JSON.stringify(L.equity));
  A(`${tag}: Σ asset lines = Total Assets 7,330 (bug: named lines 6,130)`, near(sum(L.assets), EXP.totalAssets) && near(sum(L.assets), bs.totalAssets), 'Σ=' + sum(L.assets));
  A(`${tag}: Σ liability lines = Total Liabilities 1,430 (bug: named lines 400)`, near(sum(L.liabilities), EXP.totalLiabilities) && near(sum(L.liabilities), bs.totalLiabilities), 'Σ=' + sum(L.liabilities));
  A(`${tag}: Σ equity lines = Equity 5,900`, near(sum(L.equity), EXP.equity) && near(sum(L.equity), bs.equity), 'Σ=' + sum(L.equity));
  const _all = [...(L.assets || []), ...(L.liabilities || []), ...(L.equity || [])];
  A(`${tag}: every line is labelled by its account name, never a raw ledger code (J####)`, _all.length > 0 && !_all.some(l => !String(l.label || '').trim() || /^J?\d{4}$/.test(String(l.label).trim())),
    JSON.stringify(L).slice(0, 300));
}

// The rendered report: every money row (a flex div with exactly two spans: label, value), in document order.
function renderedRows(doc) {
  const out = [];
  for (const d of doc.querySelectorAll('#rpt-body div')) {
    const sp = [...d.children].filter(c => c.tagName === 'SPAN');
    if (sp.length === 2 && d.children.length === 2) out.push({ label: sp[0].textContent.trim(), text: sp[1].textContent.trim(), value: parseFloat(sp[1].textContent.replace(/[^\d.\-]/g, '')) });
  }
  return out;
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L6c — every balance-sheet account is on a line, and the lines foot to the totals\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L6c Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-08-01' });
      await J('/api/bills', { vendor: 'Supplier', amount: 400, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-08-02' });
      const je = (date, description, lines) => J('/api/journals', { date, description, status: 'Posted', lines });
      await je('2026-07-01', 'Owner investment', [{ code: '1010', name: 'Checking Account', debit: 5000, credit: 0 }, { code: '3000', name: "Owner's Equity", debit: 0, credit: 5000 }]);
      await je('2026-07-05', 'Laptop on the card', [{ code: '1500', name: 'Equipment', debit: 1200, credit: 0 }, { code: '2100', name: 'Credit Card', debit: 0, credit: 1200 }]);
      await je('2026-07-06', 'Cash sale with tax', [{ code: '1010', name: 'Checking Account', debit: 330, credit: 0 }, { code: '4000', name: 'Service Revenue', debit: 0, credit: 300 }, { code: '2200', name: 'Tax Payable', debit: 0, credit: 30 }]);
      await je('2026-07-07', 'Card repayment', [{ code: '2100', name: 'Credit Card', debit: 200, credit: 0 }, { code: '1010', name: 'Checking Account', debit: 0, credit: 200 }]);
    } });
    const { window: w, settle, http } = ctx;
    await settle(40, 100);

    // ── server: the active entity, then the consolidated (All entities) view ──
    const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
    checkServer('entity', bs);
    const cbs = (await http.post('/api/reports/balance-sheet?entity_id=all', {})).json || {};
    checkServer('consolidated', cbs);

    // ── rendered report (the runtime winner: finflow-api-wiring-extra.js window.generateReport) ──
    for (let i = 0; i < 250 && typeof w.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await w.generateReport('Balance Sheet'); await settle(25, 60);
    const rows = renderedRows(w.document);
    const idx = re => rows.findIndex(r => re.test(r.label));
    const iCash = idx(/^Cash & Equivalents$/), iTA = idx(/^Total Assets/), iTL = idx(/^Total Liabilities$/), iEq = rows.length - 1 - [...rows].reverse().findIndex(r => /^(Total )?Equity$/.test(r.label));
    console.log('  [rendered] ' + rows.map(r => r.label + '=' + r.text).join(' | '));
    const seg = (a, b) => (a >= 0 && b > a) ? rows.slice(a, b) : [];
    const aRows = seg(iCash, iTA), lRows = seg(iTA + 1, iTL), eRows = seg(iTL + 1, iEq).filter(r => !/Translation Adjustment/.test(r.label));
    const rs = arr => Math.round(arr.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0) * 100) / 100;
    A('rendered: asset rows foot to "Total Assets" 7,330 (bug: 6,130)', iTA > 0 && near(rs(aRows), 7330) && near(rows[iTA].value, 7330), 'rows=' + rs(aRows) + ' total=' + (rows[iTA] || {}).text);
    A('rendered: liability rows foot to "Total Liabilities" 1,430 (bug: 400)', iTL > 0 && near(rs(lRows), 1430) && near(rows[iTL].value, 1430), 'rows=' + rs(lRows) + ' total=' + (rows[iTL] || {}).text);
    A('rendered: equity rows foot to "Equity" 5,900 (bug: no equity rows)', eRows.length >= 2 && near(rs(eRows), 5900) && near(rows[iEq].value, 5900), 'rows=' + rs(eRows) + ' total=' + (rows[iEq] || {}).text);
    const rv = l => { const f = rows.filter(r => r.label === l); return f.length === 1 ? f[0].value : NaN; };
    A('rendered: "Equipment" row 1,200 · "Credit Card" row 1,000 · "Tax Payable" row 30', near(rv('Equipment'), 1200) && near(rv('Credit Card'), 1000) && near(rv('Tax Payable'), 30),
      JSON.stringify({ eq: rv('Equipment'), cc: rv('Credit Card'), tax: rv('Tax Payable') }));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (balance sheet lines foot)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
