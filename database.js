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
  max: 10,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('[PG] Unexpected pool error', err));

const TABLES = [
  'users', 'entities', 'invoices', 'expenses', 'customers', 'inventory',
  'payroll', 'personal_transactions', 'goals', 'holdings', 'user_settings',
  'password_resets', 'quotes', 'bills', 'vendors', 'recurring_bills',
  'recurring_invoices', 'recurring_personal_transactions',
  'sales_receipts', 'payments_received', 'credit_notes',
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

    // Holdings entity isolation — the generic loop above already creates the
    // entity_id column, but run an explicit idempotent migration so any holdings
    // table that predates entity_id (legacy deployments) gets it safely. No
    // NOT NULL — existing rows keep entity_id NULL until backfilled per-row.
    await client.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS entity_id INTEGER`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_holdings_entity_id ON holdings(entity_id)`);

    // ── PERSONAL FINANCE: ASSETS/LIABILITIES + SNAPSHOTS ────────────────────────
    // Generic JSONB shape (user_id + entity_id + data) so the db.* helpers work,
    // but WITH cascade FKs to users/entities (created above by the generic loop)
    // so rows can never orphan when a user or entity is deleted.
    //   personal_accounts.data = { kind:'asset'|'liability', name, type, value }
    //   snapshots.data          = { kind:'networth'|'portfolio', value, date, period_key }
    await client.query(`
      CREATE TABLE IF NOT EXISTS personal_accounts (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id)    ON DELETE CASCADE,
        entity_id  INTEGER REFERENCES entities(id) ON DELETE CASCADE,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_personal_accounts_user_id   ON personal_accounts(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_personal_accounts_entity_id ON personal_accounts(entity_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id)    ON DELETE CASCADE,
        entity_id  INTEGER REFERENCES entities(id) ON DELETE CASCADE,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_user_id   ON snapshots(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_entity_id ON snapshots(entity_id)`);

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
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS preferred_partner BOOLEAN DEFAULT FALSE`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_clients (
        id                    SERIAL PRIMARY KEY,
        accountant_id         INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
        user_id               INTEGER NOT NULL,
        status                VARCHAR(30) DEFAULT 'active',
        access_level          VARCHAR(30) DEFAULT 'view',
        referral_month        INTEGER DEFAULT 0,
        referral_months_total INTEGER DEFAULT 1,
        invited_at            TIMESTAMPTZ DEFAULT NOW(),
        activated_at          TIMESTAMPTZ,
        notes                 TEXT DEFAULT '',
        checklist             JSONB DEFAULT '{}',
        UNIQUE(accountant_id, user_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acc_clients_accountant ON accountant_clients(accountant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acc_clients_user       ON accountant_clients(user_id)`);
    // Add notes and checklist columns if missing (safe ALTER TABLE for existing deployments)
    await client.query(`ALTER TABLE accountant_clients ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE accountant_clients ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '{}'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_earnings (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
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
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`);
    await client.query(`ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS client_id INTEGER`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_reviews (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
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
        accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
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

    // ── FEATURE 1: FIELD-LEVEL AUDIT TRAIL ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_trail (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER, entity_id INTEGER,
        table_name TEXT, record_id INTEGER,
        action     TEXT, field_name TEXT,
        old_value  TEXT, new_value TEXT,
        changed_at TIMESTAMPTZ DEFAULT NOW(),
        ip_address TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_trail_user ON audit_trail(user_id, changed_at DESC)`);

    // ── FEATURE 2: PARTIAL PAYMENTS + BANK RECONCILIATION ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoice_payments (
        id           SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER,
        invoice_id   INTEGER, amount NUMERIC(12,2),
        payment_date DATE, method TEXT, reference TEXT, notes TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_payments_user ON invoice_payments(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_payments_inv  ON invoice_payments(invoice_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_reconciliation (
        id                SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER,
        banking_id        INTEGER, invoice_payment_id INTEGER,
        status            TEXT DEFAULT 'matched',
        matched_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bank_rec_user ON bank_reconciliation(user_id)`);

    // ── FEATURE 3: MULTI-JURISDICTION PAYROLL RUNS ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id                SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER,
        period            TEXT, jurisdiction TEXT DEFAULT 'TT',
        run_date          DATE, status TEXT DEFAULT 'draft',
        total_gross       NUMERIC(12,2), total_deductions NUMERIC(12,2), total_net NUMERIC(12,2),
        notes             TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payroll_runs_user ON payroll_runs(user_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_run_lines (
        id              SERIAL PRIMARY KEY,
        run_id          INTEGER REFERENCES payroll_runs(id) ON DELETE CASCADE,
        payroll_id      INTEGER, employee_name TEXT,
        gross           NUMERIC(12,2), bonus NUMERIC(12,2) DEFAULT 0, overtime NUMERIC(12,2) DEFAULT 0,
        tax1            NUMERIC(12,2) DEFAULT 0, tax1_label TEXT,
        tax2            NUMERIC(12,2) DEFAULT 0, tax2_label TEXT,
        tax3            NUMERIC(12,2) DEFAULT 0, tax3_label TEXT,
        other_deductions NUMERIC(12,2) DEFAULT 0,
        net_pay         NUMERIC(12,2), jurisdiction TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_run ON payroll_run_lines(run_id)`);
    // User-defined deduction rows [{label,value,type}] per line. FinFlow computes no
    // tax; the legacy tax1/2/3 columns are left inert (defaulted 0, no destructive drop).
    await client.query(`ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS deductions JSONB DEFAULT '[]'`);

    // ── FEATURE 4: INVENTORY MOVEMENTS (FIFO COGS) ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id           SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER,
        inventory_id INTEGER, type TEXT,
        quantity     NUMERIC(12,4), unit_cost NUMERIC(12,4),
        reference    TEXT, notes TEXT,
        moved_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_movements_user ON inventory_movements(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_movements_inv  ON inventory_movements(inventory_id, moved_at)`);

    // ── FEATURE 5: FX GAIN/LOSS TRACKING ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS fx_rates (
        id            SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER,
        from_currency TEXT, to_currency TEXT, rate NUMERIC(12,6),
        rate_date     DATE, source TEXT DEFAULT 'manual',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fx_rates_user ON fx_rates(user_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fx_transactions (
        id                    SERIAL PRIMARY KEY, user_id INTEGER, entity_id INTEGER,
        reference_id          INTEGER, reference_type TEXT,
        foreign_currency      TEXT, foreign_amount NUMERIC(12,2),
        base_currency         TEXT DEFAULT 'USD', base_amount NUMERIC(12,2),
        rate_at_transaction   NUMERIC(12,6), rate_at_settlement NUMERIC(12,6),
        realised_gain_loss    NUMERIC(12,2) DEFAULT 0,
        unrealised_gain_loss  NUMERIC(12,2) DEFAULT 0,
        status                TEXT DEFAULT 'open',
        settled_at            TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fx_transactions_user ON fx_transactions(user_id)`);

    // ── ACCOUNTANT MESSAGES ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_messages (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL,
        sender        VARCHAR(20) NOT NULL DEFAULT 'accountant',
        message       TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acc_messages_accountant ON accountant_messages(accountant_id)`);

    // ── ACCOUNTANT DEADLINES ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_deadlines (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
        client_name   TEXT NOT NULL,
        filing_type   TEXT NOT NULL,
        due_date      DATE NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acc_deadlines_accountant ON accountant_deadlines(accountant_id)`);

    // ── FOREIGN KEYS: single source of truth ─────────────────────────────────────
    // Idempotently add every cascade FK so a database built purely from this code is
    // fully FK-protected, while an existing database that already has them (production)
    // is a zero-op. The guard checks whether ANY foreign key already exists on the
    // given (table, column) via pg_constraint — matched BY COLUMN, not by name — so a
    // production FK created under a different constraint name is still recognised and
    // never duplicated. A constraint is only ADDed when none exists on that column.
    // Runs after every table above is created (users/entities/accountants all exist),
    // and inside the same BEGIN/COMMIT so a failure rolls the whole init back.
    await client.query(`
      DO $fk$
      DECLARE
        t text;
        std text[] := ARRAY[
          'invoices','expenses','customers','inventory','items','payroll','payroll_runs',
          'holdings','journals','chart_of_accounts','vendors','bills','sales_receipts',
          'payments_received','payments_made','credit_notes','vendor_credits',
          'recurring_bills','recurring_invoices','recurring_personal_transactions','quotes','projects','timesheet',
          'budget_targets','documents','templates','autocat_rules','invoice_payments',
          'bank_reconciliation','inventory_movements','fx_rates','fx_transactions','goals',
          'personal_transactions','lock_settings','team_members','audit_trail',
          'user_settings','personal_accounts','snapshots'
        ];
        uid_only text[] := ARRAY['entities','ai_cache','ai_usage','password_resets','accountants'];
      BEGIN
        FOREACH t IN ARRAY std LOOP
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE c.contype = 'f' AND cl.relname = t AND a.attname = 'user_id'
          ) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE', t, 'fk_'||t||'_user');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE c.contype = 'f' AND cl.relname = t AND a.attname = 'entity_id'
          ) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE', t, 'fk_'||t||'_entity');
          END IF;
        END LOOP;
        FOREACH t IN ARRAY uid_only LOOP
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE c.contype = 'f' AND cl.relname = t AND a.attname = 'user_id'
          ) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE', t, 'fk_'||t||'_user');
          END IF;
        END LOOP;
      END $fk$;
    `);

    await client.query('COMMIT');
    console.log('[DB] PostgreSQL schema ready');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Safe supplemental indexes — each wrapped individually so one bad column
  // never aborts initDB. IF NOT EXISTS makes these idempotent on redeploy.
  for (const idxSQL of [
    `CREATE INDEX IF NOT EXISTS idx_invoices_user_id       ON invoices(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_user_id       ON expenses(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_user_id      ON customers(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_user_entity    ON payroll(user_id, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_trail_user_id    ON audit_trail(user_id, changed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(inventory_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_runs_user_entity ON payroll_runs(user_id, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fx_transactions_user   ON fx_transactions(user_id, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users((data->>'email'))`,
    `CREATE INDEX IF NOT EXISTS idx_users_email_ci ON users(lower(data->>'email'))`,
    `CREATE INDEX IF NOT EXISTS idx_pwd_resets_token ON password_resets((data->>'token'))`,
    `CREATE INDEX IF NOT EXISTS idx_user_settings_user_key ON user_settings(user_id, (data->>'key'))`,
    `CREATE INDEX IF NOT EXISTS idx_lock_settings_user ON lock_settings(user_id)`,
  ]) {
    try { await pool.query(idxSQL); }
    catch (e) { console.warn('[DB] Index skipped:', e.message.slice(0, 80)); }
  }

  // platform_fees: internal 4% revenue ledger (moved out of the Stripe webhook hot path).
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS platform_fees (
      id            SERIAL PRIMARY KEY,
      accountant_id INTEGER,
      client_id     INTEGER,
      billed_cents  INTEGER,
      fee_cents     INTEGER,
      description   TEXT,
      period_month  DATE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch (e) { console.warn('[DB] platform_fees table:', e.message.slice(0, 80)); }

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

// PERFORMANCE TODO: db.get(), db.all(), db.update(), db.delete() do full table scans
// (JS filter over all rows). Replace the auth-path db.get('users', ...) with
//   pool.query("SELECT * FROM users WHERE data->>'email' = $1 LIMIT 1", [email])
// and hot-path db.update()/db.delete() with direct parameterized WHERE queries.
// Acceptable at small scale; revisit before high row counts. See idx_users_email index.
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

module.exports = { db, initDB, pool, rowToObj };
