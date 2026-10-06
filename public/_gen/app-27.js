
/* ── BOOT-WINDOW REQUEST CACHE (perf) ──────────────────────────────────────────
   On boot the dashboard fetches /api/invoices, /api/expenses and /api/bills repeatedly
   (invoices ~5×, expenses ~4×). This serves all of those from ONE /api/dashboard-bootstrap
   call during a short window, coalescing in-flight requests onto it. STRICT fallback: any path
   not in the batch, any non-GET, any entity mismatch, or any failure → a normal fetch, so
   correctness can't regress. Kill-switch: localStorage['ff_no_bootcache']='1'.
   bootKeyForUrl is identical to the tested bootcache.js. */
(function(){
  try { if (localStorage.getItem('ff_no_bootcache') === '1') return; } catch(e){}
  if (typeof window.fetch !== 'function' || typeof window.Response !== 'function' || typeof window.URL !== 'function') return;
  var SERVABLE = { '/api/invoices':1, '/api/expenses':1, '/api/bills':1 };
  function bootKeyForUrl(url, batchEntityId){
    var u; try { u = new URL(String(url), 'http://x'); } catch(e){ return null; }
    var p = u.pathname; if(!SERVABLE[p]) return null;
    var sp = u.searchParams; if(sp.has('limit')||sp.has('before')) return null;
    var eid = sp.get('entity_id');
    if(eid==null||eid==='') return p;
    if(batchEntityId!=null && String(eid)===String(batchEntityId)) return p;
    return null;
  }
  function servablePath(url){ var u; try{u=new URL(String(url),'http://x');}catch(e){return false;} if(!SERVABLE[u.pathname]) return false; var sp=u.searchParams; return !(sp.has('limit')||sp.has('before')); }

  var WINDOW_MS = 15000;
  var boot = null, until = 0;
  var orig = window.fetch.bind(window);
  // Single bootstrap call; everything coalesces onto this promise.
  var pending = orig('/api/dashboard-bootstrap', { credentials:'same-origin', headers:{'Content-Type':'application/json'} })
    .then(function(r){ return (r && r.ok) ? r.json() : null; })
    .then(function(j){ if(j && j.data){ boot = j; until = Date.now() + WINDOW_MS; } return boot; })
    .catch(function(){ boot = null; return null; });
  // Hard stop so a slow request can never wait forever on the bootstrap.
  setTimeout(function(){ pending = null; }, WINDOW_MS);

  function serve(key){ return new Response(JSON.stringify(boot.data[key]), { status:200, headers:{'Content-Type':'application/json'} }); }

  window.fetch = function(url, opts){
    try{
      var method = (opts && opts.method ? String(opts.method) : 'GET').toUpperCase();
      if(method !== 'GET'){ boot = null; return orig.apply(this, arguments); }   // flush on any mutation
      // Already have the batch and still in window → serve directly.
      if(boot && Date.now() < until){
        var k = bootKeyForUrl(String(url), boot.entity_id);
        if(k && boot.data[k] != null) return Promise.resolve(serve(k));
        return orig.apply(this, arguments);
      }
      // Bootstrap still in flight and this is a servable path → coalesce onto it, then match or fall back.
      if(pending && servablePath(url)){
        var self=this, args=arguments, u=String(url);
        return pending.then(function(){
          try{ if(boot && Date.now() < until){ var k2=bootKeyForUrl(u, boot.entity_id); if(k2 && boot.data[k2]!=null) return serve(k2); } }catch(e){}
          return orig.apply(self, args);
        });
      }
    }catch(e){}
    return orig.apply(this, arguments);
  };
})();
