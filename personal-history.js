'use strict';
// personal-history.js — LC3c (owner decision 2026-10-20: a SEPARATE personal history, never on the business trail).
//
// The audit trail (audit_trail) is account-wide and shown on a business page, so a personal record must never go there
// (the personal / business wall, CLAUDE.md). This is Personal's own history:
//   - its own append-only table, with NO business column — nothing in it can be filed under, filtered by, or shown on a
//     business;
//   - personal by WHAT IT IS: always the person (req.session.userId, or the owner whose salary a paid run books), never
//     taken from req.entityId;
//   - shown only on the Personal page (GET /api/personal-history), included in the data export, and ERASED with the
//     account (personal data, not the business's legal record — unlike audit_trail, which outlives the account, N18).
// Like recordAudit, a failure to record never turns a saved change into an error (it is logged instead).

// What each kind of record is called on the Personal page.
const KINDS = {
  personal_transactions: 'Transaction',
  bank_lines: 'Bank line',
  bank_import: 'Statement import',
  bank_sync: 'Bank sync',
  bank_link: 'Linked bank',
  bank_settings: 'Bank settings',
  personal_accounts: 'Asset / liability',
  goals: 'Goal',
  holdings: 'Investment',
  snapshots: 'Net-worth snapshot',
  recurring_personal_transactions: 'Recurring transaction',
  owner_salary: 'Owner salary',
};
const ACTIONS = { CREATE: 'Added', UPDATE: 'Changed', DELETE: 'Deleted', LINK: 'Linked', UNLINK: 'Unlinked', IMPORT: 'Imported', SYNC: 'Synced', CAPTURE: 'Captured' };

// Schema — called from initDB (database.js) and mirrored by scripts/migrations/2026-10-21-personal-history.sql.
// Append-only: UPDATE is always refused; DELETE only inside the account-erase transaction, which sets the
// transaction-local flag finflow.erase_user to the user being erased (POST /api/auth/delete-account).
const DDL = [
  `CREATE TABLE IF NOT EXISTS personal_history (
     id          SERIAL PRIMARY KEY,
     user_id     INTEGER NOT NULL,
     kind        TEXT NOT NULL,
     action      TEXT NOT NULL,
     record_id   INTEGER,
     before_data JSONB,
     after_data  JSONB,
     actor_type  TEXT NOT NULL DEFAULT 'user',
     actor_id    INTEGER,
     ip_address  TEXT,
     user_agent  TEXT,
     at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_personal_history_user ON personal_history (user_id, at DESC, id DESC)`,
  `CREATE OR REPLACE FUNCTION personal_history_no_mutate() RETURNS trigger LANGUAGE plpgsql AS $ph$
   BEGIN
     IF TG_OP = 'DELETE' AND current_setting('finflow.erase_user', true) = OLD.user_id::text THEN RETURN OLD; END IF;
     RAISE EXCEPTION 'personal_history is append-only (% refused)', TG_OP;
   END $ph$`,
  `DROP TRIGGER IF EXISTS personal_history_no_mutate ON personal_history`,
  `CREATE TRIGGER personal_history_no_mutate BEFORE UPDATE OR DELETE ON personal_history
     FOR EACH ROW EXECUTE FUNCTION personal_history_no_mutate()`,
];
async function ensureSchema(client) { for (const q of DDL) await client.query(q); }

// Never store a credential: a connection is recorded by provider + institution only (callers pass that), and these
// fields are dropped from any snapshot as a second line of defence.
const _SECRET = /token|secret|password|cursor|access|credential/i;
function _clean(o) {
  if (!o || typeof o !== 'object') return o == null ? null : o;
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!_SECRET.test(k)) out[k] = v;
  return out;
}

// record(pool, { userId, kind, action, recordId, before, after, req, actorType })
//   userId — the PERSON the record belongs to. Required. Never derive it from req.entityId.
async function record(pool, { userId, kind, action, recordId = null, before = null, after = null, req = null, actorType = null }) {
  try {
    if (userId == null) throw new Error('personal history needs the person (userId)');
    let aType = 'system', aId = null;
    if (req && req.session && req.session.accountantId) { aType = 'accountant'; aId = req.session.accountantId; }
    else if (req && req.session && req.session.userId) { aType = 'user'; aId = req.session.userId; }
    if (actorType) aType = actorType;
    const ua = req && typeof req.get === 'function' ? String(req.get('user-agent') || '').slice(0, 300) || null : null;
    await pool.query(
      `INSERT INTO personal_history (user_id, kind, action, record_id, before_data, after_data, actor_type, actor_id, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [userId, kind, action, recordId == null ? null : Number(recordId),
       before ? JSON.stringify(_clean(before)) : null, after ? JSON.stringify(_clean(after)) : null,
       aType, aId, (req && (req.clientIp || req.ip)) || null, ua]);   // LR26: the visitor, not the proxy hop
  } catch (e) { console.error('[personal-history] not recorded:', kind, action, e.message); }
}

// The person's own history, newest first.
async function list(pool, userId, limit = 100) {
  const n = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  const { rows } = await pool.query(
    `SELECT id, kind, action, record_id, before_data, after_data, actor_type, at
       FROM personal_history WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT $2`, [userId, n]);
  return rows;
}

module.exports = { DDL, ensureSchema, record, list, KINDS, ACTIONS };
