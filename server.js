'use strict';
const express      = require('express');
const session      = require('express-session');
const bcrypt       = require('bcryptjs');
const compression  = require('compression');
const helmet       = require('helmet');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const crypto       = require('crypto');
const { db, initDB, pool } = require('./database');
const pgSession = require('connect-pg-simple')(session);

let resendClient = null;
try {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
} catch (e) {
  console.warn('[Resend] Package not installed — email will be skipped.');
}

// ── STRIPE ────────────────────────────────────────────────────────────────────
let stripe = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
  if (stripe) console.log('[Stripe] Initialized');
  else console.warn('[Stripe] STRIPE_SECRET_KEY not set — billing features disabled.');
} catch (e) {
  console.warn('[Stripe] Not available:', e.message);
}

const app  = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set');
  process.exit(1);
}
console.log('Starting on port:', PORT);

app.use(compression({ level: 6 }));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
}));

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; " +
    "style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' https://api.anthropic.com https://query1.finance.yahoo.com ws: wss:; " +
    "frame-ancestors 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self';"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000'),
  credentials: true,
}));
// ── STRIPE WEBHOOK ────────────────────────────────────────────────────────────
// Must be before express.json() middleware — needs raw body
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured.' });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const userId = event.data.object?.metadata?.userId;

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const accountantId = session.metadata?.accountantId;
    const billedCents  = session.amount_total;
    if (accountantId) {
      // 4% is FinFlow's platform revenue — NOT the accountant's earnings.
      // Stripe Connect deducts it automatically via application_fee_amount.
      // We log it here in platform_fees for internal revenue audit only.
      const feeCents = Math.round(billedCents * 0.04);
      // platform_fees table is created in initDB() (database.js) — no DDL in this hot path.
      await pool.query(`
        INSERT INTO platform_fees (accountant_id, client_id, billed_cents, fee_cents, description, period_month)
        VALUES ($1, $2, $3, $4, $5, date_trunc('month', NOW()))
      `, [
        accountantId,
        session.metadata?.clientUserId || null,
        billedCents,
        feeCents,
        session.metadata?.description || 'Platform fee (4%)',
      ]).catch(err => console.error('[Stripe] platform_fees insert failed:', err.message));
      console.log(`[Stripe] Platform fee logged: $${(feeCents/100).toFixed(2)} (4% of $${(billedCents/100).toFixed(2)}) — accountant ${accountantId}`);
    }

    // Upgrade user plan when they pay for a subscription
    const planUpgrade = session.metadata?.plan; // 'pro' or 'business'
    const upgradeUserId = parseInt(session.metadata?.userId, 10);
    if (session.metadata?.userId && !upgradeUserId) console.error('[Stripe] Invalid userId in webhook metadata');
    if (upgradeUserId && planUpgrade) {
      await pool.query(
        `UPDATE users SET data = data || jsonb_build_object('plan', $1::text, 'trial_ends', null::text) WHERE id = $2`,
        [planUpgrade, upgradeUserId]
      );
      console.log(`[Stripe] User ${upgradeUserId} upgraded to plan: ${planUpgrade}`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    // Downgrade user back to trial/free when subscription cancelled
    const sub = event.data.object;
    const cancelUserId = sub.metadata?.userId;
    if (cancelUserId) {
      await pool.query(
        `UPDATE users SET data = data || jsonb_build_object('plan', 'trial'::text) WHERE id = $1`,
        [cancelUserId]
      );
      console.log(`[Stripe] User ${cancelUserId} subscription cancelled — plan set to trial`);
    }
  }

  if (event.type === 'account.updated') {
    const account = event.data.object;
    if (account.details_submitted) {
      await pool.query(
        `UPDATE accountants SET stripe_account_id = $1, stripe_onboarded = true WHERE stripe_account_id = $1`,
        [account.id]
      );
    }
  }

  res.json({ received: true });
});

// NOTE: Stripe checkout route is registered later (after session + express.json +
// requireAuth are active) so req.session and req.body are populated. See below.

// ── ROOT ROUTES — registered BEFORE express.static so the static handler
// can't auto-serve public/index.html at "/". "/" = marketing landing page,
// "/app" = the FinFlow SPA.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── STATIC FILES — served before session so DB issues never block index.html ──
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

// Small global JSON cap to limit DoS surface; routes that legitimately accept large
// base64 payloads (receipt/document images, resume uploads) opt into a 10mb parser.
// Conditional ensures the global parser doesn't 413 a large body before its route runs.
const bigJson = express.json({ limit: '10mb' });
const smallJson = express.json({ limit: '500kb' });
const LARGE_PAYLOAD_PATHS = ['/api/ai/scan', '/api/documents', '/api/ai/extract-document', '/api/accountants/extract-resume'];
app.use((req, res, next) => (LARGE_PAYLOAD_PATHS.includes(req.path) ? bigJson : smallJson)(req, res, next));
app.use(express.urlencoded({ extended: false, limit: '500kb' }));
app.set('trust proxy', 1);
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true, pruneSessionInterval: 60 }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 'none' required for cross-origin embeds (Stripe); ALLOWED_ORIGIN must be the exact domain
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000, max: 200 });

app.use('/api', apiLimiter);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorised — please log in.' });
  next();
}

// Checks trial expiry — attaches req.userPlan for downstream use
async function checkPlan(req, res, next) {
  try {
    const user = await pool.query(`SELECT data FROM users WHERE id = $1`, [req.session.userId]);
    if (!user.rows[0]) return res.status(401).json({ error: 'User not found.' });
    const u = user.rows[0].data;
    const plan = u.plan || 'trial';
    const trialEnds = u.trial_ends ? new Date(u.trial_ends) : null;

    if (plan === 'trial' && trialEnds && trialEnds < new Date()) {
      return res.status(402).json({
        error: 'Your free trial has ended. Please upgrade to continue.',
        code: 'TRIAL_EXPIRED',
      });
    }
    req.userPlan = plan;
    next();
  } catch (e) {
    next(e);
  }
}

function safeUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name || '', plan: u.plan || 'trial', trial_ends: u.trial_ends || null, role: u.role || 'owner' };
}

// Wraps async route handlers so any thrown error is forwarded to Express error handler
const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

