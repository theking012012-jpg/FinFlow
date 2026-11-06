'use strict';
/**
 * verify-f30b-role-grid — F30: the Settings page's role grid is drawn from the server's enforced table (rbac.js via
 * GET /api/permissions), read-only. Executed: the real /app in jsdom (real server + scratch Postgres). Bug values (old
 * code): the page's own 9-row copy — "Manage expenses (add, edit, delete)" ticked for accountants, "API access" owner only.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f30b-role-grid.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
(async () => {
  let h;
  console.log('\nF30b — the role grid on the page is the enforced table\n');
  try {
    h = await bootSpaInJsdom({}); await h.idle();
    await h.window.renderTeam(); await h.settle(10, 50);
    const d = h.window.document;
    const rows = [...d.querySelectorAll('#perm-list .perm-row')].map(r => [r.querySelector('.perm-label').textContent, [...r.querySelectorAll('input')].map(i => (i.checked ? 1 : 0))]);
    const row = (l) => (rows.find(r => r[0] === l) || [])[1];
    A('10 rows, from the server (bug: the page\'s own 9)', rows.length === 10, JSON.stringify(rows));
    A('"Delete records": owner + admin only (bug: accountants ticked for deleting expenses)', JSON.stringify(row('Delete records')) === '[1,1,0,0]', JSON.stringify(row('Delete records')));
    A('"Settings and API keys": owner + admin (bug: API access owner only)', JSON.stringify(row('Settings and API keys')) === '[1,1,0,0]', JSON.stringify(row('Settings and API keys')));
    A('every box is read-only and named', [...d.querySelectorAll('#perm-list input')].every(i => i.disabled && (i.getAttribute('aria-label') || '').length > 0));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (h) { try { await h.stop(); } catch (_) {} } }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F30b role grid)\n`);
  process.exitCode = fail ? 1 : 0;
})();
