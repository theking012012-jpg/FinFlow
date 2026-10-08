
// ── 1. COMMAND PALETTE ─────────────────────────────────────────────────────
const CMD_ITEMS = [
  {group:'Navigate', icon:'<polyline points="1,12 5,7 8.5,9.5 12,4 15,6"/><polyline points="12,4 15,4 15,7"/>', label:'Investments', action:()=>showPage('investments',null)},
  {group:'Navigate', icon:'<rect x="1" y="1" width="6.5" height="6.5" rx="1.2"/><rect x="8.5" y="1" width="6.5" height="6.5" rx="1.2"/><rect x="1" y="8.5" width="6.5" height="6.5" rx="1.2"/><rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1.2"/>', label:'Dashboard', action:()=>showPage('dashboard',null), kbd:'G D'},
  {group:'Navigate', icon:'<rect x="1" y="4" width="14" height="10" rx="1.2"/><line x1="1" y1="8" x2="15" y2="8"/>', label:'Banking / Plaid', action:()=>showPage('banking',null)},
  {group:'Navigate', icon:'<rect x="2" y="1" width="12" height="14" rx="1.2"/><line x1="5" y1="5" x2="11" y2="5"/>', label:'Invoices', action:()=>showPage('invoices',null), kbd:'G I'},
  {group:'Navigate', icon:'<rect x="1" y="10" width="3" height="5" rx="1"/><rect x="6" y="6" width="3" height="9" rx="1"/><rect x="11" y="2" width="3" height="13" rx="1"/>', label:'Budget', action:()=>showPage('budget',null)},
  {group:'Navigate', icon:'<path d="M1 12 Q4 4 8 7 Q11 10 15 3"/>', label:'MRR / SaaS', action:()=>showPage('mrr',null)},
  {group:'Navigate', icon:'<circle cx="6" cy="5" r="2.5"/><path d="M1 13c0-2.76 2.24-5 5-5"/><path d="M10 9l1.5 1.5L14 8"/>', label:'Payroll', action:()=>showPage('payroll',null)},
  {group:'Navigate', icon:'<circle cx="8" cy="8" r="2.5"/><line x1="8" y1="1" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="15"/>', label:'AI Insights', action:()=>showPage('ai',null)},
  {group:'Actions', icon:'<rect x="2" y="1" width="12" height="14" rx="1.2"/><path d="M5 8h6M8 5v6"/>', label:'New invoice', action:()=>{showPage('invoices',null);setTimeout(()=>window.openInvoiceModal&&openInvoiceModal(),200);}},
  {group:'Actions', icon:'<circle cx="8" cy="7" r="3"/><path d="M2 15c0-3.31 2.69-6 6-6s6 2.69 6 6"/>', label:'Add customer', action:()=>{showPage('customers',null);setTimeout(()=>window.openCustomerModal&&openCustomerModal(),200);}},
  {group:'Actions', icon:'<path d="M8 1v14M1 8h14"/>', label:'Run payroll', action:()=>notify('Running payroll simulation… ✦')},
  {group:'Actions', icon:'<polyline points="1,11 5,6 8,9 11,4 15,7"/>', label:'Export PDF report', action:()=>window.exportPDF&&exportPDF()},
  {group:'AI', icon:'<circle cx="8" cy="8" r="2.5"/><line x1="8" y1="1" x2="8" y2="3.5"/>', label:'Ask AI: forecast next quarter', action:()=>{openAIPanel();sendAIQuery('Forecast next quarter revenue and expenses');}},
  {group:'AI', icon:'<circle cx="8" cy="8" r="2.5"/><line x1="8" y1="1" x2="8" y2="3.5"/>', label:'Ask AI: explain expense spike', action:()=>{openAIPanel();sendAIQuery('Why did expenses spike last month?');}},
  {group:'AI', icon:'<circle cx="8" cy="8" r="2.5"/><line x1="8" y1="1" x2="8" y2="3.5"/>', label:'Ask AI: cash runway', action:()=>{openAIPanel();sendAIQuery('What is our current cash runway?');}},
  {group:'Settings', icon:'<circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>', label:'Settings', action:()=>showPage('settings',null), kbd:'G S'},
  {group:'Settings', icon:'<circle cx="8" cy="8" r="5"/><path d="M8 5v3l2 2"/>', label:'Toggle theme', action:()=>window.toggleTheme&&toggleTheme()},
];

let cmdSelected = 0;
let cmdFiltered = [];

