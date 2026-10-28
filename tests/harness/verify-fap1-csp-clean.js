'use strict';
/**
 * FA-P1 (2026-10-27) — STRUCTURAL (labelled, Rule 5): FinFlow's own pages and scripts contain nothing the strict
 * Content-Security-Policy (no 'unsafe-inline') would block, and the handler registry is exactly what the source names.
 * scripts/csp-scan.js reads every page (markup) and every script (its strings and templates, parsed — not grepped), so
 * a new inline handler, inline script or javascript: URL cannot ship unnoticed. What the browser actually does under the
 * policy is executed in Chromium by verify-fap1-strict-csp.
 *
 * Old code (measured 2026-10-27): 47 inline scripts, 961 handler attributes (186 built from runtime values),
 * 4 setAttribute('on…'), ~2,870 style attributes (154 built from runtime values), 29 <style> blocks / elements,
 * 1 setAttribute('style') — and no registry.
 */
const { scan } = require('../../scripts/csp-scan.js');
let gen = null; try { gen = require('../../scripts/gen-handlers.js'); } catch (_) {}
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(got)}, correct ${JSON.stringify(want)}]`); };
console.log('\nFA-P1 — nothing inline (STRUCTURAL)\n');
const all = scan();
const of = k => all.filter(f => f.kind === k);
const show = list => list.slice(0, 5).map(f => `${f.file}:${f.line} ${String(f.code).slice(0, 60)}`);
eq('1  no inline <script> in any page', show(of('inline-script')), []);
eq('2  no on<event>="…" handler attribute (markup or script-built HTML)', show(of('handler')), []);
eq('3  no setAttribute(\'on…\')', show(of('set-attr').filter(f => !/['"]style['"]/.test(f.code))), []);
eq('4  no javascript: URL', show(of('js-url')), []);
eq('7  no style="…" attribute (markup or script-built HTML) — styles travel as data-style', show(of('style-attr')), []);
// The one <style> element left is ff-csp.js's own fallback for a browser without constructed stylesheets (jsdom).
eq('7  no <style> block or <style> element — except ff-csp.js\'s fallback for a browser without constructed stylesheets', show(of('style-block').filter(f => f.file !== 'ff-csp.js')), []);
eq('7  no setAttribute(\'style\')', show(of('set-attr')), []);
eq('5  every script parses (the scan read them all)', show(of('parse-error')), []);
// 8: a value that moved from a JS string into a data-arg-* attribute is HTML text now — a JS-escaper left on it
// (.replace(/'/g, "\\'") — or stripping quotes to keep a JS string valid) would arrive as a literal backslash / a
// mangled name. Measured 2026-10-27 before the fix: 4 (country, help category, 2 client names).
{
  const srcs = require('../../scripts/csp-scan.js').files().filter(f => f.endsWith('.js'));
  const hits = [];
  for (const f of srcs) {
    const t = fs.readFileSync(path.join(__dirname, '..', '..', 'public', f), 'utf8');
    for (const m of t.matchAll(/data-arg-[\w-]+="(?:\$\{|'\s*\+)[^"\n]{0,160}?replace\(\/'\/g/g)) hits.push(f + ': ' + m[0].slice(0, 70));
  }
  eq('8  no data-arg value carries a JS-string escaper (it is an HTML attribute now)', hits.slice(0, 5), []);
}
if (gen) {
  const { text, problems, count } = gen.build();
  eq('6  every data-on-* handler is constant code that compiles, on an event the runtime dispatches', problems.slice(0, 5), []);
  const cur = (() => { try { return fs.readFileSync(path.join(__dirname, '..', '..', 'public', '_gen', 'ff-handlers.js'), 'utf8'); } catch (_) { return ''; } })();
  eq(`6  the committed registry is what the source produces (${count} handlers)`, cur === text, true);
} else eq('6  scripts/gen-handlers.js exists', false, true);
console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;
