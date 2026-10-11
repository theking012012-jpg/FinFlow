'use strict';
/**
 * Personal Finance money figures (money audit 2026-10-09), driven through the real SPA in jsdom.
 *
 * M12: a period's income = what ACTUALLY happened in it.
 *   BUG: a recurring source was counted once then scaled × the period's NOMINAL months (Year = 12).
 *   Seed: ONE 1,000 side-gig occurrence this year (linked to a monthly profile).  correct $1.0K · bug $12.0K
 * M13: a personal asset / liability carries the currency it was entered in.
 *   BUG: no currency; SP() multiplied the raw number by the display rate as if it were USD.
 *   Seed: Car 1,000 (legacy row, no currency ⇒ USD) · House 1,000 entered in TTD through the modal (rate 6.80).
 *   TTD display:  House TT$1.0K (bug TT$6.8K) · net worth 6,800 + 1,000 = TT$7.8K (bug TT$13.6K)
 *   Server net-worth snapshot (USD): 1,000 + 1,000 / 6.80 = 1,147.06 (bug 2,000)
 * M14 (client half): saving the owner's salary (4,000/month) creates NO personal income — no profile, no row.
 *   Yearly income stays $1.0K (bug: a roster-built profile + occurrence; $5.0K unscaled, $60.0K with the M12 bug)
 *   (the server half — paid runs book the row — is verify-m14-owner-salary-from-runs.js)
 * M35: no fabricated "Salary — <entity> (April)" / "Apr 30" row in the personal list after the payroll sync.
 */
const { run } = require('./clientMoneyKit.js');

run('M12 / M13 / M14 / M35 — Personal Finance figures', async ({ w, ev, all, text, settle, http, eq, A }) => {
  try { w.showPage('personal'); } catch (_) {}
  await settle(20, 60);
  await w.loadPersonalFinance(); await settle(20, 60);
  ev(`setPersPeriod('year')`); await settle(10, 40);
  eq('M12 Personal yearly income (one 1,000 occurrence this year)', text('pers-income'), '$1.0K', '$12.0K');

  // M13 — enter a 1,000 TTD house through the app's own modal + save handler.
  ev(`openAccountModal('asset')`); await settle(5, 40);
  const curSel = w.document.getElementById('acct-currency');
  A('M13 account modal has a currency picker', !!curSel);
  ev(`(function(){ const s=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;}; s('acct-name','House'); s('acct-value','1000'); s('acct-currency','TTD'); })()`);
  await w.saveAccount(); await settle(20, 60);
  const saved = ((await http.request('GET', '/api/personal-accounts')).json || []).find(a => a.name === 'House') || {};
  eq('M13 saved currency', saved.currency || null, 'TTD', null);
  eq('M13 saved USD equivalent (1,000 / 6.80)', saved.value_usd != null ? Number(saved.value_usd) : null, 147.06, null);

  ev(`setPersCurrency('TTD')`); await settle(10, 40);
  ev(`renderPersAccounts()`); await settle(5, 40);
  const acct = all('pers-accounts-list') || '';
  eq('M13 House (entered TT$1,000) shown in TTD', (acct.match(/House.*?(TT\$[0-9.,KM]+)/) || [])[1] || acct.slice(0, 80), 'TT$1.0K', 'TT$6.8K');
  eq('M13 Car (legacy row = USD 1,000) shown in TTD', (acct.match(/Car.*?(TT\$[0-9.,KM]+)/) || [])[1] || null, 'TT$6.8K', 'TT$6.8K');
  // Net worth through the full render path (page load in TTD). NOTE M51 (post-freeze, round 2): the currency-switch
  // FAST path (_updatePersCurrencyValues) writes a fabricated baseNetWorth + 2 × surplus instead — measured TT$10.9K.
  await w.loadPersonalFinance(); await settle(20, 60);
  eq('M13 net worth in TTD (6,800 + 1,000)', text('pers-nw'), 'TT$7.8K', 'TT$13.6K');
  const brk = all('nw-breakdown-list') || '';
  eq('M13 net-worth breakdown: House row in TTD', (brk.match(/House\s*(TT\$[0-9.,KM]+)/) || [])[1] || brk.slice(0, 80), 'TT$1.0K', 'TT$6.8K');
  ev(`updateNetWorthPanel(0)`); await settle(5, 40);
  eq('M13 investments net-worth panel total, USD (1,000 + 147.06)', text('nw-total-display'), '$1.1K', '$2.0K');
  const snap = (await http.request('POST', '/api/snapshots/capture', { kind: 'networth' })).json || {};
  eq('M13 server net-worth snapshot, USD (1,000 + 147.06)', Math.round(Number(snap.value) * 100) / 100, 1147.06, 2000);
  ev(`setPersCurrency('USD')`); await settle(5, 40);

  // M14 — save the owner's salary through the app's own handler; NO payroll run is paid for it.
  ev(`(function(){ if(typeof openOwnerPayrollModal==='function'){ try{ openOwnerPayrollModal(); }catch(_){} } const s=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;}; s('own-fname','Olive'); s('own-lname','Owner'); s('own-gross','4000'); })()`);
  await settle(5, 40);
  await w.saveOwnerPayroll(); await settle(40, 60);
  const profs = (await http.request('GET', '/api/recurring-personal-transactions')).json || [];
  eq('M14 no owner-salary recurring profile created', profs.filter(p => /Owner salary/.test(p.description || '')).length, 0, 1);
  const ptx = (await http.request('GET', '/api/personal-transactions')).json || [];
  eq('M14 no owner-salary personal row created', ptx.filter(t => /Owner salary/.test(t.description || '')).length, 0, 1);
  await w.loadPersonalFinance(); await settle(20, 60);
  ev(`setPersPeriod('year')`); await settle(10, 40);
  eq('M14 yearly income unchanged by saving the roster salary', text('pers-income'), '$1.0K', '$5.0K (M14 alone; $60.0K with M12)');

  // M35 — the payroll → personal sync fabricates nothing.
  ev(`syncAllPayrollsToPersonal()`); await settle(10, 40);
  const list = all('pers-transactions') || '';
  eq('M35 no fabricated "(April)" salary row', /\(April\)/.test(list), false, true);
  eq('M35 no "Apr 30" row', /Apr 30/.test(list), false, true);
});
