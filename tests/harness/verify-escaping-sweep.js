'use strict';
/**
 * verify-escaping-sweep.js — H2. Codifies the app's HTML-escaping discipline so an unescaped user-data
 * sink can never silently ship again. Escaping (esc/escHTML/e) is the app's primary XSS defense while
 * the CSP still permits 'unsafe-inline' (the inline-handler removal is a separate, larger migration).
 *
 * STATIC scan (no Postgres). For every render source it flags any `${...}` that (a) interpolates a
 * free-text USER-DATA field, (b) sits on an HTML-building line (a tag or innerHTML), (c) is NOT wrapped
 * in an escaper, and (d) is not a known-safe sink (notify/confirmModal/textContent/.value/placeholder).
 * Cross-tenant surfaces (accountant portal rendering client-supplied names) are the high-severity case.
 *
 *   node tests/harness/verify-escaping-sweep.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

const FILES = [
  'public/app-main.js',
  'public/finflow-api-wiring-extra.js',
  'public/finflow-api-wiring-medium.js',
  'public/finflow-api-wiring-pages.js',
  'public/finflow-api-wiring-dashboard.js',
  'public/finflow-api-wiring-postgres.js',
  'public/accountant-dashboard.html',
  'public/accountant-client.html',
];

// Free-text, user-controlled fields that must be escaped before hitting innerHTML.
const RISKY = /(client_name|client_email|business_name|\bclient\b|\bcustomer\b|\bvendor\b|\bemployee\b|item\.name|\.project\b|\.notes\b|\.description\b|\.company\b)/;
// Lines whose interpolation goes to a safe sink (text, not HTML) — excluded from the scan.
const SAFE_CTX = /(notify\(|confirmModal\(|textContent|\.value\s*=|placeholder|console\.|new Error\(|throw )/;
const ESCAPED = /\b(esc|escHTML|escH|_e|e)\s*\(/;

// Pull each ${...} (non-greedy, no nested braces) from a line.
function interps(line) {
  const out = []; const re = /\$\{([^{}]*)\}/g; let m;
  while ((m = re.exec(line)) !== null) out.push(m[1]);
  return out;
}

const offenders = [];
for (const rel of FILES) {
  const p = path.join(process.cwd(), rel);
  let src;
  try { src = fs.readFileSync(p, 'utf8'); } catch { A('read ' + rel, false, 'missing'); continue; }
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!line.includes('${')) return;
    const isHtmlSink = /innerHTML|<[a-zA-Z/]/.test(line);          // a tag or an innerHTML write on this line
    if (!isHtmlSink) return;
    if (SAFE_CTX.test(line)) return;                                // text sink, not HTML
    for (const expr of interps(line)) {
      if (!RISKY.test(expr)) continue;
      if (ESCAPED.test(expr)) continue;                            // wrapped in an escaper — safe
      offenders.push(`${rel}:${i + 1}  \${${expr.trim()}}`);
    }
  });
}

A('no unescaped user-data field in any HTML sink across render sources',
  offenders.length === 0,
  offenders.length ? offenders.join('\n          ') : '');

// Explicit regression guards for the two sinks fixed in this pass.
const am = fs.readFileSync(path.join(process.cwd(), 'public', 'app-main.js'), 'utf8');
A('[GUARD] renderTimesheet escapes employee/project', /\$\{esc\(t\.employee\)\}/.test(am) && /\$\{esc\(t\.project\)\}/.test(am));
const ad = fs.readFileSync(path.join(process.cwd(), 'public', 'accountant-dashboard.html'), 'utf8');
A('[GUARD] accountant bill-client dropdown escapes client name/email', /\$\{esc\(c\.client_name/.test(ad));

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (H2 escaping sweep)`);
console.log('');
process.exitCode = fail === 0 ? 0 : 1;
