'use strict';
/* verify-d2-total-billed.js — D2 on the Invoices page: Billed / Collected / % collected must use the
 * SAME recognized, NON-future set as Outstanding. A future-dated (scheduled) invoice is not on the
 * books yet (server.js "never recognise a row dated after today") and must NOT inflate Billed or drag
 * the collection % down. Reconciliation must hold: Billed − Collected must equal Outstanding.
 *
 * Drives the REAL window.updateInvoices (finflow-api-wiring-postgres.js) in jsdom against index.html's
 * real #inv-billed / #inv-paid / #inv-paid-pct cells — not a re-implementation of the math.
 *
 * Discriminating (Rule 14): the PRE-D2 code summed EVERY invoice for Billed/Collected. With a
 * future-dated invoice seeded, that code reports Billed = 4000 (incl. the scheduled 1000) and
 * % = round(1500/4000)=38 — this harness asserts Billed = 3000 and % = 50, so it goes RED on the
 * old code and GREEN only on the recognized-set fix.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-d2-total-billed.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const FinFlowDates = require(path.join(ROOT, 'public', 'finflow-dates.js'));

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app' });
    const { window } = dom;
    const doc = window.document;

    // ── minimal environment the real updateInvoices reads ──
    window.FinFlowDates = FinFlowDates;
    window.S = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString();     // money formatter
    window.getPeriodData = () => ({ label: 'All time' });                       // all-time, no window filter
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    // The realm today (jsdom window.Date = real wall-clock; Node's pinned clock does not reach it) — both
    // the code under test and this reference AR must resolve "future" against the SAME today.
    const today = window.eval('window.FinFlowDates.resolvedToday(new Date())');   // realm today, YYYY-MM-DD
    // Real-shaped AR: Σ max(0, amount − amount_paid) over recognized, NON-future statuses — the same
    // definition the fix must reconcile against.
    window._arOutstanding = function (invs) {
      const REC = ['pending', 'overdue', 'partial', 'paid'];
      let total = 0, count = 0, overdueTotal = 0, overdueCount = 0;
      (invs || []).forEach(i => {
        if (!REC.includes((i.status || '').toLowerCase())) return;
        const d = FinFlowDates._toYmd(i.issue_date || i.created_at || i.date);
        if (d == null || d > today) return;                 // scheduled → excluded
        const owed = Math.max(0, (parseFloat(i.amount) || 0) - (parseFloat(i.amount_paid) || 0));
        if (owed > 0) { total += owed; count++; if ((i.status || '').toLowerCase() === 'overdue') { overdueTotal += owed; overdueCount++; } }
      });
      return { total, count, overdueTotal, overdueCount };
    };

    // Seed dates are derived from the realm today computed above, so "future" is genuinely future
    // relative to the same clock the code under test uses.
    const pad = n => String(n).padStart(2, '0');
    const off = n => { const p = today.split('-'); const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };

    // ── seed: three recognized (past-dated) + one FUTURE-dated (scheduled) ──
    window._realInvoices = [
      { id: 1, status: 'paid',    amount: 1000, amount_paid: 1000, issue_date: off(-20) }, // recognized, fully paid
      { id: 2, status: 'pending', amount: 1000, amount_paid: 0,    issue_date: off(-10) }, // recognized, unpaid
      { id: 3, status: 'partial', amount: 1000, amount_paid: 500,  issue_date: off(-5)  }, // recognized, half paid
      { id: 4, status: 'pending', amount: 1000, amount_paid: 0,    issue_date: off(30)  }, // FUTURE → scheduled, excluded
    ];
    // Recognized set = ids 1,2,3 → Billed 3000, Collected 1500, % = round(1500/3000)=50, Outstanding = 1500.

    window.eval(fs.readFileSync(path.join(ROOT, 'public', 'finflow-api-wiring-postgres.js'), 'utf8'));
    A('window.updateInvoices installed', typeof window.updateInvoices === 'function');

    window.updateInvoices();

    const billed = (doc.getElementById('inv-billed') || {}).textContent;
    const paid   = (doc.getElementById('inv-paid') || {}).textContent;
    const pct    = (doc.getElementById('inv-paid-pct') || {}).textContent;
    const out    = (doc.getElementById('inv-out') || {}).textContent;

    A('Billed excludes the future-dated invoice (= $3,000)', billed === '$3,000', 'got ' + billed);
    A('Collected is $1,500', paid === '$1,500', 'got ' + paid);
    A('% collected = 50% (not dragged down by scheduled)', /(^|\D)50% collected/.test(pct || ''), 'got ' + pct);
    A('Outstanding is $1,500', out === '$1,500', 'got ' + out);
    // Reconciliation: Billed − Collected === Outstanding
    const num = s => parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')) || 0;
    A('Reconciles: Billed − Collected === Outstanding', num(billed) - num(paid) === num(out),
      `${num(billed)} − ${num(paid)} = ${num(billed) - num(paid)} vs Outstanding ${num(out)}`);

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : 'RED') + ` — ${pass} passed, ${fail} failed  (D2: Invoices-page Billed/Collected/% exclude scheduled)`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('  HARNESS ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
