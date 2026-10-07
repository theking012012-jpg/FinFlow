#!/usr/bin/env node
'use strict';
/**
 * verify-account-switch-ui.js — N36, UI half. The "accounts you can access" card offers a Switch button
 * for every account other than the current one, and clicking it moves the session (real page code in
 * jsdom against the real server + Postgres; the post-switch page reload is not followed by jsdom).
 *   card shows a Switch button for the joined account               (bug: no button — no switcher)
 *   click → the session now works in that account (my-access)       (bug: n/a)
 *   node -r ./tests/harness/clock.js tests/harness/verify-account-switch-ui.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot, other = null;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        other = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'swui-o@finflow.test', name: 'Other Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 4) }])).rows[0].id;
        await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [other, { name: 'Other Co', currency: 'USD', is_active: 1 }]);
        const em = (await c.query(`SELECT data->>'email' e FROM users WHERE id=$1`, [uid])).rows[0].e;
        await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [other, { email: em, role: 'admin', status: 'active', member_user_id: String(uid) }]);
      },
    });
    const { window, settle } = boot;
    await settle(40);
    await window.loadMyAccess(); await settle(10);
    const list = window.document.getElementById('my-access-list');
    const btn = list && [...list.querySelectorAll('button')].find(b => /Switch/.test(b.textContent) && (b.getAttribute('onclick') || '').includes(String(other)));
    A('card shows a Switch button for the joined account (bug: no switcher)', !!btn, list && list.innerHTML.slice(0, 300));
    try { Object.defineProperty(window.location, 'reload', { value: () => {}, configurable: true }); } catch (_) {}
    if (btn) { btn.click(); await settle(20); }
    const acc = await (await window.fetch('/api/my-access', { credentials: 'include' })).json();
    A('after clicking: the session works in the joined account', acc.currentAccountId === other && acc.scopedIntoOther === true, JSON.stringify(acc));
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    if (boot) await boot.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (account switch UI)` : `  ALL GREEN — ${pass} passed, 0 failed  (account switch UI)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
