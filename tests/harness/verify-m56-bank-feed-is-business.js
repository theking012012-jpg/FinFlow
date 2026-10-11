'use strict';
/**
 * M56 (personal/business wall, 2026-10-10): a business's bank lines never reach Personal, and Personal never reaches a
 * business's bank lines. Bank connections are per scope by design — each business and Personal link their own; an
 * account with NO business uses the bank feed as its personal feed (that stays as it is).
 * BUG:
 *   - a bank line written from the consolidated "all businesses" view (?entity_id=all — no single business resolved)
 *     was stored entity-less, i.e. landed in PERSONAL (business → personal);
 *   - PUT / DELETE /api/personal-transactions/:id accepted a BUSINESS bank line's id (personal → business write);
 *   - DELETE /api/banking/:id from a business accepted a PERSONAL transaction's id, or another business's line.
 * Seed (Rule 4 — 75 / 33 / 50 / 12 all differ): owner with businesses A and B · A's bank line 75 · personal "Books" 33
 *   · B's bank line 50.
 *   POST /api/banking?entity_id=all → 400 (bug 201, and the line shows in Personal)
 *   PUT / DELETE personal <A's line> → 404 (bug 200) · DELETE /api/banking/<Books> from A → 404 (bug 200)
 *   DELETE /api/banking/<B's line> from A → 404 (bug 200)
 *   Personal lists "Books" only (bug: + the "all"-view line)
 * Control: an account with NO business keeps its personal bank feed (bank line 12 → 201, listed in Personal).
 */
const { run } = require('./moneyFixKit.js');

run('M56 — bank lines stay in their own scope', async ({ newOwner, c, eq, A }) => {
  const o = await newOwner('M56', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'USD' }]);
  const [eA, eB] = o.ids;
  const lineA = await o.J('POST', '/api/banking?entity_id=' + eA, { desc: 'OFFICE DEPOT', amount: 75, type: 'debit', date: '2026-07-10' });
  const lineB = await o.J('POST', '/api/banking?entity_id=' + eB, { desc: 'B SUPPLIER', amount: 50, type: 'debit', date: '2026-07-10' });
  const books = await o.J('POST', '/api/personal-transactions', { description: 'Books', amount: 33, tx_type: 'expense', tx_date: '2026-07-11', currency: 'USD', category: 'Other' });

  eq('bank line from the "all businesses" view refused', (await o.http.post('/api/banking?entity_id=all', { desc: 'WHICH BUSINESS?', amount: 99, type: 'debit', date: '2026-07-12' })).status, 400, 201);
  eq('Personal lists personal rows only', (await o.J('GET', '/api/personal-transactions')).map(t => t.description).sort(), ['Books'], ['Books', 'WHICH BUSINESS?']);
  eq('personal edit of a business bank line refused', (await o.http.put('/api/personal-transactions/' + lineA.id, { amount: 1 })).status, 404, 200);
  eq('personal delete of a business bank line refused', (await o.http.request('DELETE', '/api/personal-transactions/' + lineA.id)).status, 404, 200);
  eq("business delete of a personal transaction refused", (await o.http.request('DELETE', '/api/banking/' + books.id + '?entity_id=' + eA)).status, 404, 200);
  eq("business A deleting business B's bank line refused", (await o.http.request('DELETE', '/api/banking/' + lineB.id + '?entity_id=' + eA)).status, 404, 200);
  const amt = async id => Number(((await c.query(`SELECT data->>'amount' AS a FROM personal_transactions WHERE id=$1`, [id])).rows[0] || {}).a);
  eq('every row untouched (A 75, B 50, Books 33)', [await amt(lineA.id), await amt(lineB.id), await amt(books.id)], [75, 50, 33], [1, 0, 0]);
  A('control: A deletes its own bank line', (await o.http.request('DELETE', '/api/banking/' + lineA.id + '?entity_id=' + eA)).status === 200);

  // Control: an account with no business — the bank feed IS the personal feed (by design).
  const n = await newOwner('M56N', []);
  // M62: a line that lands in Personal must know its currency — refused until the bank's country or currency is set.
  eq('no business, no bank currency yet: refused (M62)', (await n.http.post('/api/banking', { desc: 'NO CURRENCY', amount: 9, type: 'debit', date: '2026-07-10' })).status, 400);
  await n.J('PUT', '/api/personal-bank?scope=personal', { country: 'US' });
  const r = await n.http.post('/api/banking', { desc: 'COFFEE', amount: 12, type: 'debit', date: '2026-07-10' });
  eq('no business: bank line accepted into the personal feed', r.status, 201);
  eq('…and listed in Personal', (await n.J('GET', '/api/personal-transactions')).map(t => t.description), ['COFFEE']);
});
