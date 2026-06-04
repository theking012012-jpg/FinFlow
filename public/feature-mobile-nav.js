// ── MOBILE BOTTOM NAV HELPER ────────────────────────────────────────────────
window.mobNavActive=function(id){
  document.querySelectorAll('.mob-nav-item').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById(id);
  if(el)el.classList.add('active');
};

// ── SWIPE GESTURE NAVIGATION ────────────────────────────────────────────────
(function(){
  const PAGES=['dashboard','banking','invoices','cashflow','budget','mrr'];
  let touchStartX=0,touchStartY=0,currentPageIdx=0;
  document.addEventListener('touchstart',e=>{touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;},{passive:true});
  document.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-touchStartX;
    const dy=Math.abs(e.changedTouches[0].clientY-touchStartY);
    if(Math.abs(dx)<60||dy>50)return;
    if(dx<0&&currentPageIdx<PAGES.length-1){currentPageIdx++;showPage(PAGES[currentPageIdx],null);}
    else if(dx>0&&currentPageIdx>0){currentPageIdx--;showPage(PAGES[currentPageIdx],null);}
  },{passive:true});
})();

// ── MULTI-ENTITY DATA & RENDERER ────────────────────────────────────────────
// Raw entity data in native currencies (USD, GBP, TTD)
window.ENTITIES=window.ENTITIES||[];
const ENTITIES=window.ENTITIES=[];

// ── Load real entities from API on boot ──────────────────────────
async function loadEntitiesFromDB(){
  try {
    const res = await fetch('/api/entities', {credentials:'include'});
    if(!res.ok) return;
    const rows = await res.json();
    // Sort by id — consistent order always
    rows.sort((a,b) => a.id - b.id);

    ENTITIES.length = 0;
    rows.forEach(e => ENTITIES.push({
      _dbId:    e.id,
      name:     e.name,
      tag:      e.tag || 'Entity',
      color:    e.color || '#c9a84c',
      currency: e.currency || 'USD',
      active:   e.is_active == 1 || e.is_active === true,
      data:     {rev:0,cogs:0,grossProfit:0,opex:0,netProfit:0},
    }));

    // If none active, activate first one
    if(ENTITIES.length && !ENTITIES.some(e=>e.active)) ENTITIES[0].active = true;

    // Sync businesses sidebar with real entities
    if(typeof businesses !== 'undefined'){
      businesses.length = 0;
      ENTITIES.forEach(e => businesses.push({
        id: 'biz-'+e._dbId,
        _dbId: e._dbId,
        name: e.name,
        industry: e.tag || 'Business',
        currency: e.currency || 'USD',
        color: e.color || '#c9a84c',
        active: e.active,
      }));
    }

    renderEntities();
    if(typeof renderBusinessSwitcher === 'function') renderBusinessSwitcher();

    // Update sidebar brand
    const active = ENTITIES.find(e=>e.active);
    const nameEl = document.getElementById('sb-brand-name');
    const badgeEl = document.getElementById('biz-currency-badge');
    if(active){
      if(nameEl) nameEl.textContent = active.name;
      if(badgeEl) badgeEl.textContent = active.currency + ' · Pro';
    } else {
      if(nameEl) nameEl.textContent = 'Create a business';
      if(badgeEl) badgeEl.textContent = '';
      // Highlight the + Add business button
      const addBizBtn = document.querySelector('#biz-menu button');
      if(addBizBtn){ addBizBtn.classList.remove('btn-ghost'); addBizBtn.classList.add('btn-primary'); }
      return;
    }

    // Activate in session FIRST, then load data
    const activeIdx = ENTITIES.findIndex(e=>e.active);
    if(activeIdx >= 0){
      const act = ENTITIES[activeIdx];
      if(act._dbId){
        const r = await fetch('/api/entities/'+act._dbId+'/activate',{method:'POST',credentials:'include'});
        if(!r.ok) console.warn('[Entities] Activate failed');
      }
      await loadEntityData(activeIdx);
    }

    // Bulk-load owner payroll for ALL entities so multi-entity Personal sync works.
    // We do this after entity activation so each fetch is scoped by entity_id.
    try {
      window.ownerPayrollByEntity = window.ownerPayrollByEntity || {};
      for (let i = 0; i < ENTITIES.length; i++) {
        if (i === activeIdx) continue; // already loaded
        const e = ENTITIES[i];
        if (!e?._dbId) continue;
        const pr = await fetch('/api/payroll?entity_id=' + e._dbId, {credentials:'include'});
        if (!pr.ok) continue;
        const rows = await pr.json();
        const ownerRow = (rows||[]).find(r=>r.is_owner);
        if (ownerRow) {
          window.ownerPayrollByEntity[i] = {
            _dbId:    ownerRow.id,
            fname:    ownerRow.fname,
            lname:    ownerRow.lname || '',
            role:     ownerRow.role || 'CEO / Founder',
            type:     ownerRow.emp_type || 'owner',
            gross:    parseFloat(ownerRow.gross) || 0,
            taxRate:  parseFloat(ownerRow.tax_rate) || 0,
            net:      Math.round((parseFloat(ownerRow.gross)||0)*(1-(parseFloat(ownerRow.tax_rate)||0)/100)),
            initials: ((ownerRow.fname||'')[0]+((ownerRow.lname||'')[0]||'')).toUpperCase(),
            avClass:  ownerRow.av_class || 'av-blue',
            currency: e.currency || 'USD',
            entityName: e.name || 'Entity',
            isOwner:  true,
          };
        }
      }
      ownerPayrollByEntity = window.ownerPayrollByEntity;
      // Sync Personal Finance one more time now that all entities are loaded
      if (typeof syncAllPayrollsToPersonal === 'function') {
        try { syncAllPayrollsToPersonal(); } catch(e) {}
      }
      console.log('[Entities] Bulk-loaded owner payroll for', Object.keys(window.ownerPayrollByEntity).length, 'entities');
    } catch (e) { console.warn('[Entities] Bulk payroll load failed:', e.message); }
  } catch(e){ console.warn('[Entities] Boot load failed:', e.message); }
}

