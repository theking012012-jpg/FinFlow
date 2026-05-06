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

// Resend — optional. If RESEND_API_KEY is not set, password reset emails
// will log to console instead of sending. This lets the app boot without
// an email provider configured.
let resendClient = null;
try {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
} catch (e) {
  console.warn('[Resend] Package not installed — email will be skipped.');
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── STARTUP GUARDS ────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable must be set in production.');
  process.exit(1);
}
console.log('Starting on port:', PORT);

// ── GZIP COMPRESSION (must be first) ─────────────────────────────────────────
app.use(compression({ level: 6 }));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
}));

// ── HTTP SECURITY HEADERS ─────────────────────────────────────────────────────
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1); // Required for Railway/Heroku
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'finflow-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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
  return { id: u.id, email: u.email, name: u.name || '', plan: u.plan || 'Pro', role: u.role || 'owner' };
}

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
    const { lastInsertRowid: userId } = await db.insert('users', { email: email.toLowerCase(), password: hash, name: (name || '').trim().slice(0, 100), plan: 'Pro', role: 'owner' });

    try {
      seedUserData(userId);
    } catch (seedErr) {
      // Log but don't block — the account was created; seed data is non-critical
      console.error('[Register] seedUserData failed for userId', userId, seedErr);
    }

    req.session.userId = userId;
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
    res.json({ user: safeUser(user) });
  } catch (err) {
    console.error('[Login] Unexpected error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

// ── PASSWORD RESET ─────────────────────────────────────────────────────────────
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required.' });

  // Always return 200 so we don't reveal which emails are registered
  const user = await db.get('users', u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.json({ ok: true });

  // Generate token — expires in 1 hour
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // Remove any old tokens for this user
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
    // Dev fallback — log the link to console
    console.log(`\n[Password Reset] No email provider configured.\nReset link for ${user.email}:\n${resetUrl}\n`);
  }

  res.json({ ok: true });
});

app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
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
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await db.get('users', u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user: safeUser(user) });
});

app.use('/api', apiLimiter);

// ── GENERIC CRUD FACTORY ──────────────────────────────────────────────────────
function ownedBy(table, id, userId) {
  return await db.get(table, r => r.id === parseInt(id) && r.user_id === userId);
}

