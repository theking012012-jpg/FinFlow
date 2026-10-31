// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
/* Boot-scoped in-flight GET coalescer (perf): during the initial boot storm, concurrent DUPLICATE
   GET /api reads share ONE network round-trip. Each caller still receives an equivalent cloned,
   fresh response, so no displayed/computed value can change. GET-only, /api-only; skips feeds/
   streams/exports and any request with a body or abort signal; DISABLES itself after the boot
   window so steady-state fetch behaviour is identical to before. Fail-open: any error falls back
   to the original fetch. */
/* E2E-6 (full test 2026-10-30): sign-in gate. Before anyone signs in, every data GET the page fires at load answered 401
   — about 38 red "Failed to load resource" lines on the sign-in screen (and a "[Vendors] could not load…" error). Now a
   data GET waits until the page knows there is a session: the server's `ff_auth` hint cookie says so at once (no added
   round trip when signed in); without it the page asks GET /api/auth/session ONCE. Signed out, a data GET is answered
   here with the same 401 the server would give — no request, no console error — and every caller already treats 401 as
   "not signed in yet". Any sign-in / sign-out call (a non-GET to /api/auth/) makes the page ask again. Routes that work
   signed out are never held. Fail-open: if the question itself fails, requests go to the server as before. */
(function(){
  try {
    if (window.__ffAuthGate) return;
    window.__ffAuthGate = true;
    var _f = window.fetch.bind(window);
    var OPEN = /\/api\/(auth\/session|support\b|team\/accept|accountants\/directory|accountants\/\d+\/reviews|portal\b|wipay\/|auth\/sso\/)/;
    var probe = null;
    function hinted(){ try { return /(?:^|;\s*)ff_auth=1(?:;|$)/.test(document.cookie || ''); } catch(_e){ return false; } }
    function signedIn(){
      if (hinted()) return Promise.resolve(true);
      if (!probe) probe = _f('/api/auth/session', { credentials: 'include', cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : { authenticated: true }; })
        .then(function(j){ return !(j && j.authenticated === false); }, function(){ return true; });
      return probe;
    }
    function unauthorised(){
      return new Response(JSON.stringify({ error: 'Unauthorised — please log in.' }), { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } });
    }
    window.__ffSignedIn = signedIn;
    window.fetch = function(input, init){
      try {
        var method = ((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var path = url.replace(/^https?:\/\/[^/]+/, '');
        if (path.indexOf('/api/') === 0) {
          // A report is READ with a POST (the same reads the server lets an expired trial make) — gated like a GET.
          var readPost = method === 'POST' && /^\/api\/(reports\/|cogs\/calculate)/.test(path);
          if (method !== 'GET' && method !== 'HEAD' && !readPost) {
            var p = _f(input, init);
            if (path.indexOf('/api/auth/') === 0) { var reset = function(){ probe = null; }; p.then(reset, reset); }
            return p;
          }
          if (!OPEN.test(path)) {
            return signedIn().then(function(ok){ return ok ? _f(input, init) : unauthorised(); });
          }
        }
      } catch(_e){}
      return _f(input, init);
    };
  } catch(_e){}
})();

(function(){
  try {
    if (window.__ffFetchCoalesced) return;
    window.__ffFetchCoalesced = true;
    var _f = window.fetch.bind(window);
    var cache = new Map();
    var bootUntil = Date.now() + 10000;
    window.fetch = function(input, init){
      try {
        var method = ((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var hasBody = !!(init && init.body);
        var hasSignal = !!(init && init.signal);
        if (Date.now() < bootUntil && url.indexOf('/api/') !== -1) {
          if (method !== 'GET') { cache.clear(); return _f(input, init); }
          if (!hasBody && !hasSignal && !/(feed|stream|events|export|download|sse)/i.test(url)) {
            var hit = cache.get(url);
            if (hit) return hit.then(function(r){ return r.clone(); });
            var p = _f(input, init);
            cache.set(url, p);
            // FA-P1b: share only while IN FLIGHT. Once the request settles the entry is gone, so a later GET reads the
            // server again (it used to keep every successful response for the whole window and answer repeats with it).
            p.then(function(){ cache.delete(url); }, function(){ cache.delete(url); });
            return p.then(function(r){ return r.clone(); });
          }
        }
      } catch(_e){}
      return _f(input, init);
    };
  } catch(_e){}
})();
