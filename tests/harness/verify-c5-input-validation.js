'use strict';
/**
 * verify-c5-input-validation.js — EXECUTE (Rule 14) the C5 currency + ticker validation across all
 * 10 write sites. Each route must REJECT an invalid value with 400 (the fix) AND ACCEPT a valid one
 * (control — proves the guard discriminates the value, not a blanket failure). Pre-fix every reject
 * assertion FAILED (no validation existed); the valid controls pass on both builds.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c5-input-validation.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'c5@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
  const idOf = j => (j && (j.id ?? j._dbId));

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'C5', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    const BAD = 'NOTACURRENCY', BADT = 'bad ticker!!';

    // ── CURRENCY — 8 sites ───────────────────────────────────────────────────
    // entities POST/PUT
    A('entities POST bad currency -> 400', (await http.post('/api/entities', { name: 'E1', currency: BAD })).status === 400);
    const ent = await http.post('/api/entities', { name: 'E2', currency: 'EUR' });
    A('entities POST valid currency -> 2xx (control)', ent.status < 400, 'status=' + ent.status);
    const entId = idOf(ent.json);
    A('entities PUT bad currency -> 400', (await http.put(`/api/entities/${entId}`, { currency: BAD })).status === 400);
    A('entities PUT valid currency -> 2xx (control)', (await http.put(`/api/entities/${entId}`, { currency: 'GBP' })).status < 400);

    // personal-transactions POST/PUT
    A('personal-tx POST bad currency -> 400', (await http.post('/api/personal-transactions', { description: 'd', amount: 5, currency: BAD })).status === 400);
    const ptx = await http.post('/api/personal-transactions', { description: 'd', amount: 5, currency: 'CAD' });
    A('personal-tx POST valid currency -> 2xx (control)', ptx.status < 400, 'status=' + ptx.status);
    const ptxId = idOf(ptx.json);
    A('personal-tx PUT bad currency -> 400', (await http.put(`/api/personal-transactions/${ptxId}`, { currency: BAD })).status === 400);
    A('personal-tx PUT valid currency -> 2xx (control)', (await http.put(`/api/personal-transactions/${ptxId}`, { currency: 'JPY' })).status < 400);

    // recurring-personal-transactions POST/PUT
    A('recurring-tx POST bad currency -> 400', (await http.post('/api/recurring-personal-transactions', { description: 'r', amount: 5, currency: BAD })).status === 400);
    const rtx = await http.post('/api/recurring-personal-transactions', { description: 'r', amount: 5, currency: 'AUD' });
    A('recurring-tx POST valid currency -> 2xx (control)', rtx.status < 400, 'status=' + rtx.status);
    const rtxId = idOf(rtx.json);
    A('recurring-tx PUT bad currency -> 400', (await http.put(`/api/recurring-personal-transactions/${rtxId}`, { currency: BAD })).status === 400);
    A('recurring-tx PUT valid currency -> 2xx (control)', (await http.put(`/api/recurring-personal-transactions/${rtxId}`, { currency: 'CHF' })).status < 400);

    // fx-rates POST (from + to)
    A('fx-rates POST bad to_currency -> 400', (await http.post('/api/fx-rates', { from_currency: 'USD', to_currency: BAD, rate: 1.1 })).status === 400);
    A('fx-rates POST valid -> 2xx (control)', (await http.post('/api/fx-rates', { from_currency: 'USD', to_currency: 'EUR', rate: 1.1 })).status < 400);

    // fx-transactions POST
    A('fx-transactions POST bad foreign_currency -> 400', (await http.post('/api/fx-transactions', { foreign_currency: BAD, foreign_amount: 100, rate_at_transaction: 1.1 })).status === 400);
    A('fx-transactions POST valid -> 2xx (control)', (await http.post('/api/fx-transactions', { foreign_currency: 'EUR', foreign_amount: 100, rate_at_transaction: 1.1 })).status < 400);

    // ── TICKER — 2 sites ─────────────────────────────────────────────────────
    A('holdings POST bad ticker -> 400', (await http.post('/api/holdings', { ticker: BADT, shares: 10 })).status === 400);
    const hold = await http.post('/api/holdings', { ticker: 'AAPL', shares: 10 });
    A('holdings POST valid ticker -> 2xx (control)', hold.status < 400, 'status=' + hold.status);
    const holdId = idOf(hold.json);
    A('holdings PUT bad ticker -> 400', (await http.put(`/api/holdings/${holdId}`, { ticker: BADT })).status === 400);
    A('holdings PUT valid ticker -> 2xx (control)', (await http.put(`/api/holdings/${holdId}`, { ticker: 'MSFT' })).status < 400);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
