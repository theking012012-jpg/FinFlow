#!/usr/bin/env node
'use strict';
/**
 * verify-fx-base-currency.js — N108. An FX position's base currency is its business's currency, so its
 * unrealised gain/loss is measured against the right pair.
 *
 * Defect: fx_transactions.base_currency defaulted to 'USD' and POST never set it. A TTD business's EUR position
 * (opened at EUR→TTD 7.00) had its unrealised P/L read from EUR→USD.
 * Seed: business TTD; rates EUR→TTD 7.50 and EUR→USD 1.10. Position EUR 100 @ 7.00.
 *   base_currency TTD (bug: USD) · unrealised = (7.50 − 7.00) × 100 = 50 (bug: (1.10 − 7.00) × 100 = −590)
 *   control: a USD business's position → base USD
 *   node -r ./tests/harness/clock.js tests/harness/verify-fx-base-currency.js
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
    const PW = 'fx-base-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'fb@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eT = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'TT Co', currency: 'TTD', is_active: 1 }])).rows[0].id;
    const eU = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'US Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    await c.query(`INSERT INTO fx_rates (user_id,entity_id,from_currency,to_currency,rate,rate_date) VALUES ($1,NULL,'EUR','TTD',7.5,'2026-07-20'),($1,NULL,'EUR','USD',1.1,'2026-07-20')`, [uid]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.108.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'fb@finflow.test', password: PW })).status === 200);
    const p = await h.post(`/api/fx-transactions?entity_id=${eT}`, { foreign_currency: 'EUR', foreign_amount: 100, rate_at_transaction: 7.0 });
    A('TT position: base_currency TTD (bug: USD)', p.json && p.json.base_currency === 'TTD', JSON.stringify(p.json && p.json.base_currency));
    const list = (await h.get(`/api/fx-transactions?entity_id=${eT}`)).json || [];
    const t = (Array.isArray(list) ? list : (list.transactions || [])).find(x => x.id === (p.json && p.json.id)) || {};
    A('TT position: unrealised = (7.50 − 7.00) × 100 = 50 (bug: −590)', Number(t.unrealised_gain_loss) === 50, 'unrealised ' + t.unrealised_gain_loss);
    const pu = await h.post(`/api/fx-transactions?entity_id=${eU}`, { foreign_currency: 'EUR', foreign_amount: 100, rate_at_transaction: 1.0 });
    A('control: US position base USD', pu.json && pu.json.base_currency === 'USD', JSON.stringify(pu.json && pu.json.base_currency));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (FX base currency)` : `  ALL GREEN — ${pass} passed, 0 failed  (FX base currency)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
