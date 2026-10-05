
/* PWA install prompt: capture beforeinstallprompt and offer a dismissible, theme-matched install
   banner. Hidden in standalone (already installed) and after install; dismissal remembered in
   localStorage. iOS Safari (no beforeinstallprompt) gets a one-time Add-to-Home-Screen hint.
   Self-contained, injected at end of body, fail-open - touches no existing markup. */
(function(){
  try{
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (standalone) return;
    var KEY = 'ff_install_dismissed';
    function dismissed(){ try{ return localStorage.getItem(KEY)==='1'; }catch(_){ return false; } }
    function remember(){ try{ localStorage.setItem(KEY,'1'); }catch(_){ } }
    var deferred = null;
    function banner(msg, actionLabel, onAction){
      if (document.getElementById('ff-install-banner')) return;
      var b = document.createElement('div');
      b.id = 'ff-install-banner'; b.setAttribute('role','dialog'); b.setAttribute('aria-label','Install FinFlow');
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:99999;display:flex;align-items:center;gap:12px;max-width:92vw;padding:12px 14px;border-radius:14px;background:rgba(22,18,13,0.97);color:#f2e8d5;border:1px solid rgba(201,168,76,0.35);box-shadow:0 10px 34px rgba(0,0,0,0.5);font:500 14px/1.35 system-ui,-apple-system,sans-serif';
      var t = document.createElement('span'); t.textContent = msg; t.style.cssText='flex:1 1 auto'; b.appendChild(t);
      if (onAction){
        var a = document.createElement('button'); a.type='button'; a.textContent = actionLabel;
        a.style.cssText='flex:none;padding:8px 14px;border-radius:10px;border:0;background:#c9a84c;color:#1a1409;font-weight:700;cursor:pointer';
        a.onclick = onAction; b.appendChild(a);
      }
      var x = document.createElement('button'); x.type='button'; x.setAttribute('aria-label','Dismiss'); x.innerHTML='&times;';
      x.style.cssText='flex:none;padding:6px 9px;border-radius:8px;border:0;background:transparent;color:#9e8e73;font-size:15px;cursor:pointer';
      x.onclick = function(){ remember(); b.remove(); }; b.appendChild(x);
      document.body.appendChild(b);
    }
    window.addEventListener('beforeinstallprompt', function(e){
      e.preventDefault(); deferred = e;
      if (dismissed()) return;
      banner('Install FinFlow for one-tap access', 'Install', function(){
        var el=document.getElementById('ff-install-banner'); if(el) el.remove();
        if(!deferred) return; deferred.prompt();
        if(deferred.userChoice) deferred.userChoice.then(function(){ deferred=null; });
      });
    });
    window.addEventListener('appinstalled', function(){ remember(); var el=document.getElementById('ff-install-banner'); if(el) el.remove(); });
    var ua = navigator.userAgent||'';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream && /^((?!chrome|android|crios|fxios).)*safari/i.test(ua) && !dismissed()){
      window.addEventListener('load', function(){ setTimeout(function(){ if(!dismissed()) banner('Install FinFlow: tap Share, then "Add to Home Screen"', null, null); }, 3500); });
    }
  }catch(_e){}
})();