function openCmdPalette(){
  document.getElementById('cmd-overlay').classList.remove('hidden');
  document.getElementById('cmd-input').value='';
  renderCmdItems('');
  setTimeout(()=>document.getElementById('cmd-input').focus(),50);
}
function closeCmdPalette(e){
  if(!e||e.target===document.getElementById('cmd-overlay')||e.type==='keydown')
    document.getElementById('cmd-overlay').classList.add('hidden');
}
function renderCmdItems(q){
  const container=document.getElementById('cmd-results');
  const lower=q.toLowerCase();
  cmdFiltered=q?CMD_ITEMS.filter(i=>i.label.toLowerCase().includes(lower)||i.group.toLowerCase().includes(lower)):CMD_ITEMS;
  cmdSelected=0;
  const groups={};
  cmdFiltered.forEach((item,idx)=>{
    if(!groups[item.group])groups[item.group]=[];
    groups[item.group].push({item,idx});
  });
  container.innerHTML=Object.entries(groups).map(([g,items])=>`
    <div class="cmd-group-label">${g}</div>
    ${items.map(({item,idx})=>`
      <div class="cmd-item${idx===0?' selected':''}" data-idx="${idx}" onclick="runCmdItem(${idx})">
        <div class="cmd-item-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg></div>
        <span class="cmd-item-label">${item.label}</span>
        ${item.kbd?`<span class="cmd-item-kbd">${item.kbd}</span>`:''}
      </div>`).join('')}
  `).join('');
}
function filterCmd(){
  renderCmdItems(document.getElementById('cmd-input').value);
}
function cmdKeyNav(e){
  if(e.key==='Escape'){closeCmdPalette(e);return;}
  if(e.key==='ArrowDown'){e.preventDefault();cmdSelected=Math.min(cmdSelected+1,cmdFiltered.length-1);}
  else if(e.key==='ArrowUp'){e.preventDefault();cmdSelected=Math.max(cmdSelected-1,0);}
  else if(e.key==='Enter'){e.preventDefault();runCmdItem(cmdSelected);return;}
  else return;
  document.querySelectorAll('.cmd-item').forEach((el,i)=>el.classList.toggle('selected',i===cmdSelected));
  document.querySelectorAll('.cmd-item')[cmdSelected]?.scrollIntoView({block:'nearest'});
}
window.runCmdItem=function(idx){
  if(cmdFiltered[idx]){cmdFiltered[idx].action();closeCmdPalette();}
};

// ── 2. AI CHAT PANEL ────────────────────────────────────────────────────────
let aiHistory = [];

function openAIPanel(){
  document.getElementById('ai-panel').classList.add('open');
}
function toggleAIPanel(){
  document.getElementById('ai-panel').classList.toggle('open');
}

let _aiQueryCount = 0;
window.sendAIQuery = async function(text){
  if(!text||!text.trim())return;
  text = sanitizeForAPI(text, 2000);
  if(currentUserPlan==='pro'&&_aiQueryCount>=50){
    if(typeof showUpgradeModal==='function') showUpgradeModal('ai_limit');
    return;
  }
  if(!apiRateLimit()){
    notify('Too many AI requests — please wait a moment before trying again.',true);
    return;
  }
  if(currentUserPlan==='pro') _aiQueryCount++;
  const input=document.getElementById('ai-input');
  input.value='';
  document.getElementById('ai-suggestions').style.display='none';

  const msgs=document.getElementById('ai-messages');
  const userMsg=document.createElement('div');
  userMsg.className='ai-msg ai-msg-user';
  userMsg.textContent=text;
  msgs.appendChild(userMsg);

  const thinkDiv=document.createElement('div');
  thinkDiv.className='ai-msg ai-msg-bot thinking';
  thinkDiv.innerHTML='<span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span>';
  msgs.appendChild(thinkDiv);
  msgs.scrollTop=msgs.scrollHeight;

  try{
    const res = await fetch('/api/ai', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: text, history: aiHistory})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Server error');
    const reply = data.reply || 'No response received.';
    aiHistory.push({role:'user',content:text},{role:'assistant',content:reply});
    if(aiHistory.length > 20) aiHistory = aiHistory.slice(-20);
    thinkDiv.className='ai-msg ai-msg-bot';
    thinkDiv.textContent=reply;
  }catch(err){
    thinkDiv.className='ai-msg ai-msg-bot';
    thinkDiv.textContent='Error: '+(err.message||'Something went wrong. Please try again.');
  }
  msgs.scrollTop=msgs.scrollHeight;
};