// ── STRIPE CHECKOUT ───────────────────────────────────────────────────────────
// Registered here (not earlier) so session + express.json + requireAuth are active.
app.post('/api/stripe/checkout', requireAuth, wrap(async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured.' });
  const { plan } = req.body;
  if (!plan || !['pro', 'business'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Must be "pro" or "business".' });
  }
  const priceId = plan === 'business' ? process.env.STRIPE_PRICE_BUSINESS : process.env.STRIPE_PRICE_PRO;
  if (!priceId) return res.status(500).json({ error: `STRIPE_PRICE_${plan.toUpperCase()} env var not set.` });
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: req.session.userEmail,
    metadata: { userId: String(req.session.userId), plan },
    success_url: appUrl + '/app?upgraded=1',
    cancel_url: appUrl + '/app#pricing',
  });
  res.json({ url: session.url });
}));

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

    const existing = await db.get('users', u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = bcrypt.hashSync(password, 12);
    const { lastInsertRowid: userId } = await db.insert('users', {
      email: email.toLowerCase(), password: hash,
      name: (name || '').trim().slice(0, 100), plan: 'trial', trial_ends: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), role: 'owner',
    });

    // If user signed up via an accountant referral link (?ref=CODE), link them now
    const refCode = ((req.body?.referralCode || req.body?.ref || req.query?.ref || '')).slice(0, 50);
    if (refCode) {
      pool.query(
        `SELECT id FROM accountants WHERE referral_code = $1 AND status = 'verified'`,
        [refCode]
      ).then(async result => {
        if (!result.rows[0]) return;
        const accountantId = result.rows[0].id;
        const countResult = await pool.query(
          `SELECT COUNT(*) FROM accountant_clients WHERE accountant_id = $1 AND status = 'active'`,
          [accountantId]
        );
        const count = parseInt(countResult.rows[0].count) || 0;
        const months = count >= 500 ? 12 : count >= 50 ? 3 : 1;
        await pool.query(`
          INSERT INTO accountant_clients (accountant_id, user_id, status, referral_months_total)
          VALUES ($1, $2, 'pending', $3)
          ON CONFLICT (accountant_id, user_id) DO NOTHING
        `, [accountantId, userId, months]);
        console.log(`[Referral] User ${userId} linked to accountant ${accountantId} (${months} months)`);
      }).catch(e => console.error('[Referral] Link failed:', e.message));
    }

    req.session.userId = userId;
    req.session.userRole = 'owner';
    req.session.userEmail = email.toLowerCase();
    const user = await db.get('users', u => u.id === userId);
    console.log('[Register] New user created, id:', userId);
    res.status(201).json({ user: safeUser(user) });
  } catch (err) {
    console.error('[Register] Unexpected error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const user = await db.get('users', u => u.email.toLowerCase() === email.toLowerCase());
    if (user && (user.data?.deleted === 'true' || user.deleted === 'true')) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password.' });
    req.session.userId = user.id;
    req.session.userRole = user.role || 'owner';
    req.session.userEmail = user.email;
    // Track last login time
    await pool.query(
      `UPDATE users SET data = data || jsonb_build_object('last_login', $1::text) WHERE id = $2`,
      [new Date().toISOString(), user.id]
    );
    res.json({ user: safeUser(user) });
  } catch (err) {
    console.error('[Login] Unexpected error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required.' });

    const user = await db.get('users', u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return res.json({ ok: true });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await db.delete('password_resets', r => r.user_id === user.id);
    await db.insert('password_resets', { user_id: user.id, token, expires });

    const APP_URL  = process.env.APP_URL || `http://localhost:${PORT}`;
    const resetUrl = `${APP_URL}/reset-password.html?token=${token}`;

    if (resendClient) {
      try {
        await resendClient.emails.send({
          from:    process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
          to:      user.email,
          subject: 'Reset your FinFlow password',
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
              <h2 style="color:#c9a84c;margin-bottom:8px">FinFlow</h2>
              <p>Hi ${user.name || 'there'},</p>
              <p>We received a request to reset your password. Click the button below — this link expires in 1 hour.</p>
              <a href="${resetUrl}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#c9a84c;color:#0e0b08;border-radius:8px;font-weight:700;text-decoration:none">Reset password →</a>
              <p style="color:#888;font-size:13px">If you didn't request this, just ignore this email. Your password won't change.</p>
            </div>
          `,
        });
      } catch (e) {
        console.error('[Resend] Failed to send reset email:', e.message);
      }
    } else {
      console.log('[Password Reset] Reset requested for user ID:', user.id, '— configure RESEND_API_KEY to send email');
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[ForgotPassword] Unexpected error:', err);
    res.status(500).json({ error: 'Request failed. Please try again.' });
  }
});

app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const record = await db.get('password_resets', r => r.token === token);
    if (!record) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    if (new Date(record.expires) < new Date()) {
      await db.delete('password_resets', r => r.token === token);
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const hash = bcrypt.hashSync(password, 12);
    await db.update('users', u => u.id === record.user_id, { password: hash });
    await db.delete('password_resets', r => r.token === token);

    res.json({ ok: true });
  } catch (err) {
    console.error('[ResetPassword] Unexpected error:', err);
    res.status(500).json({ error: 'Reset failed. Please try again.' });
  }
});

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const user = await db.get('users', u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user: safeUser(user) });
}));
// Alias used by frontend for session checks
app.get('/api/me', requireAuth, wrap(async (req, res) => {
  const user = await db.get('users', u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user: safeUser(user) });
}));

// Trial / plan enforcement — applies to all /api routes except auth and stripe webhook
app.use('/api', (req, res, next) => {
  const open = ['/api/auth/', '/api/stripe/'];
  if (open.some(p => req.path.startsWith(p.replace('/api', '')))) return next();
  if (!req.session?.userId) return next(); // requireAuth handles this
  checkPlan(req, res, next);
});

// ── ENTITY + RBAC MIDDLEWARE ──────────────────────────────────────────────────
// Sets req.entityId from session so routes can scope data to the active entity.
app.use('/api', async (req, res, next) => {
  // Allow explicit entity_id override from query param or body - this is the source of truth
  const explicitEntityId = req.query.entity_id || req.body?.entity_id;
  if (explicitEntityId) {
    const entityIdInt = parseInt(explicitEntityId, 10);
    if (isNaN(entityIdInt) || entityIdInt <= 0) {
      return res.status(400).json({ error: 'Invalid entity ID.' });
    }
    if (req.session.userId) {
      try {
        const owned = await pool.query('SELECT id FROM entities WHERE id=$1 AND user_id=$2', [entityIdInt, req.session.userId]);
        if (!owned.rows[0]) return res.status(403).json({ error: 'Entity not found.' });
      } catch (e) {
        return res.status(500).json({ error: 'Server error.' });
      }
    }
    req.entityId = entityIdInt;
    req.session.entityId = entityIdInt;
    return next();
  }
  if (req.session.entityId) {
    req.entityId = req.session.entityId;
    return next();
  }
  if (req.session.userId) {
    try {
      const r = await pool.query(
        `SELECT id FROM entities WHERE user_id = $1 ORDER BY (CASE WHEN (data->>'is_active')::int = 1 THEN 0 ELSE 1 END), id ASC LIMIT 1`,
        [req.session.userId]
      );
      if (r.rows[0]) {
        req.session.entityId = r.rows[0].id;
        req.entityId = r.rows[0].id;
      } else {
        req.entityId = null;
      }
    } catch (e) { req.entityId = null; }
  } else {
    req.entityId = null;
  }
  next();
});

// Role-based access: viewer=read-only, accountant=no DELETE, admin/owner=all.
app.use('/api', (req, res, next) => {
  if (!req.session.userId) return next(); // unauthenticated — let requireAuth handle it
  if (req.path.startsWith('/auth/')) return next(); // auth routes are exempt
  const role = req.session.userRole || 'owner';
  if (req.method === 'DELETE' && !['admin', 'owner'].includes(role))
    return res.status(403).json({ error: 'Only admin or owner can delete records.' });
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && role === 'viewer')
    return res.status(403).json({ error: 'Viewer role is read-only.' });
  next();
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function ownedBy(table, id, userId) {
  return db.get(table, r => r.id === parseInt(id) && r.user_id === userId);
}

// Resolve the first active entity for the current user (used by several POST routes)
async function activeEntity(userId) {
  const rows = await db.all('entities', e => e.user_id === userId && e.is_active);
  return rows[0] || null;
}

// Build a filter function scoped to user (and optionally entity)
function userFilter(userId, entityId) {
  if (entityId) return r => r.user_id === userId && r.entity_id === entityId;
  return r => r.user_id === userId;
}

// ── AUDIT LOG HELPER ──────────────────────────────────────────────────────────
async function logAudit(req, action, tableName, recordId, oldData, newData) {
  try {
    await db.insert('audit_log', {
      user_id:    req.session.userId,
      entity_id:  req.entityId || null,
      action,
      table_name: tableName,
      record_id:  recordId || null,
      old_data:   oldData ? JSON.stringify(oldData) : null,
      new_data:   newData ? JSON.stringify(newData) : null,
      ip:         req.ip || null,
    });
  } catch (e) {
    console.error('[Audit] log failed:', e.message);
  }
}

// ── LOCK HELPER ───────────────────────────────────────────────────────────────
async function isLocked(userId, date) {
  if (!date) return false;
  const s = await db.get('lock_settings', r => r.user_id === userId && r.enabled);
  if (!s || !s.lock_date) return false;
  return date <= s.lock_date;
}

// ── ENTITIES ──────────────────────────────────────────────────────────────────
app.get('/api/entities', requireAuth, wrap(async (req, res) => {
  res.json(await db.all('entities', r => r.user_id === req.session.userId, (a, b) => a.sort_order - b.sort_order));
}));
app.post('/api/entities', requireAuth, wrap(async (req, res) => {
  const { name, currency = 'USD', color = '#c9a84c' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const { row } = await db.insert('entities', { user_id: req.session.userId, name: name.trim().slice(0,100), currency, color, is_active: 0, sort_order: 0 });
  res.status(201).json(row);
}));
app.put('/api/entities/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('entities', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { name, currency, color } = req.body || {};
  await db.update('entities', r => r.id === row.id, { ...(name && {name}), ...(currency && {currency}), ...(color && {color}) });
  res.json(await db.get('entities', r => r.id === row.id));
}));
app.delete('/api/entities/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('entities', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('entities', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));
app.post('/api/entities/:id/activate', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = parseInt(req.params.id);
  await db.update('entities', r => r.user_id === uid, { is_active: 0 });
  await db.update('entities', r => r.id === eid && r.user_id === uid, { is_active: 1 });
  req.session.entityId = eid;
  res.json({ ok: true });
}));

// ── INVOICES ──────────────────────────────────────────────────────────────────
app.get('/api/invoices', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('invoices', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => b.id - a.id));
}));
app.post('/api/invoices', requireAuth, wrap(async (req, res) => {
  const { client, amount, due_date, status = 'pending', notes = '', entity_id } = req.body || {};
  if (!client || amount == null) return res.status(400).json({ error: 'client and amount required.' });
  const eid = entity_id || req.entityId || null;
  if (await isLocked(req.session.userId, due_date)) return res.status(403).json({ error: 'Period is locked.' });
  const { row } = await db.insert('invoices', { user_id: req.session.userId, entity_id: eid, client: client.trim().slice(0,200), amount: parseFloat(amount)||0, due_date: due_date||null, status, notes: notes.slice(0,500) });
  logAudit(req, 'CREATE', 'invoices', row.id, null, row);
  res.status(201).json(row);
}));
app.put('/api/invoices/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('invoices', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (await isLocked(req.session.userId, row.due_date)) return res.status(403).json({ error: 'Period is locked.' });
  const patch = {};
  const { client, amount, due_date, status, notes } = req.body || {};
  if (client != null) patch.client = client;
  if (amount != null) patch.amount = parseFloat(amount);
  if (due_date != null) patch.due_date = due_date;
  if (status != null) patch.status = status.toLowerCase();
  if (notes != null) patch.notes = notes;
  await db.update('invoices', r => r.id === row.id, patch);
  const updated = await db.get('invoices', r => r.id === row.id);
  logAudit(req, 'UPDATE', 'invoices', row.id, row, updated);
  res.json(updated);
}));
app.delete('/api/invoices/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('invoices', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (await isLocked(req.session.userId, row.due_date)) return res.status(403).json({ error: 'Period is locked.' });
  await db.delete('invoices', r => r.id === parseInt(req.params.id));
  logAudit(req, 'DELETE', 'invoices', row.id, row, null);
  res.json({ ok: true });
}));

// ── EXPENSES ──────────────────────────────────────────────────────────────────
app.get('/api/expenses', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('expenses', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => b.id - a.id));
}));
app.post('/api/expenses', requireAuth, wrap(async (req, res) => {
  const { description, category = 'Other', amount, deductible = 'no', expense_date, entity_id } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const eid = entity_id || req.entityId || null;
  const edate = expense_date || new Date().toISOString().slice(0,10);
  if (await isLocked(req.session.userId, edate)) return res.status(403).json({ error: 'Period is locked.' });
  const { row } = await db.insert('expenses', { user_id: req.session.userId, entity_id: eid, description: description.trim().slice(0,300), category, amount: parseFloat(amount)||0, deductible, expense_date: edate });
  logAudit(req, 'CREATE', 'expenses', row.id, null, row);
  res.status(201).json(row);
}));
app.put('/api/expenses/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('expenses', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (await isLocked(req.session.userId, row.expense_date)) return res.status(403).json({ error: 'Period is locked.' });
  const patch = {};
  const b = req.body || {};
  if (b.description != null) patch.description = b.description;
  if (b.category != null) patch.category = b.category;
  if (b.amount != null) patch.amount = parseFloat(b.amount);
  if (b.deductible != null) patch.deductible = b.deductible;
  if (b.expense_date != null) patch.expense_date = b.expense_date;
  await db.update('expenses', r => r.id === row.id, patch);
  const updated = await db.get('expenses', r => r.id === row.id);
  logAudit(req, 'UPDATE', 'expenses', row.id, row, updated);
  res.json(updated);
}));
app.delete('/api/expenses/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('expenses', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (await isLocked(req.session.userId, row.expense_date)) return res.status(403).json({ error: 'Period is locked.' });
  await db.delete('expenses', r => r.id === parseInt(req.params.id));
  logAudit(req, 'DELETE', 'expenses', row.id, row, null);
  res.json({ ok: true });
}));

// ── CUSTOMERS ─────────────────────────────────────────────────────────────────
app.get('/api/customers', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('customers', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => b.revenue - a.revenue));
}));
app.post('/api/customers', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const { row } = await db.insert('customers', { user_id: req.session.userId, entity_id: b.entity_id||null, fname: (b.fname||'').trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), company: (b.company||'').trim().slice(0,200), industry: (b.industry||'').slice(0,100), email: (b.email||'').slice(0,200), phone: (b.phone||'').slice(0,30), revenue: parseFloat(b.revenue)||0, status: b.status||'active', notes: (b.notes||'').slice(0,500) });
  res.status(201).json(row);
}));
app.put('/api/customers/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('customers', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['fname','lname','company','industry','email','phone','status','notes'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  if (b.revenue != null) patch.revenue = parseFloat(b.revenue);
  await db.update('customers', r => r.id === row.id, patch);
  res.json(await db.get('customers', r => r.id === row.id));
}));
app.delete('/api/customers/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('customers', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('customers', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── INVENTORY ─────────────────────────────────────────────────────────────────
app.get('/api/inventory', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('inventory', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => a.id - b.id));
}));
app.post('/api/inventory', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const u = Math.max(0, parseInt(b.qty || b.units)||0);
  const mx = parseInt(b.max_units)||200;
  const { row } = await db.insert('inventory', { user_id: req.session.userId, entity_id: b.entity_id||null, sku: (b.sku||'#'+Date.now()).slice(0,20), name: (b.name||'').trim().slice(0,200), units: u, max_units: mx, cost: parseFloat(b.cost)||0, low_stock: u < mx * 0.1 ? 1 : 0 });
  res.status(201).json(row);
}));
app.put('/api/inventory/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('inventory', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const newUnits = b.units != null ? Math.max(0, parseInt(b.units)||0) : row.units;
  const newMax   = b.max_units != null ? parseInt(b.max_units)||row.max_units : row.max_units;
  const patch = { units: newUnits, max_units: newMax, low_stock: newUnits < newMax * 0.1 ? 1 : 0 };
  if (b.name != null) patch.name = b.name;
  if (b.cost != null) patch.cost = parseFloat(b.cost);
  await db.update('inventory', r => r.id === row.id, patch);
  res.json(await db.get('inventory', r => r.id === row.id));
}));
app.post('/api/inventory/:id/restock', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('inventory', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const qty = Math.max(1, Math.min(parseInt(req.body.qty)||0, 100000));
  const newUnits = row.units + qty;
  await db.update('inventory', r => r.id === row.id, { units: newUnits, low_stock: newUnits < row.max_units * 0.1 ? 1 : 0 });
  res.json(await db.get('inventory', r => r.id === row.id));
}));
app.delete('/api/inventory/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('inventory', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('inventory', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── ITEMS (product & service catalog) ────────────────────────────────────────
app.get('/api/items', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('items', req.session.userId, null, (a, b) => a.id - b.id));
}));
app.post('/api/items', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required.' });
  const { row } = await db.insert('items', {
    user_id:   req.session.userId,
    entity_id: b.entity_id || null,
    name:      b.name.trim().slice(0, 200),
    type:      b.type   || 'Product',
    price:     parseFloat(b.price) || 0,
    unit:      (b.unit  || 'each').slice(0, 50),
    stock:     b.stock  != null ? parseInt(b.stock) : null,
    status:    b.status || 'Active',
    sku:       (b.sku   || '').slice(0, 50),
    cost:      b.cost   != null ? parseFloat(b.cost) || 0 : null,
  });
  res.status(201).json(row);
}));
app.put('/api/items/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('items', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const patch = {};
  if (b.name   != null) patch.name   = b.name.trim().slice(0, 200);
  if (b.type   != null) patch.type   = b.type;
  if (b.price  != null) patch.price  = parseFloat(b.price);
  if (b.unit   != null) patch.unit   = b.unit.slice(0, 50);
  if ('stock'  in b)    patch.stock  = b.stock != null ? parseInt(b.stock) : null;
  if (b.status != null) patch.status = b.status;
  if (b.sku    != null) patch.sku    = b.sku.slice(0, 50);
  if (b.cost   != null) patch.cost   = parseFloat(b.cost) || 0;
  await db.update('items', r => r.id === row.id, patch);
  res.json(await db.get('items', r => r.id === row.id));
}));
app.delete('/api/items/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('items', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('items', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── PAYROLL ───────────────────────────────────────────────────────────────────
app.get('/api/payroll', requireAuth, wrap(async (req, res) => {
  const userId = req.session.userId;
  const entityId = req.entityId || null;
  const rows = entityId
    ? await db.allByUser('payroll', userId, r => r.entity_id === entityId || r.entity_id == null)
    : await db.allByUser('payroll', userId);
  // Normalise is_owner to boolean and sort owner first
  const normalised = (rows || []).map(r => ({
    ...r,
    is_owner: r.is_owner === true || r.is_owner === 1 || r.is_owner === '1',
  })).sort((a, b) => (b.is_owner ? 1 : 0) - (a.is_owner ? 1 : 0) || a.id - b.id);
  res.json(normalised);
}));
app.post('/api/payroll', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.fname) return res.status(400).json({ error: 'fname required.' });
  const { row } = await db.insert('payroll', { user_id: req.session.userId, entity_id: b.entity_id||null, fname: b.fname.trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), role: (b.role||'').slice(0,100), emp_type: b.emp_type||'Full-time', gross: parseFloat(b.gross)||0, tax_rate: parseFloat(b.tax_rate)||0, av_class: b.av_class||'av-blue', is_owner: b.is_owner ? true : false });
  res.status(201).json(row);
}));
app.put('/api/payroll/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('payroll', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['fname','lname','role','emp_type','av_class'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  if (b.gross != null) patch.gross = parseFloat(b.gross);
  if (b.tax_rate != null) patch.tax_rate = parseFloat(b.tax_rate);
  await db.update('payroll', r => r.id === row.id, patch);
  res.json(await db.get('payroll', r => r.id === row.id));
}));
app.delete('/api/payroll/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('payroll', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('payroll', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── PERSONAL SALARY — cross-entity owner payroll (no entity filter) ───────────
// GET /api/payroll scopes to req.entityId from session, so it only returns rows
// for the currently-active entity. This endpoint bypasses that and returns ALL
// is_owner payroll rows for the user — used by Personal Finance income display.
app.get('/api/personal-salary', requireAuth, wrap(async (req, res) => {
  const rows = await db.allByUser('payroll', req.session.userId);
  const ownerRows = rows.filter(r =>
    r.is_owner === true || r.is_owner === 1 || r.is_owner === '1' || r.is_owner === 'true'
  );
  res.json(ownerRows);
}));

// ── PERSONAL TRANSACTIONS ─────────────────────────────────────────────────────
app.get('/api/personal-transactions', requireAuth, wrap(async (req, res) => {
  try {
    res.json(await db.allByUser('personal_transactions', req.session.userId, null, (a,b) => b.id - a.id));
  } catch (e) {
    console.error('[GET /api/personal-transactions] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]);
  }
}));
app.post('/api/personal-transactions', requireAuth, wrap(async (req, res) => {
  const { description, category = 'Other', amount, tx_type = 'expense', tx_date } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const { row } = await db.insert('personal_transactions', { user_id: req.session.userId, description: description.trim().slice(0,300), category, amount: parseFloat(amount)||0, tx_type, tx_date: tx_date || new Date().toISOString().slice(0,10) });
  res.status(201).json(row);
}));
app.put('/api/personal-transactions/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('personal_transactions', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  if (b.description != null) patch.description = b.description.trim().slice(0, 300);
  if (b.category != null)    patch.category    = b.category;
  if (b.amount != null)      patch.amount      = parseFloat(b.amount) || 0;
  if (b.tx_type != null)     patch.tx_type     = b.tx_type;
  if (b.tx_date != null)     patch.tx_date     = b.tx_date;
  await db.update('personal_transactions', r => r.id === row.id, patch);
  res.json(await db.get('personal_transactions', r => r.id === row.id));
}));
app.delete('/api/personal-transactions/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('personal_transactions', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('personal_transactions', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── GOALS ─────────────────────────────────────────────────────────────────────
app.get('/api/goals', requireAuth, wrap(async (req, res) => {
  try {
    res.json(await db.allByUser('goals', req.session.userId, null, (a,b) => a.id - b.id));
  } catch (e) {
    console.error('[GET /api/goals] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]);
  }
}));
app.post('/api/goals', requireAuth, wrap(async (req, res) => {
  const { name, current_val = 0, target_val, monthly_contrib = 0, color = 'var(--acc)' } = req.body || {};
  if (!name || target_val == null) return res.status(400).json({ error: 'name and target_val required.' });
  const { row } = await db.insert('goals', { user_id: req.session.userId, name: name.trim().slice(0,200), current_val: parseFloat(current_val)||0, target_val: parseFloat(target_val)||0, monthly_contrib: parseFloat(monthly_contrib)||0, color });
  res.status(201).json(row);
}));
app.put('/api/goals/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('goals', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  if (b.name != null) patch.name = b.name;
  if (b.color != null) patch.color = b.color;
  if (b.current_val != null) patch.current_val = parseFloat(b.current_val);
  if (b.target_val != null) patch.target_val = parseFloat(b.target_val);
  if (b.monthly_contrib != null) patch.monthly_contrib = parseFloat(b.monthly_contrib);
  await db.update('goals', r => r.id === row.id, patch);
  res.json(await db.get('goals', r => r.id === row.id));
}));
app.delete('/api/goals/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('goals', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('goals', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── PROJECTS ──────────────────────────────────────────────────────────────────
app.get('/api/projects', requireAuth, wrap(async (req, res) => {
  try {
    const rows = await db.allByUser('projects', req.session.userId, null, (a, b) => b.id - a.id);
    res.json(rows);
  } catch (e) {
    console.error('[GET /api/projects] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]);
  }
}));
app.post('/api/projects', requireAuth, wrap(async (req, res) => {
  const { name, client = '', budget = 0, status = 'In Progress' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required.' });
  const validStatuses = ['In Progress', 'Completed', 'On Hold'];
  const { row } = await db.insert('projects', {
    user_id:  req.session.userId,
    name:     name.trim().slice(0, 200),
    client:   client.trim().slice(0, 200),
    budget:   parseFloat(budget) || 0,
    billed:   0,
    hours:    0,
    status:   validStatuses.includes(status) ? status : 'In Progress',
    progress: 0,
  });
  res.status(201).json(row);
}));
app.put('/api/projects/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('projects', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  if (b.name     != null) patch.name     = b.name.trim().slice(0, 200);
  if (b.client   != null) patch.client   = b.client.trim().slice(0, 200);
  if (b.budget   != null) patch.budget   = parseFloat(b.budget) || 0;
  if (b.billed   != null) patch.billed   = parseFloat(b.billed) || 0;
  if (b.hours    != null) patch.hours    = parseFloat(b.hours) || 0;
  if (b.status   != null) patch.status   = b.status;
  if (b.progress != null) patch.progress = parseInt(b.progress);
  await db.update('projects', r => r.id === row.id, patch);
  res.json(await db.get('projects', r => r.id === row.id));
}));
app.delete('/api/projects/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('projects', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('projects', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── HOLDINGS ──────────────────────────────────────────────────────────────────
app.get('/api/holdings', requireAuth, wrap(async (req, res) => {
  try {
    const rows = await db.allByUser('holdings', req.session.userId, null, (a,b) => a.id - b.id);
    res.json(rows);
  } catch (e) {
    console.error('[GET /api/holdings] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]); // fail-soft: empty list keeps the frontend happy
  }
}));
app.post('/api/holdings', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.ticker || b.shares == null) return res.status(400).json({ error: 'ticker and shares required.' });
  const { row } = await db.insert('holdings', { user_id: req.session.userId, ticker: b.ticker.trim().toUpperCase().slice(0,20), name: (b.name||b.ticker).trim().slice(0,200), asset_type: b.asset_type||'Stock', shares: parseFloat(b.shares)||0, cost_per: parseFloat(b.cost_per)||0, price: parseFloat(b.price)||parseFloat(b.cost_per)||0, dividend: parseFloat(b.dividend)||0, color: b.color||'#c9a84c' });
  res.status(201).json(row);
}));
app.put('/api/holdings/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('holdings', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['ticker','name','asset_type','color'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  ['shares','cost_per','price','dividend'].forEach(f => { if (b[f] != null) patch[f] = parseFloat(b[f]); });
  await db.update('holdings', r => r.id === row.id, patch);
  res.json(await db.get('holdings', r => r.id === row.id));
}));
app.delete('/api/holdings/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('holdings', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('holdings', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── BUDGET TARGETS ────────────────────────────────────────────────────────────
app.get('/api/budget-targets', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  // Prefer entity-scoped row if present, fall back to entity-less row.
  let row = null;
  if (eid) row = await db.get('budget_targets', r => r.user_id === uid && r.entity_id === eid);
  if (!row) row = await db.get('budget_targets', r => r.user_id === uid && !r.entity_id);
  res.json(row ? row.targets : {});
}));
app.put('/api/budget-targets', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  const targets = req.body || {};
  // Upsert by both user_id and entity_id so each entity has its own budget
  const existing = eid
    ? await db.get('budget_targets', r => r.user_id === uid && r.entity_id === eid)
    : await db.get('budget_targets', r => r.user_id === uid && !r.entity_id);
  if (existing) {
    await db.update('budget_targets', r => r.id === existing.id, { targets });
  } else {
    await db.insert('budget_targets', { user_id: uid, entity_id: eid, targets });
  }
  res.json({ ok: true });
}));

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, wrap(async (req, res) => {
  res.json(await db.get('user_settings', r => r.user_id === req.session.userId) || {});
}));
app.put('/api/settings', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  // Read current settings for audit diff
  const before = (await db.get('user_settings', r => r.user_id === req.session.userId)) || {};
  if (b.dark_mode      != null) patch.dark_mode      = b.dark_mode ? 1 : 0;
  if (b.currency       != null) patch.currency        = b.currency;
  if (b.show_cents     != null) patch.show_cents      = b.show_cents ? 1 : 0;
  if (b.notif_email    != null) patch.notif_email     = b.notif_email ? 1 : 0;
  if (b.notif_inv      != null) patch.notif_inv       = b.notif_inv ? 1 : 0;
  if (b.notif_pay      != null) patch.notif_pay       = b.notif_pay ? 1 : 0;
  // Onboarding + profile fields
  if (b.business_name  != null) patch.business_name   = String(b.business_name).slice(0,200);
  if (b.business_type  != null) patch.business_type   = b.business_type;
  if (b.industry       != null) patch.industry        = String(b.industry).slice(0,100);
  if (b.address        != null) patch.address         = String(b.address).slice(0,500);
  if (b.email          != null) patch.email           = String(b.email).trim().slice(0,254).toLowerCase();
  if (b.phone          != null) patch.phone           = String(b.phone).slice(0,50);
  if (b.website        != null) patch.website         = String(b.website).slice(0,200);
  if (b.tax_id         != null) patch.tax_id          = String(b.tax_id).slice(0,50);
  if (b.fiscal_year    != null) patch.fiscal_year     = String(b.fiscal_year).slice(0,20);
  if (b.num_employees  != null) patch.num_employees   = b.num_employees;
  if (b.onboarding_done!= null) patch.onboarding_done = b.onboarding_done ? 1 : 0;
  await db.upsert('user_settings', 'user_id', req.session.userId, patch);
  if (b.name) await db.update('users', u => u.id === req.session.userId, { name: b.name.trim().slice(0,100) });
  if (b.business_name) {
    // Also update the active entity name if user is updating business name
    const uid = req.session.userId;
    const ent = await activeEntity(uid);
    if (ent) await db.update('entities', e => e.id === ent.id, { name: b.business_name.slice(0,100) });
  }
  // Audit log: emit one entry per business-profile field that changed.
  // We only log fields that the user typically modifies on the Settings page —
  // toggles (dark_mode, notif_*, show_cents) are intentionally excluded.
  const TRACKED = ['business_name','industry','address','email','phone','website','tax_id','fiscal_year','currency','business_type','name'];
  for (const f of TRACKED) {
    if (patch[f] == null && f !== 'name') continue;
    const newVal = f === 'name' ? (b.name ? b.name.trim() : null) : patch[f];
    const oldVal = f === 'name'
      ? (await db.get('users', u => u.id === req.session.userId))?.name
      : before[f];
    if (newVal == null) continue;
    if (String(oldVal||'') === String(newVal||'')) continue;
    logAudit(req, 'UPDATE', 'settings', null, { field: f, value: oldVal || null }, { field: f, value: newVal });
  }
  res.json({ ok: true });
}));

// ── AUTH — CHANGE PASSWORD ────────────────────────────────────────────────────
app.put('/api/auth/change-password', requireAuth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const user = await db.get('users', u => u.id === req.session.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) return res.status(401).json({ error: 'Current password is incorrect.' });
  const hash = bcrypt.hashSync(newPassword, 12);
  await db.update('users', u => u.id === req.session.userId, { password: hash });
  logAudit(req, 'CHANGE_PASSWORD', 'users', req.session.userId, null, null);
  res.json({ ok: true });
}));

// ── AUTH — DELETE ACCOUNT ─────────────────────────────────────────────────────
app.delete('/api/auth/account', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required to confirm deletion.' });
  const user = await db.get('users', u => u.id === uid);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Incorrect password.' });
  // Delete from all tables by user_id
  const allTables = [
    'invoices','expenses','customers','inventory','payroll','personal_transactions',
    'goals','holdings','user_settings','password_resets','quotes','bills','vendors',
    'recurring_bills','recurring_invoices','sales_receipts','payments_received',
    'credit_notes','payments_made','vendor_credits','items','timesheet','projects',
    'team_members','budget_targets','entities','journals','chart_of_accounts',
    'lock_settings','audit_log','documents','templates','autocat_rules',
    'audit_trail','invoice_payments','bank_reconciliation','payroll_runs',
    'payroll_run_lines','inventory_movements','fx_rates','fx_transactions',
  ];
  for (const t of allTables) {
    await db.delete(t, r => r.user_id === uid).catch(() => {});
  }
  await pool.query('DELETE FROM ai_cache WHERE user_id=$1', [uid]).catch(() => {});
  await db.delete('users', u => u.id === uid);
  req.session.destroy(() => {});
  res.json({ ok: true });
}));

// ── LOCK SETTINGS ─────────────────────────────────────────────────────────────
app.get('/api/lock-settings', requireAuth, wrap(async (req, res) => {
  const s = await db.get('lock_settings', r => r.user_id === req.session.userId);
  res.json(s || { enabled: 0, lock_date: null });
}));
app.post('/api/lock-settings', requireAuth, wrap(async (req, res) => {
  const { enabled, lock_date, password } = req.body || {};
  const uid = req.session.userId;
  const patch = { enabled: enabled ? 1 : 0, lock_date: lock_date || null };
  if (password) patch.password_hash = bcrypt.hashSync(password, 10);
  await db.upsert('lock_settings', 'user_id', uid, patch);
  logAudit(req, enabled ? 'LOCK_ENABLED' : 'LOCK_DISABLED', 'lock_settings', null, null, patch);
  res.json({ ok: true });
}));

// ── MANUAL JOURNALS ───────────────────────────────────────────────────────────
app.get('/api/journals', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('journals', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => b.id - a.id));
}));
app.post('/api/journals', requireAuth, wrap(async (req, res) => {
  const { date, description, lines = [], status = 'Draft' } = req.body || {};
  if (!description || !lines.length) return res.status(400).json({ error: 'description and lines required.' });
  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) return res.status(400).json({ error: 'Journal does not balance — debits must equal credits.' });
  if (await isLocked(req.session.userId, date)) return res.status(403).json({ error: 'Period is locked.' });
  const num = 'JE-' + String(Date.now()).slice(-4);
  const { row } = await db.insert('journals', {
    user_id: req.session.userId, entity_id: req.entityId || null,
    date: date || new Date().toISOString().slice(0,10),
    description: description.trim().slice(0,500), ref: num,
    debit: totalDebit, credit: totalCredit, lines: JSON.stringify(lines), status,
  });
  logAudit(req, 'CREATE', 'journals', row.id, null, row);
  res.status(201).json(row);
}));
app.put('/api/journals/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('journals', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const patch = {};
  if (b.description != null) patch.description = b.description;
  if (b.status      != null) patch.status      = b.status;
  if (b.date        != null) patch.date        = b.date;
  await db.update('journals', r => r.id === row.id, patch);
  res.json(await db.get('journals', r => r.id === row.id));
}));
app.delete('/api/journals/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('journals', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('journals', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── CHART OF ACCOUNTS ─────────────────────────────────────────────────────────
app.get('/api/chart-of-accounts', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('chart_of_accounts', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => a.code.localeCompare(b.code)));
}));
app.post('/api/chart-of-accounts', requireAuth, wrap(async (req, res) => {
  const { code, name, category, nature = 'Debit', balance = 0 } = req.body || {};
  if (!code || !name || !category) return res.status(400).json({ error: 'code, name and category required.' });
  const validCats = ['Assets','Liabilities','Equity','Revenue','Expenses'];
  if (!validCats.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  const { row } = await db.insert('chart_of_accounts', {
    user_id: req.session.userId, entity_id: req.entityId || null,
    code: code.trim().slice(0,20), name: name.trim().slice(0,200),
    category, nature, balance: parseFloat(balance) || 0,
  });
  res.status(201).json(row);
}));
app.put('/api/chart-of-accounts/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('chart_of_accounts', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const patch = {};
  if (b.name     != null) patch.name     = b.name.trim().slice(0,200);
  if (b.balance  != null) patch.balance  = parseFloat(b.balance);
  if (b.category != null) patch.category = b.category;
  if (b.nature   != null) patch.nature   = b.nature;
  await db.update('chart_of_accounts', r => r.id === row.id, patch);
  res.json(await db.get('chart_of_accounts', r => r.id === row.id));
}));
app.delete('/api/chart-of-accounts/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('chart_of_accounts', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('chart_of_accounts', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
app.get('/api/audit-log', requireAuth, wrap(async (req, res) => {
  const { page = 1, limit = 50, type } = req.query;
  let rows = await db.allByUser('audit_log', req.session.userId, null, (a,b) => b.id - a.id);
  if (type && type !== 'all') rows = rows.filter(r => r.table_name === type);
  const start = (parseInt(page) - 1) * parseInt(limit);
  res.json({ total: rows.length, rows: rows.slice(start, start + parseInt(limit)) });
}));

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────
const MAX_DOC_SIZE = 5 * 1024 * 1024; // 5MB in bytes before base64 (~3.75MB actual)
app.get('/api/documents', requireAuth, wrap(async (req, res) => {
  const rows = await db.allByUser('documents', req.session.userId, null, (a,b) => b.id - a.id);
  // Strip file_data from list responses to keep payload small
  res.json(rows.map(({ file_data, ...meta }) => meta));
}));
app.post('/api/documents', requireAuth, wrap(async (req, res) => {
  const { name, type = 'other', file_data, media_type = 'application/octet-stream' } = req.body || {};
  if (!name || !file_data) return res.status(400).json({ error: 'name and file_data required.' });
  const bytes = Math.ceil(file_data.length * 0.75); // approximate decoded size
  if (bytes > MAX_DOC_SIZE) return res.status(413).json({ error: 'File too large. Maximum size is 5 MB.' });
  const { row } = await db.insert('documents', {
    user_id: req.session.userId,
    name: name.slice(0,255), type, media_type,
    size: bytes, file_data, uploaded_at: new Date().toISOString(),
  });
  const { file_data: _fd, ...meta } = row;
  logAudit(req, 'UPLOAD', 'documents', row.id, null, meta);
  res.status(201).json(meta);
}));
app.get('/api/documents/:id/download', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('documents', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const buf = Buffer.from(row.file_data, 'base64');
  const safeName = (row.name || 'export').replace(/[^\w\s.\-]/g, '_');
  res.setHeader('Content-Type', row.media_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.send(buf);
}));
app.delete('/api/documents/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('documents', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('documents', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
app.get('/api/templates', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('templates', req.session.userId, null, (a,b) => a.id - b.id));
}));
app.post('/api/templates', requireAuth, wrap(async (req, res) => {
  const { name, type = 'invoice', preview = '', is_default = 0, accent_color = '#c9a84c' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required.' });
  const { row } = await db.insert('templates', { user_id: req.session.userId, name: name.slice(0,200), type, preview, is_default: is_default ? 1 : 0, accent_color });
  res.status(201).json(row);
}));
app.put('/api/templates/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('templates', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const patch = {};
  if (b.name         != null) patch.name         = b.name.slice(0,200);
  if (b.preview      != null) patch.preview      = b.preview;
  if (b.is_default   != null) patch.is_default   = b.is_default ? 1 : 0;
  if (b.accent_color != null) patch.accent_color = b.accent_color;
  await db.update('templates', r => r.id === row.id, patch);
  res.json(await db.get('templates', r => r.id === row.id));
}));
app.delete('/api/templates/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('templates', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('templates', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── AUTO-CATEGORISE ───────────────────────────────────────────────────────────
app.get('/api/autocat-rules', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('autocat_rules', req.session.userId, null, (a,b) => a.id - b.id));
}));
app.post('/api/autocat-rules', requireAuth, wrap(async (req, res) => {
  const { keyword, match_type = 'description', category, enabled = 1 } = req.body || {};
  if (!keyword || !category) return res.status(400).json({ error: 'keyword and category required.' });
  const { row } = await db.insert('autocat_rules', { user_id: req.session.userId, keyword: keyword.toLowerCase().slice(0,100), match_type, category, enabled: enabled ? 1 : 0 });
  res.status(201).json(row);
}));
app.put('/api/autocat-rules/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('autocat_rules', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const patch = {};
  if (b.keyword    != null) patch.keyword    = b.keyword.toLowerCase().slice(0,100);
  if (b.category   != null) patch.category   = b.category;
  if (b.match_type != null) patch.match_type = b.match_type;
  if (b.enabled    != null) patch.enabled    = b.enabled ? 1 : 0;
  await db.update('autocat_rules', r => r.id === row.id, patch);
  res.json(await db.get('autocat_rules', r => r.id === row.id));
}));
app.delete('/api/autocat-rules/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('autocat_rules', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('autocat_rules', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));
app.post('/api/autocat-rules/run', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const rules = await db.allByUser('autocat_rules', uid, r => r.enabled);
  const expenses = await db.allByUser('expenses', uid, r => !r.category || r.category === 'Other');
  let updated = 0;
  for (const exp of expenses) {
    for (const rule of rules) {
      const haystack = rule.match_type === 'vendor'
        ? (exp.vendor || exp.description || '').toLowerCase()
        : (exp.description || '').toLowerCase();
      if (haystack.includes(rule.keyword)) {
        await db.update('expenses', r => r.id === exp.id, { category: rule.category });
        updated++;
        break;
      }
    }
  }
  res.json({ ok: true, updated });
}));

// ── QUOTES ────────────────────────────────────────────────────────────────────
app.get('/api/quotes', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('quotes', req.session.userId, null, (a,b) => b.id - a.id));
}));
app.post('/api/quotes', requireAuth, wrap(async (req, res) => {
  const { client, amount, expiry_date, status = 'pending', notes = '' } = req.body;
  if (!client || !amount) return res.status(400).json({ error: 'client and amount required' });
  const entity = await activeEntity(req.session.userId);
  const num = 'QT-' + String(Date.now()).slice(-4);
  const { row } = await db.insert('quotes', { user_id: req.session.userId, entity_id: entity?.id, client, num, amount: Number(amount), expiry_date, status, notes });
  res.json(row);
}));
app.put('/api/quotes/:id', requireAuth, wrap(async (req, res) => {
  const row = await db.get('quotes', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const patch = {};
  const b = req.body || {};
  if (b.client      != null) patch.client      = b.client;
  if (b.amount      != null) patch.amount      = Number(b.amount);
  if (b.expiry_date != null) patch.expiry_date = b.expiry_date;
  if (b.status      != null) patch.status      = b.status;
  if (b.notes       != null) patch.notes       = b.notes;
  await db.update('quotes', r => r.id === Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/quotes/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('quotes', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── VENDORS ───────────────────────────────────────────────────────────────────
app.get('/api/vendors', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('vendors', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => a.name.localeCompare(b.name)));
}));
app.post('/api/vendors', requireAuth, wrap(async (req, res) => {
  const { name, contact, category, owing = 0, ytd_paid = 0, status = 'active' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const entity = await activeEntity(req.session.userId);
  const { row } = await db.insert('vendors', { user_id: req.session.userId, entity_id: entity?.id, name, contact, category, owing: Number(owing), ytd_paid: Number(ytd_paid), status });
  res.json(row);
}));
app.put('/api/vendors/:id', requireAuth, wrap(async (req, res) => {
  const row = await db.get('vendors', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const patch = {};
  if (b.name     != null) patch.name     = String(b.name).trim().slice(0, 200);
  if (b.contact  != null) patch.contact  = String(b.contact).trim().slice(0, 200);
  if (b.category != null) patch.category = String(b.category).slice(0, 100);
  if (b.owing    != null) patch.owing    = parseFloat(b.owing)    || 0;
  if (b.ytd_paid != null) patch.ytd_paid = parseFloat(b.ytd_paid) || 0;
  if (b.status   != null) patch.status   = String(b.status).slice(0, 50);
  await db.update('vendors', r => r.id === Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/vendors/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('vendors', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── BILLS ─────────────────────────────────────────────────────────────────────
app.get('/api/bills', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('bills', req.session.userId, req.entityId ? r => r.entity_id === req.entityId || r.entity_id == null : null, (a,b) => b.id - a.id));
}));
app.post('/api/bills', requireAuth, wrap(async (req, res) => {
  const { vendor, amount, due_date, status = 'unpaid', notes = '' } = req.body;
  if (!vendor || !amount) return res.status(400).json({ error: 'vendor and amount required' });
  const entity = await activeEntity(req.session.userId);
  const num = 'BILL-' + String(Date.now()).slice(-4);
  const { row } = await db.insert('bills', { user_id: req.session.userId, entity_id: entity?.id, vendor, num, amount: Number(amount), due_date, status, notes });
  res.json(row);
}));
app.put('/api/bills/:id', requireAuth, wrap(async (req, res) => {
  const row = await db.get('bills', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const patch = {};
  const b = req.body || {};
  if (b.vendor   != null) patch.vendor   = b.vendor;
  if (b.amount   != null) patch.amount   = Number(b.amount);
  if (b.due_date != null) patch.due_date = b.due_date;
  if (b.status   != null) patch.status   = b.status;
  if (b.notes    != null) patch.notes    = b.notes;
  await db.update('bills', r => r.id === Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/bills/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('bills', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── RECURRING BILLS ───────────────────────────────────────────────────────────
app.get('/api/recurring-bills', requireAuth, wrap(async (req, res) => {
  try {
    res.json(await db.allByUser('recurring_bills', req.session.userId));
  } catch (e) {
    console.error('[GET /api/recurring-bills] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]);
  }
}));
app.post('/api/recurring-bills', requireAuth, wrap(async (req, res) => {
  const { vendor, amount, frequency = 'Monthly', next_run, status = 'active' } = req.body;
  if (!vendor || !amount) return res.status(400).json({ error: 'vendor and amount required' });
  const entity = await activeEntity(req.session.userId);
  const { row } = await db.insert('recurring_bills', { user_id: req.session.userId, entity_id: entity?.id, vendor, amount: Number(amount), frequency, next_run, status });
  res.json(row);
}));
app.put('/api/recurring-bills/:id', requireAuth, wrap(async (req, res) => {
  const row = await db.get('recurring_bills', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { vendor, amount, frequency, next_run, status } = req.body;
  await db.update('recurring_bills', r => r.id === Number(req.params.id), { vendor, amount: Number(amount), frequency, next_run, status });
  res.json({ ok: true });
}));
app.delete('/api/recurring-bills/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('recurring_bills', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── RECURRING INVOICES ────────────────────────────────────────────────────────
app.get('/api/recurring-invoices', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('recurring_invoices', req.session.userId));
}));
app.post('/api/recurring-invoices', requireAuth, wrap(async (req, res) => {
  const { client, amount, frequency = 'Monthly', next_run, status = 'active' } = req.body;
  if (!client || !amount) return res.status(400).json({ error: 'client and amount required' });
  const entity = await activeEntity(req.session.userId);
  const { row } = await db.insert('recurring_invoices', { user_id: req.session.userId, entity_id: entity?.id, client, amount: Number(amount), frequency, next_run, status });
  res.json(row);
}));
app.put('/api/recurring-invoices/:id', requireAuth, wrap(async (req, res) => {
  const row = await db.get('recurring_invoices', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { client, amount, frequency, next_run, status } = req.body;
  await db.update('recurring_invoices', r => r.id === Number(req.params.id), { client, amount: Number(amount), frequency, next_run, status });
  res.json({ ok: true });
}));
app.delete('/api/recurring-invoices/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('recurring_invoices', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── SALES RECEIPTS ────────────────────────────────────────────────────────────
app.get('/api/sales-receipts', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('sales_receipts', req.session.userId));
}));
app.post('/api/sales-receipts', requireAuth, wrap(async (req, res) => {
  const { customer, num, amount, date, method = 'Card' } = req.body || {};
  if (!customer || amount == null) return res.status(400).json({ error: 'customer and amount required.' });
  const { row } = await db.insert('sales_receipts', {
    user_id: req.session.userId,
    customer: String(customer).trim().slice(0, 200),
    num: String(num || 'SR-' + String(Date.now()).slice(-4)).slice(0, 30),
    amount: parseFloat(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    method: String(method).slice(0, 50),
  });
  res.json(row);
}));
app.put('/api/sales-receipts/:id', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.customer != null) patch.customer = String(b.customer).trim().slice(0, 200);
  if (b.amount   != null) patch.amount   = parseFloat(b.amount) || 0;
  if (b.date     != null) patch.date     = b.date;
  if (b.method   != null) patch.method   = String(b.method).slice(0, 50);
  if (b.num      != null) patch.num      = String(b.num).slice(0, 30);
  await db.update('sales_receipts', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, patch);
  res.json({ ok: true });
}));
app.delete('/api/sales-receipts/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('sales_receipts', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── PAYMENTS RECEIVED ─────────────────────────────────────────────────────────
app.get('/api/payments-received', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('payments_received', req.session.userId));
}));
app.post('/api/payments-received', requireAuth, wrap(async (req, res) => {
  const { customer, invoice_ref, amount, date, method = 'Bank Transfer' } = req.body || {};
  if (!customer || amount == null) return res.status(400).json({ error: 'customer and amount required.' });
  const { row } = await db.insert('payments_received', {
    user_id: req.session.userId,
    customer: String(customer).trim().slice(0, 200),
    invoice_ref: String(invoice_ref || '').slice(0, 50),
    amount: parseFloat(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    method: String(method).slice(0, 50),
  });
  res.json(row);
}));
app.put('/api/payments-received/:id', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.customer     != null) patch.customer     = String(b.customer).trim().slice(0, 200);
  if (b.invoice_ref  != null) patch.invoice_ref  = String(b.invoice_ref).slice(0, 50);
  if (b.amount       != null) patch.amount       = parseFloat(b.amount) || 0;
  if (b.date         != null) patch.date         = b.date;
  if (b.method       != null) patch.method       = String(b.method).slice(0, 50);
  await db.update('payments_received', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, patch);
  res.json({ ok: true });
}));
app.delete('/api/payments-received/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('payments_received', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── CREDIT NOTES ──────────────────────────────────────────────────────────────
app.get('/api/credit-notes', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('credit_notes', req.session.userId));
}));
app.post('/api/credit-notes', requireAuth, wrap(async (req, res) => {
  const { customer, num, amount, date, status = 'Open', reason = '' } = req.body || {};
  if (!customer || amount == null) return res.status(400).json({ error: 'customer and amount required.' });
  const validStatuses = ['Open', 'Applied', 'Void'];
  const { row } = await db.insert('credit_notes', {
    user_id: req.session.userId,
    customer: String(customer).trim().slice(0, 200),
    num: String(num || 'CN-' + String(Date.now()).slice(-4)).slice(0, 30),
    amount: parseFloat(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    status: validStatuses.includes(status) ? status : 'Open',
    reason: String(reason).slice(0, 300),
  });
  res.json(row);
}));
app.put('/api/credit-notes/:id', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  const validStatuses = ['Open', 'Applied', 'Void'];
  if (b.customer != null) patch.customer = String(b.customer).trim().slice(0, 200);
  if (b.amount   != null) patch.amount   = parseFloat(b.amount) || 0;
  if (b.date     != null) patch.date     = b.date;
  if (b.status   != null) patch.status   = validStatuses.includes(b.status) ? b.status : 'Open';
  if (b.reason   != null) patch.reason   = String(b.reason).slice(0, 300);
  await db.update('credit_notes', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, patch);
  res.json({ ok: true });
}));
app.delete('/api/credit-notes/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('credit_notes', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── PAYMENTS MADE ─────────────────────────────────────────────────────────────
app.get('/api/payments-made', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('payments_made', req.session.userId));
}));
app.post('/api/payments-made', requireAuth, wrap(async (req, res) => {
  const { vendor, amount, date, method, notes, ref } = req.body || {};
  const { row } = await db.insert('payments_made', {
    user_id: req.session.userId,
    entity_id: req.entityId || null,
    vendor: (vendor || '').trim().slice(0, 200),
    amount: parseFloat(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    method: (method || '').slice(0, 50),
    notes: (notes || '').slice(0, 500),
    ref: (ref || '').slice(0, 100),
  });
  res.json(row);
}));
app.put('/api/payments-made/:id', requireAuth, wrap(async (req, res) => {
  const { vendor, amount, date, method, notes, ref } = req.body || {};
  await db.update('payments_made', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, {
    vendor: (vendor || '').trim().slice(0, 200),
    amount: parseFloat(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    method: (method || '').slice(0, 50),
    notes: (notes || '').slice(0, 500),
    ref: (ref || '').slice(0, 100),
  });
  res.json({ ok: true });
}));
app.delete('/api/payments-made/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('payments_made', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── VENDOR CREDITS ────────────────────────────────────────────────────────────
app.get('/api/vendor-credits', requireAuth, wrap(async (req, res) => {
  try {
    res.json(await db.allByUser('vendor_credits', req.session.userId));
  } catch (e) {
    console.error('[GET /api/vendor-credits] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]);
  }
}));
app.post('/api/vendor-credits', requireAuth, wrap(async (req, res) => {
  const { vendor, num, amount, date, status = 'Open', reason = '' } = req.body || {};
  if (!vendor || amount == null) return res.status(400).json({ error: 'vendor and amount required.' });
  const validStatuses = ['Open', 'Applied', 'Void'];
  const { row } = await db.insert('vendor_credits', {
    user_id: req.session.userId,
    vendor: String(vendor).trim().slice(0, 200),
    num: String(num || 'VC-' + String(Date.now()).slice(-4)).slice(0, 30),
    amount: parseFloat(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    status: validStatuses.includes(status) ? status : 'Open',
    reason: String(reason).slice(0, 300),
  });
  res.json(row);
}));
app.put('/api/vendor-credits/:id', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  const validStatuses = ['Open', 'Applied', 'Void'];
  if (b.vendor  != null) patch.vendor  = String(b.vendor).trim().slice(0, 200);
  if (b.amount  != null) patch.amount  = parseFloat(b.amount) || 0;
  if (b.date    != null) patch.date    = b.date;
  if (b.status  != null) patch.status  = validStatuses.includes(b.status) ? b.status : 'Open';
  if (b.reason  != null) patch.reason  = String(b.reason).slice(0, 300);
  await db.update('vendor_credits', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, patch);
  res.json({ ok: true });
}));
app.delete('/api/vendor-credits/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('vendor_credits', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── TIMESHEET ─────────────────────────────────────────────────────────────────
app.get('/api/timesheet', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('timesheet', req.session.userId, null, (a, b) => b.id - a.id));
}));
app.post('/api/timesheet', requireAuth, wrap(async (req, res) => {
  const { employee, project = '', date, hours, billable = 'Yes', rate = 0 } = req.body || {};
  if (!employee || hours == null) return res.status(400).json({ error: 'employee and hours required' });
  const { row } = await db.insert('timesheet', {
    user_id:  req.session.userId,
    employee: employee.trim().slice(0, 100),
    project:  project.trim().slice(0, 200),
    date:     date || new Date().toISOString().slice(0, 10),
    hours:    parseFloat(hours) || 0,
    billable: billable === 'Yes' ? 'Yes' : 'No',
    rate:     parseFloat(rate) || 0,
  });
  res.status(201).json(row);
}));
app.put('/api/timesheet/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('timesheet', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const patch = {};
  if (b.employee != null) patch.employee = b.employee;
  if (b.project  != null) patch.project  = b.project;
  if (b.date     != null) patch.date     = b.date;
  if (b.hours    != null) patch.hours    = parseFloat(b.hours);
  if (b.billable != null) patch.billable = b.billable;
  if (b.rate     != null) patch.rate     = parseFloat(b.rate);
  await db.update('timesheet', r => r.id === row.id, patch);
  res.json(await db.get('timesheet', r => r.id === row.id));
}));
app.delete('/api/timesheet/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('timesheet', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('timesheet', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── TEAM ──────────────────────────────────────────────────────────────────────
app.get('/api/team', requireAuth, wrap(async (req, res) => {
  const uid  = req.session.userId;
  const user = await db.get('users', u => u.id === uid);
  const pay  = await db.allByUser('payroll', uid);
  const invited = await db.allByUser('team_members', uid);
  const members = [
    { id: 'u0', name: user?.name || user?.email || 'You', email: user?.email || '', role: 'owner', emp_type: 'Owner', lastSeen: 'Now' },
    ...pay.map(p => ({
      id:       `p${p.id}`,
      name:     `${p.fname} ${p.lname}`.trim(),
      email:    `${(p.fname||'').replace(/[^a-z0-9]/gi,'').toLowerCase()}.${(p.lname||'user').replace(/[^a-z0-9]/gi,'').toLowerCase()}@company.com`,
      role:     p.is_owner ? 'owner' : (p.emp_type === 'Contractor' ? 'viewer' : 'accountant'),
      emp_type: p.emp_type,
      lastSeen: 'Recently',
    })),
    ...invited.map(m => ({
      id:       `tm${m.id}`,
      _tmId:    m.id,
      name:     m.name,
      email:    m.email,
      role:     m.role,
      emp_type: 'Invited',
      lastSeen: 'Invited',
    })),
  ];
  res.json(members);
}));
app.post('/api/team', requireAuth, wrap(async (req, res) => {
  const { name, email, role = 'viewer' } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
  const validRoles = ['admin', 'accountant', 'viewer'];
  const { row } = await db.insert('team_members', {
    user_id: req.session.userId,
    name:    name.trim().slice(0, 100),
    email:   email.toLowerCase().slice(0, 200),
    role:    validRoles.includes(role) ? role : 'viewer',
  });
  res.status(201).json(row);
}));
app.put('/api/team/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('team_members', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { role } = req.body || {};
  const validRoles = ['admin', 'accountant', 'viewer'];
  if (role && validRoles.includes(role)) await db.update('team_members', r => r.id === row.id, { role });
  res.json(await db.get('team_members', r => r.id === row.id));
}));
app.delete('/api/team/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('team_members', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('team_members', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── AI CHAT ───────────────────────────────────────────────────────────────────
// Words that signal a complex query requiring Sonnet; everything else uses Haiku.
const COMPLEX_QUERY_RE = /\b(analyze|recommend|explain|forecast|compare|predict|strategy|insight|report|why)\b|how should/i;

app.post('/api/ai', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    const uid         = req.session.userId;
    const questionKey = message.trim().toLowerCase();

    // Check cache first — identical question for same user within 24 h
    const cached = await pool.query(
      `SELECT answer, model FROM ai_cache
       WHERE user_id = $1 AND question = $2 AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC LIMIT 1`,
      [uid, questionKey]
    );
    if (cached.rows.length > 0) {
      const { answer, model } = cached.rows[0];
      return res.json({ reply: answer, model, cached: true });
    }

    // Gather financial context in parallel
    const [invoices, expenses, customers, settings] = await Promise.all([
      db.allByUser('invoices', uid),
      db.allByUser('expenses', uid),
      db.allByUser('customers', uid),
      db.get('user_settings', r => r.user_id === uid),
    ]);
    const cfg = settings || {};

    const totalRevenue  = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    const model = COMPLEX_QUERY_RE.test(message)
      ? (process.env.AI_MODEL_COMPLEX || 'claude-sonnet-4-20250514')
      : (process.env.AI_MODEL_SIMPLE || 'claude-haiku-4-5-20251001');

    // Instructions are static across all users — cache them at the system level.
    const systemInstruction = `You are FinFlow's AI assistant. You ONLY answer questions about the user's financial data provided in this context. You have no knowledge of external events, news, or general information. If asked something outside the user's FinFlow data, respond with: I can only help with your FinFlow financial data. Always be concise and specific to the numbers provided.`;

    // Per-user context changes between users but not between rapid follow-up questions
    // from the same user — cache it as the first user content block.
    const contextText = `Business: ${cfg.company_name || 'This business'}
Revenue (paid invoices): $${totalRevenue.toLocaleString()}
Total Expenses: $${totalExpenses.toLocaleString()}
Net Profit: $${(totalRevenue - totalExpenses).toLocaleString()}
Customers: ${customers.length}
Open Invoices: ${invoices.filter(i => i.status !== 'paid').length}
Overdue Invoices: ${invoices.filter(i => i.status === 'overdue').length}`;

    const messages = [
      ...history.slice(-10)
        .filter(m => ['user', 'assistant'].includes(m.role))
        .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })),
      {
        role: 'user',
        content: [
          { type: 'text', text: contextText, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: message },
        ],
      },
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':        process.env.ANTHROPIC_API_KEY?.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: [
          { type: 'text', text: systemInstruction, cache_control: { type: 'ephemeral' } },
        ],
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'AI service unavailable. Add ANTHROPIC_API_KEY to .env to enable.' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'No response from AI.';

    // Persist to cache (fire-and-forget — don't let a cache write failure block the response)
    pool.query(
      `INSERT INTO ai_cache (user_id, question, answer, model) VALUES ($1, $2, $3, $4)`,
      [uid, questionKey, reply, model]
    ).catch(e => console.error('[AI cache write]', e.message));

    res.json({ reply, model, cached: false });
  } catch (err) {
    console.error('AI route error:', err);
    res.status(500).json({ error: 'AI service error. Check server logs.' });
  }
});

