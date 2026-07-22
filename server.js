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
const { db, initDB, pool, rowToObj } = require('./database');
const { tierForAccountant } = require('./tier-config');   // F17 — single tier source
const aiCap = require('./ai-cap');                        // F18 — central AI cost caps
const { appUrl, warnIfUnset } = require('./app-url');     // F29 — single source of truth for app links
const { requirePerm } = require('./rbac');                // F5 Step 4 — per-route RBAC (matrix in rbac.js)
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

process.on('unhandledRejection', (reason) => {
  if (reason?.message?.includes('Connection terminated') ||
      reason?.message?.includes('connection timeout') ||
      reason?.code === 'ECONNRESET') {
    console.warn('[DB] Transient connection reset (non-fatal):', reason.message);
    return;
  }
  console.error('[Unhandled Rejection]', reason);
});

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
    "connect-src 'self' https://api.anthropic.com https://query1.finance.yahoo.com https://cdnjs.cloudflare.com; " +   // F49: dropped dead ws:/wss: — FinFlow opens no socket, so a stray socket now hits a documented CSP block
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
// ── F11: subscription lifecycle → users.subscriptionStatus + accountant_clients ─
// The referral payout cron gates on users.data.subscriptionStatus — which, before
// this, was written NOWHERE, so the cron paid nobody. These helpers write it from
// Stripe webhook events and keep the accountant_clients relationship in sync. They
// operate by userId (a webhook has no accountant session), affecting every accountant
// linked to that client.
async function setSubscriptionStatus(userId, status) {
  if (!userId) return;
  await pool.query(
    `UPDATE users SET data = data || jsonb_build_object('subscriptionStatus', $1::text) WHERE id = $2`,
    [String(status || ''), userId]
  ).catch(e => console.error('[Stripe] setSubscriptionStatus failed:', e.message));
}
async function suspendClientForUser(userId) {
  if (!userId) return;
  await pool.query(
    `UPDATE accountant_clients SET status = 'suspended' WHERE user_id = $1 AND status = 'active'`,
    [userId]
  ).catch(e => console.error('[Stripe] suspendClientForUser failed:', e.message));
}
async function reactivateClientForUser(userId) {
  if (!userId) return;
  // Only while referral months remain — a cancelled stretch is not extended.
  await pool.query(
    `UPDATE accountant_clients SET status = 'active'
      WHERE user_id = $1 AND status = 'suspended' AND referral_month < referral_months_total`,
    [userId]
  ).catch(e => console.error('[Stripe] reactivateClientForUser failed:', e.message));
}

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
    // F11: a completed subscription checkout means the client is now paying —
    // record it and reactivate any suspended referral relationship.
    if (upgradeUserId && session.mode === 'subscription') {
      await setSubscriptionStatus(upgradeUserId, 'active');
      await reactivateClientForUser(upgradeUserId);
    }
  }

  // F11: subscription lifecycle — the authoritative source for subscriptionStatus.
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const subUserId = parseInt(sub.metadata?.userId, 10);
    if (subUserId) {
      await setSubscriptionStatus(subUserId, sub.status);
      if (sub.status === 'active') await reactivateClientForUser(subUserId);
      else if (['canceled', 'unpaid', 'past_due', 'incomplete_expired'].includes(sub.status)) await suspendClientForUser(subUserId);
    }
  }

  // F17: reconcile the estimated Stripe fee on a service bill to the REAL fee from
  // the charge's balance transaction, recompute the accountant's net, and mark paid.
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    let realFee = null;
    try {
      const chargeId = pi.latest_charge || pi.charges?.data?.[0]?.id;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
        realFee = charge.balance_transaction?.fee ?? null;
      }
    } catch (e) { console.error('[Stripe] fee reconcile lookup failed:', e.message); }
    await pool.query(`
      UPDATE accountant_earnings
         SET status           = 'paid',
             stripe_fee_cents = COALESCE($2::int, stripe_fee_cents),
             amount_cents     = GREATEST(0, COALESCE(billed_cents, amount_cents)
                                            - COALESCE($2::int, stripe_fee_cents, 0)
                                            - COALESCE(commission_cents, 0))
       WHERE payment_intent_id = $1
    `, [pi.id, realFee]).catch(e => console.error('[Stripe] earnings reconcile failed:', e.message));
  }

  if (event.type === 'customer.subscription.deleted') {
    // Downgrade user back to trial/free when subscription cancelled
    const sub = event.data.object;
    const cancelUserId = parseInt(sub.metadata?.userId, 10);
    if (cancelUserId) {
      await pool.query(
        `UPDATE users SET data = data || jsonb_build_object('plan', 'trial'::text) WHERE id = $1`,
        [cancelUserId]
      );
      // F11: mark not-paying and stop the referral payout immediately.
      await setSubscriptionStatus(cancelUserId, 'canceled');
      await suspendClientForUser(cancelUserId);
      console.log(`[Stripe] User ${cancelUserId} subscription cancelled — plan set to trial, referral suspended`);
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
// F17: serve the single tier definition to the browser (accountant-dashboard.html
// loads it). Same file the Node backend require()s — one source of truth.
app.get('/tier-config.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'tier-config.js'));
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
const LARGE_PAYLOAD_PATHS = ['/api/ai/scan', '/api/documents', '/api/ai/extract-document', '/api/accountants/extract-resume', '/api/accountants/register'];
app.use((req, res, next) => (LARGE_PAYLOAD_PATHS.includes(req.path) ? bigJson : smallJson)(req, res, next));
app.use(express.urlencoded({ extended: false, limit: '500kb' }));
app.set('trust proxy', 1);
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60,
    errorLog: (err) => console.warn('[Session Store] non-fatal:', err.message),
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // F22: 'lax' kills the CSRF-write vector. The SPA and API are same-origin (this Express app
    // serves both; the frontend uses relative /api paths), so 'lax' still sends the cookie on all
    // same-site use AND on the top-level GET redirect back from Stripe Checkout — but NOT on a
    // cross-site <form> POST, which is how the forged write was authenticating. 'none' was set for
    // a cross-origin frontend that isn't in use (app.finflow.io has no DNS). No embed needs the
    // session cookie cross-site (the Stripe webhook is server-to-server, cookieless).
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000, max: 200 });
// RBAC Phase 2, Step A — invite/accept. Invites: an owner onboarding a team sends
// several, so a wider hourly cap; accept is a public, token-guarded surface, held
// to the tight auth cadence to cap brute-force/enumeration even though the 32-byte
// token is unguessable.
const inviteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });
const acceptLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.use('/api', apiLimiter);

