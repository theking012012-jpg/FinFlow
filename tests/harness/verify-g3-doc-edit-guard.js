'use strict';
/**
 * verify-g3-doc-edit-guard.js — G3 (gap investigation 2026-10-22; owner decision D2). Must be GREEN before any edit
 * screen ships (plan batch 7).
 *
 * PUT /api/invoices/:id and PUT /api/bills/:id let an edit contradict the money already recorded against the document:
 *   (1) the amount set BELOW what is paid  → amount_paid > amount, AR / AP hidden or negative
 *   (2) a paid invoice set back to DRAFT    → revenue un-recognised while its cash stays (the M1/M2 delete class)
 *   (3) status left STALE after an amount edit, or set by hand against the payments ("pending" on a part-paid one)
 * D2: every field stays editable; an amount below what is paid is refused, saying how much is paid and what to do;
 * status follows the payments; legacy rows (amount_paid with no payment rows) keep their paid figure — never wiped.
 *
 * Real Postgres + real routes. DISCRIMINATING seed (Rule 4) — each case moves a number the bug leaves elsewhere:
 *   INV-A 1,000, paid 400   PUT 300 → 409 (bug 200, amount_paid 400 > amount 300)
 *                           PUT 400 → status paid (bug partial) · PUT 1,500 → partial, AR 1,100 (bug paid)
 *                           PUT status draft → 409 (bug 200) · PUT status pending → stays partial (bug pending)
 *   INV-L legacy 600, amount_paid 250 with NO payment row
 *                           PUT 200 → 409 (paid 250) · PUT 800 → partial, amount_paid still 250 (a naive recalc wipes it to 0)
 *   INV-C 500, no payments  PUT 50 → 200, stays pending (control: nothing paid, nothing guarded)
 *   BILL-A 800, paid 300    PUT 200 → 409 · PUT 300 → paid (bug partial) · PUT 1,000 → partial, AP 700 (bug paid)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-g3-doc-edit-guard.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const eq = (n, measured, expected, bug) => A(n + `  [measured ${JSON.stringify(measured)}, correct ${JSON.stringify(expected)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, JSON.stringify(measured) === JSON.stringify(expected));
const r2 = n => Math.round((+n || 0) * 100) / 100;
const PW = 'harness-password-not-a-secret';

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  G3 — an edit can never contradict the money recorded against the document\n' + '='.repeat(78) + '\n');
    const email = 'g3edit@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', name: 'G3 Owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'Edit Co', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.88' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
    const inv = async id => { const { rows: [r] } = await c.query(`SELECT * FROM invoices WHERE id=$1`, [id]); const d = Object.assign({}, r.data || {}, r); return { amount: r2(d.amount), paid: r2(d.amount_paid), status: d.status }; };
    const bill = async id => { const { rows: [r] } = await c.query(`SELECT data FROM bills WHERE id=$1`, [id]); return { amount: r2(r.data.amount), paid: r2(r.data.amount_paid), status: r.data.status }; };
    const gl = async code => { const a = (((await http.get('/api/gl/accounts')).json || {}).accounts || []).find(x => x.code === code); return a ? r2(a.balance) : null; };

    // ── Invoice A: 1,000 with 400 paid ──
    const iA = await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-31', idempotency_key: 'g3-ia' });
    await J('POST', '/api/invoice-payments', { invoice_id: iA.id, amount: 400, payment_date: '2026-07-10', idempotency_key: 'g3-pa' });
    eq('premise: INV-A 1,000 paid 400 → partial', await inv(iA.id), { amount: 1000, paid: 400, status: 'partial' });

    const below = await http.put('/api/invoices/' + iA.id, { amount: 300 });
    eq('1  amount 300 below the 400 paid → HTTP', below.status, 409, 200);
    A('1b the refusal says how much is paid and what to do instead', (below.json || {}).code === 'AMOUNT_BELOW_PAID' && /400\.00/.test((below.json || {}).error || '') && /payment|credit note/i.test((below.json || {}).error || ''), JSON.stringify(below.json));
    eq('1c nothing changed (amount, paid, status)', await inv(iA.id), { amount: 1000, paid: 400, status: 'partial' }, { amount: 300, paid: 400, status: 'partial' });
    const liBelow = await http.put('/api/invoices/' + iA.id, { line_items: [{ description: 'x', qty: 1, rate: 250 }] });
    eq('1d the same refusal when line items total 250 (below paid)', liBelow.status, 409, 200);

    eq('2  amount 400 (= paid) → HTTP 200', (await http.put('/api/invoices/' + iA.id, { amount: 400 })).status, 200);
    eq('2b status follows the payments: paid', await inv(iA.id), { amount: 400, paid: 400, status: 'paid' }, { amount: 400, paid: 400, status: 'partial' });
    eq('3  amount 1,500 → HTTP 200', (await http.put('/api/invoices/' + iA.id, { amount: 1500 })).status, 200);
    eq('3b status follows the payments: partial', await inv(iA.id), { amount: 1500, paid: 400, status: 'partial' }, { amount: 1500, paid: 400, status: 'paid' });

    const toDraft = await http.put('/api/invoices/' + iA.id, { status: 'draft' });
    eq('4  part-paid invoice → draft refused (its revenue would vanish while its cash stays)', toDraft.status, 409, 200);
    eq('4b still partial after the refusal', (await inv(iA.id)).status, 'partial', 'draft');
    eq('5  status "pending" by hand on a part-paid invoice → HTTP 200', (await http.put('/api/invoices/' + iA.id, { status: 'pending', notes: 'chased' })).status, 200);
    eq('5b …but status follows the payments: partial', (await inv(iA.id)).status, 'partial', 'pending');

    // ── Invoice L: legacy amount_paid with no payment row ──
    const iL = await J('POST', '/api/invoices', { client: 'Legacy Co', amount: 600, status: 'pending', issue_date: '2026-07-02', idempotency_key: 'g3-il' });
    await c.query(`UPDATE invoices SET amount_paid = 250, status = 'partial' WHERE id = $1`, [iL.id]).catch(async () => {
      await c.query(`UPDATE invoices SET data = data || '{"amount_paid":250,"status":"partial"}'::jsonb WHERE id = $1`, [iL.id]); });
    eq('premise: INV-L legacy 600 with 250 paid and no payment row', await inv(iL.id), { amount: 600, paid: 250, status: 'partial' });
    eq('6  legacy: amount 200 below the 250 paid → HTTP', (await http.put('/api/invoices/' + iL.id, { amount: 200 })).status, 409, 200);
    eq('6b legacy: amount 800 → HTTP 200', (await http.put('/api/invoices/' + iL.id, { amount: 800 })).status, 200);
    eq('6c legacy: the 250 paid is kept (never wiped) and status stays partial', await inv(iL.id), { amount: 800, paid: 250, status: 'partial' }, { amount: 800, paid: 0, status: 'pending' });

    // ── Invoice C: control, nothing paid ──
    const iC = await J('POST', '/api/invoices', { client: 'Clean Co', amount: 500, status: 'pending', issue_date: '2026-07-03', idempotency_key: 'g3-ic' });
    eq('7  control: unpaid invoice 500 → 50 → HTTP 200', (await http.put('/api/invoices/' + iC.id, { amount: 50 })).status, 200);
    eq('7b control: still pending, amount 50', await inv(iC.id), { amount: 50, paid: 0, status: 'pending' });

    // ── GL agrees (INV-A 1,500 − 400, INV-L 800 − 250, INV-C 50) ──
    eq('8  GL Accounts Receivable (1100) = 1,100 + 800 + 50 = 1,950 (the legacy 250 has no payment row, so no cash leg)', await gl('1100'), 1950);

    // ── Bill A: 800 with 300 paid ──
    const bA = await J('POST', '/api/bills', { vendor: 'Supply Co', amount: 800, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-31', idempotency_key: 'g3-ba' });
    await J('POST', '/api/payments-made', { vendor: 'Supply Co', amount: 300, date: '2026-07-11', method: 'bank', bill_id: bA.id, idempotency_key: 'g3-pb' });
    eq('premise: BILL-A 800 paid 300 → partial', await bill(bA.id), { amount: 800, paid: 300, status: 'partial' });
    const bBelow = await http.put('/api/bills/' + bA.id, { amount: 200 });
    eq('9  bill amount 200 below the 300 paid → HTTP', bBelow.status, 409, 200);
    A('9b the refusal says how much is paid and points to a vendor credit', /300\.00/.test((bBelow.json || {}).error || '') && /vendor credit|payment/i.test((bBelow.json || {}).error || ''), JSON.stringify(bBelow.json));
    eq('10 bill amount 300 (= paid) → paid', (await http.put('/api/bills/' + bA.id, { amount: 300 })).status === 200 ? (await bill(bA.id)).status : 'HTTP!', 'paid', 'partial');
    eq('11 bill amount 1,000 → partial', (await http.put('/api/bills/' + bA.id, { amount: 1000 })).status === 200 ? (await bill(bA.id)).status : 'HTTP!', 'partial', 'paid');
    eq('11b GL Accounts Payable (2000) = 1,000 − 300 = 700', await gl('2000'), 700);

    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1`, [uid])).rows[0];
    A('12 trial balance ties', Math.abs(tb.d - tb.cr) < 0.01, JSON.stringify(tb));
    const recalcAudit = (await c.query(`SELECT COUNT(*)::int AS n FROM audit_trail WHERE user_id=$1 AND action='RECALC' AND table_name='invoices' AND record_id::text=$2::text`, [uid, iA.id])).rows[0].n;
    A('13 each status change an edit causes is audited (RECALC rows on INV-A)', recalcAudit >= 2, 'RECALC rows=' + recalcAudit);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (G3 document edit guard)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
