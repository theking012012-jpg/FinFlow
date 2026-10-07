
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
  set('lbl-salary', window._fmtMoneyNative(salary));
  set('lbl-churn', (churn*100).toFixed(1)+'%');
  set('lbl-invest', window._fmtMoneyNative(invest));
  set('lbl-efficiency', (efficiency>=0?'+':'')+Math.round(efficiency*100)+'%');

  const projRev = Math.round(BASE.rev * (1 + revGrowth) * (1 - churn));
  const addSalaries = headcount * salary;
  const projExp = Math.round((BASE.exp + addSalaries + invest) * (1 - efficiency));
  const projProfit = projRev - projExp;
  const newBurn = Math.max(0, Math.round((projExp - projRev/12)/12));
  // F-J2: cash runway is meaningless when cash isn't tracked (BASE.cash≈0) — show "N/A" instead of a
  // misleading "0 mo". -1 = not applicable; 99 = infinite (no burn).
  const runway = !(BASE.cash > 0) ? -1 : (newBurn > 0 ? Math.round(BASE.cash / newBurn) : 99);

  // F124: was `const S = v => window._fmtMoney(v, '$')` — a LOCAL S shadowing the global money
  // renderer inside this function, so every scenario figure carried a hardcoded '$' regardless of
  // the entity's currency. The shadow is deleted rather than edited (class C4: a second formatter
  // is the thing that drifts). Scenario figures project from BASE, which is native and never
  // FX-converted — and on a stale basis besides (F44) — so the NATIVE symbol is the honest one.
  const S = v => window._fmtMoneyNative(v);
  const delta = (now, base) => {
    const d = now-base;
    const col = d>=0?'var(--green)':'var(--red)';
    return `<span style="color:${col}">${d>=0?'▲':'▼'} ${S(Math.abs(d))}</span>`;
  };

  set('sc-rev', S(projRev));
  set('sc-exp', S(projExp));
  set('sc-profit', S(projProfit));
  set('sc-runway', runway===-1 ? 'N/A' : runway===99?'∞ mo':runway+' mo');
  { const _rc=document.getElementById('sc-runway-chg'); if(_rc) _rc.textContent = runway===-1 ? 'Cash not tracked' : 'At current burn'; }
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
              // F124: native symbol — cashData projects from BASE.cash, never FX-converted. Matches
              // the sc-* cards this chart sits under.
              y:{grid:{color:'rgba(200,164,74,.05)'},ticks:{color:'#5a4e3a',font:{size:9},callback:v=>window._fmtMoneyNativeAbbr(v)}}}}
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
// Auto-categorise — REAL data only. Uncategorised = expenses with no category or 'Other'.
const AUTOCAT_CATS = ['Software & SaaS','Travel','Meals & Entertainment','Office Supplies','Salaries','Marketing','Professional Services','Rent','Utilities','Insurance','Bank Transfer','Cost of Goods','Other'];
let _autocatSuggest = {};   // expense_id -> { category, confidence, source }  (from rules/AI)
let _autocatApplied = 0;    // categorised this session (real writes)

function _autocatUncat(){ return (window._realExpenses || []).filter(e => !e.category || e.category === 'Other'); }
function _autocatCats(){
  const used = [...new Set((window._realExpenses||[]).map(e=>e.category).filter(c=>c && c!=='Other'))];
  return [...new Set([...used, ...AUTOCAT_CATS])];
}
// Confidence colour — input is a real 0..1 fraction from the AI, not a fabricated %.
function confColor(f){ return f>=0.9?'var(--green)':f>=0.7?'var(--amber)':'var(--red)'; }