app.get('/api/ai/cache', requireAuth, wrap(async (req, res) => {
  const result = await pool.query(
    `SELECT id, question, answer, model, created_at
     FROM ai_cache WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [req.session.userId]
  );
  res.json(result.rows);
}));

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────
const registerAdminRoutes = require('./admin-routes');
registerAdminRoutes(app, pool, stripe, resendClient);

// ── ACCOUNTANT MARKETPLACE ROUTES ────────────────────────────────────────────
const registerAccountantRoutes = require('./accountant-routes');
registerAccountantRoutes(app, pool, authLimiter, apiLimiter, stripe, resendClient);

// ── RECEIPT SCANNER ───────────────────────────────────────────────────────────
// Accepts a base64-encoded image or PDF and returns structured expense data.
app.post('/api/ai/scan', requireAuth, async (req, res) => {
  try {
    const { base64, mediaType, isPDF } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: 'base64 and mediaType are required.' });

    const contentBlock = isPDF
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mediaType,           data: base64 } };

    const prompt = `You are a financial data extraction assistant. Analyze this receipt, bill, or invoice and extract the following fields. Respond ONLY with a valid JSON object — no markdown, no explanation.

{
  "vendor": "business name on the receipt",
  "amount": "total amount as a number string e.g. 142.50",
  "currency": "3-letter currency code e.g. USD",
  "date": "date in format MMM DD, YYYY",
  "category": "one of: Software, Marketing, Travel, Meals, Office, Equipment, Rent, Utilities, Professional Services, Other",
  "tax_deductible": true or false,
  "notes": "one short sentence describing what this expense is for"
}

If you cannot read a field clearly, use null. Do not invent data.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':        process.env.ANTHROPIC_API_KEY?.trim(),
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      (process.env.AI_MODEL_COMPLEX || 'claude-sonnet-4-20250514'),
        max_tokens: 500,
        messages:   [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic scan error:', err);
      return res.status(502).json({ error: 'AI service unavailable.' });
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const raw     = data.content?.map(b => b.text || '').join('').trim();
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(cleaned);
    res.json(extracted);
  } catch (err) {
    console.error('Scan route error:', err);
    res.status(500).json({ error: 'Could not parse receipt. Try a clearer image.' });
  }
});

// ── STATIC / SPA ──────────────────────────────────────────────────────────────
app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accountant-register.html'));
});
app.get('/accountant', (req, res) => {
  if (!req.session?.accountantId) return res.redirect('/accountant-login');
  res.sendFile(path.join(__dirname, 'public', 'accountant-dashboard.html'));
});
app.get('/accountant-dashboard', (req, res) => {
  if (!req.session?.accountantId) return res.redirect('/accountant-login');
  res.sendFile(path.join(__dirname, 'public', 'accountant-dashboard.html'));
});
app.get('/accountant-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accountant-login.html'));
});
app.get('/accountant-client', (req, res) => {
  if (!req.session?.accountantId) return res.redirect('/accountant-login');
  res.sendFile(path.join(__dirname, 'public', 'accountant-client.html'));
});
app.get('/accountants', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accountants.html'));
});
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const adminPath = path.join(__dirname, 'public', 'admin.html');
  res.sendFile(adminPath, err => {
    if (err) {
      console.error('[Admin] sendFile error:', err.message, 'path:', adminPath);
      res.status(500).send('admin.html not found in public/');
    }
  });
});
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});
// Favicon — return 204 if no file is bundled so it doesn't 500 via the
// static handler. Place this before the wildcard so HEAD requests succeed.
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), (err) => {
    if (err) res.status(204).end();
  });
});
// NOTE: The /api 404 fallback and the * static fallback are registered at
// the BOTTOM of this file (just before the global error handler) so that
// every app.get/post/put/delete('/api/...') has been registered first.
// (Express matches middleware in registration order — placing the /api
// 404 here would short-circuit any routes defined further down.)

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// ── RECURRING SCHEDULER ───────────────────────────────────────────────────────
function nextRunDate(currentDate, frequency) {
  const d = new Date(currentDate);
  if (isNaN(d.getTime())) return null;
  switch (frequency) {
    case 'Weekly':    d.setDate(d.getDate() + 7);    break;
    case 'Monthly':   d.setMonth(d.getMonth() + 1);  break;
    case 'Quarterly': d.setMonth(d.getMonth() + 3);  break;
    case 'Yearly':    d.setFullYear(d.getFullYear() + 1); break;
    default:          d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

async function runRecurringScheduler() {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Recurring invoices
    const { rows: _recInvRows } = await pool.query(
      `SELECT * FROM recurring_invoices WHERE (data->>'status') = 'active' AND (data->>'next_run') <= $1`,
      [today]
    );
    const recInvoices = _recInvRows.map(r => ({ id: r.id, user_id: r.user_id, entity_id: r.entity_id, ...r.data }));
    for (const r of recInvoices) {
      await db.insert('invoices', {
        user_id: r.user_id, entity_id: r.entity_id || null,
        client: r.client, amount: r.amount, due_date: r.next_run,
        status: 'pending', notes: `Auto-generated from recurring schedule`,
      });
      await db.update('recurring_invoices', x => x.id === r.id, { next_run: nextRunDate(r.next_run, r.frequency) });
    }

    // Recurring bills
    const { rows: _recBillRows } = await pool.query(
      `SELECT * FROM recurring_bills WHERE (data->>'status') = 'active' AND (data->>'next_run') <= $1`,
      [today]
    );
    const recBills = _recBillRows.map(r => ({ id: r.id, user_id: r.user_id, entity_id: r.entity_id, ...r.data }));
    for (const r of recBills) {
      const num = 'BILL-' + String(Date.now()).slice(-4);
      await db.insert('bills', {
        user_id: r.user_id, entity_id: r.entity_id || null,
        vendor: r.vendor, num, amount: r.amount, due_date: r.next_run,
        status: 'unpaid', notes: `Auto-generated from recurring schedule`,
      });
      await db.update('recurring_bills', x => x.id === r.id, { next_run: nextRunDate(r.next_run, r.frequency) });
    }

    if (recInvoices.length + recBills.length > 0) {
      console.log(`[Scheduler] Created ${recInvoices.length} invoices, ${recBills.length} bills`);
    }
  } catch (e) {
    console.error('[Scheduler] Error:', e.message);
  }
}

// ── BANKING TRANSACTIONS ──────────────────────────────────────────────────────
app.get('/api/banking', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('personal_transactions', req.session.userId, r => r.source === 'banking', (a, b) => new Date(b.date) - new Date(a.date)));
}));
app.post('/api/banking', requireAuth, wrap(async (req, res) => {
  const { desc, amount, type, date, cat } = req.body || {};
  if (!desc || amount == null) return res.status(400).json({ error: 'desc and amount required.' });
  const { row } = await db.insert('personal_transactions', {
    user_id: req.session.userId,
    entity_id: req.entityId || null,
    description: desc, amount: parseFloat(amount) || 0,
    type: type || 'debit', date: date || new Date().toISOString().slice(0, 10),
    category: cat || 'Other', source: 'banking',
  });
  res.status(201).json(row);
}));
app.delete('/api/banking/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('personal_transactions', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('personal_transactions', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── MRR / SAAS ────────────────────────────────────────────────────────────────
app.get('/api/mrr', requireAuth, wrap(async (req, res) => {
  const rows = await db.allByUser('user_settings', req.session.userId, r => r.key === 'mrr_data');
  res.json(rows[0]?.value ? JSON.parse(rows[0].value) : { subscribers: [], plans: [] });
}));
app.put('/api/mrr', requireAuth, wrap(async (req, res) => {
  const existing = await db.get('user_settings', r => r.user_id === req.session.userId && r.key === 'mrr_data');
  const data = JSON.stringify(req.body || {});
  if (existing) {
    await db.update('user_settings', r => r.id === existing.id, { value: data });
  } else {
    await db.insert('user_settings', { user_id: req.session.userId, key: 'mrr_data', value: data });
  }
  res.json({ ok: true });
}));

// ── PERMISSIONS ───────────────────────────────────────────────────────────────
app.get('/api/permissions', requireAuth, wrap(async (req, res) => {
  const rows = await db.all('user_settings', r => r.user_id === req.session.userId && r.key === 'permissions');
  res.json(rows[0]?.value ? JSON.parse(rows[0].value) : null);
}));
app.post('/api/permissions', requireAuth, wrap(async (req, res) => {
  const data = JSON.stringify(req.body || []);
  const existing = await db.get('user_settings', r => r.user_id === req.session.userId && r.key === 'permissions');
  if (existing) {
    await db.update('user_settings', r => r.id === existing.id, { value: data });
  } else {
    await db.insert('user_settings', { user_id: req.session.userId, key: 'permissions', value: data });
  }
  res.json({ ok: true });
}));

// ── DERIVED / AGGREGATE ENDPOINTS ─────────────────────────────────────────────
// These aren't backed by their own table — they compute a summary on the fly
// from invoices + expenses. Used by the Cashflow, Reports, and Tax Filing
// pages so each one has a single round-trip instead of refetching invoices
// and expenses individually and re-summing on the client.

// GET /api/cashflow — { in, out, net, monthly: [{month, in, out, net}, ...] }
app.get('/api/cashflow', requireAuth, wrap(async (req, res) => {
  try {
    const uid = req.session.userId;
    const eid = req.entityId || null;
    const matchEnt = r => !eid || r.entity_id === eid || r.entity_id == null;
    const invoices = (await db.allByUser('invoices', uid, matchEnt)) || [];
    const expenses = (await db.allByUser('expenses', uid, matchEnt)) || [];

    const inflow  = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const outflow = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    // Build last-12-month rolling buckets (oldest first).
    const now = new Date();
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7); // YYYY-MM
      const label = d.toLocaleString('en-US', { month: 'short' });
      const mIn = invoices
        .filter(x => x.status === 'paid' && (x.due_date || '').slice(0, 7) === key)
        .reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
      const mOut = expenses
        .filter(x => (x.expense_date || '').slice(0, 7) === key)
        .reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
      monthly.push({ month: label, in: mIn, out: mOut, net: mIn - mOut });
    }

    res.json({ in: inflow, out: outflow, net: inflow - outflow, monthly });
  } catch (e) {
    console.error('[GET /api/cashflow]', e.message);
    res.json({ in: 0, out: 0, net: 0, monthly: [] });
  }
}));

