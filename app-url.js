// ── F29: single source of truth for the app's public origin ──────────────────
// Every outbound link in an email or an external redirect (Stripe return/refresh,
// password reset, team/accountant invites, admin notifications) MUST build its URL
// from appUrl() — never a hardcoded domain literal. When the custom domain lands,
// LIVE_FALLBACK below is the ONE place to change.
//
//   appUrl()      → process.env.APP_URL, trailing slash(es) stripped; falls back to
//                   the live Railway origin when unset (never a dead domain).
//   warnIfUnset() → loud, one-time boot warning if APP_URL isn't set (call at startup).

const LIVE_FALLBACK = 'https://finflow-production-dab1.up.railway.app';

function appUrl() {
  const raw = process.env.APP_URL;
  if (!raw) return LIVE_FALLBACK;          // never a dead domain
  return raw.replace(/\/+$/, '');          // normalize: strip trailing slash(es)
}

let warned = false;
function warnIfUnset() {                    // call once at boot
  if (!process.env.APP_URL && !warned) {
    warned = true;
    console.warn('⚠️  [F29] APP_URL is not set — outbound email/redirect links fall back to '
      + LIVE_FALLBACK + '. Set APP_URL on the deploy to the canonical public origin.');
  }
}

module.exports = { appUrl, warnIfUnset, LIVE_FALLBACK };
