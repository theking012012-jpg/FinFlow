'use strict';
/**
 * M15 (money audit 2026-10-09; was L42): one "deductible" vocabulary on every surface.
 * BUG: four readers disagreed — server tax leg counted 'Yes' but not boolean true (the receipt scanner's
 * value); the Expenses page counted only lowercase 'yes'; the Tax-Deductible report counted true; the expense
 * list labelled a MISSING flag (CSV / Codat imports) "100% deductible" while every total counted it 0.
 * Seed (June 2026, values distinct so each row's treatment is visible — Rule 4):
 *   via the API:      A 100 deductible=true · B 40 'Yes' · C 25 'half' · D 10 (no flag)
 *   legacy SQL rows:  E 300 true (raw JSON boolean) · F 7 'Yes' (raw, never normalised) · G 5 with NO flag
 *                     (the shape CSV / Codat imports write)
 *   correct deductible = 100 + 40 + 12.5 + 0 + 300 + 7 = 459.5
 *   bug (server): 0 + 40 + 12.5 + 0 + 0 + 7 = 59.5    bug (Expenses page): 0 + 0 + 12.5 + 0 + 0 + 0 = 12.5
 * Also: the API stores the canonical vocabulary (A → 'yes', B → 'yes', C → 'half', D → 'no').
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };
const money = s => { const m = String(s == null ? '' : s).replace(/[,\s]/g, '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

async function seed({ http, client, userId }) {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text.slice(0, 200)); return JSON.parse(r.text); };
  const ent = await J('POST', '/api/entities', { name: 'Ded Co', currency: 'USD', timezone: 'UTC', country: 'US' });
  await J('POST', '/api/entities/' + ent.id + '/activate', {});
  await J('POST', '/api/expenses', { description: 'A scanner', category: 'Office', amount: 100, deductible: true, expense_date: '2026-06-03', idempotency_key: 'm15a' });
  await J('POST', '/api/expenses', { description: 'B capital', category: 'Office', amount: 40, deductible: 'Yes', expense_date: '2026-06-04', idempotency_key: 'm15b' });
  await J('POST', '/api/expenses', { description: 'C half', category: 'Meals', amount: 25, deductible: 'half', expense_date: '2026-06-05', idempotency_key: 'm15c' });
  await J('POST', '/api/expenses', { description: 'D none', category: 'Other', amount: 10, expense_date: '2026-06-06', idempotency_key: 'm15d' });
  for (const [desc, amt, ded] of [['E legacy bool', 300, true], ['F legacy Yes', 7, 'Yes'], ['G imported', 5, undefined]])
    await client.query(`INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [userId, ent.id, Object.assign({ description: desc, category: 'Office', amount: amt, expense_date: '2026-06-07' }, ded === undefined ? {} : { deductible: ded })]);
}

(async () => {
  let ctx;
  try {
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window, settle, http } = ctx;
    await settle(60, 100);
    const list = JSON.parse((await http.get('/api/expenses')).text);
    const by = Object.fromEntries(list.map(e => [e.description, e.deductible]));
    A('API stores the canonical vocabulary (true→yes, Yes→yes, half, missing→no)',
      by['A scanner'] === 'yes' && by['B capital'] === 'yes' && by['C half'] === 'half' && by['D none'] === 'no', JSON.stringify(by));
    const tf = JSON.parse((await http.get('/api/tax-filing?fyStart=0')).text);
    const bk = JSON.parse((await http.get('/api/reports')).text);
    // The server's flagged-deductible leg is exposed through the tax worksheet's non-deductible figure:
    // non-deductible = Σ expense rows − deductible rows = 487 − 459.5 = 27.5 (bug: 487 − 59.5 = 427.5).
    A('server: non-deductible expense rows = 27.5 (bug 427.5)', Math.abs(tf.nonDeductibleExpenses - 27.5) < 0.01, 'measured ' + tf.nonDeductibleExpenses + ' opex ' + bk.expenses);

    window.showPage('expenses'); await settle(20, 100);
    const exDed = money(window.document.getElementById('ex-ded') && window.document.getElementById('ex-ded').textContent);
    A('Expenses page "Tax deductible" = 459.5 (bug 12.5)', Math.abs(exDed - 459.5) < 0.6, 'ex-ded=' + exDed);
    const rows = Array.from(window.document.querySelectorAll('#expense-list .tx-row')).map(r => r.textContent.replace(/\s+/g, ' '));
    const rowOf = name => rows.find(t => t.includes(name)) || '';
    A('expense list: the API row with no flag is NOT labelled deductible', !/deductible/.test(rowOf('D none')), rowOf('D none'));
    A('expense list: the IMPORTED row with no flag is NOT labelled deductible (bug: "100% deductible")', rowOf('G imported') && !/deductible/.test(rowOf('G imported')), rowOf('G imported'));
    A('expense list: the scanner row (true) is labelled 100% deductible', /100% deductible/.test(rowOf('A scanner')), rowOf('A scanner'));
    A('expense list: the half row is labelled 50% deductible', /50% deductible/.test(rowOf('C half')), rowOf('C half'));

    window.showPage('reports'); await settle(15, 100);
    await window.generateReport('Tax-Deductible Expenses'); await settle(20, 100);
    const body = (window.document.getElementById('rpt-body') || {}).textContent || '';
    // The report paints whole currency units; its closing "Total Deductible" row is the figure (459.5 → $460).
    const all = [...body.replace(/\s+/g, ' ').matchAll(/Total Deductible\s*\$?(-?[\d,]+(?:\.\d+)?)/g)];
    const rptTotal = all.length ? parseFloat(all[all.length - 1][1].replace(/,/g, '')) : NaN;
    A('Tax-Deductible report total = 459.5 shown as $460 (control: this reader already agreed for these values)', rptTotal === 460, 'report total=' + rptTotal);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (ctx && ctx.stop) await ctx.stop(); } catch {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (M15 deductible vocabulary)\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
