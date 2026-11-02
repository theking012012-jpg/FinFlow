'use strict';
/**
 * verify-f75b-render-projects — F75-b. app-main's renderProjects was WRAPPED by the wiring copy, which called it only
 * until the boot load of /api/projects answered — in practice never (verify-f75-wrappers-live measured 0 runs), and it
 * painted a script-scoped empty `projectsData` anyway, so before the load the list was blank, and a FAILED load left it
 * blank for good. Fix: app-main's copy is deleted; the wiring copy is the one renderer — "Loading projects…" until the
 * load answers, the projects after it, and on a failed load "Couldn't load projects" with a Retry that works.
 * Executed: the real /app in Chromium against the real server + scratch Postgres (Rule 3), with /api/projects held back
 * and then failed through the browser's network layer (Rule 14: the slow and failure paths, not only the happy one).
 *   Seed: one project "Harbour Fit-out" (client Pier Co, budget 4,000).
 *   bug shapes: slow load → blank list (no "Loading"); failed load → blank list, no Retry.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f75b-render-projects.js
 */
const fs = require('fs'); const path = require('path');
const { runBrowser } = require('./browserKit.js');

runBrowser('F75-b — one projects renderer: loading, loaded, failed + Retry, create', async ({ open, A, eq, J, c, uid }) => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app-main.js'), 'utf8');
  A('[STRUCTURAL] app-main declares no renderProjects and no projectsData', !/^\s*function\s+renderProjects\s*\(/m.test(src) && !/\bconst\s+projectsData\b/.test(src));
  await J('POST', '/api/projects', { name: 'Harbour Fit-out', client: 'Pier Co', budget: 4000, status: 'In Progress' });

  // ── 1. normal: open the Projects page after boot ──
  {
    const page = await open({ width: 1280, height: 900 });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.showPage('projects')); await page.waitForTimeout(800);
    const txt = await page.evaluate(() => (document.getElementById('projects-list') || {}).textContent || '');
    A('normal: the seeded project is listed (Harbour Fit-out · Pier Co)', /Harbour Fit-out/.test(txt) && /Pier Co/.test(txt), txt.slice(0, 160));
    // ── create through the form ──
    await page.evaluate(async () => {
      window.openNewProjectModal();
      document.getElementById('proj-name').value = 'Dock Lighting';
      document.getElementById('proj-client').value = 'Pier Co';
      document.getElementById('proj-budget').value = '1500';
      await window.saveProject(); await new Promise(r => setTimeout(r, 1200));
    });
    const after = await page.evaluate(() => (document.getElementById('projects-list') || {}).textContent || '');
    A('create: the new project shows in the list', /Dock Lighting/.test(after) && /Harbour Fit-out/.test(after), after.slice(0, 200));
    eq('create: one row in the database for it', (await c.query(`SELECT count(*)::int n FROM projects WHERE user_id = $1 AND data->>'name' = 'Dock Lighting'`, [uid])).rows[0].n, 1);
    eq('normal + create: no page errors', errs, []);
    await page.close();
  }

  // ── 2. slow: /api/projects held back 4 s; the page is opened while it is pending ──
  {
    let release; const gate = new Promise(r => { release = r; });
    const page = await open({ width: 1280, height: 900, beforeGoto: async (ctx) => {
      await ctx.route(/\/api\/projects(\?.*)?$/, async (route) => { if (route.request().method() === 'GET') await gate; route.continue(); });
    } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.showPage('projects'); });
    await page.waitForTimeout(400);
    const during = await page.evaluate(() => (document.getElementById('projects-list') || {}).textContent.trim());
    eq('slow: while the load is pending the list says "Loading projects…" (bug: blank)', during, 'Loading projects…');
    release(); await page.waitForTimeout(1500);
    const done = await page.evaluate(() => (document.getElementById('projects-list') || {}).textContent || '');
    A('slow: when the load answers, the projects replace "Loading"', /Harbour Fit-out/.test(done) && !/Loading projects/.test(done), done.slice(0, 160));
    eq('slow: no page errors', errs, []);
    await page.close();
  }

  // ── 3. failed: /api/projects answers 500 until Retry is pressed ──
  {
    let failing = true;
    const page = await open({ width: 1280, height: 900, beforeGoto: async (ctx) => {
      await ctx.route(/\/api\/projects(\?.*)?$/, async (route) => {
        if (failing && route.request().method() === 'GET') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"injected"}' });
        route.continue();
      });
    } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.showPage('projects')); await page.waitForTimeout(1200);
    const failed = await page.evaluate(() => { const l = document.getElementById('projects-list'); return { txt: (l || {}).textContent || '', retry: !!(l && l.querySelector('.ff-retry')) }; });
    A('failed: the list says "Couldn\'t load projects" (bug: blank)', /Couldn't load projects/.test(failed.txt), failed.txt.slice(0, 160));
    A('failed: with a Retry button', failed.retry);
    failing = false;
    await page.click('#projects-list .ff-retry'); await page.waitForTimeout(1500);
    const retried = await page.evaluate(() => (document.getElementById('projects-list') || {}).textContent || '');
    A('failed → Retry: the projects load and the error is gone', /Harbour Fit-out/.test(retried) && !/Couldn't load/.test(retried), retried.slice(0, 160));
    eq('failed: no page errors', errs, []);
    await page.close();
  }
}, {});
