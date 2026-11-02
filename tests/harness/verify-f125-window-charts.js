'use strict';
/**
 * verify-f125-window-charts — F125 (the last three sites). `app-main.js` declares the chart registry with a top-level
 * `let charts = {}`, which never becomes `window.charts`, so every read of `window.charts` saw `undefined`:
 *   · app-main buildCharts: `if (window.charts) { …destroy…; window.charts = {} }` — never ran (and is not needed:
 *     the line above it already destroys every Chart instance);
 *   · finflow-api-wiring-dashboard.js (two sites): `if (!window.charts?.overview && …) buildCharts()` — the guard was
 *     always true, so the chart was (re)built on every dashboard load.
 * Fix (behaviour kept exactly): the dead block is deleted and the two guards say what actually happens — build the
 * chart on every load. No code reads `window.charts` any more (the finding's "done when").
 * Executed: the real /app in Chromium against the real server and scratch Postgres — the overview chart is built
 * (Chart.js self-hosted), its July revenue bar is the seeded figure, the dashboard boot and the dashboard refresh (the two
 * wiring sites) each rebuild it — as the always-true guard made them do — and nothing throws.
 *   Seed: invoices 2026-07-05 1,234 and 2026-06-10 400 (no other revenue). July bar = 1,234; June bar = 400.
 *   Bug shapes this would catch: a chart that is not built (no instance), or one left from an earlier load whose data
 *   is not this seed.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f125-window-charts.js
 */
const fs = require('fs'); const path = require('path');
const acorn = require('acorn');
const { runBrowser } = require('./browserKit.js');

const PUB = path.join(__dirname, '..', '..', 'public');
function windowChartsReads(file) {
  const src = fs.readFileSync(path.join(PUB, file), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true });
  const hits = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'MemberExpression' && n.object && n.object.type === 'Identifier' && n.object.name === 'window'
        && ((!n.computed && n.property.name === 'charts') || (n.computed && n.property.value === 'charts'))) {
      hits.push(file + ':' + src.slice(0, n.start).split('\n').length);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  return hits;
}

runBrowser('F125 — no code reads window.charts; the overview chart is still built on every load', async ({ open, A, eq, J }) => {
  const files = ['app-main.js'].concat(fs.readdirSync(PUB).filter(f => /^finflow-api-wiring.*\.js$/.test(f)), fs.readdirSync(path.join(PUB, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f));
  const hits = files.flatMap(windowChartsReads);
  eq('[STRUCTURAL] no code reads or writes window.charts (parsed, comments excluded) — ' + files.length + ' files', hits, []);

  await J('POST', '/api/invoices', { client: 'July Co', amount: 1234, status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-05', idempotency_key: 'f125-jul' });
  await J('POST', '/api/invoices', { client: 'June Co', amount: 400, status: 'pending', issue_date: '2026-06-10', due_date: '2026-07-10', idempotency_key: 'f125-jun' });

  const page = await open({ width: 1280, height: 900 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.waitForFunction(() => typeof Chart !== 'undefined' && !!Chart.getChart(document.getElementById('overviewChart')), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const read = () => page.evaluate(() => {
    const ch = (typeof Chart !== 'undefined') ? Chart.getChart(document.getElementById('overviewChart')) : null;
    if (!ch) return null;
    const labels = ch.data.labels || [], rev = (ch.data.datasets[0] || {}).data || [];
    const at = (rx) => { const i = labels.findIndex(l => rx.test(String(l))); return i < 0 ? null : Number(rev[i]); };
    return { id: ch.id, jul: at(/Jul/), jun: at(/Jun/) };
  });
  const first = await read();
  A('the overview chart is built (a Chart.js instance on #overviewChart)', !!first, 'no chart');
  eq('July revenue bar = 1,234 (the seeded July invoice)', first && first.jul, 1234);
  eq('June revenue bar = 400 (the seeded June invoice)', first && first.jun, 400);

  // a second dashboard load (what the two wiring sites run on) still (re)builds the chart from the books
  // the two wiring sites: the dashboard boot (window._bootDashboardWiring) and the refresh (window._refreshDashboardUI)
  const fns = await page.evaluate(() => [typeof window._bootDashboardWiring, typeof window._refreshDashboardUI]);
  eq('both wiring entry points are present', fns, ['function', 'function']);
  await page.evaluate(async () => { await window._bootDashboardWiring(); });
  await page.waitForTimeout(2000);
  const second = await read();
  A('a dashboard boot REBUILDS the chart (a new Chart.js instance — what the always-true guard did; behaviour kept)', !!first && !!second && second.id !== first.id, 'ids ' + (first && first.id) + ' → ' + (second && second.id));
  eq('…with the same July bar (after the boot)', second && second.jul, 1234);
  await page.evaluate(async () => { await window._refreshDashboardUI(); });
  await page.waitForTimeout(2000);
  const third = await read();
  A('a dashboard refresh REBUILDS the chart too', !!second && !!third && third.id !== second.id, 'ids ' + (second && second.id) + ' → ' + (third && third.id));
  eq('…with the same July bar (after the refresh)', third && third.jul, 1234);
  eq('no page errors', errs, []);
}, {});
