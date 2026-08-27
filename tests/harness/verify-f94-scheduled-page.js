'use strict';
/* verify-f94-scheduled-page.js — F94 Scheduled Documents tab renders from LIVE account data, with
 * ZERO hardcoded sample companies (the design prototype's samples must never ship). Loads the REAL
 * index.html page container + the real finflow-f94.js, stubs live window globals (entities + recurring),
 * opens the tab, and asserts the agenda/entity-bar reflect the stub — and that no prototype string leaks.
 * Pinned clock (2026-07-25). Pure jsdom + real finflow-dates.js; no server needed.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f94-scheduled-page.js
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

    // structural: the tab is a real top-level nav-item + a real page container
    A('nav-item for scheduled-documents exists', /showPage\('scheduled-documents'/.test(html));
    A('page container #page-scheduled-documents exists', !!doc.getElementById('page-scheduled-documents'));
    A('agenda host exists', !!doc.getElementById('f94-agenda'));

    // ── live globals (what the shipped app populates from GET /api/entities + the recurring loaders) ──
    window.FinFlowDates = FinFlowDates;
    window.ENTITIES = [
      { _dbId: 10, name: 'US Co', currency: 'USD', timezone: 'America/New_York', country: 'US', active: true },
      { _dbId: 20, name: 'Canada Co', currency: 'CAD', timezone: 'America/Toronto', country: 'CA', active: false },
    ];
    window.recurringInvoices = [
      { id: 1, entity_id: 10, client: 'Acme Retainer', amount: 6800, next_run: '2026-08-14', frequency: 'Monthly', status: 'active', end_date: null },
      { id: 2, entity_id: 20, client: 'Maple Coop',    amount: 8200, next_run: '2026-08-16', frequency: 'Monthly', status: 'active', end_date: null },
    ];
    window.recurringBills = [
      { id: 3, entity_id: 10, vendor: 'Con Edison', amount: 820, next_run: '2026-08-12', frequency: 'Monthly', status: 'active', end_date: null },
      { id: 4, entity_id: 20, vendor: 'Hydro One',  amount: 430, next_run: '2026-08-18', frequency: 'Monthly', status: 'paused', end_date: null },
    ];
    window.recurringPersonal = [
      { id: 5, description: 'Owner draw', amount: 4500, next_run: '2026-08-10', frequency: 'Monthly', status: 'active', currency: 'USD', end_date: null },
    ];
    window._isScheduled = (d) => { try { const y = FinFlowDates._toYmd(d); return y != null && y > FinFlowDates.resolvedToday(new Date()); } catch (_) { return false; } };
    // Raw arrays as the app actually loads them (server field names): _realInvoices / bills carry
    // issue_date, entity_id, notes and the F94 lineage links. The display-mapped userInvoices drops
    // those, and there is no window.userBills — the module must read the raw arrays, which this stubs.
    window._realInvoices = [
      { id: 90, entity_id: 10, client: 'Milestone Co', amount: 9000, issue_date: '2026-09-15', currency: 'USD' },   // future one-off (US)
      { id: 500, entity_id: 10, client: 'Acme Retainer', amount: 6800, due_date: '2026-07-14', status: 'pending', recurring_invoice_id: 1 }, // posted by schedule #1
      { id: 501, entity_id: 10, client: 'Acme Retainer', amount: 6800, due_date: '2026-07-20', status: 'pending', recurring_invoice_id: null }, // MANUAL same-name/amount — must NOT be attributed (link-exact)
    ];
    window.bills = [
      { id: 600, entity_id: 10, vendor: 'Con Edison', amount: 820, due_date: '2026-07-12', status: 'unpaid', recurring_bill_id: 3 },   // posted by schedule #3
    ];
    window._allPersTxs = [
      { _dbId: 700, desc: 'Owner draw', amount: 4500, date: '2026-07-10', currency: 'USD', recurringProfileId: 5 },   // posted by personal profile #5
    ];

    // eval the real module (installs its showPage wrapper immediately since readyState==='complete')
    window.eval(fs.readFileSync(path.join(ROOT, 'public', 'finflow-f94.js'), 'utf8'));
    // If the module queued on DOMContentLoaded (doc still parsing at eval), fire it so install() runs.
    if (typeof window._f94Open !== 'function') { try { window.document.dispatchEvent(new window.Event('DOMContentLoaded')); } catch (_) {} }
    A('finflow-f94.js installed showPage wrapper', typeof window.showPage === 'function');
    A('window._f94Open exposed', typeof window._f94Open === 'function');

    // open the tab (US active)
    await window._f94Open();
    await new Promise(r => setTimeout(r, 10));

    const body = () => doc.getElementById('page-scheduled-documents').innerHTML;
    const agenda = () => (doc.getElementById('f94-agenda') || {}).innerHTML || '';

    // ── renders from LIVE data ──
    A('entity selector shows the LIVE entity names', /US Co/.test(body()) && /Canada Co/.test(body()), 'entSel=' + (doc.getElementById('f94-entSel') || {}).innerHTML);
    A('agenda shows US recurring invoice (live)', /Acme Retainer/.test(agenda()));
    A('agenda shows US recurring bill (live)', /Con Edison/.test(agenda()));
    A('agenda shows the personal recurring run (user-level)', /Owner draw/.test(agenda()));
    A('agenda shows the future-dated one-off (US)', /Milestone Co/.test(agenda()));
    A('entity meta shows the US timezone chip', /America\/New_York/.test(body()));

    // ── per-row last-posted lineage (link-exact: recurring_invoice_id / recurring_bill_id / recurring_profile_id) ──
    A('recurring invoice row shows its last posted date (linked)', /Last posted 14 Jul/.test(agenda()), 'agenda=' + agenda().slice(0, 400));
    A('recurring bill row shows its last posted date (linked)', /Last posted 12 Jul/.test(agenda()));
    A('recurring personal row shows its last posted date (linked)', /Last posted 10 Jul/.test(agenda()));
    // link-exactness: the MANUAL 2026-07-20 Acme invoice (no link) must NOT be attributed to schedule #1
    A('unlinked same-name/amount doc is NOT fuzzy-attributed (no 20 Jul, no "2 total")', !/Last posted 20 Jul/.test(agenda()) && !/2 total/.test(agenda()), 'agenda=' + agenda().slice(0, 400));
    // exactly the 3 linked recurring rows carry lineage — one-offs and unlinked rows show none
    A('lineage appears on exactly the linked rows (3)', (agenda().match(/Last posted/g) || []).length === 3, 'count=' + (agenda().match(/Last posted/g) || []).length);

    // ── cash-flow forecast renders from the live items ──
    A('forecast chart draws a projection path from live data', /<path/.test((doc.getElementById('f94-fcChart') || {}).innerHTML || ''), 'fc=' + ((doc.getElementById('f94-fcChart') || {}).innerHTML || '').slice(0, 60));
    A('forecast flag shows a net cash figure', /Net [+−]/.test((doc.getElementById('f94-fcFlag') || {}).textContent || ''), 'flag=' + (doc.getElementById('f94-fcFlag') || {}).textContent);

    // ── per-entity scope: US active must NOT show Canada rows ──
    A('US active: Canada recurring invoice NOT shown (per-entity scope)', !/Maple Coop/.test(agenda()), 'leak: Maple Coop');
    A('US active: Canada bill NOT shown', !/Hydro One/.test(agenda()));

    // ── switch to Canada entity → its rows appear, US rows go ──
    window.ENTITIES[0].active = false; window.ENTITIES[1].active = true;
    window.renderScheduledDocuments();
    await new Promise(r => setTimeout(r, 5));
    A('switch to Canada: Canada invoice now shown', /Maple Coop/.test(agenda()));
    A('switch to Canada: US invoice now gone', !/Acme Retainer/.test(agenda()), 'US row leaked into CA');
    A('switch to Canada: entity meta shows Toronto tz', /America\/Toronto/.test(body()));

    // ── the dropdown's onchange handler must re-scope (regression guard for the switchEntity wiring) ──
    window.ENTITIES[0].active = true; window.ENTITIES[1].active = false; window.renderScheduledDocuments();
    const sel = doc.getElementById('f94-entSel'); sel.value = '1';
    sel.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 25));
    A('entity dropdown onchange re-renders the selected entity (Canada)', /Maple Coop/.test(agenda()), 'agenda=' + agenda().slice(0, 120));
    A('onchange: US rows gone after switching to Canada', !/Acme Retainer/.test(agenda()));

    // ── F191: entity region capture (timezone + country) — the fix that makes F88 engage in prod ──
    window.ENTITIES[0].active = true; window.ENTITIES[1].active = false; window.renderScheduledDocuments();
    const nbTz = doc.getElementById('nb-timezone'), nbCo = doc.getElementById('nb-country');
    A('create-form timezone select is populated (F191)', !!nbTz && nbTz.options.length > 1, 'opts=' + (nbTz && nbTz.options.length));
    A('create-form country select is populated (F191)', !!nbCo && nbCo.options.length > 1, 'opts=' + (nbCo && nbCo.options.length));
    const tzSel = doc.getElementById('f94-tz'), coSel = doc.getElementById('f94-country');
    A('F94 region editor timezone reflects the active entity', !!tzSel && tzSel.value === 'America/New_York', 'tz=' + (tzSel && tzSel.value));
    A('F94 region editor country reflects the active entity', !!coSel && coSel.value === 'US', 'co=' + (coSel && coSel.value));
    // Save → PUT /api/entities/:id with the chosen timezone + country
    const puts = [];
    window.fetch = (p, opts) => { puts.push({ p: String(p), opts: opts || {} }); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    tzSel.value = 'America/Chicago'; coSel.value = 'MX';
    doc.querySelector('[data-f94act="region-save"]').click();
    await new Promise(r => setTimeout(r, 20));
    const put = puts.find(x => (x.opts.method === 'PUT') && /\/api\/entities\/10\b/.test(x.p));
    A('region Save PUTs /api/entities/:id (F191)', !!put, 'calls=' + JSON.stringify(puts.map(x => (x.opts.method || 'GET') + ' ' + x.p)));
    A('...PUT body carries the chosen timezone + country', !!put && /America\/Chicago/.test(put.opts.body || '') && /"country":"MX"/.test(put.opts.body || ''), 'body=' + (put && put.opts.body));

    // ── F94 increment 2: create-schedule modal POSTs to the recurring routes ──
    window.ENTITIES[0].active = true; window.ENTITIES[1].active = false; window.renderScheduledDocuments();
    puts.length = 0;
    A('modal open hook exposed', typeof window._f94OpenModal === 'function');
    window._f94OpenModal();
    const overlay = doc.getElementById('f94-overlay');
    A('modal overlay opens', !!overlay && /(^|\s)open(\s|$)/.test(overlay.className));
    // Next date defaults to the entity's resolved 'today'. The pinned clock in clock.js pins the Node
    // realm only; jsdom's realm Date (which the module's new Date() uses) is the live browser clock, so
    // we assert a valid calendar default rather than the Node-pinned value.
    A('modal defaults Next date to a calendar date', /^\d{4}-\d{2}-\d{2}$/.test((doc.getElementById('f94-mDate') || {}).value || ''), 'date=' + (doc.getElementById('f94-mDate') || {}).value);
    // invoice (default type)
    doc.getElementById('f94-mWho').value = 'New Client LLC';
    doc.getElementById('f94-mAmount').value = '3200';
    doc.getElementById('f94-mFreq').value = 'Monthly';
    doc.getElementById('f94-mDate').value = '2026-09-01';
    doc.getElementById('f94-mSave').click();
    await new Promise(r => setTimeout(r, 20));
    const invPost = puts.find(x => (x.opts.method === 'POST') && /\/api\/recurring-invoices\b/.test(x.p));
    A('invoice save POSTs /api/recurring-invoices', !!invPost, 'calls=' + JSON.stringify(puts.map(x => (x.opts.method || 'GET') + ' ' + x.p)));
    A('...invoice body carries client + amount + next_run', !!invPost && /"client":"New Client LLC"/.test(invPost.opts.body || '') && /"amount":3200/.test(invPost.opts.body || '') && /"next_run":"2026-09-01"/.test(invPost.opts.body || ''), 'body=' + (invPost && invPost.opts.body));
    A('modal closes after a successful save', !/(^|\s)open(\s|$)/.test(overlay.className));
    // switch type → bill, then personal
    window._f94OpenModal();
    doc.querySelector('#f94-segType button[data-t="bill"]').click();
    A('type toggle relabels the party field to Vendor', (doc.getElementById('f94-partyLabel') || {}).textContent === 'Vendor');
    doc.getElementById('f94-mWho').value = 'New Vendor Inc';
    doc.getElementById('f94-mAmount').value = '750';
    doc.getElementById('f94-mSave').click();
    await new Promise(r => setTimeout(r, 20));
    const billPost = puts.find(x => (x.opts.method === 'POST') && /\/api\/recurring-bills\b/.test(x.p));
    A('bill save POSTs /api/recurring-bills with vendor', !!billPost && /"vendor":"New Vendor Inc"/.test(billPost.opts.body || ''), 'body=' + (billPost && billPost.opts.body));
    window._f94OpenModal();
    doc.querySelector('#f94-segType button[data-t="personal"]').click();
    doc.getElementById('f94-mWho').value = 'Monthly draw';
    doc.getElementById('f94-mAmount').value = '5000';
    doc.getElementById('f94-mSave').click();
    await new Promise(r => setTimeout(r, 20));
    const persPost = puts.find(x => (x.opts.method === 'POST') && /\/api\/recurring-personal-transactions\b/.test(x.p));
    A('personal save POSTs /api/recurring-personal-transactions with description', !!persPost && /"description":"Monthly draw"/.test(persPost.opts.body || ''), 'body=' + (persPost && persPost.opts.body));
    // validation: empty name blocks the POST
    puts.length = 0;
    window._f94OpenModal();
    doc.getElementById('f94-mWho').value = '';
    doc.getElementById('f94-mSave').click();
    await new Promise(r => setTimeout(r, 10));
    A('empty name blocks the POST (validation)', !puts.some(x => x.opts.method === 'POST'), 'unexpected POST on invalid form');

    // ── NO prototype sample data anywhere ──
    // Prototype leakage = the design's sample COMPANY names. (NB: 'America/Port_of_Spain' is a real,
    // legitimately-offered timezone for the Trinidad market — not prototype data — so it's excluded here.)
    const leaked = ['Meridian', 'Islandwide', 'Maple & Oak', 'Whole Foods', 'Petrotrin', 'T&TEC'].filter(s => body().indexOf(s) !== -1 || html.indexOf(s) !== -1);
    A('no design-prototype sample strings in the shipped page', leaked.length === 0, 'leaked: ' + leaked.join(', '));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F94 renders from live data, no hardcoded samples)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
