// ══════════════════════════════════════════════════════════════════
// NOTIFICATION CENTRE
// ══════════════════════════════════════════════════════════════════
const NOTIFS = []; // no hardcoded demo notifications — populated dynamically

const TYPE_COLORS = {warning:'var(--amber)',danger:'var(--red)',success:'var(--green)',info:'var(--acc)'};
const TYPE_BG = {warning:'rgba(200,160,70,.1)',danger:'rgba(184,96,80,.1)',success:'rgba(106,170,106,.1)',info:'rgba(200,164,74,.08)'};

function renderNotifs(){
  const list = document.getElementById('notif-list');
  if(!list) return;
  const unreadCount = NOTIFS.filter(n=>n.unread).length;
  const badge = document.getElementById('notif-badge');
  const countLabel = document.getElementById('notif-count-label');
  if(badge){ badge.textContent = unreadCount; badge.style.display = unreadCount>0?'flex':'none'; }
  if(countLabel) countLabel.textContent = unreadCount>0?`${unreadCount} unread`:'All caught up';

  list.innerHTML = NOTIFS.map(n=>`
    <div class="notif-item${n.unread?' unread':''}" onclick="handleNotifClick(${n.id})">
      <div class="notif-item-icon" style="background:${TYPE_BG[n.type]};color:${TYPE_COLORS[n.type]}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${n.icon}</svg>
      </div>
      <div style="flex:1;min-width:0">
        <div class="notif-item-title">${n.title}</div>
        <div class="notif-item-sub">${n.sub}</div>
        <div class="notif-item-time">${n.time}</div>
      </div>
      ${n.unread?`<div style="width:7px;height:7px;border-radius:50%;background:var(--acc);flex-shrink:0;margin-top:4px"></div>`:''}
    </div>`).join('');
}

window.toggleNotifPanel = function(){
  const p = document.getElementById('notif-panel');
  if(p) p.classList.toggle('open');
  renderNotifs();
};
window.handleNotifClick = function(id){
  const n = NOTIFS.find(x=>x.id===id);
  if(!n) return;
  n.unread = false;
  renderNotifs();
  if(n.action){ n.action(); toggleNotifPanel(); }
};
window.markAllRead = function(){ NOTIFS.forEach(n=>n.unread=false); renderNotifs(); notify('All notifications marked as read ✦'); };
window.clearAllNotifs = function(){ NOTIFS.splice(0); renderNotifs(); toggleNotifPanel(); notify('Notifications cleared ✦'); };

// Show badge on load
requestAnimationFrame(renderNotifs);

// ══════════════════════════════════════════════════════════════════
// SCENARIO MODELLER
// ══════════════════════════════════════════════════════════════════
window.BASE = { rev: 0, exp: 0, cash: 0, burn: 0 };

