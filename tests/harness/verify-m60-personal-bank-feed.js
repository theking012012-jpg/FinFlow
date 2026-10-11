'use strict';
/**
 * M60 (personal bank feed, 2026-10-11): Personal links, syncs, imports and enters its OWN bank — whether or not the person
 * has a business — and none of it ever touches a business. Business bank feeds never reach Personal.
 * BUG: every bank route took its scope from the business in view (req.entityId). A person with a business could not
 * have a personal bank feed at all: a Plaid / Belvo link, a statement import or a manual bank line made "for Personal"
 * was stored under the ACTIVE BUSINESS (personal → business), listed in that business's Banking page, and absent from
 * Personal. Statement-import / Plaid / Belvo dedupe looked across ALL the user's scopes, so a statement already
 * imported into a business was skipped ("already there") when imported into Personal.
 * Plaid and Belvo are mocked only at their HTTP boundary; everything else is the real server on real Postgres.
 *
 * Seed (Rule 4 — every amount differs, so each figure names its source): owner with businesses A (active) and B.
 *   Plaid, Personal item  (token access-pers): GROCERY 61.25 out · PAYCHECK 1,830.00 in
 *   Plaid, Business A item (token access-biz): OFFICE RENT 940.00 out
 *   Belvo, Personal link: PHARMACY 37.40 OUTFLOW
 *   statement CSV (2 lines: COFFEE 22.40 out, REFUND 300.00 in, date 03/04/2026) imported into A, then into Personal
 *     with the personal bank country GB (day-first) while A is US (month-first)
 *   manual personal bank line ATM 80.00
 *
 *   correct                                                     bug
 *   personal Plaid item stored with no business                 stored under A
 *   Personal lists GROCERY, PAYCHECK, PHARMACY, COFFEE, REFUND, ATM   none of them
 *   …as expense / income (Personal's own vocabulary)            —
 *   A's Banking lists OFFICE RENT, COFFEE, REFUND only          + every personal line
 *   personal import: 2 imported                                 0 imported, 2 skipped
 *   personal import dated 2026-04-03 (GB, day-first)            2026-03-04 (A's US order)
 *   A's linked banks: Biz Bank                                  + My Personal Bank
 *   B's view: no Plaid item, no Belvo link                      (control)
 *   personal delete of the ATM line → 200                       404
 *   accountant portal YTD personal income counts a pre-M60 personal-feed 'credit' (250) as income, not spending
 */
const bcrypt = require('bcryptjs');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

const PLAID = {
  'access-pers': [{ transaction_id: 'pp1', amount: 61.25, date: '2026-07-20', name: 'GROCERY', iso_currency_code: 'USD' },
                  { transaction_id: 'pp2', amount: -1830, date: '2026-07-21', name: 'PAYCHECK', iso_currency_code: 'USD' }],
  'access-biz':  [{ transaction_id: 'bb1', amount: 940, date: '2026-07-20', name: 'OFFICE RENT', iso_currency_code: 'USD' }],
};
const BELVO_LINK = 'belvo-link-pers-1';

