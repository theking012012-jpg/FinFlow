#!/usr/bin/env node
'use strict';
/**
 * verify-scheduler-entity-tz.js (F88 step 3, Rule 10 + Rule 14) — runRecurringScheduler must fire each
 * recurring row on ITS ENTITY's calendar day, not one global UTC day. At the pinned instant
 * (2026-07-25T16:00Z) it is already 2026-07-26 in Australia/Sydney but still 2026-07-25 in America/New_York
 * and in UTC — so a row dated 2026-07-26 must fire for the Sydney entity and NOT for the New-York or the
 * no-timezone entity.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-scheduler-entity-tz.js
 *
 * Discriminates (Rule 14): the Sydney row's next_run (Jul 26) is AFTER the UTC "today" (Jul 25), so the
 * pre-F88 global-UTC boundary would have EXCLUDED it — "Sydney fired" can only be true with per-entity
 * resolution. The no-timezone entity proves the UTC fallback is byte-identical (a UTC book never moves).
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const FD = require('../../public/finflow-dates.js');

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
    const now = new Date();

    console.log('\n' + '='.repeat(78));
    console.log('  SCHEDULER ENTITY-TZ — per-entity "today" boundary (pinned 2026-07-25T16:00Z)');
    console.log('='.repeat(78));

    // ── premise: the same instant is a DIFFERENT calendar day per zone ──
    A('runRecurringScheduler is exported', typeof app.runRecurringScheduler === 'function');
    A('UTC today = 2026-07-25', FD.resolvedToday(now) === '2026-07-25', FD.resolvedToday(now));
    A('Australia/Sydney today = 2026-07-26 (already ticked over)', FD.resolvedToday(now, 'Australia/Sydney') === '2026-07-26', FD.resolvedToday(now, 'Australia/Sydney'));
    A('America/New_York today = 2026-07-25', FD.resolvedToday(now, 'America/New_York') === '2026-07-25', FD.resolvedToday(now, 'America/New_York'));

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'tz-owner@finflow.test', name: 'TZ Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }]
    )).rows[0].id;
    const mkEntity = async (data) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, data]
    )).rows[0].id;
    const eidSyd = await mkEntity({ name: 'Sydney Co', currency: 'AUD', timezone: 'Australia/Sydney', is_active: 0, sort_order: 0 });
    const eidNY  = await mkEntity({ name: 'New York Co', currency: 'USD', timezone: 'America/New_York', is_active: 0, sort_order: 1 });
    const eidUTC = await mkEntity({ name: 'No-TZ Co', currency: 'USD', is_active: 0, sort_order: 2 }); // no timezone ⇒ UTC

    const mkRecurInv = async (eid, data) => (await c.query(
      `INSERT INTO recurring_invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { status: 'active', frequency: 'monthly', user_id: uid, ...data }]
    )).rows[0].id;

    // All three "future-in-UTC" rows share next_run 2026-07-26. Only the Sydney entity is on Jul 26.
    const sydId = await mkRecurInv(eidSyd, { next_run: '2026-07-26', client: 'Sydney Client', amount: 810, entity_id: eidSyd });
    const nyId  = await mkRecurInv(eidNY,  { next_run: '2026-07-26', client: 'NY Client',     amount: 820, entity_id: eidNY  });
    const utcId = await mkRecurInv(eidUTC, { next_run: '2026-07-26', client: 'NoTZ Client',   amount: 830, entity_id: eidUTC });
    // Control: a row dated today-in-UTC (Jul 25) fires for the NY entity under BOTH old and new logic —
    // proves the scheduler actually runs (so a "0 fired" elsewhere is a real exclusion, not a dead run).
    const ctlId = await mkRecurInv(eidNY,  { next_run: '2026-07-25', client: 'NY Control',    amount: 825, entity_id: eidNY  });

    const invCount = async (client) => Number((await c.query(`SELECT COUNT(*) n FROM invoices WHERE data->>'client'=$1`, [client])).rows[0].n);
    const nrun = async (id) => (await c.query(`SELECT data->>'next_run' AS n FROM recurring_invoices WHERE id=$1`, [id])).rows[0].n;

    console.log('\n-- run #1 --');
    await app.runRecurringScheduler();

    // ── the discriminator: Sydney fired although its date is AFTER UTC-today ──
    A('Sydney row FIRED (entity is on Jul 26, though UTC is Jul 25)', (await invCount('Sydney Client')) === 1, `count=${await invCount('Sydney Client')}`);
    A('  Sydney next_run advanced 2026-07-26 → 2026-08-26', (await nrun(sydId)) === '2026-08-26', `next_run=${await nrun(sydId)}`);

    // ── New-York and no-TZ entities are still on Jul 25 → a Jul-26 row must NOT fire ──
    A('New-York row did NOT fire (entity still Jul 25)', (await invCount('NY Client')) === 0, `count=${await invCount('NY Client')}`);
    A('  New-York next_run untouched (2026-07-26)', (await nrun(nyId)) === '2026-07-26', `next_run=${await nrun(nyId)}`);
    A('No-timezone row did NOT fire (UTC fallback = Jul 25 — byte-identical to pre-F88)', (await invCount('NoTZ Client')) === 0, `count=${await invCount('NoTZ Client')}`);
    A('  No-timezone next_run untouched (2026-07-26)', (await nrun(utcId)) === '2026-07-26', `next_run=${await nrun(utcId)}`);

    // ── control proves the scheduler ran at all ──
    A('NY control row (Jul 25) FIRED — scheduler is live', (await invCount('NY Control')) === 1, `count=${await invCount('NY Control')}`);
    A('  NY control next_run advanced 2026-07-25 → 2026-08-25', (await nrun(ctlId)) === '2026-08-25', `next_run=${await nrun(ctlId)}`);

    // ── idempotency: re-run creates no duplicates and does not now fire the still-future rows ──
    console.log('\n-- run #2 (idempotency) --');
    await app.runRecurringScheduler();
    A('re-run: Sydney still exactly 1 (advanced, no duplicate)', (await invCount('Sydney Client')) === 1, `count=${await invCount('Sydney Client')}`);
    A('re-run: NY control still exactly 1', (await invCount('NY Control')) === 1, `count=${await invCount('NY Control')}`);
    A('re-run: New-York Jul-26 row STILL did not fire', (await invCount('NY Client')) === 0, `count=${await invCount('NY Client')}`);
    A('re-run: no-timezone Jul-26 row STILL did not fire', (await invCount('NoTZ Client')) === 0, `count=${await invCount('NoTZ Client')}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (F88 scheduler per-entity boundary)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    try { if (appPool && appPool.end && !appPool.ended) await appPool.end(); } catch (_) {}
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[sched-tz] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
