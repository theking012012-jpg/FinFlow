'use strict';
/**
 * verify-f108-unique-business — F108. One account cannot hold two businesses with the same name (case / outer spaces
 * ignored) in the same country; the same name in another country, or in another account, is fine. Checked on create and
 * on edit; a unique index is the guarantee, created at boot only when no existing businesses break it (else logged, and
 * the read-only lister names them).
 *
 * Executed: real server + scratch Postgres + real initDB() + the real lister (Rule 3).
 * Bug values (old code): a second "Acme Ltd" (US) → 201; renaming into a clash → 200; no index, so a direct INSERT of a
 * duplicate succeeds.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f108-unique-business.js
 */
require('./clock.js');
const path = require('path');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  let scratch, server;
  console.log('\nF108 — one business per name and country in an account\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const uid = await mk('f108@finflow.test'); await mk('f108-other@finflow.test');
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.108' });
    await http.post('/api/auth/login', { email: 'f108@finflow.test', password: PW });
    const ent = (body) => http.post('/api/entities', Object.assign({ currency: 'USD', timezone: 'UTC' }, body));

    const us = await ent({ name: 'Acme Ltd', country: 'US' });
    A('control: "Acme Ltd" (US) is created', us.status === 201, `${us.status}`);
    // Past the 5-second double-click window (inside it the same business is returned — never a second one).
    await c.query(`UPDATE entities SET created_at = created_at - INTERVAL '1 minute' WHERE user_id = $1`, [uid]);
    const twin = await ent({ name: '  acme LTD ', country: 'us' });
    A('a second "acme LTD" in US → 409 DUPLICATE_BUSINESS naming the existing one (bug: 201)', twin.status === 409 && twin.json.code === 'DUPLICATE_BUSINESS' && twin.json.existing_id === us.json.id, `${twin.status} ${String(twin.text).slice(0, 160)}`);
    const us2 = await ent({ name: 'Beta Co', country: 'US' });
    const ca2 = await ent({ name: 'Beta Co', country: 'CA' });
    A('"Beta Co" (CA) created within 5 s of "Beta Co" (US) is a NEW business (bug: the US one returned, 200)', ca2.status === 201 && ca2.json.id !== us2.json.id, `${ca2.status} ${ca2.json && ca2.json.id} vs ${us2.json && us2.json.id}`);
    await c.query(`UPDATE entities SET created_at = created_at - INTERVAL '1 minute' WHERE user_id = $1`, [uid]);
    const ca = await ent({ name: 'Acme Ltd', country: 'CA' });
    A('the same name in Canada is a different business → 201', ca.status === 201, `${ca.status}`);
    const dbl = await Promise.all([ent({ name: 'Zed Co', country: 'US' }), ent({ name: 'Zed Co', country: 'US' })]);
    A('a double-click still returns the one business (dedupe, not 409)', dbl.every(r => r.status < 300) && dbl[0].json.id === dbl[1].json.id, dbl.map(r => r.status + ' ' + (r.json && r.json.id)).join(' / '));

    const toUs = await http.request('PUT', '/api/entities/' + ca.json.id, { country: 'US' });
    A('moving the Canadian "Acme Ltd" to US → 409 (bug: 200)', toUs.status === 409 && toUs.json.code === 'DUPLICATE_BUSINESS', `${toUs.status}`);
    const rename = await http.request('PUT', '/api/entities/' + dbl[0].json.id, { name: 'ACME LTD' });
    A('renaming "Zed Co" (US) to "ACME LTD" → 409 (bug: 200)', rename.status === 409, `${rename.status}`);
    const self = await http.request('PUT', '/api/entities/' + us.json.id, { name: 'Acme Ltd', color: '#112233' });
    A('editing a business with its own name is fine → 200', self.status === 200, `${self.status} ${String(self.text).slice(0, 120)}`);
    const names = (await c.query(`SELECT id, data->>'name' AS n, data->>'country' AS k FROM entities WHERE user_id = $1 ORDER BY id`, [uid])).rows;
    A('the refused edits changed nothing', names.find(r => r.id === ca.json.id).k === 'CA' && names.find(r => r.id === dbl[0].json.id).n === 'Zed Co', JSON.stringify(names));

    const h2 = new HarnessHttp(server.baseUrl, { xff: '203.0.113.109' });
    await h2.post('/api/auth/login', { email: 'f108-other@finflow.test', password: PW });
    const other = await h2.post('/api/entities', { name: 'Acme Ltd', country: 'US', currency: 'USD', timezone: 'UTC' });
    A('another account may have its own "Acme Ltd" (US) → 201', other.status === 201, `${other.status}`);

    // The guarantee: the index refuses a duplicate written past the app.
    let code = null;
    try { await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, '{"name":"acme ltd","country":"US"}')`, [uid]); } catch (e) { code = e.code + ' ' + e.constraint; }
    A('the database itself refuses a duplicate (unique index, 23505) (bug: inserted)', code === '23505 ux_entities_user_name_country', String(code));
    await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, '{"name":"No Country"}'), ($1, NULL, '{"name":"No Country"}')`, [uid]);
    A('legacy businesses with no country are outside the key (2 stored)', (await c.query(`SELECT count(*)::int n FROM entities WHERE data->>'name' = 'No Country'`)).rows[0].n === 2);

    // Existing duplicates: boot does not create the index, logs it, changes nothing; the lister names them.
    await c.query(`DROP INDEX ux_entities_user_name_country`);
    await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, '{"name":"ACME ltd","country":"US"}')`, [uid]);
    const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try { await require('../../database.js').initDB(); } finally { console.warn = ow; }
    const idx = async () => (await c.query(`SELECT count(*)::int n FROM pg_indexes WHERE indexname = 'ux_entities_user_name_country'`)).rows[0].n;
    A('with an existing duplicate, boot skips the index and logs why + the lister (never fails)', (await idx()) === 0 && warns.some(w => /F108/.test(w) && /list-duplicate-businesses/.test(w)), warns.join(' | ').slice(0, 300));
    const lst = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'launch', 'list-duplicate-businesses.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { DATABASE_URL: scratch.url }) });
    A('the read-only lister names the account, US, and the two ids; no e-mail printed', lst.status === 0 && new RegExp(`account #${uid}\\s+US\\s+2 businesses`).test(lst.stdout) && !/@/.test(lst.stdout) && /NOT in place yet/.test(lst.stdout), lst.stdout + lst.stderr);
    await c.query(`UPDATE entities SET data = data || '{"name":"Acme Holdings"}' WHERE data->>'name' = 'ACME ltd'`);
    await require('../../database.js').initDB();
    A('once renamed, the next boot creates the index', (await idx()) === 1);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (server) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F108 one business per name and country)\n`);
  process.exit(fail ? 1 : 0);
})();
