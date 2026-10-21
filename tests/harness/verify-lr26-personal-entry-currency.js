'use strict';
/**
 * verify-lr26-personal-entry-currency.js — LR26: a personal money field is entered in the currency it shows.
 *  Goal amounts and the personal monthly budget were labelled "($)", READ as USD, and shown converted into the personal
 *  display currency — so on a TT$ personal view a goal typed as 3,390 showed as ~TT$23K, and a budget typed as 678 as
 *  ~TT$4.6K. Now each label names the personal display currency, a goal stores the currency it was entered in, and the
 *  budget is compared in one currency. A goal saved before this has no currency: it was entered in USD and is still
 *  read as USD (no data change — Rule 8).
 *
 * Real scratch Postgres, real server, real SPA (bundle). Personal display currency TTD (the page's own switch).
 *   goal modal labels: "Current (TT$)" · "Target (TT$)" · "Monthly contribution (TT$)"        (old: "($)" — measured)
 *   new goal typed current 500 / target 3,390 → stored {currency:"TTD"}, shown TT$500 / TT$3.4K  (old: × the rate)
 *   [GUARD] a goal saved without a currency (USD 100 / 1,000) still shows converted from USD
 *   Settings "Monthly budget (TT$)"; typed 678 → the personal budget card shows TT$678          (old: × the rate)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr26-personal-entry-currency.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR26 — personal money fields: entered in the currency they show\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await J('POST', '/api/goals', { name: 'Old goal', current_val: 100, target_val: 1000, monthly_contrib: 0 });   // saved before goals had a currency
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('personal'); await settle(30, 40);
    w.setPersCurrency('TTD'); await settle(20, 30);
    const rate = (w.CURRENCIES.TTD || {}).rate;
    const fm = (n) => w._fmtMoney(n, 'TT$');

    w.openGoalModal(); await settle(5, 10);
    const lab = id => (d.querySelector(`label[for="${id}"]`) || {}).textContent.trim();
    eq('goal labels name the personal currency', [lab('goal-current'), lab('goal-target'), lab('goal-monthly')],
      ['Current (TT$)', 'Target (TT$)', 'Monthly contribution (TT$)'], ['Current ($)', 'Target ($)', 'Monthly contribution ($)']);
    d.getElementById('goal-name').value = 'New car';
    d.getElementById('goal-current').value = '500';
    d.getElementById('goal-target').value = '3390';
    d.getElementById('goal-monthly').value = '100';
    await w.saveGoal(); await settle(30, 40);

    const rows = await (await w.fetch('/api/goals', { credentials: 'include' })).json();
    const g = rows.find(r => r.name === 'New car');
    eq('the new goal stores what was typed, in the currency it was typed in', g ? [Number(g.target_val), g.currency] : null, [3390, 'TTD'], [3390, null]);
    const goalTxt = name => { const g = Array.from(d.querySelectorAll('.goal')).find(x => (x.querySelector('.goal-name') || {}).textContent === name); return g ? g.querySelector('.goal-val').textContent.trim() : null; };
    eq('the new goal shows what was typed', goalTxt('New car'), fm(500) + ' / ' + fm(3390), fm(500 * rate) + ' / ' + fm(3390 * rate));
    eq('[GUARD] a goal saved without a currency is read as USD (as entered)', goalTxt('Old goal'), fm(100 * rate) + ' / ' + fm(1000 * rate), undefined);

    eq('Settings budget label names the personal currency', lab('s-budget'), 'Monthly budget (TT$)', 'Monthly budget ($)');
    d.getElementById('s-budget').value = '678';
    w.renderPersonal(); await settle(10, 20);
    const bva = ((d.getElementById('budget-vs-actual-list') || {}).textContent || '').replace(/\s+/g, ' ');
    eq('the personal budget card shows the budget as typed', (bva.match(/Monthly budget\s*(\S+)/) || [])[1] || null, fm(678), fm(678 * rate));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
