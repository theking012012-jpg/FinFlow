// ═══════════════════════════════════════════════════════════════════════════════
// FINFLOW ACCOUNTANT MARKETPLACE — server.js additions
// Drop these routes into server.js after the existing auth routes.
// ═══════════════════════════════════════════════════════════════════════════════
//
// DATABASE SETUP — run this once in initDB() or via psql:
//
//   CREATE TABLE IF NOT EXISTS accountants (
//     id               SERIAL PRIMARY KEY,
//     user_id          INTEGER UNIQUE,          -- linked FinFlow user account
//     email            VARCHAR(255) UNIQUE NOT NULL,
//     password_hash    VARCHAR(255) NOT NULL,
//     first_name       VARCHAR(100) NOT NULL,
//     last_name        VARCHAR(100) NOT NULL,
//     firm             VARCHAR(200),
//     country          VARCHAR(100),
//     specialisation   VARCHAR(100),
//     bio              TEXT,
//     experience       VARCHAR(50),
//     referral_code    VARCHAR(50) UNIQUE NOT NULL,
//     referred_by      INTEGER REFERENCES accountants(id),
//     status           VARCHAR(30) DEFAULT 'pending',   -- pending | verified | rejected | suspended
//     verification_method VARCHAR(30),                  -- membership | employer | institution
//     verification_data   JSONB DEFAULT '{}',
//     verified_at      TIMESTAMPTZ,
//     created_at       TIMESTAMPTZ DEFAULT NOW(),
//     updated_at       TIMESTAMPTZ DEFAULT NOW()
//   );
//
//   CREATE INDEX IF NOT EXISTS idx_accountants_email ON accountants(email);
//   CREATE INDEX IF NOT EXISTS idx_accountants_referral ON accountants(referral_code);
//   CREATE INDEX IF NOT EXISTS idx_accountants_status ON accountants(status);
//
//   -- Pricing columns (added via ALTER TABLE in database.js initDB)
//   -- hourly_rate NUMERIC(10,2), packages JSONB, pricing_note TEXT, has_pricing BOOLEAN
//
//   -- Links FinFlow user accounts to their accountant
//   CREATE TABLE IF NOT EXISTS accountant_clients (
//     id               SERIAL PRIMARY KEY,
//     accountant_id    INTEGER NOT NULL REFERENCES accountants(id),
//     user_id          INTEGER NOT NULL,            -- FinFlow user (the client)
//     status           VARCHAR(30) DEFAULT 'active', -- pending | active | revoked
//     access_level     VARCHAR(30) DEFAULT 'view',   -- view | filing
//     referral_month   INTEGER DEFAULT 0,            -- months of referral payout paid so far
//     referral_months_total INTEGER DEFAULT 1,       -- 1 / 3 / 12 based on tier at signup
//     invited_at       TIMESTAMPTZ DEFAULT NOW(),
//     activated_at     TIMESTAMPTZ,
//     UNIQUE(accountant_id, user_id)
//   );
//
//   -- Earnings ledger
//   CREATE TABLE IF NOT EXISTS accountant_earnings (
//     id               SERIAL PRIMARY KEY,
//     accountant_id    INTEGER NOT NULL REFERENCES accountants(id),
//     client_id        INTEGER,                     -- NULL for service commissions
//     type             VARCHAR(30) NOT NULL,         -- referral | service_commission
//     amount_cents     INTEGER NOT NULL,
//     description      TEXT,
//     status           VARCHAR(20) DEFAULT 'pending', -- pending | paid
//     period_month     DATE,                          -- first day of the month this covers
//     created_at       TIMESTAMPTZ DEFAULT NOW()
//   );
//
//   CREATE INDEX IF NOT EXISTS idx_earnings_accountant ON accountant_earnings(accountant_id);
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

// ── HELPERS ───────────────────────────────────────────────────────────────────

/** Wraps async route handlers so thrown errors go to Express error handler */
const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

/** Generate a unique referral code: first 3 letters of name + random 6 chars */
function generateReferralCode(firstName, lastName) {
  const prefix = (firstName.slice(0, 2) + lastName.slice(0, 1)).toLowerCase().replace(/[^a-z]/g, 'x');
  const suffix = Math.random().toString(36).slice(2, 8);
  return prefix + suffix;
}

/** Determine referral months based on how many clients the accountant currently has */
function referralMonthsForTier(clientCount) {
  if (clientCount >= 500) return 12;  // Elite
  if (clientCount >= 50)  return 3;   // Growth
  return 1;                            // Starter
}

/** Require the session to be an authenticated accountant */
function requireAccountant(req, res, next) {
  if (!req.session.accountantId) {
    return res.status(401).json({ error: 'Accountant login required.' });
  }
  next();
}

