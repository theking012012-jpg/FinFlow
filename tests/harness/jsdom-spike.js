'use strict';
/**
 * jsdom-spike.js — SPIKE ONLY. Can the SPA boot in jsdom against the real server, and can we
 * read ONE KPI from the DOM? Nothing more. Do not build the full client probe on top of this
 * until it reads a value.
 *
 * DESIGN RULE (Rule 1 / F75): read DOM textContent, NEVER call client functions. Calling
 * computeExpenseBreakdown() etc. risks reading the dead app-main copy; the DOM shows whatever
 * actually won the load order, which is the whole point of a client probe.
 */

const clock = require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'seed@finflow.test', password: 'harness-password-not-a-secret' };
const KPI_ID = 'd-rev';        // Revenue KPI — starts as "—", populated after auth + data load

async function main() {
  let JSDOM, VirtualConsole, CookieJar;
  try {
    ({ JSDOM, VirtualConsole, CookieJar } = require('jsdom'));
  } catch (e) {
    console.error('[spike] jsdom not available:', e.message);
    process.exitCode = 0; return;
  }

  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;
  let dom = null;

  const consoleErrors = [];
  try {
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    await seed(c, userId);

    server = await bootServer(scratch.url);
    const origin = server.baseUrl;

    // Log in over real HTTP, capture the session cookie.
    const http = new HarnessHttp(origin);
    const login = await http.post('/api/auth/login', LOGIN);
    if (login.status !== 200) throw new Error(`login failed HTTP ${login.status}: ${login.text.slice(0, 200)}`);
    const cookiePair = [...http.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    console.log(`[spike] logged in, cookie: ${cookiePair.slice(0, 40)}…`);

    // Fetch the SPA shell. NOTE: `/` serves the marketing landing page (landing.html); the
    // actual app (index.html, with the dashboard KPIs) is served at `/app` (server.js:248).
    const htmlRes = await http.get('/app');
    if (htmlRes.status !== 200) throw new Error(`GET /app failed HTTP ${htmlRes.status}`);
    console.log(`[spike] fetched /app (${htmlRes.text.length} bytes)`);

    // Cookie jar seeded with the session cookie so <script src> loads and resource loads carry it.
    const jar = new CookieJar();
    for (const [k, v] of http.cookies.entries()) {
      jar.setCookieSync(`${k}=${v}; Path=/`, origin);
    }

    const virtualConsole = new VirtualConsole();
    virtualConsole.on('error', (m) => consoleErrors.push('error: ' + m));
    virtualConsole.on('jsdomError', (e) => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));

    dom = new JSDOM(htmlRes.text, {
      url: origin + '/',
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      cookieJar: jar,
      virtualConsole,
    });
    const { window } = dom;

    // Pin the jsdom window clock too, so client-side period windows match the server probe.
    window.Date = clock.RealDate === Date ? window.Date : (function () {
      const P = clock.PINNED_MS;
      class PinnedDate extends window.Date {
        constructor(...a) { if (a.length === 0) super(P); else super(...a); }
        static now() { return P; }
      }
      return PinnedDate;
    })();

    // jsdom has no fetch; the app uses it for every /api call. Route relative URLs to the
    // server with the session cookie, using Node's fetch.
    const nodeFetch = global.fetch;
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const abs = url.startsWith('http') ? url : origin + (url.startsWith('/') ? url : '/' + url);
      const headers = Object.assign({}, init.headers, { Cookie: cookiePair });
      return nodeFetch(abs, Object.assign({}, init, { headers }));
    };

    // Poll the KPI element until it moves off the placeholder, or time out.
    const el = () => window.document.getElementById(KPI_ID);
    const readable = () => { const e = el(); return e ? (e.textContent || '').trim() : null; };
    console.log(`[spike] #${KPI_ID} exists at parse: ${!!el()}, initial text: ${JSON.stringify(readable())}`);

    // Poll on an ITERATION COUNT, not Date.now(): clock.js froze the Node clock, so Date.now()
    // never advances and a wall-clock deadline would loop forever. (setTimeout still uses real
    // time.) Record the full TRAJECTORY of distinct values so a transient "$0" before real data
    // arrives is distinguishable from a settled figure — grabbing the first change would lie.
    const trajectory = [];
    let firstNonPlaceholderIter = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const t = readable();
      if (trajectory.length === 0 || trajectory[trajectory.length - 1] !== t) trajectory.push(t);
      if (firstNonPlaceholderIter == null && t && t !== '—' && t !== '') firstNonPlaceholderIter = i;
    }
    const settled = readable();

    console.log('');
    console.log('═'.repeat(70));
    console.log(`  SPIKE RESULT: #${KPI_ID}`);
    console.log(`    trajectory : ${trajectory.map((v) => JSON.stringify(v)).join(' → ')}`);
    console.log(`    settled    : ${JSON.stringify(settled)}`);
    if (settled && settled !== '—' && settled !== '') {
      console.log('    → the SPA booted in jsdom and the KPI populated from the DOM.');
    } else {
      console.log('    → the KPI never left its placeholder.');
    }
    console.log('═'.repeat(70));

    if (consoleErrors.length) {
      console.log(`\n  ${consoleErrors.length} window error(s) captured (first 12):`);
      for (const e of consoleErrors.slice(0, 12)) console.log('   · ' + String(e).slice(0, 200));
    } else {
      console.log('\n  No window errors captured.');
    }
  } catch (err) {
    console.error('\n[spike] FAILED\n');
    console.error(err && err.stack ? err.stack : err);
    if (consoleErrors.length) {
      console.error(`\n  ${consoleErrors.length} window error(s) before failure:`);
      for (const e of consoleErrors.slice(0, 12)) console.error('   · ' + String(e).slice(0, 200));
    }
  } finally {
    try { if (dom) dom.window.close(); } catch { /* ignore */ }
    if (server) await server.close();
    try { await appPool.end(); } catch { /* ignore */ }
    await scratch.stop();
  }
  process.exitCode = 0;
}

main().catch((e) => { console.error(e); process.exitCode = 0; });
