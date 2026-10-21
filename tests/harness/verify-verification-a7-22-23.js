'use strict';
/**
 * VERIFICATION.md A7.22 + A7.23 — the two A7 rows no harness covered (step3-gate's own "A7.22 / A7.23" labels are
 * DIFFERENT checks — an AP future-bill probe and a payment settle probe; ID collision noted in VERIFICATION.md).
 *
 * A7.22  Payroll → run history dates: formatted, on the BUSINESS's local day (Rule 10). run_date is a Postgres DATE the
 *        server stamps with the ENTITY's today. Seed discriminates: the business is in Pacific/Kiritimati (UTC+14); at
 *        the pinned instant 2026-07-25T16:00Z its local day is already 26 Jul, while the UTC day is 25 Jul. The run is
 *        created through the real route. Expected: "Jul 26" (a UTC stamp would give "Jul 25").
 * A7.23  Tax → YTD paid: absent, or the literal "Not tracked". ANY number = FAIL (Appendix C.2: tax paid has no source).
 *        Checked across the Dashboard, the Reports page and the generated "Income Tax Estimate" and
 *        "Tax-Deductible Expenses" reports.
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };
  console.log('\nVERIFICATION A7.22 (payroll run dates, local day) + A7.23 (no tax-paid number)\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 200)}`); return r.json; };
      const e = (await J('POST', '/api/entities', { name: 'Island Co', currency: 'AUD', timezone: 'Pacific/Kiritimati', country: 'KI' })).id;
      await J('POST', '/api/entities/' + e + '/activate', {});
      await J('POST', '/api/invoices', { client: 'Acme', amount: 5000, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-02', idempotency_key: 'a723-i' });
      await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 1000, deductible: 'yes', expense_date: '2026-07-03', idempotency_key: 'a723-e' });
      await J('POST', '/api/payroll', { fname: 'Pat', lname: 'Staff', gross: 3000 });
      await J('POST', '/api/payroll-runs', { period: 'July 2026', idempotency_key: 'a722-run' });   // run_date = the business's today
    } });
    const { window: w, settle } = boot;
    const d = w.document;
    await settle(60, 75);

    // A7.22
    try { w.showPage('payroll'); } catch (_) {}
    try { await w.loadPayrollRuns(); } catch (_) {}
    await settle(20, 60);
    const runs = ((d.getElementById('payroll-runs-list') || {}).textContent || '').replace(/\s+/g, ' ');
    A('A7.22 run date is the business\'s local day — Jul 26 (a UTC stamp gives Jul 25)', /Jul 26/.test(runs) && !/Jul 25/.test(runs), JSON.stringify(runs.slice(0, 160)));

    // A7.23
    const texts = [];
    for (const p of ['dashboard', 'reports']) { try { w.showPage(p); } catch (_) {} await settle(20, 60); texts.push(d.body.textContent); }
    for (const r of ['Income Tax Estimate', 'Tax-Deductible Expenses']) {
      try { await w.generateReport(r); } catch (_) {} await settle(20, 60);
      texts.push((d.getElementById('report-gen-modal') || d.body).textContent);
    }
    const all = texts.join(' ').replace(/\s+/g, ' ');
    const hits = all.match(/tax(es)?\s*paid[^.]{0,40}/gi) || [];
    const numeric = hits.filter(h => /\d/.test(h) && !/Not tracked/i.test(h));
    A('A7.23 no tax-PAID number on Dashboard, Reports, Income Tax Estimate, Tax-Deductible (absent or "Not tracked")', numeric.length === 0, JSON.stringify(numeric.slice(0, 3)));
    A('A7.23 premise: the Income Tax Estimate report rendered (non-empty)', /Tax/i.test(texts[2] || ''), String(texts[2] || '').slice(0, 80));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
