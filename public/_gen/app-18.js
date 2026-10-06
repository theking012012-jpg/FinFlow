
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

  <!-- PROPOSALS (shown when accountant linked and there are proposals) -->
  <div id="acct-proposals" style="margin-top:1.5rem;display:none"></div>

  <!-- REQUESTS / TASKS (shown when accountant linked and there are tasks) -->
  <div id="acct-tasks" style="margin-top:1.5rem;display:none"></div>

  <!-- CHAT PANEL (shown when accountant linked and active) -->
  <div id="acct-chat-panel" style="margin-top:1.5rem;background:var(--bg2);border:1px solid var(--bd);border-radius:14px;overflow:hidden;display:none">
    <div style="padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:8px">
      <span style="font-size:13px;font-weight:600;color:var(--t1)">Messages</span>
    </div>
    <div id="acct-chat-thread" style="height:280px;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <div style="text-align:center;color:var(--t3);font-size:13px;padding:40px 0">No messages yet.</div>
    </div>
    <div style="padding:10px 12px;border-top:1px solid var(--bd);display:flex;gap:8px;align-items:center">
      <input type="file" id="acct-chat-file" style="display:none" onchange="sendAcctAttachment(this)">
      <button class="btn btn-ghost btn-sm" title="Attach a file (max 5MB)" onclick="document.getElementById('acct-chat-file').click()" style="white-space:nowrap">📎</button>
      <input id="acct-chat-input" class="finput" type="text" placeholder="Message your accountant…"
        style="flex:1;margin:0;padding:9px 12px"
        oninput="onAccountantTyping()"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsgToAccountant();}">
      <button class="btn btn-primary btn-sm" onclick="sendMsgToAccountant()" style="white-space:nowrap">Send →</button>
    </div>
  </div>

  <!-- ACCESS SETTINGS (shown when accountant linked) -->
  <div id="my-acc-access" style="display:none;margin-top:1rem">
    <div class="card" style="padding:1.25rem">
      <div style="font-size:13px;font-weight:500;color:var(--t1);margin-bottom:1rem">Access permissions</div>
      <div style="font-size:11.5px;color:var(--t3);margin:-6px 0 12px">Choose what your accountant can see and do — for each business and for your personal finances, independently. <strong style="color:var(--t2)">None</strong> = fully hidden. <strong style="color:var(--t2)">View</strong> = read only. <strong style="color:var(--t2)">Filing</strong> = read, post entries &amp; lock periods.</div>
      <div id="acc-perm-matrix" style="display:flex;flex-direction:column;gap:8px"></div>
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
let directoryError = false;

