#!/usr/bin/env node
'use strict';
/**
 * verify-cogs-page-revenue.js — N68. The COGS page's Revenue and Gross Profit are the canonical figures for
 * the SAME business and period as its COGS.
 *
 * Defect: GET /api/cogs returned revenue = Σ PAID invoices of EVERY business over ALL time (cash basis) and
 * grossProfit = that − this business's period COGS — two bases and two scopes in one line.
 *
 * Seed (business A viewed, January fiscal year, today 2026-07-25):
 *   A: invoice 2026-07-01 1000 pending · invoice 2026-02-01 300 paid · invoice 2025-06-01 4000 paid (last FY)
 *   B: invoice 2026-07-01 5000 paid
 *   A inventory: purchase 10 @ 10 (2026-03-01), sale 4 (2026-07-10) → COGS 40
 *   period=year: revenue 1300, COGS 40, gross profit 1260    (bug: revenue 9300 = 300+4000+5000, GP 9260)
 *   no params (all time): revenue 5300 (1000+300+4000), GP 5260  (bug: 9300 / 9260)
 *   node -r ./tests/harness/clock.js tests/harness/verify-cogs-page-revenue.js
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
    const PW = 'cogs-page-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'cp@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const inv = (e, ymd, amt, status) => c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz)`,
      [uid, e, { client: 'Cust', amount: amt, amount_paid: status === 'paid' ? amt : 0, status, issue_date: ymd, due_date: ymd }, ymd + 'T16:00:00Z']);
    await inv(eA, '2026-07-01', 1000, 'pending');
    await inv(eA, '2026-02-01', 300, 'paid');
    await inv(eA, '2025-06-01', 4000, 'paid');
    await inv(eB, '2026-07-01', 5000, 'paid');
    const item = (await c.query(`INSERT INTO inventory (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { name: 'Widget', sku: 'W', units: 6, max_units: 100, cost: 10 }])).rows[0].id;
    await c.query(`INSERT INTO inventory_movements (user_id,entity_id,inventory_id,type,quantity,unit_cost,moved_at) VALUES ($1,$2,$3,'purchase',10,10,'2026-03-01T16:00:00Z'),($1,$2,$3,'sale',4,NULL,'2026-07-10T16:00:00Z')`, [uid, eA, item]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.68.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'cp@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  COGS PAGE — revenue / gross profit on the same basis and scope as COGS');
    console.log('='.repeat(78));
    const y = (await h.get(`/api/cogs?entity_id=${eA}&period=year&fyStart=0`)).json || {};
    A('period=year: COGS 40', Number(y.totalCOGS) === 40, 'got ' + y.totalCOGS);
    A('period=year: revenue 1300 — A only, issued this FY (bug: 9300)', Number(y.revenue) === 1300, 'got ' + y.revenue);
    A('period=year: gross profit 1260 (bug: 9260)', Number(y.grossProfit) === 1260, 'got ' + y.grossProfit);
    const rep = (await h.get(`/api/reports?entity_id=${eA}&period=year&fyStart=0`)).json || {};
    A('period=year: COGS page revenue = dashboard revenue (/api/reports)', Number(rep.revenue) === Number(y.revenue), `reports ${rep.revenue} cogs-page ${y.revenue}`);
    const all = (await h.get(`/api/cogs?entity_id=${eA}`)).json || {};
    A('all time: revenue 5300 = 1000 + 300 + 4000 (bug: 9300)', Number(all.revenue) === 5300, 'got ' + all.revenue);
    A('all time: gross profit 5260', Number(all.grossProfit) === 5260, 'got ' + all.grossProfit);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (COGS page revenue)` : `  ALL GREEN — ${pass} passed, 0 failed  (COGS page revenue)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
