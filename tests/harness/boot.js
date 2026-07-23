'use strict';
/**
 * boot.js — starts the REAL server against the scratch cluster.
 *
 * No stubs, no re-implementation, no source extraction. This requires the shipped
 * server.js and listens on a real socket, so every request the harness makes travels the
 * real middleware stack: express.json → CSRF/content-type gate (server.js:322) → rate
 * limiter → pgSession (backed by the scratch Postgres) → requireAuth → the real route.
 *
 * WHY WE CAN DO THIS AT ALL
 *   server.js:4751 wraps app.listen in `if (require.main === module)`, so importing the
 *   server yields the app WITHOUT starting a listener or the recurring scheduler. We choose
 *   the port.
 *
 * ORDER IS LOAD-BEARING
 *   database.js:39 builds its Pool from process.env.DATABASE_URL at MODULE SCOPE, and
 *   dbSsl() reads NODE_ENV at module scope too. Both must be set before the first require
 *   of database.js — which server.js performs on its own line 11. Setting them afterwards
 *   would leave a pool pointed at the wrong place, or at nothing.
 */

const guard = require('./guard.js');

/** Env the server needs, and env it must NOT have. */
function installEnv(scratchUrl) {
  const scrubbed = guard.scrubInheritedDatabaseUrl();

  // Not 'production' — dbSsl() (database.js:30) returns false off-production, and the
  // embedded cluster speaks no TLS. It also keeps session cookies non-secure so a plain
  // HTTP loopback request can hold a session.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = scratchUrl;
  process.env.SESSION_SECRET = 'finflow-verification-harness-fixed-secret-do-not-use-anywhere-else';

  // Keep every outbound integration unconfigured. The network guard in clock.js blocks these
  // anyway; unsetting them means the app takes its own "not configured" branch instead of
  // attempting a call and catching the block, so the run report stays clean and truthful.
  for (const k of [
    'ANTHROPIC_API_KEY', 'FINNHUB_API_KEY', 'COINGECKO_API_KEY',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
    'ALLOWED_ORIGIN', 'APP_URL', 'DATABASE_CA_CERT',
  ]) delete process.env[k];

  return { scrubbed };
}

/**
 * Build the real schema on the scratch cluster WITHOUT starting the server.
 *
 * Step 2 (seed) needs the schema but no listener. Step 1/3 need both. Sharing one path means
 * the seed can never run against a schema built differently from the one the server uses —
 * it is literally the same initDB().
 *
 * Returns the database module so the caller can close its pool; pg keeps the process alive
 * until the pool is ended.
 */
async function initSchema(scratchUrl) {
  const { scrubbed } = installEnv(scratchUrl);
  const database = require('../../database.js');
  await database.initDB();
  return { database, pool: database.pool, scrubbed };
}

async function bootServer(scratchUrl) {
  const { scrubbed } = installEnv(scratchUrl);

  // server.js:4750 fires initDB() at import time and never awaits it. We run our own first
  // so the schema is committed before any request arrives; the server's copy is idempotent
  // DDL over an already-built schema. Its promise is still unawaited inside the module, so
  // catch its rejection explicitly rather than letting it surface as an unhandled rejection
  // with no context.
  const bootRejections = [];
  const onUnhandled = (reason) => bootRejections.push(reason);
  process.on('unhandledRejection', onUnhandled);

  const database = require('../../database.js');
  await database.initDB();

  const app = require('../../server.js');

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Give the server's own floating initDB() a tick to settle so a rejection is captured here
  // rather than after the harness has moved on.
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', onUnhandled);

  // Teardown order matters. The app's pool (database.js:39) keeps live connections open and
  // registers `pool.on('error')` (database.js:49). Stopping the cluster while those are open
  // makes every pooled socket emit ECONNRESET, which the handler dumps to the console —
  // ~180 lines of alarming noise per run, ending the report on what looks like a failure.
  // Worse, it is noise that would MASK a real error. So: stop listening, drain the pool,
  // and only then let the caller stop the cluster.
  const close = async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    try { await database.pool.end(); } catch { /* already ended */ }
  };

  return { app, server, port, baseUrl, pool: database.pool, close, bootRejections };
}

module.exports = { bootServer, initSchema, installEnv };