// window.CURRENCIES is already set from the full CURRENCIES const above.

let consolCurrency = 'USD'; // default consolidation currency

function fxConvert(amount, fromCurrency, toCurrency){
  // Convert via USD as base
  const rates = window.CURRENCIES;
  if(!rates || !rates[fromCurrency] || !rates[toCurrency]) return amount;
  const inUSD = amount / rates[fromCurrency].rate;
  return inUSD * rates[toCurrency].rate;
}

function fmtConsol(valueUSD_native, fromCurrency){
  // Convert from native currency to consolCurrency
  const converted = fxConvert(valueUSD_native, fromCurrency, consolCurrency);
  const sym = (window.CURRENCIES[consolCurrency]||{symbol:'$'}).symbol;
  const abs = Math.abs(converted);
  return sym + (abs >= 1000 ? (abs/1000).toFixed(1)+'K' : Math.round(abs).toLocaleString());
}

function getConsolTotal(rowKey){
  // Sum all entities converted to consolCurrency
  return ENTITIES.reduce((sum, e) => {
    const val = e.data[rowKey] || 0;
    return sum + fxConvert(val, e.currency, consolCurrency);
  }, 0);
}

function fmtTotal(val){
  const sym = (window.CURRENCIES[consolCurrency]||{symbol:'$'}).symbol;
  const abs = Math.abs(val);
  return sym + (abs >= 1000 ? (abs/1000).toFixed(1)+'K' : Math.round(abs).toLocaleString());
}

const CONSOL_ROW_DEFS=[
  {label:'Revenue',     key:'rev',         color:'var(--green)'},
  {label:'Cost of goods',key:'cogs',       color:'var(--red)'},
  {label:'Gross profit',key:'grossProfit', color:'var(--acc)'},
  {label:'Operating exp.',key:'opex',      color:'var(--red)'},
  {label:'Net profit',  key:'netProfit',   color:'var(--green)'},
];

