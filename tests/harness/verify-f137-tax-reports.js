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

    // F137-k Income Tax Estimate
    const it = await bodyOf('Income Tax Estimate');
    A('Income Tax: own content + "not tax advice" disclaimer', /not tax advice/i.test(it.raw) && /Estimated Annual Tax/i.test(it.raw));
    A('Income Tax: NOT generic', !/incl\.\s*bills/i.test(it.raw));
    A('Income Tax: Taxable income === /api/tax-filing taxableIncome', it.flat.includes('Taxableincome' + flat(fmt(Number(tf.taxableIncome) || 0))), `want Taxableincome${flat(fmt(Number(tf.taxableIncome) || 0))}`);
    // Editable persistent rate (replaces the hardcoded 25%).
    const itRate = window.document.getElementById('it-rate');
    A('Income Tax: editable rate input present, defaults to 25%', !!itRate && String(itRate.value) === '25', `value=${itRate && itRate.value}`);
    if (itRate) {
      const taxable = Number(tf.taxableIncome) || 0;
      itRate.value = '40';
      if (typeof window.onIncomeTaxRateChange === 'function') window.onIncomeTaxRateChange();
      await settle(3, 50);
      const estEl = window.document.getElementById('it-est');
      const wantEst = fmt(Math.round(taxable * 40 / 100));
      A('Income Tax: editing the rate recomputes the estimate (taxable × new rate)',
        !!estEl && flat(estEl.textContent) === flat(wantEst), `est=${estEl && estEl.textContent} want=${wantEst}`);
      await settle(8, 100); // past the 500ms debounce
      const puts = (wireLog || []).filter(w => w.method === 'PUT' && w.path === '/api/settings' && /tax_rate/.test(w.body || ''));
      A('Income Tax: the new rate persists via PUT /api/settings {tax_rate} (also feeds the accountant portal)',
        puts.length >= 1 && /"tax_rate":\s*40/.test(puts[puts.length - 1].body || ''), `puts=${puts.length}`);
      const after = (await http.get('/api/settings')).json || {};
      A('Income Tax: tax_rate saved server-side (settings allowlist accepts it — accountant portal reads settings.tax_rate)',
        Number(after.tax_rate) === 40, `server tax_rate=${JSON.stringify(after.tax_rate)}`);
    }

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
