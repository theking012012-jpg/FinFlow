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

// ROOT FALLBACK (Linux containers only). Postgres refuses to run as root, and embedded-postgres's own answer is to
// create an OS user. Where the harness runs as root (a cloud container), the SAME bundled binaries run instead as an
// existing unprivileged uid (FINFLOW_PG_UID, default 65534 = nobody) via setpriv — one fresh cluster per run, torn
// down after, exactly like the normal path. Never taken on Windows/macOS or as a normal user (getuid() !== 0).
const _isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0 && process.platform === 'linux';

async function startAsUnprivileged({ keep }) {
  const { spawnSync } = require('child_process');
  const uid = String(parseInt(process.env.FINFLOW_PG_UID || '65534', 10));
  const bin = path.join(path.dirname(require.resolve('pg/package.json')), '..', '@embedded-postgres', 'linux-x64', 'native', 'bin');
  const port = await findFreePort();
  const base = path.join(os.tmpdir(), 'finflow-harness');
  const dataDir = path.join(base, keep ? 'kept-cluster' : `run-${process.pid}-${Date.now()}`);
  rmScratchDir(dataDir);
  fs.mkdirSync(base, { recursive: true }); fs.chmodSync(base, 0o755);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.chownSync(dataDir, Number(uid), Number(uid));
  const pwfile = path.join(dataDir, '.pw');
  fs.writeFileSync(pwfile, PG_PASS); fs.chownSync(pwfile, Number(uid), Number(uid));
  const pgdata = path.join(dataDir, 'data');
  const asPg = (cmd, args) => {
    const r = spawnSync('setpriv', ['--reuid=' + uid, '--regid=' + uid, '--clear-groups', path.join(bin, cmd), ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`[pgScratch] ${cmd} failed (status ${r.status}):\n${r.stdout}\n${r.stderr}${r.error ? '\n' + r.error.stack : ''}`);
    return r;
  };
  asPg('initdb', ['-D', pgdata, '-U', PG_USER, '--pwfile=' + pwfile, '-A', 'password', '--encoding=UTF8', '--locale=C']);
  asPg('pg_ctl', ['-D', pgdata, '-w', '-l', path.join(dataDir, 'pg.log'),
    '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dataDir} -c timezone=UTC -c log_timezone=UTC`, 'start']);
  const stopCluster = () => {
    try { asPg('pg_ctl', ['-D', pgdata, '-m', 'fast', '-w', 'stop']); } catch (e) { /* already down */ }
    if (!keep) { try { rmScratchDir(dataDir); } catch { /* best effort */ } }
  };
  try {
    const admin = new Client({ connectionString: `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${port}/postgres` });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();
  } catch (err) { stopCluster(); throw new Error(`[pgScratch] (root fallback) create database failed: ${err.message}\n${err.stack}`); }
  return { port, dataDir, logLines: [], pgStop: async () => stopCluster() };
}

async function startScratchPostgres({ keep = false } = {}) {
  if (_isRoot()) {
    const { port, dataDir, logLines, pgStop } = await startAsUnprivileged({ keep });
    return _finishScratch({ port, dataDir, logLines, keep, pgStop });
  }
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

  return _finishScratch({ port, dataDir, logLines, keep, pgStop: async () => {
    try { await pg.stop(); } catch (e) { logLines.push('[stop] ' + e.message); }
    if (!keep) {
      // persistent:false should have removed it; make sure (Windows file locks can defeat it).
      try { rmScratchDir(dataDir); } catch { /* best effort — reported by caller if it matters */ }
    }
  } });
}

// The checks every scratch cluster passes before a harness may use it, whichever way it was started.
async function _finishScratch({ port, dataDir, logLines, keep, pgStop }) {
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
    try { await pgStop(); } catch { /* ignore */ }
    err.message = `[pgScratch] cluster started but failed its checks — cluster stopped.\n${err.message}`;
    throw err;
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { await client.end(); } catch { /* ignore */ }
    await pgStop();
  };

  return { url, port, dataDir, facts, client, stop, logLines, keep };
}

module.exports = { startScratchPostgres, DB_NAME, PG_USER, PG_PASS };
