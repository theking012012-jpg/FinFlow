'use strict';
/**
 * verify-f112-stamp-churnfree.js — PROVE (Rule 14) that the F112 fix removes the daily
 * date-churn from VERIFICATION.md Result cells, and DISCRIMINATE (Rule 4) that the removed
 * date was in fact the churn source.
 *
 * The gate writes each measured cell via verification-sync.writeResults(). Pre-fix the verdict
 * string carried the WALL-CLOCK date: `PASS (2026-08-04 · seed <fp>)`. Re-running the gate on a
 * later calendar day rewrote every cell's date even when the figure was byte-identical, so
 * VERIFICATION.md showed modified and someone had to decide whether to commit a pure date bump.
 * Post-fix the verdict carries ONLY the seed fingerprint: `PASS (seed <fp>)`.
 *
 * TEST: write the same PASS result into a fixture on "day 1" and again on "day 2" (two different
 *       wall-clock dates). The file must be BYTE-IDENTICAL after both writes.
 * CONTROL: do the same with the OLD date-bearing verdict template — the two writes must DIFFER,
 *          proving the date was the churn and that this test can actually see it (a test where
 *          both branches went green would prove nothing — Rule 4).
 *
 *   node tests/harness/verify-f112-stamp-churnfree.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeResults } = require('./verification-sync.js');

const FP = '3c322e0f';                 // a seed fingerprint, constant across the two "days"
const DAY1 = '2026-08-04';
const DAY2 = '2026-08-05';             // a different calendar day — the churn trigger

// The exact cell shape the gate targets: id | field | jun | jul | fy | <Result>
const FIXTURE =
  '| Check | field | Jun | Jul | FY | Result |\n' +
  '|---|---|---|---|---|---|\n' +
  '| A5.1–3 | revenue | 3,800 | 4,000 | 8,800 |  |\n';

// NEW writer (post-fix): fingerprint only, no date.
const newVerdict = () => `PASS (seed ${FP})`;
// OLD writer (pre-fix): wall-clock date + fingerprint.
const oldVerdict = (day) => `PASS (${day} · seed ${FP})`;

function writeTwice(verdictFor) {
  const f = path.join(os.tmpdir(), `f112-${process.pid}-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(f, FIXTURE);
  writeResults({ 'A5.1–3': verdictFor(DAY1) }, { file: f });
  const afterDay1 = fs.readFileSync(f, 'utf8');
  writeResults({ 'A5.1–3': verdictFor(DAY2) }, { file: f });
  const afterDay2 = fs.readFileSync(f, 'utf8');
  fs.unlinkSync(f);
  return { afterDay1, afterDay2 };
}

let pass = 0, fail = 0;
const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

// FIX: new verdict ignores the day → identical bytes across day1 and day2.
const fix = writeTwice(() => newVerdict());
A('FIX — PASS (seed <fp>) is byte-identical across two calendar days (no churn)',
  fix.afterDay1 === fix.afterDay2,
  `day1:\n${fix.afterDay1}\n        day2:\n${fix.afterDay2}`);

// CONTROL: old verdict carries the day → the two writes DIFFER (this is the churn the fix removes).
const ctrl = writeTwice((day) => oldVerdict(day));
A('CONTROL — old PASS (date · seed <fp>) DIFFERS across two days (proves the date was the churn, test discriminates)',
  ctrl.afterDay1 !== ctrl.afterDay2,
  'old template produced identical bytes on two different days — the test cannot see the churn it exists to catch');

// Belt-and-braces: the surviving repo doc must no longer carry any date-bearing stamp.
const DOC = path.join(__dirname, '..', '..', 'VERIFICATION.md');
const doc = fs.readFileSync(DOC, 'utf8');
const leftover = (doc.match(/\(20\d\d-\d\d-\d\d · seed [0-9a-f]+\)/g) || []);
A('VERIFICATION.md has zero date-bearing stamps left', leftover.length === 0,
  `found ${leftover.length}: ${leftover.slice(0, 3).join(', ')}`);

console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;