window.updateScenario = function(){
  const revGrowth = parseFloat(document.getElementById('sl-rev-growth')?.value||0)/100;
  const headcount = parseInt(document.getElementById('sl-headcount')?.value||0);
  const salary = parseInt(document.getElementById('sl-salary')?.value||0)*1000;
  const churn = parseFloat(document.getElementById('sl-churn')?.value||0)/100;
  const invest = parseInt(document.getElementById('sl-invest')?.value||0)*1000;
  const efficiency = parseFloat(document.getElementById('sl-efficiency')?.value||0)/100;

  const set = (id,v)=>{ const el=document.getElementById(id); if(el)el.textContent=v; };
  set('lbl-rev-growth', (revGrowth>=0?'+':'')+Math.round(revGrowth*100)+'%');
  set('lbl-headcount', headcount+' hire'+(headcount===1?'':'s'));
  set('lbl-salary', '$'+Math.round(salary/1000)+'K');
  set('lbl-churn', (churn*100).toFixed(1)+'%');
  set('lbl-invest', '$'+Math.round(invest/1000)+'K');
  set('lbl-efficiency', (efficiency>=0?'+':'')+Math.round(efficiency*100)+'%');

  const projRev = Math.round(BASE.rev * (1 + revGrowth) * (1 - churn));
  const addSalaries = headcount * salary;
  const projExp = Math.round((BASE.exp + addSalaries + invest) * (1 - efficiency));
  const projProfit = projRev - projExp;
  const newBurn = Math.max(0, Math.round((projExp - projRev/12)/12));
  const runway = newBurn > 0 ? Math.round(BASE.cash / newBurn) : 99;

  const S = v => '$'+(Math.abs(v)>=1000?((v/1000).toFixed(0)+'K'):(v));
  const delta = (now, base) => {
    const d = now-base;
    const col = d>=0?'var(--green)':'var(--red)';
    return `<span style="color:${col}">${d>=0?'▲':'▼'} ${S(Math.abs(d))}</span>`;
  };

  set('sc-rev', S(projRev));
  set('sc-exp', S(projExp));
  set('sc-profit', S(projProfit));
  set('sc-runway', runway===99?'∞ mo':runway+' mo');
  set('sc-rev-chg', (revGrowth>=0?'+':'')+Math.round(revGrowth*100)+'% growth');
  set('sc-profit-chg', Math.round(projProfit/projRev*100)+'% margin');

  set('sc-r-rev', S(projRev));
  set('sc-r-profit', S(projProfit));
  set('sc-r-runway', runway===99?'∞':runway+' mo');
  document.getElementById('sc-r-rev-d').innerHTML = delta(projRev, BASE.rev);
  document.getElementById('sc-r-profit-d').innerHTML = delta(projProfit, BASE.rev-BASE.exp);
  // Baseline runway = current cash ÷ current monthly burn (no hardcoded 14)
  const baseRunway = BASE.burn > 0 ? Math.round(BASE.cash / BASE.burn) : 0;
  const _runDelta = runway === 99 ? '<span style="color:var(--green)">∞</span>' : (runway - baseRunway >= 0 ? '<span style="color:var(--green)">▲ ' : '<span style="color:var(--red)">▼ ') + Math.abs(runway - baseRunway) + ' mo</span>';
  document.getElementById('sc-r-runway-d').innerHTML = _runDelta;

  renderScenarioChart(projRev, projExp);
};

let scenarioChartInst = null;
function renderScenarioChart(projRev, projExp){
  const canvas = document.getElementById('scenarioChart');
  if(!canvas || typeof Chart === 'undefined') return;
  const months = ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12'];
  const cashData = months.map((_,i)=>{
    const net = (projRev - projExp)/12;
    return Math.round(BASE.cash + net*(i+1));
  });
  if(scenarioChartInst){ scenarioChartInst.destroy(); }
  const dm = document.documentElement.classList.contains('light');
  scenarioChartInst = new Chart(canvas, {
    type:'line',
    data:{ labels:months, datasets:[{
      label:'Cash balance',data:cashData,
      borderColor:'var(--acc)',backgroundColor:'rgba(200,164,74,0.07)',
      tension:0.4,fill:true,pointRadius:2,borderWidth:2
    }]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{grid:{color:'rgba(200,164,74,.05)'},ticks:{color:'#5a4e3a',font:{size:9}}},
              y:{grid:{color:'rgba(200,164,74,.05)'},ticks:{color:'#5a4e3a',font:{size:9},callback:v=>'$'+(v/1000).toFixed(0)+'K'}}}}
  });
}

