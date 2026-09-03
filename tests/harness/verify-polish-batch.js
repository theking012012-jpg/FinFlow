'use strict';
/**
 * verify-polish-batch.js — audit polish fixes:
 *   F-B1 recurring Next Run/Next Due subtitle no longer "No profiles yet"
 *   F-B2 payment-method enums humanized (window._humanPayMethod)
 *   F-J2 scenario runway shows N/A when cash untracked (not "0 mo")
 *   F-L2 stale "755+" dropped from the connections search placeholder
 *
 *   node tests/harness/verify-polish-batch.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
const wp = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-api-wiring-pages.js'), 'utf8');
const bundle = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-bundle.js'), 'utf8');

// F-B1
A('[F-B1] "No profiles yet" removed from Next Run/Next Due cards', !/Next Run<\/div><div class="mc-val">—<\/div><div class="mc-change neutral">No profiles yet/.test(html) && !/Next Due<\/div><div class="mc-val">—<\/div><div class="mc-change neutral">No profiles yet/.test(html));
A('[F-B1] cards now read "Next occurrence"', /Next Run<\/div><div class="mc-val">—<\/div><div class="mc-change neutral">Next occurrence/.test(html));

// F-B2
A('[F-B2] _humanPayMethod helper defined', /window\._humanPayMethod = function/.test(wp));
A('[F-B2] method renders use the humanizer (not raw r.method)', /esc\(window\._humanPayMethod\(r\.method\)\)/.test(wp) && !/color:var\(--t2\)">\$\{esc\(r\.method \|\| ''\)\}/.test(wp));
A('[F-B2] bundle carries the humanizer', /window\._humanPayMethod = function/.test(bundle));
// unit: humanize behavior
const human = m => { const s=String(m||'').trim(); if(!s) return ''; if(/[A-Z(]/.test(s)) return s; return s.charAt(0).toUpperCase()+s.slice(1).replace(/_/g,' '); };
A('[F-B2] "bank_transfer" → "Bank transfer"', human('bank_transfer')==='Bank transfer');
A('[F-B2] "other" → "Other"', human('other')==='Other');
A('[F-B2] "Card (Stripe)" left untouched', human('Card (Stripe)')==='Card (Stripe)');

// F-J2
A('[F-J2] scenario runway shows N/A when cash untracked', /runway===-1 \? 'N\/A'/.test(html) && /!\(BASE\.cash > 0\)/.test(html));

// F-L2
A('[F-L2] stale "755+" dropped from connections search placeholder', !/Search 755\+ integrations/.test(html) && /placeholder="Search integrations…"/.test(html));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (polish batch)`);
process.exitCode = fail === 0 ? 0 : 1;
