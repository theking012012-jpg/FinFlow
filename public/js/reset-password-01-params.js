// Moved out of reset-password.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
    // Extract token from URL
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');

    if (!token) {
      document.getElementById('reset-panel').style.display  = 'none';
      document.getElementById('invalid-panel').style.display = '';
    }

    async function doReset() {
      const pw1   = document.getElementById('new-pw').value;
      const pw2   = document.getElementById('confirm-pw').value;
      const msgEl = document.getElementById('reset-msg');
      const btn   = document.getElementById('reset-btn');

      msgEl.style.color = 'var(--red)';
      msgEl.textContent = '';

      if (!pw1 || pw1.length < 8) { msgEl.textContent = 'Password must be at least 8 characters.'; return; }
      if (pw1 !== pw2)             { msgEl.textContent = 'Passwords do not match.'; return; }

      btn.disabled = true;
      btn.textContent = 'Saving…';

      try {
        const res  = await fetch('/api/auth/reset-password', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token, password: pw1 }),
        });
        const data = await res.json();

        if (!res.ok) {
          msgEl.textContent = data.error || 'Reset failed. Please request a new link.';
          if (res.status === 400 && (data.error||'').includes('expired')) {
            document.getElementById('reset-panel').style.display  = 'none';
            document.getElementById('invalid-panel').style.display = '';
          }
          return;
        }

        document.getElementById('reset-panel').style.display   = 'none';
        document.getElementById('success-panel').style.display = '';
      } catch (e) {
        msgEl.textContent = 'Network error. Please try again.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Set new password →';
      }
    }