window.setConsolCurrency = function(code){
  consolCurrency = code;
  // Update selector UI
  document.querySelectorAll('.consol-cur-btn').forEach(b=>{
    b.classList.toggle('active-preset', b.dataset.code===code);
  });
  // Update rate label
  const rateEl = document.getElementById('consol-fx-rate');
  if(rateEl){
    const cur = window.CURRENCIES[code];
    if(cur && code !== 'USD'){
      rateEl.textContent = `1 USD = ${cur.rate.toFixed(cur.rate<1?4:cur.rate>100?0:2)} ${code}`;
    } else {
      rateEl.textContent = 'Base currency · no conversion';
    }
  }
  renderConsolPL();
};

function renderConsolPL(){
  const pl = document.getElementById('consol-pl');
  if(!pl) return;
  const cur = window.CURRENCIES[consolCurrency] || {symbol:'$'};
  const n = ENTITIES.length;
  const cols = n > 0 ? `1fr repeat(${n},80px) 90px` : '1fr 90px';

  // Update header with real entity names
  const hdr = document.getElementById('consol-pl-header');
  if(hdr){
    hdr.style.gridTemplateColumns = cols;
    hdr.innerHTML = '<span>Line</span>' +
      ENTITIES.map(e=>`<span style="text-align:right">${e.name}</span>`).join('') +
      '<span style="text-align:right">Consolidated</span>';
  }

  pl.innerHTML = CONSOL_ROW_DEFS.map(row=>{
    const entityVals = ENTITIES.map(e=>`
      <span style="text-align:right;color:var(--t2);font-family:var(--font-mono)">${fmtConsol(e.data[row.key], e.currency)}</span>`
    ).join('');
    const total = getConsolTotal(row.key);
    return `
      <div style="display:grid;grid-template-columns:${cols};gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);align-items:center;font-size:12px">
        <span style="color:var(--t1);font-weight:500">${row.label}</span>
        ${entityVals}
        <span style="text-align:right;font-family:var(--font-mono);font-weight:600;color:${total===0?'var(--t2)':row.color}">${fmtTotal(total)}</span>
      </div>`;
  }).join('');
}

