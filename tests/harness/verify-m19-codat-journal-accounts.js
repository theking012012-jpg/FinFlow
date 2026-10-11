'use strict';
/**
 * M19 (money audit 2026-10-09): a Codat-imported journal line is typed by its ACCOUNT, not by the first character
 * of Codat's opaque account id.
 * BUG: lines stored accountRef.id as the code; the ledger types a code by its first digit, so an Expense account
 * whose id starts '4' booked as income, an Income account whose id starts '7' as expense, and an id starting with
 * a letter made the whole journal un-postable (a "Posted" journal in no figure).
 * Executed through the real POST /api/codat/import (accounts → journals → reconcile); only api.codat.io is mocked.
 * Accounts: '4f-…' Expense "Advertising" (400) · '7b-…' Income "Sales" (200) · 'c3-…' Asset "Bank" (090)
 * Journals (June 2026): J1 Dr Bank 1,000 / Cr Sales 1,000 · J2 Dr Advertising 300 / Cr Bank 300 ·
 *                       J3 Dr Advertising 50 / Cr Sales 50
 *   correct: revenue 1,050 · operating expenses 350
 *   bug:     J1, J2 never post (letter id) · J3 posts Dr income / Cr expense → revenue −50, expenses −50
 * A journal naming an account that was not imported is reported (unmappedAccount), not imported.
 */
process.env.CODAT_API_KEY = 'codat-m19-key';
const { run } = require('./moneyFixKit.js');

run('M19 — Codat journal lines typed by their account', async ({ newOwner, c, eq, A }) => {
  const { uid, J, ids } = await newOwner('M19');
  await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
    [uid, ids[0], { key: 'codat_conn', value: JSON.stringify({ company_id: 'co-m19', platform: 'Xero' }) }]);
  const DATA = {
    accounts: [
      { id: '4f-advertising', nominalCode: '400', name: 'Advertising', type: 'Expense' },
      { id: '7b-sales', nominalCode: '200', name: 'Sales', type: 'Income' },
      { id: 'c3-bank', nominalCode: '090', name: 'Bank', type: 'Asset' },
    ],
    journalEntries: [
      { id: 'j1', postedOn: '2026-06-05', description: 'Cash sale', journalLines: [{ accountRef: { id: 'c3-bank' }, netAmount: 1000 }, { accountRef: { id: '7b-sales' }, netAmount: -1000 }] },
      { id: 'j2', postedOn: '2026-06-06', description: 'Ads paid', journalLines: [{ accountRef: { id: '4f-advertising' }, netAmount: 300 }, { accountRef: { id: 'c3-bank' }, netAmount: -300 }] },
      { id: 'j3', postedOn: '2026-06-07', description: 'Barter', journalLines: [{ accountRef: { id: '4f-advertising' }, netAmount: 50 }, { accountRef: { id: '7b-sales' }, netAmount: -50 }] },
      { id: 'j4', postedOn: '2026-06-08', description: 'Unknown acct', journalLines: [{ accountRef: { id: 'zz-missing' }, netAmount: 9 }, { accountRef: { id: 'c3-bank' }, netAmount: -9 }] },
    ],
  };
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://api.codat.io/')) {
      const m = u.match(/\/data\/([A-Za-z]+)\?page=(\d+)/);
      if (m) { const rows = Number(m[2]) === 1 ? (DATA[m[1]] || []) : []; return { ok: true, status: 200, json: async () => ({ results: rows, totalResults: rows.length }) }; }
      return { ok: true, status: 200, json: async () => ({ results: [{ status: 'Linked', platformName: 'Xero' }] }) };
    }
    return realFetch(url, opts);
  };
  let imp;
  try { imp = await J('POST', '/api/codat/import', {}); } finally { global.fetch = realFetch; }
  eq('journals imported / unmapped-account journals reported', [imp.results.journalEntries.added, imp.results.journalEntries.unmappedAccount], [3, 1], [4, undefined]);
  const rep = await J('GET', '/api/reports');
  eq('revenue from the imported journals', rep.revenue, 1050, -50);
  eq('operating expenses from the imported journals', rep.expenses, 350, -50);
  const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND source_type = 'journal'`, [uid]);
  eq('every imported journal reached the ledger', n, 3, 1);
});