run('M60 — Personal has its own bank feed, walled from every business', async ({ newOwner, c, eq, A, server }) => {
  const realFetch = global.fetch;
  process.env.PLAID_CLIENT_ID = 'cid-m60'; process.env.PLAID_SECRET = 'secret-m60';
  process.env.BELVO_SECRET_ID = 'bid-m60'; process.env.BELVO_SECRET_PASSWORD = 'bpw-m60';
  const _json = j => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(j)) });
  global.fetch = async (url, opts) => {
    const u = String(url), b = opts && opts.body ? JSON.parse(opts.body) : {};
    if (/plaid\.com\/link\/token\/create/.test(u)) return _json({ link_token: 'link-' + b.user.client_user_id, expiration: 'x' });
    if (/plaid\.com\/item\/public_token\/exchange/.test(u)) return _json({ item_id: b.public_token === 'pub-pers' ? 'item-pers' : 'item-biz', access_token: b.public_token === 'pub-pers' ? 'access-pers' : 'access-biz' });
    if (/plaid\.com\/accounts\/get/.test(u)) return _json({ item: { institution_id: b.access_token === 'access-pers' ? 'ins_p' : 'ins_b' } });
    if (/plaid\.com\/institutions\/get_by_id/.test(u)) return _json({ institution: { name: b.institution_id === 'ins_p' ? 'My Personal Bank' : 'Biz Bank' } });
    if (/plaid\.com\/transactions\/sync/.test(u)) return _json({ added: PLAID[b.access_token] || [], modified: [], removed: [], next_cursor: 'c-' + b.access_token, has_more: false });
    if (/belvo\.com\/api\/token\//.test(u)) return _json({ access: 'belvo-widget' });
    if (/belvo\.com\/api\/links\//.test(u)) return _json({ id: BELVO_LINK, institution: 'Banco Personal', created_at: new Date(Date.now() + 1000).toISOString() });
    if (/belvo\.com\/api\/accounts\//.test(u)) return _json([{ id: 'acc1' }]);
    if (/belvo\.com\/api\/transactions\//.test(u)) return _json([{ id: 'bt1', type: 'OUTFLOW', amount: 37.4, value_date: '2026-07-22', description: 'PHARMACY' }]);
    return realFetch(url, opts);
  };
  try {
    const o = await newOwner('M60', [{ name: 'A Co', currency: 'USD', country: 'US' }, { name: 'B Co', currency: 'USD', country: 'US' }]);
    const [eA, eB] = o.ids;
    const P = '?scope=personal';
    const settingEid = async (key, item) => (await c.query(`SELECT entity_id, data->>'value' AS v FROM user_settings WHERE user_id=$1 AND data->>'key'=$2`, [o.uid, key])).rows
      .filter(r => String(r.v).includes(item)).map(r => r.entity_id);

    // ── Plaid: Personal links its own bank; Business A links its own ──
    A('personal link token issued', (await o.http.post('/api/plaid/link-token' + P, {})).status === 200);
    eq('personal Plaid exchange', (await o.http.post('/api/plaid/exchange' + P, { public_token: 'pub-pers' })).status, 201);
    eq('business A Plaid exchange', (await o.http.post('/api/plaid/exchange?entity_id=' + eA, { public_token: 'pub-biz' })).status, 201);
    eq('personal Plaid item stored with no business', await settingEid('plaid_items', 'item-pers'), [null], [eA]);
    const items = async q => (((await o.http.get('/api/plaid/items' + q)).json || {}).items || []).map(i => i.institution_name);
    eq('Personal sees its own bank only', await items(P), ['My Personal Bank'], ['My Personal Bank', 'Biz Bank']);
    eq("A sees A's bank only", await items('?entity_id=' + eA), ['Biz Bank'], ['My Personal Bank', 'Biz Bank']);
    eq('"all businesses" view lists no linked bank', await items('?entity_id=all'), []);
    eq("B sees no bank (control)", await items('?entity_id=' + eB), []);

    eq('personal Plaid sync adds 2', ((await o.http.post('/api/plaid/sync' + P, {})).json || {}).added, 2, 3);
    eq("A's Plaid sync adds 1 (its own item only)", ((await o.http.post('/api/plaid/sync?entity_id=' + eA, {})).json || {}).added, 1, 0);

    // ── Belvo: Personal links its own LatAm bank; a business widget session cannot be spent by Personal ──
    A('business widget opened', (await o.http.post('/api/belvo/widget-token?entity_id=' + eA, {})).status === 200);
    eq('a business widget session is not a personal one', (await o.http.post('/api/belvo/exchange' + P, { link: BELVO_LINK })).status, 409, 201);
    A('personal widget opened', (await o.http.post('/api/belvo/widget-token' + P, {})).status === 200);
    eq('personal Belvo exchange', (await o.http.post('/api/belvo/exchange' + P, { link: BELVO_LINK })).status, 201);
    eq('personal Belvo link stored with no business', await settingEid('belvo_conn', BELVO_LINK), [null], [eA]);
    eq("A's Belvo status: not connected", ((await o.http.get('/api/belvo/status?entity_id=' + eA)).json || {}).connected, false, true);
    eq('personal Belvo sync adds 1', ((await o.http.post('/api/belvo/sync' + P, {})).json || {}).added, 1);

    // ── Statement import: the same file into A, then into Personal (bank country GB = day-first) ──
    eq('personal bank country saved', ((await o.http.put('/api/personal-bank' + P, { country: 'gb' })).json || {}).country, 'GB');
    // M62: a personal bank line carries its bank's currency, which defaults to the bank country's (GB → GBP). This person
    // holds a USD account at a UK bank, so every personal figure below stays in one currency (USD). The date order
    // still follows the bank country (GB, day-first).
    eq('personal bank currency set to USD', ((await o.http.put('/api/personal-bank' + P, { currency: 'USD' })).json || {}).currency, 'USD');
    const CSV = 'Date,Description,Amount\n03/04/2026,COFFEE,-22.40\n03/04/2026,REFUND,300.00\n';
    const impA = (await o.http.post('/api/banking/import?entity_id=' + eA, { format: 'csv', content: CSV })).json || {};
    eq('A imports the statement', [impA.imported, impA.skipped], [2, 0]);
    const impP = (await o.http.post('/api/banking/import' + P, { format: 'csv', content: CSV })).json || {};
    eq('Personal imports the same statement into Personal', [impP.imported, impP.skipped], [2, 0], [0, 2]);
    const impP2 = (await o.http.post('/api/banking/import' + P, { format: 'csv', content: CSV })).json || {};
    eq('re-import into Personal is still idempotent (control)', [impP2.imported, impP2.skipped], [0, 2]);

    // ── Manual personal bank line ──
    const atm = await o.http.post('/api/banking' + P, { desc: 'ATM', amount: 80, type: 'debit', date: '2026-07-23' });
    eq('manual personal bank line', atm.status, 201);

    // ── What each side lists ──
    const pers = await o.J('GET', '/api/personal-transactions');
    const view = pers.map(t => t.description + ':' + t.tx_type + ':' + Number(t.amount)).sort();
    eq('Personal lists its own bank lines, as expense / income', view,
      ['ATM:expense:80', 'COFFEE:expense:22.4', 'GROCERY:expense:61.25', 'PAYCHECK:income:1830', 'PHARMACY:expense:37.4', 'REFUND:income:300'], []);
    eq('personal import dated by the personal bank country (GB, day-first)', (pers.find(t => t.description === 'COFFEE') || {}).tx_date, '2026-04-03', '2026-03-04');
    const bankA = (await o.J('GET', '/api/banking?entity_id=' + eA)).map(t => t.description).sort();
    eq("A's Banking lists A's lines only", bankA, ['COFFEE', 'OFFICE RENT', 'REFUND'], ['ATM', 'COFFEE', 'GROCERY', 'OFFICE RENT', 'PAYCHECK', 'PHARMACY', 'REFUND']);
    eq("B's Banking is empty (control)", (await o.J('GET', '/api/banking?entity_id=' + eB)).length, 0);
    const { rows: [{ n: nBizPers }] } = await c.query(
      `SELECT COUNT(*)::int AS n FROM personal_transactions WHERE user_id=$1 AND entity_id IS NOT NULL AND data->>'description' IN ('ATM','GROCERY','PAYCHECK','PHARMACY')`, [o.uid]);
    eq('no personal bank line stored under any business', nBizPers, 0, 4);

    // ── Deletes stay in scope ──
    const offRent = (await o.J('GET', '/api/banking?entity_id=' + eA)).find(t => t.description === 'OFFICE RENT');
    eq("Personal cannot delete A's bank line", (await o.http.request('DELETE', '/api/banking/' + offRent.id + P)).status, 404, 200);
    eq("A cannot delete Personal's ATM line", (await o.http.request('DELETE', '/api/banking/' + atm.json.id + '?entity_id=' + eA)).status, 404, 200);
    eq('Personal deletes its own ATM line', (await o.http.request('DELETE', '/api/banking/' + atm.json.id + P)).status, 200, 404);

    // ── Unlink stays in scope ──
    eq('"all businesses" view cannot unlink Personal\'s bank', (await o.http.post('/api/plaid/unlink?entity_id=all', { item_id: 'item-pers' })).status, 400, 404);
    eq("A cannot unlink Personal's bank", (await o.http.post('/api/plaid/unlink?entity_id=' + eA, { item_id: 'item-pers' })).status, 404, 200);
    eq('Personal unlinks its own bank', (await o.http.post('/api/plaid/unlink' + P, { item_id: 'item-pers' })).status, 200, 404);
    eq("A's bank is still linked", await items('?entity_id=' + eA), ['Biz Bank']);

    // ── /api/personal-bank summary ──
    const pb = (await o.http.get('/api/personal-bank' + P)).json || {};
    eq('personal-bank summary', [pb.country, ((pb.plaid || {}).items || []).length, (pb.belvo || {}).institutions, pb.lines], ['GB', 0, ['Banco Personal'], 5]);

    // ── Accountant portal: a pre-M60 personal-feed 'credit' is income ──
    await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [o.uid, { description: 'OLD FEED DEPOSIT', amount: 250, tx_type: 'credit', tx_date: '2026-07-10', source: 'banking', currency: 'USD' }]);
    const PW = 'm60-acc-pw-not-a-secret';
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('m60-acc@finflow.test', $1, 'M', 'Sixty', 'Firm', 'M60REF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, o.uid]);
    A('owner grants personal access', (await o.http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [eA]: 'view' }, personal: 'view' } })).status === 200);
    const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.236' });
    A('accountant login', (await ACC.post('/api/accountants/login', { email: 'm60-acc@finflow.test', password: PW })).status === 200);
    const p = ((await ACC.get(`/api/accountants/clients/${o.uid}/books?period=year`)).json || {}).personal || {};
    // income  = PAYCHECK 1,830 + REFUND 300 + OLD FEED DEPOSIT 250 = 2,380
    // expense = GROCERY 61.25 + COFFEE 22.40 + PHARMACY 37.40 = 121.05 (ATM deleted)
    // bug (pre-M60 'credit' read as spending): income 2,130 · expense 371.05
    eq('portal YTD personal income / expense (bug = the feed fixed, the portal still reading a credit as spending)', [Number(p.income), Number(p.expense)], [2380, 121.05], [2130, 371.05]);
    eq('portal list shows the old deposit as income', ((p.transactions || []).find(t => t.description === 'OLD FEED DEPOSIT') || {}).tx_type, 'income', 'credit');
  } finally {
    global.fetch = realFetch;
  }
});
