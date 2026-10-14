'use strict';
/**
 * verify-la1-counter-race.js — LA1 (live audit 2026-10-13 B1): dashboard cards randomly showed "$0".
 *
 * Executes the REAL public/finflow-counter.js in jsdom (requestAnimationFrame via pretendToBeVisual).
 * No database: this is the animation alone, driven exactly as the app drives it (animateCounters over a
 * page's .mc-val cards; a canonical writer then sets textContent).
 *
 * THE BUG (old app-main.js animateCounter): the animation snapshotted the card's text when it started and
 * wrote that value on every frame, plus a final write of the snapshot. A writer that painted the real
 * value DURING the animation was overwritten. Each case states what the buggy code produces.
 *
 *   FINFLOW_COUNTER_SRC=<file>  run the same cases against another implementation (to show RED on the old one).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = process.env.FINFLOW_COUNTER_SRC || path.join(__dirname, '..', '..', 'public', 'finflow-counter.js');
let pass = 0, fail = 0;
const eq = (n, measured, expected, bug) => {
  const ok = JSON.stringify(measured) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(measured)}, correct ${JSON.stringify(expected)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`);
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function page(cards) {
  const dom = new JSDOM(`<!doctype html><div id="page-dashboard" class="page active">${
    cards.map(([id, t]) => `<div class="mc"><div class="mc-val" id="${id}">${t}</div></div>`).join('')}</div>`,
    { pretendToBeVisual: true, runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(SRC, 'utf8'));
  return dom.window;
}

(async () => {
  console.log('\nL1 — stat-card counter never overwrites a value written after it started\n  implementation: ' + path.relative(process.cwd(), SRC) + '\n');
  try {
    // 1. The live symptom: the card still reads "$0" (painted from empty stores) when the animation starts;
    //    the real Investments figure lands 50 ms later. Old code: the last frame writes the "$0" snapshot back.
    {
      const w = page([['d-invest', '$0']]);
      w.animateCounters(w.document.getElementById('page-dashboard'));
      await wait(50);
      w.document.getElementById('d-invest').textContent = '$2,700';
      await wait(1000);
      eq('$0 snapshot, real value lands mid-animation → card keeps the real value', w.document.getElementById('d-invest').textContent, '$2,700', '$0');
      w.close();
    }
    // 2. Same race with a non-zero snapshot (a stale figure from before a data refresh).
    {
      const w = page([['d-outstanding', '$1,200']]);
      w.animateCounters(w.document.getElementById('page-dashboard'));
      await wait(120);
      w.document.getElementById('d-outstanding').textContent = '$2,400';
      await wait(1000);
      eq('stale $1,200 snapshot, $2,400 lands mid-animation → card keeps $2,400', w.document.getElementById('d-outstanding').textContent, '$2,400', '$1,200');
      w.close();
    }
    // 3. Several cards at once, as on the dashboard: only the ones written during the window are at risk.
    {
      const w = page([['d-rev', '$0'], ['d-exp', '$0'], ['d-outstanding', '$2,400']]);
      w.animateCounters(w.document.getElementById('page-dashboard'));
      await wait(30);
      w.document.getElementById('d-rev').textContent = '$15.4K';
      w.document.getElementById('d-exp').textContent = '$888';
      await wait(1000);
      eq('three cards: Revenue written mid-animation', w.document.getElementById('d-rev').textContent, '$15.4K', '$0');
      eq('three cards: Expenses written mid-animation', w.document.getElementById('d-exp').textContent, '$888', '$0');
      eq('three cards: Outstanding not rewritten → animation still ends on its own value', w.document.getElementById('d-outstanding').textContent, '$2,400');
      w.close();
    }
    // 4. The animation is still an animation (decoration kept): with no other writer it passes through
    //    intermediate values and ends exactly on the card's value.
    {
      const w = page([['d-outstanding', '$2,400']]);
      const seen = new Set();
      const el = w.document.getElementById('d-outstanding');
      w.animateCounters(w.document.getElementById('page-dashboard'));
      for (let t = 0; t < 20; t++) { await wait(40); seen.add(el.textContent); }
      eq('no other writer → ends on $2,400', el.textContent, '$2,400');
      eq('no other writer → showed intermediate values while counting up', [...seen].some(s => s !== '$2,400'), true);
      w.close();
    }
    // 5. Percent / hours cards behave the same way.
    {
      const w = page([['pct', '0%'], ['hrs', '9.5h']]);
      w.animateCounters(w.document.getElementById('page-dashboard'));
      await wait(40);
      w.document.getElementById('pct').textContent = '81%';
      await wait(900);
      eq('0% snapshot, 81% written mid-animation → keeps 81%', w.document.getElementById('pct').textContent, '81%', '0%');
      eq('9.5h with no other writer → ends on 9.5h', w.document.getElementById('hrs').textContent, '9.5h');
      w.close();
    }
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
