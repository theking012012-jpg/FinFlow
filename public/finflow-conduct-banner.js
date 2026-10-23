// D-E — the Professional Conduct Policy request, shown to an accountant who has not accepted the current version.
// Loaded by accountant-dashboard.html and accountant-client.html; each calls window.ffConductBanner(me.conduct) after
// /api/accountants/me. One component, so the two pages cannot word it differently.
(function () {
  'use strict';
  function fmt(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return String(iso || '').slice(0, 10); }
  }
  window.ffConductBanner = function (conduct) {
    const old = document.getElementById('ff-conduct-banner');
    if (old) old.remove();
    if (!conduct || !conduct.required) return null;
    const el = document.createElement('div');
    el.id = 'ff-conduct-banner';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'margin:0 0 16px;padding:14px 18px;border-radius:10px;border:1px solid ' + (conduct.paused ? '#c45c5c' : '#c9a84c') +
      ';background:' + (conduct.paused ? 'rgba(196,92,92,.12)' : 'rgba(201,168,76,.10)') + ';color:#f0ead6;font-size:13.5px;line-height:1.6;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between';
    const msg = document.createElement('div');
    msg.style.cssText = 'flex:1 1 320px';
    const head = document.createElement('strong');
    head.textContent = conduct.paused ? 'Access to client books is paused' : 'Please accept the Professional Conduct Policy';
    const body = document.createElement('div');
    body.textContent = conduct.paused
      ? 'Accept version ' + conduct.version + ' of the policy to open client books again. Messages with your clients still work.'
      : 'Version ' + conduct.version + ' needs your acceptance' + (conduct.graceEndsAt ? ' by ' + fmt(conduct.graceEndsAt) + ' — after that, access to client books pauses until you accept.' : '.');
    msg.appendChild(head); msg.appendChild(body);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;align-items:center';
    const read = document.createElement('a');
    read.href = conduct.url || '/conduct.html'; read.target = '_blank'; read.rel = 'noopener';
    read.textContent = 'Read the policy'; read.style.cssText = 'color:#c9a84c';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'ff-conduct-accept';
    btn.textContent = 'I have read it and accept';
    btn.style.cssText = 'background:#c9a84c;color:#0e0e0c;border:0;border-radius:7px;padding:8px 14px;font-weight:600;cursor:pointer';
    const err = document.createElement('div');
    err.style.cssText = 'flex:1 1 100%;color:#e08a8a;font-size:12.5px;display:none';
    btn.onclick = async function () {
      btn.disabled = true; err.style.display = 'none';
      try {
        const r = await fetch('/api/accountants/conduct/accept', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: conduct.version }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || ('Could not record your acceptance (' + r.status + ').'));
        el.remove();
        if (typeof window.ffConductAccepted === 'function') window.ffConductAccepted(d.conduct);
      } catch (e) { err.textContent = e.message; err.style.display = 'block'; btn.disabled = false; }
    };
    actions.appendChild(read); actions.appendChild(btn);
    el.appendChild(msg); el.appendChild(actions); el.appendChild(err);
    const host = document.querySelector('main') || document.body;
    host.insertBefore(el, host.firstChild);
    return el;
  };
})();
