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
const { db, initDB, seedUserData, pool } = require('./database');
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
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('[Stripe] Initialized');
  } else {
    console.warn('[Stripe] STRIPE_SECRET_KEY not set — billing features disabled.');
  }
} catch (e) {
  console.warn('[Stripe] Package not installed — run: npm install stripe');
}

const app  = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable must be set in production.');
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
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production' ? false : true),
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
    // Service payment completed — record commission
    const session = event.data.object;
    const accountantId = session.metadata?.accountantId;
    const billedCents = session.amount_total;
    const commissionCents = Math.round(billedCents * 0.04);
    if (accountantId) {
      await pool.query(`
        INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, status, period_month)
        VALUES ($1, $2, 'service_commission', $3, $4, 'pending', date_trunc('month', NOW()))
      `, [accountantId, session.metadata?.clientUserId || null, commissionCents, session.metadata?.description || 'Service commission']);
      console.log(`[Stripe] Commission recorded: $${(commissionCents/100).toFixed(2)} for accountant ${accountantId}`);
    }
  }

  if (event.type === 'account.updated') {
    // Stripe Connect onboarding completed
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

app.use(express.json({ limit: '10mb' })); // 10 mb covers base64-encoded receipt images
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1);
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'finflow-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000, max: 200 });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorised — please log in.' });
  next();
}

function safeUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name || '', plan: u.plan || 'trial', trial_ends: u.trial_ends || null, role: u.role || 'owner' };
}

// Wraps async route handlers so any thrown error is forwarded to Express error handler
const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

    const existing = await db.get('users', u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = bcrypt.hashSync(password, 12);
    const { lastInsertRowid: userId } = await db.insert('users', {
      email: email.toLowerCase(), password: hash,
      name: (name || '').trim().slice(0, 100), plan: 'pro', trial_ends: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), role: 'owner',
    });

    seedUserData(userId).catch(e => console.error('[Register] seedUserData failed for userId', userId, e));

    // If user signed up via an accountant referral link (?ref=CODE), link them now
    const refCode = req.body.referralCode || req.query.ref;
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
    const user = await db.get('users', u => u.id === userId);
    console.log('[Register] New user created:', email);
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
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password.' });
    req.session.userId = user.id;
    req.session.userRole = user.role || 'owner';
    res.json({ user: safeUser(user) });
  } catch (err) {
    console.error('[Login] Unexpected error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

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
      console.log(`\n[Password Reset] No email provider configured.\nReset link for ${user.email}:\n${resetUrl}\n`);
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
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

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

app.use('/api', apiLimiter);

// ── ENTITY + RBAC MIDDLEWARE ──────────────────────────────────────────────────
// Sets req.entityId from session so routes can scope data to the active entity.
app.use('/api', (req, res, next) => {
  req.entityId = req.session.entityId || null;
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
  if (entityId) return r => r.user_id === userId && (r.entity_id === entityId || r.entity_id == null);
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
  res.json(await db.all('invoices', userFilter(req.session.userId, req.entityId), (a,b) => b.id - a.id));
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
  if (status != null) patch.status = status;
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
  res.json(await db.all('expenses', userFilter(req.session.userId, req.entityId), (a,b) => b.id - a.id));
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
  res.json(await db.all('customers', userFilter(req.session.userId, req.entityId), (a,b) => b.revenue - a.revenue));
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
  res.json(await db.all('inventory', userFilter(req.session.userId, req.entityId), (a,b) => a.id - b.id));
}));
app.post('/api/inventory', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const u = Math.max(0, parseInt(b.units)||0);
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
  res.json(await db.all('items', r => r.user_id === req.session.userId, (a, b) => a.id - b.id));
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
  res.json(await db.all('payroll', userFilter(req.session.userId, req.entityId), (a,b) => b.is_owner - a.is_owner || a.id - b.id));
}));
app.post('/api/payroll', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.fname) return res.status(400).json({ error: 'fname required.' });
  const { row } = await db.insert('payroll', { user_id: req.session.userId, entity_id: b.entity_id||null, fname: b.fname.trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), role: (b.role||'').slice(0,100), emp_type: b.emp_type||'Full-time', gross: parseFloat(b.gross)||0, tax_rate: parseFloat(b.tax_rate)||0, av_class: b.av_class||'av-blue', is_owner: b.is_owner ? 1 : 0 });
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

