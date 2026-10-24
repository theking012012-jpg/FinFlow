'use strict';
/**
 * verify-team-seats.js — A0 / D-C (owner decision 2026-10-23). The pricing said "Up to 3 team members" (Pro) and
 * "Up to 15" (Business); nothing enforced either. The decision, better than QuickBooks / Xero:
 *   • a seat = someone who can EDIT the books (role admin), active OR pending invite; the owner does not count
 *     ("3 team members plus you")
 *   • viewers (read-only) and accountants are free and unlimited, on every plan
 *   • trial 15 · Pro 3 · Business 15 · Scale unlimited — the numbers come from plans.js
 *   • every door that can give someone edit access checks it: the invite, the role change, the bare insert
 *   • the Team page shows "N of M edit seats used" and says why the Admin option is unavailable when full
 * Real Postgres + real server. Owner account on Pro.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const Plans = require(path.join(__dirname, '..', '..', 'plans.js'));

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  D-C — edit seats are enforced; viewers and accountants are free\n' + '='.repeat(78) + '\n');
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  await initSchema(scratch.url);
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const ownerId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'seats-owner@finflow.test', name: 'Seat Owner', plan: 'pro', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.81' });
    if ((await http.post('/api/auth/login', { email: 'seats-owner@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const ent = (await http.post('/api/entities', { name: 'Seat Co', currency: 'USD', timezone: 'UTC', country: 'US' })).json || {};
    await http.post('/api/entities/' + ent.id + '/activate', {});
    const inv = (n, role) => http.post('/api/team/invite', { name: 'P' + n, email: 'p' + n + '@finflow.test', role, entity_ids: [ent.id] });

    const PRO = Plans.limit('pro', 'seats');
    A('0  premise: Pro has ' + PRO + ' edit seats in plans.js', PRO === 3, String(PRO));
    const s0 = (await http.get('/api/team/seats')).json || {};
    A('1  /api/team/seats: 0 of 3 used on Pro (bug: no such figure)', s0.used === 0 && s0.limit === 3, JSON.stringify(s0));

    const r1 = [await inv(1, 'admin'), await inv(2, 'admin'), await inv(3, 'admin')].map(r => r.status);
    A('2  three admins can be invited (pending invites take a seat) — owner not counted', r1.every(s => s === 201 || s === 200), JSON.stringify(r1));
    const r4 = await inv(4, 'admin');
    A('3  a fourth admin is refused: 402 SEAT_LIMIT, naming the plan and the number (bug: 201 — no limit)', r4.status === 402 && (r4.json || {}).code === 'SEAT_LIMIT' && /3/.test((r4.json || {}).error || ''), r4.status + ' ' + String(r4.text).slice(0, 160));
    const free = [];
    for (let i = 10; i < 16; i++) free.push((await inv(i, 'viewer')).status);
    free.push((await inv(20, 'accountant')).status, (await inv(21, 'accountant')).status);
    A('4  viewers and accountants are free — six viewers and two accountants still go through', free.every(s => s === 201 || s === 200), JSON.stringify(free));
    const s1 = (await http.get('/api/team/seats')).json || {};
    A('4b seats still 3 of 3 (viewers / accountants not counted)', s1.used === 3 && s1.limit === 3, JSON.stringify(s1));

    const viewerRow = (await c.query(`SELECT id FROM team_members WHERE user_id = $1 AND data->>'role' = 'viewer' ORDER BY id LIMIT 1`, [ownerId])).rows[0];
    const up = await http.put('/api/team/' + viewerRow.id, { role: 'admin' });
    A('5  promoting a viewer to admin when full is refused (the second door; bug: 200)', up.status === 402 && (up.json || {}).code === 'SEAT_LIMIT', up.status + ' ' + String(up.text).slice(0, 120));
    const bare = await http.post('/api/team', { name: 'Bare', email: 'bare@finflow.test', role: 'admin' });
    A('6  the bare insert route refuses an admin when full (the third door; bug: 201)', bare.status === 402 && (bare.json || {}).code === 'SEAT_LIMIT', bare.status + ' ' + String(bare.text).slice(0, 120));

    const adminRow = (await c.query(`SELECT id FROM team_members WHERE user_id = $1 AND data->>'role' = 'admin' ORDER BY id LIMIT 1`, [ownerId])).rows[0];
    await http.request('DELETE', '/api/team/' + adminRow.id);
    const after = await http.put('/api/team/' + viewerRow.id, { role: 'admin' });
    A('7  removing an admin frees the seat — the viewer can now be promoted', after.status === 200, 'status ' + after.status);
    const same = await http.put('/api/team/' + viewerRow.id, { role: 'admin' });
    A('7b re-saving an admin as admin is not a new seat (no false refusal when full)', same.status === 200, 'status ' + same.status);

    await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [ownerId]);
    const sb = (await http.get('/api/team/seats')).json || {};
    A('8  Business: 15 seats', sb.limit === 15 && sb.used === 3, JSON.stringify(sb));
    await c.query(`UPDATE users SET data = data || '{"plan":"scale"}'::jsonb WHERE id = $1`, [ownerId]);
    const ss = (await http.get('/api/team/seats')).json || {};
    const sc = await inv(30, 'admin');
    A('9  Scale: unlimited (limit null) and an admin invite goes through', ss.limit === null && (sc.status === 201 || sc.status === 200), JSON.stringify(ss) + ' ' + sc.status);
    await c.query(`UPDATE users SET data = data || '{"plan":"trial"}'::jsonb WHERE id = $1`, [ownerId]);
    const st = (await http.get('/api/team/seats')).json || {};
    A('10 trial: 15 seats', st.limit === 15, JSON.stringify(st));

    // the Team page: back on Pro and full
    await c.query(`UPDATE users SET data = data || '{"plan":"pro"}'::jsonb WHERE id = $1`, [ownerId]);
    await c.query(`DELETE FROM team_members WHERE user_id = $1 AND data->>'email' = 'p30@finflow.test'`, [ownerId]);
    const cookiePair = [...http.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const page = await http.get('/app');
    const jar = new CookieJar();
    for (const [k, v] of http.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, server.baseUrl);
    const dom = new JSDOM(page.text, { url: server.baseUrl + '/app', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const w = dom.window, nodeFetch = global.fetch;
    w.fetch = (input, init = {}) => { const u = typeof input === 'string' ? input : String(input && input.url || input);
      const abs = u.startsWith('http') ? u : server.baseUrl + (u.startsWith('/') ? u : '/' + u);
      return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) })); };
    for (let i = 0; i < 80 && typeof w.renderTeam !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 1500));
    try { w.showPage('team'); } catch (_) {}
    try { await w.renderTeam(); } catch (_) {}
    for (let i = 0; i < 40 && !w.document.getElementById('team-seats'); i++) await new Promise(r => setTimeout(r, 100));
    const seatsTxt = ((w.document.getElementById('team-seats') || {}).textContent || '').replace(/\s+/g, ' ');
    A('11 the Team page shows "3 of 3 edit seats used" and that viewers + accountants are free', /3 of 3 edit seats used/.test(seatsTxt) && /free/i.test(seatsTxt), seatsTxt || 'no #team-seats');
    try { w.openInviteModal && w.openInviteModal(); } catch (_) {}
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 100));
    const adminOpt = w.document.querySelector('#inv-role option[value="admin"]');
    A('11b with seats full, the invite form\'s Admin option is unavailable and says why', !!adminOpt && adminOpt.disabled && /seat/i.test(adminOpt.textContent), adminOpt ? adminOpt.outerHTML : 'no option');
    try { w.close(); } catch (_) {}
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-C team seats)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