async function renderAutocat(){
  const list = document.getElementById('autocat-list');
  if(!list) return;
  // Ensure real expenses are loaded before deciding the queue is empty.
  if(!Array.isArray(window._realExpenses)){
    try{ const eid=(window.ENTITIES||[]).find(e=>e.active)?._dbId; const er=await fetch('/api/expenses'+(eid?'?entity_id='+eid:''),{credentials:'include'}); if(er.ok) window._realExpenses=await er.json()||[]; }catch(_){ window._realExpenses=window._realExpenses||[]; }
  }
  const rows = _autocatUncat();
  const cats = _autocatCats();
  const pc = document.getElementById('autocat-pending-count'); if(pc) pc.textContent = rows.length;
  const ac = document.getElementById('autocat-approved-count'); if(ac) ac.textContent = _autocatApplied;

  list.innerHTML = rows.length ? rows.map(e=>{
    const sug = _autocatSuggest[e.id];
    const selected = sug?.category || 'Other';
    const hasConf = sug && typeof sug.confidence === 'number';
    const pct = hasConf ? Math.round(sug.confidence*100) : null;
    const confHtml = hasConf
      ? `<div class="autocat-conf"><div class="autocat-conf-bar"><div class="autocat-conf-fill" style="width:${pct}%;background:${confColor(sug.confidence)}"></div></div><span class="autocat-conf-pct">${pct}%</span></div>`
      : `<span class="autocat-conf-pct" style="width:auto;color:var(--t3)">${sug?(sug.source==='rule'?'rule':'—'):'—'}</span>`;
    return `<div class="autocat-row" id="acat-row-${e.id}">
      <div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.description||'(no description)')}</div></div>
      <div style="font-family:var(--font-mono);font-size:12px;color:var(--red);width:80px;text-align:right;flex-shrink:0">-$${Math.abs(parseFloat(e.amount)||0).toLocaleString()}</div>
      <div style="width:110px;flex-shrink:0">
        <select class="finput" id="acat-sel-${e.id}" style="font-size:11px;padding:3px 6px">
          ${cats.map(c=>`<option${c===selected?' selected':''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      ${confHtml}
      <div style="width:70px;flex-shrink:0;text-align:right"><button class="autocat-tag" onclick="approveCat(${e.id})">✓ Approve</button></div>
    </div>`;
  }).join('') : '<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">All expenses categorised ✓</div>';

  // Rules list — REAL rules only; honest empty state (no phantom fallback).
  const rulesList = document.getElementById('autocat-rules-list');
  if(rulesList){
    try{
      const res=await fetch('/api/autocat-rules',{credentials:'include'});
      const rules=res.ok?(await res.json()||[]):[];
      const rc=document.getElementById('autocat-rules-count'); if(rc) rc.textContent=rules.length;
      rulesList.innerHTML = rules.length ? rules.map(r=>`
        <div style="display:flex;align-items:center;gap:10px;padding:.5rem 0;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="font-family:var(--font-mono);color:var(--t1);flex:1">${esc(r.keyword||'')}</span>
          <span style="color:var(--t2)">→ ${esc(r.category||'')}</span>
          <span style="font-size:11px;color:var(--t3)">${r.enabled?'Auto-approve':'Review'}</span>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteAutocatRule(${r.id})">✕</button>
        </div>`).join('') : '<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12.5px">No rules yet — add one to auto-categorise matching transactions.</div>';
    }catch(e){
      rulesList.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12.5px">Could not load rules.</div>';
    }
  }
}
window.deleteAutocatRule=async function(id){
  if(!(await window._confirmModal('Delete this rule?', {danger:true})))return;
  const res=await fetch('/api/autocat-rules/'+id,{method:'DELETE',credentials:'include'});
  if(res.ok){ renderAutocat(); window.finflow?.refresh(['banking','dashboard']); }else notify('Delete failed');
};
window.runAutocatRules=async function(){
  try{
    const res=await fetch('/api/autocat-rules/run',{method:'POST',credentials:'include'});
    const data=await res.json();
    const n=data.updated||0;
    _autocatApplied += n;
    // Re-fetch expenses so the queue drops the rows the server just categorised.
    try{ const eid=(window.ENTITIES||[]).find(e=>e.active)?._dbId; const er=await fetch('/api/expenses'+(eid?'?entity_id='+eid:''),{credentials:'include'}); if(er.ok) window._realExpenses=await er.json()||window._realExpenses; }catch(_){ }
    notify('Auto-categorised '+n+' expense'+(n!==1?'s':'')+' ✦');
    renderAutocat();
    window.finflow?.refresh(['expenses','dashboard']);
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

// Approve — writes the chosen category to the REAL expense.
window.approveCat = async function(id){
  const sel = document.getElementById('acat-sel-'+id);
  const category = sel ? sel.value : null;
  if(!category){ notify('Pick a category first',true); return; }
  try{
    const res = await fetch('/api/expenses/'+id,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({category})});
    if(!res.ok){ const d=await res.json().catch(()=>({})); notify(d.error||'Could not apply',true); return; }
    delete _autocatSuggest[id];
    _autocatApplied++;
    const e=(window._realExpenses||[]).find(x=>x.id===id); if(e) e.category=category;   // drop from queue
    const row=document.getElementById('acat-row-'+id);
    if(row){ row.style.opacity='0'; row.style.transition='opacity .25s'; }
    setTimeout(()=>{ renderAutocat(); window.finflow?.refresh(['expenses','dashboard']); },260);
    notify('Categorised as '+category+' ✦');
  }catch(e){ notify('Could not apply — '+e.message,true); }
};
// Approve all — applies each row's selected category to its real expense.
window.approveAllAutocat = async function(){
  const rows=_autocatUncat();
  if(!rows.length){ notify('Nothing to categorise'); return; }
  let applied=0;
  for(const e of rows){
    const sel=document.getElementById('acat-sel-'+e.id);
    const category=sel?sel.value:null;
    if(!category) continue;
    try{
      const res=await fetch('/api/expenses/'+e.id,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({category})});
      if(res.ok){ const ex=(window._realExpenses||[]).find(x=>x.id===e.id); if(ex) ex.category=category; delete _autocatSuggest[e.id]; applied++; }
    }catch(err){ }
  }
  _autocatApplied+=applied;
  renderAutocat();
  window.finflow?.refresh(['expenses','dashboard']);
  notify('Categorised '+applied+' expense'+(applied!==1?'s':'')+' ✦');
};
// Suggest with AI — rules-first + cached + capped batched Haiku (server endpoint).
window.runAutocatAI = async function(){
  const btn=document.getElementById('autocat-ai-btn');
  if(btn){ btn.disabled=true; btn.textContent='Analysing…'; }
  try{
    const res=await fetch('/api/autocat-rules/ai-suggest',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await res.json().catch(()=>({}));
    // Apply any suggestions the server DID return (rules/cache come back even on 402/502).
    (data.suggestions||[]).forEach(s=>{ _autocatSuggest[s.expense_id]={category:s.category,confidence:s.confidence,source:s.source}; });
    if(res.status===402){ notify(data.error||'Monthly AI limit reached — upgrade for unlimited',true); }
    else if(res.status===502){ notify(data.error||'AI categorisation isn’t enabled yet',true); }
    else if(!res.ok){ notify(data.error||'AI suggestion failed',true); }
    else{
      const n=(data.counts&&data.counts.ai)||0;
      notify(n>0 ? ('AI suggested '+n+' categor'+(n!==1?'ies':'y')+(data.capped?' — monthly limit reached for the rest':'')+' ✦') : 'No new AI suggestions needed');
    }
  }catch(e){ notify('AI suggestion failed — '+e.message,true); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='✦ Suggest with AI'; } }
  renderAutocat();
};

// ══════════════════════════════════════════════════════════════════
// CLIENT PORTAL
// ══════════════════════════════════════════════════════════════════
// Honesty pass (F51/F65): the interactive Client Portal (PORTALS list,
// renderPortal, createPortal, copyPortalLink) was dead — the Client Portal page
// is a "Coming Soon" placeholder with no #portal-list element, so renderPortal
// bailed and createPortal had no caller. Its "Email sent ✦" / "Portal created ✦"
// toasts and the fabricated portal.finflow.io links are removed so they cannot be
// re-exposed. The page keeps its honest "Coming Soon" card.

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
  // Business investment positions are real, entity-scoped DB rows loaded into
  // window.bizHoldings (loadBizHoldingsFromDB below). This is also the canonical source
  // for the business dashboard's Investments card (d-invest) + its F34 conversion, so the
  // personal `window.holdings` never leaks onto the business card.
  window.bizHoldings = window.bizHoldings || [];

  // ── Status pill helpers ────────────────────────────────────────
  function setLiveStatus(pageId, state, text){
    const id = 'live-status-' + pageId;
    let el = document.getElementById(id);
    if(!el) return;
    const dot = el.querySelector('.live-dot');
    const lbl = el.querySelector('.live-label');
    if(dot) dot.style.background = state === 'live'     ? 'var(--green)' :
                                    state === 'updating' ? 'var(--amber,#e0a500)' :
                                    state === 'err'      ? 'var(--red)'   : 'var(--t3)';
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

  // ── Symbol resolution — the quote APIs need an exchange TICKER (MSFT, BTC), but investors type
  // company / coin NAMES ("Microsoft", "Bitcoin") or wrong symbols. Unresolved → no live price, which
  // read as "the feed is broken" when it wasn't. Resolve NAME→TICKER: a built-in map for the common
  // stocks + every supported crypto, a plain-ticker passthrough, then the /api/symbol-search fallback.
  // Cached per raw string so an unknown name is searched at most once per session.
  var NAME2TICKER = {
    MICROSOFT:'MSFT', APPLE:'AAPL', TESLA:'TSLA', AMAZON:'AMZN', GOOGLE:'GOOGL', ALPHABET:'GOOGL',
    META:'META', FACEBOOK:'META', NVIDIA:'NVDA', NETFLIX:'NFLX', WALMART:'WMT', DISNEY:'DIS',
    'COCA COLA':'KO', 'COCA-COLA':'KO', PEPSI:'PEP', PEPSICO:'PEP', INTEL:'INTC',
    'ADVANCED MICRO DEVICES':'AMD', ORACLE:'ORCL', SALESFORCE:'CRM', ADOBE:'ADBE', PAYPAL:'PYPL',
    VISA:'V', MASTERCARD:'MA', JPMORGAN:'JPM', 'JP MORGAN':'JPM', 'JPMORGAN CHASE':'JPM', BOEING:'BA',
    NIKE:'NKE', STARBUCKS:'SBUX', MCDONALDS:'MCD', "MCDONALD'S":'MCD', UBER:'UBER', AIRBNB:'ABNB',
    SHOPIFY:'SHOP', SPOTIFY:'SPOT', 'BERKSHIRE HATHAWAY':'BRK.B',
    // crypto NAMES → the symbols the quote proxy's CRYPTO_IDS understands
    BITCOIN:'BTC', ETHEREUM:'ETH', SOLANA:'SOL', CARDANO:'ADA', RIPPLE:'XRP', DOGECOIN:'DOGE',
    POLKADOT:'DOT', POLYGON:'MATIC', LITECOIN:'LTC', CHAINLINK:'LINK', AVALANCHE:'AVAX',
    UNISWAP:'UNI', COSMOS:'ATOM', STELLAR:'XLM', ALGORAND:'ALGO', TETHER:'USDT', 'USD COIN':'USDC',
    TRON:'TRX', 'BITCOIN CASH':'BCH', 'SHIBA INU':'SHIB', BINANCE:'BNB'
  };
  var _symResolveCache = {};
  // type: 'crypto' routes the search fallback to CoinGecko (~15k coins); anything else → Finnhub
  // (stocks/ETFs — including metal ETFs like GLD/SLV). The built-in map is only a fast-path, never
  // the ceiling: unknown names fall through to the live search so coverage is the provider's, not a list.
  async function resolveSymbol(raw, type){
    var s = String(raw||'').trim().toUpperCase();
    if(!s || s==='CASH') return s || null;
    var isCrypto = String(type||'').toLowerCase() === 'crypto';
    var ck = (isCrypto?'C|':'S|') + s;
    if(Object.prototype.hasOwnProperty.call(_symResolveCache, ck)) return _symResolveCache[ck];
    if(NAME2TICKER[s]) return (_symResolveCache[ck] = NAME2TICKER[s]);
    // Already a plausible ticker (letters, up to ~5 chars, optional .A/-B suffix) → use as-is. For crypto
    // the ticker IS the symbol (BTC, PEPE) — the server resolves it to a CoinGecko id dynamically.
    if(/^[A-Z0-9]{1,6}([.\-][A-Z0-9]{1,4})?$/.test(s)) return (_symResolveCache[ck] = s);
    // A longer / multi-word name → ask the keyed search proxy (crypto→CoinGecko, else Finnhub).
    try{
      var r = await fetch('/api/symbol-search?q='+encodeURIComponent(raw)+(isCrypto?'&type=crypto':''), { credentials:'include', signal: AbortSignal.timeout(8000) });
      var j = await r.json().catch(function(){ return {}; });
      return (_symResolveCache[ck] = (j && j.symbol ? String(j.symbol).toUpperCase() : null));
    }catch(e){ return (_symResolveCache[ck] = null); }
  }
  window._ffResolveSymbol = resolveSymbol;   // exposed for tests

  // ── Stock price fetch via server-side proxy (/api/stock-price) ───
  // Avoids CORS errors and Edge tracking-prevention blocks from direct
  // Yahoo Finance or allorigins.win calls in the browser.
  async function fetchQuote(ticker, type){
    const sym = await resolveSymbol(ticker, type);
    if(!sym || sym === 'CASH') throw new Error('Unresolved symbol: ' + ticker);
    const isCrypto = String(type||'').toLowerCase() === 'crypto';
    const cacheKey = (isCrypto?'C:':'S:') + sym;
    const cached = window.getCachedQuote && window.getCachedQuote(cacheKey);
    if(cached) return Object.assign({}, cached, { ticker });   // key the result by the holding's own ticker

    const res = await fetch(`/api/stock-price?symbol=${encodeURIComponent(sym)}${isCrypto?'&type=crypto':''}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if(d.price == null) throw new Error('No price for ' + ticker + ' (resolved ' + sym + ')');
    const result = {
      ticker,                 // original holding ticker, so applyQuotes maps it back
      resolved:     sym,      // the exchange symbol actually quoted
      price:        d.price,
      prevClose:    d.prevClose ?? d.price,
      dayChange:    d.dayChange ?? 0,
      dayChangePct: d.dayChangePct ?? 0,
      dividend:     d.dividend ?? 0,
    };
    if(window.setCachedQuote) window.setCachedQuote(cacheKey, result);
    return result;
  }

  async function fetchQuotes(tickers, typeMap){
    // Fetch all in parallel; individual failures return null (graceful degradation).
    // typeMap: { TICKER: 'crypto' } so each quote routes to the right provider.
    typeMap = typeMap || {};
    const results = await Promise.all(
      tickers.map(t => fetchQuote(t, typeMap[t]).catch(() => null))
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
      if(!q){
        // No live quote AND not cash → the symbol didn't resolve/quote. Flag it so the row can say
        // "check ticker" rather than silently showing cost basis as if it were a live price.
        if(String(h.ticker||'').toUpperCase() !== 'CASH') h._noQuote = true;
        return;
      }
      h.price    = q.price;
      h.dayChgPx = q.dayChange;
      h._resolved = q.resolved || h.ticker;
      h._noQuote = false;
      if(q.dividend > 0) h.div = q.dividend;
      (window._lastLive || (window._lastLive = {}))[h.ticker] = { price:q.price, dayChange:q.dayChange, resolved:q.resolved||h.ticker, dividend:q.dividend||0 };
      updated++;
    });
    if(updated > 0) window._invLive = true;   // in-memory PERSONAL holdings now carry LIVE prices
    return updated;
  }

  // ── Re-apply this session's last-known LIVE quotes to a freshly (re)loaded holdings array, so an
  // entity switch or post-mutation reload keeps live prices instead of flashing the stored DB price.
  // In-memory only (the app is DB-only / zero-localStorage) — a cold page load has no seed and simply
  // shows the loading state until the market refresh lands.
  function _reseedLive(arr, scope){
    const cache = window._lastLive || {};
    let seeded = 0;
    (arr||[]).forEach(h => {
      const q = cache[h.ticker];
      if(!q) return;
      h.price = q.price; h._resolved = q.resolved || h.ticker; h._noQuote = false;
      if(scope === 'biz') h._dayChg = q.dayChange; else h.dayChgPx = q.dayChange;
      if(q.dividend > 0) h.div = q.dividend;
      seeded++;
    });
    if(seeded > 0){ if(scope === 'biz') window._bizInvLive = true; else window._invLive = true; }
    return seeded;
  }
  window._reseedLive = _reseedLive;   // the personal holdings loader (bundle) calls this

  // ── Render the BUSINESS portfolio (#biz-inv-holdings-list) from window.bizHoldings ─
  // Entity-scoped DB rows (DB shape: id/ticker/name/type/shares/cost/price/div/color).
  // Includes Edit/✕ per row (calls the same editHolding/deleteHolding used by personal).
  function renderBizInvestments(){
    const list = document.getElementById('biz-inv-holdings-list');
    if(!list) return;
    const hs = window.bizHoldings || [];
    const bizEl = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val; };
    const S2b = n => (window._fmtMoney ? window._fmtMoney(n, '$') : '$'+Math.round(n).toLocaleString());
    if(!hs.length){
      list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--t3)">No holdings yet — click + Add holding to get started</div>';
      ['biz-inv-total','biz-inv-gain','biz-inv-daychg'].forEach(id => bizEl(id,'$0'));
      bizEl('biz-inv-income','$0/yr');
      // F155: this render OWNS the business Performance box. It used to be written only by the
      // PERSONAL renderInvestments (app-main.js) from personal holdings — a cross-wire that showed
      // the personal cost basis on the business page, identical across every entity.
      { const pp=document.getElementById('biz-perf-port'); const ps=document.getElementById('biz-perf-summary');
        if(pp){ pp.textContent='—'; pp.style.color='var(--t3)'; }
        if(ps) ps.textContent='No holdings yet — add positions to see performance.'; }
      return;
    }
    const palette=['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a4e3a'];
    let totalValue=0, totalCost=0, totalIncome=0, totalDayChg=0, totalGain=0, haveDay=false;
    const rows = hs.map((h,i) => {
      const shares  = parseFloat(h.shares)||0;
      const price   = parseFloat(h.price)||parseFloat(h.cost)||0;
      const costPer = parseFloat(h.cost)||0;
      const val=price*shares, cost=costPer*shares, gl=val-cost;
      const inc=(parseFloat(h.div)||0)*shares;
      if(typeof h._dayChg==='number'){ totalDayChg+=h._dayChg*shares; haveDay=true; }
      totalValue+=val; totalCost+=cost; totalGain+=gl; totalIncome+=inc;
      const pos=gl>=0; const glPct=cost>0?(gl/cost*100).toFixed(1):'0.0';
      const color=h.color||palette[i%palette.length];
      const sym3=esc((h.ticker||'').slice(0,3));
      return `<div style="display:grid;grid-template-columns:36px 1fr 90px 80px 75px 75px 80px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
        <div style="width:30px;height:30px;border-radius:7px;background:${color}22;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${color}">${sym3}</div>
        <div>
          <div style="font-weight:500;color:var(--t1)">${esc(h.ticker)}${h._noQuote?' <span title="No live price — check the ticker symbol (e.g. enter MSFT, not Microsoft; BTC, not Bitcoin)" style="color:var(--amber,#e0a500);font-size:10px;font-weight:600">⚠ check ticker</span>':((h._resolved&&h._resolved!==String(h.ticker||'').toUpperCase())?` <span title="Quoted as ${esc(h._resolved)}" style="color:var(--t3);font-size:10px">→ ${esc(h._resolved)}</span>`:'')}</div>
          <div style="font-size:11px;color:var(--t3)">${esc(h.type||'Stock')} · ${esc(String(shares))} units</div>
        </div>
        <div style="text-align:right;font-family:var(--font-mono);color:${h._noQuote?'var(--t3)':'var(--t1)'}" title="${h._noQuote?'Cost basis — no live price':'Live price'}">$${price.toFixed(2)}</div>
        <div style="text-align:right;font-family:var(--font-mono);color:var(--t1)">${window._fmtMoney(val,'$')}</div>
        <div style="text-align:right;font-family:var(--font-mono);color:var(--t3)">${window._fmtMoney(cost,'$')}</div>
        <div style="text-align:right;font-family:var(--font-mono);color:${pos?'var(--green)':'var(--red)'}">${pos?'+':''}${glPct}%</div>
        <div style="text-align:right;font-family:var(--font-mono);color:var(--teal)">
          ${inc>0?window._fmtMoney(inc,'$'):'—'}
          ${h.id!=null?`<div style="margin-top:3px;display:flex;gap:4px;justify-content:flex-end">
            <button class="btn btn-ghost" style="padding:1px 7px;font-size:10px" title="Edit holding" onclick="event.stopPropagation();editHolding(${h.id})">Edit</button>
            <button class="btn btn-ghost" style="padding:1px 6px;font-size:10px;color:var(--red)" title="Remove holding" onclick="event.stopPropagation();deleteHolding(${h.id})">✕</button>
          </div>`:''}
        </div>
      </div>`;
    });
    list.innerHTML = rows.join('');
    const bizChg=(id,txt,cls)=>{ const e=document.getElementById(id); if(e){e.textContent=txt;e.className='mc-change '+cls;} };
    // Don't paint STORED (entry-time) prices as a live portfolio value on a cold load. On a fresh boot
    // (`_invBootPending`, set by init() and cleared when the first refresh finishes) show a neutral
    // loading state until a live quote lands (`_bizInvLive`). `bizNeedsQuote` keeps an all-cash book
    // instant; income (dividends) is stored data so it renders regardless. The flag is only set by the
    // real boot, so direct render calls (tests, mid-session nav) paint values immediately.
    const bizNeedsQuote = hs.some(h => String(h.ticker||'').toUpperCase() !== 'CASH');
    const bizLoading = bizNeedsQuote && window._invBootPending && !window._bizInvLive;
    if(bizLoading){
      ['biz-inv-total','biz-inv-gain','biz-inv-daychg'].forEach(id => bizEl(id,'—'));
      bizEl('biz-inv-income', S2b(totalIncome)+'/yr');
      bizChg('biz-inv-total-chg', 'Fetching live prices…', 'neutral');
      bizChg('biz-inv-gain-chg',  'Fetching live prices…', 'neutral');
      bizChg('biz-inv-daychg-chg', '', 'neutral');
      const pp=document.getElementById('biz-perf-port'); const ps=document.getElementById('biz-perf-summary');
      if(pp){ pp.textContent='—'; pp.style.color='var(--t3)'; pp.style.fontWeight='600'; }
      if(ps) ps.textContent='Fetching live prices…';
      return;
    }
    bizEl('biz-inv-total',  S2b(totalValue));
    bizEl('biz-inv-gain',   (totalGain>=0?'+':'')+S2b(totalGain));
    bizEl('biz-inv-income', S2b(totalIncome)+'/yr');
    bizEl('biz-inv-daychg', haveDay?((totalDayChg>=0?'+':'')+S2b(totalDayChg)):'—');
    // F-E2: populate the business asset-allocation bars (were static $0). Classify each holding by type.
    (function(){
      let _eq=0,_fi=0,_re=0,_csh=0;
      hs.forEach(h=>{
        const v=(parseFloat(h.price)||0)*(parseFloat(h.shares)||0);
        const t=String(h.type||'').toLowerCase(), tk=String(h.ticker||'').toUpperCase();
        if(tk==='CASH'||t==='cash') _csh+=v;
        else if(/bond|fixed|treasur|note|bill|gilt/.test(t)) _fi+=v;
        else if(/reit|real\s*estate|property/.test(t)) _re+=v;
        else _eq+=v;   // stock / etf / crypto / default → equities
      });
      const _tot=(_eq+_fi+_re+_csh)||1;
      const _setA=(vId,bId,amt)=>{ const ve=document.getElementById(vId), be=document.getElementById(bId);
        if(ve) ve.textContent=S2b(amt); if(be) be.style.setProperty('width', Math.round(amt/_tot*100)+'%','important'); };
      _setA('biz-alloc-eq','biz-alloc-eq-bar',_eq); _setA('biz-alloc-fi','biz-alloc-fi-bar',_fi);
      _setA('biz-alloc-re','biz-alloc-re-bar',_re); _setA('biz-alloc-cash','biz-alloc-cash-bar',_csh);
    })();
    const gainPos=totalGain>=0;
    const gainPct=totalCost>0?(totalGain/totalCost*100).toFixed(1):'0.0';
    const dayPct=(haveDay&&totalValue>0)?(totalDayChg/totalValue*100).toFixed(2):'0.00';
    bizChg('biz-inv-total-chg', (gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% all time', gainPos?'up':'dn');
    bizChg('biz-inv-gain-chg',  (gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% return',   gainPos?'up':'dn');
    if(haveDay) bizChg('biz-inv-daychg-chg', (totalDayChg>=0?'▲ ':'▼ ')+Math.abs(dayPct)+'% today', totalDayChg>=0?'up':'dn');
    else bizChg('biz-inv-daychg-chg', 'Builds after 1 day', 'neutral');
    // F155: business Performance box from BUSINESS data (was cross-wired to personal renderInvestments).
    { const pp=document.getElementById('biz-perf-port'); const ps=document.getElementById('biz-perf-summary');
      if(pp){ pp.textContent=(gainPos?'+':'')+Math.abs(parseFloat(gainPct))+'%'; pp.style.color=gainPos?'var(--green)':'var(--red)'; pp.style.fontWeight='600'; }
      if(ps) ps.textContent='Unrealised '+(gainPos?'gain':'loss')+': '+(gainPos?'+':'')+S2b(totalGain)+' on '+S2b(totalCost)+' cost basis.'; }
  }

  // Apply live quotes into window.bizHoldings, then repaint.
  function applyBizQuotes(quotes){
    let updated = 0;
    (window.bizHoldings||[]).forEach(h => {
      const q = quotes[h.ticker];
      if(!q){
        if(String(h.ticker||'').toUpperCase() !== 'CASH') h._noQuote = true;
        return;
      }
      h.price = q.price;
      h._dayChg = q.dayChange;
      h._resolved = q.resolved || h.ticker;
      h._noQuote = false;
      if(q.dividend > 0) h.div = q.dividend;
      (window._lastLive || (window._lastLive = {}))[h.ticker] = { price:q.price, dayChange:q.dayChange, resolved:q.resolved||h.ticker, dividend:q.dividend||0 };
      updated++;
    });
    if(updated > 0) window._bizInvLive = true;   // in-memory BUSINESS holdings now carry LIVE prices
    renderBizInvestments();
  }

  // Load entity-scoped business holdings from the DB (scope=business → active entity).
  async function loadBizHoldingsFromDB(entityId){
    try{
      // F154: accept an explicit entity_id so an entity SWITCH reloads the RIGHT portfolio without
      // depending on session timing. The server resolves a no-entity_id ?scope=business against the
      // ACTIVE entity (server.js:744) — which, mid-switch, is the entity we just left, i.e. the leak.
      // No arg → active entity (unchanged for boot / page-nav / post-mutation refresh paths).
      const _u = '/api/holdings?scope=business' + (entityId != null ? '&entity_id=' + encodeURIComponent(entityId) : '');
      const res = await fetch(_u, { credentials:'include' });
      if(!res.ok) throw new Error('HTTP '+res.status);
      const rows = await res.json();
      window.bizHoldings = (rows||[]).map(r => ({
        _dbId:r.id, id:r.id, ticker:r.ticker, name:r.name, type:r.asset_type,
        shares:r.shares, cost:r.cost_per, price:r.price, div:r.dividend, color:r.color,
      }));
      // Fresh DB rows carry the STORED (entry-time) price, not the live market price. Drop the live
      // flag so the KPI cards don't flash that stale figure, then re-seed from any live quote still
      // held in memory this session (warm cache → a switch/reload stays live with no flash).
      window._bizInvLive = false;
      if(window._reseedLive) window._reseedLive(window.bizHoldings, 'biz');
      renderBizInvestments();
      if(window._kickMarketRefresh) window._kickMarketRefresh();   // pull fresh quotes promptly (cold view / new ticker)
      if(typeof window._refreshDashboardUI === 'function') window._refreshDashboardUI();
    }catch(err){ console.warn('[BizHoldings]', err.message); }
  }

  // Repaint the CORRECT portfolio + dashboard after a mutation (add/edit/delete).
  window._refreshHoldings = function(scope){
    if(scope === 'business') loadBizHoldingsFromDB();
    else if(typeof window._loadHoldingsFromDB === 'function') window._loadHoldingsFromDB();
    if(typeof window._refreshDashboardUI === 'function') window._refreshDashboardUI();
  };
  window._loadBizHoldingsFromDB = loadBizHoldingsFromDB;
  window.renderBizInvestments   = renderBizInvestments;

  // ── Main refresh loop ──────────────────────────────────────────
  async function refreshAll(){
    // Collect all unique tickers (skip CASH — not exchange-traded) and note each one's asset class so
    // crypto routes to CoinGecko and cross-class ticker collisions (ARB stock vs Arbitrum coin) resolve.
    const typeMap = {};
    const noteType = h => { if(!h || !h.ticker || h.ticker==='CASH') return; if(/crypto/i.test(h.type||'')) typeMap[h.ticker] = 'crypto'; else if(!(h.ticker in typeMap)) typeMap[h.ticker] = ''; };
    holdings.forEach(noteType);
    (window.bizHoldings||[]).forEach(noteType);
    const personalTickers = holdings.map(h=>h.ticker).filter(t=>t!=='CASH');
    const bizTickers      = (window.bizHoldings||[]).map(h=>h.ticker).filter(t=>t && t!=='CASH');
    const allTickers      = [...new Set([...personalTickers, ...bizTickers])];

    ['investments','biz-investments'].forEach(id => setLiveStatus(id, 'loading', 'Fetching quotes…'));

    try {
      const quotes = await fetchQuotes(allTickers, typeMap);
      const now = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      const fetchedCount = Object.keys(quotes).length;
      const ok = fetchedCount > 0;

      // Personal
      if(ok){
        applyPersonalQuotes(quotes);
        if(typeof renderInvestments === 'function') renderInvestments();
        setLiveStatus('investments', 'live', `Live · ${now}`);
      } else {
        // No fresh quotes this pass (rate-limit window, or a transient miss) — we retry every 60s and
        // are still showing last-known values, so this is "Updating…", not an outage.
        setLiveStatus('investments', 'updating', 'Updating…');
      }

      // Business
      applyBizQuotes(quotes);
      setLiveStatus('biz-investments', ok ? 'live' : 'updating', ok ? `Live · ${now}` : 'Updating…');

      if(ok && fetchedCount < allTickers.length){
        const missed = allTickers.filter(t => !quotes[t]).join(', ');
        console.warn('[FinFlow] Could not fetch:', missed);
      }
    } catch(err){
      console.error('[FinFlow] Market data error:', err);
      ['investments','biz-investments'].forEach(id => setLiveStatus(id, 'updating', 'Updating…'));
    } finally {
      window._invBootPending = false;   // first refresh pass done — KPI cards may now paint values (live if we got them)
    }
  }

  // ── Bootstrap once DOM is ready ────────────────────────────────
  function init(){
    window._invBootPending = true;   // cold boot: hold KPI cards in a loading state until the first live refresh lands
    injectStatusPill('investments');
    injectStatusPill('biz-investments');
    loadBizHoldingsFromDB();          // load real entity-scoped business positions on boot
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
  // Debounced kick so boot / entity-switch / mutation reloads coalesce into ONE prompt refresh
  // (the 55s in-memory quote cache dedupes the network side; this dedupes the calls).
  window._kickMarketRefresh = function(){ clearTimeout(window._mktKickT); window._mktKickT = setTimeout(function(){ try{ refreshAll(); }catch(_){} }, 150); };
})();

// Also wire up the biz-investments metric card IDs expected by applyBizQuotes
// (IDs are set in the HTML; this is a no-op safety guard)
