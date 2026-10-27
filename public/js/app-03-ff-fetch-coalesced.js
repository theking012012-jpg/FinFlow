// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
/* Boot-scoped in-flight GET coalescer (perf): during the initial boot storm, concurrent DUPLICATE
   GET /api reads share ONE network round-trip. Each caller still receives an equivalent cloned,
   fresh response, so no displayed/computed value can change. GET-only, /api-only; skips feeds/
   streams/exports and any request with a body or abort signal; DISABLES itself after the boot
   window so steady-state fetch behaviour is identical to before. Fail-open: any error falls back
   to the original fetch. */
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
            p.then(function(r){ if (!r || !r.ok) cache.delete(url); }, function(){ cache.delete(url); });
            return p.then(function(r){ return r.clone(); });
          }
        }
      } catch(_e){}
      return _f(input, init);
    };
  } catch(_e){}
})();
