'use strict';
/**
 * verify-lr14-consol-caption.js — LR14: the Entities page says what its consolidated figures are.
 *  • Caption: static "No conversion · native currencies shown" until a currency button was pressed, while every entity
 *    column was already fetched in the consolidation currency (a TTD entity's column in $). After a press it quoted the
 *    client's static table rate ("1 USD = 6.78 TTD"), which the server's per-transaction conversion never used.
 *  • Intercompany card: a static "$0 · Eliminated" — nothing writes it, and these totals (/api/reports?entity_id=all)
 *    do not eliminate intercompany trade. Now "—" · "Not eliminated in these totals".
 *  • LR25 class: entity names were written into the page raw.
 *
 * Real scratch Postgres, real server, real SPA (bundle).
 *   default (USD):  "All in USD · Island <b>LR14</b> (TTD) converted at the stored rate for each transaction's date"
 *                                                   (old: "No conversion · native currencies shown" — measured)
 *   report in TTD:  "All in TTD · Mainland LR14 (USD) converted …"   (old: "1 USD = … TTD")
 *   intercompany:   ["—", "Not eliminated in these totals"]            (old: ["$0", "Eliminated"])
 *   an entity named "Island <b>LR14</b>" draws no <b>                  (old: it does)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr14-consol-caption.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR14 — consolidated caption, intercompany card, entity names\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      await J('POST', '/api/entities', { name: 'Mainland LR14', currency: 'USD', timezone: 'UTC', country: 'US' });
      const e = await J('POST', '/api/entities', { name: 'Island <b>LR14</b>', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('entities');
    await settle(60, 60);
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    const storedName = (w.ENTITIES || []).find(x => x.currency === 'TTD').name;

    eq('default caption names what was converted, and how', t('consol-fx-rate'),
      `All in USD · ${storedName} (TTD) converted at the stored rate for each transaction's date`, 'No conversion · native currencies shown');
    const ic = d.getElementById('ent-interco') || Array.from(d.querySelectorAll('#page-entities .mc')).find(m => /Intercompany/i.test(m.textContent)).querySelector('.mc-val');
    eq('intercompany card makes no claim the totals do not support', [ic.textContent.trim(), ic.nextElementSibling.textContent.trim()], ['—', 'Not eliminated in these totals'], ['$0', 'Eliminated']);
    eq('an entity name with markup draws no element', d.querySelectorAll('#page-entities b').length, 0, 2);

    w.setConsolCurrency('TTD');
    await settle(60, 60);
    eq('report in TTD: the caption follows (no static-table rate)', t('consol-fx-rate'),
      "All in TTD · Mainland LR14 (USD) converted at the stored rate for each transaction's date", '1 USD = … TTD');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
