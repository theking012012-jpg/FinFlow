'use strict';
/**
 * FA-P1 (2026-10-27) — public/ff-csp.js runs a data-on-<event> handler exactly as the browser ran the inline attribute it
 * replaces, and runs NOTHING that is not in the registry. Executed in a bare jsdom page holding only the runtime and a
 * registry built by scripts/gen-handlers.js's own registryText() (the same wrapper the app's registry uses).
 * (The policy itself — the browser refusing inline code — is executed in real Chromium by verify-fap1-strict-csp.)
 *
 *   1 `this` is the element; `event` is the event
 *   2 scope: a bare name resolves on the element first (as inline handlers did). The FORM step of that scope chain is
 *     executed in Chromium (verify-fap1-strict-csp) — jsdom has no form named properties, even for its own inline handlers.
 *   3 `return false` cancels the default action
 *   4 bubbling: child's handler, then the parent's; stopPropagation() in the child stops the parent's
 *   5 an event that does not bubble (mouseenter, a dispatched non-bubbling change) runs only the target's handler
 *   6 a handler that throws is reported, and the next handler up still runs
 *   7 code that is not in the registry does not run, and is reported once        old code: no runtime at all
 *   8 the attribute and the on<event> PROPERTY are one slot, as in the browser: a script that assigns el.onclick = fn
 *     replaces the data-on-click handler, el.onclick = null disables it, and reading el.onclick returns it
 *     (found by the owner's sweep 2026-10-28: the Pricing buttons re-point / disable themselves that way — before the
 *     fix one click on "Start free trial" ran BOTH handlers: two checkouts; a muted "Current plan" still started one)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { registryText } = require('../../scripts/gen-handlers.js');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(got)}, correct ${JSON.stringify(want)}]`); };

const CODES = [
  "this.setAttribute('data-who', this.id + ':' + event.type)",
  "this.setAttribute('data-q', tagName + '/' + id)",
  "return false",
  "window.__order.push(this.id)",
  "window.__order.push(this.id); event.stopPropagation()",
  "throw new Error('boom')",
];
console.log('\nFA-P1 — the handler runtime\n');
let runtime;
try { runtime = fs.readFileSync(path.join(ROOT, 'public', 'ff-csp.js'), 'utf8'); } catch (e) { runtime = null; }
if (!runtime) { eq('0  public/ff-csp.js exists', false, true); console.log(`\n  ${fail} FAILED — ${pass} passed, ${fail} failed\n`); process.exit(1); }

const errors = [];
const vc = new VirtualConsole(); vc.on('error', m => errors.push(String(m))); vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
const dom = new JSDOM(`<!doctype html><body>
  <button id="b1" data-on-click="${CODES[0].replace(/"/g, '&quot;')}">x</button>
  <form><input name="q" value="from-form"><button type="button" id="b2" data-on-click="${CODES[1]}">y</button></form>
  <a id="a1" href="#moved" data-on-click="return false">z</a>
  <div id="p1" data-on-click="window.__order.push(this.id)"><span id="c1" data-on-click="window.__order.push(this.id)">c</span></div>
  <div id="p2" data-on-click="window.__order.push(this.id)"><span id="c2" data-on-click="window.__order.push(this.id); event.stopPropagation()">c</span></div>
  <div id="p3" data-on-mouseenter="window.__order.push(this.id)"><span id="c3" data-on-mouseenter="window.__order.push(this.id)">c</span></div>
  <div id="p4" data-on-change="window.__order.push(this.id)"><input id="c4" data-on-change="window.__order.push(this.id)"></div>
  <div id="p5" data-on-click="window.__order.push(this.id)"><span id="c5" data-on-click="throw new Error('boom')">c</span></div>
  <button id="evil" data-on-click="window.__pwned = 1">e</button>
  <button id="s1" data-on-click="window.__order.push(this.id)">s1</button><button id="s2" data-on-click="window.__order.push(this.id)">s2</button><button id="s3" data-on-click="window.__order.push(this.id)">s3</button>
</body>`, { runScripts: 'outside-only', virtualConsole: vc, url: 'http://localhost/' });
const w = dom.window, d = w.document;
w.eval(runtime);
w.eval(registryText(CODES));
w.__order = [];

d.getElementById('b1').click();
eq('1  `this` is the element, `event` the event', d.getElementById('b1').getAttribute('data-who'), 'b1:click');
d.getElementById('b2').click();
eq('2  bare names resolve on the element (tagName, id)', d.getElementById('b2').getAttribute('data-q'), 'BUTTON/b2');
const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
d.getElementById('a1').dispatchEvent(ev);
eq('3  `return false` cancels the default action', ev.defaultPrevented, true);

w.__order = []; d.getElementById('c1').click();
eq('4  child, then parent', w.__order, ['c1', 'p1']);
w.__order = []; d.getElementById('c2').click();
eq('4  stopPropagation() in the child: the parent\'s handler does not run', w.__order, ['c2']);

w.__order = []; d.getElementById('c3').dispatchEvent(new w.MouseEvent('mouseenter', { bubbles: false }));
eq('5  mouseenter (does not bubble): only the target\'s handler', w.__order, ['c3']);
w.__order = []; d.getElementById('c4').dispatchEvent(new w.Event('change'));
eq('5  a dispatched change with bubbles:false: only the target\'s handler', w.__order, ['c4']);
w.__order = []; d.getElementById('c4').dispatchEvent(new w.Event('change', { bubbles: true }));
eq('5  …and a real (bubbling) change: target, then parent', w.__order, ['c4', 'p4']);

w.__order = []; const before = errors.length;
d.getElementById('c5').click();
eq('6  a handler that throws: the next handler up still runs', w.__order, ['p5']);
setTimeout(() => {
  eq('6  …and the error is reported', errors.slice(before).some(e => /boom/.test(e)), true);
  const e0 = errors.length;
  d.getElementById('evil').click(); d.getElementById('evil').click();
  eq('7  code not in the registry does not run', w.__pwned, undefined);
  eq('7  …and is reported once (not per click)', errors.slice(e0).filter(e => /not a registered handler/.test(e)).length, 1);
  w.__order = [];
  d.getElementById('s1').onclick = function () { w.__order.push('prop'); };
  d.getElementById('s1').click();
  eq('8  el.onclick = fn replaces the data-on-click handler (one slot) — fn runs, the attribute\'s does not', w.__order, ['prop'], ['s1', 'prop']);
  w.__order = []; d.getElementById('s2').onclick = null; d.getElementById('s2').click();
  eq('8  el.onclick = null disables it', w.__order, [], ['s2']);
  w.__order = []; const got = d.getElementById('s3').onclick; if (typeof got === 'function') got();
  eq('8  reading el.onclick returns the data-on-click handler (callable, `this` = the element)', [typeof got, w.__order], ['function', ['s3']], ['object', []]);
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}, 20);
