#!/usr/bin/env node
'use strict';
/**
 * verify-lock-password-ui.js — N19, UI half. Turning off a password-protected lock without the password
 * shows the server's refusal; it used to toast "Lock settings saved ✦" whatever the server answered.
 * Executed: the real saveLockSettings (app-main.js — no wiring override) in jsdom against the real
 * server + Postgres.
 *   untick "lock", no password, Save → toast is the refusal, lock still enabled in DB  (bug: "saved")
 *   control: with the password → "saved", lock disabled
 *   node -r ./tests/harness/clock.js tests/harness/verify-lock-password-ui.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot, uid = null, eid = null;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, u) => {
        uid = u;
        eid = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [u])).rows[0].id;
        await c.query(`INSERT INTO lock_settings (user_id, entity_id, data) VALUES ($1,$2,$3)`, [u, eid, { enabled: 1, lock_date: '2026-06-30', password_hash: bcrypt.hashSync('ui-lock-pw', 4) }]);
      },
    });
    const { window, client: c, settle, toast } = boot;
    await settle(40);
    const doc = window.document;
    const enabled = async () => Number((await c.query(`SELECT (data->>'enabled')::int e FROM lock_settings WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0].e);
    console.log('\n' + '='.repeat(78));
    console.log('  LOCK SETTINGS UI — refusal is shown');
    console.log('='.repeat(78));
    doc.getElementById('lock-enabled').checked = false;
    doc.getElementById('lock-date').value = '2026-06-30';
    doc.getElementById('lock-password').value = '';
    await window.saveLockSettings(); await settle(10);
    const t1 = toast();
    A('no password → toast shows the refusal, not "saved" (bug: "Lock settings saved")', t1.text && !/saved/i.test(t1.text) && /password/i.test(t1.text), JSON.stringify(t1));
    A('  lock still enabled in the database', (await enabled()) === 1);
    A('  the page re-shows the lock as ON after the refusal (reflects the server)', doc.getElementById('lock-enabled').checked === true);
    doc.getElementById('lock-enabled').checked = false;
    doc.getElementById('lock-password').value = 'ui-lock-pw';
    await window.saveLockSettings(); await settle(10);
    A('control: with the password → "saved", lock disabled', /saved/i.test(toast().text || '') && (await enabled()) === 0, JSON.stringify(toast()));
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    if (boot) await boot.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (lock password UI)` : `  ALL GREEN — ${pass} passed, 0 failed  (lock password UI)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