// GET /api/reports — summary stats (revenue, expenses, profit, counts).
app.get('/api/reports', requireAuth, wrap(async (req, res) => {
  try {
    const uid = req.session.userId;
    const eid = req.entityId || null;
    const matchEnt = r => !eid || r.entity_id === eid || r.entity_id == null;
    const invoices = (await db.allByUser('invoices', uid, matchEnt)) || [];
    const expenses = (await db.allByUser('expenses', uid, matchEnt)) || [];

    const revenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const outstanding = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const overdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const totalExp = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const netProfit = revenue - totalExp;
    const margin = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;

    // COGS from inventory movements
    let totalCOGS = 0;
    try {
      const { rows: cogsRows } = await pool.query(
        `SELECT im.inventory_id,
                SUM(CASE WHEN im.type='sale' THEN im.quantity ELSE 0 END) AS units_sold,
                SUM(CASE WHEN im.type='purchase' THEN im.quantity*im.unit_cost ELSE 0 END) AS purchase_total,
                SUM(CASE WHEN im.type='purchase' THEN im.quantity ELSE 0 END) AS units_purchased
         FROM inventory_movements im WHERE im.user_id = $1 GROUP BY im.inventory_id`,
        [uid]
      );
      for (const r of cogsRows) {
        const unitCost = parseFloat(r.purchase_total) / Math.max(parseFloat(r.units_purchased), 1);
        totalCOGS += parseFloat(r.units_sold) * unitCost;
      }
      totalCOGS = Math.round(totalCOGS * 100) / 100;
    } catch (_) { totalCOGS = 0; }

    // FX gain/loss
    let fxRealised = 0, fxUnrealised = 0;
    try {
      const { rows: fxRows } = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN status='settled' THEN realised_gain_loss ELSE 0 END),0) AS realised,
                COALESCE(SUM(CASE WHEN status='open' THEN unrealised_gain_loss ELSE 0 END),0) AS unrealised
         FROM fx_transactions WHERE user_id=$1`, [uid]
      );
      fxRealised = parseFloat(fxRows[0]?.realised) || 0;
      fxUnrealised = parseFloat(fxRows[0]?.unrealised) || 0;
    } catch (_) {}

    res.json({
      revenue, outstanding, overdue,
      expenses: totalExp,
      netProfit, margin,
      invoiceCount: invoices.length,
      expenseCount: expenses.length,
      cogs: totalCOGS,
      grossProfit: revenue - totalCOGS,
      fx_realised: fxRealised,
      fx_unrealised: fxUnrealised,
    });
  } catch (e) {
    console.error('[GET /api/reports]', e.message);
    res.json({ revenue: 0, outstanding: 0, overdue: 0, expenses: 0, netProfit: 0, margin: 0, invoiceCount: 0, expenseCount: 0 });
  }
}));

// POST /api/reports/profit-loss — monthly P&L breakdown
app.post('/api/reports/profit-loss', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const [invoices, expenses] = await Promise.all([
    db.allByUser('invoices', uid),
    db.allByUser('expenses', uid),
  ]);
  const _MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const toMonth = d => { const dt = new Date(d); return isNaN(dt) ? 'Unknown' : `${_MO[dt.getMonth()]} '${String(dt.getFullYear()).slice(-2)}`; };
  const monthMap = {};
  (invoices || []).filter(i => i.status === 'paid').forEach(i => {
    const m = toMonth(i.created_at || i.due_date || i.date);
    if (!monthMap[m]) monthMap[m] = { revenue: 0, expenses: 0 };
    monthMap[m].revenue += parseFloat(i.amount) || 0;
  });
  (expenses || []).forEach(e => {
    const m = toMonth(e.expense_date || e.date || e.created_at);
    if (!monthMap[m]) monthMap[m] = { revenue: 0, expenses: 0 };
    monthMap[m].expenses += parseFloat(e.amount) || 0;
  });
  const rows = Object.keys(monthMap).sort().map(m => ({
    month: m, revenue: monthMap[m].revenue, expenses: monthMap[m].expenses,
    netProfit: monthMap[m].revenue - monthMap[m].expenses,
  }));
  const totalRevenue  = rows.reduce((s, r) => s + r.revenue, 0);
  const totalExpenses = rows.reduce((s, r) => s + r.expenses, 0);
  res.json({ rows, totalRevenue, totalExpenses, netProfit: totalRevenue - totalExpenses });
}));

