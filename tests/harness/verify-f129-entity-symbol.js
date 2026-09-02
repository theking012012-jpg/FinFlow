'use strict';
/**
 * verify-f129-entity-symbol.js — F129. Entity-currency business surfaces must render the ENTITY's
 * currency symbol, not a literal '$'. Three stragglers fixed: budget variance (index.html renderBudget),
 * Chart-of-Accounts totals (app-main renderCOALive), and Journals debit/credit KPIs (renderJournalsLive).
 *
 * Executes the REAL renderBudget in jsdom with a non-USD entity (_nativeSymbol='€') and asserts the
 * variance uses '€', matching the actual/budget in its own row. COA + journals are checked structurally.
 * Honest-USD investment surfaces are deliberately LEFT '$' (unconverted USD prices — that's F126/F124,
 * not F129); a reverse-check guards against over-reaching into them.
 *
 * Discriminating (Rule 14): pre-fix the variance renders '-$200' → A1 red.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f129-entity-symbol.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);

try {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  const appMain = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8');

  // ── execute the real renderBudget against a non-USD entity ──
  const start = html.indexOf('function renderBudget()');
  const end = html.indexOf('requestAnimationFrame(renderBudget);');
  A('extracted renderBudget from index.html', start >= 0 && end > start, `start=${start} end=${end}`);
  const src = html.slice(start, end);

  const dom = new JSDOM('<!doctype html><body><div id="budget-rows"></div><div id="budget-ai-text"></div></body>');
  const win = dom.window;
  win.BUDGET_DATA = [
    { cat: 'Rent', budget: 1000, actual: 1200, color: '#c00' }, // over  → variance -200
    { cat: 'Ads',  budget: 500,  actual: 300,  color: '#0c0' }, // under → variance +200
  ];
  win._nativeSymbol = () => '€'; // €
  win._fmtMoney = (n, sym) => sym + Math.round(n).toLocaleString('en-US');
  new win.Function('window', 'document', src + '\n; window.__renderBudget = renderBudget;')(win, win.document);
  win.__renderBudget();
  const out = win.document.getElementById('budget-rows').innerHTML;

  A('A1: budget variance renders the entity symbol € (not literal $)', out.includes('€200') && !/[-+]\$200/.test(out), `rendered contains: ${(out.match(/[-+][^<]*200/g) || []).join(' , ')}`);
  A('A2: actual/budget in the same row also use € (consistency held)', out.includes('€1,200') && out.includes('€1,000'), 'row totals not in € as expected');

  // ── structural: COA + journals now use the entity symbol ──
  AS('COA totals use _nativeSymbol() (not literal $)', /const S = n=>_nativeSymbol\(\)\+Math\.abs\(n\)/.test(appMain));
  AS('Journals KPIs use _nativeSymbol() (not literal $)', /const S = n=>_nativeSymbol\(\)\+n\.toLocaleString/.test(appMain));
  AS('no local business formatter still hardcodes "=>\'$\'+"', !/=>\s*'\$'\s*\+/.test(appMain));

  // ── reverse-check: honest-USD investment surfaces deliberately KEPT '$' (not over-reached) ──
  AS('business-investment S2b intentionally still uses $ (USD prices, unconverted — F126 not F129)', /const S2b = n => \(window\._fmtMoney \? window\._fmtMoney\(n, '\$'\)/.test(html));

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F129 entity currency symbol)`);
  console.log('');
} catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
process.exitCode = fail === 0 ? 0 : 1;
