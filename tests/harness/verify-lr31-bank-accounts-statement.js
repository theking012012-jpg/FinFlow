'use strict';
/**
 * verify-lr31-bank-accounts-statement.js — LR31: Banking lists the linked accounts with their balances; Bank Rec takes
 * the statement balance and shows the difference to explain.
 *  • bankAccounts (the "Bank Accounts" list and Total Balance) had NO writer — always empty, even with a linked bank.
 *    Now filled from GET /api/plaid/accounts (Plaid /accounts/get: the balance Plaid holds; read-only, same scope as
 *    the feed). Total Balance adds only accounts in the business's currency and names the rest.
 *  • Bank Rec had no statement side. PUT /api/bank-reconciliation/statement stores the ending balance + date (audited,
 *    nothing posted); the page shows statement − book cash.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Plaid answered in-process at its HTTP boundary (the server's
 * own fetch to *.plaid.com — as verify-plaid-sync-changes does). TT$ business, one linked bank with two accounts:
 * TTD checking 5,000 (****1234) and USD savings 200 (****9876). Book cash: a 300 payment received.
 *   accounts list: both, the TTD one as TT$5,000, the USD one as "USD 200.00"          (old: empty — measured)
 *   Total Balance TT$5,000 · "1 account · 1 in another currency not added"            (old: "—")
 *   [GUARD] /api/plaid/accounts?scope=personal → no accounts (a business bank never shows in Personal)
 *   statement 350 on 2026-07-20 → "As of … · difference TT$50 to explain" (350 − 300, hand-derived) (old: no route)
 *   a future date → 400; a non-number → 400; the change is in the audit trail
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr31-bank-accounts-statement.js
 */
require('./clock.js');
process.env.PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || 'cid-lr31';
process.env.PLAID_SECRET = process.env.PLAID_SECRET || 'secret-lr31';
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (/plaid\.com\/accounts\/get/.test(String(url))) {
      return new Response(JSON.stringify({ accounts: [
        { account_id: 'a1', name: 'Ops Checking', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 5000, available: 4900, iso_currency_code: 'TTD' } },
        { account_id: 'a2', name: 'USD Savings', mask: '9876', type: 'depository', subtype: 'savings', balances: { current: 200, available: 200, iso_currency_code: 'USD' } },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
  console.log('\nLR31 — Banking accounts with balances; Bank Rec statement balance\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Island LR31', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      const app = require('../../server.js');
      await client.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1,$2,$3)`,
        [userId, e.id, { key: 'plaid_items', value: JSON.stringify([{ item_id: 'it-lr31', access_token: app._encTok('access-sandbox-lr31'), institution_name: 'Republic Bank', linked_at: '2026-07-01T00:00:00Z', cursor: null }]) }]);
      const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 300, issue_date: '2026-07-01', date: '2026-07-01', due_date: '2026-07-31', status: 'pending' });
      await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 300, payment_date: '2026-07-10', method: 'Bank' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('banking'); await settle(60, 60);
    const t = id => ((d.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const list = t('bank-accounts-list');
    eq('both accounts listed with bank, last 4 and balance in its own currency',
      [/Ops Checking/.test(list), /Republic Bank · \*\*\*\*1234/.test(list), /TT\$5,000/.test(list), /USD Savings/.test(list), /USD 200\.00/.test(list)],
      [true, true, true, true, true], [false, false, false, false, false]);
    eq('Total Balance: the business-currency accounts, the rest named', [t('bank-total-bal'), t('bank-total-sub')], ['TT$5,000', '1 account · 1 in another currency not added'], ['—', 'Not supplied by the bank feed']);
    const pers = await (await w.fetch('/api/plaid/accounts?scope=personal', { credentials: 'include' })).json();
    eq('[GUARD] the business bank is not in Personal', (pers.accounts || []).length, 0, undefined);

    const put = async b => { const r = await w.fetch('/api/bank-reconciliation/statement', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.status; };
    eq('a future statement date is refused', await put({ balance: 350, date: '2026-08-01' }), 400, 404);
    eq('[GUARD] a non-number balance is refused', await put({ balance: 'abc', date: '2026-07-20' }), 400, undefined);   // old: 400 too (no such route) — not discriminating
    w.showPage('bank-rec'); await settle(40, 50);
    d.getElementById('brec-stmt-input').value = '350';
    d.getElementById('brec-stmt-date').value = '2026-07-20';
    await w.saveBankStatement(); await settle(30, 40);
    eq('statement side: the figure entered, and the difference to explain', [t('brec-book-bal'), t('brec-stmt-bal'), /As of .*difference TT\$50 to explain/.test(t('brec-stmt-sub'))],
      ['TT$300', 'TT$350', true], ['TT$300', '—', false]);
    const aud = await (await w.fetch('/api/audit-log?type=bank_statement', { credentials: 'include' })).json();
    eq('the statement entry is in the audit trail', (aud.rows || []).filter(r => r.table_name === 'bank_statement').length, 1, 0);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { globalThis.fetch = realFetch; try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