/** Membership body lookup table — replace stub with real API calls per body */
const MEMBERSHIP_APIS = {
  ACCA:  { name: 'ACCA',  url: 'https://www.accaglobal.com/api/members', mock: true },
  ICAEW: { name: 'ICAEW', url: 'https://www.icaew.com/api/verify',       mock: true },
  CPA:   { name: 'CPA',   url: 'https://www.aicpa.org/api/verify',       mock: true },
  ICATT: { name: 'ICATT', url: null, mock: true },   // manual call for now
  ICAJ:  { name: 'ICAJ',  url: null, mock: true },
};

/**
 * Attempt automated membership lookup.
 * Returns { verified: bool, name: string|null, status: string }
 * In production: replace mock logic with real HTTP fetch to each body's API.
 */
async function lookupMembership(body, membershipNumber) {
  const api = MEMBERSHIP_APIS[body];
  if (!api) return { verified: false, name: null, status: 'Unknown body' };

  if (api.mock) {
    // Mock: numbers with 6+ chars pass. Replace with real API in production.
    await new Promise(r => setTimeout(r, 300)); // simulate latency
    if (membershipNumber.length >= 6) {
      return { verified: true, name: `${body} Member`, status: 'Active member in good standing' };
    }
    return { verified: false, name: null, status: 'Not found in registry' };
  }

  // Real API call (example pattern — each body differs):
  try {
    const resp = await fetch(`${api.url}?id=${encodeURIComponent(membershipNumber)}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'FinFlow/1.0' },
      timeout: 5000,
    });
    if (!resp.ok) return { verified: false, name: null, status: 'Registry unavailable' };
    const data = await resp.json();
    return { verified: data.active === true, name: data.fullName || null, status: data.status || 'Unknown' };
  } catch (e) {
    return { verified: false, name: null, status: 'Registry unreachable — will verify manually' };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES — paste these into server.js after the auth section
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = function registerAccountantRoutes(app, pool, authLimiter, apiLimiter, stripe, resendClient) {

  // ── 1. REGISTER AS ACCOUNTANT ─────────────────────────────────────────────
  app.post('/api/accountants/register', authLimiter, wrap(async (req, res) => {
    const {
      firstName, lastName, email, password,
      firm, country, specialisation, bio, experience,
      referralCode: referredByCode,
      verification,
    } = req.body || {};

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !firm || !country || !specialisation) {
      return res.status(400).json({ error: 'All required fields must be completed.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (!verification || !verification.method) {
      return res.status(400).json({ error: 'Verification method is required.' });
    }

    const client = await pool.connect();
    try {
      // Check for existing accountant with this email
      const existing = await client.query('SELECT id FROM accountants WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An accountant profile with this email already exists.' });
      }

      const hash = require('bcryptjs').hashSync(password, 12);
      const refCode = generateReferralCode(firstName, lastName);

      // Resolve referred_by accountant
      let referredById = null;
      if (referredByCode) {
        const refRow = await client.query('SELECT id FROM accountants WHERE referral_code = $1', [referredByCode]);
        if (refRow.rows.length > 0) referredById = refRow.rows[0].id;
      }

      // Insert accountant record
      const result = await client.query(`
        INSERT INTO accountants
          (email, password_hash, first_name, last_name, firm, country, specialisation,
           bio, experience, referral_code, referred_by, status, verification_method, verification_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13)
        RETURNING id
      `, [
        email.toLowerCase(), hash,
        firstName.trim().slice(0, 100), lastName.trim().slice(0, 100),
        firm.trim().slice(0, 200), country, specialisation,
        (bio || '').trim().slice(0, 1000), experience,
        refCode, referredById,
        verification.method,
        JSON.stringify(verification),
      ]);

      const accountantId = result.rows[0].id;

      // Save credentials extracted from CV
      if (req.body.credentials || req.body.memberships) {
        await client.query(
          `UPDATE accountants SET credentials = $1, memberships = $2 WHERE id = $3`,
          [req.body.credentials || '', req.body.memberships || '', accountantId]
        ).catch(e => console.error('[Register] Credentials save failed:', e.message));
      }

      // If membership verification — attempt auto-lookup
      if (verification.method === 'membership' && verification.profBody && verification.membershipNumber) {
        const lookup = await lookupMembership(verification.profBody, verification.membershipNumber);
        if (lookup.verified) {
          await client.query(
            `UPDATE accountants SET status = 'verified', verified_at = NOW(),
             verification_data = verification_data || $1 WHERE id = $2`,
            [JSON.stringify({ autoVerified: true, lookupResult: lookup.status }), accountantId]
          );
        }
        // If not auto-verified, stays 'pending' — team follows up
      }
      // employer + institution methods stay 'pending' — team does manual call/check

      // Start session
      req.session.accountantId = accountantId;

      return res.status(201).json({
        success: true,
        accountantId,
        referralCode: refCode,
        status: verification.method === 'membership' ? 'auto-checked' : 'pending-manual',
        message: 'Application received. You will be notified when verification is complete.',
      });

    } finally {
      client.release();
    }
  }));


  // ── RESUME / CV EXTRACTION ───────────────────────────────────────────────────
  app.post('/api/accountants/extract-resume', apiLimiter, wrap(async (req, res) => {
    const { base64, mediaType, isPDF, isWord, fileName } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'No file data received.' });

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI service not configured.' });

    const prompt = `You are a professional CV/resume parser. Extract information from this CV/resume and respond ONLY with a valid JSON object — no markdown, no explanation, no backticks.

{
  "firstName": "first name only",
  "lastName": "last name only",
  "firm": "current or most recent employer/firm name",
  "country": "country of residence or work",
  "specialisation": "one of: Tax Filing, Bookkeeping, Audit & Assurance, Payroll, Advisory / CFO, All of the above",
  "experience": "one of: 1-3, 3-5, 5-10, 10-20, 20+",
  "bio": "2-3 sentence professional summary in first person",
  "credentials": "comma-separated qualifications e.g. ACCA, CPA, ACA, MBA",
  "memberships": "comma-separated professional body memberships",
  "previousFirms": "comma-separated previous employers (max 3)"
}

If you cannot find a field, use null. Be concise.`;

    try {
      let contentBlock;
      if (isPDF) {
        contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
      } else {
        const decoded = Buffer.from(base64, 'base64').toString('utf-8').replace(/[^\x20-\x7E\x09\x0A\x0D]/g, ' ').trim();

        contentBlock = { type: 'text', text: 'CV/Resume content:\n\n' + decoded.slice(0, 8000) };
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY.trim(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('[Resume Extract] Anthropic error:', err);
        return res.status(502).json({ error: 'AI service unavailable.' });
      }

      const data = await response.json();
      const raw = data.content?.map(b => b.text || '').join('').trim();
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(cleaned);
      return res.json(extracted);

    } catch(e) {
      console.error('[Resume Extract] Error:', e.message);
      return res.status(500).json({ error: 'Could not parse CV. Please fill in manually.' });
    }
  }));

  // ── 2. MEMBERSHIP LOOKUP (called from frontend verify button) ─────────────
  app.post('/api/accountants/verify-membership', authLimiter, wrap(async (req, res) => {
    const { profBody, membershipNumber } = req.body || {};
    if (!profBody || !membershipNumber) {
      return res.status(400).json({ error: 'Professional body and membership number are required.' });
    }
    const result = await lookupMembership(profBody, membershipNumber);
    return res.json(result);
  }));


  // ── 3. ACCOUNTANT LOGIN ───────────────────────────────────────────────────
  app.post('/api/accountants/login', authLimiter, wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const result = await pool.query('SELECT * FROM accountants WHERE email = $1', [email.toLowerCase()]);
    const acc = result.rows[0];
    if (!acc) return res.status(401).json({ error: 'Invalid credentials.' });

    const match = require('bcryptjs').compareSync(password, acc.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

    req.session.accountantId = acc.id;
    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });
    return res.json({
      id: acc.id,
      firstName: acc.first_name,
      lastName: acc.last_name,
      email: acc.email,
      firm: acc.firm,
      status: acc.status,
      referralCode: acc.referral_code,
    });
  }));


  // ── 4. GET ACCOUNTANT PROFILE ─────────────────────────────────────────────
  app.get('/api/accountants/me', requireAccountant, wrap(async (req, res) => {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, firm, country, specialisation,
              bio, experience, referral_code, status, verified_at, created_at,
              hourly_rate, packages, pricing_note, has_pricing, avg_rating,
              credentials, memberships
       FROM accountants WHERE id = $1`,
      [req.session.accountantId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found.' });
    return res.json(result.rows[0]);
  }));


  // ── 5. GET ACCOUNTANT'S CLIENTS ───────────────────────────────────────────
  app.get('/api/accountants/clients', requireAccountant, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT ac.id, ac.user_id, ac.status, ac.access_level, ac.activated_at,
             ac.referral_month, ac.referral_months_total,
             u.data->>'name'       AS client_name,
             u.data->>'email'      AS client_email,
             u.data->>'plan'       AS client_plan,
             u.data->>'last_login' AS last_login,
             (SELECT MAX(i.created_at) FROM invoices i WHERE i.user_id = ac.user_id) AS last_invoice,
             (SELECT MAX(e.created_at) FROM expenses e WHERE e.user_id = ac.user_id) AS last_expense
      FROM accountant_clients ac
      JOIN users u ON u.id = ac.user_id
      WHERE ac.accountant_id = $1
      ORDER BY ac.activated_at DESC NULLS LAST
    `, [req.session.accountantId]);

    return res.json(result.rows);
  }));


  // ── 6. GET CLIENT BOOKS (with permission check) ───────────────────────────
  app.get('/api/accountants/clients/:userId/books', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;

    // Verify the accountant has access to this client
    const access = await pool.query(
      `SELECT access_level FROM accountant_clients
       WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access to this client.' });

    // Fetch all client data
    const [invoices, expenses, entities, settings, payroll, journals, customers, bills] = await Promise.all([
      pool.query(`SELECT entity_id, data FROM invoices WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT entity_id, data FROM expenses WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT id, data->>'name' AS name FROM entities WHERE user_id = $1 ORDER BY id`, [userId]),
      pool.query(`SELECT data FROM users WHERE id = $1 LIMIT 1`, [userId]),
      pool.query(`SELECT data FROM payroll WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT data FROM journals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]),
      pool.query(`SELECT data FROM customers WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT data FROM bills WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    ]);

    const taxRate = parseFloat(settings.rows[0]?.data?.tax_rate || 0);
    const totalIncome   = invoices.rows.reduce((sum, r) => sum + (parseFloat(r.data?.amount) || 0), 0);
    const totalExpenses = expenses.rows.reduce((sum, r) => sum + (parseFloat(r.data?.amount) || 0), 0);
    const totalPayroll  = payroll.rows.reduce((sum, r) => sum + (parseFloat(r.data?.gross) || 0), 0);

    // Balance sheet components
    const outstanding = invoices.rows
      .filter(r => r.data?.status !== 'paid')
      .reduce((s, r) => s + (parseFloat(r.data?.amount) || 0), 0);
    const unpaidBills = bills.rows
      .filter(r => r.data?.status === 'unpaid')
      .reduce((s, r) => s + (parseFloat(r.data?.amount) || 0), 0);

    return res.json({
      accessLevel: access.rows[0].access_level,
      taxRate,
      summary: {
        totalIncome:   totalIncome.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netProfit:     (totalIncome - totalExpenses).toFixed(2),
      },
      entities:    entities.rows,
      allInvoices: invoices.rows.map(r => ({ ...r.data, entity_id: r.entity_id })),
      allExpenses: expenses.rows.map(r => ({ ...r.data, entity_id: r.entity_id })),
      allPayroll:  payroll.rows.map(r => r.data),
      allJournals: journals.rows.map(r => r.data),
      allCustomers: customers.rows.map(r => r.data),
      balanceSheet: {
        accountsReceivable: outstanding.toFixed(2),
        accountsPayable:    unpaidBills.toFixed(2),
        totalPayroll:       totalPayroll.toFixed(2),
      },
      recentInvoices: invoices.rows.map(r => r.data).slice(0, 10),
      recentExpenses: expenses.rows.map(r => r.data).slice(0, 10),
    });
  }));

  // ── ADD JOURNAL ENTRY ON BEHALF OF CLIENT ────────────────────────────────
  app.post('/api/accountants/clients/:userId/journal', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    const { date, description, lines } = req.body || {};
    const access = await pool.query(
      `SELECT access_level FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    if (access.rows[0].access_level === 'view') return res.status(403).json({ error: 'View-only access.' });
    const { row } = await db.insert('journals', {
      user_id: parseInt(userId),
      description: (description || '').slice(0, 500),
      date: date || new Date().toISOString().slice(0, 10),
      lines: JSON.stringify(lines || []),
      posted_by: `accountant:${req.session.accountantId}`,
    });
    res.status(201).json(row);
  }));

  // ── LOCK/UNLOCK PERIOD ───────────────────────────────────────────────────
  app.post('/api/accountants/clients/:userId/lock', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    const { period, locked } = req.body || {};
    const access = await pool.query(
      `SELECT access_level FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    const existing = await db.get('lock_settings', r => r.user_id === parseInt(userId) && r.period === period);
    if (existing) {
      await db.update('lock_settings', r => r.id === existing.id, { locked: locked ? 1 : 0, locked_by: `accountant:${req.session.accountantId}` });
    } else {
      await db.insert('lock_settings', { user_id: parseInt(userId), period, locked: locked ? 1 : 0, locked_by: `accountant:${req.session.accountantId}` });
    }
    res.json({ ok: true });
  }));


  // ── 7. SAVE ACCOUNTANT NOTES ON CLIENT ───────────────────────────────────
  app.post('/api/accountants/clients/:userId/notes', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    const { note } = req.body || {};
    // Verify access
    const access = await pool.query(
      `SELECT id FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    await pool.query(
      `UPDATE accountant_clients SET access_level = access_level WHERE accountant_id = $1 AND user_id = $2`,
      [req.session.accountantId, userId]
    );
    // Store note in accountant_reports table
    await pool.query(`
      INSERT INTO accountant_reports (accountant_id, client_id, type, content, created_at)
      VALUES ($1, $2, 'note', $3, NOW())
      ON CONFLICT DO NOTHING
    `, [req.session.accountantId, userId, (note || '').slice(0, 2000)]);
    res.json({ ok: true });
  }));

  // ── 8. FLAG A TRANSACTION ─────────────────────────────────────────────────
  app.post('/api/accountants/clients/:userId/flag', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    const { type, ref, message } = req.body || {};
    const access = await pool.query(
      `SELECT id FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    await pool.query(`
      INSERT INTO accountant_reports (accountant_id, client_id, type, content, created_at)
      VALUES ($1, $2, 'flag', $3, NOW())
    `, [req.session.accountantId, userId, JSON.stringify({ type, ref, message })]);
    res.json({ ok: true });
  }));

  // ── 9. INVITE CLIENT ──────────────────────────────────────────────────────
  app.post('/api/accountants/invite', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { email, name } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Client email required.' });

    const acc = await pool.query('SELECT * FROM accountants WHERE id = $1', [req.session.accountantId]);
    if (!acc.rows[0] || acc.rows[0].status !== 'verified') {
      return res.status(403).json({ error: 'Only verified accountants can invite clients.' });
    }

    const accountant = acc.rows[0];
    const refUrl = `${process.env.APP_URL || 'https://finflow.app'}/register?ref=${accountant.referral_code}`;

    // Send email via Resend (reuse existing resendClient)
    if (resendClient) {
      await resendClient.emails.send({
        from: process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
        to: email,
        subject: `${accountant.first_name} ${accountant.last_name} invited you to FinFlow`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0e0e0c;color:#f0ead6;border-radius:12px;">
            <h2 style="color:#c9a84c;font-size:24px;margin-bottom:8px;">You've been invited to FinFlow</h2>
            <p style="color:#9a9278;margin-bottom:20px;">
              ${accountant.first_name} ${accountant.last_name} from <strong style="color:#f0ead6">${accountant.firm}</strong>
              has invited${name ? ` ${name}` : ' you'} to manage your finances on FinFlow.
            </p>
            <p style="color:#9a9278;margin-bottom:24px;">
              Start your free 14-day trial — no credit card required.
              ${accountant.first_name} will have access to your books to help with your filing and accounting needs.
            </p>
            <a href="${refUrl}" style="display:inline-block;background:#c9a84c;color:#0e0e0c;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
              Start free trial →
            </a>
            <p style="color:#5a5540;font-size:11px;margin-top:24px;">
              FinFlow is a platform connecting businesses with accounting professionals.
              FinFlow does not provide accounting services.
            </p>
          </div>
        `,
      });
    }

    return res.json({ success: true, message: `Invitation sent to ${email}` });
  }));


  // ── 8. LINK CLIENT AFTER SIGNUP (called when user registers with ?ref=code) ─
  app.post('/api/accountants/link-client', wrap(async (req, res) => {
    const { referralCode, userId } = req.body || {};
    if (!referralCode || !userId) return res.status(400).json({ error: 'Missing referral code or user ID.' });

    const acc = await pool.query(
      'SELECT id FROM accountants WHERE referral_code = $1 AND status = $2',
      [referralCode, 'verified']
    );
    if (!acc.rows[0]) return res.status(404).json({ error: 'Referral code not found.' });

    const accountantId = acc.rows[0].id;

    // Count current clients to determine referral tier
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM accountant_clients WHERE accountant_id = $1 AND status = 'active'`,
      [accountantId]
    );
    const currentCount = parseInt(countResult.rows[0].count) || 0;
    const months = referralMonthsForTier(currentCount);

    await pool.query(`
      INSERT INTO accountant_clients (accountant_id, user_id, status, referral_months_total)
      VALUES ($1, $2, 'pending', $3)
      ON CONFLICT (accountant_id, user_id) DO NOTHING
    `, [accountantId, userId, months]);

    return res.json({ success: true, referralMonths: months });
  }));


  // ── 9. ACTIVATE CLIENT (called when client completes payment/trial) ────────
  // Call this from your Stripe webhook when a client's subscription activates.
  app.post('/api/accountants/activate-client', wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    const client = await pool.connect();
    try {
      const result = await client.query(`
        UPDATE accountant_clients
        SET status = 'active', activated_at = NOW()
        WHERE user_id = $1 AND status = 'pending'
        RETURNING accountant_id, referral_months_total
      `, [userId]);

      if (result.rows[0]) {
        const { accountant_id, referral_months_total } = result.rows[0];
        // Create first month's referral earning record
        await client.query(`
          INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, period_month)
          VALUES ($1, $2, 'referral', 1000, 'Referral commission — month 1', date_trunc('month', NOW()))
        `, [accountant_id, userId]);
      }

      return res.json({ success: true });
    } finally {
      client.release();
    }
  }));


  // ── 10. GET ACCOUNTANT EARNINGS ───────────────────────────────────────────
  app.get('/api/accountants/earnings', requireAccountant, wrap(async (req, res) => {
    const { month } = req.query; // optional: YYYY-MM

    let query = `
      SELECT ae.*, ac.user_id,
             u.data->>'name' AS client_name
      FROM accountant_earnings ae
      LEFT JOIN accountant_clients ac ON ac.user_id = ae.client_id AND ac.accountant_id = ae.accountant_id
      LEFT JOIN users u ON u.id = ae.client_id
      WHERE ae.accountant_id = $1
    `;
    const params = [req.session.accountantId];

    if (month) {
      query += ` AND date_trunc('month', ae.period_month) = date_trunc('month', $2::date)`;
      params.push(month + '-01');
    }

    query += ' ORDER BY ae.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);

    const total = result.rows.reduce((sum, r) => sum + r.amount_cents, 0);
    return res.json({
      earnings: result.rows,
      totalCents: total,
      totalFormatted: '$' + (total / 100).toFixed(2),
    });
  }));


  // ── 11. RECORD SERVICE COMMISSION (call from payment flow) ────────────────
  // When an accountant charges a client for work via FinFlow, call this.
  app.post('/api/accountants/record-commission', wrap(async (req, res) => {
    const { accountantId, userId, billedAmountCents, description } = req.body || {};
    if (!accountantId || !billedAmountCents) return res.status(400).json({ error: 'Missing fields.' });

    const commissionCents = Math.round(billedAmountCents * 0.04); // 4%

    await pool.query(`
      INSERT INTO accountant_earnings
        (accountant_id, client_id, type, amount_cents, description, status, period_month)
      VALUES ($1, $2, 'service_commission', $3, $4, 'pending', date_trunc('month', NOW()))
    `, [accountantId, userId || null, commissionCents, description || 'Service commission']);

    return res.json({ success: true, commissionCents, commissionFormatted: '$' + (commissionCents / 100).toFixed(2) });
  }));


  // ── 12. MONTHLY REFERRAL PAYOUT CRON ──────────────────────────────────────
  // Call this via a cron job on the 1st of each month (or a Betterstack scheduled job).
  // POST /api/accountants/run-monthly-payouts  (protected by CRON_SECRET header)
  //
  // GOLDEN RULE: Commission only pays on ACTIVE, PAYING clients.
  // If a client has cancelled their subscription, their $10/month stops immediately.
  // We check Stripe subscription status (stored in users.data.subscriptionStatus)
  // before creating any payout record. No active subscription = no commission.
  app.post('/api/accountants/run-monthly-payouts', wrap(async (req, res) => {
    const secret = req.headers['x-cron-secret'];
    if (!secret || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorised.' });
    }

    const client = await pool.connect();
    try {
      // Find all active client relationships that still have referral months remaining.
      // Join to users table to check live subscription status — only pay if subscribed.
      const rows = await client.query(`
        SELECT ac.accountant_id, ac.user_id, ac.referral_month, ac.referral_months_total,
               u.data->>'subscriptionStatus' AS sub_status,
               u.data->>'plan'               AS plan
        FROM accountant_clients ac
        JOIN users u ON u.id = ac.user_id
        WHERE ac.status = 'active'
          AND ac.referral_month < ac.referral_months_total
          AND u.data->>'subscriptionStatus' IN ('active', 'trialing')
      `);
      // Clients whose subscriptionStatus is 'canceled', 'past_due', 'unpaid', or missing
      // are excluded from the query above — no commission is created for them this month.

      let payoutsCreated = 0;
      let payoutsSkipped = 0;

      for (const row of rows.rows) {
        const nextMonth = row.referral_month + 1;

        await client.query(`
          INSERT INTO accountant_earnings
            (accountant_id, client_id, type, amount_cents, description, period_month)
          VALUES ($1, $2, 'referral', 1000, $3, date_trunc('month', NOW()))
          ON CONFLICT DO NOTHING
        `, [
          row.accountant_id,
          row.user_id,
          `Referral commission — month ${nextMonth} of ${row.referral_months_total}`,
        ]);

        await client.query(
          `UPDATE accountant_clients SET referral_month = $1 WHERE accountant_id = $2 AND user_id = $3`,
          [nextMonth, row.accountant_id, row.user_id]
        );
        payoutsCreated++;
      }

      // Also count how many eligible relationships were skipped due to inactive subscription
      const skippedResult = await client.query(`
        SELECT COUNT(*) FROM accountant_clients ac
        JOIN users u ON u.id = ac.user_id
        WHERE ac.status = 'active'
          AND ac.referral_month < ac.referral_months_total
          AND u.data->>'subscriptionStatus' NOT IN ('active', 'trialing')
      `);
      payoutsSkipped = parseInt(skippedResult.rows[0].count) || 0;

      return res.json({ success: true, payoutsCreated, payoutsSkipped });
    } finally {
      client.release();
    }
  }));


  // ── 12b. SUSPEND CLIENT COMMISSION (call from Stripe webhook on cancellation) ─
  // When a client cancels their subscription, call this immediately.
  // Their $10/month commission stops — accountant is only paid for active clients.
  // If the client resubscribes later, reactivate-client re-links them.
  app.post('/api/accountants/suspend-client', wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    await pool.query(`
      UPDATE accountant_clients
      SET status = 'suspended'
      WHERE user_id = $1 AND status = 'active'
    `, [userId]);

    return res.json({ success: true, message: 'Client commission suspended. No further payouts until client reactivates.' });
  }));


  // ── 12c. REACTIVATE CLIENT COMMISSION (call from Stripe when client resubscribes) ─
  app.post('/api/accountants/reactivate-client', wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    // Only reactivate if referral months still remain — no extension for cancelled period
    await pool.query(`
      UPDATE accountant_clients
      SET status = 'active'
      WHERE user_id = $1
        AND status = 'suspended'
        AND referral_month < referral_months_total
    `, [userId]);

    return res.json({ success: true });
  }));


  // ── 13. ADMIN: LIST PENDING VERIFICATIONS ─────────────────────────────────
  // Add your admin auth middleware here before deploying
  app.get('/api/admin/accountants/pending', wrap(async (req, res) => {
    // TODO: add requireAdmin middleware
    const result = await pool.query(`
      SELECT id, first_name, last_name, email, firm, country,
             verification_method, verification_data, created_at
      FROM accountants WHERE status = 'pending'
      ORDER BY created_at ASC
    `);
    return res.json(result.rows);
  }));


  // ── 14. ADMIN: APPROVE / REJECT ACCOUNTANT ────────────────────────────────
  app.post('/api/admin/accountants/:id/verify', wrap(async (req, res) => {
    // TODO: add requireAdmin middleware
    const { action, notes } = req.body || {}; // action: 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });

    const newStatus = action === 'approve' ? 'verified' : 'rejected';
    await pool.query(
      `UPDATE accountants SET status = $1, verified_at = $2, updated_at = NOW() WHERE id = $3`,
      [newStatus, action === 'approve' ? new Date() : null, req.params.id]
    );

    // TODO: send email to accountant notifying them of outcome

    return res.json({ success: true, status: newStatus });
  }));


  // ── ACCOUNTANT LOGOUT ─────────────────────────────────────────────────────
  app.post('/api/accountants/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // ── SUBMIT REVIEW (only after completed FinFlow payment) ─────────────────
  app.post('/api/accountants/review', wrap(async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Login required.' });
    const { accountantId, rating, comment } = req.body || {};
    if (!accountantId || !rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Invalid review data.' });

    // Only allow review if client has a completed payment to this accountant
    const paymentCheck = await pool.query(`
      SELECT id FROM accountant_earnings
      WHERE accountant_id = $1 AND client_id = $2 AND type = 'service_commission' AND status = 'pending'
      LIMIT 1
    `, [accountantId, req.session.userId]);
    if (!paymentCheck.rows[0]) {
      return res.status(403).json({ error: 'You can only review an accountant after completing a FinFlow payment with them.' });
    }

    // Upsert review (one per client per accountant)
    await pool.query(`
      INSERT INTO accountant_reviews (accountant_id, client_id, rating, comment, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (accountant_id, client_id) DO UPDATE SET rating = $3, comment = $4, created_at = NOW()
    `, [accountantId, req.session.userId, rating, (comment || '').trim().slice(0, 500)]);

    // Recalculate average rating
    await pool.query(`
      UPDATE accountants SET
        avg_rating = (SELECT AVG(rating) FROM accountant_reviews WHERE accountant_id = $1),
        review_count = (SELECT COUNT(*) FROM accountant_reviews WHERE accountant_id = $1)
      WHERE id = $1
    `, [accountantId]);

    return res.json({ success: true });
  }));

  // ── GET REVIEWS FOR AN ACCOUNTANT ────────────────────────────────────────
  app.get('/api/accountants/:id/reviews', wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT r.rating, r.comment, r.created_at,
             u.data->>'name' AS client_name
      FROM accountant_reviews r
      JOIN users u ON u.id = r.client_id
      WHERE r.accountant_id = $1
      ORDER BY r.created_at DESC LIMIT 20
    `, [req.params.id]);
    return res.json(result.rows);
  }));

  // ── REPORT ACCOUNTANT ─────────────────────────────────────────────────────
  app.post('/api/accountants/report', wrap(async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Login required.' });
    const { accountantId, reason } = req.body || {};
    if (!accountantId || !reason) return res.status(400).json({ error: 'Missing fields.' });

    await pool.query(`
      INSERT INTO accountant_reports (accountant_id, reporter_id, reason, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [accountantId, req.session.userId, reason.trim().slice(0, 1000)]);

    return res.json({ success: true });
  }));

  // ── PUBLIC DIRECTORY — verified accountants only ───────────────────────────
  app.get('/api/accountants/directory', wrap(async (req, res) => {
    const { country, specialisation } = req.query;
    let query = `SELECT id, first_name, last_name, firm, country, specialisation, bio, experience, avg_rating, review_count, credentials, memberships, hourly_rate, packages, has_pricing FROM accountants WHERE status = 'verified'`;
    const params = [];
    if (country) { params.push(country); query += ` AND country = $${params.length}`; }
    if (specialisation) { params.push(specialisation); query += ` AND specialisation = $${params.length}`; }
    query += ' ORDER BY verified_at ASC';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  }));

  // ── CLIENT: GET MY LINKED ACCOUNTANT ──────────────────────────────────────
  app.get('/api/accountants/my-accountant', wrap(async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Login required.' });
    const result = await pool.query(`
      SELECT a.id, a.first_name, a.last_name, a.firm, a.country, a.specialisation, a.experience, a.bio,
             ac.status, ac.access_level
      FROM accountant_clients ac
      JOIN accountants a ON a.id = ac.accountant_id
      WHERE ac.user_id = $1 AND ac.status = 'active'
      LIMIT 1
    `, [req.session.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'No accountant linked.' });
    return res.json(result.rows[0]);
  }));

  // ── CLIENT: REQUEST ACCESS FROM AN ACCOUNTANT ─────────────────────────────
  app.post('/api/accountants/request-access', wrap(async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Login required.' });
    const { accountantId } = req.body || {};
    if (!accountantId) return res.status(400).json({ error: 'accountantId required.' });

    const acc = await pool.query(`SELECT id, status FROM accountants WHERE id = $1`, [accountantId]);
    if (!acc.rows[0] || acc.rows[0].status !== 'verified') return res.status(404).json({ error: 'Accountant not found.' });

    await pool.query(`
      INSERT INTO accountant_clients (accountant_id, user_id, status, referral_months_total)
      VALUES ($1, $2, 'active', 0)
      ON CONFLICT (accountant_id, user_id) DO UPDATE SET status = 'active'
    `, [accountantId, req.session.userId]);

    return res.json({ success: true });
  }));

}; // end registerAccountantRoutes


