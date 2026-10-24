'use strict';
/**
 * verify-fam13-currency-labels.js — FA-M13 (full app audit M13: Island Traders' payroll form says "Monthly gross (USD)"
 * on a TTD business). Rule 13 enumeration found the class: 20 form money labels hard-coded "(USD)" / "($)" in
 * index.html plus 3 built at runtime (time-entry rate, project budget, journal debit / credit) — every business form
 * said dollars whatever the business's currency. And the savings-goal form (Personal) took its amounts AS USD while the
 * goals are SHOWN in the personal display currency: with TTD selected, typing 1,000 stored US$1,000.
 * After: one writer (_ffApplyCurrencyLabels) labels every business form with the business's currency CODE (USD, TTD,
 * JMD and CAD all write "$", so the code is the unambiguous label) on each load / switch / modal open; goal labels say
 * the personal currency, and a goal typed in it is converted to the USD it is stored in.
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed; the business is in TTD.
 *   EXPECTED: invoice / bill / expense / payroll / journal / item labels read "(TTD)" (bug: "($)" / "(USD)")
 *             time-entry "Rate (TTD/hr)", project "Budget (TTD)" (bug: "$")
 *             personal currency EUR → goal labels "(EUR)"; target typed 110 EUR → stored 110 ÷ rate(EUR) USD (bug: 110)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam13-currency-labels.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({
      baseSeed: false,
      seedExtra: async (c, uid) => {
        await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { name: 'Island Traders', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT', is_active: 1 }]);
      },
    });
    const { window, http, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.openModal !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(20, 100);
    const lbl = id => ((d.querySelector('label[for="' + id + '"]') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const ids = ['inv-amount', 'bill-amount', 'bexp-amount', 'emp-gross', 'payroll-cta-gross', 'item-price', 'quote-amount', 'cn-amount', 'vc-amount', 'pm-amount', 'receipt-amount', 's-budget'];
    try { window.openModal('invoice-modal'); window.closeModal && window.closeModal('invoice-modal'); } catch (_) {}
    const got = ids.map(id => [id, lbl(id)]);
    const bad = got.filter(([, t]) => !/\(TTD\)/.test(t));
    A('1  business form labels read "(TTD)" — invoice, bill, expense, payroll, item, quote, credits, payments, budget (bug: "($)" / "(USD)")', bad.length === 0, JSON.stringify(bad));
    const head = ((d.querySelector('#journal-modal') || d.body).textContent || '');
    A('2  the journal grid says Debit (TTD) / Credit (TTD)', /Debit \(TTD\)/.test(d.body.textContent) && /Credit \(TTD\)/.test(d.body.textContent), '');
    void head;
    try { window.openLogTimeModal(); } catch (e) { A('openLogTimeModal ran', false, e.message); }
    await settle(3, 30);
    const tsRate = [...d.querySelectorAll('label')].map(l => l.textContent.replace(/\s+/g, ' ')).find(t => /^Rate \(/.test(t)) || '';
    A('3  time entry "Rate (TTD/hr)" (bug: "Rate ($/hr)")', tsRate === 'Rate (TTD/hr)', tsRate);
    try { (window.openNewProjectModal || window.openProjectModal || (() => {}))(); } catch (_) {}
    await settle(3, 30);
    const pb = [...d.querySelectorAll('label')].map(l => l.textContent.replace(/\s+/g, ' ')).find(t => /^Budget \(/.test(t)) || '';
    A('4  project "Budget (TTD)" (bug: "Budget ($)")', pb === 'Budget (TTD)', pb);

    // Personal goals: the personal display currency, converted to the USD they are stored in
    try { window.setPersCurrency('EUR'); } catch (e) { A('setPersCurrency ran', false, e.message); }
    await settle(3, 30);
    A('5  goal labels read "(EUR)" once the personal currency is EUR', /\(EUR\)/.test(lbl('goal-target')) && /\(EUR\)/.test(lbl('goal-current')), lbl('goal-target'));
    const rate = Number(((window.CURRENCIES || {}).EUR || {}).rate);
    try { window.openGoalModal(); } catch (_) {}
    d.getElementById('goal-name').value = 'Emergency fund';
    d.getElementById('goal-current').value = '';
    d.getElementById('goal-target').value = '110';
    d.getElementById('goal-monthly').value = '';
    try { await window.saveGoal(); } catch (e) { A('saveGoal ran', false, e.message); }
    await settle(6, 50);
    const gs = (await http.get('/api/goals')).json || [];
    const g = (Array.isArray(gs) ? gs : []).find(x => x.name === 'Emergency fund') || {};
    const want = Math.round((110 / rate) * 100) / 100;
    A('6  a target typed as 110 EUR is stored as ' + want + ' USD (110 ÷ ' + rate + ') (bug: 110)', Math.abs(Number(g.target_val) - want) < 0.011, 'stored ' + g.target_val);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M13 currency labels)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
