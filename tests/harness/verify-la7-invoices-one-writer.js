'use strict';
/**
 * verify-la7-invoices-one-writer.js — LA7 (live audit 2026-10-13, found during LA6): app-main.js held a shadowed
 * copy of updateInvoices that still computed Outstanding with the pre-F56 formula (Σ amount over status ≠ paid —
 * a draft and a part-paid invoice counted whole). The runtime winner is window.updateInvoices
 * (finflow-api-wiring-postgres.js, a REPLACEMENT, no _orig). An instrumented boot recorded 0 calls into the
 * app-main copy (boot, Invoices page, month/quarter/year, refreshAllPeriodData, renderInvoices, show-cents).
 * The dead copy is deleted so the old formula cannot regrow if the override ever moves (Rule 1).
 *
 * Seed (clientMoneyKit, clock 2026-07-25): Acme 1,000 pending · Acme 600 with 250 paid · Beta 300 fully paid ·
 * Gamma 9,999 DRAFT · credit note 80.
 *   HAND-COMPUTED Outstanding = 1,000 + (600 − 250) − 80 = 1,270
 *   the dead copy's formula   = 1,000 + 600 + 9,999      = 11,599   (status ≠ paid, whole amounts, draft included)
 *
 * Part 1 (EXECUTED, structural in weight — it proves a definition is gone, which no money value can express):
 *   app-main.js is evaluated ALONE in a blank page; function declarations hoist, so whatever it defines exists
 *   even though its top-level code cannot finish without the SPA. Old code: it defines updateInvoices, and
 *   running that copy on the seed's invoices writes "$11,599". Fix: it defines none.
 * Part 2 (EXECUTED, values): the real SPA's Invoices Outstanding card = $1,270 at boot, after every period
 *   switch, after refreshAllPeriodData and after renderInvoices — the deletion changed no figure. (Green on the
 *   old code too: the copy was dead. This half guards against the deletion breaking a caller.)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la7-invoices-one-writer.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { run } = require('./clientMoneyKit.js');

const PUB = path.join(__dirname, '..', '..', 'public');

// app-main.js alone, with the scripts index.html loads before it, in a blank page holding the Invoices card ids.
function appMainAlone() {
  const ids = ['inv-billed', 'inv-billed-lbl', 'inv-paid', 'inv-paid-pct', 'inv-out', 'inv-over', 'inv-table-title', 'badge-inv'];
  const dom = new JSDOM('<!doctype html><body>' + ids.map(i => `<div id="${i}"></div>`).join('') + '</body>',
    { runScripts: 'outside-only', url: 'http://localhost/app' });
  // Each file runs as a classic SCRIPT in the page's global scope, as a <script> tag does. (window.eval would be an
  // indirect eval: app-main's top-level `let userInvoices` would stay private to that eval, so anything assigned to
  // it afterwards would land on a different binding — the first draft of this harness measured "$0" that way.)
  const ctx = dom.getInternalVMContext();
  const runScript = (src, name) => new vm.Script(src, { filename: name }).runInContext(ctx);
  for (const f of ['finflow-dates.js', 'finflow-currency.js', 'finflow-counter.js']) {
    try { runScript(fs.readFileSync(path.join(PUB, f), 'utf8'), f); } catch (_) {}
  }
  let topLevelError = null;
  try { runScript(fs.readFileSync(path.join(PUB, 'app-main.js'), 'utf8'), 'app-main.js'); } catch (e) { topLevelError = e; }
  return { w: dom.window, dom, topLevelError, runScript };
}

run('LA7 — Invoices Outstanding has one writer (the dead pre-F56 copy in app-main.js is gone)', async ({ w, d, ev, settle, eq }) => {
  // ── Part 1: what app-main.js itself defines ──────────────────────────────────────────────
  const solo = appMainAlone();
  const defined = typeof solo.w.updateInvoices === 'function';
  let wouldWrite = null;
  if (defined) {
    // Run the copy app-main defines on the seed's invoices (as the API returns them), to show what it would paint.
    // app-main declares `let userInvoices` itself (the binding the copy reads) — assign to it, don't redeclare.
    solo.runScript(`userInvoices = ${JSON.stringify((w._realInvoices || w.userInvoices || []).map(i => ({ amount: i.amount, amount_paid: i.amount_paid, status: i.status })))};`, 'feed');
    try { solo.runScript(`updateInvoices({ label: 'Year' })`, 'call'); } catch (_) {}
    wouldWrite = solo.w.document.getElementById('inv-out').textContent || null;
  }
  console.log(`  [app-main.js evaluated alone: top-level stopped at ${solo.topLevelError ? JSON.stringify(String(solo.topLevelError.message).slice(0, 80)) : 'end of file'}]`);
  eq('STRUCTURAL (executed): app-main.js defines no updateInvoices', defined, false, true);
  eq('if a copy existed, what it would paint for Outstanding', wouldWrite, null, '$11,599');
  solo.dom.window.close();

  // ── Part 2: the real SPA, the figure the owner sees ──────────────────────────────────────
  const out = () => (d.getElementById('inv-out') || {}).textContent;
  w.showPage('invoices'); await settle(20, 50);
  eq('Invoices Outstanding (hand-computed 1,000 + 350 − 80)', out(), '$1,270', '$11,599');
  for (const [id, p] of [['pMonth', 'month'], ['pQ', 'quarter'], ['pY', 'year']]) {
    let threw = null;
    try { ev(`setPeriod(document.getElementById('${id}'), '${p}')`); } catch (e) { threw = String(e.message); }
    await settle(10, 50);
    eq(`period ${p}: no error, Outstanding still $1,270 (all-time to date, M27)`, [threw, out()], [null, '$1,270']);
  }
  let threw = null;
  try { w.refreshAllPeriodData(); w.renderInvoices(); } catch (e) { threw = String(e.message); }
  await settle(5, 50);
  eq('refreshAllPeriodData + renderInvoices: no error, Outstanding $1,270', [threw, out()], [null, '$1,270']);
});
