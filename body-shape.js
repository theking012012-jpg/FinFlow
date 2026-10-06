'use strict';
/**
 * body-shape.js — N14 class. One request-body shape check every /api write passes through.
 *
 * Handlers read well-known fields straight off req.body. Before this, a field of the wrong TYPE did one
 * of two things depending on the route: `.trim()` / `.slice()` on a number threw (500), or an object /
 * array was written raw into the row; and `parseFloat("abc")` stored NaN, which JSONB turns into null —
 * silently zeroing an amount, price, cost or gross pay. The executed class probe
 * (tests/harness/verify-put-field-validation.js) found 18 PUT routes doing one or the other.
 *
 * The check is by FIELD NAME and only on the top level of a plain-object JSON body:
 *   TEXT fields   — an object/array is refused (400); a number/boolean is converted to its string.
 *   NUMBER fields — must be a finite number or a numeric string ("12", "-3.5", ".5"); null / "" pass
 *                   through untouched (handlers already treat them as absent/zero). Anything else → 400.
 *   DATE fields   — `date` / `*_date`: an ISO calendar date (YYYY-MM-DD[Thh:mm…]) that exists (N63) → else 400 INVALID_DATE.
 * Business rules (non-negative units, integer stock, required fields) stay in the handlers.
 */

const TEXT_FIELDS = new Set([
  'name', 'description', 'client', 'customer', 'vendor', 'employee', 'keyword', 'unit', 'sku', 'notes',
  'memo', 'fname', 'lname', 'company', 'industry', 'phone', 'title', 'category', 'reason', 'method',
  'reference', 'institution', 'symbol', 'project', 'task', 'contact', 'invoice_ref', 'status', 'type', 'role',
]);
const NUMBER_FIELDS = new Set([
  'amount', 'amount_paid', 'price', 'cost', 'gross', 'bonus', 'overtime', 'units', 'max_units', 'hours',
  'rate', 'current_val', 'target_val', 'monthly_contrib', 'balance', 'shares', 'qty', 'quantity', 'stock',
  'revenue',
]);
const NUMERIC_STRING = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)\s*$/;
// N63: date fields (`date`, `*_date`) are ISO calendar dates — YYYY-MM-DD, optionally with an ISO time —
// and a real day. '07/10/2026' (July or October?) or '2026-02-30' used to be stored as-is, and the ledger and
// the books then read it two different ways.
const DATE_FIELD = /^(date|[a-z_]+_date)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
function isIsoCalendarDate(v) {
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

// Returns an error message for the first bad field, or null. Converts text-field primitives in place.
function checkBody(body) {
  if (!isPlainObject(body)) return null;
  for (const k of Object.keys(body)) {
    const v = body[k];
    if (v == null) continue;
    if (TEXT_FIELDS.has(k)) {
      if (typeof v === 'object') return k + ' must be text.';
      if (typeof v !== 'string') body[k] = String(v);
    } else if (DATE_FIELD.test(k)) {
      if (v === '') continue;
      if (typeof v !== 'string' || !isIsoCalendarDate(v.trim())) return { msg: k + ' must be a date in YYYY-MM-DD format.', code: 'INVALID_DATE', field: k };
    } else if (NUMBER_FIELDS.has(k)) {
      if (v === '') continue;
      if (typeof v === 'number' ? !Number.isFinite(v) : !(typeof v === 'string' && NUMERIC_STRING.test(v))) {
        return k + ' must be a number.';
      }
    }
  }
  return null;
}

function bodyShape(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return next();
  const err = checkBody(req.body);
  if (err && typeof err === 'object') return res.status(400).json({ error: err.msg, code: err.code, field: err.field });
  if (err) return res.status(400).json({ error: err, code: 'BAD_FIELD_TYPE' });
  next();
}

module.exports = { bodyShape, checkBody, isIsoCalendarDate, TEXT_FIELDS, NUMBER_FIELDS };
