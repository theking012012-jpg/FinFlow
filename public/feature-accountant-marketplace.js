// ══════════════════════════════════════════════════════════════════════════════
// FINFLOW ACCOUNTANT MARKETPLACE — Client-side integration
// Adds: "My Accountant" nav item + page, replaces advisors "Coming Soon" with
// real accountant discovery page backed by /api/accountants/directory
// ══════════════════════════════════════════════════════════════════════════════
window.addEventListener("load", function() {
(function() {

// ── 1. ADD "MY ACCOUNTANT" NAV ITEM under Accountant group ───────────────────
const accGroup = document.querySelector('#nav-group-accountant .nav-group-inner');
if (accGroup) {
  const myAccItem = document.createElement('div');
  myAccItem.className = 'nav-item nav-sub';
  myAccItem.setAttribute('onclick', "showPage('my-accountant',this)");
  myAccItem.innerHTML = `<svg class="nav-icon" viewBox="0 0 16 16"><circle cx="6" cy="4.5" r="2.5"/><path d="M1 13c0-2.76 2.24-5 5-5"/><path d="M10 9l1.5 1.5L14 8"/></svg>My Accountant`;
  accGroup.appendChild(myAccItem);

  const findAccItem = document.createElement('div');
  findAccItem.className = 'nav-item nav-sub';
  findAccItem.setAttribute('onclick', "showPage('find-accountant',this)");
  findAccItem.innerHTML = `<svg class="nav-icon" viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4"/><line x1="10" y1="10" x2="14" y2="14"/><path d="M10 9l1.5 1.5L14 8" style="display:none"/></svg>Find Accountant<span class="badge b-green" style="margin-left:auto;font-size:9px">NEW</span>`;
  accGroup.appendChild(findAccItem);
}

// ── 2. MY ACCOUNTANT PAGE ─────────────────────────────────────────────────────
const myAccPage = document.createElement('div');
myAccPage.className = 'page';
myAccPage.id = 'page-my-accountant';
myAccPage.innerHTML = `
<div style="max-width:720px;margin:0 auto;padding:1.5rem 0">
  <div style="margin-bottom:1.5rem">
    <div style="font-family:var(--font-display);font-size:24px;font-style:italic;color:var(--acc-light);margin-bottom:4px">My Accountant</div>
    <div style="font-size:13px;color:var(--t2)">Manage your accountant's access to your books</div>
  </div>

  <!-- CURRENT ACCOUNTANT CARD -->
  <div id="my-acc-content">
    <div style="text-align:center;padding:3rem 1rem;color:var(--t3)">
      <div style="width:56px;height:56px;border-radius:14px;background:var(--acc-bg);border:1px solid var(--acc2);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:24px">👤</div>
      <div style="font-size:14px;color:var(--t2);margin-bottom:8px">No accountant linked yet</div>
      <div style="font-size:13px;color:var(--t3);margin-bottom:1.25rem">Browse verified FinFlow accountants and request access</div>
      <button class="btn btn-primary" style="font-size:13px" onclick="showPage('find-accountant',null)">Find an accountant →</button>
    </div>
  </div>

  <!-- CHAT PANEL (shown when accountant linked and active) -->
  <div id="acct-chat-panel" style="margin-top:1.5rem;background:var(--bg2);border:1px solid var(--bd);border-radius:14px;overflow:hidden;display:none">
    <div style="padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:8px">
      <span style="font-size:13px;font-weight:600;color:var(--t1)">Messages</span>
    </div>
    <div id="acct-chat-thread" style="height:280px;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <div style="text-align:center;color:var(--t3);font-size:13px;padding:40px 0">No messages yet.</div>
    </div>
    <div style="padding:10px 12px;border-top:1px solid var(--bd);display:flex;gap:8px;align-items:center">
      <input id="acct-chat-input" class="finput" type="text" placeholder="Message your accountant…"
        style="flex:1;margin:0;padding:9px 12px"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsgToAccountant();}">
      <button class="btn btn-primary btn-sm" onclick="sendMsgToAccountant()" style="white-space:nowrap">Send →</button>
    </div>
  </div>

  <!-- ACCESS SETTINGS (shown when accountant linked) -->
  <div id="my-acc-access" style="display:none;margin-top:1rem">
    <div class="card" style="padding:1.25rem">
      <div style="font-size:13px;font-weight:500;color:var(--t1);margin-bottom:1rem">Access permissions</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label for="acc-perm-view" style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--t2);cursor:pointer">
          <span>View my books & reports</span>
          <input type="checkbox" id="acc-perm-view" checked onchange="updateAccPermission('view',this.checked)" style="width:16px;height:16px;accent-color:var(--acc)">
        </label>
        <label for="acc-perm-filing" style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--t2);cursor:pointer">
          <span>File tax returns on my behalf</span>
          <input type="checkbox" id="acc-perm-filing" onchange="updateAccPermission('filing',this.checked)" style="width:16px;height:16px;accent-color:var(--acc)">
        </label>
      </div>
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--bd);display:flex;gap:8px">
        <button class="btn btn-ghost" style="font-size:12px" onclick="leaveReview(linkedAccountant&&linkedAccountant.id)">★ Leave a review</button>
        <button class="btn btn-ghost" style="font-size:12px;color:var(--danger)" onclick="revokeAccountant()">Revoke access</button>
      </div>
    </div>
  </div>
</div>`;
document.querySelector('.content')?.appendChild(myAccPage);

// ── 3. FIND ACCOUNTANT PAGE ──────────────────────────────────────────────────
const findAccPage = document.createElement('div');
findAccPage.className = 'page';
findAccPage.id = 'page-find-accountant';
findAccPage.innerHTML = `
<div style="max-width:900px;margin:0 auto;padding:1.5rem 0">
  <div style="margin-bottom:1.5rem;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--font-display);font-size:24px;font-style:italic;color:var(--acc-light);margin-bottom:4px">Find an Accountant</div>
      <div style="font-size:13px;color:var(--t2)">All accountants are verified by the FinFlow team before listing</div>
    </div>
  </div>

  <!-- SEARCH & FILTERS -->
  <div style="display:flex;gap:10px;margin-bottom:1.25rem;flex-wrap:wrap">
    <input id="acc-search" class="finput" placeholder="Search by name, firm, or speciality..." style="flex:1;min-width:200px;font-size:13px" oninput="filterAccountants()">
    <select id="acc-filter-country" class="finput" style="width:160px;font-size:13px" onchange="filterAccountants()">
      <option value="">All countries</option>
      <option>Trinidad & Tobago</option>
      <option>United States</option>
      <option>United Kingdom</option>
      <option>Jamaica</option>
      <option>Canada</option>
      <option>Other</option>
    </select>
    <select id="acc-filter-spec" class="finput" style="width:160px;font-size:13px" onchange="filterAccountants()">
      <option value="">All specialities</option>
      <option>Tax & Filing</option>
      <option>Bookkeeping</option>
      <option>CFO Services</option>
      <option>Payroll</option>
      <option>Audit</option>
    </select>
  </div>

  <!-- ACCOUNTANT GRID -->
  <div id="acc-directory-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
    <div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--t3);font-size:13px">Loading accountants...</div>
  </div>
</div>`;
document.querySelector('.content')?.appendChild(findAccPage);

// ── 4. LOAD DIRECTORY FROM API ────────────────────────────────────────────────
let allAccountants = [];

async function loadDirectory() {
  try {
    const res = await fetch('/api/accountants/directory', {credentials:'include'});
    if (!res.ok) throw new Error('not ok');
    allAccountants = await res.json();
  } catch(e) {
    // Fallback demo data while directory is being populated
    allAccountants = [];
  }
  filterAccountants();
  loadMyAccountant();
}

window.filterAccountants = function() {
  const q = (document.getElementById('acc-search')?.value || '').toLowerCase();
  const country = document.getElementById('acc-filter-country')?.value || '';
  const spec = document.getElementById('acc-filter-spec')?.value || '';

  const filtered = allAccountants.filter(a => {
    const name = `${a.first_name} ${a.last_name} ${a.firm} ${a.specialisation}`.toLowerCase();
    return (!q || name.includes(q))
      && (!country || a.country === country)
      && (!spec || a.specialisation === spec);
  });

  const grid = document.getElementById('acc-directory-grid');
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--t3);font-size:13px">No accountants match your search</div>';
    return;
  }

  grid.innerHTML = filtered.map(a => {
    const initials = (a.first_name[0] + a.last_name[0]).toUpperCase();
    const colors = ['#c9a84c','#4a9c6d','#6b8ecc','#9b7ec8','#cc6b6b'];
    const col = colors[(a.id || 0) % colors.length];
    const rating = parseFloat(a.avg_rating) || 0;
    const reviewCount = parseInt(a.review_count) || 0;
    const stars = rating > 0
      ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating))
      : '☆☆☆☆☆';
    const starsColor = rating >= 4 ? '#c9a84c' : rating >= 3 ? '#c48a2a' : '#5a5540';
    return `
    <div class="card" style="padding:1.25rem;cursor:pointer;transition:border-color .2s" onmouseenter="this.style.borderColor='var(--acc2)'" onmouseleave="this.style.borderColor='var(--bd)'">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:40px;height:40px;border-radius:10px;background:${col}22;color:${col};border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0">${initials}</div>
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.first_name} ${a.last_name}</div>
          <div style="font-size:11px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.firm || ''}</div>
        </div>
        <span style="margin-left:auto;font-size:9px;background:var(--green-bg,#0d1f15);color:var(--green,#4a9c6d);border:1px solid rgba(74,156,109,0.3);border-radius:4px;padding:2px 6px;flex-shrink:0">✓ Verified</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="color:${starsColor};font-size:13px;letter-spacing:1px">${stars}</span>
        <span style="font-size:11px;color:var(--t3)">${rating > 0 ? rating.toFixed(1) + ' · ' + reviewCount + ' review' + (reviewCount !== 1 ? 's' : '') : 'No reviews yet'}</span>
      </div>
      <div style="font-size:11px;color:var(--t3);margin-bottom:6px">📍 ${a.country || 'N/A'} &nbsp;·&nbsp; ${a.specialisation || 'General'}</div>
      <div style="font-size:11px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px">
        <span style="background:rgba(74,156,109,0.1);color:#4a9c6d;border:1px solid rgba(74,156,109,0.25);border-radius:4px;padding:2px 7px;font-size:10px">🛡 FinFlow Protected</span>
        ${a.memberships ? a.memberships.split(',').slice(0,2).map(function(m){return '<span style="background:rgba(201,168,76,0.08);color:var(--acc);border:1px solid rgba(201,168,76,0.2);border-radius:4px;padding:2px 7px;font-size:10px">'+m.trim()+'</span>';}).join('') : ''}
      </div>
      ${a.credentials ? `<div style="font-size:11px;color:var(--t3);margin-bottom:6px">🎓 ${a.credentials}</div>` : ''}
      <div style="font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${a.bio || 'Verified FinFlow professional accountant.'}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        ${a.hourly_rate ? `<span style="font-size:13px;color:var(--acc-light,#e4c97a);font-weight:500">From $${parseFloat(a.hourly_rate).toFixed(0)}/hr</span>` : a.packages && a.packages.length ? '<span style="font-size:13px;color:var(--acc-light,#e4c97a);font-weight:500">From $'+(function(){try{var pkgs=typeof a.packages==="string"?JSON.parse(a.packages):a.packages;return Math.min.apply(null,pkgs.map(function(p){return p.price;})).toFixed(0);}catch(e){return "?";}})()+'</span>' : '<span style="font-size:12px;color:var(--t3,#5a5040)">Rates on request</span>'}
        ${a.has_pricing ? '<span style="font-size:10px;background:rgba(200,164,74,0.08);color:var(--acc,#c8a44a);border:1px solid rgba(200,164,74,0.25);border-radius:4px;padding:2px 7px">💰 Transparent Pricing</span>' : ''}
      </div>
      <div style="display:flex;gap:8px">
        ${linkedAccountant && linkedAccountant.id === a.id
          ? `<button class="btn btn-outline" style="flex:1;justify-content:center;font-size:12px;padding:7px;opacity:0.7;cursor:default" disabled>${linkedAccountant.status === 'pending' ? '⏳ Pending approval' : '✓ Linked'}</button>`
          : `<button class="btn btn-primary" style="flex:1;justify-content:center;font-size:12px;padding:7px" onclick="requestAccountant(${a.id},'${a.first_name} ${a.last_name}')">Request access</button>`
        }
        <button class="btn btn-ghost" style="font-size:12px;padding:7px;color:var(--t3)" onclick="event.stopPropagation();reportAccountant(${a.id},'${a.first_name} ${a.last_name}')" title="Report">⚑</button>
      </div>
    </div>`;
  }).join('');
}

