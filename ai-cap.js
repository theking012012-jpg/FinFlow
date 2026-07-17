// ── F18: central AI cost caps ──────────────────────────────────────────────────
// Every endpoint that calls the Anthropic API MUST pass a cap check here BEFORE the
// call and record usage AFTER a successful call — so no path reaches Anthropic
// uncapped. Two independent MONTHLY budgets per account:
//   shared — chat (/api/ai), auto-categorize, accountant insights (cheap text)
//   scan   — document/vision extraction: receipt scan (/api/ai/scan, Sonnet vision)
//            and resume/CV parse (/api/accountants/extract-resume)
//
// User budgets  → ai_usage(user_id, billing_month, query_count=shared, scan_count).
// Accountant    → accountant_ai_usage(accountant_id, billing_month, shared_count, scan_count).
//
// All ceilings are env-overridable (pure config) so they can be tuned without a deploy
// of code — only a restart. Fail-CLOSED: if usage can't be read, the call is blocked.

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

const CAPS = {
  trial:      { shared: int(process.env.AI_CAP_TRIAL_SHARED, 30),       scan: int(process.env.AI_CAP_TRIAL_SCAN, 3) },
  pro:        { shared: int(process.env.AI_CAP_PRO_SHARED, 500),        scan: int(process.env.AI_CAP_PRO_SCAN, 15) },
  business:   { shared: int(process.env.AI_CAP_BUSINESS_SHARED, 2000),  scan: int(process.env.AI_CAP_BUSINESS_SCAN, 50) },
  accountant: { shared: int(process.env.AI_CAP_ACCOUNTANT_SHARED, 300), scan: int(process.env.AI_CAP_ACCOUNTANT_SCAN, 10) },
};

// Map a user's stored plan string to a cap tier. free / trial / unknown → the
// lowest (trial) tier. Keeps 'pro' and 'business' distinct (the Pro-vs-Business check).
function planTier(plan) {
  const p = String(plan || '').toLowerCase();
  return (p === 'pro' || p === 'business') ? p : 'trial';
}

function capFor(plan, kind) {
  return CAPS[planTier(plan)][kind];
}

async function _read(pool, table, idCol, id) {
  const sel = table === 'ai_usage'
    ? 'query_count AS shared_count, scan_count'
    : 'shared_count, scan_count';
  const r = await pool.query(
    `SELECT ${sel} FROM ${table} WHERE ${idCol} = $1 AND billing_month = date_trunc('month', NOW())`,
    [id]
  );
  return { shared: r.rows[0]?.shared_count || 0, scan: r.rows[0]?.scan_count || 0 };
}

// Returns { ok, used, cap, kind, failClosed? }. On a DB error, ok:false + failClosed:true
// so the caller blocks the Anthropic call instead of failing open to unlimited spend.
async function checkUserCap(pool, userId, plan, kind) {
  try {
    const cap  = capFor(plan, kind);
    const used = (await _read(pool, 'ai_usage', 'user_id', userId))[kind];
    return { ok: used < cap, used, cap, kind };
  } catch (e) {
    console.error('[ai-cap] user check failed (fail-closed):', e.message);
    return { ok: false, used: null, cap: null, kind, failClosed: true };
  }
}

async function checkAccountantCap(pool, accountantId, kind) {
  try {
    const cap  = CAPS.accountant[kind];
    const used = (await _read(pool, 'accountant_ai_usage', 'accountant_id', accountantId))[kind];
    return { ok: used < cap, used, cap, kind };
  } catch (e) {
    console.error('[ai-cap] accountant check failed (fail-closed):', e.message);
    return { ok: false, used: null, cap: null, kind, failClosed: true };
  }
}

async function recordUser(pool, userId, kind, n = 1) {
  const col = kind === 'scan' ? 'scan_count' : 'query_count';
  await pool.query(
    `INSERT INTO ai_usage (user_id, billing_month, ${col})
     VALUES ($1, date_trunc('month', NOW()), $2)
     ON CONFLICT (user_id, billing_month) DO UPDATE SET ${col} = ai_usage.${col} + $2`,
    [userId, n]
  ).catch(e => console.error('[ai-cap] user record failed:', e.message));
}

async function recordAccountant(pool, accountantId, kind, n = 1) {
  const col = kind === 'scan' ? 'scan_count' : 'shared_count';
  await pool.query(
    `INSERT INTO accountant_ai_usage (accountant_id, billing_month, ${col})
     VALUES ($1, date_trunc('month', NOW()), $2)
     ON CONFLICT (accountant_id, billing_month) DO UPDATE SET ${col} = accountant_ai_usage.${col} + $2`,
    [accountantId, n]
  ).catch(e => console.error('[ai-cap] accountant record failed:', e.message));
}

module.exports = { CAPS, planTier, capFor, checkUserCap, checkAccountantCap, recordUser, recordAccountant };
