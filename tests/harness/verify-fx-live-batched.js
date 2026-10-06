#!/usr/bin/env node
'use strict';
/**
 * verify-fx-live-batched.js — N67. The live-FX refresh writes every user's rates with one statement per user,
 * keeps hand-entered rates, and updates (never duplicates) today's live rates.
 *
 * Defect: 2–3 queries per currency per user (~160 currencies → ~480 queries per user per refresh).
 * Executed: real Postgres, the real refreshLiveFxRates; open.er-api.com mocked at the HTTP boundary (5 rates).
 * Three users; user 1 has a MANUAL USD→EUR 0.5.
 *   queries during the refresh ≤ 1 + 3 (users) + 1        (bug: ~3 × 5 × 2 = 30+)
 *   each user has today's live rows (EUR/GBP/JPY/TTD/MXN, except user 1's manual EUR) — values as fetched
 *   user 1's manual EUR 0.5 untouched; a second refresh with new values updates, row count unchanged
 *   node -r ./tests/harness/clock.js tests/harness/verify-fx-live-batched.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let scratch, server;
  const realFetch = global.fetch;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    let RATES = { USD: 1, EUR: 0.9, GBP: 0.8, JPY: 150, TTD: 6.8, MXN: 17.5 };
    global.fetch = async (url, opts) => String(url).startsWith('https://open.er-api.com/') ? { ok: true, status: 200, json: async () => ({ result: 'success', rates: RATES }) } : realFetch(url, opts);
    const users = [];
    for (let i = 1; i <= 3; i++) {
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: `fx${i}@finflow.test` }])).rows[0].id;
      await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'Co ' + i, currency: 'USD' }]);
      users.push(uid);
    }
    await c.query(`INSERT INTO fx_rates (user_id,entity_id,from_currency,to_currency,rate,rate_date,source) VALUES ($1,NULL,'USD','EUR',0.5,'2026-07-01','manual')`, [users[0]]);
    const app = require('../../server.js');
    const { pool } = require('../../database.js');
    const realQ = pool.query.bind(pool); let n = 0;
    pool.query = (...a) => { n++; return realQ(...a); };
    await app._jobs.fxLive();
    pool.query = realQ;
    A('queries during the refresh ≤ 5 (bug: ~30+, one per currency per user)', n <= 5, 'queries ' + n);
    const live = async (uid, cur) => (await c.query(`SELECT rate::float r FROM fx_rates WHERE user_id=$1 AND from_currency='USD' AND to_currency=$2 AND source='live'`, [uid, cur])).rows.map(x => x.r);
    A('user 2 has today\'s live rates as fetched (GBP 0.8, JPY 150, TTD 6.8)', JSON.stringify(await live(users[1], 'GBP')) === '[0.8]' && JSON.stringify(await live(users[1], 'JPY')) === '[150]' && JSON.stringify(await live(users[1], 'TTD')) === '[6.8]');
    const man = (await c.query(`SELECT rate::float r FROM fx_rates WHERE user_id=$1 AND to_currency='EUR'`, [users[0]])).rows.map(x => x.r);
    A('user 1: manual EUR 0.5 kept, no live EUR written (manual wins)', JSON.stringify(man) === '[0.5]', JSON.stringify(man));
    const before = (await c.query(`SELECT COUNT(*)::int n FROM fx_rates`)).rows[0].n;
    RATES = Object.assign({}, RATES, { GBP: 0.79 });
    await app._jobs.fxLive();
    const after = (await c.query(`SELECT COUNT(*)::int n FROM fx_rates`)).rows[0].n;
    A('second refresh the same day updates (GBP 0.79), no duplicate rows', after === before && JSON.stringify(await live(users[2], 'GBP')) === '[0.79]', `rows ${before}→${after} GBP ${JSON.stringify(await live(users[2], 'GBP'))}`);
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (FX live batched)` : `  ALL GREEN — ${pass} passed, 0 failed  (FX live batched)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