// ── 5. MY ACCOUNTANT LOGIC ────────────────────────────────────────────────────
let linkedAccountant = null;

async function loadMyAccountant() {
  try {
    const res = await fetch('/api/accountants/my-accountant', { credentials: 'include' });
    if (res.ok) {
      linkedAccountant = await res.json();
      if (linkedAccountant && linkedAccountant.id) {
        renderLinkedAccountant();
        filterAccountants(); // re-render directory cards with correct button state
      }
    }
  } catch(e) { /* not linked */ }
}

function renderLinkedAccountant() {
  const a = linkedAccountant;
  if (!a || !a.id) return;
  const content = document.getElementById('my-acc-content');
  const access = document.getElementById('my-acc-access');
  if (!content) return;

  const initials = ((a.first_name||'?')[0] + (a.last_name||'?')[0]).toUpperCase();
  const colors = ['#c9a84c','#4a9c6d','#6b8ecc'];
  const col = colors[(a.id || 0) % colors.length];

  if (a.status === 'pending') {
    content.innerHTML = `
      <div class="card" style="padding:1.25rem;display:flex;align-items:center;gap:14px;border-color:rgba(196,138,42,0.4)">
        <div style="width:48px;height:48px;border-radius:12px;background:${col}22;color:${col};border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:500;color:var(--t1)">${a.first_name} ${a.last_name}</div>
          <div style="font-size:12px;color:var(--t3)">${a.firm || ''} &nbsp;·&nbsp; ${a.country || ''}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:2px">Your request is awaiting approval from this accountant.</div>
        </div>
        <span style="font-size:10px;background:rgba(196,138,42,0.12);color:var(--amber,#c8a44a);border:1px solid rgba(196,138,42,0.35);border-radius:4px;padding:3px 8px;flex-shrink:0">⏳ Pending</span>
      </div>`;
    if (access) access.style.display = 'none';
    return;
  }

  content.innerHTML = `
    <div class="card" style="padding:1.25rem;display:flex;align-items:center;gap:14px">
      <div style="width:48px;height:48px;border-radius:12px;background:${col}22;color:${col};border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;flex-shrink:0">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;color:var(--t1)">${a.first_name} ${a.last_name}</div>
        <div style="font-size:12px;color:var(--t3)">${a.firm || ''} &nbsp;·&nbsp; ${a.country || ''}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:2px">${a.specialisation || ''} &nbsp;·&nbsp; ${a.experience || ''}</div>
      </div>
      <span style="font-size:10px;background:var(--green-bg,#0d1f15);color:var(--green,#4a9c6d);border:1px solid rgba(74,156,109,0.3);border-radius:4px;padding:3px 8px;flex-shrink:0">✓ Linked</span>
    </div>`;

  if (access) access.style.display = 'block';
  if (typeof window.loadAccountantMessages === 'function') window.loadAccountantMessages();
}

