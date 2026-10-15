'use strict';
/**
 * verify-la21-reporting-currency.js — LA21 (found during LA19; owner decision 2026-10-15: "I choose in Settings").
 *
 * The "All entities" figures are reported in ONE currency. Before: users.data.base_currency (which nothing ever wrote),
 * else the FIRST row of allByUser('entities') — created_at DESC, i.e. the NEWEST business — so adding a business silently
 * changed the currency of every consolidated figure; and the owner's own "All entities" view started from a hardcoded
 * 'USD' regardless. After: one server resolver — the reporting currency the owner chose in Settings, else the OLDEST
 * business's currency, else USD — and the SPA's consolidation view starts in that same currency.
 *
 * Real SPA + real scratch Postgres, seeded through the real routes. Rule 4 seed: the OLDEST business is USD, the NEWEST
 * is TTD, so "oldest" and "newest" give different currencies AND different numbers.
 *   Dollar Co (USD, created first) invoice 1,000 · Island Co (TTD, created second) invoice 6,800 · rate 1 USD = 6.8 TTD
 *   nothing chosen   → All entities in USD: 1,000 + 6,800 / 6.8 = 2,000        bug: TTD, 6,800 + 1,000 × 6.8 = 13,600
 *   chosen TTD       → All entities in TTD: 13,600                              bug: setting not saved → USD/TTD by accident
 *   invalid "XX"     → 400, nothing saved
 *   cleared          → back to the oldest business (USD, 2,000)
 *   SPA              → Settings shows the choice; the All-entities view starts in it (bug: hardcoded USD);
 *                      changing the Settings dropdown saves it
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la21-reporting-currency.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const r2 = n => Math.round((+n || 0) * 100) / 100;

(async () => {
  let boot;
  console.log('\nLA21 — "All entities" figures use the reporting currency chosen in Settings (default: the oldest business)\n');
  try {
    let J;
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      J = async (m, p, b) => { const r = await http.request(m, p, b); return { status: r.status, json: r.json, text: r.text }; };
      const ok = async (m, p, b) => { const r = await J(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const us = await ok('POST', '/api/entities', { name: 'Dollar Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await ok('POST', '/api/entities/' + us.id + '/activate', {});
      await ok('POST', '/api/invoices', { client: 'US Cust', amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01', idempotency_key: 'la21-us' });
      // Created strictly later (created_at), so "newest" is unambiguous.
      await client.query(`UPDATE entities SET created_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [us.id]);
      const tt = await ok('POST', '/api/entities', { name: 'Island Co', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await ok('POST', '/api/entities/' + tt.id + '/activate', {});
      await ok('POST', '/api/invoices', { client: 'TT Cust', amount: 6800, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01', idempotency_key: 'la21-tt' });
      await ok('POST', '/api/fx-rates', { from_currency: 'USD', to_currency: 'TTD', rate: 6.8, rate_date: '2026-01-01' });
      await ok('POST', '/api/entities/' + us.id + '/activate', {});

      const all = async () => { const r = (await J('GET', '/api/reports?entity_id=all')).json || {}; return [r.fxCoverage && r.fxCoverage.display, r2(r.revenue)]; };
      const st = async () => { const s = (await J('GET', '/api/settings')).json || {}; return [s.reporting_currency === undefined ? 'absent' : s.reporting_currency, s.reporting_currency_effective === undefined ? 'absent' : s.reporting_currency_effective]; };

      eq('nothing chosen: settings report no choice, effective = oldest business (USD)', await st(), [null, 'USD'], ['absent', 'absent']);
      eq('nothing chosen: All entities in USD = 1,000 + 6,800 / 6.8', await all(), ['USD', 2000], ['TTD', 13600]);

      const bad = await J('PUT', '/api/settings', { reporting_currency: 'XX' });
      eq('invalid reporting currency "XX" is refused', bad.status, 400, 200);

      eq('choose TTD: saved', (await J('PUT', '/api/settings', { reporting_currency: 'TTD' })).status, 200);
      eq('choose TTD: settings', await st(), ['TTD', 'TTD'], ['absent', 'absent']);
      eq('choose TTD: All entities in TTD = 6,800 + 1,000 × 6.8', await all(), ['TTD', 13600]);
      const audit = (await client.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE user_id = $1 AND table_name = 'settings' AND new_data::text LIKE '%reporting_currency%'`, [userId])).rows[0].n;
      eq('the change is in the audit trail', audit >= 1, true, false);

      eq('clear the choice: back to the oldest business', (await J('PUT', '/api/settings', { reporting_currency: null })).status, 200);
      eq('cleared: settings', await st(), [null, 'USD']);
      eq('cleared: All entities in USD again', await all(), ['USD', 2000]);

      await ok('PUT', '/api/settings', { reporting_currency: 'TTD' });   // the SPA below loads with TTD chosen
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const sel = () => d.getElementById('s-reporting-currency');
    eq('SPA: Settings has a reporting-currency dropdown showing the choice (TTD)', sel() ? sel().value : null, 'TTD', null);
    eq('SPA: the All-entities view starts in the reporting currency', w.consolCurrency, 'TTD', 'USD');

    if (sel()) {
      sel().value = 'GBP'; sel().dispatchEvent(new w.Event('change'));
      await settle(20, 50);
      const s = await (await w.fetch('/api/settings', { credentials: 'include' })).json();
      eq('SPA: changing the dropdown saves it (GBP)', [s.reporting_currency, w.consolCurrency], ['GBP', 'GBP']);
      sel().value = ''; sel().dispatchEvent(new w.Event('change'));
      await settle(20, 50);
      const s2 = await (await w.fetch('/api/settings', { credentials: 'include' })).json();
      eq('SPA: choosing the default option clears it (oldest business, USD)', [s2.reporting_currency, s2.reporting_currency_effective, w.consolCurrency], [null, 'USD', 'USD']);
    }
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
