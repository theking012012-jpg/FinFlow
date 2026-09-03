'use strict';
/**
 * verify-fa1-dashboard-expense-label.js — F-A1. The dashboard "Expense breakdown" widget must label
 * each bar with its ACTUAL category, not a hardcoded positional label. The label spans had no id, so
 * updateExpenseBars (which sets exp-*-lbl) could not relabel them — a Rent-only $2,850 rendered under
 * the hardcoded "Salaries" slot.
 *
 * Structural (label spans now carry exp-*-lbl ids; renderer sets the label from the category and clears
 * empty rows) + logic replication (Rent-only expenses ⇒ top bar labelled "Rent", not "Salaries").
 *
 *   node tests/harness/verify-fa1-dashboard-expense-label.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
// The dashboard block is the one with id="exp-sal" (values). Its labels must now carry exp-*-lbl ids.
A('[STRUCTURAL] dashboard label spans have exp-sal-lbl/exp-rent-lbl/exp-sw-lbl/exp-mkt-lbl',
  /id="exp-sal-lbl"/.test(html) && /id="exp-rent-lbl"/.test(html) && /id="exp-sw-lbl"/.test(html) && /id="exp-mkt-lbl"/.test(html));

const wd = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-api-wiring-dashboard.js'), 'utf8');
A('[STRUCTURAL] updateExpenseBars sets each label from the real category', /if \(lblEl && cat != null\) lblEl\.textContent = cat;/.test(wd));
A('[STRUCTURAL] updateExpenseBars clears empty-row labels (not just values)', /_paint\(i, '', null\)/.test(wd));

// LOGIC replication of updateExpenseBars label binding.
const labelIds = ['Salaries','Rent','Software','Marketing']; // starting hardcoded text
const expenses = [{category:'Rent',amount:250},{category:'Rent',amount:1600},{category:'Rent',amount:1000}];
const cats = {}; expenses.forEach(e=>{ const c=e.category||'Other'; cats[c]=(cats[c]||0)+(parseFloat(e.amount)||0); });
const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
const labels = ['','','','']; const vals = [null,null,null,null];
const paint=(i,cat,amt)=>{ if(cat!=null) labels[i]=cat; vals[i]=(amt==null)?'—':amt; };
for(let i=0;i<4;i++) paint(i,'',null);
sorted.slice(0,4).forEach(([cat,amt],i)=>paint(i,cat,amt));
A('top bar label = "Rent" (the real category), NOT "Salaries"', labels[0]==='Rent', `labels=${JSON.stringify(labels)}`);
A('top bar value = 2850', vals[0]===2850, `vals=${JSON.stringify(vals)}`);
A('empty rows carry no stale category label', labels[1]==='' && labels[2]==='' && labels[3]==='', `labels=${JSON.stringify(labels)}`);

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-A1 dashboard expense label)`);
process.exitCode = fail === 0 ? 0 : 1;
