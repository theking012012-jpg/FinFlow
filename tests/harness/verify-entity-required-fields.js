'use strict';
/**
 * verify-entity-required-fields.js — the TIGHTENED entity-creation contract, executed.
 * POST /api/entities now requires name + country + currency (country drives tax/filing; an entity with
 * no jurisdiction is useless downstream). The UPDATE path stays lenient so pre-existing (legacy)
 * entities created before this rule can still be edited without being forced to backfill.
 *
 * Proves (Rule 14 — the 400s ARE the enforcement; a broken gate turns them into 2xx):
 *   · create with NO country            → 400 "Country is required."
 *   · create with NO name               → 400 "Name is required."
 *   · create with blank currency        → 400 "Currency is required."
 *   · create with a malformed country   → 400 "Invalid country code."
 *   · create with name+country(+default currency) → 201, and country is actually stored
 *   · GRANDFATHER: a legacy entity row with no country can still be PUT-updated (rename) → 200
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-required-fields.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const PW = 'harness-password-not-a-secret';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);

    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'ent-req@finflow.test', name: 'Ent Req', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('owner login', (await http.post('/api/auth/login', { email: 'ent-req@finflow.test', password: PW })).status === 200);

    // ── create rejections ──
    const noCountry = await http.post('/api/entities', { name: 'No Country Co' });
    A('create with no country → 400 "Country is required"', noCountry.status === 400 && /country is required/i.test(noCountry.json && noCountry.json.error || ''), `status ${noCountry.status}: ${JSON.stringify(noCountry.json)}`);

    const noName = await http.post('/api/entities', { country: 'CA' });
    A('create with no name → 400 "Name is required"', noName.status === 400 && /name is required/i.test(noName.json && noName.json.error || ''), `status ${noName.status}: ${JSON.stringify(noName.json)}`);

    const blankCcy = await http.post('/api/entities', { name: 'Blank Ccy Co', country: 'CA', currency: '' });
    A('create with blank currency → 400 "Currency is required"', blankCcy.status === 400 && /currency is required/i.test(blankCcy.json && blankCcy.json.error || ''), `status ${blankCcy.status}: ${JSON.stringify(blankCcy.json)}`);

    const badCountry = await http.post('/api/entities', { name: 'Bad Country Co', country: 'USA' });
    A('create with malformed country → 400 "Invalid country code"', badCountry.status === 400 && /invalid country code/i.test(badCountry.json && badCountry.json.error || ''), `status ${badCountry.status}: ${JSON.stringify(badCountry.json)}`);

    // ── valid create ──
    const good = await http.post('/api/entities', { name: 'Good Co', country: 'CA' });
    A('valid create (name + country, default currency) → 201', good.status === 201, `status ${good.status}: ${JSON.stringify(good.json)}`);
    A('created entity stored the country', good.json && String(good.json.country || (good.json.data && good.json.data.country) || '').toUpperCase() === 'CA',
      JSON.stringify({ country: good.json && good.json.country, data: good.json && good.json.data }));

    // ── grandfather: a legacy entity with NO country is still editable ──
    const legacyId = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [userId, { name: 'Legacy Co', currency: 'USD', is_active: 0, sort_order: 9 }]   // note: no country
    )).rows[0].id;
    const rename = await http.put('/api/entities/' + legacyId, { name: 'Legacy Co (renamed)' });
    A('legacy entity with no country can still be updated → 200 (grandfathered)', rename.status === 200, `status ${rename.status}: ${JSON.stringify(rename.json)}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (entity required fields)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
