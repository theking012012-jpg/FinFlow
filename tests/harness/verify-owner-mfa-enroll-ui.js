'use strict';
/**
 * verify-owner-mfa-enroll-ui.js — the owner 2FA enrollment card (finflow-owner-mfa.js) on Settings.
 * jsdom over a fixture that carries the REAL card element IDs (asserted present in index.html), with
 * stubbed fetch. Proves: status render, setup reveals the secret, enable→enabled, wrong-code error,
 * disable→disabled. No server.
 *
 *   node tests/harness/verify-owner-mfa-enroll-ui.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CARD = `
  <div id="owner-mfa-status">Loading…</div>
  <button id="owner-mfa-enable-btn" style="display:none"></button>
  <div id="owner-mfa-setup" style="display:none">
    <div id="owner-mfa-secret"></div>
    <input id="owner-mfa-code">
    <div id="owner-mfa-setup-err" style="display:none"></div>
  </div>
  <div id="owner-mfa-disable" style="display:none">
    <input id="owner-mfa-dcode">
    <div id="owner-mfa-disable-err" style="display:none"></div>
  </div>`;

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

  // Structural: the real index.html must carry every ID this card JS drives.
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  for (const id of ['owner-mfa-section', 'owner-mfa-status', 'owner-mfa-enable-btn', 'owner-mfa-setup', 'owner-mfa-secret', 'owner-mfa-code', 'owner-mfa-disable', 'owner-mfa-dcode']) {
    A('index.html carries #' + id, html.includes('id="' + id + '"'));
  }
  A('index.html loads finflow-owner-mfa.js after the bundle', /finflow-bundle\.js[\s\S]{0,80}finflow-owner-mfa\.js/.test(html));
  A('settings-open hook calls loadOwnerMfa (in the bundle)', fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'finflow-bundle.js'), 'utf8').includes('loadOwnerMfa'));

  const dom = new JSDOM('<!doctype html><html><body>' + CARD + '</body></html>', { runScripts: 'outside-only', url: 'https://x.test/app' });
  const { window } = dom;

  let enabled = false;            // server-side truth the stub reflects
  const GOOD = '654321';
  const calls = [];
  window.fetch = (p, opts) => {
    const body = (() => { try { return JSON.parse((opts && opts.body) || '{}'); } catch (_) { return {}; } })();
    calls.push({ path: String(p), method: opts && opts.method, body });
    if (String(p).endsWith('/api/auth/mfa/status')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mfa_enabled: enabled }) });
    if (String(p).endsWith('/api/auth/mfa/setup')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ secret: 'ABCD2345EFGH6789', otpauth: 'otpauth://totp/FinFlow:owner?secret=ABCD2345EFGH6789' }) });
    if (String(p).endsWith('/api/auth/mfa/enable')) {
      if (body.token === GOOD) { enabled = true; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mfa_enabled: true }) }); }
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Invalid code — check your authenticator app and try again.' }) });
    }
    if (String(p).endsWith('/api/auth/mfa/disable')) {
      if (body.token === GOOD) { enabled = false; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ mfa_enabled: false }) }); }
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Invalid code.' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };

  const $ = id => window.document.getElementById(id);
  try {
    window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'finflow-owner-mfa.js'), 'utf8'));
    A('card JS defines the handlers', ['loadOwnerMfa', 'startOwnerMfaSetup', 'confirmOwnerMfaEnable', 'disableOwnerMfa', 'cancelOwnerMfaSetup'].every(f => typeof window[f] === 'function'));

    // Status: disabled → Enable button shown, disable panel hidden.
    await window.loadOwnerMfa(); await new Promise(r => setTimeout(r, 10));
    A('status(disabled): Enable button shown', $('owner-mfa-enable-btn').style.display !== 'none');
    A('status(disabled): disable panel hidden', $('owner-mfa-disable').style.display === 'none');
    A('status(disabled): text reflects off', /off/i.test($('owner-mfa-status').textContent));

    // Setup: reveals the secret, hides the Enable button.
    await window.startOwnerMfaSetup(); await new Promise(r => setTimeout(r, 10));
    A('setup reveals the secret panel', $('owner-mfa-setup').style.display !== 'none');
    A('setup shows the returned secret', $('owner-mfa-secret').textContent === 'ABCD2345EFGH6789');
    A('setup POSTed /api/auth/mfa/setup', calls.some(c => c.path.endsWith('/mfa/setup') && c.method === 'POST'));

    // Enable with a wrong code → error, still not enabled.
    $('owner-mfa-code').value = '000000';
    await window.confirmOwnerMfaEnable(); await new Promise(r => setTimeout(r, 10));
    A('wrong enable code shows an error', $('owner-mfa-setup-err').style.display !== 'none' && /invalid/i.test($('owner-mfa-setup-err').textContent));
    A('wrong code did NOT flip to enabled', $('owner-mfa-disable').style.display === 'none');

    // Enable with the correct code → enabled UI.
    $('owner-mfa-code').value = GOOD;
    await window.confirmOwnerMfaEnable(); await new Promise(r => setTimeout(r, 10));
    A('correct code → disable panel shown (enabled)', $('owner-mfa-disable').style.display !== 'none');
    A('correct code → Enable button hidden', $('owner-mfa-enable-btn').style.display === 'none');
    A('correct code → status text reflects ON', /on\b/i.test($('owner-mfa-status').textContent));
    A('enable POST carried the token', calls.some(c => c.path.endsWith('/mfa/enable') && c.body.token === GOOD));

    // Disable with correct code → back to disabled UI.
    $('owner-mfa-dcode').value = GOOD;
    await window.disableOwnerMfa(); await new Promise(r => setTimeout(r, 10));
    A('disable → Enable button shown again', $('owner-mfa-enable-btn').style.display !== 'none');
    A('disable → disable panel hidden', $('owner-mfa-disable').style.display === 'none');
    A('disable POST carried the token', calls.some(c => c.path.endsWith('/mfa/disable') && c.body.token === GOOD));

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : fail + ' FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed  (owner MFA enrollment card)\n');
  } catch (e) {
    console.error('  PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail++;
  }
  process.exit(fail === 0 ? 0 : 1);
})();
