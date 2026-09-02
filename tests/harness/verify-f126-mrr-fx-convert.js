'use strict';
/**
 * verify-f126-mrr-fx-convert.js — F126. Under a display currency, MRR/ARR must be FX-CONVERTED, not
 * shown native-with-a-foreign-label. GET /api/recurring-invoices?display=<ccy> converts each amount
 * from the active entity's native currency → the display currency via rateAsOf (today, carry-forward),
 * and — honest like _applyConvertedKPIs/F34 — leaves amounts NATIVE with _fx.ok=false when no FX rate
 * exists, so the client shows "—" rather than a relabelled number.
 *
 * EXECUTED against real Postgres + the real endpoint + real rateAsOf. Discriminating (Rule 14): pre-fix
 * the ?display= param is ignored → amount stays native (1000, not 900) and there is no _fx field.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f126-mrr-fx-convert.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'f126-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'F126 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    // Active entity in USD (native source currency for conversion).
    const E = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'USD Co', currency: 'USD', is_active: 1, sort_order: 0 }])).rows[0].id;
    // An FX rate USD→EUR = 0.90 (effective before the pinned 2026-07-25).
    await c.query(`INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date, source) VALUES ($1,NULL,'USD','EUR',0.90,'2026-07-01','manual')`, [uid]);
    // One active $1,000/month recurring invoice on the active entity (entity_id NOT NULL — F150d).
    await c.query(`INSERT INTO recurring_invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, E, { client: 'Acme Sub', amount: 1000, frequency: 'Monthly', status: 'active', user_id: uid }]);

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);
    const rowOf = (arr) => (arr || []).find(r => r.client === 'Acme Sub');

    // 1 — native (no ?display=): byte-identical, amount 1000, no _fx.
    const rN = (await http.get('/api/recurring-invoices')).json;
    const n = rowOf(rN);
    A('native GET: amount stays 1000 (unconverted)', n && Number(n.amount) === 1000, `amount=${n && n.amount}`);
    A('native GET: no _fx field added', n && n._fx === undefined, `_fx=${JSON.stringify(n && n._fx)}`);

    // 2 — display=EUR with a rate: amount converted 1000 → 900, _fx.ok true.
    const rE = (await http.get('/api/recurring-invoices?display=EUR')).json;
    const e = rowOf(rE);
    A('A1: display=EUR converts amount 1000 → 900 (×0.90)', e && Number(e.amount) === 900, `amount=${e && e.amount}`);
    A('A2: _fx carries {display:EUR, from:USD, ok:true}', e && e._fx && e._fx.ok === true && e._fx.from === 'USD' && e._fx.display === 'EUR', `_fx=${JSON.stringify(e && e._fx)}`);

    // 3 — display=GBP with NO rate: honest — amount left native, _fx.ok false (client will show "—").
    const rG = (await http.get('/api/recurring-invoices?display=GBP')).json;
    const g = rowOf(rG);
    A('A3: display=GBP (no rate) leaves amount native (1000), _fx.ok=false', g && Number(g.amount) === 1000 && g._fx && g._fx.ok === false, `amount=${g && g.amount} _fx=${JSON.stringify(g && g._fx)}`);

    // STRUCTURAL — client loadMRRData wired to the display path + honesty.
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    AS('loadMRRData fetches recurring-invoices with ?display= when a display currency is active',
      /recurring-invoices'\+\(_dispCcy\?\('\?display='\+encodeURIComponent\(_dispCcy\)\)/.test(html));
    AS('MRR cards render the display symbol when converted, native otherwise',
      /_dispCcy && _fxOk[\s\S]*CURRENCIES\[_dispCcy\]/.test(html));
    AS('MRR shows honest "—" (not a relabelled native number) when no FX rate',
      /if\(_dispCcy && !_fxOk\)\{[\s\S]*No FX rate for[\s\S]*'—'/.test(html));
    // reverse: the native path is preserved (Σ frequency-normalised amounts still there)
    AS('native MRR math unchanged (frequency normalisation intact)', /if\(f\.startsWith\('week'\)\)\s*return s\+\(amt\*52\/12\)/.test(html));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F126 MRR/ARR FX conversion)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
