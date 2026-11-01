#!/usr/bin/env node
'use strict';
/**
 * verify-visitor-ip-retention — website visitor IP addresses (page_views) are removed after 30 days; every Traffic figure
 * stays the same. Also proves both retention steps run from the REAL daily job (_jobs.billing), not only when called
 * directly (Rule 14: the call site is reached). Real server + Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-visitor-ip-retention.js
 *
 * Seed: visitor A seen 40 days ago, visitor B seen 10 days ago, both with an IP. Bug value (no retention): A keeps its IP.
 * Plus a deleted account 100 days ago with IP/device on its audit rows (LC3d-b) — cleared by the same job run.
 */
process.env.ADMIN_PASSWORD = 'harness-shared-admin-pw';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
(async () => {
  const s = await startScratchPostgres({ keep: false }); const c = s.client; let server;
  try {
    server = await bootServer(s.url);
    const app = require('../../server.js');
    const day = n => new Date(Date.now() - n * 86400000);
    const pv = (k, n) => c.query(`INSERT INTO page_views (visitor_key, view_day, ip_address, country, city, path, user_agent, views, first_seen, last_seen)
      VALUES ($1, $2::date, '198.51.100.9', 'TT', 'Port of Spain', '/', 'Mozilla/5.0', 3, $2, $2)`, [k, day(n)]);
    await pv('visitor-A', 40); await pv('visitor-B', 10);
    const uid = (await c.query(`INSERT INTO users (data, created_at, updated_at) VALUES ('{"email":"gone@x.test"}', NOW(), NOW()) RETURNING id`)).rows[0].id;
    await c.query(`INSERT INTO audit_trail (user_id, table_name, record_id, action, actor_type, actor_id, ip_address, user_agent, changed_at) VALUES ($1,'users',$1,'ACCOUNT_DELETED','user',$1,'203.0.113.7','Chrome',$2)`, [uid, day(100)]);
    await c.query(`DELETE FROM users WHERE id = $1`, [uid]);
    const adm = new HarnessHttp(server.baseUrl, { xff: '192.0.2.50' });
    await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    const before = ((await adm.get('/api/admin/traffic')).json || {}).summary;

    await app._jobs.billing();   // the real daily job

    const ips = Object.fromEntries((await c.query(`SELECT visitor_key, ip_address FROM page_views`)).rows.map(r => [r.visitor_key, r.ip_address]));
    A('visitor seen 40 days ago: IP removed (bug: kept)', ips['visitor-A'] === null, JSON.stringify(ips));
    A('visitor seen 10 days ago: IP kept', ips['visitor-B'] === '198.51.100.9', JSON.stringify(ips));
    const kept = (await c.query(`SELECT country, city, views FROM page_views WHERE visitor_key = 'visitor-A'`)).rows[0];
    A('the row itself stays (country, city, views)', kept && kept.country === 'TT' && kept.city === 'Port of Spain' && kept.views === 3, JSON.stringify(kept));
    const after = ((await adm.get('/api/admin/traffic')).json || {}).summary;
    A('every Traffic figure is unchanged', JSON.stringify(before) === JSON.stringify(after) && before && before.uniqueAll === 2, JSON.stringify({ before, after }));
    const au = (await c.query(`SELECT count(*) FILTER (WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL)::int n FROM audit_trail WHERE user_id = $1`, [uid])).rows[0].n;
    A('the same daily job ran LC3d-b: the deleted account\'s IP/device is gone', au === 0, 'rows with ip/ua: ' + au);
  } finally { if (server && server.close) await server.close(); await s.stop(); }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (visitor IP retention)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR', e && e.stack); process.exit(1); });
