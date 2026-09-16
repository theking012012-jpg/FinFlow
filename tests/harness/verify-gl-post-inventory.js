'use strict';
/**
 * verify-gl-post-inventory.js — GL Phase 2: inventory movements.
 *   PURCHASE  → Dr Inventory (1200) / Cr Cash (1000) = qty*unit_cost (capitalise stock)
 *   SALE      → Dr COGS (5000) / Cr Inventory (1200) = FIFO cost (relieve stock)
 * Drives POST /api/inventory → POST /api/inventory-movements (2 purchases, 1 sale). Proves each entry
 * balances, the sale posts at the FIFO cost (layered across both purchases, Rule 4), ledger COGS ==
 * computeBooks.cogs (oracle), Inventory carries the residual, Cash reflects the cash out, TB ties to 0.
 * Discriminating seed: buy 10@5 (=50) then 6@8 (=48); sell 12 → FIFO 10*5+2*8 = 66 (not 12*avg, not 60).
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-inventory.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — inventory (purchase capitalises; sale relieves at FIFO COGS)\n' + '='.repeat(78) + '\n');
    const email = 'glinv@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.72' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    const itR = await http.post('/api/inventory', { name: 'Widget', sku: 'W1', cost: 5, entity_id: eid });
    A('POST inventory item 2xx', itR.status >= 200 && itR.status < 300, 'status=' + itR.status + ' ' + (itR.text || '').slice(0, 140));
    const item = JSON.parse(itR.text);

    const mv = (type, quantity, unit_cost) => http.post('/api/inventory-movements', { inventory_id: item.id, type, quantity, unit_cost, entity_id: eid });
    const entryLines = async srcId => (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id JOIN ledger_entries le ON le.id=ll.entry_id WHERE le.source_type='inventory_movement' AND le.source_id=$1`, [srcId])).rows;

    const p1 = await mv('purchase', 10, 5);
    A('POST purchase#1 (10@5) 2xx', p1.status >= 200 && p1.status < 300, 'status=' + p1.status + ' ' + (p1.text || '').slice(0, 140));
    const m1 = JSON.parse(p1.text);
    const l1 = Object.fromEntries((await entryLines(m1.id)).map(l => [l.code, l]));
    A('purchase#1: Dr Inventory (1200)=50 / Cr Cash (1000)=50', l1['1200'] && near(l1['1200'].debit, 50) && l1['1000'] && near(l1['1000'].credit, 50), JSON.stringify(l1));

    const p2 = await mv('purchase', 6, 8);
    A('POST purchase#2 (6@8) 2xx', p2.status >= 200 && p2.status < 300, 'status=' + p2.status);
    const m2 = JSON.parse(p2.text);

    const sale = await mv('sale', 12, 0);
    A('POST sale (12) 2xx', sale.status >= 200 && sale.status < 300, 'status=' + sale.status + ' ' + (sale.text || '').slice(0, 140));
    const ms = JSON.parse(sale.text);
    A('sale response cogs = 66 (FIFO 10*5 + 2*8)', near(ms.cogs, 66), 'cogs=' + ms.cogs);
    const ls = Object.fromEntries((await entryLines(ms.id)).map(l => [l.code, l]));
    A('sale: Dr COGS (5000) = 66', ls['5000'] && near(ls['5000'].debit, 66) && near(ls['5000'].credit, 0), JSON.stringify(ls['5000']));
    A('sale: Cr Inventory (1200) = 66', ls['1200'] && near(ls['1200'].credit, 66) && near(ls['1200'].debit, 0), JSON.stringify(ls['1200']));
    const saleAll = await entryLines(ms.id);
    A('sale entry balances', near(saleAll.reduce((s, l) => s + +l.debit, 0), saleAll.reduce((s, l) => s + +l.credit, 0)));

    // Harness clock skew: inventory_movements.moved_at defaults to Postgres NOW() (real wall-clock),
    // which is AFTER the pinned JS test clock (2026-07-25), so computeBooks' D2 rule treats the sale as
    // future-dated and drops it. Backdate to fixed in-period, DISTINCT purchase dates (so FIFO layer
    // order is deterministic: 10@5 before 6@8) and an in-period sale date. The GL entries stay as
    // posted; ledger COGS is all-time, so this only fixes what computeBooks recognises for the window.
    await c.query(`UPDATE inventory_movements SET moved_at='2026-06-01' WHERE inventory_id=$1 AND type='purchase' AND unit_cost=5`, [item.id]);
    await c.query(`UPDATE inventory_movements SET moved_at='2026-06-02' WHERE inventory_id=$1 AND type='purchase' AND unit_cost=8`, [item.id]);
    await c.query(`UPDATE inventory_movements SET moved_at='2026-06-15' WHERE inventory_id=$1 AND type='sale'`, [item.id]);

    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger COGS (66) == computeBooks.cogs', near(await bal('5000'), books.cogs) && near(books.cogs, 66), 'ledger5000=' + (await bal('5000')) + ' cogs=' + books.cogs);
    A('ledger Inventory (1200) residual == 32 (98 bought − 66 sold)', near(await bal('1200'), 32), 'inv=' + (await bal('1200')));
    A('ledger Cash (1000) == −98 (cash paid for purchases)', near(await bal('1000'), -98), 'cash=' + (await bal('1000')));

    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));
    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL inventory == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