// ── F22 defense-in-depth (belt & braces on top of sameSite:'lax') ──────────────
// Runs before auth/resolvers so forged requests are rejected early. Does NOT touch
// the Stripe webhook (registered earlier at /api/stripe/webhook, raw application/json).
//  1) Content-type gate — the API is JSON-only in practice (no route reads urlencoded
//     or multipart). Rejecting the CORS "simple" content-types removes the exact
//     property that lets a cross-site <form> POST skip preflight. Empty content-type
//     (bodyless DELETE/POST) is allowed; a cross-site form can't send an empty type.
//  2) Origin gate — reject any mutation that explicitly declares a foreign Origin.
//     Missing Origin is allowed so server-to-server callers (Stripe webhook, the
//     payout cron, native/mobile) keep working; browser CSRF form posts always send it.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== '' && ct !== 'application/json') {
    return res.status(415).json({ error: 'Unsupported Media Type — this API accepts application/json only.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    const allowed = new Set([
      `https://${req.headers.host}`, `http://${req.headers.host}`,
      process.env.ALLOWED_ORIGIN, process.env.APP_URL,
    ].filter(Boolean));
    if (!allowed.has(origin)) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  return next();
});

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

    const { rows: [_existU] } = await pool.query(
      `SELECT id FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]
    );
    if (_existU) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = bcrypt.hashSync(password, 12);
    const { lastInsertRowid: userId } = await db.insert('users', {
      email: email.toLowerCase(), password: hash,
      name: (name || '').trim().slice(0, 100), plan: 'trial', trial_ends: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), role: 'owner',
    });

    // If user signed up via an accountant referral link (?ref=CODE), link them now
    const refCode = ((req.body?.referralCode || req.body?.ref || req.query?.ref || '')).slice(0, 50);
    if (refCode) {
      pool.query(
        `SELECT id FROM accountants WHERE referral_code = $1 AND status = 'verified'`,
        [refCode]
      ).then(async result => {
        if (!result.rows[0]) {
          // S3: distinguish a DEAD referral code (invalid or unverified accountant)
          // from a valid one that simply has no referrals yet. Signup still succeeds
          // (a bad ?ref= must never block registration), but the broken link is now
          // surfaced instead of silently swallowed as if it had worked.
          console.warn(`[Referral] ref code "${refCode}" not found or not verified — signup for user ${userId} proceeded WITHOUT a referral link.`);
          return;
        }
        const accountantId = result.rows[0].id;
        // F17: tier months from the shared ladder, counting only PAYING active
        // clients (subscriptionStatus='active'; trial excluded). Provisional here —
        // approve-request re-stamps the authoritative frozen value at approval.
        const countResult = await pool.query(
          `SELECT COUNT(*) FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
            WHERE ac.accountant_id = $1 AND ac.status = 'active' AND u.data->>'subscriptionStatus' = 'active'`,
          [accountantId]
        );
        const count = parseInt(countResult.rows[0].count) || 0;
        const months = tierForAccountant(count).referralMonths;
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
    const { rows: [_ru] } = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const user = _ru ? rowToObj(_ru) : null;
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
    const { rows: [_lu] } = await pool.query(
      `SELECT * FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]
    );
    const user = _lu ? rowToObj(_lu) : null;
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

    const { rows: [_fpu] } = await pool.query(
      `SELECT * FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]
    );
    const user = _fpu ? rowToObj(_fpu) : null;
    if (!user) return res.json({ ok: true });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [user.id]);
    await db.insert('password_resets', { user_id: user.id, token, expires });

    const resetUrl = `${appUrl()}/reset-password.html?token=${token}`;

    const _htmlEsc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    if (resendClient) {
      try {
        await resendClient.emails.send({
          from:    process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
          to:      user.email,
          subject: 'Reset your FinFlow password',
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
              <h2 style="color:#c9a84c;margin-bottom:8px">FinFlow</h2>
              <p>Hi ${_htmlEsc(user.name) || 'there'},</p>
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

    const { rows: [_pr] } = await pool.query(
      `SELECT * FROM password_resets WHERE data->>'token' = $1 LIMIT 1`, [token]
    );
    const record = _pr ? rowToObj(_pr) : null;
    if (!record) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    if (new Date(record.expires) < new Date()) {
      await pool.query(`DELETE FROM password_resets WHERE data->>'token' = $1`, [token]);
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const hash = bcrypt.hashSync(password, 12);
    await db.updateById('users', record.user_id, { password: hash });
    await pool.query(`DELETE FROM password_resets WHERE data->>'token' = $1`, [token]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[ResetPassword] Unexpected error:', err);
    res.status(500).json({ error: 'Reset failed. Please try again.' });
  }
});

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const { rows: [_mu] } = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [req.session.userId]);
  const user = _mu ? rowToObj(_mu) : null;
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user: safeUser(user) });
}));
// Alias used by frontend for session checks
app.get('/api/me', requireAuth, wrap(async (req, res) => {
  const { rows: [_meu] } = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [req.session.userId]);
  const user = _meu ? rowToObj(_meu) : null;
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user: safeUser(user) });
}));

// Trial / plan enforcement — applies to all /api routes except auth and stripe webhook
app.use('/api', (req, res, next) => {
  const open = ['/auth/', '/stripe/', '/accountants', '/admin'];
  if (open.some(p => req.path.startsWith(p))) return next();
  if (!req.session?.userId) return next(); // requireAuth handles this
  checkPlan(req, res, next);
});

// ── ACCOUNT RESOLVER (RBAC Phase 2, Step 1) ────────────────────────────────────
// Sets req.accountId = the effective data-scope account for this request.
//   Owner / brand-new signup / no active membership → own user_id (UNCHANGED).
//   Active member/accountant → account_owner_id from their membership row.
// Airtight: a user resolves to another account ONLY via an ACTIVE membership;
// pending/revoked/absent → falls through to own id (never escalates). Registered
// BEFORE the entity resolver below because that resolver calls scopeId(req), which
// now returns req.accountId — so req.accountId must already be set. Resolved fresh
// each request (no session cache) so a revoked membership loses access immediately.
app.use('/api', async (req, res, next) => {
  const uid = req.session?.userId;
  if (!uid) { req.accountId = undefined; return next(); }  // logged out: parity w/ old scopeId
  req.accountId   = uid;                                    // default: owner of own account
  req.accountRole = req.session.userRole || 'owner';        // inert spine until Step 4 enforcement
  try {
    const { rows } = await pool.query(
      `SELECT user_id AS account_owner_id, data->>'role' AS role
         FROM team_members
        WHERE data->>'member_user_id' = $1::text
          AND data->>'status'         = 'active'
        ORDER BY id ASC
        LIMIT 1`,
      [String(uid)]
    );
    const m = rows[0];
    if (m && m.account_owner_id && m.account_owner_id !== uid) {
      req.accountId   = m.account_owner_id;                 // scope to the account they joined
      req.accountRole = m.role || 'viewer';                 // role within that account
    }
  } catch (e) {
    req.accountId   = uid;                                  // fail-safe: own id, never escalate
    req.accountRole = req.session.userRole || 'owner';
  }
  next();
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
        const owned = await pool.query('SELECT id FROM entities WHERE id=$1 AND user_id=$2', [entityIdInt, scopeId(req)]);
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
        [scopeId(req)]
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

// ── COARSE METHOD GATE (RBAC catch-all) ────────────────────────────────────────
// viewer = read-only; DELETE = owner/admin only (accountant + viewer excluded).
// Keyed on req.accountRole — the RESOLVED membership role — NOT req.session.userRole
// (which is the actor's OWN account role, always 'owner' for a normal signup, so it
// let invited members bypass every check). This is the safety net for any route not
// explicitly mapped by requirePerm; owner (incl. every own-account user) is unaffected.
// READ_ONLY_POST: computations that use POST only to carry body params — they are
// reads, so a viewer must be allowed through to them.
const READ_ONLY_POST = new Set(['/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow']);
app.use('/api', (req, res, next) => {
  if (!req.session.userId) return next(); // unauthenticated — let requireAuth handle it
  if (req.path.startsWith('/auth/')) return next(); // auth routes are exempt (self-service)
  const role = req.accountRole || 'viewer'; // resolved membership role; fail closed if unset
  if (req.method === 'DELETE' && !['admin', 'owner'].includes(role))
    return res.status(403).json({ error: 'Only admin or owner can delete records.' });
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && role === 'viewer' && !READ_ONLY_POST.has(req.path))
    return res.status(403).json({ error: 'Viewer role is read-only.' });
  next();
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
// scopeId(req) — the single indirection point for data-scope resolution.
// Phase 2: returns req.accountId, resolved by the account resolver middleware above.
// For an owner (and every user with no active membership) req.accountId === their
// own req.session.userId, so behavior is unchanged; an active invited member/
// accountant resolves to the owner's account. Use for "data belonging to this
// account" reads/writes; keep req.session.userId for actor identity / audit / the
// acting user's own record.
function scopeId(req) { return req.accountId; }

async function ownedBy(table, id, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM ${table} WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [parseInt(id), userId]
  );
  return rows[0] ? rowToObj(rows[0]) : null;
}

// Resolve the first active entity for the current user (used by several POST routes)
async function activeEntity(userId) {
  const rows = await db.allByUser('entities', userId, e => e.is_active);
  return rows[0] || null;
}

// Build a filter function scoped to user (and optionally entity)
function userFilter(userId, entityId) {
  if (entityId) return r => r.user_id === userId && r.entity_id === entityId;
  return r => r.user_id === userId;
}

// ── LAYER 3: SERVER-SIDE DEDUPE (idempotency backstop) ────────────────────────
// Final guard against duplicate CREATEs from a near-simultaneous double POST
// (fast double-click, retry, flaky network). Returns an existing row that matches
// the given field predicate for this user (+ entity) created within `windowSec`
// seconds, so the duplicate POST returns the ORIGINAL row instead of inserting a
// second record. The window is deliberately short (5s) so a user can still
// legitimately create an identical record again later (e.g. logging the same
// expense twice minutes apart). `textMatch`/`numMatch` are keyed by JSONB field
// name; keys are code-controlled constants (never user input); values are bound
// parameters. entity_id uses IS NOT DISTINCT FROM so NULL matches NULL.
async function findRecentDuplicate(table, userId, entityId, { textMatch = {}, numMatch = {} }, windowSec = 5) {
  const w = parseInt(windowSec) || 5;
  const conds = ['user_id = $1', 'entity_id IS NOT DISTINCT FROM $2', `created_at > NOW() - INTERVAL '${w} seconds'`];
  const params = [userId, entityId];
  let i = 3;
  for (const [k, v] of Object.entries(textMatch)) {
    conds.push(`lower(trim(data->>'${k}')) = lower(trim($${i}))`);
    params.push(v == null ? '' : String(v));
    i++;
  }
  for (const [k, v] of Object.entries(numMatch)) {
    // Cast the stored JSON value to numeric; a missing key yields NULL which
    // never equals the bound value, so the row simply won't match (no throw).
    conds.push(`(data->>'${k}')::numeric = $${i}::numeric`);
    params.push(Number(v) || 0);
    i++;
  }
  const { rows } = await pool.query(
    `SELECT * FROM ${table} WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT 1`,
    params
  );
  return rows[0] ? rowToObj(rows[0]) : null;
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
  const { rows } = await pool.query(
    `SELECT * FROM lock_settings WHERE user_id = $1 AND (data->>'enabled')::int = 1 LIMIT 1`,
    [userId]
  );
  const s = rows[0] ? rowToObj(rows[0]) : null;
  if (!s || !s.lock_date) return false;
  return date <= s.lock_date;
}

// ── ENTITIES ──────────────────────────────────────────────────────────────────
app.get('/api/entities', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('entities', req.session.userId, null, (a, b) => a.sort_order - b.sort_order));
}));
app.post('/api/entities', requireAuth, requirePerm('entities:manage'), wrap(async (req, res) => {
  const { name, currency = 'USD', color = '#c9a84c' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  // Layer 3: dedupe near-simultaneous duplicate creates (user_id + name).
  const _dup = await findRecentDuplicate('entities', req.session.userId, null, { textMatch: { name: name.trim().slice(0,100) } });
  if (_dup) return res.status(200).json(_dup);
  // PL#3: enforce the plan's entity cap SERVER-SIDE — RBAC (entities:manage) governs WHO may manage
  // entities, not HOW MANY. Without this a direct API call bypasses the UI gate and creates unlimited
  // entities past the plan. req.userPlan is attached by the trial-expiry middleware. Dedupe runs
  // first so a retried duplicate is never counted against the cap. (Dedupe short-circuits above.)
  const ENTITY_LIMITS = { trial: 1, pro: 1, business: 5 };
  const _entCount = (await db.allByUser('entities', req.session.userId)).length;
  if (_entCount >= (ENTITY_LIMITS[req.userPlan] ?? 1)) {
    return res.status(402).json({ error: 'Entity limit reached for your plan.' });
  }
  const { row } = await db.insert('entities', { user_id: req.session.userId, name: name.trim().slice(0,100), currency, color, is_active: 0, sort_order: 0 });
  res.status(201).json(row);
}));
app.put('/api/entities/:id', requireAuth, requirePerm('entities:manage'), wrap(async (req, res) => {
  const row = await ownedBy('entities', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { name, currency, color } = req.body || {};
  await db.updateById('entities', row.id, { ...(name && {name}), ...(currency && {currency}), ...(color && {color}) });
  const { rows: [_er] } = await pool.query(`SELECT * FROM entities WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_er ? rowToObj(_er) : {});
}));
app.delete('/api/entities/:id', requireAuth, requirePerm('entities:manage'), wrap(async (req, res) => {
  if (!(await ownedBy('entities', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('entities', parseInt(req.params.id));
  res.json({ ok: true });
}));
app.post('/api/entities/:id/activate', requireAuth, requirePerm('entities:manage'), wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = parseInt(req.params.id);
  await pool.query(
    `UPDATE entities SET data = data || '{"is_active":0}'::jsonb, updated_at = NOW() WHERE user_id = $1`,
    [scopeId(req)]
  );
  await pool.query(
    `UPDATE entities SET data = data || '{"is_active":1}'::jsonb, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [eid, scopeId(req)]
  );
  req.session.entityId = eid;
  res.json({ ok: true });
}));

// ── INVOICES ──────────────────────────────────────────────────────────────────
app.get('/api/invoices', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('invoices', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => b.id - a.id));
}));
app.post('/api/invoices', requireAuth, wrap(async (req, res) => {
  const { client, amount, due_date, status = 'pending', notes = '', entity_id, issue_date } = req.body || {};
  if (!client || amount == null) return res.status(400).json({ error: 'client and amount required.' });
  const eid = entity_id || req.entityId || null;
  if (await isLocked(req.session.userId, due_date)) return res.status(403).json({ error: 'Period is locked.' });
  // Layer 3: dedupe near-simultaneous duplicate creates (user_id + entity_id + client + amount).
  const _dup = await findRecentDuplicate('invoices', req.session.userId, eid, { textMatch: { client: client.trim().slice(0,200) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.status(200).json(_dup);
  // F36: issue_date is the user-editable business issue date recognition keys on (Step 2).
  // Store only when supplied — legacy/API rows with no issue_date fall back to created_at at
  // recognition time. Not defaulted server-side (server "today" is UTC; the UI sends a LOCAL
  // date), so we never fabricate a UTC issue date that could differ from the user's day.
  const { row } = await db.insert('invoices', { user_id: req.session.userId, entity_id: eid, client: client.trim().slice(0,200), amount: parseFloat(amount)||0, due_date: due_date||null, status, notes: notes.slice(0,500), issue_date: issue_date || null });
  logAudit(req, 'CREATE', 'invoices', row.id, null, row);
  res.status(201).json(row);
}));
app.put('/api/invoices/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('invoices', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (await isLocked(req.session.userId, row.due_date)) return res.status(403).json({ error: 'Period is locked.' });
  const patch = {};
  const { client, amount, due_date, status, notes, issue_date } = req.body || {};
  if (client != null) patch.client = client;
  if (amount != null) patch.amount = parseFloat(amount);
  if (due_date != null) patch.due_date = due_date;
  if (status != null) patch.status = status.toLowerCase();
  if (notes != null) patch.notes = notes;
  if (issue_date != null) patch.issue_date = issue_date;   // F36: editable business issue date
  await db.updateById('invoices', row.id, patch);
  const { rows: [_iur] } = await pool.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [row.id]);
  const updated = _iur ? rowToObj(_iur) : {};
  logAudit(req, 'UPDATE', 'invoices', row.id, row, updated);
  res.json(updated);
}));
app.delete('/api/invoices/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('invoices', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (await isLocked(req.session.userId, row.due_date)) return res.status(403).json({ error: 'Period is locked.' });
  await db.deleteById('invoices', parseInt(req.params.id));
  logAudit(req, 'DELETE', 'invoices', row.id, row, null);
  res.json({ ok: true });
}));

// ── EXPENSES ──────────────────────────────────────────────────────────────────
app.get('/api/expenses', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('expenses', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => b.id - a.id));
}));
app.post('/api/expenses', requireAuth, wrap(async (req, res) => {
  const { description, category = 'Other', amount, deductible = 'no', expense_date, entity_id } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const eid = entity_id || req.entityId || null;
  const edate = expense_date || new Date().toISOString().slice(0,10);
  if (await isLocked(req.session.userId, edate)) return res.status(403).json({ error: 'Period is locked.' });
  // Layer 3: dedupe near-simultaneous duplicate creates (user_id + entity_id + description + amount).
  const _dup = await findRecentDuplicate('expenses', req.session.userId, eid, { textMatch: { description: description.trim().slice(0,300) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('expenses', row.id, patch);
  const { rows: [_eur] } = await pool.query(`SELECT * FROM expenses WHERE id = $1 LIMIT 1`, [row.id]);
  const updated = _eur ? rowToObj(_eur) : {};
  logAudit(req, 'UPDATE', 'expenses', row.id, row, updated);
  res.json(updated);
}));
app.delete('/api/expenses/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('expenses', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (await isLocked(req.session.userId, row.expense_date)) return res.status(403).json({ error: 'Period is locked.' });
  await db.deleteById('expenses', parseInt(req.params.id));
  logAudit(req, 'DELETE', 'expenses', row.id, row, null);
  res.json({ ok: true });
}));

// ── CUSTOMERS ─────────────────────────────────────────────────────────────────
app.get('/api/customers', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('customers', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => b.revenue - a.revenue));
}));
app.post('/api/customers', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const _dup = await findRecentDuplicate('customers', req.session.userId, b.entity_id||null, { textMatch: { fname: (b.fname||'').trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), email: (b.email||'').slice(0,200) } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('customers', row.id, patch);
  const { rows: [_cur] } = await pool.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_cur ? rowToObj(_cur) : {});
}));
app.delete('/api/customers/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('customers', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('customers', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── INVENTORY ─────────────────────────────────────────────────────────────────
app.get('/api/inventory', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('inventory', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => a.id - b.id));
}));
app.post('/api/inventory', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const u = Math.max(0, parseInt(b.qty || b.units)||0);
  const mx = parseInt(b.max_units)||200;
  const _dup = await findRecentDuplicate('inventory', req.session.userId, b.entity_id||null, { textMatch: { name: (b.name||'').trim().slice(0,200) }, numMatch: { cost: parseFloat(b.cost)||0 } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('inventory', row.id, patch);
  const { rows: [_inur] } = await pool.query(`SELECT * FROM inventory WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_inur ? rowToObj(_inur) : {});
}));
app.post('/api/inventory/:id/restock', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('inventory', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const qty = Math.max(1, Math.min(parseInt(req.body.qty)||0, 100000));
  const newUnits = row.units + qty;
  await db.updateById('inventory', row.id, { units: newUnits, low_stock: newUnits < row.max_units * 0.1 ? 1 : 0 });
  const { rows: [_rstk] } = await pool.query(`SELECT * FROM inventory WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_rstk ? rowToObj(_rstk) : {});
}));
app.delete('/api/inventory/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('inventory', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('inventory', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── ITEMS (product & service catalog) ────────────────────────────────────────
app.get('/api/items', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('items', req.session.userId, null, (a, b) => a.id - b.id));
}));
app.post('/api/items', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required.' });
  const _dup = await findRecentDuplicate('items', req.session.userId, b.entity_id||null, { textMatch: { name: b.name.trim().slice(0,200) }, numMatch: { price: parseFloat(b.price)||0 } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('items', row.id, patch);
  const { rows: [_itmr] } = await pool.query(`SELECT * FROM items WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_itmr ? rowToObj(_itmr) : {});
}));
app.delete('/api/items/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('items', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('items', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── PAYROLL ───────────────────────────────────────────────────────────────────
app.get('/api/payroll', requireAuth, wrap(async (req, res) => {
  const userId = req.session.userId;
  const entityId = req.entityId || null;
  // Fail safe: when no entity resolves, return only legacy unassigned rows — never all entities.
  const rows = await db.allByUser('payroll', userId, r => r.entity_id == null || (entityId != null && r.entity_id === entityId));
  // Normalise is_owner to boolean and sort owner first
  const normalised = (rows || []).map(r => ({
    ...r,
    is_owner: r.is_owner === true || r.is_owner === 1 || r.is_owner === '1',
  })).sort((a, b) => (b.is_owner ? 1 : 0) - (a.is_owner ? 1 : 0) || a.id - b.id);
  res.json(normalised);
}));
app.post('/api/payroll', requireAuth, requirePerm('payroll:write'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.fname) return res.status(400).json({ error: 'fname required.' });
  const _peid = b.entity_id || null;
  // Layer 3: dedupe near-simultaneous duplicate creates (user_id + entity_id + fname + lname + gross).
  const _dup = await findRecentDuplicate('payroll', req.session.userId, _peid, { textMatch: { fname: b.fname.trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100) }, numMatch: { gross: parseFloat(b.gross)||0 } });
  if (_dup) return res.status(200).json(_dup);
  const { row } = await db.insert('payroll', { user_id: req.session.userId, entity_id: _peid, fname: b.fname.trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), role: (b.role||'').slice(0,100), emp_type: b.emp_type||'Full-time', gross: parseFloat(b.gross)||0, deductions: Array.isArray(b.deductions) ? computeDeductions(parseFloat(b.gross)||0, b.deductions).rows.map(({label,value,type})=>({label,value,type})) : [], av_class: b.av_class||'av-blue', is_owner: b.is_owner ? true : false, salary_profile_id: b.salary_profile_id != null ? Number(b.salary_profile_id) : null });
  res.status(201).json(row);
}));
app.put('/api/payroll/:id', requireAuth, requirePerm('payroll:write'), wrap(async (req, res) => {
  const row = await ownedBy('payroll', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['fname','lname','role','emp_type','av_class'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  if (b.gross != null) patch.gross = parseFloat(b.gross);
  // Deduction rows { label, value, type } — sanitized; net is derived, never stored as tax.
  if (Array.isArray(b.deductions)) patch.deductions = computeDeductions(parseFloat(b.gross != null ? b.gross : row.gross)||0, b.deductions).rows.map(({label,value,type})=>({label,value,type}));
  // salary_profile_id links the owner's payroll to its recurring personal-income
  // profile so the salary sync finds-or-updates ONE profile (never fuzzy-matches).
  if (b.salary_profile_id !== undefined) patch.salary_profile_id = b.salary_profile_id != null ? Number(b.salary_profile_id) : null;
  await db.updateById('payroll', row.id, patch);
  const { rows: [_payr] } = await pool.query(`SELECT * FROM payroll WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_payr ? rowToObj(_payr) : {});
}));
app.delete('/api/payroll/:id', requireAuth, requirePerm('payroll:write'), wrap(async (req, res) => {
  if (!(await ownedBy('payroll', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('payroll', parseInt(req.params.id));
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
  const { description, category = 'Other', amount, tx_type = 'expense', tx_date, recurring_profile_id = null, currency = 'USD' } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const _dup = await findRecentDuplicate('personal_transactions', req.session.userId, null, { textMatch: { description: description.trim().slice(0,300) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.status(200).json(_dup);
  // recurring_profile_id links this occurrence to the recurring profile it came
  // from (null = one-time). The period-KPI math uses it to exclude materialised
  // occurrences from one-time sums and project the profile instead (no double-count).
  const { row } = await db.insert('personal_transactions', { user_id: req.session.userId, description: description.trim().slice(0,300), category, amount: parseFloat(amount)||0, tx_type, tx_date: tx_date || new Date().toISOString().slice(0,10), recurring_profile_id: recurring_profile_id != null ? Number(recurring_profile_id) : null, currency: String(currency || 'USD') });
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
  if (b.currency != null)    patch.currency    = String(b.currency);
  // Allow (re)linking or clearing the recurring profile on edit — null unlinks.
  if (b.recurring_profile_id !== undefined) patch.recurring_profile_id = b.recurring_profile_id != null ? Number(b.recurring_profile_id) : null;
  await db.updateById('personal_transactions', row.id, patch);
  const { rows: [_ptr] } = await pool.query(`SELECT * FROM personal_transactions WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_ptr ? rowToObj(_ptr) : {});
}));
app.delete('/api/personal-transactions/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('personal_transactions', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('personal_transactions', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── PERSONAL ACCOUNTS (assets & liabilities → real net worth) ─────────────────
app.get('/api/personal-accounts', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('personal_accounts', req.session.userId,
    r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId),
    (a, b) => b.id - a.id));
}));
app.post('/api/personal-accounts', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'liability' ? 'liability' : 'asset';
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required.' });
  const eid = req.entityId || null;
  const value = parseFloat(b.value) || 0;
  const _dup = await findRecentDuplicate('personal_accounts', req.session.userId, eid, { textMatch: { name, kind }, numMatch: { value } });
  if (_dup) return res.status(200).json(_dup);
  const { row } = await db.insert('personal_accounts', {
    user_id: req.session.userId, entity_id: eid,
    kind, name: name.slice(0, 120), type: (b.type || 'other').slice(0, 40), value,
  });
  res.status(201).json(row);
}));
app.put('/api/personal-accounts/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('personal_accounts', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const patch = {};
  if (b.name  != null) patch.name  = String(b.name).trim().slice(0, 120);
  if (b.type  != null) patch.type  = String(b.type).slice(0, 40);
  if (b.kind  != null) patch.kind  = b.kind === 'liability' ? 'liability' : 'asset';
  if (b.value != null) patch.value = parseFloat(b.value) || 0;
  await db.updateById('personal_accounts', row.id, patch);
  const { rows: [_par] } = await pool.query(`SELECT * FROM personal_accounts WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_par ? rowToObj(_par) : {});
}));
app.delete('/api/personal-accounts/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('personal_accounts', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('personal_accounts', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── SNAPSHOTS (real forward-only net-worth & portfolio series) ────────────────
// GET returns the stored series (ascending by date). POST /capture computes the
// value server-side from the user's own data and UPSERTS one row per period_key
// (net worth monthly, portfolio daily) — idempotent, so repeated captures on
// page load never create duplicates.
app.get('/api/snapshots', requireAuth, wrap(async (req, res) => {
  const kind = req.query.kind;
  const eid  = req.entityId || null;
  res.json(await db.allByUser('snapshots', req.session.userId,
    r => (!kind || r.kind === kind) && (r.entity_id == null || (eid != null && r.entity_id === eid)),
    (a, b) => String(a.date || '').localeCompare(String(b.date || ''))));
}));
app.post('/api/snapshots/capture', requireAuth, wrap(async (req, res) => {
  const uid  = req.session.userId;
  const eid  = req.entityId || null;
  const kind = req.body?.kind === 'portfolio' ? 'portfolio' : (req.body?.kind === 'networth' ? 'networth' : null);
  if (!kind) return res.status(400).json({ error: 'kind must be networth or portfolio.' });
  const dateStr   = new Date().toISOString().slice(0, 10);
  const periodKey = kind === 'networth' ? `networth:${dateStr.slice(0, 7)}` : `portfolio:${dateStr}`;

  // Value is computed server-side from the user's real, entity-scoped data.
  let value = 0;
  if (kind === 'networth') {
    // Net worth = manual assets + live investment portfolio − manual liabilities.
    const accts  = await db.allByUser('personal_accounts', uid, r => (r.entity_id || null) === eid);
    const assets = accts.filter(a => a.kind === 'asset').reduce((s, a) => s + (parseFloat(a.value) || 0), 0);
    const liabs  = accts.filter(a => a.kind === 'liability').reduce((s, a) => s + (parseFloat(a.value) || 0), 0);
    const holds  = await db.allByUser('holdings', uid, r => r.entity_id == null || (eid != null && r.entity_id === eid));
    const portfolio = holds.reduce((s, h) => s + ((parseFloat(h.shares) || 0) * (parseFloat(h.price) || 0)), 0);
    value = assets + portfolio - liabs;
  } else {
    const holds = await db.allByUser('holdings', uid, r => r.entity_id == null || (eid != null && r.entity_id === eid));
    value = holds.reduce((s, h) => s + ((parseFloat(h.shares) || 0) * (parseFloat(h.price) || 0)), 0);
  }

  // Upsert by period_key within this user + entity.
  const existing = await db.allByUser('snapshots', uid, r => r.period_key === periodKey && (r.entity_id || null) === eid);
  if (existing[0]) {
    await db.updateById('snapshots', existing[0].id, { value, date: dateStr });
    return res.json({ ok: true, kind, value, date: dateStr, updated: true });
  }
  const { row } = await db.insert('snapshots', { user_id: uid, entity_id: eid, kind, value, date: dateStr, period_key: periodKey });
  res.status(201).json({ ok: true, kind, value, date: dateStr, row });
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
  const _dup = await findRecentDuplicate('goals', req.session.userId, null, { textMatch: { name: name.trim().slice(0,200) }, numMatch: { target_val: parseFloat(target_val)||0 } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('goals', row.id, patch);
  const { rows: [_gr] } = await pool.query(`SELECT * FROM goals WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_gr ? rowToObj(_gr) : {});
}));
app.delete('/api/goals/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('goals', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('goals', parseInt(req.params.id));
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
  const _dup = await findRecentDuplicate('projects', req.session.userId, null, { textMatch: { name: name.trim().slice(0,200), client: client.trim().slice(0,200) } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('projects', row.id, patch);
  const { rows: [_pjr] } = await pool.query(`SELECT * FROM projects WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_pjr ? rowToObj(_pjr) : {});
}));
app.delete('/api/projects/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('projects', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('projects', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── HOLDINGS ──────────────────────────────────────────────────────────────────
app.get('/api/holdings', requireAuth, wrap(async (req, res) => {
  try {
    const rows = await db.allByUser('holdings', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => a.id - b.id);
    res.json(rows);
  } catch (e) {
    console.error('[GET /api/holdings] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]); // fail-soft: empty list keeps the frontend happy
  }
}));
app.post('/api/holdings', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.ticker || b.shares == null) return res.status(400).json({ error: 'ticker and shares required.' });
  const _dup = await findRecentDuplicate('holdings', req.session.userId, req.entityId || null, { textMatch: { ticker: b.ticker.trim().toUpperCase().slice(0,20) }, numMatch: { shares: parseFloat(b.shares)||0 } });
  if (_dup) return res.status(200).json(_dup);
  const { row } = await db.insert('holdings', { user_id: req.session.userId, entity_id: req.entityId || null, ticker: b.ticker.trim().toUpperCase().slice(0,20), name: (b.name||b.ticker).trim().slice(0,200), asset_type: b.asset_type||'Stock', shares: parseFloat(b.shares)||0, cost_per: parseFloat(b.cost_per)||0, price: parseFloat(b.price)||parseFloat(b.cost_per)||0, dividend: parseFloat(b.dividend)||0, color: b.color||'#c9a84c' });
  res.status(201).json(row);
}));
app.put('/api/holdings/:id', requireAuth, wrap(async (req, res) => {
  const row = await ownedBy('holdings', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['ticker','name','asset_type','color'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  ['shares','cost_per','price','dividend'].forEach(f => { if (b[f] != null) patch[f] = parseFloat(b[f]); });
  await db.updateById('holdings', row.id, patch);
  const { rows: [_hldr] } = await pool.query(`SELECT * FROM holdings WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_hldr ? rowToObj(_hldr) : {});
}));
app.delete('/api/holdings/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('holdings', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('holdings', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── BUDGET TARGETS ────────────────────────────────────────────────────────────
app.get('/api/budget-targets', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  // Prefer entity-scoped row if present, fall back to entity-less row.
  let row = null;
  if (eid) {
    const { rows: [_bte] } = await pool.query(
      `SELECT * FROM budget_targets WHERE user_id = $1 AND entity_id = $2 LIMIT 1`, [scopeId(req), eid]
    );
    row = _bte ? rowToObj(_bte) : null;
  }
  if (!row) {
    const { rows: [_bt0] } = await pool.query(
      `SELECT * FROM budget_targets WHERE user_id = $1 AND entity_id IS NULL LIMIT 1`, [scopeId(req)]
    );
    row = _bt0 ? rowToObj(_bt0) : null;
  }
  res.json(row ? row.targets : {});
}));
app.put('/api/budget-targets', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  const targets = req.body || {};
  // Upsert by both user_id and entity_id so each entity has its own budget
  let existing = null;
  if (eid) {
    const { rows: [_bte2] } = await pool.query(
      `SELECT * FROM budget_targets WHERE user_id = $1 AND entity_id = $2 LIMIT 1`, [scopeId(req), eid]
    );
    existing = _bte2 ? rowToObj(_bte2) : null;
  } else {
    const { rows: [_bt02] } = await pool.query(
      `SELECT * FROM budget_targets WHERE user_id = $1 AND entity_id IS NULL LIMIT 1`, [scopeId(req)]
    );
    existing = _bt02 ? rowToObj(_bt02) : null;
  }
  if (existing) {
    await db.updateById('budget_targets', existing.id, { targets });
  } else {
    await db.insert('budget_targets', { user_id: uid, entity_id: eid, targets });
  }
  res.json({ ok: true });
}));

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, wrap(async (req, res) => {
  const { rows: [_sr] } = await pool.query(
    `SELECT * FROM user_settings WHERE user_id = $1 AND data->>'key' IS NULL LIMIT 1`,
    [scopeId(req)]
  );
  res.json(_sr ? rowToObj(_sr) : {});
}));
app.put('/api/settings', requireAuth, requirePerm('settings:manage'), wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  // Read current settings for audit diff
  const { rows: [_sb] } = await pool.query(
    `SELECT * FROM user_settings WHERE user_id = $1 AND data->>'key' IS NULL LIMIT 1`,
    [scopeId(req)]
  );
  const before = _sb ? rowToObj(_sb) : {};
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
  const uid2 = req.session.userId;
  const { rows: [_usRow] } = await pool.query(
    `SELECT * FROM user_settings WHERE user_id = $1 AND data->>'key' IS NULL LIMIT 1`, [scopeId(req)]
  );
  if (_usRow) await db.updateById('user_settings', _usRow.id, patch);
  else await db.insert('user_settings', { user_id: uid2, ...patch });
  if (b.name) await db.updateById('users', uid2, { name: b.name.trim().slice(0,100) });
  if (b.business_name) {
    // Also update the active entity name if user is updating business name
    const ent = await activeEntity(uid2);
    if (ent) await db.updateById('entities', ent.id, { name: b.business_name.slice(0,100) });
  }
  // Audit log: emit one entry per business-profile field that changed.
  // We only log fields that the user typically modifies on the Settings page —
  // toggles (dark_mode, notif_*, show_cents) are intentionally excluded.
  const TRACKED = ['business_name','industry','address','email','phone','website','tax_id','fiscal_year','currency','business_type','name'];
  for (const f of TRACKED) {
    if (patch[f] == null && f !== 'name') continue;
    const newVal = f === 'name' ? (b.name ? b.name.trim() : null) : patch[f];
    const oldVal = f === 'name'
      ? (await pool.query(`SELECT data->>'name' AS name FROM users WHERE id = $1 LIMIT 1`, [uid2])).rows[0]?.name
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
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { rows: [_cpu] } = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [req.session.userId]);
  const user = _cpu ? rowToObj(_cpu) : null;
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) return res.status(401).json({ error: 'Current password is incorrect.' });
  const hash = bcrypt.hashSync(newPassword, 12);
  await db.updateById('users', req.session.userId, { password: hash });
  logAudit(req, 'CHANGE_PASSWORD', 'users', req.session.userId, null, null);
  res.json({ ok: true });
}));

