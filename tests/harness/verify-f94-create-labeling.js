'use strict';
/* verify-f94-create-labeling.js — F94 Phase B1: the create affordances say plainly that this page
 * creates RECURRING schedules, not one-off documents (the view-first identity — the page displays
 * one-offs but does not author them; that lives on the Invoices/Bills pages). Asserts the day-click
 * create button and the modal both name "recurring / repeating schedule".
 *
 * Pure jsdom + real finflow-dates.js; no server needed.
 * Discriminating (Rule 14): before B1 the day button read "+ New on <day>" (no "recurring") and the
 * modal subtitle began "For <entity> …" with no "repeating schedule" statement.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f94-create-labeling.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const FinFlowDates = require(path.join(ROOT, 'public', 'finflow-dates.js'));

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app' });
    const { window } = dom;
    const doc = window.document;

    window.FinFlowDates = FinFlowDates;
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    window.ENTITIES = [{ _dbId: 10, name: 'Solo Co', currency: 'USD', timezone: null, country: null, active: true }];
    window.recurringInvoices = []; window.recurringBills = []; window.recurringPersonal = [];
    window._realInvoices = []; window.bills = []; window._allPersTxs = [];
    window._isScheduled = () => false;

    window.eval(fs.readFileSync(path.join(ROOT, 'public', 'finflow-f94.js'), 'utf8'));
    if (typeof window._f94Open !== 'function') { try { doc.dispatchEvent(new window.Event('DOMContentLoaded')); } catch (_) {} }
    await window._f94Open();
    await new Promise((r) => setTimeout(r, 10));

    // click any real day cell → the "+ New on <day>" create button appears
    const cell = doc.querySelector('#f94-cal .cell[data-day]');
    A('a calendar day cell exists to click', !!cell);
    if (cell) { cell.click(); await new Promise((r) => setTimeout(r, 5)); }
    const ndb = doc.getElementById('f94-newDayBtn');
    A('the day-create button renders', !!ndb);
    A('...and labels itself as creating a RECURRING schedule', !!ndb && /\(recurring\)/.test(ndb.textContent), 'txt=' + (ndb && ndb.textContent));

    // the modal itself states it creates a repeating schedule
    A('modal open hook exposed', typeof window._f94OpenModal === 'function');
    window._f94OpenModal();
    await new Promise((r) => setTimeout(r, 5));
    const title = (doc.getElementById('f94-modalTitle') || {}).textContent || '';
    const sub = (doc.getElementById('f94-modalSub') || {}).textContent || '';
    A('modal title names it a recurring schedule', /recurring/i.test(title), 'title=' + title);
    A('modal subtitle states it creates a repeating schedule (not a one-off)', /repeating schedule/i.test(sub), 'sub=' + sub);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F94 B1: honest create labelling)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
