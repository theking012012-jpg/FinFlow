// Moved out of admin.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
// ── SECURITY ──────────────────────────────────────────────────────────────────
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

// ── STATE ─────────────────────────────────────────────────────────────────────
let currentModal = null;
let _allUsers = [];
let _allAccountants = [];
let _logData = [];
let _securityData = [];
let _overviewChart = null;
let _trafficChart = null;
let _trafficTimer = null;
let _currentLogTab = 'admin';
let _currentUserId = null;
let _currentAccId = null;

// ── LOGIN ─────────────────────────────────────────────────────────────────────
async function adminLogin() {
  const pw = document.getElementById('admin-pw').value;
  const err = document.getElementById('login-err');
  err.textContent = '';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, token: (document.getElementById('admin-otp').value || '').trim() || undefined }),
    });
    const data = await res.json();
    if (data.error) {
      if (data.mfaRequired) { const o=document.getElementById('admin-otp'); o.style.display=''; o.focus(); }
      err.textContent = data.error;
      return;
    }
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    boot();
  } catch(e) { err.textContent = 'Connection error.'; }
}

async function adminLogout() {
  await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
  location.reload();
}

document.getElementById('admin-pw').addEventListener('keydown', e => { if(e.key==='Enter') adminLogin(); });

// Check if already logged in
(async () => {
  try {
    const res = await fetch('/api/admin/me', { credentials: 'include' });
    if (res.ok) {
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app').classList.add('visible');
      boot();
    }
  } catch(e) {}
})();

// ── BOOT ──────────────────────────────────────────────────────────────────────
function boot() {
  loadOverview();
  loadPending();
}

// ── NAV ───────────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`[onclick="showPage('${name}')"]`).classList.add('active');

  const loaders = {
    traffic: loadTraffic,
    accountants: () => loadAccountants('', ''),
    reports: loadReports,
    support: loadSupport,
    users: () => loadUsers('', ''),
    earnings: loadEarnings,
    costs: loadCosts,
    log: loadLog,
    flags: loadFlags,
  };
  if (loaders[name]) loaders[name]();
}