// ── AUTH — DELETE ACCOUNT ─────────────────────────────────────────────────────
app.delete('/api/auth/account', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required to confirm deletion.' });
  const { rows: [_dau] } = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [uid]);
  const user = _dau ? rowToObj(_dau) : null;
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
    'personal_accounts','snapshots',
  ];
  for (const t of allTables) {
    await db.deleteByUser(t, uid).catch(() => {});
  }
  await pool.query('DELETE FROM ai_cache WHERE user_id=$1', [uid]).catch(() => {});
  await db.deleteById('users', uid);
  req.session.destroy(() => {});
  res.json({ ok: true });
}));

// ── LOCK SETTINGS ─────────────────────────────────────────────────────────────
app.get('/api/lock-settings', requireAuth, wrap(async (req, res) => {
  const { rows: [_lsGet] } = await pool.query(
    `SELECT * FROM lock_settings WHERE user_id = $1 LIMIT 1`, [scopeId(req)]
  );
  const s = _lsGet ? rowToObj(_lsGet) : null;
  res.json(s || { enabled: 0, lock_date: null });
}));
app.post('/api/lock-settings', requireAuth, requirePerm('settings:manage'), wrap(async (req, res) => {
  const { enabled, lock_date, password } = req.body || {};
  const uid = req.session.userId;
  const patch = { enabled: enabled ? 1 : 0, lock_date: lock_date || null };
  if (password) patch.password_hash = bcrypt.hashSync(password, 10);
  const { rows: [_lsUp] } = await pool.query(
    `SELECT * FROM lock_settings WHERE user_id = $1 LIMIT 1`, [scopeId(req)]
  );
  if (_lsUp) await db.updateById('lock_settings', _lsUp.id, patch);
  else await db.insert('lock_settings', { user_id: uid, ...patch });
  logAudit(req, enabled ? 'LOCK_ENABLED' : 'LOCK_DISABLED', 'lock_settings', null, null, patch);
  res.json({ ok: true });
}));

// ── MANUAL JOURNALS ───────────────────────────────────────────────────────────
app.get('/api/journals', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('journals', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => b.id - a.id));
}));
app.post('/api/journals', requireAuth, wrap(async (req, res) => {
  const { date, description, lines = [], status = 'Draft' } = req.body || {};
  if (!description || !lines.length) return res.status(400).json({ error: 'description and lines required.' });
  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) return res.status(400).json({ error: 'Journal does not balance — debits must equal credits.' });
  if (await isLocked(req.session.userId, date)) return res.status(403).json({ error: 'Period is locked.' });
  const num = 'JE-' + String(Date.now()).slice(-4);
  const _dup = await findRecentDuplicate('journals', req.session.userId, req.entityId || null, { textMatch: { description: description.trim().slice(0,500) }, numMatch: { debit: totalDebit } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('journals', row.id, patch);
  const { rows: [_jr] } = await pool.query(`SELECT * FROM journals WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_jr ? rowToObj(_jr) : {});
}));
app.delete('/api/journals/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('journals', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('journals', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── CHART OF ACCOUNTS ─────────────────────────────────────────────────────────
app.get('/api/chart-of-accounts', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('chart_of_accounts', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => a.code.localeCompare(b.code)));
}));
app.post('/api/chart-of-accounts', requireAuth, wrap(async (req, res) => {
  const { code, name, category, nature = 'Debit', balance = 0 } = req.body || {};
  if (!code || !name || !category) return res.status(400).json({ error: 'code, name and category required.' });
  const validCats = ['Assets','Liabilities','Equity','Revenue','Expenses'];
  if (!validCats.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  const _dup = await findRecentDuplicate('chart_of_accounts', req.session.userId, req.entityId || null, { textMatch: { code: code.trim().slice(0,20) } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('chart_of_accounts', row.id, patch);
  const { rows: [_coar] } = await pool.query(`SELECT * FROM chart_of_accounts WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_coar ? rowToObj(_coar) : {});
}));
app.delete('/api/chart-of-accounts/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('chart_of_accounts', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('chart_of_accounts', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
app.get('/api/audit-log', requireAuth, requirePerm('audit:read'), wrap(async (req, res) => {
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
  await db.deleteById('documents', parseInt(req.params.id));
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
  await db.updateById('templates', row.id, patch);
  const { rows: [_tmpr] } = await pool.query(`SELECT * FROM templates WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_tmpr ? rowToObj(_tmpr) : {});
}));
app.delete('/api/templates/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('templates', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('templates', parseInt(req.params.id));
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
  await db.updateById('autocat_rules', row.id, patch);
  const { rows: [_acr] } = await pool.query(`SELECT * FROM autocat_rules WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_acr ? rowToObj(_acr) : {});
}));
app.delete('/api/autocat-rules/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('autocat_rules', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('autocat_rules', parseInt(req.params.id));
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
        await db.updateById('expenses', exp.id, { category: rule.category });
        updated++;
        break;
      }
    }
  }
  res.json({ ok: true, updated });
}));

