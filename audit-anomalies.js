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
    loginIps:      _int(over.loginIps      ?? process.env.AUDIT_ANOMALY_LOGIN_IPS, 3),
    massExport:    _int(over.massExport    ?? process.env.AUDIT_ANOMALY_MASS_EXPORT, 20),
    failedLogins:  _int(over.failedLogins  ?? process.env.AUDIT_ANOMALY_FAILED_LOGINS, 10),
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

  // 4) one principal logging in from many DISTINCT IPs (breach-pivot / shared-credential signal).
  // Honest scope: distinct-IP-count, not true geo-velocity "impossible travel" (needs a geo service).
  const li = await pool.query(
    `SELECT actor_type, actor_id, COUNT(DISTINCT ip_address) AS ips
       FROM audit_trail
      WHERE action = 'LOGIN' AND actor_id IS NOT NULL AND ip_address IS NOT NULL AND ${since}
      GROUP BY actor_type, actor_id HAVING COUNT(DISTINCT ip_address) >= $1
      ORDER BY ips DESC`, [t.loginIps]);
  for (const r of li.rows) anomalies.push({
    type: 'login_multi_ip', severity: 'high', actor_type: r.actor_type, actor_id: r.actor_id,
    count: Number(r.ips), threshold: t.loginIps, window_minutes: t.windowMinutes,
    message: `${r.actor_type} ${r.actor_id} logged in from ${r.ips} distinct IPs in the last ${t.windowMinutes}m (threshold ${t.loginIps}).`,
  });

  // 5) mass export/download by a single actor (data-exfil signal).
  const me = await pool.query(
    `SELECT actor_type, actor_id, COUNT(*) AS n
       FROM audit_trail
      WHERE action = 'EXPORT' AND actor_id IS NOT NULL AND ${since}
      GROUP BY actor_type, actor_id HAVING COUNT(*) >= $1
      ORDER BY n DESC`, [t.massExport]);
  for (const r of me.rows) anomalies.push({
    type: 'mass_export', severity: 'high', actor_type: r.actor_type, actor_id: r.actor_id,
    count: Number(r.n), threshold: t.massExport, window_minutes: t.windowMinutes,
    message: `${r.actor_type} ${r.actor_id} exported/downloaded ${r.n} items in the last ${t.windowMinutes}m (threshold ${t.massExport}).`,
  });

  // 6) failed-login burst from a single IP (brute-force / credential-stuffing). Grouped by IP because
  // a failed login has no authenticated actor.
  const fb = await pool.query(
    `SELECT ip_address, COUNT(*) AS n
       FROM audit_trail
      WHERE action = 'LOGIN_FAILED' AND ip_address IS NOT NULL AND ${since}
      GROUP BY ip_address HAVING COUNT(*) >= $1
      ORDER BY n DESC`, [t.failedLogins]);
  for (const r of fb.rows) anomalies.push({
    type: 'failed_login_burst', severity: 'high', ip_address: r.ip_address, actor_type: 'anonymous', actor_id: null,
    count: Number(r.n), threshold: t.failedLogins, window_minutes: t.windowMinutes,
    message: `${r.n} failed logins from IP ${r.ip_address} in the last ${t.windowMinutes}m (threshold ${t.failedLogins}).`,
  });

  return { generated_at: new Date().toISOString(), thresholds: t, count: anomalies.length, anomalies };
}


function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Pure: turn a detect result into an email {subject, html, text}. No side effects (testable alone).
function formatAnomalyEmail(result) {
  const a = (result && result.anomalies) || [];
  const win = result && result.thresholds ? result.thresholds.windowMinutes : '';
  const subject = `[FinFlow security] ${a.length} audit anomal${a.length === 1 ? 'y' : 'ies'} detected`;
  const items = a.map(x => `<li><b>${_esc(x.type)}</b> <span style="color:#b45">(${_esc(x.severity)})</span> — ${_esc(x.message)}</li>`).join('');
  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
    <h2 style="color:#c9a84c;margin:0 0 8px">FinFlow — security alert</h2>
    <p>${a.length} anomal${a.length === 1 ? 'y' : 'ies'} detected in the last ${_esc(win)} minutes:</p>
    <ul>${items}</ul>
    <p style="color:#888;font-size:12px">Automated scan of the audit trail. Review in the admin console.</p></div>`;
  const text = `FinFlow security alert — ${a.length} anomaly(ies):\n` + a.map(x => `- [${x.severity}] ${x.type}: ${x.message}`).join('\n');
  return { subject, html, text };
}

// Scan + (if anomalies) email a digest via the Resend client. Returns a status object; never throws
// on a missing recipient/client (returns sent:false with a reason). Delivery for the anomaly detector.
async function notifyAnomalies(pool, resendClient, opts = {}) {
  const result = await detectAuditAnomalies(pool, opts.over || {});
  const to = opts.to || process.env.SECURITY_ALERT_EMAIL || null;
  if (result.count === 0) return { count: 0, sent: false, reason: 'no anomalies', to };
  if (!resendClient)      return { count: result.count, sent: false, reason: 'email not configured (no Resend client)', to };
  if (!to)                return { count: result.count, sent: false, reason: 'no recipient (set SECURITY_ALERT_EMAIL)', to: null };
  const mail = formatAnomalyEmail(result);
  await resendClient.emails.send({ from: opts.from || process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>', to, subject: mail.subject, html: mail.html });
  return { count: result.count, sent: true, to, subject: mail.subject, anomalies: result.anomalies };
}

// Periodic background scan → alert. Guarded: does nothing unless a recipient is configured
// (SECURITY_ALERT_EMAIL) or opts.enabled is set. The timer is unref'd so it never holds the process
// open. Returns { handle, tick, everyMinutes } when armed, or null when disabled. Overlap-safe.
function startAnomalyMonitor(pool, resendClient, opts = {}) {
  const enabled = opts.enabled != null ? opts.enabled : !!process.env.SECURITY_ALERT_EMAIL;
  if (!enabled) return null;
  const everyMinutes = _int(opts.everyMinutes ?? process.env.AUDIT_ANOMALY_SCAN_MIN, 60);
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const r = await notifyAnomalies(pool, resendClient, opts);
      if (r && r.sent) console.log('[anomaly-monitor] alert emailed —', r.count, 'anomaly(ies)');
    } catch (e) { console.error('[anomaly-monitor] tick failed:', e.message); }
    finally { running = false; }
  };
  const handle = setInterval(tick, everyMinutes * 60 * 1000);
  if (handle.unref) handle.unref();
  return { handle, tick, everyMinutes };
}

module.exports = { detectAuditAnomalies, thresholds, formatAnomalyEmail, notifyAnomalies, startAnomalyMonitor };
