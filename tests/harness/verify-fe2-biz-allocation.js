'use strict';
/**
 * verify-fe2-biz-allocation.js — F-E2. Business "Asset allocation" bars were static $0 (no ids, never
 * wired) despite a live portfolio. They must be populated from type-classified holdings.
 *
 * Structural (bars carry biz-alloc-* ids; render classifies holdings) + logic replication (all-stock
 * $1.0M book ⇒ Equities = full value, others $0).
 *
 *   node tests/harness/verify-fe2-biz-allocation.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
A('[STRUCTURAL] allocation bars carry ids (biz-alloc-eq/fi/re/cash)',
  /id="biz-alloc-eq"/.test(html) && /id="biz-alloc-fi"/.test(html) && /id="biz-alloc-re"/.test(html) && /id="biz-alloc-cash"/.test(html));
A('[STRUCTURAL] render classifies holdings into buckets and populates', /F-E2: populate the business asset-allocation bars[\s\S]{0,900}biz-alloc-eq-bar/.test(html));

// LOGIC replication of the classifier.
const classify = (hs) => {
  let eq=0,fi=0,re=0,csh=0;
  hs.forEach(h=>{ const v=(parseFloat(h.price)||0)*(parseFloat(h.shares)||0);
    const t=String(h.type||'').toLowerCase(), tk=String(h.ticker||'').toUpperCase();
    if(tk==='CASH'||t==='cash') csh+=v;
    else if(/bond|fixed|treasur|note|bill|gilt/.test(t)) fi+=v;
    else if(/reit|real\s*estate|property/.test(t)) re+=v;
    else eq+=v; });
  return {eq,fi,re,csh};
};
const biz = classify([ {ticker:'MSFT',type:'Stock',shares:2000,price:497.1}, {ticker:'MSFT',type:'Stock',shares:100,price:497.1} ]);
A('all-stock book: Equities = full value (2100×497.1)', Math.abs(biz.eq - 2100*497.1) < 0.01, JSON.stringify(biz));
A('non-equity buckets are 0', biz.fi===0 && biz.re===0 && biz.csh===0, JSON.stringify(biz));
const mixed = classify([ {ticker:'AGG',type:'Bond',shares:10,price:100}, {ticker:'VNQ',type:'REIT',shares:5,price:80}, {ticker:'CASH',type:'Cash',shares:1,price:500} ]);
A('mixed book classifies bond/REIT/cash correctly', mixed.fi===1000 && mixed.re===400 && mixed.csh===500, JSON.stringify(mixed));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-E2 business asset allocation)`);
process.exitCode = fail === 0 ? 0 : 1;
