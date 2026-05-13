'use strict';
/**
 * database.js — FinFlow data layer using PostgreSQL (pg)
 * Drop-in replacement for the lowDB version — same API, zero changes to server.js.
 *
 * Required env var:
 *   DATABASE_URL  — postgres connection string
 *                   e.g. postgres://user:pass@host:5432/finflow
 *
 * Install dep:  npm install pg connect-pg-simple
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('[PG] Unexpected pool error', err));

// ── Schema ────────────────────────────────────────────────────────────────────
// One CREATE TABLE per logical table. All share the same shape:
//   id SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER (nullable),
//   data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
//
// Storing the payload in a JSONB `data` column means we don't need to alter
// the schema every time a new field is added — exactly how lowDB behaved.
// user_id and entity_id are pulled out as real columns so they can be indexed.

const TABLES = [
  'users', 'entities', 'invoices', 'expenses', 'customers', 'inventory',
  'payroll', 'personal_transactions', 'goals', 'holdings', 'user_settings',
  'password_resets', 'quotes', 'bills', 'vendors', 'recurring_bills',
  'recurring_invoices', 'sales_receipts', 'payments_received', 'credit_notes',
  'payments_made', 'vendor_credits', 'items', 'timesheet', 'projects',
  'team_members', 'budget_targets',
  'journals', 'chart_of_accounts', 'lock_settings', 'audit_log',
  'documents', 'templates', 'autocat_rules',
];

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const table of TABLES) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id         SERIAL PRIMARY KEY,
          user_id    INTEGER,
          entity_id  INTEGER,
          data       JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Indexes for the hot paths (user_id lookups dominate)
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_${table}_user_id ON ${table}(user_id)
      `);
    }

    // Sessions table (used by connect-pg-simple)
    await client.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid    VARCHAR NOT NULL COLLATE "default",
        sess   JSON NOT NULL,
        expire TIMESTAMPTZ NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire)
    `);

    // ── ACCOUNTANT MARKETPLACE TABLES ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accountants (
        id                  SERIAL PRIMARY KEY,
        user_id             INTEGER UNIQUE,
        email               VARCHAR(255) UNIQUE NOT NULL,
        password_hash       VARCHAR(255) NOT NULL,
        first_name          VARCHAR(100) NOT NULL,
        last_name           VARCHAR(100) NOT NULL,
        firm                VARCHAR(200),
        country             VARCHAR(100),
        specialisation      VARCHAR(100),
        bio                 TEXT,
        experience          VARCHAR(50),
        referral_code       VARCHAR(50) UNIQUE NOT NULL,
        referred_by         INTEGER REFERENCES accountants(id),
        status              VARCHAR(30) DEFAULT 'pending',
        verification_method VARCHAR(30),
        verification_data   JSONB DEFAULT '{}',
        verified_at         TIMESTAMPTZ,
        stripe_account_id   VARCHAR(100),
        stripe_onboarded    BOOLEAN DEFAULT FALSE,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_accountants_email    ON accountants(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_accountants_referral ON accountants(referral_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_accountants_status   ON accountants(status)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_clients (
        id                    SERIAL PRIMARY KEY,
        accountant_id         INTEGER NOT NULL REFERENCES accountants(id),
        user_id               INTEGER NOT NULL,
        status                VARCHAR(30) DEFAULT 'active',
        access_level          VARCHAR(30) DEFAULT 'view',
        referral_month        INTEGER DEFAULT 0,
        referral_months_total INTEGER DEFAULT 1,
        invited_at            TIMESTAMPTZ DEFAULT NOW(),
        activated_at          TIMESTAMPTZ,
        UNIQUE(accountant_id, user_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acc_clients_accountant ON accountant_clients(accountant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acc_clients_user       ON accountant_clients(user_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_earnings (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id),
        client_id     INTEGER,
        type          VARCHAR(30) NOT NULL,
        amount_cents  INTEGER NOT NULL,
        description   TEXT,
        status        VARCHAR(20) DEFAULT 'pending',
        period_month  DATE,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_earnings_accountant ON accountant_earnings(accountant_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_reviews (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id),
        client_id     INTEGER NOT NULL,
        rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment       TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(accountant_id, client_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_accountant ON accountant_reviews(accountant_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_reports (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id),
        reporter_id   INTEGER NOT NULL,
        reason        TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Add rating columns to accountants if not exists
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(100)`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS stripe_onboarded BOOLEAN DEFAULT FALSE`);

    // Admin activity log
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_log (
        id          SERIAL PRIMARY KEY,
        action      VARCHAR(100) NOT NULL,
        target_type VARCHAR(50),
        target_id   INTEGER,
        notes       TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS credentials TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2)`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS packages JSONB DEFAULT '[]'`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS pricing_note TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS has_pricing BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS memberships TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0`);

    // ── END ACCOUNTANT MARKETPLACE TABLES ──────────────────────────────────────

    // AI response cache — keyed by user_id + normalised question, TTL enforced in queries
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_cache (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        question   TEXT NOT NULL,
        answer     TEXT NOT NULL,
        model      VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_cache_user_created ON ai_cache(user_id, created_at)
    `);

    await client.query('COMMIT');
    console.log('[DB] PostgreSQL schema ready');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return pool;
}

// ── Row serialisation helpers ─────────────────────────────────────────────────
// lowDB rows were plain objects; here rows live in the `data` JSONB column
// plus the real id/user_id/entity_id/created_at columns.
// We merge them back into a flat object so server.js never notices.

function rowToObj(pgRow) {
  if (!pgRow) return null;
  return {
    id: pgRow.id,
    user_id: pgRow.user_id,
    entity_id: pgRow.entity_id,
    created_at: pgRow.created_at,
    updated_at: pgRow.updated_at,
    ...pgRow.data,
  };
}

function objToData(obj) {
  // Strip the columns we store outside `data`
  const { id, user_id, entity_id, created_at, updated_at, ...rest } = obj;
  return rest;
}

// ── Public db API (mirrors lowDB version exactly) ─────────────────────────────
const db = {

  // insert(table, row) → { lastInsertRowid, row }
  async insert(table, row) {
    const { user_id = null, entity_id = null, ...rest } = row;
    const data = objToData(rest);
    const res = await pool.query(
      `INSERT INTO ${table} (user_id, entity_id, data)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user_id, entity_id, data]
    );
    const inserted = rowToObj(res.rows[0]);
    return { lastInsertRowid: inserted.id, row: inserted };
  },

  // get(table, filterFn) → row | null
  // For the most common hot path (filter by id + user_id), we hit the index.
  // For everything else we do a full table scan in JS — acceptable at this scale.
  async get(table, filterFn) {
    const res = await pool.query(`SELECT * FROM ${table}`);
    const row = res.rows.map(rowToObj).find(filterFn);
    return row || null;
  },

  // all(table, filterFn?, sortFn?) → row[]
  async all(table, filterFn, sortFn) {
    const res = await pool.query(`SELECT * FROM ${table}`);
    let rows = res.rows.map(rowToObj);
    if (filterFn) rows = rows.filter(filterFn);
    if (sortFn) rows.sort(sortFn);
    return rows;
  },

  // update(table, filterFn, patch | patchFn)
  async update(table, filterFn, patch) {
    const res = await pool.query(`SELECT * FROM ${table}`);
    const toUpdate = res.rows.map(rowToObj).filter(filterFn);
    for (const row of toUpdate) {
      const applied = typeof patch === 'function' ? patch(row) : patch;
      const { user_id, entity_id, id, created_at, updated_at, ...rest } = row;
      const newData = { ...objToData(rest), ...objToData(applied) };
      const newUserId = applied.user_id !== undefined ? applied.user_id : user_id;
      const newEntityId = applied.entity_id !== undefined ? applied.entity_id : entity_id;
      await pool.query(
        `UPDATE ${table} SET data=$1, user_id=$2, entity_id=$3, updated_at=NOW() WHERE id=$4`,
        [newData, newUserId, newEntityId, id]
      );
    }
  },

  // delete(table, filterFn)
  async delete(table, filterFn) {
    const res = await pool.query(`SELECT id FROM ${table}`);
    const allRows = await pool.query(`SELECT * FROM ${table}`);
    const toDelete = allRows.rows.map(rowToObj).filter(filterFn).map(r => r.id);
    if (toDelete.length === 0) return;
    await pool.query(
      `DELETE FROM ${table} WHERE id = ANY($1::int[])`,
      [toDelete]
    );
  },

  // upsert(table, keyField, keyVal, patch) — used for user_settings
  async upsert(table, keyField, keyVal, patch) {
    const res = await pool.query(`SELECT * FROM ${table}`);
    const existing = res.rows.map(rowToObj).find(r => r[keyField] === keyVal);
    if (existing) {
      await db.update(table, r => r[keyField] === keyVal, patch);
    } else {
      await db.insert(table, { [keyField]: keyVal, ...patch });
    }
  },
};

// ── SEED HELPERS (identical logic to lowDB version) ───────────────────────────
async function seedUserData(userId) {
  // Guard: don't seed if user already has data
  const existing = await pool.query(`SELECT id FROM invoices WHERE user_id = $1 LIMIT 1`, [userId]);
  if (existing.rows.length > 0) return;

  const { lastInsertRowid: entityId } = await db.insert('entities', { user_id: userId, name: 'FinFlow Inc.', currency: 'USD', color: '#c9a84c', is_active: 1, sort_order: 0 });

  for (const r of [
    { client: 'RetailCo Ltd',    amount: 8400,  due_date: 'Apr 30', status: 'pending' },
    { client: 'TechStart Inc',   amount: 5000,  due_date: 'May 5',  status: 'paid' },
    { client: 'NovaCorp',        amount: 12000, due_date: 'May 15', status: 'paid' },
    { client: 'Sapphire Media',  amount: 4800,  due_date: 'May 20', status: 'paid' },
    { client: 'Mango & Co',      amount: 2200,  due_date: 'Apr 10', status: 'overdue' },
    { client: 'BlueSky Agency',  amount: 1600,  due_date: 'Apr 14', status: 'overdue' },
    { client: 'Freelance — Dev', amount: 3200,  due_date: 'May 12', status: 'pending' },
  ]) await db.insert('invoices', { user_id: userId, entity_id: entityId, notes: '', ...r });

  for (const r of [
    { description: 'Office rent — April',   category: 'Rent',     amount: 3900, deductible: 'yes',  expense_date: 'Apr 1' },
    { description: 'Google Workspace',      category: 'Software', amount: 420,  deductible: 'yes',  expense_date: 'Apr 2' },
    { description: 'AWS Cloud services',    category: 'Software', amount: 622,  deductible: 'yes',  expense_date: 'Apr 5' },
    { description: 'Team lunch',            category: 'Meals',    amount: 285,  deductible: 'half', expense_date: 'Apr 10' },
    { description: 'Flight — client visit', category: 'Travel',   amount: 680,  deductible: 'yes',  expense_date: 'Apr 14' },
    { description: 'Freelancer — UI dev',   category: 'Salaries', amount: 1200, deductible: 'yes',  expense_date: 'Apr 18' },
    { description: 'Mailchimp marketing',   category: 'Marketing',amount: 149,  deductible: 'yes',  expense_date: 'Apr 20' },
  ]) await db.insert('expenses', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { fname: 'Emma',   lname: 'Richardson', company: 'RetailCo Ltd',   industry: 'Retail',     email: 'emma@retailco.com',   phone: '+1 555-0101', revenue: 218400, status: 'active', notes: 'Top client.' },
    { fname: 'Marcus', lname: 'Chen',       company: 'TechStart Inc',  industry: 'Technology', email: 'marcus@techstart.io', phone: '+1 555-0202', revenue: 149400, status: 'active', notes: 'Fast-growing startup.' },
    { fname: 'Priya',  lname: 'Kapoor',     company: 'NovaCorp',       industry: 'Finance',    email: 'priya@novacorp.com',  phone: '+1 555-0303', revenue: 144000, status: 'active', notes: 'Always pays on time.' },
    { fname: 'James',  lname: 'Okafor',     company: 'Mango & Co',     industry: 'Retail',     email: 'james@mango.co',      phone: '+1 555-0404', revenue: 26400,  status: 'active', notes: 'Overdue Apr invoice.' },
    { fname: 'Aria',   lname: 'Santos',     company: 'BlueSky Agency', industry: 'Media',      email: 'aria@bluesky.agency', phone: '+1 555-0505', revenue: 19200,  status: 'active', notes: 'Overdue since Apr 14.' },
  ]) await db.insert('customers', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { sku: '#1042', name: 'Wireless Headset Pro', units: 142, max_units: 200, cost: 60,  low_stock: 0 },
    { sku: '#1043', name: 'USB-C Hub 8-in-1',     units: 88,  max_units: 200, cost: 50,  low_stock: 0 },
    { sku: '#1044', name: 'Mechanical Keyboard',  units: 31,  max_units: 200, cost: 100, low_stock: 0 },
    { sku: '#1045', name: 'Webcam 4K Ultra',      units: 9,   max_units: 200, cost: 80,  low_stock: 1 },
    { sku: '#1046', name: 'Laptop Stand Alu.',    units: 67,  max_units: 200, cost: 40,  low_stock: 0 },
    { sku: '#1047', name: 'Ergonomic Mouse',      units: 4,   max_units: 200, cost: 60,  low_stock: 1 },
  ]) await db.insert('inventory', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { fname: 'Jordan', lname: 'Mills',  role: 'Dev Lead',  emp_type: 'Full-time',  gross: 5200, tax_rate: 20, av_class: 'av-blue',   is_owner: 0 },
    { fname: 'Sofia',  lname: 'Arenas', role: 'Designer',  emp_type: 'Full-time',  gross: 3800, tax_rate: 20, av_class: 'av-purple', is_owner: 0 },
    { fname: 'Raj',    lname: 'Kapoor', role: 'Sales',     emp_type: 'Full-time',  gross: 3500, tax_rate: 20, av_class: 'av-green',  is_owner: 0 },
    { fname: 'Leila',  lname: 'Torres', role: 'Marketing', emp_type: 'Part-time',  gross: 2100, tax_rate: 20, av_class: 'av-amber',  is_owner: 0 },
    { fname: 'Ben',    lname: 'Nwosu',  role: 'Backend',   emp_type: 'Contractor', gross: 1132, tax_rate: 0,  av_class: 'av-teal',   is_owner: 0 },
  ]) await db.insert('payroll', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
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
  ]) await db.insert('personal_transactions', { user_id: userId, ...r });

  for (const r of [
    { name: 'Emergency fund',       current_val: 12000, target_val: 15000, monthly_contrib: 500,  color: 'var(--green)' },
    { name: 'House deposit',        current_val: 28000, target_val: 60000, monthly_contrib: 1500, color: 'var(--acc)' },
    { name: 'Investment portfolio', current_val: 44500, target_val: 50000, monthly_contrib: 1800, color: 'var(--acc-light)' },
  ]) await db.insert('goals', { user_id: userId, ...r });

  for (const r of [
    { ticker: 'AAPL',  name: 'Apple Inc.',      asset_type: 'Stock', shares: 85,  cost_per: 148.20, price: 192.35, dividend: 0.96, color: '#c9a84c' },
    { ticker: 'MSFT',  name: 'Microsoft Corp.', asset_type: 'Stock', shares: 40,  cost_per: 310.50, price: 415.80, dividend: 3.00, color: '#5aaa9e' },
    { ticker: 'VTI',   name: 'Vanguard Total',  asset_type: 'ETF',   shares: 120, cost_per: 218.00, price: 242.10, dividend: 3.20, color: '#9e8fbf' },
    { ticker: 'BRK.B', name: 'Berkshire B',     asset_type: 'Stock', shares: 30,  cost_per: 320.00, price: 404.50, dividend: 0,    color: '#7db87d' },
    { ticker: 'NVDA',  name: 'NVIDIA Corp.',    asset_type: 'Stock', shares: 25,  cost_per: 480.00, price: 875.40, dividend: 0.16, color: '#d4964a' },
    { ticker: 'CASH',  name: 'Cash & MM',       asset_type: 'Cash',  shares: 1,   cost_per: 8000,   price: 8000,   dividend: 0.05, color: '#5a4e3a' },
  ]) await db.insert('holdings', { user_id: userId, ...r });

  for (const r of [
    { client: 'RetailCo Ltd',    num: 'QT-0042', amount: 28400, expiry_date: 'May 15', status: 'pending',  notes: '' },
    { client: 'TechStart Inc',   num: 'QT-0041', amount: 9600,  expiry_date: 'May 10', status: 'accepted', notes: '' },
    { client: 'Mango & Co',      num: 'QT-0040', amount: 4800,  expiry_date: 'Apr 30', status: 'accepted', notes: '' },
    { client: 'BlueSky Agency',  num: 'QT-0039', amount: 14200, expiry_date: 'May 20', status: 'pending',  notes: '' },
    { client: 'Nova Systems',    num: 'QT-0038', amount: 7800,  expiry_date: 'Apr 25', status: 'declined', notes: '' },
    { client: 'GreenLeaf Ltd',   num: 'QT-0037', amount: 5200,  expiry_date: 'May 1',  status: 'accepted', notes: '' },
  ]) await db.insert('quotes', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { name: 'AWS',                contact: 'billing@aws.com',       category: 'Infrastructure', owing: 6200, ytd_paid: 74400, status: 'active' },
    { name: 'Stripe',             contact: 'support@stripe.com',    category: 'Payments',       owing: 0,    ytd_paid: 4200,  status: 'active' },
    { name: 'Office Prime',       contact: 'lease@officeprime.com', category: 'Rent',           owing: 3800, ytd_paid: 45600, status: 'active' },
    { name: 'Adobe Creative',     contact: 'accounts@adobe.com',    category: 'Software',       owing: 840,  ytd_paid: 10080, status: 'active' },
    { name: 'Slack Technologies', contact: 'billing@slack.com',     category: 'Software',       owing: 420,  ytd_paid: 5040,  status: 'active' },
    { name: 'FedEx',              contact: 'fedex@fedex.com',       category: 'Shipping',       owing: 0,    ytd_paid: 2400,  status: 'active' },
  ]) await db.insert('vendors', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { vendor: 'AWS',                num: 'BILL-0042', amount: 6200, due_date: 'Apr 30', status: 'overdue' },
    { vendor: 'Office Prime',       num: 'BILL-0041', amount: 3800, due_date: 'May 1',  status: 'due_soon' },
    { vendor: 'Adobe Creative',     num: 'BILL-0040', amount: 840,  due_date: 'May 5',  status: 'unpaid' },
    { vendor: 'Slack Technologies', num: 'BILL-0039', amount: 420,  due_date: 'May 8',  status: 'unpaid' },
    { vendor: 'FedEx',              num: 'BILL-0038', amount: 380,  due_date: 'May 12', status: 'unpaid' },
    { vendor: 'AWS',                num: 'BILL-0037', amount: 6200, due_date: 'Mar 30', status: 'paid' },
  ]) await db.insert('bills', { user_id: userId, entity_id: entityId, notes: '', ...r });

  for (const r of [
    { vendor: 'AWS',                amount: 6200, frequency: 'Monthly', next_run: 'May 1',  status: 'active' },
    { vendor: 'Office Prime',       amount: 3800, frequency: 'Monthly', next_run: 'May 1',  status: 'active' },
    { vendor: 'Adobe Creative',     amount: 840,  frequency: 'Monthly', next_run: 'May 5',  status: 'active' },
    { vendor: 'Slack Technologies', amount: 420,  frequency: 'Monthly', next_run: 'May 8',  status: 'active' },
  ]) await db.insert('recurring_bills', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { client: 'RetailCo Ltd',   amount: 12800, frequency: 'Monthly',   next_run: 'May 1',  status: 'active' },
    { client: 'TechStart Inc',  amount: 4800,  frequency: 'Monthly',   next_run: 'May 1',  status: 'active' },
    { client: 'BlueSky Agency', amount: 3200,  frequency: 'Monthly',   next_run: 'May 5',  status: 'active' },
    { client: 'Nova Systems',   amount: 4200,  frequency: 'Quarterly', next_run: 'Jul 1',  status: 'active' },
    { client: 'GreenLeaf Ltd',  amount: 1800,  frequency: 'Monthly',   next_run: 'May 10', status: 'paused' },
    { client: 'Mango & Co',     amount: 1600,  frequency: 'Monthly',   next_run: 'May 1',  status: 'active' },
  ]) await db.insert('recurring_invoices', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { customer: 'Walk-in Customer', num: 'SR-0124', amount: 840,  date: 'Apr 28', method: 'Card' },
    { customer: 'RetailCo',         num: 'SR-0123', amount: 4200, date: 'Apr 27', method: 'Bank Transfer' },
    { customer: 'BlueWave Agency',  num: 'SR-0122', amount: 2400, date: 'Apr 26', method: 'Card' },
    { customer: 'Walk-in Customer', num: 'SR-0121', amount: 315,  date: 'Apr 25', method: 'Cash' },
    { customer: 'Nova Systems',     num: 'SR-0120', amount: 3800, date: 'Apr 24', method: 'Card' },
  ]) await db.insert('sales_receipts', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { customer: 'RetailCo',        invoice_ref: 'INV-2026-009', amount: 12800, date: 'Apr 28', method: 'Bank Transfer' },
    { customer: 'TechStart Ltd',   invoice_ref: 'INV-2026-008', amount: 9600,  date: 'Apr 26', method: 'Card' },
    { customer: 'Mango & Co',      invoice_ref: 'INV-2026-007', amount: 4800,  date: 'Apr 24', method: 'Bank Transfer' },
    { customer: 'BlueWave Agency', invoice_ref: 'INV-2026-006', amount: 7200,  date: 'Apr 20', method: 'Card' },
    { customer: 'Nova Systems',    invoice_ref: 'INV-2026-005', amount: 5400,  date: 'Apr 18', method: 'Bank Transfer' },
  ]) await db.insert('payments_received', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { customer: 'Mango & Co',      num: 'CN-0008', amount: 420,  date: 'Apr 20', status: 'Open',    reason: 'Return' },
    { customer: 'RetailCo',        num: 'CN-0007', amount: 780,  date: 'Apr 14', status: 'Applied', reason: 'Discount adjustment' },
    { customer: 'BlueWave Agency', num: 'CN-0006', amount: 1200, date: 'Mar 28', status: 'Open',    reason: 'Service credit' },
    { customer: 'Nova Systems',    num: 'CN-0005', amount: 440,  date: 'Mar 15', status: 'Applied', reason: 'Billing error' },
  ]) await db.insert('credit_notes', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { vendor: 'AWS',                ref: 'PM-0041', amount: 6200, date: 'Apr 30', method: 'Bank Transfer' },
    { vendor: 'Office Supplies Co', ref: 'PM-0040', amount: 840,  date: 'Apr 28', method: 'Card' },
    { vendor: 'Slack',              ref: 'PM-0039', amount: 1200, date: 'Apr 26', method: 'Bank Transfer' },
    { vendor: 'Adobe',              ref: 'PM-0038', amount: 960,  date: 'Apr 24', method: 'Card' },
    { vendor: 'Stripe',             ref: 'PM-0037', amount: 2400, date: 'Apr 22', method: 'Bank Transfer' },
  ]) await db.insert('payments_made', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { vendor: 'Office Supplies Co', num: 'VC-0003', amount: 820,  date: 'Apr 18', status: 'Open',    reason: 'Overpayment refund' },
    { vendor: 'Adobe',              num: 'VC-0002', amount: 480,  date: 'Mar 30', status: 'Applied', reason: 'Subscription downgrade' },
    { vendor: 'AWS',                num: 'VC-0001', amount: 520,  date: 'Mar 12', status: 'Applied', reason: 'Credit for outage' },
  ]) await db.insert('vendor_credits', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
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
  ]) await db.insert('items', { user_id: userId, entity_id: entityId, ...r });

  for (const r of [
    { employee: 'Jordan Mills',  project: 'RetailCo Portal',    date: '2026-04-28', hours: 6.5, billable: 'Yes', rate: 120 },
    { employee: 'Sofia Arenas',  project: 'TechStart Rebrand',  date: '2026-04-28', hours: 4,   billable: 'Yes', rate: 100 },
    { employee: 'Raj Kapoor',    project: 'Sales Calls',        date: '2026-04-27', hours: 8,   billable: 'No',  rate: 0   },
    { employee: 'Jordan Mills',  project: 'NovaCorp API',       date: '2026-04-26', hours: 7,   billable: 'Yes', rate: 120 },
    { employee: 'Leila Torres',  project: 'Marketing Campaign', date: '2026-04-25', hours: 5,   billable: 'No',  rate: 0   },
    { employee: 'Ben Nwosu',     project: 'Backend Infra',      date: '2026-04-25', hours: 8,   billable: 'Yes', rate: 95  },
    { employee: 'Sofia Arenas',  project: 'BlueSky Redesign',   date: '2026-04-24', hours: 6,   billable: 'Yes', rate: 100 },
  ]) await db.insert('timesheet', { user_id: userId, ...r });

  for (const r of [
    { name: 'RetailCo Portal v2',       client: 'RetailCo Ltd',  budget: 32000, billed: 12800, hours: 128, status: 'In Progress', progress: 40 },
    { name: 'TechStart Rebrand',        client: 'TechStart Inc', budget: 18000, billed: 18000, hours: 180, status: 'Completed',   progress: 100 },
    { name: 'Nova Analytics Dashboard', client: 'NovaCorp',      budget: 22000, billed: 8800,  hours: 88,  status: 'In Progress', progress: 40 },
    { name: 'GreenLeaf SEO Audit',      client: 'GreenLeaf Ltd', budget: 4800,  billed: 4800,  hours: 40,  status: 'Completed',   progress: 100 },
    { name: 'Mango & Co CRM',           client: 'Mango & Co',    budget: 9600,  billed: 2400,  hours: 24,  status: 'In Progress', progress: 25 },
    { name: 'Internal Dashboard v2',    client: 'Internal',      budget: 0,     billed: 0,     hours: 48,  status: 'On Hold',     progress: 60 },
  ]) await db.insert('projects', { user_id: userId, entity_id: entityId, ...r });

  await db.upsert('user_settings', 'user_id', userId, { dark_mode: 1, currency: 'USD', show_cents: 0, notif_email: 1, notif_inv: 1, notif_pay: 1 });

  // Chart of accounts seed
  for (const r of [
    { code: '1010', name: 'Checking Account',         category: 'Assets',      nature: 'Debit',  balance: 98420 },
    { code: '1020', name: 'Savings Account',           category: 'Assets',      nature: 'Debit',  balance: 38200 },
    { code: '1100', name: 'Accounts Receivable',       category: 'Assets',      nature: 'Debit',  balance: 9150  },
    { code: '1200', name: 'Inventory',                 category: 'Assets',      nature: 'Debit',  balance: 34200 },
    { code: '1500', name: 'Equipment',                 category: 'Assets',      nature: 'Debit',  balance: 28000 },
    { code: '2000', name: 'Accounts Payable',          category: 'Liabilities', nature: 'Credit', balance: 14200 },
    { code: '2100', name: 'Credit Card',               category: 'Liabilities', nature: 'Credit', balance: 4800  },
    { code: '2200', name: 'Tax Payable',               category: 'Liabilities', nature: 'Credit', balance: 19200 },
    { code: '3000', name: "Owner's Equity",            category: 'Equity',      nature: 'Credit', balance: 186200 },
    { code: '3100', name: 'Retained Earnings',         category: 'Equity',      nature: 'Credit', balance: 238950 },
    { code: '4000', name: 'Service Revenue',           category: 'Revenue',     nature: 'Credit', balance: 469200 },
    { code: '4100', name: 'Product Sales',             category: 'Revenue',     nature: 'Credit', balance: 0     },
    { code: '5000', name: 'Salaries & Wages',          category: 'Expenses',    nature: 'Debit',  balance: 157200 },
    { code: '5100', name: 'Rent',                      category: 'Expenses',    nature: 'Debit',  balance: 45600 },
    { code: '5200', name: 'Software Subscriptions',    category: 'Expenses',    nature: 'Debit',  balance: 12000 },
    { code: '5300', name: 'Marketing',                 category: 'Expenses',    nature: 'Debit',  balance: 15450 },
  ]) await db.insert('chart_of_accounts', { user_id: userId, entity_id: entityId, ...r });

  // Invoice & email template seeds
  for (const r of [
    { name: 'Classic Professional', type: 'invoice', preview: 'Clean two-column layout',   is_default: 1, accent_color: '#c8a44a' },
    { name: 'Modern Minimal',       type: 'invoice', preview: 'Bold header, clean lines',  is_default: 0, accent_color: '#5aaa9e' },
    { name: 'Compact Receipt',      type: 'invoice', preview: 'Single page receipt format', is_default: 0, accent_color: '#9e8fbf' },
    { name: 'Invoice Reminder (7 days)', type: 'email', preview: 'Auto — 7 days after due',  is_default: 0, accent_color: '' },
    { name: 'Payment Received',          type: 'email', preview: 'Auto — on payment',         is_default: 0, accent_color: '' },
  ]) await db.insert('templates', { user_id: userId, ...r });

  // Auto-categorise rules seed
  for (const r of [
    { keyword: 'aws',       match_type: 'vendor',      category: 'Software',    enabled: 1 },
    { keyword: 'google',    match_type: 'vendor',      category: 'Software',    enabled: 1 },
    { keyword: 'stripe',    match_type: 'vendor',      category: 'Payments',    enabled: 1 },
    { keyword: 'flight',    match_type: 'description', category: 'Travel',      enabled: 1 },
    { keyword: 'uber',      match_type: 'description', category: 'Travel',      enabled: 1 },
    { keyword: 'lunch',     match_type: 'description', category: 'Meals',       enabled: 1 },
  ]) await db.insert('autocat_rules', { user_id: userId, ...r });
}

module.exports = { db, initDB, seedUserData, pool };
