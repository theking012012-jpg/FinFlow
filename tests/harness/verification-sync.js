'use strict';
/**
 * verification-sync.js — keeps VERIFICATION.md and expected.js from diverging, and writes
 * measured results into the document as part of a run.
 *
 *   node tests/harness/verification-sync.js --check    (pre-commit; exits non-zero on drift)
 *   node tests/harness/verification-sync.js --report   (show current Result column state)
 *
 * TWO JOBS, BOTH REPLACING A HABIT WITH A CHECK
 *
 * 1. RECONCILE. The expected values in VERIFICATION.md's Part A tables must equal
 *    expected.js. They were hand-maintained in parallel and drifted within one commit.
 *
 *    Chosen approach: CHECK, not generate. Generation was considered and rejected — the Part A
 *    tables are interleaved with hand-authored prose, judgment notes (A7.23's "how to judge
 *    it") and per-row caveats, and a generator owning those regions would either clobber the
 *    prose or need markers threaded through the document's most-edited section. The check gives
 *    the same guarantee (divergence cannot survive a commit) at a fraction of the blast radius.
 *    It mirrors the existing F13 bundle hook: `bundle.js --check` verifies rather than rewrites.
 *
 * 2. WRITE RESULTS. A gate writes its measured outcome into the Result column as part of the
 *    run. Results that live in chat while the document shows an empty column is F55's exact
 *    mechanism — and it already happened once this session with A5.10-15.
 *
 * This file only ever edits the Result column and only ever READS the expected columns. It
 * cannot silently "fix" a mismatch by rewriting the expectation — that would defeat the point.
 */

const fs = require('fs');
const path = require('path');
const EXPECTED = require('./expected.js');

const DOC = path.join(__dirname, '..', '..', 'VERIFICATION.md');

/** Parse "−1,150" / "5,000" / "0" → number. Handles the Unicode minus the document uses. */
function parseMoney(cell) {
  if (cell == null) return null;
  const t = String(cell).replace(/\*\*/g, '').replace(/,/g, '').replace(/[−–—]/g, '-').trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return parseFloat(t);
}

/** Rows of the A5 table, which is the densest expected-value block: `| A5.1–3 | revenue | … |`. */
function readA5Table(md) {
  const out = {};
  const re = /^\|\s*(A5\.\d+[–-]\d+)\s*\|\s*([A-Za-z]+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm;
  let m;
  while ((m = re.exec(md))) {
    out[m[2].trim()] = { id: m[1].trim(), jun: parseMoney(m[3]), jul: parseMoney(m[4]), fy: parseMoney(m[5]) };
  }
  return out;
}

/**
 * Compare the document's stated expectations against expected.js.
 * Returns a list of human-readable drift descriptions (empty = in sync).
 */
function reconcile(md) {
  const drift = [];
  const a5 = readA5Table(md);

  const FIELD_MAP = {
    revenue: 'revenue', cogs: 'cogs', grossProfit: 'grossProfit',
    opex: 'opex', netProfit: 'netProfit', outstanding: 'outstanding',
  };

  for (const [docField, expField] of Object.entries(FIELD_MAP)) {
    const row = a5[docField];
    if (!row) { drift.push(`A5 table: no row found for "${docField}"`); continue; }
    for (const period of ['jun', 'jul', 'fy']) {
      const want = EXPECTED.serverFigures(period)[expField];
      const got = row[period];
      if (got === null) { drift.push(`${row.id} ${docField} (${period}): unparseable cell`); continue; }
      if (Math.abs(got - want) > 0.005) {
        drift.push(`${row.id} ${docField} (${period}): VERIFICATION.md says ${got}, expected.js says ${want}`);
      }
    }
  }
  return drift;
}

/** Checks whose Result cell is still empty, so "never run" is visible rather than assumed. */
function emptyResults(md) {
  const empty = [];
  const re = /^\|\s*(A\d+[a-z]?\.[\d–\-]+)\s*\|(.*)\|\s*\|\s*$/gm;
  let m;
  while ((m = re.exec(md))) {
    // The final cell is empty only if there is no content between the last two pipes.
    const cells = m[0].split('|');
    const last = cells[cells.length - 2];
    if (last !== undefined && last.trim() === '') empty.push(m[1].trim());
  }
  return empty;
}

/**
 * Result cells stamped with a seed fingerprint that no longer matches the current one.
 * A stale-fingerprint cell is worse than an empty one: it reads as authoritative while
 * describing a dataset that has since changed. Returns [{id, stamped, current}].
 */
function staleResults(md, currentFp) {
  const stale = [];
  // Match the check id, then the fingerprint anywhere later in the row. NOT anchored to the
  // trailing pipe: the stamp reads "… seed c882b311) |" and requiring `seed <hex>\s*|` misses
  // the closing paren and never fires — a stale-detector that is silently blind, caught only
  // because its negative test failed to detect an injected seed change.
  const re = /^\|\s*(A\d+[a-z]?\.[\d–\-]+)\b.*\bseed ([0-9a-f]{6,})\b/gm;
  let m;
  while ((m = re.exec(md))) {
    if (m[2] !== currentFp) stale.push({ id: m[1].trim(), stamped: m[2], current: currentFp });
  }
  return stale;
}

/**
 * Write measured results into the Result column.
 * @param {Object} results  { 'A5.10–12': 'FAIL — actual 5,650 / 4,650 / 11,500', … }
 */
function writeResults(results, opts = {}) {
  const file = opts.file || DOC;
  let md = fs.readFileSync(file, 'utf8');
  const written = [];

  for (const [id, verdict] of Object.entries(results)) {
    // Match the row by its check id and replace ONLY the final cell.
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[–-]/g, '[–-]');
    const re = new RegExp(`^(\\|\\s*${esc}\\s*\\|.*\\|)([^|]*)\\|\\s*$`, 'm');
    if (!re.test(md)) continue;
    md = md.replace(re, (_full, head) => `${head} ${verdict} |`);
    written.push(id);
  }

  fs.writeFileSync(file, md);
  return written;
}

