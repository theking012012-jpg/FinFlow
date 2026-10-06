#!/usr/bin/env node
'use strict';
/**
 * verify-timesheet-switch-reload.js — switching the active entity reloads the timesheet, so the page
 * never shows the previous entity's hours. EXECUTED (replaces the [STRUCTURAL] source-slice check in
 * verify-timesheet-entity-scope.js, which read a fixed 6000-character window of switchEntity's source
 * and went red once the function grew — while the behaviour itself was intact; Rule 5).
 *   real SPA in jsdom, real server + Postgres; entity A has entry "A-hours", entity B "B-hours"
 *   switch to B → window.timesheet = [B-hours] only; switch back to A → [A-hours] only
 *   node -r ./tests/harness/clock.js tests/harness/verify-timesheet-switch-reload.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
        const eA = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
        const eB = (await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2) RETURNING id`, [uid, { name: 'TS B Co', currency: 'USD', is_active: 0, sort_order: 1 }])).rows[0].id;
        await c.query(`INSERT INTO timesheet (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eA, { employee: 'A-hours', hours: 3, date: '2026-07-10' }]);
        await c.query(`INSERT INTO timesheet (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eB, { employee: 'B-hours', hours: 5, date: '2026-07-10' }]);
      },
    });
    const { window, settle } = boot;
    await settle(80, 60);
    const ents = window.ENTITIES || [];
    const bIdx = ents.findIndex(e => e && e.name === 'TS B Co'), aIdx = ents.findIndex(e => e && e.name !== 'TS B Co');
    A('both entities present', aIdx >= 0 && bIdx >= 0, ents.map(e => e && e.name).join(','));
    const names = () => (window.timesheet || []).map(r => r.employee).sort().join(',');
    await window.switchEntity(bIdx); await settle(60, 60);
    A('after switching to B: timesheet = [B-hours] only', names() === 'B-hours', 'timesheet=' + names());
    await window.switchEntity(aIdx); await settle(60, 60);
    A('after switching back to A: timesheet = [A-hours] only', names() === 'A-hours', 'timesheet=' + names());
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    if (boot) await boot.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (timesheet reload on entity switch)` : `  ALL GREEN — ${pass} passed, 0 failed  (timesheet reload on entity switch)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
