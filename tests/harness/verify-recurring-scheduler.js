#!/usr/bin/env node
'use strict';
/**
 * verify-recurring-scheduler.js — the recurring invoice/bill scheduler (Appendix A: previously
 * UNVERIFIED). Drives the REAL runRecurringScheduler() (exported test hook) against real Postgres
 * with the pinned clock (today = 2026-07-25) and asserts on executed rows:
 *   - a DUE active template materialises exactly one invoice/bill and advances next_run one period
 *   - a NOT-due template produces nothing and is left untouched
 *   - re-running is idempotent (an advanced template no longer fires — no duplicate)
 *   - end_date is honoured: a template whose NEXT run passes end_date completes after firing once
 *
 * Rule 4: seed values discriminate (client/vendor/amount/date all distinct so the source is
 * identifiable). Rule 9-adjacent: the idempotency assertion executes the re-run failure path.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-recurring-scheduler.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    const TODAY = new Date().toISOString().slice(0, 10);

    console.log('\n' + '='.repeat(78));
    console.log('  RECURRING SCHEDULER — runRecurringScheduler() against real Postgres (today ' + TODAY + ')');
    console.log('='.repeat(78));
    A('pinned clock is 2026-07-25', TODAY === '2026-07-25', `today=${TODAY}`);
    A('runRecurringScheduler is exported', typeof app.runRecurringScheduler === 'function');

    // ── F159: nextRunDate must be timezone-free (Rule 10). Under this negative-offset TZ the old
    //    local-time instant math rolled 1st-of-month dates BACK a day. Assert the whole class. ──
    console.log('\n-- F159 · nextRunDate is timezone-free (server TZ = ' + process.env.TZ + ') --');
    const nrd = app.nextRunDate;
    const cases = [
      ['2026-07-01', 'monthly', '2026-08-01'],   // was 2026-07-31
      ['2026-12-01', 'monthly', '2027-01-01'],   // was 2026-12-31 (also lost the year)
      ['2026-02-01', 'monthly', '2026-03-01'],   // was 2026-03-04
      ['2026-03-31', 'monthly', '2026-04-30'],   // month-end clamp (was 2026-05-01)
      ['2026-01-31', 'monthly', '2026-02-28'],   // clamp to short month (2026 not leap)
      ['2026-07-10', 'monthly', '2026-08-10'],   // mid-month (worked before too)
      ['2026-01-01', 'yearly',  '2027-01-01'],
      ['2026-12-01', 'quarterly', '2027-03-01'], // quarter crossing a year boundary
      ['2026-07-01', 'weekly',  '2026-07-08'],
      ['2026-06-15', 'Annually','2027-06-15'],   // modal sends 'Annually'
    ];
    for (const [inp, freq, want] of cases) {
      const got = nrd(inp, freq);
      A(`nextRunDate(${inp}, ${freq}) → ${want}`, got === want, `got=${got}`);
    }

    // ── owner + entity (business rows require a non-null entity_id under the F150 constraints) ──
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'recur-owner@finflow.test', name: 'Recur Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }]
    )).rows[0].id;
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'Recur Co', currency: 'USD', is_active: 1, sort_order: 0 }]
    )).rows[0].id;

    const mkRecur = async (table, data) => (await c.query(
      `INSERT INTO ${table} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, data]
    )).rows[0].id;

    // DUE monthly invoice template (next_run in the past → should fire once, advance to 08-01)
    const dueInvId = await mkRecur('recurring_invoices', {
      status: 'active', frequency: 'monthly', next_run: '2026-07-01',
      client: 'Recur Client A', amount: 500, entity_id: eid, user_id: uid,
    });
    // NOT-due invoice template (next_run in the future → must NOT fire)
    const futInvId = await mkRecur('recurring_invoices', {
      status: 'active', frequency: 'monthly', next_run: '2026-08-15',
      client: 'Future Client', amount: 999, entity_id: eid, user_id: uid,
    });
    // DUE monthly bill template
    const dueBillId = await mkRecur('recurring_bills', {
      status: 'active', frequency: 'monthly', next_run: '2026-07-10',
      vendor: 'Recur Vendor', amount: 300, entity_id: eid, user_id: uid,
    });
    // end_date template: fires once for 07-05, next would be 08-05 > end_date 07-20 → completes
    const endInvId = await mkRecur('recurring_invoices', {
      status: 'active', frequency: 'monthly', next_run: '2026-07-05', end_date: '2026-07-20',
      client: 'Ending Client', amount: 700, entity_id: eid, user_id: uid,
    });

    const nrun = async (table, id) => (await c.query(`SELECT data->>'next_run' AS n, data->>'status' AS s FROM ${table} WHERE id=$1`, [id])).rows[0];
    const invFor = async (client) => (await c.query(`SELECT COUNT(*) n, MIN(data->>'due_date') dd, MIN(data->>'status') st FROM invoices WHERE data->>'client'=$1`, [client])).rows[0];
    const billFor = async (vendor) => (await c.query(`SELECT COUNT(*) n, MIN(data->>'status') st FROM bills WHERE data->>'vendor'=$1`, [vendor])).rows[0];

    // ── first run ──
    console.log('\n-- run #1 --');
    await app.runRecurringScheduler();

    const g1 = await invFor('Recur Client A');
    A('DUE invoice template materialised exactly one invoice', Number(g1.n) === 1, `count=${g1.n}`);
    A('  generated invoice carries the template due_date (2026-07-01)', g1.dd === '2026-07-01', `due=${g1.dd}`);
    A('  generated invoice status = pending', g1.st === 'pending', `status=${g1.st}`);
    // F94: durable lineage link back to the recurring template (the F94 page reads this, never fuzzy-matches).
    const invLink = (await c.query(`SELECT data->>'recurring_invoice_id' AS rid FROM invoices WHERE data->>'client'='Recur Client A' LIMIT 1`)).rows[0];
    A('  generated invoice carries recurring_invoice_id = its template id (F94 lineage)', Number(invLink.rid) === Number(dueInvId), `recurring_invoice_id=${invLink.rid}, template=${dueInvId}`);
    A('  generated invoice is entity-scoped (not a personal/null-entity leak)',
      Number((await c.query(`SELECT COUNT(*) n FROM invoices WHERE data->>'client'='Recur Client A' AND entity_id=$1`, [eid])).rows[0].n) === 1);
    const a1 = await nrun('recurring_invoices', dueInvId);
    A('DUE invoice template next_run advanced one month → 2026-08-01', a1.n === '2026-08-01', `next_run=${a1.n}`);
    A('DUE invoice template still active', a1.s === 'active', `status=${a1.s}`);

    const b1 = await billFor('Recur Vendor');
    A('DUE bill template materialised exactly one bill', Number(b1.n) === 1, `count=${b1.n}`);
    A('  generated bill status = unpaid', b1.st === 'unpaid', `status=${b1.st}`);
    const billLink = (await c.query(`SELECT data->>'recurring_bill_id' AS rid FROM bills WHERE data->>'vendor'='Recur Vendor' LIMIT 1`)).rows[0];
    A('  generated bill carries recurring_bill_id = its template id (F94 lineage)', Number(billLink.rid) === Number(dueBillId), `recurring_bill_id=${billLink.rid}, template=${dueBillId}`);
    A('DUE bill template next_run advanced → 2026-08-10', (await nrun('recurring_bills', dueBillId)).n === '2026-08-10');

    const fut1 = await invFor('Future Client');
    A('NOT-due template produced NOTHING', Number(fut1.n) === 0, `count=${fut1.n}`);
    A('NOT-due template next_run untouched (2026-08-15)', (await nrun('recurring_invoices', futInvId)).n === '2026-08-15');

    const end1 = await invFor('Ending Client');
    const endS1 = await nrun('recurring_invoices', endInvId);
    A('end_date template fired once', Number(end1.n) === 1, `count=${end1.n}`);
    A('end_date template completed (next run 08-05 would pass end_date 07-20)', endS1.s === 'completed', `status=${endS1.s}`);

    // ── second run — idempotency: nothing that already advanced should fire again ──
    console.log('\n-- run #2 (idempotency) --');
    await app.runRecurringScheduler();
    A('re-run creates NO duplicate invoice for the advanced template', Number((await invFor('Recur Client A')).n) === 1, `count=${(await invFor('Recur Client A')).n}`);
    A('re-run creates NO duplicate bill', Number((await billFor('Recur Vendor')).n) === 1);
    A('re-run does NOT re-fire the completed end_date template', Number((await invFor('Ending Client')).n) === 1);
    A('NOT-due template STILL produced nothing on re-run', Number((await invFor('Future Client')).n) === 0);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (recurring scheduler)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    try { if (appPool && appPool.end && !appPool.ended) await appPool.end(); } catch (_) {}
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[recur] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
