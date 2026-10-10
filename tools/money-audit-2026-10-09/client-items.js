'use strict';
/**
 * client-items.js — money audit 2026-10-09: EXECUTES the browser-only findings that were CODE-READ
 * (M11, M12, M13, M14, M20, M25, M27, M28, M29, M30, M31, M35, M37, M45) by booting the REAL SPA in jsdom
 * against a real scratch Postgres seeded through the real routes. Reads rendered DOM text only (jsdomBoot
 * rule): it never calls a compute function to read a value. Driving the app's own controls (setPeriod,
 * generateReport, setPersCurrency, the owner-payroll save) simulates a click.
 *
 * Clock: tests/harness/clock.js pins JS time to 2026-07-25 (fiscal year January, Q3, month index 6).
 * Inventory movements are stamped by Postgres NOW() (the real clock), so the seed re-dates the three
 * scratch movements into June/July — the shape a June/July stock sale would have. Scratch only.
 *
 * Each check prints MEASURED, EXPECTED (hand-computed below) and the value the suspected bug produces.
 *
 *   node -r ./tests/harness/clock.js tools/money-audit-2026-10-09/client-items.js
 *
 * HAND-COMPUTED (today 2026-07-25, fiscal year Jan–Dec):
 *   revenue  Year 1,820 (Jan 1,000 + Jun 300 + Jul 600 − credit note 80) · July 520 · June 300
 *   opex     Year 2,900 (rent 500 + payroll 2,000 + bill 400) · July 2,900 · June 0
 *   COGS     June 20 (4 @ 5) · July 10 (2 @ 5) · Year 30
 *   net      Year −1,110 · July −2,390 · June 280
 */
require('../../tests/harness/clock.js');
const { bootSpaInJsdom } = require('../../tests/harness/jsdomBoot.js');

const out = [];
const R = (id, measured, expected, buggy, note) => {
  const m = JSON.stringify(measured), e = JSON.stringify(expected), b = JSON.stringify(buggy);
  const verdict = m === e ? 'CORRECT (cleared)' : (m === b ? 'DEFECT CONFIRMED (matches predicted bug value)' : 'DIFFERS FROM BOTH');
  out.push({ id, verdict });
  console.log(`\n[${id}] ${verdict}\n   measured: ${m}\n   expected: ${e}\n   bug-pred: ${b}${note ? '\n   note:     ' + note : ''}`);
};

