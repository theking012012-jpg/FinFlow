'use strict';
/**
 * tz-matrix.js — TIMEZONE INDEPENDENCE. The A/B experiment.
 *
 *   node tests/harness/tz-matrix.js
 *
 * THE PROPERTY UNDER TEST
 *   The same books, read by two people in different places, must show the same numbers.
 *   An accountant in California and their client in Trinidad are looking at ONE database. If
 *   the June total depends on where the reader is sitting, the books are not the books.
 *
 * WHY THIS CANNOT BE ESTABLISHED BY READING SOURCE
 *   `_periodWindow` (app-main.js:1744) builds boundaries with `new Date(y, m, 1)` — the
 *   VIEWER'S local midnight — and serialises them with `.toISOString()`. Reading that tells
 *   you a timezone is involved. It does not tell you whether any seeded row falls in the gap,
 *   and therefore whether any figure actually moves. Only running it does.
 *
 * THE EXPERIMENT
 *   Run the identical seed and the identical probe twice, changing ONLY the process timezone.
 *   Everything else is held constant by construction — same pinned instant, same fixed-UTC
 *   seed instants, a fresh UTC cluster each time. Any figure that differs is caused by the
 *   viewer's timezone and nothing else.
 *
 *   A: America/Port_of_Spain  UTC-4, no DST      (the owner)
 *   B: America/Los_Angeles    UTC-7 (DST) / -8   (a US accountant)
 *
 * This script REPORTS. It does not fix, and a difference here is structural — it belongs with
 * the money-engine consolidation, not a patch.
 */

const path = require('path');
const { spawn } = require('child_process');

// The matrix MUST span the sign boundary. UTC-4 and UTC-8 are both WEST of UTC and misfile
// IDENTICALLY, so a western-only matrix goes green on the very bug it exists to catch — the
// same false-negative class as a date-only seed. At least one positive offset is required.
// Asia/Kolkata is +5:30 deliberately: a half-hour offset also catches code that assumes
// whole-hour zones.
const ZONES = [
  { key: 'LA', tz: 'America/Los_Angeles', note: 'UTC-7 (PDT) — west, a US accountant' },
  { key: 'POS', tz: 'America/Port_of_Spain', note: 'UTC-4, no DST — west, the owner' },
  { key: 'LON', tz: 'Europe/London', note: 'UTC+1 (BST) — EAST of UTC' },
  { key: 'IST', tz: 'Asia/Kolkata', note: 'UTC+5:30 — east, half-hour offset' },
];

const FIGURES = ['revenue', 'cogs', 'grossProfit', 'opex', 'netProfit', 'outstanding'];
const PERIOD_KEYS = ['may', 'jun', 'jul', 'q2', 'q3', 'fy'];

function runProbe(tz) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '-r', path.join(__dirname, 'clock.js'),
      path.join(__dirname, 'tz-probe.js'),
    ], {
      cwd: path.join(__dirname, '..', '..'),
      // Both viewers get the IDENTICAL dataset, boundary row included. The dataset is a
      // constant of the experiment; the timezone is the only variable.
      env: { ...process.env, HARNESS_TZ: tz, TZ: tz, HARNESS_BOUNDARY_ROW: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', () => {
      const m = stdout.match(/<<<TZPROBE>>>([\s\S]*?)<<<END>>>/);
      if (!m) {
        return reject(new Error(
          `[tz-matrix] probe for ${tz} produced no result block.\n`
          + `--- stdout (tail) ---\n${stdout.slice(-1500)}\n`
          + `--- stderr (tail) ---\n${stderr.slice(-1500)}`
        ));
      }
      try { resolve(JSON.parse(m[1])); }
      catch (e) { reject(new Error(`[tz-matrix] result block did not parse: ${e.message}`)); }
    });
  });
}

const fmt = (v) => (v === null || v === undefined ? '—' : String(v));

