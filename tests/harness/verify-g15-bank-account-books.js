'use strict';
/**
 * verify-g15-bank-account-books — G15 (owner decision 2026-11-01): each linked bank account is its own cash account in
 * the business's ledger (1000-NN). A matched bank-feed line moves its amount from Cash (1000) to that account; unmatched,
 * released or ignored, it moves back. Total cash never changes, and each account's books balance is exactly what has been
 * reconciled to it — so the Banking page compares bank vs books PER ACCOUNT and explains the rest.
 * Real server + real /app in a browser, scratch Postgres (Rule 3); Plaid mocked only at *.plaid.com.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-g15-bank-account-books.js
 *
 * Seed (Rule 4 — every line has a different amount, so each figure names its source):
 *   Operating ••4821 (USD, bank balance 1,000.00): T1 +300 in (matched to an invoice payment) · T2 −120 (booked as an
 *     expense) · T3 −80 (matched to a bill) · T4 −40 (left unmatched) · T5 +60 (ignored)
 *   Savings ••7710 (USD, 500.00): T6 +200 (unmatched)          TT Account ••0042 (TTD, 6,800.00): not compared
 * Hand-computed: Operating books = 300 − 120 − 80 = 100; not yet matched −40; ignored +60; before the feed
 *   1,000 − 100 − (−40) − 60 = 880. Savings: books 0, no cash account yet. Old code: no per-account books at all.
 */
let PLAID_ON = true;
{ const _f = global.fetch;
  const ACCTS = [
    { account_id: 'a1', name: 'Operating', mask: '4821', type: 'depository', subtype: 'checking', balances: { current: 1000, available: 1000, iso_currency_code: 'USD' } },
    { account_id: 'a2', name: 'Savings', mask: '7710', type: 'depository', subtype: 'savings', balances: { current: 500, available: 500, iso_currency_code: 'USD' } },
    { account_id: 'a3', name: 'TT Account', mask: '0042', type: 'depository', subtype: 'checking', balances: { current: 6800, available: 6800, iso_currency_code: 'TTD' } },
  ];
  const tx = (id, acct, amt, name) => ({ transaction_id: id, account_id: acct, amount: amt, date: '2026-07-20', name, iso_currency_code: acct === 'a3' ? 'TTD' : 'USD', pending: false });
  global.fetch = async (u, o) => {
    const s = String(u);
    if (PLAID_ON && /plaid\.com\/accounts\/(balance\/)?get/.test(s)) return { ok: true, status: 200, json: async () => ({ accounts: JSON.parse(JSON.stringify(ACCTS)), item: { item_id: 'it1' } }) };
    if (PLAID_ON && /plaid\.com\/transactions\/sync/.test(s)) return { ok: true, status: 200, json: async () => ({ added: [
      tx('T1', 'a1', -300, 'Client payment'), tx('T2', 'a1', 120, 'Office supplies'), tx('T3', 'a1', 80, 'Supplier bill'),
      tx('T4', 'a1', 40, 'Card fee'), tx('T5', 'a1', -60, 'Owner transfer in'), tx('T6', 'a2', -200, 'Interest'), tx('T7', 'a3', -700, 'TT sale') ],
      modified: [], removed: [], next_cursor: 'c1', has_more: false }) };
    return _f(u, o);
  }; }
process.env.PLAID_CLIENT_ID = 'cid-harness'; process.env.PLAID_SECRET = 'secret-harness';
const { runBrowser } = require('./browserKit.js');

