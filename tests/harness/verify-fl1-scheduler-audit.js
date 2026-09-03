'use strict';
/**
 * verify-fl1-scheduler-audit.js — F-L1. Recurring-scheduler-created invoices/bills must be recorded in
 * the audit trail (they were inserted via db.insert with no recordAudit, so they bypassed it — the
 * audit trail's "last change" predated every auto-generated row).
 *
 * EXECUTED: drives the real runRecurringScheduler() against real Postgres, then asserts audit_trail
 * carries a CREATE row for the generated invoice AND bill. Discriminating: pre-fix count = 0.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fl1-scheduler-audit.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    A('runRecurringScheduler exported', typeof app.runRecurringScheduler === 'function');

    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'fl1-owner@finflow.test', name: 'FL1 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'FL1 Co', currency: 'USD', is_active: 1, sort_order: 0 }])).rows[0].id;
    const mkRecur = async (table, data) => (await c.query(`INSERT INTO ${table} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`, [uid, eid, data])).rows[0].id;

    await mkRecur('recurring_invoices', { status: 'active', frequency: 'monthly', next_run: '2026-07-01', client: 'Audited Client', amount: 500, entity_id: eid, user_id: uid });
    await mkRecur('recurring_bills',    { status: 'active', frequency: 'monthly', next_run: '2026-07-10', vendor: 'Audited Vendor', amount: 300, entity_id: eid, user_id: uid });

    await app.runRecurringScheduler();

    const invId = (await c.query(`SELECT id FROM invoices WHERE data->>'client'='Audited Client' LIMIT 1`)).rows[0];
    const billId = (await c.query(`SELECT id FROM bills WHERE data->>'vendor'='Audited Vendor' LIMIT 1`)).rows[0];
    A('scheduler created the invoice', !!invId, 'no invoice row');
    A('scheduler created the bill', !!billId, 'no bill row');

    const invAudit = Number((await c.query(`SELECT COUNT(*) n FROM audit_trail WHERE table_name='invoices' AND action='CREATE' AND record_id=$1`, [invId && invId.id])).rows[0].n);
    const billAudit = Number((await c.query(`SELECT COUNT(*) n FROM audit_trail WHERE table_name='bills' AND action='CREATE' AND record_id=$1`, [billId && billId.id])).rows[0].n);
    A('audit_trail has a CREATE row for the scheduler-generated INVOICE', invAudit >= 1, `count=${invAudit}`);
    A('audit_trail has a CREATE row for the scheduler-generated BILL', billAudit >= 1, `count=${billAudit}`);
    // system actor (no req)
    const actor = (await c.query(`SELECT actor_type FROM audit_trail WHERE table_name='invoices' AND action='CREATE' AND record_id=$1 LIMIT 1`, [invId && invId.id])).rows[0];
    A('scheduler audit row is actor_type=system', actor && actor.actor_type === 'system', `actor=${actor && actor.actor_type}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-L1 scheduler audit)`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
