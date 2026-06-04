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
function startStripeFeed(){
  const feed=document.getElementById('stripe-feed');
  if(!feed)return;
  feed.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12px">Connect Stripe to see live payment transactions</div>';
  const label=document.getElementById('stripe-total-label');
  if(label)label.textContent='';
}
document.addEventListener('DOMContentLoaded',startStripeFeed);

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
    const varStr=(over?'-':'+')+'$'+(Math.abs(variance)/1000).toFixed(1)+'K';
    return `<div class="budget-row" style="margin-top:8px">
      <span class="budget-label">${r.cat}</span>
      <div class="budget-track">
        <div class="budget-actual" style="width:${pct}%;background:${over?'var(--red)':r.color}"></div>
        <div class="budget-marker" style="left:100%"></div>
      </div>
      <span class="budget-vals" style="font-family:var(--font-mono);font-size:11px">$${(r.actual/1000).toFixed(1)}K / $${(r.budget/1000).toFixed(0)}K</span>
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
    const res = await fetch('/api/recurring-invoices',{credentials:'include'});
    if(!res.ok) return;
    const rows = await res.json();
    const monthlyTotal = rows.filter(r=>r.status==='active').reduce((s,r)=>{
      const amt = parseFloat(r.amount)||0;
      if(r.frequency==='monthly') return s+amt;
      if(r.frequency==='quarterly') return s+(amt/3);
      if(r.frequency==='annually') return s+(amt/12);
      return s+amt;
    },0);
    const arr = monthlyTotal*12;
    // Update MRR metric cards
    const els = {
      'mrr-val': '$'+Math.round(monthlyTotal).toLocaleString(),
      'arr-val': '$'+Math.round(arr/1000)+'K',
    };
    Object.entries(els).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.textContent=val; });
  } catch(e){ console.warn('[MRR] Load failed:',e.message); }
}

let mrrChartInst=null;
function renderMRRChart(){
  const canvas=document.getElementById('mrrChart');
  if(!canvas||typeof Chart==='undefined'||canvas.offsetWidth===0||canvas.offsetParent===null)return;
  const existing=Chart.getChart(canvas);
  if(existing){existing.destroy();}
  if(mrrChartInst){mrrChartInst.destroy();mrrChartInst=null;}
  const labels=['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr'];
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
              y:{grid:{color:'rgba(201,168,76,0.06)'},ticks:{color:'#5a4e3a',font:{size:10},callback:v=>'$'+(v/1000).toFixed(0)+'K'}}}}
  });
}
// ── 6. PLAID BANKING ────────────────────────────────────────────────────────
// No hardcoded demo data — all banking data loads from DB via loadBankingFromDB()
function renderPlaid(){
  // Delegate entirely to renderBanking() which reads live DB data
  if(typeof renderBanking === 'function') renderBanking();
}
window.plaidConnect=function(){notify('Connect your bank account to start syncing transactions ✦');};
requestAnimationFrame(()=>{ if(typeof loadBankingFromDB==='function') loadBankingFromDB(); });

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
  if(id==='bank-rec'&&typeof loadBankRec==='function') _rAF(loadBankRec);
  if(id==='fx'&&typeof loadFXData==='function') _rAF(loadFXData);
  if(id==='audit'&&typeof loadAuditTrail==='function') _rAF(loadAuditTrail);
  if(id==='inventory'&&typeof loadCOGS==='function') _rAF(loadCOGS);
  if(id==='payroll'&&typeof loadPayrollRuns==='function') setTimeout(loadPayrollRuns,200);
};
