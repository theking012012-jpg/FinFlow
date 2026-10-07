#!/usr/bin/env node
'use strict';
/**
 * verify-vendors-payables-ui.js — N24b (Rule 2). The Vendors page "payables" card shows the same accounts payable
 * as the Balance Sheet: recognised bills issued on or before today, less open/applied vendor credits.
 *
 * Defect: the card was recomputed in the browser from the bills list — every non-paid bill, future-dated ones
 * included, vendor credits ignored — a second AP implementation that disagreed with the balance sheet.
 *
 * Executed through the real SPA in jsdom against the real server + Postgres. Base VERIFICATION seed
 * (owner-supplied: B0 300 + B1 800 unpaid, VC-1 300 open → apNet 800) plus one unpaid bill 250 issued
 * 2026-08-20 (after today, 2026-07-25 — not yet recognised).
 *   Vendors payables card = 800              (bug: 1350 = 300 + 800 + 250, vendor credit ignored)
 *   node -r ./tests/harness/clock.js tests/harness/verify-vendors-payables-ui.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const EXPECTED = require('./expected.js');

process.on('uncaughtException', (e) => {
  const s = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(s)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        const eid = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
        await c.query(`INSERT INTO bills (user_id,entity_id,data) VALUES ($1,$2,$3)`,
          [uid, eid, { vendor: 'Future Supplies', amount: 250, amount_paid: 0, status: 'unpaid', issue_date: '2026-08-20', due_date: '2026-09-20', num: 'B-FUT' }]);
      },
    });
    const { window, settle } = boot;
    const apNet = (EXPECTED.BALANCES || EXPECTED.balances || {}).apNet;
    A('owner-supplied expectation present (apNet 800)', apNet === 800, 'apNet ' + apNet);

    console.log('\n' + '='.repeat(78));
    console.log('  VENDORS PAGE — payables card = the balance sheet\'s accounts payable');
    console.log('='.repeat(78));
    if (typeof window.navigateTo === 'function') { try { window.navigateTo('vendors'); } catch (_) {} }
    for (let i = 0; i < 100 && typeof window.renderVendors !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    window.renderVendors();
    await settle(12, 80);
    window.renderVendors();   // once the vendors / bills lists are loaded
    await settle(12, 80);
    const cards = Array.from(window.document.querySelectorAll('#page-vendors .mc-val')).map(e => e.textContent.trim());
    const want = typeof window.S === 'function' ? window.S(800) : '800';
    const bug = typeof window.S === 'function' ? window.S(1350) : '1350';
    A(`payables card = ${want} (bug: ${bug} — future bill counted, vendor credit ignored)`, cards[1] === want, JSON.stringify(cards));
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally { if (boot) { try { await boot.stop(); } catch (_) {} } }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (vendors payables UI)` : `  ALL GREEN — ${pass} passed, 0 failed  (vendors payables UI)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
