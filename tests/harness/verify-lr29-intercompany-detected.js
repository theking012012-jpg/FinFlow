'use strict';
/**
 * verify-lr29-intercompany-detected.js — LR29: the Entities Intercompany card shows the ledger's detected figure,
 * for the same window as the totals.
 *  • The GL consolidation detects intercompany trade (an invoice whose customer is named exactly like another of the
 *    owner's businesses; a bill likewise) — but no route ever sent it: /api/reports carried nothing, and the profit-loss
 *    report's "Intercompany (group consolidation)" block read d.intercompany from a route that never set it, so it
 *    never rendered. The Entities card had no figure behind it at all.
 *  • The detection counted every invoice ever, whatever the P&L's window (Rule 4: a last-year invoice makes it show).
 *  Shown, NEVER subtracted from the certified totals (the existing design: a name match is a guess).
 *
 * Real scratch Postgres, real server, real SPA (bundle). Two USD businesses; Alpha invoices "Beta LR29" 500 (Jul 2026)
 * and 900 (Jun 2025 — last fiscal year), and "Acme" 1,000 (Jul 2026). Fiscal year = calendar 2026.
 *   /api/reports?entity_id=all → intercompany.revenue 500, count 1      (old: field absent — measured)
 *   /api/reports/profit-loss?entity_id=all → intercompany.revenue 500    (old: absent — measured. The old, unwindowed
 *                                         detection would give 1,400: DERIVED from the seed, not executed — no route sent it)
 *   [GUARD] consolidated revenue is NOT reduced by it (1,500 = 500 + 1,000 this year)
 *   Entities card: "$500" · "1 detected · not eliminated in these totals" (old: "—" · "Not eliminated in these totals")
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr29-intercompany-detected.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR29 — detected intercompany: sent, windowed, shown on Entities\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      await J('POST', '/api/entities', { name: 'Beta LR29', currency: 'USD', timezone: 'UTC', country: 'US' });
      const a = await J('POST', '/api/entities', { name: 'Alpha LR29', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + a.id + '/activate', {});
      const inv = (client_, amount, issue_date) => J('POST', '/api/invoices', { client: client_, amount, issue_date, date: issue_date, due_date: '2026-12-31', status: 'pending' });
      await inv('Beta LR29', 500, '2026-07-10');
      await inv('Beta LR29', 900, '2025-06-01');
      await inv('Acme', 1000, '2026-07-05');
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const get = async u => (await w.fetch(u, { credentials: 'include' })).json();
    const rep = await get('/api/reports?entity_id=all');
    eq('/api/reports (consolidated) carries this window\'s detected intercompany', rep.intercompany ? [rep.intercompany.revenue, rep.intercompany.count] : null, [500, 1], null);
    eq('[GUARD] the consolidated revenue is not reduced by it', rep.revenue, 1500, undefined);
    const pl = await (await w.fetch('/api/reports/profit-loss?entity_id=all', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    eq('profit-loss report (consolidated) carries it — the report\'s block can render', pl.intercompany ? pl.intercompany.revenue : null, 500, null);

    w.showPage('entities');
    await settle(80, 80);
    const ic = d.getElementById('ent-interco');
    eq('Entities card: the detected figure, and what it is', ic ? [ic.textContent.trim(), ic.nextElementSibling.textContent.trim()] : null,
      ['$500', '1 detected · not eliminated in these totals'], ['—', 'Not eliminated in these totals']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