// POST /api/reports/balance-sheet — assets vs liabilities snapshot
app.post('/api/reports/balance-sheet', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const [invoices, expenses, bills] = await Promise.all([
    db.allByUser('invoices', uid),
    db.allByUser('expenses', uid),
    db.allByUser('bills', uid).catch(() => []),
  ]);
  const paidRev  = (invoices || []).filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const totalExp = (expenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const cash     = Math.max(0, paidRev - totalExp);
  const ar       = (invoices || []).filter(i => i.status !== 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const ap       = (bills   || []).filter(b => b.status !== 'paid').reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
  const totalAssets      = cash + ar;
  const totalLiabilities = ap;
  res.json({ cash, accountsReceivable: ar, totalAssets, accountsPayable: ap, totalLiabilities, equity: totalAssets - totalLiabilities });
}));

// POST /api/reports/cash-flow — monthly inflows vs outflows
app.post('/api/reports/cash-flow', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const [receipts, payments, invoices, expenses] = await Promise.all([
    db.allByUser('receipts', uid).catch(() => []),
    db.allByUser('payments', uid).catch(() => []),
    db.allByUser('invoices', uid),
    db.allByUser('expenses', uid),
  ]);
  const monthMap = {};
  const _MO2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const add = (date, field, amount) => {
    if (!date) return;
    const dt = new Date(date);
    const m = isNaN(dt) ? 'Unknown' : `${_MO2[dt.getMonth()]} '${String(dt.getFullYear()).slice(-2)}`;
    if (!monthMap[m]) monthMap[m] = { inflow: 0, outflow: 0 };
    monthMap[m][field] += parseFloat(amount) || 0;
  };
  (receipts || []).forEach(r => add(r.date, 'inflow', r.amount));
  (invoices || []).filter(i => i.status === 'paid').forEach(i => add(i.created_at || i.due_date || i.date, 'inflow', i.amount));
  (payments || []).forEach(p => add(p.date, 'outflow', p.amount));
  (expenses || []).forEach(e => add(e.expense_date || e.date || e.created_at, 'outflow', e.amount));
  const rows = Object.keys(monthMap).sort().map(m => ({
    month: m, inflow: monthMap[m].inflow, outflow: monthMap[m].outflow,
    net: monthMap[m].inflow - monthMap[m].outflow,
  }));
  res.json({ rows, totalInflow: rows.reduce((s, r) => s + r.inflow, 0), totalOutflow: rows.reduce((s, r) => s + r.outflow, 0) });
}));

