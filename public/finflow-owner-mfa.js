/* finflow-owner-mfa.js — owner-account 2FA (TOTP) enrollment card on the Settings page.
 * Loaded after finflow-bundle.js (own <script>, not a bundle source). Talks to the
 * /api/auth/mfa/{status,setup,enable,disable} endpoints. loadOwnerMfa() is called by the
 * settings-open branch in the wiring; the rest are onclick handlers on the card. */
(function () {
  'use strict';
  function _el(id) { return document.getElementById(id); }
  function _setErr(id, m) { var e = _el(id); if (e) { e.textContent = m || ''; e.style.display = m ? 'block' : 'none'; } }
  async function _f(method, path, body) {
    var r = await fetch(path, { method: method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }
  function render(enabled) {
    var st = _el('owner-mfa-status'); if (st) st.textContent = enabled ? '✓ Two-factor authentication is ON.' : 'Two-factor authentication is off.';
    var eb = _el('owner-mfa-enable-btn'); if (eb) eb.style.display = enabled ? 'none' : '';
    var ds = _el('owner-mfa-disable'); if (ds) ds.style.display = enabled ? '' : 'none';
    var su = _el('owner-mfa-setup'); if (su) su.style.display = 'none';
    _setErr('owner-mfa-setup-err', ''); _setErr('owner-mfa-disable-err', '');
  }

  window.loadOwnerMfa = async function () {
    try { var d = await _f('GET', '/api/auth/mfa/status'); render(!!d.mfa_enabled); }
    catch (e) { /* unauthenticated at boot, or transient — leave the card as-is */ }
    if (typeof window.loadSecurityActivity === 'function') window.loadSecurityActivity();
  };

  // LC3d: "Recent security activity" — the person's own sign-ins, failed attempts, 2FA, password and alert events.
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var _WARN = { LOGIN_FAILED: 1, MFA_DISABLED: 1, MFA_CODE_REJECTED: 1, PASSWORD_RESET: 1, PASSWORD_RESET_FAILED: 1 };
  var _REASON = { wrong_password: 'wrong password', mfa_code: 'wrong 2FA code', blocked: 'account suspended', unknown_link: 'unknown link', expired: 'link expired',
    NEW_DEVICE_LOGIN: 'new device sign-in', MFA_DISABLED: '2FA turned off', CHANGE_PASSWORD: 'password changed', PASSWORD_RESET: 'password reset', enable: 'turning 2FA on', disable: 'turning 2FA off' };
  window.loadSecurityActivity = async function () {
    var box = _el('security-activity-list'); if (!box) return;
    try {
      var d = await _f('GET', '/api/auth/security-activity');
      var ev = (d && d.events) || [];
      if (!ev.length) { box.textContent = 'No security events yet.'; return; }
      box.innerHTML = ev.slice(0, 25).map(function (x) {
        var when = x.at ? new Date(x.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        var det = x.detail ? ' · ' + _esc(_REASON[x.detail] || x.detail) : '';
        return '<div class="sec-act-row" data-style="display:flex;flex-wrap:wrap;gap:4px 10px;padding:5px 0;border-bottom:1px solid var(--bd)">'
          + '<span data-style="min-width:150px;font-weight:600;color:' + (_WARN[x.action] ? 'var(--amber)' : 'var(--t1)') + '">' + _esc(x.label) + det + '</span>'
          + '<span data-style="color:var(--t3)">' + _esc(when) + '</span>'
          + '<span>' + _esc(x.device || '') + '</span>'
          + '<span data-style="font-family:var(--font-mono);color:var(--t3)">' + _esc(x.ip || '') + '</span></div>';
      }).join('');
    } catch (e) { box.textContent = 'Could not load security activity.'; }
  };

  window.startOwnerMfaSetup = async function () {
    try {
      var d = await _f('POST', '/api/auth/mfa/setup', {});
      var sec = _el('owner-mfa-secret'); if (sec) sec.textContent = d.secret || '';
      var su = _el('owner-mfa-setup'); if (su) su.style.display = '';
      var eb = _el('owner-mfa-enable-btn'); if (eb) eb.style.display = 'none';
      _setErr('owner-mfa-setup-err', '');
      var c = _el('owner-mfa-code'); if (c) { c.value = ''; try { c.focus(); } catch (_) {} }
    } catch (e) { _setErr('owner-mfa-setup-err', e.message || 'Could not start setup.'); }
  };

  window.confirmOwnerMfaEnable = async function () {
    var c = _el('owner-mfa-code'); var tok = c ? c.value.trim() : '';
    if (!tok) { _setErr('owner-mfa-setup-err', 'Enter the 6-digit code from your app.'); return; }
    try { await _f('POST', '/api/auth/mfa/enable', { token: tok }); render(true); }
    catch (e) { _setErr('owner-mfa-setup-err', e.message || 'Invalid code — try again.'); }
  };

  window.cancelOwnerMfaSetup = function () {
    var su = _el('owner-mfa-setup'); if (su) su.style.display = 'none';
    var eb = _el('owner-mfa-enable-btn'); if (eb) eb.style.display = '';
    _setErr('owner-mfa-setup-err', '');
  };

  window.disableOwnerMfa = async function () {
    var c = _el('owner-mfa-dcode'); var tok = c ? c.value.trim() : '';
    if (!tok) { _setErr('owner-mfa-disable-err', 'Enter a current code to confirm.'); return; }
    try { await _f('POST', '/api/auth/mfa/disable', { token: tok }); render(false); }
    catch (e) { _setErr('owner-mfa-disable-err', e.message || 'Invalid code.'); }
  };
})();
