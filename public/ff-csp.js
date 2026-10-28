/**
 * ff-csp.js — FA-P1 (2026-10-27): FinFlow runs under a Content-Security-Policy with no 'unsafe-inline', so the browser
 * runs no inline event-handler attribute. Markup names its handler with data-on-<event>="<code>" instead, and this file
 * runs it — but ONLY code that is in the handler registry (public/_gen/ff-handlers.js, generated from FinFlow's own
 * source by scripts/gen-handlers.js). Markup injected into a page can name no code of its own: an attribute whose code is
 * not in the registry is ignored and reported.
 *
 * A registered handler runs exactly as the inline attribute did: `this` is the element, `event` the event, the same
 * scope (element, then its form, then the document), `return false` cancels the default action, and it runs for the
 * element and then each ancestor in bubbling order until a handler stops propagation. Load it first, in <head>.
 *
 * STYLES. The policy blocks style="…" attributes and <style> elements too. Markup carries data-style="…" instead, and
 * this file applies it through the CSS object model (element.style), which the policy allows — at once after
 * innerHTML / outerHTML / insertAdjacentHTML / createContextualFragment, and for parsed or inserted markup through a
 * MutationObserver — then removes the attribute, so element.style reads exactly as it did with an inline style. A value
 * carrying a legacy script-bearing CSS form (expression(), -moz-binding, behavior:) is dropped. CSS a script adds at run
 * time goes through ffAdoptCss(id, css) — a constructed stylesheet. A document written into an iframe (srcdoc, which
 * inherits this policy) goes through ffFrameWrite(frame, html): its CSS travels in <template data-ff-css> and its
 * styles as data-style, both applied inside the frame once it loads.
 */
