#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-consent-ui.js — N78, client side. A user with a pending REFERRAL link sees an
 * "Approve access" button on My Accountant, and clicking it (the real page code, in jsdom, against the
 * real server + Postgres) activates the link. Before the fix the page only said "awaiting approval from
 * this accountant" — the client had no way to consent, and the accountant activated it alone.
 *   referral link: My Accountant shows "Approve access"           (bug: no button; "awaiting … accountant")
 *   click Approve access → link active in the database              (bug: no such action)
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-consent-ui.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot, accId = null, userId = null;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        userId = uid;
        accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
          VALUES ('ui-acc@finflow.test', $1, 'Rita', 'Referrer', 'Ref Firm', 'UIREF1', 'verified') RETURNING id`, [bcrypt.hashSync('x', 4)])).rows[0].id;
        await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, referral_months_total, requested_by) VALUES ($1,$2,'pending',3,'referral')`, [accId, uid]);
      },
    });
    const { window, client: c, settle } = boot;
    await settle(40);
    console.log('\n' + '='.repeat(78));
    console.log('  MY ACCOUNTANT — the client approves a referral link');
    console.log('='.repeat(78));
    if (typeof window.showPage === 'function') { try { window.showPage('my-accountant'); } catch (_) {} }
    await settle(20);
    // The page loads the link itself (ff:authed → loadDirectory → loadMyAccountant); wait for it.
    let content = null;
    for (let i = 0; i < 40; i++) { content = window.document.getElementById('my-acc-content'); if (content && /Rita/.test(content.innerHTML)) break; await settle(5); }
    const html = content ? content.innerHTML : '';
    const btn = content && [...content.querySelectorAll('button')].find(b => /Approve access/.test(b.textContent));
    A('My Accountant shows "Approve access" for the referral link (bug: none)', !!btn, html.replace(/\s+/g, ' ').slice(0, 300));
    A('copy explains the referral, not "awaiting approval from this accountant"', /referral link/.test(html) && !/awaiting approval from this accountant/.test(html));
    if (btn) { btn.click(); await settle(40); }
    const st = (await c.query(`SELECT status FROM accountant_clients WHERE accountant_id=$1 AND user_id=$2`, [accId, userId])).rows[0];
    A('clicking Approve access activates the link (bug: stays pending)', st && st.status === 'active', JSON.stringify(st));
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    if (boot) await boot.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant consent UI)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant consent UI)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