// GET /api/tax-filing — quarterly tax estimates from paid invoices and
// deductible expenses. Uses a flat 25% combined federal+self-employment
// estimate as a starting point; users override on the frontend.
app.get('/api/tax-filing', requireAuth, wrap(async (req, res) => {
  try {
    const uid = req.session.userId;
    const eid = req.entityId || null;
    const matchEnt = r => !eid || r.entity_id === eid || r.entity_id == null;
    const invoices = (await db.allByUser('invoices', uid, matchEnt)) || [];
    const expenses = (await db.allByUser('expenses', uid, matchEnt)) || [];

    const revenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const deductible = expenses.reduce((s, e) => {
      const ded = e.deductible;
      const factor = ded === 'yes' || ded === '100' ? 1 : ded === 'half' || ded === '50' ? 0.5 : 0;
      return s + ((parseFloat(e.amount) || 0) * factor);
    }, 0);
    const taxableIncome = Math.max(0, revenue - deductible);
    const estimatedTax = Math.round(taxableIncome * 0.25);
    const quarterly = Math.round(estimatedTax / 4);

    res.json({
      revenue, deductible, taxableIncome,
      estimatedTax, quarterly,
      rate: 0.25,
    });
  } catch (e) {
    console.error('[GET /api/tax-filing]', e.message);
    res.json({ revenue: 0, deductible: 0, taxableIncome: 0, estimatedTax: 0, quarterly: 0, rate: 0.25 });
  }
}));

// GET /api/scenario — placeholder; scenarios live entirely client-side for
// now. Returns the saved scenario blob from user_settings if present, else
// an empty object so the client can default.
app.get('/api/scenario', requireAuth, wrap(async (req, res) => {
  try {
    const row = await db.get('user_settings', r => r.user_id === req.session.userId && r.key === 'scenario');
    res.json(row?.value ? JSON.parse(row.value) : {});
  } catch (e) {
    console.error('[GET /api/scenario]', e.message);
    res.json({});
  }
}));
app.put('/api/scenario', requireAuth, wrap(async (req, res) => {
  try {
    const data = JSON.stringify(req.body || {});
    const existing = await db.get('user_settings', r => r.user_id === req.session.userId && r.key === 'scenario');
    if (existing) await db.update('user_settings', r => r.id === existing.id, { value: data });
    else await db.insert('user_settings', { user_id: req.session.userId, key: 'scenario', value: data });
    res.json({ ok: true });
  } catch (e) {
    console.error('[PUT /api/scenario]', e.message);
    res.status(500).json({ error: 'Could not save scenario.' });
  }
}));

// GET /api/connections + POST /api/connections — connection toggle states
// (e.g. "Stripe enabled", "QuickBooks enabled"). Stored as a JSON blob in
// user_settings under key='connections'. Defaults to an empty object so the
// frontend can render all toggles off.
app.get('/api/connections', requireAuth, wrap(async (req, res) => {
  try {
    const row = await db.get('user_settings', r => r.user_id === req.session.userId && r.key === 'connections');
    res.json(row?.value ? JSON.parse(row.value) : {});
  } catch (e) {
    console.error('[GET /api/connections]', e.message);
    res.json({});
  }
}));
app.post('/api/connections', requireAuth, wrap(async (req, res) => {
  try {
    const data = JSON.stringify(req.body || {});
    const existing = await db.get('user_settings', r => r.user_id === req.session.userId && r.key === 'connections');
    if (existing) await db.update('user_settings', r => r.id === existing.id, { value: data });
    else await db.insert('user_settings', { user_id: req.session.userId, key: 'connections', value: data });
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/connections]', e.message);
    res.status(500).json({ error: 'Could not save connection settings.' });
  }
}));

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — FIELD-LEVEL AUDIT TRAIL
// ════════════════════════════════════════════════════════════════════════════════
async function auditLog(pool, { userId, entityId, table, recordId, action, field, oldValue, newValue, req }) {
  try {
    await pool.query(
      `INSERT INTO audit_trail (user_id,entity_id,table_name,record_id,action,field_name,old_value,new_value,ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, entityId, table, recordId, action, field || null, oldValue?.toString() || null, newValue?.toString() || null, req?.ip || null]
    );
  } catch (e) { console.error('auditLog error:', e.message); }
}

app.get('/api/audit-trail', requireAuth, wrap(async (req, res) => {
  const { table, action } = req.query;
  let q = `SELECT * FROM audit_trail WHERE user_id = $1`;
  const params = [req.session.userId];
  if (table && table !== 'all') { params.push(table); q += ` AND table_name = $${params.length}`; }
  if (action && action !== 'all') { params.push(action); q += ` AND action = $${params.length}`; }
  q += ` ORDER BY changed_at DESC LIMIT 500`;
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — PARTIAL PAYMENTS + BANK RECONCILIATION
// ════════════════════════════════════════════════════════════════════════════════
async function recalcInvoiceStatus(pool, invoiceId, userId) {
  const invRow = await db.get('invoices', r => r.id === invoiceId && r.user_id === userId);
  if (!invRow) return;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS paid FROM invoice_payments WHERE invoice_id = $1`,
    [invoiceId]
  );
  const paid = parseFloat(rows[0].paid) || 0;
  const total = parseFloat(invRow.amount) || 0;
  const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : invRow.status;
  await db.update('invoices', r => r.id === invoiceId && r.user_id === userId, { status, amount_paid: paid });
}

app.get('/api/invoice-payments', requireAuth, wrap(async (req, res) => {
  const { invoice_id } = req.query;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });
  const { rows } = await pool.query(
    `SELECT * FROM invoice_payments WHERE invoice_id = $1 AND user_id = $2 ORDER BY payment_date DESC`,
    [parseInt(invoice_id), req.session.userId]
  );
  res.json(rows);
}));

