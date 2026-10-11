'use strict';
/**
 * moneyFixKit.js — shared boot for the money-audit fix-pass harnesses (verify-mNN-*.js).
 * Real embedded Postgres + the real server + real routes (Rules 3/4). Each harness gets owners with
 * their own login and entities, and an assertion helper that states the value the BUG produces
 * beside the correct value, so a reader can see the seed discriminates (Rule 4).
 *
 *   const { run } = require('./moneyFixKit.js');
 *   run('M1 ...', async ({ newOwner, c, A, eq }) => { ... });
 */
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'money-fix-pw-not-a-secret';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function run(title, body) {
  (async () => {
    let pass = 0, fail = 0, scratch, server, n = 0;
    const A = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); } };
    // eq: compare a measured value with the correct one; `bug` is what the defect produces (Rule 4).
    const eq = (name, measured, expected, bug) => {
      const m = JSON.stringify(measured), e = JSON.stringify(expected);
      A(name + `  [measured ${m}, correct ${e}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, m === e);
    };
    console.log('\n' + title + '\n');
    try {
      scratch = await startScratchPostgres({ keep: false });
      const c = scratch.client;
      server = await bootServer(scratch.url);
      const newOwner = async (tag, ents = [{ name: tag + ' Co', currency: 'USD' }]) => {
        n++;
        const email = `fix-${tag.toLowerCase().replace(/[^a-z0-9]/g, '')}-${n}@finflow.test`;
        const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
          [{ email, name: tag, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
        const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.' + (10 + n) });
        if ((await http.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + tag);
        const J = async (method, p, b) => { const r = await http.request(method, p, b); if (r.status >= 300) throw new Error(method + ' ' + p + ' -> ' + r.status + ' ' + String(r.text).slice(0, 300)); return r.json; };
        const ids = [];
        for (const e of ents) ids.push((await J('POST', '/api/entities', Object.assign({ timezone: 'UTC', country: 'US' }, e))).id);
        if (ids.length) await J('POST', '/api/entities/' + ids[0] + '/activate', {});
        return { uid, email, http, J, ids };
      };
      await body({ newOwner, c, A, eq, r2, server });
    } catch (e) {
      fail++;
      console.error('\n  FATAL:', e && e.message, e && e.code, e && e.stack);
      if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message);
    } finally {
      try { if (server && server.close) await server.close(); } catch {}
      try { if (scratch) await scratch.stop(); } catch {}
    }
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  })();
}

module.exports = { run, r2 };