async function main() {
  console.log('');
  console.log('═'.repeat(86));
  console.log('  TIMEZONE INDEPENDENCE — same seed, same instant, two viewers');
  console.log('═'.repeat(86));
  for (const z of ZONES) console.log(`  ${z.key}: ${z.tz.padEnd(24)} ${z.note}`);
  console.log('');
  console.log('  Only the process timezone differs. The pinned instant, the seed (fixed UTC');
  console.log('  instants) and the cluster (UTC) are identical in both runs.');
  console.log('');
  console.log('  Both runs include a BOUNDARY ROW: one 777 expense at 2026-06-01T05:30:00Z,');
  console.log('  inside the gap between the two viewers\' June boundaries (04:00Z vs 07:00Z).');
  console.log('  Without it the seed cannot discriminate — every other row is a date-only');
  console.log('  string, which lands before BOTH boundaries and moves for neither viewer.');
  console.log('═'.repeat(86));
  console.log('');

  const results = {};
  for (const z of ZONES) {
    process.stdout.write(`  running viewer ${z.key} (${z.tz}) … `);
    results[z.key] = await runProbe(z.tz);
    const r = results[z.key];
    if (r.fatal) { console.log('FATAL'); console.log(r.fatal); return; }
    console.log(`done  (offset UTC${r.offsetMinutes > 0 ? '-' : '+'}${Math.abs(r.offsetMinutes) / 60})`);
    if (r.errors && r.errors.length) for (const e of r.errors) console.log(`      ! ${e}`);
  }

  const keys = ZONES.map((z) => z.key);
  const ref = keys[0];

  // ── The windows actually sent ──────────────────────────────────────────────
  console.log('');
  console.log('  ── period windows as SENT to /api/reports (start instant) ──────────────────────');
  console.log(`  ${'period'.padEnd(7)} ${keys.map((k) => k.padEnd(26)).join('')}same?`);
  console.log('  ' + '─'.repeat(112));
  for (const k of PERIOD_KEYS) {
    const cells = keys.map((z) => results[z].windows[k]);
    if (cells.some((w) => !w)) continue;
    const same = cells.every((w) => w.start === cells[0].start);
    console.log(`  ${k.padEnd(7)} ${cells.map((w) => w.start.padEnd(26)).join('')}${same ? 'yes' : 'NO'}`);
  }

  // ── Figures across every viewer ────────────────────────────────────────────
  console.log('');
  console.log('  ── figures ─────────────────────────────────────────────────────────────────────');
  console.log(`  ${'period'.padEnd(7)} ${'figure'.padEnd(13)} ${keys.map((k) => k.padEnd(11)).join('')}verdict`);
  console.log('  ' + '─'.repeat(100));

  const differences = [];
  for (const k of PERIOD_KEYS) {
    const rows = keys.map((z) => results[z].figures[k]);
    if (rows.some((r) => !r)) { console.log(`  ${k.padEnd(7)} (no data)`); continue; }
    for (const f of FIGURES) {
      const vals = rows.map((r) => r[f]);
      const base = vals[0];
      const differs = vals.some((v) => !(typeof v === 'number' && typeof base === 'number'
        ? Math.abs(v - base) < 0.005 : v === base));
      if (differs) {
        differences.push({ period: k, figure: f, byZone: Object.fromEntries(keys.map((z, i) => [z, vals[i]])) });
      }
      console.log(`  ${k.padEnd(7)} ${f.padEnd(13)} ${vals.map((v) => fmt(v).padEnd(11)).join('')}${differs ? '*** DIFFERS ***' : 'same'}`);
    }
    console.log('');
  }

  // ── East/west split ────────────────────────────────────────────────────────
  // The asymmetry is the point: a row dated the 1st lands BEFORE a western local-midnight
  // boundary (→ previous month, wrong) and AFTER an eastern one (→ correct month). Grouping by
  // the sign of the offset makes that visible instead of leaving it as a claim.
  console.log('  ── offset by viewer ────────────────────────────────────────────────────────────');
  for (const z of ZONES) {
    const off = results[z.key].offsetMinutes;   // minutes WEST of UTC
    const side = off > 0 ? 'WEST of UTC' : off < 0 ? 'EAST of UTC' : 'UTC';
    const hrs = Math.abs(off) / 60;
    console.log(`  ${z.key.padEnd(5)} ${z.tz.padEnd(24)} UTC${off > 0 ? '-' : '+'}${hrs}  ${side}`);
  }

  console.log('');
  console.log('═'.repeat(86));
  if (!differences.length) {
    console.log('  RESULT: every figure is IDENTICAL across all viewers.');
    console.log('');
    console.log('  ⚠️  This does NOT prove timezone independence. It proves no seeded row falls in');
    console.log('  any inter-viewer gap. Check the window table above — if the BOUNDARIES differ');
    console.log('  while the figures agree, the seed is not discriminating (Rule 4).');
  } else {
    console.log(`  RESULT: ${differences.length} figure(s) DIFFER between viewers of the SAME books.`);
    console.log('');
    for (const d of differences) {
      const cells = keys.map((z) => `${z}=${fmt(d.byZone[z])}`).join('  ');
      console.log(`    ${d.period.padEnd(6)} ${d.figure.padEnd(13)} ${cells}`);
    }
    console.log('');
    console.log('  Proven by EXECUTION: one database, one instant, one seed — and different');
    console.log('  books depending on where the reader sits.');
  }
  console.log('═'.repeat(86));
  console.log('');
}

main().catch((err) => {
  console.error('\n[tz-matrix] FAILED\n');
  console.error(err && err.message ? err.message : err);
  if (err && err.stack) console.error('\n--- stack ---\n' + err.stack);
  process.exitCode = 0;
});
