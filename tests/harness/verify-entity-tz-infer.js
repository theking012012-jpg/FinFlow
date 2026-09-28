'use strict';
/**
 * verify-entity-tz-infer.js — M2. An entity created WITHOUT an explicit timezone must have one INFERRED
 * from its country, so it never falls back to UTC (which misfiles late-local-evening timestamps and the
 * overdue cutoff for any non-UTC business). An explicitly supplied timezone must still win.
 *
 * EXECUTED against real Postgres + the real POST /api/entities route. Discriminating (Rule 14): before
 * the fix an omitted timezone was simply not stored (entity.timezone undefined → server resolves UTC),
 * so the inferred-value assertions fail; after the fix TT→America/Port_of_Spain, US→America/New_York,
 * and an explicit zone is preserved verbatim.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-tz-infer.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'm2-tz@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    // business plan → entity cap 5 (so we can create three)
    await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: OWNER.email, name: 'M2 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]);

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    // 1 · country TT, NO timezone → inferred America/Port_of_Spain
    const tt = await http.post('/api/entities', { name: 'Trinidad Co', currency: 'TTD', country: 'TT' });
    A('TT create → 201', tt.status === 201, `status ${tt.status}: ${tt.text && tt.text.slice(0,120)}`);
    A('M2: TT with no timezone → inferred America/Port_of_Spain', tt.json && tt.json.timezone === 'America/Port_of_Spain', JSON.stringify(tt.json));

    // 2 · country US, NO timezone → inferred America/New_York
    const us = await http.post('/api/entities', { name: 'US Co', currency: 'USD', country: 'US' });
    A('US create → 201', us.status === 201, `status ${us.status}: ${us.text && us.text.slice(0,120)}`);
    A('M2: US with no timezone → inferred America/New_York', us.json && us.json.timezone === 'America/New_York', JSON.stringify(us.json));

    // 3 · explicit timezone still WINS (inference must not override a supplied zone)
    const ex = await http.post('/api/entities', { name: 'Explicit Co', currency: 'USD', country: 'TT', timezone: 'America/New_York' });
    A('explicit create → 201', ex.status === 201, `status ${ex.status}: ${ex.text && ex.text.slice(0,120)}`);
    A('M2: explicit timezone preserved over inference', ex.json && ex.json.timezone === 'America/New_York', JSON.stringify(ex.json));

    // 4 · values SURVIVE a GET (real DB round-trip, not a request echo)
    const list = (await http.get('/api/entities')).json || [];
    const ttRow = list.find(x => x.id === (tt.json && tt.json.id));
    A('M2: inferred timezone round-trips from Postgres', ttRow && ttRow.timezone === 'America/Port_of_Spain', JSON.stringify(ttRow));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (M2 entity timezone inferred from country)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
