'use strict';
/**
 * verify-lr4-payroll-empty-no-dollar.js — LR4 (live retest 2026-10-20, LA15 class): on Island Traders (TTD) the Payroll
 * page's "No payroll runs recorded" text read "…your reports currently show $0 of payroll…" — a literal "$" on a
 * business that books in TT$ (static text in index.html, never re-rendered).
 *
 * Real scratch Postgres, real server, real SPA (bundle): a TTD business with an employee and no run.
 *   the empty-state text is shown and contains no "$"      (old: contains "$0")
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr4-payroll-empty-no-dollar.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR4 — the Payroll empty state names no currency of its own\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Island LR4', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('POST', '/api/payroll', { fname: 'Jordan', lname: 'Lee', gross: 3000, deductions: [] });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('payroll');
    await settle(40, 50);
    const el = d.getElementById('payroll-empty-state');
    const txt = el ? el.textContent.replace(/\s+/g, ' ') : '';
    eq('the "No payroll runs recorded" text is present', /No payroll runs recorded/.test(txt), true);
    // A BARE "$" (not part of "TT$"). The roster line on the same card is written in the business's currency
    // ("TT$3,000/month") — correct, and must not count (the first version of this check flagged it).
    eq('…and has no bare "$" on a TTD business', (txt.match(/(?<!TT)\$\S*/g) || []), [], ['$0']);
    eq('…while the roster line is in TT$', /TT\$3,000/.test(txt), true);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
