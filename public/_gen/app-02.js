
(function(){
  'use strict';
  // Topmost-first precedence: open modal → sidebar drawer → AI panel → notif panel.
  function _openModalEl(){ return document.querySelector('.modal-overlay:not(.hidden)'); }
  function _topmost(){
    if(_openModalEl()) return 'modal';
    if(document.body.classList.contains('sidebar-open')) return 'sidebar';
    if(document.querySelector('.ai-panel.open')) return 'ai';
    if(document.querySelector('.notif-panel.open')) return 'notif';
    return null;
  }
  var _guard = false;    // is our sentinel history entry currently on the stack?
  var _popping = false;  // re-entrancy flag while we self-consume the sentinel via history.back()

  // Keep exactly one sentinel entry on the stack while ANY overlay is open; remove it when the
  // last overlay closes by the app's own handlers. (Guards against history loops: never pushes
  // a second sentinel while one is already present.)
  function _sync(){
    var open = _topmost() !== null;
    if(open && !_guard){
      _guard = true;
      try{ history.pushState({ffOverlay:1}, ''); }catch(e){}
    } else if(!open && _guard && !_popping){
      _guard = false; _popping = true;
      try{ history.back(); }catch(e){ _popping = false; }
    }
  }
  // Wrap the app's own open/close entry points so opening arms the sentinel and closing
  // (via X / Cancel / Esc) consumes it — without touching those functions' definitions.
  function _wrap(name){
    if(typeof window[name] !== 'function') return;
    var orig = window[name];
    window[name] = function(){ var r = orig.apply(this, arguments); setTimeout(_sync, 0); return r; };
  }
  ['openModal','closeModal','openSidebar','closeSidebar','toggleAIPanel','toggleNotifPanel'].forEach(_wrap);

  function _closeTopmost(){
    var t = _topmost();
    if(t === 'modal'){ var m = _openModalEl(); if(m){ (typeof window.closeModal==='function') ? window.closeModal(m.id) : m.classList.add('hidden'); } }
    else if(t === 'sidebar'){ (typeof window.closeSidebar==='function') ? window.closeSidebar() : document.body.classList.remove('sidebar-open'); }
    else if(t === 'ai'){ var a=document.querySelector('.ai-panel.open'); if(a) a.classList.remove('open'); }
    else if(t === 'notif'){ var n=document.querySelector('.notif-panel.open'); if(n) n.classList.remove('open'); }
  }

  window.addEventListener('popstate', function(){
    if(_popping){ _popping = false; return; }   // our own history.back() — swallow, don't re-handle
    if(_topmost()){                             // back/swipe-back pressed with an overlay open
      _guard = false;                           // the sentinel was just popped by the browser
      _closeTopmost();                          // dismiss topmost; wrapped close re-arms a sentinel if more remain
    }
    // else: nothing open → allow normal navigation (do nothing)
  });
})();
