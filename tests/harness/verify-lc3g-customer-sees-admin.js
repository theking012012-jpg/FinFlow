'use strict';
/**
 * verify-lc3g-customer-sees-admin.js — LC3g, the customer-facing half. When FinFlow support changes a customer's
 * account (plan, suspension, deletion) the change lands on the customer's own audit trail with actor 'admin'; the
 * Audit page must SAY it was FinFlow support — a bare "UPDATE plan trial → business" reads as if the customer did it.
 * Real SPA (bundle) + real scratch Postgres; the admin row is written by the real admin route.
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lc3g-customer-sees-admin.js
 */
require('./clock.js');
process.env.ADMIN_PASSWORD = 'harness-admin-password-not-a-secret';
delete process.env.ADMIN_TOTP_SECRET;
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLC3g — a customer sees which changes FinFlow support made to their account\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"trial"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Seen Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      const admin = new HarnessHttp(http.baseUrl, { xff: '198.51.100.8' });
      if ((await admin.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status !== 200) throw new Error('admin login');
      const r = await admin.request('POST', '/api/admin/users/' + userId + '/plan', { plan: 'business' });
      if (r.status >= 300) throw new Error('plan ' + r.status);
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(60, 60);
    try { w.showPage('audit'); } catch (_) {}
    await settle(10, 40);
    d.getElementById('audit-filter-table').value = Array.from(d.getElementById('audit-filter-table').options).find(o => o.value.split(',').includes('users')).value;
    await w.loadAuditTrail(); await settle(5, 30);
    const rows = Array.from(d.querySelectorAll('#audit-trail-body tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())).filter(r => r.length > 1);
    const plan = rows.find(r => r[4] === 'plan');
    eq('the plan change is listed: trial → business', plan ? [plan[5], plan[6]] : null, ['trial', 'business'], null);
    eq('…marked as made by FinFlow support', plan ? /FinFlow support/.test(plan[3]) : null, true, false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