function main() {
  const md = fs.readFileSync(DOC, 'utf8');
  const args = process.argv.slice(2);

  const currentFp = EXPECTED.seedFingerprint();

  if (args.includes('--report')) {
    const empty = emptyResults(md);
    const stale = staleResults(md, currentFp);
    console.log(`[verification-sync] seed fingerprint: ${currentFp}`);
    console.log(`[verification-sync] ${empty.length} check(s) have an empty Result cell.`);
    if (empty.length) console.log('  ' + empty.join(', '));
    console.log(`[verification-sync] ${stale.length} result(s) measured against a SUPERSEDED seed.`);
    for (const s of stale) console.log(`  ${s.id}: stamped seed ${s.stamped}, current is ${s.current} — RE-RUN`);
    return;
  }

  // --check (default). Stale-fingerprint results are WARNED (non-blocking): a seed change
  // legitimately supersedes results, and the fix is to re-run the gate, not to abandon the
  // commit. Expected-value DRIFT is a different animal and blocks below.
  const stale = staleResults(md, currentFp);
  if (stale.length) {
    console.error(`[verification-sync] WARNING — ${stale.length} Result cell(s) measured against a superseded seed (current ${currentFp}):`);
    for (const s of stale) console.error(`  · ${s.id}: stamped seed ${s.stamped} — re-run the gate to refresh`);
    console.error('');
  }

  const drift = reconcile(md);
  if (!drift.length) {
    console.log('[verification-sync] OK — VERIFICATION.md and expected.js agree.');
    return;
  }
  console.error('');
  console.error('[verification-sync] DRIFT — VERIFICATION.md and tests/harness/expected.js disagree.');
  console.error('');
  for (const d of drift) console.error('  · ' + d);
  console.error('');
  console.error('  These are the SAME numbers held in two places. One of them is wrong, and while');
  console.error('  they disagree the sweep is measuring against an expectation nobody agreed to.');
  console.error('  This exact drift already happened once: a seed revision updated the P&L table');
  console.error('  and the gate but not the Part A rows.');
  console.error('');
  console.error('  expected.js is the source of truth. Correct VERIFICATION.md to match it, or');
  console.error('  change expected.js deliberately and re-derive the document from it.');
  console.error('');
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { reconcile, writeResults, emptyResults, staleResults, readA5Table, parseMoney, DOC };
