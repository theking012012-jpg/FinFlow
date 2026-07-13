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

const crypto = require('crypto');
const { db, pool: _dbPool, rowToObj: _rowToObj } = require('./database');
const { tierForAccountant, commissionRateFor, splitBilling, estimateStripeFeeCents } = require('./tier-config'); // F17 — single tier source

// Step F — accountant credential-proof upload (base64-in-Postgres, accountant-scoped).
const CREDENTIAL_MAX_BYTES = 5 * 1024 * 1024; // 5 MB decoded
const CREDENTIAL_ALLOWED_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
/** Validate an optional credential document from the register payload.
 *  → { present:false } if none; { present:true, error } if invalid;
 *    { present:true, ok:true, bytes } if valid. Absent is allowed (not required). */
function validateCredentialDoc(doc) {
  if (!doc || !doc.base64) return { present: false };
  if (typeof doc.base64 !== 'string' || !CREDENTIAL_ALLOWED_TYPES.has(doc.mediaType)) {
    return { present: true, error: 'Credential document must be a PDF, image (JPG/PNG/WebP), or Word document.' };
  }
  const bytes = Math.ceil(doc.base64.length * 0.75);
  if (bytes > CREDENTIAL_MAX_BYTES) return { present: true, error: 'Credential document too large. Maximum size is 5 MB.' };
  return { present: true, ok: true, bytes };
}

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

/** Require the session to be an authenticated AND admin-approved accountant.
 *  F16: status is re-checked from the DB on every request (not trusted from the
 *  session) so an admin suspend/reject revokes access immediately — a session
 *  alone is never sufficient; only status='verified' passes. Uses the module-level
 *  pool (_dbPool) since this helper is defined outside registerAccountantRoutes. */
async function requireAccountant(req, res, next) {
  if (!req.session.accountantId) {
    return res.status(401).json({ error: 'Accountant login required.' });
  }
  try {
    const { rows } = await _dbPool.query(`SELECT status FROM accountants WHERE id = $1`, [req.session.accountantId]);
    if (!rows[0] || rows[0].status !== 'verified') {
      return res.status(403).json({ error: 'Your accountant account is pending review or is not active.' });
    }
    next();
  } catch (e) {
    console.error('[requireAccountant] status check failed:', e.message);
    return res.status(500).json({ error: 'Server error.' });
  }
}

/** Require the session to be an authenticated admin */
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin access required.' });
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
    // F16: NO fake automated verification. There is no live registry integration,
    // so we never claim a membership is "verified" — every application is reviewed
    // manually by a FinFlow admin. Record the attempt honestly for the admin queue.
    return { verified: false, name: null, status: 'Pending manual review by FinFlow' };
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

