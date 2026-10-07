#!/usr/bin/env node
'use strict';
/**
 * verify-put-field-validation.js — N14. PUT on payroll / inventory / items validates its fields: text
 * fields are stored as text, money/quantity fields must be numbers ≥ 0, and a wrong type is a 400 — never
 * a 500 and never a silently-nulled amount.
 *
 * Defects: PUT /api/items called .trim()/.slice() on whatever arrived (a number name → TypeError → 500);
 * PUT /api/payroll, /api/inventory, /api/items stored raw values for text fields (objects/arrays went
 * straight into the row) and parseFloat()'d money fields without checking — gross: "abc" stored NaN,
 * which JSON turns into null, zeroing that employee's payroll; price/cost likewise.
 *
 * Executed against the real server + Postgres. Bug value stated:
 *   items PUT {name: 123}          → 200, name "123"            (bug: 500)
 *   items PUT {price: "abc"}       → 400, price unchanged 50    (bug: 200, price null)
 *   payroll PUT {gross: "abc"}     → 400, gross unchanged 3000  (bug: 200, gross null)
 *   payroll PUT {fname: {x: 1}}    → 400                        (bug: 200, object stored)
 *   inventory PUT {cost: "x"}      → 400, cost unchanged 12     (bug: 200, cost null)
 *   controls: valid edits → 200 with the values applied
 *   node -r ./tests/harness/clock.js tests/harness/verify-put-field-validation.js
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
    const PW = 'put-valid-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'pv@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'PV Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const item = (await c.query(`INSERT INTO items (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { name: 'Widget', price: 50, unit: 'ea', sku: 'W1' }])).rows[0].id;
    const emp = (await c.query(`INSERT INTO payroll (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { fname: 'Pat', lname: 'Lee', gross: 3000, deductions: [] }])).rows[0].id;
    const inv = (await c.query(`INSERT INTO inventory (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, { name: 'Bolts', units: 100, max_units: 500, cost: 12 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.14.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'pv@finflow.test', password: PW })).status === 200);
    const f = async (t, id, k) => (await c.query(`SELECT data->$2 v FROM ${t} WHERE id=$1`, [id, k])).rows[0].v;

    console.log('\n' + '='.repeat(78));
    console.log('  PUT FIELD VALIDATION — payroll / inventory / items');
    console.log('='.repeat(78));
    const r1 = await h.put('/api/items/' + item, { name: 123 });
    A('items {name: 123} → 200, stored "123" (bug: 500)', r1.status === 200 && (await f('items', item, 'name')) === '123', `status ${r1.status} name=${JSON.stringify(await f('items', item, 'name'))}`);
    const r2 = await h.put('/api/items/' + item, { price: 'abc' });
    A('items {price: "abc"} → 400, price stays 50 (bug: 200, null)', r2.status === 400 && Number(await f('items', item, 'price')) === 50, `status ${r2.status} price=${JSON.stringify(await f('items', item, 'price'))}`);
    const r3 = await h.put('/api/payroll/' + emp, { gross: 'abc' });
    A('payroll {gross: "abc"} → 400, gross stays 3000 (bug: 200, null)', r3.status === 400 && Number(await f('payroll', emp, 'gross')) === 3000, `status ${r3.status} gross=${JSON.stringify(await f('payroll', emp, 'gross'))}`);
    const r4 = await h.put('/api/payroll/' + emp, { fname: { x: 1 } });
    A('payroll {fname: {x:1}} → 400 (bug: 200, object stored)', r4.status === 400 && (await f('payroll', emp, 'fname')) === 'Pat', `status ${r4.status} fname=${JSON.stringify(await f('payroll', emp, 'fname'))}`);
    const r5 = await h.put('/api/inventory/' + inv, { cost: 'x' });
    A('inventory {cost: "x"} → 400, cost stays 12 (bug: 200, null)', r5.status === 400 && Number(await f('inventory', inv, 'cost')) === 12, `status ${r5.status} cost=${JSON.stringify(await f('inventory', inv, 'cost'))}`);
    A('control: items valid edit applies', (await h.put('/api/items/' + item, { name: '  Gadget ', price: '75.5' })).status === 200 && (await f('items', item, 'name')) === 'Gadget' && Number(await f('items', item, 'price')) === 75.5);
    A('control: payroll valid edit applies', (await h.put('/api/payroll/' + emp, { gross: 3200, fname: 'Patricia' })).status === 200 && Number(await f('payroll', emp, 'gross')) === 3200);
    // N69: units change only through stock movements — a valid edit is name/cost with units unchanged.
    A('control: inventory valid edit applies', (await h.put('/api/inventory/' + inv, { units: 100, cost: '13.25', name: 'Bolts M6' })).status === 200 && Number(await f('inventory', inv, 'units')) === 100 && Number(await f('inventory', inv, 'cost')) === 13.25);

    // ── CLASS PROBE (Rule 13, executed): every PUT /api/<resource>/:id in the live router. One owned row is
    // seeded per resource, then two hostile bodies are sent: wrong-typed TEXT fields (number / object /
    // array) and junk NUMERIC fields ("abc"). A route fails the class if it answers 500, stores an
    // object/array in a text field, or turns a stored number into null / NaN / a non-number.
    const app = require('../../server.js');
    const TEXT = ['employee', 'name', 'description', 'client', 'customer', 'vendor', 'keyword', 'unit', 'sku', 'notes', 'memo', 'fname', 'lname', 'role', 'title', 'category', 'reason', 'method', 'reference', 'institution', 'symbol', 'type', 'project', 'task'];
    const NUM = ['amount', 'price', 'cost', 'gross', 'units', 'max_units', 'hours', 'rate', 'current_val', 'target_val', 'monthly_contrib', 'balance', 'budget', 'shares', 'qty', 'quantity', 'stock', 'revenue'];
    const TABLE_OF = { team: 'team_members' };
    const tables = new Set((await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='data'`)).rows.map(r => r.table_name));
    const putRoutes = [];
    for (const layer of app._router.stack) {
      const r = layer.route; if (!r || !r.methods.put || typeof r.path !== 'string') continue;
      const m = /^\/api\/([a-z-]+)\/:id$/.exec(r.path); if (m) putRoutes.push([r.path, TABLE_OF[m[1]] || m[1].replace(/-/g, '_')]);
    }
    const STATUS_OF = { bills: 'unpaid', credit_notes: 'Open', vendor_credits: 'Open' };   // chk_<table>_status vocabularies (schema)
    const seedRow = (table) => { const d = { status: STATUS_OF[table] || 'pending', date: '2026-07-01', issue_date: '2026-07-01', expense_date: '2026-07-01', due_date: '2026-08-01', email: 'seed@finflow.test' }; TEXT.forEach(k => { d[k] = 'Orig'; }); NUM.forEach(k => { d[k] = 100; }); d.type = 'service'; return d; };
    const probed = [], classBad = [], skipped = [];
    for (const [path, table] of putRoutes) {
      if (!tables.has(table)) { skipped.push(path + ' (no JSONB table ' + table + ')'); continue; }
      const id = (await c.query(`INSERT INTO ${table} (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eid, seedRow(table)])).rows[0].id;
      const url = path.replace(':id', String(id));
      const tb = {}; TEXT.forEach((k, i) => { tb[k] = i % 3 === 0 ? 123 : i % 3 === 1 ? { x: 1 } : [1]; });
      const rt = await h.put(url, tb);
      const nb = {}; NUM.forEach(k => { nb[k] = 'abc'; });
      const rn = await h.put(url, nb);
      const data = (await c.query(`SELECT data FROM ${table} WHERE id=$1`, [id])).rows[0].data || {};
      const why = [];
      if (rt.status >= 500) why.push('text body → ' + rt.status);
      if (rn.status >= 500) why.push('numeric body → ' + rn.status);
      TEXT.forEach(k => { if (data[k] !== null && typeof data[k] === 'object') why.push(k + ' stored ' + JSON.stringify(data[k])); });
      NUM.forEach(k => { if (k in data && !(typeof data[k] === 'number' && Number.isFinite(data[k]))) why.push(k + ' stored ' + JSON.stringify(data[k])); });
      probed.push(path);
      if (why.length) classBad.push(path + ': ' + why.join('; '));
    }
    // Same class on CREATE: every POST /api/<resource> backed by a JSONB table. A valid-looking base body
    // with the text fields, then the numeric fields, corrupted. Fails on a 500, or on a created row holding
    // an object in a text field or a non-number in a numeric field.
    const postRoutes = [];
    for (const layer of app._router.stack) {
      const r = layer.route; if (!r || !r.methods.post || typeof r.path !== 'string') continue;
      const m = /^\/api\/([a-z-]+)$/.exec(r.path); if (m) { const t = TABLE_OF[m[1]] || m[1].replace(/-/g, '_'); if (tables.has(t)) postRoutes.push([r.path, t]); }
    }
    let postProbed = 0;
    for (const [path, table] of postRoutes) {
      for (const which of ['text', 'num']) {
        const body = seedRow(table);
        if (which === 'text') TEXT.forEach((k, i) => { body[k] = i % 3 === 0 ? 123 : i % 3 === 1 ? { x: 1 } : [1]; });
        else NUM.forEach(k => { body[k] = 'abc'; });
        const before = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM ${table}`)).rows[0].m;
        const r = await h.post(path, body);
        postProbed++;
        const why = [];
        if (r.status >= 500) why.push(which + ' body → ' + r.status);
        for (const row of (await c.query(`SELECT data FROM ${table} WHERE id > $1`, [before])).rows) {
          const d = row.data || {};
          TEXT.forEach(k => { if (d[k] !== null && typeof d[k] === 'object') why.push('created row ' + k + ' = ' + JSON.stringify(d[k])); });
          NUM.forEach(k => { if (k in d && !(typeof d[k] === 'number' && Number.isFinite(d[k]))) why.push('created row ' + k + ' = ' + JSON.stringify(d[k])); });
        }
        if (why.length) classBad.push('POST ' + path + ': ' + why.join('; '));
      }
    }
    console.log('  class probe: ' + postProbed + ' POST create requests across ' + postRoutes.length + ' routes');
    A('class probe reached the POST create routes', postRoutes.length >= 20, 'routes ' + postRoutes.length);
    console.log('\n  class probe: ' + probed.length + ' PUT :id routes probed' + (skipped.length ? '; not JSONB-backed (not probed): ' + skipped.join(', ') : ''));
    A('class probe reached the PUT :id routes', probed.length >= 20, 'probed ' + probed.length);
    A('no PUT :id / POST create route 500s, stores an object as text, or nulls a stored number on wrong-typed input', classBad.length === 0, classBad.join('\n          '));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (PUT field validation)` : `  ALL GREEN — ${pass} passed, 0 failed  (PUT field validation)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
