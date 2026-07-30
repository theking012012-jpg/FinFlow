// bundle.js — concatenates the 10 wiring scripts into public/finflow-bundle.js
//
//   node bundle.js              regenerate public/finflow-bundle.js from the
//                               WORKING TREE (manual dev use)
//   node bundle.js --check      write nothing; exit 1 if the committed bundle is
//                               out of sync with its sources, 0 if in sync (drift guard)
//   node bundle.js --from-index build the bundle from the STAGED (index) copy of
//                               each source and, if it differs from the staged
//                               bundle, write the result into the INDEX ONLY —
//                               leaving the working tree untouched. The pre-commit
//                               hook uses this so the committed bundle can only ever
//                               contain committed source, never a dirty or
//                               partially-staged working tree (H1).
//
// Order matches the original <script> load order in public/index.html so the
// bundled behavior is identical to the un-bundled load.
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

const OUT     = path.join('public', 'finflow-bundle.js');
const OUT_REL = 'public/finflow-bundle.js';   // git pathspec form (forward slashes)

// Run git, returning stdout as a string. `input`, when given, is fed to stdin.
function git(args, input) {
  return execFileSync('git', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

// Read a wiring source from the WORKING TREE.
const readFromWorkingTree = f => fs.readFileSync(path.join('public', f), 'utf8');

// Read a wiring source from the git INDEX (the STAGED bytes). For an unstaged,
// unchanged file `git show :path` returns the HEAD version — which is correct:
// it is exactly what a commit right now would contain.
const readFromIndex = f => git(['show', `:public/${f}`]);

// Build the bundle string from the source wiring files (single source of truth
// for every mode — the write path, --check and --from-index — so they can never
// disagree). `readFile` selects the working tree vs the index.
function build(readFile = readFromWorkingTree) {
  const parts = files.map(f => {
    const body = readFile(f);
    return `/* ── ${f} ── */\n${body}\n`;
  });
  // `;` separator guards against a previous file ending without one.
  return parts.join('\n;\n');
}

// Compare content only — normalize line endings so a CRLF/LF checkout difference
// is never mistaken for real drift.
const norm = s => s.replace(/\r\n/g, '\n');

// ── --from-index : build from the index, write to the index only ─────────────
// The default mode reads the WORKING TREE, and the pre-commit hook used to
// `git add` that result — so a dirty or partially-staged wiring source produced a
// committed bundle containing code that was in NO committed source. index.html
// loads only the bundle (never the ten wiring sources), so that unreviewed code
// is what deployed. This mode reads each source from the index instead, and
// writes the rebuilt bundle straight into the index via hash-object +
// update-index — never through the working tree — so the committed bundle always
// matches the committed sources. (H1)
function fromIndex() {
  const built = build(readFromIndex);

  let staged = null;
  try { staged = git(['show', `:${OUT_REL}`]); }
  catch { staged = null; }   // bundle not in the index yet (e.g. first add)

  if (staged !== null && norm(staged) === norm(built)) {
    console.log('[bundle:from-index] OK — staged bundle already matches the staged sources.');
    return;
  }

  // Write the built content as a blob. `--path` applies the same clean/eol
  // filters `git add` would, so the blob is identical to a normal add; `-w`
  // stores it in the object database and prints its SHA. Then point the index
  // entry at that blob. The working tree copy is left untouched.
  const sha = git(['hash-object', '-w', '--path', OUT_REL, '--stdin'], built).trim();
  git(['update-index', '--add', '--cacheinfo', `100644,${sha},${OUT_REL}`]);
  console.log('[bundle:from-index] Rebuilt bundle from the staged sources and wrote it to the index (working tree untouched — `git status` will show it modified; run `node bundle.js` to sync your working copy).');
}

if (process.argv.includes('--from-index')) {
  fromIndex();
  process.exit(0);
}

// Default and --check both operate on the WORKING TREE (manual dev use).
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
