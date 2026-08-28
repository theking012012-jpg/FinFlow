'use strict';
/* verify-f94-agenda-sections.js — F94 Phase B5: the agenda groups its day-blocks under time-bucket
 * section headers (Overdue → This week → This month → Later) so a long list stays scannable.
 *
 * Pure jsdom + real finflow-dates.js; no server needed. Dates are computed off the module's own
 * (jsdom-realm) 'today' so the buckets are deterministic whatever day this runs on.
 * Discriminating (Rule 14): before B5 the agenda was a flat list of day-groups with no section headers.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f94-agenda-sections.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const FinFlowDates = require(path.join(ROOT, 'public', 'finflow-dates.js'));

const pad = (n) => String(n).padStart(2, '0');
const addDays = (ymd, n) => { const p = ymd.split('-'); const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };

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

    const today = window.eval('(function(){var e=(window.ENTITIES||[]).find(function(x){return x.active;})||(window.ENTITIES||[])[0];try{if(window.FinFlowDates&&window.FinFlowDates.resolvedToday)return window.FinFlowDates.resolvedToday(new Date(),(e&&e.timezone)||null);}catch(_){}return new Date().toISOString().slice(0,10);})()');
    // three deterministic buckets regardless of today: −5d Overdue, +2d This week, +45d Later
    window.recurringInvoices = [
      { id: 1, entity_id: 10, client: 'OverdueInv', amount: 100, next_run: addDays(today, -5), frequency: 'Monthly', status: 'active', end_date: null },
      { id: 2, entity_id: 10, client: 'WeekInv',    amount: 200, next_run: addDays(today, 2),  frequency: 'Monthly', status: 'active', end_date: null },
      { id: 3, entity_id: 10, client: 'LaterInv',   amount: 300, next_run: addDays(today, 45), frequency: 'Monthly', status: 'active', end_date: null },
    ];
    await window._f94Open();
    await new Promise((r) => setTimeout(r, 10));

    const ag = () => (doc.getElementById('f94-agenda') || {}).innerHTML || '';
    const at = (needle) => ag().indexOf(needle);

    A('agenda renders section headers (f94-section)', /class="f94-section"/.test(ag()));
    A('Overdue section present', at('>Overdue<') !== -1);
    A('This week section present', at('>This week<') !== -1);
    A('Later section present', at('>Later<') !== -1);
    A('sections appear in chronological order (Overdue → This week → Later)',
      at('>Overdue<') !== -1 && at('>Overdue<') < at('>This week<') && at('>This week<') < at('>Later<'),
      'idx=' + [at('>Overdue<'), at('>This week<'), at('>Later<')].join(','));
    A('the overdue item sits under the Overdue header', at('OverdueInv') > at('>Overdue<') && at('OverdueInv') < at('>This week<'));
    A('the this-week item sits under the This week header', at('WeekInv') > at('>This week<') && at('WeekInv') < at('>Later<'));
    A('the far item sits under the Later header', at('LaterInv') > at('>Later<'));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F94 B5: agenda time-bucket sections)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
