'use strict';
/**
 * LR22 (decision 2026-10-21: option A — they ARE USD figures, so say "US$"; converting would invent an FX step).
 * Business investments are priced in USD (M36) but printed a bare "$" — on a TTD business that reads as TT dollars; the
 * Stripe card's static placeholder read "Today: $0" before the feed (which uses each payment's own currency) loads.
 * Seed: a TTD business with no holdings.
 *   1  business-investments empty state reads "US$0" / "US$0/yr", never a bare "$0"       bug: "$0", "$0/yr"
 *   2  Stripe total placeholder carries no bare "$0"                                         bug: "Today: $0"
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };
  console.log('\nLR22 — USD figures say US$\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const e = (await http.post('/api/entities', { name: 'Island Co', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' })).json.id;
      await http.post('/api/entities/' + e + '/activate', {});
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(60, 75);
    try { w.renderBizInvestments(); } catch (_) {}
    await settle(10, 40);
    const v = id => ((d.getElementById(id) || {}).textContent || '').trim();
    const vals = ['biz-inv-total', 'biz-inv-gain', 'biz-inv-daychg', 'biz-inv-income'].map(v);
    A('1  investments empty state: US$0 ×3 and US$0/yr', JSON.stringify(vals) === JSON.stringify(['US$0', 'US$0', 'US$0', 'US$0/yr']), JSON.stringify(vals));
    const st = v('stripe-total-label');
    A('2  Stripe placeholder has no bare "$0"', !/(^|[^A-Z])\$0/.test(st), JSON.stringify(st));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
