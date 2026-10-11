'use strict';
/**
 * M60 (personal bank feed, 2026-10-11) — the Personal page side.
 * BUG 1: bank-feed rows in Personal written before M60 (an account with no business, whose bank feed is its personal
 *        feed) say credit / debit; the Personal page read only 'income' / 'expense', so they were in no total.
 * BUG 2: the Personal page had no bank of its own — no link, import or sync; every bank control sent the request in the
 *        BUSINESS's scope.
 * Seed: clientMoneyKit (Personal: side gig income 1,000 · groceries 200, July) + two pre-M60 personal bank-feed rows:
 *        BANK DEPOSIT credit 250 (Jul 18) · CARD PURCHASE debit 40 (Jul 19).
 *   yearly income  $1.3K (1,000 + 250)       bug $1.0K
 *   bank card shows "2 bank transactions"     bug: no bank card
 *   Link bank from Personal → /api/belvo/status?scope=personal for MX (Belvo region); Plaid link token → ?scope=personal
 *   Business Banking "Link bank" still asks in the business's scope (no scope=personal) — control
 */
const { run } = require('./clientMoneyKit.js');

run('M60 — Personal page: own bank card, bank-feed rows counted', async ({ w, d, ev, text, settle, eq, A, http }) => {
  try { w.showPage('personal'); } catch (_) {}
  await settle(20, 60);
  await w.loadPersonalFinance(); await settle(30, 60);
  ev(`setPersPeriod('year')`); await settle(10, 40);
  eq('yearly income counts the pre-M60 bank deposit (credit 250)', text('pers-income'), '$1.3K', '$1.0K');
  const types = ev(`JSON.stringify((window._allPersTxs||[]).filter(t=>/BANK DEPOSIT|CARD PURCHASE/.test(t.desc)).map(t=>t.desc+':'+t.type).sort())`);
  eq('bank-feed rows read as income / expense', JSON.parse(types), ['BANK DEPOSIT:income', 'CARD PURCHASE:expense'], ['BANK DEPOSIT:credit', 'CARD PURCHASE:debit']);

  const linked = d.getElementById('pers-bank-linked');
  eq('Personal bank card is on the page', !!linked, true, false);
  A('bank card counts the personal feed (2 bank transactions)', /2 bank transactions/.test(linked ? linked.textContent : ''), linked && linked.textContent);
  const sel = d.getElementById('pers-bank-country');
  A('bank-country list offers the app countries (same list as onboarding)', sel && sel.options.length > 40, sel && sel.options.length);

  // Country is saved for the person (not a business).
  await w.ffPersBankCountry('MX'); await settle(10, 40);
  eq('personal bank country saved', ((await http.get('/api/personal-bank?scope=personal')).json || {}).country, 'MX');

  // Every request the Personal card makes carries scope=personal; the business page's does not.
  const urls = [];
  const orig = w.fetch;
  w.fetch = (u, o) => { urls.push(String(u)); return orig(u, o); };
  await w.loadPersonalFinance(); await settle(10, 40);
  eq('bank card shows the saved country', d.getElementById('pers-bank-country').value, 'MX');
  urls.length = 0;
  await w.ffPersBankLink(); await settle(10, 40);
  eq('Link bank (MX) asks Belvo in the personal scope', urls.filter(u => /\/api\/(belvo|plaid)\//.test(u)), ['/api/belvo/status?scope=personal']);
  urls.length = 0;
  await w.ffLinkBank(null, null, 'personal'); await settle(10, 40);
  eq('Plaid link token requested in the personal scope', urls.filter(u => /\/api\/plaid\//.test(u)), ['/api/plaid/link-token?scope=personal']);
  urls.length = 0;
  await w.ffBankLinkFromPage(); await settle(10, 40);
  eq('control: business Banking "Link bank" stays in the business scope (US → Plaid)', urls.filter(u => /\/api\/(belvo|plaid)\//.test(u)), ['/api/plaid/items']);
  w.fetch = orig;
  eq('region rule', ['MX', 'GB', 'TT'].map(c => w.ffBankRegion(c)), ['belvo', 'plaid', null]);
}, { extraSeed: async ({ client, userId }) => {
  for (const [desc, amt, type, date] of [['BANK DEPOSIT', 250, 'credit', '2026-07-18'], ['CARD PURCHASE', 40, 'debit', '2026-07-19']]) {
    await client.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [userId, { description: desc, amount: amt, tx_type: type, tx_date: date, source: 'banking', currency: 'USD', category: 'Other' }]);
  }
} });