// ── SUPPORT INBOX ───────────────────────────────────────────────────────────
async function loadSupport() {
  const status = (document.getElementById('support-status-filter')||{}).value ?? 'open';
  const actor  = (document.getElementById('support-actor-filter')||{}).value || '';
  const list = document.getElementById('support-list');
  list.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const qs = new URLSearchParams(); if (status) qs.set('status', status); if (actor) qs.set('actor', actor);
    const res = await fetch('/api/admin/support?' + qs.toString(), { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const badge = document.getElementById('support-count');
    if (badge) { badge.textContent = d.openCount; badge.style.display = d.openCount > 0 ? '' : 'none'; }
    const up = document.getElementById('support-updated'); if (up) up.textContent = d.openCount + ' open · ' + new Date().toLocaleTimeString();
    if (!d.requests.length) { list.innerHTML = '<div class="empty">No tickets' + (status ? ' (' + esc(status) + ')' : '') + '.</div>'; return; }
    list.innerHTML = d.requests.map(t => {
      const open = (t.status || 'open') === 'open';
      const badgeC = open ? 'background:var(--amber-bg);color:var(--amber)' : 'background:var(--green-bg);color:var(--green)';
      const actorC = t.actor === 'accountant' ? 'background:var(--purple-bg,#140f20);color:var(--purple,#9e8fbf)' : 'background:var(--bg3);color:var(--t2)';
      const when = t.created_at ? new Date(t.created_at).toLocaleString() : '';
      const resp = t.response ? '<div style="margin-top:8px;padding:8px 10px;background:var(--bg2);border-left:2px solid var(--acc);border-radius:5px;font-size:12.5px;color:var(--t2);white-space:pre-wrap">'+esc(t.response)+'</div>' : '';
      return '<div style="background:var(--bg1,#16120d);border:1px solid var(--bd,#2e2619);border-radius:12px;padding:14px 16px">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:14px;color:var(--t1);font-weight:500">'+esc(t.subject)+'</span>'
        + '<span style="font-size:10px;padding:2px 8px;border-radius:10px;'+badgeC+'">'+(open?'Open':'Resolved')+'</span>'
        + '<span style="font-size:10px;padding:2px 8px;border-radius:10px;'+actorC+'">'+esc(t.actor)+'</span>'
        + '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--bg3);color:var(--t3)">'+esc(t.category)+'</span>'
        + '<span style="margin-left:auto;font-size:11px;color:var(--t3)">#'+t.id+' · '+esc(when)+'</span></div>'
        + '<div style="margin-top:8px;font-size:13px;color:var(--t2);white-space:pre-wrap">'+esc(t.message)+'</div>'
        + (t.email ? '<div style="margin-top:6px;font-size:11.5px;color:var(--t3)">From: '+esc(t.email)+'</div>' : '')
        + resp
        + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'
        + '<input id="sup-reply-'+t.id+'" placeholder="Write a reply (emails the sender if configured)…" style="flex:1;min-width:200px;box-sizing:border-box;background:var(--bg2);border:1px solid var(--bd);border-radius:7px;color:var(--t1);padding:8px 10px;font-size:12.5px">'
        + '<button class="btn-sm" onclick="replySupport('+t.id+')">Send reply</button>'
        + (open ? '<button class="btn-sm" onclick="resolveSupport('+t.id+',true)">Mark resolved</button>' : '<button class="btn-sm" onclick="resolveSupport('+t.id+',false)">Reopen</button>')
        + '</div></div>';
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty">Could not load tickets: ' + esc(e.message) + '</div>';
  }
}
async function _supPost(id, body) {
  const res = await fetch('/api/admin/support/' + id, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
  return res.ok;
}
async function resolveSupport(id, resolved) {
  if (await _supPost(id, { status: resolved ? 'resolved' : 'open' })) loadSupport();
}
async function replySupport(id) {
  const el = document.getElementById('sup-reply-' + id);
  const response = (el && el.value || '').trim();
  if (!response) { if (el) el.focus(); return; }
  if (await _supPost(id, { response, status: 'resolved' })) loadSupport();
}

// ── TRAFFIC / VISITOR ANALYTICS ─────────────────────────────────────────────
async function loadTraffic() {
  // Live refresh: while the Traffic page is open, re-pull every 15s so new visitors
  // appear without a manual reload. Self-clears when the user navigates away.
  if (!_trafficTimer) {
    _trafficTimer = setInterval(() => {
      const p = document.getElementById('page-traffic');
      if (p && p.classList.contains('active')) loadTraffic();
      else { clearInterval(_trafficTimer); _trafficTimer = null; }
    }, 15000);
  }
  try {
    const res = await fetch('/api/admin/traffic', { credentials: 'include' });
    const d = await res.json();
    const s = d.summary || {};

    document.getElementById('traffic-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    document.getElementById('tf-today').textContent = (s.uniqueToday || 0).toLocaleString();
    document.getElementById('tf-today-views').textContent = (s.viewsToday || 0).toLocaleString() + ' page loads';
    document.getElementById('tf-7').textContent = (s.unique7 || 0).toLocaleString();
    document.getElementById('tf-7-views').textContent = (s.views7 || 0).toLocaleString() + ' page loads';
    document.getElementById('tf-30').textContent = (s.unique30 || 0).toLocaleString();
    document.getElementById('tf-30-views').textContent = (s.views30 || 0).toLocaleString() + ' page loads';
    document.getElementById('tf-all').textContent = (s.uniqueAll || 0).toLocaleString();

    // Sidebar badge — today's visitors
    const badge = document.getElementById('traffic-count');
    if (badge) {
      if (s.uniqueToday > 0) { badge.textContent = s.uniqueToday; badge.style.display = 'inline'; }
      else { badge.style.display = 'none'; }
    }

    // Top countries
    const countries = d.countries || [];
    document.getElementById('tf-countries-tbody').innerHTML = countries.length
      ? countries.map(c => `<tr><td class="primary">${esc(c.country)}</td><td>${parseInt(c.visitors).toLocaleString()}</td><td>${parseInt(c.views).toLocaleString()}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">No visitors yet</td></tr>';

    // Top pages
    const pages = d.pages || [];
    document.getElementById('tf-pages-tbody').innerHTML = pages.length
      ? pages.map(p => `<tr><td class="primary">${esc(p.path)}</td><td>${parseInt(p.views).toLocaleString()}</td><td>${parseInt(p.visitors).toLocaleString()}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">No page views yet</td></tr>';

    // Recent visitors
    const recent = d.recent || [];
    document.getElementById('tf-recent-tbody').innerHTML = recent.length
      ? recent.map(r => {
          const loc = [r.city, r.region, r.country].filter(Boolean).join(', ') || '—';
          const when = r.last_seen ? new Date(r.last_seen).toLocaleString() : '—';
          const acct = r.account_name
            ? `<span class="primary">${esc(r.account_name)}</span>${r.account_email?`<div style="font-size:11px;color:var(--t3)">${esc(r.account_email)}</div>`:''}`
            : (r.account_email ? esc(r.account_email) : '<span style="color:var(--t3)">Guest</span>');
          return `<tr><td>${esc(when)}</td><td>${acct}</td><td>${esc(loc)}</td><td class="primary">${esc(r.path || '/')}</td><td>${parseInt(r.views || 1).toLocaleString()}</td><td style="color:var(--t3);font-variant-numeric:tabular-nums">${esc(r.ip_address || '—')}</td></tr>`;
        }).join('')
      : '<tr><td colspan="6" class="empty">No visitors recorded yet</td></tr>';

    // Daily chart
    const daily = d.daily || [];
    const labels = daily.map(x => FinFlowDates.calendarLabel(x.day, { month: 'short', day: 'numeric' }));   // FA-L3f: view_day is a DATE
    const visitors = daily.map(x => parseInt(x.visitors));
    if (typeof Chart !== 'undefined' && document.getElementById('traffic-chart')) {
      const ctx = document.getElementById('traffic-chart').getContext('2d');
      if (_trafficChart) _trafficChart.destroy();
      _trafficChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Unique Visitors', data: visitors, fill: true,
          backgroundColor: 'rgba(200,164,74,0.12)', borderColor: 'rgba(200,164,74,0.9)',
          borderWidth: 2, tension: 0.3, pointRadius: 2, pointBackgroundColor: 'rgba(200,164,74,1)' }] },
        options: { responsive: true, maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#9a8a6e', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#9a8a6e', font: { size: 10 }, precision: 0 }, beginAtZero: true }
          } }
      });
    }
  } catch (e) { console.error('Traffic error', e); }
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const res = await fetch('/api/admin/overview', { credentials: 'include' });
    const d = await res.json();

    document.getElementById('overview-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    document.getElementById('ov-users').textContent = d.users.total.toLocaleString();
    document.getElementById('ov-users-month').textContent = `+${d.users.month} this month`;
    document.getElementById('ov-accountants').textContent = d.accountants.verified;
    document.getElementById('ov-acc-pending').textContent = `${d.accountants.pending} pending`;
    document.getElementById('ov-commission').textContent = d.earnings.totalFormatted;
    document.getElementById('ov-commission-pending').textContent = `${d.earnings.pendingFormatted} referral pay owed`;
    document.getElementById('ov-ai').textContent = d.ai.monthQueries.toLocaleString();
    document.getElementById('ov-ai-cost').textContent = `est. ${d.ai.estimatedMonthlyCost} this month`;

    // Update pending badge
    document.getElementById('pending-count').textContent = d.accountants.pending;
    // Support open-ticket badge (fire-and-forget)
    fetch('/api/admin/support?status=open', { credentials:'include' }).then(r => r.ok ? r.json() : null).then(s => {
      if (!s) return; const b = document.getElementById('support-count');
      if (b) { b.textContent = s.openCount; b.style.display = s.openCount > 0 ? '' : 'none'; }
    }).catch(()=>{});
    if (d.reports.recent > 0) {
      document.getElementById('reports-count').textContent = d.reports.recent;
      document.getElementById('reports-count').style.display = 'inline';
    }
    document.getElementById('topbar-pending').textContent = d.accountants.pending > 0 ? `⚠ ${d.accountants.pending} pending applications` : '';

    // MRR — authoritative, computed SERVER-SIDE (/api/admin/overview → revenue.mrr). No browser math.
    const mrr = (d.revenue && typeof d.revenue.mrr === 'number') ? d.revenue.mrr : 0;
    document.getElementById('ov-mrr').textContent = '$' + mrr.toLocaleString();
    const earnMrr = document.getElementById('earn-mrr');
    if (earnMrr) earnMrr.textContent = '$' + mrr.toLocaleString();

    // Plans table
    document.getElementById('plans-tbody').innerHTML = d.users.plans.map(p => `
      <tr><td class="primary">${p.plan || 'unknown'}</td><td>${p.count}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No data</td></tr>';

    // Quick stats
    document.getElementById('quick-stats-tbody').innerHTML = `
      <tr><td>New users today</td><td class="primary">${d.users.today}</td></tr>
      <tr><td>New users this week</td><td class="primary">${d.users.week}</td></tr>
      <tr><td>Total accountants</td><td class="primary">${d.accountants.total}</td></tr>
      <tr><td>Total AI queries</td><td class="primary">${d.ai.totalQueries.toLocaleString()}</td></tr>
      <tr><td>Reports this month</td><td class="primary">${d.reports.recent}</td></tr>`;

    // Chart
    const monthly = d.users.monthly || [];
    const labels = monthly.map(m => FinFlowDates.calendarLabel(m.month, { month: 'short', year: '2-digit' }));   // FA-L3f
    const counts = monthly.map(m => parseInt(m.count));
    const ctx = document.getElementById('overview-chart').getContext('2d');
    if (_overviewChart) _overviewChart.destroy();
    _overviewChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label:'New Signups', data: counts,
          backgroundColor:'rgba(200,164,74,0.4)', borderColor:'rgba(200,164,74,0.9)',
          borderWidth:1, borderRadius:4 }]
      },
      options: {
        responsive:true, maintainAspectRatio:true,
        plugins:{ legend:{ display:false } },
        scales:{
          x:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#9a8a6e', font:{size:10} } },
          y:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#9a8a6e', font:{size:10} }, beginAtZero:true }
        }
      }
    });
  } catch(e) { console.error('Overview error', e); }
}

// ── PENDING ───────────────────────────────────────────────────────────────────
async function loadPending() {
  try {
    const res = await fetch('/api/admin/accountants?status=pending', { credentials: 'include' });
    const data = await res.json();
    document.getElementById('pending-count').textContent = data.length;
    if (!data.length) {
      document.getElementById('pending-tbody').innerHTML = '<tr><td colspan="7" class="empty">No pending applications 🎉</td></tr>';
      return;
    }
    // Store pending accountants for modal access
    window._pendingAccountants = {};
    data.forEach(a => { window._pendingAccountants[a.id] = a; });

    document.getElementById('pending-tbody').innerHTML = data.map(a => `
      <tr>
        <td class="primary">${esc(a.first_name)} ${esc(a.last_name)}</td>
        <td>${esc(a.firm || '—')}</td>
        <td>${esc(a.country || '—')}</td>
        <td><span class="badge b-amber">${esc(a.verification_method || '—')}</span></td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.credentials || a.memberships || '—')}</td>
        <td>${new Date(a.created_at).toLocaleDateString()}</td>
        <td>
          <button class="action-btn approve" onclick="openReviewById(${a.id})">Review</button>
        </td>
      </tr>`).join('');
  } catch(e) { console.error('Pending error', e); }
}

// ── ACCOUNTANTS ───────────────────────────────────────────────────────────────
async function loadAccountants(search='', status='') {
  try {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    const res = await fetch(`/api/admin/accountants?${params}`, { credentials: 'include' });
    _allAccountants = await res.json();
    document.getElementById('accountants-tbody').innerHTML = _allAccountants.length ? _allAccountants.map(a => `
      <tr onclick="openAccountant(${a.id})" style="cursor:pointer">
        <td><div class="primary">${esc(a.first_name)} ${esc(a.last_name)}</div><div style="font-size:11px;color:var(--t3)">${esc(a.email)}</div></td>
        <td>${esc(a.firm || '—')}</td>
        <td>${esc(a.country || '—')}</td>
        <td>${a.client_count || 0}</td>
        <td>${a.avg_rating > 0 ? '★'.repeat(Math.round(a.avg_rating)) + ' ' + parseFloat(a.avg_rating).toFixed(1) : '—'}</td>
        <td><span class="badge ${a.status==='verified'?'b-green':a.status==='pending'?'b-amber':a.status==='suspended'?'b-red':'b-purple'}">${a.status}</span></td>
        <td><span class="badge ${a.stripe_onboarded?'b-green':'b-amber'}">${a.stripe_onboarded?'Connected':'Not set'}</span></td>
        <td>
          ${a.status==='verified' ? `<button class="action-btn suspend" onclick="event.stopPropagation();verifyAction(${a.id},'suspend')">Suspend</button>` : ''}
          ${a.status==='suspended' ? `<button class="action-btn approve" onclick="event.stopPropagation();verifyAction(${a.id},'reinstate')">Reinstate</button>` : ''}
          ${a.status==='pending' ? `<button class="action-btn approve" onclick="event.stopPropagation();verifyAction(${a.id},'approve')">Approve</button><button class="action-btn reject" onclick="event.stopPropagation();verifyAction(${a.id},'reject')">Reject</button>` : ''}
          <button class="action-btn gold" onclick="event.stopPropagation();togglePreferred(${a.id},${a.avg_rating < 4.5})">${a.avg_rating >= 4.5 ? '★ Remove PP' : '☆ Set PP'}</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="8" class="empty">No accountants found</td></tr>';
  } catch(e) { console.error('Accountants error', e); }
}

