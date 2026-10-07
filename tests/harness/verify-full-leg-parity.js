'use strict';
/**
 * verify-full-leg-parity.js — Phase 1.1 (Rule 2 / 6 / 13): with ONE of every money leg on the books
 * (fullLegScenario: invoice, invoice payment, sales receipt, credit note, expense, issued bill, linked +
 * orphan payment made, vendor credit, posted income + expense journals, payroll runs draft/approved/paid),
 * every surface that shows a headline money figure must equal the HAND-COMPUTED value — client == server
 * == GL — at every period (year · quarter · month).
 *
 * Surfaces (code-side ↔ screen-side):
 *   server  GET /api/reports (computeBooks) · POST /api/reports/profit-loss (totals + monthly rows) ·
 *           GET /api/gl/reconcile-check · GET /api/gl/pnl · POST /api/reports/balance-sheet ·
 *           POST /api/reports/cash-flow · computeBooks.monthly
 *   client  dashboard KPIs #d-rev #d-exp #d-profit #d-outstanding · overview chart REV[]/EXP[] ·
 *           Invoices page Outstanding · Payments Received Outstanding · Vendors Payables ·
 *           Cash Flow page Cash In / Out / Net · Reports page Revenue / Net Result
 *
 * Expected values are derived from the seed by hand (see fullLegScenario.js), never from the code:
 *   year  : revenue 745 · opex 614 · net 131 · AR 635 · AP 22 · cash in 80 / out 280
 *   June  : revenue 745 · opex 314 (= 614 − May's approved run 300) · net 431
 *   Quarter: TODAY's fiscal quarter (Q3, Jul–Sep — no rows) ⇒ 0 · 0 · 0, also after browsing to June (L9)
 *   monthly (Jan FY): revenue Jun 745 · expense May 300, Jun 314, all other months 0
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-full-leg-parity.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario, EXPECTED } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const money = s => { const m = String(s == null ? '' : s).replace(/[,\s]/g, '').match(/(-?)\$?(-?\d+(?:\.\d+)?)/); return m ? (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) : NaN; };

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  Phase 1.1 — full-leg parity: client == server == GL == hand-computed\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: postFullLegScenario });
    const { window, http, settle, text } = ctx;
    const d = window.document;
    const getJ = async p => JSON.parse((await http.get(p)).text);
    const postJ = async p => JSON.parse((await http.post(p, {})).text);
    const card = (page, label) => {
      const pg = d.getElementById('page-' + page); if (!pg) return NaN;
      const c = [...pg.querySelectorAll('.mc')].find(m => (m.querySelector('.mc-label') || {}).textContent.trim() === label);
      return c ? money(c.querySelector('.mc-val').textContent) : NaN;
    };

    // ── server, year ──
    const rep = await getJ('/api/reports?period=year&fyStart=0');
    A('server /api/reports revenue == 745', near(rep.revenue, EXPECTED.revenue), 'revenue=' + rep.revenue);
    A('server /api/reports expenses == 614', near(rep.expenses, EXPECTED.opex), 'expenses=' + rep.expenses);
    A('server /api/reports netProfit == 131', near(rep.netProfit, EXPECTED.net), 'net=' + rep.netProfit);
    A('server /api/reports outstanding (AR) == 635', near(rep.outstanding, EXPECTED.ar), 'AR=' + rep.outstanding);
    const pl = await postJ('/api/reports/profit-loss?period=year&fyStart=0');
    A('server P&L totals == 745 / 614 / 131', near(pl.totalRevenue, 745) && near(pl.totalExpenses, 614) && near(pl.netProfit, 131), JSON.stringify({ r: pl.totalRevenue, e: pl.totalExpenses, n: pl.netProfit }));
    const _plR = (pl.rows || []).reduce((s, r) => s + r.revenue, 0), _plE = (pl.rows || []).reduce((s, r) => s + r.expenses, 0);
    A('server P&L monthly rows sum to the totals', near(_plR, 745) && near(_plE, 614), 'Σrev=' + _plR + ' Σexp=' + _plE);
    const rc = await getJ('/api/gl/reconcile-check');
    A('GL reconcile-check: books balanced + reconciled to reports', rc.ok === true && (rc.entities || []).every(e => e.booksBalanced && e.reconciledToReports), JSON.stringify(rc).slice(0, 300));
    const glpnl = await getJ('/api/gl/pnl');
    const glInc = (glpnl.lines || []).filter(l => l.type === 'income').reduce((s, l) => s + l.amount, 0);
    const glExp = (glpnl.lines || []).filter(l => l.type === 'expense').reduce((s, l) => s + l.amount, 0);
    A('GL P&L income == 745, expense == 614', near(glInc, 745) && near(glExp, 614), 'inc=' + glInc + ' exp=' + glExp);
    const bs = await postJ('/api/reports/balance-sheet');
    A('balance sheet (GL) AR == 635, AP == 22, equity == 131', bs.source === 'gl' && near(bs.accountsReceivable, 635) && near(bs.accountsPayable, 22) && near(bs.equity, 131), JSON.stringify(bs));
    const cf = await postJ('/api/reports/cash-flow?period=year&fyStart=0');
    A('cash-flow report in 80 / out 280', near(cf.totalInflow, EXPECTED.cashIn) && near(cf.totalOutflow, EXPECTED.cashOut), 'in=' + cf.totalInflow + ' out=' + cf.totalOutflow);

    // ── client, year ──
    await settle(60, 100);
    A('dashboard Revenue == 745', near(money(text('d-rev')), 745), 'd-rev=' + text('d-rev'));
    A('dashboard Expenses == 614', near(money(text('d-exp')), 614), 'd-exp=' + text('d-exp'));
    A('dashboard Net profit == 131', near(money(text('d-profit')), 131), 'd-profit=' + text('d-profit'));
    A('dashboard Outstanding == 635', near(money(text('d-outstanding')), 635), 'd-outstanding=' + text('d-outstanding'));
    const REV = window.eval('typeof REV!=="undefined"?Array.from(REV):null'), EXP = window.eval('typeof EXP!=="undefined"?Array.from(EXP):null');
    const srvM = rep.monthly || {};
    A('chart REV[] == hand monthly (Jun 745, else 0)', REV && REV.length === 12 && REV.every((v, i) => near(v, i === 5 ? 745 : 0)), 'REV=' + JSON.stringify(REV));
    A('chart EXP[] == hand monthly (May 300, Jun 314, else 0)', EXP && EXP.length === 12 && EXP.every((v, i) => near(v, i === 4 ? 300 : i === 5 ? 314 : 0)), 'EXP=' + JSON.stringify(EXP));
    A('server monthly == chart arrays', srvM.revByMonth && srvM.revByMonth.every((v, i) => near(v, REV[i])) && srvM.expByMonth.every((v, i) => near(v, EXP[i])),
      'srv rev=' + JSON.stringify(srvM.revByMonth) + ' exp=' + JSON.stringify(srvM.expByMonth));
    window.showPage('invoices'); await settle(20, 100);
    A('Invoices page Outstanding == 635', near(card('invoices', 'Outstanding'), 635), 'shown=' + card('invoices', 'Outstanding'));
    window.showPage('payments-received'); await settle(20, 100);
    A('Payments Received Outstanding == 635', near(card('payments-received', 'Outstanding'), 635), 'shown=' + card('payments-received', 'Outstanding'));
    window.showPage('vendors'); await settle(20, 100);
    A('Vendors Payables == 22', near(card('vendors', 'Payables'), 22), 'shown=' + card('vendors', 'Payables'));
    window.showPage('cashflow'); await settle(25, 100);
    A('Cash Flow page In 80 / Out 280 / Net −200', near(money(text('cf-in')), 80) && near(money(text('cf-out')), 280) && near(money(text('cf-net')), -200),
      'in=' + text('cf-in') + ' out=' + text('cf-out') + ' net=' + text('cf-net'));
    window.showPage('reports'); await settle(25, 100);
    A('Reports page Revenue 745 / Net Result 131', near(card('reports', 'Revenue'), 745) && near(card('reports', 'Net Result'), 131), 'rev=' + card('reports', 'Revenue') + ' net=' + card('reports', 'Net Result'));

    // ── month: June ──
    window.showPage('dashboard');
    window.setPeriod(d.getElementById('pMonth'), 'month');
    await settle(10, 100);
    for (let i = 0; i < 12 && window.eval('currentMonthIdx') > 5; i++) { window.shiftMonth(-1); await settle(3, 100); }
    await settle(30, 100);
    const mi = window.eval('currentMonthIdx');
    const repM = await getJ('/api/reports?period=month&monthIdx=' + mi + '&fyStart=0');
    A('month nav on June (fiscal idx 5)', mi === 5, 'currentMonthIdx=' + mi);
    A('server June: revenue 745 · expenses 314 · net 431', near(repM.revenue, 745) && near(repM.expenses, 314) && near(repM.netProfit, 431), JSON.stringify({ r: repM.revenue, e: repM.expenses, n: repM.netProfit }));
    A('dashboard June: 745 / 314 / 431', near(money(text('d-rev')), 745) && near(money(text('d-exp')), 314) && near(money(text('d-profit')), 431),
      [text('d-rev'), text('d-exp'), text('d-profit')].join(' / '));

    // ── quarter: TODAY's fiscal quarter (Q3, Jul–Sep) even after browsing the Month view to June (L9) ──
    window.setPeriod(d.getElementById('pQ'), 'quarter');
    await settle(30, 100);
    const miQ = window._periodIntentIdx('quarter');
    const repQ = await getJ('/api/reports?period=quarter&monthIdx=' + miQ + '&fyStart=0');
    A('server quarter (client intent = today\'s Q3): 0 / 0 / 0', miQ === 6 && near(repQ.revenue, 0) && near(repQ.expenses, 0) && near(repQ.netProfit, 0), 'monthIdx=' + miQ + ' ' + JSON.stringify({ r: repQ.revenue, e: repQ.expenses, n: repQ.netProfit }));
    A('dashboard quarter == server quarter', near(money(text('d-rev')), repQ.revenue) && near(money(text('d-exp')), repQ.expenses) && near(money(text('d-profit')), repQ.netProfit),
      [text('d-rev'), text('d-exp'), text('d-profit')].join(' / ') + ' vs server ' + [repQ.revenue, repQ.expenses, repQ.netProfit].join(' / '));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (full-leg parity)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
