'use strict';
/**
 * M36 (money audit 2026-10-09): the dashboard Investments card values USD-priced business holdings in the
 * business's OWN currency.
 * BUG: the native card painted Σ shares × USD price under the entity's symbol, unconverted (TT$1.0K for US$1,000).
 * Seed: a TTD business · holding 10 × US$100 = US$1,000 · fx rate USD→TTD 6.80.
 *   correct 6.8K · bug 1.0K. Without any USD→TTD rate the card shows "—" (never the USD figure).
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };

async function seed({ http }) {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text.slice(0, 200)); return JSON.parse(r.text); };
  const ent = await J('POST', '/api/entities', { name: 'TT Co', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
  await J('POST', '/api/entities/' + ent.id + '/activate', {});
  await J('POST', '/api/holdings', { ticker: 'ACME', name: 'Acme Corp', shares: 10, cost_per: 100, price: 100, scope: 'business' });
}

(async () => {
  let ctx;
  try {
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, settle, text, http } = ctx;
    await settle(80, 75);
    w.eval(`setPeriod(document.getElementById('pY'),'year')`); await settle(40, 60);
    if (typeof w.updateDashboard === 'function') w.updateDashboard(); await settle(40, 60);
    const noRate = text('d-invest');
    A('no USD→TTD rate yet: "—", never the unconverted US$1,000 (bug: 1.0K)', noRate === '—', 'card=' + noRate);
    const r = await http.request('POST', '/api/fx-rates', { from_currency: 'USD', to_currency: 'TTD', rate: 6.80, rate_date: '2026-01-01' });
    A('fx rate saved', r.status < 300, 'status ' + r.status);
    if (typeof w.updateDashboard === 'function') w.updateDashboard(); await settle(40, 60);
    const withRate = text('d-invest');
    // The VALUE is the finding (the symbol follows the app's display-currency setting).
    A('with USD→TTD 6.80: 10 × US$100 = 6.8K in the business currency (bug: 1.0K)', /6\.8K$/.test(withRate || ''), 'card=' + withRate);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (ctx && ctx.stop) await ctx.stop(); } catch {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (M36 business investments currency)\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