window.loadAccountantMessages = async function() {
  try {
    const res = await fetch('/api/accountant-messages', {credentials:'include'});
    if (!res.ok) return;
    const msgs = await res.json();
    const el = document.getElementById('acct-chat-thread');
    const panel = document.getElementById('acct-chat-panel');
    if (!el || !panel) return;
    panel.style.display = 'block';
    const fn = typeof esc === 'function' ? esc : s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (!msgs.length) {
      el.innerHTML = '<div style="text-align:center;color:var(--t3);font-size:13px;padding:40px 0">No messages yet. Start the conversation below.</div>';
    } else {
      el.innerHTML = msgs.map(m => {
        const isMe = m.sender === 'client';
        const dateStr = new Date(m.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        return `<div style="display:flex;flex-direction:column;align-items:${isMe?'flex-end':'flex-start'};gap:2px">
          <div style="max-width:80%;background:${isMe?'var(--acc)':'var(--bg3)'};color:${isMe?'#0e0b08':'var(--t1)'};padding:9px 13px;border-radius:${isMe?'14px 14px 4px 14px':'14px 14px 14px 4px'};font-size:13.5px;line-height:1.5">${fn(m.content)}</div>
          <div style="font-size:11px;color:var(--t3);padding:0 4px">${fn(m.sender_name)} · ${dateStr}</div>
        </div>`;
      }).join('');
      el.scrollTop = el.scrollHeight;
    }
  } catch(e) { console.warn('[Chat] load failed:', e.message); }
};

window.sendMsgToAccountant = async function() {
  const input = document.getElementById('acct-chat-input');
  const content = (input?.value || '').trim();
  if (!content) return;
  const btn = document.querySelector('#acct-chat-panel .btn-primary');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/accountant-messages', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content})
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    if (input) input.value = '';
    await window.loadAccountantMessages();
  } catch(e) {
    alert('Failed to send: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
};

window.requestAccountant = async function(accountantId, name) {
  try {
    const meRes = await fetch('/api/me', { credentials: 'include' });
    const me = await meRes.json();
    const userId = me.user?.id;
    if (!userId) {
      if(typeof notify==='function') notify('Please log in first');
      else alert('Please log in first');
      return;
    }
    const res = await fetch('/api/accountants/request-access', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountantId }),
    });
    const data = await res.json();
    if (data.success) {
      if(typeof notify==='function') notify(`✓ Request sent to ${name}`);
      else alert('Request sent successfully!');
      linkedAccountant = { id: accountantId, status: 'pending', first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' ') };
      filterAccountants();
      showPage('my-accountant', null);
      setTimeout(loadMyAccountant, 300);
    } else if (data.error?.includes('already')) {
      if(typeof notify==='function') notify('⚠ You are already linked to this accountant.');
      else alert(data.error);
    } else {
      if(typeof notify==='function') notify('⚠ ' + (data.error || 'Something went wrong'));
      else alert(data.error || 'Something went wrong');
    }
  } catch(e) {
    if(typeof notify==='function') notify('Could not send request — are you logged in?');
  }
}

