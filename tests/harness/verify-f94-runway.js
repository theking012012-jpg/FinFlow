'use strict';
/* verify-f94-runway.js — F94 Phase B3: the forecast is a real cash RUNWAY.
 *
 * When the entity has a USER-set opening cash balance (never fabricated — F31/F55), the forecast
 * projects the actual cash BALANCE forward over 60 days and flags the first day it goes below zero.
 * Absent ⇒ the honest zero-based "net impact of what's scheduled" line (unchanged), plus a prompt to
 * set opening cash. Opening cash persists on the entity via PUT /api/entities/:id (server helper
 * normalizeOpeningCash validates it).
 *
 * Two layers (mirrors verify-f94-resolved-dates):
 *   • CLIENT (jsdom, always): dip / stays-positive / honest-fallback + the editor input reflects the value.
 *   • SERVER helper (runs when server.js loads; else SKIP — full sweep covers it): normalizeOpeningCash.
 *
 * The forecast window is derived from the module's own (jsdom-realm) 'today', so seeded dates always
 * land inside the horizon regardless of the wall-clock day this runs on.
 *
 * Discriminating (Rule 14): before B3 the forecast always started at 0 and the flag always read
 * "Net ±$…" — there was no balance projection, no "dips below 0" flag, and no opening-cash input.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f94-runway.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const FinFlowDates = require(path.join(ROOT, 'public', 'finflow-dates.js'));

const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = (n) => String(n).padStart(2, '0');
const addDays = (ymd, n) => { const p = ymd.split('-'); const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
const dlabel = (ymd) => { const p = ymd.split('-'); return (+p[2]) + ' ' + MONS[+p[1] - 1]; };

(async () => {
  let pass = 0, fail = 0, skip = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const SKIP = (n) => { skip++; console.log('  SKIP  ' + n); };
  try {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/app' });
    const { window } = dom;
    const doc = window.document;

    window.FinFlowDates = FinFlowDates;
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    window.ENTITIES = [{ _dbId: 10, name: 'Solo Co', currency: 'USD', timezone: null, country: null, active: true, opening_cash: 1000 }];
    window.recurringInvoices = [];
    window.recurringBills = [];
    window.recurringPersonal = [];
    window._realInvoices = [];
    window.bills = [];
    window._allPersTxs = [];
    window._isScheduled = () => false;

    window.eval(fs.readFileSync(path.join(ROOT, 'public', 'finflow-f94.js'), 'utf8'));
    if (typeof window._f94Open !== 'function') { try { doc.dispatchEvent(new window.Event('DOMContentLoaded')); } catch (_) {} }

    // the module's own 'today' (jsdom-realm live clock), so seeded dates fall inside the 60-day horizon
    const today = window.eval('(function(){var e=(window.ENTITIES||[]).find(function(x){return x.active;})||(window.ENTITIES||[])[0];try{if(window.FinFlowDates&&window.FinFlowDates.resolvedToday)return window.FinFlowDates.resolvedToday(new Date(),(e&&e.timezone)||null);}catch(_){}return new Date().toISOString().slice(0,10);})()');
    const dipDate = addDays(today, 10);

    // a single bill of 3000 ten days out drains the 1000 opening → dips to −2000 on day+10
    window.recurringBills = [{ id: 1, entity_id: 10, vendor: 'Big Bill', amount: 3000, next_run: dipDate, frequency: 'Monthly', status: 'active', end_date: null }];

    await window._f94Open();
    await new Promise((r) => setTimeout(r, 10));

    const sub = () => (doc.getElementById('f94-fcSub') || {}).textContent || '';
    const subHtml = () => (doc.getElementById('f94-fcSub') || {}).innerHTML || '';
    const flag = () => doc.getElementById('f94-fcFlag') || {};
    const chart = () => (doc.getElementById('f94-fcChart') || {}).innerHTML || '';

    // ── PHASE A: runway with a dip ──
    A('runway sub shows projected balance from the opening cash', /Projected cash balance/.test(sub()) && /from opening \$1,000/.test(sub()), 'sub=' + sub());
    A('flag calls out the exact first below-zero day', (flag().textContent || '') === 'Cash dips below 0 on ' + dlabel(dipDate), 'flag=' + flag().textContent + ' | expected day=' + dlabel(dipDate));
    A('flag is styled as a danger (fc-flag bad)', /(^|\s)bad(\s|$)/.test(flag().className || ''), 'cls=' + flag().className);
    A('a dip marker is drawn on the chart', /<circle/.test(chart()));
    A('the entity editor exposes an opening-cash input reflecting the stored value', ((doc.getElementById('f94-openingcash') || {}).value || '') === '1000', 'val=' + (doc.getElementById('f94-openingcash') || {}).value);

    // ── PHASE B: enough cash → stays positive ──
    window.ENTITIES[0].opening_cash = 100000;
    window.renderScheduledDocuments();
    await new Promise((r) => setTimeout(r, 5));
    A('with ample cash the flag reports it stays positive', /Stays positive/.test(flag().textContent || ''), 'flag=' + flag().textContent);
    A('...styled OK (fc-flag ok), no dip marker', /(^|\s)ok(\s|$)/.test(flag().className || '') && !/<circle/.test(chart()), 'cls=' + flag().className);

    // ── PHASE C: no opening cash → honest fallback (unchanged pre-B3 behaviour) ──
    window.ENTITIES[0].opening_cash = null;
    window.renderScheduledDocuments();
    await new Promise((r) => setTimeout(r, 5));
    A('without opening cash the flag falls back to the honest "Net ±" line', /Net [+−]/.test(flag().textContent || ''), 'flag=' + flag().textContent);
    A('...and the sub offers to set opening cash for a runway', /set opening cash for a runway/.test(subHtml()));

    // ── SERVER helper: normalizeOpeningCash ──
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'harness-only-secret';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/none';
    let serverMod = null;
    try { serverMod = require(path.join(ROOT, 'server.js')); }
    catch (e) { SKIP('server.js not loadable here (' + (e.code || e.message) + ') — normalizeOpeningCash covered by the full sweep'); }
    if (serverMod && typeof serverMod.normalizeOpeningCash === 'function') {
      const noc = serverMod.normalizeOpeningCash;
      A('normalize: undefined → skip (leave stored value untouched)', noc(undefined).skip === true);
      A('normalize: null / "" → explicit clear (value null, never a fabricated 0)', noc(null).value === null && noc('').value === null && !('error' in noc('')));
      A('normalize: a positive number → rounded to cents', noc('12000.555').value === 12000.56 && noc(0).value === 0);
      A('normalize: negative / non-number → error', !!noc(-5).error && !!noc('abc').error);
    } else if (serverMod) {
      A('server.js exports normalizeOpeningCash', false, 'export missing');
    }

    const tail = skip ? '  (' + skip + ' skipped)' : '';
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed${tail}  (F94 B3: cash runway)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
