'use strict';
/**
 * M62 (2026-10-11): a personal bank line carries its bank's currency.
 * BUG: personal bank lines from a statement import or a manual bank line were stored with NO currency, and the Personal
 * page reads a missing currency as USD, so a TT$ (or €, £…) statement counted as US$ in every personal total. Belvo
 * lines carried none either. Only Plaid set one (iso_currency_code).
 * FIX: the "Your bank" card holds the bank's currency, defaulting to the bank country's currency (one shared rule,
 * FinFlowDates.currencyForCountry). Every personal bank line is stamped with the bank's own currency when the provider
 * sends one, else the card's. With neither a currency nor a country, a personal import is refused, never guessed.
 * Seed (Rule 4 — each source gives a different currency): owner with business A (USD).
 *   import with nothing set                → 400 NO_BANK_CURRENCY            (bug: 201, currency null → read as USD)
 *   bank country TT (no currency set)      → import stamped TTD               (bug: null)
 *   currency set to EUR, then the country set to MX → currency stays EUR (an explicit choice is never overwritten)
 *   manual personal line                   → EUR                              (bug: null)
 *   Belvo line with currency 'mxn'         → MXN (the bank's own)             (bug: null)
 *   Belvo line with no currency            → EUR (the card's)                 (bug: null)
 *   Plaid line with no iso_currency_code   → EUR (the card's)                 (bug: null)
 *   control: a BUSINESS import in A is unchanged (no currency stamped — the business currency applies)
 */
const { run } = require('./moneyFixKit.js');

run('M62 — personal bank lines carry a currency', async ({ newOwner, c, eq, A }) => {
  const realFetch = global.fetch;
  process.env.PLAID_CLIENT_ID = 'cid-m62'; process.env.PLAID_SECRET = 'secret-m62';
  process.env.BELVO_SECRET_ID = 'bid-m62'; process.env.BELVO_SECRET_PASSWORD = 'bpw-m62';
  const _json = j => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(j)) });
  global.fetch = async (url, opts) => {
    const u = String(url), b = opts && opts.body ? JSON.parse(opts.body) : {};
    if (/plaid\.com\/item\/public_token\/exchange/.test(u)) return _json({ item_id: 'item-p', access_token: 'access-p' });
    if (/plaid\.com\/accounts\/get/.test(u)) return _json({ item: {} });
    if (/plaid\.com\/transactions\/sync/.test(u)) return _json({ added: [{ transaction_id: 'pl1', amount: 19.5, date: '2026-10-02', name: 'PLAID NO CURRENCY' }], modified: [], removed: [], next_cursor: 'c', has_more: false });
    if (/belvo\.com\/api\/token\//.test(u)) return _json({ access: 'w' });
    if (/belvo\.com\/api\/links\//.test(u)) return _json({ id: 'bl-m62', institution: 'Banco', created_at: new Date(Date.now() + 1000).toISOString() });
    if (/belvo\.com\/api\/accounts\//.test(u)) return _json([]);
    if (/belvo\.com\/api\/transactions\//.test(u)) return _json([
      { id: 'bv1', type: 'OUTFLOW', amount: 70, value_date: '2026-10-03', description: 'BELVO MXN', currency: 'mxn' },
      { id: 'bv2', type: 'INFLOW', amount: 30, value_date: '2026-10-04', description: 'BELVO NONE' }]);
    return realFetch(url, opts);
  };
  try {
    const o = await newOwner('M62', [{ name: 'A Co', currency: 'USD', country: 'US' }]);
    const P = '?scope=personal';
    const cur = async d => ((await c.query(`SELECT data->>'currency' AS cu FROM personal_transactions WHERE user_id=$1 AND data->>'description'=$2`, [o.uid, d])).rows[0] || {}).cu || null;
    const imp = (content) => o.http.post('/api/banking/import' + P, { format: 'csv', content });

    const r0 = await imp('Date,Description,Amount\n2026-10-01,NOTHING SET,-11.00\n');
    eq('personal import with no bank currency or country: refused', [r0.status, r0.json && r0.json.code], [400, 'NO_BANK_CURRENCY'], [201, undefined]);
    eq('…and nothing was stored', await cur('NOTHING SET'), null);

    await o.J('PUT', '/api/personal-bank' + P, { country: 'TT' });
    eq('the card shows the bank country\'s currency', ((await o.http.get('/api/personal-bank' + P)).json || {}).currency, 'TTD');
    eq('TT import accepted', (await imp('Date,Description,Amount\n2026-10-01,TT LINE,-12.00\n')).status, 201);
    eq('import stamped with the bank country\'s currency (TT → TTD)', await cur('TT LINE'), 'TTD', null);

    await o.J('PUT', '/api/personal-bank' + P, { currency: 'eur' });
    await o.J('PUT', '/api/personal-bank' + P, { country: 'MX' });
    eq('an explicit currency survives a country change', ((await o.http.get('/api/personal-bank' + P)).json || {}).currency, 'EUR', 'MXN');
    eq('a currency that is not a 3-letter code is refused', (await o.http.put('/api/personal-bank' + P, { currency: 'EURO' })).status, 400);

    eq('manual personal line accepted', (await o.http.post('/api/banking' + P, { desc: 'MANUAL LINE', amount: 13, type: 'debit', date: '2026-10-02' })).status, 201);
    eq('manual personal line stamped EUR', await cur('MANUAL LINE'), 'EUR', null);

    await o.http.post('/api/belvo/widget-token' + P, {});
    eq('personal Belvo link', (await o.http.post('/api/belvo/exchange' + P, { link: 'bl-m62' })).status, 201);
    eq('personal Belvo sync adds 2', ((await o.http.post('/api/belvo/sync' + P, {})).json || {}).added, 2);
    eq("Belvo line keeps the bank's own currency (mxn → MXN)", await cur('BELVO MXN'), 'MXN', null);
    eq("Belvo line with no currency takes the card's (EUR)", await cur('BELVO NONE'), 'EUR', null);

    eq('personal Plaid link', (await o.http.post('/api/plaid/exchange' + P, { public_token: 'pub' })).status, 201);
    eq('personal Plaid sync adds 1', ((await o.http.post('/api/plaid/sync' + P, {})).json || {}).added, 1);
    eq("Plaid line with no currency takes the card's (EUR)", await cur('PLAID NO CURRENCY'), 'EUR', null);

    // Control: business bank lines are untouched by this (their currency is the business's).
    eq('control: business import in A', (await o.http.post('/api/banking/import?entity_id=' + o.ids[0], { format: 'csv', content: 'Date,Description,Amount\n2026-10-01,BIZ LINE,-14.00\n' })).status, 201);
    eq('control: business line has no personal currency stamp', await cur('BIZ LINE'), null);
  } finally {
    global.fetch = realFetch;
  }
});
