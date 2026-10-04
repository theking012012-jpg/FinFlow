
(function(){
  'use strict';
  var _isMobile = function(){ return window.matchMedia('(max-width:768px)').matches; };

  // Give the on-screen keyboard's action key a sensible label. Single-line fields get "done"
  // (the AI composer gets "send"); checkboxes/buttons/file inputs are skipped. Textareas keep
  // their default newline behaviour.
  function _applyHints(root){
    var sel = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range])';
    (root||document).querySelectorAll(sel).forEach(function(el){
      if(el.hasAttribute('enterkeyhint')) return;
      el.setAttribute('enterkeyhint', el.id==='ai-input' ? 'send' : 'done');
    });
  }
  // Perf: set enterkeyhint just-in-time on focus instead of scanning every input across all 43
  // screens at load AND re-scanning the whole document on every DOM mutation (biggest TBT hit).
  document.addEventListener('focusin', function(e){
    var el = e.target; if(!el || el.hasAttribute('enterkeyhint')) return;
    if((el.tagName || '') !== 'INPUT') return;
    if(/^(checkbox|radio|button|submit|file|range)$/.test(el.type || '')) return;
    el.setAttribute('enterkeyhint', el.id === 'ai-input' ? 'send' : 'done');
  }, true);

  // Scroll the focused field above the on-screen keyboard (mobile only). The delay lets the
  // keyboard finish animating in before we measure/scroll.
  document.addEventListener('focusin', function(e){
    if(!_isMobile()) return;
    var el = e.target;
    if(!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName || '')) return;
    setTimeout(function(){
      try{ el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(_){ try{ el.scrollIntoView(); }catch(__){} }
    }, 300);
  });
})();