window.applyPreset = function(preset){
  document.querySelectorAll('.scenario-preset-btn').forEach(b=>b.classList.remove('active-preset'));
  document.getElementById('preset-'+preset)?.classList.add('active-preset');
  const presets = {
    base:{revGrowth:0,headcount:0,salary:0,churn:0,invest:0,efficiency:0},
    hire:{revGrowth:25,headcount:2,salary:110,churn:1.8,invest:0,efficiency:0},
    growth:{revGrowth:60,headcount:4,salary:95,churn:1.2,invest:50,efficiency:5},
    downturn:{revGrowth:-15,headcount:0,salary:95,churn:8,invest:0,efficiency:10},
  };
  const p = presets[preset];
  if(!p) return;
  const set = (id,v)=>{ const el=document.getElementById(id); if(el)el.value=v; };
  set('sl-rev-growth',p.revGrowth); set('sl-headcount',p.headcount); set('sl-salary',p.salary);
  set('sl-churn',p.churn); set('sl-invest',p.invest); set('sl-efficiency',p.efficiency);
  updateScenario();
};

window.getScenarioAI = function(){
  const revGrowth = document.getElementById('sl-rev-growth')?.value||18;
  const headcount = document.getElementById('sl-headcount')?.value||0;
  const churn = document.getElementById('sl-churn')?.value||1.8;
  const invest = document.getElementById('sl-invest')?.value||0;
  const text = document.getElementById('sc-r-profit')?.textContent||'';
  const aiText = document.getElementById('scenario-ai-text');
  if(aiText){ aiText.textContent='Analysing scenario with Claude…'; aiText.style.color='var(--t3)'; }
  openAIPanel&&openAIPanel();
  sendAIQuery&&sendAIQuery(`Scenario analysis: revenue growth ${revGrowth}%, ${headcount} new hires, churn ${churn}%, $${invest}K one-time investment. Projected 12-month profit: ${text}. Give me a specific recommendation — should I proceed? What are the top 3 risks?`);
};

// ══════════════════════════════════════════════════════════════════
// AUTO-CATEGORISATION
// ══════════════════════════════════════════════════════════════════
const AUTOCAT_TXNS = [
  {id:1,desc:'GOOGLE CLOUD PLATFORM',amt:-1840,cat:'Software & SaaS',conf:98,approved:false},
  {id:2,desc:'UNITED AIRLINES 0162948',amt:-2400,cat:'Travel',conf:97,approved:false},
  {id:3,desc:'WHOLE FOODS MARKET #142',amt:-340,cat:'Meals & Entertainment',conf:91,approved:false},
  {id:4,desc:'GITHUB INC.',amt:-84,cat:'Software & SaaS',conf:99,approved:false},
  {id:5,desc:'ZOOM VIDEO COMMUNICATIONS',amt:-149,cat:'Software & SaaS',conf:99,approved:false},
  {id:6,desc:'MARRIOTT HOTELS INTL',amt:-890,cat:'Travel',conf:95,approved:false},
  {id:7,desc:'STAPLES #1004',amt:-210,cat:'Office Supplies',conf:88,approved:false},
  {id:8,desc:'XERO SOFTWARE',amt:-69,cat:'Software & SaaS',conf:96,approved:false},
  {id:9,desc:'ACH TRANSFER OUT',amt:-5000,cat:'Bank Transfer',conf:72,approved:false},
  {id:10,desc:'PAYPAL *FREELANCER0219',amt:-1200,cat:'Professional Services',conf:84,approved:false},
  {id:11,desc:'AMAZON WEB SERVICES',amt:-3420,cat:'Software & SaaS',conf:99,approved:false},
  {id:12,desc:'COFFEE BEAN & TEA LEAF',amt:-45,cat:'Meals & Entertainment',conf:93,approved:false},
];

const AUTOCAT_RULES = [
  {pattern:'GOOGLE *',cat:'Software & SaaS',auto:true},
  {pattern:'AMAZON WEB *',cat:'Software & SaaS',auto:true},
  {pattern:'AIRLINES *',cat:'Travel',auto:true},
  {pattern:'MARRIOTT *',cat:'Travel',auto:false},
  {pattern:'PAYROLL *',cat:'Salaries',auto:true},
];

function confColor(c){ return c>=95?'var(--green)':c>=80?'var(--amber)':'var(--red)'; }

