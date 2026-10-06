#!/usr/bin/env node
'use strict';
/**
 * verify-client-accountant-xss.js — accountant-controlled text (name, firm, country, specialisation,
 * experience) renders as TEXT in the client's own app — directory cards and My Accountant.
 *
 * Defect: the marketplace block interpolated accountant fields raw into innerHTML, and put the name
 * inside onclick="requestAccountant(id,'<name>')" — an accountant registering with markup in their name
 * ran script in every client's FinFlow session that opened the directory (stored XSS against clients,
 * acting with their session), and a quote in the name broke out of the JS string.
 *
 * Executed: the real SPA in jsdom against the real server + Postgres. Accountant A (linked, active) and
 * accountant B (directory only) carry live payloads. Bug value stated:
 *   window.__xss never set                                     (bug: set by onerror)
 *   no <img>/<b> elements injected in directory or My Accountant (bug: present)
 *   the payload text is visible as text                         (proves it still renders)
 *   clicking "Request access" on B passes B's exact name        (bug: JS string broken by the quote)
 *   node -r ./tests/harness/clock.js tests/harness/verify-client-accountant-xss.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

const XSS_IMG = '<img src=x onerror="window.__xss=1">Ada';
const BREAK = "Bob'); window.__xss2=1; ('";

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot, accB = null;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        const h = bcrypt.hashSync('x', 4);
        const accA = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, country, specialisation, experience, referral_code, status)
          VALUES ('xss-a@finflow.test', $1, $2, 'Lovelace', '<b>Evil Firm</b>', '<i>TT</i>', '<u>Tax</u>', '<s>10y</s>', 'XSSA1', 'verified') RETURNING id`, [h, XSS_IMG])).rows[0].id;
        accB = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, country, specialisation, referral_code, status)
          VALUES ('xss-b@finflow.test', $1, $2, 'Builder', 'B Firm', 'US', 'Audit', 'XSSB1', 'verified') RETURNING id`, [h, BREAK])).rows[0].id;
        await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, requested_by) VALUES ($1,$2,'active','client')`, [accA, uid]);
      },
    });
    const { window, settle } = boot;
    const doc = window.document;
    let got = null;
    for (let i = 0; i < 60; i++) {
      const grid = doc.getElementById('acc-directory-grid'), mine = doc.getElementById('my-acc-content');
      if (grid && /Builder/.test(grid.innerHTML) && mine && /Lovelace/.test(mine.innerHTML)) { got = { grid, mine }; break; }
      await settle(5);
    }
    console.log('\n' + '='.repeat(78));
    console.log('  CLIENT APP — accountant text is rendered as text');
    console.log('='.repeat(78));
    A('directory and My Accountant rendered', !!got);
    const grid = doc.getElementById('acc-directory-grid'), mine = doc.getElementById('my-acc-content');
    await settle(10);
    A('onerror never fired (window.__xss unset)', !window.__xss);
    A('no injected <img>/<b>/<i>/<u> in the directory (bug: present)', grid && !grid.querySelector('img, b, i, u, s'), grid && grid.innerHTML.slice(0, 200));
    A('no injected <img>/<b>/<i>/<u>/<s> in My Accountant (bug: present)', mine && !mine.querySelector('img, b, i, u, s'), mine && mine.innerHTML.slice(0, 200));
    A('payload visible as text in My Accountant', mine && mine.textContent.includes('<img src=x') && mine.textContent.includes('<b>Evil Firm</b>'), mine && mine.textContent.slice(0, 160));
    const calls = [];
    window.requestAccountant = async (id, name) => { calls.push([id, name]); };
    const btn = grid && [...grid.querySelectorAll('button')].find(b => /Request access/.test(b.textContent) && (b.getAttribute('onclick') || '').includes(String(accB)));
    A('Request access button for B present', !!btn, grid && grid.innerHTML.slice(0, 300));
    if (btn) { try { btn.click(); } catch (_) {} }
    await settle(5);
    A('clicking it passes B\'s exact name (bug: JS string broken by the quote)', calls.length === 1 && calls[0][0] === accB && calls[0][1] === BREAK + ' Builder', JSON.stringify(calls));
    A('the quote never executed code (window.__xss2 unset)', !window.__xss2);
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    if (boot) await boot.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (client accountant XSS)` : `  ALL GREEN — ${pass} passed, 0 failed  (client accountant XSS)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
