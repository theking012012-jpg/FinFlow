'use strict';
/**
 * verify-lc3d-security-activity-ui.js — LC3d, the person-facing half: Settings → "Recent security activity" lists the
 * account's own security events — including a failed sign-in attempt made against it from elsewhere — with the IP and
 * a readable device. Real SPA (index.html + bundle + finflow-owner-mfa.js) + real scratch Postgres; the failed attempt
 * goes through the real login route from a different IP and browser.
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lc3d-security-activity-ui.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLC3d — Settings shows the account\'s recent security activity\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status); return r.json; };
      const e = await J('POST', '/api/entities', { name: 'Sec UI Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      const attacker = new HarnessHttp(http.baseUrl, { xff: '198.51.100.66', ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' });
      await attacker.post('/api/auth/login', { email: 'seed@finflow.test', password: 'not-the-password' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(60, 60);
    try { w.showPage('settings'); } catch (_) {}
    await settle(20, 60);
    if (typeof w.loadSecurityActivity === 'function') { await w.loadSecurityActivity(); await settle(5, 30); }
    const rows = Array.from(d.querySelectorAll('#security-activity-list .sec-act-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim());
    eq('Settings has a "Recent security activity" list', !!d.getElementById('security-activity-list'), true, false);
    const failed = rows.find(r => /Failed sign-in/.test(r));
    eq('…showing the failed attempt on this account: reason, device, IP', failed ? [/wrong password/.test(failed), /Firefox on Linux/.test(failed), /198\.51\.100\.66/.test(failed)] : null, [true, true, true], null);
    eq('…and this session\'s own sign-in', rows.some(r => /^Signed in/.test(r)), true, false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
