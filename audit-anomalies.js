'use strict';
/**
 * audit-anomalies.js — read-only anomaly detection over the append-only audit_trail.
 *
 * Surfaces the "assume-breach, detect fast" signals from the security checklist that are ACTUALLY
 * derivable from what the trail records (CREATE/UPDATE/DELETE/VOID/… with actor_type + actor_id):
 *
 *   1. accountant_cross_client — one accountant touching many DISTINCT client accounts in the window
 *      (the classic compromised-accountant pivot: one login, many clients' books).
 *   2. activity_spike        — one actor performing an abnormal number of audited actions.
 *   3. mass_delete           — one actor deleting many records (bulk destruction).
 *
 * NOT covered yet: mass EXPORT — exports/reads are not written to audit_trail today, so there is
 * nothing to detect. Auditing export events is the prerequisite; this module gains a 4th signal for
 * free once they are recorded.
 *
 * Pure + read-only: no writes, no external deps. Thresholds are env-overridable so ops can tune
 * without a deploy. Callable directly (tests) or via the admin endpoint.
 */

const _int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };

function thresholds(over = {}) {
  return {
    windowMinutes: _int(over.windowMinutes ?? process.env.AUDIT_ANOMALY_WINDOW_MIN, 60),
    crossClient:   _int(over.crossClient   ?? process.env.AUDIT_ANOMALY_CROSS_CLIENT, 5),
    activity:      _int(over.activity      ?? process.env.AUDIT_ANOMALY_ACTIVITY, 100),
    massDelete:    _int(over.massDelete    ?? process.env.AUDIT_ANOMALY_MASS_DELETE, 10),
  };
}

async function detectAuditAnomalies(pool, over = {}) {
  const t = thresholds(over);
  // windowMinutes is a validated positive integer (parseInt), safe to inline into make_interval.
  const since = `changed_at >= NOW() - make_interval(mins => ${t.windowMinutes})`;
  const anomalies = [];

  // 1) one accountant touching many DISTINCT client accounts
  const cc = await pool.query(
    `SELECT actor_id, COUNT(DISTINCT user_id) AS clients
       FROM audit_trail
      WHERE actor_type = 'accountant' AND actor_id IS NOT NULL AND user_id IS NOT NULL AND ${since}
      GROUP BY actor_id HAVING COUNT(DISTINCT user_id) >= $1
      ORDER BY clients DESC`, [t.crossClient]);
  for (const r of cc.rows) anomalies.push({
    type: 'accountant_cross_client', severity: 'high', actor_type: 'accountant', actor_id: r.actor_id,
    count: Number(r.clients), threshold: t.crossClient, window_minutes: t.windowMinutes,
    message: `Accountant ${r.actor_id} touched ${r.clients} distinct client accounts in the last ${t.windowMinutes}m (threshold ${t.crossClient}).`,
  });

  // 2) activity spike by a single actor (any actor type)
  const sp = await pool.query(
    `SELECT actor_type, actor_id, COUNT(*) AS n
       FROM audit_trail
      WHERE actor_id IS NOT NULL AND ${since}
      GROUP BY actor_type, actor_id HAVING COUNT(*) >= $1
      ORDER BY n DESC`, [t.activity]);
  for (const r of sp.rows) anomalies.push({
    type: 'activity_spike', severity: 'medium', actor_type: r.actor_type, actor_id: r.actor_id,
    count: Number(r.n), threshold: t.activity, window_minutes: t.windowMinutes,
    message: `${r.actor_type} ${r.actor_id} performed ${r.n} audited actions in the last ${t.windowMinutes}m (threshold ${t.activity}).`,
  });

  // 3) mass delete by a single actor
  const md = await pool.query(
    `SELECT actor_type, actor_id, COUNT(*) AS n
       FROM audit_trail
      WHERE action = 'DELETE' AND actor_id IS NOT NULL AND ${since}
      GROUP BY actor_type, actor_id HAVING COUNT(*) >= $1
      ORDER BY n DESC`, [t.massDelete]);
  for (const r of md.rows) anomalies.push({
    type: 'mass_delete', severity: 'high', actor_type: r.actor_type, actor_id: r.actor_id,
    count: Number(r.n), threshold: t.massDelete, window_minutes: t.windowMinutes,
    message: `${r.actor_type} ${r.actor_id} deleted ${r.n} records in the last ${t.windowMinutes}m (threshold ${t.massDelete}).`,
  });

  return { generated_at: new Date().toISOString(), thresholds: t, count: anomalies.length, anomalies };
}

module.exports = { detectAuditAnomalies, thresholds };