window.updateAccPermission = function(type, val) {
  if(typeof notify==='function') notify(`${type === 'view' ? 'View' : 'Filing'} access ${val ? 'granted' : 'revoked'}`);
}

window.revokeAccountant = function() {
  if (!confirm('Are you sure you want to revoke this accountant\'s access?')) return;
  linkedAccountant = null;
  const content = document.getElementById('my-acc-content');
  const access = document.getElementById('my-acc-access');
  if (content) content.innerHTML = `
    <div style="text-align:center;padding:3rem 1rem;color:var(--t3)">
      <div style="font-size:14px;color:var(--t2);margin-bottom:8px">No accountant linked</div>
      <button class="btn btn-primary" style="font-size:13px" onclick="showPage('find-accountant',null)">Find an accountant →</button>
    </div>`;
  if (access) access.style.display = 'none';
  if(typeof notify==='function') notify('Accountant access revoked');
}

// ── 5b. REPORT ACCOUNTANT ────────────────────────────────────────────────────
window.reportAccountant = function(accountantId, name) {
  // TODO: Replace with modal textarea — prompt() removed per audit Finding 34
  if (!confirm(`Report this accountant to FinFlow? Our team will review within 24 hours.`)) return;
  const reason = 'Reported by client — details to be collected via support contact';
  fetch('/api/accountants/report', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountantId, reason }),
  }).then(r => r.json()).then(data => {
    if(typeof notify==='function') notify(data.error || '✓ Report submitted — our team will review within 24 hours');
  }).catch(() => {
    if(typeof notify==='function') notify('Could not submit report');
  });
};

