
// Lazy-load the third-party bank widgets (Plaid, Belvo) ONLY when the user actually links a bank.
// Loading them eagerly set 4 third-party cookies on EVERY page load (Lighthouse Best-Practices hit)
// and put third-party JS on the mobile critical path. Same CDN hosts as before → CSP unchanged.
window._loadScriptOnce = function(src){
  window.__ldScripts = window.__ldScripts || {};
  if (window.__ldScripts[src]) return window.__ldScripts[src];
  window.__ldScripts[src] = new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = function(){ resolve(); };
    s.onerror = function(){ window.__ldScripts[src] = null; reject(new Error('load failed: ' + src)); };
    document.head.appendChild(s);
  });
  return window.__ldScripts[src];
};
