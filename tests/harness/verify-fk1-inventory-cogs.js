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
// LR15 (2026-10-21): "COGS this month" is THIS month's FIFO COGS from /api/cogs (app-main _loadCogsThisMonth), no longer
// the dashboard period's _cogsTotal under a "this month" label — executed in verify-lr15-cogs-this-month.
A('[STRUCTURAL] inv-cogs reads the real FIFO COGS for this month (/api/cogs via _loadCogsThisMonth)', /_paintCogsThisMonth\(\)/.test(wm) && /_loadCogsThisMonth\(\)/.test(wm));
A('[STRUCTURAL] inv-cogs no longer computes units×cost (inventory value)',
  !/_invKpi\('inv-cogs',\s*S\(window\.inventory\.reduce/.test(wm));
A('[STRUCTURAL] inventory render triggers loadCOGS to populate the real figure', /window\._cogsTotal == null.*loadCOGS|loadCOGS.*window\._cogsTotal == null/.test(wm) || /window\.loadCOGS === 'function' && window\._cogsTotal == null/.test(wm));

const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
A('[STRUCTURAL] COGS KPI label is FIFO (not MAC)', /id="inv-cogs">—<\/div><div class="mc-change neutral">FIFO method/.test(html));   // LR15: "—" until loaded
A('[STRUCTURAL] no "MAC method" label remains on inv-cogs', !/id="inv-cogs">[^<]*<\/div><div class="mc-change neutral">MAC method/.test(html));

const bundle = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-bundle.js'), 'utf8');
A('[STRUCTURAL] bundle carries the FIFO-COGS inv-cogs fix', /_paintCogsThisMonth/.test(bundle));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-K1 inventory COGS)`);
process.exitCode = fail === 0 ? 0 : 1;
