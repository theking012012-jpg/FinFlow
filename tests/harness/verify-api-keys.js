'use strict';
/**
 * verify-api-keys.js — executes the SHIPPED key helpers (../../api-keys.js). Pure; no DB needed.
 * Covers format, hash properties (deterministic, collision-free across keys, never the plaintext),
 * well-formedness rejection, masking, and header extraction (Bearer + X-API-Key).
 */
const { PREFIX, generateKey, hashKey, isWellFormed, maskKey, extractFromHeaders } = require('../../api-keys.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

const k1 = generateKey(), k2 = generateKey();
A('generated key has prefix', k1.indexOf(PREFIX) === 0);
A('generated key is 48 hex after prefix', /^[0-9a-f]{48}$/.test(k1.slice(PREFIX.length)));
A('two keys differ (random)', k1 !== k2);
A('generated keys are well-formed', isWellFormed(k1) && isWellFormed(k2));

const h1 = hashKey(k1);
A('hash is 64 hex (sha256)', /^[0-9a-f]{64}$/.test(h1));
A('hash is deterministic', hashKey(k1) === h1);
A('different keys → different hashes', hashKey(k2) !== h1);
A('hash is NOT the plaintext key', h1.indexOf(k1) === -1 && h1 !== k1);

A('reject wrong prefix', !isWellFormed('sk_live_' + '0'.repeat(48)));
A('reject short body', !isWellFormed(PREFIX + 'abcd'));
A('reject non-hex body', !isWellFormed(PREFIX + 'z'.repeat(48)));
A('reject empty/null', !isWellFormed('') && !isWellFormed(null));

const m = maskKey(k1);
A('mask keeps prefix + ellipsis, hides body', m.indexOf(PREFIX) === 0 && m.indexOf('…') > -1 && m.indexOf(k1.slice(PREFIX.length, PREFIX.length + 10)) === -1);
A('mask of non-key is dots', maskKey('garbage') === '••••');

A('extract from Bearer header', extractFromHeaders({ authorization: 'Bearer ' + k1 }) === k1);
A('extract from Bearer header (case-insensitive scheme)', extractFromHeaders({ authorization: 'bearer ' + k1 }) === k1);
A('extract from X-API-Key header', extractFromHeaders({ 'x-api-key': k1 }) === k1);
A('no header → null', extractFromHeaders({}) === null && extractFromHeaders(null) === null);
A('malformed Bearer (no token) → null', extractFromHeaders({ authorization: 'Bearer ' }) === null);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
