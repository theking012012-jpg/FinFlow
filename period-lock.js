'use strict';
// period-lock — the ONE reader and writer of closed-period state (lock_settings rows
// { enabled, lock_date } per entity; entity_id NULL = a legacy account-wide lock). Used by the main
// app's write paths (server.js isLocked) AND the accountant portal, which used to write a different
// shape ({ period, locked }) that nothing read — accountant locks had no effect (N77).
// Dates are calendar-date strings 'YYYY-MM-DD' compared as strings (Rule 10).
const { rowToObj } = require('./database');

// The lock date that closes `date` for this business ('YYYY-MM-DD', the latest one when several apply), or null.
async function lockedThrough(pool, userId, entityId, date) {
  if (!date) return null;
  const d = String(date).slice(0, 10);
  const { rows } = await pool.query(
    `SELECT * FROM lock_settings WHERE user_id = $1 AND (entity_id IS NULL OR entity_id = $2) AND (data->>'enabled')::int = 1`,
    [userId, entityId == null ? null : entityId]
  );
  let through = null;
  for (const r of rows) {
    const s = rowToObj(r);
    const ld = s && s.lock_date ? String(s.lock_date).slice(0, 10) : null;
    if (ld && d <= ld && (!through || ld > through)) through = ld;
  }
  return through;
}
async function isLocked(pool, userId, entityId, date) { return (await lockedThrough(pool, userId, entityId, date)) != null; }

// E2E-2 (full test 2026-10-30, Part 9): every refusal said only "Period is locked." — not which dates are closed, nor
// what to do — so a payroll void in a locked month read as "nothing happened". ONE wording for every lock refusal
// (the owner's app and the accountant portal): the closed-through date, the record's date, and the way out.
function lockedRefusal(date, lockDate, opts = {}) {
  const FD = require('./public/finflow-dates.js');
  const d = String(date).slice(0, 10), ld = lockDate ? String(lockDate).slice(0, 10) : null;
  const fmt = v => FD.fmtLabel(v, { year: true }) || v;
  const how = opts.accountant
    ? 'Ask the business owner to reopen that period.'
    : 'To change it, move the lock date back in Transaction Locking, then try again.';
  const error = (ld ? 'Your books are locked through ' + fmt(ld) + ', and this is dated ' + fmt(d) + '. '
                    : 'This is dated ' + fmt(d) + ', inside a locked period. ') + how;
  return { error, code: 'PERIOD_LOCKED', date: d, lock_date: ld };
}

// Answers 403 when `date` is in a closed period; returns true when it has answered.
async function refuseIfLockedRes(pool, res, userId, entityId, date, opts) {
  const ld = await lockedThrough(pool, userId, entityId, date);
  if (ld == null) return false;
  res.status(403).json(lockedRefusal(date, ld, opts));
  return true;
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

module.exports = { isLocked, lockedThrough, lockedRefusal, refuseIfLockedRes, periodBounds, setPeriodLock };
