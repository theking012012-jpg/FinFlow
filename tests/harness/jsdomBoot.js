'use strict';
/**
 * jsdomBoot.js — boot the real SPA in jsdom against the real seeded server, with GENERIC
 * failure injection at the fetch layer.
 *
 * WHY GENERIC INJECTION (CLAUDE.md Rule 14): a fix is not verified until its failure path is
 * EXECUTED. The first version of this harness could only fail /api/entities, so four boot-fetch
 * treatments shipped as unexecuted "pattern-mirrors" — and reasoning missed that the
 * network-failure path (a rejected promise) takes a DIFFERENT code branch than a non-ok status.
 * With this, failing any endpoint — by status OR at the network level — costs one line, so
 * "not individually failure-injected" is no longer a defensible position.
 *
 *   failMap: { "/api/banking": 500,            // → synthetic Response, that status
 *              "/api/recurring-invoices": 401, // → 401 (auth branch)
 *              "/api/x": "network" }           // → rejected promise (the catch branch)
 *
 * Matching is by exact URL PATHNAME (query ignored), so "/api/entities" fails the LIST but not
 * "/api/entities/5/activate".
 *
 * Reads settled DOM state; callers must `await settle()` before asserting. Never call client
 * compute functions to READ a value (Rule 1 / F75) — read DOM textContent. Driving action
 * handlers (openModal, save) to SIMULATE a click is legitimate and different from reading.
 */

const clock = require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'seed@finflow.test', password: 'harness-password-not-a-secret' };

function pathOf(url) {
  try { return new URL(url, 'http://127.0.0.1/').pathname; } catch { return String(url); }
}

/**
 * @param {object} opts
 * @param {Object<string, number|'network'>} opts.failMap  pathname → status code, or 'network'
 * @param {function(client, userId):Promise} [opts.seedExtra]  extra rows beyond the base seed
 */
async function bootSpaInJsdom(opts = {}) {
  const { failMap = {}, seedExtra = null } = opts;
  const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');

  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);

  const userId = (await c.query(
    `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
     VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
    [{ email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner',
       password: bcrypt.hashSync(LOGIN.password, 10) }]
  )).rows[0].id;
  await seed(c, userId);
  if (seedExtra) await seedExtra(c, userId);

  const server = await bootServer(scratch.url);
  const origin = server.baseUrl;

  const http = new HarnessHttp(origin);
  const login = await http.post('/api/auth/login', LOGIN);
  if (login.status !== 200) {
    await server.close(); await appPool.end().catch(() => {}); await scratch.stop();
    throw new Error(`login failed HTTP ${login.status}: ${login.text.slice(0, 200)}`);
  }
  const cookiePair = [...http.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const htmlRes = await http.get('/app');
  if (htmlRes.status !== 200) {
    await server.close(); await appPool.end().catch(() => {}); await scratch.stop();
    throw new Error(`GET /app failed HTTP ${htmlRes.status}`);
  }

  const jar = new CookieJar();
  for (const [k, v] of http.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, origin);

  const consoleErrors = [], consoleWarns = [], consoleLogs = [];
  const vc = new VirtualConsole();
  vc.on('error', (m) => consoleErrors.push(String(m)));
  vc.on('warn', (m) => consoleWarns.push(String(m)));
  vc.on('log', (m) => consoleLogs.push(String(m)));
  vc.on('jsdomError', (e) => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));

  const dom = new JSDOM(htmlRes.text, {
    url: origin + '/', runScripts: 'dangerously', resources: 'usable',
    pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
  });
  const { window } = dom;

  // Pin the jsdom window clock so client period windows match the server probe.
  window.Date = (function () {
    const P = clock.PINNED_MS;
    class PinnedDate extends window.Date {
      constructor(...a) { if (a.length === 0) super(P); else super(...a); }
      static now() { return P; }
    }
    return PinnedDate;
  })();

  // The fetch layer: generic injection + wire capture. resources:'usable' loads <script src>
  // through jsdom's own loader, so app bundles are unaffected — only the app's /api calls pass
  // through here.
  const nodeFetch = global.fetch;
  const wireLog = [];
  const reqLog = [];     // EVERY request (method + path), for boot-cost measurement
  const injected = [];
  const t0 = clock.RealDate.now();
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const p = pathOf(url);
    reqLog.push({ method: (init.method || 'GET').toUpperCase(), path: p, at: clock.RealDate.now() - t0 });
    if (Object.prototype.hasOwnProperty.call(failMap, p)) {
      const v = failMap[p];
      injected.push({ path: p, as: v });
      if (v === 'network') {
        return Promise.reject(new TypeError(`Failed to fetch [injected network error: ${p}]`));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: `injected ${v}` }), {
        status: v, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (init && init.body != null) {
      wireLog.push({ method: (init.method || 'GET').toUpperCase(), path: p, body: String(init.body) });
    }
    const abs = url.startsWith('http') ? url : origin + (url.startsWith('/') ? url : '/' + url);
    const headers = Object.assign({}, init.headers, { Cookie: cookiePair });
    return nodeFetch(abs, Object.assign({}, init, { headers }));
  };

  const settle = async (iters = 200, ms = 100) => {
    for (let i = 0; i < iters; i++) await new Promise((r) => setTimeout(r, ms));
  };
  const text = (id) => { const el = window.document.getElementById(id); return el ? (el.textContent || '').trim() : null; };
  const toast = () => ({
    text: text('notif-text'),
    isError: /(^|\s)error(\s|$)/.test((window.document.getElementById('notif') || {}).className || ''),
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    try { dom.window.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    try { await appPool.end(); } catch { /* ignore */ }
    await scratch.stop();
  };

  return {
    window, http, origin, scratch, client: c, userId,
    consoleErrors, consoleWarns, consoleLogs, wireLog, reqLog, injected,
    settle, text, toast, stop,
  };
}

module.exports = { bootSpaInJsdom, LOGIN, pathOf };
