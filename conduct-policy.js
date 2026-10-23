// ── FinFlow Professional Conduct Policy — SINGLE SOURCE for the current version (A0 / D-E) ──────────────
// One definition used by the server (accountant-routes.js: registration, sign-in, the client-access gate) and the
// browser (accountant-register.html / accountant-dashboard.html load /conduct-policy.js). public/conduct.html carries
// the same version in <meta name="conduct-version"> — verify-conduct-policy fails if they differ.
// Publishing a new version: edit conduct.html, bump VERSION here. Every accountant is asked again at next sign-in and
// has GRACE_DAYS to accept before access to client books pauses (messages keep working).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FinFlowConduct = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = '1.0';
  const GRACE_DAYS = 14;
  const URL = '/conduct.html';

  // state({ version, acceptedAt, promptedAt }, nowMs) → what the accountant must do and whether client access is paused.
  function state(acc, nowMs) {
    const a = acc || {};
    const accepted = String(a.version || '') === VERSION && !!a.acceptedAt;
    if (accepted) return { version: VERSION, accepted: true, required: false, graceEndsAt: null, paused: false, url: URL };
    const prompted = a.promptedAt ? new Date(a.promptedAt).getTime() : null;
    const graceEnds = prompted == null ? null : prompted + GRACE_DAYS * 86400000;
    return { version: VERSION, accepted: false, required: true,
             graceEndsAt: graceEnds == null ? null : new Date(graceEnds).toISOString(),
             paused: graceEnds != null && (nowMs == null ? Date.now() : nowMs) >= graceEnds, url: URL };
  }
  return { VERSION, GRACE_DAYS, URL, state };
});
