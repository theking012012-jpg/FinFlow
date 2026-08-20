#!/usr/bin/env node
'use strict';
/**
 * verify-page-views.js — visitor analytics (page-view tracking) for the admin Traffic panel.
 * Boots the REAL server against a real throwaway Postgres and drives real HTTP so the actual
 * tracking middleware (server.js) runs in the real pipeline:
 *   - a page navigation (GET, non-/api, no extension) is recorded with time + IP + geo
 *   - unique-visitor-per-day dedupe: same visitor same day → ONE row, views increments, last_seen advances
 *   - a different visitor (different IP) → a new row
 *   - IP→location resolved offline (fast-geoip): 8.8.8.8→US, 1.1.1.1→AU
 *   - static assets (has extension) and /api/* are NOT tracked
 *   - /api/admin/traffic is admin-gated (401 anon) and returns correct aggregates
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-page-views.js
 *
 * Scratch Postgres only — enforced by guard.js.
 */

require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');

// The admin panel gate reads ADMIN_PASSWORD; boot.js does not scrub it. Set before boot.
process.env.ADMIN_PASSWORD = 'harness-admin-pw-not-a-secret';

const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The middleware records on response 'finish', fire-and-forget, so the DB write can trail the
// HTTP response. Poll (bounded iterations — clock.js pins Date.now(), so no wall-clock math).
async function waitFor(client, predicate, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const rows = (await client.query(
      `SELECT visitor_key, view_day, ip_address, country, region, city, path, referrer, views,
              extract(epoch from first_seen) AS fs, extract(epoch from last_seen) AS ls
       FROM page_views ORDER BY first_seen`)).rows;
    if (predicate(rows)) return rows;
    await sleep(30);
  }
  return (await client.query(`SELECT visitor_key, ip_address, country, path, views FROM page_views ORDER BY first_seen`)).rows;
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    console.log('\n' + '='.repeat(78));
    console.log('  VISITOR ANALYTICS — page-view tracking (unique visitor / day, geo, admin panel)');
    console.log('='.repeat(78));

    // Each HarnessHttp carries its own X-Forwarded-For → its own req.ip (trust proxy:1) → its own
    // visitor identity + geo. 8.8.8.8 resolves to US, 1.1.1.1 to AU (offline, fast-geoip).
    const visitorA = new HarnessHttp(server.baseUrl, { xff: '8.8.8.8' });
    const visitorB = new HarnessHttp(server.baseUrl, { xff: '1.1.1.1' });

    console.log('\n-- a page navigation is recorded (time + IP + geo) --');
    await visitorA.get('/');
    let rows = await waitFor(c, r => r.length === 1);
    A('one row after first page view', rows.length === 1, `rows=${rows.length}`);
    const a1 = rows[0];
    A('captured the real client IP (trust proxy)', a1 && a1.ip_address === '8.8.8.8', a1 && a1.ip_address);
    A('resolved location from IP offline (8.8.8.8 → US)', a1 && a1.country === 'US', a1 && String(a1.country));
    A('recorded the path', a1 && a1.path === '/', a1 && a1.path);
    A('view_day is set (a date, for per-day dedupe)', a1 && !!a1.view_day);
    A('views starts at 1', a1 && Number(a1.views) === 1, a1 && String(a1.views));

    console.log('\n-- same visitor, same day → ONE row, views increments (unique/day) --');
    await visitorA.get('/app');
    rows = await waitFor(c, r => r.length === 1 && Number(r[0].views) >= 2);
    A('still exactly one row for the visitor', rows.length === 1, `rows=${rows.length}`);
    A('views incremented to 2', rows[0] && Number(rows[0].views) === 2, rows[0] && String(rows[0].views));
    A('last_seen advanced past first_seen', rows[0] && Number(rows[0].ls) >= Number(rows[0].fs));
    A('first path preserved (entry page)', rows[0] && rows[0].path === '/', rows[0] && rows[0].path);

    console.log('\n-- a different visitor (different IP) → a new row --');
    await visitorB.get('/');
    rows = await waitFor(c, r => r.length === 2);
    A('now two visitor rows', rows.length === 2, `rows=${rows.length}`);
    const b = rows.find(r => r.ip_address === '1.1.1.1');
    A('second visitor recorded', !!b);
    A('resolved second location (1.1.1.1 → AU)', b && b.country === 'AU', b && String(b.country));

    console.log('\n-- static assets and /api are NOT tracked --');
    const before = (await c.query(`SELECT COALESCE(SUM(views),0) v, COUNT(*) n FROM page_views`)).rows[0];
    await visitorA.get('/finflow-dates.js');   // has extension → skipped
    await visitorA.get('/api/admin/me');        // /api → skipped (also 401)
    await sleep(300);
    const after = (await c.query(`SELECT COALESCE(SUM(views),0) v, COUNT(*) n FROM page_views`)).rows[0];
    A('asset request did not add a row or a view', after.n === before.n && after.v === before.v,
      `before n=${before.n} v=${before.v} / after n=${after.n} v=${after.v}`);

    console.log('\n-- /api/admin/traffic is admin-gated + returns correct aggregates --');
    const anon = new HarnessHttp(server.baseUrl);
    A('anonymous → 401', (await anon.get('/api/admin/traffic')).status === 401);

    const admin = new HarnessHttp(server.baseUrl);
    const login = await admin.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    A('admin login → 200', login.status === 200, JSON.stringify(login.json));
    const tr = await admin.get('/api/admin/traffic');
    A('admin traffic → 200', tr.status === 200, JSON.stringify(tr.json).slice(0, 200));
    const d = tr.json || {};
    const s = d.summary || {};
    A('uniqueToday = 2 visitors', s.uniqueToday === 2, JSON.stringify(s));
    A('viewsToday = 3 page loads (2 + 1)', s.viewsToday === 3, JSON.stringify(s));
    A('uniqueAll = 2', s.uniqueAll === 2, JSON.stringify(s));
    const cc = d.countries || [];
    A('top countries include US and AU', cc.some(x => x.country === 'US') && cc.some(x => x.country === 'AU'), JSON.stringify(cc));
    A('recent visitors list has both', (d.recent || []).length === 2, `len=${(d.recent || []).length}`);
    A('recent rows carry location + time + ip', (d.recent || []).every(r => r.last_seen && r.ip_address),
      JSON.stringify((d.recent || []).map(r => ({ ip: r.ip_address, c: r.country, t: !!r.last_seen }))));
    const pg = (d.pages || []).find(p => p.path === '/');
    A('top pages: "/" has 3 views across 2 visitors', pg && Number(pg.views) === 3 && Number(pg.visitors) === 2, JSON.stringify(d.pages));

    console.log('\n-- real client IP behind a proxy chain (Railway) --');
    // Leftmost X-Forwarded-For entry is the ORIGIN client; the rightmost is the edge hop that
    // trust-proxy:1's req.ip wrongly reported (152.233.47.66 → Brazil). raw fetch: HarnessHttp only
    // sets a single xff value, so craft the multi-hop header directly.
    await fetch(server.baseUrl + '/', { headers: { 'x-forwarded-for': '77.88.8.8, 10.0.0.1, 152.233.47.66' } });
    let iprows = await waitFor(c, r => r.some(x => x.ip_address === '77.88.8.8'));
    A('client IP = leftmost XFF entry (the visitor)', iprows.some(x => x.ip_address === '77.88.8.8'),
      JSON.stringify(iprows.map(r => r.ip_address)));
    A('did NOT record the edge-hop IP (152.233.47.66)', !iprows.some(x => x.ip_address === '152.233.47.66'));
    A('geo from the real client IP (77.88.8.8 → RU), not the BR hop',
      (iprows.find(x => x.ip_address === '77.88.8.8') || {}).country === 'RU',
      String((iprows.find(x => x.ip_address === '77.88.8.8') || {}).country));

    // Railway/Envoy sets x-envoy-external-address to the trusted external client — prefer it.
    await fetch(server.baseUrl + '/', { headers: { 'x-forwarded-for': '77.88.8.8', 'x-envoy-external-address': '8.8.4.4' } });
    iprows = await waitFor(c, r => r.some(x => x.ip_address === '8.8.4.4'));
    A('x-envoy-external-address preferred over XFF', iprows.some(x => x.ip_address === '8.8.4.4'),
      JSON.stringify(iprows.map(r => r.ip_address)));

    console.log('\n-- graceful boot: no unhandled rejections from tracking --');
    A('no boot rejections', (server.bootRejections || []).length === 0, JSON.stringify(server.bootRejections));

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (visitor analytics / page-view tracking)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[page-views] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
