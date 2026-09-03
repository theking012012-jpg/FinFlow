'use strict';
/**
 * verify-fk1-inventory-cogs.js — F-K1. The inventory "COGS this month" KPI showed Σ(units×cost)
 * (inventory VALUE on hand) under a "MAC method" label, contradicting the FIFO COGS Summary ($0) and
 * the reports COGS. It must show the real FIFO COGS (server /api/cogs → window._cogsTotal) and be
 * labelled FIFO.
 *
 *   node tests/harness/verify-fk1-inventory-cogs.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const wm = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-api-wiring-medium.js'), 'utf8');
A('[STRUCTURAL] inv-cogs now reads the real FIFO COGS (window._cogsTotal)', /_invKpi\('inv-cogs',\s*S\(window\._cogsTotal \|\| 0\)\)/.test(wm));
A('[STRUCTURAL] inv-cogs no longer computes units×cost (inventory value)',
  !/_invKpi\('inv-cogs',\s*S\(window\.inventory\.reduce/.test(wm));
A('[STRUCTURAL] inventory render triggers loadCOGS to populate the real figure', /window\._cogsTotal == null.*loadCOGS|loadCOGS.*window\._cogsTotal == null/.test(wm) || /window\.loadCOGS === 'function' && window\._cogsTotal == null/.test(wm));

const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
A('[STRUCTURAL] COGS KPI label is FIFO (not MAC)', /id="inv-cogs">\$0<\/div><div class="mc-change neutral">FIFO method/.test(html));
A('[STRUCTURAL] no "MAC method" label remains on inv-cogs', !/id="inv-cogs">\$0<\/div><div class="mc-change neutral">MAC method/.test(html));

const bundle = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-bundle.js'), 'utf8');
A('[STRUCTURAL] bundle carries the FIFO-COGS inv-cogs fix', /_invKpi\('inv-cogs',\s*S\(window\._cogsTotal \|\| 0\)\)/.test(bundle));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-K1 inventory COGS)`);
process.exitCode = fail === 0 ? 0 : 1;
