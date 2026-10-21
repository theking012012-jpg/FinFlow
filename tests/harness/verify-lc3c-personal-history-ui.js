'use strict';
/**
 * LC3c — the Personal page shows Personal's own history; the business Audit page never shows it (the wall).
 * Real SPA in jsdom → real server → real scratch Postgres. Seed (clientMoneyKit): Business A in view; personal
 * "Groceries" 200 and "Side gig" 1,000 added through the real routes, plus a personal asset "Car".
 *   1  Personal page has a "Personal history" card                        bug: no card
 *   2  it lists "Added · Transaction" for Groceries and "Added · Asset / liability" for Car    bug: nothing listed
 *   3  the business Audit page (audit trail) shows none of them            (the wall — control, and stays true)
 */
const { run } = require('./clientMoneyKit.js');

run('LC3c — Personal history on the Personal page, never on the business Audit page', async ({ w, d, settle, eq, A }) => {
  try { w.showPage('personal'); } catch (_) {}
  await settle(20, 60);
  await w.loadPersonalFinance(); await settle(40, 60);
  const card = d.getElementById('pers-history-card');
  eq('1  Personal page has a "Personal history" card', !!card, true, false);
  const list = (d.getElementById('pers-history-list') || {}).textContent || '';
  A('2  lists "Added · Transaction" … Groceries', /Added · Transaction\s*Groceries/.test(list.replace(/\s+/g, ' ')), list.slice(0, 300));
  A('2  lists "Added · Asset / liability" … Car', /Added · Asset \/ liability\s*Car/.test(list.replace(/\s+/g, ' ')), list.slice(0, 300));

  try { w.showPage('audit'); } catch (_) {}
  await settle(20, 60);
  if (typeof w.loadAuditTrail === 'function') { try { await w.loadAuditTrail(); } catch (_) {} }
  await settle(20, 60);
  const auditText = (d.getElementById('page-audit') || d.body).textContent || '';
  A('3  the business Audit page shows none of the personal records', !/Groceries|Side gig|\bCar\b/.test(auditText));
});
