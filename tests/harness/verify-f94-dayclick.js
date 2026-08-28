'use strict';
/* verify-f94-dayclick.js — F94 Phase 4: the Scheduled Documents calendar is now CLICKABLE.
 * Owner decision was "Both": a day-click filters the agenda AND offers "+ New on this day".
 * This harness boots the REAL index.html container + the real finflow-f94.js in jsdom with one
 * live entity and a seeded schedule, then asserts the Phase 4 behaviour:
 *
 *   1. EVERY real day cell carries data-day and is clickable — count === days-in-month
 *      (before Phase 4 only `.cell.has` days were wired, so the count would be the item-days only).
 *   2. Clicking an EMPTY day sets the day filter (cell gains `.sel`) and renders `#f94-newDayBtn`
 *      reading "+ New on <that day>" — a button that did not exist before Phase 4.
 *   3. Clicking `#f94-newDayBtn` opens the create modal (`#f94-overlay.open`) with `#f94-mDate`
 *      pre-filled to the CLICKED date — proven distinct from entity-today.
 *   4. Clicking a day WITH items filters the agenda to that date's group(s) only.
 *
 * Modelled on verify-f94-scheduled-page.js. Pure jsdom + real finflow-dates.js; no server needed.
 * The view month is read back from the rendered calendar (the module derives it from the LIVE
 * clock via entityToday), so the seed dates are computed into that month — the harness stays
 * deterministic whatever day it runs on.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f94-dayclick.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const FinFlowDates = require(path.join(ROOT, 'public', 'finflow-dates.js'));

const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = (n) => String(n).padStart(2, '0');
const dlabel = (ymd) => { const p = String(ymd).split('-'); return (+p[2]) + ' ' + MONS[+p[1] - 1]; };

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app' });
    const { window } = dom;
    const doc = window.document;

    // ── live globals: one entity + empty collections (we seed the schedule AFTER we learn the view month) ──
    window.FinFlowDates = FinFlowDates;
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); // never actually hit here
    window.ENTITIES = [
      { _dbId: 10, name: 'Solo Co', currency: 'USD', timezone: null, country: null, active: true },
    ];
    window.recurringInvoices = [];
    window.recurringBills = [];
    window.recurringPersonal = [];
    window._realInvoices = [];
    window.bills = [];
    window._allPersTxs = [];
    window._isScheduled = () => false;

    // eval the real module (installs its showPage wrapper immediately since readyState === 'complete')
    window.eval(fs.readFileSync(path.join(ROOT, 'public', 'finflow-f94.js'), 'utf8'));
    if (typeof window._f94Open !== 'function') { try { doc.dispatchEvent(new window.Event('DOMContentLoaded')); } catch (_) {} }
    A('finflow-f94.js installed showPage wrapper', typeof window.showPage === 'function');
    A('window._f94Open exposed', typeof window._f94Open === 'function');
    A('window._f94OpenModal exposed', typeof window._f94OpenModal === 'function');

    // open the tab → calendar renders the current (live) month with no items yet
    await window._f94Open();
    await new Promise((r) => setTimeout(r, 10));

    const cells = () => Array.from(doc.querySelectorAll('#f94-cal .cell[data-day]'));

    // the module derived the view month from entityToday(); read it back off the rendered cells so the
    // seed dates land in the SAME month (deterministic regardless of the wall-clock day this runs on).
    const firstDay = cells()[0] && cells()[0].getAttribute('data-day');
    A('calendar rendered real day cells with data-day', !!firstDay, 'no .cell[data-day] found');
    if (!firstDay) throw new Error('calendar did not render — cannot continue');
    const [yStr, moStr] = firstDay.split('-');            // 'YYYY', 'MM'  (first cell is day 1 of the view month)
    const viewY = +yStr, mo1 = +moStr;                    // mo1 = 1-based month
    const ym = yStr + '-' + pad(mo1);
    const dstr = (d) => ym + '-' + pad(d);
    const dim = new Date(viewY, mo1, 0).getDate();        // days in the view month

    // entity-today exactly as the module computes it (jsdom-realm live clock), so we can prove the
    // modal pre-fill is the CLICKED date and not the default.
    const entityTodayVal = window.eval(
      '(function(){var e=(window.ENTITIES||[]).find(function(x){return x.active;})||(window.ENTITIES||[])[0];' +
      'try{if(window.FinFlowDates&&window.FinFlowDates.resolvedToday)return window.FinFlowDates.resolvedToday(new Date(),(e&&e.timezone)||null);}catch(_){}' +
      'return new Date().toISOString().slice(0,10);})()'
    );
    A('entity-today resolved to a calendar date', /^\d{4}-\d{2}-\d{2}$/.test(entityTodayVal || ''), 'today=' + entityTodayVal);

    // ── seed a schedule INTO the view month: items on day 15 and day 20 ──
    const D_ITEM = 15, D_OTHER = 20;
    window.recurringInvoices = [
      { id: 1, entity_id: 10, client: 'Acme Fifteen', amount: 5000, next_run: dstr(D_ITEM), frequency: 'Monthly', status: 'active', end_date: null, currency: 'USD' },
      { id: 2, entity_id: 10, client: 'Beta Twenty',  amount: 3000, next_run: dstr(D_OTHER), frequency: 'Monthly', status: 'active', end_date: null, currency: 'USD' },
    ];
    window.renderScheduledDocuments();
    await new Promise((r) => setTimeout(r, 5));

    // pick an EMPTY day in the view month that is NOT an item day and NOT entity-today (so the pre-fill
    // assertion is discriminating against the default).
    const todayDayNum = (+entityTodayVal.split('-')[2]) || -1;
    let emptyDayNum = 0;
    for (let d = 1; d <= dim; d++) { if (d !== D_ITEM && d !== D_OTHER && d !== todayDayNum) { emptyDayNum = d; break; } }
    A('found an empty, non-today day to test', emptyDayNum > 0, 'dim=' + dim + ' today=' + todayDayNum);

    // ── 1. every real day cell is clickable; count === days-in-month ──
    A('every real day cell carries data-day (count === days-in-month)', cells().length === dim, 'cells=' + cells().length + ' dim=' + dim);
    A('every real day cell is wired clickable', cells().length > 0 && cells().every((c) => typeof c.onclick === 'function'));
    A('padding cells are NOT wired (no data-day)', Array.from(doc.querySelectorAll('#f94-cal .cell.pad')).every((c) => !c.getAttribute('data-day')));

    // ── 2. clicking an EMPTY day → day filter set + "+ New on <day>" button ──
    const emptyCell = doc.querySelector('#f94-cal .cell[data-day="' + dstr(emptyDayNum) + '"]');
    A('empty-day cell present and has no items (no .has)', !!emptyCell && !emptyCell.classList.contains('has'), 'emptyDay=' + dstr(emptyDayNum));
    emptyCell.click();
    await new Promise((r) => setTimeout(r, 5));
    A('clicking an empty day selects it (cell gains .sel = day filter set)',
      !!doc.querySelector('#f94-cal .cell[data-day="' + dstr(emptyDayNum) + '"].sel'));
    const ndb = () => doc.getElementById('f94-newDayBtn');
    A('empty-day agenda renders the "+ New on this day" button', !!ndb());
    A('...button reads "+ New on <clicked day>"',
      !!ndb() && /New on/.test(ndb().textContent) && ndb().textContent.indexOf(dlabel(dstr(emptyDayNum))) !== -1,
      'txt=' + (ndb() && ndb().textContent));

    // ── 3. the button opens the create modal pre-filled with the CLICKED date (not entity-today) ──
    ndb().click();
    await new Promise((r) => setTimeout(r, 5));
    const overlay = doc.getElementById('f94-overlay');
    A('New-on-day button opens the create modal', !!overlay && /(^|\s)open(\s|$)/.test(overlay.className), 'cls=' + (overlay && overlay.className));
    const mDate = (doc.getElementById('f94-mDate') || {}).value;
    A('modal #f94-mDate pre-fills to the CLICKED day, not entity-today',
      mDate === dstr(emptyDayNum) && mDate !== entityTodayVal,
      'mDate=' + mDate + ' clicked=' + dstr(emptyDayNum) + ' today=' + entityTodayVal);
    const mc = doc.getElementById('f94-mCancel'); if (mc) mc.click();   // tidy up

    // ── 4. clicking a day WITH items filters the agenda to that day's group only ──
    const itemCell = doc.querySelector('#f94-cal .cell[data-day="' + dstr(D_ITEM) + '"]');
    A('day-15 cell is marked as having items (.has)', !!itemCell && itemCell.classList.contains('has'));
    itemCell.click();
    await new Promise((r) => setTimeout(r, 5));
    const agenda = (doc.getElementById('f94-agenda') || {}).innerHTML || '';
    A('clicking a day WITH items filters the agenda to that day only (shows day-15, hides day-20)',
      /Acme Fifteen/.test(agenda) && !/Beta Twenty/.test(agenda), 'agenda=' + agenda.slice(0, 320));
    A('selected item-day cell reflects the filter (.sel)',
      !!doc.querySelector('#f94-cal .cell[data-day="' + dstr(D_ITEM) + '"].sel'));
    A('the "+ New on this day" button is also present in the POPULATED agenda state', !!ndb());
    A('...and in the populated state it reads the item day', !!ndb() && ndb().textContent.indexOf(dlabel(dstr(D_ITEM))) !== -1, 'txt=' + (ndb() && ndb().textContent));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F94 Phase 4: clickable calendar — day-click filters + "+ New on this day")\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
