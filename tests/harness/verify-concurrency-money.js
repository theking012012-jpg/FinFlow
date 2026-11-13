#!/usr/bin/env node
'use strict';
/**
 * verify-concurrency-money.js — load test #2 (owner request 2026-11-13): the same account doing many things AT ONCE.
 * Two tabs (different idempotency keys) and double-clicks (the same key) fire the money actions at the same instant.
 * Every result is checked against a HAND-COMPUTED value from the database (Rule 6), not "no errors".
 *
 * Real server + scratch Postgres, real logins, real routes. Concurrency = N requests started together (Promise.all) on
 * separate HTTP connections; repeated ROUNDS times so a lucky interleaving cannot pass by chance.
 *
 * Seeds and expected values (per round, fresh rows):
 *   P1 Record payment, 5 tabs at once on a 1,000 invoice, amounts 400 / 350 / 300 / 250 / 200 (distinct keys):
 *      amount_paid ≤ 1,000 · amount_paid = Σ stored payments · status paid ⇔ amount_paid = 1,000 · no 5xx.
 *      BUG: amount_paid > 1,000 (overpaid), or the invoice total ≠ its payments.
 *   P2 Record payment double-click: 8 × the SAME key, 300 → exactly ONE payment row, amount_paid 300.
 *   R1 Run payroll for one period, 5 tabs at once → exactly ONE run; its lines = the roster (2 lines, gross 4,000 + 2,500).
 *   R2 Approve that run, 5 at once → status approved; P&L payroll expense 6,500 ONCE (BUG 13,000+).
 *   R3 Mark paid, 5 at once → status paid; the owner's salary reaches Personal EXACTLY once (net 4,000; BUG 8,000+),
 *      and no request answers 5xx.
 *   R4 Void, 5 at once → status voided; P&L payroll 0; the owner-salary personal row removed (0 rows).
 *   S1 Stock: 10 units @ 12; 5 tabs sell 3 at once → ≤ 3 sales accepted, units = 10 − 3·accepted ≥ 0, movements match,
 *      COGS = 36 · accepted. BUG: units < 0 or a sale recorded the stock didn't cover.
 *   S2 Stock double-click: 6 × the same key selling 1 → exactly ONE movement.
 *   S3 Two sales (4 + 5 of 20) racing two product edits (rename / cost) → units 11. BUG: an edit writes the old count back.
 *   B1 Busy account: the owner records 6 payments on 6 invoices WHILE a filing accountant posts 6 journals and the owner
 *      adds 6 expenses — all at once. Afterwards: every payment / journal / expense stored exactly once; the general
 *      ledger balances (Σ debits = Σ credits); /api/reports revenue & outstanding = the hand-computed values.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-concurrency-money.js      (ROUNDS=3 default; ROUNDS=10 for soak)
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const ROUNDS = Math.max(1, parseInt(process.env.ROUNDS || '3', 10));
const PW = 'concurrency-pw-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const r2 = x => Math.round(Number(x) * 100) / 100;
const J = r => { try { return JSON.parse(r.text); } catch (_) { return {}; } };

(async () => {
  let scratch, server;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    // production boot runs the versioned migrations (scripts/migrations — e.g. one payroll run per period) after initDB;
    // the shared test boot does not, so apply them here: this test must see production's constraints (Rule 3).
    const mig = await require('../../database.js').runMigrations();
    if (mig.failed && mig.failed.length) throw new Error('migrations failed: ' + mig.failed.map(x => x.name + ' ' + (x.error || '')).join('; '));
    const base = server.baseUrl;
    console.log('\n' + '='.repeat(78) + `\n  Concurrency — the same account, many money actions at once (${ROUNDS} rounds)\n` + '='.repeat(78) + '\n');

    // Each round (and B1) is its OWN account: the server allows 300 writes a minute per account (writeLimiter), and a
    // round fires ~60 at once — one account doing every round inside a minute would hit 429s that no real user sees.
    let _n = 0;
    const setup = async () => {
      const k = ++_n;
      const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
        [{ email: `cc-owner${k}@finflow.test`, name: 'CC Owner ' + k, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 4) }])).rows[0].id;
      const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
         VALUES ($1, $2, 'Ada', 'Ledger', 'Firm', $3, 'verified') RETURNING id`, [`cc-acc${k}@finflow.test`, bcrypt.hashSync(PW, 4), 'CCACC' + k])).rows[0].id;
      const owner = new HarnessHttp(base, { xff: `198.51.100.${k}` });
      if ((await owner.post('/api/auth/login', { email: `cc-owner${k}@finflow.test`, password: PW })).status !== 200) throw new Error('owner login');
      const tab = () => { const h = new HarnessHttp(base, { xff: `198.51.100.${k}` }); for (const [kk, v] of owner.cookies) h.cookies.set(kk, v); return h; };
      const ent = J(await owner.post('/api/entities', { name: 'CC Co ' + k, currency: 'USD', timezone: 'UTC', country: 'US' }));
      await owner.post('/api/entities/' + ent.id + '/activate', {});
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, entity_access) VALUES ($1, $2, 'active', 'filing', $3)`,
        [acc, uid, JSON.stringify({ entities: { [String(ent.id)]: 'filing' }, personal: 'none' })]);
      const accH = new HarnessHttp(base, { xff: `198.51.100.${k}` });
      if ((await accH.post('/api/accountants/login', { email: `cc-acc${k}@finflow.test`, password: PW })).status !== 200) throw new Error('accountant login');
      // payroll roster: the owner (net 4,000) + one employee (2,500), no deductions
      await c.query(`INSERT INTO payroll (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()), ($1, $2, $4, NOW(), NOW())`,
        [uid, ent.id, { fname: 'CC', lname: 'Owner', gross: 4000, deductions: [], is_owner: true }, { fname: 'Emp', lname: 'One', gross: 2500, deductions: [] }]);
      return { uid, owner, tab, ent, accH };
    };

    const all = (n, f) => Promise.all(Array.from({ length: n }, (_, i) => f(i)));
    const no5xx = rs => rs.every(r => r.status < 500);
    const codes = rs => JSON.stringify(rs.map(r => r.status));

    for (let round = 1; round <= ROUNDS; round++) {
      console.log(`\n  ── round ${round} ──`);
      const { uid, owner, tab, ent } = await setup();
      // P1 — five tabs pay one invoice at once
      const inv = J(await owner.post('/api/invoices', { client: 'Pay Co ' + round, amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-31', idempotency_key: `p1-inv-${round}` }));
      const amts = [400, 350, 300, 250, 200];
      const p1 = await all(5, i => tab().post('/api/invoice-payments', { invoice_id: inv.id, amount: amts[i], payment_date: '2026-07-10', method: 'bank', idempotency_key: `p1-${round}-${i}` }));
      const pr = (await c.query(`SELECT COALESCE(SUM(amount),0)::float s, COUNT(*)::int n FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows[0];
      const iv = (await c.query(`SELECT data FROM invoices WHERE id = $1`, [inv.id])).rows[0].data;
      const paid = r2(iv.amount_paid || 0);
      const st = String(iv.status);
      A(`P1 r${round}: 5 tabs pay a 1,000 invoice at once — paid ${paid} ≤ 1,000, = Σ payments ${r2(pr.s)} (${pr.n} rows), status ${st}`,
        paid <= 1000 && paid === r2(pr.s) && (st === 'paid') === (paid === 1000) && no5xx(p1), codes(p1));
      // P2 — double-click (same key)
      const inv2 = J(await owner.post('/api/invoices', { client: 'Dbl Co ' + round, amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-31', idempotency_key: `p2-inv-${round}` }));
      const p2 = await all(8, () => tab().post('/api/invoice-payments', { invoice_id: inv2.id, amount: 300, payment_date: '2026-07-10', method: 'bank', idempotency_key: `p2-${round}` }));
      const p2n = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float s FROM invoice_payments WHERE invoice_id = $1`, [inv2.id])).rows[0];
      A(`P2 r${round}: 8 identical clicks → ONE payment of 300`, p2n.n === 1 && r2(p2n.s) === 300 && no5xx(p2), `rows ${p2n.n} sum ${p2n.s} ${codes(p2)}`);

      // R1..R4 — payroll for a fresh period
      const period = `Round ${round} 2026`;
      const pre = J(await owner.get('/api/reports?period=year'));
      const r1 = await all(5, i => tab().post('/api/payroll-runs', { period, idempotency_key: `r1-${round}-${i}` }));
      const runs = (await c.query(`SELECT id, status FROM payroll_runs WHERE user_id = $1 AND period = $2`, [uid, period])).rows;
      const lines = runs.length ? (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(gross),0)::float g FROM payroll_run_lines WHERE run_id = $1`, [runs[0].id])).rows[0] : { n: 0, g: 0 };
      A(`R1 r${round}: 5 tabs run payroll for one period → ONE run, 2 lines, gross 6,500`, runs.length === 1 && lines.n === 2 && r2(lines.g) === 6500 && no5xx(r1), `runs ${runs.length} lines ${lines.n} gross ${lines.g} ${codes(r1)}`);
      if (runs.length !== 1) continue;
      const rid = runs[0].id;
      const ra = await all(5, () => tab().put(`/api/payroll-runs/${rid}/approve`, {}));
      const mid = J(await owner.get('/api/reports?period=year'));
      A(`R2 r${round}: 5 approvals at once → approved; expenses +6,500 once (Δ ${r2(mid.expenses - pre.expenses)})`,
        (await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [rid])).rows[0].status === 'approved' && r2(mid.expenses - pre.expenses) === 6500 && no5xx(ra), codes(ra));
      const rp = await all(5, () => tab().put(`/api/payroll-runs/${rid}/mark-paid`, { paid_date: '2026-07-20', confirmPrepay: true }));
      const sal = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM((data->>'amount')::numeric),0)::float s FROM personal_transactions WHERE user_id=$1 AND data->>'payroll_run_id' = $2::text`, [uid, rid])).rows[0];
      const rpBodies = rp.map(r => (J(r).ownerSalary || {}).error).filter(Boolean);
      A(`R3 r${round}: 5 mark-paid at once → paid; owner salary in Personal ONCE (${sal.n} row, ${sal.s}); no 5xx, no "salary failed" message`,
        (await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [rid])).rows[0].status === 'paid' && sal.n === 1 && r2(sal.s) === 4000 && no5xx(rp) && rpBodies.length === 0,
        `${codes(rp)} errors ${JSON.stringify(rpBodies)}`);
      const rv = await all(5, () => tab().put(`/api/payroll-runs/${rid}/void`, {}));
      const post = J(await owner.get('/api/reports?period=year'));
      const sal2 = (await c.query(`SELECT COUNT(*)::int n FROM personal_transactions WHERE user_id=$1 AND data->>'payroll_run_id' = $2::text`, [uid, rid])).rows[0].n;
      A(`R4 r${round}: 5 voids at once → voided; expenses back (Δ ${r2(post.expenses - pre.expenses)}); owner salary removed (${sal2})`,
        /void/.test((await c.query(`SELECT status FROM payroll_runs WHERE id=$1`, [rid])).rows[0].status) && r2(post.expenses - pre.expenses) === 0 && sal2 === 0 && no5xx(rv), codes(rv));

      // S1 / S2 — stock
      const item = (await c.query(`INSERT INTO inventory (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        [uid, ent.id, { name: 'Bolt ' + round, sku: 'B-' + round, units: 0, cost: 12, max_units: 100 }])).rows[0].id;
      const buy = await owner.post('/api/inventory-movements', { inventory_id: item, type: 'purchase', quantity: 10, unit_cost: 12, date: '2026-07-01', idempotency_key: `s-buy-${round}` });
      if (buy.status >= 300) throw new Error('stock purchase ' + buy.status + ' ' + buy.text.slice(0, 160));
      const s1 = await all(5, i => tab().post('/api/inventory-movements', { inventory_id: item, type: 'sale', quantity: 3, date: '2026-07-05', idempotency_key: `s1-${round}-${i}` }));
      const ok1 = s1.filter(r => r.status < 300).length;
      const unitsNow = Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id=$1`, [item])).rows[0].u);
      const sales = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(quantity),0)::float q FROM inventory_movements WHERE inventory_id=$1 AND type='sale'`, [item])).rows[0];
      A(`S1 r${round}: 5 tabs sell 3 of 10 at once → ${ok1} accepted (≤ 3), units ${unitsNow} = 10 − 3·${ok1} ≥ 0, ${sales.n} sale rows`,
        ok1 <= 3 && unitsNow === 10 - 3 * ok1 && unitsNow >= 0 && sales.n === ok1 && no5xx(s1), codes(s1));
      const s2 = await all(6, () => tab().post('/api/inventory-movements', { inventory_id: item, type: 'sale', quantity: 1, date: '2026-07-06', idempotency_key: `s2-${round}` }));
      const s2n = (await c.query(`SELECT COUNT(*)::int n FROM inventory_movements WHERE inventory_id=$1 AND type='sale' AND quantity = 1`, [item])).rows[0].n;
      A(`S2 r${round}: 6 identical clicks selling 1 → ONE movement`, (unitsNow >= 1 ? s2n === 1 : s2n === 0) && no5xx(s2), `rows ${s2n} ${codes(s2)}`);
      // S3 — a product edit (rename) racing two sales: the edit must not write the old count back
      const item3 = (await c.query(`INSERT INTO inventory (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        [uid, ent.id, { name: 'Nut ' + round, sku: 'N-' + round, units: 0, cost: 5, max_units: 100 }])).rows[0].id;
      await owner.post('/api/inventory-movements', { inventory_id: item3, type: 'purchase', quantity: 20, unit_cost: 5, date: '2026-07-01', idempotency_key: `s3-buy-${round}` });
      const s3 = await Promise.all([
        tab().post('/api/inventory-movements', { inventory_id: item3, type: 'sale', quantity: 4, date: '2026-07-05', idempotency_key: `s3-a-${round}` }),
        tab().put('/api/inventory/' + item3, { name: 'Nut renamed ' + round }),
        tab().post('/api/inventory-movements', { inventory_id: item3, type: 'sale', quantity: 5, date: '2026-07-05', idempotency_key: `s3-b-${round}` }),
        tab().put('/api/inventory/' + item3, { name: 'Nut renamed again ' + round, cost: 5 }),
      ]);
      const u3 = Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id=$1`, [item3])).rows[0].u);
      A(`S3 r${round}: two sales (4 + 5 of 20) racing two product edits → units 11 (bug: a pre-sale count written back)`, u3 === 11 && no5xx(s3), `units ${u3} ${codes(s3)}`);
    }

    // B1 — busy account: owner + accountant at once
    const { uid, owner, tab, ent, accH } = await setup();
    const before = J(await owner.get('/api/reports?period=year'));
    const invs = [];
    for (let i = 0; i < 6; i++) invs.push(J(await owner.post('/api/invoices', { client: 'Busy ' + i, amount: 100 * (i + 1), status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-31', idempotency_key: `b1-inv-${i}` })));
    const JL = i => ({ date: '2026-07-15', description: 'Busy adj ' + i, entity_id: ent.id, lines: [{ code: '6000', name: 'Office', debit: 10 + i }, { code: '1000', name: 'Cash', credit: 10 + i }] });
    const work = [
      ...invs.map((v, i) => () => tab().post('/api/invoice-payments', { invoice_id: v.id, amount: 50 * (i + 1), payment_date: '2026-07-12', method: 'bank', idempotency_key: `b1-pay-${i}` })),
      ...Array.from({ length: 6 }, (_, i) => () => accH.post(`/api/accountants/clients/${uid}/journal`, JL(i))),
      ...Array.from({ length: 6 }, (_, i) => () => tab().post('/api/expenses', { description: 'Busy exp ' + i, category: 'Rent', amount: 20 + i, deductible: 'yes', expense_date: '2026-07-14', idempotency_key: `b1-exp-${i}` })),
    ];
    const br = await Promise.all(work.map(f => f()));
    const payN = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float s FROM invoice_payments WHERE invoice_id = ANY($1::int[])`, [invs.map(v => v.id)])).rows[0];
    const jn = (await c.query(`SELECT COUNT(*)::int n FROM journals WHERE user_id = $1 AND data->>'description' LIKE 'Busy adj %'`, [uid])).rows[0].n;
    const exN = (await c.query(`SELECT COUNT(*)::int n FROM expenses WHERE user_id = $1 AND data->>'description' LIKE 'Busy exp %'`, [uid])).rows[0].n;
    A('B1: owner + accountant at once — 6 payments (Σ 1,050), 6 journals, 6 expenses, each stored ONCE, no 5xx',
      payN.n === 6 && r2(payN.s) === 1050 && jn === 6 && exN === 6 && no5xx(br), `payments ${payN.n}/${payN.s} journals ${jn} expenses ${exN} ${codes(br)}`);
    const after = J(await owner.get('/api/reports?period=year'));
    // hand-computed: invoices 100..600 add revenue 2,100 and leave 2,100 − 1,050 = 1,050 outstanding
    A(`B1: revenue +2,100 (Δ ${r2(after.revenue - before.revenue)}), outstanding +1,050 (Δ ${r2(after.outstanding - before.outstanding)})`,
      r2(after.revenue - before.revenue) === 2100 && r2(after.outstanding - before.outstanding) === 1050);
    const tb = await owner.get('/api/gl/trial-balance');
    const tbj = J(tb);
    A(`B1: trial balance balances after the burst (debits ${r2(tbj.totalDebit)} = credits ${r2(tbj.totalCredit)})`, tb.status === 200 && tbj.totalDebit > 0 && r2(tbj.totalDebit) === r2(tbj.totalCredit), tb.status + ' ' + tb.text.slice(0, 160));
  } catch (e) {
    fail++; console.log('  FATAL: ' + e.message + '\n' + e.stack);
  } finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed` : `  ALL GREEN — ${pass} passed, 0 failed  (concurrency, ${ROUNDS} rounds)`);
  process.exit(fail ? 1 : 0);
})();
