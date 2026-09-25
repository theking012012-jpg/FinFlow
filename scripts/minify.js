// scripts/minify.js — front-end minify build step (mobile-perf lever).
//
// App JS is served no-store by design (server.js: the service worker is the freshness layer, so a
// stale HTTP cache can never pin old money-computing code). With no HTTP cache and gzip already on,
// the remaining win on mobile is shipping FEWER BYTES to parse/execute — i.e. minification.
//
// This step reads the large served front-end files and writes minified copies into public/.min/.
// server.js transparently serves public/.min/<name> for /<name> WHEN the minified copy exists and is
// at least as new as its source (the mtime guard) — otherwise it serves the original. So this build is
// PURELY ADDITIVE and fail-safe: if terser is absent, or a file fails to minify, or the sources change
// without a rebuild, the app just serves the readable originals. It never blocks boot.
//
//   node scripts/minify.js            minify the target list into public/.min/
//   node scripts/minify.js --check    exit 0 always; report which targets are stale/missing (advisory)
//
// Run AFTER bundle.js (so finflow-bundle.js is fresh) — package.json chains them in prestart.
'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const OUT = path.join(PUB, '.min');

// The served front-end files worth minifying (biggest parse/transfer cost first). Only files that are
// actually loaded by a <script> tag. finflow-bundle.js is the concatenation bundle.js produces.
const TARGETS = [
  'app-main.js',
  'finflow-bundle.js',
  'finflow-f94.js',
  'finflow-docview.js',
  'finflow-lineitems.js',
  'finflow-owner-mfa.js',
  'finflow-dates.js',
  'finflow-api.js',
];

let terser = null;
try { terser = require('terser'); }
catch (_) { console.log('[minify] terser not installed — skipping (app will serve un-minified sources).'); process.exit(0); }

const isCheck = process.argv.includes('--check');

async function main() {
  if (!isCheck) fs.mkdirSync(OUT, { recursive: true });
  let done = 0, skipped = 0, failed = 0, stale = 0;
  let srcTotal = 0, minTotal = 0;
  for (const name of TARGETS) {
    const src = path.join(PUB, name);
    const dst = path.join(OUT, name);
    if (!fs.existsSync(src)) { continue; }
    const srcStat = fs.statSync(src);
    const fresh = fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= srcStat.mtimeMs;
    if (isCheck) { if (!fresh) { stale++; console.log('[minify:check] stale/missing: ' + name); } continue; }
    if (fresh) { skipped++; srcTotal += srcStat.size; minTotal += fs.statSync(dst).size; continue; }
    try {
      const code = fs.readFileSync(src, 'utf8');
      const result = await terser.minify(code, {
        compress: { defaults: true },
        mangle: true,
        format: { comments: false },
        // Front-end scripts are classic (non-module) globals; keep top-level names so cross-file
        // globals (e.g. window.* wiring) are never renamed away.
        toplevel: false,
        sourceMap: false,
      });
      if (result.error) throw result.error;
      const outCode = result.code || '';
      if (!outCode) throw new Error('empty output');
      fs.writeFileSync(dst, outCode);
      done++; srcTotal += srcStat.size; minTotal += Buffer.byteLength(outCode);
      console.log('[minify] ' + name + ': ' + srcStat.size + ' -> ' + Buffer.byteLength(outCode) + ' bytes');
    } catch (e) {
      failed++;
      // Never leave a stale/partial min for this file — remove it so the original is served.
      try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch (_) {}
      console.error('[minify] FAILED ' + name + ': ' + (e && e.message) + ' — will serve original.');
    }
  }
  if (isCheck) { console.log('[minify:check] ' + stale + ' stale/missing of ' + TARGETS.length + ' (advisory; prestart regenerates).'); process.exit(0); }
  const pct = srcTotal ? Math.round((1 - minTotal / srcTotal) * 100) : 0;
  console.log('[minify] done: ' + done + ' built, ' + skipped + ' fresh, ' + failed + ' failed — ' + srcTotal + ' -> ' + minTotal + ' bytes (' + pct + '% smaller).');
  process.exit(0);   // never fail the build: minify is best-effort
}
main().catch(e => { console.error('[minify] fatal (ignored):', e && e.message); process.exit(0); });
