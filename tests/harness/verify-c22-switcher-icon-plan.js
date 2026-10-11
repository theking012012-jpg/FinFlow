'use strict';
/**
 * C22 / C27 (Cowork end-to-end test): the business-switcher menu never shows "undefined", and the sidebar badge shows
 * the account's real plan.
 * BUG C22: the menu drew each business's `icon`, which the list built from the real businesses never sets → "undefined".
 * BUG C27: renderBusinessSwitcher hard-coded "· Pro" while every other path wrote the real plan, so the badge flipped
 * between "Pro" and "Business".
 * Seed: clientMoneyKit (Business A) on the business plan.
 *   menu text has no "undefined"; shows the business's initial "B"     bug: "undefined"
 *   badge after renderBusinessSwitcher → "USD · Business"               bug: "USD · Pro"
 */
const { run } = require('./clientMoneyKit.js');

run('C22/C27 — switcher icon and plan badge', async ({ w, d, ev, settle, eq, A }) => {
  ev('buildBizMenu()'); await settle(5, 30);
  const menu = (d.getElementById('biz-list') || {}).textContent || '';
  eq('switcher menu shows no "undefined"', /undefined/.test(menu), false, true);
  A('…and shows the business initial instead', /\bB\b/.test(menu.replace(/\s+/g, ' ')), menu.replace(/\s+/g, ' ').slice(0, 120));
  ev('renderBusinessSwitcher()'); await settle(5, 30);
  eq('sidebar badge shows the real plan', (d.getElementById('biz-currency-badge') || {}).textContent, 'USD · Business', 'USD · Pro');
}, { extraSeed: async ({ client, userId }) => {
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
} });
