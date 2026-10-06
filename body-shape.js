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
  if (err) return res.status(400).json({ error: err, code: 'BAD_FIELD_TYPE' });
  next();
}

module.exports = { bodyShape, checkBody, TEXT_FIELDS, NUMBER_FIELDS };
