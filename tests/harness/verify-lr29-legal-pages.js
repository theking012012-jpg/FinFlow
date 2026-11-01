#!/usr/bin/env node
'use strict';
/**
 * verify-lr29-legal-pages — LR29 (owner decisions 2026-11-01): Terms, Privacy and Security rewritten with NO company name,
 * NO business address and NO contact email (the company is not registered yet); governed by WYOMING law and courts, with
 * every consumer's mandatory home-country rights kept; contact through the public form; privacy rights for every region
 * FinFlow serves; retention periods that match what the code does; every outside service the code talks to is named.
 *
 *   node tests/harness/verify-lr29-legal-pages.js
 *
 * STRUCTURAL / TEXT assertions (Rule 5, labelled): a legal page's content is text, so the rendered text is what is
 * checked — body text parsed with JSDOM, scripts removed. Two checks tie the text to the code instead of to itself:
 *   [code] every provider the server depends on or calls (package.json + server.js fetch targets) is named in the policy;
 *   [code] the retention numbers stated (30 days visitor IP, 90 days audit IP after deletion) are the server's constants.
 * The behaviour behind those numbers is EXECUTED in verify-visitor-ip-retention and verify-lc3db-strip-deleted-devices.
 * Bug values (old pages): mailto hello@finflow.io / security@finflow.io on all three; no governing law; no regional rights
 * beyond the UK/EU; Google Fonts and the market-data services unnamed; "audit trail kept … with IP address and device".
 */
const fs = require('fs'); const path = require('path'); const { JSDOM } = require('jsdom');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const page = f => { const d = new JSDOM(read('public/' + f)).window.document; d.querySelectorAll('script,style').forEach(n => n.remove());
  return { d, t: d.body.textContent.replace(/\s+/g, ' '), html: d.body.innerHTML }; };
const P = { terms: page('terms.html'), privacy: page('privacy.html'), security: page('security.html') };
console.log('\n  LR29 — legal pages\n');
for (const [k, p] of Object.entries(P)) {
  A(`[text] ${k}: no email address, no mailto`, !/mailto:|[\w.+-]+@[\w-]+\.[\w.]+/.test(p.html), (p.html.match(/.{30}(mailto:|@[\w-]+\.).{30}/) || [''])[0]);
  A(`[text] ${k}: no company name (Inc., LLC, Ltd, Corp)`, !/\b(Inc\.|LLC|L\.L\.C\.|Ltd\b|Limited\b|Corp\b|Corporation)/.test(p.t), (p.t.match(/.{30}(Inc\.|LLC|Ltd|Limited|Corp).{20}/) || [''])[0]);
  A(`[text] ${k}: no street address`, !/\b\d{1,5}\s+\w+\s+(Street|St\.|Avenue|Ave\.|Road|Rd\.|Suite|Blvd)\b/i.test(p.t));
  A(`[text] ${k}: contact goes to the contact form`, !!p.d.querySelector('a[href^="/contact.html"]'));
  A(`[text] ${k}: dated November 2026`, /Last updated: November 2026/.test(p.t));
}
const T = P.terms.t;
A('[text] terms: governed by the laws of the State of Wyoming', /governed by the laws of the State of Wyoming/.test(T));
A('[text] terms: disputes in the state or federal courts located in Wyoming', /state or federal courts located in Wyoming/.test(T));
A('[text] terms: consumers keep their home-country mandatory protections and courts', /does not take away the protection of the mandatory laws of the country where you live/.test(T) && /courts of that country/.test(T));
A('[text] terms: income-tax estimates only — no filing, no VAT/GST/sales tax', /income-tax estimates only/.test(T) && /does not file tax returns/.test(T) && /VAT, GST or sales tax/.test(T));
A('[text] terms: US sanctions clause', /comprehensive United States sanctions/.test(T));
A('[text] terms: several accountants, personal view only if turned on', /one or more accountants/.test(T) && /view\b.*personal finances \(off unless you turn it on\)/.test(T));
const V = P.privacy.t;
for (const law of ['EU and UK GDPR', "Brazil's LGPD", "Canada's PIPEDA", 'California Consumer Privacy Act', 'Trinidad and Tobago', 'Jamaica', 'Barbados', 'Mexico', 'Colombia'])
  A(`[text] privacy: names ${law}`, V.includes(law));
A('[text] privacy: the same rights for everyone, answered within 30 days, appeal', /give the same rights to everyone/.test(V) && /answer within 30 days/.test(V) && /how to appeal/.test(V));
A('[text] privacy: processor commitments for the records users keep', /use it only to provide the Service to you, on your instructions/.test(V) && /tell you without undue delay if a breach/.test(V));
A('[text] privacy: no selling, no cross-context ads, no AI training', /do not sell your personal information/.test(V) && /cross-context behavioural advertising/.test(V) && /Neither we nor Anthropic use your data to train/.test(V));
A('[text] privacy: product news has a one-click unsubscribe', /one-click unsubscribe link/.test(V));

// [code] every provider the code uses is named
const pkg = JSON.parse(read('package.json')); const deps = Object.keys(pkg.dependencies || {});
const srv = read('server.js');
const PROVIDERS = [
  ['Stripe', deps.includes('stripe')], ['Resend', deps.includes('resend')], ['Sentry', deps.includes('@sentry/node')],
  ['Anthropic', /fetch\('https:\/\/api\.anthropic\.com/.test(srv)], ['Plaid', /plaid/i.test(srv)], ['Belvo', /belvo/i.test(srv)],
  ['Finnhub', /finnhub\.io/.test(srv)], ['CoinGecko', /api\.coingecko\.com/.test(srv)], ['ExchangeRate-API', /open\.er-api\.com/.test(srv)],
  ['Google Fonts', fs.readdirSync(path.join(ROOT, 'public')).some(f => f.endsWith('.html') && /fonts\.googleapis\.com/.test(read('public/' + f)))],
  ['Railway', /railway\.app/.test(read('app-url.js'))], ['Supabase', true],
];
for (const [name, used] of PROVIDERS) if (used) A(`[code] privacy names ${name} (the code uses it)`, V.includes(name));
// [code] the stated retention numbers are the server's own constants
const vip = +(srv.match(/const VISITOR_IP_DAYS = (\d+)/) || [])[1], aip = +(srv.match(/const PII_RETENTION_DAYS = (\d+)/) || [])[1];
A(`[code] visitor IPs: page says ${vip} days, server constant VISITOR_IP_DAYS = ${vip}`, vip === 30 && new RegExp('IP addresses are removed after <strong>' + vip + ' days').test(P.privacy.html));
A(`[code] audit IP/device after deletion: page says ${aip} days, server constant PII_RETENTION_DAYS = ${aip}`, aip === 90 && new RegExp('<strong>' + aip + ' days</strong> after deletion, the IP addresses').test(P.privacy.html));
A('[text] security: named admin accounts with required 2FA', /own named account, their own password and required two-factor/.test(P.security.t));
A('[text] security: vulnerability reports via the form, good-faith safe harbour', /Security report/.test(P.security.t) && /not take legal action against research done in good faith/.test(P.security.t));
const c = new JSDOM(read('public/contact.html')).window.document;
A('the privacy and security links\' topics exist on the contact form', ['privacy', 'security'].every(v => !!c.querySelector(`#cf-topic option[value="${v}"]`)));
console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (LR29 legal pages)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
process.exit(fail === 0 ? 0 : 1);
