'use strict';
/**
 * job-lock.js — N72. A background job runs in ONE place at a time, however many web replicas are up.
 *
 * Every replica started the recurring scheduler, the live-FX refresh, the audit-anomaly scan and the GL
 * reconcile scan on its own timers, so N replicas did each job N times (N× the work; for the reconcile scan,
 * computeBooks + the ledger for every entity, up to 20,000, every 6 h — in each replica's web process).
 *
 * runExclusive(pool, name, fn) takes a SESSION-level Postgres advisory lock for `name` on a dedicated
 * connection (pg_try_advisory_lock — non-blocking). The replica that gets it runs fn; the others skip this tick
 * ({ ran: false }). The lock is released (and the connection returned) when fn settles, so a crashed replica's
 * lock dies with its session.
 */
async function runExclusive(pool, name, fn) {
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows: [r] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', ['finflow-job:' + name]);
    locked = !!(r && r.ok);
    if (!locked) return { ran: false };
    const result = await fn();
    return { ran: true, result };
  } finally {
    if (locked) { try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['finflow-job:' + name]); } catch (_) {} }
    client.release();
  }
}

module.exports = { runExclusive };