// ── PERSONAL TRANSACTIONS ─────────────────────────────────────────────────────
app.get('/api/personal-transactions', requireAuth, wrap(async (req, res) => {
  res.json(await db.all('personal_transactions', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
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
  res.json(await db.all('goals', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
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
  res.json(await db.all('projects', r => r.user_id === req.session.userId, (a, b) => b.id - a.id));
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
  res.json(await db.all('holdings', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
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
  const row = await db.get('budget_targets', r => r.user_id === req.session.userId);
  res.json(row ? row.targets : {});
}));
app.put('/api/budget-targets', requireAuth, wrap(async (req, res) => {
  const targets = req.body || {};
  await db.upsert('budget_targets', 'user_id', req.session.userId, { targets });
  res.json({ ok: true });
}));

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, wrap(async (req, res) => {
  res.json(await db.get('user_settings', r => r.user_id === req.session.userId) || {});
}));
app.put('/api/settings', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.dark_mode      != null) patch.dark_mode      = b.dark_mode ? 1 : 0;
  if (b.currency       != null) patch.currency        = b.currency;
  if (b.show_cents     != null) patch.show_cents      = b.show_cents ? 1 : 0;
  if (b.notif_email    != null) patch.notif_email     = b.notif_email ? 1 : 0;
  if (b.notif_inv      != null) patch.notif_inv       = b.notif_inv ? 1 : 0;
  if (b.notif_pay      != null) patch.notif_pay       = b.notif_pay ? 1 : 0;
  // Onboarding fields
  if (b.business_name  != null) patch.business_name   = b.business_name.slice(0,200);
  if (b.business_type  != null) patch.business_type   = b.business_type;
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
  res.json(await db.all('journals', userFilter(req.session.userId, req.entityId), (a,b) => b.id - a.id));
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
  res.json(await db.all('chart_of_accounts', userFilter(req.session.userId, req.entityId), (a,b) => a.code.localeCompare(b.code)));
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
  let rows = await db.all('audit_log', r => r.user_id === req.session.userId, (a,b) => b.id - a.id);
  if (type && type !== 'all') rows = rows.filter(r => r.table_name === type);
  const start = (parseInt(page) - 1) * parseInt(limit);
  res.json({ total: rows.length, rows: rows.slice(start, start + parseInt(limit)) });
}));

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────
const MAX_DOC_SIZE = 5 * 1024 * 1024; // 5MB in bytes before base64 (~3.75MB actual)
app.get('/api/documents', requireAuth, wrap(async (req, res) => {
  const rows = await db.all('documents', r => r.user_id === req.session.userId, (a,b) => b.id - a.id);
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
  res.setHeader('Content-Type', row.media_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${row.name}"`);
  res.send(buf);
}));
app.delete('/api/documents/:id', requireAuth, wrap(async (req, res) => {
  if (!(await ownedBy('documents', req.params.id, req.session.userId))) return res.status(404).json({ error: 'Not found.' });
  await db.delete('documents', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
}));

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
app.get('/api/templates', requireAuth, wrap(async (req, res) => {
  res.json(await db.all('templates', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
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
  res.json(await db.all('autocat_rules', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
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
  const rules = await db.all('autocat_rules', r => r.user_id === uid && r.enabled);
  const expenses = await db.all('expenses', r => r.user_id === uid && (!r.category || r.category === 'Other'));
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

// ── PAGE ROUTES ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ── QUOTES ────────────────────────────────────────────────────────────────────
app.get('/api/quotes', requireAuth, wrap(async (req, res) => {
  res.json(await db.all('quotes', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
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
  res.json(await db.all('vendors', userFilter(req.session.userId, req.entityId), (a,b) => a.name.localeCompare(b.name)));
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
  const { name, contact, category, owing, ytd_paid, status } = req.body;
  await db.update('vendors', r => r.id === Number(req.params.id), { name, contact, category, owing: Number(owing), ytd_paid: Number(ytd_paid), status });
  res.json({ ok: true });
}));
app.delete('/api/vendors/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('vendors', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── BILLS ─────────────────────────────────────────────────────────────────────
app.get('/api/bills', requireAuth, wrap(async (req, res) => {
  res.json(await db.all('bills', userFilter(req.session.userId, req.entityId), (a,b) => b.id - a.id));
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
  res.json(await db.all('recurring_bills', r => r.user_id === req.session.userId));
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
  res.json(await db.all('recurring_invoices', r => r.user_id === req.session.userId));
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
  res.json(await db.all('sales_receipts', r => r.user_id === req.session.userId));
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
  res.json(await db.all('payments_received', r => r.user_id === req.session.userId));
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
  res.json(await db.all('credit_notes', r => r.user_id === req.session.userId));
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
  res.json(await db.all('payments_made', r => r.user_id === req.session.userId));
}));
app.post('/api/payments-made', requireAuth, wrap(async (req, res) => {
  const { row } = await db.insert('payments_made', { ...req.body, user_id: req.session.userId });
  res.json(row);
}));
app.put('/api/payments-made/:id', requireAuth, wrap(async (req, res) => {
  await db.update('payments_made', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, req.body);
  res.json({ ok: true });
}));
app.delete('/api/payments-made/:id', requireAuth, wrap(async (req, res) => {
  await db.delete('payments_made', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
}));

// ── VENDOR CREDITS ────────────────────────────────────────────────────────────
app.get('/api/vendor-credits', requireAuth, wrap(async (req, res) => {
  res.json(await db.all('vendor_credits', r => r.user_id === req.session.userId));
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
  res.json(await db.all('timesheet', r => r.user_id === req.session.userId, (a, b) => b.id - a.id));
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
  const pay  = await db.all('payroll', r => r.user_id === uid);
  const invited = await db.all('team_members', r => r.user_id === uid);
  const members = [
    { id: 'u0', name: user?.name || user?.email || 'You', email: user?.email || '', role: 'owner', emp_type: 'Owner', lastSeen: 'Now' },
    ...pay.map(p => ({
      id:       `p${p.id}`,
      name:     `${p.fname} ${p.lname}`.trim(),
      email:    `${p.fname.toLowerCase()}.${p.lname.toLowerCase()}@company.com`,
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
      db.all('invoices',  r => r.user_id === uid),
      db.all('expenses',  r => r.user_id === uid),
      db.all('customers', r => r.user_id === uid),
      db.get('user_settings', r => r.user_id === uid),
    ]);
    const cfg = settings || {};

    const totalRevenue  = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    const model = COMPLEX_QUERY_RE.test(message)
      ? 'claude-sonnet-4-20250514'
      : 'claude-haiku-4-5-20251001';

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
      ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
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
        model:      'claude-sonnet-4-20250514',
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
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accountant-register.html'));
});
app.get('/accountant', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accountant-dashboard.html'));
});
app.get('/accountant-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'accountant-login.html'));
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
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, maxAge: '1h',
  setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

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
    const recInvoices = await db.all('recurring_invoices', r => r.status === 'active' && r.next_run && r.next_run <= today);
    for (const r of recInvoices) {
      await db.insert('invoices', {
        user_id: r.user_id, entity_id: r.entity_id || null,
        client: r.client, amount: r.amount, due_date: r.next_run,
        status: 'pending', notes: `Auto-generated from recurring schedule`,
      });
      await db.update('recurring_invoices', x => x.id === r.id, { next_run: nextRunDate(r.next_run, r.frequency) });
    }

    // Recurring bills
    const recBills = await db.all('recurring_bills', r => r.status === 'active' && r.next_run && r.next_run <= today);
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

// ── BOOT ──────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  ✦ FinFlow backend running → http://localhost:${PORT}`);
    console.log(`  ✦ Point Lighthouse at:    http://localhost:${PORT}\n`);
  });
  // Run scheduler on boot, then every hour
  runRecurringScheduler();
  setInterval(runRecurringScheduler, 60 * 60 * 1000);
}).catch(err => {
  console.error('Failed to init database:', err);
  process.exit(1);
});
