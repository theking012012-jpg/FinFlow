'use strict';
/**
 * verify-lr12-audit-actor-column.js — LR12 (live retest T1 / C12): the Audit table had no "who" column (Date · Table ·
 * Record ID · Action · Field · Old · New) although every row carries actor_type / actor_id — "who did it" was invisible.
 *
 * Real SPA in jsdom → real server → real scratch Postgres. Two different people act on the same business, so a page that
 * printed one fixed name could not pass (Rule 4):
 *   - the owner ("Seed Owner") adds expense "LR12 OWNER EXP"
 *   - an active admin team member ("Morgan Member") adds expense "LR12 MEMBER EXP"
 *   - the recurring scheduler (system) creates nothing here; a system row is seeded directly to cover that label
 *   1  the Audit table has a "By" column                                                bug: no column
 *   2  the owner's row says "Seed Owner"; the member's row says "Morgan Member"           bug: no name anywhere
 *   3  a system row says "FinFlow (automatic)"
 *   4  the CSV export carries the By column too (it copies the table cells)
 *   5  GET /api/audit-log rows (the page's source) carry actor_name            bug: absent
 */
const bcrypt = require('bcryptjs');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { HarnessHttp } = require('./httpClient.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };
  const eq = (n, m, e, bug) => { const ms = JSON.stringify(m), es = JSON.stringify(e); A(n + `  [measured ${ms}, correct ${es}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, ms === es); };
  console.log('\nLR12 — the Audit page says who did it\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b, h = http) => { const r = await h.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 200)}`); return r.json; };
      const ent = (await J('POST', '/api/entities', { name: 'Business A', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
      await J('POST', '/api/entities/' + ent + '/activate', {});
      await J('POST', '/api/expenses', { description: 'LR12 OWNER EXP', category: 'Office', amount: 11, expense_date: '2026-07-10', idempotency_key: 'lr12-o' });
      const mid = (await client.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
        [{ email: 'lr12-member@finflow.test', name: 'Morgan Member', plan: 'business', role: 'owner', password: bcrypt.hashSync('harness-password-not-a-secret', 10) }])).rows[0].id;
      await client.query(`INSERT INTO team_members (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
        [userId, { member_user_id: String(mid), status: 'active', role: 'admin', name: 'Morgan Member', email: 'lr12-member@finflow.test' }]);
      const mh = new HarnessHttp(http.baseUrl);
      if ((await mh.post('/api/auth/login', { email: 'lr12-member@finflow.test', password: 'harness-password-not-a-secret' })).status !== 200) throw new Error('member login');
      await J('POST', '/api/expenses', { description: 'LR12 MEMBER EXP', category: 'Office', amount: 22, expense_date: '2026-07-11', idempotency_key: 'lr12-m' }, mh);
      await client.query(`INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, new_data, actor_type, actor_id) VALUES ($1,$2,'invoices',999,'CREATE',$3,'system',NULL)`,
        [userId, ent, JSON.stringify({ client: 'LR12 SYSTEM ROW' })]);
    } });
    const { window: w, settle, http } = boot;
    const d = w.document;
    await settle(60, 75);
    try { w.showPage('audit'); } catch (_) {}
    await settle(20, 60);
    try { await w.loadAuditTrail(); } catch (e) { console.log('    loadAuditTrail threw: ' + e.message); }
    await settle(20, 60);
    const page = d.getElementById('page-audit');
    const heads = page ? [...page.querySelectorAll('thead th')].map(th => th.textContent.trim()) : [];
    A('1  the Audit table has a "By" column', heads.includes('By'), JSON.stringify(heads));
    const rowsText = page ? [...page.querySelectorAll('tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ')) : [];
    const rowFor = (re) => rowsText.find(t => re.test(t)) || '';
    A('2  owner\'s expense row says "Seed Owner"', /Seed Owner/.test(rowFor(/LR12 OWNER EXP/)), rowFor(/LR12 OWNER EXP/).slice(0, 200));
    A('2  member\'s expense row says "Morgan Member"', /Morgan Member/.test(rowFor(/LR12 MEMBER EXP/)), rowFor(/LR12 MEMBER EXP/).slice(0, 200));
    A('3  system row says "FinFlow (automatic)"', /FinFlow \(automatic\)/.test(rowFor(/LR12 SYSTEM ROW/)), rowFor(/LR12 SYSTEM ROW/).slice(0, 200));
    const api = ((await http.get('/api/audit-log')).json || {}).rows || [];   // the endpoint the Audit page reads
    const names = [...new Set(api.filter(r => /LR12/.test(JSON.stringify(r.new_data || ''))).map(r => r.actor_name))].sort();
    eq('5  API rows carry actor_name', names, ['FinFlow (automatic)', 'Morgan Member', 'Seed Owner'], [null]);
    const csvRow = page ? [...page.querySelectorAll('tbody tr')].find(tr => /LR12 MEMBER EXP/.test(tr.textContent)) : null;
    A('4  the By cell is a real table cell (CSV export copies cells)', !!csvRow && [...csvRow.querySelectorAll('td')].some(td => td.textContent.trim() === 'Morgan Member'));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
