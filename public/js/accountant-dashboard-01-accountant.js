// Moved out of accountant-dashboard.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
// ── STATE ─────────────────────────────────────────────────────────────────────
let accountant = null;
let clients = [];
let earnings = [];
let deadlines = [];

const APP_URL = window.location.origin;

// Escape any user-derived string before it goes into innerHTML. Client names/emails and deadline text
// are attacker-controllable (a linked client sets their own name), so every interpolation of them is
// escaped to prevent stored XSS in the accountant's session.
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

window.acctHelp = function(){
  try{ var ex=document.getElementById('acct-help-ov'); if(ex) ex.remove(); }catch(e){}
  var HOW=[
    ['Accept a client','A business invites you or requests a review. Open Requests, review it, and Approve to gain the access they granted.'],
    ['Review a client’s books','Open a client from your list to see their dashboard, reports, P&L, balance sheet and trial balance for the entities you were granted.'],
    ['Message a client','Use the in-app chat on the client’s page — private to your relationship and visible on both sides.'],
    ['Certify the books','When a client’s trial balance ties, issue a GL certification from their page — your marketplace trust signal.'],
    ['Complete verification (KYC)','Finish identity verification in your profile so clients see you as verified; your professional body links to its official register.'],
    ['Tax summary','Open a client → Tax Summary for deductible totals and the income-tax worksheet, scoped to their fiscal year.'],
    ['Getting paid','Referral months and commissions are tracked in your earnings; new paying clients advance your tier automatically.']
  ];
  var esc2=function(x){ return String(x==null?'':x).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
  var ov=document.createElement('div'); ov.id='acct-help-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:500;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow:auto';
  var how=HOW.map(function(h){ return '<details style="border-top:1px solid #2e2619;padding:9px 0"><summary style="cursor:pointer;font-size:13.5px;color:#f2e8d5;font-weight:500">'+esc2(h[0])+'</summary><div style="font-size:12.5px;color:#9e8e73;margin-top:6px;line-height:1.6">'+esc2(h[1])+'</div></details>'; }).join('');
  ov.innerHTML='<div style="max-width:560px;width:100%;background:#171208;border:1px solid #2e2619;border-radius:14px;padding:20px 22px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px"><div style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#e4c97a">Help & support</div><button id="ah-x" aria-label="Close" style="background:none;border:none;color:#9e8e73;font-size:18px;cursor:pointer">&#10005;</button></div>'
    +'<div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;margin:8px 0 0">Working in the portal</div>'+how
    +'<div style="border-top:1px solid #2e2619;margin-top:16px;padding-top:14px"><div style="font-family:monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;margin-bottom:8px">Contact FinFlow</div>'
    +'<input id="ah-subject" placeholder="Subject" style="width:100%;box-sizing:border-box;background:#201910;border:1px solid #2e2619;border-radius:7px;color:#f2e8d5;padding:9px 11px;font-size:13px;margin-bottom:8px">'
    +'<textarea id="ah-msg" placeholder="How can we help?" style="width:100%;box-sizing:border-box;min-height:80px;resize:vertical;background:#201910;border:1px solid #2e2619;border-radius:7px;color:#f2e8d5;padding:9px 11px;font-size:13px"></textarea>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px"><span style="font-size:11.5px;color:#6a5c44">or email <a href="mailto:support@finflow.app" style="color:#c9a84c">support@finflow.app</a></span><button id="ah-send" style="background:#c9a84c;color:#16120d;border:none;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer">Send</button></div>'
    +'<div id="ah-status" style="font-size:12px;margin-top:6px"></div></div></div>';
  document.body.appendChild(ov);
  var close=function(){ try{ov.remove();}catch(e){} };
  document.getElementById('ah-x').onclick=close;
  ov.onclick=function(e){ if(e.target===ov) close(); };
  var b=document.getElementById('ah-send');
  if(b) b.onclick=async function(){
    var subj=(document.getElementById('ah-subject')||{}).value||'';
    var msg=(document.getElementById('ah-msg')||{}).value||'';
    var st=document.getElementById('ah-status');
    if(!msg.trim()){ if(st){ st.style.color='#d0705f'; st.textContent='Please add a message.'; } return; }
    b.disabled=true; b.textContent='Sending…';
    try{
      var r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({subject:subj,message:msg,category:'accountant'})});
      if(!r.ok){ var j=await r.json().catch(function(){return {};}); if(st){ st.style.color='#d0705f'; st.textContent=j.error||'Could not send — please email us instead.'; } b.disabled=false; b.textContent='Send'; return; }
      if(st){ st.style.color='#7db87d'; st.textContent='Sent ✓ We’ll reply by email.'; }
      var s1=document.getElementById('ah-subject'), m1=document.getElementById('ah-msg'); if(s1)s1.value=''; if(m1)m1.value='';
      b.textContent='Sent ✓';
    }catch(e){ if(st){ st.style.color='#d0705f'; st.textContent='Network error — please email us instead.'; } b.disabled=false; b.textContent='Send'; }
  };
};

