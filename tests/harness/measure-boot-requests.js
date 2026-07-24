'use strict';
/**
 * measure-boot-requests.js — count the API requests a COLD dashboard boot makes, at the fetch
 * layer, so the rate-limit proposal is sized against a measured number, not a HAR estimate.
 *
 *   node -r ./tests/harness/clock.js tests/harness/measure-boot-requests.js
 *
 * CAVEAT (stated, not hidden): this counts what the SPA's JS actually requests in jsdom on a
 * dashboard-only boot. It is a real, reproducible floor, but it is NOT identical to a browser:
 * page-specific loaders that only fire when their tab is opened (MRR, accountant, banking page,
 * etc.) do not run here, and jsdom does not fetch images/fonts/charts. So the true browser boot
 * count is >= this. The duplicate-path structure, however, is the SPA's own doing and transfers.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

async function main() {
  const h = await bootSpaInJsdom({});   // no injection — a clean cold boot
  try {
    await h.settle(60, 100);            // 6s: the boot storm is front-loaded in the first ~2s
    const reqs = h.reqLog.filter((r) => r.path.startsWith('/api/'));

    const byPath = new Map();
    for (const r of reqs) {
      const key = `${r.method} ${r.path.replace(/\/\d+(?=\/|$)/g, '/:id')}`;   // collapse numeric ids
      byPath.set(key, (byPath.get(key) || 0) + 1);
    }
    const total = reqs.length;
    const unique = byPath.size;
    const redundant = total - unique;
    const within2s = reqs.filter((r) => r.at <= 2000).length;

    console.log('\n' + '═'.repeat(72));
    console.log('  COLD DASHBOARD BOOT — API request cost (jsdom, fetch layer)');
    console.log('═'.repeat(72));
    console.log(`  total /api requests      : ${total}`);
    console.log(`  unique method+path       : ${unique}`);
    console.log(`  redundant (total-unique) : ${redundant}`);
    console.log(`  arriving within 2s       : ${within2s}`);
    console.log('');
    console.log('  ── per path (count × method path) — duplicates first ─────────────────');
    const rows = [...byPath.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, n] of rows) {
      const mark = n > 1 ? `  ×${n}  DUP` : '  ×1';
      console.log(`   ${String(n).padStart(3)}${mark.padEnd(9)} ${key}`);
    }
    console.log('');
    console.log('  ── methods ───────────────────────────────────────────────────────────');
    const gets = reqs.filter((r) => r.method === 'GET').length;
    const mut = total - gets;
    console.log(`   GET: ${gets}   non-GET (POST/PUT/DELETE): ${mut}`);
    console.log('═'.repeat(72) + '\n');
  } finally {
    await h.stop();
  }
  process.exitCode = 0;
}

main().catch((e) => { console.error('[measure] FAILED', e && e.stack ? e.stack : e); process.exitCode = 0; });
