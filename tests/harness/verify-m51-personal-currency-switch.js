'use strict';
/**
 * M51 (fix pass round 2): switching the PERSONAL display currency repaints every personal money card from the same
 * figures the full render uses. Driven through the real SPA in jsdom (clientMoneyKit seed, clock 2026-07-25).
 * BUG (as EXECUTED — corrected from the round-1 sighting): the assets / liabilities list kept the OLD currency after a
 * switch (setPersCurrency never repainted it). The fast path (_updatePersCurrencyValues) also wrote a fabricated
 * Net worth (baseNetWorth + 2 × surplus) and "+surplus this month", but setPersCurrency re-renders from the real
 * figures in the same tick, so those values never reached the screen — a latent second writer, removed here and
 * asserted STRUCTURALLY (labelled) because no rendered value can show a value that is overwritten before paint.
 * Seed (Rule 4): Car 1,000 (legacy row ⇒ USD) · personal holding 20 × 100 = 2,000 · net-worth snapshots June 2,700,
 *   July 3,000, stored as the app stores them (under the active business — see M53) ⇒ month-over-month +300.
 *   TTD 6.80: Net worth TT$20.4K · change +TT$2.0K this month · Investments TT$13.6K · Car row TT$6.8K (bug $1.0K)
 */
const { run } = require('./clientMoneyKit.js');

run('M51 — personal currency switch repaints from the real figures', async ({ w, ev, all, text, settle, eq, A }) => {
  try { w.showPage('personal'); } catch (_) {}
  await settle(20, 60);
  await w.loadPersonalFinance(); await settle(30, 60);
  ev(`setPersPeriod('year')`); await settle(10, 40);
  eq('control: portfolio value (USD)', ev(`personalPortfolioValue()`), 2000);
  eq('control: net worth before the switch (USD)', text('pers-nw'), '$3.0K');
  eq('control: change line before the switch', text('pers-nw-chg'), '+$300 this month');

  ev(`setPersCurrency('TTD')`); await settle(10, 40);   // the user's click — no other re-render
  eq('Net worth after switching to TTD', text('pers-nw'), 'TT$20.4K');
  eq('Net-worth change after switching to TTD', text('pers-nw-chg'), '+TT$2.0K this month');
  eq('Personal Investments card after switching to TTD', text('pers-invest'), 'TT$13.6K');
  const acct = all('pers-accounts-list') || '';
  eq('Car row after switching to TTD', (acct.match(/Car.*?((?:TT)?\$[0-9.,KM]+)/) || [])[1] || acct.slice(0, 80), 'TT$6.8K', '$1.0K');

  ev(`setPersCurrency('USD')`); await settle(10, 40);
  eq('back to USD: Net worth', text('pers-nw'), '$3.0K');
  eq('back to USD: Car row', (all('pers-accounts-list').match(/Car.*?((?:TT)?\$[0-9.,KM]+)/) || [])[1], '$1.0K');
  // STRUCTURAL (labelled): the fabricated second writer of the personal KPI cards is gone — one writer (renderPersonal).
  eq('[STRUCTURAL] no fast-path KPI writer and no baseNetWorth', ev(`typeof _updatePersCurrencyValues + '/' + (typeof baseNetWorth)`), 'undefined/undefined', 'function/number');
}, { extraSeed: async ({ http, client, userId }, { ent }) => {
  const r = await http.request('POST', '/api/holdings', { scope: 'personal', ticker: 'IDX', name: 'Index fund', shares: 20, cost_per: 100, price: 100 });
  if (r.status >= 300) throw new Error('holding ' + r.status + ' ' + r.text);
  const snap = (key, date, value) => client.query(`INSERT INTO snapshots (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
    [userId, ent, { kind: 'networth', value, date, period_key: key }]);
  await snap('networth:2026-06', '2026-06-30', 2700);
  await snap('networth:2026-07', '2026-07-25', 3000);
} });
