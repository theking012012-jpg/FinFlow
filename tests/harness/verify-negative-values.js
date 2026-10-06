#!/usr/bin/env node
'use strict';
/**
 * verify-negative-values.js — N105 class. Money and quantity fields (amount, price, cost, gross, units, hours,
 * rate, qty, stock, shares, …) are never negative on create or edit — a negative is refused (400), never stored
 * and never silently clamped to 0.
 *
 * Defect: routes stored a negative amount as-is (a −500 invoice, a −40 expense, a −3000 gross salary — silently
 * inverting a money figure) or clamped it (inventory units −5 → 0) without telling the user.
 * EXECUTED CLASS PROBE (Rule 13): every POST /api/<resource> and PUT /api/<resource>/:id backed by a JSONB
 * table in the live router gets a valid-looking body with every money/quantity field −5. A route fails if it
 * answers 2xx and a stored money/quantity field is negative. (Signed fields — `balance` — are excluded.)
 *   node -r ./tests/harness/clock.js tests/harness/verify-negative-values.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'neg-values-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'nv@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'NV Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.105.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'nv@finflow.test', password: PW })).status === 200);
    const app = require('../../server.js');
    const NUM = ['amount', 'price', 'cost', 'gross', 'bonus', 'overtime', 'units', 'max_units', 'hours', 'rate', 'qty', 'quantity', 'stock', 'shares', 'current_val', 'target_val', 'monthly_contrib', 'revenue', 'amount_paid'];
    const TEXT = ['name', 'description', 'client', 'customer', 'vendor', 'employee', 'fname', 'lname', 'ticker', 'keyword', 'category', 'company', 'project'];
    const STATUS_OF = { bills: 'unpaid', credit_notes: 'Open', vendor_credits: 'Open' };
    const TABLE_OF = { team: 'team_members' };
    const tables = new Set((await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='data'`)).rows.map(r => r.table_name));
    const base = (t) => { const d = { status: STATUS_OF[t] || 'pending', date: '2026-07-01', issue_date: '2026-07-01', expense_date: '2026-07-01', due_date: '2026-08-01', email: 'x@finflow.test', frequency: 'Monthly', next_run: '2026-08-01', kind: 'asset', target_val: 10 }; TEXT.forEach(k => { d[k] = 'Neg test'; }); return d; };
    const routes = [];
    for (const layer of app._router.stack) {
      const r = layer.route; if (!r || typeof r.path !== 'string') continue;
      let m = /^\/api\/([a-z-]+)$/.exec(r.path); if (m && r.methods.post) routes.push(['POST', r.path, TABLE_OF[m[1]] || m[1].replace(/-/g, '_')]);
      m = /^\/api\/([a-z-]+)\/:id$/.exec(r.path); if (m && r.methods.put) routes.push(['PUT', r.path, TABLE_OF[m[1]] || m[1].replace(/-/g, '_')]);
    }
    const bad = []; let probed = 0;
    for (const [method, path, table] of routes) {
      if (!tables.has(table)) continue;
      const body = base(table); NUM.forEach(k => { body[k] = -5; });
      let url = path, id = null;
      if (method === 'PUT') {
        const seed = base(table); NUM.forEach(k => { seed[k] = 5; });
        id = (await c.query(`INSERT INTO ${table} (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, seed])).rows[0].id;
        url = path.replace(':id', String(id));
      }
      const before = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM ${table}`)).rows[0].m;
      const r = method === 'PUT' ? await h.put(url, body) : await h.post(url, body);
      probed++;
      if (r.status >= 300) continue;
      const rows = method === 'PUT' ? (await c.query(`SELECT data FROM ${table} WHERE id=$1`, [id])).rows : (await c.query(`SELECT data FROM ${table} WHERE id > $1`, [before])).rows;
      for (const row of rows) for (const k of NUM) if (k in (row.data || {}) && Number(row.data[k]) < 0) { bad.push(`${method} ${path}: ${k} stored ${row.data[k]}`); break; }
    }
    console.log(`\n  class probe: ${probed} create/edit requests`);
    A('class probe reached the routes', probed >= 40, 'probed ' + probed);
    A('no create/edit route stores a negative money/quantity value (bug: stored as-is)', bad.length === 0, bad.join('\n          '));
    // The clamp case: a negative units edit is refused, not silently zeroed.
    const inv = (await c.query(`INSERT INTO inventory (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { name: 'Bolts', units: 10, max_units: 50, cost: 2 }])).rows[0].id;
    const r = await h.put('/api/inventory/' + inv, { units: -5 });
    const u = Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id=$1`, [inv])).rows[0].u);
    A('inventory PUT units −5 → 400, units stay 10 (bug: 200, clamped to 0)', r.status === 400 && u === 10, `status ${r.status} units ${u}`);
    A('control: a positive amount is accepted', (await h.post('/api/expenses', { description: 'Pos', amount: 12.5, category: 'Other', expense_date: '2026-07-02' })).status < 300);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (negative values)` : `  ALL GREEN — ${pass} passed, 0 failed  (negative values)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
