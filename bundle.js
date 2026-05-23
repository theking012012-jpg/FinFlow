// bundle.js — concatenates the 10 wiring scripts into public/finflow-bundle.js
// Run with: node bundle.js
//
// Order matches the original <script> load order in public/index.html so the
// bundled behavior is identical to the un-bundled load.
const fs   = require('fs');
const path = require('path');

const files = [
  'finflow-api.js',
  'finflow-api-wiring.js',
  'finflow-api-wiring-medium.js',
  'finflow-api-wiring-final.js',
  'finflow-api-wiring-stubs.js',
  'finflow-api-wiring-final5.js',
  'finflow-api-wiring-pages.js',
  'finflow-api-wiring-extra.js',
  'finflow-api-wiring-dashboard.js',
  'finflow-api-wiring-postgres.js',
];

const parts = files.map(f => {
  const p = path.join('public', f);
  const body = fs.readFileSync(p, 'utf8');
  return `/* ── ${f} ── */\n${body}\n`;
});

// `;` separator guards against a previous file ending without one.
const bundle = parts.join('\n;\n');
const out = path.join('public', 'finflow-bundle.js');
fs.writeFileSync(out, bundle);
console.log('Bundle created:', out, '—', bundle.length, 'chars from', files.length, 'files');
