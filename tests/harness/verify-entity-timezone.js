'use strict';
/**
 * verify-entity-timezone.js (F88 step 1, Rule 14) — an entity must carry a validated IANA
 * `timezone` and an ISO-3166 alpha-2 `country`, round-tripped through real Postgres, and a junk
 * zone/country must be REJECTED (never stored — a bad zone would make a set of books resolve
 * "today" against a calendar that doesn't exist, the whole point of F88).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-timezone.js
 *
 * Discriminates (Rule 14): each accept case asserts the value SURVIVED a GET (DB round-trip, not a
 * request echo); each reject case asserts BOTH a 400 AND that a prior good value was NOT corrupted.
 * Before the F88 route change, timezone/country are silently dropped on write (accept cases fail:
 * the field reads back undefined) and the junk values are stored (reject cases fail: 201, not 400).
 */
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const REG = { email: 'f88-tz@finflow.test', password: 'harness-password-not-a-secret', name: 'F88 Owner' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`)); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);

    A('register owner → 2xx (session cookie set)', (await http.post('/api/auth/register', REG)).ok);

    // ── 1 · REJECT a junk timezone BEFORE any entity exists (so it can't be the plan cap masking it) ──
    const badTz = await http.post('/api/entities', { name: 'Bad Zone Co', timezone: 'Pluto/Central' });
    A('junk timezone → 400 (not stored, not a 500/402)', badTz.status === 400, `status ${badTz.status}: ${badTz.text?.slice(0,120)}`);
    A('junk timezone 400 names the field', badTz.status === 400 && /timezone/i.test(badTz.text || ''), badTz.text?.slice(0,120));

    // ── 1b · REJECT a junk country ──
    const badCc = await http.post('/api/entities', { name: 'Bad Country Co', country: 'XYZ' });
    A('junk country → 400', badCc.status === 400, `status ${badCc.status}: ${badCc.text?.slice(0,120)}`);
    A('junk country 400 names the field', badCc.status === 400 && /country/i.test(badCc.text || ''), badCc.text?.slice(0,120));

    // ── 2 · ACCEPT a valid entity with tz + country (country lower-case → stored upper-case) ──
    const create = await http.post('/api/entities', { name: 'Maple & Oak Ltd.', currency: 'CAD', timezone: 'America/Toronto', country: 'ca' });
    A('valid create → 201', create.status === 201, `status ${create.status}: ${create.text?.slice(0,120)}`);
    const eid = create.json && create.json.id;
    A('create response carries timezone', create.json && create.json.timezone === 'America/Toronto', JSON.stringify(create.json));
    A('create response carries country, upper-cased', create.json && create.json.country === 'CA', JSON.stringify(create.json));

    // ── 3 · the values SURVIVE a GET (proves a real DB round-trip, not just a request echo) ──
    let list = (await http.get('/api/entities')).json || [];
    let e = list.find(x => x.id === eid);
    A('GET round-trips timezone from Postgres', e && e.timezone === 'America/Toronto', JSON.stringify(e));
    A('GET round-trips country from Postgres', e && e.country === 'CA', JSON.stringify(e));

    // ── 4 · UPDATE the zone/country, and it persists ──
    const upd = await http.put('/api/entities/' + eid, { timezone: 'Europe/Berlin', country: 'DE' });
    A('update → 200', upd.status === 200, `status ${upd.status}: ${upd.text?.slice(0,120)}`);
    list = (await http.get('/api/entities')).json || [];
    e = list.find(x => x.id === eid);
    A('GET shows the updated timezone', e && e.timezone === 'Europe/Berlin', JSON.stringify(e));
    A('GET shows the updated country', e && e.country === 'DE', JSON.stringify(e));

    // ── 5 · a junk UPDATE is rejected AND does not corrupt the stored good value (discriminating) ──
    const badUpd = await http.put('/api/entities/' + eid, { timezone: 'Bogus/Zone' });
    A('junk update → 400', badUpd.status === 400, `status ${badUpd.status}: ${badUpd.text?.slice(0,120)}`);
    list = (await http.get('/api/entities')).json || [];
    e = list.find(x => x.id === eid);
    A('rejected update left the good timezone intact (Europe/Berlin)', e && e.timezone === 'Europe/Berlin', JSON.stringify(e));

    // ── 6 · absent tz/country is allowed on update (clears cleanly, no forced value) ──
    const clear = await http.put('/api/entities/' + eid, { timezone: '', country: '' });
    A('clearing tz/country → 200 (empty allowed)', clear.status === 200, `status ${clear.status}`);
    list = (await http.get('/api/entities')).json || [];
    e = list.find(x => x.id === eid);
    A('cleared timezone reads back null/absent (falls back to UTC downstream)', e && (e.timezone == null), JSON.stringify(e));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : 'RED'} — ${pass} passed, ${fail} failed  (F88 entity timezone/country)`);
  } catch (e) {
    console.error('FATAL', e && (e.stack || e.message || e));
    fail++;
  } finally {
    try { await server?.close(); } catch {}
    try { await scratch?.stop(); } catch {}
    process.exit(fail ? 1 : 0);
  }
})();
