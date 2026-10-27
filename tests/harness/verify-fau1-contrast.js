'use strict';
/**
 * FA-U1 (2026-10-27) — every text colour token reads at 4.5:1 or more (WCAG AA) on every background, in BOTH themes.
 * Measured on the old values: dark --t3 #5a4e3a 1.88–2.42:1, light --t3 #a89878 2.05–2.83:1 (FA-U1 named only dark —
 * Rule 13), and chart axis labels hard-coded #5a4e3a. Computed from the token values shipped in public/index.html
 * (jsdom renders no colour, so this is a TOKEN check: real values, real WCAG arithmetic, not a screenshot).
 */
const fs = require('fs'), path = require('path');
const html = require('./appScripts.js').pageSource('index.html');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const L = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const themes = [...html.matchAll(/--bg0:(#[0-9a-f]{6});--bg1:(#[0-9a-f]{6});--bg2:(#[0-9a-f]{6});--bg3:(#[0-9a-f]{6});--bg4:(#[0-9a-f]{6});[\s\S]{0,200}?--t1:(#[0-9a-f]{6});--t2:(#[0-9a-f]{6});--t3:(#[0-9a-f]{6});/g)];
console.log('\nFA-U1 — text contrast, both themes\n');
eq('0  setup: the theme blocks are found (dark, light, light-auto)', themes.length >= 2, true);
const low = [];
themes.forEach((m, i) => { const bg = m.slice(1, 6), t = { t1: m[6], t2: m[7], t3: m[8] };
  for (const k in t) for (const b of bg) { const r = cr(t[k], b); if (r < 4.5) low.push(`theme${i} ${k} ${t[k]} on ${b} = ${r.toFixed(2)}`); } });
eq('1  every text token is 4.5:1+ on every background', low, [], ['theme0 t3 #5a4e3a on #16120d = 2.30', '…']);
eq('2  no chart axis label hard-codes the old #5a4e3a', (html.match(/ticks:\{color:'#5a4e3a'/g) || []).length, 0, 4);
console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
