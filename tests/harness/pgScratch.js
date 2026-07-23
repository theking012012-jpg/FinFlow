'use strict';
/**
 * pgScratch.js — brings up a real, throwaway PostgreSQL cluster for the harness.
 *
 * SUBSTRATE: `embedded-postgres` unpacks an official PostgreSQL 17.10 binary and runs it as
 * a child process on a loopback port. The SQL engine is real Postgres — not an emulator, not
 * pg-mem, not a hand-written pool. That is the whole point: CLAUDE.md Rule 3 and F77.
 *
 * The npm wrapper is a prerelease (every published version is; there is no stable release).
 * Accepted deliberately: the wrapper only unpacks a binary and shells out to initdb/pg_ctl,
 * and if it misbehaves it fails to START — leaving no server to connect to. That is a loud
 * failure. The failure mode that actually costs production time is the opposite one: a
 * harness that boots happily and reports confident wrong numbers (F77). This substrate
 * cannot produce that.
 *
 * Version is pinned EXACT in package.json (no caret) so the substrate cannot change between
 * runs without a visible diff.
 */

const os = require('os');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { Client } = require('pg');
const guard = require('./guard.js');

const DB_NAME = 'finflow_scratch';
const PG_USER = 'postgres';
const PG_PASS = 'postgres';

/** An OS-assigned free port. Bind 0, read what we got, release it. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Remove a directory, but only inside our own namespace. */
function rmScratchDir(dir) {
  if (!dir.includes('finflow-harness')) {
    throw new Error(`[pgScratch] refusing to remove "${dir}" — not inside the harness namespace.`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function startScratchPostgres({ keep = false } = {}) {
  const mod = await import('embedded-postgres');           // package is ESM-only
  const EmbeddedPostgres = mod.default || mod;

  const port = await findFreePort();
  const dataDir = path.join(
    os.tmpdir(), 'finflow-harness',
    keep ? 'kept-cluster' : `run-${process.pid}-${Date.now()}`
  );

  // initialise() requires a clean directory.
  rmScratchDir(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });

  const logLines = [];
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: PG_USER,
    password: PG_PASS,
    port,
    authMethod: 'password',
    // persistent:false makes stop() delete the data directory for us.
    persistent: keep,
    initdbFlags: [
      '--encoding=UTF8',
      // C collation for determinism. Production (Supabase) uses en_US.UTF-8; the difference
      // affects text ORDER BY only, and no money figure in VERIFICATION is ordered by text.
      // It is PRINTED in the run header rather than quietly assumed equivalent.
      '--locale=C',
    ],
    postgresFlags: [
      // Non-negotiable — see guard.assertScratchDatabase(). Production stamps NOW() in UTC.
      '-c', 'timezone=UTC',
      '-c', 'log_timezone=UTC',
    ],
    onLog: (m) => logLines.push(String(m)),
    onError: (m) => logLines.push('[err] ' + String(m && m.message ? m.message : m)),
  });

  const dumpLogs = () => logLines.length
    ? '\n--- postgres output ---\n' + logLines.join('\n')
    : '\n(no postgres output captured)';

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(DB_NAME);
  } catch (err) {
    // Rule 7: print real error detail. A failure message that says nothing is as bad as a
    // green test that proves nothing.
    const detail = [
      `[pgScratch] cluster failed to start: ${err && err.message}`,
      err && err.code ? `  code: ${err.code}` : null,
      err instanceof AggregateError && err.errors
        ? '  aggregate: ' + err.errors.map(e => e.message).join(' | ') : null,
      dumpLogs(),
      err && err.stack ? '\n--- stack ---\n' + err.stack : null,
    ].filter(Boolean).join('\n');
    try { await pg.stop(); } catch { /* already down */ }
    throw new Error(detail);
  }

  const url = `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${port}/${DB_NAME}`;

  // Everything from here on runs with a LIVE cluster. If any of it throws, the cluster must
  // still come down — an early version let a failed assertion escape past this point and
  // orphaned a postmaster, which then held its shared-memory block and made the NEXT run
  // fail with "pre-existing shared memory block is still in use". A harness that leaks
  // processes on failure poisons its own next run.
  let client = null;
  let facts = null;
  try {
    // Guard BEFORE anything connects with intent to write.
    guard.assertScratchUrl(url);

    client = new Client({ connectionString: url });
    await client.connect();
    facts = await guard.assertScratchDatabase(client);
    await guard.installScratchMarker(client, `verification harness · pid ${process.pid}`);
  } catch (err) {
    if (client) { try { await client.end(); } catch { /* ignore */ } }
    try { await pg.stop(); } catch { /* ignore */ }
    if (!keep) { try { rmScratchDir(dataDir); } catch { /* best effort */ } }
    err.message = `[pgScratch] cluster started but failed its checks — cluster stopped.\n${err.message}`;
    throw err;
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { await client.end(); } catch { /* ignore */ }
    try { await pg.stop(); } catch (e) { logLines.push('[stop] ' + e.message); }
    if (!keep) {
      // persistent:false should have removed it; make sure (Windows file locks can defeat it).
      try { rmScratchDir(dataDir); } catch { /* best effort — reported by caller if it matters */ }
    }
  };

  return { url, port, dataDir, facts, client, stop, logLines, keep };
}

module.exports = { startScratchPostgres, DB_NAME, PG_USER, PG_PASS };