app.post('/api/invoice-payments', requireAuth, wrap(async (req, res) => {
  const { invoice_id, amount, payment_date, method, reference, notes } = req.body || {};
  if (!invoice_id || !amount) return res.status(400).json({ error: 'invoice_id and amount required' });
  const { rows } = await pool.query(
    `INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date, method, reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.session.userId, req.entityId || null, parseInt(invoice_id), parseFloat(amount),
     payment_date || new Date().toISOString().slice(0, 10), method || 'Bank Transfer', reference || null, notes || null]
  );
  await recalcInvoiceStatus(pool, parseInt(invoice_id), req.session.userId);
  await auditLog(pool, { userId: req.session.userId, entityId: req.entityId, table: 'invoice_payments', recordId: rows[0].id, action: 'CREATE', req });
  res.status(201).json(rows[0]);
}));

app.delete('/api/invoice-payments/:id', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM invoice_payments WHERE id=$1 AND user_id=$2 RETURNING *`,
    [parseInt(req.params.id), req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  await recalcInvoiceStatus(pool, rows[0].invoice_id, req.session.userId);
  res.json({ ok: true });
}));

app.get('/api/bank-reconciliation', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const matchedBankIds = await pool.query(`SELECT banking_id FROM bank_reconciliation WHERE user_id=$1`, [uid]);
  const matchedPayIds  = await pool.query(`SELECT invoice_payment_id FROM bank_reconciliation WHERE user_id=$1`, [uid]);
  const matchedBankSet = new Set(matchedBankIds.rows.map(r => r.banking_id));
  const matchedPaySet  = new Set(matchedPayIds.rows.map(r => r.invoice_payment_id));

  const banking = await db.allByUser('personal_transactions', uid, r => r.source === 'banking');
  const unmatchedBanking = banking.filter(r => !matchedBankSet.has(r.id));

  const { rows: payments } = await pool.query(
    `SELECT ip.*, i.data->>'client' AS client FROM invoice_payments ip
     LEFT JOIN invoices i ON i.id = ip.invoice_id
     WHERE ip.user_id = $1 ORDER BY ip.payment_date DESC`,
    [uid]
  );
  const unmatchedPayments = payments.filter(r => !matchedPaySet.has(r.id));

  const { rows: matched } = await pool.query(
    `SELECT br.*, ip.amount AS pay_amount, ip.payment_date, ip.method,
            pt.data->>'description' AS bank_desc, pt.data->>'amount' AS bank_amount
     FROM bank_reconciliation br
     JOIN invoice_payments ip ON ip.id = br.invoice_payment_id
     JOIN personal_transactions pt ON pt.id = br.banking_id
     WHERE br.user_id = $1 ORDER BY br.matched_at DESC`,
    [uid]
  );
  res.json({ unmatchedBanking, unmatchedPayments, matched });
}));

app.post('/api/bank-reconciliation/match', requireAuth, wrap(async (req, res) => {
  const { banking_id, invoice_payment_id } = req.body || {};
  if (!banking_id || !invoice_payment_id) return res.status(400).json({ error: 'banking_id and invoice_payment_id required' });
  const bankRow = await pool.query('SELECT id FROM personal_transactions WHERE id=$1 AND user_id=$2', [banking_id, req.session.userId]);
  const payRow = await pool.query('SELECT id FROM invoice_payments WHERE id=$1 AND user_id=$2', [invoice_payment_id, req.session.userId]);
  if (!bankRow.rows[0] || !payRow.rows[0]) return res.status(404).json({ error: 'Not found.' });
  const { rows } = await pool.query(
    `INSERT INTO bank_reconciliation (user_id, entity_id, banking_id, invoice_payment_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.session.userId, req.entityId || null, parseInt(banking_id), parseInt(invoice_payment_id)]
  );
  res.status(201).json(rows[0]);
}));

app.delete('/api/bank-reconciliation/:id', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM bank_reconciliation WHERE id=$1 AND user_id=$2 RETURNING *`,
    [parseInt(req.params.id), req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — MULTI-JURISDICTION PAYROLL
// ════════════════════════════════════════════════════════════════════════════════
function calculatePayroll(grossMonthly, jurisdiction = 'TT', bonus = 0, overtime = 0, options = {}) {
  const {
    province = 'ON',
    state = '',
    scotland = false,
    studentLoanPlan = 0,
    pension = true,
  } = options;

  const totalGross = grossMonthly + bonus + overtime;
  let tax1 = 0, tax1_label = '', tax2 = 0, tax2_label = '', tax3 = 0, tax3_label = '';
  let employerContributions = 0;
  let notes = '';

  if (jurisdiction === 'TT') {
    const nis = Math.min(totalGross * 0.0315, 414.72);
    const personalAllowance = 7000;
    const taxable = Math.max(0, totalGross - personalAllowance - nis);
    const annualTaxable = taxable * 12;
    const paye = annualTaxable <= 1000000 ? (annualTaxable * 0.25) / 12 : (250000 + (annualTaxable - 1000000) * 0.30) / 12;
    const healthSurcharge = totalGross > 469 ? 35.75 : 8.25;
    tax1 = Math.round(paye * 100) / 100; tax1_label = 'PAYE';
    tax2 = Math.round(nis * 100) / 100; tax2_label = 'NIS';
    tax3 = healthSurcharge; tax3_label = 'Health Surcharge';
    employerContributions = Math.round(Math.min(totalGross * 0.0315, 414.72) * 100) / 100;
  } else if (jurisdiction === 'BB') {
    const nis = totalGross * 0.111;
    const taxable = Math.max(0, totalGross * 12 - 25000) / 12;
    const paye = taxable * 0.25;
    tax1 = Math.round(paye * 100) / 100; tax1_label = 'PAYE';
    tax2 = Math.round(nis * 100) / 100; tax2_label = 'NIS';
    employerContributions = Math.round(totalGross * 0.111 * 100) / 100;
  } else if (jurisdiction === 'JM') {
    const threshold = 1500096 / 12;
    const taxable = Math.max(0, totalGross - threshold);
    const incomeTax = taxable * 0.25;
    const nis = Math.min(totalGross * 0.03, 22500 / 12);
    const nht = totalGross * 0.02;
    const edTax = totalGross * 0.0225;
    tax1 = Math.round(incomeTax * 100) / 100; tax1_label = 'Income Tax';
    tax2 = Math.round((nis + nht + edTax) * 100) / 100; tax2_label = 'NIS+NHT+Ed Tax';
    employerContributions = Math.round((Math.min(totalGross * 0.03, 22500 / 12) + totalGross * 0.03 + totalGross * 0.03) * 100) / 100;
  } else if (jurisdiction === 'CA') {
    const cpp = Math.min(totalGross * 0.0595, 3867.50 / 12);
    const ei = Math.min(totalGross * 0.0166, 1049.12 / 12);
    const annualGross = totalGross * 12;
    let federalTax = 0;
    if (annualGross <= 55867) federalTax = annualGross * 0.15;
    else if (annualGross <= 111733) federalTax = 8380 + (annualGross - 55867) * 0.205;
    else if (annualGross <= 154906) federalTax = 19832 + (annualGross - 111733) * 0.26;
    else federalTax = 31016 + (annualGross - 154906) * 0.29;
    const p = (province || 'ON').toUpperCase();
    let provTax = 0;
    if (p === 'AB') {
      provTax = Math.max(0, annualGross - 21003) * 0.10;
    } else if (p === 'QC') {
      if (annualGross <= 51780) provTax = annualGross * 0.14;
      else if (annualGross <= 103560) provTax = 7249.20 + (annualGross - 51780) * 0.19;
      else if (annualGross <= 126000) provTax = 17087.40 + (annualGross - 103560) * 0.24;
      else provTax = 22474.20 + (annualGross - 126000) * 0.2575;
    } else if (p === 'BC') {
      if (annualGross <= 45654) provTax = annualGross * 0.0506;
      else if (annualGross <= 91310) provTax = 2310.09 + (annualGross - 45654) * 0.0770;
      else if (annualGross <= 104835) provTax = 5825.00 + (annualGross - 91310) * 0.1050;
      else if (annualGross <= 127299) provTax = 7244.12 + (annualGross - 104835) * 0.1229;
      else if (annualGross <= 172602) provTax = 10003.24 + (annualGross - 127299) * 0.1470;
      else provTax = 16665.00 + (annualGross - 172602) * 0.1680;
    } else {
      if (annualGross <= 51446) provTax = annualGross * 0.0505;
      else if (annualGross <= 102894) provTax = 2598.02 + (annualGross - 51446) * 0.0915;
      else if (annualGross <= 150000) provTax = 7307.39 + (annualGross - 102894) * 0.1116;
      else provTax = 12565.43 + (annualGross - 150000) * 0.1216;
    }
    tax1 = Math.round(((federalTax + provTax) / 12) * 100) / 100; tax1_label = `Federal+${p} Tax`;
    tax2 = Math.round(cpp * 100) / 100; tax2_label = 'CPP';
    tax3 = Math.round(ei * 100) / 100; tax3_label = 'EI';
    const employerCPP = Math.min(totalGross * 0.0595, 3867.50 / 12);
    const employerEI = Math.min(totalGross * 0.0166 * 1.4, 1049.12 / 12 * 1.4);
    employerContributions = Math.round((employerCPP + employerEI) * 100) / 100;
    if (p !== 'ON') notes = `Province: ${p}`;
  } else if (jurisdiction === 'US') {
    const annualGross = totalGross * 12;
    let federalTax = 0;
    if (annualGross <= 11600) federalTax = annualGross * 0.10;
    else if (annualGross <= 47150) federalTax = 1160 + (annualGross - 11600) * 0.12;
    else if (annualGross <= 100525) federalTax = 5426 + (annualGross - 47150) * 0.22;
    else if (annualGross <= 191950) federalTax = 17168 + (annualGross - 100525) * 0.24;
    else federalTax = 39110 + (annualGross - 191950) * 0.32;
    const socialSecurity = Math.min(totalGross * 0.062, 160200 * 0.062 / 12);
    const medicare = totalGross * 0.0145;
    const st = (state || '').toUpperCase();
    let stateTax = 0;
    if (!['TX','FL','NV','WA','SD','WY','AK','NH','TN'].includes(st)) {
      if (st === 'CA') {
        if (annualGross <= 10412) stateTax = annualGross * 0.01;
        else if (annualGross <= 24684) stateTax = 104.12 + (annualGross - 10412) * 0.02;
        else if (annualGross <= 38959) stateTax = 389.56 + (annualGross - 24684) * 0.04;
        else if (annualGross <= 54081) stateTax = 960.56 + (annualGross - 38959) * 0.06;
        else if (annualGross <= 68350) stateTax = 1867.88 + (annualGross - 54081) * 0.08;
        else stateTax = 3009.40 + (annualGross - 68350) * 0.093;
      } else if (st === 'NY') {
        if (annualGross <= 17150) stateTax = annualGross * 0.04;
        else if (annualGross <= 23600) stateTax = 686 + (annualGross - 17150) * 0.045;
        else if (annualGross <= 27900) stateTax = 976.25 + (annualGross - 23600) * 0.0525;
        else if (annualGross <= 161550) stateTax = 1202 + (annualGross - 27900) * 0.0585;
        else if (annualGross <= 323200) stateTax = 9021.57 + (annualGross - 161550) * 0.0625;
        else stateTax = 19124.57 + (annualGross - 323200) * 0.0685;
      } else if (st === 'IL') {
        stateTax = annualGross * 0.0495;
      } else if (st) {
        stateTax = annualGross * 0.05;
      }
    }
    tax1 = Math.round(((federalTax + stateTax) / 12) * 100) / 100;
    tax1_label = st ? `Federal+${st} Tax` : 'Federal Tax';
    tax2 = Math.round(socialSecurity * 100) / 100; tax2_label = 'Social Security';
    tax3 = Math.round(medicare * 100) / 100; tax3_label = 'Medicare';
    employerContributions = Math.round((Math.min(totalGross * 0.062, 160200 * 0.062 / 12) + totalGross * 0.0145) * 100) / 100;
    if (st) notes = `State: ${st}`;
  } else if (jurisdiction === 'GB') {
    const personalAllowance = 12570 / 12;
    const annualGross = totalGross * 12;
    let incomeTax = 0;
    if (scotland) {
      const scottishTaxable = Math.max(0, annualGross - 12570);
      if (scottishTaxable <= 2306) incomeTax = scottishTaxable * 0.19;
      else if (scottishTaxable <= 13991) incomeTax = 437.14 + (scottishTaxable - 2306) * 0.20;
      else if (scottishTaxable <= 31092) incomeTax = 2774.14 + (scottishTaxable - 13991) * 0.21;
      else if (scottishTaxable <= 62430) incomeTax = 6365.35 + (scottishTaxable - 31092) * 0.42;
      else incomeTax = 19526.51 + (scottishTaxable - 62430) * 0.47;
      notes = 'Scottish income tax rates applied';
    } else {
      const annualTaxable = Math.max(0, annualGross - 12570);
      if (annualTaxable <= 37700) incomeTax = annualTaxable * 0.20;
      else if (annualTaxable <= 125140) incomeTax = 7540 + (annualTaxable - 37700) * 0.40;
      else incomeTax = 42140 + (annualTaxable - 125140) * 0.45;
    }
    const niThreshold = 12570 / 12;
    const ni = totalGross > niThreshold ? Math.min((totalGross - niThreshold) * 0.08, (50270 - 12570) / 12 * 0.08) : 0;
    const plan = parseInt(studentLoanPlan, 10) || 0;
    const slThresholds = { 1: 22015 / 12, 2: 27295 / 12, 4: 27660 / 12, 5: 25000 / 12 };
    const slRate = plan > 0 && slThresholds[plan] ? (totalGross > slThresholds[plan] ? (totalGross - slThresholds[plan]) * 0.09 : 0) : 0;
    const pensionEmployee = pension ? totalGross * 0.05 : 0;
    const pensionEmployer = pension ? totalGross * 0.03 : 0;
    tax1 = Math.round((incomeTax / 12) * 100) / 100; tax1_label = scotland ? 'Scottish Income Tax' : 'Income Tax';
    const niLabel = [plan > 0 ? `Student Loan Plan ${plan}` : '', pension ? 'Pension' : ''].filter(Boolean);
    tax2 = Math.round((ni + slRate + pensionEmployee) * 100) / 100;
    tax2_label = niLabel.length ? `NI+${niLabel.join('+')}` : 'National Insurance';
    const employerNI = totalGross > (9100 / 12) ? (totalGross - 9100 / 12) * 0.138 : 0;
    employerContributions = Math.round((employerNI + pensionEmployer) * 100) / 100;
  } else if (jurisdiction === 'MX') {
    const annualGross = totalGross * 12;
    let isr = 0;
    if (annualGross <= 8952.49) isr = annualGross * 0.0192;
    else if (annualGross <= 75984.55) isr = 171.88 + (annualGross - 8952.49) * 0.064;
    else if (annualGross <= 133536.07) isr = 4461.94 + (annualGross - 75984.55) * 0.1088;
    else isr = 10723.55 + (annualGross - 133536.07) * 0.16;
    const imss = totalGross * 0.022;
    tax1 = Math.round((isr / 12) * 100) / 100; tax1_label = 'ISR';
    tax2 = Math.round(imss * 100) / 100; tax2_label = 'IMSS';
    employerContributions = Math.round(totalGross * 0.17 * 100) / 100;
  } else if (jurisdiction === 'CO') {
    const pensionCO = totalGross * 0.04;
    const health = totalGross * 0.04;
    tax1 = Math.round(pensionCO * 100) / 100; tax1_label = 'Pensión';
    tax2 = Math.round(health * 100) / 100; tax2_label = 'Salud';
    employerContributions = Math.round((totalGross * 0.12 + totalGross * 0.085) * 100) / 100;
  } else {
    tax1 = Math.round(totalGross * 0.20 * 100) / 100; tax1_label = 'Income Tax';
    employerContributions = Math.round(totalGross * 0.05 * 100) / 100;
  }

  const totalDeductions = Math.round((tax1 + tax2 + tax3) * 100) / 100;
  const netPay = Math.round((totalGross - totalDeductions) * 100) / 100;
  const totalEmployerCost = Math.round((totalGross + employerContributions) * 100) / 100;
  return { gross: grossMonthly, bonus, overtime, totalGross, tax1, tax1_label, tax2, tax2_label, tax3, tax3_label, totalDeductions, netPay, employerContributions, totalEmployerCost, notes, jurisdiction };
}

app.get('/api/payroll-runs', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pr.*, json_agg(prl ORDER BY prl.id) AS lines
     FROM payroll_runs pr
     LEFT JOIN payroll_run_lines prl ON prl.run_id = pr.id
     WHERE pr.user_id = $1 AND ($2::int IS NULL OR pr.entity_id = $2)
     GROUP BY pr.id ORDER BY pr.created_at DESC LIMIT 50`,
    [req.session.userId, req.entityId || null]
  );
  res.json(rows);
}));

app.post('/api/payroll-runs', requireAuth, wrap(async (req, res) => {
  const { period, jurisdiction = 'TT', bonus_overrides = {}, overtime_overrides = {}, options = {}, notes = '' } = req.body || {};
  if (!period) return res.status(400).json({ error: 'period required' });
  const uid = req.session.userId;
  const eid = req.entityId || null;

  const employees = await db.allByUser('payroll', uid, eid ? r => r.entity_id === eid || r.entity_id == null : null);
  if (!employees.length) return res.status(400).json({ error: 'No employees found for this entity.' });

  const lines = employees.map(emp => {
    const gross = parseFloat(emp.gross) || 0;
    const bonus = parseFloat(bonus_overrides[emp.id]) || 0;
    const overtime = parseFloat(overtime_overrides[emp.id]) || 0;
    const calc = calculatePayroll(gross, jurisdiction, bonus, overtime, options);
    return { payroll_id: emp.id, employee_name: `${emp.fname} ${emp.lname}`.trim(), ...calc, jurisdiction };
  });

  const totalGross = lines.reduce((s, l) => s + l.totalGross, 0);
  const totalDeductions = lines.reduce((s, l) => s + l.totalDeductions, 0);
  const totalNet = lines.reduce((s, l) => s + l.netPay, 0);

  const { rows: [run] } = await pool.query(
    `INSERT INTO payroll_runs (user_id, entity_id, period, jurisdiction, run_date, status, total_gross, total_deductions, total_net, notes)
     VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9) RETURNING *`,
    [uid, eid, period, jurisdiction, 'draft', totalGross, totalDeductions, totalNet, notes]
  );

  for (const l of lines) {
    await pool.query(
      `INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, tax1, tax1_label, tax2, tax2_label, tax3, tax3_label, net_pay, jurisdiction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [run.id, l.payroll_id, l.employee_name, l.gross, l.bonus, l.overtime, l.tax1, l.tax1_label, l.tax2, l.tax2_label, l.tax3, l.tax3_label, l.netPay, l.jurisdiction]
    );
  }

  const { rows: fullLines } = await pool.query(`SELECT * FROM payroll_run_lines WHERE run_id = $1`, [run.id]);
  await auditLog(pool, { userId: uid, entityId: eid, table: 'payroll_runs', recordId: run.id, action: 'CREATE', req });
  res.status(201).json({ ...run, lines: fullLines });
}));