// Promise-based confirm modal (replaces native confirm() — consistent styling, non-blocking).
function confirmModal(message, opts){
  opts = opts || {};
  return new Promise(function(resolve){
    var done = false;
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div style="background:var(--card);border:1px solid var(--border2);border-radius:16px;padding:24px;width:400px;max-width:90vw">'
      + '<p style="font-size:14px;color:var(--text);line-height:1.5;margin-bottom:20px">' + esc(message) + '</p>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-outline" id="cm-no">Cancel</button>'
      + '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-gold') + '" id="cm-yes">' + esc(opts.okLabel || 'Confirm') + '</button></div></div>';
    document.body.appendChild(ov);
    var close = function(v){ if(done) return; done = true; try{ov.remove();}catch(e){} resolve(v); };
    ov.querySelector('#cm-no').onclick = function(){ close(false); };
    ov.querySelector('#cm-yes').onclick = function(){ close(true); };
    ov.onclick = function(e){ if(e.target===ov) close(false); };
  });
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const res = await fetch('/api/accountants/me', { credentials: 'include' });
    if (!res.ok) {
      window.location.href = '/accountant-login';
      return;
    }
    accountant = await res.json();
    // D-E: ask for the current Professional Conduct Policy; on acceptance, reload what the pause had blocked.
    window.ffConductAccepted = function () { accountant.conduct = null; loadClients(); loadRollup(); };
    if (window.ffConductBanner) window.ffConductBanner(accountant.conduct);
    initUI();
    loadClients();
    loadEarnings();
    loadPendingRequests();
    loadDeadlines();
    loadRollup();
  } catch (e) {
    console.error('Boot error:', e);
    window.location.href = '/accountant-login';
  }
}

