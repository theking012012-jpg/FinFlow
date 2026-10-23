'use strict';
/**
 * verify-a0-landing-claims.js — A0 / FA-L (LANDING_CLAIMS_A0.md sections 1, 2 and 4, owner-approved 2026-10-23).
 * The public landing page carried invented social proof (testimonials from named people, a logo strip of invented
 * companies, "hundreds of businesses", four unsourced statistics), claims the app contradicts ("the only accounting
 * platform", "tax filing", "no CSV imports / no manual reconciliation", "logs it automatically", MRR churn / LTV:CAC,
 * "AI variance alerts") and an unsourced competitor table. A claim that is removed must not come back.
 *
 * The page is PARSED and its rendered text read (body + the meta descriptions search engines and social cards show) —
 * the text a visitor or a crawler gets, not the source file.
 * Sections 3 (pricing) and 5 (domain, legal name, support promises) wait for owner decisions and are NOT asserted here.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'landing.html'), 'utf8');
const d = new JSDOM(html).window.document;
d.querySelectorAll('script,style').forEach(n => n.remove());
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const body = norm(d.body.textContent);
const metas = [...d.querySelectorAll('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]')].map(m => m.getAttribute('content') || '');
const all = body + ' ' + metas.join(' ');
const sect = id => norm((d.getElementById(id) || {}).textContent);
const absent = (label, re, where = all) => { const m = where.match(re); A(label, !m, m ? 'still on the page: "' + where.slice(Math.max(0, m.index - 40), m.index + 60) + '"' : ''); };

console.log('\n' + '='.repeat(78) + '\n  A0 — the landing page makes no invented or contradicted claims\n' + '='.repeat(78) + '\n');

// §1 fabricated social proof
absent('1a no "Trusted by teams at" strip of invented companies', /Trusted by teams|TechCorp|Globex|Initech|NovaTech|Pinnacle Co|Summit Inc/);
absent('1b no testimonials from invented people', /Sarah Chen|Marcus Reid|Priya Nair|Real businesses|What they say/);
absent('1c no "join hundreds of businesses" before launch', /hundreds of businesses/i);
absent('1d no unsourced statistics (9.4 rating, 37% cheaper, 14 s scan, 750+ integrations)', /Overall rating vs competitors|Cheaper than QuickBooks|time to scan|750\+|App integrations available/);
// §2 claims the app contradicts — the body AND the meta descriptions
absent('2a nowhere (page or search/social descriptions) "the only accounting platform"', /the only accounting platform/i);
absent('2b no "tax filing" — FinFlow estimates tax, it does not file', /tax filing/i);
absent('2c no "No CSV imports" / "No manual reconciliation" / "flow into your P&L in real time"', /No CSV imports|No manual reconciliation|flow into your P&L in real time/i);
absent('2d receipt scanner: no "tax status" and no "logs it automatically" (the user adds it)', /tax status|logs it automatically/i);
absent('2e MRR: no churned / expansion revenue or LTV:CAC (not built)', /LTV:CAC|churned, and expansion|expansion revenue/i);
absent('2f features: no "7-year audit trail" (no written retention policy yet)', /7-year/i, sect('features'));
absent('2g budget: no "AI variance alerts" and no drift flagging (not built)', /AI variance alerts|flags when you're drifting/i);
A('2h the example AI conversation is labelled as an example', /Example conversation/.test(sect('ai')), sect('ai').slice(0, 120));
A('2i the hero dashboard is labelled as example data', /Example data/.test(sect('hero')), sect('hero').slice(0, 120));
A('2j the payroll line says only the owner\'s salary crosses to personal (the wall)', /salary/i.test(sect('features')) && /nothing else crosses/i.test(sect('features')), sect('features').slice(0, 200));
// §4 competitor table
absent('4a no competitor comparison table (QuickBooks / Xero / FreshBooks prices, ✗ marks, star "design quality")', /\$275\/mo|FreshBooks|Design quality|Why teams switch|vs Wave/);
const anchors = [...d.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1);
const dead = anchors.filter(h => !d.getElementById(h.slice(1)));
A('4b every in-page link lands on a section that exists (no dangling #compare)', dead.length === 0 && anchors.length > 0, 'dead: ' + JSON.stringify([...new Set(dead)]));
A('4c a "What\'s included" section lists FinFlow\'s own features instead', /What's included/i.test(body) && !!d.getElementById('included'), 'missing #included');

console.log('\n' + '-'.repeat(78));
console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (A0 landing claims)'));
console.log('-'.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
