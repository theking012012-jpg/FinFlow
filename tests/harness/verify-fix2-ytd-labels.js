'use strict';
/**
 * verify-fix2-ytd-labels.js — FIX-2 / LC2 (owner decision 2026-10-20: relabel to "Year to date").
 *
 * Every "Year" figure — server (computeBooks inPeriod, glFinancials, the monthly buckets) and client (_periodWindow
 * inWin) alike — counts only what is dated UP TO TODAY (the D2 rule): a November payroll run, viewed in October, adds
 * $0. The figures were captioned as if they were the whole year: "Full year total", "Full Year · January – December",
 * "Fiscal Year · Jan 2026 – Dec 2026", "Full year revenue", "this fiscal year", and on the accountant portal
 * "Full year overview" / "Full year". The numbers are right (the same rule everywhere, as Xero's P&L also stops at
 * today); the words were not. Fix: every label of the D2-capped year says "to date" and names the months it covers.
 *
 * Real SPA (bundle) + real scratch Postgres. The harness clock is 2026-07-25 and the fiscal year starts in January, so
 * the year to date is Jan 2026 – Jul 2026 (hand-derived). Values are READ FROM THE RENDERED PAGE (executed), except the
 * accountant-portal labels, which need an accountant session — those two are STRUCTURAL (labelled, Rule 5).
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-fix2-ytd-labels.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nFIX-2 — the "Year" figures are labelled "year to date" (they count what is dated up to today)\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('POST', '/api/invoices', { client: 'Acme', amount: 1200, status: 'pending', issue_date: '2026-03-10', due_date: '2026-04-10', idempotency_key: 'fix2-i' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    try { w.showPage('dashboard'); } catch (_) {}
    await settle(20, 50);
    const txt = id => { const el = d.getElementById(id); return el ? el.textContent.trim() : null; };

    eq('header period label', txt('period-label'), 'Year to date · Jan 2026 – Jul 2026', 'Full Year · Jan 2026 – Dec 2026');
    eq('dashboard chart title', txt('d-chart-title'), 'Revenue vs Expenses — Year to date · Jan 2026 – Jul 2026', 'Revenue vs Expenses — Full Year · Jan 2026 – Dec 2026');
    eq('dashboard Revenue / Expenses / Net captions', [txt('d-rev-chg'), txt('d-exp-chg'), txt('d-profit-chg')], ['Year to date', 'Year to date', 'Year to date'], ['Full year total', 'Full year total', 'Full year total']);
    eq('the year window label (Reports, statements)', w._periodWindow('year').label, 'Year to date · Jan 2026 – Jul 2026' /* LR6 decision 2026-10-21: one wording, "Year to date" */, 'Fiscal Year · Jan 2026 – Dec 2026');

    try { w.showPage('ai'); } catch (_) {}
    await settle(20, 50);
    if (typeof w.updateAI === 'function') { try { w.updateAI(); } catch (_) {} }
    const ins = (d.getElementById('ai-insights-list') || {}).textContent || '';
    eq('AI insight names the year to date', [/Year-to-date revenue/.test(ins), /Full year revenue/.test(ins)], [true, false], [false, true]);

    try { w.showPage('reports'); } catch (_) {}
    await settle(30, 60);
    const rc = Array.from(d.querySelectorAll('#page-reports .mc-change')).map(x => x.textContent.trim()).find(t => /^Revenue issued/.test(t)) || null;
    eq('Reports revenue caption', rc, 'Revenue issued, this fiscal year to date', 'Revenue issued, this fiscal year');

    // STRUCTURAL (labelled): the accountant portal's own captions — it reads the same D2-capped computeBooks year.
    const acct = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'accountant-client.html'), 'utf8');
    eq('STRUCTURAL accountant portal subtitle', /id="dash-subtitle">Year to date overview</.test(acct), true, false);
    eq('STRUCTURAL accountant portal period caption (year)', /year:'Year to date'/.test(acct) && !/year:'Full year'/.test(acct), true, false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