// ═══════════════════════════════════════════════════════════════════════════════
// HOW TO ADD TO server.js
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. Save this file as accountant-routes.js next to server.js
//
// 2. In server.js, after initDB() and before app.listen(), add:
//
//    const registerAccountantRoutes = require('./accountant-routes');
//    registerAccountantRoutes(app, pool, authLimiter, apiLimiter);
//
// 3. Add SQL tables to initDB() in database.js (see SQL at top of this file)
//
// 4. In your user registration handler, detect ?ref= query param and call:
//    POST /api/accountants/link-client  with { referralCode, userId }
//
// 5. In your Stripe webhook handler, wire up these three events:
//    subscription.status = 'active'    → POST /api/accountants/activate-client    { userId }
//    subscription.status = 'canceled'  → POST /api/accountants/suspend-client     { userId }
//    subscription.status = 'active'    → POST /api/accountants/reactivate-client  { userId }
//      (reactivate fires when a previously cancelled client resubscribes)
//
//    GOLDEN RULE: Commission only pays on active, paying clients.
//    A client who cancels stops earning their accountant $10/month immediately.
//    The cron also double-checks subscription status before every payout.
//
// 6. Set env var:  CRON_SECRET=your-secret-here
//    Schedule:     POST /api/accountants/run-monthly-payouts on the 1st of each month
//                  Set x-cron-secret: your-secret-here header
//
// ═══════════════════════════════════════════════════════════════════════════════
