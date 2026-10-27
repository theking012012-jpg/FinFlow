// Moved out of team-accept.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');
    let emailHasAccount = false;

    const show = id => { document.getElementById(id).style.display = ''; };
    const hide = id => { document.getElementById(id).style.display = 'none'; };
    const esc  = s => String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});

    if (!token) {
      hide('loading-panel'); show('invalid-panel');
    } else {
      loadInvite();
    }

    async function loadInvite() {
      try {
        const res  = await fetch('/api/team/accept?token=' + encodeURIComponent(token));
        const data = await res.json();
        if (!res.ok) { hide('loading-panel'); show('invalid-panel'); return; }

        emailHasAccount = !!data.emailHasAccount;
        document.getElementById('invite-summary').innerHTML =
          'You have been invited to join <b>' + esc(data.accountName) + '</b> as ' +
          '<span class="role-chip">' + esc(data.role) + '</span><br>' +
          '<span style="color:var(--t3)">for ' + esc(data.email) + '</span>';

        if (emailHasAccount) {
          document.getElementById('existing-email').textContent = data.email;
          show('existing-user-fields');
        } else {
          show('new-user-fields');
        }
        hide('loading-panel'); show('accept-panel');
      } catch (e) {
        hide('loading-panel'); show('invalid-panel');
      }
    }

    async function doAccept() {
      const msgEl = document.getElementById('accept-msg');
      const btn   = document.getElementById('accept-btn');
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = '';

      const body = { token };
      if (emailHasAccount) {
        const pw = document.getElementById('acc-existing-pw').value;
        if (!pw) { msgEl.textContent = 'Enter your existing password.'; return; }
        body.password = pw;
      } else {
        const name = document.getElementById('acc-name').value.trim();
        const pw1  = document.getElementById('acc-pw').value;
        const pw2  = document.getElementById('acc-pw2').value;
        if (!name)                 { msgEl.textContent = 'Enter your name.'; return; }
        if (!pw1 || pw1.length < 8) { msgEl.textContent = 'Password must be at least 8 characters.'; return; }
        if (pw1 !== pw2)           { msgEl.textContent = 'Passwords do not match.'; return; }
        body.name = name; body.password = pw1;
      }

      btn.disabled = true; btn.textContent = 'Joining…';
      try {
        const res  = await fetch('/api/team/accept', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok) {
          if (res.status === 400 && /invalid|expired/i.test(data.error || '')) {
            hide('accept-panel'); show('invalid-panel'); return;
          }
          msgEl.textContent = data.message || data.error || 'Could not accept. Please try again.';
          return;
        }

        hide('accept-panel'); show('success-panel');
        setTimeout(() => { window.location.href = '/app'; }, 1200);
      } catch (e) {
        msgEl.textContent = 'Network error. Please try again.';
      } finally {
        btn.disabled = false; btn.textContent = 'Accept invitation →';
      }
    }
