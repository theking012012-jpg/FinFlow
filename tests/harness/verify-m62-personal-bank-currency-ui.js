'use strict';
/**
 * M62 (2026-10-11) — the Personal page side: the "Your bank" card shows and sets the bank's currency, and personal bank
 * lines reach the Personal page with that currency (which is what every personal total converts from).
 * BUG: the card had no currency; imported lines had none, so the page read them as USD.
 * Seed: clientMoneyKit. Bank country set to Trinidad and Tobago from the card; a TT$ statement line is imported.
 *   card currency after choosing TT            → TTD                  (bug: no currency control)
 *   imported line on the Personal page          → currency TTD         (bug: USD — the page's default for a missing one)
 *   choose EUR, then change the country to MX   → stays EUR            (an explicit choice is never overwritten)
 */
const { run } = require('./clientMoneyKit.js');

run('M62 — Personal bank card: currency', async ({ w, d, ev, settle, eq, http }) => {
  try { w.showPage('personal'); } catch (_) {}
  await settle(20, 60);
  await w.loadPersonalFinance(); await settle(20, 60);
  const sel = d.getElementById('pers-bank-currency');
  eq('the card has a currency control', !!sel, true, false);
  await w.ffPersBankCountry('TT'); await settle(15, 60);
  eq('currency follows the bank country (TT → TTD)', d.getElementById('pers-bank-currency').value, 'TTD', undefined);
  const r = await http.request('POST', '/api/banking/import?scope=personal', { format: 'csv', content: 'Date,Description,Amount\n2026-07-21,DOUBLES STAND,-100.00\n' });
  eq('TT$ statement imported', r.status, 201);
  await w.loadPersonalFinance(); await settle(20, 60);
  const row = JSON.parse(ev(`JSON.stringify((window._allPersTxs||[]).filter(t=>t.desc==='DOUBLES STAND').map(t=>[t.currency,t.amount,t.type]))`));
  eq('the line reaches Personal in TT$ (converted by every personal total)', row, [['TTD', 100, 'expense']], [['USD', 100, 'expense']]);
  await w.ffPersBankCurrency('EUR'); await settle(15, 60);
  await w.ffPersBankCountry('MX'); await settle(15, 60);
  eq('an explicit currency survives a country change', d.getElementById('pers-bank-currency').value, 'EUR', 'MXN');
});