// ── ENTITIES ──────────────────────────────────────────────────────────────────
app.get('/api/entities', requireAuth, async (req, res) => {
  res.json(await db.all('entities', r => r.user_id === req.session.userId, (a, b) => a.sort_order - b.sort_order));
});
app.post('/api/entities', requireAuth, async (req, res) => {
  const { name, currency = 'USD', color = '#c9a84c' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const { row } = await db.insert('entities', { user_id: req.session.userId, name: name.trim().slice(0,100), currency, color, is_active: 0, sort_order: 0 });
  res.status(201).json(row);
});
app.put('/api/entities/:id', requireAuth, async (req, res) => {
  const row = ownedBy('entities', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { name, currency, color } = req.body || {};
  await db.update('entities', r => r.id === row.id, { ...(name && {name}), ...(currency && {currency}), ...(color && {color}) });
  res.json(await db.get('entities', r => r.id === row.id));
});
app.delete('/api/entities/:id', requireAuth, async (req, res) => {
  if (!ownedBy('entities', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('entities', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});
app.post('/api/entities/:id/activate', requireAuth, async (req, res) => {
  const uid = req.session.userId;
  await db.update('entities', r => r.user_id === uid, { is_active: 0 });
  await db.update('entities', r => r.id === parseInt(req.params.id) && r.user_id === uid, { is_active: 1 });
  res.json({ ok: true });
});

// ── INVOICES ──────────────────────────────────────────────────────────────────
app.get('/api/invoices', requireAuth, async (req, res) => {
  res.json(await db.all('invoices', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/invoices', requireAuth, async (req, res) => {
  const { client, amount, due_date, status = 'pending', notes = '', entity_id } = req.body || {};
  if (!client || amount == null) return res.status(400).json({ error: 'client and amount required.' });
  const { row } = await db.insert('invoices', { user_id: req.session.userId, entity_id: entity_id||null, client: client.trim().slice(0,200), amount: parseFloat(amount)||0, due_date: due_date||null, status, notes: notes.slice(0,500) });
  res.status(201).json(row);
});
app.put('/api/invoices/:id', requireAuth, async (req, res) => {
  const row = ownedBy('invoices', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const { client, amount, due_date, status, notes } = req.body || {};
  if (client != null) patch.client = client;
  if (amount != null) patch.amount = parseFloat(amount);
  if (due_date != null) patch.due_date = due_date;
  if (status != null) patch.status = status;
  if (notes != null) patch.notes = notes;
  await db.update('invoices', r => r.id === row.id, patch);
  res.json(await db.get('invoices', r => r.id === row.id));
});
app.delete('/api/invoices/:id', requireAuth, async (req, res) => {
  if (!ownedBy('invoices', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('invoices', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── EXPENSES ──────────────────────────────────────────────────────────────────
app.get('/api/expenses', requireAuth, async (req, res) => {
  res.json(await db.all('expenses', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/expenses', requireAuth, async (req, res) => {
  const { description, category = 'Other', amount, deductible = 'no', expense_date, entity_id } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const { row } = await db.insert('expenses', { user_id: req.session.userId, entity_id: entity_id||null, description: description.trim().slice(0,300), category, amount: parseFloat(amount)||0, deductible, expense_date: expense_date || new Date().toISOString().slice(0,10) });
  res.status(201).json(row);
});
app.put('/api/expenses/:id', requireAuth, async (req, res) => {
  const row = ownedBy('expenses', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  if (b.description != null) patch.description = b.description;
  if (b.category != null) patch.category = b.category;
  if (b.amount != null) patch.amount = parseFloat(b.amount);
  if (b.deductible != null) patch.deductible = b.deductible;
  if (b.expense_date != null) patch.expense_date = b.expense_date;
  await db.update('expenses', r => r.id === row.id, patch);
  res.json(await db.get('expenses', r => r.id === row.id));
});
app.delete('/api/expenses/:id', requireAuth, async (req, res) => {
  if (!ownedBy('expenses', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('expenses', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── CUSTOMERS ─────────────────────────────────────────────────────────────────
app.get('/api/customers', requireAuth, async (req, res) => {
  res.json(await db.all('customers', r => r.user_id === req.session.userId, (a,b) => b.revenue - a.revenue));
});
app.post('/api/customers', requireAuth, async (req, res) => {
  const b = req.body || {};
  const { row } = await db.insert('customers', { user_id: req.session.userId, entity_id: b.entity_id||null, fname: (b.fname||'').trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), company: (b.company||'').trim().slice(0,200), industry: (b.industry||'').slice(0,100), email: (b.email||'').slice(0,200), phone: (b.phone||'').slice(0,30), revenue: parseFloat(b.revenue)||0, status: b.status||'active', notes: (b.notes||'').slice(0,500) });
  res.status(201).json(row);
});
app.put('/api/customers/:id', requireAuth, async (req, res) => {
  const row = ownedBy('customers', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['fname','lname','company','industry','email','phone','status','notes'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  if (b.revenue != null) patch.revenue = parseFloat(b.revenue);
  await db.update('customers', r => r.id === row.id, patch);
  res.json(await db.get('customers', r => r.id === row.id));
});
app.delete('/api/customers/:id', requireAuth, async (req, res) => {
  if (!ownedBy('customers', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('customers', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── INVENTORY ─────────────────────────────────────────────────────────────────
app.get('/api/inventory', requireAuth, async (req, res) => {
  res.json(await db.all('inventory', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
});
app.post('/api/inventory', requireAuth, async (req, res) => {
  const b = req.body || {};
  const u = Math.max(0, parseInt(b.units)||0);
  const mx = parseInt(b.max_units)||200;
  const { row } = await db.insert('inventory', { user_id: req.session.userId, entity_id: b.entity_id||null, sku: (b.sku||'#'+Date.now()).slice(0,20), name: (b.name||'').trim().slice(0,200), units: u, max_units: mx, cost: parseFloat(b.cost)||0, low_stock: u < mx * 0.1 ? 1 : 0 });
  res.status(201).json(row);
});
app.put('/api/inventory/:id', requireAuth, async (req, res) => {
  const row = ownedBy('inventory', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const newUnits = b.units != null ? Math.max(0, parseInt(b.units)||0) : row.units;
  const newMax   = b.max_units != null ? parseInt(b.max_units)||row.max_units : row.max_units;
  const patch = { units: newUnits, max_units: newMax, low_stock: newUnits < newMax * 0.1 ? 1 : 0 };
  if (b.name != null) patch.name = b.name;
  if (b.cost != null) patch.cost = parseFloat(b.cost);
  await db.update('inventory', r => r.id === row.id, patch);
  res.json(await db.get('inventory', r => r.id === row.id));
});
app.post('/api/inventory/:id/restock', requireAuth, async (req, res) => {
  const row = ownedBy('inventory', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const qty = Math.max(1, Math.min(parseInt(req.body.qty)||0, 100000));
  const newUnits = row.units + qty;
  await db.update('inventory', r => r.id === row.id, { units: newUnits, low_stock: newUnits < row.max_units * 0.1 ? 1 : 0 });
  res.json(await db.get('inventory', r => r.id === row.id));
});
app.delete('/api/inventory/:id', requireAuth, async (req, res) => {
  if (!ownedBy('inventory', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('inventory', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── ITEMS (product & service catalog) ────────────────────────────────────────
app.get('/api/items', requireAuth, async (req, res) => {
  res.json(await db.all('items', r => r.user_id === req.session.userId, (a, b) => a.id - b.id));
});
app.post('/api/items', requireAuth, async (req, res) => {
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
});
app.put('/api/items/:id', requireAuth, async (req, res) => {
  const row = ownedBy('items', req.params.id, req.session.userId);
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
});
app.delete('/api/items/:id', requireAuth, async (req, res) => {
  if (!ownedBy('items', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('items', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── PAYROLL ───────────────────────────────────────────────────────────────────
app.get('/api/payroll', requireAuth, async (req, res) => {
  res.json(await db.all('payroll', r => r.user_id === req.session.userId, (a,b) => b.is_owner - a.is_owner || a.id - b.id));
});
app.post('/api/payroll', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.fname) return res.status(400).json({ error: 'fname required.' });
  const { row } = await db.insert('payroll', { user_id: req.session.userId, entity_id: b.entity_id||null, fname: b.fname.trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), role: (b.role||'').slice(0,100), emp_type: b.emp_type||'Full-time', gross: parseFloat(b.gross)||0, tax_rate: parseFloat(b.tax_rate)||0, av_class: b.av_class||'av-blue', is_owner: b.is_owner ? 1 : 0 });
  res.status(201).json(row);
});
app.put('/api/payroll/:id', requireAuth, async (req, res) => {
  const row = ownedBy('payroll', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['fname','lname','role','emp_type','av_class'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  if (b.gross != null) patch.gross = parseFloat(b.gross);
  if (b.tax_rate != null) patch.tax_rate = parseFloat(b.tax_rate);
  await db.update('payroll', r => r.id === row.id, patch);
  res.json(await db.get('payroll', r => r.id === row.id));
});
app.delete('/api/payroll/:id', requireAuth, async (req, res) => {
  if (!ownedBy('payroll', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('payroll', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── PERSONAL TRANSACTIONS ─────────────────────────────────────────────────────
app.get('/api/personal-transactions', requireAuth, async (req, res) => {
  res.json(await db.all('personal_transactions', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/personal-transactions', requireAuth, async (req, res) => {
  const { description, category = 'Other', amount, tx_type = 'expense', tx_date } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const { row } = await db.insert('personal_transactions', { user_id: req.session.userId, description: description.trim().slice(0,300), category, amount: parseFloat(amount)||0, tx_type, tx_date: tx_date || new Date().toISOString().slice(0,10) });
  res.status(201).json(row);
});
app.delete('/api/personal-transactions/:id', requireAuth, async (req, res) => {
  if (!ownedBy('personal_transactions', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('personal_transactions', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});
app.put('/api/personal-transactions/:id', requireAuth, async (req, res) => {
  const row = ownedBy('personal_transactions', req.params.id, req.session.userId);
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
});

// ── GOALS ─────────────────────────────────────────────────────────────────────
app.get('/api/goals', requireAuth, async (req, res) => {
  res.json(await db.all('goals', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
});
app.post('/api/goals', requireAuth, async (req, res) => {
  const { name, current_val = 0, target_val, monthly_contrib = 0, color = 'var(--acc)' } = req.body || {};
  if (!name || target_val == null) return res.status(400).json({ error: 'name and target_val required.' });
  const { row } = await db.insert('goals', { user_id: req.session.userId, name: name.trim().slice(0,200), current_val: parseFloat(current_val)||0, target_val: parseFloat(target_val)||0, monthly_contrib: parseFloat(monthly_contrib)||0, color });
  res.status(201).json(row);
});
app.put('/api/goals/:id', requireAuth, async (req, res) => {
  const row = ownedBy('goals', req.params.id, req.session.userId);
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
});
app.delete('/api/goals/:id', requireAuth, async (req, res) => {
  if (!ownedBy('goals', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('goals', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── PROJECTS ──────────────────────────────────────────────────────────────────
app.get('/api/projects', requireAuth, async (req, res) => {
  res.json(await db.all('projects', r => r.user_id === req.session.userId, (a, b) => b.id - a.id));
});
app.post('/api/projects', requireAuth, async (req, res) => {
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
});
app.put('/api/projects/:id', requireAuth, async (req, res) => {
  const row = ownedBy('projects', req.params.id, req.session.userId);
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
});
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  if (!ownedBy('projects', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('projects', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── HOLDINGS ──────────────────────────────────────────────────────────────────
app.get('/api/holdings', requireAuth, async (req, res) => {
  res.json(await db.all('holdings', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
});
app.post('/api/holdings', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.ticker || b.shares == null) return res.status(400).json({ error: 'ticker and shares required.' });
  const { row } = await db.insert('holdings', { user_id: req.session.userId, ticker: b.ticker.trim().toUpperCase().slice(0,20), name: (b.name||b.ticker).trim().slice(0,200), asset_type: b.asset_type||'Stock', shares: parseFloat(b.shares)||0, cost_per: parseFloat(b.cost_per)||0, price: parseFloat(b.price)||parseFloat(b.cost_per)||0, dividend: parseFloat(b.dividend)||0, color: b.color||'#c9a84c' });
  res.status(201).json(row);
});
app.put('/api/holdings/:id', requireAuth, async (req, res) => {
  const row = ownedBy('holdings', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['ticker','name','asset_type','color'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  ['shares','cost_per','price','dividend'].forEach(f => { if (b[f] != null) patch[f] = parseFloat(b[f]); });
  await db.update('holdings', r => r.id === row.id, patch);
  res.json(await db.get('holdings', r => r.id === row.id));
});
app.delete('/api/holdings/:id', requireAuth, async (req, res) => {
  if (!ownedBy('holdings', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('holdings', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── BUDGET TARGETS ────────────────────────────────────────────────────────────
app.get('/api/budget-targets', requireAuth, async (req, res) => {
  const row = await db.get('budget_targets', r => r.user_id === req.session.userId);
  res.json(row ? row.targets : {});
});
app.put('/api/budget-targets', requireAuth, async (req, res) => {
  const targets = req.body || {};
  await db.upsert('budget_targets', 'user_id', req.session.userId, { targets });
  res.json({ ok: true });
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, async (req, res) => {
  res.json(await db.get('user_settings', r => r.user_id === req.session.userId) || {});
});
app.put('/api/settings', requireAuth, async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.dark_mode != null)   patch.dark_mode   = b.dark_mode ? 1 : 0;
  if (b.currency != null)    patch.currency     = b.currency;
  if (b.show_cents != null)  patch.show_cents   = b.show_cents ? 1 : 0;
  if (b.notif_email != null) patch.notif_email  = b.notif_email ? 1 : 0;
  if (b.notif_inv != null)   patch.notif_inv    = b.notif_inv ? 1 : 0;
  if (b.notif_pay != null)   patch.notif_pay    = b.notif_pay ? 1 : 0;
  await db.upsert('user_settings', 'user_id', req.session.userId, patch);
  if (b.name) await db.update('users', u => u.id === req.session.userId, { name: b.name.trim().slice(0,100) });
  res.json({ ok: true });
});

// ── STATIC / SPA ──────────────────────────────────────────────────────────────



// ── PAGE ROUTES ───────────────────────────────────────────────────────────────
// Landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ── QUOTES ────────────────────────────────────────────────────────────────────
app.get('/api/quotes', requireAuth, async (req, res) => {
  res.json(await db.all('quotes', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/quotes', requireAuth, async (req, res) => {
  const { client, amount, expiry_date, status = 'pending', notes = '' } = req.body;
  if (!client || !amount) return res.status(400).json({ error: 'client and amount required' });
  const entity = await db.all('entities', e => e.user_id === req.session.userId && e.is_active)[0];
  const num = 'QT-' + String(Date.now()).slice(-4);
  const { row } = await db.insert('quotes', { user_id: req.session.userId, entity_id: entity?.id, client, num, amount: Number(amount), expiry_date, status, notes });
  res.json(row);
});
app.put('/api/quotes/:id', requireAuth, async (req, res) => {
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
});
app.delete('/api/quotes/:id', requireAuth, async (req, res) => {
  await db.delete('quotes', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── VENDORS ───────────────────────────────────────────────────────────────────
app.get('/api/vendors', requireAuth, async (req, res) => {
  res.json(await db.all('vendors', r => r.user_id === req.session.userId, (a,b) => a.name.localeCompare(b.name)));
});
app.post('/api/vendors', requireAuth, async (req, res) => {
  const { name, contact, category, owing = 0, ytd_paid = 0, status = 'active' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const entity = await db.all('entities', e => e.user_id === req.session.userId && e.is_active)[0];
  const { row } = await db.insert('vendors', { user_id: req.session.userId, entity_id: entity?.id, name, contact, category, owing: Number(owing), ytd_paid: Number(ytd_paid), status });
  res.json(row);
});
app.put('/api/vendors/:id', requireAuth, async (req, res) => {
  const row = await db.get('vendors', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { name, contact, category, owing, ytd_paid, status } = req.body;
  await db.update('vendors', r => r.id === Number(req.params.id), { name, contact, category, owing: Number(owing), ytd_paid: Number(ytd_paid), status });
  res.json({ ok: true });
});
app.delete('/api/vendors/:id', requireAuth, async (req, res) => {
  await db.delete('vendors', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── BILLS ─────────────────────────────────────────────────────────────────────
app.get('/api/bills', requireAuth, async (req, res) => {
  res.json(await db.all('bills', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/bills', requireAuth, async (req, res) => {
  const { vendor, amount, due_date, status = 'unpaid', notes = '' } = req.body;
  if (!vendor || !amount) return res.status(400).json({ error: 'vendor and amount required' });
  const entity = await db.all('entities', e => e.user_id === req.session.userId && e.is_active)[0];
  const num = 'BILL-' + String(Date.now()).slice(-4);
  const { row } = await db.insert('bills', { user_id: req.session.userId, entity_id: entity?.id, vendor, num, amount: Number(amount), due_date, status, notes });
  res.json(row);
});
app.put('/api/bills/:id', requireAuth, async (req, res) => {
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
});
app.delete('/api/bills/:id', requireAuth, async (req, res) => {
  await db.delete('bills', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── RECURRING BILLS ───────────────────────────────────────────────────────────
app.get('/api/recurring-bills', requireAuth, async (req, res) => {
  res.json(await db.all('recurring_bills', r => r.user_id === req.session.userId));
});
app.post('/api/recurring-bills', requireAuth, async (req, res) => {
  const { vendor, amount, frequency = 'Monthly', next_run, status = 'active' } = req.body;
  if (!vendor || !amount) return res.status(400).json({ error: 'vendor and amount required' });
  const entity = await db.all('entities', e => e.user_id === req.session.userId && e.is_active)[0];
  const { row } = await db.insert('recurring_bills', { user_id: req.session.userId, entity_id: entity?.id, vendor, amount: Number(amount), frequency, next_run, status });
  res.json(row);
});
app.put('/api/recurring-bills/:id', requireAuth, async (req, res) => {
  const row = await db.get('recurring_bills', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { vendor, amount, frequency, next_run, status } = req.body;
  await db.update('recurring_bills', r => r.id === Number(req.params.id), { vendor, amount: Number(amount), frequency, next_run, status });
  res.json({ ok: true });
});
app.delete('/api/recurring-bills/:id', requireAuth, async (req, res) => {
  await db.delete('recurring_bills', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── RECURRING INVOICES ────────────────────────────────────────────────────────
app.get('/api/recurring-invoices', requireAuth, async (req, res) => {
  res.json(await db.all('recurring_invoices', r => r.user_id === req.session.userId));
});
app.post('/api/recurring-invoices', requireAuth, async (req, res) => {
  const { client, amount, frequency = 'Monthly', next_run, status = 'active' } = req.body;
  if (!client || !amount) return res.status(400).json({ error: 'client and amount required' });
  const entity = await db.all('entities', e => e.user_id === req.session.userId && e.is_active)[0];
  const { row } = await db.insert('recurring_invoices', { user_id: req.session.userId, entity_id: entity?.id, client, amount: Number(amount), frequency, next_run, status });
  res.json(row);
});
app.put('/api/recurring-invoices/:id', requireAuth, async (req, res) => {
  const row = await db.get('recurring_invoices', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { client, amount, frequency, next_run, status } = req.body;
  await db.update('recurring_invoices', r => r.id === Number(req.params.id), { client, amount: Number(amount), frequency, next_run, status });
  res.json({ ok: true });
});
app.delete('/api/recurring-invoices/:id', requireAuth, async (req, res) => {
  await db.delete('recurring_invoices', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── SALES RECEIPTS ────────────────────────────────────────────────────────────
app.get('/api/sales-receipts', requireAuth, async (req, res) => {
  res.json(await db.all('sales_receipts', r => r.user_id === req.session.userId));
});
app.post('/api/sales-receipts', requireAuth, async (req, res) => {
  const r = await db.insert('sales_receipts', { ...req.body, user_id: req.session.userId, created_at: new Date().toISOString() });
  res.json(r);
});
app.put('/api/sales-receipts/:id', requireAuth, async (req, res) => {
  const r = await db.update('sales_receipts', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, req.body);
  res.json(r);
});
app.delete('/api/sales-receipts/:id', requireAuth, async (req, res) => {
  await db.delete('sales_receipts', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── PAYMENTS RECEIVED ─────────────────────────────────────────────────────────
app.get('/api/payments-received', requireAuth, async (req, res) => {
  res.json(await db.all('payments_received', r => r.user_id === req.session.userId));
});
app.post('/api/payments-received', requireAuth, async (req, res) => {
  const r = await db.insert('payments_received', { ...req.body, user_id: req.session.userId, created_at: new Date().toISOString() });
  res.json(r);
});
app.put('/api/payments-received/:id', requireAuth, async (req, res) => {
  const r = await db.update('payments_received', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, req.body);
  res.json(r);
});
app.delete('/api/payments-received/:id', requireAuth, async (req, res) => {
  await db.delete('payments_received', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── CREDIT NOTES ──────────────────────────────────────────────────────────────
app.get('/api/credit-notes', requireAuth, async (req, res) => {
  res.json(await db.all('credit_notes', r => r.user_id === req.session.userId));
});
app.post('/api/credit-notes', requireAuth, async (req, res) => {
  const r = await db.insert('credit_notes', { ...req.body, user_id: req.session.userId, created_at: new Date().toISOString() });
  res.json(r);
});
app.put('/api/credit-notes/:id', requireAuth, async (req, res) => {
  const r = await db.update('credit_notes', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, req.body);
  res.json(r);
});
app.delete('/api/credit-notes/:id', requireAuth, async (req, res) => {
  await db.delete('credit_notes', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── PAYMENTS MADE ─────────────────────────────────────────────────────────────
app.get('/api/payments-made', requireAuth, async (req, res) => {
  res.json(await db.all('payments_made', r => r.user_id === req.session.userId));
});
app.post('/api/payments-made', requireAuth, async (req, res) => {
  const r = await db.insert('payments_made', { ...req.body, user_id: req.session.userId, created_at: new Date().toISOString() });
  res.json(r);
});
app.put('/api/payments-made/:id', requireAuth, async (req, res) => {
  const r = await db.update('payments_made', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, req.body);
  res.json(r);
});
app.delete('/api/payments-made/:id', requireAuth, async (req, res) => {
  await db.delete('payments_made', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── VENDOR CREDITS ────────────────────────────────────────────────────────────
app.get('/api/vendor-credits', requireAuth, async (req, res) => {
  res.json(await db.all('vendor_credits', r => r.user_id === req.session.userId));
});
app.post('/api/vendor-credits', requireAuth, async (req, res) => {
  const r = await db.insert('vendor_credits', { ...req.body, user_id: req.session.userId, created_at: new Date().toISOString() });
  res.json(r);
});
app.put('/api/vendor-credits/:id', requireAuth, async (req, res) => {
  const r = await db.update('vendor_credits', r => r.id === Number(req.params.id) && r.user_id === req.session.userId, req.body);
  res.json(r);
});
app.delete('/api/vendor-credits/:id', requireAuth, async (req, res) => {
  await db.delete('vendor_credits', r => r.id === Number(req.params.id) && r.user_id === req.session.userId);
  res.json({ ok: true });
});

// ── TIMESHEET ─────────────────────────────────────────────────────────────────
app.get('/api/timesheet', requireAuth, async (req, res) => {
  res.json(await db.all('timesheet', r => r.user_id === req.session.userId, (a, b) => b.id - a.id));
});
app.post('/api/timesheet', requireAuth, async (req, res) => {
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
});
app.put('/api/timesheet/:id', requireAuth, async (req, res) => {
  const row = ownedBy('timesheet', req.params.id, req.session.userId);
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
});
app.delete('/api/timesheet/:id', requireAuth, async (req, res) => {
  if (!ownedBy('timesheet', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('timesheet', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── TEAM ──────────────────────────────────────────────────────────────────────
app.get('/api/team', requireAuth, async (req, res) => {
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
});
app.post('/api/team', requireAuth, async (req, res) => {
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
});
app.put('/api/team/:id', requireAuth, async (req, res) => {
  const row = ownedBy('team_members', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { role } = req.body || {};
  const validRoles = ['admin', 'accountant', 'viewer'];
  if (role && validRoles.includes(role)) await db.update('team_members', r => r.id === row.id, { role });
  res.json(await db.get('team_members', r => r.id === row.id));
});
app.delete('/api/team/:id', requireAuth, async (req, res) => {
  if (!ownedBy('team_members', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  await db.delete('team_members', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── AI CHAT ───────────────────────────────────────────────────────────────────
app.post('/api/ai', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    // Build business context from the user's data
    const invoices = await db.all('invoices', r => r.user_id === req.session.userId);
    const expenses = await db.all('expenses', r => r.user_id === req.session.userId);
    const customers = await db.all('customers', r => r.user_id === req.session.userId);
    const settings = await db.all('user_settings', r => r.user_id === req.session.userId)[0] || {};

    const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    const systemPrompt = `You are FinFlow AI, a sharp financial assistant embedded in the FinFlow accounting platform.
Business: ${settings.company_name || 'This business'}
Revenue (paid invoices): $${totalRevenue.toLocaleString()}
Total Expenses: $${totalExpenses.toLocaleString()}
Customers: ${customers.length}
Open Invoices: ${invoices.filter(i => i.status !== 'paid').length}

Be concise, practical, and specific to this business's actual numbers. Format currency with $ signs. Keep replies under 200 words unless asked for detail.`;

    const messages = [
      ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'AI service unavailable. Add ANTHROPIC_API_KEY to .env to enable.' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'No response from AI.';
    res.json({ reply });
  } catch (err) {
    console.error('AI route error:', err);
    res.status(500).json({ error: 'AI service error. Check server logs.' });
  }
});

// App at /app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Password reset page
app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// Sitemap
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '1h', setHeaders: function(res, filePath) { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res) => {
  // Any unknown route → landing page
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
// Must be defined after all routes. Catches any unhandled errors and returns
// a safe JSON response without exposing stack traces to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// ── BOOT ──────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  ✦ FinFlow backend running → http://localhost:${PORT}`);
    console.log(`  ✦ Point Lighthouse at:    http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to init database:', err);
  process.exit(1);
});
