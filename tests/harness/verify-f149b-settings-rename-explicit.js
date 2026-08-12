'use strict';
/**
 * verify-f149b-settings-rename-explicit.js (Rule 14, Rule 4 discriminating)
 *
 * F149-b (class-kill): a PUT /api/settings may rename the active ENTITY only when it explicitly
 * opts in with rename_active_entity:true. That flag is sent ONLY by the deliberate Settings-page
 * rename (saveSettings). Any other /api/settings write — including the old create flow, or any
 * future caller — carries business_name for the account profile WITHOUT renaming an entity.
 *
 * Server: server.js ~1733  `if (b.business_name && b.rename_active_entity === true) { rename activeEntity }`
 *
 * DISCRIMINATOR: the seed has one active entity with a known name. We issue two settings PUTs with
 * DIFFERENT business_name values so a wrong rename MOVES the name:
 *   1) business_name only (NO flag): active entity name must stay the seed name; but user_settings
 *      .business_name MUST update (profile still saved). Pre-fix this renamed the entity → FAIL.
 *   2) business_name + rename_active_entity:true: active entity name MUST become the new value.
 *
 * Run like the other verify-* harnesses (real scratch Postgres):
 *   node -r ./tests/harness/clock.js tests/harness/verify-f149b-settings-rename-explicit.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { http, client, userId, settle } = boot;
    await settle(10, 20);

    const entName = async () => (await client.query(
      `SELECT data->>'name' AS name FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [userId]
    )).rows[0].name;
    const settingsBizName = async () => (await client.query(
      `SELECT data->>'business_name' AS bn FROM user_settings WHERE user_id=$1 AND data->>'key' IS NULL LIMIT 1`, [userId]
    )).rows[0]?.bn;

    const orig = await entName();
    A('seed has one active entity with a name', !!orig, `orig="${orig}"`);
    const NOFLAG = orig + ' NOFLAG', FLAG = orig + ' FLAG';
    A('test names differ from seed (discriminates)', NOFLAG !== orig && FLAG !== orig);

    // 1) business_name WITHOUT the flag → profile updates, entity name does NOT move.
    const r1 = await http.put('/api/settings', { business_name: NOFLAG });
    A('PUT (no flag) → 200', r1.status === 200, `status=${r1.status} ${r1.text.slice(0,120)}`);
    await settle(3, 20);
    A('no-flag PUT did NOT rename the entity (bug renamed it here)', (await entName()) === orig, `entity now="${await entName()}"`);
    A('no-flag PUT DID persist the account profile business_name', (await settingsBizName()) === NOFLAG, `settings.business_name="${await settingsBizName()}"`);

    // 2) business_name WITH the flag → the deliberate rename renames the active entity.
    const r2 = await http.put('/api/settings', { business_name: FLAG, rename_active_entity: true });
    A('PUT (flag) → 200', r2.status === 200, `status=${r2.status} ${r2.text.slice(0,120)}`);
    await settle(3, 20);
    A('flagged PUT renamed the active entity (deliberate rename still works)', (await entName()) === FLAG, `entity now="${await entName()}"`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F149-b explicit-rename gate)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