async function loadRollup() {
  const section = document.getElementById('attention-section');
  const list = document.getElementById('attention-list');
  if (!section || !list) return;
  try {
    const res = await fetch('/api/accountants/rollup', { credentials: 'include' });
    if (!res.ok) { section.style.display = 'none'; return; }
    const d = await res.json();
    const t = d.totals || {};
    const chips = [];
    if (t.unreadMessages) chips.push(`<span style="color:var(--gold)">${t.unreadMessages} unread</span>`);
    if (t.pendingProposals) chips.push(`${t.pendingProposals} proposal${t.pendingProposals>1?'s':''} pending`);
    if (t.overdueTasks) chips.push(`<span style="color:var(--red,#c0392b)">${t.overdueTasks} overdue request${t.overdueTasks>1?'s':''}</span>`);
    else if (t.openTasks) chips.push(`${t.openTasks} open request${t.openTasks>1?'s':''}`);
    const overdueDl = (d.deadlines||[]).filter(x=>x.overdue).length;
    if (overdueDl) chips.push(`<span style="color:var(--red,#c0392b)">${overdueDl} overdue deadline${overdueDl>1?'s':''}</span>`);

    const clients = d.clients || [];
    if (!clients.length && !overdueDl) { section.style.display = 'none'; return; }
    const badge = document.getElementById('attention-badge');
    if (badge) badge.textContent = clients.length ? (clients.length + (clients.length>1?' clients':' client')) : '';
    const pill = (txt, danger) => `<span style="font-size:11px;padding:2px 9px;border-radius:100px;background:${danger?'rgba(192,57,43,0.12)':'rgba(201,168,76,0.1)'};color:${danger?'var(--red,#c0392b)':'var(--gold)'};border:1px solid ${danger?'rgba(192,57,43,0.3)':'var(--gold-dim)'}">${txt}</span>`;
    list.innerHTML = clients.map(cl => {
      const bits = [];
      if (cl.unread) bits.push(pill(cl.unread + ' unread', false));
      if (cl.pendingProposals) bits.push(pill(cl.pendingProposals + ' proposal' + (cl.pendingProposals>1?'s':''), false));
      if (cl.overdueTasks) bits.push(pill(cl.overdueTasks + ' overdue', true));
      else if (cl.openTasks) bits.push(pill(cl.openTasks + ' open', false));
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--card,#161310);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:13.5px;color:var(--text1)">${esc(cl.name)}</span>${bits.join(' ')}</div>
          <button class="btn btn-outline btn-sm" onclick="viewBooks(${cl.user_id},'${esc(String(cl.name).replace(/'/g,''))}')">Open →</button>
        </div>`;
    }).join('') || `<div style="font-size:13px;color:var(--text3);padding:4px 2px">${overdueDl} overdue filing deadline${overdueDl>1?'s':''} — see Deadlines.</div>`;
    section.style.display = 'block';
  } catch (e) { section.style.display = 'none'; }
}

async function loadPendingRequests() {
  try {
    const res = await fetch('/api/accountants/pending-requests', { credentials: 'include' });
    if (!res.ok) return;
    const requests = await res.json();

    const section = document.getElementById('pending-requests-section');
    const list    = document.getElementById('pending-requests-list');

    if (!requests.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    const badge = document.getElementById('pending-count-badge');
    if (badge) badge.textContent = requests.length + ' pending';

    list.innerHTML = requests.map(r => {
      const name    = (r.client_name && r.client_name.trim()) ? r.client_name : r.client_email;
      const date    = r.requested_at ? new Date(r.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      const plan    = r.client_plan || 'trial';
      return `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--card);border:1px solid rgba(196,138,42,0.35);border-radius:10px;">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(196,138,42,0.12);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">👤</div>
          <div style="flex:1;">
            <div style="font-size:13px;color:var(--text);font-weight:500;">${esc(name)}</div>
            <div style="font-size:12px;color:var(--text3);margin-top:2px;">${esc(r.client_email)} · <span class="badge badge-gold">${esc(plan)}</span> · Requested ${esc(date)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${r.requested_by === 'client'
              ? `<button class="btn btn-gold btn-sm" onclick="approveRequest(${r.user_id}, this)">Approve</button>`
              : `<span style="font-size:11px;color:var(--text3);">Referral — awaiting client approval</span>`}
            <button class="btn btn-danger btn-sm" onclick="declineRequest(${r.user_id}, this)">Decline</button>
          </div>
        </div>`;
    }).join('');

    // Also update the pending stat card
    document.getElementById('stat-pending').textContent = requests.length;
  } catch (e) {
    console.error('Could not load pending requests:', e);
  }
}

async function approveRequest(userId, btn) {
  btn.disabled = true;
  btn.textContent = 'Approving…';
  try {
    const res = await fetch('/api/accountants/approve-request', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); btn.disabled = false; btn.textContent = 'Approve'; return; }
    toast('Client approved — they now have access to link with you ✓', 'success');
    loadPendingRequests();
    loadClients();
  } catch (e) {
    toast('Could not approve request', 'error');
    btn.disabled = false;
    btn.textContent = 'Approve';
  }
}

async function declineRequest(userId, btn) {
  if (!(await confirmModal('Decline this access request? The client will not be notified.', {danger:true, okLabel:'Decline'}))) return;
  btn.disabled = true;
  try {
    await fetch('/api/accountants/decline-request', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    toast('Request declined', 'success');
    loadPendingRequests();
  } catch (e) {
    toast('Could not decline request', 'error');
    btn.disabled = false;
  }
}

async function activateClient(userId) {
  try {
    const res = await fetch('/api/accountants/activate-client', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }
    toast('Client approved ✓', 'success');
    loadClients();
  } catch(e) { toast('Could not approve client', 'error'); }
}

async function rejectClient(userId) {
  if (!(await confirmModal('Reject this client request? They will remain on the platform but will not be linked to you.', {danger:true, okLabel:'Reject'}))) return;
  try {
    const res = await fetch('/api/accountants/reject-client', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }
    toast('Request rejected', 'success');
    loadClients();
  } catch(e) { toast('Could not reject client', 'error'); }
}

function initUI() {
  const name = `${accountant.first_name} ${accountant.last_name}`;
  document.getElementById('nav-name').textContent = name;
  document.getElementById('first-name').textContent = accountant.first_name;

  const statusMap = { verified: '✓ Verified', pending: 'Pending review', rejected: 'Rejected', suspended: 'Suspended' };
  const avgRating = parseFloat(accountant.avg_rating) || 0;
  if (avgRating >= 4.5) {
    const ppBadge = document.createElement('span');
    ppBadge.style.cssText = 'font-size:11px;background:rgba(201,168,76,0.15);color:var(--gold);border:1px solid rgba(201,168,76,0.4);border-radius:4px;padding:3px 8px;margin-left:8px';
    ppBadge.textContent = '★ Preferred Partner';
    document.getElementById('nav-name').insertAdjacentElement('afterend', ppBadge);
  }
  const badgeEl = document.getElementById('nav-badge');
  badgeEl.textContent = statusMap[accountant.status] || accountant.status;
  if (accountant.status === 'verified') { badgeEl.style.color = 'var(--green)'; badgeEl.style.borderColor = 'rgba(74,156,109,0.4)'; badgeEl.style.background = 'var(--green-bg)'; }

  document.getElementById('pf-status').textContent = statusMap[accountant.status] || accountant.status;
  if (accountant.status === 'verified') document.getElementById('pf-status').style.color = 'var(--green)';

  // Referral link
  const refUrl = `${APP_URL}/register?ref=${accountant.referral_code}`;
  document.getElementById('referral-url').textContent = refUrl;
  document.getElementById('referral-url-2').textContent = refUrl;

  // Profile fields
  document.getElementById('pf-fname').value = accountant.first_name || '';
  document.getElementById('pf-lname').value = accountant.last_name || '';
  document.getElementById('pf-email').value = accountant.email || '';
  document.getElementById('pf-firm').value = accountant.firm || '';
  document.getElementById('pf-country').value = accountant.country || '';
  document.getElementById('pf-spec').value = accountant.specialisation || '';
  document.getElementById('pf-exp').value = accountant.experience || '';
  document.getElementById('pf-bio').value = accountant.bio || '';
  if (typeof loadKyc === 'function') loadKyc(accountant.kyc_status, accountant.kyc_verified_at);
  if (typeof loadMfa === 'function') loadMfa();

  // Status line
  document.getElementById('status-line').textContent = accountant.status === 'verified'
    ? `Verified ${accountant.firm ? '· ' + accountant.firm : ''} · ${accountant.specialisation || ''}`
    : 'Your profile is pending verification — you\'ll be notified within 1–2 business days.';

  renderDeadlines();
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
async function loadClients() {
  try {
    const res = await fetch('/api/accountants/clients', { credentials: 'include' });
    clients = await res.json();
    renderClients();
    updateStats();
    updateTierWidget();
  } catch (e) {
    document.getElementById('dashboard-clients-tbody').innerHTML = '<tr class="loading-row"><td colspan="6">Could not load clients.</td></tr>';
  }
}

function renderClients() {
  const now = new Date();

  function activityBadge(c) {
    const lastLogin = c.last_login ? new Date(c.last_login) : null;
    const lastInv = c.last_invoice ? new Date(c.last_invoice) : null;
    const lastExp = c.last_expense ? new Date(c.last_expense) : null;
    const dates = [lastLogin, lastInv, lastExp].filter(Boolean);
    const ref = dates.length ? new Date(Math.max(...dates)) : null;
    if (!ref) return `<span style="font-size:11px;color:var(--text3)">Never active</span>`;
    const days = Math.floor((now - ref) / 86400000);
    if (days <= 1)  return `<span style="font-size:11px;color:var(--green)">&#9679; Active today</span>`;
    if (days <= 7)  return `<span style="font-size:11px;color:var(--green)">&#9679; ${days}d ago</span>`;
    if (days <= 30) return `<span style="font-size:11px;color:var(--amber)">&#9679; ${days}d ago</span>`;
    return `<span style="font-size:11px;color:var(--red)">&#9679; ${days}d ago &mdash; ghost?</span>`;
  }

  const rows = clients.length === 0
    ? '<tr class="loading-row"><td colspan="8">No clients yet. <a style="color:var(--gold);cursor:pointer" onclick="showPage(\'invite\')">Invite your first client &rarr;</a></td></tr>'
    : clients.map(c => `
      <tr>
        <td class="primary">${esc(c.client_name && c.client_name.trim() ? c.client_name : c.client_email)}</td>
        <td style="font-size:12px;color:var(--text3)">${esc(c.client_email) || '&mdash;'}</td>
        <td><span class="badge badge-gold">${esc(c.client_plan || 'trial')}</span></td>
        <td><span class="badge ${c.status === 'active' ? 'badge-green' : c.status === 'pending' ? 'badge-amber' : 'badge-red'}">${c.status === 'active' ? 'Active' : c.status === 'pending' ? 'Pending' : c.status === 'invited' ? 'Invited' : 'Pending'}</span></td>
        <td>${activityBadge(c)}</td>
        <td>${c.referral_month ?? 0}/${c.referral_months_total ?? 0} months</td>
        <td>${c.status === 'pending'
          ? `<button class="btn btn-gold btn-sm" onclick="activateClient(${c.id})">Approve</button> <button class="btn btn-outline btn-sm" style="color:var(--red,#c0392b);border-color:var(--red,#c0392b)" onclick="rejectClient(${c.id})">Reject</button>`
          : `<button class="btn btn-outline btn-sm" onclick="viewBooks(${c.id},'${esc(((c.client_name&&c.client_name.trim())?c.client_name:c.client_email||'').replace(/'/g,''))}')">View books</button>`
        }</td>
      </tr>`).join('');

  document.getElementById('clients-tbody').innerHTML = rows;

  // Dashboard preview (first 5)
  const dashRows = clients.slice(0, 5).map(c => `
    <tr>
      <td class="primary">${esc(c.client_name && c.client_name.trim() ? c.client_name : c.client_email)}</td>
      <td><span class="badge badge-gold">${esc(c.client_plan || 'trial')}</span></td>
      <td><span class="badge ${c.status === 'active' ? 'badge-green' : 'badge-amber'}">${c.status === 'active' ? 'Active' : c.status === 'pending' ? 'Pending' : c.status === 'invited' ? 'Invited' : 'Pending'}</span></td>
      <td>${activityBadge(c)}</td>
      <td>${c.activated_at ? new Date(c.activated_at).toLocaleDateString() : '&mdash;'}</td>
      <td><button class="btn btn-outline btn-sm" onclick="viewBooks(${c.id},'${esc(((c.client_name&&c.client_name.trim())?c.client_name:c.client_email||'').replace(/'/g,''))}')">View books</button></td>
    </tr>`).join('') || '<tr class="loading-row"><td colspan="6">No clients yet.</td></tr>';
  document.getElementById('dashboard-clients-tbody').innerHTML = dashRows;
}

function updateStats() {
  const active = clients.filter(c => c.status === 'active').length;
  const pending = clients.filter(c => c.status === 'pending').length;
  document.getElementById('stat-clients').textContent = active;
  document.getElementById('stat-pending').textContent = pending;
}

function updateTierWidget() {
  // F17: "active client" = consented AND paying (subscriptionStatus='active'),
  // matching the backend. Tiers come from the shared /tier-config.js — one source.
  const T = window.FinFlowTiers;
  const active = clients.filter(c => c.status === 'active' && c.subscription_status === 'active').length;
  const tiers = T.TIERS;
  const current = T.tierForAccountant(active);

  // Per-tier badges: '✓ Achieved' below current, 'Current', or 'N to go' above.
  tiers.forEach(t => {
    const badge = document.getElementById('tier-badge-' + t.name.toLowerCase());
    if (!badge) return;
    if (t.name === current.name) { badge.textContent = 'Current'; badge.className = 'badge badge-green'; }
    else if (active > t.max)     { badge.textContent = '✓ Achieved'; badge.className = 'badge badge-green'; }
    else { badge.textContent = `${Math.max(0, t.min - active)} to go`; badge.className = 'badge'; }
  });

  // Progress toward the next tier (or full bar at the top tier).
  const idx = tiers.findIndex(t => t.name === current.name);
  const next = tiers[idx + 1];
  let progress, label;
  if (!next) {
    progress = 100;
    label = `${active} paying clients — maximum tier`;
  } else {
    const span = next.min - current.min;
    progress = span > 0 ? ((active - current.min) / span) * 100 : 0;
    label = `${active} paying · ${next.min - active} to ${next.name}`;
  }

  document.getElementById('tier-name').textContent = current.name;
  document.getElementById('tier-bar').style.width = Math.min(Math.max(progress, 0), 100) + '%';
  document.getElementById('tier-label').innerHTML = `<span>${label}</span>`;
}

// ── EARNINGS ──────────────────────────────────────────────────────────────────
async function loadEarnings() {
  try {
    const res = await fetch('/api/accountants/earnings', { credentials: 'include' });
    const data = await res.json();
    earnings = data.earnings || [];

    // FA-L3g: the cards show the server's figures (earnings-figures.js — all rows, unpaid bills apart), not a sum of
    // the 100 rows listed below. FA-L3f: "this month" is the server's booking month (Rule 10 — no viewer clock).
    const FD = window.FinFlowDates;
    const sm = data.summary || {};
    const usd = c => '$' + ((Number(c) || 0) / 100).toFixed(2);
    const mtd = usd(sm.thisMonthCents);

    document.getElementById('stat-mtd').textContent = mtd;
    document.getElementById('earn-total').textContent = usd(sm.earnedCents);
    document.getElementById('earn-total-sub').textContent = Number(sm.awaitingClientCents) > 0 ? 'All time · + ' + usd(sm.awaitingClientCents) + ' billed, waiting for the client' : 'All time';
    document.getElementById('earn-mtd').textContent = mtd;
    document.getElementById('earn-pending').textContent = usd(sm.referralOwedCents);

    const rows = earnings.length === 0
      ? '<tr class="loading-row"><td colspan="5">No earnings yet. Invite clients to start earning.</td></tr>'
      : earnings.map(e => `
        <tr>
          <td>${e.period_month ? FD.calendarLabel(e.period_month, { month: 'short', year: 'numeric' }) : '—'}</td>
          <td><span class="badge ${e.type === 'referral' ? 'badge-gold' : 'badge-green'}">${e.type === 'referral' ? 'Referral' : 'Service'}</span></td>
          <td>${esc(e.description || '—')}</td>
          <td class="gold">$${(e.amount_cents / 100).toFixed(2)}</td>
          <td><span class="badge ${e.status === 'paid' ? 'badge-green' : 'badge-amber'}"${e.payout_transfer_id ? ` title="Stripe transfer ${esc(e.payout_transfer_id)}"` : ''}>${esc(_earningStatus(e))}</span></td>
        </tr>`).join('');

    document.getElementById('earnings-tbody').innerHTML = rows;
  } catch (e) {
    document.getElementById('earnings-tbody').innerHTML = '<tr class="loading-row"><td colspan="5">Could not load earnings.</td></tr>';
  }
}

// ── DEADLINES ─────────────────────────────────────────────────────────────────
function renderDeadlines() {
  // L18 (Rule 10): deadlines are CALENDAR dates. "today" is the resolved calendar date (UTC — viewer-independent,
  // the client convention) and day differences are whole calendar days between date STRINGS. The old
  // local-midnight Date vs new Date('YYYY-MM-DD') (UTC midnight) showed a filing due today as "1 days overdue"
  // for every viewer west of UTC.
  const _ymd = new Date().toISOString().slice(0, 10);
  const _dayN = s => { const p = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; };
  const today = _dayN(_ymd);
  const DAY = 1;
  // OVERDUE (past-due) items are the most urgent and must NOT be hidden — show them FIRST (most overdue
  // at top), then upcoming soonest-first. Only truly-future items were shown before, so overdue filings
  // silently vanished.
  const open = [...deadlines].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const overdue = open.filter(d => _dayN(d.date) < today).reverse(); // most overdue first
  const upcoming = open.filter(d => _dayN(d.date) >= today);
  const ordered = overdue.concat(upcoming);

  // Stat = items needing attention: overdue + due within the next 30 days.
  const needsAttention = ordered.filter(d => (_dayN(d.date) - today) <= 30).length;
  document.getElementById('stat-deadlines').textContent = needsAttention;

  const row = d => {
    const diff = _dayN(d.date) - today;
    const urgency = diff < 0 ? 'urgent' : diff <= 7 ? 'urgent' : diff <= 21 ? 'soon' : 'ok';
    const daysLabel = diff === 0 ? 'Due today' : diff < 0 ? `${Math.abs(diff)} days overdue` : `${diff} days left`;
    return `
      <div class="deadline-item ${urgency}">
        <div class="deadline-dot ${urgency}"></div>
        <div class="deadline-info">
          <div class="deadline-client">${esc(d.client)}</div>
          <div class="deadline-type">${esc(d.type)}</div>
        </div>
        <div class="deadline-date">
          <div>${(() => { const y = String(d.date).slice(0, 10); const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return MN[+y.slice(5,7)-1] + ' ' + (+y.slice(8,10)) + ', ' + y.slice(0,4); })()}</div>
          <div class="deadline-days ${urgency}">${daysLabel}</div>
        </div>
      </div>`;
  };

  document.getElementById('dashboard-deadlines').innerHTML = ordered.length === 0
    ? '<div style="color:var(--text3);font-size:13px;padding:16px 0;text-align:center;">No deadlines. <a style="color:var(--gold);cursor:pointer" onclick="openDeadlineModal()">Add one →</a></div>'
    : ordered.slice(0, 5).map(row).join('');

  document.getElementById('all-deadlines').innerHTML = ordered.length === 0
    ? '<div style="color:var(--text3);font-size:13px;padding:16px 0;text-align:center;">No deadlines yet.</div>'
    : ordered.map(row).join('');
}

function openDeadlineModal() { document.getElementById('deadline-modal').classList.add('open'); }
function closeDeadlineModal() { document.getElementById('deadline-modal').classList.remove('open'); }

async function loadDeadlines() {
  try {
    const res = await fetch('/api/accountants/deadlines', { credentials: 'include' });
    if (!res.ok) return;
    const rows = await res.json();
    deadlines = rows.map(r => ({ id: r.id, client: r.client_name, type: r.filing_type, date: r.due_date.slice(0,10) }));
    renderDeadlines();
  } catch(e) {}
}

async function saveDeadline() {
  const client = document.getElementById('dl-client').value.trim();
  const type = document.getElementById('dl-type').value;
  const date = document.getElementById('dl-date').value;
  if (!client || !date) { toast('Please fill in all fields', 'error'); return; }
  try {
    const res = await fetch('/api/accountants/deadlines', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: client, filing_type: type, due_date: date }),
    });
    if (!res.ok) { toast('Could not save deadline', 'error'); return; }
    const row = await res.json();
    deadlines.push({ id: row.id, client: row.client_name, type: row.filing_type, date: row.due_date.slice(0,10) });
    closeDeadlineModal();
    renderDeadlines();
    toast('Deadline saved', 'success');
    document.getElementById('dl-client').value = '';
    document.getElementById('dl-date').value = '';
  } catch(e) { toast('Could not save deadline', 'error'); }
}

