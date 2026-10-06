#!/usr/bin/env node
'use strict';
/**
 * verify-owner-salary-per-entity.js — N60. Saving the owner's salary for business B updates B's owner
 * payroll row — never business A's.
 *
 * Defect: savePersonalSalary (app-main.js — the only definition, so the runtime winner) looked up the
 * owner's existing row via /api/personal-salary, which returns owner rows of ALL entities, and PUT over
 * the first one. A multi-business owner saving B's salary overwrote A's owner payroll row (A's payroll
 * and expense changed; B kept the old figure).
 *
 * Executed: the real page code in jsdom against the real server + Postgres. Owner rows: A gross 5000,
 * B gross 7000. With B active, save 8000. Bug value stated:
 *   A's owner row stays 5000          (bug: 8000)
 *   B's owner row becomes 8000        (bug: stays 7000)
 *   node -r ./tests/harness/clock.js tests/harness/verify-owner-salary-per-entity.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot, eA = null, eB = null, rA = null, rB = null;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
        eA = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
        eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Salary B Co', currency: 'USD', is_active: 0, sort_order: 1 }])).rows[0].id;
        // Rule 4: /api/personal-salary lists newest first (created_at DESC), and the bug took row [0]. A's row is
        // the NEWER one, so the buggy code picks A while saving B — the seed must make the bug change a number.
        rB = (await c.query(`INSERT INTO payroll (user_id,entity_id,data,created_at) VALUES ($1,$2,$3,'2026-07-01T16:00:00Z') RETURNING id`, [uid, eB, { fname: 'Owner', lname: 'B', gross: 7000, deductions: [], is_owner: true }])).rows[0].id;
        rA = (await c.query(`INSERT INTO payroll (user_id,entity_id,data,created_at) VALUES ($1,$2,$3,'2026-07-02T16:00:00Z') RETURNING id`, [uid, eA, { fname: 'Owner', lname: 'A', gross: 5000, deductions: [], is_owner: true }])).rows[0].id;
      },
    });
    const { window, client: c, settle } = boot;
    await settle(80, 60);
    const bIdx = (window.ENTITIES || []).findIndex(e => e && e.name === 'Salary B Co');
    A('entity B present', bIdx >= 0);
    await window.switchEntity(bIdx); await settle(60, 60);
    window.document.getElementById('pers-sal-gross').value = '8000';
    await window.savePersonalSalary(); await settle(20, 30);
    const g = async (id) => Number((await c.query(`SELECT (data->>'gross')::numeric g FROM payroll WHERE id=$1`, [id])).rows[0].g);
    A("A's owner row stays 5000 (bug: overwritten to 8000)", (await g(rA)) === 5000, 'A gross=' + await g(rA));
    A("B's owner row becomes 8000 (bug: stays 7000)", (await g(rB)) === 8000, 'B gross=' + await g(rB));
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    if (boot) await boot.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (owner salary per entity)` : `  ALL GREEN — ${pass} passed, 0 failed  (owner salary per entity)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