// ── 3. STRIPE LIVE FEED ─────────────────────────────────────────────────────
async function startStripeFeed(){
  const feed=document.getElementById('stripe-feed'); if(!feed)return;
  const label=document.getElementById('stripe-total-label');
  const _symOf=c=>((window.CURRENCIES&&window.CURRENCIES[c]&&window.CURRENCIES[c].symbol)||(c==='USD'?'$':(c||'')+' '));
  const _m=n=>(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  try{
    const r=await fetch('/api/stripe/feed?limit=20',{credentials:'include'});
    if(!r.ok){ if(r.status===401||r.status===403) return; throw new Error('HTTP '+r.status); }
    const d=await r.json();
    if(!d.connected){
      feed.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12px">Connect Stripe to see live payment transactions</div>';
      if(label)label.textContent=''; return;
    }
    // Entity gating: this Stripe account books to ONE entity. On any OTHER entity, don't render its
    // charges / in-books status as if they belong here — show where it books instead.
    const _actE=(window.ENTITIES||[]).find(e=>e.active); const _actId=_actE?(_actE._dbId||_actE.id):null;
    window._stripeBooksEntity=(d.books&&d.books.entity_id!=null)?d.books.entity_id:null;
    if(d.books&&d.books.scope==='business'&&d.books.entity_id!=null&&_actId!=null&&d.books.entity_id!==_actId){
      const _be=(window.ENTITIES||[]).find(e=>(e._dbId||e.id)===d.books.entity_id);
      const _bn=_be?(_be.name||_be.business_name||'another business'):'another business';
      feed.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12px">This Stripe account books to <span style="color:var(--t2)">'+esc(_bn)+'</span>. Switch to that business to see and reconcile its payments.</div>';
      if(label)label.textContent='';
      const _pb0=document.getElementById('stripe-payouts'); if(_pb0)_pb0.innerHTML='';
      return;
    }
    const charges=d.charges||[];
    const _bk=d.books||null;
    let bindingBar='';
    if(_bk){ const _ent=(window.ENTITIES||[]).find(e=>(e._dbId||e.id)===_bk.entity_id); const _lbl=_bk.scope==='personal'?'Personal':(_ent?(_ent.name||_ent.business_name||'Business'):'a business'); bindingBar='<div id="stripe-binding-bar" style="font-size:10px;color:var(--t3);padding:0 0 6px 0">Books to: <button type="button" onclick="ffChooseStripeBinding()" style="font-size:10px;color:var(--t2);background:none;border:1px solid var(--bd);border-radius:5px;padding:2px 6px;cursor:pointer">'+esc(_lbl)+' \u25be</button></div>'; }
    const mode=(d.livemode===false)?'Test mode · ':'';
    if(!charges.length){
      feed.innerHTML=bindingBar+'<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12px">No payments yet on your connected Stripe account.</div>';
      if(label)label.textContent=mode.trim(); return;
    }
    feed.innerHTML=bindingBar+charges.map(c=>{
      const col=c.status==='succeeded'?'var(--green)':(c.status==='failed'?'var(--red)':'var(--amber)');
      const dt=c.created?new Date(c.created).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
      const st=c.refunded?'refunded':c.status;
      const canBook=(c.status==='succeeded' && !c.refunded);
      let bookCtl='';
      if(c.refunded && c.inBooks){
        bookCtl = c.refundInBooks
          ? '<span style="font-size:10px;color:var(--amber);white-space:nowrap">refund recorded</span>'
          : '<button type="button" onclick="ffImportStripeRefund(\''+esc(c.id)+'\',this)" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--card);color:var(--amber);cursor:pointer;white-space:nowrap">Record refund</button>';
      } else if(c.inBooks){
        bookCtl = '<span style="font-size:10px;color:var(--green);white-space:nowrap">\u2713 in books</span>';
      } else if(c.appliedToInvoice){
        bookCtl = '<span style="font-size:10px;color:var(--green);white-space:nowrap">\u2713 applied to invoice</span>';
      } else if(canBook){
        const _addBtn = '<button type="button" onclick="ffImportStripeCharge(\''+esc(c.id)+'\',this)" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--card);color:var(--t2);cursor:pointer;white-space:nowrap">'+(c.matchInvoice?'Add as income':'Add to books')+'</button>';
        if(c.matchInvoice){
          const _mnum = esc(c.matchInvoice.num||('INV-'+c.matchInvoice.id));
          bookCtl = '<button type="button" onclick="ffMatchStripeInvoice(\''+esc(c.id)+'\','+(c.matchInvoice.id)+',this)" style="font-size:10px;padding:3px 8px;border:1px solid var(--green);border-radius:6px;background:var(--card);color:var(--green);cursor:pointer;white-space:nowrap">Match '+_mnum+'</button>'+_addBtn;
        } else {
          bookCtl = _addBtn;
        }
      }
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">'+
        '<div style="min-width:0"><div style="color:var(--t1);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(c.description||c.email||'Payment')+'</div>'+
        '<div style="color:var(--t3);font-size:11px">'+esc(dt)+' · <span style="color:'+col+'">'+esc(st)+'</span></div></div>'+
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;margin-left:10px">'+
          '<div style="font-family:var(--font-mono);color:var(--t1);white-space:nowrap">'+_symOf(c.currency)+_m(c.amount)+'</div>'+
          bookCtl+
        '</div></div>';
    }).join('');
    if(label) label.textContent=mode+_symOf((charges[0]||{}).currency)+_m(d.total)+' collected';
  }catch(e){
    feed.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12px">Could not load Stripe payments — '+esc(e.message||'try again')+'</div>';
  }
}
window.startStripeFeed=startStripeFeed;
// Owner action: record ONE connected-Stripe charge into the books (server re-fetches the charge,
// is idempotent on the charge id, and counts it as revenue). Then refresh the feed + money surfaces.
window.ffImportStripeCharge=async function(chargeId,btn){
  if(!chargeId) return;
  const orig=btn?btn.textContent:'';
  const _reset=()=>{ if(btn){ btn.disabled=false; btn.textContent=orig||'Add to books'; btn.style.opacity='1'; } };
  if(btn){ btn.disabled=true; btn.textContent='Adding\u2026'; btn.style.opacity='0.6'; }
  const _post=async(confirmed)=>{
    const r=await fetch('/api/stripe/import-charge',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(confirmed?{charge_id:chargeId,confirm:true}:{charge_id:chargeId})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
    return d;
  };
  try{
    let d=await _post(false);
    // Stopgap: server flags a charge whose amount matches an OPEN invoice (likely that invoice's payment,
    // so importing a 2nd time would double-count). Confirm with the owner before booking it.
    if(d && d.needsConfirm){
      const m=d.match||{};
      const msg='Heads up - this charge matches an open invoice'+(m.num?(' ('+m.num+(m.client?(' - '+m.client):'')+')'):'')+'. Adding it to your books records the payment as a SEPARATE sales receipt - it will NOT mark that invoice paid. If this charge already paid the invoice, the money would be counted twice.\n\nAdd to books anyway?';
      if(!(typeof window.confirm==='function' && window.confirm(msg))){ _reset(); return; }
      d=await _post(true);
    }
    if(typeof notify==='function') notify(d.duplicate?'That charge is already in your books':'Added to your books · booked on the payment date',false);
    await startStripeFeed();
    // The imported charge is a sales receipt → it lands in window.receipts, which is what the dashboard
    // revenue card and the Sales Receipts page both read. refreshFinancials only reloads invoices/expenses,
    // so we MUST reload receipts too, then let the canonical writer (updateDashboard) repaint d-rev.
    if(typeof window.loadReceipts==='function'){ try{ await window.loadReceipts(); }catch(_){} }
    if(typeof window.refreshFinancials==='function'){ try{ await window.refreshFinancials('all'); }catch(_){} }
    if(typeof window.updateDashboard==='function') window.updateDashboard();
    if(typeof window._refreshDashboardUI==='function') window._refreshDashboardUI();
  }catch(e){
    if(typeof notify==='function') notify('Could not add to books - '+(e.message||'try again'),true);
    _reset();
  }
};
window.ffImportStripeRefund=async function(chargeId,btn){
  if(!chargeId) return;
  const orig=btn?btn.textContent:'';
  const _reset=()=>{ if(btn){ btn.disabled=false; btn.textContent=orig||'Record refund'; btn.style.opacity='1'; } };
  if(!(typeof window.confirm==='function' && window.confirm('Record this refund? It adds a negative sales receipt so your revenue nets down. The Stripe fee is NOT reversed (Stripe keeps it on refunds).'))) return;
  if(btn){ btn.disabled=true; btn.textContent='Recording\u2026'; btn.style.opacity='0.6'; }
  try{
    const r=await fetch('/api/stripe/import-refund',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({charge_id:chargeId})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
    if(typeof notify==='function') notify(d.duplicate?'That refund is already recorded':'Refund recorded - revenue adjusted',false);
    await startStripeFeed();
    if(typeof window.loadReceipts==='function'){ try{ await window.loadReceipts(); }catch(_){} }
    if(typeof window.refreshFinancials==='function'){ try{ await window.refreshFinancials('all'); }catch(_){} }
    if(typeof window.updateDashboard==='function') window.updateDashboard();
    if(typeof window._refreshDashboardUI==='function') window._refreshDashboardUI();
  }catch(e){
    if(typeof notify==='function') notify('Could not record refund - '+(e.message||'try again'),true);
    _reset();
  }
};
window.ffSetStripeBinding=async function(scope,entityId){
  try{
    const r=await fetch('/api/stripe/binding',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:scope,entity_id:entityId})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
    if(typeof notify==='function') notify('Stripe now books to '+(scope==='personal'?'Personal':'the selected business'),false);
    await startStripeFeed();
  }catch(e){ if(typeof notify==='function') notify('Could not change where Stripe books - '+(e.message||'try again'),true); }
};
window.ffChooseStripeBinding=function(){
  const wrap=document.getElementById('stripe-binding-bar'); if(!wrap) return;
  const ents=(window.ENTITIES||[]);
  const sel=document.createElement('select');
  sel.style.cssText='font-size:10px;background:var(--card);color:var(--t2);border:1px solid var(--bd);border-radius:5px;padding:2px 6px';
  ents.forEach(function(e){ const id=e._dbId||e.id; const o=document.createElement('option'); o.value='biz:'+id; o.textContent=e.name||e.business_name||('Business '+id); sel.appendChild(o); });
  const op=document.createElement('option'); op.value='personal'; op.textContent='Personal'; sel.appendChild(op);
  sel.addEventListener('change',function(){ const v=this.value; if(v==='personal') window.ffSetStripeBinding('personal',null); else window.ffSetStripeBinding('business',parseInt(v.split(':')[1],10)); });
  wrap.textContent='Books to: '; wrap.appendChild(sel);
};
async function startStripePayouts(){
  const box=document.getElementById('stripe-payouts'); if(!box)return;
  const _pae=(window.ENTITIES||[]).find(e=>e.active); const _paid=_pae?(_pae._dbId||_pae.id):null;
  if(window._stripeBooksEntity!=null && _paid!=null && window._stripeBooksEntity!==_paid){ box.innerHTML=''; return; }
  const _symOf=c=>((window.CURRENCIES&&window.CURRENCIES[c]&&window.CURRENCIES[c].symbol)||(c==='USD'?'$':(c||'')+' '));
  const _m=n=>(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  try{
    const r=await fetch('/api/stripe/payouts?limit=6',{credentials:'include'});
    if(!r.ok){ if(r.status===401||r.status===403) return; box.innerHTML=''; return; }
    const d=await r.json();
    if(!d.connected||!(d.payouts||[]).length){ box.innerHTML=''; return; }
    const rows=d.payouts.map(function(p){
      const col=p.status==='paid'?'var(--green)':((p.status==='failed'||p.status==='canceled')?'var(--red)':'var(--amber)');
      const when=p.arrival_date?new Date(p.arrival_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--bd)">'+
        '<div style="min-width:0"><div style="color:var(--t2);font-size:12px">Payout to bank</div>'+
        '<div style="color:var(--t3);font-size:11px">'+esc(when)+' \u00b7 <span style="color:'+col+'">'+esc(p.status)+'</span></div></div>'+
        '<div style="font-family:var(--font-mono);color:var(--t1);white-space:nowrap;margin-left:10px">'+_symOf(p.currency)+_m(p.amount)+'</div></div>';
    }).join('');
    box.innerHTML='<div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;padding:8px 0 4px">Payouts to your bank</div>'+rows+'<div style="font-size:10px;color:var(--t3);padding:6px 0 0">Match each to the matching deposit on your bank statement.</div>';
  }catch(e){ box.innerHTML=''; }
}
window.startStripePayouts=startStripePayouts;
window.ffMatchStripeInvoice=async function(chargeId,invoiceId,btn){
  if(!chargeId||!invoiceId) return;
  const orig=btn?btn.textContent:'';
  const _reset=()=>{ if(btn){ btn.disabled=false; btn.textContent=orig||'Match'; btn.style.opacity='1'; } };
  if(btn){ btn.disabled=true; btn.textContent='Matching\u2026'; btn.style.opacity='0.6'; }
  try{
    const r=await fetch('/api/stripe/match-invoice',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({charge_id:chargeId,invoice_id:invoiceId})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
    if(typeof notify==='function') notify('Matched - invoice marked paid, no double revenue',false);
    await startStripeFeed();
    if(typeof window.loadReceipts==='function'){ try{ await window.loadReceipts(); }catch(_){} }
    if(typeof window.refreshFinancials==='function'){ try{ await window.refreshFinancials('all'); }catch(_){} }
    if(typeof window.updateDashboard==='function') window.updateDashboard();
    if(typeof window._refreshDashboardUI==='function') window._refreshDashboardUI();
  }catch(e){
    if(typeof notify==='function') notify('Could not match to invoice - '+(e.message||'try again'),true);
    _reset();
  }
};
document.addEventListener('DOMContentLoaded',startStripeFeed);
document.addEventListener('DOMContentLoaded',startStripePayouts);
// Gentle live refresh: only while the dashboard is actually visible (keeps Stripe API calls minimal).
setInterval(function(){ const dp=document.getElementById('page-dashboard'); if(dp && dp.offsetParent!==null){ startStripeFeed(); startStripePayouts(); } }, 60000);

// ── 4. BUDGET MODULE ────────────────────────────────────────────────────────
window.BUDGET_DATA=window.BUDGET_DATA||[];
function renderBudget(){
  const el=document.getElementById('budget-rows');
  if(!el)return;
  const BUDGET_DATA=window.BUDGET_DATA||[];
  if(!BUDGET_DATA.length){el.innerHTML='<div style="padding:1.2rem;text-align:center;color:var(--t3);font-size:13px">No budget targets set. Click "Edit targets" to add categories.</div>';return;}
  el.innerHTML=BUDGET_DATA.map(r=>{
    const pct=Math.min(100,(r.actual/r.budget)*100);
    const over=r.actual>r.budget;
    const variance=r.budget-r.actual;
    const varColor=over?'var(--red)':'var(--green)';
    const varStr=(over?'-':'+')+window._fmtMoneyNative(Math.abs(variance));   // L29: exact (was K/M/B)   // F129: entity symbol, matches this row's actual/budget
    return `<div class="budget-row" style="margin-top:8px">
      <span class="budget-label">${r.cat}</span>
      <div class="budget-track">
        <div class="budget-actual" style="width:${pct}%;background:${over?'var(--red)':r.color}"></div>
        <div class="budget-marker" style="left:100%"></div>
      </div>
      <span class="budget-vals" style="font-family:var(--font-mono);font-size:11px">${window._fmtMoneyNative(r.actual)} / ${window._fmtMoneyNative(r.budget)}</span>
      <span class="budget-variance" style="color:${varColor}">${varStr}</span>
    </div>`;
  }).join('');

  const aiText=document.getElementById('budget-ai-text');
  if(aiText)aiText.textContent='Add real expenses and budget targets to see AI-powered insights.';
}
requestAnimationFrame(renderBudget);

// ── 5. MRR CHART ────────────────────────────────────────────────────────────
// ── MRR: wire to real data from recurring invoices ──────────────────
async function loadMRRData(){
  try {
    // Calculate MRR from real recurring invoices
    const _dispCcy = window._displayCurrency || null;   // F126: view MRR/ARR in the chosen display currency
    const res = await fetch('/api/recurring-invoices'+(_dispCcy?('?display='+encodeURIComponent(_dispCcy)):''),{credentials:'include'});
    // F96 class: a non-ok response must NOT silently leave MRR/ARR reading $0, which looks like
    // "no subscriptions" (money surface). 401/403 = logged out; anything else is a real failure —
    // surface it and leave the cards on their prior/placeholder value rather than a fabricated $0.
    if(!res.ok){
      if(res.status === 401 || res.status === 403) return;
      console.error('[MRR] load failed (HTTP '+res.status+')');
      if(typeof notify === 'function') notify('Could not load MRR — check your connection and retry', true);
      return;
    }
    const rows = await res.json();
    // Frequency is stored VERBATIM from the create form ("Monthly"/"Weekly"/"Quarterly"/"Annually"),
    // so the match MUST be case-insensitive — the old lowercase '===' never matched a single stored
    // row, which made MRR the raw sum of every active amount (quarterly/annual counted at full monthly
    // value, weekly ignored entirely). Mirror the server's case-insensitive normalization (server.js
    // ~4018) and the shared monthlyEquiv helper: weekly ×52/12, quarterly ÷3, yearly ÷12.
    const monthlyTotal = rows.filter(r=>String(r.status||'').toLowerCase()==='active').reduce((s,r)=>{
      const amt = parseFloat(r.amount)||0;
      const f = String(r.frequency||'Monthly').toLowerCase();
      if(f.startsWith('week'))    return s+(amt*52/12);
      if(f.startsWith('quarter')) return s+(amt/3);
      if(f.startsWith('year')||f.startsWith('annual')) return s+(amt/12);
      return s+amt;   // monthly (and any unknown cadence) → face value
    },0);
    const arr = monthlyTotal*12;
    // Update MRR metric cards.
    // F124: NATIVE symbol, not a hardcoded '$' and not activeCurrency. These figures are summed
    // straight from GET /api/recurring-invoices with no ?display= param and no conversion, so they
    // are in the ENTITY's own currency. '$' was simply wrong for any non-USD entity; activeCurrency
    // would be worse under a display currency — a converted label on an unconverted number.
    // Converting MRR needs FX wiring this endpoint does not have → held as F126, not half-done.
    // Each card keeps EXACTLY the rounding it had — mrr-val exact, arr-val abbreviated. Only the
    // symbol moves. (That the two disagree on abbreviation is pre-existing and left alone: it is a
    // formatting question, and changing it inside a currency commit would hide one change behind
    // another.)
    // F126: render in the display currency when one is active AND the server could convert (amounts
    // above are already converted). No FX rate for the pair ⇒ _fx.ok=false ⇒ honest "—" (never a
    // relabelled native number, mirroring _applyConvertedKPIs). No display currency ⇒ native, byte-
    // identical to before.
    const _fx = (_dispCcy && rows.length) ? (rows[0]._fx || null) : null;
    const _fxOk = !_dispCcy || !_fx || _fx.ok !== false;
    const _sym = (_dispCcy && _fxOk)
      ? ((window.CURRENCIES && window.CURRENCIES[_dispCcy] && window.CURRENCIES[_dispCcy].symbol) || _dispCcy)
      : window._nativeSymbol();
    const _mv=document.getElementById('mrr-val'), _av=document.getElementById('arr-val');
    if(_dispCcy && !_fxOk){
      const _hint='No FX rate for '+((_fx&&_fx.from)||'')+'→'+_dispCcy+'. Add one under FX / Currency to convert.';
      if(_mv){ _mv.textContent='—'; _mv.title=_hint; }
      if(_av){ _av.textContent='—'; _av.title=_hint; }
    } else {
      if(_mv){ _mv.textContent=_sym+Math.round(monthlyTotal).toLocaleString(); _mv.title=''; }
      if(_av){ _av.textContent=window._fmtMoney(arr, _sym); _av.title=''; }
    }
    // F127: build a REAL trailing-12-month MRR series so the chart is not a permanent flat zero line
    // (window._mrrChartData previously had NO writer anywhere). Each currently-active recurring invoice
    // contributes its monthly value from its start month (created_at) forward — the ramp of the active
    // book. Churned subs aren't retained server-side, so this is honestly "MRR of currently-active
    // subscriptions over time" (the last point equals the MRR card), not a fabricated trend.
    const _monthlyVal = r => { const a=parseFloat(r.amount)||0; const f=String(r.frequency||'').toLowerCase();
      return f==='quarterly' ? a/3 : f==='annually' ? a/12 : a; };
    const _active = rows.filter(r=>r.status==='active');
    // L18 (Rule 10): months are CALENDAR months ('YYYY-MM' strings from the resolved today), and a sub's start /
    // end reduce to calendar dates — the old viewer-local Date windows filed a sub created 1 Jul 02:00 UTC into
    // JUNE for every viewer west of UTC.
    const _FD = window.FinFlowDates, _MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _todayY = (window._entityToday ? window._entityToday() : _FD.resolvedToday(new Date()));
    const _abs0 = parseInt(_todayY.slice(0,4),10)*12 + (parseInt(_todayY.slice(5,7),10)-1);
    const _key = a => Math.floor(a/12) + '-' + String((a%12)+1).padStart(2,'0');
    const _series=[], _mlabels=[];
    for(let i=11;i>=0;i--){
      const a = _abs0 - i, mStart = _key(a) + '-01', mEnd = _key(a+1) + '-01';
      const total = _active.reduce((s,r)=>{
        const started = r.created_at ? _FD._toYmd(r.created_at) : null;   // no start ⇒ treat as always-on
        if(started && started >= mEnd) return s;                          // not started yet in this month
        const ended = r.end_date ? _FD._toYmd(r.end_date) : null;
        if(ended && ended < mStart) return s;                             // ended before this month
        return s + _monthlyVal(r);
      },0);
      _series.push(Math.round(total*100)/100);
      _mlabels.push(_MN[a%12]);
    }
    window._mrrChartData = _series;
    window._mrrChartLabels = _mlabels;
    if(typeof renderMRRChart==='function') renderMRRChart();
    // F-F1: Revenue by customer — group active recurring subs by client (was a permanent "Loading…"
    // placeholder that no code ever populated).
    const _byCust = {};
    _active.forEach(r=>{ const c=(r.client||'—'); _byCust[c]=(_byCust[c]||0)+_monthlyVal(r); });
    const _custEl = document.getElementById('mrr-by-customer');
    if(_custEl){
      const _entries = Object.entries(_byCust).sort((a,b)=>b[1]-a[1]);
      _custEl.innerHTML = _entries.length
        ? _entries.map(([c,v])=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--t1)">${esc(c)}</span><span style="font-family:var(--font-mono);color:var(--t2)">${_sym+Math.round(v).toLocaleString()}/mo</span></div>`).join('')
        : '<div style="padding:1rem;text-align:center;color:var(--t3)">No active subscriptions yet.</div>';
    }
    // F-F2: Active customers = distinct clients with an active subscription. Net MRR = current active MRR.
    // New/Churned/Expansion require period-over-period cohort history that is NOT retained server-side
    // (see the F127 note above) — left as "—" rather than fabricated.
    const _mc = document.getElementById('mrr-customers'); if(_mc) _mc.textContent = Object.keys(_byCust).length;
    const _netEl = document.getElementById('mrr-net');
    if(_netEl) _netEl.textContent = (_dispCcy && !_fxOk) ? '—' : (_sym+Math.round(monthlyTotal).toLocaleString());
  } catch(e){
    // F96 class — NETWORK-failure path (fetch rejected). Same visibility as the !res.ok branch:
    // a dropped connection must not read as "no subscriptions" ($0).
    console.error('[MRR] load failed:', e && e.message);
    if(typeof notify === 'function') notify('Could not load MRR — check your connection and retry', true);
  }
}

let mrrChartInst=null;
function renderMRRChart(){
  const canvas=document.getElementById('mrrChart');
  if(!canvas||typeof Chart==='undefined'||canvas.offsetWidth===0||canvas.offsetParent===null)return;
  const existing=Chart.getChart(canvas);
  if(existing){existing.destroy();}
  if(mrrChartInst){mrrChartInst.destroy();mrrChartInst=null;}
  // F127: labels track the real trailing-12-month window loadMRRData built (fallback to a static
  // sequence only before the data writer has run). The chart no longer draws a permanent flat zero.
  const labels=window._mrrChartLabels||['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr'];
  const data=window._mrrChartData||new Array(12).fill(0);
  mrrChartInst=new Chart(canvas,{
    type:'line',
    data:{labels,datasets:[{
      label:'MRR',data,
      borderColor:'#c9a84c',backgroundColor:'rgba(201,168,76,0.08)',
      pointBackgroundColor:'#c9a84c',pointRadius:3,borderWidth:2,tension:0.35,fill:true
    }]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{grid:{color:'rgba(201,168,76,0.06)'},ticks:{color:'#5a4e3a',font:{size:10}}},
              // F124: native symbol — the series is window._mrrChartData, which is never FX-converted
              // (F126) and, per F127, has no writer anywhere so it is always a flat zero line.
              // Matches the MRR/ARR cards above.
              y:{grid:{color:'rgba(201,168,76,0.06)'},ticks:{color:'#5a4e3a',font:{size:10},callback:v=>window._fmtMoneyNativeAbbr(v)}}}}
  });
}
// ── 6. PLAID BANKING ────────────────────────────────────────────────────────
// No hardcoded demo data — all banking data loads from DB via loadBankingFromDB()
function renderPlaid(){
  // Delegate entirely to renderBanking() which reads live DB data
  if(typeof renderBanking === 'function') renderBanking();
}
window.plaidConnect=function(){notify('Connect your bank account to start syncing transactions ✦');};
window.addEventListener('ff:authed',function(){ if(typeof loadBankingFromDB==='function') loadBankingFromDB(); },{once:true});
window.addEventListener('ff:authed',function(){
  var u=window.CURRENT_USER;
  if(!u||!u.trial_ends||(u.plan!=='trial'&&u.plan!=='free'))return;
  var trialEnd=new Date(u.trial_ends);
  var daysLeft=Math.ceil((trialEnd-Date.now())/86400000);
  if(daysLeft>30)return;                                   // plenty of trial left → no banner
  // F132: when the trial has ENDED (daysLeft<=0) the app is READ-ONLY, not locked — show a
  // PERSISTENT banner (was: `daysLeft<=0` bailed, so the only trial UI vanished exactly when it
  // mattered). Reads still work (server checkPlan), so the user sees their books; this tells them
  // why saving is blocked and how to fix it.
  var expired=daysLeft<=0;
  var banner=document.createElement('div');
  banner.id='trial-banner';
  banner.style.cssText='background:'+(expired?'var(--red,#c0392b)':'var(--acc)')+';color:'+(expired?'#fff':'#000')+';text-align:center;font-size:12px;font-weight:600;padding:6px;cursor:pointer;';
  banner.innerHTML=expired
    ? '&#9889; Your free trial has ended — you can still view your books, but changes are locked. <u>Upgrade to make changes</u>'
    : '&#9889; '+daysLeft+' day'+(daysLeft===1?'':'s')+' left on your free trial — <u>Upgrade now</u>';
  banner.onclick=function(){ if(typeof window.startUpgrade==='function') window.startUpgrade(); else if(typeof showPage==='function') showPage('pricing',null); };
  var main=document.querySelector('.main');
  if(main)main.prepend(banner);
},{once:true});

// ── 7. KEYBOARD SHORTCUTS ───────────────────────────────────────────────────
document.addEventListener('keydown',function(e){
  const tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openCmdPalette();return;}
  if(e.key==='?' && !e.shiftKey){openCmdPalette();return;}
  // G + key shortcuts
  if(window._gKey){
    clearTimeout(window._gTimeout);
    window._gKey=false;
    const map={d:'dashboard',i:'invoices',b:'banking',p:'payroll',s:'settings',a:'ai',r:'reports',m:'mrr',u:'budget'};
    if(map[e.key.toLowerCase()]){showPage(map[e.key.toLowerCase()],null);return;}
  }
  if(e.key==='g'&&!e.metaKey&&!e.ctrlKey){
    window._gKey=true;
    window._gTimeout=setTimeout(()=>{window._gKey=false;},1200);
  }
  if(e.key==='n'&&!e.metaKey&&!e.ctrlKey){showPage('invoices',null);setTimeout(()=>window.openInvoiceModal&&openInvoiceModal(),200);}
  if(e.key==='a'&&!e.metaKey&&!e.ctrlKey){toggleAIPanel();}
});

// Patch showPage for new pages
const _sp8=window.showPage;
window.showPage=function(id,el){
  if(currentUserPlan==='pro'&&(id==='mrr'||id==='banking')){
    if(typeof showUpgradeModal==='function') showUpgradeModal(id==='mrr'?'mrr':'banking');
    return;
  }
  _sp8(id,el);
  const extras={budget:'Budget',mrr:'MRR / SaaS',banking:'Banking',entities:'Entities',team:'Team & Roles',audit:'Audit Trail','bank-rec':'Bank Reconciliation',fx:'FX / Currency'};
  if(extras[id])document.getElementById('pageTitle').textContent=extras[id];
  const _rAF=window.requestAnimationFrame||setTimeout;
  if(id==='dashboard') loadChartJS(function(){buildCharts();buildCashChart();});
  if(id==='cashflow') loadChartJS(buildCashChart);
  if(id==='budget')  _rAF(renderBudget);
  if(id==='mrr'){ loadChartJS(renderMRRChart); loadMRRData(); }
  if(id==='banking'){ _rAF(renderPlaid); loadBankingFromDB(); }
  if(id==='entities')_rAF(renderEntities);
  if(id==='team')    _rAF(renderTeam);
  if(id==='audit')   _rAF(renderAudit);
  if(id==='connections'&&typeof window._connHydrate==='function') _rAF(window._connHydrate);
  if(id==='bank-rec'&&typeof loadBankRec==='function') _rAF(loadBankRec);
  if(id==='fx'&&typeof loadFXData==='function') _rAF(loadFXData);
  if(id==='audit'&&typeof loadAuditTrail==='function') _rAF(loadAuditTrail);
  if(id==='inventory'&&typeof loadCOGS==='function') _rAF(loadCOGS);
  if(id==='payroll'&&typeof loadPayrollRuns==='function') setTimeout(loadPayrollRuns,200);
};
