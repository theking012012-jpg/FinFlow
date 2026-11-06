// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
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

// F52 (2026-11-06) — every modal window, however it was built (37 in index.html, more built at runtime by app-main and
// the wiring files, and any added later), is announced and usable from the keyboard. ONE mechanism instead of a patch per
// modal: an observer marks each .modal-overlay as a named dialog (role="dialog", aria-modal, aria-label = its title)
// and names every icon-only close button "Close"; when a modal opens, focus moves into it and returns on close; Escape
// closes the top open modal by pressing its own close button (so each modal's own close logic runs).
(function(){
  'use strict';
  function _isOpen(ov){
    if(!ov || ov.classList.contains('hidden')) return false;
    try { return window.getComputedStyle(ov).display !== 'none'; } catch(_) { return ov.style.display !== 'none'; }
  }
  function _title(ov){
    var t = ov.querySelector('.modal-title, h2, h3');
    var s = t ? String(t.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return (s || 'Dialog').slice(0, 120);
  }
  function _mark(root){
    if(!root || root.nodeType !== 1) return;
    var ovs = [], btns = [];
    if(root.matches && root.matches('.modal-overlay')) ovs.push(root);
    if(root.matches && root.matches('.modal-close')) btns.push(root);
    if(root.querySelectorAll){
      Array.prototype.push.apply(ovs, root.querySelectorAll('.modal-overlay'));
      Array.prototype.push.apply(btns, root.querySelectorAll('.modal-close'));
    }
    ovs.forEach(function(ov){
      if(!ov.getAttribute('role')) ov.setAttribute('role', 'dialog');
      if(!ov.hasAttribute('aria-modal')) ov.setAttribute('aria-modal', 'true');
      if(!ov.getAttribute('aria-label') && !ov.getAttribute('aria-labelledby')) ov.setAttribute('aria-label', _title(ov));
      // First sight: a modal inserted ALREADY open (built and shown in one go) is an opening too.
      if(ov._ffWasOpen === undefined){ ov._ffWasOpen = false; _openedOrClosed(ov); }
    });
    btns.forEach(function(b){ if(!b.getAttribute('aria-label') && !String(b.textContent || '').trim()) b.setAttribute('aria-label', 'Close'); });
    // A form label with no `for` (the runtime-built forms write <label class="field-label">Code *</label><input id=…>):
    // link it to the one field in its own .field-wrap, so the field is announced by its label.
    var labs = [];
    if(root.matches && root.matches('label.field-label:not([for])')) labs.push(root);
    if(root.querySelectorAll) Array.prototype.push.apply(labs, root.querySelectorAll('label.field-label:not([for])'));
    labs.forEach(function(l){
      var w = l.closest('.field-wrap'); if(!w || l.querySelector('input,select,textarea')) return;
      var c = w.querySelectorAll('input:not([type="hidden"]),select,textarea'); if(c.length !== 1) return;
      if(c[0].id) l.setAttribute('for', c[0].id);
      else if(!c[0].getAttribute('aria-label')) c[0].setAttribute('aria-label', String(l.textContent || '').replace(/[*\s]+$/,'').trim());
    });
  }
  var _FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not(.modal-close), [tabindex]:not([tabindex="-1"])';
  function _openedOrClosed(ov){
    var open = _isOpen(ov);
    if(open === !!ov._ffWasOpen) return;
    ov._ffWasOpen = open;
    if(open){
      // Where to return: what had focus before — not a field inside this modal (openModal may focus one before we run).
      var a = document.activeElement;
      ov._ffReturnFocus = (a && ov.contains(a)) ? _lastOutside : a;
      setTimeout(function(){ if(!_isOpen(ov) || ov.contains(document.activeElement)) return;
        var f = ov.querySelector(_FOCUSABLE) || ov.querySelector('.modal-close'); if(f && f.focus) f.focus(); }, 0);
    } else {
      var r = ov._ffReturnFocus; ov._ffReturnFocus = null;
      if(r && r.focus && document.contains(r)) { try { r.focus(); } catch(_) {} }
    }
  }
  var _lastOutside = null;
  function _start(){
    document.addEventListener('focusin', function(e){ if(e.target && e.target.closest && !e.target.closest('.modal-overlay')) _lastOutside = e.target; }, true);
    _mark(document.body);
    new MutationObserver(function(muts){
      for(var i = 0; i < muts.length; i++){
        var m = muts[i];
        if(m.type === 'childList'){ for(var j = 0; j < m.addedNodes.length; j++) _mark(m.addedNodes[j]); }
        else if(m.target && m.target.classList && m.target.classList.contains('modal-overlay')) _openedOrClosed(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Escape' || e.defaultPrevented) return;
      var open = Array.prototype.filter.call(document.querySelectorAll('.modal-overlay'), _isOpen);
      if(!open.length) return;
      var top = open[open.length - 1], x = top.querySelector('.modal-close');
      if(x){ e.preventDefault(); x.click(); }
    });
  }
  window._ffModalA11y = { mark: _mark, isOpen: _isOpen };   // test surface
  if(document.body) _start(); else document.addEventListener('DOMContentLoaded', _start);
})();
