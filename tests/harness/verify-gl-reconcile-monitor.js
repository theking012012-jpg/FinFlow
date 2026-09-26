#!/usr/bin/env node
'use strict';
/**
 * verify-gl-reconcile-monitor.js — the GL safety-net scan classifies ledger health correctly.
 *
 * Closes the class of bug that hid the empty prod ledger: an account whose books have activity but
 * whose ledger is empty (or diverges) must be SURFACED, not silent.
 *   - an entity with invoices but NO backfill → status 'not_backfilled'
 *   - after backfill → status 'ok', zero divergent
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-reconcile-monitor.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const { glReconcileScan, backfillLedgerForUser } = require('../../server.js');

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'rec-mon@finflow.test', name: 'RM', plan: 'business', role: 'owner', base_currency: 'USD', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Co', currency: 'USD' }])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-10T09:00:00Z',NOW())`,
      [uid, eid, { client: 'A', amount: 5000, status: 'pending', issue_date: '2026-06-10' }]);

    // Before backfill: books have activity, ledger empty → the scan must flag not_backfilled (NOT ok).
    const before = await glReconcileScan();
    const mine = () => 0; // placeholder
    const beforeMine = (before.notBackfilled || []).filter(x => x.entityId === eid);
    A('scan flags the un-backfilled entity as not_backfilled', beforeMine.length === 1, JSON.stringify(before.notBackfilled));
    A('scan does NOT count it as divergent (it is empty, not wrong)', !(before.divergent || []).some(x => x.entityId === eid), JSON.stringify(before.divergent));

    // Backfill → the entity now ties → scan shows it ok, nothing divergent.
    await backfillLedgerForUser(uid, { entityId: eid });
    const after = await glReconcileScan();
    A('after backfill the entity is no longer flagged not_backfilled', !(after.notBackfilled || []).some(x => x.entityId === eid), JSON.stringify(after.notBackfilled));
    A('after backfill nothing is divergent', (after.divergent || []).length === 0, JSON.stringify(after.divergent));
    A('scan reports a scanned count and an okCount', typeof after.scanned === 'number' && typeof after.okCount === 'number' && after.okCount >= 1, JSON.stringify({ scanned: after.scanned, ok: after.okCount }));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (GL reconcile safety-net classifies ledger health)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[rec-mon] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
