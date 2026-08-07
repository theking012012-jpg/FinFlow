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

// ── F19: DB TLS ────────────────────────────────────────────────────────────────
// In production we connect over TLS. By default the server certificate is NOT
// verified (`rejectUnauthorized: false`) because Railway/Supabase present a
// self-signed / private-CA cert, and verifying against it WITHOUT the matching CA
// makes pg refuse the connection → the pool can't connect → the app crashes on
// boot. So the default is intentionally permissive (traffic still encrypted; MITM
// risk is bounded when the DB link rides the provider's private network).
//
// To turn on real verification (recommended once you have the CA): set
// DATABASE_CA_CERT to the provider's CA certificate in PEM form (Supabase offers a
// downloadable cert). With it present we verify the chain; without it, behavior is
// exactly as before — additive and non-breaking, never a deploy-time crash.
function dbSsl() {
  if (process.env.NODE_ENV !== 'production') return false;         // dev: no TLS (unchanged)
  const ca = process.env.DATABASE_CA_CERT;
  if (ca && ca.trim()) return { ca, rejectUnauthorized: true };    // opt-in: real verification
  console.warn('⚠️  [F19] DB TLS is ENCRYPTED BUT UNVERIFIED (rejectUnauthorized:false). '
    + 'Set DATABASE_CA_CERT (provider CA, PEM) to enable certificate verification.');
  return { rejectUnauthorized: false };                            // default: unchanged from before
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: dbSsl(),
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

    // ── RBAC Phase 2, Step 2 — membership functional indexes ────────────────────
    // The per-request account resolver (server.js) matches team_members on
    // data->>'member_user_id'; the invite-accept flow looks up pending invites on
    // data->>'invite_token_hash'. These functional indexes keep both off a seq
    // scan now that real membership/invite rows exist (the member_user_id index was
    // deferred from Step 1 as a tracked commitment when zero rows existed to index).
    await client.query(`CREATE INDEX IF NOT EXISTS idx_team_members_member_user_id ON team_members ((data->>'member_user_id'))`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_team_members_invite_token   ON team_members ((data->>'invite_token_hash'))`);

    // Holdings entity isolation — the generic loop above already creates the
    // entity_id column, but run an explicit idempotent migration so any holdings
    // table that predates entity_id (legacy deployments) gets it safely. No
    // NOT NULL — existing rows keep entity_id NULL until backfilled per-row.
    await client.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS entity_id INTEGER`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_holdings_entity_id ON holdings(entity_id)`);

    // F48 follow-up — AR is now arithmetic: Σ max(0, amount − amount_paid) over ALL recognized
    // invoices (the status!=='paid' filter was dropped, mirroring AP). Before this, invoices could be
    // marked 'paid' with amount_paid 0/NULL (bare status flip), so those rows must be backfilled to
    // amount_paid = amount or they'd resurrect as AR the instant the filter drops. Atomic-with-deploy
    // for ALL users (no standalone script → no AR-flip-before-script sequencing hazard).
    //
    // NOTE: invoices is a generic JSONB table — amount/amount_paid/status live in `data`, NOT typed
    // columns, so this is a jsonb_set (a typed-column ALTER/UPDATE would throw "column does not
    // exist" and abort initDB). NULL-safe: guards jsonb_typeof(data->'amount')='number' and copies
    // the amount JSON number straight into amount_paid, so a paid row with a NULL/absent amount_paid
    // (invisible to a naive amount_paid < amount) is still backfilled. Idempotent: the WHERE clause
    // makes a re-run over already-backfilled rows a no-op.
    await client.query(`
      UPDATE invoices
         SET data = jsonb_set(data, '{amount_paid}', data->'amount')
       WHERE lower(data->>'status') = 'paid'
         AND jsonb_typeof(data->'amount') = 'number'
         AND COALESCE((data->>'amount_paid')::numeric, 0) < (data->>'amount')::numeric
    `);

    // F135 — the symmetric AP backfill for BILLS. F135 fixed the create/edit path going forward
    // (server.js POST/PUT /api/bills: status='paid' ⇒ amount_paid = amount); this heals the EXISTING
    // rows that were marked 'paid' with amount_paid NULL/0, which the AP leg counts at FULL FACE
    // (AP = Σ max(0, amount − amount_paid), server.js:3589) — so a paid bill still shows as owed.
    // Unlike invoices there was NO bills backfill before, so these rows never self-healed. Owner-gated
    // (separate commit, explicit approval). SAME shape as the invoices backfill above: bills is a
    // generic JSONB table (amount/amount_paid/status in `data`), so this is a NULL-safe jsonb_set,
    // guarded on jsonb_typeof(data->'amount')='number'. It ONLY touches 'paid' bills whose amount_paid
    // is below amount — a genuinely part-paid bill is status 'partial' (recalcBillStatus), so it is NOT
    // matched and its amount_paid is preserved. Idempotent: the WHERE clause makes a re-run a no-op.
    // Read-only pre-check the owner can run first: SELECT id, data->>'vendor', data->>'amount',
    //   data->>'amount_paid' FROM bills WHERE lower(data->>'status')='paid'
    //   AND COALESCE((data->>'amount_paid')::numeric,0) < (data->>'amount')::numeric;
    await client.query(`
      UPDATE bills
         SET data = jsonb_set(data, '{amount_paid}', data->'amount')
       WHERE lower(data->>'status') = 'paid'
         AND jsonb_typeof(data->'amount') = 'number'
         AND COALESCE((data->>'amount_paid')::numeric, 0) < (data->>'amount')::numeric
    `);

    // F117 / C1 — durable idempotency backstop for POST /api/invoices. invoices is a generic
    // JSONB table with NO natural key (two identical $2000 invoices are legitimate re-invoicing),
    // so the enforcing key is a per-submit-intent IDEMPOTENCY TOKEN the client mints once and
    // reuses on a double-submit. This PARTIAL expression index is the un-bypassable guarantee the
    // 5s findRecentDuplicate pre-check cannot be (that pre-check is a non-atomic TOCTOU race and
    // misses any slow >5s re-click — CLAUDE.md Rule 9). Keyed on (user_id, token): the token is a
    // random UUID, globally unique per intent, so entity_id is not needed in the key.
    //   PARTIAL on non-NULL keys → legacy rows (incl. the existing saige ids 8 & 9) carry no token
    //   and are EXCLUDED, so the index builds cleanly with the current duplicate still present
    //   (historical cleanup is a separate owner-gated commit, Rule 8). A NULL token from an old
    //   client / API caller is likewise excluded → behaviour unchanged until a token is sent.
    //   Non-CONCURRENTLY is correct here: it is transactional (safe inside this initDB BEGIN) and
    //   the partial index covers zero rows at creation, so it is instant. If the invoices table
    //   ever grows large before this ships, build the CONCURRENTLY variant once out-of-band instead.
    // Import-safety (Rule 7): this lives inside initDB(), which already fires DDL at boot — it adds
    // no NEW import side effect and is reached only via the existing initDB call path.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_idem_key
        ON invoices (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — expenses idempotency backstop (same shape as invoices above). expenses is a
    // generic JSONB table with NO natural key (two identical "Fuel $50" expenses are legitimate),
    // so the enforcing key is the per-submit idempotency TOKEN, not UNIQUE(description, amount).
    // Partial on non-NULL keys: legacy/token-less rows are excluded, so the index builds cleanly
    // and behaviour is unchanged until a token is sent. Inside initDB → no new import side effect.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_idem_key
        ON expenses (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — bills idempotency backstop (same shape as invoices/expenses). Two identical
    // "Acme $500" bills are legitimate, so the key is the per-submit idempotency TOKEN, not
    // UNIQUE(vendor, amount). Partial on non-NULL keys → token-less/legacy rows excluded, behaviour
    // unchanged until a token is sent. Independent of F135 amount_paid-on-paid (that is unaffected).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_idem_key
        ON bills (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — payments_made idempotency backstop (same shape). A duplicated payment is a real
    // AP double-spend, so this is high-value. Two legitimate payments to the same vendor for the
    // same amount are allowed (paying two bills), so the key is the per-submit TOKEN, not
    // UNIQUE(vendor, amount). The bill_id link / recalcBillStatus path is unaffected: on 23505 the
    // 2nd insert never lands, so the bill is recalculated once by the first request only.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_made_idem_key
        ON payments_made (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — payments_received idempotency backstop (AR mirror of payments_made). A duplicated
    // receipt overstates collections / understates AR, so it is high-value. Two legitimate receipts
    // from the same customer for the same amount are allowed, so the key is the per-submit TOKEN,
    // not UNIQUE(customer, amount). Partial on non-NULL keys → token-less/legacy rows unchanged.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_received_idem_key
        ON payments_received (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — credit_notes idempotency backstop (same shape). A duplicated credit note
    // overstates contra-revenue once F58 applies them, so it is money-bearing. credit_notes is
    // user-scoped (no entity_id stored), so the token is the key; partial on non-NULL keys.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_idem_key
        ON credit_notes (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — vendor_credits idempotency backstop (AP contra mirror of credit_notes). Also
    // user-scoped (no entity_id), so the token is the key; partial on non-NULL keys.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_credits_idem_key
        ON vendor_credits (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — sales_receipts idempotency backstop (same shape). A duplicated receipt overstates
    // cash sales. Two legitimate receipts to the same customer for the same amount are allowed, so
    // the token is the key. (sales_receipts stores entity_id; its token-less pre-check scope is
    // fixed in the server handler alongside — same class as payments_received.)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_receipts_idem_key
        ON sales_receipts (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1 — journals idempotency backstop (manual journal entries). A duplicated JE double-
    // posts to the ledger. Two identical balanced entries can be legitimate, so the token is the
    // key (single-row insert; the debit/credit lines are stored as JSON on the row). Partial on
    // non-NULL keys → token-less/legacy rows unchanged.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_idem_key
        ON journals (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

    // C1 Wave 1b — chart_of_accounts idempotency backstop (token, boot-safe). JSONB table, so the
    // token lives in data->>'idempotency_key' like the 9 Wave-1 routes. NOT a natural key on `code`
    // (that business-uniqueness is deferred post-launch, out-of-band — never in initDB).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_of_accounts_idem_key
        ON chart_of_accounts (user_id, (data->>'idempotency_key'))
        WHERE data->>'idempotency_key' IS NOT NULL
    `);

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
    // Step G (F28): admin-CONFIRMED credentials, written at approval from the reviewed
    // document — distinct from the self-declared `credentials`/`memberships`/`verification_data`.
    // This is the ONLY credential text shown to clients; the raw self-declared fields are
    // admin-only. Empty string until an admin approves with a confirmed value.
    await client.query(`ALTER TABLE accountants ADD COLUMN IF NOT EXISTS confirmed_credentials TEXT DEFAULT ''`);

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
    // F17 money-split ledger: a service_commission row records the full breakdown of a
    // client bill. amount_cents = the accountant's NET (billed − Stripe fee − FinFlow
    // commission); the two columns below record the other legs so the split is auditable.
    // billed_cents = gross the client paid. Referral rows leave these NULL (full to accountant).
    await client.query(`ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS billed_cents     INTEGER`);
    await client.query(`ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS commission_cents INTEGER`);
    await client.query(`ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS stripe_fee_cents INTEGER`);
    // Stripe PaymentIntent id — lets the payment_intent.succeeded webhook find the row
    // and reconcile the estimated Stripe fee to the real balance-transaction fee.
    await client.query(`ALTER TABLE accountant_earnings ADD COLUMN IF NOT EXISTS payment_intent_id TEXT`);

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

    // Accountant credential proof (Step F). Base64-in-Postgres, mirroring the
    // documents table pattern but ACCOUNTANT-scoped. Kept in its own table so the
    // multi-MB file_data never bloats the frequently-SELECTed accountants row /
    // verification_data (admin lists, directory). Fetched only on explicit review.
    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_documents (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
        doc_type      VARCHAR(50) DEFAULT 'credential_proof',
        file_name     VARCHAR(255),
        media_type    VARCHAR(100),
        size_bytes    INTEGER,
        file_data     TEXT,
        uploaded_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acc_docs_accountant ON accountant_documents(accountant_id)`);

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
    // F18 — second per-account monthly AI budget: query_count = shared (chat/autocat/
    // insights), scan_count = document/vision extraction (receipt scan + resume parse).
    await client.query(`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS scan_count INTEGER NOT NULL DEFAULT 0`);
    // F18 — accountants have no plan tier, so their AI spend is tracked separately
    // with a fixed monthly ceiling (see ai-cap.js CAPS.accountant).
    await client.query(`
      CREATE TABLE IF NOT EXISTS accountant_ai_usage (
        id            SERIAL PRIMARY KEY,
        accountant_id INTEGER NOT NULL,
        billing_month DATE NOT NULL DEFAULT date_trunc('month', NOW()),
        shared_count  INTEGER NOT NULL DEFAULT 0,
        scan_count    INTEGER NOT NULL DEFAULT 0,
        UNIQUE(accountant_id, billing_month)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acct_ai_usage_month ON accountant_ai_usage(accountant_id, billing_month)`);

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
    // C1 Wave 1b — invoice_payments idempotency backstop (TOKEN, boot-safe). Typed table (like
    // payroll_runs), so the token is a REAL column. Money-critical: two rapid PARTIAL payments both
    // fit under the overpayment check and both booked, silently settling an invoice twice. Nullable
    // column add is instant; partial index over all-NULL existing rows is instant → no boot-brick.
    await client.query(`ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_idem_key
        ON invoice_payments (user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

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

    // C1 Wave 1b — payroll_runs idempotency backstop (TOKEN, boot-safe). Unlike the 9 JSONB routes,
    // payroll_runs is a TYPED table (no `data` column), so the token needs a REAL column. Adding a
    // nullable column is instant (no table rewrite) and the partial unique index covers zero existing
    // rows (all NULL) at creation → instant, no boot-brick risk. This is the portable in-initDB
    // guarantee for ALL environments; the prod-only natural-key `idx_payroll_runs_uniq` (one-shot,
    // 2026-07-25, NOT in initDB) coexists and is the deferred post-launch item. Do NOT add the
    // natural-key `period` index here (owner ruling 2026-08-07 — boot-safety over max correctness).
    await client.query(`ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_idem_key
        ON payroll_runs (user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

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
    // C1 Wave 1b — inventory_movements idempotency backstop (TOKEN, boot-safe). Typed table. HIGHEST-
    // consequence duplicate: a double-clicked 'sale' books units out twice and (because COGS is
    // recomputed from the rows) permanently corrupts FIFO COGS + gross profit. calculateFIFOCOGS is
    // read-only, so the token 23505 preventing the duplicate ROW is the whole fix; the recovery
    // returns before the units-decrement too. Nullable add + partial index over all-NULL rows = instant.
    await client.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_idem_key
        ON inventory_movements (user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

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
  // table names from SQL strings create rogue tables). Returns TRUE if the table
  // now exists (known name → created here), FALSE if the name is NOT allowlisted —
  // in which case the caller MUST rethrow the 42P01 rather than silently return an
  // empty result. That "silently succeed as empty when the query actually failed"
  // is the F14-class bug (a missing/renamed/typo'd table hidden as "no data").
  // A genuine CREATE failure now THROWS (no inner swallow) so it surfaces too.
  if (!TABLES.includes(table)) return false;
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
  console.warn(`⚠️  [DB] table "${table}" was MISSING and has been auto-created — a schema migration likely did not run on this deploy. Investigate.`);
  return true;
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
      // 42P01 on a KNOWN table → create it and retry once. A non-allowlisted table
      // (or any other error) falls through to throw — never silently swallowed.
      if (err.code === '42P01' && await _ensureTable(table)) {
        res = await doInsert();
      } else {
        throw err;
      }
    }
    const inserted = rowToObj(res.rows[0]);
    return { lastInsertRowid: inserted.id, row: inserted };
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
      // 42P01 on a KNOWN table → self-heal and return the (genuinely empty) set.
      // Unknown/typo'd/renamed table (or a creation failure) → THROW. Returning []
      // here is exactly the silent-empty-on-failure bug that hid F14's dead tables.
      if (err.code === '42P01' && await _ensureTable(table)) return [];
      throw err;
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

  // deleteById() — single row, uses PK
  async deleteById(table, id) {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  },

  // deleteByUser() — wipe all rows for a user (used on account delete)
  async deleteByUser(table, userId) {
    await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  },
};

// seedUserData intentionally removed.
// New users start with a clean slate — no demo data.
// To restore demo seeding for development only, add it behind:
//   if (process.env.NODE_ENV !== 'production') { ... }

module.exports = { db, initDB, pool, rowToObj };
