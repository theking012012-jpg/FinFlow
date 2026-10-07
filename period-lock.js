'use strict';
// period-lock — the ONE reader and writer of closed-period state (lock_settings rows
// { enabled, lock_date } per entity; entity_id NULL = a legacy account-wide lock). Used by the main
// app's write paths (server.js isLocked) AND the accountant portal, which used to write a different
// shape ({ period, locked }) that nothing read — accountant locks had no effect (N77).
// Dates are calendar-date strings 'YYYY-MM-DD' compared as strings (Rule 10).
const { rowToObj } = require('./database');

async function isLocked(pool, userId, entityId, date) {
  if (!date) return false;
  const d = String(date).slice(0, 10);
  const { rows } = await pool.query(
    `SELECT * FROM lock_settings WHERE user_id = $1 AND (entity_id IS NULL OR entity_id = $2) AND (data->>'enabled')::int = 1`,
    [userId, entityId == null ? null : entityId]
  );
  for (const r of rows) {
    const s = rowToObj(r);
    if (s && s.lock_date && d <= String(s.lock_date).slice(0, 10)) return true;
  }
  return false;
}

// 'YYYY-MM' → { first: 'YYYY-MM-01', last: 'YYYY-MM-<last day>', dayBefore: '<last day of previous month>' }
function periodBounds(period) {
  const m = String(period || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const prevLast = new Date(Date.UTC(y, mo - 1, 0));
  return { first: `${y}-${pad(mo)}-01`, last: `${y}-${pad(mo)}-${pad(lastDay)}`,
           dayBefore: `${prevLast.getUTCFullYear()}-${pad(prevLast.getUTCMonth() + 1)}-${pad(prevLast.getUTCDate())}` };
}

// Close (lock=true) the books THROUGH the end of `period` for one entity, or reopen (lock=false) that
// period and everything after it. A lock date only ever moves forward on lock and backward on unlock.
// Returns the resulting lock_date (or null when nothing is locked).
async function setPeriodLock(pool, db, userId, entityId, period, lock, extra = {}) {
  const b = periodBounds(period);
  if (!b) throw Object.assign(new Error('period must be YYYY-MM'), { status: 400 });
  const { rows: [row] } = await pool.query(
    `SELECT * FROM lock_settings WHERE user_id = $1 AND entity_id IS NOT DISTINCT FROM $2 LIMIT 1`, [userId, entityId]);
  const cur = row ? rowToObj(row) : null;
  const curDate = cur && Number(cur.enabled) === 1 && cur.lock_date ? String(cur.lock_date).slice(0, 10) : null;
  let next;
  if (lock) next = curDate && curDate > b.last ? curDate : b.last;
  else next = curDate && curDate >= b.first ? b.dayBefore : curDate;
  // N19: a password-protected lock is never loosened from here — this path (accountant portal) has no
  // way to present the owner's lock password.
  if (cur && cur.password_hash && curDate && (next == null || next < curDate)) {
    throw Object.assign(new Error('This lock is password-protected by the business owner. Ask them to reopen the period.'), { status: 403, code: 'LOCK_PASSWORD_REQUIRED' });
  }
  const patch = Object.assign({ enabled: next ? 1 : 0, lock_date: next }, extra);
  if (row) await db.updateById('lock_settings', row.id, patch);
  else await db.insert('lock_settings', Object.assign({ user_id: userId, entity_id: entityId }, patch));
  return next;
}

module.exports = { isLocked, periodBounds, setPeriodLock };
