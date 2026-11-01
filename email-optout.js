'use strict';
// Product-news unsubscribe links (Privacy Policy, 2026-11). A link carries the address and an HMAC of it, so it works
// without signing in and cannot be forged for someone else's address. Keyed on SESSION_SECRET (always set in
// production); without one, a per-process key is used and old links stop working at restart — logged once.
const crypto = require('crypto');
const { appUrl } = require('./app-url');
let _fallback = null, _warned = false;
function _key() {
  const k = process.env.SESSION_SECRET || process.env.CONNECTOR_ENC_KEY;
  if (k) return 'email-optout:' + k;
  if (!_fallback) _fallback = crypto.randomBytes(32).toString('hex');
  if (!_warned) { _warned = true; console.warn('[email-optout] no SESSION_SECRET — unsubscribe links are valid only until restart'); }
  return 'email-optout:' + _fallback;
}
const norm = e => String(e || '').trim().toLowerCase();
function token(email) { return crypto.createHmac('sha256', _key()).update(norm(email)).digest('base64url').slice(0, 32); }
function valid(email, t) {
  const a = Buffer.from(token(email)), b = Buffer.from(String(t || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const _q = email => 'e=' + encodeURIComponent(norm(email)) + '&t=' + token(email);
const pageUrl = email => appUrl() + '/unsubscribe.html?' + _q(email);          // the link in the email: a page with Undo
const oneClickUrl = email => appUrl() + '/api/unsubscribe?' + _q(email);       // List-Unsubscribe: mail apps POST here
module.exports = { token, valid, pageUrl, oneClickUrl, norm };
