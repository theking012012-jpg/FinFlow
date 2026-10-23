'use strict';
/**
 * verify-v2-bank-balance.js — V2 (competitor gap audit 2026-10-22: "Total balance $0 across all accounts" with a Plaid
 * bank linked and synced). Owner decision D7 (upgraded).
 *
 * Root: Plaid's account balances were fetched once at link time — only to read the bank's name — and thrown away; the
 * page's `bankAccounts` was never filled (production showed a fabricated "$0"; main, after LR16, an honest "—").
 * Fix: the provider's balance per account is stored at link and refreshed on every sync, served with the linked bank
 * (never the token), and shown per account (current, available, as of) with totals PER CURRENCY — never two currencies
 * added together — plus one business-level comparison against the cash in the books (when the currency matches).
 * Each synced line now also keeps the bank account it came from (plaid_account_id), for per-account books later.
 *
 * The REAL SPA + real server; Plaid mocked only at its HTTP boundary (*.plaid.com), as in verify-plaid-sync-changes.
 * Seed: one linked bank with Operating ****4821 1,234.56 USD (available 1,200.00), Savings ****7710 765.44 USD and
 * TT Account ****0042 6,800.00 TTD. EXPECTED: USD total $2,000.00 (bug "—" / "$0"), TTD shown apart as TT$6,800.00 —
 * never a mixed 8,800; the sync's new line keeps account a1 (bug: no account recorded).
 */
const { run } = require('./clientMoneyKit.js');
const realFetch = global.fetch;
const ACCTS = [
  { account_id: 'a1', name: 'Operating', mask: '4821', type: 'depository', subtype: 'checking', balances: { current: 1234.56, available: 1200, iso_currency_code: 'USD' } },
  { account_id: 'a2', name: 'Savings', mask: '7710', type: 'depository', subtype: 'savings', balances: { current: 765.44, available: 765.44, iso_currency_code: 'USD' } },
  { account_id: 'a3', name: 'TT Account', mask: '0042', type: 'depository', subtype: 'checking', balances: { current: 6800, available: 6800, iso_currency_code: 'TTD' } },
];

run('V2 — linked bank balances per account, totals per currency, compared with the books', async ({ w, d, settle, eq, A, http }) => {
  const sync = await http.post('/api/plaid/sync', {});
  eq('premise: sync → 200', sync.status, 200);
  const items = ((await http.get('/api/plaid/items')).json || {}).items || [];
  const accts = (items[0] && items[0].accounts) || [];
  eq('1  the linked bank carries its 3 accounts with the bank\'s own balances', accts.map(a => [a.name, a.mask, a.current, a.currency]),
    [['Operating', '4821', 1234.56, 'USD'], ['Savings', '7710', 765.44, 'USD'], ['TT Account', '0042', 6800, 'TTD']], []);
  A('1b …each with an "as of" time', accts.length === 3 && accts.every(a => !!a.as_of), JSON.stringify(accts.map(a => a.as_of)));
  A('1c the access token never leaves the server', !/access_token|access-sandbox/.test(JSON.stringify(items)));
  const line = (((await http.get('/api/banking')).json) || []).find(r => r.plaid_txn_id === 'V2T1');
  eq('2  a synced line keeps the bank account it came from', line && line.plaid_account_id, 'a1', undefined);

  try { w.showPage('banking'); } catch (_) {}
  if (typeof w.loadBankingFromDB === 'function') { await w.loadBankingFromDB(); await settle(10, 50); }
  const total = ((d.getElementById('bank-total-bal') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  A('3  Total Balance shows the USD total $2,000.00', /\$2,000\.00/.test(total) && !/^—$/.test(total), JSON.stringify(total));
  A('3b …and the TTD account apart (TT$6,800.00), never added into one figure', /TT\$6,800\.00/.test(total) && !/8,800/.test(total), JSON.stringify(total));
  const list = ((d.getElementById('bank-accounts-list') || {}).textContent || '').replace(/\s+/g, ' ');
  A('4  each account: name, last 4 digits, balance, available, as of', /Operating/.test(list) && /4821/.test(list) && /\$1,234\.56/.test(list) && /\$1,200\.00 available/.test(list) && /as of/i.test(list), list.slice(0, 300));
  const bs = (await http.post('/api/reports/balance-sheet', {})).json || {};
  const cmp = ((d.getElementById('bank-books-compare') || {}).textContent || '').replace(/\s+/g, ' ');
  if (bs.cashTracked) {
    const diff = Math.round((2000 - bs.cash) * 100) / 100;
    const fmt = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    A('5  compared with the books: cash in the books ' + fmt(bs.cash) + ', difference ' + fmt(diff) + ', with a way to reconcile',
      cmp.indexOf(fmt(bs.cash)) >= 0 && cmp.indexOf(fmt(diff)) >= 0 && /reconcile/i.test(cmp), JSON.stringify(cmp));
  } else {
    A('5  books cash is not tracked for this business → the comparison says so, never a made-up difference', /not tracked/i.test(cmp) && !/difference/i.test(cmp), JSON.stringify(cmp));
  }
  A('5b the TTD account is not compared with USD books (it says so)', /TTD/.test(cmp) && /not compared|separately/i.test(cmp), JSON.stringify(cmp));
}, { extraSeed: async ({ client, userId }, r) => {
  process.env.PLAID_CLIENT_ID = 'cid-harness'; process.env.PLAID_SECRET = 'secret-harness';
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (/plaid\.com\/accounts\/(balance\/)?get/.test(u)) return { ok: true, status: 200, json: async () => ({ accounts: JSON.parse(JSON.stringify(ACCTS)), item: { item_id: 'it1' } }) };
    if (/plaid\.com\/transactions\/sync/.test(u)) return { ok: true, status: 200, json: async () => ({ added: [{ transaction_id: 'V2T1', account_id: 'a1', amount: 25, date: '2026-07-21', name: 'Coffee supplier', iso_currency_code: 'USD', pending: false }], modified: [], removed: [], next_cursor: 'c1', has_more: false }) };
    return realFetch(url, opts);
  };
  const app = require('../../server.js');
  await client.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`,
    [userId, r.ent, { key: 'plaid_items', value: JSON.stringify([{ item_id: 'it1', access_token: app._encTok('access-sandbox-v2'), institution_name: 'Harness Bank', linked_at: '2026-07-01T00:00:00Z', cursor: null }]) }]);
} });