async function renderAutocat(){
  const list = document.getElementById('autocat-list');
  if(!list) return;
  const pending = AUTOCAT_TXNS.filter(t=>!t.approved);
  const approved = AUTOCAT_TXNS.filter(t=>t.approved).length;
  const pc = document.getElementById('autocat-pending-count');
  const ac = document.getElementById('autocat-approved-count');
  if(pc) pc.textContent = pending.length;
  if(ac) ac.textContent = approved;

  list.innerHTML = pending.map(t=>`
    <div class="autocat-row" id="acat-row-${t.id}">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.desc}</div>
      </div>
      <div style="font-family:var(--font-mono);font-size:12px;color:var(--red);width:80px;text-align:right;flex-shrink:0">-$${Math.abs(t.amt).toLocaleString()}</div>
      <div style="width:110px;flex-shrink:0">
        <select class="finput" style="font-size:11px;padding:3px 6px" onchange="overrideCat(${t.id},this.value)">
          ${['Software & SaaS','Travel','Meals & Entertainment','Office Supplies','Salaries','Marketing','Professional Services','Bank Transfer','Other'].map(c=>`<option${c===t.cat?' selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="autocat-conf">
        <div class="autocat-conf-bar"><div class="autocat-conf-fill" style="width:${t.conf}%;background:${confColor(t.conf)}"></div></div>
        <span class="autocat-conf-pct">${t.conf}%</span>
      </div>
      <div style="width:70px;flex-shrink:0;text-align:right">
        <button class="autocat-tag" onclick="approveCat(${t.id})">✓ Approve</button>
      </div>
    </div>`).join('') || '<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">All transactions categorised ✓</div>';

  const rulesList = document.getElementById('autocat-rules-list');
  if(rulesList){
    try{
      const res=await fetch('/api/autocat-rules',{credentials:'include'});
      const apiRules=res.ok?await res.json():[];
      const rules=apiRules.length?apiRules:AUTOCAT_RULES;
      rulesList.innerHTML=rules.map(r=>`
        <div style="display:flex;align-items:center;gap:10px;padding:.5rem 0;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="font-family:var(--font-mono);color:var(--t1);flex:1">${r.keyword||r.pattern||''}</span>
          <span style="color:var(--t2)">→ ${r.category||r.cat||''}</span>
          <span style="font-size:11px;color:var(--t3)">${(r.enabled||r.auto)?'Auto-approve':'Review'}</span>
          ${r.id?`<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteAutocatRule(${r.id})">✕</button>`:''}
        </div>`).join('');
    }catch(e){
      rulesList.innerHTML=AUTOCAT_RULES.map(r=>`
        <div style="display:flex;align-items:center;gap:10px;padding:.5rem 0;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="font-family:var(--font-mono);color:var(--t1);flex:1">${r.pattern}</span>
          <span style="color:var(--t2)">→ ${r.cat}</span>
          <span style="font-size:11px;color:var(--t3)">${r.auto?'Auto-approve':'Review'}</span>
        </div>`).join('');
    }
  }
}
window.deleteAutocatRule=async function(id){
  if(!confirm('Delete this rule?'))return;
  const res=await fetch('/api/autocat-rules/'+id,{method:'DELETE',credentials:'include'});
  if(res.ok){ renderAutocat(); window.finflow?.refresh(['banking','dashboard']); }else notify('Delete failed');
};
window.runAutocatRules=async function(){
  try{
    const res=await fetch('/api/autocat-rules/run',{method:'POST',credentials:'include'});
    const data=await res.json();
    notify('Auto-categorised '+(data.updated||0)+' expenses ✦');
    window.finflow?.refresh(['banking','dashboard']);
  }catch(e){notify('Run failed');}
};
window.openAddRuleModal=function(){
  let m=document.getElementById('add-rule-modal');
  if(!m){
    m=document.createElement('div');m.id='add-rule-modal';m.className='modal-overlay';
    m.innerHTML=`<div class="modal" style="width:380px">
      <div class="modal-header"><span class="modal-title">Add Categorisation Rule</span><button class="modal-close" onclick="closeModal('add-rule-modal')">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div><label class="field-label" for="rule-keyword">Keyword / Pattern</label><input id="rule-keyword" class="finput" placeholder="e.g. GOOGLE *"></div>
        <div><label class="field-label" for="rule-category">Category</label>
          <select id="rule-category" class="finput">${['Software & SaaS','Travel','Meals & Entertainment','Office Supplies','Salaries','Marketing','Professional Services','Other'].map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="rule-auto" checked><label for="rule-auto" style="font-size:13px;color:var(--t2)">Auto-approve matching transactions</label></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('add-rule-modal')">Cancel</button><button class="btn btn-primary" onclick="saveAutocatRule()">Save Rule</button></div>
    </div>`;
    document.body.appendChild(m);
  }
  document.getElementById('rule-keyword').value='';
  m.style.display='flex';
};
window.saveAutocatRule=async function(){
  const keyword=document.getElementById('rule-keyword').value.trim();
  const category=document.getElementById('rule-category').value;
  const enabled=document.getElementById('rule-auto').checked?1:0;
  if(!keyword){notify('Enter a keyword');return;}
  try{
    const res=await fetch('/api/autocat-rules',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({keyword,category,enabled})});
    if(!res.ok){const d=await res.json();notify(d.error||'Save failed');return;}
    closeModal('add-rule-modal');renderAutocat();window.finflow?.refresh(['banking','dashboard']);notify('Rule saved ✦');
  }catch(e){notify('Save failed');}
};

window.approveCat = function(id){
  const t = AUTOCAT_TXNS.find(x=>x.id===id);
  if(t){ t.approved=true; }
  const row = document.getElementById('acat-row-'+id);
  if(row){ row.style.opacity='0'; row.style.transition='opacity .25s'; setTimeout(()=>renderAutocat(),280); }
  notify('Transaction categorised ✦');
};
window.overrideCat = function(id,cat){ const t=AUTOCAT_TXNS.find(x=>x.id===id); if(t) t.cat=cat; };
window.approveAllAutocat = function(){
  AUTOCAT_TXNS.forEach(t=>t.approved=true);
  renderAutocat();
  notify('All transactions approved ✦');
};
window.getAutocatAI = function(){
  openAIPanel&&openAIPanel();
  sendAIQuery&&sendAIQuery('Re-analyse my uncategorised transactions and suggest better categories. Flag any that look like duplicates or unusual charges I should review.');
};

// ══════════════════════════════════════════════════════════════════
// CLIENT PORTAL
// ══════════════════════════════════════════════════════════════════
const PORTALS = []; // populated from DB

function renderPortal(){
  const list = document.getElementById('portal-list');
  if(!list) return;
  list.innerHTML = PORTALS.map(p=>`
    <div class="portal-card">
      <div style="width:36px;height:36px;border-radius:8px;background:var(--bg3);border:1px solid var(--bd2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--acc);flex-shrink:0">${p.client.slice(0,2).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--t1);margin-bottom:2px">${p.client}</div>
        <div style="font-size:11px;color:var(--t3)">Outstanding: <span style="color:${p.outstanding==='$0'?'var(--green)':'var(--amber)'}">${p.outstanding}</span> · Paid YTD: <span style="color:var(--t1)">${p.paidYTD}</span></div>
        <div style="font-size:10.5px;color:var(--t3);margin-top:2px">Last viewed: ${p.lastViewed}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
        <span class="portal-link-pill" style="width:auto;max-width:180px">portal.finflow.io/client/${p.slug}</span>
        <div style="display:flex;gap:5px">
          <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="copyPortalLink('${p.slug}')">Copy link</button>
          <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="notify('Email sent to ${p.client} ✦')">Send email</button>
        </div>
      </div>
    </div>`).join('');
}

window.copyPortalLink = function(slug){
  const url = 'https://portal.finflow.io/client/'+slug;
  navigator.clipboard?.writeText(url).catch(()=>{});
  notify('Portal link copied to clipboard ✦');
};
window.createPortal = function(){
  // TODO: Replace with modal text input — prompt() removed per audit Finding 34
  if(!confirm('Create a new client portal? You can rename it from the portal list.')) return;
  const clientName = 'New Client ' + (PORTALS.length + 1);
  if(!clientName||!clientName.trim()) return;
  const slug = clientName.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+Math.random().toString(36).slice(2,6);
  PORTALS.push({client:clientName.trim(),slug,outstanding:'$0',paidYTD:'$0',lastViewed:'Never',active:true});
  renderPortal();
  notify('Portal created for '+clientName.trim()+' ✦');
};

// ══════════════════════════════════════════════════════════════════
// PATCH showPage FOR NEW PAGES
// ══════════════════════════════════════════════════════════════════
const _spV15 = window.showPage;
window.showPage = function(id, el){
  _spV15(id, el);
  const names = {scenario:'Scenario planner',autocat:'Auto-categorise',portal:'Client portal','biz-investments':'Investments'};
  if(names[id]) document.getElementById('pageTitle').textContent = names[id];
  if(id==='scenario'){ requestAnimationFrame(()=>{ if(typeof window._syncScenarioBase==='function')window._syncScenarioBase(); updateScenario(); renderScenarioChart(BASE.rev||0,BASE.exp||0); }); }
  if(id==='autocat')  requestAnimationFrame(renderAutocat);
  if(id==='portal')   requestAnimationFrame(renderPortal);
  if(id==='notifications') toggleNotifPanel();
};

// Close notif panel on click outside
document.addEventListener('click', e=>{
  const panel = document.getElementById('notif-panel');
  const bell = document.getElementById('notif-bell');
  if(panel?.classList.contains('open') && !panel.contains(e.target) && !bell?.contains(e.target)){
    panel.classList.remove('open');
  }
});


// ══════════════════════════════════════════════════════════════════
// LIVE MARKET DATA
// Fetches real-time quotes from Yahoo Finance (no API key required).
// Updates both the personal and business investment portfolios.
// Retries on failure and refreshes every 60 seconds.
// ══════════════════════════════════════════════════════════════════
(function(){
  'use strict';

  // ── Ticker registries ──────────────────────────────────────────
  // Personal portfolio tickers come from the live `holdings` array.
  // Business portfolio tickers are declared here.
  const BIZ_HOLDINGS = [];
  const BIZ_STATIC = [];

  // ── Status pill helpers ────────────────────────────────────────
  function setLiveStatus(pageId, state, text){
    const id = 'live-status-' + pageId;
    let el = document.getElementById(id);
    if(!el) return;
    const dot = el.querySelector('.live-dot');
    const lbl = el.querySelector('.live-label');
    if(dot) dot.style.background = state === 'live' ? 'var(--green)' :
                                    state === 'err'  ? 'var(--red)'   : 'var(--t3)';
    if(lbl) lbl.textContent = text;
  }

  function injectStatusPill(pageId){
    // Inject a small "● Live · updated hh:mm" pill into the page topbar area
    const page = document.getElementById('page-' + pageId);
    if(!page || document.getElementById('live-status-' + pageId)) return;
    const pill = document.createElement('div');
    pill.id = 'live-status-' + pageId;
    pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--t3);padding:3px 8px;background:var(--bg2);border:1px solid var(--bd);border-radius:20px;margin-bottom:10px';
    pill.innerHTML = '<span class="live-dot" style="width:6px;height:6px;border-radius:50%;background:var(--t3);transition:background .3s;flex-shrink:0"></span><span class="live-label">Connecting…</span>';
    page.insertBefore(pill, page.firstChild);
  }

  // ── Stock price fetch via server-side proxy (/api/stock-price) ───
  // Avoids CORS errors and Edge tracking-prevention blocks from direct
  // Yahoo Finance or allorigins.win calls in the browser.
  async function fetchQuote(ticker){
    const cached = window.getCachedQuote && window.getCachedQuote(ticker);
    if(cached) return cached;

    const res = await fetch(`/api/stock-price?symbol=${encodeURIComponent(ticker)}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if(d.price == null) throw new Error('No price for ' + ticker);
    const result = {
      ticker,
      price:        d.price,
      prevClose:    d.prevClose ?? d.price,
      dayChange:    d.dayChange ?? 0,
      dayChangePct: d.dayChangePct ?? 0,
      dividend:     d.dividend ?? 0,
    };
    if(window.setCachedQuote) window.setCachedQuote(ticker, result);
    return result;
  }

  async function fetchQuotes(tickers){
    // Fetch all in parallel; individual failures return null (graceful degradation)
    const results = await Promise.all(
      tickers.map(t => fetchQuote(t).catch(() => null))
    );
    const map = {};
    results.forEach(r => { if(r) map[r.ticker] = r; });
    return map;
  }

  // ── Apply quotes to personal portfolio ─────────────────────────
  function applyPersonalQuotes(quotes){
    let updated = 0;
    holdings.forEach(h => {
      const q = quotes[h.ticker];
      if(!q) return;
      h.price    = q.price;
      h.dayChgPx = q.dayChange;
      if(q.dividend > 0) h.div = q.dividend;
      updated++;
    });
    return updated;
  }

  // ── Apply quotes to business portfolio & re-render ─────────────
  function applyBizQuotes(quotes){
    const list = document.getElementById('biz-inv-holdings-list');
    if(!list) return;

    let totalValue = BIZ_STATIC.reduce((s, r) => s + r.value, 0);
    let totalCost  = BIZ_STATIC.reduce((s, r) => s + r.value, 0); // cost ≈ value for static
    let totalIncome = BIZ_STATIC.reduce((s, r) => s + r.income, 0);
    let totalDayChg = 0;
    let totalGain   = 0;

    const rows = BIZ_HOLDINGS.map(h => {
      const q = quotes[h.ticker];
      const price  = q ? q.price    : (h._lastPrice || h.costPer);
      const dayChg = q ? q.dayChange : 0;
      if(q) h._lastPrice = price;
      const val   = price * h.shares;
      const cost  = h.costPer * h.shares;
      const gl    = val - cost;
      const div   = q?.dividend ?? 0;
      const inc   = div * h.shares;
      totalValue  += val;
      totalCost   += cost;
      totalGain   += gl;
      totalIncome += inc;
      totalDayChg += dayChg * h.shares;
      const pos = gl >= 0;
      const glPct = cost > 0 ? (gl / cost * 100).toFixed(1) : '0.0';
      const sym3 = esc(h.ticker.slice(0, 3));
      return `<div style="display:grid;grid-template-columns:36px 1fr 90px 80px 75px 75px 80px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
        <div style="width:30px;height:30px;border-radius:7px;background:${esc(h.color)}22;border:1px solid ${esc(h.color)}44;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${esc(h.color)}">${sym3}</div>
        <div>
          <div style="font-weight:500;color:var(--t1)">${esc(h.ticker)}</div>
          <div style="font-size:11px;color:var(--t3)">${esc(h.type)} · ${esc(String(h.shares))} units</div>
        </div>
        <div style="text-align:right;font-family:var(--font-mono);color:var(--t1)">$${price.toFixed(2)}</div>
        <div style="text-align:right;font-family:var(--font-mono);color:var(--t1)">$${(val/1000).toFixed(1)}K</div>
        <div style="text-align:right;font-family:var(--font-mono);color:var(--t3)">$${(cost/1000).toFixed(1)}K</div>
        <div style="text-align:right;font-family:var(--font-mono);color:${pos?'var(--green)':'var(--red)'}">
          ${pos?'+':''}${glPct}%
        </div>
        <div style="text-align:right;font-family:var(--font-mono);color:var(--teal)">${inc>0?'$'+(inc/1000).toFixed(1)+'K':'—'}</div>
      </div>`;
    });

    list.innerHTML = rows.join('');

    // Update metric cards
    function bizEl(id, val){ const e=document.getElementById(id); if(e) e.textContent=val; }
    const S2b = n => n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+(n/1e3).toFixed(1)+'K':'$'+Math.round(n).toLocaleString();
    bizEl('biz-inv-total',    S2b(totalValue));
    bizEl('biz-inv-gain',     (totalGain>=0?'+':'')+S2b(totalGain));
    bizEl('biz-inv-income',   S2b(totalIncome)+'/yr');
    bizEl('biz-inv-daychg',   (totalDayChg>=0?'+':'')+S2b(totalDayChg));

    const gainPos = totalGain >= 0;
    const gainPct = totalCost > 0 ? (totalGain/totalCost*100).toFixed(1) : '0.0';
    const dayPct  = totalValue > 0 ? (totalDayChg/totalValue*100).toFixed(2) : '0.00';
    function bizChg(id, txt, cls){ const e=document.getElementById(id); if(e){e.textContent=txt;e.className='mc-change '+cls;} }
    bizChg('biz-inv-total-chg',  (gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% all time',  gainPos?'up':'dn');
    bizChg('biz-inv-gain-chg',   (gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% return',    gainPos?'up':'dn');
    bizChg('biz-inv-daychg-chg', (totalDayChg>=0?'▲ ':'▼ ')+Math.abs(dayPct)+'% today', totalDayChg>=0?'up':'dn');
  }

  // ── Main refresh loop ──────────────────────────────────────────
  async function refreshAll(){
    // Collect all unique tickers (skip CASH — not exchange-traded)
    const personalTickers = holdings.map(h=>h.ticker).filter(t=>t!=='CASH');
    const bizTickers      = BIZ_HOLDINGS.map(h=>h.ticker);
    const allTickers      = [...new Set([...personalTickers, ...bizTickers])];

    ['investments','biz-investments'].forEach(id => setLiveStatus(id, 'loading', 'Fetching quotes…'));

    try {
      const quotes = await fetchQuotes(allTickers);
      const now = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      const fetchedCount = Object.keys(quotes).length;
      const ok = fetchedCount > 0;

      // Personal
      if(ok){
        applyPersonalQuotes(quotes);
        if(typeof renderInvestments === 'function') renderInvestments();
        setLiveStatus('investments', 'live', `Live · ${now}`);
      } else {
        setLiveStatus('investments', 'err', 'Offline · cached prices');
      }

      // Business
      applyBizQuotes(quotes);
      setLiveStatus('biz-investments', ok ? 'live' : 'err', ok ? `Live · ${now}` : 'Offline · cached prices');

      if(ok && fetchedCount < allTickers.length){
        const missed = allTickers.filter(t => !quotes[t]).join(', ');
        console.warn('[FinFlow] Could not fetch:', missed);
      }
    } catch(err){
      console.error('[FinFlow] Market data error:', err);
      ['investments','biz-investments'].forEach(id => setLiveStatus(id, 'err', 'Offline · cached prices'));
    }
  }

  // ── Bootstrap once DOM is ready ────────────────────────────────
  function init(){
    injectStatusPill('investments');
    injectStatusPill('biz-investments');
    refreshAll();
    setInterval(refreshAll, 60000); // refresh every 60 s
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual refresh (e.g. from AI panel)
  window.refreshMarketData = refreshAll;
})();

// Also wire up the biz-investments metric card IDs expected by applyBizQuotes
// (IDs are set in the HTML; this is a no-op safety guard)
