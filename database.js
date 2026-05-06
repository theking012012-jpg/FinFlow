'use strict';
/**
 * database.js — FinFlow data layer using lowdb (JSON file, zero compilation)
 * Drop-in replacement for the better-sqlite3 version.
 */
const { JSONFilePreset } = require('lowdb/node');
const path = require('path');

const DB_PATH = path.join(__dirname, 'finflow.db.json');

// We use a synchronous-style wrapper so the rest of the app stays the same
let _db = null;

async function initDB() {
  const defaultData = { users: [], entities: [], invoices: [], expenses: [], customers: [], inventory: [], payroll: [], personal_transactions: [], goals: [], holdings: [], user_settings: [], password_resets: [], quotes: [], bills: [], vendors: [], recurring_bills: [], recurring_invoices: [], sales_receipts: [], payments_received: [], credit_notes: [], payments_made: [], vendor_credits: [], items: [] };
  _db = await JSONFilePreset(DB_PATH, defaultData);

  // Ensure every expected table exists — lowdb reads the file as-is and does NOT
  // merge defaultData, so tables added after the first deploy are missing on existing DBs.
  let needsWrite = false;
  for (const table of Object.keys(defaultData)) {
    if (!Array.isArray(_db.data[table])) {
      console.log(`[DB] Adding missing table: ${table}`);
      _db.data[table] = [];
      needsWrite = true;
    }
  }
  if (needsWrite) await _db.write();

  return _db;
}

// ── ID generator ──────────────────────────────────────────────────────────────
let _idCounters = {};
function nextId(table) {
  if (!_idCounters[table]) {
    const rows = Array.isArray(_db.data[table]) ? _db.data[table] : [];
    _idCounters[table] = rows.length ? Math.max(...rows.map(r => r.id || 0)) + 1 : 1;
  }
  return _idCounters[table]++;
}

// ── Write queue — prevents race conditions from concurrent fire-and-forget writes ──
let _writeQueue = Promise.resolve();
function queueWrite() {
  _writeQueue = _writeQueue.then(() => _db.write()).catch(err => console.error('[DB write error]', err));
}

// ── Ensure a table array exists (guard for tables added after initial deploy) ──
function ensureTable(table) {
  if (!Array.isArray(_db.data[table])) {
    console.warn(`[DB] Auto-creating missing table: ${table}`);
    _db.data[table] = [];
  }
}

