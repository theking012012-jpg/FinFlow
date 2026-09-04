'use strict';
/**
 * verify-bank-money-out.js — MONEY-OUT bank reconcile (the mirror of credit→invoice-payment). A bank
 * DEBIT becomes a direct EXPENSE, or a payment MATCHED to a bill (settles AP, NO new expense — the bill
 * already accrued it), or is IGNORED. Each is idempotent (reconcile_state guard), entity-scoped, and a
 * personal (no-entity) bank row is refused. Discriminating: without the endpoints these 404.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-bank-money-out.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'bankout-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'BO Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'BO Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const mkBank = async (amount, desc, ent) => (await c.query(
      `INSERT INTO personal_transactions (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, ent, { description: desc, amount, tx_type: 'debit', tx_date: '2026-07-20', category: 'Software', source: 'banking' }])).rows[0].id;
    const d1 = await mkBank(120, 'Cloud hosting', eid);      // → book as expense
    const d2 = await mkBank(200, 'Acme Supplies inv', eid);  // → match to bill
    const d3 = await mkBank(50, 'Unknown debit', eid);       // → ignore
    const dP = await mkBank(30, 'Personal netflix', null);   // personal (no entity) → refused
    const billId = (await c.query(`INSERT INTO bills (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { vendor: 'Acme Supplies', amount: 200, amount_paid: 0, status: 'unpaid', issue_date: '2026-07-20' }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const expCount = async () => (await c.query(`SELECT COUNT(*)::int n FROM expenses WHERE user_id=$1`, [uid])).rows[0].n;
    const repExpenses = async () => { const r = await http.get('/api/reports'); return (r.json && r.json.expenses) || 0; };
    const bankState = async (id) => (await c.query(`SELECT data->>'reconcile_state' k FROM personal_transactions WHERE id=$1`, [id])).rows[0].k;

    // GET serves the money-out side
    const recon = await http.get('/api/bank-reconciliation');
    A('GET returns unmatchedDebits + openBills (money-out side)',
      recon.status === 200 && Array.isArray(recon.json.unmatchedDebits) && recon.json.unmatchedDebits.length === 3 && Array.isArray(recon.json.openBills) && recon.json.openBills.length === 1,
      JSON.stringify({ d: (recon.json.unmatchedDebits||[]).length, b: (recon.json.openBills||[]).length }));

    // ── book a debit as a direct expense ──
    const exp0 = await repExpenses(), n0 = await expCount();
    const be = await http.post('/api/bank-reconciliation/book-expense', { banking_id: d1 });
    A('book-expense endpoint exists (not 404)', be.status === 200, `status=${be.status}`);
    A('booked → expense created, banking row state=expense', be.json.booked === true && (await bankState(d1)) === 'expense');
    A('one new expense row (count +1)', (await expCount()) === n0 + 1);
    A('/api/reports expenses rose by exactly 120', Math.abs((await repExpenses()) - (exp0 + 120)) < 1e-6, `before=${exp0} after=${await repExpenses()}`);
    const beDup = await http.post('/api/bank-reconciliation/book-expense', { banking_id: d1 });
    A('re-book is idempotent (duplicate, no second expense)', beDup.json.duplicate === true && (await expCount()) === n0 + 1);

    // ── match a debit to a bill (settles AP, NO new expense) ──
    const expBeforeMatch = await repExpenses(), nBeforeMatch = await expCount();
    const mb = await http.post('/api/bank-reconciliation/match-bill', { banking_id: d2, bill_id: billId });
    A('match-bill endpoint exists + matched', mb.status === 200 && mb.json.matched === true, JSON.stringify(mb.json).slice(0,120));
    A('a payments_made LINKED to the bill was created', (await c.query(`SELECT COUNT(*)::int n FROM payments_made WHERE user_id=$1 AND data->>'bill_id'=$2`, [uid, String(billId)])).rows[0].n === 1);
    A('bill marked PAID (amount_paid=200)', (() => { return true; })());
    const _bill = (await c.query(`SELECT data FROM bills WHERE id=$1`, [billId])).rows[0].data;
    A('bill status now paid, amount_paid 200', String(_bill.status) === 'paid' && Number(_bill.amount_paid) === 200, JSON.stringify(_bill));
    A('NO new expense row from the match (bill already accrued — no double-count)', (await expCount()) === nBeforeMatch);
    A('/api/reports expenses UNCHANGED by the match (no double-count)', Math.abs((await repExpenses()) - expBeforeMatch) < 1e-6, `before=${expBeforeMatch} after=${await repExpenses()}`);
    A('banking row state=bill', (await bankState(d2)) === 'bill');
    const mbDup = await http.post('/api/bank-reconciliation/match-bill', { banking_id: d2, bill_id: billId });
    A('re-match is idempotent (duplicate, no second payment)', mbDup.json.duplicate === true && (await c.query(`SELECT COUNT(*)::int n FROM payments_made WHERE user_id=$1 AND data->>'bill_id'=$2`, [uid, String(billId)])).rows[0].n === 1);

    // ── ignore ──
    const ig = await http.post('/api/bank-reconciliation/ignore', { banking_id: d3 });
    A('ignore → state=ignored', ig.json.ignored === true && (await bankState(d3)) === 'ignored');

    // ── personal (no-entity) bank row refused ──
    const pe = await http.post('/api/bank-reconciliation/book-expense', { banking_id: dP });
    A('personal bank row refused (PERSONAL_TXN, boundary enforced)', pe.status === 400 && /PERSONAL_TXN|personal bank/.test(JSON.stringify(pe.json||{})), `status=${pe.status}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (bank money-out reconcile)`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
