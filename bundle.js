// bundle.js — concatenates the 10 wiring scripts into public/finflow-bundle.js
//
//   node bundle.js           regenerate public/finflow-bundle.js from source
//   node bundle.js --check    write nothing; exit 1 if the committed bundle is
//                             out of sync with its sources, 0 if in sync (drift guard)
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

const OUT = path.join('public', 'finflow-bundle.js');

// Build the bundle string from the source wiring files (single source of truth
// for both the write path and the --check path, so they can never disagree).
function build() {
  const parts = files.map(f => {
    const body = fs.readFileSync(path.join('public', f), 'utf8');
    return `/* ── ${f} ── */\n${body}\n`;
  });
  // `;` separator guards against a previous file ending without one.
  return parts.join('\n;\n');
}

// Compare content only — normalize line endings so a CRLF/LF checkout difference
// is never mistaken for real drift.
const norm = s => s.replace(/\r\n/g, '\n');

const bundle = build();

if (process.argv.includes('--check')) {
  let current = '';
  try { current = fs.readFileSync(OUT, 'utf8'); }
  catch { console.error(`[bundle:check] ${OUT} is missing — run: node bundle.js`); process.exit(1); }
  if (norm(current) !== norm(bundle)) {
    console.error(`[bundle:check] DRIFT — ${OUT} is out of sync with its ${files.length} wiring sources.`);
    console.error('[bundle:check] A wiring source was edited without regenerating the bundle. Run: node bundle.js');
    process.exit(1);
  }
  console.log(`[bundle:check] OK — ${OUT} is in sync with its ${files.length} sources.`);
  process.exit(0);
}

fs.writeFileSync(OUT, bundle);
console.log('Bundle created:', OUT, '—', bundle.length, 'chars from', files.length, 'files');
