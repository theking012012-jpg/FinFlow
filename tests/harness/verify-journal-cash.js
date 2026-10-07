'use strict';
/**
 * verify-journal-cash.js — Phase 1.1 / L6 (cash leg) + L15. A posted manual journal that debits or credits a
 * CASH account (template 1010 Checking / 1020 Savings → ledger J1010 / J1020) moves the business's cash. N20
 * posts it to J-namespaced ledger accounts, and every cash reader looked only at the system Cash account
 * 1000, so the journal's cash leg reached NO cash figure:
 *   balance sheet Cash (glBalanceSheet bal['1000']) · Balance Sheet report Cash line · 13-week forecast
 *   "Cash now" (reads glBalanceSheet) · Cash Flow report / page (POST /api/reports/cash-flow, built from tables)
 * The Balance Sheet report's Total Assets still included J1010 (it sums every asset), so its lines did not
 * add up to its total (L15: Cash −200 + AR 635 = 435 vs Total Assets 453).
 *
 * Seed: fullLegScenario. Hand-computed cash (Rule 6):
 *   in  = invoice payment 60 + sales receipt 20 + JE Dr Checking 30          = 110   (bug: 80)
 *   out = expense 8 + payments made 15 + 7 + paid payroll 250 + JE Cr Checking 12 = 292 (bug: 280)
 *   net = −182 (bug: −200); Total Assets 453 = Cash −182 + AR 635
 *   Posted→Draft on the income JE reverses its +30 ⇒ cash −212 on every cash surface.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-journal-cash.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { postFullLegScenario } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L6/L15 — a manual journal\'s cash leg moves every cash figure\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: postFullLegScenario });
    const { http } = ctx;
    const P = async p => JSON.parse((await http.post(p, {})).text);
    const G = async p => JSON.parse((await http.get(p)).text);

    const check = async (tag, cash, cin, cout) => {
      const bs = await P('/api/reports/balance-sheet');
      A(`${tag}: balance sheet Cash == ${cash}`, bs.source === 'gl' && near(bs.cash, cash), JSON.stringify(bs));
      A(`${tag}: Total Assets == Cash + AR (lines add up)`, near(bs.totalAssets, bs.cash + bs.accountsReceivable + (bs.inventory || 0)), JSON.stringify(bs));
      const cf = await P('/api/reports/cash-flow?period=year&fyStart=0');
      A(`${tag}: cash-flow report in ${cin} / out ${cout}`, near(cf.totalInflow, cin) && near(cf.totalOutflow, cout), 'in=' + cf.totalInflow + ' out=' + cf.totalOutflow);
      A(`${tag}: cash-flow net == balance-sheet Cash (${cash})`, near(cf.totalInflow - cf.totalOutflow, bs.cash), 'cf net=' + (cf.totalInflow - cf.totalOutflow) + ' bs cash=' + bs.cash);
      const fc = await G('/api/cashflow-forecast');
      A(`${tag}: 13-week forecast starting cash == ${cash}`, near(fc.summary && fc.summary.starting_cash, cash), 'starting_cash=' + (fc.summary && fc.summary.starting_cash));
    };
    await check('posted', -182, 110, 292);

    // Posted → Draft on the income JE (+30 to Checking) — the GL reversal must take the cash out again.
    const js = await G('/api/journals');
    const inc = (Array.isArray(js) ? js : []).find(j => j.description === 'Income adjustment');
    const put = await http.put('/api/journals/' + inc.id, { status: 'Draft' });
    A('income JE flipped to Draft (2xx)', put.status >= 200 && put.status < 300, 'status=' + put.status + ' ' + String(put.text).slice(0, 120));
    await check('after Draft', -212, 80, 292);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (journal cash)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
