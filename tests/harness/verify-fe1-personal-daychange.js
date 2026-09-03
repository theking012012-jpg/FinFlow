'use strict';
/**
 * verify-fe1-personal-daychange.js — F-E1. Personal-investments "Day's Change" must be the actual
 * intraday price movement Σ(dayChgPx × shares), identical to the business engine — NOT
 * (currentValue − prior-day snapshot), which compared two DIFFERENT portfolio compositions and
 * reported a nonsensical loss larger than the whole portfolio (−151%).
 *
 * Structural (calcPortfolio now sums dayChgPx×shares; the snapshot-delta is gone) + a logic
 * replication on the real audited holdings (3× MSFT, 210 shares, dayChgPx −3.92 → −823.2, NOT −158,100).
 *
 *   node tests/harness/verify-fe1-personal-daychange.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const am = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8');
const calc = (am.match(/function calcPortfolio\(\)\{[\s\S]*?\n\}/) || [''])[0];

// STRUCTURAL
A('[STRUCTURAL] calcPortfolio sums per-holding dayChgPx×shares', /dayChgPx\s*\*\s*h\.shares/.test(calc));
A('[STRUCTURAL] stale prior-snapshot day-change removed from calcPortfolio',
  !/totalValue\s*-\s*\(parseFloat\(_prior\.value\)/.test(calc), 'snapshot-delta still present');

// LOGIC replication — the fixed formula on the real audited personal holdings.
const holdings = [
  { ticker:'MSFT', shares:100, price:497.1, dayChgPx:-3.92 },
  { ticker:'MSFT', shares:100, price:497.1, dayChgPx:-3.92 },
  { ticker:'MSFT', shares:10,  price:497.1, dayChgPx:-3.92 },
];
let totalValue=0,dayChgSum=0,haveDay=false;
holdings.forEach(h=>{ totalValue+=h.price*h.shares; if(typeof h.dayChgPx==='number'){ dayChgSum+=h.dayChgPx*h.shares; haveDay=true; } });
const dayChg = haveDay ? dayChgSum : null;
const dayPct = (totalValue>0)? (dayChg/totalValue*100) : null;
A('day change = Σ dayChgPx×shares = −823.2 (was −158,100 via stale snapshot)', Math.abs(dayChg - (-823.2)) < 0.001, `dayChg=${dayChg}`);
A('day % is a sane −0.79% (not −151%)', Math.abs(dayPct - (-0.7885)) < 0.01, `dayPct=${dayPct}`);
A('|day change| never exceeds portfolio value', Math.abs(dayChg) < totalValue, `|dayChg|=${Math.abs(dayChg)} value=${totalValue}`);

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F-E1 personal day change)`);
process.exitCode = fail === 0 ? 0 : 1;
