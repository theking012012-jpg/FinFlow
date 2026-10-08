'use strict';
/**
 * verify-aging-reports-reconcile.js — L39 (regression class of L6b). The Accounts Receivable and Accounts Payable
 * reports promise (F137-c / F137-d, asserted by verify-f137-cashflow-ar-ap-reports.js) that their total IS the
 * balance-sheet line and that Σ rows == total. L6b made the balance-sheet AR / AP CONTROL accounts (invoice / bill
 * subledger + posted journals' AR / AP legs — D16), but the reports' rows are customers / vendors only:
 *   · AR report: total = the customer subledger (1,000) while the balance sheet says 1,130 — they no longer agree.
 *   · AP report: total = the balance sheet (460) while the vendor rows sum to 400 — the report does not foot.
 * The existing harness stayed green because its seed has no journals (Rule 4). Fix: the balance sheet exposes the
 * reconciliation (subledger + journalAdjustments = control) and each report shows the journal leg as an explicit row
 * ("Manual journal entries (no customer / vendor)"), so rows foot to a total that equals the balance-sheet line.
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes:
 *   invoice 1,000 pending (Acme, 06-01) · bill 400 unpaid (Supplier, 06-02)
 *   JE 07-10 Dr 1100 Accounts Receivable 130 / Cr 4000 Service Revenue 130
 *   JE 07-11 Dr 5200 Utilities 60 / Cr 2000 Accounts Payable 60
 * HAND-COMPUTED: AR report  Acme 1,000 + manual journal entries 130 = 1,130 = balance-sheet AR
 *                AP report  Supplier 400 + manual journal entries 60 = 460 = balance-sheet AP
 * BUGGY (pre-fix): AR report total 1,000 ≠ balance sheet 1,130 · AP report rows 400 ≠ its total 460 ·
 *                  no journalAdjustments / subledger on the balance-sheet response.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-aging-reports-reconcile.js
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
    console.log('\n' + '='.repeat(78) + '\n  L39 — AR / AP reports foot, and their totals equal the balance-sheet control accounts\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L39 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-08-01' });
      await J('/api/bills', { vendor: 'Supplier', amount: 400, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-08-02' });
      const je = (date, description, lines) => J('/api/journals', { date, description, status: 'Posted', lines });
      await je('2026-07-10', 'AR adjustment', [{ code: '1100', name: 'Accounts Receivable', debit: 130, credit: 0 }, { code: '4000', name: 'Service Revenue', debit: 0, credit: 130 }]);
      await je('2026-07-11', 'Utilities accrual', [{ code: '5200', name: 'Utilities', debit: 60, credit: 0 }, { code: '2000', name: 'Accounts Payable', debit: 0, credit: 60 }]);
    } });
    const { window: w, settle, http } = ctx;
    await settle(40, 100);

    // ── server: the balance sheet states its own reconciliation ──
    const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
    A('CONTROL: balance sheet AR 1,130 · AP 460 from the reconciled GL (L6b)', bs.source === 'gl' && near(bs.accountsReceivable, 1130) && near(bs.accountsPayable, 460), JSON.stringify({ src: bs.source, ar: bs.accountsReceivable, ap: bs.accountsPayable }));
    const sl = bs.subledger || {}, ja = bs.journalAdjustments || {};
    A('balance sheet exposes subledger AR 1,000 + journal AR 130 = 1,130 (bug: absent)', near(sl.ar, 1000) && near(ja.ar, 130) && near(sl.ar + ja.ar, bs.accountsReceivable), JSON.stringify({ subledger: bs.subledger, journalAdjustments: bs.journalAdjustments }));
    A('balance sheet exposes subledger AP 400 + journal AP 60 = 460 (bug: absent)', near(sl.ap, 400) && near(ja.ap, 60) && near(sl.ap + ja.ap, bs.accountsPayable), JSON.stringify({ subledger: bs.subledger, journalAdjustments: bs.journalAdjustments }));

    for (let i = 0; i < 250 && typeof w.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));

    // ── AR report ──
    await w.generateReport('Accounts Receivable'); await settle(25, 60);
    let rows = renderedRows(w.document);
    console.log('  [AR rendered] ' + rows.map(r => r.label + '=' + r.text).join(' | '));
    let iT = rows.findIndex(r => /^Total Receivable/.test(r.label));
    let body = iT > 0 ? rows.slice(0, iT) : [];
    let rsum = Math.round(body.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0) * 100) / 100;
    A('AR report: "Acme" row 1,000', body.some(r => r.label === 'Acme' && near(r.value, 1000)), JSON.stringify(body));
    A('AR report: a "Manual journal entries" row of 130 (bug: absent)', body.some(r => /manual journal/i.test(r.label) && near(r.value, 130)), JSON.stringify(body));
    A('AR report: Total Receivable 1,130 = balance-sheet AR (bug: 1,000)', iT >= 0 && near(rows[iT].value, 1130) && near(rows[iT].value, bs.accountsReceivable), 'total=' + (rows[iT] || {}).text);
    A('AR report: rows foot to the total (Σ 1,130)', iT >= 0 && near(rsum, rows[iT].value), 'Σ=' + rsum + ' total=' + (rows[iT] || {}).text);

    // ── AP report ──
    await w.generateReport('Accounts Payable'); await settle(25, 60);
    rows = renderedRows(w.document);
    console.log('  [AP rendered] ' + rows.map(r => r.label + '=' + r.text).join(' | '));
    iT = rows.findIndex(r => /^Total Payable/.test(r.label));
    body = iT > 0 ? rows.slice(0, iT) : [];
    rsum = Math.round(body.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0) * 100) / 100;
    A('AP report: "Supplier" row 400', body.some(r => r.label === 'Supplier' && near(r.value, 400)), JSON.stringify(body));
    A('AP report: a "Manual journal entries" row of 60 (bug: absent)', body.some(r => /manual journal/i.test(r.label) && near(r.value, 60)), JSON.stringify(body));
    A('AP report: Total Payable 460 = balance-sheet AP', iT >= 0 && near(rows[iT].value, 460) && near(rows[iT].value, bs.accountsPayable), 'total=' + (rows[iT] || {}).text);
    A('AP report: rows foot to the total (bug: Σ 400 vs 460)', iT >= 0 && near(rsum, rows[iT].value), 'Σ=' + rsum + ' total=' + (rows[iT] || {}).text);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (aging reports reconcile)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