module.exports = function registerAccountantRoutes(app, pool, authLimiter, apiLimiter, stripe, resendClient, computeBooks) {

  // ── 1. REGISTER AS ACCOUNTANT ─────────────────────────────────────────────
  app.post('/api/accountants/register', authLimiter, wrap(async (req, res) => {
    const {
      firstName, lastName, email, password,
      firm, country, specialisation, bio, experience,
      referralCode: referredByCode,
      verification,
    } = req.body || {};

    console.log('[Register] req.body fields:', JSON.stringify({ firstName, lastName, email: email ? '***' : undefined, firm, country, specialisation, experience, verificationMethod: verification?.method }));

    // Validate required fields
    const _required = { firstName, lastName, email, password, firm, country, specialisation };
    const _missing = Object.keys(_required).filter(k => !_required[k]);
    if (_missing.length > 0) {
      return res.status(400).json({ error: 'Missing required fields: ' + _missing.join(', ') });
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

    // Step F: validate the optional credential document BEFORE creating anything, so
    // a present-but-invalid file fails the whole submission (never silently dropped —
    // that would leave the accountant believing they submitted proof when they didn't).
    const credDoc = validateCredentialDoc(req.body.credentialDoc);
    if (credDoc.present && credDoc.error) {
      return res.status(400).json({ error: credDoc.error });
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

      // Step F: persist the credential proof (if supplied), accountant-scoped, in the
      // same transaction so the document and the accountant row commit atomically.
      // Base64-in-Postgres, mirroring the documents system; admin views it at review.
      if (credDoc.present && credDoc.ok) {
        const cd = req.body.credentialDoc;
        await client.query(
          `INSERT INTO accountant_documents (accountant_id, doc_type, file_name, media_type, size_bytes, file_data)
           VALUES ($1, 'credential_proof', $2, $3, $4, $5)`,
          [accountantId, String(cd.fileName || 'credential').slice(0, 255), cd.mediaType, credDoc.bytes, cd.base64]
        );
        await client.query(
          `INSERT INTO admin_log (action, target_type, target_id, notes, created_at)
           VALUES ('credential_upload', 'accountant', $1, $2, NOW())`,
          [accountantId, `Credential proof uploaded at registration (${cd.mediaType}, ${Math.round(credDoc.bytes / 1024)} KB)`]
        ).catch(() => {});
      }

      // Save credentials extracted from CV
      if (req.body.credentials || req.body.memberships) {
        await client.query(
          `UPDATE accountants SET credentials = $1, memberships = $2 WHERE id = $3`,
          [req.body.credentials || '', req.body.memberships || '', accountantId]
        ).catch(e => console.error('[Register] Credentials save failed:', e.message));
      }

      // If membership verification — attempt auto-lookup but do NOT auto-approve.
      // Record the lookup result for admin review; admin must manually verify.
      if (verification.method === 'membership' && verification.profBody && verification.membershipNumber) {
        const lookup = await lookupMembership(verification.profBody, verification.membershipNumber);
        await client.query(
          `UPDATE accountants SET verification_data = verification_data || $1 WHERE id = $2`,
          [JSON.stringify({ lookupAttempted: true, lookupVerified: lookup.verified, lookupResult: lookup.status }), accountantId]
        ).catch(e => console.error('[Register] Lookup result save failed:', e.message));
        // Status stays 'pending' — admin reviews and approves manually
      }
      // All verification methods stay 'pending' — admin does final approval

      // Notify admin of new application
      if (resendClient) {
        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
          resendClient.emails.send({
            from: process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
            to: adminEmail,
            subject: `New accountant application from ${firstName} ${lastName} (${firm})`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0e0e0c;color:#f0ead6;border-radius:12px"><h2 style="color:#c9a84c;margin-bottom:16px">FinFlow Admin</h2><p>New accountant application received:</p><ul style="margin:12px 0;padding-left:20px;line-height:1.8"><li><strong>Name:</strong> ${firstName} ${lastName}</li><li><strong>Firm:</strong> ${firm}</li><li><strong>Email:</strong> ${email}</li><li><strong>Country:</strong> ${country}</li><li><strong>Specialisation:</strong> ${specialisation}</li><li><strong>Verification:</strong> ${verification.method}</li></ul><a href="${process.env.APP_URL || 'https://finflow-production-8e57.up.railway.app'}/admin" style="display:inline-block;background:#c9a84c;color:#0e0e0c;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">Review in Admin Panel →</a></div>`,
          }).catch(e => console.error('[Register] Admin notification failed:', e.message));
        } else {
          // TODO: set ADMIN_EMAIL env var to enable admin email notifications
          console.log(`[Register] New application from ${firstName} ${lastName} (${firm}) — set ADMIN_EMAIL to enable notifications`);
        }
      } else {
        // TODO: set RESEND_API_KEY env var to enable email notifications
        console.log(`[Register] New application from ${firstName} ${lastName} (${firm}) — configure RESEND_API_KEY to enable email notifications`);
      }

      // F16: NO session at signup. The application is 'pending' until an admin
      // approves it — no session, no access, not listed. A pre-approval session
      // was the hole that let unverified accountants straight into the portal.
      return res.status(201).json({
        success: true,
        accountantId,
        referralCode: refCode,
        status: 'pending-review',
        message: 'Application received. A FinFlow admin will review your credentials; you will be notified when your profile is approved. You can log in once approved.',
      });

    } finally {
      client.release();
    }
  }));


  // ── RESUME / CV EXTRACTION ───────────────────────────────────────────────────
  // TODO: add rate limit — rateLimit({ windowMs: 60*60*1000, max: 10 })
  app.post('/api/accountants/extract-resume', apiLimiter, wrap(async (req, res) => {
    if (!req.session.accountantId && !req.session.userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const { base64, mediaType, isPDF, isWord, fileName } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'No file data received.' });
    if (base64.length > 1000000) return res.status(413).json({ error: 'File too large. Maximum 750KB.' });

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

  // ── 2. MEMBERSHIP CHECK ───────────────────────────────────────────────────
  // F16: there is NO automated verification. This endpoint no longer returns a
  // "verified" verdict (the old ≥6-char mock was a fake). It only acknowledges the
  // number and states, honestly, that a FinFlow admin will review it manually.
  app.post('/api/accountants/verify-membership', authLimiter, wrap(async (req, res) => {
    const { profBody, membershipNumber } = req.body || {};
    if (!profBody || !membershipNumber) {
      return res.status(400).json({ error: 'Professional body and membership number are required.' });
    }
    return res.json({ verified: false, pending: true, status: 'Pending manual review by FinFlow',
      message: 'Your membership will be verified manually by FinFlow before your profile goes live.' });
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

    // F16: only an admin-approved (status='verified') accountant gets a session.
    // Pending/rejected/suspended authenticate correctly but receive NO session and
    // NO access — an honest status-specific message instead.
    if (acc.status !== 'verified') {
      const msg = acc.status === 'pending'
        ? 'Your application is still under review. You will be able to log in once a FinFlow admin approves your credentials.'
        : acc.status === 'rejected'
        ? 'Your application was not approved. Please contact support or reapply with updated credentials.'
        : 'Your accountant account is currently suspended. Please contact support.';
      return res.status(403).json({ error: msg, status: acc.status });
    }

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
      SELECT u.id,
             u.data->>'email' AS client_email,
             u.data->>'name'  AS client_name,
             u.data->>'plan'  AS client_plan,
             u.data->>'subscriptionStatus' AS subscription_status,
             ac.status,
             ac.invited_at AS created_at,
             ac.referral_month,
             ac.referral_months_total
      FROM users u
      JOIN accountant_clients ac ON ac.user_id = u.id
      WHERE ac.accountant_id = $1
      ORDER BY ac.invited_at DESC
    `, [req.session.accountantId]);

    return res.json(result.rows);
  }));


  // ── 6. GET CLIENT BOOKS (with permission check) ───────────────────────────
  app.get('/api/accountants/clients/:userId/books', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });

    // Block pending/suspended accountants from reading books
    const accStatus = await pool.query(
      `SELECT status FROM accountants WHERE id = $1`,
      [req.session.accountantId]
    );
    if (!accStatus.rows[0] || accStatus.rows[0].status !== 'verified') {
      return res.status(403).json({ error: 'Your account must be verified before accessing client books.' });
    }

    // Verify access SOLELY via a consented, active client relationship (F1).
    const access = await pool.query(
      `SELECT ac.access_level FROM accountant_clients ac
       WHERE ac.accountant_id = $1 AND ac.user_id = $2 AND ac.status = 'active'
       LIMIT 1`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access to this client.' });

    // Fetch all client data
    const [invoices, expenses, entities, settings, payroll, journals, customers, bills] = await Promise.all([
      pool.query(`SELECT id, entity_id, data FROM invoices WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT id, entity_id, data FROM expenses WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT id, data->>'name' AS name, data->>'color' AS color, data->>'currency' AS currency FROM entities WHERE user_id = $1 ORDER BY id`, [userId]),
      pool.query(`SELECT data FROM users WHERE id = $1 LIMIT 1`, [userId]),
      pool.query(`SELECT data FROM payroll WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT data FROM journals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]),
      pool.query(`SELECT data FROM customers WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT id, entity_id, data FROM bills WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    ]);

    const taxRate = parseFloat(settings.rows[0]?.data?.tax_rate || 0);

    // Optional entity scope (?entity_id=) + period (?period=month|quarter|year; 'all'→year).
    // Default: all entities, year. Both mirror the client dashboard so totals reconcile at
    // the same entity AND the same period.
    const entParam = req.query.entity_id;
    const entityId = entParam != null && /^[1-9][0-9]*$/.test(String(entParam)) ? parseInt(entParam) : null;
    const period = ['month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'year';
    const entMatch = eid => eid == null || eid === entityId || entityId == null;

    // Canonical, entity-scoped books (F9) — the SAME computeBooks the client dashboard uses,
    // so the accountant's totals reconcile. Revenue = paid invoices + sales receipts +
    // payments received (fixes the old "count UNPAID invoices as income" bug); OpEx includes
    // payments made + payroll accrual; NetProfit subtracts FIFO COGS.
    const books = await computeBooks(userId, entityId, period);
    // Per-entity canonical summaries (same period) so the portal's entity tabs reconcile.
    const summariesByEntity = {};
    for (const er of entities.rows) summariesByEntity[er.id] = await computeBooks(userId, er.id, period);

    // Accounts payable (unpaid bills), entity-scoped to match the selected view.
    const unpaidBills = bills.rows
      .filter(r => r.data?.status === 'unpaid' && entMatch(r.entity_id))
      .reduce((s, r) => s + (parseFloat(r.data?.amount) || 0), 0);

    return res.json({
      accessLevel: access.rows[0].access_level,
      taxRate,
      entityId, // echoes the scope applied (null = all entities)
      period,   // echoes the period applied (month|quarter|year)
      summary: {
        // Canonical values (F9). Legacy keys kept as aliases so nothing breaks.
        revenue:       books.revenue.toFixed(2),
        cogs:          books.cogs.toFixed(2),
        grossProfit:   books.grossProfit.toFixed(2),
        opex:          books.opex.toFixed(2),
        netProfit:     books.netProfit.toFixed(2),
        outstanding:   books.outstanding.toFixed(2),
        totalIncome:   books.revenue.toFixed(2),  // legacy alias → now paid-only canonical revenue
        totalExpenses: books.opex.toFixed(2),      // legacy alias → now canonical OpEx
        parts:         books.parts,
      },
      summariesByEntity,
      entities:    entities.rows.map(r => ({ id: r.id, name: r.name, color: r.color || '#c9a84c', currency: r.currency || 'USD' })),
      allInvoices: invoices.rows.map(r => ({ ...r.data, id: r.id, entity_id: r.entity_id })),
      allExpenses: expenses.rows.map(r => ({ ...r.data, id: r.id, entity_id: r.entity_id })),
      allPayroll:  access.rows[0].access_level === 'view' ? [] : payroll.rows.map(r => r.data),
      allJournals: journals.rows.map(r => r.data),
      allCustomers: customers.rows.map(r => r.data),
      balanceSheet: {
        accountsReceivable: books.outstanding.toFixed(2),
        accountsPayable:    unpaidBills.toFixed(2),
        totalPayroll:       books.parts.payroll.toFixed(2),
      },
      recentInvoices: invoices.rows.map(r => r.data).slice(0, 10),
      recentExpenses: expenses.rows.map(r => r.data).slice(0, 10),
    });
  }));

  // ── ADD JOURNAL ENTRY ON BEHALF OF CLIENT ────────────────────────────────
  app.post('/api/accountants/clients/:userId/journal', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
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
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const { period, locked } = req.body || {};
    const access = await pool.query(
      `SELECT access_level FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    if (access.rows[0].access_level === 'view') return res.status(403).json({ error: 'View-only access.' });
    const { rows: [_lsAcc] } = await pool.query(
      `SELECT * FROM lock_settings WHERE user_id = $1 AND data->>'period' = $2 LIMIT 1`,
      [parseInt(userId), period]
    );
    if (_lsAcc) {
      await db.updateById('lock_settings', _lsAcc.id, { locked: locked ? 1 : 0, locked_by: `accountant:${req.session.accountantId}` });
    } else {
      await db.insert('lock_settings', { user_id: parseInt(userId), period, locked: locked ? 1 : 0, locked_by: `accountant:${req.session.accountantId}` });
    }
    res.json({ ok: true });
  }));


  // ── 7. ACCOUNTANT NOTES ON CLIENT (GET + POST) ───────────────────────────
  app.get('/api/accountants/clients/:userId/notes', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const access = await pool.query(
      `SELECT notes FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    res.json({ note: access.rows[0].notes || '' });
  }));

  app.post('/api/accountants/clients/:userId/notes', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const { note } = req.body || {};
    const access = await pool.query(
      `SELECT id FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    await pool.query(
      `UPDATE accountant_clients SET notes = $1 WHERE accountant_id = $2 AND user_id = $3`,
      [(note || '').slice(0, 2000), req.session.accountantId, userId]
    );
    res.json({ ok: true });
  }));

  // ── 8. FLAG A TRANSACTION ─────────────────────────────────────────────────
  app.post('/api/accountants/clients/:userId/flag', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const { type, ref, message } = req.body || {};
    const access = await pool.query(
      `SELECT id FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    await pool.query(`
      INSERT INTO accountant_reports (accountant_id, reporter_id, reason, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [req.session.accountantId, parseInt(userId), JSON.stringify({ type, ref, message })]);
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


  // ── 8. LINK CLIENT — REMOVED (F1 cross-tenant breach) ──────────────────────
  // This route was the sole writer of users.data.accountant_id and let any verified
  // accountant self-link to an arbitrary user with no consent, then read their books
  // via the JSONB access branch below. It was also unreachable from the UI. The
  // legitimate referral link (a status='pending' accountant_clients row) is created
  // server-side by the register route (server.js) when a user signs up via ?ref=code;
  // access is granted only after that relationship reaches status='active'.


  // ── 9. ACTIVATE CLIENT (called when client completes payment/trial) ────────
  // Call this from your Stripe webhook when a client's subscription activates.
  app.post('/api/accountants/activate-client', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    const client = await pool.connect();
    try {
      const result = await client.query(`
        UPDATE accountant_clients
        SET status = 'active', activated_at = NOW()
        WHERE user_id = $1 AND accountant_id = $2 AND status = 'pending'
        RETURNING accountant_id, referral_months_total
      `, [userId, req.session.accountantId]);

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'No pending client found for this accountant.' });
      }

      const { accountant_id, referral_months_total } = result.rows[0];
      await client.query(`
        INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, period_month)
        VALUES ($1, $2, 'referral', 1000, 'Referral commission — month 1', date_trunc('month', NOW()))
      `, [accountant_id, userId]);

      return res.json({ success: true });
    } finally {
      client.release();
    }
  }));

  app.post('/api/accountants/reject-client', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    if (!userId) return res.status(400).json({ error: 'userId required.' });
    await pool.query(
      `UPDATE accountant_clients SET status = 'rejected' WHERE user_id = $1 AND accountant_id = $2`,
      [userId, req.session.accountantId]
    );
    return res.json({ success: true });
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


  // ── 11. RECORD SERVICE COMMISSION (non-Stripe / manual ledger path) ───────
  // The live billing path is bill-client (Stripe). This route records the same
  // money split for a manually-collected bill. F17: the rate is the LIVE tier rate
  // (no hardcoded 4%), and the row records the full split via the shared helper.
  app.post('/api/accountants/record-commission', requireAccountant, wrap(async (req, res) => {
    const accountantId = req.session.accountantId;
    const { userId, billedAmountCents, description } = req.body || {};
    if (!accountantId || !billedAmountCents) return res.status(400).json({ error: 'Missing fields.' });

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
        WHERE ac.accountant_id = $1 AND ac.status = 'active' AND u.data->>'subscriptionStatus' = 'active'`,
      [accountantId]
    );
    const activeCount = parseInt(countRes.rows[0].count) || 0;
    const rate  = commissionRateFor(activeCount);
    const split = splitBilling(billedAmountCents, rate, estimateStripeFeeCents(billedAmountCents));

    await pool.query(`
      INSERT INTO accountant_earnings
        (accountant_id, client_id, type, amount_cents, billed_cents, commission_cents,
         stripe_fee_cents, description, status, period_month)
      VALUES ($1,$2,'service_commission',$3,$4,$5,$6,$7,'pending', date_trunc('month', NOW()))
    `, [accountantId, userId || null, split.accountantNetCents, split.billedCents,
        split.commissionCents, split.stripeFeeCents, description || 'Service commission']);

    return res.json({ success: true, commissionRate: rate, ...split,
      commissionFormatted: '$' + (split.commissionCents / 100).toFixed(2) });
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
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'Cron not configured.' });
    if (!process.env.CRON_SECRET || !crypto.timingSafeEqual(
      Buffer.from(secret || '').slice(0, 64),
      Buffer.from(process.env.CRON_SECRET).slice(0, 64)
    )) {
      return res.status(401).json({ error: 'Unauthorized' });
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
          AND u.data->>'subscriptionStatus' = 'active'
      `);
      // F17: pay only on PAYING clients (subscriptionStatus='active'). Trialing,
      // canceled, past_due, unpaid, or missing are excluded — no commission this month.

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
          AND u.data->>'subscriptionStatus' IS DISTINCT FROM 'active'
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
  app.post('/api/accountants/suspend-client', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    await pool.query(`
      UPDATE accountant_clients
      SET status = 'suspended'
      WHERE user_id = $1 AND status = 'active' AND accountant_id = $2
    `, [userId, req.session.accountantId]);

    return res.json({ success: true, message: 'Client commission suspended. No further payouts until client reactivates.' });
  }));


  // ── 12c. REACTIVATE CLIENT COMMISSION (call from Stripe when client resubscribes) ─
  app.post('/api/accountants/reactivate-client', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    // Only reactivate if referral months still remain — no extension for cancelled period
    await pool.query(`
      UPDATE accountant_clients
      SET status = 'active'
      WHERE user_id = $1
        AND status = 'suspended'
        AND referral_month < referral_months_total
        AND accountant_id = $2
    `, [userId, req.session.accountantId]);

    return res.json({ success: true });
  }));


  // ── 13. ADMIN: LIST PENDING VERIFICATIONS ─────────────────────────────────
  // Add your admin auth middleware here before deploying
  app.get('/api/admin/accountants/pending', requireAdmin, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT id, first_name, last_name, email, firm, country,
             verification_method, verification_data, created_at
      FROM accountants WHERE status = 'pending'
      ORDER BY created_at ASC
    `);
    return res.json(result.rows);
  }));


  // ── 14. ADMIN: APPROVE / REJECT ACCOUNTANT — handled by admin-routes.js ─────
  // Route removed: POST /api/admin/accountants/:id/verify is defined in admin-routes.js
  // (supports approve/reject/suspend/reinstate, logs to admin_log, sends email via Resend)


  // ── CLIENT NOTIFY ─────────────────────────────────────────────────────────
  app.post('/api/accountants/clients/:userId/notify', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const { message } = req.body || {};
    const access = await pool.query(
      `SELECT 1 FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    await pool.query(
      `INSERT INTO admin_log (action, target_type, target_id, notes, created_at) VALUES ($1,'user',$2,$3,NOW())`,
      ['accountant_notification', userId, (message || '').slice(0, 500)]
    ).catch(() => {});
    return res.json({ ok: true });
  }));

  // ── AI INSIGHTS ────────────────────────────────────────────────────────────
  app.post('/api/accountants/clients/:userId/ai-insights', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const access = await pool.query(
      `SELECT 1 FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });

    const [invR, expR, payR] = await Promise.all([
      pool.query(`SELECT data FROM invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]),
      pool.query(`SELECT data FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]),
      pool.query(`SELECT data FROM payroll WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    ]);
    const invs = invR.rows.map(r => r.data || {});
    const exps = expR.rows.map(r => r.data || {});
    const pays = payR.rows.map(r => r.data || {});
    const paidRev = invs.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const outstanding = invs.filter(i => i.status !== 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const overdueCnt = invs.filter(i => i.status === 'overdue').length;
    const totalExp = exps.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const payrollTotal = pays.reduce((s, p) => s + (parseFloat(p.gross) || 0), 0);

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) return res.status(503).json({ error: 'AI not configured (ANTHROPIC_API_KEY missing).' });

    const prompt = `You are a professional accountant reviewing a client's financial data. Give 5 concise insights (one per line, no numbering or bullet symbols) covering: outstanding invoice risk, expense patterns, tax filing readiness, cash flow health, and your top recommendation.

Client data:
- Paid revenue: $${paidRev.toFixed(2)}
- Outstanding invoices: $${outstanding.toFixed(2)} (${overdueCnt} overdue)
- Total expenses: $${totalExp.toFixed(2)}
- Payroll: $${payrollTotal.toFixed(2)}
- Invoice count: ${invs.length}, Expense count: ${exps.length}

Respond with exactly 5 lines. No bullets, no numbers, no symbols.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!aiRes.ok) return res.status(502).json({ error: 'AI service unavailable.' });
    const aiData = await aiRes.json();
    return res.json({ insights: aiData.content?.[0]?.text || '' });
  }));

  // ── CHECKLIST ──────────────────────────────────────────────────────────────
  app.get('/api/accountants/clients/:userId/checklist', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const r = await pool.query(
      `SELECT checklist FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!r.rows[0]) return res.status(403).json({ error: 'No access.' });
    return res.json({ checklist: r.rows[0].checklist || {} });
  }));

  app.post('/api/accountants/clients/:userId/checklist', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const { checklist } = req.body || {};
    if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
      return res.status(400).json({ error: 'checklist must be an object' });
    }
    const r = await pool.query(
      `SELECT id FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.session.accountantId, userId]
    );
    if (!r.rows[0]) return res.status(403).json({ error: 'No access.' });
    await pool.query(
      `UPDATE accountant_clients SET checklist = $1 WHERE accountant_id = $2 AND user_id = $3`,
      [checklist, req.session.accountantId, userId]
    );
    return res.json({ ok: true });
  }));

  // ── MESSAGES ───────────────────────────────────────────────────────────────
  // CREATE TABLE IF NOT EXISTS accountant_messages (
  //   id            SERIAL PRIMARY KEY,
  //   accountant_id INTEGER NOT NULL,
  //   client_id     INTEGER NOT NULL,
  //   message       TEXT NOT NULL,
  //   sender        VARCHAR(20) NOT NULL DEFAULT 'accountant',
  //   created_at    TIMESTAMPTZ DEFAULT NOW()
  // );
  app.get('/api/accountants/clients/:userId/message', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const access = await pool.query(
      `SELECT 1 FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    const msgs = await pool.query(
      `SELECT id, message, sender, created_at FROM accountant_messages
       WHERE accountant_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 100`,
      [req.session.accountantId, userId]
    ).catch(() => ({ rows: [] }));
    return res.json(msgs.rows);
  }));

  app.post('/api/accountants/clients/:userId/message', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Message required.' });
    const access = await pool.query(
      `SELECT 1 FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    const row = await pool.query(
      `INSERT INTO accountant_messages (accountant_id, user_id, message, sender)
       VALUES ($1, $2, $3, 'accountant') RETURNING id, message, sender, created_at`,
      [req.session.accountantId, userId, message.trim().slice(0, 2000)]
    );
    return res.json(row.rows[0]);
  }));

  // ── MESSAGES (PLURAL alias — /messages vs legacy /message singular) ─────────
  app.get('/api/accountants/clients/:userId/messages', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const access = await pool.query(
      `SELECT 1 FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    const { rows } = await pool.query(
      `SELECT id, message AS content, sender, created_at FROM accountant_messages
       WHERE accountant_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 200`,
      [req.session.accountantId, userId]
    ).catch(() => ({ rows: [] }));
    res.json(rows.map(r => ({ ...r, sender_name: r.sender === 'accountant' ? 'Your accountant' : 'Client' })));
  }));

  app.post('/api/accountants/clients/:userId/messages', requireAccountant, apiLimiter, wrap(async (req, res) => {
    const { userId } = req.params;
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    const content = String(req.body.content || req.body.message || '').trim().slice(0, 2000);
    if (!content) return res.status(400).json({ error: 'Message required.' });
    const access = await pool.query(
      `SELECT 1 FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [req.session.accountantId, userId]
    );
    if (!access.rows[0]) return res.status(403).json({ error: 'No access.' });
    const row = await pool.query(
      `INSERT INTO accountant_messages (accountant_id, user_id, message, sender, created_at)
       VALUES ($1, $2, $3, 'accountant', NOW()) RETURNING id, message AS content, sender, created_at`,
      [req.session.accountantId, userId, content]
    );
    res.json(row.rows[0]);
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

    // Only allow review if client is an active linked client of this accountant
    const paymentCheck = await pool.query(`
      SELECT 1 FROM accountant_clients WHERE user_id = $1 AND accountant_id = $2 AND status = 'active'
    `, [req.session.userId, accountantId]);
    if (!paymentCheck.rows[0]) {
      return res.status(403).json({ error: 'You can only review an accountant you are actively linked with.' });
    }

    // Upsert review (one per client per accountant)
    await pool.query(`
      INSERT INTO accountant_reviews (accountant_id, client_id, rating, comment, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (accountant_id, client_id) DO UPDATE SET rating = $3, comment = $4, created_at = NOW()
    `, [accountantId, req.session.userId, rating, (comment || '').trim().slice(0, 500)]);

    // Recalculate average rating — ROUND to 2dp; COALESCE keeps current value if subquery returns NULL
    await pool.query(`
      UPDATE accountants SET
        avg_rating = COALESCE(ROUND((SELECT AVG(rating) FROM accountant_reviews WHERE accountant_id = $1)::numeric, 2), avg_rating),
        review_count = (SELECT COUNT(*) FROM accountant_reviews WHERE accountant_id = $1)
      WHERE id = $1
    `, [accountantId]);

    return res.json({ success: true });
  }));

  // ── GET REVIEWS FOR AN ACCOUNTANT ────────────────────────────────────────
  app.get('/api/accountants/:id/reviews', wrap(async (req, res) => {
    if (!/^[1-9][0-9]*$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
    const result = await pool.query(`
      SELECT r.rating, r.comment, r.created_at,
             LEFT(u.data->>'name', 1) || '.' AS client_initial
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
    try {
      const { country, specialisation } = req.query;
      let query = `SELECT id, first_name, last_name, firm, country, specialisation, bio, experience, avg_rating, review_count, credentials, memberships, hourly_rate, packages, has_pricing FROM accountants WHERE status = 'verified'`;
      const params = [];
      if (country) { params.push(country); query += ` AND country = $${params.length}`; }
      if (specialisation) { params.push(specialisation); query += ` AND specialisation = $${params.length}`; }
      query += ' ORDER BY avg_rating DESC NULLS LAST, review_count DESC, verified_at ASC';
      const result = await pool.query(query, params);
      return res.json(result.rows);
    } catch (e) {
      console.error('[GET /api/accountants/directory] failed:', e.code, e.message);
      // 42P01 = relation does not exist — accountants table not provisioned
      // on this deployment. Fail soft so the marketplace page renders empty
      // instead of throwing a 500 that breaks the rest of the app.
      if (e.code === '42P01') return res.json([]);
      return res.json([]);
    }
  }));

  // ── CLIENT: GET MY LINKED ACCOUNTANT ──────────────────────────────────────
  app.get('/api/accountants/my-accountant', wrap(async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Login required.' });
    const result = await pool.query(`
      SELECT a.id, a.first_name, a.last_name, a.firm, a.country, a.specialisation, a.experience, a.bio,
             ac.status, ac.access_level
      FROM accountant_clients ac
      JOIN accountants a ON a.id = ac.accountant_id
      WHERE ac.user_id = $1 AND ac.status IN ('active', 'pending')
      ORDER BY ac.invited_at DESC
      LIMIT 1
    `, [req.session.userId]);
    // No accountant linked yet — return an empty object (200) rather than 404
    // so the client renders an empty state instead of treating it as an error.
    if (!result.rows[0]) return res.json({});
    return res.json(result.rows[0]);
  }));

  // ── CLIENT: REQUEST ACCESS FROM AN ACCOUNTANT ─────────────────────────────
  app.post('/api/accountants/request-access', wrap(async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Login required.' });
    const { accountantId } = req.body || {};
    if (!accountantId) return res.status(400).json({ error: 'accountantId required.' });

    const acc = await pool.query(`SELECT id, status FROM accountants WHERE id = $1`, [accountantId]);
    if (!acc.rows[0] || acc.rows[0].status !== 'verified') return res.status(404).json({ error: 'Accountant not found.' });

    // Check if already linked (don't allow duplicate requests)
    const existing = await pool.query(
      `SELECT status FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`,
      [accountantId, req.session.userId]
    );
    if (existing.rows[0]) {
      const s = existing.rows[0].status;
      if (s === 'active')   return res.status(409).json({ error: 'You are already linked to this accountant.' });
      if (s === 'pending')  return res.status(409).json({ error: 'You already have a pending request with this accountant.' });
    }

    // Create a PENDING record — accountant must approve before getting books access
    // referral_months_total = 0 until approved (then set based on tier at activation time)
    await pool.query(`
      INSERT INTO accountant_clients (accountant_id, user_id, status, referral_months_total)
      VALUES ($1, $2, 'pending', 0)
      ON CONFLICT (accountant_id, user_id) DO UPDATE SET status = 'pending'
    `, [accountantId, req.session.userId]);

    // Notify accountant by email
    const [userRes, accRes] = await Promise.all([
      pool.query(`SELECT data->>'email' AS email, data->>'name' AS name FROM users WHERE id = $1`, [req.session.userId]),
      pool.query(`SELECT email, first_name FROM accountants WHERE id = $1`, [accountantId]),
    ]);
    const clientEmail = userRes.rows[0]?.email || 'Unknown';
    const clientName  = userRes.rows[0]?.name  || clientEmail;
    const accEmail    = accRes.rows[0]?.email;
    const accFirst    = accRes.rows[0]?.first_name || 'there';
    if (accEmail && resendClient) {
      resendClient.emails.send({
        from: process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.io>',
        to: accEmail,
        subject: `New client request — ${clientName}`,
        html: `<p>Hi ${accFirst},</p>
               <p><strong>${clientName}</strong> (${clientEmail}) has requested to link with you on FinFlow.</p>
               <p>Log in to your accountant dashboard to review and approve or decline the request.</p>
               <p><a href="${process.env.APP_URL || 'https://app.finflow.io'}/accountant">Review request →</a></p>`,
      }).catch(() => {});
    }

    return res.json({ success: true, message: 'Request sent. The accountant will review and approve your request.' });
  }));

  // ── PENDING ACCESS REQUESTS ───────────────────────────────────────────────

  // GET — fetch all pending client access requests for this accountant
  app.get('/api/accountants/pending-requests', requireAccountant, wrap(async (req, res) => {
    const result = await pool.query(`
      SELECT
        ac.user_id,
        ac.created_at   AS requested_at,
        u.data->>'email' AS client_email,
        u.data->>'name'  AS client_name,
        u.data->>'plan'  AS client_plan
      FROM accountant_clients ac
      JOIN users u ON u.id = ac.user_id
      WHERE ac.accountant_id = $1 AND ac.status = 'pending'
      ORDER BY ac.created_at DESC
    `, [req.session.accountantId]);
    return res.json(result.rows);
  }));

  // POST — approve a pending client request
  app.post('/api/accountants/approve-request', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    const conn = await pool.connect();
    try {
      // F17: referral months FROZEN here at approval, from the shared tier ladder.
      // "Active client" = consented AND paying (subscriptionStatus='active'); trial
      // clients do NOT count toward tier.
      const countRes = await conn.query(
        `SELECT COUNT(*) FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
          WHERE ac.accountant_id = $1 AND ac.status = 'active' AND u.data->>'subscriptionStatus' = 'active'`,
        [req.session.accountantId]
      );
      const count  = parseInt(countRes.rows[0].count) || 0;
      const months = tierForAccountant(count).referralMonths;

      // Activate the pending record
      const upd = await conn.query(`
        UPDATE accountant_clients
        SET status = 'active', activated_at = NOW(), referral_months_total = $3
        WHERE user_id = $1 AND accountant_id = $2 AND status = 'pending'
        RETURNING user_id
      `, [userId, req.session.accountantId, months]);
      if (!upd.rows[0]) return res.status(404).json({ error: 'Pending request not found.' });

      // First month referral earning
      await conn.query(`
        INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, period_month)
        VALUES ($1, $2, 'referral', 1000, 'Referral commission — month 1', date_trunc('month', NOW()))
      `, [req.session.accountantId, userId]);

      // Email the client
      const [uRes, aRes] = await Promise.all([
        conn.query(`SELECT data->>'email' AS email, data->>'name' AS name FROM users WHERE id = $1`, [userId]),
        conn.query(`SELECT first_name, last_name, firm FROM accountants WHERE id = $1`, [req.session.accountantId]),
      ]);
      const clientEmail = uRes.rows[0]?.email;
      const accName = `${aRes.rows[0]?.first_name || ''} ${aRes.rows[0]?.last_name || ''}`.trim();
      const firm    = aRes.rows[0]?.firm || 'your accountant';
      if (clientEmail && resendClient) {
        resendClient.emails.send({
          from: process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.io>',
          to: clientEmail,
          subject: 'Your accountant request has been approved',
          html: `<p>Hi ${uRes.rows[0]?.name || 'there'},</p>
                 <p><strong>${accName}</strong> from <strong>${firm}</strong> has approved your request on FinFlow.</p>
                 <p>They now have read access to your books and can help manage your accounts.</p>
                 <p><a href="${process.env.APP_URL || 'https://app.finflow.io'}">Log in to FinFlow →</a></p>`,
        }).catch(() => {});
      }

      return res.json({ success: true, referralMonths: months });
    } finally {
      conn.release();
    }
  }));

  // POST — decline a pending client request
  app.post('/api/accountants/decline-request', requireAccountant, wrap(async (req, res) => {
    const { userId } = req.body || {};
    if (!/^[1-9][0-9]*$/.test(String(userId))) return res.status(400).json({ error: 'Invalid userId.' });
    if (!userId) return res.status(400).json({ error: 'userId required.' });
    await pool.query(
      `DELETE FROM accountant_clients WHERE user_id = $1 AND accountant_id = $2 AND status = 'pending'`,
      [userId, req.session.accountantId]
    );
    return res.json({ success: true });
  }));

  // ── STRIPE STATUS ─────────────────────────────────────────────────────────
  app.get('/api/accountants/stripe-status', requireAccountant, async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT stripe_account_id FROM accountants WHERE id = $1',
        [req.session.accountantId]
      );
      const acct = rows[0];
      if (!acct?.stripe_account_id) return res.json({ connected: false, accountId: null });
      if (stripe) {
        const stripeAcct = await stripe.accounts.retrieve(acct.stripe_account_id).catch(() => null);
        return res.json({
          connected: !!stripeAcct?.charges_enabled,
          accountId: acct.stripe_account_id,
          chargesEnabled: stripeAcct?.charges_enabled || false,
          payoutsEnabled: stripeAcct?.payouts_enabled || false,
          requirements: stripeAcct?.requirements?.currently_due || []
        });
      }
      return res.json({ connected: false, accountId: acct.stripe_account_id, chargesEnabled: false, message: 'Stripe not configured on server' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── STRIPE CONNECT ────────────────────────────────────────────────────────
  app.post('/api/accountants/stripe-connect', requireAccountant, async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
      const { rows } = await pool.query('SELECT * FROM accountants WHERE id = $1', [req.session.accountantId]);
      const acct = rows[0];
      if (!acct) return res.status(404).json({ error: 'Accountant not found' });
      let stripeAccountId = acct.stripe_account_id;
      if (!stripeAccountId) {
        const stripeAcct = await stripe.accounts.create({
          type: 'express',
          email: acct.email,
          capabilities: { transfers: { requested: true } },
          business_type: 'individual',
          individual: { first_name: acct.first_name, last_name: acct.last_name },
          metadata: { accountant_id: acct.id }
        });
        stripeAccountId = stripeAcct.id;
        await pool.query('UPDATE accountants SET stripe_account_id = $1 WHERE id = $2', [stripeAccountId, acct.id]);
      }
      const appUrl = process.env.APP_URL || 'https://finflow-production-0817.up.railway.app';
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${appUrl}/accountant?stripe=refresh`,
        return_url: `${appUrl}/accountant?stripe=success`,
        type: 'account_onboarding'
      });
      res.json({ url: accountLink.url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── BILL CLIENT ───────────────────────────────────────────────────────────
  app.post('/api/accountants/bill-client', requireAccountant, async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
      const { clientId, amount, description, currency = 'usd' } = req.body;
      if (!clientId || !amount) return res.status(400).json({ error: 'clientId and amount required' });
      const { rows: clientRows } = await pool.query(
        `SELECT u.id, u.data FROM users u
         JOIN accountant_clients ac ON ac.user_id = u.id AND ac.accountant_id = $2 AND ac.status = 'active'
         WHERE u.id = $1`,
        [clientId, req.session.accountantId]
      );
      if (!clientRows.length) return res.status(403).json({ error: 'Client not found or not linked to you' });
      const { rows: accRows } = await pool.query('SELECT stripe_account_id FROM accountants WHERE id = $1', [req.session.accountantId]);
      const stripeAccountId = accRows[0]?.stripe_account_id;
      if (!stripeAccountId) return res.status(400).json({ error: 'Connect your Stripe account first' });
      const amountCents = Math.round(parseFloat(amount) * 100);

      // F17: LIVE tier commission (was a flat hardcoded 4%). "Active client" =
      // consented AND paying (subscriptionStatus='active'); the accountant's first 3
      // such clients are commission-free (onboarding hook, applied by commissionRateFor).
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
          WHERE ac.accountant_id = $1 AND ac.status = 'active' AND u.data->>'subscriptionStatus' = 'active'`,
        [req.session.accountantId]
      );
      const activeCount = parseInt(countRes.rows[0].count) || 0;
      const rate   = commissionRateFor(activeCount);
      const feeEst = estimateStripeFeeCents(amountCents);
      const split  = splitBilling(amountCents, rate, feeEst);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency,
        application_fee_amount: split.commissionCents,   // FinFlow's tier commission
        on_behalf_of: stripeAccountId,                    // accountant is settlement merchant → bears the Stripe fee
        transfer_data: { destination: stripeAccountId },
        metadata: {
          accountant_id: req.session.accountantId,
          client_id: clientId,
          description: description || 'Accounting services'
        }
      });

      // Ledger records the FULL split: amount_cents = accountant NET (billed − Stripe
      // fee − commission), with the fee an ESTIMATE. The payment_intent.succeeded
      // webhook reconciles to the real balance-transaction fee and flips status→'paid'.
      await pool.query(
        `INSERT INTO accountant_earnings
           (accountant_id, client_id, type, amount_cents, billed_cents, commission_cents,
            stripe_fee_cents, payment_intent_id, description, status, created_at)
         VALUES ($1,$2,'service_commission',$3,$4,$5,$6,$7,$8,'pending',NOW())
         ON CONFLICT DO NOTHING`,
        [req.session.accountantId, clientId, split.accountantNetCents, split.billedCents,
         split.commissionCents, split.stripeFeeCents, paymentIntent.id, description || 'Accounting services']
      );

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amountCents,
        commissionRate: rate,
        commissionCents: split.commissionCents,
        estStripeFeeCents: split.stripeFeeCents,
        accountantNetCents: split.accountantNetCents
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── ACCOUNTANT DEADLINES ──────────────────────────────────────────────────
  app.get('/api/accountants/deadlines', requireAccountant, wrap(async (req, res) => {
    const result = await pool.query(
      `SELECT id, client_name, filing_type, due_date, created_at
       FROM accountant_deadlines WHERE accountant_id = $1 ORDER BY due_date ASC`,
      [req.session.accountantId]
    );
    return res.json(result.rows);
  }));

  app.post('/api/accountants/deadlines', requireAccountant, wrap(async (req, res) => {
    const { client_name, filing_type, due_date } = req.body || {};
    if (!client_name || !filing_type || !due_date) return res.status(400).json({ error: 'Missing fields.' });
    const result = await pool.query(
      `INSERT INTO accountant_deadlines (accountant_id, client_name, filing_type, due_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.session.accountantId, client_name, filing_type, due_date]
    );
    return res.status(201).json(result.rows[0]);
  }));

  app.delete('/api/accountants/deadlines/:id', requireAccountant, wrap(async (req, res) => {
    if (!/^[1-9][0-9]*$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid id.' });
    await pool.query(
      `DELETE FROM accountant_deadlines WHERE id = $1 AND accountant_id = $2`,
      [req.params.id, req.session.accountantId]
    );
    return res.json({ ok: true });
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