// ── INVITE ────────────────────────────────────────────────────────────────────
async function sendInvite() {
  const email = document.getElementById('invite-email').value.trim();
  const name = document.getElementById('invite-name').value.trim();
  if (!email) { toast('Please enter a client email', 'error'); return; }
  try {
    const res = await fetch('/api/accountants/invite', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }
    toast(`Invitation sent to ${email}`, 'success');
    document.getElementById('invite-email').value = '';
    document.getElementById('invite-name').value = '';
  } catch (e) {
    toast('Could not send invite. Try again.', 'error');
  }
}

function copyRef() {
  const url = `${APP_URL}/register?ref=${accountant?.referral_code}`;
  navigator.clipboard.writeText(url).then(() => toast('Referral link copied!', 'success'));
}

// ── CLIENT BOOKS ─────────────────────────────────────────────────────────────
const fmt = v => '$' + parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function viewBooks(clientId, clientName) {
  if (!clientId) return;
  window.location.href = '/accountant-client?client=' + clientId + '&name=' + encodeURIComponent(clientName || '');
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
async function logout() {
  await fetch('/api/accountants/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/accountant-login';
}

// ── NAV ───────────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`[onclick="showPage('${name}')"]`)?.classList.add('active');
  closeSidebar(); // collapse the mobile overlay after choosing a page
}

// Mobile sidebar overlay toggle.
function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  const scrim = document.getElementById('sidebar-scrim');
  const open = sb.classList.toggle('mobile-open');
  if (scrim) scrim.classList.toggle('open', open);
}
function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebar-scrim')?.classList.remove('open');
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// FA-L3d: what happened to each earning, in words — referral pay is sent by Stripe transfer.
function _earningStatus(e) {
  if (e.status === 'paid' && e.payout_sent_at) return 'Sent to Stripe · ' + new Date(e.payout_sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (e.status === 'refunded') return 'Refunded to the client — not earned';   // FA-L3i
  if (e.status === 'paid' && e.refunded_cents > 0) return 'Paid · partly refunded';
  if (e.status === 'paid') return 'Paid';
  if (e.status === 'awaiting_payment') return 'Client has not paid yet';
  if (e.payout_status === 'claimed' || e.payout_status === 'failed') return 'Sending to Stripe';
  if (e.type === 'referral') return 'Due — sent this month';
  return e.status;
}

// ── STRIPE CONNECT ───────────────────────────────────────────────────────────
async function checkStripeStatus() {
  try {
    const res = await fetch('/api/accountants/stripe-status', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const banner = document.getElementById('stripe-banner');
    const badge  = document.getElementById('stripe-connected-badge');
    const main   = document.querySelector('.main');
    if (data.connected) {
      if (banner) banner.style.display = 'none';
      if (badge)  badge.style.display = 'flex';
    } else {
      if (banner) banner.style.display = 'flex';
      if (badge)  badge.style.display = 'none';
    }
    // The banner/badge are position:fixed over the top of the content — pad the scroll area so they
    // never cover the page header.
    if (main) main.style.paddingTop = (data.connected ? 40 : 44) + 'px';
    // FA-L3d: referral pay goes out by Stripe transfer only once Stripe has enabled transfers to this account
    const sub = document.getElementById('earn-pending-sub');
    if (sub) sub.textContent = data.transfersEnabled ? 'Sent to your Stripe account automatically each month' : 'Finish connecting Stripe to receive it';
  } catch(e) {}
}

async function connectStripe() {
  try {
    const res = await fetch('/api/accountants/stripe-connect', {
      method: 'POST', credentials: 'include',
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }
    window.location.href = data.url;
  } catch(e) {
    toast('Could not connect Stripe. Try again.', 'error');
  }
}

// ── BILL CLIENT ───────────────────────────────────────────────────────────────
function openBillModal() {
  // Populate client dropdown
  const sel = document.getElementById('bill-client-select');
  const activeClients = clients.filter(c => c.status === 'active');
  if (!activeClients.length) { toast('No active clients to bill', 'error'); return; }
  sel.innerHTML = '<option value="">Select client...</option>' +
    activeClients.map(c => `<option value="${c.id}">${esc(c.client_name && c.client_name.trim() ? c.client_name : c.client_email)}</option>`).join('');
  document.getElementById('bill-breakdown').style.display = 'none';
  document.getElementById('bill-amount').value = '';
  // FA-L3: the label and the input's minimum come from tier-config — the rule bill-client enforces
  const minBill = _minBillCents();
  document.getElementById('bill-amount-label').textContent = 'Amount (USD) — minimum $' + (minBill / 100).toFixed(2);
  document.getElementById('bill-amount').min = String(minBill / 100);
  document.getElementById('bill-description').value = '';
  document.getElementById('bill-modal').classList.add('open');
}

// The dashboard bills in USD (FA-L3e); 0 when tier-config sets no USD minimum.
function _minBillCents() { return window.FinFlowTiers.minBillMinor('usd') || 0; }

document.addEventListener('input', function(e) {
  if (e.target.id === 'bill-amount') {
    const amt = parseFloat(e.target.value) || 0;
    if (Math.round(amt * 100) >= _minBillCents()) {
      // F17: LIVE tier commission from the shared /tier-config.js — the same split
      // the backend applies (Stripe fee off the top → commission → you net the rest).
      // First 3 active paying clients are commission-free.
      const T = window.FinFlowTiers;
      const activeCount = clients.filter(c => c.status === 'active' && c.subscription_status === 'active').length;
      const rate = T.commissionRateFor(activeCount);
      const cents = Math.round(amt * 100);
      const split = T.splitBilling(cents, rate, T.estimateStripeFeeCents(cents));
      const fmt = c => '$' + (c / 100).toFixed(2);
      document.getElementById('bill-total').textContent = fmt(split.billedCents);
      document.getElementById('bill-stripe').textContent = '−' + fmt(split.stripeFeeCents);
      document.getElementById('bill-fee-label').textContent = `FinFlow commission (${(rate * 100).toFixed(0)}%)`;
      document.getElementById('bill-fee').textContent = '−' + fmt(split.commissionCents);
      document.getElementById('bill-receive').textContent = fmt(split.accountantNetCents);
      document.getElementById('bill-breakdown').style.display = 'block';
    } else {
      document.getElementById('bill-breakdown').style.display = 'none';
    }
  }
});

async function submitBill() {
  const clientUserId = document.getElementById('bill-client-select').value;
  const description = document.getElementById('bill-description').value.trim();
  const amount = parseFloat(document.getElementById('bill-amount').value);

  if (!clientUserId) { toast('Please select a client', 'error'); return; }
  if (!description) { toast('Please enter a service description', 'error'); return; }
  const minBill = _minBillCents();   // FA-L3: the same minimum the server enforces
  if (!amount || Math.round(amount * 100) < minBill) { toast('Minimum bill is $' + (minBill / 100).toFixed(2), 'error'); return; }

  const amountCents = Math.round(amount * 100);

  try {
    const res = await fetch('/api/accountants/bill-client', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientUserId, description, amountCents }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }
    document.getElementById('bill-modal').classList.remove('open');
    toast(data.emailed ? 'Payment link created — the client has been emailed ✓' : 'Payment link created — send it to your client ✓', 'success');
    // Open the Stripe checkout in a new tab
    if (data.url) window.open(data.url, '_blank');
  } catch(e) {
    toast('Could not create payment link', 'error');
  }
}

// ── KYC / Identity verification (Stripe Identity, Phase B) ──────────────────────
function _kycRender(status, verifiedAt){
  const badge=document.getElementById('kyc-badge'), btn=document.getElementById('kyc-start-btn'), msg=document.getElementById('kyc-msg');
  if(!badge) return;
  const map={verified:['badge-green','\u2713 Verified'],pending:['badge-amber','\u23f3 In review'],failed:['badge-red','\u2717 Not verified \u2014 retry'],not_started:['badge-amber','Not verified']};
  const m=map[status||'not_started']||map.not_started;
  badge.className='badge '+m[0]; badge.textContent=m[1];
  if(btn) btn.style.display=(status==='verified'||status==='pending')?'none':'inline-flex';
  if(msg){ msg.style.color='var(--text3)'; msg.textContent=(status==='verified'&&verifiedAt)?('Verified on '+new Date(verifiedAt).toLocaleDateString()):''; }
}
async function loadKyc(preStatus, preVerifiedAt){
  if(preStatus){ _kycRender(preStatus, preVerifiedAt); return; }
  try{
    const r=await fetch('/api/accountants/kyc/status',{credentials:'include'});
    if(!r.ok){ _kycRender('not_started'); return; }
    const d=await r.json(); _kycRender(d.kyc_status, d.kyc_verified_at);
  }catch(e){ _kycRender('not_started'); }
}
async function startKyc(){
  const btn=document.getElementById('kyc-start-btn'), msg=document.getElementById('kyc-msg');
  if(btn){ btn.disabled=true; btn.textContent='Starting\u2026'; }
  if(msg){ msg.style.color='var(--text3)'; msg.textContent=''; }
  try{
    const r=await fetch('/api/accountants/kyc/start',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});
    const d=await r.json().catch(()=>({}));
    if(r.ok && d.url){ window.location.href=d.url; return; }
    if(msg){ msg.style.color='var(--red)'; msg.textContent=d.error||'Could not start verification \u2014 please try again.'; }
  }catch(e){ if(msg){ msg.style.color='var(--red)'; msg.textContent='Could not start verification \u2014 please try again.'; } }
  if(btn){ btn.disabled=false; btn.textContent='Start identity verification'; }
}
window.startKyc=startKyc; window.loadKyc=loadKyc;

// ── 2FA / MFA (TOTP) ─────────────────────────────────────────────────────────────
async function loadMfa(){
  try{ const r=await fetch('/api/accountants/mfa/status',{credentials:'include'}); if(!r.ok)return; const d=await r.json(); _mfaRender(!!d.mfa_enabled); }catch(e){}
}
function _mfaRender(enabled){
  const b=document.getElementById('mfa-badge'),en=document.getElementById('mfa-enable-btn'),dis=document.getElementById('mfa-disable-btn');
  if(!b)return;
  b.className='badge '+(enabled?'badge-green':'badge-amber'); b.textContent=enabled?'\u2713 Enabled':'Not enabled';
  if(en)en.style.display=enabled?'none':'inline-flex';
  if(dis)dis.style.display=enabled?'inline-flex':'none';
  cancelMfa();
}
async function startMfaSetup(){
  const msg=document.getElementById('mfa-msg'); if(msg)msg.textContent='';
  try{
    const r=await fetch('/api/accountants/mfa/setup',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ if(msg)msg.textContent=d.error||'Could not start setup.'; return; }
    document.getElementById('mfa-secret').textContent=d.secret;
    const a=document.getElementById('mfa-otpauth'); if(a&&d.otpauth)a.href=d.otpauth;
    document.getElementById('mfa-disable-panel').style.display='none';
    document.getElementById('mfa-setup-panel').style.display='block';
  }catch(e){ if(msg)msg.textContent='Could not start setup.'; }
}
async function confirmMfaEnable(){
  const code=(document.getElementById('mfa-setup-code').value||'').trim(); const msg=document.getElementById('mfa-setup-msg'); if(msg)msg.textContent='';
  try{ const r=await fetch('/api/accountants/mfa/enable',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:code})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.mfa_enabled){ _mfaRender(true); } else if(msg){ msg.textContent=d.error||'Invalid code.'; }
  }catch(e){ if(msg)msg.textContent='Could not enable 2FA.'; }
}
function showMfaDisable(){ document.getElementById('mfa-setup-panel').style.display='none'; document.getElementById('mfa-disable-panel').style.display='block'; }
async function confirmMfaDisable(){
  const code=(document.getElementById('mfa-disable-code').value||'').trim(); const msg=document.getElementById('mfa-disable-msg'); if(msg)msg.textContent='';
  try{ const r=await fetch('/api/accountants/mfa/disable',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:code})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.mfa_enabled===false){ _mfaRender(false); } else if(msg){ msg.textContent=d.error||'Invalid code.'; }
  }catch(e){ if(msg)msg.textContent='Could not disable 2FA.'; }
}
function cancelMfa(){ var a=document.getElementById('mfa-setup-panel'),b=document.getElementById('mfa-disable-panel'); if(a)a.style.display='none'; if(b)b.style.display='none'; }
window.startMfaSetup=startMfaSetup; window.confirmMfaEnable=confirmMfaEnable; window.showMfaDisable=showMfaDisable; window.confirmMfaDisable=confirmMfaDisable; window.cancelMfa=cancelMfa; window.loadMfa=loadMfa;

// ── INIT ──────────────────────────────────────────────────────────────────────
boot();
// Check Stripe status after boot
setTimeout(checkStripeStatus, 1000);
