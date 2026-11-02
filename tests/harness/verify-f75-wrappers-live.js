'use strict';
/**
 * verify-f75-wrappers-live — are the 7 app-main functions that a wiring file WRAPS (rather than replaces) actually live?
 * "Live" = calling window.NAME through the whole runtime chain reaches the app-main body, and the function does its job.
 *
 * How: the real /app in Chromium against the real server + scratch Postgres (Rule 3). The browser is served app-main.js
 * with ONE line added at the top of each of the 7 bodies — `__f75hit('NAME')` — so a hit means the app-main code itself
 * ran (parsed with acorn, inserted at the body's first brace; nothing else changes). Each function is then called the way
 * the app calls it, twice (a wrapper can call the original only the first time), and its visible effect is checked.
 * MEASUREMENT harness: it reports what it measures for every call; it asserts only that each function does its job.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f75-wrappers-live.js
 */
const fs = require('fs'); const path = require('path');
const acorn = require('acorn');
const { runBrowser } = require('./browserKit.js');
const NAMES = ['closeModal', 'renderDocuments', 'renderProjects', 'renderReports', 'saveOwnerPayroll', 'updateDashboard', 'showPage'];

function instrumented() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app-main.js'), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
  const at = [];
  for (const n of ast.body) if (n.type === 'FunctionDeclaration' && NAMES.includes(n.id.name)) at.push([n.body.start + 1, n.id.name]);
  if (at.length !== NAMES.length) throw new Error('found ' + at.map(a => a[1]) + ' — expected all 7 declared in app-main');
  let out = src;
  for (const [pos, name] of at.sort((a, b) => b[0] - a[0])) out = out.slice(0, pos) + `try{(window.__f75hits=window.__f75hits||[]).push(${JSON.stringify(name)});}catch(_){}` + out.slice(pos);
  return out;
}

runBrowser('F75 — the 7 wrapped app-main functions: does the app-main code run?', async ({ open, A, eq, J, c, uid }) => {
  const body = instrumented();
  await J('POST', '/api/invoices', { client: 'Wrapper Co', amount: 2468, status: 'pending', issue_date: '2026-07-08', due_date: '2026-08-08', idempotency_key: 'f75w-i' });
  await J('POST', '/api/projects', { name: 'Wrapper Project', client: 'Wrapper Co', budget: 1000, status: 'active' }).catch(() => {});

  const page = await open({ width: 1280, height: 900, beforeGoto: async (ctx) => {
    await ctx.route(/\/app-main\.js(\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body }));
  } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.waitForTimeout(3000);

  const hitsOf = (name) => page.evaluate((n) => (window.__f75hits || []).filter(x => x === n).length, name);
  const reset = () => page.evaluate(() => { window.__f75hits = []; });
  const wait = (ms) => page.waitForTimeout(ms);
  const report = {};
  report['during boot (all 7)'] = await page.evaluate(() => { const h = window.__f75hits || []; const o = {}; h.forEach(x => o[x] = (o[x] || 0) + 1); return o; });

  // showPage — switches the visible page
  for (const k of [1, 2]) {
    await reset();
    await page.evaluate(() => window.showPage(document.getElementById('page-invoices') ? 'invoices' : 'dashboard')); await wait(700);
    report['showPage#' + k] = await hitsOf('showPage');
  }
  A('showPage: the invoices page is the one showing', await page.evaluate(() => { const el = document.getElementById('page-invoices'); return !!el && el.offsetParent !== null; }));

  // closeModal — closes an open modal
  for (const k of [1, 2]) {
    await reset();
    const closed = await page.evaluate(async () => {
      if (typeof openModal === 'function') openModal('expense-modal');
      await new Promise(r => setTimeout(r, 200));
      window.closeModal('expense-modal'); await new Promise(r => setTimeout(r, 200));
      const m = document.getElementById('expense-modal');
      return !!m && !m.classList.contains('open') && getComputedStyle(m).display === 'none' || (!!m && !m.classList.contains('open'));
    });
    report['closeModal#' + k] = await hitsOf('closeModal');
    A('closeModal #' + k + ': the expense modal is closed', closed);
  }

  // updateDashboard — paints the revenue card
  for (const k of [1, 2]) {
    await reset();
    await page.evaluate(() => window.showPage('dashboard')); await wait(500);
    await page.evaluate(() => window.updateDashboard()); await wait(500);
    report['updateDashboard#' + k] = await hitsOf('updateDashboard');
  }
  const rev = await page.evaluate(() => (document.getElementById('d-rev') || {}).textContent || '');
  A('updateDashboard: the revenue card shows the seeded invoice (2,468 / 2.5K)', /2,?468|2\.5K/.test(rev), 'd-rev = ' + rev);

  // renderReports / renderDocuments / renderProjects — their pages render
  for (const [name, pg] of [['renderReports', 'reports'], ['renderDocuments', 'documents'], ['renderProjects', 'projects']]) {
    for (const k of [1, 2]) {
      await reset();
      await page.evaluate((p) => window.showPage(p), pg); await wait(900);
      report[name + ' while opening the page #' + k] = await hitsOf(name);
      await reset();
      await page.evaluate(async (n) => { await window[n](); }, name); await wait(900);
      report[name + '#' + k] = await hitsOf(name);
    }
    const txt = await page.evaluate((p) => ((document.getElementById('page-' + p) || {}).textContent || '').replace(/\s+/g, ' ').trim(), pg);
    A(name + ': the ' + pg + ' page has content', txt.length > 40, txt.slice(0, 120));
  }
  const projTxt = await page.evaluate(() => (document.getElementById('page-projects') || {}).textContent || '');
  report['projects page shows the seeded project'] = /Wrapper Project/.test(projTxt);

  // saveOwnerPayroll — saves the owner's salary to the database
  for (const k of [1, 2]) {
    await reset();
    await page.evaluate(async (k) => {
      window.showPage('payroll'); await new Promise(r => setTimeout(r, 600));
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('own-fname', 'Owen'); set('own-lname', 'Wrapper'); set('own-gross', String(3000 + k));
      await window.saveOwnerPayroll(); await new Promise(r => setTimeout(r, 1200));
    }, k);
    report['saveOwnerPayroll#' + k] = await hitsOf('saveOwnerPayroll');
  }
  const own = (await c.query(`SELECT data->>'gross' AS g FROM payroll WHERE user_id = $1 AND data->>'fname' = 'Owen' ORDER BY id`, [uid])).rows.map(r => Number(r.g));
  report['owner payroll rows in the database'] = own;
  A('saveOwnerPayroll: the owner salary is in the database with the last value saved (3002)', own.length >= 1 && own[own.length - 1] === 3002, JSON.stringify(own));

  console.log('\n  MEASURED — times the app-main body ran per call (0 = only the wiring code ran):');
  for (const [k, v] of Object.entries(report)) console.log('    ' + k.padEnd(40) + JSON.stringify(v));
  eq('no page errors', errs, []);
}, {});