// ── AI EXPENSE CATEGORISATION (Path B) ────────────────────────────────────────
// Rules-first (free) → per-description cache (free, ai_cache) → batched Haiku for
// the rest, gated by a per-user MONTHLY cap (ai_usage). Only ever classifies
// UNCATEGORISED expenses (!category || 'Other') — never re-analyses categorised
// ones, so repeat runs can't leak cost. Does NOT write categories; the client
// approves via PUT /api/expenses/:id. Requires ANTHROPIC_API_KEY (502 if unset).
const STD_EXPENSE_CATS = ['Software & SaaS','Travel','Meals & Entertainment','Office Supplies','Salaries','Marketing','Professional Services','Rent','Utilities','Insurance','Bank Transfer','Cost of Goods','Other'];
const AI_CAT_BATCH     = 40;      // expenses per Claude call
// F18 — cap now comes from the shared AI budget in ai-cap.js (single source), so
// auto-categorize draws from the same per-plan monthly pool as chat + insights.
function _acNorm(s) { return String(s || '').toLowerCase().replace(/[0-9#*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }

app.post('/api/autocat-rules/ai-suggest', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;

  // 1) UNCATEGORISED expenses only (mirrors /run's filter).
  const expenses = await db.allByUser('expenses', uid, r => !r.category || r.category === 'Other');
  const counts = () => ({
    total: expenses.length,
    rule:  suggestions.filter(s => s.source === 'rule').length,
    cache: suggestions.filter(s => s.source === 'cache').length,
    ai:    suggestions.filter(s => s.source === 'ai').length,
  });
  const suggestions = [];
  if (!expenses.length) return res.json({ suggestions, counts: counts() });

  // Allowed categories = the user's OWN scheme + standard fallback.
  const allExp    = await db.allByUser('expenses', uid);
  const userCats  = [...new Set(allExp.map(e => e.category).filter(c => c && c !== 'Other'))];
  const allowed   = [...new Set([...userCats, ...STD_EXPENSE_CATS])];
  const allowedLc = new Set(allowed.map(c => c.toLowerCase()));

  // 2) RULES-FIRST (free, in-memory, no write).
  const rules = (await db.allByUser('autocat_rules', uid, r => r.enabled)) || [];
  const remaining = [];
  for (const exp of expenses) {
    let cat = null;
    for (const rule of rules) {
      const hay = (rule.match_type === 'vendor' ? (exp.vendor || exp.description || '') : (exp.description || '')).toLowerCase();
      if (rule.keyword && hay.includes(rule.keyword)) { cat = rule.category; break; }
    }
    if (cat) suggestions.push({ expense_id: exp.id, category: cat, confidence: null, source: 'rule' });
    else remaining.push(exp);
  }

  // 3) CACHE by normalised description (free). Group identical descriptions so a
  //    recurring merchant is classified once.
  const keyOf = e => 'autocat:v1:' + _acNorm(e.vendor || e.description);
  const byKey = new Map();
  for (const exp of remaining) {
    const k = keyOf(exp);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(exp);
  }
  const uncached = [];
  for (const [k, group] of byKey.entries()) {
    const c = await pool.query(
      `SELECT answer FROM ai_cache WHERE user_id = $1 AND question = $2 ORDER BY created_at DESC LIMIT 1`, [scopeId(req), k]
    );
    let hit = null;
    if (c.rows[0]) { try { hit = JSON.parse(c.rows[0].answer); } catch (e) { hit = null; } }
    if (hit && hit.category) {
      for (const exp of group) suggestions.push({ expense_id: exp.id, category: hit.category, confidence: hit.confidence ?? null, source: 'cache' });
    } else {
      uncached.push({ key: k, group });
    }
  }
  if (!uncached.length) return res.json({ suggestions, counts: counts() });

  // 4) CAP CHECK — before any Claude call. Only unique uncached descriptions
  //    count against the cap (that's what actually gets sent).
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(502).json({ error: 'AI categorization unavailable. Add ANTHROPIC_API_KEY to enable.', suggestions, counts: counts() });
  }
  const plan = req.userPlan || 'trial';
  const cap  = aiCap.capFor(plan, 'shared');   // F18 — shared monthly AI budget
  const usedRow = await pool.query(
    `SELECT query_count FROM ai_usage WHERE user_id = $1 AND billing_month = date_trunc('month', NOW())`, [scopeId(req)]
  );
  const used   = usedRow.rows[0]?.query_count || 0;
  const budget = cap - used;
  if (budget <= 0) {
    return res.status(402).json({ error: 'Monthly AI limit reached — upgrade for more.', code: 'AI_CAP_REACHED', suggestions, counts: counts() });
  }

  const toSend = uncached.slice(0, budget);          // unique descriptions within budget
  const capped = uncached.length > toSend.length;    // some left unclassified this month

  // 5) BATCHED Haiku classification (strict JSON). Category-list system prompt is
  //    prompt-cached (ephemeral) so repeated batches only pay for it once.
  const model = process.env.AI_MODEL_SIMPLE || 'claude-haiku-4-5-20251001';
  const sys = `You are an expense classifier. Assign each expense to exactly ONE category from this ALLOWED list: ${allowed.join(', ')}. If none fit, use "Other". Reply with ONLY a JSON array, no markdown, no prose: [{"id":<number>,"category":"<one allowed category>","confidence":<number 0-1>}]. confidence is your certainty in the choice.`;
  let sent = 0;
  for (let i = 0; i < toSend.length; i += AI_CAT_BATCH) {
    const batch = toSend.slice(i, i + AI_CAT_BATCH);
    const payload = batch.map(u => { const e = u.group[0]; return { id: e.id, text: (e.vendor || e.description || '').slice(0, 140), amount: e.amount }; });
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY?.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'prompt-caching-2024-07-31',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model, max_tokens: 1500,
          system:   [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: JSON.stringify(payload) }],
        }),
      });
    } catch (e) { console.error('[AI autocat] fetch failed:', e.message); break; }
    if (!resp.ok) { console.error('[AI autocat] Anthropic error:', (await resp.text().catch(() => '')).slice(0, 200)); break; }
    const data = await resp.json();
    sent += batch.length;   // billable: the call happened, count it against the cap
    const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { console.error('[AI autocat] JSON parse failed'); continue; }
    if (!Array.isArray(parsed)) continue;
    const idToUnit = new Map(batch.map(u => [u.group[0].id, u]));
    for (const item of parsed) {
      const unit = idToUnit.get(item.id);
      if (!unit) continue;
      let category = String(item.category || 'Other');
      if (!allowedLc.has(category.toLowerCase())) category = 'Other';
      const confidence = typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : null;
      // Cache the classification for this description (dedupes future runs).
      pool.query(`INSERT INTO ai_cache (user_id, question, answer, model) VALUES ($1, $2, $3, $4)`,
        [uid, unit.key, JSON.stringify({ category, confidence }), model]).catch(() => {});
      for (const exp of unit.group) suggestions.push({ expense_id: exp.id, category, confidence, source: 'ai' });
    }
  }

  // 6) Increment usage by unique descriptions actually SENT to Claude.
  if (sent > 0) {
    pool.query(
      `INSERT INTO ai_usage (user_id, billing_month, query_count)
       VALUES ($1, date_trunc('month', NOW()), $2)
       ON CONFLICT (user_id, billing_month) DO UPDATE SET query_count = ai_usage.query_count + $2`,
      [uid, sent]
    ).catch(e => console.error('[AI usage]', e.message));
  }

  res.json({ suggestions, capped, counts: counts() });
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
  const _dup = await findRecentDuplicate('quotes', req.session.userId, entity?.id || null, { textMatch: { client: String(client) }, numMatch: { amount: Number(amount) } });
  if (_dup) return res.json(_dup);
  const { row } = await db.insert('quotes', { user_id: req.session.userId, entity_id: entity?.id, client, num, amount: Number(amount), expiry_date, status, notes });
  res.json(row);
}));
app.put('/api/quotes/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [_qtr] } = await pool.query(
    `SELECT * FROM quotes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (!_qtr) return res.status(404).json({ error: 'not found' });
  const row = rowToObj(_qtr);
  const patch = {};
  const b = req.body || {};
  if (b.client      != null) patch.client      = b.client;
  if (b.amount      != null) patch.amount      = Number(b.amount);
  if (b.expiry_date != null) patch.expiry_date = b.expiry_date;
  if (b.status      != null) patch.status      = b.status;
  if (b.notes       != null) patch.notes       = b.notes;
  await db.updateById('quotes', Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/quotes/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM quotes WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── VENDORS ───────────────────────────────────────────────────────────────────
app.get('/api/vendors', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('vendors', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => a.name.localeCompare(b.name)));
}));
app.post('/api/vendors', requireAuth, wrap(async (req, res) => {
  const { name, contact, category, owing = 0, ytd_paid = 0, status = 'active' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const entity = await activeEntity(req.session.userId);
  const _dup = await findRecentDuplicate('vendors', req.session.userId, entity?.id || null, { textMatch: { name: String(name) } });
  if (_dup) return res.json(_dup);
  const { row } = await db.insert('vendors', { user_id: req.session.userId, entity_id: entity?.id, name, contact, category, owing: Number(owing), ytd_paid: Number(ytd_paid), status });
  res.json(row);
}));
app.put('/api/vendors/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [_vndr] } = await pool.query(
    `SELECT * FROM vendors WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  const row = _vndr ? rowToObj(_vndr) : null;
  if (!row) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const patch = {};
  if (b.name     != null) patch.name     = String(b.name).trim().slice(0, 200);
  if (b.contact  != null) patch.contact  = String(b.contact).trim().slice(0, 200);
  if (b.category != null) patch.category = String(b.category).slice(0, 100);
  if (b.owing    != null) patch.owing    = parseFloat(b.owing)    || 0;
  if (b.ytd_paid != null) patch.ytd_paid = parseFloat(b.ytd_paid) || 0;
  if (b.status   != null) patch.status   = String(b.status).slice(0, 50);
  await db.updateById('vendors', Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/vendors/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM vendors WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── BILLS ─────────────────────────────────────────────────────────────────────
app.get('/api/bills', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('bills', req.session.userId, r => r.entity_id == null || (req.entityId != null && r.entity_id === req.entityId), (a,b) => b.id - a.id));
}));
app.post('/api/bills', requireAuth, wrap(async (req, res) => {
  const { vendor, amount, due_date, status = 'unpaid', notes = '', issue_date } = req.body;
  if (!vendor || !amount) return res.status(400).json({ error: 'vendor and amount required' });
  const entity = await activeEntity(req.session.userId);
  const num = 'BILL-' + String(Date.now()).slice(-4);
  const _dup = await findRecentDuplicate('bills', req.session.userId, entity?.id || null, { textMatch: { vendor: String(vendor) }, numMatch: { amount: Number(amount) } });
  if (_dup) return res.json(_dup);
  // F36/F38: issue_date is the business issue date the (Step 4) expense-accrual leg keys on;
  // stored only when supplied, legacy rows fall back to created_at at recognition time.
  const { row } = await db.insert('bills', { user_id: req.session.userId, entity_id: entity?.id, vendor, num, amount: Number(amount), due_date, status, notes, issue_date: issue_date || null });
  res.json(row);
}));
app.put('/api/bills/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [_blr] } = await pool.query(
    `SELECT * FROM bills WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  const row = _blr ? rowToObj(_blr) : null;
  if (!row) return res.status(404).json({ error: 'not found' });
  const patch = {};
  const b = req.body || {};
  if (b.vendor     != null) patch.vendor     = b.vendor;
  if (b.amount     != null) patch.amount     = Number(b.amount);
  if (b.due_date   != null) patch.due_date   = b.due_date;
  if (b.status     != null) patch.status     = b.status;
  if (b.notes      != null) patch.notes      = b.notes;
  if (b.issue_date != null) patch.issue_date = b.issue_date;   // F36/F38: editable issue date
  await db.updateById('bills', Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/bills/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM bills WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
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
  const { vendor, amount, frequency = 'Monthly', next_run, status = 'active', end_date = null } = req.body;
  if (!vendor || !amount) return res.status(400).json({ error: 'vendor and amount required' });
  const entity = await activeEntity(req.session.userId);
  const _dup = await findRecentDuplicate('recurring_bills', req.session.userId, entity?.id || null, { textMatch: { vendor: String(vendor).trim().slice(0,200), frequency: String(frequency) }, numMatch: { amount: Number(amount) } });
  if (_dup) return res.json(_dup);
  const { row } = await db.insert('recurring_bills', { user_id: req.session.userId, entity_id: entity?.id, vendor: String(vendor).trim().slice(0, 200), amount: Number(amount), frequency, next_run, status, end_date: end_date || null });
  res.json(row);
}));
app.put('/api/recurring-bills/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [_rblr] } = await pool.query(
    `SELECT * FROM recurring_bills WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (!_rblr) return res.status(404).json({ error: 'not found' });
  const { vendor, amount, frequency, next_run, status } = req.body || {};
  const patch = {};
  if (vendor != null) patch.vendor = String(vendor).trim().slice(0, 200);
  if (amount != null) patch.amount = Number(amount);
  if (frequency != null) patch.frequency = frequency;
  if (next_run != null) patch.next_run = next_run;
  if (status != null) patch.status = status;
  await db.updateById('recurring_bills', Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/recurring-bills/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM recurring_bills WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── RECURRING PERSONAL TRANSACTIONS ─────────────────────────────────────────────
// Mirrors recurring_bills; user-scoped (no entity_id, like personal_transactions).
// The hourly runRecurringScheduler materialises personal_transactions rows.
app.get('/api/recurring-personal-transactions', requireAuth, wrap(async (req, res) => {
  try {
    res.json(await db.allByUser('recurring_personal_transactions', req.session.userId));
  } catch (e) {
    console.error('[GET /api/recurring-personal-transactions] failed for user', req.session.userId, ':', e.code, e.message);
    res.json([]);
  }
}));
app.post('/api/recurring-personal-transactions', requireAuth, wrap(async (req, res) => {
  const { description, category = 'Other', amount, tx_type = 'expense', frequency = 'Monthly', next_run, status = 'active', end_date = null, currency = 'USD' } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const _dup = await findRecentDuplicate('recurring_personal_transactions', req.session.userId, null, { textMatch: { description: String(description).trim().slice(0,300), frequency: String(frequency) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.json(_dup);
  const { row } = await db.insert('recurring_personal_transactions', { user_id: req.session.userId, description: String(description).trim().slice(0, 300), category, amount: parseFloat(amount)||0, tx_type, frequency, next_run, status, end_date: end_date || null, currency: String(currency || 'USD') });
  res.status(201).json(row);
}));
app.put('/api/recurring-personal-transactions/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [_rptr] } = await pool.query(
    `SELECT * FROM recurring_personal_transactions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (!_rptr) return res.status(404).json({ error: 'not found' });
  // Merge-update (db.updateById preserves next_run so the existing schedule holds).
  const { description, category, amount, tx_type, frequency, status, end_date, currency } = req.body || {};
  const patch = {};
  if (description != null) patch.description = String(description).trim().slice(0, 300);
  if (category != null) patch.category = category;
  if (amount != null) patch.amount = parseFloat(amount) || 0;
  if (tx_type != null) patch.tx_type = tx_type;
  if (frequency != null) patch.frequency = frequency;
  if (status != null) patch.status = status;
  if (end_date !== undefined) patch.end_date = end_date || null;
  if (currency != null) patch.currency = String(currency);
  await db.updateById('recurring_personal_transactions', Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/recurring-personal-transactions/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM recurring_personal_transactions WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── RECURRING INVOICES ────────────────────────────────────────────────────────
app.get('/api/recurring-invoices', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('recurring_invoices', req.session.userId));
}));
app.post('/api/recurring-invoices', requireAuth, wrap(async (req, res) => {
  const { client, amount, frequency = 'Monthly', next_run, status = 'active', end_date = null } = req.body;
  if (!client || !amount) return res.status(400).json({ error: 'client and amount required' });
  const entity = await activeEntity(req.session.userId);
  const _dup = await findRecentDuplicate('recurring_invoices', req.session.userId, entity?.id || null, { textMatch: { client: String(client).trim().slice(0,200), frequency: String(frequency) }, numMatch: { amount: Number(amount) } });
  if (_dup) return res.json(_dup);
  const { row } = await db.insert('recurring_invoices', { user_id: req.session.userId, entity_id: entity?.id, client: String(client).trim().slice(0, 200), amount: Number(amount), frequency, next_run, status, end_date: end_date || null });
  res.json(row);
}));
app.put('/api/recurring-invoices/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [_rinvr] } = await pool.query(
    `SELECT * FROM recurring_invoices WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (!_rinvr) return res.status(404).json({ error: 'not found' });
  const { client, amount, frequency, next_run, status, end_date } = req.body || {};
  const patch = {};
  if (client != null) patch.client = String(client).trim().slice(0, 200);
  if (amount != null) patch.amount = Number(amount);
  if (frequency != null) patch.frequency = frequency;
  if (next_run != null) patch.next_run = next_run;
  if (status != null) patch.status = status;
  if (end_date != null) patch.end_date = end_date;
  await db.updateById('recurring_invoices', Number(req.params.id), patch);
  res.json({ ok: true });
}));
app.delete('/api/recurring-invoices/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM recurring_invoices WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── SALES RECEIPTS ────────────────────────────────────────────────────────────
app.get('/api/sales-receipts', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('sales_receipts', req.session.userId));
}));
app.post('/api/sales-receipts', requireAuth, wrap(async (req, res) => {
  const { customer, num, amount, date, method = 'Card' } = req.body || {};
  if (!customer || amount == null) return res.status(400).json({ error: 'customer and amount required.' });
  const _dup = await findRecentDuplicate('sales_receipts', req.session.userId, null, { textMatch: { customer: String(customer).trim().slice(0,200) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.json(_dup);
  const { row } = await db.insert('sales_receipts', {
    user_id: req.session.userId,
    entity_id: req.entityId || null,
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
  await pool.query(
    `UPDATE sales_receipts SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(Object.fromEntries(Object.entries(patch).filter(([,v]) => v !== undefined))), Number(req.params.id), scopeId(req)]
  );
  res.json({ ok: true });
}));
app.delete('/api/sales-receipts/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM sales_receipts WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── PAYMENTS RECEIVED ─────────────────────────────────────────────────────────
app.get('/api/payments-received', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('payments_received', req.session.userId));
}));
app.post('/api/payments-received', requireAuth, wrap(async (req, res) => {
  const { customer, invoice_ref, amount, date, method = 'Bank Transfer' } = req.body || {};
  if (!customer || amount == null) return res.status(400).json({ error: 'customer and amount required.' });
  const _dup = await findRecentDuplicate('payments_received', req.session.userId, null, { textMatch: { customer: String(customer).trim().slice(0,200) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.json(_dup);
  const { row } = await db.insert('payments_received', {
    user_id: req.session.userId,
    entity_id: req.entityId || null,
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
  const { rows: [_prchk] } = await pool.query(
    `SELECT id FROM payments_received WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (_prchk) await db.updateById('payments_received', _prchk.id, patch);
  res.json({ ok: true });
}));
app.delete('/api/payments-received/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM payments_received WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
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
  const _dup = await findRecentDuplicate('credit_notes', req.session.userId, null, { textMatch: { customer: String(customer).trim().slice(0,200) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.json(_dup);
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
  const { rows: [_cnchk] } = await pool.query(
    `SELECT id FROM credit_notes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (_cnchk) await db.updateById('credit_notes', _cnchk.id, patch);
  res.json({ ok: true });
}));
app.delete('/api/credit-notes/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM credit_notes WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── PAYMENTS MADE ─────────────────────────────────────────────────────────────
app.get('/api/payments-made', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('payments_made', req.session.userId));
}));
app.post('/api/payments-made', requireAuth, wrap(async (req, res) => {
  const { vendor, amount, date, method, notes, ref, bill_id } = req.body || {};
  const _dup = await findRecentDuplicate('payments_made', req.session.userId, req.entityId || null, { textMatch: { vendor: (vendor || '').trim().slice(0,200) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.json(_dup);
  // F38 Step 3: bill_id links this payment to a bill (nullable). A LINKED payment settles AP
  // (Step 4 excludes it from expense); an UNLINKED (bill_id null) payment stays a direct expense.
  const _billId = (bill_id != null && bill_id !== '') ? Number(bill_id) : null;
  const { row } = await db.insert('payments_made', {
    user_id: req.session.userId,
    entity_id: req.entityId || null,
    vendor: (vendor || '').trim().slice(0, 200),
    amount: parseFloat(amount) || 0,
    date: date || new Date().toISOString().slice(0, 10),
    method: (method || '').slice(0, 50),
    notes: (notes || '').slice(0, 500),
    ref: (ref || '').slice(0, 100),
    bill_id: _billId,
  });
  if (_billId != null) await recalcBillStatus(pool, _billId, req.session.userId);
  res.json(row);
}));
app.put('/api/payments-made/:id', requireAuth, wrap(async (req, res) => {
  const { vendor, amount, date, method, notes, ref, bill_id } = req.body || {};
  const { rows: [_pmchk] } = await pool.query(
    `SELECT * FROM payments_made WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (!_pmchk) return res.json({ ok: true });
  const _oldBillId = _pmchk.data && _pmchk.data.bill_id != null ? Number(_pmchk.data.bill_id) : null;
  const patch = {};
  if (vendor != null) patch.vendor = String(vendor).trim().slice(0, 200);
  if (amount != null) patch.amount = parseFloat(amount) || 0;
  if (date != null) patch.date = date;
  if (method != null) patch.method = String(method).slice(0, 50);
  if (notes != null) patch.notes = String(notes).slice(0, 500);
  if (ref != null) patch.ref = String(ref).slice(0, 100);
  let _newBillId = _oldBillId;
  if (bill_id !== undefined) { _newBillId = (bill_id != null && bill_id !== '') ? Number(bill_id) : null; patch.bill_id = _newBillId; }
  await db.updateById('payments_made', _pmchk.id, patch);
  // F38 Step 3: recalc every bill this payment touched — the old link and the new one (deduped),
  // so amount/link changes redraw AP on both the previous and current bill.
  for (const b of new Set([_oldBillId, _newBillId])) { if (b != null) await recalcBillStatus(pool, b, req.session.userId); }
  res.json({ ok: true });
}));
app.delete('/api/payments-made/:id', requireAuth, wrap(async (req, res) => {
  // F38 Step 3: capture the linked bill BEFORE deleting so its AP is redrawn afterward.
  const { rows: [_pmrow] } = await pool.query('SELECT * FROM payments_made WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  const _billId = _pmrow && _pmrow.data && _pmrow.data.bill_id != null ? Number(_pmrow.data.bill_id) : null;
  await pool.query('DELETE FROM payments_made WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  if (_billId != null) await recalcBillStatus(pool, _billId, req.session.userId);
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
  const _dup = await findRecentDuplicate('vendor_credits', req.session.userId, null, { textMatch: { vendor: String(vendor).trim().slice(0,200) }, numMatch: { amount: parseFloat(amount)||0 } });
  if (_dup) return res.json(_dup);
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
  const { rows: [_vcchk] } = await pool.query(
    `SELECT id FROM vendor_credits WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [Number(req.params.id), scopeId(req)]
  );
  if (_vcchk) await db.updateById('vendor_credits', _vcchk.id, patch);
  res.json({ ok: true });
}));
app.delete('/api/vendor-credits/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM vendor_credits WHERE id = $1 AND user_id = $2', [Number(req.params.id), scopeId(req)]);
  res.json({ ok: true });
}));

// ── TIMESHEET ─────────────────────────────────────────────────────────────────
app.get('/api/timesheet', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('timesheet', req.session.userId, null, (a, b) => b.id - a.id));
}));
app.post('/api/timesheet', requireAuth, wrap(async (req, res) => {
  const { employee, project = '', date, hours, billable = 'Yes', rate = 0 } = req.body || {};
  if (!employee || hours == null) return res.status(400).json({ error: 'employee and hours required' });
  const _dup = await findRecentDuplicate('timesheet', req.session.userId, null, { textMatch: { employee: employee.trim().slice(0,100), project: project.trim().slice(0,200) }, numMatch: { hours: parseFloat(hours)||0 } });
  if (_dup) return res.status(200).json(_dup);
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
  await db.updateById('timesheet', row.id, patch);
  const { rows: [_tsr] } = await pool.query(`SELECT * FROM timesheet WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_tsr ? rowToObj(_tsr) : {});
}));
app.delete('/api/timesheet/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('timesheet', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('timesheet', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── TEAM ──────────────────────────────────────────────────────────────────────
app.get('/api/team', requireAuth, wrap(async (req, res) => {
  const uid  = req.session.userId;
  const { rows: [_tmu] } = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [uid]);
  const user = _tmu ? rowToObj(_tmu) : null;
  // F19: the roster is people with ACTUAL account access — the owner + real invited
  // members (rows in team_members). Payroll employees are NOT portal users: they have
  // no membership row, no login, and no email on file. They used to be injected here
  // with a fabricated `firstname.lastname@company.com` address AND an RBAC role badge
  // (viewer/accountant) — after Step-1 enforcement that badge was an outright lie about
  // access. They belong on the Payroll page, not the Team/RBAC roster.
  const invited = await db.allByUser('team_members', uid);
  const members = [
    { id: 'u0', name: user?.name || user?.email || 'You', email: user?.email || '', role: 'owner', emp_type: 'Owner', lastSeen: 'Now' },
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
app.post('/api/team', requireAuth, requirePerm('team:manage'), wrap(async (req, res) => {
  const { name, email, role = 'viewer' } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
  const validRoles = ['admin', 'accountant', 'viewer'];
  const _dup = await findRecentDuplicate('team_members', req.session.userId, null, { textMatch: { email: email.toLowerCase().slice(0,200) } });
  if (_dup) return res.status(200).json(_dup);
  const { row } = await db.insert('team_members', {
    user_id: req.session.userId,
    name:    name.trim().slice(0, 100),
    email:   email.toLowerCase().slice(0, 200),
    role:    validRoles.includes(role) ? role : 'viewer',
  });
  res.status(201).json(row);
}));
app.put('/api/team/:id', requireAuth, requirePerm('team:manage'), wrap(async (req, res) => {
  const row = await ownedBy('team_members', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { role } = req.body || {};
  const validRoles = ['admin', 'accountant', 'viewer'];
  if (role && validRoles.includes(role)) await db.updateById('team_members', row.id, { role });
  const { rows: [_tmr] } = await pool.query(`SELECT * FROM team_members WHERE id = $1 LIMIT 1`, [row.id]);
  res.json(_tmr ? rowToObj(_tmr) : {});
}));
app.delete('/api/team/:id', requireAuth, requirePerm('team:manage'), wrap(async (req, res) => {
  if (!(await ownedBy('team_members', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('team_members', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── TEAM INVITE / ACCEPT (RBAC Phase 2, Step A) ────────────────────────────────
// Real multi-user invites. An invite is a team_members row in 'pending' state
// carrying a sha256-hashed, single-use, 7-day token (raw token lives only in the
// emailed link). Accept resolves/creates the invitee's real users row and flips
// the row to 'active' with member_user_id set — exactly what the account resolver
// at the top of this file matches on, so access begins only once active.
//
// SECURITY — the role and the target account come SOLELY from the invite row
// (looked up by token hash), NEVER from the accept request body. There is no path
// by which a caller can POST a role or an account id and have it honored, so an
// invitee cannot self-escalate. Revoke = the owner's DELETE /api/team/:id above
// (removes the row → token lookup fails → resolver never matches).
const INVITE_ROLES     = ['admin', 'accountant', 'viewer'];      // 'owner' deliberately excluded
const hashInviteToken  = t => crypto.createHash('sha256').update(String(t)).digest('hex');

app.post('/api/team/invite', inviteLimiter, requireAuth, requirePerm('team:manage'), wrap(async (req, res) => {
  // Only an owner/admin OF THIS ACCOUNT may invite. accountRole is set per-request
  // by the account resolver; a viewer/accountant member cannot invite.
  if (!['owner', 'admin'].includes(req.accountRole)) {
    return res.status(403).json({ error: 'Only an account owner or admin can invite members.' });
  }
  const ownerId = scopeId(req);   // invite INTO this account (the resolved owner id)
  const { email, role = 'viewer', name = '' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
  if (!INVITE_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });  // rejects 'owner'
  const emailLc  = email.toLowerCase().slice(0, 200);
  const dispName = (name || '').trim().slice(0, 100) || emailLc;

  // Can't invite the account owner's own email.
  const { rows: [ownerRow] } = await pool.query(`SELECT data->>'email' AS email FROM users WHERE id = $1 LIMIT 1`, [ownerId]);
  if (ownerRow && (ownerRow.email || '').toLowerCase() === emailLc) {
    return res.status(400).json({ error: 'That email already owns this account.' });
  }

  // Already an ACTIVE member of this account → nothing to do.
  const { rows: [activeMember] } = await pool.query(
    `SELECT id FROM team_members WHERE user_id = $1 AND lower(data->>'email') = $2 AND data->>'status' = 'active' LIMIT 1`,
    [ownerId, emailLc]
  );
  if (activeMember) return res.status(409).json({ error: 'That person is already a member of this account.' });

  const token     = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expires   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Re-invite: refresh an existing PENDING invite in place (fresh token+expiry),
  // else insert a new pending row. Never stacks duplicate pending invites.
  const { rows: [pending] } = await pool.query(
    `SELECT id FROM team_members WHERE user_id = $1 AND lower(data->>'email') = $2 AND data->>'status' = 'pending' LIMIT 1`,
    [ownerId, emailLc]
  );
  if (pending) {
    await pool.query(
      `UPDATE team_members SET data = data || jsonb_build_object(
         'name', $2::text, 'role', $3::text,
         'invite_token_hash', $4::text, 'invite_expires', $5::text, 'invited_by', $6::text
       ) WHERE id = $1`,
      [pending.id, dispName, role, tokenHash, expires, String(req.session.userId)]
    );
  } else {
    await db.insert('team_members', {
      user_id: ownerId,
      email:   emailLc,
      name:    dispName,
      role,
      status:  'pending',
      invite_token_hash: tokenHash,
      invite_expires:    expires,
      invited_by:        String(req.session.userId),
    });
  }

  // Email the accept link — same helper/pattern as password reset. When Resend is
  // unconfigured the URL is logged so the flow is fully verifiable without keys.
  const acceptUrl = `${appUrl()}/team-accept.html?token=${token}`;
  const roleEsc   = role.replace(/[^a-z]/gi, '');
  if (resendClient) {
    try {
      await resendClient.emails.send({
        from:    process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
        to:      emailLc,
        subject: 'You have been invited to a FinFlow account',
        html:    `<p>You have been invited to join a FinFlow account as <b>${roleEsc}</b>.</p>
                  <p><a href="${acceptUrl}">Accept your invitation</a> — this link expires in 7 days.</p>
                  <p>If you were not expecting this, you can safely ignore this email.</p>`,
      });
    } catch (e) { console.error('[Invite] email failed:', e.message); }
  } else {
    console.log(`[Invite] (Resend not configured) accept URL for ${emailLc}: ${acceptUrl}`);
  }

  res.status(201).json({ ok: true, email: emailLc, role });
}));

// GET — invite metadata for the accept page to render. Read-only; never consumes.
app.get('/api/team/accept', acceptLimiter, wrap(async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
  const { rows: [inv] } = await pool.query(
    `SELECT tm.data->>'email' AS email, tm.data->>'role' AS role, tm.data->>'invite_expires' AS expires,
            ou.data->>'name'  AS owner_name, ou.data->>'email' AS owner_email
       FROM team_members tm
       LEFT JOIN users ou ON ou.id = tm.user_id
      WHERE tm.data->>'invite_token_hash' = $1 AND tm.data->>'status' = 'pending' LIMIT 1`,
    [hashInviteToken(token)]
  );
  if (!inv || !inv.expires || new Date(inv.expires) < new Date()) {
    return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
  }
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [inv.email]
  );
  res.json({
    email:           inv.email,
    role:            inv.role,
    accountName:     inv.owner_name || inv.owner_email || 'a FinFlow account',
    emailHasAccount: !!existing,
  });
}));

// POST — consume the invite. Transactional + row lock to serialize double-accept.
app.post('/api/team/accept', acceptLimiter, wrap(async (req, res) => {
  const { token, name, password } = req.body || {};
  if (!token) return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
  const tokenHash = hashInviteToken(token);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the pending invite row so two concurrent accepts can't both consume it.
    const { rows: [inv] } = await client.query(
      `SELECT id, user_id AS owner_id, data->>'email' AS email,
              data->>'role' AS role, data->>'invite_expires' AS expires
         FROM team_members
        WHERE data->>'invite_token_hash' = $1 AND data->>'status' = 'pending'
        FOR UPDATE`,
      [tokenHash]
    );
    if (!inv || !inv.expires || new Date(inv.expires) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
    }

    // Does a users row already exist for the invited email?
    const { rows: [existRow] } = await client.query(
      `SELECT * FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [inv.email]
    );

    let memberUserId, memberName;
    if (existRow) {
      // EMAIL COLLISION — require proof of identity before linking. A leaked token
      // must never grant access to an existing account: the invitee must already be
      // logged in as that user, or supply its password. Password is NEVER overwritten.
      const existing = rowToObj(existRow);
      const authed = req.session.userId === existing.id
        || (!!password && bcrypt.compareSync(password, existing.password));
      if (!authed) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'existing_account',
          message: 'An account with this email already exists. Enter its password to accept.' });
      }
      memberUserId = existing.id;
      memberName   = existing.name || inv.email;
    } else {
      // NEW USER — create a real users row (their own global identity is 'owner';
      // their role WITHIN this account comes from the invite row, via the resolver).
      if (!password || password.length < 8) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      memberName = (name || '').trim().slice(0, 100) || inv.email;
      const hash = bcrypt.hashSync(password, 12);
      const ins  = await client.query(
        `INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id`,
        [{ email: inv.email, password: hash, name: memberName, plan: 'trial',
           trial_ends: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), role: 'owner' }]
      );
      memberUserId = ins.rows[0].id;
    }

    // An owner accepting their own account's invite would orphan the resolver's
    // self-reference guard — reject it explicitly.
    if (memberUserId === inv.owner_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You cannot accept an invitation into your own account.' });
    }

    // Flip to active membership and DELETE the token fields (single-use). member_user_id
    // stored as text so it compares byte-for-byte with the resolver's $1::text.
    await client.query(
      `UPDATE team_members
          SET data = (data - 'invite_token_hash' - 'invite_expires')
                     || jsonb_build_object('member_user_id', $2::text, 'status', 'active', 'name', $3::text)
        WHERE id = $1`,
      [inv.id, String(memberUserId), memberName]
    );

    // Accountant convergence (RBAC Step B): if the accepted email belongs to a
    // marketplace accountant, link their professional profile to this real users
    // identity via the pre-existing accountants.user_id bridge (set-once). From here
    // an accountant authenticates as a user and resolves into the account through
    // unified membership (role:'accountant'), not the legacy accountant_clients-only
    // path. Same transaction, so identity + membership commit atomically.
    await client.query(
      `UPDATE accountants SET user_id = $1, updated_at = NOW()
        WHERE lower(email) = lower($2) AND user_id IS NULL`,
      [memberUserId, inv.email]
    );

    await client.query('COMMIT');

    // Log them into the account they just joined.
    req.session.userId    = memberUserId;
    req.session.userRole  = 'owner';   // own-identity session role; account role comes from resolver
    req.session.userEmail = inv.email;
    return res.json({ ok: true, role: inv.role });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[Accept] failed:', e.message);
    return res.status(500).json({ error: 'Could not accept invitation. Please try again.' });
  } finally {
    client.release();
  }
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
      [scopeId(req), questionKey]
    );
    if (cached.rows.length > 0) {
      const { answer, model } = cached.rows[0];
      return res.json({ reply: answer, model, cached: true });   // cache hit → free, no cap consumed
    }

    // F18 — cost cap BEFORE any Anthropic call (cache miss only). Fail-closed.
    const gate = await aiCap.checkUserCap(pool, scopeId(req), req.userPlan, 'shared');
    if (!gate.ok) {
      if (gate.failClosed) return res.status(503).json({ error: 'AI temporarily unavailable — please retry.' });
      return res.status(402).json({ error: 'Monthly AI limit reached — upgrade for more.', code: 'AI_CAP_REACHED', used: gate.used, cap: gate.cap });
    }

    // Gather financial context in parallel
    const [invoices, expenses, customers, settings] = await Promise.all([
      db.allByUser('invoices', uid),
      db.allByUser('expenses', uid),
      db.allByUser('customers', uid),
      pool.query(`SELECT * FROM user_settings WHERE user_id = $1 AND data->>'key' IS NULL LIMIT 1`, [scopeId(req)]).then(r => r.rows[0] ? rowToObj(r.rows[0]) : null),
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

    aiCap.recordUser(pool, scopeId(req), 'shared', 1);   // F18 — count the successful call

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
    [scopeId(req)]
  );
  res.json(result.rows);
}));

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────
const registerAdminRoutes = require('./admin-routes');
registerAdminRoutes(app, pool, stripe, resendClient);

// ── CLIENT ↔ ACCOUNTANT MESSAGES ─────────────────────────────────────────────
app.get('/api/accountant-messages', requireAuth, wrap(async (req, res) => {
  const userId = req.session.userId;
  const link = await pool.query(
    `SELECT accountant_id FROM accountant_clients WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [scopeId(req)]
  );
  if (!link.rows[0]) return res.json([]);
  const { rows } = await pool.query(
    `SELECT m.id, m.message AS content, m.sender, m.created_at,
       CASE WHEN m.sender = 'client' THEN 'You'
            ELSE COALESCE(a.first_name || ' ' || a.last_name, 'Accountant') END AS sender_name
     FROM accountant_messages m
     LEFT JOIN accountants a ON a.id = m.accountant_id
     WHERE m.user_id = $1 AND m.accountant_id = $2
     ORDER BY m.created_at ASC LIMIT 200`,
    [scopeId(req), link.rows[0].accountant_id]
  );
  res.json(rows);
}));

app.post('/api/accountant-messages', requireAuth, wrap(async (req, res) => {
  const userId = req.session.userId;
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: 'Message required.' });
  const link = await pool.query(
    `SELECT accountant_id FROM accountant_clients WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [scopeId(req)]
  );
  if (!link.rows[0]) return res.status(404).json({ error: 'No linked accountant.' });
  const { rows } = await pool.query(
    `INSERT INTO accountant_messages (accountant_id, user_id, sender, message)
     VALUES ($1, $2, 'client', $3) RETURNING id, created_at`,
    [link.rows[0].accountant_id, userId, content]
  );
  res.json({ ok: true, id: rows[0].id });
}));

// ── ACCOUNTANT MARKETPLACE ROUTES ────────────────────────────────────────────
const registerAccountantRoutes = require('./accountant-routes');
// computeBooks is a hoisted declaration (defined below) closing over db+pool — pass it so
// the accountant /books view shares the one canonical, entity-scoped basis (F9).
registerAccountantRoutes(app, pool, authLimiter, apiLimiter, stripe, resendClient, computeBooks);

// ── RECEIPT SCANNER ───────────────────────────────────────────────────────────
// Accepts a base64-encoded image or PDF and returns structured expense data.
app.post('/api/ai/scan', requireAuth, async (req, res) => {
  try {
    const { base64, mediaType, isPDF } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: 'base64 and mediaType are required.' });

    // F18 — scan is the expensive Sonnet-vision path; gate it on the tighter scan budget. Fail-closed.
    const gate = await aiCap.checkUserCap(pool, scopeId(req), req.userPlan, 'scan');
    if (!gate.ok) {
      if (gate.failClosed) return res.status(503).json({ error: 'AI temporarily unavailable — please retry.' });
      return res.status(402).json({ error: 'Monthly AI scan limit reached — upgrade for more.', code: 'AI_CAP_REACHED', used: gate.used, cap: gate.cap });
    }

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

    aiCap.recordUser(pool, scopeId(req), 'scan', 1);   // F18 — count the successful scan call

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
app.get('/team-accept.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'team-accept.html'));
});
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accountant-register.html'));
});
// F10: accountant referral funnel. The shared link is /register?ref=CODE. With no
// /register route it fell through to the catch-all (landing.html) and the ref was
// silently dropped. Redirect into the app's existing signup flow, forwarding ?ref=
// (and a valid plan) so doRegister() attaches the referral to /api/auth/register.
// Registered before app.get('*') so it isn't swallowed by the catch-all.
app.get('/register', (req, res) => {
  const params = new URLSearchParams({ signup: '1' });
  const ref = String(req.query.ref || req.query.referralCode || '').slice(0, 50);
  if (ref) params.set('ref', ref);
  const plan = String(req.query.plan || '');
  if (plan === 'pro' || plan === 'business') params.set('plan', plan);
  res.redirect('/app?' + params.toString());
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

// NOTE: The global error handler is registered at the very BOTTOM of this file
// (after all routes + the /api 404 + the * fallback), NOT here. Express routes an
// error only to handlers registered AFTER the throwing route, so placing it here
// would miss the ~940 lines of routes below (they'd leak HTML/stack — F4).

// ── RECURRING SCHEDULER ───────────────────────────────────────────────────────
function nextRunDate(currentDate, frequency) {
  const d = new Date(currentDate);
  if (isNaN(d.getTime())) return null;
  // Normalize so every entry point agrees: case-insensitive, and treat
  // 'Annually'/'Annual' as yearly (the Recurring Bills/Invoices modals send
  // 'Annually', which previously fell through to the monthly default).
  const f = String(frequency || '').trim().toLowerCase();
  if (f === 'weekly')                                    d.setDate(d.getDate() + 7);
  else if (f === 'quarterly')                            d.setMonth(d.getMonth() + 3);
  else if (f === 'yearly' || f === 'annually' || f === 'annual') d.setFullYear(d.getFullYear() + 1);
  else                                                   d.setMonth(d.getMonth() + 1); // monthly / default
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
      // Respect optional end_date: once the schedule has passed it, stop (mirrors recurring bills).
      if (r.end_date && r.next_run > r.end_date) {
        await db.updateById('recurring_invoices', r.id, { status: 'completed' });
        continue;
      }
      await db.insert('invoices', {
        user_id: r.user_id, entity_id: r.entity_id || null,
        client: r.client, amount: r.amount, due_date: r.next_run,
        status: 'pending', notes: `Auto-generated from recurring schedule`,
      });
      const _nextRun = nextRunDate(r.next_run, r.frequency);
      const _patch = { next_run: _nextRun };
      if (r.end_date && _nextRun > r.end_date) _patch.status = 'completed';
      await db.updateById('recurring_invoices', r.id, _patch);
    }

    // Recurring bills
    const { rows: _recBillRows } = await pool.query(
      `SELECT * FROM recurring_bills WHERE (data->>'status') = 'active' AND (data->>'next_run') <= $1`,
      [today]
    );
    const recBills = _recBillRows.map(r => ({ id: r.id, user_id: r.user_id, entity_id: r.entity_id, ...r.data }));
    for (const r of recBills) {
      // Respect optional end_date: once the schedule has passed it, stop.
      if (r.end_date && r.next_run > r.end_date) {
        await db.updateById('recurring_bills', r.id, { status: 'completed' });
        continue;
      }
      const num = 'BILL-' + String(Date.now()).slice(-4);
      await db.insert('bills', {
        user_id: r.user_id, entity_id: r.entity_id || null,
        vendor: r.vendor, num, amount: r.amount, due_date: r.next_run,
        status: 'unpaid', notes: `Auto-generated from recurring schedule`,
      });
      const _nextRun = nextRunDate(r.next_run, r.frequency);
      const _patch = { next_run: _nextRun };
      if (r.end_date && _nextRun > r.end_date) _patch.status = 'completed';
      await db.updateById('recurring_bills', r.id, _patch);
    }

    // Recurring personal transactions (mirrors bills; materialises personal_transactions)
    const { rows: _recPtRows } = await pool.query(
      `SELECT * FROM recurring_personal_transactions WHERE (data->>'status') = 'active' AND (data->>'next_run') <= $1`,
      [today]
    );
    const recPts = _recPtRows.map(r => ({ id: r.id, user_id: r.user_id, ...r.data }));
    for (const r of recPts) {
      if (r.end_date && r.next_run > r.end_date) {
        await db.updateById('recurring_personal_transactions', r.id, { status: 'completed' });
        continue;
      }
      await db.insert('personal_transactions', {
        user_id: r.user_id,
        description: r.description, category: r.category || 'Other',
        amount: r.amount, tx_type: r.tx_type || 'expense', tx_date: r.next_run,
        currency: r.currency || 'USD',   // carry the profile's native currency onto the occurrence
        recurring_profile_id: r.id,   // link back so the KPI math can exclude this occurrence
      });
      const _ptNext = nextRunDate(r.next_run, r.frequency);
      const _ptPatch = { next_run: _ptNext };
      if (r.end_date && _ptNext > r.end_date) _ptPatch.status = 'completed';
      await db.updateById('recurring_personal_transactions', r.id, _ptPatch);
    }

    if (recInvoices.length + recBills.length + recPts.length > 0) {
      console.log(`[Scheduler] Created ${recInvoices.length} invoices, ${recBills.length} bills, ${recPts.length} personal txns`);
    }
  } catch (e) {
    console.error('[Scheduler] Error:', e.message);
  }
}

// ── BANKING TRANSACTIONS ──────────────────────────────────────────────────────
app.get('/api/banking', requireAuth, wrap(async (req, res) => {
  res.json(await db.allByUser('personal_transactions', req.session.userId, r => r.source === 'banking' && (!req.entityId || r.entity_id === req.entityId || r.entity_id == null), (a, b) => new Date(b.tx_date || b.date) - new Date(a.tx_date || a.date)));
}));
app.post('/api/banking', requireAuth, wrap(async (req, res) => {
  const { desc, amount, type, date, cat } = req.body || {};
  if (!desc || amount == null) return res.status(400).json({ error: 'desc and amount required.' });
  // F46: allowlist tx_type. An EXPLICIT unknown value (e.g. a typo, or a credit sent as anything but
  // 'credit') must 400 — not silently fall through to 'debit' and book an inflow as an outflow. A
  // null/omitted type keeps the legacy-compatible 'debit' default below.
  const TX_TYPES = ['credit', 'debit'];
  if (type != null && !TX_TYPES.includes(type)) return res.status(400).json({ error: "tx_type must be 'credit' or 'debit'." });
  const { row } = await db.insert('personal_transactions', {
    user_id: req.session.userId,
    entity_id: req.entityId || null,
    description: desc, amount: parseFloat(amount) || 0,
    // F23: standardize on tx_type/tx_date to match the rest of personal_transactions
    // (legacy rows written as type/date are still read via fallback below and on GET).
    tx_type: type || 'debit', tx_date: date || new Date().toISOString().slice(0, 10),
    category: cat || 'Other', source: 'banking',
  });
  res.status(201).json(row);
}));
app.delete('/api/banking/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('personal_transactions', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.deleteById('personal_transactions', parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── MRR / SAAS ────────────────────────────────────────────────────────────────
app.get('/api/mrr', requireAuth, wrap(async (req, res) => {
  const rows = await db.allByUser('user_settings', req.session.userId, r => r.key === 'mrr_data');
  res.json(rows[0]?.value ? JSON.parse(rows[0].value) : { subscribers: [], plans: [] });
}));
app.put('/api/mrr', requireAuth, wrap(async (req, res) => {
  const { rows: [_mrre] } = await pool.query(
    `SELECT id FROM user_settings WHERE user_id = $1 AND data->>'key' = 'mrr_data' LIMIT 1`,
    [scopeId(req)]
  );
  const data = JSON.stringify(req.body || {});
  if (_mrre) await db.updateById('user_settings', _mrre.id, { value: data });
  else await db.insert('user_settings', { user_id: req.session.userId, key: 'mrr_data', value: data });
  res.json({ ok: true });
}));

// ── PERMISSIONS ───────────────────────────────────────────────────────────────
app.get('/api/permissions', requireAuth, wrap(async (req, res) => {
  const { rows: _permRows } = await pool.query(
    `SELECT * FROM user_settings WHERE user_id = $1 AND data->>'key' = 'permissions' LIMIT 1`,
    [scopeId(req)]
  );
  const _pr0 = _permRows[0] ? rowToObj(_permRows[0]) : null;
  res.json(_pr0?.value ? JSON.parse(_pr0.value) : null);
}));
app.post('/api/permissions', requireAuth, requirePerm('permissions:manage'), wrap(async (req, res) => {
  const data = JSON.stringify(req.body || []);
  const { rows: [_perme] } = await pool.query(
    `SELECT id FROM user_settings WHERE user_id = $1 AND data->>'key' = 'permissions' LIMIT 1`,
    [scopeId(req)]
  );
  if (_perme) await db.updateById('user_settings', _perme.id, { value: data });
  else await db.insert('user_settings', { user_id: req.session.userId, key: 'permissions', value: data });
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
    const matchEnt = r => r.entity_id == null || (eid != null && r.entity_id === eid);
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
    // F31: a thrown query error must NOT be disguised as a legitimate $0 cash flow.
    // A real business with no transactions returns real zeros from the try above;
    // only a genuine failure reaches here — surface it instead of fabricating money.
    console.error('[GET /api/cashflow]', e.message);
    res.status(500).json({ error: 'Could not load cash flow. Please try again.' });
  }
}));

// GET /api/reports — summary stats (revenue, expenses, profit, counts).
app.get('/api/reports', requireAuth, wrap(async (req, res) => {
  try {
    const uid = req.session.userId;
    const eid = req.entityId || null;
    const matchEnt = r => r.entity_id == null || (eid != null && r.entity_id === eid);
    // F33/F25: optional explicit window (?start=YYYY-MM-DD&end=YYYY-MM-DD&elapsedMonths=N),
    // resolved client-side from the fiscal-year setting + selected month so the dashboard and
    // this endpoint reconcile at EVERY period. No params → legacy 'year' (backward compatible:
    // the accountant portal + consolidated P&L call this with no window). Params present →
    // validated strictly — a financial endpoint must never trust an arbitrary client window.
    let bookPeriod = 'year';
    const { start, end, elapsedMonths } = req.query;
    if (start != null || end != null || elapsedMonths != null) {
      const ws = new Date(start), we = new Date(end), em = parseInt(elapsedMonths, 10), DAY = 86400000;
      const okDates = start && end && !isNaN(ws) && !isNaN(we) && we > ws;
      const okRange = okDates && (we - ws) <= 366 * DAY && ws.getFullYear() >= 2000 && we.getFullYear() <= 2100;
      const okElapsed = Number.isInteger(em) && em >= 0 && em <= 12;
      if (!okRange || !okElapsed) return res.status(400).json({ error: 'Invalid period window.' });
      bookPeriod = { start: ws.toISOString(), end: we.toISOString(), elapsedMonths: em };
    }
    // Canonical figures from computeBooks (the single source shared with the dashboard,
    // /books and the report routes) so every surface reconciles. Revenue/expenses/net all
    // include receipts, payments, payroll accrual + FIFO COGS.
    // F34 Path B: optional ?display=CCY converts every leg to that currency at each leg's recognition
    // date (default omitted ⇒ entity-native ⇒ identity). fxCoverage travels with the response.
    const _display = (req.query.display || '').toUpperCase();
    const display = /^[A-Z]{3}$/.test(_display) ? _display : null;
    // F34 B: fiscal-year start month (0-11) for the converted overview-chart buckets. Client sends the
    // resolved #s-fy index; invalid/absent → January (0), matching the client default.
    const _fy = parseInt(req.query.fyStart, 10);
    const fyStartIdx = Number.isInteger(_fy) && _fy >= 0 && _fy <= 11 ? _fy : 0;
    const [books, invoices, expenses] = await Promise.all([
      computeBooks(uid, eid, bookPeriod, display, fyStartIdx),
      db.allByUser('invoices', uid, matchEnt),
      db.allByUser('expenses', uid, matchEnt),
    ]);
    const revenue = books.revenue;
    const outstanding = books.outstanding;
    const overdue = (invoices || []).filter(i => (i.status || '').toLowerCase() === 'overdue').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const totalExp = books.opex;
    const netProfit = books.netProfit;
    const margin = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;
    const totalCOGS = books.cogs;
    const cogsUncoveredItems = books.parts.cogsUncoveredItems;

    // FX gain/loss — realised from settled positions; unrealised COMPUTED at read time for
    // open positions with a current rate (never the dead unrealised_gain_loss column).
    let fxRealised = 0, fxUnrealised = 0;
    try {
      const { rows: fxTxs } = await pool.query(
        `SELECT * FROM fx_transactions WHERE user_id=$1 AND (entity_id IS NULL OR ($2::int IS NOT NULL AND entity_id = $2))`,
        [scopeId(req), eid]
      );
      const rateMap = await latestFxRates(pool, scopeId(req));
      for (const t of fxTxs) {
        if (t.status === 'settled') fxRealised += parseFloat(t.realised_gain_loss) || 0;
        else { const u = computeUnrealised(t, rateMap); if (u != null) fxUnrealised += u; }
      }
      fxRealised = Math.round(fxRealised * 100) / 100;
      fxUnrealised = Math.round(fxUnrealised * 100) / 100;
    } catch (_) {}

    res.json({
      revenue, outstanding, overdue,
      expenses: totalExp,
      netProfit, margin,
      invoiceCount: invoices.length,
      expenseCount: expenses.length,
      cogs: totalCOGS,
      grossProfit: Math.round((revenue - totalCOGS) * 100) / 100,
      cogsMethod: 'fifo',
      cogsUncoveredItems,
      fx_realised: fxRealised,
      fx_unrealised: fxUnrealised,
      // F34 B surface 4: Investments are the personal holdings path (USD-priced) — NOT in computeBooks.
      // Convert them EXPLICITLY via rateAsOf(USD→display, today) [nearest-rate A]. null (no display, or
      // no USD→display rate) ⇒ the client shows "—", never a relabel.
      investRate: display ? await rateAsOf(pool, scopeId(req), 'USD', display, new Date().toISOString().slice(0, 10)) : null,
      fxCoverage: books.fxCoverage,   // F34: null-flag coverage — complete=false ⇒ figures are a partial (converted) P&L
      monthly: books.monthly,         // F34 B: converted overview-chart buckets (client basis; native = identity)
      expenseBreakdown: books.expenseBreakdown,  // F34 B: converted expense-by-category (client updateExpenseBars basis)
      transactions: books.transactions,          // F34 B: converted recent-transactions preview (per-row; null ⇒ "—")
    });
  } catch (e) {
    // F31: surface the failure instead of fabricating $0 KPIs. A real empty period
    // returns real zeros from the try above; only a thrown error reaches here.
    console.error('[GET /api/reports]', e.message);
    res.status(500).json({ error: 'Could not load report data. Please try again.' });
  }
}));

// POST /api/reports/profit-loss — monthly P&L breakdown (entity-scoped).
// Monthly rows show DATED cash activity (paid invoices + receipts + payments received in;
// expenses + payments made out). The TOTALS come from computeBooks so the bottom line is
// canonical — it additionally includes payroll accrual (a monthly rate, surfaced as its own
// line) and FIFO COGS (an aggregate). Sorted by YYYY-MM key, labelled at render (F15).
app.post('/api/reports/profit-loss', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  const matchEnt = r => r.entity_id == null || (eid != null && r.entity_id === eid);
  const [invoices, expenses, paymentsMade, receipts, bills] = await Promise.all([
    db.allByUser('invoices', uid, matchEnt),
    db.allByUser('expenses', uid, matchEnt),
    db.allByUser('payments_made', uid, matchEnt),
    db.allByUser('sales_receipts', uid),      // user-level (no entity_id) — F26
    db.allByUser('bills', uid, matchEnt),     // F38 Step 4: issued bills = accrued expense
    // payments_received dropped: it settles AR, it is not revenue (F32).
  ]);
  const _MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const keyOf = d => { const dt = new Date(d); return isNaN(dt) ? 'Unknown' : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; };
  const labelOf = k => { if (k === 'Unknown') return 'Unknown'; const [y, m] = k.split('-'); return `${_MO[+m - 1]} '${y.slice(-2)}`; };
  const monthMap = {};
  const bump = (d, field, amt) => { const k = keyOf(d); (monthMap[k] || (monthMap[k] = { revenue: 0, expenses: 0 }))[field] += parseFloat(amt) || 0; };
  // Issue-based accrual (F32): recognize every ISSUED invoice at its issue month (created_at),
  // full amount, any recognized status — not just 'paid'. payments_received is not revenue.
  const _REC = new Set(['pending', 'overdue', 'partial', 'paid']);
  invoices.filter(i => _REC.has((i.status || '').toLowerCase())).forEach(i => bump(i.issue_date || i.created_at || i.date, 'revenue', i.amount));   // F36: issue_date, created_at fallback (transition — see computeBooks issueDate)
  receipts.forEach(r => bump(r.date, 'revenue', r.amount));
  expenses.forEach(e => bump(e.expense_date || e.date || e.created_at, 'expenses', e.amount));
  // F38 Step 4: issued bills accrue as expense in their ISSUE month (mirror of the invoice
  // revenue leg above) — RECOGNIZED_BILL allowlist, FULL amount, keyed on issue_date.
  bills.filter(b => RECOGNIZED_BILL.has((b.status || '').toLowerCase())).forEach(b => bump(b.issue_date || b.created_at || b.due_date, 'expenses', b.amount));
  // Only ORPHAN payments (bill_id IS NULL) stay expense; a bill-linked payment is a settlement
  // (Dr AP / Cr Cash), not a fresh expense — would double-count the issued-bill leg. Sole guard.
  paymentsMade.filter(p => p.bill_id == null).forEach(p => bump(p.date || p.created_at, 'expenses', p.amount));
  // Sort by YYYY-MM key ('Unknown' sorts last); format the label at render (F15).
  const rows = Object.keys(monthMap).sort().map(k => ({
    month: labelOf(k), key: k, revenue: monthMap[k].revenue, expenses: monthMap[k].expenses,
    netProfit: monthMap[k].revenue - monthMap[k].expenses,
  }));
  // Canonical totals — the reconciling bottom line (adds payroll accrual + COGS).
  // F34 Path B: ?display=CCY converts the totals (default omitted ⇒ native ⇒ identity). The monthly
  // `rows` above stay native this step — they get server-converted buckets in Step 3.
  const _display = (req.query.display || '').toUpperCase();
  const display = /^[A-Z]{3}$/.test(_display) ? _display : null;
  const books = await computeBooks(uid, eid, 'year', display);
  res.json({
    rows,
    totalRevenue:  books.revenue,
    cogs:          books.cogs,
    grossProfit:   books.grossProfit,
    payroll:       books.parts.payroll,
    totalExpenses: books.opex,
    netProfit:     books.netProfit,
    fxCoverage:    books.fxCoverage,   // F34
  });
}));

// POST /api/reports/balance-sheet — assets vs liabilities snapshot (entity-scoped).
// AR + the cash proxy come from canonical computeBooks so they reconcile with the P&L;
// AP = unpaid bills (entity-scoped). No real cash-account model, so cash is a retained-
// earnings proxy (max(0, netProfit)) — noted, not a tracked balance.
app.post('/api/reports/balance-sheet', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  const matchEnt = r => r.entity_id == null || (eid != null && r.entity_id === eid);
  const [books, bills] = await Promise.all([
    computeBooks(uid, eid, 'year'),
    db.allByUser('bills', uid, matchEnt),
  ]);
  const cash = Math.max(0, books.netProfit);          // proxy: no cash account is tracked
  const ar   = books.outstanding;                     // canonical unpaid AR
  // F38 Step 4 (AP amendment): AP = Σ max(0, amount − amount_paid) over ALL RECOGNIZED_BILL
  // bills — payables now ARITHMETIC-driven, not status-driven. Excluding 'paid' bought nothing
  // (a truly paid bill has amount_paid == amount → contributes 0 anyway) but let a WRONGLY-set
  // 'paid' status hide a real liability (reachable via a direct PUT /api/bills {status:'paid'} —
  // the mark-paid path Step 5 fixes). The max(0, …) floor stops an overpayment (amount_paid >
  // amount) driving AP negative. amount_paid is written by recalcBillStatus (Step 3). Unknown
  // statuses are still excluded, never counted.
  const ap   = (bills || [])
    .filter(b => RECOGNIZED_BILL.has((b.status || '').toLowerCase()))
    .reduce((s, b) => s + Math.max(0, (parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0)), 0);
  const totalAssets      = Math.round((cash + ar) * 100) / 100;
  const totalLiabilities = Math.round(ap * 100) / 100;
  res.json({ cash, accountsReceivable: ar, totalAssets, accountsPayable: totalLiabilities, totalLiabilities, equity: Math.round((totalAssets - totalLiabilities) * 100) / 100 });
}));

// POST /api/reports/cash-flow — monthly inflows vs outflows (entity-scoped, CASH basis).
// Stays a pure cash statement (decision #2): NO COGS, NO payroll accrual — cash in = paid
// invoices + sales receipts + payments received; cash out = expenses + payments made.
// Real table names (sales_receipts / payments_made) — the previous 'receipts'/'payments'
// were non-existent and the .catch(()=>[]) silently returned empty legs; removed so a bad
// table name now throws loudly. Sorted by YYYY-MM key, labelled at render (F15).
app.post('/api/reports/cash-flow', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  const matchEnt = r => r.entity_id == null || (eid != null && r.entity_id === eid);
  const [invoices, expenses, paymentsMade, receipts, paymentsIn] = await Promise.all([
    db.allByUser('invoices', uid, matchEnt),
    db.allByUser('expenses', uid, matchEnt),
    db.allByUser('payments_made', uid, matchEnt),
    db.allByUser('sales_receipts', uid),      // user-level (no entity_id) — F26
    db.allByUser('payments_received', uid),   // user-level (no entity_id) — F26
  ]);
  const _MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const keyOf = d => { const dt = new Date(d); return isNaN(dt) ? 'Unknown' : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; };
  const labelOf = k => { if (k === 'Unknown') return 'Unknown'; const [y, m] = k.split('-'); return `${_MO[+m - 1]} '${y.slice(-2)}`; };
  const monthMap = {};
  const add = (date, field, amount) => { const k = keyOf(date); (monthMap[k] || (monthMap[k] = { inflow: 0, outflow: 0 }))[field] += parseFloat(amount) || 0; };
  invoices.filter(i => (i.status || '').toLowerCase() === 'paid').forEach(i => add(i.created_at || i.due_date || i.date, 'inflow', i.amount));
  receipts.forEach(r => add(r.date, 'inflow', r.amount));
  paymentsIn.forEach(p => add(p.date, 'inflow', p.amount));
  expenses.forEach(e => add(e.expense_date || e.date || e.created_at, 'outflow', e.amount));
  paymentsMade.forEach(p => add(p.date || p.created_at, 'outflow', p.amount));
  const rows = Object.keys(monthMap).sort().map(k => ({
    month: labelOf(k), key: k, inflow: monthMap[k].inflow, outflow: monthMap[k].outflow,
    net: monthMap[k].inflow - monthMap[k].outflow,
  }));
  res.json({
    rows,
    totalInflow:  Math.round(rows.reduce((s, r) => s + r.inflow, 0) * 100) / 100,
    totalOutflow: Math.round(rows.reduce((s, r) => s + r.outflow, 0) * 100) / 100,
  });
}));

// GET /api/tax-filing — quarterly tax estimates from paid invoices and
// deductible expenses. Uses a flat 25% combined federal+self-employment
// estimate as a starting point; users override on the frontend.
app.get('/api/tax-filing', requireAuth, wrap(async (req, res) => {
  try {
    const uid = req.session.userId;
    const eid = req.entityId || null;
    const matchEnt = r => r.entity_id == null || (eid != null && r.entity_id === eid);
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
    // F31: don't disguise a query failure as a $0 tax estimate. Real empty period
    // returns real zeros from the try above; only a thrown error reaches here.
    console.error('[GET /api/tax-filing]', e.message);
    res.status(500).json({ error: 'Could not load tax estimate. Please try again.' });
  }
}));

// GET /api/scenario — placeholder; scenarios live entirely client-side for
// now. Returns the saved scenario blob from user_settings if present, else
// an empty object so the client can default.
app.get('/api/scenario', requireAuth, wrap(async (req, res) => {
  try {
    const { rows: [_scn] } = await pool.query(
      `SELECT * FROM user_settings WHERE user_id = $1 AND data->>'key' = 'scenario' LIMIT 1`,
      [scopeId(req)]
    );
    const row = _scn ? rowToObj(_scn) : null;
    res.json(row?.value ? JSON.parse(row.value) : {});
  } catch (e) {
    console.error('[GET /api/scenario]', e.message);
    res.json({});
  }
}));
app.put('/api/scenario', requireAuth, wrap(async (req, res) => {
  try {
    const data = JSON.stringify(req.body || {});
    const { rows: [_scne] } = await pool.query(
      `SELECT id FROM user_settings WHERE user_id = $1 AND data->>'key' = 'scenario' LIMIT 1`,
      [scopeId(req)]
    );
    if (_scne) await db.updateById('user_settings', _scne.id, { value: data });
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
    const { rows: [_connr] } = await pool.query(
      `SELECT * FROM user_settings WHERE user_id = $1 AND data->>'key' = 'connections' LIMIT 1`,
      [scopeId(req)]
    );
    const row = _connr ? rowToObj(_connr) : null;
    res.json(row?.value ? JSON.parse(row.value) : {});
  } catch (e) {
    console.error('[GET /api/connections]', e.message);
    res.json({});
  }
}));
app.post('/api/connections', requireAuth, requirePerm('bank:manage'), wrap(async (req, res) => {
  try {
    const data = JSON.stringify(req.body || {});
    const { rows: [_conne] } = await pool.query(
      `SELECT id FROM user_settings WHERE user_id = $1 AND data->>'key' = 'connections' LIMIT 1`,
      [scopeId(req)]
    );
    if (_conne) await db.updateById('user_settings', _conne.id, { value: data });
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

app.get('/api/audit-trail', requireAuth, requirePerm('audit:read'), wrap(async (req, res) => {
  const { table, action } = req.query;
  let q = `SELECT * FROM audit_trail WHERE user_id = $1`;
  const params = [scopeId(req)];
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
  const { rows: [_invR] } = await pool.query(
    `SELECT * FROM invoices WHERE id = $1 AND user_id = $2 LIMIT 1`, [invoiceId, userId]
  );
  const invRow = _invR ? rowToObj(_invR) : null;
  if (!invRow) return;
  // F48 #1: SCOPE the sum by user_id. An invoice_payments row injected by another user against
  // this invoice_id must NEVER contribute to this owner's amount_paid (cross-tenant AR corruption).
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS paid FROM invoice_payments WHERE invoice_id = $1 AND user_id = $2`,
    [invoiceId, userId]
  );
  const paid = parseFloat(rows[0].paid) || 0;
  const total = parseFloat(invRow.amount) || 0;
  // F48 #1 (delete-revert): when paid drops to 0 (last payment removed), REVERT a payment-derived
  // status ('partial'/'paid') to the natural unpaid state — NOT the stale current status, which
  // would strand the invoice at 'partial' with amount_paid 0. A manually-set non-payment status is
  // preserved. (Live-reproduced: paid → delete all → stuck 'partial', AR incoherent.)
  let status;
  if (paid >= total) status = 'paid';
  else if (paid > 0) status = 'partial';
  else status = (invRow.status === 'partial' || invRow.status === 'paid') ? 'pending' : invRow.status;
  await db.updateById('invoices', invoiceId, { status, amount_paid: paid });
}

// F38 Step 3 — the payables mirror of recalcInvoiceStatus. Sums the payments_made LINKED to a
// bill (data->>'bill_id') and writes the bill's amount_paid + status. payments_made is a JSONB
// table (amount/bill_id live in `data`), so the sum casts data->>'amount'; the link matches on
// data->>'bill_id' as text. Same status rule as invoices, INCLUDING the revert (F48 #1): when the
// last payment is removed (paid → 0) a payment-derived status reverts to 'unpaid' rather than
// stranding the bill at 'partial'. (AP is arithmetic-driven so the money was already correct, but
// a 'partial' bill with amount_paid 0 is an incoherent status the UI keys on — fixed here too.)
// RECOGNIZED_BILL (below) is the allowlist Step 4's expense leg and the balance-sheet AP key on.
async function recalcBillStatus(pool, billId, userId) {
  const { rows: [_blR] } = await pool.query(
    `SELECT * FROM bills WHERE id = $1 AND user_id = $2 LIMIT 1`, [billId, userId]
  );
  const billRow = _blR ? rowToObj(_blR) : null;
  if (!billRow) return;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM((data->>'amount')::numeric),0) AS paid
       FROM payments_made WHERE user_id = $1 AND data->>'bill_id' = $2`,
    [userId, String(billId)]
  );
  const paid = parseFloat(rows[0].paid) || 0;
  const total = parseFloat(billRow.amount) || 0;
  let status;
  if (paid >= total) status = 'paid';
  else if (paid > 0) status = 'partial';
  else status = (billRow.status === 'partial' || billRow.status === 'paid') ? 'unpaid' : billRow.status;
  await db.updateById('bills', billId, { status, amount_paid: paid });
}

// F38: recognized bill statuses — the payables analog of the invoice RECOGNIZED set. An 'unpaid'
// bill is the analog of a 'pending' invoice: issued and unsettled, so it IS an expense + AP.
// Unknown statuses are excluded (Step 4 flags them), never silently counted.
const RECOGNIZED_BILL = new Set(['unpaid', 'due_soon', 'overdue', 'partial', 'paid']);

app.get('/api/invoice-payments', requireAuth, wrap(async (req, res) => {
  const { invoice_id } = req.query;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });
  const { rows } = await pool.query(
    `SELECT * FROM invoice_payments WHERE invoice_id = $1 AND user_id = $2 ORDER BY payment_date DESC`,
    [parseInt(invoice_id), scopeId(req)]
  );
  res.json(rows);
}));

app.post('/api/invoice-payments', requireAuth, wrap(async (req, res) => {
  const { invoice_id, amount, payment_date, method, reference, notes } = req.body || {};
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id and amount required' });
  // F48 #3: validate amount server-side — `!amount` let -500 / NaN through, inflating AR.
  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A valid positive amount is required.' });
  // F48 #2: the invoice MUST belong to the caller. Without this, a payment injected against a
  // foreign/nonexistent invoice_id is accepted (was 201) and corrupts that owner's AR.
  const inv = await ownedBy('invoices', invoice_id, req.session.userId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  // Overpayment: no credit/refund model exists, so reject a payment beyond the remaining balance
  // rather than book cash the system can't represent. (Epsilon guards float rounding.)
  const remaining = (parseFloat(inv.amount) || 0) - (parseFloat(inv.amount_paid) || 0);
  if (amt > remaining + 0.005) return res.status(400).json({ error: `Payment exceeds the remaining balance of ${remaining.toFixed(2)}.` });
  const { rows } = await pool.query(
    `INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date, method, reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.session.userId, req.entityId || null, parseInt(invoice_id), amt,
     payment_date || new Date().toISOString().slice(0, 10), method || 'Bank Transfer', reference || null, notes || null]
  );
  await recalcInvoiceStatus(pool, parseInt(invoice_id), req.session.userId);
  await auditLog(pool, { userId: req.session.userId, entityId: req.entityId, table: 'invoice_payments', recordId: rows[0].id, action: 'CREATE', req });
  res.status(201).json(rows[0]);
}));

app.delete('/api/invoice-payments/:id', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM invoice_payments WHERE id=$1 AND user_id=$2 RETURNING *`,
    [parseInt(req.params.id), scopeId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  await recalcInvoiceStatus(pool, rows[0].invoice_id, req.session.userId);
  res.json({ ok: true });
}));

app.get('/api/bank-reconciliation', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const matchedBankIds = await pool.query(`SELECT banking_id FROM bank_reconciliation WHERE user_id=$1`, [scopeId(req)]);
  const matchedPayIds  = await pool.query(`SELECT invoice_payment_id FROM bank_reconciliation WHERE user_id=$1`, [scopeId(req)]);
  const matchedBankSet = new Set(matchedBankIds.rows.map(r => r.banking_id));
  const matchedPaySet  = new Set(matchedPayIds.rows.map(r => r.invoice_payment_id));

  const banking = await db.allByUser('personal_transactions', uid, r => r.source === 'banking');
  const unmatchedBanking = banking.filter(r => !matchedBankSet.has(r.id));

  const { rows: payments } = await pool.query(
    `SELECT ip.*, i.data->>'client' AS client FROM invoice_payments ip
     LEFT JOIN invoices i ON i.id = ip.invoice_id
     WHERE ip.user_id = $1 ORDER BY ip.payment_date DESC`,
    [scopeId(req)]
  );
  const unmatchedPayments = payments.filter(r => !matchedPaySet.has(r.id));

  const { rows: matched } = await pool.query(
    `SELECT br.*, ip.amount AS pay_amount, ip.payment_date, ip.method,
            pt.data->>'description' AS bank_desc, pt.data->>'amount' AS bank_amount
     FROM bank_reconciliation br
     JOIN invoice_payments ip ON ip.id = br.invoice_payment_id
     JOIN personal_transactions pt ON pt.id = br.banking_id
     WHERE br.user_id = $1 ORDER BY br.matched_at DESC`,
    [scopeId(req)]
  );
  res.json({ unmatchedBanking, unmatchedPayments, matched });
}));

app.post('/api/bank-reconciliation/match', requireAuth, wrap(async (req, res) => {
  const { banking_id, invoice_payment_id } = req.body || {};
  if (!banking_id || !invoice_payment_id) return res.status(400).json({ error: 'banking_id and invoice_payment_id required' });
  const bankRow = await pool.query('SELECT id FROM personal_transactions WHERE id=$1 AND user_id=$2', [banking_id, scopeId(req)]);
  const payRow = await pool.query('SELECT id FROM invoice_payments WHERE id=$1 AND user_id=$2', [invoice_payment_id, scopeId(req)]);
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
    [parseInt(req.params.id), scopeId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — PAYROLL (user-defined deductions; FinFlow performs NO tax calculation)
// ════════════════════════════════════════════════════════════════════════════════
// FinFlow knows nothing about any country's tax rules. Each payroll record carries
// an array of user-defined deduction rows { label, value, type:'percent'|'fixed' }:
//   percent → amount = gross × value/100 ;  fixed → amount = value (record currency).
// net = gross − Σ(amounts). Estimates only, based on what the user entered.
function computeDeductions(gross, deductions) {
  const g = parseFloat(gross) || 0;
  const rows = Array.isArray(deductions) ? deductions : [];
  let total = 0;
  const computed = rows
    .filter(d => d && (d.label != null || d.value != null))
    .map(d => {
      const value = parseFloat(d.value) || 0;
      const type = d.type === 'percent' ? 'percent' : 'fixed';
      const amount = Math.round((type === 'percent' ? g * value / 100 : value) * 100) / 100;
      total += amount;
      return { label: String(d.label || '').slice(0, 60), value, type, amount };
    });
  return { rows: computed, total: Math.round(total * 100) / 100 };
}

app.get('/api/payroll-runs', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pr.*, json_agg(prl ORDER BY prl.id) AS lines
     FROM payroll_runs pr
     LEFT JOIN payroll_run_lines prl ON prl.run_id = pr.id
     WHERE pr.user_id = $1 AND (pr.entity_id IS NULL OR ($2::int IS NOT NULL AND pr.entity_id = $2))
     GROUP BY pr.id ORDER BY pr.created_at DESC LIMIT 50`,
    [scopeId(req), req.entityId || null]
  );
  res.json(rows);
}));

app.post('/api/payroll-runs', requireAuth, requirePerm('payroll:write'), wrap(async (req, res) => {
  const { period, bonus_overrides = {}, overtime_overrides = {}, notes = '' } = req.body || {};
  if (!period) return res.status(400).json({ error: 'period required' });
  const uid = req.session.userId;
  const eid = req.entityId || null;

  const employees = await db.allByUser('payroll', uid, r => r.entity_id == null || (eid != null && r.entity_id === eid));
  if (!employees.length) return res.status(400).json({ error: 'No employees found for this entity.' });

  // Net is pure arithmetic on the deduction rows the user defined on each record.
  // No tax calculation — percent rows apply to the period gross (gross+bonus+overtime).
  const lines = employees.map(emp => {
    const gross = parseFloat(emp.gross) || 0;
    const bonus = parseFloat(bonus_overrides[emp.id]) || 0;
    const overtime = parseFloat(overtime_overrides[emp.id]) || 0;
    const totalGross = Math.round((gross + bonus + overtime) * 100) / 100;
    const { rows: dedRows, total } = computeDeductions(totalGross, emp.deductions);
    const netPay = Math.round((totalGross - total) * 100) / 100;
    return { payroll_id: emp.id, employee_name: `${emp.fname} ${emp.lname}`.trim(), gross, bonus, overtime, totalGross, deductions: dedRows, totalDeductions: total, netPay };
  });

  const totalGross = lines.reduce((s, l) => s + l.totalGross, 0);
  const totalDeductions = lines.reduce((s, l) => s + l.totalDeductions, 0);
  const totalNet = lines.reduce((s, l) => s + l.netPay, 0);

  const { rows: [run] } = await pool.query(
    `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net, notes)
     VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8) RETURNING *`,
    [uid, eid, period, 'draft', totalGross, totalDeductions, totalNet, notes]
  );

  for (const l of lines) {
    await pool.query(
      `INSERT INTO payroll_run_lines (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [run.id, l.payroll_id, l.employee_name, l.gross, l.bonus, l.overtime, JSON.stringify(l.deductions), l.netPay]
    );
  }

  const { rows: fullLines } = await pool.query(`SELECT * FROM payroll_run_lines WHERE run_id = $1`, [run.id]);
  await auditLog(pool, { userId: uid, entityId: eid, table: 'payroll_runs', recordId: run.id, action: 'CREATE', req });
  res.status(201).json({ ...run, lines: fullLines });
}));

app.get('/api/payroll-runs/:id', requireAuth, wrap(async (req, res) => {
  const { rows: [run] } = await pool.query(
    `SELECT * FROM payroll_runs WHERE id=$1 AND user_id=$2`, [parseInt(req.params.id), scopeId(req)]
  );
  if (!run) return res.status(404).json({ error: 'Not found.' });
  const { rows: lines } = await pool.query(`SELECT * FROM payroll_run_lines WHERE run_id=$1`, [run.id]);
  res.json({ ...run, lines });
}));

app.put('/api/payroll-runs/:id/approve', requireAuth, requirePerm('payroll:write'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE payroll_runs SET status='approved' WHERE id=$1 AND user_id=$2 RETURNING *`,
    [parseInt(req.params.id), scopeId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  res.json(rows[0]);
}));

app.put('/api/payroll-runs/:id/mark-paid', requireAuth, requirePerm('payroll:write'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE payroll_runs SET status='paid' WHERE id=$1 AND user_id=$2 RETURNING *`,
    [parseInt(req.params.id), scopeId(req)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
  res.json(rows[0]);
}));

// (Removed: GET /api/payroll/preview + the multi-jurisdiction tax engine — FinFlow
// no longer calculates tax. Net is derived from user-defined deduction rows only.)

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — INVENTORY COGS (FIFO)
// ════════════════════════════════════════════════════════════════════════════════
// FIFO is the single costing method across FinFlow (point-of-sale + every aggregate).
// fifoConsume walks purchase layers oldest-first: skip `skipUnits` already consumed by
// prior sales, then cost `sellUnits`. `uncovered` = units sold with no purchase layer to
// draw from → NO COST BASIS (never silently costed at $0; surfaced so gross profit isn't
// quietly overstated).
function fifoConsume(purchases, skipUnits, sellUnits) {
  let skip = Math.max(0, skipUnits), toSell = Math.max(0, sellUnits), cogs = 0;
  for (const b of purchases) {
    let avail = parseFloat(b.quantity) || 0;
    if (skip > 0) { const s = Math.min(skip, avail); skip -= s; avail -= s; }
    if (avail <= 0 || toSell <= 0) continue;
    const used = Math.min(avail, toSell);
    cogs += used * (parseFloat(b.unit_cost) || 0);
    toSell -= used;
    if (toSell <= 0) break;
  }
  return { cogs: Math.round(cogs * 100) / 100, uncovered: Math.round(Math.max(0, toSell) * 100) / 100 };
}

async function _purchaseLayers(pool, inventoryId) {
  const { rows } = await pool.query(
    `SELECT quantity, unit_cost FROM inventory_movements WHERE inventory_id=$1 AND type='purchase' ORDER BY moved_at ASC`,
    [inventoryId]
  );
  return rows;
}

// Point-of-sale FIFO: cost the NEW quantity, skipping layers consumed by prior sales.
async function calculateFIFOCOGS(pool, inventoryId, quantitySold) {
  const purchases = await _purchaseLayers(pool, inventoryId);
  const { rows: [{ sold }] } = await pool.query(
    `SELECT COALESCE(SUM(quantity),0) AS sold FROM inventory_movements WHERE inventory_id=$1 AND type='sale'`,
    [inventoryId]
  );
  return fifoConsume(purchases, parseFloat(sold), quantitySold).cogs;
}

// Aggregate FIFO for reports/dashboards: total COGS of ALL units ever sold for one item,
// plus how many of those units have no cost basis. Recomputed from raw movements (does not
// trust any stored per-sale unit_cost), so it reconciles by construction with the sum of
// the point-of-sale FIFO figures the user saw at each sale.
async function fifoItemTotal(pool, inventoryId) {
  const purchases = await _purchaseLayers(pool, inventoryId);
  const { rows: [{ sold }] } = await pool.query(
    `SELECT COALESCE(SUM(quantity),0) AS sold FROM inventory_movements WHERE inventory_id=$1 AND type='sale'`,
    [inventoryId]
  );
  const unitsSold = parseFloat(sold) || 0;
  const { cogs, uncovered } = fifoConsume(purchases, 0, unitsSold);
  return { cogs, unitsSold, uncovered };
}

// F34 Step 1b — per-SALE FIFO COGS with the sale's movement date, so each sale can convert at its
// own historical rate. Walks sales in date order, costing each against the FIFO layers consumed by
// all prior sales. Σ of the per-sale cogs equals fifoItemTotal's aggregate (FIFO is associative over
// consecutive slices), so the native (unconverted) total reconciles by construction.
async function fifoItemSales(pool, inventoryId) {
  const purchases = await _purchaseLayers(pool, inventoryId);
  const { rows: sales } = await pool.query(
    `SELECT quantity, moved_at FROM inventory_movements WHERE inventory_id=$1 AND type='sale' ORDER BY moved_at ASC, id ASC`,
    [inventoryId]
  );
  const out = []; let consumed = 0;
  for (const s of sales) {
    const q = parseFloat(s.quantity) || 0;
    const { cogs, uncovered } = fifoConsume(purchases, consumed, q);
    out.push({ date: s.moved_at, cogs, uncovered });
    consumed += q;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════
// CANONICAL BOOKS — single entity-scoped source of truth for revenue / COGS / OpEx /
// profit. Mirrors the frontend canonical helpers exactly (computeRevenue R1 +
// computeExpenseBreakdown E1, "year/default" basis) so the dashboard, the report
// routes, and the accountant /books view all reconcile to the same numbers.
//
//   Revenue     = paid invoices + sales receipts + payments received
//   OpEx        = expenses + issued bills (RECOGNIZED_BILL, full amount, by issue_date — F38
//                 Step 4) + orphan payments made (bill_id IS NULL; linked ones settle AP) +
//                 payroll (monthly gross × elapsed months)
//   COGS        = FIFO (fifoItemTotal, from F6)
//   GrossProfit = Revenue − COGS
//   NetProfit   = Revenue − COGS − OpEx
//
// NOTE (F25): "year" here = all-time revenue/expenses + YTD-accrued payroll, mirroring
//   the frontend canonical faithfully — NOT a true fiscal-year window (tracked as F25).
// NOTE (F26): sales_receipts / payments_received have no entity_id, so they are always
//   user-level; for multi-entity users they attribute to whichever entity is viewed
//   (tracked as F26). Every other source is entity-scoped.
async function computeBooks(userId, entityId = null, period = 'year', display = null, fyStartIdx = 0) {
  const r2 = n => Math.round((n || 0) * 100) / 100;
  const num = v => parseFloat(v) || 0;
  const sum = (arr, f) => (arr || []).reduce((s, x) => s + f(x), 0);
  // entityId null → all entities (accountant "all" view); set → that entity + unassigned rows.
  const ent = r => entityId == null || r.entity_id == null || r.entity_id === entityId;
  // F33/F25: an explicit window { start, end, elapsedMonths } (resolved client-side from the
  // fiscal-year setting + selected month) overrides the legacy string period. A string period
  // keeps EXACTLY the prior behavior — the accountant portal / consolidated P&L call
  // computeBooks('year'|'month'|'quarter') and must not change (backward compatible).
  let winMode = false, winInc = null, winElapsed = 0, winStart = null;
  if (period && typeof period === 'object' && period.start && period.end) {
    const ws = new Date(period.start), we = new Date(period.end);
    if (!isNaN(ws) && !isNaN(we) && we > ws) {
      winMode = true;
      winInc = v => { const d = v ? new Date(v) : null; return !!d && !isNaN(d) && d >= ws && d < we; };
      winElapsed = Math.max(0, Math.min(12, parseInt(period.elapsedMonths, 10) || 0));
      winStart = ws;   // F34 Step 1b: window start → per-month payroll dating
    }
  }
  period = winMode ? 'window' : ((period === 'month' || period === 'quarter') ? period : 'year'); // 'all' → 'year'

  const [invoices, expenses, paymentsMade, payroll, receipts, bills] = await Promise.all([
    db.allByUser('invoices', userId, ent),
    db.allByUser('expenses', userId, ent),
    db.allByUser('payments_made', userId, ent),
    db.allByUser('payroll', userId, ent),
    db.allByUser('sales_receipts', userId),      // user-scoped (no entity_id) — F26
    db.allByUser('bills', userId, ent),          // F38 Step 4: issued bills = accrued expense
    // payments_received is NO LONGER a revenue leg (F32): it settles AR, it is not revenue.
  ]);

  // ── F34 Path B (Step 1a) — historical FX conversion layer ──────────────────────────────────
  // Every P&L leg converts entity.currency → display at ITS OWN recognition date (≡ the accrual
  // date used above), sourced from fx_rates via pickRate (carry-forward, missing→null). Default
  // display = the viewed entity's native currency ⇒ from===to ⇒ rate 1 ⇒ IDENTITY (byte-for-byte
  // today's numbers). Conversion only engages when a single entity is viewed AND an explicit
  // display ≠ native is requested. entityId==null (accountant "all") stays native this step — the
  // per-row multi-entity currency mapping is deferred to Step 4 (F24). A leg with any row that has
  // no rate is flagged in fxCoverage and EXCLUDED (never summed native into a converted total).
  const _entRows = await db.allByUser('entities', userId);
  const entCur = {}; for (const e of _entRows) entCur[e.id] = (e.currency || 'USD');
  const viewedCur = (entityId != null ? entCur[entityId] : null) || 'USD';
  const _disp = (typeof display === 'string' && /^[A-Z]{3}$/.test(display)) ? display : null;
  const canConvert = entityId != null;                 // single-entity only this step
  const displayCur = (canConvert && _disp && _disp !== viewedCur) ? _disp : null; // null ⇒ native identity path
  const fxCoverage = { display: displayCur || viewedCur, complete: true, unconvertible: [], convertedRows: 0, totalRows: 0 };
  let _fxRows = [];
  if (displayCur) { _fxRows = (await pool.query(`SELECT from_currency, to_currency, rate, rate_date FROM fx_rates WHERE user_id=$1`, [userId])).rows; }
  // sumFX: period-filtered rows already passed in. Native path (displayCur null) = plain Σ (identity,
  // no coverage tracking). Converting path: per-row rate at dateFn(row); null → flag + exclude.
  const sumFX = (rows, amountFn, dateFn, leg) => {
    let total = 0;
    for (const r of (rows || [])) {
      const amt = num(amountFn(r));
      if (!displayCur) { total += amt; continue; }     // native identity
      if (amt === 0) continue;                          // zero rows don't affect coverage
      fxCoverage.totalRows++;
      const from = entCur[r.entity_id] != null ? entCur[r.entity_id] : viewedCur; // user-scoped rows → viewed entity
      const rate = (from === displayCur) ? 1 : pickRate(_fxRows, from, displayCur, dateFn(r));
      if (rate == null) { fxCoverage.complete = false; fxCoverage.unconvertible.push({ leg, id: r.id != null ? r.id : null, date: dateFn(r) || null, from, to: displayCur }); continue; }
      total += amt * rate; fxCoverage.convertedRows++;
    }
    return total;
  };
  // F34 Step 1b — accrual legs with no clean per-row date. Payroll (rate×time) converts each
  // elapsed month at that month's first-day rate; COGS (FIFO) converts each sale at its movement
  // date. Same rule as sumFX: a null rate flags + excludes, never native-sums into a converted total.
  const _fxAccrual = (amount, date, leg, from) => {   // returns converted amount, or 0 (flagged) if no rate
    if (!displayCur) return amount;
    if (num(amount) === 0) return 0;
    fxCoverage.totalRows++;
    const rate = (from === displayCur) ? 1 : pickRate(_fxRows, from, displayCur, date);
    if (rate == null) { fxCoverage.complete = false; fxCoverage.unconvertible.push({ leg, id: null, date: date ? String(date).slice(0, 10) : null, from, to: displayCur }); return 0; }
    fxCoverage.convertedRows++;
    return amount * rate;
  };

  // Period windows mirror the frontend R1/E1 branches EXACTLY (incl. their date-field
  // precedence), so server and client agree at every period. 'year' = all records (F25).
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth(), q = Math.floor(mo / 3) * 3;
  const _d = v => { const d = v ? new Date(v) : null; return (d && !isNaN(d)) ? d : null; };
  const inMonth   = d => !!d && d.getMonth() === mo && d.getFullYear() === y;
  const inQuarter = d => !!d && d.getFullYear() === y && d.getMonth() >= q && d.getMonth() < q + 3;

  // ── Revenue — ISSUE-BASED ACCRUAL (F32). Recognize every ISSUED invoice at its FULL
  // amount, in the period of its ISSUE date (created_at — NOT due_date), plus cash sales
  // receipts. Settlements (invoice_payments / legacy payments_received) draw down AR and
  // are NEVER revenue, so payments_received is no longer a revenue leg. Statuses outside
  // the recognized allowlist are FLAGGED (surfaced as unrecognizedStatusCount), never
  // silently counted or dropped. Mirrors frontend computeRevenue.
  const RECOGNIZED = new Set(['pending', 'overdue', 'partial', 'paid']);
  let unrecognizedStatusCount = 0;
  const issuedInv = invoices.filter(i => {
    if (RECOGNIZED.has((i.status || '').toLowerCase())) return true;
    unrecognizedStatusCount++; return false;
  });
  // F36: recognize on the editable business issue_date; fall back to created_at for rows that
  // predate the field. ⚠️ TRANSITION FALLBACK — TIME-BOXED, NOT CORRECT-FOREVER: created_at is
  // a UTC insert timestamp. This account sits at a NEGATIVE UTC offset (todayLocal 2026-07-19
  // vs UTC 2026-07-20), so a legacy row created in the first hours of UTC on the 1st of a month
  // belongs to the PRIOR month locally, and keying off created_at misassigns its period. Today's
  // invoices are mid-month (Jul 2–3, 02:34Z/21:46Z/21:25Z) so none is misassigned — but once
  // every live row carries issue_date this fallback should be retired, not trusted indefinitely.
  const issueDate = i => _d(i.issue_date || i.created_at || i.date);   // issue date, NOT due_date (F32/F36)
  // F34: recognition dates per leg = the same fields the period filters key on (conversion date ≡
  // recognition date). invoices: issue_date||created_at||date; receipts: date.
  const _invDate  = i => i.issue_date || i.created_at || i.date;
  const _rcptDate = x => x.date;
  let issuedInvoices, salesReceipts;
  if (winMode) {
    issuedInvoices = sumFX(issuedInv.filter(i => winInc(i.issue_date || i.created_at || i.date)), i => i.amount, _invDate, 'invoices');
    salesReceipts  = sumFX(receipts.filter(x => winInc(x.date)), x => x.amount, _rcptDate, 'sales_receipts');
  } else if (period === 'month') {
    issuedInvoices = sumFX(issuedInv.filter(i => inMonth(issueDate(i))), i => i.amount, _invDate, 'invoices');
    salesReceipts  = sumFX(receipts.filter(x => inMonth(_d(x.date))), x => x.amount, _rcptDate, 'sales_receipts');
  } else if (period === 'quarter') {
    issuedInvoices = sumFX(issuedInv.filter(i => inQuarter(issueDate(i))), i => i.amount, _invDate, 'invoices');
    salesReceipts  = sumFX(receipts.filter(x => inQuarter(_d(x.date))), x => x.amount, _rcptDate, 'sales_receipts');
  } else { // year — all records (F25)
    issuedInvoices = sumFX(issuedInv, i => i.amount, _invDate, 'invoices');
    salesReceipts  = sumFX(receipts, x => x.amount, _rcptDate, 'sales_receipts');
  }
  const revenue = r2(issuedInvoices + salesReceipts);

  // ── OpEx (mirrors frontend computeExpenseBreakdown / E1) ──
  const inPeriod = v => {
    if (winMode) return winInc(v);
    if (period === 'year') return true;
    const d = _d(v); if (!d) return false;
    return period === 'month' ? inMonth(d) : inQuarter(d);
  };
  const _expDate = e => e.expense_date || e.date || e.created_at;
  const expensesTotal     = sumFX(expenses.filter(e => inPeriod(_expDate(e))), e => e.amount, _expDate, 'expenses');
  // F38 Step 4 — EXPENSE-side accrual, the mirror of the F32 revenue accrual. An ISSUED bill is
  // an expense when ISSUED (Dr Expense / Cr AP), at FULL amount, keyed on its issue_date
  // (created_at fallback — the same time-boxed transition as the invoice issueDate above).
  // RECOGNIZED_BILL is the status allowlist; unknown statuses are excluded, never counted
  // (mirrors the revenue RECOGNIZED allowlist). issue_date so server == client at every period.
  const _billDate = b => b.issue_date || b.created_at || b.due_date;
  const issuedBillsTotal  = sumFX((bills || []).filter(b =>
    RECOGNIZED_BILL.has((b.status || '').toLowerCase()) && inPeriod(_billDate(b))
  ), b => b.amount, _billDate, 'bills');
  // payments_made: a payment LINKED to a bill (bill_id set) is a SETTLEMENT (Dr AP / Cr Cash),
  // NEVER a fresh expense — counting it would double-count against the issued-bill leg above.
  // ONLY orphan payments (bill_id IS NULL) — a direct disbursement with no bill — stay expense.
  // This bill_id-IS-NULL predicate is the SOLE double-count guard.
  const _pmDate = p => p.date || p.created_at;
  const paymentsMadeTotal = sumFX(paymentsMade.filter(p =>
    p.bill_id == null && inPeriod(_pmDate(p))
  ), p => p.amount, _pmDate, 'payments_made');
  const months = winMode ? winElapsed
    : period === 'month' ? 1 : period === 'quarter' ? (mo - q + 1) : (mo + 1); // elapsed months in period
  const monthlyPayroll = sum(payroll, p => num(p.gross));
  // Payroll (rate×time accrual, no per-row date). Native ⇒ monthlyPayroll × elapsed months (exactly
  // as before). Converting ⇒ convert EACH elapsed month's slice at that month's first-day rate (F34
  // Step 1b), so a rate that moved mid-period is honoured per month; a month with no rate flags +
  // excludes that slice. The month first-days match the `months` count for every period branch.
  const _payrollMonthDates = () => {
    const out = [];
    if (winMode) { const s = winStart ? new Date(winStart) : null; if (s && !isNaN(s)) for (let k = 0; k < winElapsed; k++) out.push(new Date(s.getFullYear(), s.getMonth() + k, 1)); }
    else if (period === 'month')   out.push(new Date(y, mo, 1));
    else if (period === 'quarter') { for (let m = q; m <= mo; m++) out.push(new Date(y, m, 1)); }
    else { for (let m = 0; m <= mo; m++) out.push(new Date(y, m, 1)); } // year
    return out;
  };
  let payrollTotal;
  if (!displayCur) {
    payrollTotal = r2(monthlyPayroll * months);
  } else {
    let conv = 0;
    for (const md of _payrollMonthDates()) conv += _fxAccrual(monthlyPayroll, md, 'payroll', viewedCur);
    payrollTotal = r2(conv);
  }
  const opex = r2(expensesTotal + issuedBillsTotal + paymentsMadeTotal + payrollTotal);

  // ── COGS (FIFO, F6) for items sold in this entity ──
  // COGS and outstanding (AR) are all-time snapshots, NOT period-scoped — matching the
  // client dashboard, which subtracts the all-time FIFO total and shows all unpaid AR at
  // every period. (Period-scoped COGS is a future refinement, tied to F25.)
  let cogs = 0, cogsUncoveredItems = 0;
  try {
    const { rows: items } = await pool.query(
      `SELECT DISTINCT im.inventory_id FROM inventory_movements im
       WHERE im.user_id = $1 AND im.type = 'sale'
         AND ($2::int IS NULL OR im.entity_id IS NULL OR im.entity_id = $2)`,
      [userId, entityId]
    );
    for (const it of items) {
      if (!displayCur) {
        const f = await fifoItemTotal(pool, it.inventory_id);
        cogs += f.cogs;
        if (f.uncovered > 0) cogsUncoveredItems++;
      } else {
        // F34 Step 1b: convert each SALE's FIFO cost at its movement date (per-sale dating). The
        // per-sale slices sum to the same aggregate fifoItemTotal returns (FIFO is associative over
        // consecutive slices), so native reconciles by construction; a sale with no rate flags+excludes.
        const sales = await fifoItemSales(pool, it.inventory_id);
        let itemUncovered = 0;
        for (const s of sales) { cogs += _fxAccrual(s.cogs, s.date, 'cogs', viewedCur); if (s.uncovered > 0) itemUncovered = 1; }
        cogsUncoveredItems += itemUncovered;
      }
    }
    cogs = r2(cogs);
  } catch (_) { cogs = 0; cogsUncoveredItems = 0; }

  // AR = Σ(amount − amount_paid) over recognized, non-paid invoices. amount_paid is written
  // ONLY by Store B (invoice_payments/recalcInvoiceStatus), which is UI-unreachable until
  // F35 lands — so today it is null everywhere and this equals Σ(amount). Coded correct;
  // the partial-AR draw-down becomes active with F35.
  // F48 follow-up — AR is now fully arithmetic, the exact mirror of AP (Step 4): Σ max(0, amount −
  // amount_paid) over ALL recognized invoices, with NO status filter. A truly-paid invoice has
  // amount_paid == amount → contributes 0 on its own, so the status!=='paid' filter is redundant and
  // was masking a real bug: an invoice marked 'paid' with amount_paid 0 (the old bare-status-flip
  // markInvoicePaid) was silently dropped from AR by the filter rather than by the money. That flip
  // now writes a settling invoice_payment (amount_paid = amount), and existing status-only-'paid'
  // rows are backfilled at boot (database.js), so this equals the filtered result on correct data —
  // but is now driven by amount_paid, not a status flag. The max(0, …) floor keeps an over-credited
  // invoice from ever subtracting from receivables.
  // AR converts at each invoice's issue date (same recognition date as the revenue leg).
  const outstanding = r2(sumFX(
    issuedInv,
    i => Math.max(0, num(i.amount) - num(i.amount_paid)),
    _invDate, 'ar'
  ));
  const grossProfit = r2(revenue - cogs);
  const netProfit   = r2(revenue - cogs - opex);

  // ── F34 B (surface 1) — CONVERTED monthly buckets for the overview chart ────────────────────
  // Mirrors the client buildMonthlyArrays basis EXACTLY (so native = identity byte-for-byte and the
  // period sum reconciles): revenue = recognized invoices@issue_date + receipts@date; expense =
  // expenses@expense_date + issued bills@issue_date + orphan payments@date. NO payroll/COGS (the
  // chart never included them). 12 fiscal months from fyStartIdx of the current fiscal year, all rows
  // (not period-filtered — the chart shows the whole FY). Converted per-row at each row's own date via
  // pickRate; a row with no rate is EXCLUDED from its bucket (never native-summed) and flags
  // monthly.complete=false — honest, never a fabricated 0.
  const _fy0 = Number.isInteger(fyStartIdx) && fyStartIdx >= 0 && fyStartIdx <= 11 ? fyStartIdx : 0;
  const _fyY = (now.getMonth() >= _fy0) ? now.getFullYear() : now.getFullYear() - 1;
  const _fyMonths = [];
  for (let i = 0; i < 12; i++) { const d = new Date(_fyY, _fy0 + i, 1); _fyMonths.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleString('en-US', { month: 'short' }) }); }
  const revByMonth = new Array(12).fill(0), expByMonth = new Array(12).fill(0);
  let monthlyComplete = true;
  const _bIdx = v => { const d = _d(v); if (!d) return -1; return _fyMonths.findIndex(x => x.y === d.getFullYear() && x.m === d.getMonth()); };
  const _fromOf = row => (entCur[row.entity_id] != null ? entCur[row.entity_id] : viewedCur);
  const addBucket = (arr, amount, date, from) => {
    const idx = _bIdx(date); if (idx < 0) return;
    const a = num(amount);
    if (!displayCur) { arr[idx] += a; return; }        // native identity
    if (a === 0) return;
    const rate = (from === displayCur) ? 1 : pickRate(_fxRows, from, displayCur, date);
    if (rate == null) { monthlyComplete = false; return; }   // no rate → exclude + flag (never fake 0)
    arr[idx] += a * rate;
  };
  issuedInv.forEach(i => addBucket(revByMonth, i.amount, _invDate(i), _fromOf(i)));
  receipts.forEach(x => addBucket(revByMonth, x.amount, _rcptDate(x), _fromOf(x)));
  expenses.forEach(e => addBucket(expByMonth, e.amount, _expDate(e), _fromOf(e)));
  (bills || []).filter(b => RECOGNIZED_BILL.has((b.status || '').toLowerCase())).forEach(b => addBucket(expByMonth, b.amount, _billDate(b), _fromOf(b)));
  paymentsMade.filter(p => p.bill_id == null).forEach(p => addBucket(expByMonth, p.amount, _pmDate(p), _fromOf(p)));
  const monthly = { labels: _fyMonths.map(x => x.label), revByMonth: revByMonth.map(r2), expByMonth: expByMonth.map(r2), complete: monthlyComplete };

  // ── F34 B (surface 2) — CONVERTED expense breakdown by category ──────────────────────────────
  // Mirrors the client updateExpenseBars basis: the raw expense ROWS binned by category (NOT bills/
  // payroll/COGS), all-time (as the client passes _realExpenses). Each row converts at its own
  // expense_date rate; a row with no rate is excluded and flags complete=false. native ⇒ identity.
  // Σ(breakdown) reconciles with the converted expenses LEG (parts.expenses, all-time == the sum of
  // these same rows), not the period-scoped opex KPI (which also carries bills/payroll/COGS).
  const _catTotals = {}; let breakdownComplete = true;
  for (const e of expenses) {
    const cat = e.category || 'Other';
    const a = num(e.amount);
    if (!displayCur) { _catTotals[cat] = (_catTotals[cat] || 0) + a; continue; }
    if (a === 0) { if (!(cat in _catTotals)) _catTotals[cat] = 0; continue; }
    const from = _fromOf(e);
    const rate = (from === displayCur) ? 1 : pickRate(_fxRows, from, displayCur, _expDate(e));
    if (rate == null) { breakdownComplete = false; continue; }
    _catTotals[cat] = (_catTotals[cat] || 0) + a * rate;
  }
  const expenseBreakdown = {
    rows: Object.entries(_catTotals).map(([category, amount]) => ({ category, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
    complete: breakdownComplete,
  };

  // ── F34 B (surface 3) — CONVERTED recent business transactions (mirrors the client
  // updateTransactions preview: recent recognized invoices + expenses). Each row's amount converts at
  // its OWN recognition date (invoice issue_date / expense expense_date) via pickRate; no rate ⇒
  // amount:null ⇒ the client renders "—". native ⇒ identity (rate 1). Preview only (not a reconciled
  // total) — a shown row's converted amount == its contribution to the converted KPI at the same rate.
  const _txAmt = (amount, date, from) => {
    const a = num(amount);
    if (!displayCur) return r2(a);
    const rate = (from === displayCur) ? 1 : pickRate(_fxRows, from, displayCur, date);
    return rate == null ? null : r2(a * rate);
  };
  const _txByDate = (a, b) => (new Date(b._d) - new Date(a._d)) || 0;
  const _invTx = issuedInv.map(i => ({ name: i.client || 'Invoice', cat: 'Revenue · ' + (i.status || ''), type: 'income', _d: _invDate(i), amount: _txAmt(i.amount, _invDate(i), _fromOf(i)) })).sort(_txByDate).slice(0, 5);
  const _expTx = expenses.map(e => ({ name: e.description || e.category || 'Expense', cat: 'Expense · ' + (e.category || 'Other'), type: 'expense', _d: _expDate(e), amount: _txAmt(e.amount, _expDate(e), _fromOf(e)) })).sort(_txByDate).slice(0, 5);
  const transactions = [..._invTx, ..._expTx].sort(_txByDate).slice(0, 6).map(t => ({ name: t.name, cat: t.cat, type: t.type, amount: t.amount }));

  return {
    revenue, cogs, grossProfit, opex, netProfit, outstanding, period, monthly, expenseBreakdown, transactions,
    fxCoverage,   // F34: { display, complete, unconvertible[], convertedRows, totalRows } — complete=false ⇒ partial P&L
    parts: {
      issuedInvoices: r2(issuedInvoices), salesReceipts: r2(salesReceipts),
      expenses: r2(expensesTotal), issuedBills: r2(issuedBillsTotal), paymentsMade: r2(paymentsMadeTotal), payroll: payrollTotal,
      monthlyPayroll: r2(monthlyPayroll), months, cogsUncoveredItems, unrecognizedStatusCount,
    },
  };
}

app.get('/api/inventory-movements', requireAuth, wrap(async (req, res) => {
  const { inventory_id } = req.query;
  let q = `SELECT * FROM inventory_movements WHERE user_id = $1`;
  const params = [scopeId(req)];
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
  await db.updateById('inventory', parseInt(inventory_id), {
    units: newUnits, low_stock: newUnits < newMax * 0.1 ? 1 : 0
  });

  res.status(201).json({ ...movement, cogs });
}));

app.get('/api/cogs', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const eid = req.entityId || null;
  // Entity-scoped so the total matches computeBooks / the dashboard (the frontend stashes
  // it as window._cogsTotal for the canonical net). $2 NULL → all entities.
  const { rows: items } = await pool.query(
    `SELECT DISTINCT im.inventory_id, i.data->>'name' AS name, i.data->>'sku' AS sku
     FROM inventory_movements im
     JOIN inventory i ON i.id = im.inventory_id
     WHERE im.user_id = $1 AND im.type = 'sale'
       AND ($2::int IS NULL OR im.entity_id IS NULL OR im.entity_id = $2)`,
    [scopeId(req), eid]
  );

  let totalCOGS = 0, uncoveredItems = 0;
  const breakdown = [];
  for (const it of items) {
    // FIFO per item (single costing method); flag units with no purchase layer.
    const f = await fifoItemTotal(pool, it.inventory_id);
    if (f.unitsSold <= 0) continue;
    totalCOGS += f.cogs;
    if (f.uncovered > 0) uncoveredItems++;
    breakdown.push({
      inventory_id: it.inventory_id, name: it.name, sku: it.sku,
      units_sold: f.unitsSold, cogs: f.cogs,
      uncovered_units: f.uncovered,
      no_cost_basis: f.uncovered > 0,
    });
  }
  totalCOGS = Math.round(totalCOGS * 100) / 100;

  const invoices = await db.allByUser('invoices', uid);
  const revenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  res.json({
    totalCOGS, grossProfit: Math.round((revenue - totalCOGS) * 100) / 100, revenue,
    breakdown, uncoveredItems, cogsMethod: 'fifo',
  });
}));

app.post('/api/cogs/calculate', requireAuth, wrap(async (req, res) => {
  const { inventory_id, quantity } = req.body || {};
  if (!inventory_id || !quantity) return res.status(400).json({ error: 'inventory_id and quantity required' });
  const item = await pool.query('SELECT id FROM inventory WHERE id=$1 AND user_id=$2', [inventory_id, scopeId(req)]);
  if (!item.rows[0]) return res.status(404).json({ error: 'Not found.' });
  const cogs = await calculateFIFOCOGS(pool, parseInt(inventory_id), parseFloat(quantity));
  res.json({ cogs });
}));

// ════════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — FX GAIN/LOSS TRACKING
// ════════════════════════════════════════════════════════════════════════════════
// Latest user-entered rate per currency pair → { 'EUR>USD': 1.20, ... }. This feature
// has its OWN rate store (fx_rates); it does NOT reuse the frontend's static _safeFX
// snapshot rates, which are a personal-finance display convenience, not the user's real
// current rates.
// F34 Path B — historical FX: the rate for from>to effective on/before `date` (carry-forward the
// most-recent prior rate, standard accounting). from===to short-circuits to 1 BEFORE any lookup, so
// native display is always identity even for users who have FX rates stored. No row on/before the
// date → null (NEVER 0, NEVER the static frontend table) — the caller flags the figure, never fabricates.
// pickRate is the pure matcher (over pre-fetched rows) so computeBooks can convert many rows without
// N queries; rateAsOf is the single-lookup entry point (harness + external callers).
function pickRate(rows, from, to, date) {
  if (from === to) return 1;
  // Collect the usable rates for this pair once (numeric rate + valid rate_date).
  const pair = [];
  for (const r of rows || []) {
    if (r.from_currency !== from || r.to_currency !== to) continue;
    const rd = new Date(r.rate_date), rate = parseFloat(r.rate);
    if (!isNaN(rd) && isFinite(rate)) pair.push({ rd, rate });
  }
  if (pair.length === 0) return null;           // pair has ZERO rates → null (never fabricate)
  const d = date ? new Date(date) : null;
  // Preferred: the most-recent rate effective ON/BEFORE the recognition date (carry-forward — keeps
  // historical accuracy when several rates exist, standard accounting).
  if (d && !isNaN(d)) {
    let best = null, bestDate = null;
    for (const r of pair) {
      if (r.rd > d) continue;
      if (bestDate == null || r.rd > bestDate) { bestDate = r.rd; best = r.rate; }
    }
    if (best != null) return best;
  }
  // Nearest-available fallback (A): no rate on/before the date (or no usable date) → the EARLIEST
  // rate that exists for the pair (carry-backward). Lets a single rate convert the whole history,
  // while multiple rates still date each txn to its own on/before rate above. Non-empty ⇒ non-null.
  let earliest = null, earliestDate = null;
  for (const r of pair) {
    if (earliestDate == null || r.rd < earliestDate) { earliestDate = r.rd; earliest = r.rate; }
  }
  return earliest;
}
async function rateAsOf(pool, userId, from, to, date) {
  if (from === to) return 1;                    // short-circuit before any DB hit
  const { rows } = await pool.query(
    `SELECT from_currency, to_currency, rate, rate_date FROM fx_rates WHERE user_id=$1 AND from_currency=$2 AND to_currency=$3`,
    [userId, from, to]
  );
  return pickRate(rows, from, to, date);
}

async function latestFxRates(pool, userId) {
  const { rows } = await pool.query(
    `SELECT from_currency, to_currency, rate FROM fx_rates WHERE user_id=$1 ORDER BY rate_date DESC, created_at DESC`,
    [userId]
  );
  const map = {};
  for (const r of rows) {
    const key = `${r.from_currency}>${r.to_currency}`;
    if (!(key in map)) map[key] = parseFloat(r.rate); // first row per pair is the latest
  }
  return map;
}

// Unrealised P/L for an OPEN position, in base currency, computed at read time from the
// current rate for its pair. Returns null when no current rate is available — NEVER a
// fabricated $0 (that phantom zero was the whole of F3).
function computeUnrealised(tx, rateMap) {
  if (tx.status !== 'open') return null;
  const cur = rateMap[`${tx.foreign_currency}>${tx.base_currency || 'USD'}`];
  if (cur == null || !isFinite(cur)) return null;
  return Math.round((cur - parseFloat(tx.rate_at_transaction)) * parseFloat(tx.foreign_amount) * 100) / 100;
}

app.get('/api/fx-rates', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM fx_rates WHERE user_id=$1 ORDER BY rate_date DESC, created_at DESC LIMIT 200`,
    [scopeId(req)]
  );
  res.json(rows);
}));

app.post('/api/fx-rates', requireAuth, wrap(async (req, res) => {
  const { from_currency, to_currency, rate, rate_date } = req.body || {};
  if (!from_currency || !to_currency || !rate) return res.status(400).json({ error: 'from_currency, to_currency, rate required' });
  const _from = from_currency.toUpperCase(), _to = to_currency.toUpperCase();
  const _rate = parseFloat(rate), _date = rate_date || new Date().toISOString().slice(0, 10);
  // Recent-duplicate guard (mirrors findRecentDuplicate's 5s spirit, on fx_rates' TYPED columns —
  // findRecentDuplicate only matches the JSONB data model). A rapid re-submit of the same
  // from/to/rate/date is returned idempotently instead of inserting a dupe; with the client's
  // disable-on-submit this ends the 3× identical-row problem.
  const { rows: dup } = await pool.query(
    `SELECT * FROM fx_rates WHERE user_id=$1 AND entity_id IS NOT DISTINCT FROM $2
       AND from_currency=$3 AND to_currency=$4 AND rate=$5 AND rate_date=$6
       AND created_at > NOW() - INTERVAL '5 seconds' ORDER BY id DESC LIMIT 1`,
    [req.session.userId, req.entityId || null, _from, _to, _rate, _date]
  );
  if (dup[0]) return res.status(201).json(dup[0]);
  const { rows: [row] } = await pool.query(
    `INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.session.userId, req.entityId || null, _from, _to, _rate, _date]
  );
  res.status(201).json(row);
}));

app.delete('/api/fx-rates/:id', requireAuth, wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rowCount } = await pool.query(
    `DELETE FROM fx_rates WHERE id=$1 AND user_id=$2`, [id, scopeId(req)]
  );
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

app.get('/api/fx-transactions', requireAuth, wrap(async (req, res) => {
  const eid = req.entityId || null;
  const { rows } = await pool.query(
    `SELECT * FROM fx_transactions WHERE user_id=$1 AND (entity_id IS NULL OR ($2::int IS NOT NULL AND entity_id = $2)) ORDER BY created_at DESC LIMIT 200`,
    [scopeId(req), eid]
  );
  // Compute unrealised P/L for open positions at read time (null when no current rate).
  const rateMap = await latestFxRates(pool, scopeId(req));
  for (const t of rows) {
    if (t.status === 'open') t.unrealised_gain_loss = computeUnrealised(t, rateMap);
  }
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
  // Recent-duplicate guard (same 5s recent-dup spirit, typed columns) — a rapid re-submit of the
  // same currency/amount/rate returns the existing row instead of inserting a dupe.
  const { rows: dupTx } = await pool.query(
    `SELECT * FROM fx_transactions WHERE user_id=$1 AND entity_id IS NOT DISTINCT FROM $2
       AND foreign_currency=$3 AND foreign_amount=$4 AND rate_at_transaction=$5
       AND created_at > NOW() - INTERVAL '5 seconds' ORDER BY id DESC LIMIT 1`,
    [req.session.userId, req.entityId || null, foreign_currency.toUpperCase(), fAmt, rate]
  );
  if (dupTx[0]) return res.status(201).json(dupTx[0]);
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
    `SELECT * FROM fx_transactions WHERE id=$1 AND user_id=$2`, [parseInt(req.params.id), scopeId(req)]
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
  const eid = req.entityId || null;
  const { rows: txs } = await pool.query(
    `SELECT * FROM fx_transactions WHERE user_id=$1 AND (entity_id IS NULL OR ($2::int IS NOT NULL AND entity_id = $2))`,
    [scopeId(req), eid]
  );
  const rateMap = await latestFxRates(pool, scopeId(req));

  // Realised = settled positions. Unrealised = COMPUTED for open positions that have a
  // current rate; positions with no rate are excluded (never counted as 0) and tallied
  // separately so the UI can be honest that they're unmeasured, not break-even.
  let totalRealised = 0, totalUnrealised = 0, openWithoutRate = 0;
  const byCurrency = {};
  for (const t of txs) {
    const cur = t.foreign_currency;
    byCurrency[cur] = byCurrency[cur] || { foreign_currency: cur, count: 0, total_realised: 0, total_unrealised: 0 };
    byCurrency[cur].count++;
    if (t.status === 'settled') {
      const r = parseFloat(t.realised_gain_loss) || 0;
      totalRealised += r; byCurrency[cur].total_realised += r;
    } else {
      const u = computeUnrealised(t, rateMap);
      if (u == null) openWithoutRate++;
      else { totalUnrealised += u; byCurrency[cur].total_unrealised += u; }
    }
  }
  totalRealised = Math.round(totalRealised * 100) / 100;
  totalUnrealised = Math.round(totalUnrealised * 100) / 100;
  res.json({
    totalRealised, totalUnrealised,
    netFX: Math.round((totalRealised + totalUnrealised) * 100) / 100,
    openWithoutRate,
    byCurrency: Object.values(byCurrency),
  });
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

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
// MUST be the very last app.use: Express routes an error only to error handlers
// registered AFTER the throwing route, so this position catches errors from every
// route above. (Previously it sat mid-file at ~2534, leaving ~42 later routes to
// fall through to Express's default handler and return HTML/stack instead of JSON.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// ── BOOT ──────────────────────────────────────────────────────────────────────
initDB().then(() => {
  if (require.main === module) {
    app.listen(PORT, () => {
      warnIfUnset(); // F29 — loud one-time warning if APP_URL is unset
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
// Test hook: expose the canonical books calculator for harness verification (no behavior
// change in prod — the app is still the default export).
module.exports.computeBooks = computeBooks;
