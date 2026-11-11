'use strict';
/**
 * verify-n3-7-unlink-confirm.js — N3-7 (live re-audit 2026-11-11).
 * Unlinking a bank feed was ONE click with no confirmation — business (ffBankUnlink) and personal (ffPersBankUnlink,
 * Plaid "Unlink" and Belvo "Disconnect"). It stops the feed for good (re-linking is a new bank sign-in).
 * Expected: the app's danger dialog opens; Cancel → NO unlink request reaches the server; Unlink → exactly one.
 * Bug values: the request goes out immediately (1 request with no dialog, also on the "cancel" path).
 * Real SPA (jsdom) against the real server; requests counted at the page's own fetch.
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-7 — unlinking a bank asks first; Cancel sends nothing\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: true });
    const { window: w, settle } = ctx;
    await settle(30, 100);
    const sent = [];
    const realFetch = w.fetch.bind(w);
    w.fetch = function (input, init) { const u = String(input && input.url || input); if (/\/api\/(plaid\/unlink|belvo\/disconnect)/.test(u)) sent.push(u); return realFetch(input, init); };
    const dialog = () => w.document.getElementById('_confirm-yes');
    for (const [label, call] of [
      ['business ffBankUnlink', () => w.ffBankUnlink('item-test')],
      ['personal Plaid ffPersBankUnlink', () => w.ffPersBankUnlink('plaid', 'item-test')],
      ['personal Belvo disconnect', () => w.ffPersBankUnlink('belvo')],
    ]) {
      sent.length = 0;
      let p = call(); await sleep(150);
      const shown = !!dialog();
      A(label + ': a confirmation dialog opens (bug: none)', shown, 'dialog=' + shown + ' sent=' + sent.length);
      if (shown) w.document.getElementById('_confirm-no').click();
      await p; await sleep(150);
      A(label + ': Cancel → no unlink request (bug: 1)', sent.length === 0, 'sent=' + JSON.stringify(sent));
      sent.length = 0;
      p = call(); await sleep(150);
      if (dialog()) dialog().click();
      await p; await sleep(300);
      A(label + ': Unlink → exactly one request', sent.length === 1, 'sent=' + JSON.stringify(sent));
    }
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-7 unlink confirm)'));
  process.exit(fail ? 1 : 0);
})();
