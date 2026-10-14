'use strict';
/**
 * verify-la2-boot-after-parse.js — LA2 (live audit 2026-10-13; named 2026-10-14). Every live boot logged 7 ×
 * "[boot] a deferred render hook threw … Cannot set properties of null" (5 textContent, 2 innerHTML).
 *
 * Mechanism (reproduced in real Chromium): the production page (SLIM_APP, public/_gen/index.html) loads app-main.js,
 * then 21 BLOCKING /_gen/app-NN.js scripts, then — last — the lazy-screen hook; the code bundle is `defer`. app-main's
 * boot check (initEnhancements → /api/me) fired `ff:authed` the moment /api/me answered, which on a real network is
 * while the parser is still waiting on those scripts. The boot render hooks (_heavyInit) then ran:
 *   - before the lazy hook existed → getElementById on a not-yet-hydrated screen returned null → threw; and
 *   - before the deferred bundle ran → `renderPayroll`, `renderInvoices`, … resolved to the SHADOWED app-main copies
 *     (stack frames app-main.js:2595 renderInvoices, :2867 renderPayroll) — dead code executing at every boot.
 * Same race as F50 / F50 REOPEN / F97 (index.html patched it three times with after-the-fact re-fire nets).
 * Root fix: initEnhancements still starts /api/me at once, but acts on it only after DOMContentLoaded (parser done ⇒
 * lazy hook installed; deferred bundle executed) — so nothing listening to ff:authed can run against a half-built page.
 *
 * Real Chromium, real scratch Postgres, the production build. Each /_gen/app-NN.js is delayed 250 ms (network latency;
 * on localhost they arrive instantly and the race never shows — which is why every earlier harness was green).
 * Seed = clientMoneyKit (hand-computed: Invoices Outstanding 1,270).
 *   deferred-hook errors on first load and on a hard reload        0      bug: > 0 — timing-dependent (pre-fix here 3 / 5; live 7)
 *   Invoices "Outstanding" after opening the page                  $1,270 (the boot render's data is right)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la2-boot-after-parse.js
 */
process.env.SLIM_APP = '1';
const { runBrowser } = require('./browserKit.js');
const { seed } = require('./clientMoneyKit.js');

runBrowser('LA2 — boot render hooks run only after the page is fully parsed (production build, real network latency)', async ({ open, eq, A, http, c, uid }) => {
  const DELAY = +(process.env.LA2_DELAY_MS || 250);
  const errs = [];
  const page = await open({ width: 1280, height: 800, beforeGoto: async (ctx, pg) => {
    await ctx.route(/\/_gen\/app-\d+\.js/, async r => { await new Promise(res => setTimeout(res, DELAY)); r.continue(); });
    pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  } });
  const hookErrs = () => errs.filter(e => /deferred render hook threw|Cannot set properties of null/.test(e));
  await page.waitForTimeout(8000);
  const slim = await page.evaluate(() => document.querySelectorAll('template[data-lz]').length);
  A('served document is the production (SLIM) build — lazy screens present', slim > 20, 'lazy templates=' + slim);
  eq('first load: deferred render hooks that threw', hookErrs().length, 0, '> 0 (pre-fix here: 3; live: 7)');
  hookErrs().slice(0, 7).forEach(e => console.log('          ' + e.replace(/\s+/g, ' ').slice(0, 220)));

  errs.length = 0;
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(9000);
  eq('hard reload: deferred render hooks that threw', hookErrs().length, 0, '> 0 (pre-fix here: 5; live: 7)');
  hookErrs().slice(0, 7).forEach(e => console.log('          ' + e.replace(/\s+/g, ' ').slice(0, 220)));

  await page.evaluate(() => window.showPage('invoices'));
  await page.waitForTimeout(1500);
  const out = await page.evaluate(() => (document.getElementById('inv-out') || {}).textContent);
  eq('Invoices Outstanding (hand-computed 1,000 + 350 − 80)', out, '$1,270');
}, { seed: async ({ http, c, uid }) => { await seed({ http, client: c, userId: uid }); } });
