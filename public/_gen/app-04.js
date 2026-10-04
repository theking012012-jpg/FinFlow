
(function(){
  'use strict';
  // Force a fresh, COMPLETE reload of the active entity + dashboard. Gated on auth (never fires on
  // the login screen) and debounced so a burst of focus/visibility events triggers at most one load.
  var _last = 0, _hiddenAt = 0;
  function _refresh(reason){
    if(!window._ffAuthed) return;
    var now = Date.now();
    if(now - _last < 2500) return;                     // debounce the visibility+focus double-fire
    // F151: only resume-refresh after a MEANINGFUL time in the background. A quick tab-switch (the
    // common case) must NOT force a full reload — loadEntitiesFromDB(true) re-fetches invoices/etc and
    // triggers several dashboard re-renders, so the CORRECT data visibly "blinked" on every tab return.
    // A genuine long resume (installed-PWA wake, or >60s backgrounded) still refreshes so stale data
    // can't linger. _hiddenAt=0 means the tab was never actually hidden → nothing to resume, skip.
    if(!_hiddenAt || (now - _hiddenAt) < 60000) return;
    _last = now;
    if(typeof window.loadEntitiesFromDB === 'function'){
      try{ window.loadEntitiesFromDB(true); }catch(e){}  // force: bypass the boot memo → real reload
    }
  }

  // 1. Resume-from-background. visibilitychange records when we go to the background; on return, the
  //    refresh is gated on how long we were away (see _refresh) so a quick tab-switch never reloads.
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden'){ _hiddenAt = Date.now(); return; }
    if(document.visibilityState === 'visible') _refresh('visible');
  });
  window.addEventListener('focus', function(){ _refresh('focus'); });

  // 2. Pull-to-refresh — only when the scroll container is at the very top, and only for a
  //    dominantly-VERTICAL downward drag. The horizontal swipe-nav owns |dx|>=60 with small dy, so
  //    the two never fight; body has overscroll-behavior:none (no native bounce), so this gesture is
  //    ours to define. A light indicator tracks the pull and confirms the refresh.
  var scroller = function(){ return document.querySelector('.content') || document.scrollingElement || document.documentElement; };
  var startY = 0, startX = 0, armed = false, THRESH = 70, MAXPULL = 110;

  var ind = document.createElement('div');
  ind.setAttribute('aria-hidden','true');
  ind.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;align-items:center;justify-content:center;'
    + 'height:0;overflow:hidden;z-index:600;pointer-events:none;color:var(--acc,#c9a84c);font-size:12px;'
    + 'font-weight:500;letter-spacing:.04em;transition:none;background:transparent';
  ind.textContent = '↓ Pull to refresh';
  function _addIndicator(){ if(!ind.parentNode && document.body) document.body.appendChild(ind); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _addIndicator); else _addIndicator();

  document.addEventListener('touchstart', function(e){
    var c = scroller();
    armed = !!c && c.scrollTop <= 0 && e.touches.length === 1;   // only at the very top, single finger
    if(armed){ startY = e.touches[0].clientY; startX = e.touches[0].clientX; }
  }, {passive:true});

  document.addEventListener('touchmove', function(e){
    if(!armed) return;
    var dy = e.touches[0].clientY - startY;
    var dx = Math.abs(e.touches[0].clientX - startX);
    if(dy <= 0 || dx > Math.abs(dy)){ ind.style.height = '0'; return; }  // upward or horizontal → not us
    var pull = Math.min(dy, MAXPULL);
    ind.style.height = pull + 'px';
    ind.textContent = pull >= THRESH ? '↑ Release to refresh' : '↓ Pull to refresh';
  }, {passive:true});

  document.addEventListener('touchend', function(e){
    if(!armed){ ind.style.height = '0'; return; }
    armed = false;
    var dy = e.changedTouches[0].clientY - startY;
    var dx = Math.abs(e.changedTouches[0].clientX - startX);
    var fire = dy > THRESH && Math.abs(dy) > dx && dx < 50;   // vertical-only, downward, past threshold
    if(fire){
      ind.style.transition = 'height .18s ease'; ind.style.height = '26px'; ind.textContent = '⟳ Refreshing…';
      _refresh('pull');
      setTimeout(function(){ ind.style.height = '0'; setTimeout(function(){ ind.style.transition='none'; }, 200); }, 900);
    } else {
      ind.style.transition = 'height .15s ease'; ind.style.height = '0';
      setTimeout(function(){ ind.style.transition='none'; }, 160);
    }
  }, {passive:true});
})();
