#!/usr/bin/env node
'use strict';
/**
 * ledger-sync.js — F105: the findings ledger checks itself at commit time (the same shape as verification-sync.js).
 *
 * F105: F104 was logged as a NEW finding while F80 — the same defect, on the same code — was one day old, and it posed
 * a question VERIFICATION.md's "ACCOUNTING BASIS — DECIDED" Decision 2 had already settled. Nothing linked a new row to
 * an existing row on the same code, or to a settled decision.
 *
 * Two guards, run on the STAGED AUDIT_MASTER.md (or a file given with --file):
 *   (a) ANCHOR COLLISION — every `file.js:123` a finding cites is an anchor. When two DIFFERENT findings claim the same
 *       anchor and neither mentions the other, the commit fails and names both. (A finding that cites the other —
 *       "see F80", "same class as F80" — is linked, so it passes.)
 *   (b) DECISION CITATION — a finding that asks an accounting-basis question ("decision needed", "open question",
 *       "held for owner", "does … accrue / count / recognise …") on a topic a Decision covers must cite "Decision N"
 *       (or say "no decision exists"); otherwise the commit fails and points at that Decision.
 * What the ledger held when this guard was built is the BASELINE (ledger-baseline.json): only NEW collisions /
 * uncited questions fail — a ratchet, so the history does not block every commit, and nothing new slips in.
 *
 *   node tests/harness/ledger-sync.js --check              (pre-commit)
 *   node tests/harness/ledger-sync.js --write-baseline      (once, by the owner, to accept the current ledger)
 *   node tests/harness/ledger-sync.js --check --file X.md   (a given file — tests)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'ledger-baseline.json');

// The Decisions in VERIFICATION.md (ACCOUNTING BASIS — DECIDED), each with the words that mark its topic. A finding is
// on a decision's topic when every group in `all` has at least one word in the finding.
const DECISIONS = [
  { n: 1, topic: 'a bill is an expense when issued, not when paid', all: [['bill'], ['expense'], ['issued', 'issue', 'paid', 'payment']] },
  { n: 2, topic: 'a payroll run is recognised at approved; draft contributes 0; paid adds nothing', all: [['payroll'], ['run'], ['draft', 'approved', 'paid']] },
  { n: 3, topic: 'Cash Flow is genuine cash basis', all: [['cash flow', 'cash-flow', 'cashflow'], ['basis', 'accrual', 'cash basis']] },
  { n: 4, topic: 'investments: cached server-side price, frozen during a sweep', all: [['investment', 'holding'], ['price']] },
  { n: 5, topic: 'the Banking MTD card is deleted', all: [['banking'], ['mtd', 'month to date', 'month-to-date']] },
];
const QUESTION = /(decision needed|needs? (?:an? )?(?:owner )?decision|held for (?:the )?owner|open question|\bdoes [^.?]{0,60}\b(?:accrue|count|recogni[sz]e|contribute)\b)/i;

function readLedger(file) {
  if (file) return fs.readFileSync(file, 'utf8');
  try { return execSync('git show :AUDIT_MASTER.md', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (_) { return fs.readFileSync(path.join(ROOT, 'AUDIT_MASTER.md'), 'utf8'); }
}

// Findings: every "### <ID> …" section, and every table row "| <ID> | …" of the dated live-test tables.
const ID = '(?:F\\d+(?:-[a-z0-9]+)?|C\\d+|PL#\\d+|NEW-\\d+|E2E-\\d+|LA\\d+[a-z]?|LC\\d+[a-z]?(?:-[a-z])?|LR\\d+[a-z]?|FA-[A-Z]+\\d*[a-z]?|G\\d+|N\\d+)';
function findings(md) {
  const out = [];
  const lines = md.split('\n');
  let cur = null;
  const head = new RegExp('^#{3,4}\\s+(' + ID + ')\\b');
  const row = new RegExp('^\\|\\s*(' + ID + ')\\s*\\|');
  for (const line of lines) {
    const h = head.exec(line), r = row.exec(line);
    if (h) { cur = { id: h[1], text: line + '\n' }; out.push(cur); continue; }
    if (/^#{1,3}\s/.test(line)) { cur = null; }
    if (r) { out.push({ id: r[1], text: line }); continue; }
    if (cur) cur.text += line + '\n';
  }
  // one finding may appear in several places (a heading and a table row) — one record per id
  const byId = new Map();
  for (const f of out) { const e = byId.get(f.id); if (e) e.text += '\n' + f.text; else byId.set(f.id, { id: f.id, text: f.text }); }
  return [...byId.values()];
}
const anchorsOf = t => [...new Set((t.match(/\b[A-Za-z0-9_.\/-]+\.(?:js|html|sql):\d+\b/g) || []).map(a => a.replace(/^.*\//, '')))];
const mentions = (text, id) => new RegExp('(^|[^A-Za-z0-9#-])' + id.replace(/[#.*+?^${}()|[\]\\-]/g, '\\$&') + '(?![0-9A-Za-z])').test(text);

function analyse(md) {
  const fs_ = findings(md);
  const owners = new Map();
  for (const f of fs_) for (const a of anchorsOf(f.text)) { if (!owners.has(a)) owners.set(a, []); owners.get(a).push(f); }
  const collisions = [];
  for (const [a, list] of owners) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const x = list[i], y = list[j];
      if (mentions(x.text, y.id) || mentions(y.text, x.id)) continue;
      const [p, q] = [x.id, y.id].sort();
      collisions.push(p + '|' + q + '|' + a);
    }
  }
  const uncited = [];
  for (const f of fs_) {
    const t = f.text.toLowerCase();
    if (!QUESTION.test(f.text)) continue;
    if (/no decision exists/i.test(f.text)) continue;
    for (const d of DECISIONS) {
      if (!d.all.every(g => g.some(w => t.includes(w)))) continue;
      if (new RegExp('\\bdecision\\s*' + d.n + '\\b', 'i').test(f.text)) continue;
      uncited.push(f.id + '|Decision ' + d.n);
    }
  }
  return { findings: fs_.length, collisions: [...new Set(collisions)].sort(), uncited: [...new Set(uncited)].sort() };
}

function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const md = readLedger(fi >= 0 ? args[fi + 1] : null);
  const r = analyse(md);
  if (args.includes('--write-baseline')) {
    fs.writeFileSync(BASELINE, JSON.stringify({ note: 'F105 baseline — the ledger as it stood when the guard was built (2026-11-02). Only NEW entries fail.', collisions: r.collisions, uncited: r.uncited }, null, 1) + '\n');
    console.log(`[ledger-sync] baseline written: ${r.collisions.length} anchor collisions, ${r.uncited.length} uncited decision questions (${r.findings} findings)`);
    return 0;
  }
  let base = { collisions: [], uncited: [] };
  try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) {}
  const bc = new Set(base.collisions), bu = new Set(base.uncited);
  const newC = r.collisions.filter(k => !bc.has(k)), newU = r.uncited.filter(k => !bu.has(k));
  if (!newC.length && !newU.length) { console.log(`[ledger-sync] OK — ${r.findings} findings; no new anchor collision, no uncited decision question.`); return 0; }
  for (const k of newC) { const [a, b, anchor] = k.split('|'); console.error(`[ledger-sync] ANCHOR COLLISION: ${a} and ${b} both cite ${anchor} and neither mentions the other — is one a duplicate? Cite it ("see ${a}") or merge.`); }
  for (const k of newU) {
    const [id, dec] = k.split('|'); const d = DECISIONS.find(x => 'Decision ' + x.n === dec);
    console.error(`[ledger-sync] UNCITED DECISION: ${id} asks a question on a settled topic — ${dec} (VERIFICATION.md, ACCOUNTING BASIS — DECIDED): "${d.topic}". Cite "${dec}", or write "no decision exists" if it truly does not cover this.`);
  }
  return 1;
}

if (require.main === module) process.exit(main());
module.exports = { analyse, findings, DECISIONS };
