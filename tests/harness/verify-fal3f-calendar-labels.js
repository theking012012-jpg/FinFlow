'use strict';
/**
 * verify-fal3f-calendar-labels.js — FA-L3f (Rule 10). A calendar date ('2026-10-01', a DATE column or a month bucket)
 * was shown with new Date(value).toLocale…(): the string parses as UTC midnight, so every viewer WEST of UTC saw the
 * day / month BEFORE. The class on the accountant dashboard + admin pages:
 *   1 accountant earnings Date column          ('2026-10-01' → "Oct 2026"; bug west: "Sep 2026")
 *   2 accountant "This Month" card              (October's $10 counted in October; bug west: $0.00)
 *   3 admin earnings Period column              ("Oct 2026"; bug west: "Sep 2026")
 *   4 admin new-signups chart month labels      (month bucket → "Oct 26"; bug west: "Sep 26")
 *   5 admin traffic chart day labels            (view_day DATE '2026-10-05' → "Oct 5"; bug west: "Oct 4")
 *   6 admin log date filter                     (from parsed as UTC, to as local: an entry at 02:00 UTC on 5 Oct —
 *                                                22:00 on 4 Oct in New York — was kept by a 5-Oct filter in NY)
 * Each zone runs in its own process (TZ is read at start): New York (UTC−4), UTC, Tokyo (UTC+9) — the matrix spans
 * the sign boundary (Rule 10 corollary: two western zones misfile identically). The pages run in jsdom with the real
 * finflow-dates.js / tier-config.js; the API is canned in the routes' shapes (DATE → 'YYYY-MM-DD', database.js:22).
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal3f-calendar-labels.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

if (process.argv[2] === '--child') { child().catch(e => { console.log(JSON.stringify({ fatal: String(e && e.stack || e) })); process.exit(0); }); }
else parent();

function parent() {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  console.log('\n' + '='.repeat(78) + '\n  FA-L3f — a calendar date reads the same in every timezone\n' + '='.repeat(78) + '\n');
  for (const tz of ['America/New_York', 'UTC', 'Asia/Tokyo']) {
    let r;
    try {
      const out = execFileSync(process.execPath, ['-r', path.join(__dirname, 'clock.js'), __filename, '--child'], { env: Object.assign({}, process.env, { TZ: tz, HARNESS_TZ: tz }), encoding: 'utf8', timeout: 120000 });
      r = JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).pop());
    } catch (e) { r = { fatal: e.message }; }
    if (r.fatal) { A(tz + ': child ran', false, r.fatal.slice(0, 300)); continue; }
    A(tz + ' (offset ' + r.offset + ' min): 1 accountant earnings row reads "Oct 2026"', r.accDate === 'Oct 2026', r.accDate);
    A(tz + ': 2 "This Month" counts October\'s $10.00', r.mtd === '$10.00', r.mtd);
    A(tz + ': 3 admin Period reads "Oct 2026"', r.adminPeriod === 'Oct 2026', r.adminPeriod);
    A(tz + ': 4 signups chart labels "Sep 26, Oct 26"', r.signupLabels === 'Sep 26,Oct 26', r.signupLabels);
    A(tz + ': 5 traffic chart labels "Oct 4, Oct 5"', r.trafficLabels === 'Oct 4,Oct 5', r.trafficLabels);
    // hand-computed: 02:00Z on 5 Oct = 4 Oct 22:00 in NY / 5 Oct in UTC / 5 Oct 11:00 in Tokyo;
    //               16:00Z on 5 Oct = 5 Oct 12:00 in NY / 5 Oct in UTC / 6 Oct 01:00 in Tokyo
    const want = { 'America/New_York': 'at-1600z', UTC: 'at-0200z,at-1600z', 'Asia/Tokyo': 'at-0200z' }[tz];
    A(tz + ': 6 a 5-Oct log filter keeps the entries that are 5 Oct on this admin\'s clock (' + want + ')', r.logKept === want, r.logKept);
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-L3f calendar labels)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}

async function child() {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const settle = async (n) => { for (let i = 0; i < (n || 30); i++) await new Promise(r => setTimeout(r, 40)); };
  const read = f => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const inlineScripts = h => h
    .replace('<script src="/tier-config.js"></script>', () => '<script>' + fs.readFileSync(path.join(ROOT, 'tier-config.js'), 'utf8') + '</script>')
    .replace('<script src="/finflow-dates.js"></script>', () => '<script>' + read('finflow-dates.js') + '</script>');
  const page = (file, api) => {
    const stub = `<script>window.fetch=function(u){var p=String(u).split('?')[0];var data=(${JSON.stringify(api)})[p];return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(data==null?{}:data);}});};window.open=function(){};
      window.__charts=[];window.Chart=function(ctx,cfg){window.__charts.push(cfg);this.destroy=function(){};};HTMLCanvasElement.prototype.getContext=function(){return {};};</script>`;
    const html = inlineScripts(read(file)).replace(/<head>/i, () => '<head>' + stub);
    return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://finflow.test/' + file }).window;
  };
  const out = { offset: -new Date('2026-10-05T12:00:00Z').getTimezoneOffset() };

  // accountant dashboard
  const acc = page('accountant-dashboard.html', {
    '/api/accountants/me': { first_name: 'Ada', last_name: 'L', status: 'verified', referral_code: 'X', email: 'a@x.test', conduct: { accepted: true, version: '1.0', current: '1.0', blocked: false } },
    '/api/accountants/clients': [], '/api/accountants/pending-requests': [], '/api/accountants/deadlines': [], '/api/accountants/stripe-status': { connected: true, transfersEnabled: true },
    '/api/accountants/earnings': { earnings: [{ id: 1, type: 'referral', amount_cents: 1000, description: 'Referral', status: 'pending', period_month: '2026-10-01' }], totalFormatted: '$10.00', currentPeriod: '2026-10-01' },
  });
  await settle();
  try { await acc.loadEarnings(); } catch (_) {}
  const row = acc.document.querySelector('#earnings-tbody tr td');
  out.accDate = row ? row.textContent.trim() : null;
  out.mtd = (acc.document.getElementById('earn-mtd') || {}).textContent || null;
  acc.close();

  // admin
  const adm = page('admin.html', {
    '/api/admin/earnings': { records: [{ id: 1, type: 'referral', amount_cents: 1000, description: 'x', status: 'pending', period_month: '2026-10-01', payout_id: null, first_name: 'A', last_name: 'B', firm: '' }], summary: {}, payouts: [] },
    '/api/admin/overview': { users: { total: 2, today: 0, week: 0, month: 1, plans: [], monthly: [{ month: '2026-09-01', count: '1' }, { month: '2026-10-01', count: '1' }] },
      accountants: { total: 0, pending: 0, verified: 0 }, reports: { recent: 0 }, earnings: { totalFormatted: '$0.00', pendingFormatted: '$0.00' }, ai: { totalQueries: 0, monthQueries: 0, estimatedMonthlyCost: '0' }, revenue: { mrr: 0 } },
    '/api/admin/traffic': { summary: {}, daily: [{ day: '2026-10-04', visitors: '3', views: '4' }, { day: '2026-10-05', visitors: '5', views: '6' }], pages: [], countries: [], recent: [] },
    '/api/admin/log': [
      { action: 'at-0200z', target_type: 'x', notes: '', created_at: '2026-10-05T02:00:00.000Z' },
      { action: 'at-1600z', target_type: 'x', notes: '', created_at: '2026-10-05T16:00:00.000Z' },
    ],
  });
  await settle();
  try { await adm.loadEarnings(); } catch (_) {}
  const prow = adm.document.querySelector('#earnings-tbody tr');
  out.adminPeriod = prow ? (prow.children[5] || {}).textContent.trim() : null;
  adm.__charts.length = 0;
  try { await adm.loadOverview(); } catch (_) {}
  const c1 = adm.__charts[0];
  out.signupLabels = c1 ? c1.data.labels.join() : 'no chart';
  adm.__charts.length = 0;
  try { await adm.loadTraffic(); } catch (_) {}
  const c2 = adm.__charts.find(c => c && c.data && c.data.labels && c.data.labels.length === 2);
  out.trafficLabels = c2 ? c2.data.labels.join() : 'no chart';
  try { await adm.loadLog(); } catch (_) {}
  adm.document.getElementById('log-date-from').value = '2026-10-05';
  adm.document.getElementById('log-date-to').value = '2026-10-05';
  try { adm.applyLogFilters(); } catch (_) {}
  out.logKept = [...adm.document.querySelectorAll('#log-tbody tr td.primary')].map(t => t.textContent.trim().replace(/ /g, '_')).map(s => s.replace(/_/g, '-')).join();
  adm.close();
  console.log(JSON.stringify(out));
  process.exit(0);
}