window.renderEntities=function(){
  // Update entity count KPI card
  const cntEl=document.getElementById('ent-count');
  if(cntEl) cntEl.textContent=ENTITIES.length;

  // Update consolidated KPI cards
  const totalRev=getConsolTotal('rev');
  const totalProfit=getConsolTotal('netProfit');
  const consolMarginPct=totalRev>0?Math.round(totalProfit/totalRev*100):null;
  const revEl=document.getElementById('ent-consol-rev');
  if(revEl) revEl.textContent=fmtTotal(totalRev);
  const profEl=document.getElementById('ent-consol-profit');
  if(profEl) profEl.textContent=fmtTotal(totalProfit);
  const marginEl=document.getElementById('ent-consol-margin');
  if(marginEl) marginEl.textContent=consolMarginPct!==null?consolMarginPct+'% margin':'—';

  const el=document.getElementById('entity-list');
  if(el)el.innerHTML=ENTITIES.map((e,i)=>{
    const revConverted = fmtConsol(e.data.rev, e.currency);
    const margin = e.data.rev ? Math.round(e.data.netProfit/e.data.rev*100*10)/10 : null;
    return `
    <div class="entity-card${e.active?' active-entity':''}" onclick="switchEntity(${i})">
      <div class="entity-logo" style="background:${e.color}">${e.name.slice(0,2).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div class="entity-name">${e.name}</div>
        <div class="entity-meta">${e.currency} · <span class="entity-tag">${e.tag}</span></div>
      </div>
      <div class="entity-stat">
        <div class="entity-stat-val">${revConverted}</div>
        <div class="entity-stat-lbl">${margin!==null?'Revenue · '+margin+'% margin':'—'}</div>
      </div>
      ${e.active?`<span class="badge b-green" style="flex-shrink:0">Active</span>`:`<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();switchEntity(${i})">Switch</button>`}
    </div>`;
  }).join('');

  renderConsolPL();
};

window.switchEntity=async function(idx){
  ENTITIES.forEach((e,i)=>e.active=i===idx);
  const e=ENTITIES[idx];
  if(!e) return;

  // Update sidebar brand immediately
  const nameEl=document.getElementById('sb-brand-name');
  const badgeEl=document.getElementById('biz-currency-badge');
  if(nameEl) nameEl.textContent=e.name;
  if(badgeEl) badgeEl.textContent=e.currency+' · Pro';

  // Refresh entity list UI
  renderEntities();

  // MUST activate in session and wait for response before loading data
  if(e._dbId){
    try {
      const r = await fetch('/api/entities/'+e._dbId+'/activate',{method:'POST',credentials:'include'});
      if(!r.ok) console.warn('[Entity] Activate failed:', await r.text());
    } catch(err){ console.warn('[Entity] Activate error:', err.message); }
  }

  // Small pause to ensure session is committed server-side
  await new Promise(res => setTimeout(res, 100));

  // Load real data for this entity
  await loadEntityData(idx);

  notify('Switched to '+e.name+' ✦');
};

// Populate the "More…" dropdowns with all CURRENCIES keys
(function initConsolSelect(){
  const QUICK = ['USD','GBP','EUR','TTD'];
  // Consolidated P&L select
  const sel = document.getElementById('consol-more-select');
  // Personal finance select
  const psel = document.getElementById('pers-cur-more');
  if(window.CURRENCIES){
    Object.entries(window.CURRENCIES).forEach(([code,cur])=>{
      if(QUICK.includes(code)) return;
      if(sel){
        const opt = document.createElement('option');
        opt.value = code; opt.textContent = `${cur.flag} ${code} — ${cur.name}`;
        sel.appendChild(opt);
      }
      if(psel){
        const opt2 = document.createElement('option');
        opt2.value = code; opt2.textContent = `${cur.flag} ${code} — ${cur.name}`;
        psel.appendChild(opt2);
      }
    });
  }
})();

// ── TEAM & RBAC ─────────────────────────────────────────────────────────────
const TEAM=[];
const ROLE_LABELS={owner:'Owner',admin:'Admin',accountant:'Accountant',viewer:'Viewer'};
const ROLE_CLASSES={owner:'role-owner',admin:'role-admin',accountant:'role-accountant',viewer:'role-viewer'};
const PERMS=[
  {label:'View all reports',desc:'P&L, cash flow, balance sheet',o:true,a:true,ac:true,v:true},
  {label:'Create invoices',desc:'Draft, send & mark paid',o:true,a:true,ac:true,v:false},
  {label:'Manage expenses',desc:'Add, edit, delete expenses',o:true,a:true,ac:true,v:false},
  {label:'Run payroll',desc:'Execute payroll runs',o:true,a:true,ac:false,v:false},
  {label:'Manage team',desc:'Invite, remove, change roles',o:true,a:true,ac:false,v:false},
  {label:'Bank connections',desc:'Link & manage bank accounts',o:true,a:false,ac:false,v:false},
  {label:'Entity management',desc:'Add/remove business entities',o:true,a:false,ac:false,v:false},
  {label:'Audit log',desc:'View full change history',o:true,a:true,ac:true,v:false},
  {label:'API access',desc:'Generate API keys',o:true,a:false,ac:false,v:false},
];
window.renderTeam=function(){
  const tl=document.getElementById('team-list');
  const active=TEAM.filter(m=>m.lastSeen!=='Pending');
  const pending=TEAM.filter(m=>m.lastSeen==='Pending');
  const tc=document.getElementById('team-count');if(tc)tc.textContent=active.length;
  const tp=document.getElementById('team-pending');if(tp)tp.textContent=pending.length;
  if(tl){
    if(!TEAM.length){tl.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">No team members yet. Click + Invite to add someone.</div>';}
    else tl.innerHTML=TEAM.map(m=>`
    <div class="team-member-row">
      <div class="team-avatar" style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}44">${m.avatar}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</div>
        <div style="font-size:11px;color:var(--t3)">${m.email}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <span class="role-badge ${ROLE_CLASSES[m.role]}">${ROLE_LABELS[m.role]}</span>
        <span style="font-size:10px;color:var(--t3)">${m.lastSeen}</span>
      </div>
    </div>`).join('');
  }

  const pl=document.getElementById('perm-list');
  if(pl)pl.innerHTML=PERMS.map((p,pi)=>{
    const chk=(role,on,disabled)=>`<input type="checkbox" data-pi="${pi}" data-role="${role}" ${on?'checked':''} ${disabled?'disabled':''} onchange="window._onPermChange(this)" style="width:16px;height:16px;accent-color:var(--acc);cursor:${disabled?'default':'pointer'};margin:0 auto;display:block">`;
    return `<div class="perm-row" style="display:grid;grid-template-columns:1fr repeat(4,32px);gap:6px;align-items:center">
      <div><div class="perm-label">${p.label}</div><div class="perm-desc">${p.desc}</div></div>
      ${chk('o',p.o,true)}${chk('a',p.a,false)}${chk('ac',p.ac,false)}${chk('v',p.v,false)}
    </div>`;
  }).join('');
};
window._onPermChange=function(cb){
  const pi=parseInt(cb.dataset.pi);const role=cb.dataset.role;
  if(PERMS[pi])PERMS[pi][role]=cb.checked;
};
window.savePermissions=async function(){
  const state=PERMS.map(p=>({a:p.a,ac:p.ac,v:p.v}));
  try{
    await fetch('/api/permissions',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
    notify('Role permissions saved ✦');
  }catch(e){notify('Could not save permissions',true);}
};
(async function loadPermissions(){
  try{
    const res=await fetch('/api/permissions',{credentials:'same-origin'});
    if(!res.ok)return;
    const saved=await res.json();
    if(!saved||!Array.isArray(saved))return;
    saved.forEach((s,i)=>{if(PERMS[i]){if(s.a!=null)PERMS[i].a=!!s.a;if(s.ac!=null)PERMS[i].ac=!!s.ac;if(s.v!=null)PERMS[i].v=!!s.v;}});
  }catch(e){}
})();

// ── AUDIT TRAIL — all data from DB via /api/audit-log ──────────────────────
const AUDIT_EVENTS=[]; // intentionally empty — no hardcoded demo data
const ICON_SVG={
  receipt:'<rect x="2" y="1" width="12" height="14" rx="1.2"/><line x1="5" y1="5" x2="11" y2="5"/><line x1="5" y1="8" x2="9" y2="8"/>',
  dollar:'<circle cx="8" cy="8" r="6.5"/><path d="M8 5v6M6 9.5c0 .83.67 1.5 2 1.5s2-.67 2-1.5"/>',
  users:'<circle cx="5.5" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4.5 4.5-4.5"/><circle cx="11.5" cy="5" r="2.5"/><path d="M15 13c0-2.5-2-4.5-4.5-4.5"/>',
  user:'<circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6"/>',
  settings:'<circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
  check:'<polyline points="2,8 6,12 14,4"/>',
  grid:'<rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  trash:'<polyline points="2,4 14,4"/><path d="M5 4V2h6v2"/><rect x="3" y="4" width="10" height="10" rx="1"/>',
};

let auditFilter='all';
window.filterAudit=function(val){auditFilter=val;renderAudit();};
window.renderAudit=async function(){
  const el=document.getElementById('audit-list');
  if(!el)return;
  el.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Loading…</div>';
  try{
    const params=auditFilter!=='all'?'?type='+encodeURIComponent(auditFilter):'';
    const res=await fetch('/api/audit-log'+params,{credentials:'include'});
    if(!res.ok)throw new Error();
    const data=await res.json();
    const entries=Array.isArray(data)?data:(data.rows||data.entries||[]);
    if(!entries.length){el.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">No audit events yet.</div>';return;}
    el.innerHTML=entries.map(e=>`
      <div class="audit-row">
        <div class="audit-icon" style="background:var(--acc-bg);color:var(--acc)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><polyline points="8,5 8,8 10,10"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div><span class="audit-user">You</span> <span class="audit-action">${e.action||''}</span> <span class="audit-target">${e.table_name||''}${e.record_id?' #'+e.record_id:''}</span></div>
          <div class="audit-time">${e.created_at?new Date(e.created_at).toLocaleString():''}</div>
        </div>
      </div>`).join('');
    // Update KPI cards with real data
    (function(){
      const _set=(id,v)=>{const _e=document.getElementById(id);if(_e)_e.textContent=v;};
      _set('audit-event-count', entries.length);
      const _last=entries[0];
      if(_last){
        const _d=_last.created_at?new Date(_last.created_at):null;
        const _now=new Date();
        let _rel='—';
        if(_d){
          const _diff=Math.floor((_now-_d)/1000);
          if(_diff<60)_rel=_diff+'s ago';
          else if(_diff<3600)_rel=Math.floor(_diff/60)+'m ago';
          else if(_diff<86400)_rel=Math.floor(_diff/3600)+'h ago';
          else _rel=_d.toLocaleDateString();
        }
        _set('audit-last-time',_rel);
        _set('audit-last-action',(_last.action||'')+(_last.table_name?' · '+_last.table_name:''));
      }
    })();
  }catch(err){
    el.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Could not load audit log. Check your connection.</div>';
  }
};

// ── SWIPE HINT (show once on mobile) ────────────────────────────────────────
(function(){
  if(window.innerWidth<=768&&!sessionStorage.getItem('ff_swipe_shown')){
    setTimeout(()=>{
      const h=document.getElementById('swipe-hint');
      if(h){h.style.display='block';sessionStorage.setItem('ff_swipe_shown','1');}
    },2500);
  }
})();

// Add to command palette
const _extraCmds=[
  {group:'Navigate',icon:'<rect x="1" y="1" width="6" height="6" rx="1.2"/><rect x="9" y="1" width="6" height="6" rx="1.2"/><rect x="1" y="9" width="6" height="6" rx="1.2"/><rect x="9" y="9" width="6" height="6" rx="1.2"/>',label:'Entities',action:()=>showPage('entities',null)},
  {group:'Navigate',icon:'<circle cx="5.5" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4.5 4.5-4.5"/>',label:'Team & roles',action:()=>showPage('team',null)},
  {group:'Navigate',icon:'<rect x="2" y="2" width="12" height="12"/><polyline points="2,6 14,6"/><polyline points="8,2 8,6"/>',label:'Audit trail',action:()=>showPage('audit',null)},
  {group:'Actions',icon:'<circle cx="5.5" cy="5" r="2.5"/>',label:'Invite team member',action:()=>{showPage('team',null);setTimeout(()=>notify('Invite modal opening…'),200);}},
  {group:'Actions',icon:'<rect x="1" y="1" width="6" height="6" rx="1.2"/>',label:'Switch entity',action:()=>showPage('entities',null)},
  {group:'Actions',icon:'<rect x="2" y="1" width="12" height="14" rx="1.2"/><path d="M9 11l1.5 1.5 2.5-2.5"/>',label:'Scan receipt',action:()=>showPage('expenses',null)},
];
requestAnimationFrame(()=>{if(window.CMD_ITEMS)CMD_ITEMS.push(..._extraCmds);});

// ── PRICING PAGE ─────────────────────────────────────────────────────────────
(function(){

const PRO_FEATURES=[
  {text:'1 business entity',ok:true},
  {text:'Up to 3 team members',ok:true},
  {text:'Invoicing & quotes (up to 50/month)',ok:true},
  {text:'Expense tracking',ok:true},
  {text:'Stripe live feed',ok:true},
  {text:'Budget vs actuals',ok:true},
  {text:'50 AI queries / month',ok:true},
  {text:'Multi-currency',ok:true},
  {text:'Bank sync via Plaid',ok:false},
  {text:'AI receipt & invoice scanner',ok:false},
  {text:'MRR / SaaS dashboard',ok:false},
  {text:'Multi-entity accounting',ok:false},
  {text:'Full RBAC — 4 role tiers',ok:false},
  {text:'Unlimited AI queries',ok:false},
];

const BIZ_FEATURES=[
  {text:'Up to 5 entities (separate ledgers)',ok:true},
  {text:'Up to 15 team members',ok:true},
  {text:'Everything in Pro (unlimited invoices)',ok:true},
  {text:'MRR / SaaS dashboard',ok:true},
  {text:'Bank sync via Plaid',ok:true},
  {text:'AI receipt & invoice scanner',ok:true},
  {text:'Unlimited AI queries',ok:true},
  {text:'Full RBAC — 4 role tiers',ok:true},
  {text:'7-year audit trail',ok:true},
  {text:'Consolidated multi-entity P&L',ok:true},
  {text:'Budget variance tracking',ok:true},
  {text:'Priority email support',ok:true},
];

const ENT_FEATURES=[
  {text:'Unlimited entities',ok:true},
  {text:'Unlimited team members',ok:true},
  {text:'White-label (your branding)',ok:true},
  {text:'Dedicated account manager',ok:true},
  {text:'Custom AI context & prompts',ok:true},
  {text:'SSO / SAML integration',ok:true},
  {text:'SLA with 99.9% uptime guarantee',ok:true},
  {text:'Custom integrations & API',ok:true},
  {text:'On-premise deployment option',ok:true},
  {text:'Annual audit support',ok:true},
];

const COMPARE_ROWS=[
  {feature:'Pro plan price',ff:'$79/mo',qb:'$35/mo',xero:'$29/mo',fb:'$19/mo',ffWins:false},
  {feature:'Business plan price',ff:'$199/mo',qb:'$275/mo',xero:'$90/mo',fb:'$60/mo',ffWins:true},
  {feature:'Native AI assistant',ff:'✓ Claude (Business)',qb:'Limited',xero:'✗',fb:'✗',ffWins:true},
  {feature:'Multi-entity (same plan)',ff:'✓ Business',qb:'✗ Extra sub',xero:'✗ Extra org',fb:'✗',ffWins:true},
  {feature:'AI receipt scanner',ff:'✓ Business',qb:'Basic OCR',xero:'Basic OCR',fb:'✗',ffWins:true},
  {feature:'Live bank sync (Plaid)',ff:'✓ Business',qb:'✓',xero:'✓',fb:'Limited',ffWins:false},
  {feature:'7-year audit trail',ff:'✓ Business',qb:'✓',xero:'✓',fb:'✗',ffWins:false},
  {feature:'MRR / SaaS dashboard',ff:'✓ Business',qb:'✗',xero:'✗',fb:'✗',ffWins:true},
  {feature:'Budget variance tracking',ff:'✓ Pro & Business',qb:'Add-on',xero:'Limited',fb:'✗',ffWins:true},
  {feature:'Command palette',ff:'✓',qb:'✗',xero:'✗',fb:'✗',ffWins:true},
  {feature:'Annual discount',ff:'20% off',qb:'10% off',xero:'10% off',fb:'10% off',ffWins:true},
  {feature:'Free trial',ff:'14 days',qb:'30 days',xero:'30 days',fb:'30 days',ffWins:false},
];

const FAQ=[
  {q:'Can I switch plans at any time?',a:'Yes — upgrade or downgrade instantly. If you upgrade mid-cycle you\'re charged the prorated difference. Downgrades take effect at the next billing date.'},
  {q:'What happens to my data if I cancel?',a:'Your data is retained for 90 days after cancellation. You can export everything as CSV, PDF, or JSON at any point — including after cancelling.'},
  {q:'Is the 30-day trial really free?',a:'100%. No credit card required. You get full Business tier access for 30 days, then choose a plan or your account moves to read-only mode.'},
  {q:'Do you charge per entity on Business?',a:'No — Business includes up to 5 separate entities with fully independent ledgers, currencies, and chart of accounts. No per-entity fees.'},
  {q:'What AI model powers FinFlow AI?',a:'FinFlow uses Claude by Anthropic — one of the most capable AI models available. All AI runs through FinFlow backend — no API key needed on your end.'},
  {q:'Is my financial data secure?',a:'All data is encrypted at rest and in transit using industry-standard AES-256. FinFlow never sells or shares your data. AI features run entirely on FinFlow\'s own servers — you never need to provide an API key.'},
];

let isAnnual=false;

window.toggleBilling=function(){
  const cb=document.getElementById('billing-toggle');
  isAnnual=cb?cb.checked:!isAnnual;
  const pro=isAnnual?63:79;
  const biz=isAnnual?159:199;
  const proEl=document.getElementById('price-pro');
  const bizEl=document.getElementById('price-biz');
  const proSub=document.getElementById('price-pro-sub');
  const bizSub=document.getElementById('price-biz-sub');
  if(proEl)proEl.textContent='$'+pro;
  if(bizEl)bizEl.textContent='$'+biz;
  if(proSub)proSub.textContent=isAnnual?`$${pro*12}/yr · save $${(79-pro)*12}`:'Billed monthly';
  if(bizSub)bizSub.textContent=isAnnual?`$${biz*12}/yr · save $${(199-biz)*12}`:'Billed monthly';
};

function check(ok){
  return ok
    ?`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><polyline points="2,8 6,12 14,4"/></svg>`
    :`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--t3)" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
}

