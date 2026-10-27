'use strict';
/**
 * Decision 3.3 (2026-10-21: option B — ask once). With businesses in different currencies and no reporting currency
 * chosen, "All entities" silently used the OLDEST business's currency. Now, the first time the Entities page opens in that
 * state, a one-question picker asks; either answer SAVES the setting (pick one, or keep the default explicitly), so it is
 * never asked again — on any device (the setting is the account's, LA21).
 * Real SPA in jsdom → real server → scratch Postgres. Businesses: Northwind (USD, oldest) + Island Traders (TTD).
 *   1  opening Entities shows the picker, offering USD and TTD                      bug: no picker
 *   2  choosing TTD saves reporting_currency = TTD (GET /api/settings)              bug: not saved (null)
 *   3  the consolidated caption now reports in TTD
 *   4  opening Entities again → no picker (asked once)
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };
  console.log('\n3.3 — ask once for the reporting currency\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const nw = (await http.post('/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' })).json.id;
      await http.post('/api/entities', { name: 'Island Traders', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await http.post('/api/entities/' + nw + '/activate', {});
    } });
    const { window: w, settle, http } = boot; const d = w.document;
    await settle(60, 75);
    try { w.showPage('entities'); } catch (_) {}
    await settle(60, 75);
    const m = () => d.getElementById('rc-ask-modal');
    const shown = () => !!m() && !m().classList.contains('hidden');
    const opts = m() ? [...m().querySelectorAll('option')].map(o => o.value) : [];
    A('1  Entities shows the picker offering USD and TTD', shown() && opts.includes('USD') && opts.includes('TTD'), JSON.stringify({ shown: shown(), opts }));
    A('1  FA-B14: it is an inline banner on the page, not a blocking pop-up (no .modal-overlay)', !!m() && !m().classList.contains('modal-overlay') && !!m().closest('#page-entities'), m() ? m().className : 'missing');
    if (shown()) {
      m().querySelector('select').value = 'TTD';
      const btn = [...m().querySelectorAll('button')].find(b => /Use this currency/.test(b.textContent)); if (btn) btn.click();
      await settle(60, 75);
    }
    const s = (await http.get('/api/settings')).json || {};
    A('2  reporting_currency saved as TTD', s.reporting_currency === 'TTD', JSON.stringify(s.reporting_currency));
    const cap = ((d.getElementById('consol-fx-rate') || {}).textContent || '');
    A('3  consolidated caption reports in TTD', /Reported in TTD/.test(cap), JSON.stringify(cap));
    try { w.showPage('dashboard'); } catch (_) {} await settle(10, 40);
    try { w.showPage('entities'); } catch (_) {} await settle(40, 60);
    A('4  opening Entities again → no picker', !shown(), '');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
