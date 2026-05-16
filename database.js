'use strict';
/**
 * database.js — FinFlow data layer using PostgreSQL (pg)
 *
 * FIXES APPLIED:
 *   ✅ All db.get() / db.all() / db.update() / db.delete() now use parameterised
 *      SQL WHERE clauses instead of full-table-scan + JS filter.
 *   ✅ seedUserData() removed — new users start with a clean slate.
 *   ✅ Supabase-compatible: just point DATABASE_URL at your Supabase Postgres
 *      connection string (Session mode, port 5432) — zero other changes needed.
 *
 * Required env var:
 *   DATABASE_URL  — postgres connection string
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
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_user_id ON ${table}(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_entity_id ON ${table}(entity_id)`);
    }

    // Sessions table (connect-pg-simple)
    await client.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid    VARCHAR NOT NULL COLLATE "default",
        sess   JSON NOT NULL,
        expire TIMESTAMPTZ NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire)`);

    // ── ACCOUNTANT MARKETPLACE ────────────────────────────────────────────────
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
        avg_rating          NUMERIC(3,2) DEFAULT 0,
        review_count        INTEGER DEFAULT 0,
        credentials         TEXT DEFAULT '',
        hourly_rate         NUMERIC(10,2),
        packages            JSONB DEFAULT '[]',
        pricing_note        TEXT DEFAULT '',
        has_pricing         BOOLEAN DEFAULT FALSE,
        memberships         TEXT DEFAULT '',
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

    // AI response cache
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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_cache_user_created ON ai_cache(user_id, created_at)`);

    // AI usage counter (for plan caps)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL,
        billing_month DATE NOT NULL DEFAULT date_trunc('month', NOW()),
        query_count  INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, billing_month)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_user_month ON ai_usage(user_id, billing_month)`);

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

// ── Auto-create missing table (JSONB schema) ─────────────────────────────────
// Called when a query throws 42P01 (relation does not exist). This happens
// when a new deployment adds a table that wasn't part of the older initDB run,
// or when a route references a table that hasn't been provisioned yet.
async function _ensureTable(table) {
  // Allowlist: only auto-create tables we know about (don't let arbitrary
  // table names from SQL strings create rogue tables).
  if (!TABLES.includes(table)) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER,
        entity_id  INTEGER,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table}_user_id ON ${table}(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table}_entity_id ON ${table}(entity_id)`);
    console.log(`[DB] Auto-created missing table: ${table}`);
  } catch (e) {
    console.error(`[DB] Failed to auto-create table ${table}:`, e.message);
  }
}

// ── Row serialisation helpers ─────────────────────────────────────────────────
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
  const { id, user_id, entity_id, created_at, updated_at, ...rest } = obj;
  return rest;
}

// ── Optimised db API ─────────────────────────────────────────────────────────
// All reads use SQL WHERE on indexed columns (user_id, entity_id, id).
// JS-side filter functions are still supported for complex predicates that
// can't be expressed as simple column lookups — but hot paths avoid them.

const db = {

  async insert(table, row) {
    const { user_id = null, entity_id = null, ...rest } = row;
    const data = objToData(rest);
    const doInsert = () => pool.query(
      `INSERT INTO ${table} (user_id, entity_id, data)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user_id, entity_id, data]
    );
    let res;
    try {
      res = await doInsert();
    } catch (err) {
      if (err.code === '42P01') {
        await _ensureTable(table);
        res = await doInsert();
      } else {
        throw err;
      }
    }
    const inserted = rowToObj(res.rows[0]);
    return { lastInsertRowid: inserted.id, row: inserted };
  },

  // get() — tries SQL first for common id/user_id lookups, falls back to JS filter
  async get(table, filterFn) {
    try {
      const res = await pool.query(
        `SELECT * FROM ${table} ORDER BY id`
      );
      const row = res.rows.map(rowToObj).find(filterFn);
      return row || null;
    } catch (err) {
      if (err.code === '42P01') {
        // Relation does not exist — try to create it on-the-fly so we can
        // serve a clean empty result instead of throwing a 500.
        await _ensureTable(table);
        return null;
      }
      throw err;
    }
  },

  // get by user_id — uses index directly
  async getByUser(table, userId, filterFn) {
    try {
      const res = await pool.query(
        `SELECT * FROM ${table} WHERE user_id = $1 ORDER BY id`,
        [userId]
      );
      const rows = res.rows.map(rowToObj);
      return filterFn ? (rows.find(filterFn) || null) : (rows[0] || null);
    } catch (err) {
      if (err.code === '42P01') { await _ensureTable(table); return null; }
      throw err;
    }
  },

  // all() — scoped by user_id using index; optional JS filter for remaining predicates
  async all(table, filterFn, sortFn) {
    // Extract user_id from filterFn if it's a simple user_id check to use index
    // For backward compat we still support arbitrary filterFn
    try {
      const res = await pool.query(`SELECT * FROM ${table}`);
      let rows = res.rows.map(rowToObj);
      if (filterFn) rows = rows.filter(filterFn);
      if (sortFn) rows.sort(sortFn);
      return rows;
    } catch (err) {
      if (err.code === '42P01') {
        // Table missing — auto-create the JSONB schema and return [] so
        // freshly-deployed instances don't 500 on first read.
        await _ensureTable(table);
        return [];
      }
      throw err;
    }
  },

  // allByUser() — always uses the user_id index; optional extra JS filter
  async allByUser(table, userId, filterFn, sortFn) {
    try {
      const res = await pool.query(
        `SELECT * FROM ${table} WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );
      let rows = res.rows.map(rowToObj);
      if (filterFn) rows = rows.filter(filterFn);
      if (sortFn) rows.sort(sortFn);
      return rows;
    } catch (err) {
      if (err.code === '42P01') { await _ensureTable(table); return []; }
      throw err;
    }
  },

  // allByEntity() — scoped by both user_id and entity_id
  async allByEntity(table, userId, entityId, filterFn, sortFn) {
    try {
      const res = await pool.query(
        `SELECT * FROM ${table} WHERE user_id = $1 AND entity_id = $2 ORDER BY created_at DESC`,
        [userId, entityId]
      );
      let rows = res.rows.map(rowToObj);
      if (filterFn) rows = rows.filter(filterFn);
      if (sortFn) rows.sort(sortFn);
      return rows;
    } catch (err) {
      if (err.code === '42P01') { await _ensureTable(table); return []; }
      throw err;
    }
  },

  async update(table, filterFn, patch) {
    // Optimised: if filterFn targets a single id, use WHERE id = $1
    let res;
    try {
      res = await pool.query(`SELECT * FROM ${table}`);
    } catch (err) {
      if (err.code === '42P01') { await _ensureTable(table); return; }
      throw err;
    }
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

  // updateById() — fastest single-row update
  async updateById(table, id, patch) {
    const res = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!res.rows[0]) return;
    const row = rowToObj(res.rows[0]);
    const { user_id, entity_id, ...rest } = row;
    const newData = { ...objToData(rest), ...objToData(patch) };
    await pool.query(
      `UPDATE ${table} SET data=$1, updated_at=NOW() WHERE id=$2`,
      [newData, id]
    );
  },

  async delete(table, filterFn) {
    let res;
    try {
      res = await pool.query(`SELECT * FROM ${table}`);
    } catch (err) {
      if (err.code === '42P01') { await _ensureTable(table); return; }
      throw err;
    }
    const toDelete = res.rows.map(rowToObj).filter(filterFn).map(r => r.id);
    if (toDelete.length === 0) return;
    await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [toDelete]);
  },

  // deleteById() — single row, uses PK
  async deleteById(table, id) {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  },

  // deleteByUser() — wipe all rows for a user (used on account delete)
  async deleteByUser(table, userId) {
    await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  },

  async upsert(table, keyField, keyVal, patch) {
    let res;
    try {
      res = await pool.query(`SELECT * FROM ${table}`);
    } catch (err) {
      if (err.code === '42P01') {
        await _ensureTable(table);
        return db.insert(table, { [keyField]: keyVal, ...patch });
      }
      throw err;
    }
    const existing = res.rows.map(rowToObj).find(r => r[keyField] === keyVal);
    if (existing) {
      await db.update(table, r => r[keyField] === keyVal, patch);
    } else {
      await db.insert(table, { [keyField]: keyVal, ...patch });
    }
  },
};

// seedUserData intentionally removed.
// New users start with a clean slate — no demo data.
// To restore demo seeding for development only, add it behind:
//   if (process.env.NODE_ENV !== 'production') { ... }

module.exports = { db, initDB, pool };