function renderFeatureList(id, items){
  const el=document.getElementById(id);
  if(!el)return;
  el.innerHTML=items.map(f=>`
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;color:${f.ok?'var(--t1)':'var(--t3)'}">
      <span style="flex-shrink:0">${check(f.ok)}</span>
      <span>${f.text}</span>
    </div>`).join('');
}

function renderCompareTable(){
  const body=document.getElementById('compare-table-body');
  if(!body)return;
  body.innerHTML=COMPARE_ROWS.map((r,i)=>`
    <tr style="border-bottom:1px solid var(--bd);${i%2===0?'':'background:rgba(255,255,255,.01)'}">
      <td style="padding:7px 8px;color:var(--t2)">${r.feature}</td>
      <td style="padding:7px 8px;text-align:center;background:var(--acc-bg);font-weight:${r.ffWins?'600':'400'};color:${r.ffWins?'var(--acc)':'var(--t1)'}">${r.ff}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--t2)">${r.qb}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--t2)">${r.xero}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--t2)">${r.fb}</td>
    </tr>`).join('');
}

function renderFAQ(){
  const el=document.getElementById('faq-list');
  if(!el)return;
  el.innerHTML=FAQ.map((f,i)=>`
    <div style="border-bottom:1px solid var(--bd);${i===FAQ.length-1?'border-bottom:none':''}">
      <div onclick="toggleFAQ(${i})" style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;cursor:pointer;user-select:none">
        <span style="font-size:13px;font-weight:500;color:var(--t1)">${f.q}</span>
        <svg id="faq-arr-${i}" width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="var(--t3)" stroke-width="1.5" stroke-linecap="round" style="flex-shrink:0;transition:transform .2s"><polyline points="2,3 5,7 8,3"/></svg>
      </div>
      <div id="faq-ans-${i}" style="display:none;font-size:12.5px;color:var(--t2);line-height:1.65;padding-bottom:.85rem">${f.a}</div>
    </div>`).join('');
}

window.toggleFAQ=function(i){
  const ans=document.getElementById('faq-ans-'+i);
  const arr=document.getElementById('faq-arr-'+i);
  if(!ans)return;
  const open=ans.style.display==='block';
  ans.style.display=open?'none':'block';
  if(arr)arr.style.transform=open?'':'rotate(180deg)';
};

function initPricing(){
  renderFeatureList('pro-features',PRO_FEATURES);
  renderFeatureList('biz-features',BIZ_FEATURES);
  renderFeatureList('ent-features',ENT_FEATURES);
  renderCompareTable();
  renderFAQ();
}

// Init on page load and when navigated to
requestAnimationFrame(initPricing);
const _spOld=window.showPage;
window.showPage=function(id,el){
  _spOld(id,el);
  if(id==='pricing'){document.getElementById('pageTitle').textContent='Plans & pricing';setTimeout(initPricing,80);}
};

})();
