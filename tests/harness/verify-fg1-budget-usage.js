'use strict';
/**
 * verify-fg1-budget-usage.js — F-G1. Budget "Spent / % used / over-budget" must compare actuals of
 * BUDGETED categories against their budgets — not ALL expenses (incl. unbudgeted categories) against a
 * partial budget, which reported "570% over budget" while the one budgeted category was under.
 *
 *   node tests/harness/verify-fg1-budget-usage.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const wm = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-api-wiring-medium.js'), 'utf8');
A('[STRUCTURAL] totalSpent accumulates budgeted-category actuals in the targets loop', /totalSpent \+= actual;\s*\/\/ F-G1/.test(wm));
A('[STRUCTURAL] totalSpent no longer sums ALL expenses', !/const totalSpent = expenses\.reduce/.test(wm));

// LOGIC replication: Marketing budgeted $500 (actual $0); Rent unbudgeted (actual $2850).
const targets = { Marketing: 500 };
const catActuals = { rent: 2850, marketing: 0 };
let totalBudget = 0, totalSpent = 0;
Object.entries(targets).forEach(([cat, budget]) => { totalBudget += parseFloat(budget)||0; totalSpent += catActuals[cat.toLowerCase()]||0; });
const remaining = totalBudget - totalSpent;
const pct = totalBudget > 0 ? Math.round(totalSpent/totalBudget*100) : 0;
A('spent = budgeted actuals only ($0, not $2850)', totalSpent === 0, `totalSpent=${totalSpent}`);
A('% used = 0% (not 570%)', pct === 0, `pct=${pct}`);
A('remaining = $500, under budget', remaining === 500 && remaining >= 0, `remaining=${remaining}`);

// Realistic over-budget case still works.
{ const t={Marketing:500}, ca={marketing:800}; let tb=0,ts=0; Object.entries(t).forEach(([c,b])=>{tb+=b;ts+=ca[c.toLowerCase()]||0;});
  A('genuine over-budget still flagged (spend $800 vs $500 → over)', (tb-ts) < 0 && Math.round(ts/tb*100)===160, `pct=${Math.round(ts/tb*100)}`); }

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-G1 budget usage)`);
process.exitCode = fail === 0 ? 0 : 1;
