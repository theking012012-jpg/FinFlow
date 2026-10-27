// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
'use strict';
// ── XSS sanitizer ──────────────────────────────────────────────────
// Escapes & < > " ' — safe in text AND in quoted attribute values (the textContent→innerHTML trick
// left quotes raw, so esc() inside value="…" / onclick='…' was still injectable).
window.esc = function(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); };

// ── Input validators ───────────────────────────────────────────────
window.validateEmail = function(e){
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e||''));
};
window.validateAmount = function(v){
  const n = parseFloat(String(v||'').replace(/[^0-9.-]/g,''));
  return isFinite(n) && n >= 0 ? n : null;
};
window.sanitizeText = function(s, max=500){
  return String(s||'').replace(/[<>"'`]/g,'').trim().slice(0, max);
};
window.sanitizePhone = function(s){
  return String(s||'').replace(/[^0-9+\-() ]/g,'').trim().slice(0,20);
};

// ── Rate limiter for API calls (covers ALL API paths) ─────────────
// Timestamps are stored in sessionStorage so a page reload does NOT
// reset the window — bypassing the limit by refreshing is prevented.
window.apiRateLimit = (function(){
  const KEY = 'ff_rate_calls';
  const MAX_PER_MIN = 10;
  function getCalls(){
    try{ return JSON.parse(sessionStorage.getItem(KEY)||'[]'); }catch(e){ return []; }
  }
  function saveCalls(arr){
    try{ sessionStorage.setItem(KEY, JSON.stringify(arr)); }catch(e){}
  }
  return function canCall(){
    const now = Date.now();
    const calls = getCalls().filter(t => now - t < 60000);
    if(calls.length >= MAX_PER_MIN){ saveCalls(calls); return false; }
    calls.push(now);
    saveCalls(calls);
    return true;
  };
})();

// ── Sanitize user text before sending to API ──────────────────────
window.sanitizeForAPI = function(s, max=2000){
  return String(s||'').trim().slice(0, max);
};

// ── Focus trap for modal dialogs ──────────────────────────────────
// Call trapFocus(modalEl) when opening; it returns a cleanup function.
window.trapFocus = function(modal){
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const els = Array.from(modal.querySelectorAll(FOCUSABLE));
  if(!els.length) return ()=>{};
  const first = els[0], last = els[els.length-1];
  // Focus first element
  first.focus();
  function onKey(e){
    if(e.key !== 'Tab') return;
    if(e.shiftKey){
      if(document.activeElement === first){ e.preventDefault(); last.focus(); }
    } else {
      if(document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  }
  modal.addEventListener('keydown', onKey);
  return ()=> modal.removeEventListener('keydown', onKey);
};

// ── Per-ticker quote cache (TTL: 55s — just under the 60s refresh) ─
window._quoteCache = {};
window._quoteCacheTTL = 55000;
window.getCachedQuote = function(ticker){
  const entry = window._quoteCache[ticker];
  if(!entry) return null;
  if(Date.now() - entry.ts > window._quoteCacheTTL) return null;
  return entry.data;
};
window.setCachedQuote = function(ticker, data){
  window._quoteCache[ticker] = {ts: Date.now(), data};
};
