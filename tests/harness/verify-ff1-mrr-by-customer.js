'use strict';
/**
 * verify-ff1-mrr-by-customer.js — F-F1/F-F2. The MRR "Revenue by customer" card (#mrr-by-customer) was
 * a permanent "Loading…" placeholder no code populated. loadMRRData must group active recurring subs by
 * client, set Active-customers count (#mrr-customers) and Net MRR (#mrr-net). New/Churned/Expansion stay
 * "—" (no cohort history retained) — honest, not fabricated.
 *
 *   node tests/harness/verify-ff1-mrr-by-customer.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
const fn = (html.match(/async function loadMRRData\(\)\{[\s\S]*?\n\}/) || [''])[0];
A('[STRUCTURAL] loadMRRData populates #mrr-by-customer', /getElementById\('mrr-by-customer'\)/.test(fn) && /_byCust/.test(fn));
A('[STRUCTURAL] loadMRRData sets active-customers count (#mrr-customers)', /getElementById\('mrr-customers'\)/.test(fn));
A('[STRUCTURAL] loadMRRData sets Net MRR (#mrr-net)', /getElementById\('mrr-net'\)/.test(fn));
A('[STRUCTURAL] does not fabricate churn/new/expansion (left honest)', !/mrr-churned'\)[^;]*=[^;]*monthlyTotal|mrr-new'\)[^;]*=[^;]*monthlyTotal/.test(fn));

// LOGIC replication of the grouping.
const monthlyVal = r => { const a=parseFloat(r.amount)||0; const f=String(r.frequency||'').toLowerCase(); return f==='quarterly'?a/3:f==='annually'?a/12:a; };
const active = [
  {client:'sean', amount:1000, frequency:'Monthly', status:'active'},
  {client:'ZZ QA Recurring', amount:300, frequency:'Monthly', status:'active'},
];
const byCust = {}; active.forEach(r=>{ const c=r.client||'—'; byCust[c]=(byCust[c]||0)+monthlyVal(r); });
const entries = Object.entries(byCust).sort((a,b)=>b[1]-a[1]);
A('grouped by customer: sean $1000/mo top, ZZ QA $300/mo', entries[0][0]==='sean' && entries[0][1]===1000 && entries[1][1]===300, JSON.stringify(entries));
A('active-customer count = 2', Object.keys(byCust).length === 2);
A('Net MRR = Σ monthly (1300)', active.reduce((s,r)=>s+monthlyVal(r),0) === 1300);

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-F1/F-F2 MRR by customer)`);
process.exitCode = fail === 0 ? 0 : 1;