async function verifyAction(id, action, notes, confirmedCredentials) {
  if (notes === undefined) notes = '';
  try {
    const res = await fetch(`/api/admin/accountants/${id}/verify`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, notes, confirmedCredentials }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }
    toast(`Accountant ${action}d successfully`, 'success');
    loadAccountants('', '');
    loadPending();
    loadOverview();
  } catch(e) { toast('Action failed', 'error'); }
}

async function togglePreferred(id, enable) {
  await fetch(`/api/admin/accountants/${id}/preferred-partner`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: enable }),
  });
  toast(enable ? '★ Preferred Partner badge set' : 'Preferred Partner badge removed', 'success');
  loadAccountants('', '');
}

// ── REVIEW MODAL ──────────────────────────────────────────────────────────────
function openReviewById(id) {
  const accountant = (window._pendingAccountants || {})[id];
  if (!accountant) { toast('Could not load application data', 'error'); return; }
  openReview(accountant);
}

function openReview(accountant) {
  currentModal = accountant;
  document.getElementById('modal-title').textContent = `${accountant.first_name} ${accountant.last_name}`;
  document.getElementById('modal-sub').textContent = `${accountant.firm || ''} · ${accountant.country || ''}`;

  const vData = typeof accountant.verification_data === 'string'
    ? JSON.parse(accountant.verification_data) : accountant.verification_data || {};

  document.getElementById('modal-details').innerHTML = `
    <div class="detail-row"><span class="detail-label">Email</span><span class="detail-val">${esc(accountant.email)}</span></div>
    <div class="detail-row"><span class="detail-label">Specialisation</span><span class="detail-val">${esc(accountant.specialisation || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Experience</span><span class="detail-val">${esc(accountant.experience || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Verify method</span><span class="detail-val"><span class="badge b-amber">${esc(accountant.verification_method || '—')}</span></span></div>
    ${vData.profBody ? `<div class="detail-row"><span class="detail-label">Prof body</span><span class="detail-val">${esc(vData.profBody)} · ${esc(vData.membershipNumber || '')}</span></div>` : ''}
    ${(window._kycRegistryRow ? window._kycRegistryRow(vData.profBody, vData.membershipNumber, esc) : '')}
    ${vData.employerFirm ? `<div class="detail-row"><span class="detail-label">Employer</span><span class="detail-val">${esc(vData.employerFirm)} · ${esc(vData.employerContact || '')} · ${esc(vData.employerPhone || '')}</span></div>` : ''}
    ${vData.institution ? `<div class="detail-row"><span class="detail-label">Institution</span><span class="detail-val">${esc(vData.institution)} · ${esc(vData.degree || '')}</span></div>` : ''}
    ${accountant.credentials ? `<div class="detail-row"><span class="detail-label">Credentials</span><span class="detail-val">${esc(accountant.credentials)}</span></div>` : ''}
    ${accountant.memberships ? `<div class="detail-row"><span class="detail-label">Memberships</span><span class="detail-val">${esc(accountant.memberships)}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">Identity (KYC)</span><span class="detail-val">${(function(k){var m={verified:['b-green','✓ Verified'],pending:['b-amber','⏳ Pending'],failed:['b-red','✗ Failed'],not_started:['b-grey','Not started']};var v=m[k||'not_started']||m.not_started;return '<span class="badge '+v[0]+'">'+v[1]+'</span>'+(accountant.kyc_verified_at?(' · '+new Date(accountant.kyc_verified_at).toLocaleDateString()):'');})(accountant.kyc_status)}</span></div>
    <div class="detail-row"><span class="detail-label">Credential proof</span><span class="detail-val" id="modal-documents">Loading…</span></div>
    <div class="detail-row"><span class="detail-label">Applied</span><span class="detail-val">${new Date(accountant.created_at).toLocaleString()}</span></div>
  `;

  document.getElementById('modal-notes').value = '';
  document.getElementById('modal-confirmed').value = accountant.confirmed_credentials || '';
  document.getElementById('modal-approve-btn').onclick = () => doModalAction('approve');
  document.getElementById('modal-reject-btn').onclick = () => doModalAction('reject');
  document.getElementById('review-modal').classList.add('open');
  loadReviewDocuments(accountant.id);   // Step F — surface the uploaded credential document
}

// Step F — fetch and render the accountant's credential document(s) as View links.
// The download streams inline (opens in a new tab); the admin's session cookie
// authorizes it. Shows an explicit warning when no proof was uploaded.
async function loadReviewDocuments(id) {
  const el = document.getElementById('modal-documents');
  if (!el) return;
  try {
    const res = await fetch(`/api/admin/accountants/${id}/documents`, { credentials: 'include' });
    const docs = await res.json();
    if (!Array.isArray(docs) || !docs.length) {
      el.innerHTML = '<span style="color:var(--red)">⚠ No document uploaded</span>';
      return;
    }
    el.innerHTML = docs.map(d => {
      const kb = d.size_bytes ? Math.round(d.size_bytes / 1024) + ' KB' : '';
      const url = `/api/admin/accountants/${id}/documents/${d.id}/download`;
      return `<a href="${url}" target="_blank" rel="noopener" style="color:var(--acc);text-decoration:none">📄 ${esc(d.file_name || 'document')}</a> <span style="color:var(--t3);font-size:11px">${esc(kb)}</span>`;
    }).join('<br>');
  } catch (e) {
    el.innerHTML = '<span style="color:var(--t3)">Could not load document</span>';
  }
}

async function doModalAction(action) {
  const notes = document.getElementById('modal-notes').value;
  // Step G — only meaningful on approve; sent verbatim so the admin can also correct it on reinstate.
  const confirmedCredentials = document.getElementById('modal-confirmed').value;
  const id = currentModal.id;
  closeModal();
  await verifyAction(id, action, notes, confirmedCredentials);
}

function closeModal() {
  document.getElementById('review-modal').classList.remove('open');
  currentModal = null;
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
async function loadReports() {
  try {
    const res = await fetch('/api/admin/reports', { credentials: 'include' });
    const data = await res.json();
    document.getElementById('reports-tbody').innerHTML = data.length ? data.map(r => {
      const st = r.report_status || 'open';
      const isOpen = st === 'open';
      const stBg = isOpen ? '#3a2f12' : '#262420';
      const stFg = isOpen ? '#e0a93a' : '#8a8268';
      return `
      <tr>
        <td><div class="primary">${esc(r.first_name)} ${esc(r.last_name)}</div><div style="font-size:11px;color:var(--t3)">${esc(r.firm || '')}</div></td>
        <td>${esc(r.reporter_name || '—')}<div style="font-size:11px;color:var(--t3)">${esc(r.reporter_email || '')}</div></td>
        <td style="text-transform:capitalize">${esc(r.category || 'other')}</td>
        <td style="max-width:240px">${esc(r.reason)}</td>
        <td><span style="font-size:11px;padding:2px 8px;border-radius:9px;background:${stBg};color:${stFg};text-transform:capitalize">${esc(st)}</span></td>
        <td>${new Date(r.created_at).toLocaleDateString()}${r.respond_by ? `<div style="font-size:11px;color:${r.overdue ? '#e05a4a' : 'var(--t3)'}">${r.acknowledged_at ? 'Acknowledged ' + new Date(r.acknowledged_at).toLocaleDateString() : (r.overdue ? 'OVERDUE — acknowledge by ' : 'Acknowledge by ') + new Date(r.respond_by).toLocaleString()}</div>` : ''}${r.accountant_notified_at ? `<div style="font-size:11px;color:var(--t3)">Accountant told ${new Date(r.accountant_notified_at).toLocaleDateString()}</div>` : ''}</td>
        <td>
          ${isOpen
            ? `${r.acknowledged_at ? '' : `<button class="action-btn approve" onclick="ackReport(${r.id})">Acknowledge</button>`}
          ${r.accountant_notified_at ? '' : `<button class="action-btn" onclick="notifyAccountantReport(${r.id})">Tell accountant</button>`}
          <button class="action-btn suspend" onclick="verifyAction(${r.accountant_id},'suspend')">Suspend</button>
          <button class="action-btn approve" onclick="resolveReport(${r.id})">Resolve</button>
          <button class="action-btn" onclick="dismissReport(${r.id})">Dismiss</button>`
            : `<span style="font-size:11px;color:var(--t3)">${esc(r.resolved_by || 'admin')}${r.resolved_at ? ' · ' + new Date(r.resolved_at).toLocaleDateString() : ''}</span>`}
        </td>
      </tr>`; }).join('')
    : '<tr><td colspan="7" class="empty">No reports filed</td></tr>';
  } catch(e) { console.error('Reports error', e); }
}

// D-E: the conduct policy's two promises, each once (the server keeps the first)
async function ackReport(id) {
  const r = await fetch(`/api/admin/reports/${id}/acknowledge`, { method: 'POST', credentials: 'include' }).then(x => x.json()).catch(() => ({}));
  toast(r.emailed ? 'Acknowledged — the client was emailed' : 'Acknowledged (no email sent — check Resend)', r.emailed ? 'success' : 'error');
  loadReports();
}
async function notifyAccountantReport(id) {
  const r = await fetch(`/api/admin/reports/${id}/notify-accountant`, { method: 'POST', credentials: 'include' }).then(x => x.json()).catch(() => ({}));
  toast(r.emailed ? 'The accountant was asked for their response' : 'Marked told (no email sent — check Resend)', r.emailed ? 'success' : 'error');
  loadReports();
}

async function dismissReport(id) {
  await fetch(`/api/admin/reports/${id}/dismiss`, { method: 'POST', credentials: 'include' });
  toast('Report dismissed', 'success');
  loadReports();
}

async function resolveReport(id) {
  await fetch(`/api/admin/reports/${id}/resolve`, { method: 'POST', credentials: 'include' });
  toast('Report marked resolved', 'success');
  loadReports();
}

// ── USERS ─────────────────────────────────────────────────────────────────────
async function loadUsers(search='', plan='') {
  try {
    const params = new URLSearchParams();
    if (plan) params.set('plan', plan);
    const res = await fetch(`/api/admin/users?${params}`, { credentials: 'include' });
    _allUsers = await res.json();
    renderUsers(_allUsers, search);
  } catch(e) { console.error('Users error', e); }
}

function renderUsers(data, search='') {
  const q = (search||'').toLowerCase();
  const filtered = q ? data.filter(u => (u.name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)) : data;
  document.getElementById('users-tbody').innerHTML = filtered.length ? filtered.map(u => `
    <tr onclick="openUser(${u.id})" style="cursor:pointer">
      <td class="primary">${esc(u.name || '—')}</td>
      <td>${esc(u.email || '—')}</td>
      <td>
        <select class="filter-select" id="plan-sel-${u.id}" style="font-size:11px;padding:3px 8px;margin-right:4px" onclick="event.stopPropagation()">
          <option value="trial" ${(u.plan||'trial')==='trial'?'selected':''}>Trial</option>
          <option value="pro" ${u.plan==='pro'?'selected':''}>Pro</option>
          <option value="business" ${u.plan==='business'?'selected':''}>Business</option>
          <option value="scale" ${u.plan==='scale'?'selected':''}>Scale</option>
        </select>
        <button class="action-btn" onclick="event.stopPropagation();setPlan(${u.id})">Save</button>
      </td>
      <td>${u.accountant_first ? `${esc(u.accountant_first)} ${esc(u.accountant_last)}` : '—'}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td><span class="badge ${u.suspended==='true'?'b-red':'b-green'}">${u.suspended==='true'?'Suspended':'Active'}</span></td>
      <td><button class="action-btn ${u.suspended==='true'?'approve':'suspend'}" onclick="event.stopPropagation();suspendUser(${u.id},${u.suspended!=='true'})">${u.suspended==='true'?'Reinstate':'Suspend'}</button></td>
    </tr>`).join('')
  : '<tr><td colspan="7" class="empty">No users found</td></tr>';
}

function filterUserRows(q) {
  renderUsers(_allUsers, q);
}

async function setPlan(id) {
  const sel = document.getElementById('plan-sel-' + id);
  if (!sel) return;
  const plan = sel.value;
  const res = await fetch(`/api/admin/users/${id}/plan`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }
  toast('Plan updated to ' + plan, 'success');
}

async function suspendUser(id, suspend) {
  await fetch(`/api/admin/users/${id}/suspend`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suspend }),
  });
  toast(suspend ? 'User suspended' : 'User reinstated', 'success');
  loadUsers('', '');
}

// ── EARNINGS ──────────────────────────────────────────────────────────────────
async function loadEarnings() {
  try {
    const sa = document.getElementById('select-all'); if(sa) sa.checked = false;
    const res = await fetch('/api/admin/earnings', { credentials: 'include' });
    const { records, summary, payouts } = await res.json();
    const s = summary || {};

    document.getElementById('earn-commission').textContent = '$' + ((parseInt(s.commission_collected_cents)||0)/100).toFixed(2);   // FA-L3g: FinFlow's commission on paid bills
    document.getElementById('earn-referral').textContent = '$' + ((parseInt(s.referral_owed_cents)||0)/100).toFixed(2);   // FA-L3d: owed = pending only
    document.getElementById('earn-paid').textContent = '$' + ((parseInt(s.paid_cents)||0)/100).toFixed(2);

    document.getElementById('earnings-tbody').innerHTML = records.length ? records.map(e => `
      <tr>
        <td>${e.status === 'pending' && !e.payout_id ? `<input type="checkbox" class="earn-check" value="${e.id}" aria-label="Select to mark paid by hand">` : ''}</td>
        <td class="primary">${esc(e.first_name)} ${esc(e.last_name)}<div style="font-size:11px;color:var(--t3)">${esc(e.firm||'')}</div></td>
        <td><span class="badge ${e.type==='referral'?'b-gold':'b-green'}">${e.type==='referral'?'Referral':'Commission'}</span></td>
        <td>${esc(e.description||'—')}</td>
        <td class="gold">$${(e.amount_cents/100).toFixed(2)}</td>
        <td>${e.period_month ? FinFlowDates.calendarLabel(e.period_month, { month: 'short', year: 'numeric' }) : '—'}</td>
        <td><span class="badge ${e.status==='paid'?'b-green':'b-amber'}">${e.status === 'paid' ? 'paid' : e.payout_id ? 'sending by Stripe' : e.status === 'awaiting_payment' ? 'client has not paid' : e.status}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No earnings records</td></tr>';
    const ym = v => FinFlowDates.calendarLabel(v, { month: 'short', year: 'numeric' }) || '—';   // FA-L3f: the shared calendar-label writer
    document.getElementById('payouts-tbody').innerHTML = (payouts || []).length ? payouts.map(p => `
      <tr>
        <td class="primary">${esc(p.first_name)} ${esc(p.last_name)}<div style="font-size:11px;color:var(--t3)">${esc(p.firm||'')}</div></td>
        <td>${ym(p.period_month)}</td>
        <td class="gold">$${(p.amount_cents/100).toFixed(2)}</td>
        <td><span class="badge ${p.status==='sent'?'b-green':p.status==='failed'?'b-red':'b-amber'}">${p.status === 'claimed' ? 'sending' : esc(p.status)}</span></td>
        <td style="font-size:12px">${p.status === 'sent' ? esc(p.stripe_transfer_id || '') : esc(p.last_error || '—')}</td>
        <td>${Number(p.attempts) || 0}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No referral payouts yet</td></tr>';
  } catch(e) { console.error('Earnings error', e); }
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.earn-check').forEach(c => c.checked = cb.checked);
}

async function markSelectedPaid() {
  const ids = [...document.querySelectorAll('.earn-check:checked')].map(c => parseInt(c.value));
  if (!ids.length) { toast('Select at least one record', 'error'); return; }
  const res = await fetch('/api/admin/earnings/mark-paid', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  toast(`${data.updated} record(s) marked as paid` + ((data.refused || []).length ? ` · ${data.refused.length} refused (sent by Stripe transfer, already paid, or not paid by the client)` : ''), (data.refused || []).length ? 'error' : 'success');
  loadEarnings();
}

// ── COSTS ─────────────────────────────────────────────────────────────────────
function _fmtMoney(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Operating-cost editor: one row = label + monthly $ + remove. Rendered from the server's list.
function renderOpex(list) {
  const box = document.getElementById('opex-rows');
  if (!box) return;
  box.innerHTML = '';
  (list && list.length ? list : []).forEach(r => addOpexRow(r.label, r.monthly));
}
function addOpexRow(label, monthly) {
  const box = document.getElementById('opex-rows');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'opex-row';
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  row.innerHTML =
    '<input class="opex-label" type="text" placeholder="e.g. Supabase" maxlength="60" '
      + 'style="flex:1;background:var(--bg2,#1a1a1a);border:1px solid var(--bd);color:var(--t1);padding:6px 8px;border-radius:6px;font-size:12px">'
    + '<span style="color:var(--t3);font-size:12px">$</span>'
    + '<input class="opex-amt" type="number" min="0" step="0.01" placeholder="0.00" '
      + 'style="width:90px;background:var(--bg2,#1a1a1a);border:1px solid var(--bd);color:var(--t1);padding:6px 8px;border-radius:6px;font-size:12px;text-align:right">'
    + '<button type="button" class="opex-del" title="Remove" '
      + 'style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px">×</button>';
  row.querySelector('.opex-label').value = label || '';
  row.querySelector('.opex-amt').value = (monthly != null && monthly !== '') ? monthly : '';
  row.querySelector('.opex-del').onclick = () => row.remove();
  box.appendChild(row);
}
async function saveOpex() {
  const rows = Array.from(document.querySelectorAll('#opex-rows .opex-row')).map(r => ({
    label: r.querySelector('.opex-label').value.trim(),
    monthly: Math.max(0, parseFloat(r.querySelector('.opex-amt').value) || 0),
  })).filter(r => r.label);
  const btn = document.getElementById('opex-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await fetch('/api/admin/operating-costs', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operating: rows }),
    });
    if (!res.ok) throw new Error('save failed');
    const saved = document.getElementById('opex-saved');
    if (saved) { saved.style.display = 'inline'; setTimeout(() => { saved.style.display = 'none'; }, 2500); }
    await loadCosts();   // re-pull so AI + Stripe + operating total + net all reconcile server-side
  } catch (e) {
    alert('Could not save operating costs: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save operating costs'; }
  }
}

async function loadCosts() {
  try {
    const res = await fetch('/api/admin/costs', { credentials: 'include' });
    const d = await res.json();
    document.getElementById('cost-ai-total').textContent = d.ai.totalQueries.toLocaleString();
    document.getElementById('cost-ai-month').textContent = d.ai.monthQueries || '—';
    document.getElementById('cost-ai-month-cost').textContent = d.ai.estimatedMonthlyCost;
    document.getElementById('cost-ai-total-cost').textContent = d.ai.estimatedTotalCost;

    if (d.revenue) {
      const r = d.revenue;
      const nm = { pro:'Pro', business:'Business', scale:'Scale' };
      let rows = r.byPlan.map(p => `<div class="cost-row"><span>${nm[p.plan]||p.plan} — ${p.count} × $${p.price}</span><span class="cost-val">$${p.subtotal.toLocaleString()}</span></div>`).join('');
      if (r.enterpriseCount) rows += `<div class="cost-row"><span>Enterprise — ${r.enterpriseCount} (custom)</span><span class="cost-val">—</span></div>`;
      document.getElementById('revenue-rows').innerHTML = rows || '<div class="cost-row"><span>No paying clients yet</span><span class="cost-val">$0</span></div>';
      document.getElementById('rev-total').textContent = '$' + r.totalMRR.toLocaleString();
      document.getElementById('rev-clients').textContent = r.payingClients;
      document.getElementById('net-mrr').textContent = '$' + r.totalMRR.toLocaleString();
      document.getElementById('rev-net').textContent = _fmtMoney(r.netMonthly);
      document.getElementById('rev-net').style.color = r.netMonthly < 0 ? '#e5484d' : '#19c37d';
    }

    if (d.costs) {
      const c = d.costs;
      document.getElementById('cost-ai').textContent = _fmtMoney(c.ai);
      document.getElementById('cost-stripe').textContent = _fmtMoney(c.stripeFeesEst);
      document.getElementById('cost-total').textContent = _fmtMoney(c.totalMonthlyCosts);
      document.getElementById('net-costs').textContent = _fmtMoney(c.totalMonthlyCosts);
      renderOpex(c.operating || []);
      // Wire the operating-cost controls once.
      const addBtn = document.getElementById('opex-add'), saveBtn = document.getElementById('opex-save');
      if (addBtn && !addBtn._wired) { addBtn._wired = 1; addBtn.onclick = () => addOpexRow('', ''); }
      if (saveBtn && !saveBtn._wired) { saveBtn._wired = 1; saveBtn.onclick = saveOpex; }
    }

    if (d.stripe) {
      const avail = d.stripe.available.map(b => `$${(b.amount/100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ') || '—';
      const pend = d.stripe.pending.map(b => `$${(b.amount/100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ') || '—';
      document.getElementById('cost-stripe-available').textContent = avail;
      document.getElementById('cost-stripe-pending').textContent = pend;
      document.getElementById('stripe-note').textContent = 'Live Stripe data';

      document.getElementById('stripe-payouts-tbody').innerHTML = d.stripe.recentPayouts.length
        ? d.stripe.recentPayouts.map(p => `
          <tr>
            <td class="gold">$${(p.amount/100).toFixed(2)}</td>
            <td>${p.currency.toUpperCase()}</td>
            <td><span class="badge ${p.status==='paid'?'b-green':'b-amber'}">${p.status}</span></td>
            <td>${p.arrival}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="empty">No payouts yet</td></tr>';
    }

    // Health check
    try {
      const hRes = await fetch('/api/admin/health', { credentials:'include' });
      const h = await hRes.json();
      document.getElementById('h-db-dot').className = 'health-dot ' + (h.db ? 'ok' : 'warn');
      document.getElementById('h-db-label').textContent = 'Database — ' + (h.db ? 'Connected ✅' : 'Error ⚠');
      document.getElementById('h-redis-dot').className = 'health-dot ' + (h.redis ? 'ok' : 'warn');
      document.getElementById('h-redis-label').textContent = 'Redis — ' + (h.redis ? 'Connected ✅' : 'Not connected');
      document.getElementById('h-deploy-label').textContent = 'Last deploy — ' + (h.deployId || 'Unknown');
    } catch(e) {}
  } catch(e) { console.error('Costs error', e); }
}

// ── LOG ───────────────────────────────────────────────────────────────────────
async function loadLog() {
  try {
    const res = await fetch('/api/admin/log', { credentials: 'include' });
    _logData = await res.json();
    applyLogFilters();
  } catch(e) { console.error('Log error', e); }
}

function renderLogRows(data) {
  document.getElementById('log-tbody').innerHTML = data.length ? data.map(l => `
    <tr>
      <td class="primary">${esc(l.action.replace(/_/g,' '))}</td>
      <td>${esc(l.target_type||'—')} ${l.target_id ? '#'+l.target_id : ''}</td>
      <td style="max-width:300px;word-break:break-word">${esc(l.notes||'—')}</td>
      <td>${new Date(l.created_at).toLocaleString()}</td>
    </tr>`).join('')
  : '<tr><td colspan="4" class="empty">No entries</td></tr>';
}

function applyLogFilters() {
  const data = _currentLogTab === 'security' ? _securityData : _logData;
  const action = document.getElementById('log-action-filter').value;
  const from = document.getElementById('log-date-from').value;
  const to = document.getElementById('log-date-to').value;
  const notes = (document.getElementById('log-notes-search').value||'').toLowerCase();
  const filtered = data.filter(l => {
    if (action && l.action !== action) return false;
    // FA-L3f: both ends are this admin's own calendar day — the same clock the Time column is shown in. Before, "from"
    // was UTC midnight (new Date('YYYY-MM-DD')) while "to" was local, so the window was skewed west of UTC.
    if (from && new Date(l.created_at) < new Date(from + 'T00:00:00')) return false;
    if (to && new Date(l.created_at) > new Date(to + 'T23:59:59.999')) return false;
    if (notes && !(l.notes||'').toLowerCase().includes(notes)) return false;
    return true;
  });
  renderLogRows(filtered);
}

async function switchLogTab(tab) {
  _currentLogTab = tab;
  document.getElementById('tab-admin').classList.toggle('active', tab==='admin');
  document.getElementById('tab-security').classList.toggle('active', tab==='security');
  const filtersEl = document.getElementById('log-filters');
  if (tab === 'security') {
    filtersEl.style.display = 'none';
    if (!_securityData.length) {
      const res = await fetch('/api/admin/security-log', { credentials:'include' });
      _securityData = await res.json().catch(()=>[]);
    }
    renderLogRows(_securityData);
  } else {
    filtersEl.style.display = 'flex';
    applyLogFilters();
  }
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type?' '+type:'');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── USER DETAIL MODAL ─────────────────────────────────────────────────────────
async function openUser(id) {
  _currentUserId = id;
  try {
    const res = await fetch(`/api/admin/users/${id}`, { credentials:'include' });
    const u = await res.json();
    if (u.error) { toast(u.error,'error'); return; }
    document.getElementById('um-name').textContent = u.name || '—';
    document.getElementById('um-email').textContent = u.email || '';
    document.getElementById('um-details').innerHTML = `
      <div class="detail-row"><span class="detail-label">Plan</span><span class="detail-val">${u.plan||'trial'}</span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-val"><span class="badge ${u.suspended==='true'?'b-red':'b-green'}">${u.suspended==='true'?'Suspended':'Active'}</span></span></div>
      <div class="detail-row"><span class="detail-label">Joined</span><span class="detail-val">${new Date(u.created_at).toLocaleDateString()}</span></div>
      <div class="detail-row"><span class="detail-label">Last Login</span><span class="detail-val">${u.last_login ? new Date(u.last_login).toLocaleString() : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Trial Ends</span><span class="detail-val">${u.trial_ends ? new Date(u.trial_ends).toLocaleDateString() : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Entities</span><span class="detail-val">${u.entity_count||0}</span></div>
      <div class="detail-row"><span class="detail-label">Accountant</span><span class="detail-val">${u.accountant_first ? `${u.accountant_first} ${u.accountant_last} (${u.accountant_firm||''})` : '—'}</span></div>`;
    const suspBtn = document.getElementById('um-suspend-btn');
    suspBtn.textContent = u.suspended==='true' ? 'Reinstate' : 'Suspend';
    suspBtn.className = u.suspended==='true' ? 'btn-approve' : 'btn-reject';
    document.getElementById('user-modal').classList.add('open');
  } catch(e) { toast('Failed to load user','error'); }
}

async function toggleUserSuspend() {
  if (!_currentUserId) return;
  const suspBtn = document.getElementById('um-suspend-btn');
  const suspend = suspBtn.textContent.trim() === 'Suspend';
  await suspendUser(_currentUserId, suspend);
  document.getElementById('user-modal').classList.remove('open');
}

async function deleteUser() {
  if (!_currentUserId) return;
  if (!confirm('Permanently soft-delete this user? This cannot be undone.')) return;
  const res = await fetch(`/api/admin/users/${_currentUserId}`, { method:'DELETE', credentials:'include' });
  const data = await res.json();
  if (data.error) { toast(data.error,'error'); return; }
  toast('User deleted','success');
  document.getElementById('user-modal').classList.remove('open');
  loadUsers('','');
}

// ── ACCOUNTANT DETAIL MODAL ───────────────────────────────────────────────────
async function openAccountant(id) {
  _currentAccId = id;
  try {
    const res = await fetch(`/api/admin/accountants/${id}`, { credentials:'include' });
    const a = await res.json();
    if (a.error) { toast(a.error,'error'); return; }
    document.getElementById('am-name').textContent = `${a.first_name} ${a.last_name}`;
    document.getElementById('am-sub').textContent = `${a.firm||''} · ${a.country||''} · ${a.specialisation||''}`;
    const vData = typeof a.verification_data === 'string' ? JSON.parse(a.verification_data||'{}') : a.verification_data||{};
    const clientRows = (a.clients||[]).map(c => `
      <div class="client-list-row">
        <span>${esc(c.name||'—')}</span>
        <span style="color:var(--t3)">${esc(c.email||'')}</span>
        <span class="badge ${c.status==='active'?'b-green':'b-amber'}" style="margin-left:8px">${esc(c.status)}</span>
      </div>`).join('') || '<div class="client-list-row" style="color:var(--t3)">No clients</div>';
    document.getElementById('am-details').innerHTML = `
      <div class="detail-row"><span class="detail-label">Email</span><span class="detail-val">${esc(a.email)}</span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-val"><span class="badge ${a.status==='verified'?'b-green':a.status==='pending'?'b-amber':'b-red'}">${esc(a.status)}</span></span></div>
      <div class="detail-row"><span class="detail-label">Rating</span><span class="detail-val">${a.avg_rating > 0 ? parseFloat(a.avg_rating).toFixed(1) + ' ★' : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Stripe</span><span class="detail-val"><span class="badge ${a.stripe_onboarded?'b-green':'b-amber'}">${a.stripe_onboarded?'Connected':'Not set'}</span></span></div>
      <div class="detail-row"><span class="detail-label">Total Earned</span><span class="detail-val">$${(parseInt(a.total_earnings_cents||0)/100).toFixed(2)}</span></div>
      <div class="detail-row"><span class="detail-label">Verify Method</span><span class="detail-val">${esc(a.verification_method||'—')}</span></div>
      ${vData.profBody?`<div class="detail-row"><span class="detail-label">Prof Body</span><span class="detail-val">${esc(vData.profBody)} · ${esc(vData.membershipNumber||'')}</span></div>`:''}
      <div class="detail-row"><span class="detail-label">Clients (${(a.clients||[]).length})</span></div>
      <div class="client-list">${clientRows}</div>`;
    const suspBtn = document.getElementById('am-suspend-btn');
    const appBtn = document.getElementById('am-approve-btn');
    suspBtn.style.display = a.status === 'verified' ? '' : 'none';
    appBtn.style.display = a.status === 'pending' ? '' : 'none';
    document.getElementById('acc-modal').classList.add('open');
  } catch(e) { toast('Failed to load accountant','error'); }
}

async function accModalAction(action) {
  if (!_currentAccId) return;
  document.getElementById('acc-modal').classList.remove('open');
  await verifyAction(_currentAccId, action);
}

// ── FLAGS ─────────────────────────────────────────────────────────────────────
async function loadFlags() {
  try {
    const res = await fetch('/api/admin/flags', { credentials:'include' });
    const data = await res.json();
    document.getElementById('flags-tbody').innerHTML = data.length ? data.map(f => `
      <tr>
        <td class="primary">${esc(((f.first_name||'')+' '+(f.last_name||'')).trim()||'—')}<div style="font-size:11px;color:var(--t3)">${esc(f.firm||'')}</div></td>
        <td>${esc(f.client_name||'—')}<div style="font-size:11px;color:var(--t3)">${esc(f.client_email||'')}</div></td>
        <td><span class="badge b-amber" style="text-transform:capitalize">${esc(f.txn_type||'—')}</span>${f.txn_ref?`<div style="font-size:11px;color:var(--t3);word-break:break-word">${esc(f.txn_ref)}</div>`:''}</td>
        <td style="min-width:240px;max-width:380px;white-space:normal;overflow-wrap:anywhere">${esc(f.note||'—')}</td>
        <td>${new Date(f.created_at).toLocaleDateString()}</td>
        <td><span class="badge ${f.status==='resolved'?'b-green':'b-amber'}" style="text-transform:capitalize">${esc(f.status||'open')}</span></td>
        <td>${f.status!=='resolved'?`<button class="action-btn approve" onclick="resolveFlag(${f.id},this)">Resolve</button>`:`<span style="font-size:11px;color:var(--t3)">${esc(f.resolved_by||'admin')}${f.resolved_at?' · '+new Date(f.resolved_at).toLocaleDateString():''}</span>`}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No flagged transactions</td></tr>';
  } catch(e) { console.error('Flags error',e); }
}

async function resolveFlag(id, btn) {
  const res = await fetch(`/api/admin/flags/${id}/resolve`, { method:'POST', credentials:'include' });
  const data = await res.json();
  if (data.error) { toast(data.error,'error'); return; }
  toast('Flag resolved','success');
  loadFlags();   // re-render from server (status→Resolved + stamp); avoids poking the wrong .badge cell
}

// ── BROADCAST ─────────────────────────────────────────────────────────────────
async function sendBroadcast() {
  const audience = document.getElementById('bc-audience').value;
  const subject = document.getElementById('bc-subject').value.trim();
  const message = document.getElementById('bc-message').value.trim();
  if (!subject || !message) { toast('Subject and message required','error'); return; }
  const res = await fetch('/api/admin/broadcast', {
    method:'POST', credentials:'include',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ audience, subject, message }),
  });
  const data = await res.json();
  if (data.error) { toast(data.error,'error'); return; }
  // F21: honest result — distinguish real delivery from logged-only (no email configured).
  if (data.logged) {
    toast(data.message || `Logged only — email not configured (${data.total} recipients).`, 'error');
    return;  // keep the draft so the admin can resend once email is configured
  }
  const failMsg = data.failed ? ` · ${data.failed} failed` : '';
  toast(`Broadcast sent to ${data.sent}/${data.total} recipients${failMsg}`,'success');
  document.getElementById('bc-subject').value = '';
  document.getElementById('bc-message').value = '';
}

// ── EXPORT CSV ────────────────────────────────────────────────────────────────
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

async function exportUsersCSV() {
  // Routed through the server so the PII export is logged to admin_log (see admin-routes.js).
  try {
    const res = await fetch('/api/admin/export/users.csv', { credentials: 'include' });
    if (!res.ok) { toast('Export failed','error'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'users.csv'; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('Export failed','error'); }
}

async function exportAccountantsCSV() {
  // Routed through the server so the PII export is logged to admin_log (see admin-routes.js).
  try {
    const res = await fetch('/api/admin/export/accountants.csv', { credentials: 'include' });
    if (!res.ok) { toast('Export failed','error'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'accountants.csv'; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('Export failed','error'); }
}
