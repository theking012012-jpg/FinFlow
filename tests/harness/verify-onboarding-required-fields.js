'use strict';
/**
 * verify-onboarding-required-fields.js — the onboarding wizard (Step 1) must require Industry and
 * Business address, consistent with the other required fields (business name, your name, email,
 * country). STATIC: asserts the labels carry the required marker AND obNext blocks advancing without
 * them, so the requirement can't silently regress.
 *   node tests/harness/verify-onboarding-required-fields.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');

A('Industry label marked required (*)', /for="ob-industry">Industry \*<\/label>/.test(html));
A('Business address label marked required (*)', /for="ob-address">Business address \*<\/label>/.test(html));
A('obNext blocks advancing without Industry', /Industry is required/.test(html) && /ob-industry'\)\?\.value/.test(html));
A('obNext blocks advancing without Business address', /Business address is required/.test(html) && /ob-address'\)\?\.value/.test(html));
// the checks live in the step-1 branch (currentStep===1) of obNext
const ob = html.slice(html.indexOf('window.obNext = function'), html.indexOf('window.obNext = function') + 1400);
A('required checks are inside obNext step 1', /Industry is required/.test(ob) && /Business address is required/.test(ob));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (onboarding required fields)`);
console.log('');
process.exitCode = fail === 0 ? 0 : 1;
