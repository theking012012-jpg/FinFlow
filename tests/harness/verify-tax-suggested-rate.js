"use strict";
/*
 * verify-tax-suggested-rate.js - #5 localized estimate defaults. GET /api/tax/suggested-rate returns a
 * per-country SUGGESTED starting rate + local label for the estimator. It is purely additive and clearly
 * non-authoritative: every response carries isSuggestion + a "not tax advice" note, and the owner's own
 * saved rate is exposed as savedRate (which always wins). Proves: known country -> its rate/label; case
 * insensitive; unknown -> default 25 flagged isDefault; entity-country fallback; saved rate surfaced.
 *   node -r ./tests/harness/clock.js tests/harness/verify-tax-suggested-rate.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  #5 localized estimate defaults - suggested tax rate per country\n' + '='.repeat(78) + '\n');
    const email = 'gltax@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GB Co', currency: 'GBP', country: 'GB' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.81' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const get = async q => (await http.get('/api/tax/suggested-rate' + q)).json;

    const tt = await get('?country=TT');
    A('TT -> rate 30, label Corporation Tax, suggestion not-default', tt.rate === 30 && tt.label === 'Corporation Tax' && tt.isSuggestion === true && tt.isDefault === false, JSON.stringify(tt));
    A('TT response carries a "not tax advice" note', typeof tt.note === 'string' && /not tax advice/i.test(tt.note), tt.note);
    const us = await get('?country=us');
    A('case-insensitive: us -> rate 21', us.rate === 21 && us.country === 'US', JSON.stringify(us));
    const zz = await get('?country=ZZ');
    A('unknown country -> default 25, isDefault true, label Income Tax', zz.rate === 25 && zz.isDefault === true && zz.label === 'Income Tax', JSON.stringify(zz));
    const ent = await get('?entity_id=' + eid);
    A('entity-country fallback (no ?country) -> GB Corporation Tax 25', ent.country === 'GB' && ent.rate === 25 && ent.label === 'Corporation Tax', JSON.stringify(ent));

    // Owner's saved rate is surfaced and does NOT change the suggestion.
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { tax_rate: '18' }]);
    const tt2 = await get('?country=TT');
    A('savedRate surfaced (18); suggestion rate unchanged (30)', tt2.savedRate === 18 && tt2.rate === 30, JSON.stringify(tt2));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (localized suggested rate, non-authoritative)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
