#!/usr/bin/env node
'use strict';
/**
 * verify-g16-recurring-terms.js (G16, owner decision 2026-11-01) — a document a recurring schedule generates is due on
 * its scheduled issue date + the business's payment terms (the same rule as every other invoice / bill —
 * invoiceDueFromTerms), THEN moved onto a business day for the entity's country (F88 step 6, Modified Following).
 * Before: due on the run date itself (business-day shifted), so recurring documents ignored the business's terms.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-g16-recurring-terms.js
 *
 * Drives the REAL runRecurringScheduler() against a scratch Postgres (Rule 3). Expected values are calendar
 * arithmetic done by hand (Rule 6), each with the value the old code gives (Rule 4):
 *   Net 14 (US): invoice run Wed 2026-07-01 → due Wed 2026-07-15            (bug: 2026-07-01)
 *   Net 14 (US): invoice run Sat 2026-07-04 → 07-18 is a Saturday → Mon 07-20 (bug: 2026-07-06 — the run date shifted)
 *   Net 14 (US): bill run Fri 2026-07-10 → due Fri 2026-07-24              (bug: 2026-07-10)
 *   no terms set (30), no country: invoice run 2026-07-02 → Sat 2026-08-01, raw (no country ⇒ no shift) (bug: 2026-07-02)
 *   Net 0 (US) — due on receipt: invoice run Sat 2026-07-18 → Mon 2026-07-20 (control: unchanged behaviour)
 * And the issue date stays the scheduled date (2026-07-01) — only the due date moves.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const eq = (name, got, want, bug) => A(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` + (bug ? `  (the old code gives ${JSON.stringify(bug)})` : ''));

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  G16 — recurring documents are due on issue + payment terms\n' + '='.repeat(78));
    eq('pinned clock is 2026-07-25', new Date().toISOString().slice(0, 10), '2026-07-25');

    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'g16@finflow.test', name: 'G16 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const ent = async (data) => (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, data])).rows[0].id;
    const e14 = await ent({ name: 'Net14 Co', currency: 'USD', country: 'US', payment_terms: 14, is_active: 1, sort_order: 0 });
    const eDef = await ent({ name: 'Default Co', currency: 'USD', is_active: 0, sort_order: 1 });
    const e0 = await ent({ name: 'Net0 Co', currency: 'USD', country: 'US', payment_terms: 0, is_active: 0, sort_order: 2 });
    const rec = async (table, eid, data) => c.query(`INSERT INTO ${table} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, eid, { status: 'active', frequency: 'monthly', user_id: uid, entity_id: eid, ...data }]);
    await rec('recurring_invoices', e14, { next_run: '2026-07-01', client: 'G16 Wed', amount: 101 });
    await rec('recurring_invoices', e14, { next_run: '2026-07-04', client: 'G16 Sat', amount: 102 });
    await rec('recurring_bills', e14, { next_run: '2026-07-10', vendor: 'G16 Vendor', amount: 103 });
    await rec('recurring_invoices', eDef, { next_run: '2026-07-02', client: 'G16 Default', amount: 104 });
    await rec('recurring_invoices', e0, { next_run: '2026-07-18', client: 'G16 Receipt', amount: 105 });

    await app.runRecurringScheduler();

    const inv = async (client) => (await c.query(`SELECT data->>'issue_date' AS i, data->>'due_date' AS d, count(*) OVER () AS n FROM invoices WHERE data->>'client'=$1`, [client])).rows;
    const bill = async (vendor) => (await c.query(`SELECT data->>'due_date' AS d FROM bills WHERE data->>'vendor'=$1`, [vendor])).rows;

    const w = await inv('G16 Wed');
    eq('Net 14: one invoice generated', w.length, 1);
    eq('Net 14: issue date stays the scheduled date', w[0] && w[0].i, '2026-07-01');
    eq('Net 14: run Wed 2026-07-01 → due 2026-07-15', w[0] && w[0].d, '2026-07-15', '2026-07-01');
    const s = await inv('G16 Sat');
    eq('Net 14: run Sat 2026-07-04 → 07-18 (Sat) → Mon 2026-07-20', s[0] && s[0].d, '2026-07-20', '2026-07-06');
    const b = await bill('G16 Vendor');
    eq('Net 14: recurring BILL run 2026-07-10 → due 2026-07-24 (same rule as a bill entered by hand)', b[0] && b[0].d, '2026-07-24', '2026-07-10');
    const d = await inv('G16 Default');
    eq('no terms set → 30 days; no country → no shift: run 2026-07-02 → 2026-08-01', d[0] && d[0].d, '2026-08-01', '2026-07-02');
    const r = await inv('G16 Receipt');
    eq('control — Net 0 (due on receipt): run Sat 2026-07-18 → Mon 2026-07-20, as before', r[0] && r[0].d, '2026-07-20');

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (G16 recurring due = issue + terms)` : `  ${fail} FAILED, ${pass} passed`);
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    try { if (appPool && appPool.end && !appPool.ended) await appPool.end(); } catch (_) {}
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('[g16] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