async function seed({ http, client: c, userId }) {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 200)}`); return r.json; };
  const ent = (await J('POST', '/api/entities', { name: 'Business A', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
  await J('POST', '/api/entities/' + ent + '/activate', {});
  await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 1000, status: 'pending', issue_date: '2026-01-10', due_date: '2026-02-10', idempotency_key: 'i1' });
  const i2 = await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 600, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-15', idempotency_key: 'i2' });
  await J('POST', '/api/invoice-payments', { invoice_id: i2.id, amount: 250, payment_date: '2026-07-03', idempotency_key: 'p2' });
  const i3 = await J('POST', '/api/invoices', { client: 'Beta Co', amount: 300, status: 'pending', issue_date: '2026-06-04', due_date: '2026-06-30', idempotency_key: 'i3' });
  await J('POST', '/api/invoice-payments', { invoice_id: i3.id, amount: 300, payment_date: '2026-06-05', idempotency_key: 'p3' });
  await J('POST', '/api/invoices', { client: 'Gamma', amount: 9999, status: 'draft', issue_date: '2026-07-06', idempotency_key: 'i4' });
  await J('POST', '/api/credit-notes', { customer: 'Acme Ltd', amount: 80, date: '2026-07-07', status: 'Open', idempotency_key: 'cn' });
  await J('POST', '/api/expenses', { description: 'Rent', category: 'Rent', amount: 500, deductible: 'yes', expense_date: '2026-07-01', idempotency_key: 'e1' });
  await J('POST', '/api/bills', { vendor: 'Supply Co', amount: 400, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-10', idempotency_key: 'b1' });
  await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Field', gross: 2000, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
  const run = await J('POST', '/api/payroll-runs', { period: 'July 2026', idempotency_key: 'run-jul' });   // the UI's default period format
  await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
  const item = await J('POST', '/api/inventory', { sku: 'W1', name: 'Widget', units: 0, max_units: 100, cost: 5 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 5, idempotency_key: 'mv1' });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 4, idempotency_key: 'mv2' });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 2, idempotency_key: 'mv3' });
  // scratch-only: Postgres NOW() is the real clock (October); re-date the three movements to June/July.
  await c.query(`UPDATE inventory_movements SET moved_at = CASE idempotency_key WHEN 'mv1' THEN '2026-06-01T12:00:00Z'::timestamptz WHEN 'mv2' THEN '2026-06-15T12:00:00Z'::timestamptz ELSE '2026-07-10T12:00:00Z'::timestamptz END WHERE user_id = $1`, [userId]);
  await J('POST', '/api/recurring-bills', { vendor: 'Net Host', amount: 100, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' });
  // personal: a monthly side-gig income profile with ONE occurrence this year, plus one grocery expense
  const prof = await J('POST', '/api/recurring-personal-transactions', { description: 'Side gig', amount: 1000, currency: 'USD', category: 'Salary', tx_type: 'income', frequency: 'Monthly', status: 'active', next_run: '2026-08-01' });
  await J('POST', '/api/personal-transactions', { description: 'Side gig', amount: 1000, currency: 'USD', category: 'Salary', tx_type: 'income', tx_date: '2026-07-15', recurring_profile_id: prof.id });
  await J('POST', '/api/personal-transactions', { description: 'Groceries', amount: 200, currency: 'USD', category: 'Groceries', tx_type: 'expense', tx_date: '2026-07-20' });
  await J('POST', '/api/personal-accounts', { name: 'Car', kind: 'asset', type: 'other', value: 1000 });
}

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, settle, text } = boot;
    const d = w.document;
    const ev = (src) => w.eval(src);
    const all = (id) => { const el = d.getElementById(id); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };
    await settle(80, 75);

    // ── Year view ───────────────────────────────────────────────────────────────────────────────
    ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(30, 60);
    if (typeof w.updateAI === 'function') w.updateAI(); if (typeof w.updateHealthScore === 'function') w.updateHealthScore();
    await settle(10, 50);
    const aiYear = all('ai-insights-list') || '';
    const growthTxt = (aiYear.match(/Full year revenue:[^.]*\.[^.]*\./) || [''])[0];
    R('M11 growth (AI Year insight + Health "Growth" sub-score)', { aiSaysMinus100: /−?-?100% growth/.test(aiYear), healthGrowth: text('hs-gr-v') },
      { aiSaysMinus100: false, healthGrowth: 'not 0/100' }, { aiSaysMinus100: true, healthGrowth: '0/100' },
      'REV[11] (December) is in the future on 25 Jul. AI line: ' + JSON.stringify(growthTxt));
    const p2r = (aiYear.match(/Payroll-to-revenue: (-?\d+)%/) || [])[1];
    R('M20 AI "Payroll-to-revenue" (payroll run 2,000 / revenue 1,820)', { payrollToRevenuePct: p2r == null ? null : Number(p2r) },
      { payrollToRevenuePct: 110 }, { payrollToRevenuePct: 0 }, 'bug reads salary-CATEGORY expense rows (none), not the payroll run');
    R('M30 Health "Receivables" sub-score', { receivables: text('hs-rec-v') },
      { receivables: '29/100' }, { receivables: '3/100' },
      'correct = collected 550 / recognised billed 1,900; bug = status-paid face 300 / every invoice incl. the 9,999 draft');
    // jsdom has no layout engine: buildRiver bails out when its container is 0px wide. Give the container the
    // width a real screen would (560px) so the SHIPPED buildRiver runs; nothing else about it is changed.
    ev(`(function(){ const wr=document.getElementById('river-wrap'); if(!wr) return; Object.defineProperty(wr,'offsetWidth',{configurable:true,get:()=>560}); Object.defineProperty(wr,'clientWidth',{configurable:true,get:()=>560}); Object.defineProperty(wr,'offsetParent',{configurable:true,get:()=>document.body}); buildRiver(getPeriodData()); })()`); await settle(10, 60);
    const riverSub = all('river-sub') || '';
    R('M37 River diagram net profit vs dashboard Net (Year)', { riverSays: riverSub, dashboardNet: text('d-profit') },
      { riverSays: '-$1,110 net profit', dashboardNet: text('d-profit') }, { riverSays: '$920 net profit', dashboardNet: text('d-profit') },
      'river = REV−EXP arrays: no COGS (30) and the "July 2026" payroll dropped (M10) ⇒ 1,820 − 900 = 920');

    // ── Invoices page: the two "% collected" writers ────────────────────────────────────────────
    w.updateInvoices && w.updateInvoices(); await settle(5, 40);
    const pctA = text('inv-paid-pct');
    ev(`window._refreshDashboardUI && window._refreshDashboardUI()`); await settle(10, 50);
    const pctB = text('inv-paid-pct');
    R('M27 Invoices "% collected" — two writers on the same card', { afterInvoicesWriter: pctA, afterDashboardWriter: pctB },
      { afterInvoicesWriter: pctA, afterDashboardWriter: pctA }, { afterInvoicesWriter: '29% collected', afterDashboardWriter: '30% collected' },
      'invoices writer 550/1,900; dashboard writer 550/(550 + AR 1,270)');

    // ── Bills nav badge ─────────────────────────────────────────────────────────────────────────
    if (typeof w.showPage === 'function') { try { w.showPage('bills'); } catch (_) {} }
    await settle(20, 60); if (typeof w.renderBills === 'function') w.renderBills(); await settle(5, 40);
    const blVals = Array.from(d.querySelectorAll('#page-bills .mc-val')).map(e => e.textContent.trim());
    R('M25 Bills nav badge (one unpaid bill, due 10 Jul, 400 past due)', { badge: text('badge-bills'), overdueCard: blVals[2] || null },
      { badge: '1', overdueCard: '$400' }, { badge: '0', overdueCard: '$400' }, 'badge counts the literal status overdue|due_soon; cards: ' + JSON.stringify(blVals));

    // ── Recurring bills YTD ─────────────────────────────────────────────────────────────────────
    if (typeof w.showPage === 'function') { try { w.showPage('recurring-bills'); } catch (_) {} }
    await settle(20, 60); if (typeof w.renderRecurringBills === 'function') w.renderRecurringBills(); await settle(5, 40);
    const rbVals = Array.from(d.querySelectorAll('#page-recurring-bills .mc-val')).map(e => e.textContent.trim());
    R('M31 Recurring Bills "YTD" (profile 100/month, first run 1 Aug — nothing generated yet)', { ytdCard: rbVals[3] || null },
      { ytdCard: '$0' }, { ytdCard: '$700' }, 'bug = monthly 100 × calendar month 7; cards: ' + JSON.stringify(rbVals));

    // ── Quarter view: AI label ──────────────────────────────────────────────────────────────────
    if (typeof w.showPage === 'function') { try { w.showPage('dashboard'); } catch (_) {} }
    ev(`setPeriod(document.getElementById('pQ'),'quarter')`); await settle(30, 60);
    w.updateAI && w.updateAI(); await settle(5, 40);
    const aiQ = all('ai-insights-list') || '';
    R('M28 AI Quarter insight names the current quarter (Q3 = July–September)', { firstLine: (aiQ.match(/^[^.]*revenue/) || [aiQ.slice(0, 60)])[0] },
      { firstLine: 'Jul 2026–Sep 2026 revenue' }, { firstLine: 'Oct 2026–Dec 2026 revenue' });

    // ── Month view (July): profit delta vs June ─────────────────────────────────────────────────
    ev(`setPeriod(document.getElementById('pMonth'),'month')`); await settle(40, 60);
    ev(`window.loadCOGS && window.loadCOGS()`); await settle(30, 60);
    ev(`window.updateDashboard && window.updateDashboard()`); await settle(10, 50);
    R('M29 Dashboard profit "vs prior period" (July net −2,390 vs June 280)', { profitChange: text('d-profit-chg'), profit: text('d-profit') },
      { profitChange: '↓ 954% vs prior period', profit: text('d-profit') }, { profitChange: '↓ 897% vs prior period', profit: text('d-profit') },
      'correct prior = June net incl. COGS 20 (280); bug prior = revenue − opex only (300)');

    // ── Reports: P&L tile label ─────────────────────────────────────────────────────────────────
    ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(20, 60);
    if (typeof w.generateReport === 'function') { await w.generateReport('Profit & Loss Statement'); await settle(20, 60); }
    const rpt = all('rpt-body') || '';
    const tile = (rpt.match(/Expenses\s*(\$[0-9,.\-−]+)\s*incl\. payroll \+ COGS/) || []);
    R('M45 P&L report "Expenses" tile (opex 2,900; COGS 30)', { tileValue: tile[1] || null, saysInclCogs: /incl\. payroll \+ COGS/.test(rpt) },
      { tileValue: '$2,930', saysInclCogs: true }, { tileValue: '$2,900', saysInclCogs: true }, 'label says COGS is included; value excludes it');

    // ── Personal finance ────────────────────────────────────────────────────────────────────────
    if (typeof w.showPage === 'function') { try { w.showPage('personal'); } catch (_) {} }
    await settle(20, 60);
    if (typeof w.loadPersonalFinance === 'function') await w.loadPersonalFinance(); await settle(20, 60);
    ev(`typeof setPersPeriod==='function' && setPersPeriod('year')`); await settle(10, 40);
    R('M12 Personal Yearly income (one 1,000 side-gig occurrence so far this year)', { yearlyIncome: text('pers-income') },
      { yearlyIncome: '$1.0K' }, { yearlyIncome: '$12.0K' }, 'cards abbreviate; 12.0K = 1,000 × 12 nominal months');
    ev(`setPersCurrency('TTD')`); await settle(10, 40);
    ev(`typeof renderPersAccounts==='function' && renderPersAccounts()`); await settle(5, 40);
    const acctTxt = all('pers-accounts-list') || '';
    R('M13 Personal asset "Car" entered as 1,000, personal currency switched to TTD', { shown: (acctTxt.match(/Car.*?(TT\$[0-9.,KM]+)/) || [])[1] || acctTxt.slice(0, 80) },
      { shown: 'TT$1.0K' }, { shown: 'TT$6.8K' }, 'value has no currency; SP() multiplies by the TTD rate');
    ev(`setPersCurrency('USD')`); await settle(5, 40);

    // M14 + M35: save the owner's payroll (4,000/month) through the app's own form handler, run NO payroll for it.
    ev(`(function(){ if(typeof openOwnerPayrollModal==='function'){ try{ openOwnerPayrollModal(); }catch(_){} } const s=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;}; s('own-fname','Olive'); s('own-lname','Owner'); s('own-gross','4000'); })()`);
    await settle(5, 40);
    if (typeof w.saveOwnerPayroll === 'function') { try { await w.saveOwnerPayroll(); } catch (e) { console.log('  saveOwnerPayroll threw: ' + e.message); } }
    await settle(40, 60);
    if (typeof w.loadPersonalFinance === 'function') await w.loadPersonalFinance(); await settle(20, 60);
    ev(`typeof setPersPeriod==='function' && setPersPeriod('year')`); await settle(10, 40);
    R('M14 Personal income after saving owner salary 4,000/month with NO payroll run for the owner', { yearlyIncome: text('pers-income') },
      { yearlyIncome: '$1.0K' }, { yearlyIncome: '$60.0K' },
      'Rule 12: no run ⇒ no salary. Bug = roster-built profile, and with M12 scaling (1,000 + 4,000) × 12 = 60,000');
    ev(`typeof syncAllPayrollsToPersonal==='function' && syncAllPayrollsToPersonal()`); await settle(10, 40);
    const ptx = all('pers-transactions') || '';
    R('M35 Personal transaction list after the payroll sync', { hasFakeAprilRow: /\(April\)/.test(ptx) && /Apr 30/.test(ptx) },
      { hasFakeAprilRow: false }, { hasFakeAprilRow: true }, 'list text: ' + JSON.stringify(ptx.slice(0, 160)));
  } catch (e) {
    console.log('FATAL: ' + (e && e.stack || e));
  } finally {
    try { if (boot && boot.stop) await boot.stop(); } catch (_) {}
  }
  console.log('\n==== SUMMARY ====');
  for (const o of out) console.log(o.verdict.padEnd(48) + ' ' + o.id);
})();
