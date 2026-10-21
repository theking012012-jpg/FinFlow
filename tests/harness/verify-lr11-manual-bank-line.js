'use strict';
/**
 * verify-lr11-manual-bank-line.js — LR11 (live retest 2026-10-20; owner decision 2026-10-21 "build it, better and more
 * secure"). Banking "+ Add" was a toast with no form; POST /api/banking had no caller and checked almost nothing.
 *
 * Real scratch Postgres (+ the 2026-10-21 idempotency-key index migration), real routes. What the old route gives
 * (Rule 4) is stated beside each check:
 *   1. a manual line is stored and marked manual                               (old: no manual mark)
 *   2. the same idempotency key with a different description → the SAME line   (old: a second line)
 *   3. amount −5 / 0 → 400                                                     (old: −5 refused downstream, 0 STORED)
 *   4. date 2026-02-30 → 400 — a GUARD: the old code also refused it downstream (measured 2026-10-21); kept so the
 *      route's own check cannot regress unnoticed
 *   5. the bank feed already has 88 out on the 19th; manual 88 out on the 20th → 409 POSSIBLE_DUPLICATE (old: 201)
 *      …confirmed → 201
 *   6. a business line dated inside a locked period → refused                  (old: 201)
 *   7. a second row with the same key straight into the database → 23505        (the guarantee is at the write)
 *   8. the business line is audited (bank_lines CREATE)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lr11-manual-bank-line.js
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./moneyFixKit.js');

run('LR11 — a manual bank line is validated, de-duplicated, lock-checked, marked and audited on the server', async ({ newOwner, c, eq }) => {
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'migrations', '2026-10-21-personal-tx-idem-key.sql'), 'utf8'));
  const { uid, http, J, ids } = await newOwner('LR11', [{ name: 'Northwind LR11', currency: 'USD' }]);
  const eid = ids[0];
  const post = b => http.request('POST', '/api/banking', b);
  const lines = async () => (await c.query(`SELECT id, data FROM personal_transactions WHERE user_id = $1 AND entity_id = $2 ORDER BY id`, [uid, eid])).rows;

  const r1 = await post({ desc: 'Cash deposit', amount: 250, type: 'credit', date: '2026-07-20', cat: 'Sales', idempotency_key: 'lr11-k1' });
  eq('1. stored (201), money in, marked manual', [r1.status, r1.json && r1.json.tx_type, r1.json && r1.json.manual], [201, 'credit', true], [201, 'credit', undefined]);

  const r2 = await post({ desc: 'Cash deposit (retyped)', amount: 250, type: 'credit', date: '2026-07-20', idempotency_key: 'lr11-k1' });
  eq('2. same key again → the same line, still one row', [r2.status, r2.json && r2.json.id, (await lines()).length], [200, r1.json && r1.json.id, 1], [201, undefined, 2]);

  const neg = await post({ desc: 'Bad', amount: -5, type: 'debit', date: '2026-07-20', idempotency_key: 'lr11-neg' });
  const zero = await post({ desc: 'Bad', amount: 0, type: 'debit', date: '2026-07-20', idempotency_key: 'lr11-zero' });
  eq('3. amount −5 and 0 are refused', [neg.status, zero.status], [400, 400], [400, 201]);

  const bad = await post({ desc: 'Bad date', amount: 10, type: 'debit', date: '2026-02-30', idempotency_key: 'lr11-date' });
  eq('4. a date that does not exist is refused (guard)', bad.status, 400);

  await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
    [uid, eid, { description: 'CARD PURCHASE 4417', amount: 88, tx_type: 'debit', tx_date: '2026-07-19', source: 'banking', category: 'Uncategorized' }]);
  const d1 = await post({ desc: 'Software', amount: 88, type: 'debit', date: '2026-07-20', idempotency_key: 'lr11-dup' });
  eq('5. matches a line the bank already sent → 409 POSSIBLE_DUPLICATE naming it', [d1.status, d1.json && d1.json.code, d1.json && d1.json.match && d1.json.match.date], [409, 'POSSIBLE_DUPLICATE', '2026-07-19'], [201, undefined, undefined]);
  const d2 = await post({ desc: 'Software', amount: 88, type: 'debit', date: '2026-07-20', idempotency_key: 'lr11-dup', confirm_duplicate: true });
  eq('5. …added once the person confirms', d2.status, 201);

  await J('POST', '/api/lock-settings', { enabled: true, lock_date: '2026-06-30' });
  const lk = await post({ desc: 'Back-dated', amount: 40, type: 'debit', date: '2026-06-15', idempotency_key: 'lr11-lock' });
  eq('6. a line dated in a locked period is refused', lk.status >= 400 && lk.status < 500, true, false);
  eq('6. …and nothing was stored for it', (await lines()).filter(l => l.data.description === 'Back-dated').length, 0, 1);

  let code = null;
  try { await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid, { description: 'x', amount: 1, idempotency_key: 'lr11-k1', source: 'banking' }]); }
  catch (e) { code = e.code; }
  eq('7. a second row with the same key straight into the database is refused', code, '23505', null);

  const aud = (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE table_name = 'bank_lines' AND action = 'CREATE' AND entity_id = $1`, [eid])).rows[0].n;
  eq('8. each business line added is audited (2 lines → 2 rows)', aud, 2);
});
