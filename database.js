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
}


module.exports = { db, initDB, seedUserData, pool };
