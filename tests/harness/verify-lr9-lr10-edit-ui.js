'use strict';
/**
 * verify-lr9-lr10-edit-ui.js — LR9 / LR10 UI: the Quotes page can edit a quote and turn it into an invoice; a converted
 * quote shows its invoice and offers no Edit; the Timesheet can edit an entry. Old code: View and ✕ only (Rule 4).
 *
 * Real scratch Postgres, real server, real SPA (bundle).
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr9-lr10-edit-ui.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR9 / LR10 — edit a quote, turn it into an invoice, edit a time entry (real SPA)\n');
  try {
    const ids = {};
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR9 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      ids.q = (await J('POST', '/api/quotes', { client: 'Bright Labs', amount: 1000, status: 'pending', expiry_date: '2026-08-31' })).id;
      ids.t = (await J('POST', '/api/timesheet', { employee: 'Sam', date: '2026-07-10', hours: 2, billable: 'Yes', rate: 100 })).id;
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const get = async p => (await w.fetch(p, { credentials: 'include' })).json();
    const row = id => Array.from(d.querySelectorAll('#quotes-list .table-row')).find(r => r.innerHTML.includes('(' + id + ')'));

    w.showPage('quotes'); await settle(30, 40);
    eq('a quote row offers Edit and → Invoice', !!(row(ids.q) && /editQuote\(/.test(row(ids.q).innerHTML) && /convertQuote\(/.test(row(ids.q).innerHTML)), true, false);

    w.editQuote(ids.q); await settle(5, 20);
    eq('Edit opens the form filled with the quote', [d.querySelector('#quote-modal .modal-title').textContent, d.getElementById('quote-client').value, Number(d.getElementById('quote-amount').value)], ['Edit Quote', 'Bright Labs', 1000], null);
    d.getElementById('quote-amount').value = '1500';
    await w.saveQuote(); await settle(20, 30);
    const q1 = (await get('/api/quotes')).find(x => x.id === ids.q) || {};
    eq('saving the edit updates the quote (1,000 → 1,500), no new quote', [Number(q1.amount), (await get('/api/quotes')).length], [1500, 1], [1000, 2]);

    w._confirmModal = async () => true;
    await w.convertQuote(ids.q); await settle(30, 40);
    const invs = (await get('/api/invoices')) || [];
    const inv = (Array.isArray(invs) ? invs : invs.rows || []).find(i => i.from_quote_id === ids.q);
    const q2 = (await get('/api/quotes')).find(x => x.id === ids.q) || {};
    eq('→ Invoice creates the invoice (1,500) and marks the quote converted', [inv ? Number(inv.amount) : null, q2.status], [1500, 'converted'], [null, 'pending']);
    w.renderQuotes(); await settle(5, 20);
    const r2 = row(ids.q) ? row(ids.q).innerHTML : '';
    eq('…the converted row names its invoice and offers no Edit / → Invoice', [/invoice #/.test(r2), /editQuote\(/.test(r2), /convertQuote\(/.test(r2)], [true, false, false]);

    w.showPage('timesheet'); await settle(30, 40);
    w.editTimesheetEntry(ids.t); await settle(5, 20);
    eq('Edit opens the time form filled with the entry', [d.querySelector('#ts-log-modal .modal-title').textContent, d.getElementById('ts-employee').value, Number(d.getElementById('ts-hours').value)], ['Edit time entry', 'Sam', 2], null);
    d.getElementById('ts-hours').value = '3.5';
    await w.saveTimesheetEntry(); await settle(20, 30);
    const ts = await get('/api/timesheet');
    eq('saving the edit updates the entry (2h → 3.5h), no new entry', [Number((ts.find(x => x.id === ids.t) || {}).hours), ts.length], [3.5, 1], [2, 2]);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
