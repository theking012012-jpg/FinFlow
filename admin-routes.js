'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// FINFLOW ADMIN ROUTES
// Protected by ADMIN_PASSWORD env var — set this before deploying
// ══════════════════════════════════════════════════════════════════════════════

const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

module.exports = function registerAdminRoutes(app, pool, stripe, resendClient) {

  // ── ADMIN LOGIN ───────────────────────────────────────────────────────────
  app.post('/api/admin/login', wrap(async (req, res) => {
    const { password } = req.body || {};
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD not configured.' });
    if (!password || password !== ADMIN_PASSWORD) {
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
             a.verification_data, a.credentials, a.memberships, a.avg_rating,
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
    if (search) { params.push(`%${search}%`); conditions.push(`(a.first_name ILIKE $${params.length} OR a.last_name ILIKE $${params.length} OR a.email ILIKE $${params.length} OR a.firm ILIKE $${params.length})`); }
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

    await pool.query(
      `UPDATE accountants SET status = $1, verified_at = $2, updated_at = NOW() WHERE id = $3`,
      [newStatus, action === 'approve' || action === 'reinstate' ? new Date() : null, req.params.id]
    );

    // Log admin action
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, notes, created_at) VALUES ($1, 'accountant', $2, $3, NOW())`,
      [`accountant_${action}`, req.params.id, notes || '']
    ).catch(() => {});

    // Send email notification if Resend configured
    if (resendClient) {
      const acc = await pool.query('SELECT email, first_name FROM accountants WHERE id = $1', [req.params.id]);
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

  // Toggle Preferred Partner badge manually
  app.post('/api/admin/accountants/:id/preferred-partner', requireAdmin, wrap(async (req, res) => {
    const { enabled } = req.body || {};
    await pool.query(
      `UPDATE accountants SET avg_rating = $1 WHERE id = $2`,
      [enabled ? 5.0 : 0, req.params.id]
    );
    return res.json({ success: true });
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
    if (search) { params.push(`%${search}%`); conditions.push(`(u.data->>'name' ILIKE $${params.length} OR u.data->>'email' ILIKE $${params.length})`); }
    if (plan) { params.push(plan); conditions.push(`u.data->>'plan' = $${params.length}`); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY u.created_at DESC LIMIT 200';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  }));

  // Suspend / unsuspend user
  app.post('/api/admin/users/:id/suspend', requireAdmin, wrap(async (req, res) => {
    const { suspend } = req.body || {};
    await pool.query(
      `UPDATE users SET data = data || $1 WHERE id = $2`,
      [JSON.stringify({ suspended: suspend ? 'true' : 'false' }), req.params.id]
    );
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, created_at) VALUES ($1, 'user', $2, NOW())`,
      [suspend ? 'user_suspend' : 'user_reinstate', req.params.id]
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
    await pool.query(`DELETE FROM accountant_reports WHERE id = $1`, [req.params.id]);
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
      SELECT * FROM admin_log ORDER BY created_at DESC LIMIT 100
    `).catch(() => ({ rows: [] }));
    return res.json(result.rows);
  }));

}; // end registerAdminRoutes
