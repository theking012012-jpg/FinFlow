'use strict';
/**
 * LR25 (decision 2026-10-21: option A). Banking "+ Add Account" (app-main openAddAccountModal — no wiring override)
 * only showed a toast "Connect or add a bank account". Now it opens a chooser with the two real ways a business adds a
 * bank: link it (ffBankLinkFromPage) or import a statement (ffImportStatement).
 *   1  "+ Add Account" opens a chooser with "Link a bank" and "Import a statement"     bug: toast only
 *   2  "Import a statement" calls ffImportStatement (business scope — no 'personal')  bug: no button
 *   3  "Link a bank" calls ffBankLinkFromPage                                          bug: no button
 */
const { run } = require('./clientMoneyKit.js');
run('LR25 — + Add Account offers Link / Import', async ({ w, d, settle, eq, A }) => {
  const calls = [];
  w.ffImportStatement = (scope) => calls.push(['import', scope || null]);
  w.ffBankLinkFromPage = () => calls.push(['link']);
  try { w.showPage('banking'); } catch (_) {}
  await settle(10, 40);
  try { w.openAddAccountModal(); } catch (e) { console.log('    threw ' + e.message); }
  await settle(5, 30);
  const m = d.getElementById('bank-add-account-modal');
  const btns = m ? [...m.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
  A('1  chooser opens with Link + Import', !!m && !m.classList.contains('hidden') && btns.some(t => /Link a bank/.test(t)) && btns.some(t => /Import a statement/.test(t)), JSON.stringify(btns));
  const click = re => { const b = m && [...m.querySelectorAll('button')].find(x => re.test(x.textContent)); if (b) b.click(); };
  click(/Import a statement/); await settle(2, 20);
  eq('2  Import calls ffImportStatement in the business scope', calls.find(c => c[0] === 'import') || null, ['import', null], null);
  try { w.openAddAccountModal(); } catch (_) {} await settle(2, 20);
  click(/Link a bank/); await settle(2, 20);
  A('3  Link calls ffBankLinkFromPage', calls.some(c => c[0] === 'link'), JSON.stringify(calls));
});
