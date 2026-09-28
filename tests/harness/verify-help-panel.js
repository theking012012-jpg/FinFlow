'use strict';
/**
 * verify-help-panel.js — in-app Help & Getting-Started panel (onboarding + support surface). STATIC:
 * asserts the panel exists, is reachable from the nav, links only to REAL pages, offers a support
 * contact, and guards localStorage (per-viewer, try/catch). Closes the onboarding/support gap vs.
 * incumbents without touching money code.
 *   node tests/harness/verify-help-panel.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');

A('window.ffHelp is defined', /window\.ffHelp\s*=\s*function/.test(html));
A('reachable from the sidebar nav (onclick ffHelp)', /onclick="ffHelp\(\)"/.test(html));
A('renders a Getting started checklist', /Getting started/.test(html) && /data-tick=/.test(html));
A('renders a Questions/FAQ section', /Questions/.test(html) && /<details/.test(html));
A('offers a support contact', /mailto:support@finflow\.app/.test(html));

// every checklist "Go" target must be a REAL showPage id (no dead links)
const VALID = new Set(['entities','invoices','connections','banking','my-accountant','fx','reports','dashboard','team','settings']);
const block0 = html.slice(html.indexOf('window.ffHelp = function'), html.indexOf('window.ffHelp = function') + 9000);
const gos = [...block0.matchAll(/,'([a-z0-9-]+)'\]/g)].map(m => m[1]);
A('checklist has 5 step targets', gos.length === 5, 'targets=' + JSON.stringify(gos));
A('every checklist target is a real page', gos.every(g => VALID.has(g)), 'targets=' + JSON.stringify(gos));
A('checklist navigates via window.showPage', /if\(window\.showPage\)\s*window\.showPage\(id\)/.test(html));

// localStorage must be guarded (per-viewer convenience; must never throw the panel)
const block = html.slice(html.indexOf('window.ffHelp = function'), html.indexOf('window.ffHelp = function') + 9000);
A('localStorage reads/writes are wrapped in try/catch', /try\{[^}]*localStorage\.getItem/.test(block) && /try\{[^}]*localStorage\.setItem/.test(block));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (help & getting-started panel)`);
console.log('');
process.exitCode = fail === 0 ? 0 : 1;
