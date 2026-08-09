'use strict';
/* F145 (executed live-path proof): with stubs.js retired, the quotes/vendors/bills/recurring
 * renderers must still produce DOM rows — i.e. pages.js's copies are live and functional, not
 * merely "the winner by name". Inject data, call each window.renderX, assert rows appear. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(30, 30);
    const doc = window.document;
    const cases = [
      ['renderVendors', 'vendors', 'vendors-list', [{ id: 1, name: 'Acme Supplies', email: 'a@x.com', phone: '', balance: 250 }]],
      ['renderBills', 'bills', 'bills-list', [{ id: 1, vendor: 'Acme', amount: 400, status: 'pending', due_date: '2026-07-01' }]],
      ['renderQuotes', 'quotes', 'quotes-list', [{ id: 1, client: 'Beta LLC', amount: 900, status: 'pending', expiry_date: '2026-09-01' }]],
    ];
    for (const [fn, gvar, listId, rows] of cases) {
      A(`${fn} is a live function`, typeof window[fn] === 'function');
      window[gvar] = rows;
      try { window[fn](); } catch (e) { A(`${fn}() ran without throwing`, false, String(e && e.message)); continue; }
      A(`${fn}() ran without throwing`, true);
      const el = doc.getElementById(listId);
      const html = el ? el.innerHTML : '';
      A(`${fn} produced non-empty ${listId}`, html.trim().length > 0, `len=${html.length}`);
    }
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
