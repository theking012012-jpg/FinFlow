'use strict';
/**
 * verify-kyc-registry.js — KYC Phase C portal mapping. Pure function, no server/PG. Asserts each
 * mapped professional body resolves to its OFFICIAL verified register, order-sensitivity (CPA Ontario
 * must not be swallowed by the generic CPA→CPAverify rule), and the web-search fallback for unmapped
 * bodies. URLs are the ones verified 2026-09-14.
 *
 *   node tests/harness/verify-kyc-registry.js
 */
const { registryLink } = require('../../public/kyc-registry.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const hit = (body, host, direct) => { const r = registryLink(body, '12345'); return r.url.includes(host) && r.direct === direct; };

console.log('\n' + '='.repeat(78));
console.log('  KYC PHASE C — professional-body → official register mapping');
console.log('='.repeat(78) + '\n');

A('ACCA → accaglobal directory (direct)',            hit('ACCA', 'accaglobal.com', true));
A('ICAEW → find.icaew.com (direct)',                 hit('ICAEW', 'find.icaew.com', true));
A('ICAS → icas.com (direct)',                        hit('ICAS', 'icas.com', true));
A('CIMA → aicpa-cima.com (direct)',                  hit('CIMA', 'aicpa-cima.com', true));
A('CGMA → aicpa-cima.com (direct)',                  hit('CGMA', 'aicpa-cima.com', true));
A('US CPA / AICPA → cpaverify.org (direct)',         hit('AICPA (US CPA)', 'cpaverify.org', true));
A('bare "CPA" → cpaverify.org (direct)',             hit('CPA', 'cpaverify.org', true));

// Order-sensitivity: provincial Canadian bodies must win over the generic CPA→CPAverify rule.
A('CPA Ontario → cpaontario.ca, NOT cpaverify',      hit('CPA Ontario', 'cpaontario.ca', true) && !registryLink('CPA Ontario', '1').url.includes('cpaverify'));
A('CPA Alberta → cpaalberta.ca, NOT cpaverify',      hit('CPA Alberta', 'cpaalberta.ca', true) && !registryLink('CPA Alberta', '1').url.includes('cpaverify'));

// Fallback: unmapped body → scoped Google search, direct=false, carries body + number.
const icatt = registryLink('ICATT (Trinidad & Tobago)', 'TT-889');
A('unmapped ICATT → google search fallback (direct=false)', icatt.url.includes('google.com/search') && icatt.direct === false);
A('fallback query carries the body + membership number', /ICATT/.test(decodeURIComponent(icatt.url)) && decodeURIComponent(icatt.url).includes('TT-889'));

// Robustness.
A('empty body → fallback, still a valid https URL', (r => r.url.startsWith('https://') && r.direct === false)(registryLink('', '')));
A('every result URL is https', ['ACCA', 'ICAEW', 'CPA', 'Nonsense Body', ''].every(b => registryLink(b, '1').url.startsWith('https://')));
A('mapped label mentions the number to look up', /look up 12345/.test(registryLink('ACCA', '12345').label));

console.log('\n' + '-'.repeat(78));
console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (KYC Phase C registry mapping)'));
console.log('-'.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