// ── 5c. LEAVE REVIEW (shown in My Accountant page after payment) ─────────────
window.leaveReview = function(accountantId) {
  if (!accountantId) { if(typeof notify==='function') notify('No accountant linked'); return; }
  // TODO: Replace with star-rating modal — prompt() removed per audit Finding 34
  if (!confirm('Leave a 5-star review for your accountant?')) return;
  const r = 5; // TODO: collect star rating from modal UI
  const comment = ''; // TODO: collect from modal textarea
  fetch('/api/accountants/review', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountantId, rating: r, comment }),
  }).then(r => r.json()).then(data => {
    if (data.error) { if(typeof notify==='function') notify('⚠ ' + data.error); return; }
    if(typeof notify==='function') notify('✓ Review submitted — thank you!');
  }).catch(() => {
    if(typeof notify==='function') notify('Could not submit review');
  });
};

// ── 6. HOOK INTO showPage ─────────────────────────────────────────────────────
const _spMarketplace = window.showPage;
window.showPage = function(id, el) {
  _spMarketplace(id, el);
  if (id === 'find-accountant') {
    const titles = document.getElementById('pageTitle');
    if (titles) titles.textContent = 'Find Accountant';
    if (!allAccountants.length) loadDirectory();
    else filterAccountants();
  }
  if (id === 'my-accountant') {
    const titles = document.getElementById('pageTitle');
    if (titles) titles.textContent = 'My Accountant';
    if (!allAccountants.length) loadDirectory();
    if (linkedAccountant && linkedAccountant.status === 'active') { if (typeof window.loadAccountantMessages === 'function') window.loadAccountantMessages(); }
  }
  if (id === 'advisors') {
    // Redirect old advisors page to find-accountant
    showPage('find-accountant', el);
  }
};

// Boot
loadDirectory();

})();
}); // end load listener


