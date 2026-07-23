'use strict';
/**
 * substrate.js — the run header.
 *
 * Printed on EVERY run. A result that does not say what it ran against is how a number gets
 * over-cited later: "the harness said 5,750" carries a different weight depending on whether
 * the clock was pinned, the network was open, and the database was the real engine.
 *
 * Every value here is READ FROM THE LIVE SYSTEM (SHOW timezone, the installed package
 * version, the actual pinned instant) rather than restated from a comment, so the header
 * cannot drift away from the thing it describes.
 */

const path = require('path');

// Owner-confirmed, 2026-07-23. Not measured by this harness — it is a stated fact about a
// system the harness deliberately never connects to.
const PRODUCTION = { version: '17.6.1', host: 'Supabase' };

function installedEmbeddedPgVersion() {
  try {
    return require(path.join('..', '..', 'node_modules', 'embedded-postgres', 'package.json')).version;
  } catch {
    return '(not resolvable)';
  }
}

function pad(label) { return (label + ' '.repeat(13)).slice(0, 13); }

/**
 * @param {object} facts      from guard.assertScratchDatabase()
 * @param {object} ctx        { port, dataDir, keep, pinnedIso, tz, scrubbed }
 */
function printSubstrateHeader(facts, ctx) {
  const wrapperVersion = installedEmbeddedPgVersion();
  const sameMajor = String(facts.server_version).split('.')[0] === PRODUCTION.version.split('.')[0];

  const lines = [];
  lines.push('');
  lines.push('═'.repeat(78));
  lines.push('  FinFlow — VERIFICATION harness');
  lines.push('═'.repeat(78));
  lines.push(`  ${pad('substrate')}scratch PostgreSQL ${facts.server_version} (embedded, wrapper ${wrapperVersion} — prerelease)`);
  lines.push(`  ${pad('production')}PostgreSQL ${PRODUCTION.version} (${PRODUCTION.host}) — ${sameMajor ? 'same major, patch differs' : '*** MAJOR VERSION MISMATCH ***'}`);
  lines.push(`  ${pad('database')}${facts.database} as ${facts.user} @ 127.0.0.1:${ctx.port}`);
  lines.push(`  ${pad('timezone')}${facts.timezone}  (asserted — must be UTC; production stamps NOW() in UTC)`);
  lines.push(`  ${pad('lc_collate')}${facts.lc_collate}  (production lc_collate NOT verified; affects text ORDER BY only)`);
  lines.push(`  ${pad('encoding')}${facts.server_encoding}  (asserted)`);
  lines.push(`  ${pad('DateStyle')}${facts.datestyle}`);
  lines.push(`  ${pad('node clock')}pinned ${ctx.pinnedIso}  ·  TZ ${ctx.tz} (UTC-4, no DST)`);
  lines.push(`  ${pad('network')}blocked — loopback only`);
  lines.push(`  ${pad('data dir')}${ctx.dataDir}${ctx.keep ? '   [KEPT — cluster stays up]' : '   [ephemeral]'}`);
  if (ctx.scrubbed && ctx.scrubbed.present) {
    lines.push('');
    lines.push(`  !! an inherited DATABASE_URL (host ${ctx.scrubbed.host}) was REMOVED from the`);
    lines.push('     environment before any module loaded. The harness never reads DATABASE_URL.');
  }
  lines.push('─'.repeat(78));
  lines.push('  SCOPE LIMIT — the seed is written by DIRECT SQL, not through the POST endpoints.');
  lines.push('  It has to be: POST /api/payroll-runs hardcodes run_date = NOW() with no override');
  lines.push('  (server.js:3822, F85), so an endpoint-built seed could not place one row in May or');
  lines.push('  June. The seed therefore exercises the SCHEMA, not the write paths.');
  lines.push('  A green Part A says NOTHING about whether invoice/expense/bill creation works.');
  lines.push('  The write paths are Part B\'s job, and Part B drives the real buttons.');
  lines.push('═'.repeat(78));
  lines.push('');
  console.log(lines.join('\n'));
}

/**
 * Blocked outbound requests, recorded by clock.js. Printed at the END of a run because the
 * app swallows its own fetch failures — without this, a blocked price-feed call would be
 * invisible and the run would look cleaner than it was.
 */
function printBlockedRequests() {
  const blocked = global.__FF_HARNESS_BLOCKED_REQUESTS__ || [];
  if (!blocked.length) {
    console.log('  network: no outbound requests attempted.');
    return blocked;
  }
  console.log(`  network: ${blocked.length} outbound request(s) BLOCKED (expected — the feed is frozen):`);
  for (const b of blocked) console.log(`    · [${b.via}] ${b.target}`);
  return blocked;
}

module.exports = { printSubstrateHeader, printBlockedRequests, PRODUCTION };
