/* ff-pw-eye.js — ONE show/hide-password control for every password field in FinFlow (owner request 2026-11-11).
 *
 * Before: only the legacy in-app login/register modal had an eye, and its handler (ffPwToggle) was never defined, so
 * even those two did nothing. The sign-in gate, accountant sign-in / sign-up, admin, reset-password, team-invite and the
 * Settings password fields had none.
 *
 * Now: every <input type="password"> on the page — present at load or added later (the sign-in gate and modals are built
 * by script) — gets an eye button. Strict-CSP safe: no inline handler or style attribute; styles are set through
 * element.style (allowed by style-src-attr 'none'); the click is an addEventListener. Works on pages with or without the
 * app stylesheet. A field opts out with data-no-eye.
 */
(function () {
  'use strict';
  if (window.__ffPwEye) return; window.__ffPwEye = true;
  var EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function decorate(input) {
    if (!input || input.__ffEye || input.hasAttribute('data-no-eye')) return;
    input.__ffEye = true;
    var cs = window.getComputedStyle(input);
    var wrap = document.createElement('span');
    wrap.className = 'ff-pw-wrap';
    wrap.style.position = 'relative';
    wrap.style.display = (cs.display === 'inline' || cs.display === 'inline-block') && cs.width !== '100%' && input.style.width !== '100%' ? 'inline-block' : 'block';
    if (wrap.style.display === 'block') wrap.style.width = '100%';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var pr = parseFloat(cs.paddingRight) || 0;
    if (pr < 38) input.style.paddingRight = '38px';
    if (wrap.style.display === 'block' && !input.style.width) input.style.width = '100%';
    input.style.boxSizing = input.style.boxSizing || cs.boxSizing || 'border-box';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ff-pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.tabIndex = 0;
    btn.innerHTML = EYE;
    var s = btn.style;
    s.position = 'absolute'; s.right = '8px'; s.top = '50%'; s.transform = 'translateY(-50%)';
    s.display = 'flex'; s.alignItems = 'center'; s.justifyContent = 'center';
    s.width = '28px'; s.height = '28px'; s.padding = '0'; s.margin = '0';
    s.background = 'none'; s.border = 'none'; s.cursor = 'pointer'; s.color = 'currentColor'; s.opacity = '0.6';
    s.lineHeight = '0'; s.zIndex = '1';
    btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = '0.6'; });
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep focus (and the caret) in the field
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
    wrap.appendChild(btn);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type="password"]')) decorate(root);
    var list = root.querySelectorAll('input[type="password"]');
    for (var i = 0; i < list.length; i++) decorate(list[i]);
  }
  window.ffPwEyeScan = scan;

  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) if (m.addedNodes[j].nodeType === 1) scan(m.addedNodes[j]); }
        else if (m.type === 'attributes' && m.target.type === 'password') decorate(m.target);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
