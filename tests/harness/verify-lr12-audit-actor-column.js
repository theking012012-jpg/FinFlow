'use strict';
/**
 * verify-lr12-audit-actor-column.js — LR12: the Audit table says WHO made each change.
 *  The table was Date · Table · Record ID · Action · Field · Old · New — no actor, though every row stores actor_type /
 *  actor_id. Now a "By" column (and the CSV export, the runtime-winning index.html copy) names the person: a user by
 *  name (else e-mail), an accountant as "Accountant · <name>", FinFlow support never by identity, else "System".
 *
 * Real scratch Postgres, real server, real SPA (bundle). One change is made through the API as the signed-in owner;
 * an accountant row, a support row and a system row are written into audit_trail as their writers would.
 *   By column: { owner change → "Dana Owner", accountant → "Accountant · Ari Book", admin → "FinFlow support",
 *                system → "System" }                                (old: no column — measured)
 *   CSV header carries "By"                                         (old: no "By")
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr12-audit-actor-column.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR12 — the Audit table names who made each change\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business","name":"Dana Owner"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR12 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('POST', '/api/expenses', { description: 'Owner-made', amount: 11, category: 'Office', expense_date: '2026-07-20' });
      const { rows: [ac] } = await client.query(
        `INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code) VALUES ('ari.lr12@example.test', 'x', 'Ari', 'Book', 'LR12REF') RETURNING id`);
      const ins = (table, rid, actorType, actorId) => client.query(
        `INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, new_data, actor_type, actor_id) VALUES ($1,$2,$3,$4,'CREATE',$5,$6,$7)`,
        [userId, e.id, table, rid, { amount: rid }, actorType, actorId]);
      await ins('bills', 901, 'accountant', ac.id);
      await ins('invoices', 902, 'admin', 1);
      await ins('payroll_runs', 903, 'system', userId);
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('audit');
    await settle(40, 50);
    await w.loadAuditTrail(); await settle(10, 20);

    const heads = Array.from(d.querySelectorAll('#audit-trail-body')[0].closest('table').querySelectorAll('thead th')).map(th => th.textContent.trim());
    const byIdx = heads.indexOf('By');
    eq('the table has a "By" column', byIdx >= 0, true, false);
    const byOf = rid => {
      const tr = Array.from(d.querySelectorAll('#audit-trail-body tr')).find(r => (r.children[2] || {}).textContent === String(rid));
      return tr && byIdx >= 0 ? tr.children[byIdx].textContent.trim() : null;
    };
    const ownerTr = Array.from(d.querySelectorAll('#audit-trail-body tr')).find(r => /expenses/.test((r.children[1] || {}).textContent || ''));
    eq('who made each change', {
      owner: ownerTr && byIdx >= 0 ? ownerTr.children[byIdx].textContent.trim() : null,
      accountant: byOf(901), support: byOf(902), system: byOf(903),
    }, { owner: 'Dana Owner', accountant: 'Accountant · Ari Book', support: 'FinFlow support', system: 'System' },
    { owner: null, accountant: null, support: null, system: null });

    // CSV export — capture what the page hands to Blob.
    let csv = null; const RealBlob = w.Blob;
    w.Blob = function (parts, o) { csv = parts.join(''); return new RealBlob(parts, o); };
    w.URL.createObjectURL = () => 'blob:lr12'; w.HTMLAnchorElement.prototype.click = function () {};
    w.exportAuditCSV(); await settle(5, 10);
    w.Blob = RealBlob;
    const head = csv ? csv.split('\n')[0] : null;
    eq('CSV header has "By"', head, 'Date,Table,Record ID,Action,By,Field,Old Value,New Value', 'Date,Table,Record ID,Action,Field,Old Value,New Value');
    const accLine = csv ? csv.split('\n').find(l => /"901"/.test(l)) : null;
    eq('…and the accountant row carries the name', !!(accLine && /"Accountant · Ari Book"/.test(accLine)), true, false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
