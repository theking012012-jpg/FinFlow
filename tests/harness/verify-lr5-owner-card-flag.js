'use strict';
/**
 * verify-lr5-owner-card-flag.js — LR5 (owner decision 2026-10-21): Payroll → the owner's own card (openOwnerModal) shows
 * "This is me — the business owner", ticked and read-only. The flag decides whether the owner's salary reaches Personal,
 * and it lived only on Edit employee (LA3), so the person checking their own card could not see it. It stays changeable
 * in that ONE place: the card neither shows an editable box nor sends is_owner when it saves.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Old code: no such box on the card (Rule 4).
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr5-owner-card-flag.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot, client, ownerId;
  console.log('\nLR5 — the owner card shows the owner flag, ticked and read-only\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client: c, userId }) => {
      client = c;
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR5 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      ownerId = (await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Owner', gross: 5000, is_owner: true, emp_type: 'owner', deductions: [] })).id;
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('payroll'); await settle(30, 40);
    w.openOwnerModal(); await settle(5, 20);
    const cb = d.getElementById('own-is-owner-cb');
    const lbl = d.querySelector('label[for="own-is-owner-cb"]');
    eq('the owner card shows "This is me — the business owner"', lbl ? lbl.textContent.trim() : null, 'This is me — the business owner', null);
    eq('…ticked and read-only (changed only on Edit employee)', cb ? [cb.checked, cb.disabled] : null, [true, true], null);

    // Saving the card never changes the flag (it does not send is_owner).
    const sent = [];
    const _f = w.fetch.bind(w);
    w.fetch = (u, o) => { if (/\/api\/payroll\b/.test(String(u)) && o && o.body) sent.push(JSON.parse(o.body)); return _f(u, o); };
    d.getElementById('own-gross').value = '5200';
    if (typeof w.saveOwnerPayroll === 'function') await w.saveOwnerPayroll();
    await settle(30, 40);
    w.fetch = _f;
    eq('saving the card sends no is_owner value', sent.some(b => Object.prototype.hasOwnProperty.call(b, 'is_owner') && b.is_owner !== true), false);
    const row = (await client.query(`SELECT data->>'is_owner' o FROM payroll WHERE id = $1`, [ownerId])).rows[0];
    eq('…and the record is still the owner', row && row.o, 'true');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
