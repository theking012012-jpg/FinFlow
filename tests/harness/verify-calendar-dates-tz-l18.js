'use strict';
/**
 * verify-calendar-dates-tz-l18.js — Phase 1.1 / L18, the rest of the Rule-10 class after L8/L11: four more client
 * surfaces turned a calendar date into an instant and read it in the VIEWER's timezone.
 *   MRR chart (index.html)                   viewer-local month windows vs created_at / end_date instants
 *   client "Requests from your accountant"   fmtDue = new Date(d).toLocaleDateString; overdue = new Date(d) < now
 *   accountant portal Requests list           new Date(d).toLocaleDateString
 *   accountant dashboard Deadlines            local-midnight today vs new Date('YYYY-MM-DD') (UTC midnight)
 *
 * Matrix spans the sign boundary (HARNESS_TZ America/New_York, Asia/Tokyo). Clock pinned 2026-07-25T16:00Z ⇒ the
 * resolved calendar today is 2026-07-25 (UTC — the client convention).
 * Seed (hand-computed):
 *   recurring invoice 100/month, active, created_at 2026-07-01T02:00:00Z ⇒ MRR Jun 0 · Jul 100
 *       (bug west of UTC: created "Jun 30" local ⇒ Jun 100)
 *   accountant task due 2026-07-25 (today) ⇒ client shows "due 25 Jul 2026", NOT red/overdue; portal "due 25 Jul"
 *       (bug west of UTC: "24 Jul …" and red)
 *   accountant deadline 2026-07-25 ⇒ dashboard "Due today" (bug west of UTC: "1 days overdue")
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-calendar-dates-tz-l18.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (!process.env.FF_TZ_CHILD) {
  let fails = 0, passes = 0;
  for (const tz of ['America/New_York', 'Asia/Tokyo']) {
    const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'clock.js'), __filename], {
      env: Object.assign({}, process.env, { HARNESS_TZ: tz, TZ: tz, FF_TZ_CHILD: tz }), encoding: 'utf8', timeout: 380000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(out.split('\n').filter(l => /PASS|FAIL|FATAL|^\s{8,}|^=+|TZ /.test(l)).join('\n') + '\n');
    const m = out.match(/TZRESULT (\d+) (\d+)/);
    if (!m) { fails++; console.log('  FAIL  ' + tz + ' child produced no result (exit ' + r.status + ')'); continue; }
    passes += +m[1]; fails += +m[2];
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fails ? ('  ' + fails + ' FAILED — ' + passes + ' passed, ' + fails + ' failed') : ('  ALL GREEN — ' + passes + ' passed, 0 failed  (L18 calendar dates, NY + Tokyo)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fails ? 1 : 0);
}

require('./clock.js');
const clock = require('./clock.js');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { HarnessHttp } = require('./httpClient.js');
const TZ = process.env.FF_TZ_CHILD;
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  [' + TZ + '] ' + n)) : (fail++, console.log('  FAIL  [' + TZ + '] ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const settleMs = ms => new Promise(r => setTimeout(r, ms));

async function openPage(origin, httpClient, urlPath) {
  const cookiePair = [...httpClient.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const htmlRes = await httpClient.get(urlPath);
  if (htmlRes.status !== 200) throw new Error('GET ' + urlPath + ' ' + htmlRes.status);
  const jar = new CookieJar();
  for (const [k, v] of httpClient.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, origin);
  const dom = new JSDOM(htmlRes.text, { url: origin + urlPath, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.Date = (function () { const P = clock.PINNED_MS; class PD extends w.Date { constructor(...a) { if (a.length === 0) super(P); else super(...a); } static now() { return P; } } return PD; })();
  const nodeFetch = global.fetch;
  w.fetch = (input, init = {}) => { const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const abs = url.startsWith('http') ? url : origin + (url.startsWith('/') ? url : '/' + url);
    return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) })); };
  return dom;
}

(async () => {
  let ctx; const doms = [];
  try {
    console.log('\n' + '='.repeat(78) + '\n  TZ ' + TZ + ' — L18 calendar dates (MRR, tasks, deadlines)\n' + '='.repeat(78));
    let accId;
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client: c, userId }) => {
      const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
      const ent = J(await http.post('/api/entities', { name: 'L18 Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
      J(await http.post('/api/entities/' + ent.id + '/activate', {}));
      const ri = J(await http.post('/api/recurring-invoices', { client: 'SubCo', amount: 100, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' }));
      await c.query(`UPDATE recurring_invoices SET created_at = '2026-07-01T02:00:00Z' WHERE id = $1`, [ri.id]);
      accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
         VALUES ($1,$2,'Acc','L18','Firm','CODEL18','verified') RETURNING id`, ['l18-acc@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, userId]);
      await c.query(`INSERT INTO accountant_tasks (accountant_id, user_id, title, due_date, status) VALUES ($1,$2,'Send June statements','2026-07-25','open')`, [accId, userId]);
    } });
    const { window: w, settle, userId, origin } = ctx;
    await settle(60, 100);

    // client — Requests from your accountant
    await w.loadMyTasks(); await settle(5, 100);
    const tEl = w.document.getElementById('acct-tasks');
    const tHtml = tEl ? tEl.innerHTML : '';
    A('client task due 2026-07-25 shows "due 25 Jul 2026" (bug west of UTC: 24 Jul)', /due 25 Jul 2026/.test(tEl ? tEl.textContent : ''), tEl && tEl.textContent.replace(/\s+/g, ' ').slice(0, 200));
    A('client task due TODAY is not flagged overdue (red)', !/color:var\(--red\)[^>]*>due/.test(tHtml), tHtml.slice(0, 300));

    // MRR chart series
    w.showPage('mrr'); await settle(25, 100);
    const ser = w._mrrChartData || [], lab = w._mrrChartLabels || [];
    const at = m => { const i = lab.lastIndexOf(m); return i < 0 ? NaN : ser[i]; };
    A('MRR: last month label is Jul (resolved today 2026-07-25)', lab[lab.length - 1] === 'Jul', JSON.stringify(lab));
    A('MRR: Jul 100 · Jun 0 (sub created 2026-07-01 02:00Z; bug west of UTC: Jun 100)', at('Jul') === 100 && at('Jun') === 0, JSON.stringify({ lab, ser }));

    // accountant — portal Requests list + dashboard deadline
    const acc = new HarnessHttp(origin, { xff: '203.0.113.98' });
    if ((await acc.post('/api/accountants/login', { email: 'l18-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login');
    const dl = await acc.post('/api/accountants/deadlines', { client_name: 'L18 Co', filing_type: 'VAT', due_date: '2026-07-25' });
    if (dl.status >= 300) throw new Error('deadline ' + dl.status + ' ' + dl.text.slice(0, 120));
    const portal = await openPage(origin, acc, `/accountant-client?client=${userId}`); doms.push(portal);
    await settleMs(6000);
    await portal.window.loadTasks(); await settleMs(800);
    const pt = (portal.window.document.getElementById('tasks-list') || {}).textContent || '';
    A('portal request shows "due 25 Jul" (bug west of UTC: 24 Jul)', /due 25 Jul\b/.test(pt), pt.replace(/\s+/g, ' ').slice(0, 200));
    const dash = await openPage(origin, acc, '/accountant-dashboard'); doms.push(dash);
    await settleMs(6000);
    if (typeof dash.window.loadDeadlines === 'function') { await dash.window.loadDeadlines(); await settleMs(500); }
    const dt = ((dash.window.document.getElementById('all-deadlines') || {}).textContent || '') + ' ' + ((dash.window.document.getElementById('dashboard-deadlines') || {}).textContent || '');
    A('dashboard deadline 2026-07-25 reads "Due today" (bug west of UTC: "1 days overdue")', /Due today/.test(dt) && !/days overdue/.test(dt), dt.replace(/\s+/g, ' ').slice(0, 240));
    A('dashboard deadline shows "Jul 25, 2026"', /Jul 25, 2026/.test(dt), dt.replace(/\s+/g, ' ').slice(0, 240));
  } catch (e) {
    fail++; console.log('  FATAL: [' + TZ + '] ' + (e && e.stack || e));
  } finally {
    for (const d of doms) { try { d.window.close(); } catch (_) {} }
    if (ctx) await ctx.stop();
  }
  console.log('TZRESULT ' + pass + ' ' + fail);
  process.exit(0);
})();
