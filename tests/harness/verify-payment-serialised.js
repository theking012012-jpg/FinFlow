#!/usr/bin/env node
'use strict';
/**
 * verify-payment-serialised.js — N57b (Rule 9). Two payments recorded at the same moment against one invoice
 * or bill can never both pass the "fits in what is still owed" check: every payment writer serialises on the
 * document (withPaymentLock — a per-document advisory lock around check + insert).
 *
 * Defect: each writer checked the balance, then inserted, with nothing between them. Two concurrent partial
 * payments of DIFFERENT amounts (so the 5-second duplicate heuristic does not match them) both read the full
 * balance and both landed: a 1000 invoice paid 1100, AR negative, the cash overstated.
 *
 * The race is made deterministic, not left to luck: every INSERT of a payment is delayed 300 ms at the pg
 * client (pg.Client.prototype.query — the layer the old pool path and the new locked path both go through),
 * so both requests always finish their check before either insert lands.
 *
 * Executed: real server + Postgres, real routes. Hand-computed expectations:
 *   invoice 1000: concurrent 600 + 500 → one 201, one 400; paid 600 or 500, never 1100     (bug: both 201, 1100)
 *   bill 1000:    concurrent 600 + 500 → one accepted, one 400; paid ≤ 1000                 (bug: both, 1100)
 *   invoice 800:  "mark paid" (settles the rest) concurrent with a manual 300 → paid exactly 800 (bug: 1100)
 *   control:      sequential 400 then 600 on a 1000 invoice → both accepted; then 1 more → 400
 *   node -r ./tests/harness/clock.js tests/harness/verify-payment-serialised.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const pg = require('pg');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

// Delay every payment INSERT by 300 ms (both the pool path and a checked-out client path use Client#query).
const _realQuery = pg.Client.prototype.query;
let delayOn = false;
pg.Client.prototype.query = function (text, ...rest) {
  const sql = String(text && text.text || text || '');
  if (delayOn && /^\s*INSERT INTO (invoice_payments|payments_made)\b/i.test(sql)) {
    const cb = typeof rest[rest.length - 1] === 'function' ? rest.pop() : null;
    const p = new Promise(r => setTimeout(r, 300)).then(() => _realQuery.call(this, text, ...rest));
    if (cb) { p.then(r => cb(null, r), e => cb(e)); return undefined; }
    return p;
  }
  return _realQuery.call(this, text, ...rest);
};

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'pay-serial-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'ps@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'PS Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const mkInv = async (amount, client) => (await c.query(`INSERT INTO invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [uid, eid, { client, amount, amount_paid: 0, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01' }])).rows[0].id;
    const inv1 = await mkInv(1000, 'Race Co'), inv2 = await mkInv(800, 'Settle Co'), inv3 = await mkInv(1000, 'Seq Co');
    const bill = (await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [uid, eid, { vendor: 'Supplier', amount: 1000, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-08-01' }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.57.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'ps@finflow.test', password: PW })).status === 200);
    const q = (p) => `${p}?entity_id=${eid}`;
    const invPaid = async (id) => (await c.query(`SELECT COALESCE(SUM(amount),0)::float s, COUNT(*)::int n FROM invoice_payments WHERE invoice_id=$1`, [id])).rows[0];
    const billPaid = async (id) => (await c.query(`SELECT COALESCE(SUM((data->>'amount')::numeric),0)::float s, COUNT(*)::int n FROM payments_made WHERE data->>'bill_id'=$1`, [String(id)])).rows[0];

    console.log('\n' + '='.repeat(78));
    console.log('  CONCURRENT PAYMENTS AGAINST ONE DOCUMENT — serialised');
    console.log('='.repeat(78));
    delayOn = true;
    const [a, b] = await Promise.all([
      h.post(q('/api/invoice-payments'), { invoice_id: inv1, amount: 600, payment_date: '2026-07-10', method: 'bank' }),
      h.post(q('/api/invoice-payments'), { invoice_id: inv1, amount: 500, payment_date: '2026-07-10', method: 'bank' }),
    ]);
    const p1 = await invPaid(inv1);
    A('invoice 1000, concurrent 600 + 500 → exactly one accepted, the other 400 (bug: both 201)',
      [a.status, b.status].sort().join(',') === '201,400', `statuses ${a.status} ${b.status}`);
    A('  paid = one payment (600 or 500), never 1100', p1.n === 1 && (p1.s === 600 || p1.s === 500), JSON.stringify(p1));

    const [x, y] = await Promise.all([
      h.post(q('/api/payments-made'), { vendor: 'Supplier', amount: 600, date: '2026-07-10', bill_id: bill }),
      h.post(q('/api/payments-made'), { vendor: 'Supplier', amount: 500, date: '2026-07-10', bill_id: bill }),
    ]);
    const bp = await billPaid(bill);
    A('bill 1000, concurrent 600 + 500 → one accepted, the other 400 (bug: both accepted)',
      [x.status, y.status].filter(s => s === 400).length === 1 && [x.status, y.status].filter(s => s === 200 || s === 201).length === 1, `statuses ${x.status} ${y.status}`);
    A('  paid on the bill ≤ 1000 (bug: 1100)', bp.n === 1 && bp.s <= 1000, JSON.stringify(bp));

    const [m, n] = await Promise.all([
      h.put(q(`/api/invoices/${inv2}`), { status: 'paid' }),
      h.post(q('/api/invoice-payments'), { invoice_id: inv2, amount: 300, payment_date: '2026-07-11', method: 'bank' }),
    ]);
    const p2 = await invPaid(inv2);
    A('invoice 800: "mark paid" concurrent with a manual 300 → paid exactly 800 (bug: 1100)', p2.s === 800, `statuses ${m.status} ${n.status} paid ${JSON.stringify(p2)}`);
    delayOn = false;

    const s1 = await h.post(q('/api/invoice-payments'), { invoice_id: inv3, amount: 400, payment_date: '2026-07-12', method: 'bank' });
    const s2 = await h.post(q('/api/invoice-payments'), { invoice_id: inv3, amount: 600, payment_date: '2026-07-13', method: 'bank' });
    const s3 = await h.post(q('/api/invoice-payments'), { invoice_id: inv3, amount: 1, payment_date: '2026-07-14', method: 'bank' });
    const st3 = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM invoices WHERE id=$1`, [inv3])).rows[0];
    A('control: sequential 400 then 600 → both 201; a further 1 → 400; invoice paid, amount_paid 1000',
      s1.status === 201 && s2.status === 201 && s3.status === 400 && st3.s === 'paid' && Number(st3.p) === 1000, `${s1.status} ${s2.status} ${s3.status} ${JSON.stringify(st3)}`);
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    delayOn = false;
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (payments serialised)` : `  ALL GREEN — ${pass} passed, 0 failed  (payments serialised)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main();
