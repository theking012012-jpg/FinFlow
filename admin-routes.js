'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// FINFLOW ADMIN ROUTES
// Protected by ADMIN_PASSWORD env var — set this before deploying
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { appUrl } = require('./app-url'); // F29 — single source of truth for app links

// Single source of truth for FinFlow subscription prices (monthly USD) — used by both /overview MRR and
// /costs revenue so the platform figure can never drift between pages (it once hardcoded a stale $199).
const FF_PLAN_PRICE = { pro: 79, business: 249, scale: 400 };   // enterprise = custom quote

const adminLoginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, skipSuccessfulRequests: true });

const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

const { detectAuditAnomalies, notifyAnomalies } = require('./audit-anomalies');
const { emailHtml } = require('./email-html'); // N85 — email bodies escape their interpolations
const earningsFigures = require('./earnings-figures');   // FA-L3g: the one writer of the commission / earnings figures

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

module.exports = function registerAdminRoutes(app, pool, stripe, resendClient) {

  // ── LC3g: THE admin audit write ──────────────────────────────────────────────────────────────────────────────
  // Every admin action goes through here: what, on what, before → after, outcome, and WHERE it came from (IP,
  // browser, and a one-way fingerprint of the admin session — there is one shared admin password, so the session is
  // the finest identity there is). admin_log is append-only at the database (admin_log_no_mutate). A failed write is
  // reported loudly, never swallowed.
  const _sessRef = req => (req.sessionID ? crypto.createHash('sha256').update(String(req.sessionID)).digest('hex').slice(0, 16) : null);
  async function adminAudit(req, action, targetType, targetId, { notes = null, before = null, after = null, outcome = 'ok' } = {}) {
    try {
      await pool.query(
        `INSERT INTO admin_log (action, target_type, target_id, notes, ip, user_agent, session_ref, before_data, after_data, outcome, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [action, targetType || null, targetId == null ? null : (parseInt(targetId, 10) || null), notes == null ? null : String(notes).slice(0, 1000),
         req.clientIp || req.ip || null, String((req.get && req.get('user-agent')) || '').slice(0, 300) || null, _sessRef(req),   // LR26
         before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), outcome]);
    } catch (e) { console.error('[admin] AUDIT WRITE FAILED for', action, targetType, targetId, ':', e.message); }
  }
  // LC3g (better than the standard): an admin change to a CUSTOMER's account also lands on that customer's own audit
  // trail (actor 'admin'), so they can see what FinFlow support changed and when. Account-level (entity NULL, table
  // 'users') — never business or personal records.
  async function customerTrail(req, userId, oldData, newData) {
    try {
      await pool.query(
        `INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, old_data, new_data, actor_type, actor_id, ip_address)
         VALUES ($1, NULL, 'users', $1, 'UPDATE', $2, $3, 'admin', NULL, $4)`,
        [userId, oldData == null ? null : JSON.stringify(oldData), newData == null ? null : JSON.stringify(newData), req.clientIp || req.ip || null]);   // LR26
    } catch (e) { console.error('[admin] customer trail write failed for user', userId, ':', e.message); }
  }
  const _userState = async id => (await pool.query(
    `SELECT data->>'plan' AS plan, data->>'trial_ends' AS trial_ends, COALESCE(data->>'suspended', '') = 'true' AS suspended,
            COALESCE(data->>'deleted', '') = 'true' AS deleted, data->>'email' AS email FROM users WHERE id = $1`, [id])).rows[0] || null;

  // ── ADMIN LOGIN ───────────────────────────────────────────────────────────
  // N89: failed admin logins are recorded HERE, by the server, from what it observed (reason + client
  // IP). The security log used to be filled by an unauthenticated client-callable endpoint, so anyone
  // could write arbitrary entries into it and a real attacker simply never called it.
  // LC3g-c: the refusal is recorded BEFORE the 401 goes out — a write left running could be lost (or be read before it
  // landed). adminAudit never throws, so a log failure still cannot turn a refusal into a 500.
  const failedAdminLogin = async (req, res, reason, body) => {
    await adminAudit(req, 'failed_login', 'security', null, { notes: String(reason + ' from ' + (req.clientIp || req.ip || 'unknown')).slice(0, 500), outcome: 'refused' });
    return res.status(401).json(body);
  };
  app.post('/api/admin/login', adminLoginLimiter, wrap(async (req, res) => {
    const { password } = req.body || {};
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD not configured.' });
    if (!password) return failedAdminLogin(req, res, 'Missing password', { error: 'Invalid password.' });
    try {
      const a = Buffer.alloc(72); Buffer.from(password).copy(a);
      const b = Buffer.alloc(72); Buffer.from(ADMIN_PASSWORD).copy(b);
      if (!crypto.timingSafeEqual(a, b)) return failedAdminLogin(req, res, 'Wrong password', { error: 'Invalid password.' });
    } catch(e) {
      return failedAdminLogin(req, res, 'Wrong password', { error: 'Invalid password.' });
    }
    // Admin MFA (opt-in): once ADMIN_TOTP_SECRET is set, a valid 6-digit TOTP is also required.
    // Backward-compatible — unset means password-only, so enabling it can't lock you out mid-flight.
    const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET;
    if (ADMIN_TOTP_SECRET && ADMIN_TOTP_SECRET.trim()) {
      const { token } = req.body || {};
      if (!token) return res.status(401).json({ error: 'MFA code required.', mfaRequired: true });
      let totp = null; try { totp = require('./totp'); } catch (_) {}
      if (!totp || !totp.verify(String(token), ADMIN_TOTP_SECRET.trim())) {
        return failedAdminLogin(req, res, 'Correct password, invalid MFA code', { error: 'Invalid MFA code.', mfaRequired: true });
      }
    }
    await require('./session-auth').establishSession(req, { isAdmin: true });   // N73: fresh session id
    await adminAudit(req, 'admin_login', 'security', null, { notes: ADMIN_TOTP_SECRET && ADMIN_TOTP_SECRET.trim() ? 'password + MFA' : 'password only' });   // LC3g
    return res.json({ success: true });
  }));

  app.post('/api/admin/logout', wrap(async (req, res) => {
    if (req.session.isAdmin) await adminAudit(req, 'admin_logout', 'security', null);   // LC3g — before the session loses its admin flag
    req.session.isAdmin = false;
    req.session.save(() => res.json({ ok: true }));
  }));

  app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: true }));

  // Read-only anomaly scan over the append-only audit trail (assume-breach / detect-fast).
  app.get('/api/admin/audit-anomalies', requireAdmin, async (req, res) => {
    try {
      const over = {};
      if (req.query.window) over.windowMinutes = parseInt(req.query.window, 10);
      res.json(await detectAuditAnomalies(pool, over));
    } catch (e) { console.error('[admin] audit-anomalies scan failed:', e.message); res.status(500).json({ error: 'Anomaly scan failed.' }); }
  });

  // Scan + email a digest via Resend (delivery channel for the anomaly detector). Recipient from
  // SECURITY_ALERT_EMAIL. Safe no-ops (sent:false + reason) when nothing to send or email unconfigured.
  app.post('/api/admin/audit-anomalies/notify', requireAdmin, async (req, res) => {
    try {
      const over = {};
      if (req.query.window) over.windowMinutes = parseInt(req.query.window, 10);
      const _r = await notifyAnomalies(pool, resendClient, { over });
      await adminAudit(req, 'audit_anomalies_notify', 'security', null, { after: _r });   // LC3g
      res.json(_r);
    } catch (e) { console.error('[admin] audit-anomalies notify failed:', e.message); res.status(500).json({ error: 'Notify failed.' }); }
  });

  // ── PLATFORM OVERVIEW ─────────────────────────────────────────────────────
  app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
    const [
      usersTotal, usersToday, usersWeek, usersMonth,
      accountantsTotal, accountantsPending, accountantsVerified,
      reportsTotal, reportsOpen,
      platformEarnings,
      aiCacheTotal, aiCacheMonth,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users`),
      pool.query(`SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '1 day'`),
      pool.query(`SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`),
      pool.query(`SELECT COUNT(*) FROM accountants`),
      pool.query(`SELECT COUNT(*) FROM accountants WHERE status = 'pending'`),
      pool.query(`SELECT COUNT(*) FROM accountants WHERE status = 'verified'`),
      pool.query(`SELECT COUNT(*) FROM accountant_reports`),
      pool.query(`SELECT COUNT(*) FROM accountant_reports WHERE created_at >= NOW() - INTERVAL '30 days'`),
      earningsFigures.platformFigures(pool),   // FA-L3g (was: Σ amount_cents of every row — accountants' money, not FinFlow's)
      pool.query(`SELECT COUNT(*) FROM ai_cache`),
      pool.query(`SELECT COUNT(*) FROM ai_cache WHERE created_at >= NOW() - INTERVAL '30 days'`),
    ]);

    // Monthly new users for chart (last 6 months)
    const monthlyUsers = await pool.query(`
      SELECT (DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'))::date AS month, COUNT(*) AS count   -- FA-L3f: a calendar month (DATE string), not an instant
      FROM users WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY month ORDER BY month ASC
    `);

    // Subscription breakdown
    const subBreakdown = await pool.query(`
      SELECT data->>'plan' AS plan, COUNT(*) AS count
      FROM users GROUP BY plan ORDER BY count DESC
    `);
    // Platform MRR, computed server-side (authoritative) so the Overview card never does browser math.
    const _platformMRR = subBreakdown.rows.reduce(
      (sum, r) => sum + (FF_PLAN_PRICE[String(r.plan || '').toLowerCase()] || 0) * parseInt(r.count || 0), 0);

    return res.json({
      users: {
        total: parseInt(usersTotal.rows[0].count),
        today: parseInt(usersToday.rows[0].count),
        week: parseInt(usersWeek.rows[0].count),
        month: parseInt(usersMonth.rows[0].count),
        monthly: monthlyUsers.rows,
        plans: subBreakdown.rows,
      },
      accountants: {
        total: parseInt(accountantsTotal.rows[0].count),
        pending: parseInt(accountantsPending.rows[0].count),
        verified: parseInt(accountantsVerified.rows[0].count),
      },
      reports: {
        total: parseInt(reportsTotal.rows[0].count),
        recent: parseInt(reportsOpen.rows[0].count),
      },
      earnings: {
        // FA-L3g: "Commission Earned" = FinFlow's commission on bills clients PAID; the sub-line is referral pay owed
        commissionCollectedCents: platformEarnings.commissionCollectedCents,
        referralOwedCents: platformEarnings.referralOwedCents,
        totalCents: platformEarnings.commissionCollectedCents,
        pendingCents: platformEarnings.referralOwedCents,
        totalFormatted: '$' + (platformEarnings.commissionCollectedCents / 100).toFixed(2),
        pendingFormatted: '$' + (platformEarnings.referralOwedCents / 100).toFixed(2),
      },
      ai: {
        totalQueries: parseInt(aiCacheTotal.rows[0].count),
        monthQueries: parseInt(aiCacheMonth.rows[0].count),
        // Estimate cost: Claude Sonnet ~$0.003 per query average
        estimatedMonthlyCost: '$' + (parseInt(aiCacheMonth.rows[0].count) * 0.003).toFixed(2),
        estimatedTotalCost: '$' + (parseInt(aiCacheTotal.rows[0].count) * 0.003).toFixed(2),
      },
      revenue: { mrr: _platformMRR },
    });
  }));

  // ── ACCOUNTANT MANAGEMENT ─────────────────────────────────────────────────
  app.get('/api/admin/accountants', requireAdmin, wrap(async (req, res) => {
    const { status, search } = req.query;
    let query = `
      SELECT a.id, a.first_name, a.last_name, a.email, a.firm, a.country,
             a.specialisation, a.experience, a.status, a.verification_method,
             a.verification_data, a.credentials, a.memberships, a.confirmed_credentials, a.avg_rating, a.preferred_partner,
             a.kyc_status, a.kyc_verified_at,
             a.review_count, a.stripe_onboarded, a.created_at, a.verified_at,
             -- FA-L3g: subqueries, not two joined one-to-many tables (that multiplied clients × earnings rows)
             (SELECT COUNT(*) FROM accountant_clients ac WHERE ac.accountant_id = a.id AND ac.status = 'active') AS client_count,
             (SELECT COALESCE(SUM(ae.amount_cents), 0) FROM accountant_earnings ae WHERE ae.accountant_id = a.id AND ae.${earningsFigures.EARNED_SQL}) AS total_earnings_cents
      FROM accountants a
    `;
    const params = [];
    const conditions = [];
    if (status) { params.push(status); conditions.push(`a.status = $${params.length}`); }
    if (search) { const safe = search.replace(/[%_\\]/g, '\\$&'); params.push(`%${safe}%`); conditions.push(`(a.first_name ILIKE $${params.length} ESCAPE '\\' OR a.last_name ILIKE $${params.length} ESCAPE '\\' OR a.email ILIKE $${params.length} ESCAPE '\\' OR a.firm ILIKE $${params.length} ESCAPE '\\')`); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' GROUP BY a.id ORDER BY a.created_at DESC LIMIT 100';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  }));

  // Approve or reject accountant
  app.post('/api/admin/accountants/:id/verify', requireAdmin, wrap(async (req, res) => {
    const { action, notes } = req.body || {};
    if (!['approve', 'reject', 'suspend', 'reinstate'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action.' });
    }
    const statusMap = { approve: 'verified', reject: 'rejected', suspend: 'suspended', reinstate: 'verified' };
    const newStatus = statusMap[action];

    // Step G (F28): on approve/reinstate the admin records what they CONFIRMED from the
    // reviewed credential document — this is the only credential text clients ever see.
    // Null on reject/suspend (and on approve with no text) → COALESCE keeps the prior value.
    const confirmed = (action === 'approve' || action === 'reinstate') && typeof req.body.confirmedCredentials === 'string'
      ? req.body.confirmedCredentials.trim().slice(0, 300)
      : null;

    const _accId = (parseInt(req.params.id, 10) || 0);
    const _accBefore = (await pool.query(`SELECT status, confirmed_credentials FROM accountants WHERE id = $1`, [_accId])).rows[0] || null;
    await pool.query(
      `UPDATE accountants SET status = $1, verified_at = $2,
         confirmed_credentials = COALESCE($3, confirmed_credentials), updated_at = NOW()
       WHERE id = $4`,
      [newStatus, action === 'approve' || action === 'reinstate' ? new Date() : null, confirmed, _accId]
    );
    const _accAfter = (await pool.query(`SELECT status, confirmed_credentials FROM accountants WHERE id = $1`, [_accId])).rows[0] || null;
    await adminAudit(req, `accountant_${action}`, 'accountant', _accId, { notes: notes || '', before: _accBefore, after: _accAfter });   // LC3g

    // Send email notification if Resend configured
    if (resendClient) {
      const acc = await pool.query('SELECT email, first_name FROM accountants WHERE id = $1', [(parseInt(req.params.id, 10) || 0)]);
      if (acc.rows[0]) {
        const { email, first_name } = acc.rows[0];
        const subject = action === 'approve'
          ? 'Your FinFlow accountant profile is now live ✓'
          : action === 'reject'
          ? 'Update on your FinFlow application'
          : `Your FinFlow account has been ${newStatus}`;
        const body = action === 'approve'
          ? emailHtml`<p>Hi ${first_name},</p><p>Great news — your FinFlow accountant profile has been <strong>verified and is now live</strong> in our professional directory.</p><p>Log in to your dashboard to start inviting clients and earning referral commissions.</p><a href="${appUrl()}/accountant-login" style="display:inline-block;background:#c9a84c;color:#0e0e0c;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Go to dashboard →</a>`
          : action === 'reject'
          ? emailHtml`<p>Hi ${first_name},</p><p>Thank you for applying to the FinFlow Professional Network. Unfortunately we were unable to verify your credentials at this time.</p>${notes ? emailHtml`<p>Notes: ${notes}</p>` : ''}<p>You're welcome to reapply once you have updated credentials.</p>`
          : emailHtml`<p>Hi ${first_name},</p><p>Your FinFlow accountant account status has been updated to: <strong>${newStatus}</strong>.</p>${notes ? emailHtml`<p>Reason: ${notes}</p>` : ''}`;

        await resendClient.emails.send({
          from: process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
          to: email,
          subject,
          html: String(emailHtml`<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0e0e0c;color:#f0ead6;border-radius:12px"><h2 style="color:#c9a84c;margin-bottom:16px">FinFlow</h2>${body}</div>`),
        }).catch(e => console.error('[Admin Email]', e.message));
      }
    }

    return res.json({ success: true, status: newStatus });
  }));

  // Step F — accountant credential documents. Metadata list (file_data stripped)
  // and a download that streams the file so the admin can view the real proof
  // before approving/rejecting. Scoped by accountant_id so the doc id can't be
  // used to fetch another accountant's document.
  app.get('/api/admin/accountants/:id/documents', requireAdmin, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
    const { rows } = await pool.query(
      `SELECT id, doc_type, file_name, media_type, size_bytes, uploaded_at
         FROM accountant_documents WHERE accountant_id = $1 ORDER BY uploaded_at DESC`,
      [id]
    );
    return res.json(rows);
  }));

  app.get('/api/admin/accountants/:id/documents/:docId/download', requireAdmin, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const docId = parseInt(req.params.docId, 10);
    if (!id || id <= 0 || !docId || docId <= 0) return res.status(400).json({ error: 'Invalid id.' });
    const { rows } = await pool.query(
      `SELECT file_name, media_type, file_data FROM accountant_documents WHERE id = $1 AND accountant_id = $2`,
      [docId, id]
    );
    const row = rows[0];
    if (!row || !row.file_data) return res.status(404).json({ error: 'Document not found.' });
    const buf = Buffer.from(row.file_data, 'base64');
    const safeName = (row.file_name || 'credential').replace(/[^\w\s.\-]/g, '_');
    res.setHeader('Content-Type', row.media_type || 'application/octet-stream');
    // inline so PDFs/images open in a tab for review (still downloadable)
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.send(buf);
  }));

  // Toggle Preferred Partner badge manually
  app.post('/api/admin/accountants/:id/preferred-partner', requireAdmin, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
    const result = await pool.query(
      `UPDATE accountants SET preferred_partner = NOT COALESCE(preferred_partner, false) WHERE id = $1 RETURNING preferred_partner`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Accountant not found.' });
    await adminAudit(req, 'accountant_preferred_partner', 'accountant', id, { before: { preferred_partner: !result.rows[0].preferred_partner }, after: { preferred_partner: result.rows[0].preferred_partner } });   // LC3g
    return res.json({ success: true, preferred_partner: result.rows[0].preferred_partner });
  }));

  // /preferred alias — frontend calls /preferred, backend was only registered at /preferred-partner
  app.post('/api/admin/accountants/:id/preferred', requireAdmin, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
    const { rows } = await pool.query(
      `UPDATE accountants SET preferred_partner = NOT COALESCE(preferred_partner, false)
       WHERE id = $1 RETURNING id, preferred_partner`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Accountant not found.' });
    await adminAudit(req, 'accountant_preferred_partner', 'accountant', id, { before: { preferred_partner: !rows[0].preferred_partner }, after: { preferred_partner: rows[0].preferred_partner } });   // LC3g
    res.json({ ok: true, preferred_partner: rows[0].preferred_partner });
  }));

  // ── CLIENT MANAGEMENT ─────────────────────────────────────────────────────
  app.get('/api/admin/users', requireAdmin, wrap(async (req, res) => {
    const { search, plan } = req.query;
    let query = `
      SELECT u.id, u.data->>'name' AS name, u.data->>'email' AS email,
             u.data->>'plan' AS plan, u.data->>'subscriptionStatus' AS sub_status,
             u.data->>'suspended' AS suspended, u.created_at,
             a.first_name AS accountant_first, a.last_name AS accountant_last,
             a.firm AS accountant_firm
      FROM users u
      LEFT JOIN accountant_clients ac ON ac.user_id = u.id AND ac.status = 'active'
      LEFT JOIN accountants a ON a.id = ac.accountant_id
    `;
    const params = [];
    const conditions = [];
    if (search) { const safe = search.replace(/[%_\\]/g, '\\$&'); params.push(`%${safe}%`); conditions.push(`(u.data->>'name' ILIKE $${params.length} ESCAPE '\\' OR u.data->>'email' ILIKE $${params.length} ESCAPE '\\')`); }
    if (plan) { params.push(plan); conditions.push(`u.data->>'plan' = $${params.length}`); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY u.created_at DESC LIMIT 200';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  }));

  // ── AUDITED CSV EXPORTS ─────────────────────────────────────────────────────
  // PII leaves the system here, so the download goes through the server and writes an
  // admin_log row — the client-side data: URI export left no trace of who exported what.
  const _csvEsc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  app.get('/api/admin/export/users.csv', requireAdmin, wrap(async (req, res) => {
    const r = await pool.query(`
      SELECT u.id, u.data->>'name' AS name, u.data->>'email' AS email,
             u.data->>'plan' AS plan, u.created_at,
             a.first_name AS accountant_first, a.last_name AS accountant_last
      FROM users u
      LEFT JOIN accountant_clients ac ON ac.user_id = u.id AND ac.status = 'active'
      LEFT JOIN accountants a ON a.id = ac.accountant_id
      ORDER BY u.created_at DESC LIMIT 10000`);
    await adminAudit(req, 'export_users_csv', 'users', null, { notes: 'Exported ' + r.rows.length + ' users to CSV', after: { rows: r.rows.length } });   // LC3g
    const header = ['ID','Name','Email','Plan','Joined','Accountant'];
    const body = r.rows.map(u => [u.id, u.name||'', u.email||'', u.plan||'trial',
      u.created_at ? new Date(u.created_at).toISOString().slice(0,10) : '',
      u.accountant_first ? (u.accountant_first + ' ' + u.accountant_last) : ''].map(_csvEsc).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    return res.send([header.join(','), ...body].join('\n'));
  }));

  app.get('/api/admin/export/accountants.csv', requireAdmin, wrap(async (req, res) => {
    const r = await pool.query(`
      SELECT a.id, a.first_name, a.last_name, a.firm, a.country, a.status, a.avg_rating,
             COUNT(ac.id) AS client_count
      FROM accountants a
      LEFT JOIN accountant_clients ac ON ac.accountant_id = a.id AND ac.status = 'active'
      GROUP BY a.id ORDER BY a.created_at DESC LIMIT 10000`);
    await adminAudit(req, 'export_accountants_csv', 'accountants', null, { notes: 'Exported ' + r.rows.length + ' accountants to CSV', after: { rows: r.rows.length } });   // LC3g
    const header = ['ID','Name','Firm','Country','Status','Clients','Rating'];
    const body = r.rows.map(a => [a.id, ((a.first_name||'') + ' ' + (a.last_name||'')).trim(), a.firm||'', a.country||'',
      a.status||'', a.client_count||0, a.avg_rating ? parseFloat(a.avg_rating).toFixed(1) : ''].map(_csvEsc).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="accountants.csv"');
    return res.send([header.join(','), ...body].join('\n'));
  }));

  // Suspend / unsuspend user
  app.post('/api/admin/users/:id/suspend', requireAdmin, wrap(async (req, res) => {
    const suspend = req.body?.suspend === true || req.body?.suspend === 'true';
    const _uid = (parseInt(req.params.id, 10) || 0);
    const _b = await _userState(_uid);
    await pool.query(
      `UPDATE users SET data = data || $1 WHERE id = $2`,
      [JSON.stringify({ suspended: suspend ? 'true' : 'false' }), _uid]
    );
    if (_b) {   // LC3g
      await adminAudit(req, suspend ? 'user_suspend' : 'user_reinstate', 'user', _uid, { before: { suspended: _b.suspended }, after: { suspended: suspend } });
      await customerTrail(req, _uid, { suspended: _b.suspended }, { suspended: suspend });
    }
    return res.json({ ok: true });
  }));

  app.post('/api/admin/users/:id/unsuspend', requireAdmin, wrap(async (req, res) => {
    const _uid = (parseInt(req.params.id, 10) || 0);
    const _b = await _userState(_uid);
    await pool.query(`UPDATE users SET data = jsonb_set(COALESCE(data,'{}'), '{suspended}', 'false') WHERE id = $1`, [_uid]);
    if (_b) {   // LC3g
      await adminAudit(req, 'user_unsuspend', 'user', _uid, { before: { suspended: _b.suspended }, after: { suspended: false } });
      await customerTrail(req, _uid, { suspended: _b.suspended }, { suspended: false });
    }
    res.json({ ok: true });
  }));

  // Override user plan
  app.post('/api/admin/users/:id/plan', requireAdmin, wrap(async (req, res) => {
    const { plan } = req.body || {};
    // N87: 'scale' is a real plan (checkout, entity limits, AI caps all know it) but was missing here and
    // in the admin dropdown — a Scale customer's row showed "Trial" pre-selected, so one Save downgraded
    // them. Setting 'trial' stamps trial_ends when there is none: checkPlan only restricts a trial WITH an
    // end date, so a null end meant unlimited write access (the N4 class). An existing end is kept.
    if (!['trial', 'pro', 'business', 'scale', 'enterprise'].includes(plan)) return res.status(400).json({ error: 'Invalid plan.' });
    const uidT = (parseInt(req.params.id, 10) || 0);
    const _b = await _userState(uidT);
    if (plan === 'trial') {
      await pool.query(
        `UPDATE users SET data = data || jsonb_build_object('plan', 'trial'::text, 'trial_ends', COALESCE(NULLIF(data->>'trial_ends', ''), $2::text)) WHERE id = $1`,
        [uidT, new Date().toISOString()]);
    } else {
      await pool.query(`UPDATE users SET data = data || $1 WHERE id = $2`, [JSON.stringify({ plan }), uidT]);
    }
    const _a = await _userState(uidT);
    if (_b && _a) {   // LC3g
      await adminAudit(req, 'user_plan_override', 'user', uidT, { notes: `Set plan to ${plan}`, before: { plan: _b.plan, trial_ends: _b.trial_ends }, after: { plan: _a.plan, trial_ends: _a.trial_ends } });
      await customerTrail(req, uidT, { plan: _b.plan }, { plan: _a.plan });
    }
    return res.json({ success: true });
  }));

  // ── REPORTS ───────────────────────────────────────────────────────────────
  app.get('/api/admin/reports', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT r.id, r.reason, r.category, r.status AS report_status, r.resolved_at, r.resolved_by, r.created_at,
             r.respond_by, r.acknowledged_at, r.accountant_notified_at,
             a.id AS accountant_id, a.first_name, a.last_name, a.firm, a.email, a.status,
             u.data->>'name' AS reporter_name, u.data->>'email' AS reporter_email
      FROM accountant_reports r
      JOIN accountants a ON a.id = r.accountant_id
      LEFT JOIN users u ON u.id = r.reporter_id
      ORDER BY (r.status = 'open') DESC, (r.acknowledged_at IS NULL) DESC, r.respond_by ASC NULLS LAST, r.created_at DESC LIMIT 100
    `);
    // D-E: overdue = open, not yet acknowledged, and past the date the client was promised
    const now = Date.now();
    return res.json(result.rows.map(r => Object.assign(r, { overdue: r.report_status === 'open' && !r.acknowledged_at && !!r.respond_by && new Date(r.respond_by).getTime() < now })));
  }));

  // D-E: the two promises of conduct policy §9, each done once and logged. Acknowledge → the client is emailed that the
  // report is being looked at. Tell the accountant → they are emailed the category and asked for their response; the
  // client is never named (the policy's 'unless that would put the client at risk' is the admin's call: don't press it).
  const _rptMail = async (to, subject, html) => {
    if (!resendClient || !process.env.EMAIL_FROM || !to) return false;
    try { await resendClient.emails.send({ from: process.env.EMAIL_FROM, to, subject, html: String(html), reply_to: process.env.SUPPORT_EMAIL || undefined }); return true; }
    catch (e) { console.error('[admin report email]', e.message); return false; }
  };
  app.post('/api/admin/reports/:id/acknowledge', requireAdmin, wrap(async (req, res) => {
    const _rid = parseInt(req.params.id, 10) || 0;
    const { rows: [r] } = await pool.query(`UPDATE accountant_reports SET acknowledged_at = NOW() WHERE id = $1 AND acknowledged_at IS NULL RETURNING id, reporter_id, category`, [_rid]);
    if (!r) return res.json({ success: true, already: true });
    const { rows: [u] } = await pool.query(`SELECT data->>'email' AS email FROM users WHERE id = $1`, [r.reporter_id]);
    const mailed = await _rptMail(u && u.email, 'We received your report', emailHtml`<p>Thank you — we have received your report (reference R-${r.id}) and are looking into it.</p><p>We may contact you for more detail. You can keep working with your accountant in FinFlow meanwhile.</p>`);
    await adminAudit(req, 'report_acknowledge', 'report', _rid, { after: { acknowledged: true, emailed: mailed } });
    res.json({ success: true, emailed: mailed });
  }));
  app.post('/api/admin/reports/:id/notify-accountant', requireAdmin, wrap(async (req, res) => {
    const _rid = parseInt(req.params.id, 10) || 0;
    const { rows: [r] } = await pool.query(`UPDATE accountant_reports SET accountant_notified_at = NOW() WHERE id = $1 AND accountant_notified_at IS NULL RETURNING id, accountant_id, category`, [_rid]);
    if (!r) return res.json({ success: true, already: true });
    const { rows: [a] } = await pool.query(`SELECT email, first_name FROM accountants WHERE id = $1`, [r.accountant_id]);
    const mailed = await _rptMail(a && a.email, 'A client has raised a concern (R-' + r.id + ')', emailHtml`<p>Hello ${(a && a.first_name) || ''},</p><p>A client has raised a concern about your work on FinFlow (category: ${r.category || 'other'}, reference R-${r.id}). Under the Professional Conduct Policy (section 9) we ask for your response.</p><p>Please reply to this email within 14 days with your account of what happened. No decision has been made.</p>`);
    await adminAudit(req, 'report_notify_accountant', 'report', _rid, { after: { accountant_notified: true, emailed: mailed } });
    res.json({ success: true, emailed: mailed });
  }));

  app.post('/api/admin/reports/:id/dismiss', requireAdmin, wrap(async (req, res) => {
    // Non-destructive: keep the row as the moderation trail (was a hard DELETE, which erased history).
    // 'dismissed' = reviewed, no action warranted.
    const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
    const _rid = (parseInt(req.params.id, 10) || 0);
    const _rb = (await pool.query(`SELECT status, resolution FROM accountant_reports WHERE id = $1`, [_rid])).rows[0] || null;
    await pool.query(
      `UPDATE accountant_reports SET status='dismissed', resolved_at=NOW(), resolved_by='admin', resolution=$2 WHERE id=$1`,
      [_rid, note || null]);
    if (_rb) await adminAudit(req, 'report_dismiss', 'report', _rid, { before: _rb, after: { status: 'dismissed', resolution: note || null } });   // LC3g
    return res.json({ success: true });
  }));

  app.post('/api/admin/reports/:id/resolve', requireAdmin, wrap(async (req, res) => {
    // 'resolved' = reviewed AND acted on (e.g. accountant warned/suspended). Row retained for the trail.
    const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
    const _rid = (parseInt(req.params.id, 10) || 0);
    const _rb = (await pool.query(`SELECT status, resolution FROM accountant_reports WHERE id = $1`, [_rid])).rows[0] || null;
    await pool.query(
      `UPDATE accountant_reports SET status='resolved', resolved_at=NOW(), resolved_by='admin', resolution=$2 WHERE id=$1`,
      [_rid, note || null]);
    if (_rb) await adminAudit(req, 'report_resolve', 'report', _rid, { before: _rb, after: { status: 'resolved', resolution: note || null } });   // LC3g
    return res.json({ success: true });
  }));

  // ── EARNINGS & PAYOUTS ────────────────────────────────────────────────────
  app.get('/api/admin/earnings', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT ae.id, ae.type, ae.amount_cents, ae.description, ae.status, ae.period_month, ae.created_at, ae.payout_id,
             rp.status AS payout_status,
             a.first_name, a.last_name, a.firm
      FROM accountant_earnings ae
      JOIN accountants a ON a.id = ae.accountant_id
      LEFT JOIN referral_payouts rp ON rp.id = ae.payout_id
      ORDER BY ae.created_at DESC LIMIT 200
    `);
    // FA-L3d: the Stripe transfers that pay referral pay — a failed one names Stripe's reason and needs a person
    const payouts = await pool.query(`
      SELECT rp.id, rp.period_month, rp.amount_cents, rp.currency, rp.status, rp.stripe_transfer_id, rp.attempts, rp.last_error,
             rp.sent_at, rp.updated_at, a.first_name, a.last_name, a.firm
      FROM referral_payouts rp JOIN accountants a ON a.id = rp.accountant_id
      ORDER BY (rp.status = 'failed') DESC, rp.updated_at DESC LIMIT 100
    `);

    const summary = await pool.query(`
      SELECT
        COUNT(*) AS total_records,
        COALESCE(SUM(amount_cents),0) AS total_cents,
        COALESCE(SUM(CASE WHEN status='pending' THEN amount_cents ELSE 0 END),0) AS pending_cents,
        COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0) AS paid_cents,
        COALESCE(SUM(CASE WHEN type='service_commission' THEN amount_cents ELSE 0 END),0) AS commission_cents,
        COALESCE(SUM(CASE WHEN type='referral' THEN amount_cents ELSE 0 END),0) AS referral_cents,
        -- FA-L3d: referral pay still owed = booked, not yet paid (was: every referral row, paid ones included)
        COALESCE(SUM(CASE WHEN type='referral' AND status='pending' THEN amount_cents ELSE 0 END),0) AS referral_owed_cents
      FROM accountant_earnings
    `);
    // FA-L3g: FinFlow's commission on PAID bills, from the one writer (commission_cents above is the accountants' nets)
    summary.rows[0].commission_collected_cents = (await earningsFigures.platformFigures(pool)).commissionCollectedCents;

    return res.json({ records: result.rows, summary: summary.rows[0], payouts: payouts.rows });
  }));

  // Mark payouts as paid
  app.post('/api/admin/earnings/mark-paid', requireAdmin, wrap(async (req, res) => {
    const { ids } = req.body || {};
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided.' });
    // FA-L3d: referral pay is sent by Stripe transfer (referral-payouts.js). Marking by hand is for pay sent OUTSIDE
    // Stripe only: a row a transfer is paying (payout_id set) or a bill the client has not paid ('awaiting_payment')
    // is refused, so nothing is paid twice and nothing unpaid is marked paid.
    const _eb = (await pool.query(`SELECT id, accountant_id, type, amount_cents, status FROM accountant_earnings WHERE id = ANY($1) AND status = 'pending' AND payout_id IS NULL ORDER BY id`, [ids])).rows;
    const _ok = _eb.map(e => e.id);
    if (_ok.length) await pool.query(`UPDATE accountant_earnings SET status = 'paid' WHERE id = ANY($1) AND status = 'pending' AND payout_id IS NULL`, [_ok]);
    const _refused = ids.filter(i => !_ok.includes(Number(i)));
    // Audit: a payout state change is a money action — each payout's amount and prior status, before → after (LC3g).
    await adminAudit(req, 'earnings_mark_paid', 'earnings', _ok.length === 1 ? _ok[0] : null, {
      notes: 'Marked ' + _ok.length + ' earning(s) paid: #' + _ok.join(', #') + (_refused.length ? ' · refused #' + _refused.join(', #') + ' (sent by Stripe transfer, already paid, or not paid by the client)' : ''),
      before: _eb, after: _eb.map(e => Object.assign({}, e, { status: 'paid' })) });
    return res.json({ success: true, updated: _ok.length, refused: _refused });
  }));

  // ── AI & COST TRACKING ────────────────────────────────────────────────────
  app.get('/api/admin/costs', requireAdmin, wrap(async (req, res) => {
    // AI usage from cache
    const aiUsage = await pool.query(`
      SELECT
        model,
        COUNT(*) AS queries,
        DATE_TRUNC('month', created_at) AS month
      FROM ai_cache
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY model, month
      ORDER BY month DESC
    `);

    const aiTotal = await pool.query(`SELECT COUNT(*), model FROM ai_cache GROUP BY model`);

    // Resume extractions (these cost more — full document)
    const resumeCount = await pool.query(`
      SELECT COUNT(*) FROM ai_cache WHERE question LIKE '%resume%' OR question LIKE '%CV%'
    `).catch(() => ({ rows: [{ count: 0 }] }));

    // Stripe balance if configured
    let stripeBalance = null;
    let stripePayouts = null;
    if (stripe) {
      try {
        stripeBalance = await stripe.balance.retrieve();
        stripePayouts = await stripe.payouts.list({ limit: 10 });
      } catch(e) { console.error('[Admin Costs] Stripe error:', e.message); }
    }

    // Cost estimates (Claude Sonnet 4 pricing)
    const SONNET_COST_PER_QUERY = 0.003; // ~$0.003 average per query
    const RESUME_COST_PER_EXTRACT = 0.015; // ~$0.015 per resume (longer doc)

    const totalQueries = aiTotal.rows.reduce((s, r) => s + parseInt(r.count), 0);
    const estimatedAICost = (totalQueries * SONNET_COST_PER_QUERY).toFixed(2);

    // Monthly AI cost as a number (reused for the net-revenue calc below).
    const monthlyAIQueries = aiUsage.rows.filter(r => {
      const m = new Date(r.month); const now = new Date();
      return m.getMonth() === now.getMonth() && m.getFullYear() === now.getFullYear();
    }).reduce((s, r) => s + parseInt(r.queries), 0);
    const monthlyAICost = monthlyAIQueries * SONNET_COST_PER_QUERY;

    // Platform revenue (MRR) — AUTHORITATIVE, computed server-side from active paid plans × plan price.
    // (The Overview page's old browser-side MRR used a stale $199 for Business; the real prices live here.)
    const planCounts = await pool.query(`
      SELECT LOWER(data->>'plan') AS plan, COUNT(*)::int AS count
      FROM users WHERE data->>'deleted' IS DISTINCT FROM 'true'
      GROUP BY LOWER(data->>'plan')
    `);
    const PLAN_PRICE = FF_PLAN_PRICE;   // shared single source of truth (see top of file)
    const _planCnt = p => { const r = planCounts.rows.find(x => x.plan === p); return r ? r.count : 0; };
    const revenueByPlan = Object.keys(PLAN_PRICE).map(p => ({
      plan: p, count: _planCnt(p), price: PLAN_PRICE[p], subtotal: _planCnt(p) * PLAN_PRICE[p],
    }));
    const enterpriseCount = _planCnt('enterprise');
    const totalMRR = revenueByPlan.reduce((s, r) => s + r.subtotal, 0);
    const payingClients = revenueByPlan.reduce((s, r) => s + r.count, 0) + enterpriseCount;

    // ── FULL MONTHLY COST PICTURE ────────────────────────────────────────────
    // Net has to reflect ALL expenses, not just AI. Three buckets:
    //  (1) AI — auto, computed above from usage (monthlyAICost).
    //  (2) Stripe processing fees — estimated from MRR (2.9% + $0.30 per paying client/charge);
    //      the app can't cheaply pull exact per-charge fees here, and in test mode they're ~$0.
    //  (3) Operating costs — the external SaaS bills no API exposes to us (Railway, Supabase,
    //      Resend, domain, …). The admin enters these on the Costs page; we persist them in
    //      platform_settings so the net is a REAL number, not AI-only.
    const stripeFeesEst = Number((totalMRR * 0.029 + payingClients * 0.30).toFixed(2));

    let operatingCosts = [];
    try {
      const oc = await pool.query(`SELECT value FROM platform_settings WHERE key = 'operating_costs'`);
      if (oc.rows.length && Array.isArray(oc.rows[0].value)) {
        operatingCosts = oc.rows[0].value
          .map(r => ({ label: String(r.label || '').slice(0, 60), monthly: Number(r.monthly) || 0 }))
          .filter(r => r.label);
      }
    } catch (e) { console.warn('[Admin Costs] operating_costs read:', e.message.slice(0, 80)); }
    if (!operatingCosts.length) {
      // First load — seed the common vendors at $0 so the admin just fills in the amounts.
      operatingCosts = [
        { label: 'Railway (hosting)', monthly: 0 },
        { label: 'Supabase (database)', monthly: 0 },
        { label: 'Resend (email)', monthly: 0 },
        { label: 'Domain', monthly: 0 },
      ];
    }
    const operatingTotal = Number(operatingCosts.reduce((s, r) => s + (Number(r.monthly) || 0), 0).toFixed(2));
    const mAI = Number(monthlyAICost.toFixed(2));
    const totalMonthlyCosts = Number((mAI + stripeFeesEst + operatingTotal).toFixed(2));
    const netMonthly = Number((totalMRR - totalMonthlyCosts).toFixed(2));

    return res.json({
      ai: {
        totalQueries,
        byModel: aiTotal.rows,
        monthlyBreakdown: aiUsage.rows,
        estimatedTotalCost: '$' + estimatedAICost,
        estimatedMonthlyCost: '$' + monthlyAICost.toFixed(2),
      },
      revenue: {
        byPlan: revenueByPlan,            // [{plan, count, price, subtotal}]
        enterpriseCount,
        totalMRR,
        payingClients,
        monthlyAICost: mAI,
        netMonthly,                       // MRR − (AI + Stripe fees + operating costs)
      },
      costs: {
        ai: mAI,                          // auto, from usage
        stripeFeesEst,                    // est. 2.9% + $0.30/paying client
        operating: operatingCosts,        // [{label, monthly}] — admin-editable, persisted
        operatingTotal,
        totalMonthlyCosts,
      },
      stripe: stripeBalance ? {
        available: stripeBalance.available.map(b => ({ amount: b.amount, currency: b.currency })),
        pending: stripeBalance.pending.map(b => ({ amount: b.amount, currency: b.currency })),
        recentPayouts: stripePayouts?.data?.map(p => ({
          amount: p.amount, currency: p.currency, status: p.status,
          arrival: new Date(p.arrival_date * 1000).toLocaleDateString(),
        })) || [],
      } : null,
      infrastructure: {
        note: 'Railway costs are managed at dashboard.railway.app',
        link: 'https://railway.app/dashboard',
      },
    });
  }));

  // Save the admin-entered operating costs (Railway, Supabase, Resend, domain, …).
  app.post('/api/admin/operating-costs', requireAdmin, wrap(async (req, res) => {
    const raw = Array.isArray(req.body && req.body.operating) ? req.body.operating : null;
    if (!raw) return res.status(400).json({ error: 'operating must be an array of {label, monthly}' });
    const clean = raw
      .map(r => ({ label: String((r && r.label) || '').trim().slice(0, 60), monthly: Math.max(0, Number(r && r.monthly) || 0) }))
      .filter(r => r.label)
      .slice(0, 30);
    const _ob = (await pool.query(`SELECT value FROM platform_settings WHERE key = 'operating_costs'`).catch(() => ({ rows: [] }))).rows[0];
    await pool.query(`
      INSERT INTO platform_settings (key, value, updated_at)
      VALUES ('operating_costs', $1::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [JSON.stringify(clean)]);
    await adminAudit(req, 'operating_costs_update', 'settings', null, {   // LC3g
      notes: `${clean.length} line(s), total $${clean.reduce((a,b)=>a+b.monthly,0).toFixed(2)}/mo`, before: _ob ? _ob.value : null, after: clean });
    return res.json({ success: true, operating: clean });
  }));

  // ── ADMIN ACTIVITY LOG ────────────────────────────────────────────────────
  app.get('/api/admin/log', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT * FROM admin_log ORDER BY created_at DESC LIMIT 500
    `).catch(() => ({ rows: [] }));
    return res.json(result.rows);
  }));

  // ── USER DETAIL ───────────────────────────────────────────────────────────
  app.get('/api/admin/users/:id', requireAdmin, wrap(async (req, res) => {
    const { id } = req.params;
    const userRes = await pool.query(`
      SELECT u.id, u.data->>'name' AS name, u.data->>'email' AS email,
             u.data->>'plan' AS plan, u.data->>'subscriptionStatus' AS sub_status,
             u.data->>'suspended' AS suspended, u.data->>'last_login' AS last_login,
             u.data->>'trial_ends' AS trial_ends, u.created_at,  -- F12: was 'trialEnds' (never written) → always blank
             a.first_name AS accountant_first, a.last_name AS accountant_last,
             a.firm AS accountant_firm, a.email AS accountant_email
      FROM users u
      LEFT JOIN accountant_clients ac ON ac.user_id = u.id AND ac.status IN ('active','pending')
      LEFT JOIN accountants a ON a.id = ac.accountant_id
      WHERE u.id = $1
    `, [id]);
    if (!userRes.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const entityCount = await pool.query(`SELECT COUNT(*) FROM entities WHERE user_id = $1`, [id])
      .catch(() => ({ rows: [{ count: 0 }] }));
    return res.json({ ...userRes.rows[0], entity_count: parseInt(entityCount.rows[0].count) });
  }));

  // ── DELETE USER (soft) ────────────────────────────────────────────────────
  app.delete('/api/admin/users/:id', requireAdmin, wrap(async (req, res) => {
    const { id } = req.params;
    const _b = await _userState(parseInt(id, 10) || 0);
    await pool.query(
      `UPDATE users SET data = jsonb_set(jsonb_set(data, '{deleted}', 'true'), '{email}', $1) WHERE id = $2`,
      [JSON.stringify(`deleted_${id}@deleted.com`), id]
    );
    if (_b) {   // LC3g: the address it had is kept on the admin log (the row's email is overwritten)
      await adminAudit(req, 'user_delete', 'user', id, { notes: 'Soft deleted by admin', before: { email: _b.email, deleted: _b.deleted }, after: { email: `deleted_${id}@deleted.com`, deleted: true } });
      await customerTrail(req, parseInt(id, 10), { deleted: _b.deleted }, { deleted: true });
    }
    return res.json({ ok: true });
  }));

  // ── ACCOUNTANT DETAIL ─────────────────────────────────────────────────────
  app.get('/api/admin/accountants/:id', requireAdmin, wrap(async (req, res) => {
    const { id } = req.params;
    const accRes = await pool.query(`
      SELECT a.*,
             COALESCE(SUM(ae.amount_cents) FILTER (WHERE ae.${earningsFigures.EARNED_SQL}),0) AS total_earnings_cents,   -- FA-L3g: earned = booked referral + PAID fees (was: incl. unpaid bills)
             COALESCE(SUM(CASE WHEN ae.status='paid' THEN ae.amount_cents ELSE 0 END),0) AS paid_earnings_cents
      FROM accountants a
      LEFT JOIN accountant_earnings ae ON ae.accountant_id = a.id
      WHERE a.id = $1
      GROUP BY a.id
    `, [id]);
    if (!accRes.rows[0]) return res.status(404).json({ error: 'Accountant not found.' });
    const clients = await pool.query(`
      SELECT u.id, u.data->>'name' AS name, u.data->>'email' AS email, ac.status
      FROM accountant_clients ac
      JOIN users u ON u.id = ac.user_id
      WHERE ac.accountant_id = $1
      ORDER BY ac.invited_at DESC LIMIT 50
    `, [id]);
    // F1: the legacy users.data.accountant_id link is no longer authoritative;
    // list only the real consented accountant_clients relationships.
    return res.json({ ...accRes.rows[0], clients: clients.rows });
  }));

  // ── FLAGGED TRANSACTIONS ──────────────────────────────────────────────────
  app.get('/api/admin/flags', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT f.id, f.txn_type, f.txn_ref, f.note, f.status, f.created_at, f.resolved_at, f.resolved_by,
             a.first_name, a.last_name, a.firm,
             u.data->>'name' AS client_name, u.data->>'email' AS client_email
      FROM flagged_transactions f
      JOIN accountants a ON a.id = f.accountant_id
      LEFT JOIN users u ON u.id = f.user_id
      ORDER BY (f.status = 'open') DESC, f.created_at DESC LIMIT 200
    `).catch(() => ({ rows: [] }));
    return res.json(result.rows);
  }));

  app.post('/api/admin/flags/:id/resolve', requireAdmin, wrap(async (req, res) => {
    const _fid = (parseInt(req.params.id, 10) || 0);
    const _fb = (await pool.query(`SELECT status FROM flagged_transactions WHERE id = $1`, [_fid]).catch(() => ({ rows: [] }))).rows[0] || null;
    await pool.query(
      `UPDATE flagged_transactions SET status='resolved', resolved_at=NOW(), resolved_by='admin' WHERE id = $1`,
      [_fid]
    );
    if (_fb) await adminAudit(req, 'flag_resolve', 'flagged_transaction', _fid, { before: _fb, after: { status: 'resolved' } });   // LC3g
    return res.json({ success: true });
  }));

  // ── BROADCAST ─────────────────────────────────────────────────────────────
  // F21: previously counted the audience, logged, and returned `sent: N` while
  // sending nothing. Now it actually delivers via Resend and reports the TRUE
  // counts. When Resend isn't configured it says so honestly (logged only, sent:0)
  // instead of claiming a delivery that never happened.
  app.post('/api/admin/broadcast', requireAdmin, wrap(async (req, res) => {
    const { audience, subject, message } = req.body || {};
    if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });

    // Recipient emails per audience (was COUNT(*); now selects addresses to send to).
    const recipientQueries = {
      all_users:      `SELECT data->>'email' AS email FROM users WHERE data->>'deleted' IS DISTINCT FROM 'true' AND data->>'email' IS NOT NULL`,
      all_accountants:`SELECT email FROM accountants WHERE status = 'verified' AND email IS NOT NULL`,
      pro_users:      `SELECT data->>'email' AS email FROM users WHERE data->>'plan' = 'pro' AND data->>'deleted' IS DISTINCT FROM 'true' AND data->>'email' IS NOT NULL`,
      business_users: `SELECT data->>'email' AS email FROM users WHERE data->>'plan' = 'business' AND data->>'deleted' IS DISTINCT FROM 'true' AND data->>'email' IS NOT NULL`,
      trial_users:    `SELECT data->>'email' AS email FROM users WHERE (data->>'plan' = 'trial' OR data->>'plan' IS NULL) AND data->>'deleted' IS DISTINCT FROM 'true' AND data->>'email' IS NOT NULL`,
    };
    const q = recipientQueries[audience] || recipientQueries.all_users;
    const rows = (await pool.query(q)).rows;
    const recipients = [...new Set(rows.map(r => r.email).filter(Boolean))];
    const total = recipients.length;

    // No Resend key → honest "logged only", never a fake `sent`.
    if (!resendClient) {
      await adminAudit(req, 'broadcast', 'system', null, { notes: `${audience} (LOGGED ONLY — email not configured; ${total} would receive): ${subject}`,   // LC3g
        after: { audience, subject, total, sent: 0, failed: 0, delivered: false } });
      return res.json({ ok: true, sent: 0, failed: 0, total, logged: true,
        message: `Email is not configured — nothing was sent. ${total} recipient(s) logged only.` });
    }

    // Deliver in chunks so a large audience doesn't fire thousands of calls at once.
    const from = process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>';
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0e0e0c;color:#f0ead6;border-radius:12px"><h2 style="color:#c9a84c;margin-bottom:16px">FinFlow</h2><div style="white-space:pre-wrap;line-height:1.6">${String(message).replace(/[<>]/g, c => (c === '<' ? '&lt;' : '&gt;'))}</div></div>`;
    let sent = 0, failed = 0;
    const CHUNK = 20;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const batch = recipients.slice(i, i + CHUNK);
      const results = await Promise.allSettled(
        batch.map(to => resendClient.emails.send({ from, to, subject, html }))
      );
      for (const r of results) (r.status === 'fulfilled' ? sent++ : failed++);
    }

    await adminAudit(req, 'broadcast', 'system', null, { notes: `${audience} (sent ${sent}/${total}, ${failed} failed): ${subject}`,   // LC3g
      after: { audience, subject, total, sent, failed, delivered: true }, outcome: failed ? 'partial' : 'ok' });
    return res.json({ ok: true, sent, failed, total });
  }));

  // ── PLATFORM HEALTH ───────────────────────────────────────────────────────
  app.get('/api/admin/health', requireAdmin, wrap(async (req, res) => {
    let db = false, redis = false;
    try { await pool.query('SELECT 1'); db = true; } catch(e) {}
    try {
      const redisClient = app.locals.redisClient;
      if (redisClient) {
        let redisOk = false;
        try {
          await redisClient.set('health_check', '1');
          const val = await redisClient.get('health_check');
          redisOk = val === '1';
        } catch(e) {
          redisOk = false;
        }
        redis = redisOk;
      }
    } catch(e) {}
    return res.json({ db, redis, deployId: process.env.RAILWAY_DEPLOYMENT_ID || null });
  }));

  // ── SECURITY LOG ──────────────────────────────────────────────────────────
  // ── INTEGRATION DEMAND — aggregate of every account's integration requests (founder-facing; N53). ──
  app.get('/api/admin/integration-requests', requireAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT data->>'value' AS name, COUNT(*)::int AS requests
         FROM user_settings WHERE data->>'key'='integration_request'
         GROUP BY 1 ORDER BY requests DESC, name ASC`);
    res.json({ requests: rows });
  }));

  app.get('/api/admin/security-log', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT * FROM admin_log WHERE action = 'failed_login'
      ORDER BY created_at DESC LIMIT 100
    `).catch(() => ({ rows: [] }));
    return res.json(result.rows);
  }));

  // ── TRAFFIC / VISITOR ANALYTICS ───────────────────────────────────────────
  // Reads the page_views table (one row per unique visitor per UTC day, populated
  // by the tracking middleware in server.js). Returns headline counts, a 30-day
  // daily series for the chart, top countries + pages, and the most-recent visitors.
  app.get('/api/admin/traffic', requireAdmin, wrap(async (req, res) => {
    const TODAY = `(NOW() AT TIME ZONE 'UTC')::date`;
    const [uniqToday, uniq7, uniq30, uniqAll, viewsToday, views7, views30] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS c FROM page_views WHERE view_day = ${TODAY}`),
      pool.query(`SELECT COUNT(*) AS c FROM page_views WHERE view_day >= ${TODAY} - 6`),
      pool.query(`SELECT COUNT(*) AS c FROM page_views WHERE view_day >= ${TODAY} - 29`),
      pool.query(`SELECT COUNT(*) AS c FROM page_views`),
      pool.query(`SELECT COALESCE(SUM(views),0) AS t FROM page_views WHERE view_day = ${TODAY}`),
      pool.query(`SELECT COALESCE(SUM(views),0) AS t FROM page_views WHERE view_day >= ${TODAY} - 6`),
      pool.query(`SELECT COALESCE(SUM(views),0) AS t FROM page_views WHERE view_day >= ${TODAY} - 29`),
    ]);

    const daily = await pool.query(`
      SELECT view_day AS day, COUNT(*) AS visitors, COALESCE(SUM(views),0) AS views
      FROM page_views WHERE view_day >= ${TODAY} - 29
      GROUP BY view_day ORDER BY view_day ASC
    `);
    const countries = await pool.query(`
      SELECT COALESCE(NULLIF(country,''),'—') AS country, COUNT(*) AS visitors, COALESCE(SUM(views),0) AS views
      FROM page_views WHERE view_day >= ${TODAY} - 29
      GROUP BY 1 ORDER BY visitors DESC, views DESC LIMIT 15
    `);
    const pages = await pool.query(`
      SELECT COALESCE(NULLIF(path,''),'/') AS path, COALESCE(SUM(views),0) AS views, COUNT(*) AS visitors
      FROM page_views WHERE view_day >= ${TODAY} - 29
      GROUP BY 1 ORDER BY views DESC LIMIT 15
    `);
    const recent = await pool.query(`
      SELECT pv.ip_address, pv.country, pv.region, pv.city, pv.path, pv.referrer, pv.user_agent,
             pv.user_id, pv.views, pv.first_seen, pv.last_seen,
             u.data->>'name' AS account_name, u.data->>'email' AS account_email
      FROM page_views pv
      LEFT JOIN users u ON u.id = pv.user_id
      ORDER BY pv.last_seen DESC LIMIT 200
    `);

    return res.json({
      summary: {
        uniqueToday: parseInt(uniqToday.rows[0].c, 10),
        unique7:     parseInt(uniq7.rows[0].c, 10),
        unique30:    parseInt(uniq30.rows[0].c, 10),
        uniqueAll:   parseInt(uniqAll.rows[0].c, 10),
        viewsToday:  parseInt(viewsToday.rows[0].t, 10),
        views7:      parseInt(views7.rows[0].t, 10),
        views30:     parseInt(views30.rows[0].t, 10),
      },
      daily: daily.rows,
      countries: countries.rows,
      pages: pages.rows,
      recent: recent.rows,
    });
  }));

  // ── SUPPORT INBOX — triage tickets from clients and accountants ─────────────
  // support_requests is a generic JSONB table (id, user_id, data, created_at). Tickets
  // come from BOTH audiences (data.actor = 'client' | 'accountant'). Admin can filter,
  // read, and resolve; resolving stamps status + an optional reply note server-side.
  app.get('/api/admin/support', requireAdmin, wrap(async (req, res) => {
    const status = String(req.query.status || '').trim();   // '', 'open', 'resolved'
    const actor  = String(req.query.actor  || '').trim();   // '', 'client', 'accountant'
    const conds = [], params = [];
    if (status) { params.push(status); conds.push(`data->>'status' = $${params.length}`); }
    if (actor)  { params.push(actor);  conds.push(`data->>'actor'  = $${params.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    // D-H: the queue is worked in reply-by order (soonest due first; tickets with no target last), and late ones counted.
    const q = await pool.query(
      `SELECT id, user_id, data, created_at FROM support_requests ${where}
        ORDER BY (data->>'reply_by') IS NULL, (data->>'reply_by')::timestamptz ASC, created_at DESC LIMIT 300`, params);
    const openCount = (await pool.query(`SELECT COUNT(*)::int n FROM support_requests WHERE data->>'status'='open' OR data->>'status' IS NULL`)).rows[0].n;
    const _now = new Date().toISOString();
    const overdueCount = (await pool.query(`SELECT COUNT(*)::int n FROM support_requests WHERE COALESCE(data->>'status','open') = 'open' AND data->>'first_response_at' IS NULL
        AND data->>'reply_by' IS NOT NULL AND (data->>'reply_by')::timestamptz < $1::timestamptz`, [_now])).rows[0].n;
    res.json({
      openCount, overdueCount,
      requests: q.rows.map(r => ({
        id: r.id,
        plan: r.data.plan || null,
        replyBy: r.data.reply_by || null,
        firstResponseAt: r.data.first_response_at || null,
        slaMet: r.data.sla_met == null ? null : r.data.sla_met,
        overdue: (r.data.status || 'open') === 'open' && !r.data.first_response_at && !!r.data.reply_by && r.data.reply_by < _now,
        user_id: r.user_id,
        actor: r.data.actor || 'client',
        subject: r.data.subject || '(no subject)',
        message: r.data.message || '',
        category: r.data.category || 'general',
        email: r.data.email || '',
        status: r.data.status || 'open',
        response: r.data.response || '',
        resolved_at: r.data.resolved_at || null,
        created_at: r.created_at,
      })),
    });
  }));

  // Update one ticket: set status ('open'|'resolved') and/or attach a reply note. When a
  // reply is given and Resend + the submitter email are present, it is emailed to them.
  app.post('/api/admin/support/:id', requireAdmin, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id.' });
    const status   = req.body && req.body.status ? String(req.body.status).trim() : null;
    const response = req.body && req.body.response != null ? String(req.body.response).slice(0, 5000) : null;
    if (status && !['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'status must be open or resolved.' });

    const cur = (await pool.query(`SELECT data FROM support_requests WHERE id=$1`, [id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Ticket not found.' });
    const data = Object.assign({}, cur.data);
    if (status) { data.status = status; data.resolved_at = status === 'resolved' ? new Date().toISOString() : null; }
    if (response != null) data.response = response;
    // D-H: the FIRST reply records when, and whether it met the ticket's reply-by target.
    if (response && !data.first_response_at) { data.first_response_at = new Date().toISOString(); if (data.reply_by) data.sla_met = data.first_response_at <= data.reply_by; }
    await pool.query(`UPDATE support_requests SET data=$2 WHERE id=$1`, [id, data]);
    await adminAudit(req, 'support_update', 'support_request', id, {   // LC3g
      before: { status: cur.data && cur.data.status, response: (cur.data && cur.data.response) || null }, after: { status: data.status, response: data.response || null } });

    if (response && resendClient && data.email && process.env.EMAIL_FROM) {
      const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      try {
        await resendClient.emails.send({
          from: process.env.EMAIL_FROM,
          to: data.email,
          subject: 'Re: ' + (data.subject || 'your FinFlow support request'),
          html: `<p>${esc(response).replace(/\n/g, '<br>')}</p><hr><p style="color:#888;font-size:12px">In reply to: ${esc(data.message || '')}</p>`,
        });
      } catch (e) { console.error('[admin support reply email]', e.message); }
    }
    res.json({ ok: true, id, status: data.status, response: data.response || '' });
  }));

}; // end registerAdminRoutes