// ── Low-level helpers (mimic better-sqlite3 API) ──────────────────────────────
const db = {
  get data() { return _db ? _db.data : null; },

  async write() { await _db.write(); },

  // Insert a row, return { lastInsertRowid }
  insert(table, row) {
    ensureTable(table);
    const id = nextId(table);
    const newRow = { id, ...row, created_at: new Date().toISOString() };
    _db.data[table].push(newRow);
    queueWrite();
    return { lastInsertRowid: id, row: newRow };
  },

  // Get one row by filter fn
  get(table, filterFn) {
    if (!Array.isArray(_db.data[table])) return null;
    return _db.data[table].find(filterFn) || null;
  },

  // Get all rows matching filter fn
  all(table, filterFn, sortFn) {
    const src = Array.isArray(_db.data[table]) ? _db.data[table] : [];
    let rows = filterFn ? src.filter(filterFn) : [...src];
    if (sortFn) rows.sort(sortFn);
    return rows;
  },

  // Update rows matching filter, apply patch object or fn
  update(table, filterFn, patch) {
    if (!Array.isArray(_db.data[table])) return;
    _db.data[table].forEach(row => {
      if (filterFn(row)) Object.assign(row, typeof patch === 'function' ? patch(row) : patch);
    });
    queueWrite();
  },

  // Delete rows matching filter
  delete(table, filterFn) {
    if (!Array.isArray(_db.data[table])) return;
    _db.data[table] = _db.data[table].filter(r => !filterFn(r));
    queueWrite();
  },

  // Upsert (for user_settings)
  upsert(table, keyField, keyVal, patch) {
    ensureTable(table);
    const existing = _db.data[table].find(r => r[keyField] === keyVal);
    if (existing) {
      Object.assign(existing, patch, { updated_at: new Date().toISOString() });
    } else {
      _db.data[table].push({ id: nextId(table), [keyField]: keyVal, ...patch, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    queueWrite();
  },
};

// ── SEED HELPERS ──────────────────────────────────────────────────────────────
function seedUserData(userId) {
  // Default entity
  const { lastInsertRowid: entityId } = db.insert('entities', { user_id: userId, name: 'FinFlow Inc.', currency: 'USD', color: '#c9a84c', is_active: 1, sort_order: 0 });

  // Invoices
  [
    { client: 'RetailCo Ltd',    amount: 8400,  due_date: 'Apr 30', status: 'pending' },
    { client: 'TechStart Inc',   amount: 5000,  due_date: 'May 5',  status: 'paid' },
    { client: 'NovaCorp',        amount: 12000, due_date: 'May 15', status: 'paid' },
    { client: 'Sapphire Media',  amount: 4800,  due_date: 'May 20', status: 'paid' },
    { client: 'Mango & Co',      amount: 2200,  due_date: 'Apr 10', status: 'overdue' },
    { client: 'BlueSky Agency',  amount: 1600,  due_date: 'Apr 14', status: 'overdue' },
    { client: 'Freelance — Dev', amount: 3200,  due_date: 'May 12', status: 'pending' },
  ].forEach(r => db.insert('invoices', { user_id: userId, entity_id: entityId, notes: '', ...r }));

  // Expenses
  [
    { description: 'Office rent — April',   category: 'Rent',     amount: 3900, deductible: 'yes',  expense_date: 'Apr 1' },
    { description: 'Google Workspace',      category: 'Software', amount: 420,  deductible: 'yes',  expense_date: 'Apr 2' },
    { description: 'AWS Cloud services',    category: 'Software', amount: 622,  deductible: 'yes',  expense_date: 'Apr 5' },
    { description: 'Team lunch',            category: 'Meals',    amount: 285,  deductible: 'half', expense_date: 'Apr 10' },
    { description: 'Flight — client visit', category: 'Travel',   amount: 680,  deductible: 'yes',  expense_date: 'Apr 14' },
    { description: 'Freelancer — UI dev',   category: 'Salaries', amount: 1200, deductible: 'yes',  expense_date: 'Apr 18' },
    { description: 'Mailchimp marketing',   category: 'Marketing',amount: 149,  deductible: 'yes',  expense_date: 'Apr 20' },
  ].forEach(r => db.insert('expenses', { user_id: userId, entity_id: entityId, ...r }));

  // Customers
  [
    { fname: 'Emma',   lname: 'Richardson', company: 'RetailCo Ltd',   industry: 'Retail',     email: 'emma@retailco.com',   phone: '+1 555-0101', revenue: 218400, status: 'active', notes: 'Top client.' },
    { fname: 'Marcus', lname: 'Chen',       company: 'TechStart Inc',  industry: 'Technology', email: 'marcus@techstart.io', phone: '+1 555-0202', revenue: 149400, status: 'active', notes: 'Fast-growing startup.' },
    { fname: 'Priya',  lname: 'Kapoor',     company: 'NovaCorp',       industry: 'Finance',    email: 'priya@novacorp.com',  phone: '+1 555-0303', revenue: 144000, status: 'active', notes: 'Always pays on time.' },
    { fname: 'James',  lname: 'Okafor',     company: 'Mango & Co',     industry: 'Retail',     email: 'james@mango.co',      phone: '+1 555-0404', revenue: 26400,  status: 'active', notes: 'Overdue Apr invoice.' },
    { fname: 'Aria',   lname: 'Santos',     company: 'BlueSky Agency', industry: 'Media',      email: 'aria@bluesky.agency', phone: '+1 555-0505', revenue: 19200,  status: 'active', notes: 'Overdue since Apr 14.' },
  ].forEach(r => db.insert('customers', { user_id: userId, entity_id: entityId, ...r }));

  // Inventory
  [
    { sku: '#1042', name: 'Wireless Headset Pro', units: 142, max_units: 200, cost: 60,  low_stock: 0 },
    { sku: '#1043', name: 'USB-C Hub 8-in-1',     units: 88,  max_units: 200, cost: 50,  low_stock: 0 },
    { sku: '#1044', name: 'Mechanical Keyboard',  units: 31,  max_units: 200, cost: 100, low_stock: 0 },
    { sku: '#1045', name: 'Webcam 4K Ultra',      units: 9,   max_units: 200, cost: 80,  low_stock: 1 },
    { sku: '#1046', name: 'Laptop Stand Alu.',    units: 67,  max_units: 200, cost: 40,  low_stock: 0 },
    { sku: '#1047', name: 'Ergonomic Mouse',      units: 4,   max_units: 200, cost: 60,  low_stock: 1 },
  ].forEach(r => db.insert('inventory', { user_id: userId, entity_id: entityId, ...r }));

  // Payroll
  [
    { fname: 'Jordan', lname: 'Mills',  role: 'Dev Lead',  emp_type: 'Full-time',  gross: 5200, tax_rate: 20, av_class: 'av-blue',   is_owner: 0 },
    { fname: 'Sofia',  lname: 'Arenas', role: 'Designer',  emp_type: 'Full-time',  gross: 3800, tax_rate: 20, av_class: 'av-purple', is_owner: 0 },
    { fname: 'Raj',    lname: 'Kapoor', role: 'Sales',     emp_type: 'Full-time',  gross: 3500, tax_rate: 20, av_class: 'av-green',  is_owner: 0 },
    { fname: 'Leila',  lname: 'Torres', role: 'Marketing', emp_type: 'Part-time',  gross: 2100, tax_rate: 20, av_class: 'av-amber',  is_owner: 0 },
    { fname: 'Ben',    lname: 'Nwosu',  role: 'Backend',   emp_type: 'Contractor', gross: 1132, tax_rate: 0,  av_class: 'av-teal',   is_owner: 0 },
  ].forEach(r => db.insert('payroll', { user_id: userId, entity_id: entityId, ...r }));

  // Personal transactions
  [
    { description: 'Salary — April',      category: 'Income',        amount: 6800, tx_type: 'income',  tx_date: 'Apr 30' },
    { description: 'Rent payment',        category: 'Rent/Mortgage', amount: 1800, tx_type: 'expense', tx_date: 'Apr 1' },
    { description: 'Supermarket run',     category: 'Groceries',     amount: 182,  tx_type: 'expense', tx_date: 'Apr 8' },
    { description: 'Netflix & Spotify',   category: 'Subscriptions', amount: 42,   tx_type: 'expense', tx_date: 'Apr 3' },
    { description: 'Dinner with client',  category: 'Dining out',    amount: 95,   tx_type: 'expense', tx_date: 'Apr 12' },
    { description: 'Fuel',                category: 'Transport',     amount: 60,   tx_type: 'expense', tx_date: 'Apr 15' },
    { description: 'Dividend income',     category: 'Income',        amount: 320,  tx_type: 'income',  tx_date: 'Apr 20' },
    { description: 'Gym membership',      category: 'Subscriptions', amount: 45,   tx_type: 'expense', tx_date: 'Apr 5' },
    { description: 'Uber rides',          category: 'Transport',     amount: 38,   tx_type: 'expense', tx_date: 'Apr 22' },
    { description: 'Grocery — bulk shop', category: 'Groceries',     amount: 210,  tx_type: 'expense', tx_date: 'Apr 28' },
  ].forEach(r => db.insert('personal_transactions', { user_id: userId, ...r }));

  // Goals
  [
    { name: 'Emergency fund',       current_val: 12000, target_val: 15000, monthly_contrib: 500,  color: 'var(--green)' },
    { name: 'House deposit',        current_val: 28000, target_val: 60000, monthly_contrib: 1500, color: 'var(--acc)' },
    { name: 'Investment portfolio', current_val: 44500, target_val: 50000, monthly_contrib: 1800, color: 'var(--acc-light)' },
  ].forEach(r => db.insert('goals', { user_id: userId, ...r }));

  // Holdings
  [
    { ticker: 'AAPL',  name: 'Apple Inc.',      asset_type: 'Stock', shares: 85,  cost_per: 148.20, price: 192.35, dividend: 0.96, color: '#c9a84c' },
    { ticker: 'MSFT',  name: 'Microsoft Corp.', asset_type: 'Stock', shares: 40,  cost_per: 310.50, price: 415.80, dividend: 3.00, color: '#5aaa9e' },
    { ticker: 'VTI',   name: 'Vanguard Total',  asset_type: 'ETF',   shares: 120, cost_per: 218.00, price: 242.10, dividend: 3.20, color: '#9e8fbf' },
    { ticker: 'BRK.B', name: 'Berkshire B',     asset_type: 'Stock', shares: 30,  cost_per: 320.00, price: 404.50, dividend: 0,    color: '#7db87d' },
    { ticker: 'NVDA',  name: 'NVIDIA Corp.',    asset_type: 'Stock', shares: 25,  cost_per: 480.00, price: 875.40, dividend: 0.16, color: '#d4964a' },
    { ticker: 'CASH',  name: 'Cash & MM',       asset_type: 'Cash',  shares: 1,   cost_per: 8000,   price: 8000,   dividend: 0.05, color: '#5a4e3a' },
  ].forEach(r => db.insert('holdings', { user_id: userId, ...r }));

  // Quotes
  [
    { client: 'RetailCo Ltd',    num: 'QT-0042', amount: 28400, expiry_date: 'May 15', status: 'pending',  notes: '' },
    { client: 'TechStart Inc',   num: 'QT-0041', amount: 9600,  expiry_date: 'May 10', status: 'accepted', notes: '' },
    { client: 'Mango & Co',      num: 'QT-0040', amount: 4800,  expiry_date: 'Apr 30', status: 'accepted', notes: '' },
    { client: 'BlueSky Agency',  num: 'QT-0039', amount: 14200, expiry_date: 'May 20', status: 'pending',  notes: '' },
    { client: 'Nova Systems',    num: 'QT-0038', amount: 7800,  expiry_date: 'Apr 25', status: 'declined', notes: '' },
    { client: 'GreenLeaf Ltd',   num: 'QT-0037', amount: 5200,  expiry_date: 'May 1',  status: 'accepted', notes: '' },
  ].forEach(r => db.insert('quotes', { user_id: userId, entity_id: entityId, ...r }));

  // Vendors
  [
    { name: 'AWS',                contact: 'billing@aws.com',       category: 'Infrastructure', owing: 6200, ytd_paid: 74400, status: 'active' },
    { name: 'Stripe',             contact: 'support@stripe.com',    category: 'Payments',       owing: 0,    ytd_paid: 4200,  status: 'active' },
    { name: 'Office Prime',       contact: 'lease@officeprime.com', category: 'Rent',           owing: 3800, ytd_paid: 45600, status: 'active' },
    { name: 'Adobe Creative',     contact: 'accounts@adobe.com',    category: 'Software',       owing: 840,  ytd_paid: 10080, status: 'active' },
    { name: 'Slack Technologies', contact: 'billing@slack.com',     category: 'Software',       owing: 420,  ytd_paid: 5040,  status: 'active' },
    { name: 'FedEx',              contact: 'fedex@fedex.com',       category: 'Shipping',       owing: 0,    ytd_paid: 2400,  status: 'active' },
  ].forEach(r => db.insert('vendors', { user_id: userId, entity_id: entityId, ...r }));

  // Bills
  [
    { vendor: 'AWS',                num: 'BILL-0042', amount: 6200, due_date: 'Apr 30', status: 'overdue' },
    { vendor: 'Office Prime',       num: 'BILL-0041', amount: 3800, due_date: 'May 1',  status: 'due_soon' },
    { vendor: 'Adobe Creative',     num: 'BILL-0040', amount: 840,  due_date: 'May 5',  status: 'unpaid' },
    { vendor: 'Slack Technologies', num: 'BILL-0039', amount: 420,  due_date: 'May 8',  status: 'unpaid' },
    { vendor: 'FedEx',              num: 'BILL-0038', amount: 380,  due_date: 'May 12', status: 'unpaid' },
    { vendor: 'AWS',                num: 'BILL-0037', amount: 6200, due_date: 'Mar 30', status: 'paid' },
  ].forEach(r => db.insert('bills', { user_id: userId, entity_id: entityId, notes: '', ...r }));

  // Recurring Bills
  [
    { vendor: 'AWS',                amount: 6200, frequency: 'Monthly', next_run: 'May 1',  status: 'active' },
    { vendor: 'Office Prime',       amount: 3800, frequency: 'Monthly', next_run: 'May 1',  status: 'active' },
    { vendor: 'Adobe Creative',     amount: 840,  frequency: 'Monthly', next_run: 'May 5',  status: 'active' },
    { vendor: 'Slack Technologies', amount: 420,  frequency: 'Monthly', next_run: 'May 8',  status: 'active' },
  ].forEach(r => db.insert('recurring_bills', { user_id: userId, entity_id: entityId, ...r }));

  // Recurring Invoices
  [
    { client: 'RetailCo Ltd',   amount: 12800, frequency: 'Monthly',   next_run: 'May 1',  status: 'active' },
    { client: 'TechStart Inc',  amount: 4800,  frequency: 'Monthly',   next_run: 'May 1',  status: 'active' },
    { client: 'BlueSky Agency', amount: 3200,  frequency: 'Monthly',   next_run: 'May 5',  status: 'active' },
    { client: 'Nova Systems',   amount: 4200,  frequency: 'Quarterly', next_run: 'Jul 1',  status: 'active' },
    { client: 'GreenLeaf Ltd',  amount: 1800,  frequency: 'Monthly',   next_run: 'May 10', status: 'paused' },
    { client: 'Mango & Co',     amount: 1600,  frequency: 'Monthly',   next_run: 'May 1',  status: 'active' },
  ].forEach(r => db.insert('recurring_invoices', { user_id: userId, entity_id: entityId, ...r }));

  // Sales Receipts
  [
    { customer: 'Walk-in Customer', num: 'SR-0124', amount: 840,  date: 'Apr 28', method: 'Card' },
    { customer: 'RetailCo',         num: 'SR-0123', amount: 4200, date: 'Apr 27', method: 'Bank Transfer' },
    { customer: 'BlueWave Agency',  num: 'SR-0122', amount: 2400, date: 'Apr 26', method: 'Card' },
    { customer: 'Walk-in Customer', num: 'SR-0121', amount: 315,  date: 'Apr 25', method: 'Cash' },
    { customer: 'Nova Systems',     num: 'SR-0120', amount: 3800, date: 'Apr 24', method: 'Card' },
  ].forEach(r => db.insert('sales_receipts', { user_id: userId, entity_id: entityId, ...r }));

  // Payments Received
  [
    { customer: 'RetailCo',        invoice_ref: 'INV-2026-009', amount: 12800, date: 'Apr 28', method: 'Bank Transfer' },
    { customer: 'TechStart Ltd',   invoice_ref: 'INV-2026-008', amount: 9600,  date: 'Apr 26', method: 'Card' },
    { customer: 'Mango & Co',      invoice_ref: 'INV-2026-007', amount: 4800,  date: 'Apr 24', method: 'Bank Transfer' },
    { customer: 'BlueWave Agency', invoice_ref: 'INV-2026-006', amount: 7200,  date: 'Apr 20', method: 'Card' },
    { customer: 'Nova Systems',    invoice_ref: 'INV-2026-005', amount: 5400,  date: 'Apr 18', method: 'Bank Transfer' },
  ].forEach(r => db.insert('payments_received', { user_id: userId, entity_id: entityId, ...r }));

  // Credit Notes
  [
    { customer: 'Mango & Co',      num: 'CN-0008', amount: 420,  date: 'Apr 20', status: 'Open',    reason: 'Return' },
    { customer: 'RetailCo',        num: 'CN-0007', amount: 780,  date: 'Apr 14', status: 'Applied', reason: 'Discount adjustment' },
    { customer: 'BlueWave Agency', num: 'CN-0006', amount: 1200, date: 'Mar 28', status: 'Open',    reason: 'Service credit' },
    { customer: 'Nova Systems',    num: 'CN-0005', amount: 440,  date: 'Mar 15', status: 'Applied', reason: 'Billing error' },
  ].forEach(r => db.insert('credit_notes', { user_id: userId, entity_id: entityId, ...r }));

  // Payments Made
  [
    { vendor: 'AWS',              ref: 'PM-0041', amount: 6200, date: 'Apr 30', method: 'Bank Transfer' },
    { vendor: 'Office Supplies Co', ref: 'PM-0040', amount: 840,  date: 'Apr 28', method: 'Card' },
    { vendor: 'Slack',            ref: 'PM-0039', amount: 1200, date: 'Apr 26', method: 'Bank Transfer' },
    { vendor: 'Adobe',            ref: 'PM-0038', amount: 960,  date: 'Apr 24', method: 'Card' },
    { vendor: 'Stripe',           ref: 'PM-0037', amount: 2400, date: 'Apr 22', method: 'Bank Transfer' },
  ].forEach(r => db.insert('payments_made', { user_id: userId, entity_id: entityId, ...r }));

  // Vendor Credits
  [
    { vendor: 'Office Supplies Co', num: 'VC-0003', amount: 820,  date: 'Apr 18', status: 'Open',    reason: 'Overpayment refund' },
    { vendor: 'Adobe',              num: 'VC-0002', amount: 480,  date: 'Mar 30', status: 'Applied', reason: 'Subscription downgrade' },
    { vendor: 'AWS',                num: 'VC-0001', amount: 520,  date: 'Mar 12', status: 'Applied', reason: 'Credit for outage' },
  ].forEach(r => db.insert('vendor_credits', { user_id: userId, entity_id: entityId, ...r }));

  // Items (product & service catalog)
  [
    { name: 'Web Development Services', type: 'Service', price: 150,  unit: 'hr',      stock: null, status: 'Active',    sku: 'SVC-001' },
    { name: 'UI/UX Design',             type: 'Service', price: 120,  unit: 'hr',      stock: null, status: 'Active',    sku: 'SVC-002' },
    { name: 'SEO Monthly Retainer',     type: 'Service', price: 2400, unit: 'mo',      stock: null, status: 'Active',    sku: 'SVC-003' },
    { name: 'Laptop Stand Pro',         type: 'Product', price: 89,   unit: 'each',    stock: 34,   status: 'Active',    sku: 'PRD-001' },
    { name: 'Webcam 4K Ultra',          type: 'Product', price: 199,  unit: 'each',    stock: 9,    status: 'Low Stock', sku: 'PRD-002' },
    { name: 'Ergonomic Mouse',          type: 'Product', price: 64,   unit: 'each',    stock: 4,    status: 'Low Stock', sku: 'PRD-003' },
    { name: 'USB-C Hub 7-in-1',         type: 'Product', price: 45,   unit: 'each',    stock: 82,   status: 'Active',    sku: 'PRD-004' },
    { name: 'Mechanical Keyboard',      type: 'Product', price: 149,  unit: 'each',    stock: 28,   status: 'Active',    sku: 'PRD-005' },
    { name: 'Annual Support Plan',      type: 'Service', price: 1800, unit: 'yr',      stock: null, status: 'Active',    sku: 'SVC-004' },
    { name: 'Cloud Hosting Setup',      type: 'Service', price: 500,  unit: 'project', stock: null, status: 'Active',    sku: 'SVC-005' },
  ].forEach(r => db.insert('items', { user_id: userId, entity_id: entityId, ...r }));

  // Settings
  db.upsert('user_settings', 'user_id', userId, { dark_mode: 1, currency: 'USD', show_cents: 0, notif_email: 1, notif_inv: 1, notif_pay: 1 });
}

module.exports = { db, initDB, seedUserData };
