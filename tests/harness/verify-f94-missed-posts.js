'use strict';
/* verify-f94-missed-posts.js — F94 Phase B4: the radar catches runs that DIDN'T post.
 *
 * A successful recurring run advances its next_run to the next future occurrence, so an ACTIVE recurring
 * row whose post day (it.date — the F88-resolved day from B2) is already in the PAST means the server
 * scheduler never materialised it: a failed or delayed run. B4 surfaces these in the "Needs attention"
 * band as a MISSED row. Paused rows (legitimately don't post) and one-offs (real documents, not
 * scheduler-driven) are excluded.
 *
 * Pure jsdom + real finflow-dates.js; no server needed.
 * Discriminating (Rule 14): before B4 the attention band flagged only series-ending runs — a past active
 * recurring row with no end date did not appear at all, so the asserts below flip on the old code.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f94-missed-posts.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const FinFlowDates = require(path.join(ROOT, 'public', 'finflow-dates.js'));

const PAST_A = '2020-01-06';   // long past, a weekday (no B2 shift) → unambiguously < today
const PAST_B = '2020-01-07';
const FUTURE = '2999-01-04';   // far future → never "missed"

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
    window.recurringInvoices = [
      { id: 1, entity_id: 10, client: 'Late Retainer',   amount: 5000, next_run: PAST_A, frequency: 'Monthly', status: 'active', end_date: null },  // MISSED
      { id: 2, entity_id: 10, client: 'Future Retainer', amount: 4000, next_run: FUTURE, frequency: 'Monthly', status: 'active', end_date: null },  // fine (future)
      { id: 3, entity_id: 10, client: 'Paused Retainer', amount: 3000, next_run: PAST_B, frequency: 'Monthly', status: 'paused', end_date: null },  // paused → not missed
    ];
    window.recurringBills = [];
    window.recurringPersonal = [];
    window._realInvoices = [];   // no materialised docs → the missed row has no prior posting on record
    window.bills = [];
    window._allPersTxs = [];
    window._isScheduled = () => false;

    window.eval(fs.readFileSync(path.join(ROOT, 'public', 'finflow-f94.js'), 'utf8'));
    if (typeof window._f94Open !== 'function') { try { doc.dispatchEvent(new window.Event('DOMContentLoaded')); } catch (_) {} }
    await window._f94Open();
    await new Promise((r) => setTimeout(r, 10));

    const host = () => doc.getElementById('f94-attn') || {};
    const attn = () => (host().innerHTML || '');

    A('attention band is visible when a run is missed', (host().style ? host().style.display : '') !== 'none' && attn().length > 0, 'display=' + (host().style && host().style.display));
    A('missed active recurring run appears in the band', /Late Retainer/.test(attn()) && /no document has been created/.test(attn()), 'attn=' + attn().slice(0, 400));
    A('...flagged with a MISSED marker', /MISSED ·/.test(attn()));
    A('...prior-postings note reads "none on record" (no linked doc)', /prior postings: none on record/.test(attn()));
    A('a FUTURE-dated active run is NOT flagged missed', !/Future Retainer/.test(attn()));
    A('a PAUSED past run is NOT flagged missed', !/Paused Retainer/.test(attn()));
    A('exactly one missed row is shown', (attn().match(/MISSED ·/g) || []).length === 1, 'count=' + (attn().match(/MISSED ·/g) || []).length);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F94 B4: missed / late-post band)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
