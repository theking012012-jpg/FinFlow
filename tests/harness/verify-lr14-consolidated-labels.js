'use strict';
/**
 * LR14 (live retest A2): on Entities, the Consolidated P&L caption read "No conversion · native currencies shown" while
 * the Island Traders (TTD) column WAS converted to $ — the caption is static markup, rewritten only when a currency
 * button is clicked; every column is fetched in the report currency (default USD) and converted by the server. And the
 * "Intercompany" card is a hard-coded "$0" no code ever writes — "$0" even in the TTD view (the LA15 bare-"$" class).
 *
 * Real SPA in jsdom → real server → scratch Postgres. Account with two businesses: Northwind (USD) and Island Traders
 * (TTD), one invoice each.
 *   1  default view (report in USD, a TTD business present): caption never says "No conversion"; says USD   bug: "No conversion · native currencies shown"
 *   2  report in TTD: the Intercompany card shows no bare "$" (TT$ figure or "—")                            bug: "$0"
 *   3  report in TTD: caption names TTD and says the other business is converted
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };
  console.log('\nLR14 — consolidated labels say what is shown\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 200)}`); return r.json; };
      // Order as live: Northwind (USD) is the OLDEST business, so the effective report currency is USD and the settings
      // loader never calls setConsolCurrency — the static caption is what shows (an older TTD business masks the bug).
      const nw = (await J('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
      await J('POST', '/api/entities/' + nw + '/activate', {});
      await J('POST', '/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-03', due_date: '2026-08-03', idempotency_key: 'lr14-u' });
      const it = (await J('POST', '/api/entities', { name: 'Island Traders', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' })).id;
      await J('POST', '/api/entities/' + it + '/activate', {});
      await J('POST', '/api/invoices', { client: 'Local Co', amount: 8000, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-02', idempotency_key: 'lr14-t' });
      await J('POST', '/api/entities/' + nw + '/activate', {});
    } });
    const { window: w, settle } = boot;
    const d = w.document;
    await settle(60, 75);
    try { w.showPage('entities'); } catch (_) {}
    await settle(60, 75);
    const cap = () => ((d.getElementById('consol-fx-rate') || {}).textContent || '').trim();
    const ic = () => { const lab = [...d.querySelectorAll('#page-entities .mc-label')].find(l => /Intercompany/.test(l.textContent)); const v = lab && lab.parentElement.querySelector('.mc-val'); return v ? v.textContent.trim() : null; };
    console.log('    caption on load: ' + JSON.stringify(cap()) + ' · report currency ' + w.consolCurrency);
    A('1  default (USD) with a TTD business: caption does not say "No conversion"', !/No conversion/i.test(cap()) && /USD/.test(cap()), JSON.stringify(cap()));
    try { w.setConsolCurrency('TTD'); } catch (e) { console.log('    setConsolCurrency threw ' + e.message); }
    await settle(80, 75);
    const v = ic();
    A('2  TTD view: Intercompany card has no bare "$"', v != null && !/(^|[^A-Z])\$/.test(v), JSON.stringify(v));
    A('3  TTD view: caption names TTD and says the other business is converted', /TTD/.test(cap()) && /convert/i.test(cap()), JSON.stringify(cap()));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