async function loadDirectory() {
  try {
    const res = await fetch('/api/accountants/directory', {credentials:'include'});
    if (!res.ok) throw new Error('not ok');
    allAccountants = await res.json();
    directoryError = false;
  } catch(e) {
    // Honest failure state — distinguish "couldn't load" from "none listed" (never fake data).
    allAccountants = [];
    directoryError = true;
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
    grid.innerHTML = directoryError
      ? '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--t3);font-size:13px">Couldn\'t load the directory. <a style="color:var(--acc);cursor:pointer" onclick="loadDirectory()">Try again</a></div>'
      : '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--t3);font-size:13px">' + (allAccountants.length ? 'No accountants match your search' : 'No accountants listed yet — check back soon') + '</div>';
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
        <div style="width:40px;height:40px;border-radius:10px;background:${col}22;color:${col};border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0">${esc(initials)}</div>
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.first_name)} ${esc(a.last_name)}</div>
          <div style="font-size:11px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.firm || '')}</div>
        </div>
        <span style="margin-left:auto;font-size:9px;background:var(--green-bg,#0d1f15);color:var(--green,#4a9c6d);border:1px solid rgba(74,156,109,0.3);border-radius:4px;padding:2px 6px;flex-shrink:0">✓ Verified</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="color:${starsColor};font-size:13px;letter-spacing:1px">${stars}</span>
        <span style="font-size:11px;color:var(--t3)">${rating > 0 ? rating.toFixed(1) + ' · ' + reviewCount + ' review' + (reviewCount !== 1 ? 's' : '') : 'No reviews yet'}</span>
      </div>
      <div style="font-size:11px;color:var(--t3);margin-bottom:6px">📍 ${esc(a.country || 'N/A')} &nbsp;·&nbsp; ${esc(a.specialisation || 'General')}</div>
      <div style="font-size:11px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px">
        ${a.stripe_onboarded ? '<span style="background:rgba(74,156,109,0.1);color:#4a9c6d;border:1px solid rgba(74,156,109,0.25);border-radius:4px;padding:2px 7px;font-size:10px">🛡 FinFlow Protected</span>' : ''}
        ${a.confirmed_credentials ? '<span style="background:rgba(74,156,109,0.12);color:#4a9c6d;border:1px solid rgba(74,156,109,0.35);border-radius:4px;padding:2px 7px;font-size:10px">✓ '+esc(a.confirmed_credentials)+' · verified by FinFlow</span>' : ''}
      </div>
      <div style="font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${a.bio ? esc(a.bio) : 'FinFlow professional accountant.'}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        ${a.hourly_rate ? `<span style="font-size:13px;color:var(--acc-light,#e4c97a);font-weight:500">From $${parseFloat(a.hourly_rate).toFixed(0)}/hr</span>` : a.packages && a.packages.length ? '<span style="font-size:13px;color:var(--acc-light,#e4c97a);font-weight:500">From $'+(function(){try{var pkgs=typeof a.packages==="string"?JSON.parse(a.packages):a.packages;return Math.min.apply(null,pkgs.map(function(p){return p.price;})).toFixed(0);}catch(e){return "?";}})()+'</span>' : '<span style="font-size:12px;color:var(--t3,#5a5040)">Rates on request</span>'}
        ${a.has_pricing ? '<span style="font-size:10px;background:rgba(200,164,74,0.08);color:var(--acc,#c8a44a);border:1px solid rgba(200,164,74,0.25);border-radius:4px;padding:2px 7px">💰 Transparent Pricing</span>' : ''}
      </div>
      <div style="display:flex;gap:8px">
        ${linkedAccountant && linkedAccountant.id === a.id
          ? `<button class="btn btn-outline" style="flex:1;justify-content:center;font-size:12px;padding:7px;opacity:0.7;cursor:default" disabled>${linkedAccountant.status === 'pending' ? '⏳ Pending approval' : '✓ Linked'}</button>`
          : `<button class="btn btn-primary" style="flex:1;justify-content:center;font-size:12px;padding:7px" data-name="${esc((a.first_name||'') + ' ' + (a.last_name||''))}" onclick="requestAccountant(${Number(a.id)}, this.dataset.name)">Request access</button>`
        }
        <button class="btn btn-ghost" style="font-size:12px;padding:7px;color:var(--t3)" data-name="${esc((a.first_name||'') + ' ' + (a.last_name||''))}" onclick="event.stopPropagation();reportAccountant(${Number(a.id)}, this.dataset.name)" title="Report">⚑</button>
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
        <div style="width:48px;height:48px;border-radius:12px;background:${col}22;color:${col};border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;flex-shrink:0">${esc(initials)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:500;color:var(--t1)">${esc(a.first_name)} ${esc(a.last_name)}</div>
          <div style="font-size:12px;color:var(--t3)">${esc(a.firm || '')} &nbsp;·&nbsp; ${esc(a.country || '')}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:2px">${a.requested_by === 'client'
            ? 'Your request is awaiting approval from this accountant.'
            : 'You joined through this accountant\'s referral link. They can see your books only if you approve.'}</div>
        </div>
        ${a.requested_by === 'client'
          ? '<span style="font-size:10px;background:rgba(196,138,42,0.12);color:var(--amber,#c8a44a);border:1px solid rgba(196,138,42,0.35);border-radius:4px;padding:3px 8px;flex-shrink:0">⏳ Pending</span>'
          : `<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-gold btn-sm" onclick="respondReferralLink(${Number(a.id)}, true, this)">Approve access</button><button class="btn btn-sm" onclick="respondReferralLink(${Number(a.id)}, false, this)">Decline</button></div>`}
      </div>`;
    if (access) access.style.display = 'none';
    return;
  }

  content.innerHTML = `
    <div class="card" style="padding:1.25rem;display:flex;align-items:center;gap:14px">
      <div style="width:48px;height:48px;border-radius:12px;background:${col}22;color:${col};border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;flex-shrink:0">${esc(initials)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;color:var(--t1)">${esc(a.first_name)} ${esc(a.last_name)}</div>
        <div style="font-size:12px;color:var(--t3)">${esc(a.firm || '')} &nbsp;·&nbsp; ${esc(a.country || '')}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:2px">${esc(a.specialisation || '')} &nbsp;·&nbsp; ${esc(a.experience || '')}</div>
      </div>
      <span style="font-size:10px;background:var(--green-bg,#0d1f15);color:var(--green,#4a9c6d);border:1px solid rgba(74,156,109,0.3);border-radius:4px;padding:3px 8px;flex-shrink:0">✓ Linked</span>
    </div>`;

  if (access) access.style.display = 'block';
  // Render the per-entity + personal access matrix from the owner's current grant.
  if (typeof window.renderAccessMatrix === 'function') window.renderAccessMatrix();
  // Badge unread on the nav item, but only auto-open the thread (which marks read) if the
  // client is actually on the My Accountant page — otherwise defer to showPage on navigation.
  setMyAccNavBadge(a.unread || 0);
  const onPage = document.getElementById('page-my-accountant')?.classList.contains('active');
  if (onPage && typeof window.loadAccountantMessages === 'function') window.loadAccountantMessages();
}

// N78: a referral link (the user signed up through an accountant's link) grants books access only when
// the CLIENT approves it here; declining removes the pending link.
window.respondReferralLink = async function (accountantId, approve, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/accountants/my-accountant/' + (approve ? 'approve' : 'decline'), {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountantId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) { if (typeof notify === 'function') notify(data.error || 'Could not update the accountant link', true); if (btn) btn.disabled = false; return; }
    if (typeof notify === 'function') notify(approve ? 'Accountant access approved ✓' : 'Referral link declined');
    linkedAccountant = null;
    const content = document.getElementById('my-acc-content');
    if (!approve && content) content.innerHTML = '';
    await loadMyAccountant();
  } catch (e) { if (typeof notify === 'function') notify('Could not update the accountant link', true); if (btn) btn.disabled = false; }
};

// ── ACCOUNTANT CHAT — real-time (SSE), read receipts, typing, poll fallback ──
// Uses the hub-backed endpoints under /api/accountants/my-accountant/* (server-scoped to the
// caller's own active link). The legacy /api/accountant-messages route still works but does not
// broadcast — this is the live path.
let _acctMsgs = [], _acctOtherRead = null, _acctSse = null, _acctPoll = null;
let _acctTypingAt = 0, _acctTypingHide = null;
const _acctEsc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const _fmtBytes = n => { n=Number(n)||0; if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(1)+' MB'; };
const _CHAT_ATT_MAX_CLIENT = 5*1024*1024;
window.sendAcctAttachment = function(inputEl){
  var f = inputEl && inputEl.files && inputEl.files[0]; if(!f) return;
  if(f.size > _CHAT_ATT_MAX_CLIENT){ if(typeof notify==='function') notify('File too large (max 5MB).', true); inputEl.value=''; return; }
  var reader = new FileReader();
  reader.onload = function(){
    var dataB64 = String(reader.result||'');
    fetch('/api/accountants/my-accountant/attach',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name:f.name,mime:f.type||'application/octet-stream',dataB64:dataB64})})
      .then(function(r){ return r.ok?r.json():r.json().then(function(j){throw new Error(j.error||'Upload failed');}); })
      .then(function(row){ if(!_acctMsgs.some(function(m){return m.id===row.id;})){ _acctMsgs.push(row); renderAccountantMessages(); } })
      .catch(function(e){ if(typeof notify==='function') notify(e.message||'Upload failed', true); });
    inputEl.value='';
  };
  reader.readAsDataURL(f);
};

function renderAccountantMessages() {
  const el = document.getElementById('acct-chat-thread');
  if (!el) return;
  if (!_acctMsgs.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--t3);font-size:13px;padding:40px 0">No messages yet. Start the conversation below.</div>';
    return;
  }
  // "Seen" on my last message the accountant has read (created_at <= their last_read).
  const readTs = _acctOtherRead ? new Date(_acctOtherRead).getTime() : 0;
  let lastSeen = -1;
  _acctMsgs.forEach((m,i) => { if (m.sender === 'client' && new Date(m.created_at).getTime() <= readTs) lastSeen = i; });
  el.innerHTML = _acctMsgs.map((m,i) => {
    const isMe = m.sender === 'client';
    const dateStr = new Date(m.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    const seen = i === lastSeen ? ' · <span style="color:var(--acc)">✓ Seen</span>' : '';
    const att = m.att_name ? `<a href="/api/accountants/chat-attachment/${m.id}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:5px;max-width:80%;background:${isMe?'rgba(0,0,0,.12)':'var(--bg2)'};border:1px solid ${isMe?'rgba(0,0,0,.15)':'var(--bd)'};border-radius:9px;padding:7px 11px;font-size:12.5px;color:${isMe?'#0e0b08':'var(--acc)'};text-decoration:none">📎 ${_acctEsc(m.att_name)}${m.att_size?` · ${_fmtBytes(m.att_size)}`:''}</a>` : '';
    return `<div style="display:flex;flex-direction:column;align-items:${isMe?'flex-end':'flex-start'};gap:2px">
      <div style="max-width:80%;background:${isMe?'var(--acc)':'var(--bg3)'};color:${isMe?'#0e0b08':'var(--t1)'};padding:9px 13px;border-radius:${isMe?'14px 14px 4px 14px':'14px 14px 14px 4px'};font-size:13.5px;line-height:1.5">${_acctEsc(m.content)}</div>
      ${att}
      <div style="font-size:11px;color:var(--t3);padding:0 4px">${_acctEsc(m.sender_name)} · ${dateStr}${seen}</div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

window.loadAccountantMessages = async function() {
  try {
    const res = await fetch('/api/accountants/my-accountant/messages', {credentials:'include'});
    if (!res.ok){
      if (res.status !== 401 && res.status !== 403) console.error('[AccountantMessages] load failed (HTTP '+res.status+')');
      return;
    }
    const data = await res.json();
    _acctMsgs = data.messages || [];
    _acctOtherRead = data.otherLastRead || null;
    const panel = document.getElementById('acct-chat-panel');
    if (panel) panel.style.display = 'block';
    renderAccountantMessages();
    setMyAccNavBadge(0);   // opening the thread clears the badge
    openAccountantStream();
    if (!_acctPoll) _acctPoll = setInterval(refreshAccountantMessages, 20000);
    if (typeof loadMyProposals === 'function') loadMyProposals();
    if (typeof loadMyTasks === 'function') loadMyTasks();
  } catch(e) { console.warn('[Chat] load failed:', e.message); }
};

// ── REQUESTS / TASKS (client view) ──────────────────────────────────────────
window.loadMyTasks = async function() {
  const el = document.getElementById('acct-tasks'); if (!el) return;
  try {
    const r = await fetch('/api/accountants/my-accountant/tasks', {credentials:'include'});
    if (!r.ok) { el.style.display='none'; return; }
    const tasks = (await r.json()).tasks || [];
    if (!tasks.length) { el.style.display='none'; el.innerHTML=''; return; }
    const openN = tasks.filter(t => t.status !== 'done').length;
    const fmtDue = d => { if (!d) return ''; return new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); };
    const row = t => {
      const done = t.status === 'done';
      const due = t.due_date ? `<span style="font-size:11px;color:${(!done && new Date(t.due_date) < new Date()) ? 'var(--red)' : 'var(--t3)'};margin-left:8px">due ${fmtDue(t.due_date)}</span>` : '';
      const check = done
        ? '<svg viewBox="0 0 16 16" style="width:18px;height:18px;flex-shrink:0"><circle cx="8" cy="8" r="8" fill="var(--acc)"/><path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="#16120d" stroke-width="1.6"/></svg>'
        : '<svg viewBox="0 0 16 16" style="width:18px;height:18px;flex-shrink:0"><circle cx="8" cy="8" r="7.2" fill="none" stroke="var(--bd2)" stroke-width="1.4"/></svg>';
      return `<div style="display:flex;align-items:flex-start;gap:11px;padding:11px 0;border-top:1px solid var(--bd)">
          <button onclick="toggleTask(${t.id},${done ? 'true' : 'false'},this)" title="${done?'Reopen':'Mark done'}" style="background:none;border:none;cursor:pointer;padding:0;line-height:0">${check}</button>
          <div style="flex:1">
            <div style="font-size:13.5px;color:${done?'var(--t2)':'var(--t1)'};${done?'text-decoration:line-through;text-decoration-color:var(--t3)':''}">${_acctEsc(t.title)}${due}</div>
            ${t.detail?`<div style="font-size:12.3px;color:var(--t2);margin-top:3px;white-space:pre-wrap">${_acctEsc(t.detail)}</div>`:''}
          </div></div>`;
    };
    el.style.display='block';
    el.innerHTML = `<div style="background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:6px 17px 14px">
        <div style="display:flex;align-items:center;gap:9px;padding:13px 0 2px"><span style="font-family:var(--font-display);font-size:18px;color:var(--t1)">Requests from your accountant</span>${openN?`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--amber-bg);color:var(--amber)">${openN} open</span>`:''}</div>
        <div style="font-size:11.5px;color:var(--t3);margin-bottom:2px">Tick an item when it's done. You can attach a requested file in Messages above.</div>
        ${tasks.map(row).join('')}</div>`;
  } catch(e) { el.style.display='none'; }
};
window.toggleTask = async function(id, currentlyDone, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/accountants/my-accountant/tasks/'+id+'/done', {method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({done: !currentlyDone})});
    if (!r.ok) { if (typeof notify==='function') notify('Could not update the task.', true); if (btn) btn.disabled=false; return; }
    loadMyTasks();
  } catch(e) { if (btn) btn.disabled=false; }
};

// ── ENGAGEMENT PROPOSALS (client view) ──────────────────────────────────────
const _fmtFee = (cents, cur) => { const n = (Number(cents)||0)/100; return esc(cur||'USD') + ' ' + n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2}); };
window.loadMyProposals = async function() {
  const el = document.getElementById('acct-proposals'); if (!el) return;
  try {
    const r = await fetch('/api/accountants/my-accountant/proposals', {credentials:'include'});
    if (!r.ok) { el.style.display='none'; return; }
    const props = (await r.json()).proposals || [];
    if (!props.length) { el.style.display='none'; el.innerHTML=''; return; }
    const billLabel = b => b==='monthly' ? '/mo' : (b==='hourly' ? '/hr' : '');
    const card = p => {
      const pending = p.status==='pending';
      const badge = pending ? '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--amber-bg);color:var(--amber)">Awaiting your response</span>'
        : p.status==='accepted' ? '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--green-bg);color:var(--green)">Accepted ✓</span>'
        : p.status==='declined' ? '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--red-bg);color:var(--red)">Declined</span>'
        : '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--bg3);color:var(--t3)">Withdrawn</span>';
      const actions = pending ? `<div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="respondProposal(${p.id},'accept',this)">Accept</button>
          <button class="btn btn-ghost btn-sm" onclick="respondProposal(${p.id},'decline',this)">Decline</button></div>` : '';
      return `<div style="border-top:1px solid var(--bd);padding:14px 0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:14px;color:var(--t1);font-weight:500">${_acctEsc(p.title)}</span>${badge}</div>
          ${p.scope ? `<div style="font-size:12.7px;color:var(--t2);margin-top:5px;white-space:pre-wrap">${_acctEsc(p.scope)}</div>` : ''}
          <div style="font-size:13px;color:var(--acc-light);margin-top:7px;font-family:var(--font-mono)">${_fmtFee(p.fee_cents,p.currency)}<span style="color:var(--t3)">${billLabel(p.billing)}</span></div>
          ${actions}</div>`;
    };
    el.style.display='block';
    el.innerHTML = `<div style="background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:6px 17px 14px">
        <div style="display:flex;align-items:center;gap:9px;padding:13px 0 2px"><span style="font-family:var(--font-display);font-size:18px;color:var(--t1)">Engagement proposals</span></div>
        <div style="font-size:11.5px;color:var(--t3);margin-bottom:4px">Service offers from your accountant. Accepting one starts the engagement.</div>
        ${props.map(card).join('')}</div>`;
  } catch(e) { el.style.display='none'; }
};
window.respondProposal = async function(id, action, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/accountants/my-accountant/proposals/'+id+'/respond', {method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({action:action})});
    if (!r.ok) { const j = await r.json().catch(()=>({})); if (typeof notify==='function') notify(j.error||'Could not update the proposal.', true); if (btn) btn.disabled=false; return; }
    if (typeof notify==='function') notify(action==='accept' ? 'Proposal accepted — engagement started.' : 'Proposal declined.');
    loadMyProposals();
  } catch(e) { if (btn) btn.disabled=false; }
};

async function refreshAccountantMessages() {
  try {
    const res = await fetch('/api/accountants/my-accountant/messages', {credentials:'include'});
    if (!res.ok) return;
    const data = await res.json();
    _acctMsgs = data.messages || [];
    _acctOtherRead = data.otherLastRead || null;
    renderAccountantMessages();
  } catch(e) {}
}

function openAccountantStream() {
  if (_acctSse) return;
  try {
    _acctSse = new EventSource('/api/accountants/my-accountant/stream', { withCredentials: true });
    _acctSse.addEventListener('message', (e) => {
      const d = JSON.parse(e.data);
      if (_acctMsgs.some(m => m.id === d.id)) return;
      _acctMsgs.push(d);
      renderAccountantMessages();
      if (d.sender === 'accountant') { fetch('/api/accountants/my-accountant/messages',{credentials:'include'}).catch(()=>{}); }  // mark read
    });
    _acctSse.addEventListener('read', (e) => {
      const d = JSON.parse(e.data);
      if (d.by === 'accountant') { _acctOtherRead = d.at; renderAccountantMessages(); }
    });
    _acctSse.addEventListener('typing', (e) => {
      const d = JSON.parse(e.data);
      if (d.by === 'accountant') showAccountantTyping();
    });
    _acctSse.onerror = () => { try { _acctSse.close(); } catch(_){} _acctSse = null; setTimeout(openAccountantStream, 4000); };
  } catch(e) { _acctSse = null; }
}

function showAccountantTyping() {
  const el = document.getElementById('acct-chat-thread');
  if (!el) return;
  let t = document.getElementById('acct-typing');
  if (!t) {
    t = document.createElement('div');
    t.id = 'acct-typing';
    t.style.cssText = 'font-size:12px;color:var(--t3);font-style:italic;padding:2px 4px';
    el.appendChild(t);
  }
  t.textContent = 'Your accountant is typing…';
  el.scrollTop = el.scrollHeight;
  clearTimeout(_acctTypingHide);
  _acctTypingHide = setTimeout(() => { t.remove(); }, 3000);
}

window.onAccountantTyping = function() {
  const now = Date.now();
  if (now - _acctTypingAt < 2000) return;
  _acctTypingAt = now;
  fetch('/api/accountants/my-accountant/typing', { method:'POST', credentials:'include' }).catch(()=>{});
};

window.sendMsgToAccountant = async function() {
  const input = document.getElementById('acct-chat-input');
  const content = (input?.value || '').trim();
  if (!content) return;
  const btn = document.querySelector('#acct-chat-panel .btn-primary');
  if (btn) btn.disabled = true;
  if (input) input.value = '';
  try {
    const res = await fetch('/api/accountants/my-accountant/messages', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content})
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || 'Send failed'); }
    const row = await res.json();
    if (!_acctMsgs.some(m => m.id === row.id)) { _acctMsgs.push({ ...row, sender:'client', sender_name:'You' }); renderAccountantMessages(); }
  } catch(e) {
    if (input) input.value = content;
    if(typeof notify==='function') notify('Failed to send: ' + e.message, true); else alert('Failed to send: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
};

// Unread badge on the "My Accountant" nav item (fed by my-accountant GET's `unread`).
function setMyAccNavBadge(n) {
  const nav = document.querySelector('.nav-item[onclick*="my-accountant"]');
  if (!nav) return;
  let b = nav.querySelector('.nav-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge';
      b.style.cssText = 'display:inline-block;min-width:16px;height:16px;line-height:16px;text-align:center;font-size:10px;font-weight:700;background:var(--acc);color:#0e0b08;border-radius:9px;padding:0 5px;margin-left:6px'; nav.appendChild(b); }
    b.textContent = n;
  } else if (b) b.remove();
}

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
      linkedAccountant = { id: accountantId, status: 'pending', requested_by: 'client', first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' ') };
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

// F111: render the member axis — which accounts this login can access — and the scoped-session
// banner. Reads GET /api/my-access (the resolver's member axis, which nothing displayed before).
window.loadMyAccess = async function() {
  try {
    const res = await fetch('/api/my-access', { credentials: 'include' });
    if (!res.ok) return;
    const d = await res.json();
    const E = (s) => (window.esc ? window.esc(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const banner = document.getElementById('scoped-banner');
    if (d.scopedIntoOther) {
      const other = (d.accounts || []).find(a => a.accountOwnerId === d.currentAccountId) || {};
      const nEl = document.getElementById('scoped-banner-name'); if (nEl) nEl.textContent = other.ownerName || other.ownerEmail || 'another account';
      const rEl = document.getElementById('scoped-banner-role'); if (rEl) rEl.textContent = other.role || 'member';
      if (banner) banner.style.display = 'block';
    } else if (banner) { banner.style.display = 'none'; }
    const list = document.getElementById('my-access-list');
    if (list) {
      const rows = (d.accounts || []).map(a => {
        const label = a.isOwn ? 'Your own account' : (a.ownerName || a.ownerEmail || ('Account #' + a.accountOwnerId));
        const isCur = a.accountOwnerId === d.currentAccountId;
        const cur = isCur ? ' <span style="color:var(--acc,#c9a84c)">· currently viewing</span>' : '';
        // N36: switch accounts (own books ↔ accounts you were invited into).
        const sw = isCur ? '' : `<button class="btn btn-ghost btn-sm" style="margin-left:8px;font-size:11px;padding:3px 8px" onclick="switchAccount(${Number(a.accountOwnerId)}, this)">Switch</button>`;
        return `<div style="padding:8px 0;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center"><span>${E(label)}${cur}</span><span style="display:flex;align-items:center"><span style="color:var(--t3);font-size:11px;text-transform:capitalize">${E(a.role)}</span>${sw}</span></div>`;
      });
      list.innerHTML = rows.join('') || '<div style="color:var(--t3)">Just your own account.</div>';
    }
  } catch (e) { /* not logged in / no access — leave defaults */ }
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.loadMyAccess()); else window.loadMyAccess();
// N36: move this session into another account the login can access, then reload so every page,
// cache and entity list is rebuilt for that account.
window.switchAccount = async function(accountOwnerId, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/my-access/switch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountOwnerId }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { if (typeof notify === 'function') notify(d.error || 'Could not switch account', true); if (btn) btn.disabled = false; return; }
    window.location.reload();
  } catch (e) { if (typeof notify === 'function') notify('Could not switch account', true); if (btn) btn.disabled = false; }
};

window.updateAccPermission = async function(type, val) {
  // The owner chooses their accountant's level: view = review the books (read-only),
  // filing = run the books (post adjusting entries + lock periods). "File tax returns on my
  // behalf" is the filing upgrade; "View my books" is the read-only base. Persists via the real
  // endpoint (was previously a notification only — a fake-success control).
  const viewCb = document.getElementById('acc-perm-view');
  const filingCb = document.getElementById('acc-perm-filing');
  let level;
  if (type === 'filing') {
    level = val ? 'filing' : 'view';
  } else { // 'view' toggled — read is the base while an accountant is linked
    if (!val) {
      if (viewCb) viewCb.checked = true; // can't drop below read without removing the accountant
      if (typeof notify === 'function') notify('To remove all access, use "Revoke access".');
      return;
    }
    level = (filingCb && filingCb.checked) ? 'filing' : 'view';
  }
  try {
    const res = await fetch('/api/accountants/my-accountant/access', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ access_level: level }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (filingCb) filingCb.checked = (data.access_level === 'filing');
      if (viewCb) viewCb.checked = true;
      if (typeof notify === 'function') {
        notify(data.access_level === 'filing'
          ? '✓ Your accountant can now run your books — post entries & lock periods'
          : '✓ Your accountant is set to review-only');
      }
    } else {
      if (filingCb) filingCb.checked = !!(linkedAccountant && linkedAccountant.access_level === 'filing');
      if (typeof notify === 'function') notify('⚠ ' + (data.error || 'Could not update access'));
    }
  } catch (e) {
    if (typeof notify === 'function') notify('Could not update access — are you logged in?');
  }
}

window.renderAccessMatrix = async function() {
  const wrap = document.getElementById('acc-perm-matrix');
  if (!wrap) return;
  const a = linkedAccountant || {};
  // Current grant. entity_access null/absent = legacy: every entity at the account-wide level,
  // personal hidden. A stored JSON string is parsed too.
  let ea = a.entity_access;
  if (typeof ea === 'string') { try { ea = JSON.parse(ea); } catch (_) { ea = null; } }
  const legacyLvl = a.access_level === 'filing' ? 'filing' : 'view';
  const entLvl = id => (ea && ea.entities && ea.entities[String(id)]) ? ea.entities[String(id)] : (ea ? 'none' : legacyLvl);
  const perLvl = () => (ea && ea.personal) ? ea.personal : 'none';
  // Entities: prefer the in-memory list, else fetch.
  let ents = (window.ENTITIES || []).map(e => ({ id: e._dbId || e.id, name: e.name || e.business_name || 'Business' }));
  if (!ents.length) {
    try { const r = await fetch('/api/entities', { credentials: 'include' });
      if (r.ok) { const rows = await r.json(); ents = (rows || []).map(x => ({ id: x.id, name: (x.data && (x.data.name || x.data.business_name)) || x.name || 'Business' })); } } catch (_) {}
  }
  const _esc = (typeof esc === 'function') ? esc : (t => String(t == null ? '' : t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const opt = (v, cur) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + (v[0].toUpperCase() + v.slice(1)) + '</option>';
  const sel = (id, cur, kind) => '<select data-perm-kind="' + kind + '" data-perm-id="' + id + '" onchange="saveAccessMatrix()" class="finput" style="width:118px;font-size:12px;padding:5px 8px">' + opt('none', cur) + opt('view', cur) + opt('filing', cur) + '</select>';
  const rowHtml = (label, sub, control) => '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--bd);border-radius:8px"><div style="min-width:0"><div style="font-size:13px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + label + '</div>' + (sub ? '<div style="font-size:11px;color:var(--t3)">' + sub + '</div>' : '') + '</div>' + control + '</div>';
  let html = '';
  if (!ents.length) html += '<div style="font-size:12px;color:var(--t3)">No businesses yet.</div>';
  for (const e of ents) html += rowHtml(_esc(e.name), 'Business', sel(e.id, entLvl(e.id), 'entity'));
  html += rowHtml('Personal finances', 'Net worth, personal income &amp; accounts', sel('personal', perLvl(), 'personal'));
  wrap.innerHTML = html;
};

window.saveAccessMatrix = async function() {
  const wrap = document.getElementById('acc-perm-matrix');
  if (!wrap) return;
  const entities = {};
  let personal = 'none';
  wrap.querySelectorAll('select[data-perm-kind]').forEach(sl => {
    if (sl.getAttribute('data-perm-kind') === 'personal') personal = sl.value;
    else entities[sl.getAttribute('data-perm-id')] = sl.value;
  });
  try {
    const res = await fetch('/api/accountants/my-accountant/access', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ entity_access: { entities, personal } }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (linkedAccountant) { linkedAccountant.entity_access = data.entity_access; linkedAccountant.access_level = data.access_level; }
      if (typeof notify === 'function') notify('\u2713 Access updated');
    } else if (typeof notify === 'function') notify('\u26a0 ' + (data.error || 'Could not update access'));
  } catch (e) {
    if (typeof notify === 'function') notify('Could not update access — are you logged in?');
  }
};

window.revokeAccountant = async function() {
  if (!(await window._confirmModal('Are you sure you want to revoke this accountant\'s access?', {danger:true}))) return;
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

// ── Shared marketplace modal (rating + free-text). Returns a Promise that resolves to the collected
//    value, or null if cancelled. Replaces the removed prompt()/hardcoded stubs — the user's ACTUAL
//    input is captured (no more silent 5-star reviews or canned report reasons). ────────────────────
window._marketModal = function(opts){
  opts = opts || {};
  return new Promise(function(resolve){
    var done = false;
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
    var starsHtml = opts.rating ? '<div style="margin-bottom:14px"><div style="font-size:11px;color:var(--t2,#9a9278);margin-bottom:6px">Your rating</div><div id="mm-stars" style="display:flex;gap:6px;font-size:28px;line-height:1;cursor:pointer">'
      + [1,2,3,4,5].map(function(n){return '<span data-v="'+n+'" style="color:var(--t3,#5a5040);transition:color .1s">★</span>';}).join('') + '</div></div>' : '';
    var catHtml = (opts.categories && opts.categories.length) ? '<div style="margin-bottom:14px"><div style="font-size:11px;color:var(--t2,#9a9278);margin-bottom:6px">Category</div><select id="mm-cat" class="finput" style="width:100%">' + opts.categories.map(function(c){return '<option value="'+c.value+'">'+c.label+'</option>';}).join('') + '</select></div>' : '';
    ov.innerHTML = '<div style="background:var(--bg1,#16120d);border:1px solid var(--bd2,#3a3828);border-radius:12px;width:100%;max-width:420px;padding:22px">'
      + '<div style="font-family:var(--font-display,serif);font-style:italic;font-size:19px;color:var(--acc-light,#e4c97a);margin-bottom:4px">'+(opts.title||'')+'</div>'
      + (opts.subtitle ? '<div style="font-size:12px;color:var(--t2,#9a9278);margin-bottom:14px">'+opts.subtitle+'</div>' : '')
      + starsHtml
      + catHtml
      + '<textarea id="mm-text" class="finput" rows="4" placeholder="'+(opts.placeholder||'')+'" style="margin-bottom:14px;resize:vertical"></textarea>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end"><button id="mm-cancel" class="btn btn-ghost btn-sm">Cancel</button><button id="mm-ok" class="btn btn-primary btn-sm">'+(opts.okLabel||'Submit')+'</button></div></div>';
    document.body.appendChild(ov);
    var chosen = 0;
    if (opts.rating) {
      var wrap = ov.querySelector('#mm-stars');
      var paint = function(v){ wrap.querySelectorAll('span').forEach(function(s){ s.style.color = (parseInt(s.getAttribute('data-v'),10) <= v) ? 'var(--acc,#c8a44a)' : 'var(--t3,#5a5040)'; }); };
      wrap.querySelectorAll('span').forEach(function(s){
        s.onmouseenter = function(){ paint(parseInt(s.getAttribute('data-v'),10)); };
        s.onclick = function(){ chosen = parseInt(s.getAttribute('data-v'),10); paint(chosen); };
      });
      wrap.onmouseleave = function(){ paint(chosen); };
    }
    var close = function(val){ if(done) return; done = true; try{ov.remove();}catch(e){} resolve(val); };
    ov.querySelector('#mm-cancel').onclick = function(){ close(null); };
    ov.onclick = function(e){ if(e.target===ov) close(null); };
    ov.querySelector('#mm-ok').onclick = function(){
      var text = (ov.querySelector('#mm-text').value || '').trim();
      if (opts.rating && !chosen) { if(typeof notify==='function') notify('Please pick a star rating.', true); return; }
      if (opts.requireText && !text) { if(typeof notify==='function') notify('Please add a few words.', true); return; }
      var _catEl = ov.querySelector('#mm-cat');
      close({ rating: chosen, text: text, category: _catEl ? _catEl.value : null });
    };
    setTimeout(function(){ var t = ov.querySelector('#mm-text'); if(t) t.focus(); }, 30);
  });
};

// ── 5b. REPORT ACCOUNTANT ────────────────────────────────────────────────────
window.reportAccountant = async function(accountantId, name) {
  const res = await window._marketModal({
    title: 'Report ' + (name || 'this accountant'),
    subtitle: 'Tell us what went wrong. Our team reviews reports within 24 hours.',
    categories: [
      { value: 'service',  label: 'Poor or incomplete service' },
      { value: 'billing',  label: 'Billing / overcharging dispute' },
      { value: 'conduct',  label: 'Unprofessional conduct' },
      { value: 'privacy',  label: 'Data or privacy concern' },
      { value: 'other',    label: 'Something else' },
    ],
    placeholder: 'Describe the issue…', requireText: true, okLabel: 'Submit report',
  });
  if (!res) return;
  fetch('/api/accountants/report', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountantId, reason: res.text, category: res.category }),
  }).then(r => r.json()).then(data => {
    if(typeof notify==='function') notify(data.error || '✓ Report submitted — our team will review within 24 hours');
  }).catch(() => {
    if(typeof notify==='function') notify('Could not submit report');
  });
};

// ── 5c. LEAVE REVIEW (shown in My Accountant page after payment) ─────────────
window.leaveReview = async function(accountantId) {
  if (!accountantId) { if(typeof notify==='function') notify('No accountant linked'); return; }
  const res = await window._marketModal({
    title: 'Review your accountant',
    subtitle: 'Your honest rating helps other businesses choose.',
    rating: true, placeholder: 'Share a few words about your experience (optional)…', okLabel: 'Submit review',
  });
  if (!res) return;
  fetch('/api/accountants/review', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountantId, rating: res.rating, comment: res.text }),
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

// Boot — wait for auth before fetching directory or my-accountant
window.addEventListener('ff:authed', function(){ loadDirectory(); }, {once:true});

})();
}); // end load listener
