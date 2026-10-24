'use strict';
/**
 * verify-fab6-edit-titles.js — FA-B6 (full app audit B6: "Edit quote shows 'New Quote — Create a quote'; edit time entry
 * shows 'Log Time — Record a time entry'"). Rule 13: every edit opener in the app was listed (13); quote and time entry
 * were the two that reuse a "new" form without retitling it — the others retitle or have their own "Edit …" modal.
 * After: editing says so, and opening a new one after an edit says "New" again.
 * Real SPA in jsdom + real bundle + real scratch Postgres; the quote and the time entry are created through the routes.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab6-edit-titles.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, seedExtra: async (c, uid) => {
      await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
    } });
    const { window, http, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.editQuote !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    const q = (await http.post('/api/quotes', { client: 'Acme', amount: 500, status: 'pending', expiry_date: '2026-08-30', idempotency_key: 'b6-q' })).json || {};
    const ts = (await http.post('/api/timesheet', { employee: 'Ada', project: 'Website', date: '2026-07-20', hours: 3, rate: 50, billable: 'Yes' })).json || {};
    const title = id => { const m = d.getElementById(id); return m ? [(m.querySelector('.modal-title') || {}).textContent, (m.querySelector('.modal-sub') || {}).textContent].map(s => String(s || '').trim()).join(' — ') : 'no modal'; };
    try { await window.editQuote(q.id); } catch (e) { A('editQuote ran', false, e.message); }
    await settle(3, 30);
    A('1  editing a quote says "Edit quote — Acme" (bug: "New Quote — Create a quote for a client")', /^Edit quote — Acme/.test(title('quote-modal')), title('quote-modal'));
    try { window.openNewQuoteModal(); } catch (_) {}
    A('2  a new quote after that says "New Quote" again', /^New Quote/.test(title('quote-modal')), title('quote-modal'));
    const tsModalId = () => { const m = [...d.querySelectorAll('.modal-overlay')].find(x => x.querySelector('#ts-hours')); return m && m.id; };
    try { await window.editTimesheetEntry(ts.id); } catch (e) { A('editTimesheetEntry ran', false, e.message); }
    await settle(3, 30);
    A('3  editing a time entry says "Edit time entry" (bug: "Log Time — Record a time entry")', /^Edit time entry/.test(title(tsModalId())), title(tsModalId()));
    try { window.openLogTimeModal(); } catch (_) {}
    A('4  logging new time after that says "Log Time" again', /^Log Time/.test(title(tsModalId())), title(tsModalId()));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-B6 edit titles)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
