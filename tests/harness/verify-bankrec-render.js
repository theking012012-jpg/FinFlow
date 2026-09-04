'use strict';
/**
 * verify-bankrec-render.js — the money-IN bank reconciliation list must render from the SERVER's real
 * response shape. The server sends { unmatchedBanking, unmatchedPayments, matched }, but the client
 * read data.unmatched_bank / data.unmatched_payments (snake) — always undefined → both columns showed
 * "All … matched" no matter what was outstanding. This boots the real SPA in jsdom, feeds a NON-empty
 * server-shaped response, and asserts the rows actually render. Discriminating: with the old snake keys
 * the lists render empty and these assertions fail.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-bankrec-render.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    for (let i = 0; i < 250 && typeof window.loadBankRec !== 'function'; i++) await settle(1, 100);
    await settle(10, 100);
    A('client loadBankRec present', typeof window.loadBankRec === 'function', `loadBankRec=${typeof window.loadBankRec}`);
    if (typeof window.loadBankRec !== 'function') throw new Error('loadBankRec not exposed');

    // Feed the REAL server shape with outstanding rows.
    window.fetch = async (url) => {
      const u = String(url);
      if (/\/api\/bank-reconciliation$/.test(u)) {
        return { ok: true, status: 200, json: async () => ({
          unmatchedBanking: [{ id: 501, description: 'ACME WIRE IN', amount: 250, date: '2026-07-20', account_name: 'Checking' }],
          unmatchedPayments: [{ id: 601, client: 'Acme Co', amount: 250, payment_date: '2026-07-20', method: 'Card' }],
          matched: [], unmatchedDebits: [], openBills: [],
        }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    await window.loadBankRec(); await settle(6, 60);
    const doc = window.document;
    const bankHtml = (doc.getElementById('brec-bank-list') || {}).innerHTML || '';
    const payHtml = (doc.getElementById('brec-pay-list') || {}).innerHTML || '';
    const ub = (doc.getElementById('brec-unmatched-bank') || {}).textContent;
    const up = (doc.getElementById('brec-unmatched-pay') || {}).textContent;

    A('unmatched bank transaction RENDERS from unmatchedBanking (server shape)', /ACME WIRE IN/.test(bankHtml), bankHtml.slice(0, 160));
    A('unmatched invoice payment RENDERS from unmatchedPayments (server shape)', /Acme Co/.test(payHtml), payHtml.slice(0, 160));
    A('bank list is NOT the empty "all matched" state', !/All bank transactions matched/.test(bankHtml));
    A('unmatched-bank counter shows 1 (not 0)', String(ub) === '1', `counter=${ub}`);
    A('unmatched-pay counter shows 1 (not 0)', String(up) === '1', `counter=${up}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (bank-rec list renders from server shape)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
