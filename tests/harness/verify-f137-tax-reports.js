'use strict';
/**
 * verify-f137-tax-reports.js — PROVE (Rule 14) that the four Tax reports render their own content
 * (not the generic P&L overview), from real data with honest limitation labels:
 *   F137-j Tax-Deductible Expenses — deductible expenses by category; total == Σ (canonical).
 *   F137-k Income Tax Estimate     — /api/tax-filing figures; "not tax advice" banner; taxable matches.
 *   F137-l VAT Return              — honest "not tracked" state (no fabricated numbers).
 *   F137-m 1099 / W-2 Summary      — per-employee W-2 wages == Σ payroll line gross; 1099 note.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f137-tax-reports.js
 *
 * EXPECTED: current bundle → all four render the generic modal ("incl. bills") → FAIL.
 *           fixed bundle   → each renders its own content with figures matching the server → GREEN.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const s = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(s)) return;
  throw e;
});

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        const ex = (data) => c.query(`INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`, [uid, data]);
        await ex({ description: 'IDE license', category: 'Software', amount: 400, deductible: 'yes', expense_date: '2026-07-03' });
        await ex({ description: 'Client trip', category: 'Travel', amount: 250, deductible: 'yes', expense_date: '2026-07-05' });
        await ex({ description: 'Team lunch', category: 'Meals', amount: 100, deductible: 'no', expense_date: '2026-07-06' });
        const run = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net, notes) VALUES ($1,NULL,$2,NOW(),$3,$4,$5,$6,'') RETURNING id`,
          [uid, '2026-07', 'approved', 3000, 600, 2400])).rows[0].id;
        await c.query(`INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,$2,$3,$4,0,0,'[]'::jsonb,$5)`, [run, 1, 'Alice A', 2000, 1600]);
        await c.query(`INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay) VALUES ($1,$2,$3,$4,0,0,'[]'::jsonb,$5)`, [run, 2, 'Bob B', 1000, 800]);
      },
    });
    const { window, http, settle, wireLog } = boot;
    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(12, 100);
    A('runtime winner present: window.generateReport', typeof window.generateReport === 'function');

    const fmt = (typeof window._fmtMoneyNative === 'function') ? window._fmtMoneyNative : (n) => '$' + (parseFloat(n) || 0).toFixed(2);
    const flat = s => (s || '').replace(/\s+/g, '');
    const bodyOf = async (r) => { await window.generateReport(r); await settle(22, 60); const el = window.document.getElementById('rpt-body'); return { raw: el ? el.textContent || '' : '', flat: flat(el ? el.textContent : ''), html: el ? el.innerHTML : '' }; };

    // Server oracles.
    const exps = (await http.get('/api/expenses')).json || [];
    const isDed = x => { const d = x.deductible; return d === true || /^(yes|true|1|y)$/i.test(String(d || '')); };
    const srvDed = exps.filter(isDed).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
    const tf = (await http.get('/api/tax-filing')).json || {};
    const runs = (await http.get('/api/payroll-runs')).json || [];
    const srvWages = runs.reduce((s, r) => s + (Array.isArray(r.lines) ? r.lines : []).filter(Boolean).reduce((a, l) => a + (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0), 0), 0);
    console.log(`  [server] deductible=${srvDed} taxable=${tf.taxableIncome} estTax=${tf.estimatedTax} wages=${srvWages}`);

    // F137-j Tax-Deductible Expenses
    const td = await bodyOf('Tax-Deductible Expenses');
    A('Deductible: own content ("Deductible by category" + "Total Deductible")', /Deductible by category/i.test(td.raw) && /Total Deductible/i.test(td.raw));
    A('Deductible: NOT generic', !/incl\.\s*bills/i.test(td.raw));
    A('Deductible: total === Σ deductible expenses (canonical)', td.flat.includes('TotalDeductible' + flat(fmt(srvDed))), `want TotalDeductible${flat(fmt(srvDed))} (ded=${srvDed})`);
    A('Deductible: no escaped-HTML leak', !/<span/i.test(td.raw));

    // F137-k Income Tax Estimate — multi-line worksheet
    const taxable = Number(tf.taxableIncome) || 0;
    const it = await bodyOf('Income Tax Estimate');
    const tget = id => window.document.getElementById(id);
    A('Income Tax: worksheet content (Tax lines + Estimated Tax + not-tax-advice + Add line)',
      /Tax lines/i.test(it.raw) && /Estimated Tax/i.test(it.raw) && /not tax advice/i.test(it.raw) && /Add tax line/i.test(it.raw));
    A('Income Tax: NOT generic', !/incl\.\s*bills/i.test(it.raw));
    A('Income Tax: no escaped-HTML leak', !/<span|<input|<select/i.test(it.raw));
    A('Income Tax: default income line computes taxable × 25%',
      !!tget('tl-total') && flat(tget('tl-total').textContent) === flat(fmt(Math.round(taxable * 25 / 100 * 100) / 100)), `total=${tget('tl-total') && tget('tl-total').textContent}`);
    // Edit line 0 → 30%, add a fixed capital-gains line $500, assert the total reconciles.
    const setv = (id, v) => { const x = tget(id); if (x) x.value = v; };
    setv('tl-val-0', '30'); window.onTaxEdit(); await settle(2, 50);
    window.addTaxLine(); await settle(2, 50);
    setv('tl-label-1', 'Capital gains'); setv('tl-type-1', 'fixed'); setv('tl-val-1', '500'); window.onTaxEdit(); await settle(2, 50);
    const expTotal = Math.round((taxable * 30 / 100 + 500) * 100) / 100;
    A('Income Tax: multi-line total reconciles (30% of taxable + $500 fixed)',
      !!tget('tl-total') && flat(tget('tl-total').textContent) === flat(fmt(expTotal)), `total=${tget('tl-total') && tget('tl-total').textContent} want=${fmt(expTotal)}`);
    A('Income Tax: no leak after add-line re-render', !/<span|<input|<select/i.test((tget('rpt-body') || {}).textContent || ''));
    await settle(8, 100); // past the 500ms debounce
    const puts = (wireLog || []).filter(w => w.method === 'PUT' && w.path === '/api/settings' && /tax_lines/.test(w.body || ''));
    A('Income Tax: worksheet persists via PUT /api/settings {tax_lines}', puts.length >= 1, `puts=${puts.length}`);
    const after = (await http.get('/api/settings')).json || {};
    A('Income Tax: tax_lines saved server-side (SOURCE OF TRUTH: 2 lines incl. fixed $500); derived tax_rate finite',
      Array.isArray(after.tax_lines) && after.tax_lines.length === 2 && after.tax_lines.some(l => l.type === 'fixed' && Number(l.value) === 500) && Number.isFinite(Number(after.tax_rate)),
      `tax_lines=${JSON.stringify(after.tax_lines)} rate=${after.tax_rate}`);
    // Derived rate is exact for %-of-taxable lines when taxable>0; with a fixed line or taxable=0 it
    // cannot be represented as one rate (the accountant-portal coupling limitation — see ledger).
    A('Income Tax: derived tax_rate reproduces the total when taxable>0 (else 0, honest)',
      taxable > 0 ? Math.abs(Number(after.tax_rate) / 100 * taxable - expTotal) < 1 : Number(after.tax_rate) === 0,
      `rate=${after.tax_rate} taxable=${taxable} expTotal=${expTotal}`);

    // F137-l VAT Return
    const vt = await bodyOf('VAT Return');
    A('VAT: honest "not tracked" state (no fabricated numbers)', /VAT \/ GST is not tracked/i.test(vt.raw));
    A('VAT: NOT generic', !/incl\.\s*bills/i.test(vt.raw));

    // F137-m 1099 / W-2 Summary
    const w2 = await bodyOf('1099 / W-2 Summary');
    A('1099/W-2: own content ("Employee wages (W-2)") + 1099-not-tracked note', /Employee wages/i.test(w2.raw) && /1099[^.]*not (separately )?tracked/i.test(w2.raw));
    A('1099/W-2: NOT generic', !/incl\.\s*bills/i.test(w2.raw));
    A('1099/W-2: Total Wages === Σ payroll line gross (basis C)', w2.flat.includes('TotalWages' + flat(fmt(srvWages))), `want TotalWages${flat(fmt(srvWages))} (wages=${srvWages})`);
    A('1099/W-2: seeded employee "Alice A" appears', /Alice A/.test(w2.raw));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
