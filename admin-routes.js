'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// FINFLOW ADMIN ROUTES
// Protected by ADMIN_PASSWORD env var — set this before deploying
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');

const adminLoginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, skipSuccessfulRequests: true });

const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

module.exports = function registerAdminRoutes(app, pool, stripe, resendClient) {

  // ── ADMIN LOGIN ───────────────────────────────────────────────────────────
  app.post('/api/admin/login', adminLoginLimiter, wrap(async (req, res) => {
    const { password } = req.body || {};
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD not configured.' });
    if (!password) return res.status(401).json({ error: 'Invalid password.' });
    try {
      const a = Buffer.alloc(72); Buffer.from(password).copy(a);
      const b = Buffer.alloc(72); Buffer.from(ADMIN_PASSWORD).copy(b);
      if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Invalid password.' });
    } catch(e) {
      return res.status(401).json({ error: 'Invalid password.' });
    }
    req.session.isAdmin = true;
    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });
    return res.json({ success: true });
  }));

  app.post('/api/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    req.session.save(() => res.json({ ok: true }));
  });

  app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: true }));

  // ── PLATFORM OVERVIEW ─────────────────────────────────────────────────────
  app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
    const [
      usersTotal, usersToday, usersWeek, usersMonth,
      accountantsTotal, accountantsPending, accountantsVerified,
      reportsTotal, reportsOpen,
      earningsTotal, earningsPending,
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
      pool.query(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM accountant_earnings`),
      pool.query(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM accountant_earnings WHERE status = 'pending'`),
      pool.query(`SELECT COUNT(*) FROM ai_cache`),
      pool.query(`SELECT COUNT(*) FROM ai_cache WHERE created_at >= NOW() - INTERVAL '30 days'`),
    ]);

    // Monthly new users for chart (last 6 months)
    const monthlyUsers = await pool.query(`
      SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS count
      FROM users WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY month ORDER BY month ASC
    `);

    // Subscription breakdown
    const subBreakdown = await pool.query(`
      SELECT data->>'plan' AS plan, COUNT(*) AS count
      FROM users GROUP BY plan ORDER BY count DESC
    `);

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
        totalCents: parseInt(earningsTotal.rows[0].total),
        pendingCents: parseInt(earningsPending.rows[0].total),
        totalFormatted: '$' + (parseInt(earningsTotal.rows[0].total) / 100).toFixed(2),
        pendingFormatted: '$' + (parseInt(earningsPending.rows[0].total) / 100).toFixed(2),
      },
      ai: {
        totalQueries: parseInt(aiCacheTotal.rows[0].count),
        monthQueries: parseInt(aiCacheMonth.rows[0].count),
        // Estimate cost: Claude Sonnet ~$0.003 per query average
        estimatedMonthlyCost: '$' + (parseInt(aiCacheMonth.rows[0].count) * 0.003).toFixed(2),
        estimatedTotalCost: '$' + (parseInt(aiCacheTotal.rows[0].count) * 0.003).toFixed(2),
      },
    });
  }));

  // ── ACCOUNTANT MANAGEMENT ─────────────────────────────────────────────────
  app.get('/api/admin/accountants', requireAdmin, wrap(async (req, res) => {
    const { status, search } = req.query;
    let query = `
      SELECT a.id, a.first_name, a.last_name, a.email, a.firm, a.country,
             a.specialisation, a.experience, a.status, a.verification_method,
             a.verification_data, a.credentials, a.memberships, a.confirmed_credentials, a.avg_rating, a.preferred_partner,
             a.review_count, a.stripe_onboarded, a.created_at, a.verified_at,
             COUNT(ac.id) AS client_count,
             COALESCE(SUM(ae.amount_cents),0) AS total_earnings_cents
      FROM accountants a
      LEFT JOIN accountant_clients ac ON ac.accountant_id = a.id AND ac.status = 'active'
      LEFT JOIN accountant_earnings ae ON ae.accountant_id = a.id
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

    await pool.query(
      `UPDATE accountants SET status = $1, verified_at = $2,
         confirmed_credentials = COALESCE($3, confirmed_credentials), updated_at = NOW()
       WHERE id = $4`,
      [newStatus, action === 'approve' || action === 'reinstate' ? new Date() : null, confirmed, (parseInt(req.params.id, 10) || 0)]
    );

    // Log admin action
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, notes, created_at) VALUES ($1, 'accountant', $2, $3, NOW())`,
      [`accountant_${action}`, (parseInt(req.params.id, 10) || 0), notes || '']
    ).catch(() => {});

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
          ? `<p>Hi ${first_name},</p><p>Great news — your FinFlow accountant profile has been <strong>verified and is now live</strong> in our professional directory.</p><p>Log in to your dashboard to start inviting clients and earning referral commissions.</p><a href="${process.env.APP_URL || 'https://finflow-production-8e57.up.railway.app'}/accountant-login" style="display:inline-block;background:#c9a84c;color:#0e0e0c;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Go to dashboard →</a>`
          : action === 'reject'
          ? `<p>Hi ${first_name},</p><p>Thank you for applying to the FinFlow Professional Network. Unfortunately we were unable to verify your credentials at this time.</p>${notes ? `<p>Notes: ${notes}</p>` : ''}<p>You're welcome to reapply once you have updated credentials.</p>`
          : `<p>Hi ${first_name},</p><p>Your FinFlow accountant account status has been updated to: <strong>${newStatus}</strong>.</p>${notes ? `<p>Reason: ${notes}</p>` : ''}`;

        await resendClient.emails.send({
          from: process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
          to: email,
          subject,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0e0e0c;color:#f0ead6;border-radius:12px"><h2 style="color:#c9a84c;margin-bottom:16px">FinFlow</h2>${body}</div>`,
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

  // Suspend / unsuspend user
  app.post('/api/admin/users/:id/suspend', requireAdmin, wrap(async (req, res) => {
    const suspend = req.body?.suspend === true || req.body?.suspend === 'true';
    await pool.query(
      `UPDATE users SET data = data || $1 WHERE id = $2`,
      [JSON.stringify({ suspended: suspend ? 'true' : 'false' }), (parseInt(req.params.id, 10) || 0)]
    );
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, created_at) VALUES ($1, 'user', $2, NOW())`,
      [suspend ? 'user_suspend' : 'user_reinstate', (parseInt(req.params.id, 10) || 0)]
    ).catch(() => {});
    return res.json({ ok: true });
  }));

  app.post('/api/admin/users/:id/unsuspend', requireAdmin, wrap(async (req, res) => {
    await pool.query(`UPDATE users SET data = jsonb_set(COALESCE(data,'{}'), '{suspended}', 'false') WHERE id = $1`, [(parseInt(req.params.id, 10) || 0)]);
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, notes, created_at) VALUES ('user_unsuspend', 'user', $1, 'Unsuspended by admin', NOW())`,
      [(parseInt(req.params.id, 10) || 0)]
    ).catch(() => {});
    res.json({ ok: true });
  }));

  // Override user plan
  app.post('/api/admin/users/:id/plan', requireAdmin, wrap(async (req, res) => {
    const { plan } = req.body || {};
    if (!['trial', 'pro', 'business'].includes(plan)) return res.status(400).json({ error: 'Invalid plan.' });
    await pool.query(
      `UPDATE users SET data = data || $1 WHERE id = $2`,
      [JSON.stringify({ plan }), (parseInt(req.params.id, 10) || 0)]
    );
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, notes, created_at) VALUES ($1, 'user', $2, $3, NOW())`,
      ['user_plan_override', (parseInt(req.params.id, 10) || 0), `Set plan to ${plan}`]
    ).catch(() => {});
    return res.json({ success: true });
  }));

  // ── REPORTS ───────────────────────────────────────────────────────────────
  app.get('/api/admin/reports', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT r.id, r.reason, r.created_at,
             a.id AS accountant_id, a.first_name, a.last_name, a.firm, a.email, a.status,
             u.data->>'name' AS reporter_name, u.data->>'email' AS reporter_email
      FROM accountant_reports r
      JOIN accountants a ON a.id = r.accountant_id
      LEFT JOIN users u ON u.id = r.reporter_id
      ORDER BY r.created_at DESC LIMIT 100
    `);
    return res.json(result.rows);
  }));

  app.post('/api/admin/reports/:id/dismiss', requireAdmin, wrap(async (req, res) => {
    await pool.query(`DELETE FROM accountant_reports WHERE id = $1`, [(parseInt(req.params.id, 10) || 0)]);
    return res.json({ success: true });
  }));

  // ── EARNINGS & PAYOUTS ────────────────────────────────────────────────────
  app.get('/api/admin/earnings', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT ae.id, ae.type, ae.amount_cents, ae.description, ae.status, ae.period_month, ae.created_at,
             a.first_name, a.last_name, a.firm
      FROM accountant_earnings ae
      JOIN accountants a ON a.id = ae.accountant_id
      ORDER BY ae.created_at DESC LIMIT 200
    `);

    const summary = await pool.query(`
      SELECT
        COUNT(*) AS total_records,
        COALESCE(SUM(amount_cents),0) AS total_cents,
        COALESCE(SUM(CASE WHEN status='pending' THEN amount_cents ELSE 0 END),0) AS pending_cents,
        COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0) AS paid_cents,
        COALESCE(SUM(CASE WHEN type='service_commission' THEN amount_cents ELSE 0 END),0) AS commission_cents,
        COALESCE(SUM(CASE WHEN type='referral' THEN amount_cents ELSE 0 END),0) AS referral_cents
      FROM accountant_earnings
    `);

    return res.json({ records: result.rows, summary: summary.rows[0] });
  }));

  // Mark payouts as paid
  app.post('/api/admin/earnings/mark-paid', requireAdmin, wrap(async (req, res) => {
    const { ids } = req.body || {};
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided.' });
    await pool.query(
      `UPDATE accountant_earnings SET status = 'paid' WHERE id = ANY($1)`,
      [ids]
    );
    return res.json({ success: true, updated: ids.length });
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

    return res.json({
      ai: {
        totalQueries,
        byModel: aiTotal.rows,
        monthlyBreakdown: aiUsage.rows,
        estimatedTotalCost: '$' + estimatedAICost,
        estimatedMonthlyCost: '$' + (aiUsage.rows.filter(r => {
          const m = new Date(r.month);
          const now = new Date();
          return m.getMonth() === now.getMonth() && m.getFullYear() === now.getFullYear();
        }).reduce((s, r) => s + parseInt(r.queries), 0) * SONNET_COST_PER_QUERY).toFixed(2),
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
    await pool.query(
      `UPDATE users SET data = jsonb_set(jsonb_set(data, '{deleted}', 'true'), '{email}', $1) WHERE id = $2`,
      [JSON.stringify(`deleted_${id}@deleted.com`), id]
    );
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, notes, created_at) VALUES ('user_delete','user',$1,'Soft deleted by admin',NOW())`,
      [id]
    ).catch(() => {});
    return res.json({ ok: true });
  }));

  // ── ACCOUNTANT DETAIL ─────────────────────────────────────────────────────
  app.get('/api/admin/accountants/:id', requireAdmin, wrap(async (req, res) => {
    const { id } = req.params;
    const accRes = await pool.query(`
      SELECT a.*,
             COALESCE(SUM(ae.amount_cents),0) AS total_earnings_cents,
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
      SELECT id, action, target_type, target_id, notes, created_at,
             CASE WHEN notes LIKE '%[resolved]%' THEN 'resolved' ELSE 'open' END AS status
      FROM admin_log
      WHERE action LIKE '%flag%'
      ORDER BY created_at DESC LIMIT 200
    `).catch(() => ({ rows: [] }));
    return res.json(result.rows);
  }));

  app.post('/api/admin/flags/:id/resolve', requireAdmin, wrap(async (req, res) => {
    await pool.query(
      `UPDATE admin_log SET notes = COALESCE(notes,'') || ' [resolved]' WHERE id = $1`,
      [(parseInt(req.params.id, 10) || 0)]
    );
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
      await pool.query(
        `INSERT INTO admin_log (action, target_type, notes, created_at) VALUES ('broadcast','system',$1,NOW())`,
        [`${audience} (LOGGED ONLY — email not configured; ${total} would receive): ${subject}`]
      ).catch(() => {});
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

    await pool.query(
      `INSERT INTO admin_log (action, target_type, notes, created_at) VALUES ('broadcast','system',$1,NOW())`,
      [`${audience} (sent ${sent}/${total}, ${failed} failed): ${subject}`]
    ).catch(() => {});
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
  app.get('/api/admin/security-log', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT * FROM admin_log WHERE action = 'failed_login'
      ORDER BY created_at DESC LIMIT 100
    `).catch(() => ({ rows: [] }));
    return res.json(result.rows);
  }));

  // Called on failed login attempts. Rate-limited + ignores anonymous floods.
  app.post('/api/admin/log-security', adminLoginLimiter, wrap(async (req, res) => {
    const { notes } = req.body || {};
    const ALLOWED_ACTIONS = ['failed_login', 'rate_limited', 'suspicious_activity'];
    const rawAction = (req.body || {}).action;
    const safeAction = ALLOWED_ACTIONS.includes(rawAction) ? rawAction : 'failed_login';
    await pool.query(
      `INSERT INTO admin_log (action, target_type, notes, created_at) VALUES ($1,'security',$2,NOW())`,
      [safeAction, notes || '']
    ).catch(() => {});
    return res.json({ ok: true });
  }));

}; // end registerAdminRoutes
