#!/usr/bin/env node
/* Mobile-perf (SLIM_APP): the /app document ships ~449 KB of inline <script> (54% of the file),
 * which the browser must parse + compile + run on the main thread during load — the dominant cause
 * of the ~10 s mobile Total Blocking Time. This build step moves every inline app-logic <script>
 * (those AFTER the first external <script>, i.e. the body bundles) into external files under
 * public/_gen and references them as plain external scripts (NOT defer — deferring reordered execution and broke a load-time dependency). The small critical head scripts BEFORE the first
 * external script (theme/_appReady/loadChartJS) stay inline so there is no flash. Deferred scripts
 * execute in document order after parse, so execution order is preserved exactly; existing external
 * body scripts are also marked defer to keep the single ordered queue. Output: public/_gen/index.html
 * (slim) + public/_gen/app-NN.js. Original public/index.html is never modified. Serving is gated on
 * the SLIM_APP env flag (see server.js), so this is a no-op unless explicitly enabled.
 */
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const SRC = path.join(PUB, 'index.html');
const OUTDIR = path.join(PUB, '_gen');

let html = fs.readFileSync(SRC, 'utf8');
fs.mkdirSync(OUTDIR, { recursive: true });
// clean previous generated app-*.js
for (const f of fs.readdirSync(OUTDIR)) if (/^app-\d+\.js$/.test(f)) { try { fs.unlinkSync(path.join(OUTDIR, f)); } catch (_) { /* best-effort: referenced files are overwritten below */ } }

// cutoff = position of the first external <script src=...>; inline scripts before it stay inline.
const firstExt = html.search(/<script\b[^>]*\bsrc=/i);
if (firstExt < 0) { console.error('[externalize] no external script found; aborting'); process.exit(1); }

const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let out = '', last = 0, n = 0, externalized = 0, deferredExt = 0, m;
while ((m = scriptRe.exec(html)) !== null) {
  const [full, attrs, body] = m;
  const start = m.index;
  out += html.slice(last, start);
  last = start + full.length;
  const hasSrc = /\bsrc=/i.test(attrs);
  if (start < firstExt) { out += full; continue; }      // critical head scripts: leave as-is
  if (hasSrc) { out += full; continue; }                 // existing external script: leave EXACTLY as-is
                                                         // (deferring app-main.js reorders it before
                                                         // finflow-bundle.js, breaking renderItems).
  if (!body.trim()) { out += full; continue; }           // empty inline → skip
  const file = `app-${String(n).padStart(2, '0')}.js`;
  fs.writeFileSync(path.join(OUTDIR, file), body, 'utf8');
  out += `<script src="/_gen/${file}"></script>`;   // PLAIN (no defer): run in exact original inline order, avoids the renderItems race
  n++; externalized++;
}
out += html.slice(last);
fs.writeFileSync(path.join(OUTDIR, 'index.html'), out, 'utf8');

const srcKB = Buffer.byteLength(html) / 1024, outKB = Buffer.byteLength(out) / 1024;
console.log(`[externalize] inline blocks externalized: ${externalized}; existing externals set defer: ${deferredExt}`);
console.log(`[externalize] /app document: ${srcKB.toFixed(0)} KB -> ${outKB.toFixed(0)} KB (slim)`);
