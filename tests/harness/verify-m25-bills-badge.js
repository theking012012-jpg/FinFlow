'use strict';
/**
 * M25 (client half): the Bills nav badge counts bills PAST DUE with a balance — the same rule as the page's
 * Overdue card. BUG: it counted the literal statuses 'overdue' / 'due_soon', which nothing sets, so it read 0
 * while the Overdue card showed 400.
 * Seed (today pinned 2026-07-25): unpaid 400 due 2026-07-01 (past) · unpaid 90 due 2026-08-15 (not due) ·
 *   paid 50 due 2026-06-01 (no balance). Correct badge 1 · bug 0.
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };

async function seed({ http }) {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text.slice(0, 200)); return JSON.parse(r.text); };
  const ent = await J('POST', '/api/entities', { name: 'Badge Co', currency: 'USD', timezone: 'UTC', country: 'US' });
  await J('POST', '/api/entities/' + ent.id + '/activate', {});
  await J('POST', '/api/bills', { vendor: 'Late Co', amount: 400, status: 'unpaid', issue_date: '2026-06-10', due_date: '2026-07-01', idempotency_key: 'm25b-1' });
  await J('POST', '/api/bills', { vendor: 'Soon Co', amount: 90, status: 'unpaid', issue_date: '2026-07-10', due_date: '2026-08-15', idempotency_key: 'm25b-2' });
  const b3 = await J('POST', '/api/bills', { vendor: 'Paid Co', amount: 50, status: 'unpaid', issue_date: '2026-05-10', due_date: '2026-06-01', idempotency_key: 'm25b-3' });
  await J('POST', '/api/payments-made', { vendor: 'Paid Co', amount: 50, date: '2026-05-20', bill_id: b3.id, idempotency_key: 'm25b-3p' });
}

(async () => {
  let ctx;
  try {
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window, settle } = ctx;
    await settle(60, 100);
    window.showPage('bills'); await settle(20, 100);
    const badge = window.document.getElementById('badge-bills');
    const n = badge ? parseInt(badge.textContent, 10) : NaN;
    A('Bills badge = 1 (the one past-due bill with a balance; bug: 0)', n === 1, 'badge=' + (badge && badge.textContent));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (ctx && ctx.stop) await ctx.stop(); } catch {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (M25 bills badge)\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