runBrowser('G15 — each bank account is its own cash account in the books', async ({ open, A, eq, J, http, c, uid }) => {
  const ent = (await J('GET', '/api/entities'))[0];
  const app = require('../../server.js');
  await c.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, ent.id,
    { key: 'plaid_items', value: JSON.stringify([{ item_id: 'it1', access_token: app._encTok('access-sandbox-g15'), institution_name: 'Harness Bank', linked_at: '2026-07-01T00:00:00Z', cursor: null }]) }]);
  eq('premise: sync → 200', (await http.post('/api/plaid/sync', {})).status, 200);
  const lines = (await J('GET', '/api/banking'));
  const L = id => lines.find(l => l.plaid_txn_id === id);
  eq('premise: 7 lines synced with their accounts', ['T1', 'T2', 'T6', 'T7'].map(t => L(t) && L(t).plaid_account_id), ['a1', 'a1', 'a2', 'a3']);

  const cash = async () => { const bs = (await http.post('/api/reports/balance-sheet', {})).json || {}; if (process.env.G15DBG) console.log('DBG', bs.source, bs.cash, JSON.stringify(bs.gateFailed||''), JSON.stringify((bs.lines||{}).assets||'')); return Math.round(Number(bs.cash) * 100) / 100; };
  const acctBal = async (code) => Number((await c.query(`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float b FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id JOIN ledger_entries e ON e.id = l.entry_id AND e.status = 'posted' WHERE l.user_id = $1 AND a.code = $2`, [uid, code])).rows[0].b);

  // the documents the lines are reconciled to
  const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 300, status: 'pending', issue_date: '2026-07-10', idempotency_key: 'g-i' });
  const pay = await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 300, payment_date: '2026-07-20', idempotency_key: 'g-p' });
  const bill = await J('POST', '/api/bills', { vendor: 'Supplier', amount: 80, status: 'unpaid', issue_date: '2026-07-05', due_date: '2026-08-05', idempotency_key: 'g-b' });
  const cash0 = await cash();

  const m1 = await J('POST', '/api/bank-reconciliation/match', { banking_id: L('T1').id, invoice_payment_id: pay.id });
  await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: L('T2').id, category: 'Office' });
  await J('POST', '/api/bank-reconciliation/match-bill', { banking_id: L('T3').id, bill_id: bill.id });
  await J('POST', '/api/bank-reconciliation/ignore', { banking_id: L('T5').id });
  const map = (await c.query(`SELECT provider_account_id, ledger_code, name, currency FROM bank_ledger_accounts WHERE entity_id = $1 ORDER BY ledger_code`, [ent.id])).rows;
  eq('Operating got its own cash account 1000-01 (named for the bank account)', map.map(m => [m.provider_account_id, m.ledger_code, m.currency]), [['a1', '1000-01', 'USD']]);
  A('…named "Bank — Harness Bank Operating ••4821"', map[0] && map[0].name === 'Bank — Harness Bank Operating ••4821', JSON.stringify(map[0]));
  eq('Operating\'s books = 300 − 120 − 80 = 100 (the lines reconciled to it)', await acctBal('1000-01'), 100);
  // cash on the balance sheet: the expense (−120) and the bill payment (−80) moved cash as before; the reclass moves none
  eq('total cash moved only by the expense and the bill payment (−200) — the reclass moves none', Math.round((await cash() - cash0) * 100) / 100, -200);
  const bsl = (await http.post('/api/reports/balance-sheet', {})).json || {};
  A('the balance sheet shows no separate "Bank —" asset line (it is inside Cash)', !JSON.stringify(bsl.assets || bsl.lines || bsl).includes('Bank — Harness'), JSON.stringify(bsl.assets || '').slice(0, 300));
  const rc = (await http.get('/api/gl/reconcile-check')).json || {};
  A('GL reconcile check: the ledger still ties to the books', rc.ok === true, JSON.stringify(rc.problems || rc).slice(0, 300));

  // per-account comparison
  const ab = ((await http.get('/api/banking/accounts-books')).json || {}).accounts || [];
  const op = ab.find(a => a.account_id === 'a1'), sv = ab.find(a => a.account_id === 'a2'), tt = ab.find(a => a.account_id === 'a3');
  eq('Operating: bank 1,000 · books 100 · 1 not matched −40 · 1 ignored +60 · before the feed 880',
    op && [op.bank, op.books, op.unmatched_lines, op.unmatched_total, op.ignored_lines, op.ignored_total, op.before_feed, op.ledger_code], [1000, 100, 1, -40, 1, 60, 880, '1000-01']);
  eq('Savings: books 0, no cash account yet, 1 not matched +200, before the feed 300', sv && [sv.books, sv.ledger_code, sv.unmatched_lines, sv.unmatched_total, sv.before_feed], [0, null, 1, 200, 300]);
  eq('TT Account (TTD): not compared with USD books', tt && [tt.compared, tt.before_feed], [false, null]);

  // unmatch, re-match, release
  eq('unmatching T1 → Operating books 100 − 300 = −200', (await http.del('/api/bank-reconciliation/' + m1.id)).status === 200 ? await acctBal('1000-01') : 'unmatch failed', -200);
  await J('POST', '/api/bank-reconciliation/match', { banking_id: L('T1').id, invoice_payment_id: pay.id });
  eq('matched again → 100', await acctBal('1000-01'), 100);
  const exp = (await c.query(`SELECT data->>'reconcile_ref' AS r FROM personal_transactions WHERE id = $1`, [L('T2').id])).rows[0].r;
  await J('DELETE', '/api/expenses/' + exp);
  eq('deleting T2\'s expense releases it → Operating books 220', await acctBal('1000-01'), 220);
  eq('total cash: still only the bill payment moved it (the expense is gone) — −80', Math.round((await cash() - cash0) * 100) / 100, -80);

  // the Banking page
  const page = await open({ width: 1280, height: 900 });
  const txt = await page.evaluate(async () => {
    showPage('banking'); if (typeof loadBankingFromDB === 'function') await loadBankingFromDB();
    await new Promise(r => setTimeout(r, 1500));
    return [...document.querySelectorAll('#bank-accounts-list > div')].map(d => d.innerText.replace(/\s+/g, ' '));
  });
  const opRow = txt.find(t => /Operating/.test(t)) || '', ttRow = txt.find(t => /TT Account/.test(t)) || '';
  A('Banking page, Operating: "In your books (1000-01): $220.00"', /In your books \(1000-01\): \$220\.00/.test(opRow), opRow);
  // T2 is unmatched again after its expense was deleted: 2 not yet matched (−120 − 40); before the feed 1,000 − 220 + 160 − 60 = 880
  A('…the rest explained: 2 not yet matched −$160.00 · 1 ignored $60.00 · before the feed began $880.00', /2 not yet matched: -\$160\.00/.test(opRow) && /1 ignored: \$60\.00/.test(opRow) && /before the feed began: \$880\.00/.test(opRow), opRow);
  A('Banking page, TT Account: not compared', /not compared/.test(ttRow), ttRow);
}, {});
