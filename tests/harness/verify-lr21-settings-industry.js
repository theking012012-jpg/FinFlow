'use strict';
/**
 * verify-lr21-settings-industry.js — LR21: Settings shows the industry onboarding stored, and saving keeps it.
 *  Settings' Industry list was a separate, shorter copy of onboarding's (no Construction, Food & Beverage, Real Estate,
 *  Media & Creative). A select set to a value it does not list goes BLANK — and the next Settings save sent that blank
 *  as the industry, overwriting what onboarding stored. Now the lists are the same, and any stored value a select does
 *  not list is added as an option (setField), never dropped — the class, not just this list.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Stored: industry "Media & Creative", fiscal year "March"
 * (a value the Fiscal-year select does not list — the same class).
 *   Settings shows "Media & Creative"                          (old: "" — measured)
 *   Save Settings → stored industry still "Media & Creative"   (old: overwritten with "")
 *   Fiscal year "March" shown and kept                          (old: shown blank)
 *   GET /api/settings when the Settings page opens: 0 (measured — the live "5×" did not reproduce) [GUARD]
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr21-settings-industry.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR21 — Settings keeps the stored industry (and any select value it does not list)\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR21 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('PUT', '/api/settings', { industry: 'Media & Creative', fiscal_year: 'March' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const before = (await (await w.fetch('/api/settings', { credentials: 'include' })).json());
    eq('[GUARD] seed stored', [before.industry, before.fiscal_year], ['Media & Creative', 'March'], undefined);

    let gets = 0; const of = w.fetch; w.fetch = function (u, o) { if (/\/api\/settings(\?|$)/.test(String(u)) && !(o && o.method && o.method !== 'GET')) gets++; return of.apply(this, arguments); };
    w.showPage('settings');
    await settle(40, 50);
    w.fetch = of;
    eq('[GUARD] opening Settings fires no extra GET /api/settings', gets, 0, undefined);
    eq('Settings shows the stored industry and fiscal year', [d.getElementById('s-industry').value, d.getElementById('s-fy').value], ['Media & Creative', 'March'], ['', '']);

    await w.saveSettings();
    await settle(30, 40);
    const after = (await (await w.fetch('/api/settings', { credentials: 'include' })).json());
    eq('saving Settings keeps them', [after.industry, after.fiscal_year], ['Media & Creative', 'March'], ['', '']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
