'use strict';
/**
 * verify-fam14-personal-transfers.js — FA-M14 (full app audit M14: "Personal finance treats transfers, loan and card
 * payments, and CD deposits as spending — $33.5K of $33.9K is 'Other', a savings rate of −360%"). Every personal row was
 * income or expense by money direction, so moving money between your own accounts counted as spending (out) or income
 * (in), whatever the bank feed's own category said (Plaid TRANSFER_OUT / TRANSFER_IN / LOAN_PAYMENTS).
 * After: one shared rule (FinFlowDates.personalTxKind) — a row is a TRANSFER when its category says so (the person's
 * "Transfer", or the feed's) or, with no real category, when its description reads as one ("… fee" never does);
 * transfers count as neither spending nor income on the Personal page and in the accountant portal's personal sums.
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed (personal rows only). Clock 2026-07-25, Month view.
 *   income:   Salary 5,000 · TRANSFER_IN "From savings" 500
 *   spending: Groceries 300 · Dining out 95 · "Overdraft transfer fee" (Other) 5
 *   transfers out: TRANSFER_OUT "Online transfer to savings" 1,000 · "CREDIT CARD PAYMENT THANK YOU" (Other) 800 ·
 *                  "CD DEPOSIT 12M" (Other) 2,000 · LOAN_PAYMENTS "Car loan" 350
 *   EXPECTED: income 5,000 (bug 5,500) · spending 400 (bug 4,550) · savings rate (5,000 − 400) / 5,000 = 92% (bug 17%)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam14-personal-transfers.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({
      baseSeed: false,
      seedExtra: async (c, uid) => {
        const tx = (description, amount, tx_type, category, tx_date) => c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, { description, amount, tx_type, category, tx_date, currency: 'USD', source: 'banking' }]);
        await tx('Payroll ACME', 5000, 'income', 'Salary', '2026-07-01');
        await tx('From savings', 500, 'income', 'TRANSFER_IN', '2026-07-08');
        await tx('SuperMart', 300, 'expense', 'Groceries', '2026-07-03');
        await tx('Bistro', 95, 'expense', 'Dining out', '2026-07-10');
        await tx('Overdraft transfer fee', 5, 'expense', 'Other', '2026-07-09');
        await tx('Online transfer to savings', 1000, 'expense', 'TRANSFER_OUT', '2026-07-05');
        await tx('CREDIT CARD PAYMENT THANK YOU', 800, 'expense', 'Other', '2026-07-06');
        await tx('CD DEPOSIT 12M', 2000, 'expense', 'Other', '2026-07-07');
        await tx('Car loan', 350, 'expense', 'LOAN_PAYMENTS', '2026-07-12');
      },
    });
    const { window, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.setPersPeriod !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(20, 100);
    try { window.showPage('personal'); } catch (_) {}
    await settle(20, 80);
    try { window.setPersPeriod('month'); } catch (e) { A('setPersPeriod ran', false, e.message); }
    await settle(8, 60);
    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    console.log('  [personal] income ' + t('pers-income') + ' · spend ' + t('pers-spend') + ' · savings ' + t('pers-savings'));
    A('1  income $5,000 — the transfer in from savings is not income (bug: $5,500)', /^\$5(,000|\.0K|K)$/.test(t('pers-income')) || t('pers-income') === '$5,000', t('pers-income'));
    A('2  spending $400 = groceries 300 + dining 95 + a fee 5; transfers, card / loan payments and a CD deposit are not spending (bug: $4,550)', t('pers-spend') === '$400', t('pers-spend'));
    A('3  savings rate 92% = (5,000 − 400) / 5,000 (bug: 17%)', t('pers-savings') === '92%', t('pers-savings'));
    try { window.setPersTxFilter('transfer'); } catch (e) { A('setPersTxFilter ran', false, e.message); }
    await settle(3, 30);
    const list = ((d.getElementById('pers-transactions') || {}).textContent || '').replace(/\s+/g, ' ');
    A('4  the Transfers filter lists the five transfers and nothing else', ['From savings', 'Online transfer to savings', 'CREDIT CARD PAYMENT', 'CD DEPOSIT', 'Car loan'].every(s => list.includes(s)) && !/SuperMart|Overdraft/.test(list), list.slice(0, 260));
    const FD = window.FinFlowDates;
    A('5  the shared rule: a "… fee" is spending, a category the person chose wins, "Transfer" is a transfer',
      FD.personalTxKind({ tx_type: 'expense', category: 'Other', description: 'Overdraft transfer fee' }) === 'expense'
      && FD.personalTxKind({ tx_type: 'expense', category: 'Shopping', description: 'Transfer Store' }) === 'expense'
      && FD.personalTxKind({ tx_type: 'expense', category: 'Transfer', description: 'x' }) === 'transfer', '');
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M14 personal transfers)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
