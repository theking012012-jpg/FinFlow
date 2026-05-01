'use strict';
const express      = require('express');
const session      = require('express-session');
const bcrypt       = require('bcryptjs');
const helmet       = require('helmet');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const zlib         = require('zlib');
const { db, initDB, seedUserData } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── STARTUP GUARDS ────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable must be set in production.');
  process.exit(1);
}
console.log('Starting on port:', PORT);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
}));

// ── GZIP COMPRESSION ─────────────────────────────────────────────────────────
// Compress all text responses (HTML, JS, CSS, JSON) — typically 60-80% smaller
app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) return next();

  const _send = res.send.bind(res);
  res.send = function(body) {
    const contentType = res.getHeader('Content-Type') || '';
    const isText = /html|javascript|css|json|text/.test(contentType);
    if (!isText || !body || body.length < 1024) return _send(body);

    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    zlib.gzip(buf, { level: 6 }, (err, compressed) => {
      if (err) return _send(body);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', compressed.length);
      res.removeHeader('Transfer-Encoding');
      _send(compressed);
    });
  };
  next();
});

// ── SECURITY HEADERS (set via HTTP, not meta tags) ───────────────────────────
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
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  const existing = db.get('users', u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const hash = bcrypt.hashSync(password, 12);
  const { lastInsertRowid: userId } = db.insert('users', { email: email.toLowerCase(), password: hash, name: (name || '').trim().slice(0, 100), plan: 'Pro', role: 'owner' });
  seedUserData(userId);
  req.session.userId = userId;
  const user = db.get('users', u => u.id === userId);
  res.status(201).json({ user: safeUser(user) });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.get('users', u => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password.' });
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.get('users', u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session expired.' });
  res.json({ user: safeUser(user) });
});

app.use('/api', apiLimiter);

// ── GENERIC CRUD FACTORY ──────────────────────────────────────────────────────
function ownedBy(table, id, userId) {
  return db.get(table, r => r.id === parseInt(id) && r.user_id === userId);
}

// ── ENTITIES ──────────────────────────────────────────────────────────────────
app.get('/api/entities', requireAuth, (req, res) => {
  res.json(db.all('entities', r => r.user_id === req.session.userId, (a, b) => a.sort_order - b.sort_order));
});
app.post('/api/entities', requireAuth, (req, res) => {
  const { name, currency = 'USD', color = '#c9a84c' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const { row } = db.insert('entities', { user_id: req.session.userId, name: name.trim().slice(0,100), currency, color, is_active: 0, sort_order: 0 });
  res.status(201).json(row);
});
app.put('/api/entities/:id', requireAuth, (req, res) => {
  const row = ownedBy('entities', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { name, currency, color } = req.body || {};
  db.update('entities', r => r.id === row.id, { ...(name && {name}), ...(currency && {currency}), ...(color && {color}) });
  res.json(db.get('entities', r => r.id === row.id));
});
app.delete('/api/entities/:id', requireAuth, (req, res) => {
  if (!ownedBy('entities', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('entities', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});
app.post('/api/entities/:id/activate', requireAuth, (req, res) => {
  const uid = req.session.userId;
  db.update('entities', r => r.user_id === uid, { is_active: 0 });
  db.update('entities', r => r.id === parseInt(req.params.id) && r.user_id === uid, { is_active: 1 });
  res.json({ ok: true });
});

// ── INVOICES ──────────────────────────────────────────────────────────────────
app.get('/api/invoices', requireAuth, (req, res) => {
  res.json(db.all('invoices', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/invoices', requireAuth, (req, res) => {
  const { client, amount, due_date, status = 'pending', notes = '', entity_id } = req.body || {};
  if (!client || amount == null) return res.status(400).json({ error: 'client and amount required.' });
  const { row } = db.insert('invoices', { user_id: req.session.userId, entity_id: entity_id||null, client: client.trim().slice(0,200), amount: parseFloat(amount)||0, due_date: due_date||null, status, notes: notes.slice(0,500) });
  res.status(201).json(row);
});
app.put('/api/invoices/:id', requireAuth, (req, res) => {
  const row = ownedBy('invoices', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const { client, amount, due_date, status, notes } = req.body || {};
  if (client != null) patch.client = client;
  if (amount != null) patch.amount = parseFloat(amount);
  if (due_date != null) patch.due_date = due_date;
  if (status != null) patch.status = status;
  if (notes != null) patch.notes = notes;
  db.update('invoices', r => r.id === row.id, patch);
  res.json(db.get('invoices', r => r.id === row.id));
});
app.delete('/api/invoices/:id', requireAuth, (req, res) => {
  if (!ownedBy('invoices', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('invoices', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── EXPENSES ──────────────────────────────────────────────────────────────────
app.get('/api/expenses', requireAuth, (req, res) => {
  res.json(db.all('expenses', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/expenses', requireAuth, (req, res) => {
  const { description, category = 'Other', amount, deductible = 'no', expense_date, entity_id } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const { row } = db.insert('expenses', { user_id: req.session.userId, entity_id: entity_id||null, description: description.trim().slice(0,300), category, amount: parseFloat(amount)||0, deductible, expense_date: expense_date || new Date().toISOString().slice(0,10) });
  res.status(201).json(row);
});
app.put('/api/expenses/:id', requireAuth, (req, res) => {
  const row = ownedBy('expenses', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  if (b.description != null) patch.description = b.description;
  if (b.category != null) patch.category = b.category;
  if (b.amount != null) patch.amount = parseFloat(b.amount);
  if (b.deductible != null) patch.deductible = b.deductible;
  if (b.expense_date != null) patch.expense_date = b.expense_date;
  db.update('expenses', r => r.id === row.id, patch);
  res.json(db.get('expenses', r => r.id === row.id));
});
app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  if (!ownedBy('expenses', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('expenses', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── CUSTOMERS ─────────────────────────────────────────────────────────────────
app.get('/api/customers', requireAuth, (req, res) => {
  res.json(db.all('customers', r => r.user_id === req.session.userId, (a,b) => b.revenue - a.revenue));
});
app.post('/api/customers', requireAuth, (req, res) => {
  const b = req.body || {};
  const { row } = db.insert('customers', { user_id: req.session.userId, entity_id: b.entity_id||null, fname: (b.fname||'').trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), company: (b.company||'').trim().slice(0,200), industry: (b.industry||'').slice(0,100), email: (b.email||'').slice(0,200), phone: (b.phone||'').slice(0,30), revenue: parseFloat(b.revenue)||0, status: b.status||'active', notes: (b.notes||'').slice(0,500) });
  res.status(201).json(row);
});
app.put('/api/customers/:id', requireAuth, (req, res) => {
  const row = ownedBy('customers', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['fname','lname','company','industry','email','phone','status','notes'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  if (b.revenue != null) patch.revenue = parseFloat(b.revenue);
  db.update('customers', r => r.id === row.id, patch);
  res.json(db.get('customers', r => r.id === row.id));
});
app.delete('/api/customers/:id', requireAuth, (req, res) => {
  if (!ownedBy('customers', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('customers', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── INVENTORY ─────────────────────────────────────────────────────────────────
app.get('/api/inventory', requireAuth, (req, res) => {
  res.json(db.all('inventory', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
});
app.post('/api/inventory', requireAuth, (req, res) => {
  const b = req.body || {};
  const u = Math.max(0, parseInt(b.units)||0);
  const mx = parseInt(b.max_units)||200;
  const { row } = db.insert('inventory', { user_id: req.session.userId, entity_id: b.entity_id||null, sku: (b.sku||'#'+Date.now()).slice(0,20), name: (b.name||'').trim().slice(0,200), units: u, max_units: mx, cost: parseFloat(b.cost)||0, low_stock: u < mx * 0.1 ? 1 : 0 });
  res.status(201).json(row);
});
app.put('/api/inventory/:id', requireAuth, (req, res) => {
  const row = ownedBy('inventory', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const newUnits = b.units != null ? Math.max(0, parseInt(b.units)||0) : row.units;
  const newMax   = b.max_units != null ? parseInt(b.max_units)||row.max_units : row.max_units;
  const patch = { units: newUnits, max_units: newMax, low_stock: newUnits < newMax * 0.1 ? 1 : 0 };
  if (b.name != null) patch.name = b.name;
  if (b.cost != null) patch.cost = parseFloat(b.cost);
  db.update('inventory', r => r.id === row.id, patch);
  res.json(db.get('inventory', r => r.id === row.id));
});
app.post('/api/inventory/:id/restock', requireAuth, (req, res) => {
  const row = ownedBy('inventory', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const qty = Math.max(1, Math.min(parseInt(req.body.qty)||0, 100000));
  const newUnits = row.units + qty;
  db.update('inventory', r => r.id === row.id, { units: newUnits, low_stock: newUnits < row.max_units * 0.1 ? 1 : 0 });
  res.json(db.get('inventory', r => r.id === row.id));
});
app.delete('/api/inventory/:id', requireAuth, (req, res) => {
  if (!ownedBy('inventory', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('inventory', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── PAYROLL ───────────────────────────────────────────────────────────────────
app.get('/api/payroll', requireAuth, (req, res) => {
  res.json(db.all('payroll', r => r.user_id === req.session.userId, (a,b) => b.is_owner - a.is_owner || a.id - b.id));
});
app.post('/api/payroll', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.fname) return res.status(400).json({ error: 'fname required.' });
  const { row } = db.insert('payroll', { user_id: req.session.userId, entity_id: b.entity_id||null, fname: b.fname.trim().slice(0,100), lname: (b.lname||'').trim().slice(0,100), role: (b.role||'').slice(0,100), emp_type: b.emp_type||'Full-time', gross: parseFloat(b.gross)||0, tax_rate: parseFloat(b.tax_rate)||0, av_class: b.av_class||'av-blue', is_owner: b.is_owner ? 1 : 0 });
  res.status(201).json(row);
});
app.put('/api/payroll/:id', requireAuth, (req, res) => {
  const row = ownedBy('payroll', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['fname','lname','role','emp_type','av_class'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  if (b.gross != null) patch.gross = parseFloat(b.gross);
  if (b.tax_rate != null) patch.tax_rate = parseFloat(b.tax_rate);
  db.update('payroll', r => r.id === row.id, patch);
  res.json(db.get('payroll', r => r.id === row.id));
});
app.delete('/api/payroll/:id', requireAuth, (req, res) => {
  if (!ownedBy('payroll', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('payroll', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── PERSONAL TRANSACTIONS ─────────────────────────────────────────────────────
app.get('/api/personal-transactions', requireAuth, (req, res) => {
  res.json(db.all('personal_transactions', r => r.user_id === req.session.userId, (a,b) => b.id - a.id));
});
app.post('/api/personal-transactions', requireAuth, (req, res) => {
  const { description, category = 'Other', amount, tx_type = 'expense', tx_date } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ error: 'description and amount required.' });
  const { row } = db.insert('personal_transactions', { user_id: req.session.userId, description: description.trim().slice(0,300), category, amount: parseFloat(amount)||0, tx_type, tx_date: tx_date || new Date().toISOString().slice(0,10) });
  res.status(201).json(row);
});
app.delete('/api/personal-transactions/:id', requireAuth, (req, res) => {
  if (!ownedBy('personal_transactions', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('personal_transactions', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});
app.put('/api/personal-transactions/:id', requireAuth, (req, res) => {
  const row = ownedBy('personal_transactions', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  if (b.description != null) patch.description = b.description.trim().slice(0, 300);
  if (b.category != null)    patch.category    = b.category;
  if (b.amount != null)      patch.amount      = parseFloat(b.amount) || 0;
  if (b.tx_type != null)     patch.tx_type     = b.tx_type;
  if (b.tx_date != null)     patch.tx_date     = b.tx_date;
  db.update('personal_transactions', r => r.id === row.id, patch);
  res.json(db.get('personal_transactions', r => r.id === row.id));
});

// ── GOALS ─────────────────────────────────────────────────────────────────────
app.get('/api/goals', requireAuth, (req, res) => {
  res.json(db.all('goals', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
});
app.post('/api/goals', requireAuth, (req, res) => {
  const { name, current_val = 0, target_val, monthly_contrib = 0, color = 'var(--acc)' } = req.body || {};
  if (!name || target_val == null) return res.status(400).json({ error: 'name and target_val required.' });
  const { row } = db.insert('goals', { user_id: req.session.userId, name: name.trim().slice(0,200), current_val: parseFloat(current_val)||0, target_val: parseFloat(target_val)||0, monthly_contrib: parseFloat(monthly_contrib)||0, color });
  res.status(201).json(row);
});
app.put('/api/goals/:id', requireAuth, (req, res) => {
  const row = ownedBy('goals', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  if (b.name != null) patch.name = b.name;
  if (b.color != null) patch.color = b.color;
  if (b.current_val != null) patch.current_val = parseFloat(b.current_val);
  if (b.target_val != null) patch.target_val = parseFloat(b.target_val);
  if (b.monthly_contrib != null) patch.monthly_contrib = parseFloat(b.monthly_contrib);
  db.update('goals', r => r.id === row.id, patch);
  res.json(db.get('goals', r => r.id === row.id));
});
app.delete('/api/goals/:id', requireAuth, (req, res) => {
  if (!ownedBy('goals', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('goals', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── HOLDINGS ──────────────────────────────────────────────────────────────────
app.get('/api/holdings', requireAuth, (req, res) => {
  res.json(db.all('holdings', r => r.user_id === req.session.userId, (a,b) => a.id - b.id));
});
app.post('/api/holdings', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.ticker || b.shares == null) return res.status(400).json({ error: 'ticker and shares required.' });
  const { row } = db.insert('holdings', { user_id: req.session.userId, ticker: b.ticker.trim().toUpperCase().slice(0,20), name: (b.name||b.ticker).trim().slice(0,200), asset_type: b.asset_type||'Stock', shares: parseFloat(b.shares)||0, cost_per: parseFloat(b.cost_per)||0, price: parseFloat(b.price)||parseFloat(b.cost_per)||0, dividend: parseFloat(b.dividend)||0, color: b.color||'#c9a84c' });
  res.status(201).json(row);
});
app.put('/api/holdings/:id', requireAuth, (req, res) => {
  const row = ownedBy('holdings', req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const patch = {};
  const b = req.body || {};
  ['ticker','name','asset_type','color'].forEach(f => { if (b[f] != null) patch[f] = b[f]; });
  ['shares','cost_per','price','dividend'].forEach(f => { if (b[f] != null) patch[f] = parseFloat(b[f]); });
  db.update('holdings', r => r.id === row.id, patch);
  res.json(db.get('holdings', r => r.id === row.id));
});
app.delete('/api/holdings/:id', requireAuth, (req, res) => {
  if (!ownedBy('holdings', req.params.id, req.session.userId)) return res.status(404).json({ error: 'Not found.' });
  db.delete('holdings', r => r.id === parseInt(req.params.id));
  res.json({ ok: true });
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, (req, res) => {
  res.json(db.get('user_settings', r => r.user_id === req.session.userId) || {});
});
app.put('/api/settings', requireAuth, (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.dark_mode != null)   patch.dark_mode   = b.dark_mode ? 1 : 0;
  if (b.currency != null)    patch.currency     = b.currency;
  if (b.show_cents != null)  patch.show_cents   = b.show_cents ? 1 : 0;
  if (b.notif_email != null) patch.notif_email  = b.notif_email ? 1 : 0;
  if (b.notif_inv != null)   patch.notif_inv    = b.notif_inv ? 1 : 0;
  if (b.notif_pay != null)   patch.notif_pay    = b.notif_pay ? 1 : 0;
  db.upsert('user_settings', 'user_id', req.session.userId, patch);
  if (b.name) db.update('users', u => u.id === req.session.userId, { name: b.name.trim().slice(0,100) });
  res.json({ ok: true });
});

// ── STATIC / SPA ──────────────────────────────────────────────────────────────



// ── PAGE ROUTES ───────────────────────────────────────────────────────────────
// Landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// App at /app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