app.get('/api/payroll-runs/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [run] } = await pool.query(
    `SELECT * FROM payroll_runs WHERE id=$1 AND user_id=$2`, [parseInt(req.params.id), req.session.userId]
  );
  if (!run) return res.status(404).json({ error: 'Not found.' });
  const { rows: lines } = await pool.query(`SELECT * FROM payroll_run_lines WHERE run_id=$1`, [run.id]);
  res.json({ ...run, lines });
}));

app.put('/api/payroll-runs/:id/approve', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE payroll_runs SET status='approved' WHERE id=$1 AND user_id=$2 RETURNING *`,
    [parseInt(req.params.id), req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  res.json(rows[0]);
}));

app.put('/api/payroll-runs/:id/mark-paid', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE payroll_runs SET status='paid' WHERE id=$1 AND user_id=$2 RETURNING *`,
    [parseInt(req.params.id), req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  res.json(rows[0]);
}));

app.get('/api/payroll/preview', requireAuth, wrap(async (req, res) => {
  const gross = parseFloat(req.query.gross) || 0;
  const jurisdiction = req.query.jurisdiction || 'TT';
  const bonus = parseFloat(req.query.bonus) || 0;
  const overtime = parseFloat(req.query.overtime) || 0;
  const options = {
    province: req.query.province || 'ON',
    state: req.query.state || '',
    scotland: req.query.scotland === 'true',
    studentLoanPlan: parseInt(req.query.studentLoanPlan || '0', 10),
    pension: req.query.pension !== 'false',
  };
  res.json(calculatePayroll(gross, jurisdiction, bonus, overtime, options));
}));

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — INVENTORY COGS (FIFO)
// ════════════════════════════════════════════════════════════════════════════════
async function calculateFIFOCOGS(pool, inventoryId, quantitySold) {
  const { rows: purchases } = await pool.query(
    `SELECT quantity, unit_cost FROM inventory_movements WHERE inventory_id=$1 AND type='purchase' ORDER BY moved_at ASC`,
    [inventoryId]
  );
  const { rows: [{ sold }] } = await pool.query(
    `SELECT COALESCE(SUM(quantity),0) AS sold FROM inventory_movements WHERE inventory_id=$1 AND type='sale'`,
    [inventoryId]
  );
  let alreadySold = parseFloat(sold), toSell = quantitySold, cogs = 0;
  for (const b of purchases) {
    const avail = parseFloat(b.quantity) - alreadySold;
    if (avail <= 0) { alreadySold -= parseFloat(b.quantity); continue; }
    alreadySold = 0;
    const used = Math.min(avail, toSell);
    cogs += used * parseFloat(b.unit_cost);
    toSell -= used;
    if (toSell <= 0) break;
  }
  return Math.round(cogs * 100) / 100;
}

app.get('/api/inventory-movements', requireAuth, wrap(async (req, res) => {
  const { inventory_id } = req.query;
  let q = `SELECT * FROM inventory_movements WHERE user_id = $1`;
  const params = [req.session.userId];
  if (inventory_id) { params.push(parseInt(inventory_id)); q += ` AND inventory_id = $${params.length}`; }
  q += ` ORDER BY moved_at DESC LIMIT 200`;
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

app.post('/api/inventory-movements', requireAuth, wrap(async (req, res) => {
  const { inventory_id, type, quantity, unit_cost, reference, notes } = req.body || {};
  if (!inventory_id || !type || !quantity) return res.status(400).json({ error: 'inventory_id, type, quantity required' });
  if (!['purchase', 'sale', 'adjustment'].includes(type)) return res.status(400).json({ error: 'type must be purchase, sale, or adjustment' });

  const item = await ownedBy('inventory', inventory_id, req.session.userId);
  if (!item) return res.status(404).json({ error: 'Inventory item not found.' });

  const qty = parseFloat(quantity);
  let cogs = null;
  if (type === 'sale') {
    cogs = await calculateFIFOCOGS(pool, parseInt(inventory_id), qty);
  }

  const { rows: [movement] } = await pool.query(
    `INSERT INTO inventory_movements (user_id, entity_id, inventory_id, type, quantity, unit_cost, reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.session.userId, req.entityId || null, parseInt(inventory_id), type, qty,
     parseFloat(unit_cost) || 0, reference || null, notes || null]
  );

  const newUnits = type === 'purchase' ? item.units + qty : Math.max(0, item.units - qty);
  const newMax = item.max_units || 200;
  await db.update('inventory', r => r.id === parseInt(inventory_id), {
    units: newUnits, low_stock: newUnits < newMax * 0.1 ? 1 : 0
  });

  res.status(201).json({ ...movement, cogs });
}));

app.get('/api/cogs', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const { rows: movements } = await pool.query(
    `SELECT im.inventory_id, i.data->>'name' AS name, i.data->>'sku' AS sku,
            SUM(CASE WHEN im.type='sale' THEN im.quantity ELSE 0 END) AS units_sold,
            SUM(CASE WHEN im.type='purchase' THEN im.quantity * im.unit_cost ELSE 0 END) AS purchase_total,
            SUM(CASE WHEN im.type='purchase' THEN im.quantity ELSE 0 END) AS units_purchased
     FROM inventory_movements im
     JOIN inventory i ON i.id = im.inventory_id
     WHERE im.user_id = $1
     GROUP BY im.inventory_id, i.data`,
    [uid]
  );

  let totalCOGS = 0;
  const breakdown = [];
  for (const row of movements) {
    const unitsCost = parseFloat(row.purchase_total) / Math.max(parseFloat(row.units_purchased), 1);
    const cogs = Math.round(parseFloat(row.units_sold) * unitsCost * 100) / 100;
    totalCOGS += cogs;
    breakdown.push({ inventory_id: row.inventory_id, name: row.name, sku: row.sku, units_sold: parseFloat(row.units_sold), cogs });
  }

  const invoices = await db.allByUser('invoices', uid);
  const revenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  res.json({ totalCOGS, grossProfit: revenue - totalCOGS, revenue, breakdown });
}));

app.post('/api/cogs/calculate', requireAuth, wrap(async (req, res) => {
  const { inventory_id, quantity } = req.body || {};
  if (!inventory_id || !quantity) return res.status(400).json({ error: 'inventory_id and quantity required' });
  const item = await pool.query('SELECT id FROM inventory WHERE id=$1 AND user_id=$2', [inventory_id, req.session.userId]);
  if (!item.rows[0]) return res.status(404).json({ error: 'Not found.' });
  const cogs = await calculateFIFOCOGS(pool, parseInt(inventory_id), parseFloat(quantity));
  res.json({ cogs });
}));

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — FX GAIN/LOSS TRACKING
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/fx-rates', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM fx_rates WHERE user_id=$1 ORDER BY rate_date DESC, created_at DESC LIMIT 200`,
    [req.session.userId]
  );
  res.json(rows);
}));

app.post('/api/fx-rates', requireAuth, wrap(async (req, res) => {
  const { from_currency, to_currency, rate, rate_date } = req.body || {};
  if (!from_currency || !to_currency || !rate) return res.status(400).json({ error: 'from_currency, to_currency, rate required' });
  const { rows: [row] } = await pool.query(
    `INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.session.userId, req.entityId || null, from_currency.toUpperCase(), to_currency.toUpperCase(),
     parseFloat(rate), rate_date || new Date().toISOString().slice(0, 10)]
  );
  res.status(201).json(row);
}));

app.get('/api/fx-transactions', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM fx_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [req.session.userId]
  );
  res.json(rows);
}));

app.post('/api/fx-transactions', requireAuth, wrap(async (req, res) => {
  const { reference_id, reference_type, foreign_currency, foreign_amount, rate_at_transaction } = req.body || {};
  if (!foreign_currency || !foreign_amount || !rate_at_transaction) {
    return res.status(400).json({ error: 'foreign_currency, foreign_amount, rate_at_transaction required' });
  }
  const fAmt = parseFloat(foreign_amount);
  const rate = parseFloat(rate_at_transaction);
  const baseAmount = Math.round(fAmt * rate * 100) / 100;
  const { rows: [row] } = await pool.query(
    `INSERT INTO fx_transactions (user_id, entity_id, reference_id, reference_type, foreign_currency, foreign_amount, base_amount, rate_at_transaction)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.session.userId, req.entityId || null, reference_id || null, reference_type || null,
     foreign_currency.toUpperCase(), fAmt, baseAmount, rate]
  );
  res.status(201).json(row);
}));

app.post('/api/fx-transactions/:id/settle', requireAuth, wrap(async (req, res) => {
  const { rate_at_settlement } = req.body || {};
  if (!rate_at_settlement) return res.status(400).json({ error: 'rate_at_settlement required' });
  const { rows: [tx] } = await pool.query(
    `SELECT * FROM fx_transactions WHERE id=$1 AND user_id=$2`, [parseInt(req.params.id), req.session.userId]
  );
  if (!tx) return res.status(404).json({ error: 'Not found.' });
  const settlementRate = parseFloat(rate_at_settlement);
  const realisedGL = Math.round((settlementRate - parseFloat(tx.rate_at_transaction)) * parseFloat(tx.foreign_amount) * 100) / 100;
  const { rows: [updated] } = await pool.query(
    `UPDATE fx_transactions SET rate_at_settlement=$1, realised_gain_loss=$2, status='settled', settled_at=NOW()
     WHERE id=$3 RETURNING *`,
    [settlementRate, realisedGL, tx.id]
  );
  res.json(updated);
}));

app.get('/api/fx-summary', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status='settled' THEN realised_gain_loss ELSE 0 END), 0) AS total_realised,
       COALESCE(SUM(CASE WHEN status='open' THEN unrealised_gain_loss ELSE 0 END), 0) AS total_unrealised,
       foreign_currency,
       COUNT(*) AS count
     FROM fx_transactions WHERE user_id=$1
     GROUP BY foreign_currency`,
    [req.session.userId]
  );
  const totalRealised = rows.reduce((s, r) => s + parseFloat(r.total_realised), 0);
  const totalUnrealised = rows.reduce((s, r) => s + parseFloat(r.total_unrealised), 0);
  res.json({ totalRealised, totalUnrealised, netFX: totalRealised + totalUnrealised, byCurrency: rows });
}));

// ── STOCK PRICE PROXY (server-side, avoids CORS / tracking-prevention issues) ─
app.get('/api/stock-price', requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
    const prevClose = meta?.chartPreviousClose ?? meta?.previousClose ?? price;
    const dayChange = price != null && prevClose != null ? price - prevClose : null;
    const dayChangePct = prevClose ? (dayChange / prevClose) * 100 : null;
    const dividend = meta?.trailingAnnualDividendRate ?? 0;
    res.json({ symbol, price, prevClose, dayChange, dayChangePct, dividend });
  } catch(e) {
    res.json({ symbol, price: null, error: e.message });
  }
});

// ── /api 404 + STATIC FALLBACKS ───────────────────────────────────────────────
// Must come AFTER every route registration — Express matches in order.
// Any unmatched /api/* path returns JSON (so fetch().json() doesn't choke on
// the landing.html that the wildcard below would otherwise serve).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ── BOOT ──────────────────────────────────────────────────────────────────────
initDB().then(() => {
  if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`\n  ✦ FinFlow backend running → http://localhost:${PORT}`);
      console.log(`  ✦ Point Lighthouse at:    http://localhost:${PORT}\n`);
    });
    // Run scheduler on boot, then every hour
    runRecurringScheduler();
    setInterval(runRecurringScheduler, 60 * 60 * 1000);
  }
}).catch(err => {
  console.error('Failed to init database:', err);
  if (require.main === module) process.exit(1);
});

module.exports = app;
