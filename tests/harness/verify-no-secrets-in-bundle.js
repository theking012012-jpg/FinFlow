'use strict';
/**
 * verify-no-secrets-in-bundle.js — SECURITY. No live secret may ship in a client-served file. The
 * server bundles + static HTML/JS are delivered to every browser, so a leaked Stripe/Resend/Anthropic
 * secret key, webhook signing secret, AWS key, private key, or a DATABASE_URL with credentials would be
 * world-readable. This closes the coverage-audit gap where "no leaked secrets" was asserted on the
 * Launch Board with no test behind it.
 *
 * STATIC scan (no Postgres). Fails if any client-served file matches a real secret shape. Publishable
 * keys (pk_live_/pk_test_) are allowed — they are designed to be public.
 *
 *   node tests/harness/verify-no-secrets-in-bundle.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

// Client-served surfaces (everything under public/ reaches the browser).
const PUB = path.join(process.cwd(), 'public');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.(js|html|mjs|css)$/.test(e.name)) files.push(p);
  }
})(PUB);

const SECRETS = [
  ['Stripe secret key',        /\bsk_live_[0-9a-zA-Z]{10,}/],
  ['Stripe test secret key',   /\bsk_test_[0-9a-zA-Z]{10,}/],
  ['Stripe restricted key',    /\brk_live_[0-9a-zA-Z]{10,}/],
  ['Stripe webhook secret',    /\bwhsec_[0-9a-zA-Z]{10,}/],
  ['Anthropic API key',        /\bsk-ant-[0-9a-zA-Z._-]{20,}/],
  ['Resend API key',           /\bre_[0-9a-zA-Z]{20,}/],
  ['AWS access key id',        /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key block',        /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
  ['DB URL with credentials',  /\bpostgres(?:ql)?:\/\/[^:@/\s]+:[^@/\s]+@/],
  ['Google API key',           /\bAIza[0-9A-Za-z._-]{30,}/],
];

const hits = [];
for (const f of files) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const rel = path.relative(process.cwd(), f);
  for (const [name, re] of SECRETS) {
    const m = src.match(re);
    if (m) hits.push(`${rel}: ${name} → ${String(m[0]).slice(0, 24)}…`);
  }
}

A(`no live secret in any of ${files.length} client-served files`, hits.length === 0, hits.join('\n          '));
A('scan actually covered the shipped bundle + app-main', files.some(f => /finflow-bundle\.js$/.test(f)) && files.some(f => /app-main\.js$/.test(f)));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (no secrets in client bundle)`);
console.log('');
process.exitCode = fail === 0 ? 0 : 1;
