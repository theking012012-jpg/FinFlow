'use strict';
/**
 * verify-app-domain.js — Phase 1.4 / L2. `finflow-production-dab1.up.railway.app` is DEAD (Railway "Not Found");
 * the live origin is dab2, and the canonical origin is whatever APP_URL says (app-url.js, F29 single source).
 * public/sitemap.xml hard-coded the dead dab1 origin, so search engines were handed dead URLs and a domain swap
 * needed a file edit as well as the env var (the F29 note: "custom-domain swap needs BOTH APP_URL and
 * LIVE_FALLBACK, plus static files hard-coded").
 *
 * Executed: boot the real server with APP_URL set, then without it, and read GET /sitemap.xml.
 *   APP_URL=https://books.example.test ⇒ every <loc> on that origin          (bug: dab1)
 *   APP_URL unset                       ⇒ app-url.js LIVE_FALLBACK (dab2)    (bug: dab1)
 * STRUCTURAL (labelled — a value cannot prove an absence): no tracked shipped file names the dead dab1 origin.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-app-domain.js
 */
require('./clock.js');
const { execSync } = require('child_process');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function sitemapWith(appUrl) {
  if (appUrl == null) delete process.env.APP_URL; else process.env.APP_URL = appUrl;
  const http = new HarnessHttp(server.baseUrl);
  const r = await http.get('/sitemap.xml');
  return { status: r.status, type: (r.headers && (r.headers['content-type'] || (r.headers.get && r.headers.get('content-type')))) || '', locs: (r.text.match(/<loc>([^<]+)<\/loc>/g) || []).map(x => x.replace(/<\/?loc>/g, '')) };
}
let server;
(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L2 — app links use APP_URL (live origin), never the dead dab1 domain\n' + '='.repeat(78) + '\n');
    const a = await sitemapWith('https://books.example.test');
    A('sitemap 200', a.status === 200, 'status=' + a.status);
    A('APP_URL set: every <loc> is on https://books.example.test (bug: dab1)', a.locs.length >= 2 && a.locs.every(l => l.startsWith('https://books.example.test/')), JSON.stringify(a.locs));
    const b = await sitemapWith(null);
    A('APP_URL unset: <loc>s use the live fallback (dab2), not dab1', b.locs.length >= 2 && b.locs.every(l => /dab2\.up\.railway\.app\//.test(l)), JSON.stringify(b.locs));
    const root = path.resolve(__dirname, '..', '..');
    let hits = '';
    try { hits = execSync(`git -C "${root}" grep -l "dab1" -- . ':!*.md' ':!tests/harness/*' ':!.fuse_hidden*' ':!public/.fuse_hidden*'`, { encoding: 'utf8' }).trim(); } catch (_) { hits = ''; }
    A('STRUCTURAL: no tracked shipped file names the dead dab1 origin', hits === '', 'files: ' + hits);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (app domain)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
