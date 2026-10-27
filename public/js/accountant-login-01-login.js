// Moved out of accountant-login.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const token = (document.getElementById('mfa-code') || {}).value ? document.getElementById('mfa-code').value.trim() : '';
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('error-msg');

  if (!email || !password) { showError('Please enter your email and password.'); return; }

  btn.disabled = true;
  btn.textContent = 'Signing in...';
  err.classList.remove('show');

  try {
    const res = await fetch('/api/accountants/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(token ? { email, password, token } : { email, password }),
    });
    const data = await res.json();
    if (data.mfaRequired) {
      document.getElementById('mfa-group').style.display = 'block';
      const mc = document.getElementById('mfa-code'); if (mc) mc.focus();
      showError(token ? 'Invalid authenticator code — please try again.' : 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (data.error) { showError(data.error); return; }
    window.location.href = '/accountant';
  } catch(e) {
    showError('Could not connect. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in →';
  }
}

function showError(msg) {
  const err = document.getElementById('error-msg');
  err.textContent = msg;
  err.classList.add('show');
}
