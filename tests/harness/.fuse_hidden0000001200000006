'use strict';
/* F145 (read-only, runtime oracle per Rule 1): for every window.X that stubs.js assigns,
 * boot the real SPA and ask which source file the RUNTIME winner came from. We decide by
 * substring-matching window.X.toString() against each wiring file's text. If the live body
 * is found in pages.js (and NOT uniquely in stubs.js), stubs' copy is a dead shadow — safe
 * to delete. If it's found only in stubs.js, stubs WINS and must be kept. No edits, no writes. */
const fs = require('fs');
const path = require('path');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

const pub = path.join(__dirname, '..', '..', 'public');
const stubs = fs.readFileSync(path.join(pub, 'finflow-api-wiring-stubs.js'), 'utf8');
const pages = fs.readFileSync(path.join(pub, 'finflow-api-wiring-pages.js'), 'utf8');
const extra = fs.readFileSync(path.join(pub, 'finflow-api-wiring-extra.js'), 'utf8');
const postgres = fs.readFileSync(path.join(pub, 'finflow-api-wiring-postgres.js'), 'utf8');

// every window.X stubs.js assigns
const names = [
  'renderQuotes', 'openNewQuoteModal', 'editQuote', 'saveQuote',
  'renderVendors', 'filterVendorsBySearch', 'openNewVendorModal', 'editVendor', 'saveVendor',
  'renderBills', 'markBillPaid', 'openNewBillModal', 'editBill', 'saveBill',
  'renderRecurringBills', 'openNewRecurringBillModal', 'editRecurringBill', 'saveRecurringBill',
  'renderRecurring', 'openNewRecurringModal', 'editRecurringInvoice', 'saveRecurringInvoice',
  'showPage',
];

function normalize(s) { return s.replace(/\r\n/g, '\n'); }

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(40, 40);
    const S = normalize(stubs), P = normalize(pages), E = normalize(extra), G = normalize(postgres);
    let dead = 0, live = 0, absent = 0;
    console.log('name'.padEnd(28) + 'runtime winner source');
    console.log('-'.repeat(60));
    for (const n of names) {
      const fn = window[n];
      if (typeof fn !== 'function') { console.log('  ' + n.padEnd(26) + 'ABSENT (not a function at runtime)'); absent++; continue; }
      const body = normalize(fn.toString());
      const inStubs = S.includes(body);
      const inPages = P.includes(body);
      const inExtra = E.includes(body);
      const inPg = G.includes(body);
      const where = [inStubs && 'stubs', inPages && 'pages', inExtra && 'extra', inPg && 'postgres'].filter(Boolean).join('+') || 'unknown';
      let verdict;
      if (inStubs && !inPages && !inExtra && !inPg) { verdict = '*** STUBS WINS — LIVE, KEEP ***'; live++; }
      else if (!inStubs && (inPages || inExtra || inPg)) { verdict = 'dead shadow (winner=' + where + ')'; dead++; }
      else if (inStubs && (inPages || inExtra || inPg)) { verdict = 'AMBIGUOUS (identical text in ' + where + ') — inspect'; }
      else { verdict = 'winner text not in any wiring file (' + where + ') — inspect'; }
      console.log('  ' + n.padEnd(26) + verdict);
    }
    console.log('-'.repeat(60));
    console.log(`DEAD(stubs shadowed)=${dead}  LIVE(stubs wins)=${live}  ABSENT=${absent}`);
    console.log(live === 0 ? '\n=> stubs.js wins NOTHING at runtime: whole file is dead-shadow, deletable.' :
      `\n=> stubs.js still wins ${live} function(s) — those MUST be preserved.`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); process.exitCode = 1; }
  finally { try { if (boot) await boot.stop(); } catch {} }
})();
