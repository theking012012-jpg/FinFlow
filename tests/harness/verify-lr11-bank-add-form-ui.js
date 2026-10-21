'use strict';
/**
 * verify-lr11-bank-add-form-ui.js — LR11 UI: Banking "+ Add" opens a real form (it was only a toast), the line it adds
 * is shown as "Manual", and a line matching the bank feed asks before adding.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Old code: openAddTxnModal only toasts → no form (Rule 4).
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr11-bank-add-form-ui.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR11 — the Banking "+ Add" form adds a manual line, and asks about a likely duplicate\n');
  try {
    let eid;
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR11 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      eid = e.id;
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await client.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
        [userId, e.id, { description: 'CARD PURCHASE 4417', amount: 88, tx_type: 'debit', tx_date: '2026-07-24', source: 'banking', category: 'Uncategorized' }]);
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('banking');
    await settle(30, 40);
    const fill = (desc, amt, date) => { d.getElementById('_bk-desc').value = desc; d.getElementById('_bk-amt').value = String(amt); d.getElementById('_bk-date').value = date; };

    w.openAddTxnModal();
    await settle(5, 20);
    const m = d.getElementById('_bank-add-modal');
    eq('"+ Add" opens a form (description, amount, date, money in / out)', !!(m && !m.classList.contains('hidden') && d.getElementById('_bk-desc') && d.getElementById('_bk-amt') && d.getElementById('_bk-date') && m.querySelectorAll('._bk-dir').length === 2), true, false);

    m.querySelector('._bk-dir[data-dir="credit"]').click();
    fill('Cash deposit', 250, '2026-07-20');
    await w._bankAddSubmit();
    await settle(30, 40);
    const rows = await (await w.fetch('/api/banking', { credentials: 'include' })).json();
    const dep = rows.find(r => r.description === 'Cash deposit');
    eq('the line is stored: money in, 250, marked manual', dep ? [dep.tx_type, Number(dep.amount), dep.manual] : null, ['credit', 250, true], null);
    const txt = (d.getElementById('bank-txns-list') || {}).textContent || '';
    eq('…and the Banking list shows it as "Manual"', /Cash deposit[\s\S]*Manual/.test(txt), true, false);

    // A line the bank feed already has: the form asks; "Cancel" adds nothing, "OK" adds it.
    w.openAddTxnModal(); await settle(5, 20);
    fill('Software', 88, '2026-07-25');
    let asked = 0; w.confirm = () => { asked++; return false; };
    await w._bankAddSubmit(); await settle(20, 30);
    const n1 = (await (await w.fetch('/api/banking', { credentials: 'include' })).json()).filter(r => r.description === 'Software').length;
    eq('a likely duplicate of a feed line → the person is asked; declining adds nothing', [asked, n1], [1, 0], [0, 1]);
    w.confirm = () => { asked++; return true; };
    await w._bankAddSubmit(); await settle(20, 30);
    const n2 = (await (await w.fetch('/api/banking', { credentials: 'include' })).json()).filter(r => r.description === 'Software').length;
    eq('…confirming adds it, once', n2, 1);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
