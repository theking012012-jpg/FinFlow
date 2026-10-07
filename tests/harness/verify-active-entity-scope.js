#!/usr/bin/env node
'use strict';
/**
 * verify-active-entity-scope.js — N31 class. "The active business" of a request is the business the
 * request is scoped to (req.entityId), on the ACCOUNT — never the actor's own is_active flag.
 *
 * Defect: activeEntity(req.session.userId) returned the ACTOR's is_active entity. A request scoped to
 * business B (TTD) got business A (USD, flagged active); a team member owns no entities and got null.
 * Executed surface: GET /api/recurring-invoices?display=USD (F126 MRR view) converted every schedule
 * from that wrong currency.
 *
 * Seed: A = USD (is_active), B = TTD; fx TTD→USD 0.15. Recurring invoice in B: 1000 TTD.
 *   viewing B, display USD → amount 150, _fx.from TTD           (bug: 1000, from USD — A's currency)
 *   viewing A, display USD → a USD schedule in A stays 400       (control)
 *   viewing B, display TTD → 1000 unchanged, rate 1               (control: identity)
 *   node -r ./tests/harness/clock.js tests/harness/verify-active-entity-scope.js
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
    const PW = 'active-ent-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'ae@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'TTD', is_active: 0 }])).rows[0].id;
    await c.query(`INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date) VALUES ($1,NULL,'TTD','USD',0.15,'2026-01-01')`, [uid]);
    const riB = (await c.query(`INSERT INTO recurring_invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eB, { client: 'B client', amount: 1000, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' }])).rows[0].id;
    const riA = (await c.query(`INSERT INTO recurring_invoices (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`, [uid, eA, { client: 'A client', amount: 400, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.31.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'ae@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  ACTIVE BUSINESS = the request\'s business, on the account');
    console.log('='.repeat(78));
    const b = await h.get(`/api/recurring-invoices?entity_id=${eB}&display=USD`);
    const rb = (b.json || []).find(r => r.id === riB) || {};
    A('viewing B (TTD), display USD: 1000 TTD → 150 USD (bug: 1000, converted from A\'s USD)', Math.abs(Number(rb.amount) - 150) < 0.005, JSON.stringify(rb._fx) + ' amount=' + rb.amount);
    A('  _fx.from = TTD (bug: USD)', rb._fx && rb._fx.from === 'TTD', JSON.stringify(rb._fx));
    const a = await h.get(`/api/recurring-invoices?entity_id=${eA}&display=USD`);
    const ra = (a.json || []).find(r => r.id === riA) || {};
    A('control: viewing A (USD), display USD: 400 stays 400', Number(ra.amount) === 400 && ra._fx && ra._fx.from === 'USD', JSON.stringify(ra));
    const t = await h.get(`/api/recurring-invoices?entity_id=${eB}&display=TTD`);
    const rt = (t.json || []).find(r => r.id === riB) || {};
    A('control: viewing B, display TTD: identity 1000', Number(rt.amount) === 1000 && rt._fx && rt._fx.rate === 1, JSON.stringify(rt));

    // POST fallbacks read the same helper: a quote created while viewing B lands in B.
    const q = await h.post(`/api/quotes?entity_id=${eB}`, { client: 'Q client', amount: 10, date: '2026-07-20' });
    const qId = q.json && q.json.id;
    const qEnt = qId ? (await c.query(`SELECT entity_id FROM quotes WHERE id=$1`, [qId])).rows[0].entity_id : null;
    A('control: quote created while viewing B is stored in B', qEnt === eB, `status ${q.status} entity ${qEnt}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (active entity scope)` : `  ALL GREEN — ${pass} passed, 0 failed  (active entity scope)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
