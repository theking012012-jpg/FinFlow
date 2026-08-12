'use strict';
/**
 * verify-f150d-entity-constraint.js (Rule 14)
 *
 * The storage-level guarantee: business tables carry CHECK (entity_id IS NOT NULL) NOT VALID, so a
 * business row can NEVER be stored account-wide (NULL) again — making the cross-entity leak
 * impossible at the database layer even if some future insert path forgets to stamp entity_id.
 *
 * Asserts:
 *   1) boot + full seed SUCCEED under the constraint (seed stamps entity_id on every business row).
 *   2) a raw INSERT with entity_id = NULL is REJECTED (Postgres check_violation, code 23514) on a
 *      representative set of business tables.
 *   3) the same INSERT WITH a real entity_id SUCCEEDS.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f150d-entity-constraint.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

const TABLES = ['invoices', 'expenses', 'customers', 'inventory', 'items', 'credit_notes', 'vendor_credits', 'sales_receipts', 'journals'];

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});         // reaching here at all proves boot+seed survived the constraint
    const { client, userId } = boot;
    A('boot + seed succeeded under the NOT NULL constraint', true);

    const eid = (await client.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [userId])).rows[0].id;

    for (const t of TABLES) {
      // NULL entity_id must be rejected.
      let rejected = false, code = null;
      try {
        await client.query(`INSERT INTO ${t} (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, '{}'::jsonb, NOW(), NOW())`, [userId]);
      } catch (e) { rejected = true; code = e.code; }
      A(`${t}: NULL entity_id INSERT rejected (check_violation 23514)`, rejected && code === '23514', `rejected=${rejected} code=${code}`);

      // Same insert WITH a real entity_id must succeed.
      let ok = false, err = null;
      try {
        await client.query(`INSERT INTO ${t} (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, '{}'::jsonb, NOW(), NOW())`, [userId, eid]);
        ok = true;
      } catch (e) { err = e.message; }
      A(`${t}: valid entity_id INSERT succeeds`, ok, err || '');
    }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F150d entity NOT NULL constraint)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
