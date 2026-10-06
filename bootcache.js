'use strict';
/**
 * bootcache.js — pure match logic for the boot-window request cache.
 *
 * On boot the dashboard fetches /api/invoices, /api/expenses and /api/bills repeatedly (different
 * loaders). Those three are the ONLY list endpoints that go through the shared respondList path, so
 * a single /api/dashboard-bootstrap can return byte-identical data for them. This module decides,
 * for a given request URL, whether it may be served from that batch — conservatively: only the three
 * servable paths, only the full-list (non-paginated) shape, and only when the request's entity scope
 * matches the batch's. Anything else returns null → the caller does a real fetch (fallback), so
 * correctness can never regress. Testable in isolation (tests/harness/verify-bootcache.js).
 *
 * The client inlines an identical copy of bootKeyForUrl in its fetch wrapper; this is the tested
 * source of truth for that logic.
 */

var SERVABLE = { '/api/invoices': 1, '/api/expenses': 1, '/api/bills': 1 };

// Returns the batch key (e.g. '/api/invoices') when the URL may be served from a batch scoped to
// batchEntityId, else null. batchEntityId is the entity the bootstrap was computed for (may be null).
function bootKeyForUrl(url, batchEntityId) {
  var u;
  try { u = new URL(String(url), 'http://x'); } catch (e) { return null; }
  var p = u.pathname;
  if (!SERVABLE[p]) return null;
  var sp = u.searchParams;
  if (sp.has('limit') || sp.has('before')) return null;        // paginated → different shape than the batch
  var eid = sp.get('entity_id');
  if (eid == null || eid === '') return p;                     // no entity_id → session-active scope == batch scope
  if (batchEntityId != null && String(eid) === String(batchEntityId)) return p;
  return null;                                                 // a different entity → fall through to a real fetch
}

module.exports = { bootKeyForUrl, SERVABLE };
