'use strict';
/* F94 (executed): future-dated docs are excluded from figures by D2 but must be VISIBLY marked
 * "Scheduled" so they don't read as lost. Proves window._isScheduled's calendar logic (tz-free) and
 * that the live renderInvoices (runtime winner, medium.js) badges a future-dated row and NOT a
 * past-dated one — the discriminator. Clock is pinned by the harness; use dates around it. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(25, 25);
    const doc = window.document;
    const today = window.FinFlowDates.resolvedToday(new Date());

    A('window._isScheduled is defined', typeof window._isScheduled === 'function');
    A('future date is scheduled', window._isScheduled('2999-01-01') === true);
    A('past date is NOT scheduled', window._isScheduled('2000-01-01') === false);
    A('today is NOT scheduled (boundary — recognised the day it arrives)', window._isScheduled(today) === false);

    // Drive the live invoice renderer with one future + one past invoice.
    window.userInvoices = [
      { client: 'FutureCo', amount: 1000, status: 'pending', due: '—', color: 'var(--t2)', issue_date: '2999-01-01' },
      { client: 'PastCo',   amount: 500,  status: 'pending', due: '—', color: 'var(--t2)', issue_date: '2000-01-01' },
    ];
    A('window.renderInvoices is the runtime renderer', typeof window.renderInvoices === 'function');
    window.renderInvoices();
    const html = (doc.getElementById('invoice-list') || {}).innerHTML || '';
    const schedCount = (html.match(/>Scheduled</g) || []).length;
    A('exactly ONE "Scheduled" badge (the future invoice only)', schedCount === 1, `count=${schedCount}`);
    // the future row (FutureCo) is the one carrying it
    const futureRowHasBadge = /FutureCo[\s\S]*?Scheduled|Scheduled[\s\S]*?FutureCo/.test(html);
    A('the Scheduled badge is on the future-dated row', futureRowHasBadge);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
