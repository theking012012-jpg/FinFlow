'use strict';
/* verify-f94-resolved-dates.js — F94 Phase B2: the Scheduled-Documents radar shows the TRUE post day.
 *
 * A recurring row's `next_run` is the schedule anchor, but it actually posts on
 * businessDayShift(next_run, entityCountry) — F88 "Modified Following" off weekends + that country's
 * public holidays. That shift needs `date-holidays` (server-only), so the server now annotates each
 * recurring row with `resolved_post_date` + `post_shifted` (server.js annotateResolvedPostDate), and
 * finflow-f94.js places the item on the RESOLVED day and shows "moved from <nominal>" — the browser
 * never re-implements the shift (Rule 10).
 *
 * Two layers, so this runs meaningfully everywhere:
 *   • CLIENT (jsdom, always runs): seed rows carrying resolved_post_date and assert the agenda groups the
 *     item under the resolved day, shows the "moved from" note, and does NOT place it on the nominal day.
 *   • SERVER helper (runs when server.js + its deps load; skips cleanly otherwise — covered by the full
 *     sweep regardless): annotateResolvedPostDate shifts weekend rows, leaves weekdays/no-country rows
 *     untouched, and passes junk through.
 *
 * Discriminating (Rule 14): before B2, finflow-f94.js placed the item on the raw next_run (a Saturday
 * group header, no "moved from" note) — the asserts below flip on that old behaviour.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f94-resolved-dates.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const FinFlowDates = require(path.join(ROOT, 'public', 'finflow-dates.js'));

// Fixed calendar facts (no oracle needed): Aug 1 2026 is a Saturday, so Aug 15 = Sat, 17 = Mon, 19 = Wed.
const NOMINAL_WEEKEND = '2026-08-15';   // Saturday
const RESOLVED_MONDAY = '2026-08-17';   // Modified Following → next business day, same month
const WEEKDAY_UNSHIFTED = '2026-08-19'; // Wednesday — a business day, resolved === nominal

(async () => {
  let pass = 0, fail = 0, skip = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const SKIP = (n) => { skip++; console.log('  SKIP  ' + n); };
  try {
    // ── CLIENT LAYER (always runs) ──────────────────────────────────────────────
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app' });
    const { window } = dom;
    const doc = window.document;

    window.FinFlowDates = FinFlowDates;
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    window.ENTITIES = [{ _dbId: 10, name: 'US Co', currency: 'USD', timezone: 'America/New_York', country: 'US', active: true }];
    // Rows carry what the server now returns: resolved_post_date + post_shifted alongside next_run.
    window.recurringInvoices = [
      { id: 1, entity_id: 10, client: 'Weekend Retainer', amount: 5000, next_run: NOMINAL_WEEKEND, resolved_post_date: RESOLVED_MONDAY, post_shifted: true, frequency: 'Monthly', status: 'active', end_date: null },
      { id: 2, entity_id: 10, client: 'Midweek Retainer', amount: 3000, next_run: WEEKDAY_UNSHIFTED, resolved_post_date: WEEKDAY_UNSHIFTED, post_shifted: false, frequency: 'Monthly', status: 'active', end_date: null },
    ];
    window.recurringBills = [];
    window.recurringPersonal = [];
    window._realInvoices = [];
    window.bills = [];
    window._allPersTxs = [];
    window._isScheduled = () => false;

    window.eval(fs.readFileSync(path.join(ROOT, 'public', 'finflow-f94.js'), 'utf8'));
    if (typeof window._f94Open !== 'function') { try { doc.dispatchEvent(new window.Event('DOMContentLoaded')); } catch (_) {} }
    await window._f94Open();
    await new Promise((r) => setTimeout(r, 10));

    const agenda = () => (doc.getElementById('f94-agenda') || {}).innerHTML || '';

    // the shifted item is grouped under the RESOLVED day (17 Aug), never the nominal Saturday (15 Aug)
    A('shifted item is grouped under the resolved post day (17 Aug)', agenda().indexOf('class="date">17 Aug<') !== -1, 'agenda=' + agenda().slice(0, 400));
    A('shifted item is NOT placed on its nominal weekend day (no 15 Aug day-group)', agenda().indexOf('class="date">15 Aug<') === -1);
    A('shifted item shows the "moved from <nominal>" note', /moved from 15 Aug/.test(agenda()), 'agenda=' + agenda().slice(0, 500));
    A('the shifted row still shows its party', /Weekend Retainer/.test(agenda()));

    // the weekday item is untouched: on its own day, no "moved from" note
    A('weekday item is grouped on its own day (19 Aug)', agenda().indexOf('class="date">19 Aug<') !== -1);
    A('exactly one "moved from" note appears (only the shifted row)', (agenda().match(/moved from/g) || []).length === 1, 'count=' + (agenda().match(/moved from/g) || []).length);

    // ── SERVER-HELPER LAYER (runs when server.js loads; else SKIP — full sweep still covers it) ──
    // server.js hard-exits at load if SESSION_SECRET is unset; set harness-only fallbacks so this can
    // require it standalone. The values are never used — annotateResolvedPostDate touches no DB.
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'harness-only-secret';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/none';
    let serverMod = null;
    try { serverMod = require(path.join(ROOT, 'server.js')); }
    catch (e) { SKIP('server.js not loadable in this environment (' + (e.code || e.message) + ') — annotateResolvedPostDate is covered by the full sweep'); }
    if (serverMod && typeof serverMod.annotateResolvedPostDate === 'function') {
      const ann = serverMod.annotateResolvedPostDate;
      const cmap = new Map([[10, 'US']]);
      const out = ann([
        { id: 1, entity_id: 10, next_run: NOMINAL_WEEKEND },   // Sat → Mon
        { id: 2, entity_id: 10, next_run: WEEKDAY_UNSHIFTED },  // Wed → unchanged
        { id: 3, entity_id: null, next_run: NOMINAL_WEEKEND },  // no country → unchanged
        null,                                                   // junk passes through
        { id: 4, entity_id: 10 },                               // no next_run → untouched
      ], cmap);
      A('annotate: weekend row resolves forward to the next business day', out[0] && out[0].resolved_post_date === RESOLVED_MONDAY && out[0].post_shifted === true, JSON.stringify(out[0]));
      A('annotate: weekday row is unchanged and not flagged', out[1] && out[1].resolved_post_date === WEEKDAY_UNSHIFTED && out[1].post_shifted === false);
      A('annotate: no-country row is unchanged', out[2] && out[2].resolved_post_date === NOMINAL_WEEKEND && out[2].post_shifted === false);
      A('annotate: junk/blank rows pass through untouched', out[3] === null && out[4] && out[4].resolved_post_date === undefined);
    } else if (serverMod) {
      A('server.js exports annotateResolvedPostDate', false, 'export missing — add module.exports.annotateResolvedPostDate');
    }

    const tail = skip ? '  (' + skip + ' skipped)' : '';
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed${tail}  (F94 B2: resolved post dates)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
