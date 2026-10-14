'use strict';
/**
 * browserKit.js — LAYOUT harnesses in a real browser (Chromium via Playwright). jsdom has no layout engine, so
 * "is this button on screen at 700 px tall" can only be measured in a browser. Real embedded Postgres + the real
 * server + a real logged-in session (Rule 3); the page is the real /app.
 *
 *   const { runBrowser } = require('./browserKit.js');
 *   runBrowser('C20 …', async ({ open, A, eq }) => { const page = await open({ width: 1280, height: 700 }); … },
 *              { entities: [] });                     // [] = brand-new account (onboarding); default = one business
 *
 * Needs Playwright + Chromium. If they are missing the harness prints NOT RUN and exits 1 (RED) — it never reads as
 * passed when nothing was measured (Rule 14). Install once:  npm i --no-save playwright && npx playwright install chromium
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {}
  try {
    const root = require('child_process').execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return require(path.join(root, 'playwright'));
  } catch (_) { return null; }
}

const PW = 'browser-kit-pw-not-a-secret';

function runBrowser(title, body, opts = {}) {
  (async () => {
    let pass = 0, fail = 0, scratch, server, browser;
    const A = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')); } };
    const eq = (name, measured, expected, bug) => {
      const m = JSON.stringify(measured), e = JSON.stringify(expected);
      A(name + `  [measured ${m}, correct ${e}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, m === e);
    };
    console.log('\n' + title + '\n');
    const pw = loadPlaywright();
    if (!pw) {
      console.log('  NOT RUN — Playwright is not installed, so nothing was measured.');
      console.log('  Install once:  npm i --no-save playwright && npx playwright install chromium');
      console.log('\n  1 FAILED — 0 passed, 1 failed  (not run)\n');
      process.exit(1);
    }
    try {
      scratch = await startScratchPostgres({ keep: false });
      const c = scratch.client;
      server = await bootServer(scratch.url);
      const email = 'layout-owner@finflow.test';
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
        [{ email, name: 'Layout Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
      const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.77' });
      if ((await http.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login');
      const J = async (method, p, b) => { const r = await http.request(method, p, b); if (r.status >= 300) throw new Error(method + ' ' + p + ' -> ' + r.status + ' ' + String(r.text).slice(0, 300)); return r.json; };
      const ents = opts.entities !== undefined ? opts.entities : [{ name: 'Layout Co', currency: 'USD', country: 'US', timezone: 'UTC' }];
      for (const e of ents) { const row = await J('POST', '/api/entities', e); await J('POST', '/api/entities/' + row.id + '/activate', {}); }
      if (ents.length) await J('PUT', '/api/settings', { onboarding_done: 1, business_name: ents[0].name });
      if (opts.seed) await opts.seed({ J, http, c, uid });

      browser = await pw.chromium.launch();
      const host = new URL(server.baseUrl).hostname;
      // beforeGoto(ctx, page): optional — e.g. ctx.route(...) to add network latency before the first navigation (LA2).
      const open = async ({ width, height, beforeGoto }, pathname = '/app') => {
        const ctx = await browser.newContext({ viewport: { width, height } });
        await ctx.addCookies([...http.cookies.entries()].map(([name, value]) => ({ name, value, domain: host, path: '/' })));
        const page = await ctx.newPage();
        if (beforeGoto) await beforeGoto(ctx, page);
        await page.goto(server.baseUrl + pathname, { waitUntil: 'load' });
        await page.waitForTimeout(1500);   // the app's boot loads (entities, settings) settle
        return page;
      };
      await body({ open, A, eq, J, http, c, uid, base: server.baseUrl, server });
    } catch (e) {
      fail++;
      console.error('\n  FATAL:', e && e.message, e && e.code, e && e.stack);
      if (e && e.errors) for (const x of e.errors) console.error('  -', x && x.message);
    } finally {
      try { if (browser) await browser.close(); } catch {}
      try { if (server && server.close) await server.close(); } catch {}
      try { if (scratch) await scratch.stop(); } catch {}
    }
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  })();
}

module.exports = { runBrowser };
