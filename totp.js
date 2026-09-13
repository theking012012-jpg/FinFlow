'use strict';
/**
 * totp.js — RFC 6238 TOTP (SHA-1, 6 digits, 30s) with a ±1 step window, plus AES-256-GCM
 * at-rest encryption for the shared secret. Zero external dependencies (node crypto only).
 *
 * Used for accountant MFA. The stored secret is a CREDENTIAL — a leaked DB row must not be enough
 * to mint valid codes — so it is always persisted via encSecret() and read via decSecret().
 * Key derivation mirrors server.js's connector-token scheme (CONNECTOR_ENC_KEY preferred, else
 * SESSION_SECRET), so no new env var is required.
 */
const crypto = require('crypto');

// ── base32 (RFC 4648, no padding) — the alphabet authenticator apps expect ──────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/,'').replace(/\s+/g,'');
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// ── TOTP core ───────────────────────────────────────────────────────────────────────────────────
const PERIOD = 30, DIGITS = 6;
function _hotp(keyBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', keyBuf).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off+1] << 16) | (h[off+2] << 8) | h[off+3];
  return String(bin % (10 ** DIGITS)).padStart(DIGITS, '0');
}
/** Generate the current TOTP for a base32 secret (used by tests + optional server display). */
function generate(secretB32, atMs = Date.now()) {
  return _hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / PERIOD));
}
/** Verify a submitted token against a base32 secret, allowing ±1 step of clock drift. */
function verify(token, secretB32, atMs = Date.now()) {
  const t = String(token || '').replace(/\s+/g,'');
  if (!/^[0-9]{6}$/.test(t)) return false;
  const key = base32Decode(secretB32);
  const c = Math.floor(atMs / 1000 / PERIOD);
  for (const w of [-1, 0, 1]) {
    // constant-time compare per candidate
    const cand = _hotp(key, c + w);
    if (cand.length === t.length && crypto.timingSafeEqual(Buffer.from(cand), Buffer.from(t))) return true;
  }
  return false;
}
/** A fresh random base32 secret (20 bytes = 160 bits, the RFC-recommended size). */
function newSecret() { return base32Encode(crypto.randomBytes(20)); }
/** otpauth:// URI for authenticator apps (QR or manual key entry). */
function otpauthUri(secretB32, account, issuer = 'FinFlow') {
  const label = encodeURIComponent(issuer + ':' + account);
  const q = `secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${PERIOD}&algorithm=SHA1`;
  return `otpauth://totp/${label}?${q}`;
}

// ── AES-256-GCM at rest (mirrors server.js connector-token key derivation) ──────────────────────
function _keys() {
  const k = [];
  if (process.env.CONNECTOR_ENC_KEY) k.push(crypto.createHash('sha256').update('connector-key:' + process.env.CONNECTOR_ENC_KEY).digest());
  if (process.env.SESSION_SECRET)    k.push(crypto.createHash('sha256').update('mfa-secret:' + process.env.SESSION_SECRET).digest());
  if (!k.length) throw new Error('No encryption key configured (set CONNECTOR_ENC_KEY or SESSION_SECRET).');
  return k;
}
function encSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', _keys()[0], iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}
function decSecret(stored) {
  const [ivh, tagh, dh] = String(stored).split(':');
  let lastErr;
  for (const key of _keys()) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivh, 'hex'));
      d.setAuthTag(Buffer.from(tagh, 'hex'));
      return Buffer.concat([d.update(Buffer.from(dh, 'hex')), d.final()]).toString('utf8');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('decrypt failed');
}

module.exports = { generate, verify, newSecret, otpauthUri, encSecret, decSecret, base32Encode, base32Decode };
