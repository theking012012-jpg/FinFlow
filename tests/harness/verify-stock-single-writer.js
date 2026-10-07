#!/usr/bin/env node
'use strict';
/**
 * verify-stock-single-writer.js — N69. Units on hand change only through stock movements, so every unit has
 * a FIFO cost layer, every sale a COGS, and the ledger carries the inventory.
 *
 * Defects: opening units on POST /api/inventory, POST /api/inventory/:id/restock and PUT units all set the
 * units figure directly — no purchase movement, no FIFO layer, no ledger entry. Selling that stock then had
 * "no cost basis": COGS 0, gross profit overstated, inventory absent from the balance sheet.
 *
 * Seed / hand computation (business A):
 *   create "Gizmo" with 10 units @ 5          → purchase movement 10 @ 5 "Opening stock"; GL Dr 1200 50 / Cr 3100 50  (bug: no movement, no GL)
 *   restock 5 @ 8                             → purchase movement 5 @ 8; units 15; GL Dr 1200 40 / Cr 1000 40          (bug: units 15, nothing else)
 *   PUT units 99                              → 400 STOCK_VIA_MOVEMENTS, units stay 15                                (bug: 200, 99)
 *   sell 12 (inventory-movements)             → FIFO COGS = 10 × 5 + 2 × 8 = 66; units 3                              (bug: COGS 0 — no layers)
 *   control: PUT name with units unchanged    → 200
 *   node -r ./tests/harness/clock.js tests/harness/verify-stock-single-writer.js
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
    const PW = 'stock-writer-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'sw@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.69.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'sw@finflow.test', password: PW })).status === 200);
    const q = `?entity_id=${eA}`;
    const mv = async (id) => (await c.query(`SELECT type, quantity::float q, unit_cost::float uc, reference FROM inventory_movements WHERE inventory_id=$1 ORDER BY id`, [id])).rows;
    const units = async (id) => Number((await c.query(`SELECT data->>'units' u FROM inventory WHERE id=$1`, [id])).rows[0].u);
    const gl = async (code) => Number((await c.query(`SELECT COALESCE(SUM(ll.debit) - SUM(ll.credit),0) n FROM ledger_lines ll JOIN ledger_accounts la ON la.id = ll.account_id JOIN ledger_entries le ON le.id = ll.entry_id
                                                     WHERE le.user_id=$1 AND la.code=$2 AND le.source_type='inventory_movement' AND le.status='posted'`, [uid, code])).rows[0].n);

    console.log('\n' + '='.repeat(78));
    console.log('  STOCK — one writer: movements (FIFO layers, COGS, ledger)');
    console.log('='.repeat(78));
    const cr = await h.post('/api/inventory' + q, { name: 'Gizmo', sku: 'GZ-1', units: 10, cost: 5, max_units: 100 });
    const id = cr.json && cr.json.id;
    A('create Gizmo with 10 units → 201, units 10', cr.status === 201 && (await units(id)) === 10, `status ${cr.status}`);
    const m0 = await mv(id);
    A('  opening-stock purchase movement 10 @ 5 (bug: none)', m0.length === 1 && m0[0].type === 'purchase' && m0[0].q === 10 && m0[0].uc === 5 && /Opening/i.test(m0[0].reference || ''), JSON.stringify(m0));
    A('  ledger: Inventory 1200 +50 against Owner\'s Equity 3100 (bug: nothing)', (await gl('1200')) === 50 && (await gl('3100')) === -50, `1200=${await gl('1200')} 3100=${await gl('3100')}`);
    const rs = await h.post(`/api/inventory/${id}/restock${q}`, { qty: 5, unit_cost: 8 });
    const m1 = await mv(id);
    A('restock 5 @ 8 → units 15 and a purchase movement 5 @ 8 (bug: units only)', rs.status === 200 && (await units(id)) === 15 && m1.length === 2 && m1[1].type === 'purchase' && m1[1].q === 5 && m1[1].uc === 8, `status ${rs.status} ${JSON.stringify(m1)}`);
    A('  ledger: Inventory 1200 now 90; cash 1000 −40', (await gl('1200')) === 90 && (await gl('1000')) === -40, `1200=${await gl('1200')} 1000=${await gl('1000')}`);
    const pu = await h.put(`/api/inventory/${id}${q}`, { units: 99 });
    A('PUT units 99 → 400 STOCK_VIA_MOVEMENTS, units stay 15 (bug: 200, 99)', pu.status === 400 && pu.json && pu.json.code === 'STOCK_VIA_MOVEMENTS' && (await units(id)) === 15, `status ${pu.status} units ${await units(id)}`);
    const pn = await h.put(`/api/inventory/${id}${q}`, { name: 'Gizmo Pro', units: 15, cost: 5 });
    A('control: PUT name with units unchanged → 200', pn.status === 200, `status ${pn.status} ${pn.text.slice(0, 100)}`);
    const sale = await h.post('/api/inventory-movements' + q, { inventory_id: id, type: 'sale', quantity: 12 });
    A('sell 12 → FIFO COGS 66 = 10 × 5 + 2 × 8 (bug: 0 — no cost layers)', sale.status === 201 && Number(sale.json && sale.json.cogs) === 66, `status ${sale.status} cogs ${sale.json && sale.json.cogs}`);
    A('  units 3; ledger COGS 5000 = 66, Inventory 1200 = 24', (await units(id)) === 3 && (await gl('5000')) === 66 && (await gl('1200')) === 24, `units ${await units(id)} 5000=${await gl('5000')} 1200=${await gl('1200')}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (stock single writer)` : `  ALL GREEN — ${pass} passed, 0 failed  (stock single writer)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
