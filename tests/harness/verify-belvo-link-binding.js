'use strict';
/**
 * verify-belvo-link-binding.js — N56. A Belvo bank link can only be attached by the account that created
 * it, in the widget session it was created in.
 *
 * Defect: /api/belvo/exchange stored whatever link id the client sent. FinFlow's platform Belvo
 * credentials can read EVERY link on the Belvo account, so anyone who learned another tenant's link UUID
 * could attach it and /api/belvo/sync would import that tenant's bank transactions.
 *
 * Executed against the real server + Postgres; Belvo mocked at the fetch boundary (link detail returns
 * the link's created_at). Two FinFlow accounts: V (victim) and X (attacker). Bug value stated:
 *   V: widget → exchange its fresh link L1                     → 201 (control)
 *   X: exchange L1 with no widget session                      → 409 (bug: 201)
 *   X: widget → exchange L_OLD (created 2h before the widget)  → 409 (bug: 201)
 *   X: widget → exchange L1 (fresh, but claimed by V)          → 409 (bug: 201)
 *   X: widget → exchange its own fresh L3                      → 201 (control); same session again → 409 (single use)
 *   X: unknown link id                                         → 400 (bug: 201, stored)
 *   X's stored links = [L3] only                               (bug: L1, L_OLD, L3, …)
 *   node -r ./tests/harness/clock.js tests/harness/verify-belvo-link-binding.js
 */
process.env.BELVO_SECRET_ID = 'belvo_id';
process.env.BELVO_SECRET_PASSWORD = 'belvo_pw';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const realFetch = global.fetch;
  const now = () => new Date(Date.now()).toISOString();
  const LINKS = {
    'aaaaaaaa-0000-4000-8000-000000000001': { institution: 'victim_bank', created_at: null },   // set at "creation"
    'aaaaaaaa-0000-4000-8000-000000000002': { institution: 'old_bank', created_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
    'aaaaaaaa-0000-4000-8000-000000000003': { institution: 'attacker_bank', created_at: null },
  };
  const [L1, LOLD, L3] = Object.keys(LINKS);
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const base = server.baseUrl;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith(base)) return realFetch(url, opts);
      if (/\/api\/token\/$/.test(u)) return { ok: true, status: 200, json: async () => ({ access: 'widget-access' }) };
      const m = u.match(/\/api\/links\/([^/]+)\/$/);
      if (m) {
        const l = LINKS[decodeURIComponent(m[1])];
        return l ? { ok: true, status: 200, json: async () => ({ id: m[1], institution: l.institution, created_at: l.created_at }) }
                 : { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };
    const mk = async (email) => {
      const id = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync('pw-' + email, 10) }])).rows[0].id;
      const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [id, { name: email, currency: 'MXN', is_active: 1 }])).rows[0].id;
      const h = new HarnessHttp(base, { xff: '10.9.' + id + '.1' });
      A('login ' + email, (await h.post('/api/auth/login', { email, password: 'pw-' + email })).status === 200);
      return { id, eid, h };
    };
    const V = await mk('victim@finflow.test');
    const X = await mk('attacker@finflow.test');
    const ex = (who, link) => who.h.post('/api/belvo/exchange?entity_id=' + who.eid, { link });
    const widget = (who) => who.h.post('/api/belvo/widget-token?entity_id=' + who.eid, {});
    const stored = async (who) => {
      const r = (await c.query(`SELECT data->>'value' v FROM user_settings WHERE user_id=$1 AND data->>'key'='belvo_conn'`, [who.id])).rows[0];
      return r ? (JSON.parse(r.v).links || []).map(l => l.link) : [];
    };

    console.log('\n' + '='.repeat(78));
    console.log('  BELVO LINK BINDING — only the creating account, in its widget session');
    console.log('='.repeat(78));

    A('V: widget-token 200', (await widget(V)).status === 200);
    LINKS[L1].created_at = now();
    const v1 = await ex(V, L1);
    A('control: V attaches its fresh link → 201', v1.status === 201, `status ${v1.status}: ${v1.text.slice(0, 120)}`);

    const x0 = await ex(X, L1);
    A('X: exchange with no widget session → 409 (bug: 201)', x0.status === 409 && x0.json.code === 'BELVO_NO_SESSION', `status ${x0.status}: ${x0.text.slice(0, 120)}`);
    await widget(X);
    const x1 = await ex(X, LOLD);
    A('X: link created before the widget session → 409 (bug: 201)', x1.status === 409 && x1.json.code === 'BELVO_LINK_NOT_FRESH', `status ${x1.status}: ${x1.text.slice(0, 120)}`);
    await widget(X);
    const x2 = await ex(X, L1);
    A('X: V\'s link (fresh, claimed by V) → 409 (bug: 201)', x2.status === 409 && x2.json.code === 'BELVO_LINK_CLAIMED', `status ${x2.status}: ${x2.text.slice(0, 120)}`);
    await widget(X);
    const x3 = await ex(X, 'ffffffff-0000-4000-8000-00000000dead');
    A('X: unknown link id → 400 (bug: 201, stored)', x3.status === 400, `status ${x3.status}: ${x3.text.slice(0, 120)}`);

    await widget(X);
    LINKS[L3].created_at = now();
    const x4 = await ex(X, L3);
    A('control: X attaches its own fresh link → 201', x4.status === 201, `status ${x4.status}: ${x4.text.slice(0, 120)}`);
    const x5 = await ex(X, L3);
    A('same widget session cannot be reused → 409 (bug: 201)', x5.status === 409 && x5.json.code === 'BELVO_NO_SESSION', `status ${x5.status}`);

    const xs = await stored(X), vs = await stored(V);
    A('X\'s stored links = [L3] only (bug: also L1 / L_OLD / unknown)', xs.length === 1 && xs[0] === L3, JSON.stringify(xs));
    A('V\'s stored links = [L1]', vs.length === 1 && vs[0] === L1, JSON.stringify(vs));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (Belvo link binding)` : `  ALL GREEN — ${pass} passed, 0 failed  (Belvo link binding)`);
  console.log('-'.repeat(78));
  process.exitCode = fail === 0 ? 0 : 1;
})();