(function () {
  'use strict';
  if (window.__ffCsp) return;
  window.__ffCsp = true;
  var H = window.__ffHandlers || (window.__ffHandlers = Object.create(null));
  var EVENTS = ['click', 'dblclick', 'contextmenu', 'input', 'change', 'submit', 'reset', 'keydown', 'keyup', 'keypress',
    'focus', 'blur', 'focusin', 'focusout', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup',
    'dragstart', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop', 'paste', 'load', 'error', 'scroll', 'toggle'];
  var NO_BUBBLE = { focus: 1, blur: 1, mouseenter: 1, mouseleave: 1, load: 1, error: 1, scroll: 1, toggle: 1 };
  var reported = Object.create(null);

  function report(e) {
    if (typeof window.reportError === 'function') window.reportError(e);
    else setTimeout(function () { throw e; });
  }
  function run(el, type, ev) {
    var code = el.getAttribute('data-on-' + type);
    var fn = H[code];
    if (typeof fn !== 'function') {
      if (!reported[code]) { reported[code] = 1; try { console.error('[ff-csp] not a registered handler — ignored: data-on-' + type + '="' + String(code).slice(0, 120) + '"'); } catch (_) {} }
      return;
    }
    var r;
    try { r = fn.call(el, ev); } catch (e) { report(e); return; }
    if (r === false) ev.preventDefault();
  }
  // In a browser the inline attribute and the on<event> PROPERTY are ONE handler slot: a script that assigns
  // el.onclick = fn (or null) REPLACES the attribute's handler, and reading el.onclick returns it. FinFlow relies on it
  // (the Pricing buttons re-point / disable themselves that way). The same slot for data-on-<event>: once a script has
  // assigned el.on<event>, that element's data-on-<event> no longer runs; until then, reading el.on<event> returns it.
  var assigned = typeof WeakMap === 'function' ? new WeakMap() : null;
  function overridden(el, type) { var a = assigned && assigned.get(el); return !!(a && a[type]); }
  [window.HTMLElement, window.SVGElement].forEach(function (C) {
    if (!C || !assigned) return;
    EVENTS.forEach(function (type) {
      var d = Object.getOwnPropertyDescriptor(C.prototype, 'on' + type);
      if (!d || !d.set || !d.get) return;
      Object.defineProperty(C.prototype, 'on' + type, { configurable: true, enumerable: d.enumerable,
        get: function () {
          var v = d.get.call(this);
          if (v != null || overridden(this, type)) return v;
          var code = this.getAttribute('data-on-' + type), fn = code == null ? null : H[code], el = this;
          return typeof fn === 'function' ? function (ev) { return fn.call(el, ev); } : null;
        },
        set: function (v) { var a = assigned.get(this) || {}; a[type] = true; assigned.set(this, a); d.set.call(this, v); } });
    });
  });
  function dispatch(ev) {
    var type = ev.type, attr = 'data-on-' + type, t = ev.target;
    if (t && t.nodeType !== 1) t = t.parentElement || null;
    if (!t || typeof t.hasAttribute !== 'function') return;
    if (!ev.bubbles || NO_BUBBLE[type]) { if (t.hasAttribute(attr) && !overridden(t, type)) run(t, type, ev); return; }
    for (var el = t; el && el.nodeType === 1; el = el.parentElement) {
      if (el.hasAttribute(attr) && !overridden(el, type)) run(el, type, ev);
      if (ev.cancelBubble) break;
    }
  }
  for (var i = 0; i < EVENTS.length; i++) document.addEventListener(EVENTS[i], dispatch, true);
  window.__ffCspEvents = EVENTS.slice();

  // ── styles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  var BAD_CSS = /expression\s*\(|-moz-binding|(^|[;\s])behavior\s*:/i;
  function setStyle(el) {
    var v = el.getAttribute('data-style');
    el.removeAttribute('data-style');
    if (!v) return;
    if (BAD_CSS.test(v)) v = v.split(';').filter(function (d) { return !BAD_CSS.test(d); }).join(';');
    var later = el.style.cssText;   // anything a script already set on the element wins, as it did over an inline style
    el.style.cssText = later ? v + ';' + later : v;
  }
  function applyStyles(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.hasAttribute('data-style')) setStyle(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    var list = root.querySelectorAll('[data-style]');
    for (var i = 0; i < list.length; i++) setStyle(list[i]);
  }
  window.ffApplyStyles = applyStyles;
  function hookSetter(proto, prop, useParent) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { var target = useParent ? this.parentNode : this; d.set.call(this, v); applyStyles(target); } });
  }
  hookSetter(Element.prototype, 'innerHTML', false);
  hookSetter(Element.prototype, 'outerHTML', true);
  var _iah = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, html) {
    var target = /^(beforebegin|afterend)$/i.test(pos) ? (this.parentNode || this) : this;
    var r = _iah.call(this, pos, html); applyStyles(target); return r;
  };
  if (window.Range && Range.prototype.createContextualFragment) {
    var _ccf = Range.prototype.createContextualFragment;
    Range.prototype.createContextualFragment = function (h) { var f = _ccf.call(this, h); applyStyles(f); return f; };
  }
  new MutationObserver(function (recs) {
    for (var i = 0; i < recs.length; i++) for (var j = 0; j < recs[i].addedNodes.length; j++) applyStyles(recs[i].addedNodes[j]);
  }).observe(document, { childList: true, subtree: true });
  applyStyles(document);
  document.addEventListener('DOMContentLoaded', function () { applyStyles(document); });

  // Run-time CSS: a constructed stylesheet (allowed by the policy). One per id. Where constructed sheets are not
  // supported (jsdom, very old browsers) a <style> element — which the policy blocks only where it is enforced.
  var adopted = Object.create(null);
  function adoptCss(id, css, doc) {
    doc = doc || document;
    var win = doc.defaultView || window, key = id + '@' + (doc === document ? '' : 'frame');
    if (doc === document && adopted[key]) return adopted[key];
    var sheet = null;
    try {
      if ('adoptedStyleSheets' in doc && win.CSSStyleSheet) {
        sheet = new win.CSSStyleSheet(); sheet.replaceSync(css);
        doc.adoptedStyleSheets = Array.prototype.concat.call([], Array.prototype.slice.call(doc.adoptedStyleSheets), [sheet]);
      }
    } catch (_) { sheet = null; }
    if (!sheet) { var st = doc.createElement('style'); st.id = id; st.setAttribute('data-ff-css', id); st.textContent = css; (doc.head || doc.documentElement).appendChild(st); sheet = st; }
    if (doc === document) adopted[key] = sheet;
    return sheet;
  }
  window.ffAdoptCss = function (id, css) { return adoptCss(id, css, document); };
  window.ffAdoptCss.has = function (id) { return !!adopted[id + '@']; };

  // A document for an iframe (srcdoc inherits the page's policy): <template data-ff-css> → constructed sheets in the
  // frame, data-style → element.style in the frame.
  window.ffFrameWrite = function (frame, html) {
    var done = function () {
      var doc; try { doc = frame.contentDocument; } catch (_) { return; }
      if (!doc || doc.__ffDone) return;
      doc.__ffDone = true;
      var tpls = doc.querySelectorAll('template[data-ff-css]');
      for (var i = 0; i < tpls.length; i++) { adoptCss('doc' + i, tpls[i].content ? tpls[i].content.textContent || tpls[i].innerHTML : tpls[i].textContent, doc); }
      var els = doc.querySelectorAll('[data-style]');
      for (var k = 0; k < els.length; k++) setStyle(els[k]);
      if (typeof frame.__ffOnWrite === 'function') frame.__ffOnWrite(doc);
    };
    frame.addEventListener('load', done, { once: true });
    frame.srcdoc = html;
  };
})();
