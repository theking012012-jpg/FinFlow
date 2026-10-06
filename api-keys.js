'use strict';
/**
 * api-keys.js — pure helpers for the public API's credential handling.
 *
 * PURE (no DB, no request). The server stores only the SHA-256 HASH of a key (never the key
 * itself), looks keys up by that hash, and shows the plaintext key exactly once at creation. These
 * helpers are the one place the key format, hash and display mask are defined, so the management
 * endpoints and the requireApiKey middleware can't drift apart. Testable in isolation
 * (tests/harness/verify-api-keys.js).
 */

const crypto = require('crypto');

const PREFIX = 'ffk_live_';
const BODY_BYTES = 24;                         // 24 bytes → 48 hex chars of entropy (192 bits)
const KEY_RE = new RegExp('^' + PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[0-9a-f]{' + (BODY_BYTES * 2) + '}$');

// A fresh key: prefix + 48 hex chars. Shown to the user once, never stored in plaintext.
function generateKey() {
  return PREFIX + crypto.randomBytes(BODY_BYTES).toString('hex');
}

// What we persist and look up by. SHA-256 is correct here (not bcrypt): the key is high-entropy
// random, so a fast one-way hash is both safe and indexable for O(1) lookup.
function hashKey(key) {
  return crypto.createHash('sha256').update(String(key == null ? '' : key)).digest('hex');
}

// Reject anything not matching our exact format BEFORE hitting the database.
function isWellFormed(key) {
  return KEY_RE.test(String(key == null ? '' : key));
}

// Display mask for listing keys: ffk_live_ab…(last 4). Never reveals the body.
function maskKey(key) {
  const s = String(key == null ? '' : key);
  if (!s.startsWith(PREFIX)) return '••••';
  const body = s.slice(PREFIX.length);
  const head = body.slice(0, 2);
  const tail = body.slice(-4);
  return PREFIX + head + '…' + tail;
}

// Extract a presented key from either Authorization: Bearer <key> or X-API-Key: <key>.
function extractFromHeaders(headers) {
  if (!headers) return null;
  const auth = headers['authorization'] || headers['Authorization'];
  if (auth && /^Bearer\s+/i.test(auth)) {
    const k = auth.replace(/^Bearer\s+/i, '').trim();
    if (k) return k;
  }
  const x = headers['x-api-key'] || headers['X-API-Key'];
  if (x && String(x).trim()) return String(x).trim();
  return null;
}

module.exports = { PREFIX, generateKey, hashKey, isWellFormed, maskKey, extractFromHeaders };
