
// ── Belvo (Latin America bank data) — Plaid-style widget: token → widget → link → exchange. ──
window.ffLinkBelvo = async function(onLinked, onError){
  const fail = (m) => { if(typeof notify==='function') notify(m, true); if(typeof onError==='function') onError(m); };
  let d;
  try{
    const r = await fetch('/api/belvo/widget-token', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:'{}'});
    d = await r.json().catch(()=>({}));
    if(!r.ok){
      if(r.status===401) return fail('Please finish creating your account first.');
      if(r.status===403) return fail('Only the account owner can connect this.');
      return fail(d.error || 'Latin America bank linking isn\'t set up yet.');
    }
  }catch(e){ return fail('Network error starting the connection.'); }
  try{ await window._loadScriptOnce('https://cdn.belvo.io/belvo-widget-1-stable.js'); }catch(e){}
  if(!(window.belvoSDK && window.belvoSDK.createWidget)) return fail('Belvo widget did not load. Check your connection and try again.');
  window.belvoSDK.createWidget(d.access, {
    callback: async (link) => {
      try{
        const ex = await fetch('/api/belvo/exchange', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({link})});
        const j = await ex.json().catch(()=>({}));
        if(!ex.ok) return fail(j.error || 'Could not finish linking your bank.');
        if(typeof notify==='function') notify('Bank linked: ' + (j.institution || 'your bank') + ' ✓');
        if(typeof onLinked==='function') onLinked(j);
      }catch(e){ fail('Network error finishing bank link.'); }
    },
    onExit: () => {}
  }).build();
};

// ── WiPay (Caribbean payments) — merchant-credentials modal (account number + API key). ──
window.ffConnectWiPay = function(onConnected){
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center';
  ov.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:12px;width:100%;max-width:400px;padding:20px">'
    +'<div style="font-family:var(--font-display);font-style:italic;font-size:18px;color:var(--acc-light);margin-bottom:4px">Connect WiPay</div>'
    +'<div style="font-size:12px;color:var(--t2);margin-bottom:14px">Enter your WiPay merchant credentials to accept Caribbean card payments.</div>'
    +'<label style="font-size:11px;color:var(--t2)">Account number</label>'
    +'<input id="wp-acct" class="finput" style="margin:4px 0 10px" placeholder="1234567890">'
    +'<label style="font-size:11px;color:var(--t2)">API key</label>'
    +'<input id="wp-key" class="finput" type="password" style="margin:4px 0 10px" placeholder="Your WiPay API key">'
    +'<label style="font-size:11px;color:var(--t2)">Country</label>'
    +'<select id="wp-country" class="finput" style="margin:4px 0 14px"><option value="TT">Trinidad & Tobago</option><option value="JM">Jamaica</option><option value="BB">Barbados</option><option value="GY">Guyana</option><option value="LC">St. Lucia</option></select>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end"><button id="wp-cancel" class="btn btn-ghost btn-sm">Cancel</button><button id="wp-save" class="btn btn-primary btn-sm">Connect</button></div></div>';
  document.body.appendChild(ov);
  var close=function(){ try{ov.remove();}catch(e){} };
  ov.querySelector('#wp-cancel').onclick=close;
  ov.onclick=function(e){ if(e.target===ov) close(); };
  ov.querySelector('#wp-save').onclick=async function(){
    var account=ov.querySelector('#wp-acct').value.trim();
    var key=ov.querySelector('#wp-key').value.trim();
    var country=ov.querySelector('#wp-country').value;
    if(!account||!key){ if(typeof notify==='function') notify('Account number and API key are required.', true); return; }
    try{
      var r=await fetch('/api/wipay/connect',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({account_number:account,api_key:key,country:country})});
      var j=await r.json().catch(()=>({}));
      if(!r.ok){ if(typeof notify==='function') notify(j.error||'Could not connect WiPay.', true); return; }
      if(typeof notify==='function') notify('WiPay connected ✓ ('+country+')');
      close(); if(typeof onConnected==='function') onConnected(j);
    }catch(e){ if(typeof notify==='function') notify('Network error connecting WiPay.', true); }
  };
};

// ── Generic API-key credential modal (dLocal, Mercado Pago, Wise). ──
window.FF_CRED = {
  dlocal:{label:'dLocal',fields:[{k:'x_login',l:'X-Login'},{k:'x_trans_key',l:'X-Trans-Key'},{k:'secret_key',l:'Secret key',s:1}]},
  mercadopago:{label:'Mercado Pago',fields:[{k:'access_token',l:'Access token',s:1}]},
  wise:{label:'Wise',fields:[{k:'api_token',l:'API token',s:1}]},
  woocommerce:{label:'WooCommerce',fields:[{k:'store_url',l:'Store URL (https://yourstore.com)'},{k:'consumer_key',l:'Consumer key'},{k:'consumer_secret',l:'Consumer secret',s:1}]}
};
window.ffConnectCreds = function(key, onConnected){
  var cfg=window.FF_CRED[key]; if(!cfg) return;
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center';
  var inputs=cfg.fields.map(function(f){return '<label style="font-size:11px;color:var(--t2)">'+f.l+'</label><input data-k="'+f.k+'" class="finput" '+(f.s?'type="password"':'')+' style="margin:4px 0 10px">';}).join('');
  ov.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:12px;width:100%;max-width:400px;padding:20px">'
    +'<div style="font-family:var(--font-display);font-style:italic;font-size:18px;color:var(--acc-light);margin-bottom:4px">Connect '+cfg.label+'</div>'
    +'<div style="font-size:12px;color:var(--t2);margin-bottom:14px">Enter your '+cfg.label+' API credentials. They\'re encrypted before storage.</div>'
    +inputs
    +'<div style="display:flex;gap:8px;justify-content:flex-end"><button id="cc-cancel" class="btn btn-ghost btn-sm">Cancel</button><button id="cc-save" class="btn btn-primary btn-sm">Connect</button></div></div>';
  document.body.appendChild(ov);
  var close=function(){ try{ov.remove();}catch(e){} };
  ov.querySelector('#cc-cancel').onclick=close;
  ov.onclick=function(e){ if(e.target===ov) close(); };
  ov.querySelector('#cc-save').onclick=async function(){
    var body={}, ok=true;
    ov.querySelectorAll('input[data-k]').forEach(function(i){ body[i.getAttribute('data-k')]=i.value.trim(); if(!i.value.trim()) ok=false; });
    if(!ok){ if(typeof notify==='function') notify('All fields are required.', true); return; }
    try{
      var r=await fetch('/api/'+key+'/connect',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
      var j=await r.json().catch(()=>({}));
      if(!r.ok){ if(typeof notify==='function') notify(j.error||('Could not connect '+cfg.label), true); return; }
      if(typeof notify==='function') notify(cfg.label+' connected ✓');
      close(); if(typeof onConnected==='function') onConnected(j);
    }catch(e){ if(typeof notify==='function') notify('Network error connecting '+cfg.label, true); }
  };
};

window.ffLinkBank = async function(onLinked, onError){
  const fail = (m) => { if(typeof notify==='function') notify(m, true); if(typeof onError==='function') onError(m); };
  let tok;
  try{
    const r = await fetch('/api/plaid/link-token', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:'{}'});
    tok = await r.json().catch(()=>({}));
    if(!r.ok){
      if(r.status===401) return fail('Please finish creating your account first, then link your bank.');
      return fail(tok.error || 'Bank linking is unavailable right now.');
    }
  }catch(e){ return fail('Network error starting bank link.'); }
  try{ await window._loadScriptOnce('https://cdn.plaid.com/link/v2/stable/link-initialize.js'); }catch(e){}
  if(!(window.Plaid && window.Plaid.create)) return fail('Bank-linking library did not load. Check your connection and try again.');
  window.Plaid.create({
    token: tok.link_token,
    onSuccess: async (public_token) => {
      try{
        const ex = await fetch('/api/plaid/exchange', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({public_token})});
        const j = await ex.json().catch(()=>({}));
        if(!ex.ok) return fail(j.error || 'Could not finish linking your bank.');
        if(typeof notify==='function') notify('Bank linked: ' + (j.institution_name || 'your bank') + ' ✓');
        if(typeof onLinked==='function') onLinked(j);
      }catch(e){ fail('Network error finishing bank link.'); }
    },
    onExit: (err) => { if(err && typeof notify==='function') notify('Bank link cancelled.'); }
  }).open();
};

// ── Shared connect flow for redirect/hosted-URL providers (Finch payroll, Codat accounting).
//    Asks the server for a connect URL (502 → honest message), opens it in a popup, then polls
//    the provider's status endpoint until it reports connected. Never fakes a connected state. ──
window.ffConnectProvider = async function(cfg){
  // cfg: { urlEndpoint, urlKey, statusEndpoint, onConnected }
  const fail = (m) => { if(typeof notify==='function') notify(m, true); };
  let d;
  try{
    const r = await fetch(cfg.urlEndpoint, {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:'{}'});
    d = await r.json().catch(()=>({}));
    if(!r.ok){
      if(r.status===401) return fail('Please finish creating your account first.');
      if(r.status===403) return fail('Only the account owner can connect this.');
      return fail(d.error || 'This connection isn\'t set up yet.');
    }
  }catch(e){ return fail('Network error starting the connection.'); }
  const url = d[cfg.urlKey];
  if(!url) return fail('No connect URL returned.');
  const popup = window.open(url, 'ff-connect', 'width=600,height=760');
  if(typeof notify==='function') notify('Complete the connection in the popup window…');
  // Poll status until connected (or the popup closes / we time out).
  let tries = 0;
  const poll = setInterval(async ()=>{
    tries++;
    try{
      const s = await (await fetch(cfg.statusEndpoint, {credentials:'include'})).json();
      if(s && s.connected){ clearInterval(poll); if(typeof notify==='function') notify('Connected ✓'); if(cfg.onConnected) cfg.onConnected(s); return; }
    }catch(e){}
    if(tries > 150 || (popup && popup.closed && tries > 2)){ clearInterval(poll); }
  }, 2000);
};

// ── Codat migration: preview an existing accounting book (QuickBooks/Xero/Sage/…) and import
//    it into FinFlow. Owner-confirmed — shows a dry-run PREVIEW first and writes only on confirm.
//    Re-running is safe (server dedupes on Codat's stable ids). ──
window.ffCodatMigrate = async function(){
  const note = (m,e)=>{ if(typeof notify==='function') notify(m, !!e); };
  let st; try{ st = await (await fetch('/api/codat/status',{credentials:'include'})).json(); }
  catch(e){ return note('Network error reaching Codat.', true); }
  if(!st || !st.configured){ return note('Accounting import isn\'t set up yet (needs CODAT_API_KEY).', true); }
  if(!st.connected){ return note('Connect your accounting platform first: API connections → Codat → Connect.', true); }
  note('Reading your accounting data…');
  let pv;
  try{
    const r = await fetch('/api/codat/import-preview',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:'{}'});
    pv = await r.json().catch(()=>({}));
    if(!r.ok){ return note(pv.error||'Could not read your accounting data.', true); }
  }catch(e){ return note('Network error building the import preview.', true); }
  const LABEL={accounts:'Chart of accounts',customers:'Customers',suppliers:'Suppliers',invoices:'Invoices',bills:'Bills',payments:'Payments received',billPayments:'Payments made',journalEntries:'Journal entries'};
  const ds = pv.datasets||{}; let totalNew=0; const curSet={};
  const rows = Object.keys(LABEL).map(function(k){
    const t=ds[k]||{}; totalNew += (t.added||0);
    Object.keys(t.currencies||{}).forEach(function(c){ curSet[c]=1; });
    const bits=[];
    if(t.duplicate) bits.push(t.duplicate+' already imported');
    if(t.locked) bits.push(t.locked+' in a locked period');
    if(t.skipped) bits.push(t.skipped+' skipped');
    if(t.error) bits.push('⚠ '+t.error);
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--bd)">'
      +'<span style="font-size:12.5px;color:var(--t1)">'+LABEL[k]+'</span>'
      +'<span style="font-size:12px;color:var(--t2);text-align:right"><b style="color:var(--acc-light)">'+(t.added||0)+'</b> to import'
      +(bits.length?('<div style="font-size:10.5px;color:var(--t3)">'+bits.join(' · ')+'</div>'):'')+'</span></div>';
  }).join('');
  const curs=Object.keys(curSet);
  const warn = curs.length>1
    ? '<div style="font-size:11px;color:var(--amber,#e0a500);margin-top:8px">⚠ Mixed currencies in source ('+curs.join(', ')+'). Amounts import as-is — confirm they match this entity\'s currency.</div>'
    : (curs.length===1 ? '<div style="font-size:11px;color:var(--t3);margin-top:8px">Source currency: '+curs[0]+'. Amounts import as-is.</div>' : '');
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:3300;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:14px;width:100%;max-width:440px;max-height:88vh;overflow:auto;padding:22px">'
    +'<div style="font-family:var(--font-display);font-style:italic;font-size:19px;color:var(--acc-light);margin-bottom:2px">Import your books'+(pv.platform?(' — '+String(pv.platform).replace(/[<>&]/g,'')):'')+'</div>'
    +'<div style="font-size:12px;color:var(--t2);margin-bottom:14px">Review what will be imported. Nothing is written until you confirm. Re-running is safe — already-imported records are skipped.</div>'
    +rows+warn
    +'<div style="font-size:12.5px;color:var(--t1);margin:14px 0 4px"><b style="color:var(--acc-light)">'+totalNew+'</b> new record'+(totalNew===1?'':'s')+' will be imported.</div>'
    +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    +'<button id="cm-cancel" class="btn btn-ghost btn-sm">Cancel</button>'
    +'<button id="cm-go" class="btn btn-primary btn-sm"'+(totalNew?'':' disabled')+'>Import '+totalNew+' record'+(totalNew===1?'':'s')+'</button>'
    +'</div></div>';
  document.body.appendChild(ov);
  const close=function(){ try{ ov.remove(); }catch(e){} };
  ov.querySelector('#cm-cancel').onclick=close;
  ov.onclick=function(e){ if(e.target===ov) close(); };
  const go=ov.querySelector('#cm-go');
  if(go) go.onclick=async function(){
    go.disabled=true; go.textContent='Importing…';
    try{
      const r=await fetch('/api/codat/import',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:'{}'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){ go.disabled=false; go.textContent='Retry import'; return note(j.error||'Import failed.', true); }
      close();
      var _rc = j.reconcile;
      var _msg = 'Imported '+(j.total_added||0)+' record'+((j.total_added===1)?'':'s')+' from '+(j.platform||'your accounting platform')+' ✓';
      if(_rc && _rc.tiedOut){ _msg += ' — books verified: trial balance ties, entity by entity ✓'; }
      else if(_rc){ _msg += ' — imported; open Verify books to reconcile opening balances'; }
      note(_msg);
      try{ if(window.loadEntitiesFromDB) window.loadEntitiesFromDB(true); }catch(e){}
      try{ if(window.finflow&&window.finflow.refresh) window.finflow.refresh(['dashboard','reports','invoices','bills','customers','vendors']); }catch(e){}
    }catch(e){ go.disabled=false; go.textContent='Retry import'; note('Network error during import.', true); }
  };
};

// ── HELP & GETTING STARTED (in-app onboarding checklist + FAQ + support) ──────────────
var HELP_ARTICLES = [
 {c:'Getting started', q:'Set up your business', s:['On first login the setup wizard captures your business name, industry, address, currency and country.','Each business you add is its own set of books; the dashboard consolidates them.','You can reopen this Help Center anytime from the sidebar.']},
 {c:'Getting started', q:'Read your dashboard', s:['Revenue, Expenses, Net profit and Outstanding show your live position for the selected period.','Use the period switcher to view month, quarter or year.','Investments are tracked separately from the books.']},
 {c:'Businesses & entities', q:'Add another business (entity)', s:['Sidebar → Account → Entities → add a business.','Set its name, currency and country — the timezone is inferred automatically.','Switch the active business from the entity picker at the top.']},
 {c:'Businesses & entities', q:'See all businesses combined', s:['Switch the entity picker to the consolidated view.','FinFlow converts each business to your base currency at each transaction’s own FX rate — no double-counting.']},
 {c:'Invoices & income', q:'Create an invoice', s:['Sidebar → Invoices → + New invoice.','Pick the customer, add line items, set issue and due dates.','Save — it posts to your books and shows in Outstanding until paid.']},
 {c:'Invoices & income', q:'Record a payment', s:['Open the invoice → Record payment.','Enter the amount and date; partial payments are supported.','Outstanding updates automatically.']},
 {c:'Invoices & income', q:'Send a pay link', s:['On an invoice choose Pay link to generate a hosted checkout via a connected processor.','Share the link; when it is paid it reconciles against the invoice.']},
 {c:'Invoices & income', q:'Set up recurring invoices', s:['Sidebar → Recurring invoices.','Choose the customer, amount and cadence; FinFlow issues each on schedule and logs it in the audit trail.']},
 {c:'Expenses & bills', q:'Log an expense', s:['Sidebar → Expenses → add the amount, category and date.','Or use Scan receipt to pull the vendor, amount and date from a photo or PDF.']},
 {c:'Expenses & bills', q:'Add and pay a bill', s:['Sidebar → Bills → + New for a supplier bill (accounts payable).','When you pay it, record a payment against the bill — that settles AP, it is not a second expense.']},
 {c:'Payroll', q:'Run payroll', s:['Sidebar → Payroll → add employees.','Create a run for the period, review gross/bonus/overtime, then Approve.','Approved runs post to the books; Mark paid records the cash-out. A paid run can’t be reverted.']},
 {c:'Banking & reconciliation', q:'Connect a bank feed', s:['Sidebar → Banking → Link bank (Plaid for US/CA/UK/EU, Belvo for Latin America).','No coverage in your country? Use Import to upload an OFX/QFX/CSV statement from any bank.']},
 {c:'Banking & reconciliation', q:'Reconcile transactions', s:['Banking → Reconcile.','Match feed or imported lines to invoices, bills and expenses; matched items post to the books once, never twice.']},
 {c:'Inventory', q:'Track inventory & COGS', s:['Sidebar → Inventory → add items with a unit cost.','Record purchases and sales as movements; FinFlow computes FIFO cost of goods sold automatically.']},
 {c:'Reports, GL & tax', q:'View P&L and Balance Sheet', s:['Sidebar → Reports → generate the Profit & Loss or Balance Sheet for any period.','They read from the double-entry ledger, so they always tie out.']},
 {c:'Reports, GL & tax', q:'Confirm your books are balanced', s:['Reports show a books-balanced signal when the trial balance ties to zero.','If anything ever diverges, the reconcile monitor flags it for you.']},
 {c:'Reports, GL & tax', q:'Estimate income tax', s:['Reports → Tax uses your saved rate against taxable profit.','Set your rate in Settings; tax paid stays “not tracked” unless you record payments.']},
 {c:'Importing & migrating', q:'Import from QuickBooks or Xero', s:['Sidebar → API connections → Codat → Import books.','Preview shows what will import; confirm to write it.','FinFlow then verifies the trial balance ties — proof your books came over clean.']},
 {c:'Importing & migrating', q:'Import a CSV export', s:['Invoices page → Import CSV (invoices; expenses, bills, customers and vendors are supported too).','Columns are auto-detected, and re-importing the same file is safely de-duplicated.']},
 {c:'Working with your accountant', q:'Invite your accountant', s:['Sidebar → My accountant → invite by email, or find one in the directory.','Grant per-entity access; they review your books in their own portal.']},
 {c:'Working with your accountant', q:'Message your accountant', s:['Open My accountant → use the built-in chat.','Messages are private to your relationship and visible on both sides.']},
 {c:'Account & security', q:'Turn on two-factor auth (2FA)', s:['Sidebar → Settings → Two-factor authentication → Enable 2FA.','Scan the code with an authenticator app and confirm.']},
 {c:'Account & security', q:'Add team members & roles', s:['Sidebar → Account → Team & roles → invite by email.','Grant each member specific businesses and a role; access is enforced per entity.']},
 {c:'Account & security', q:'Lock a closed period', s:['Sidebar → Transaction locking → set a lock date per business.','Entries on or before that date can no longer be changed.']},
 {c:'Account & security', q:'Export or delete your data', s:['Settings → Your data → Download my data for a full export.','Danger Zone → delete your account permanently erases your data, including the ledger.']}
];
var _helpEsc = function(x){ return String(x==null?'':x).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };

// Category → destination page + a small inline icon (16x16 viewBox inner markup).
var HELP_CAT_META = {
  'Getting started':            {p:'dashboard',    i:'<path d="M2 8a6 6 0 1112 0 6 6 0 01-12 0z"/><path d="M8 5v3l2 1.5"/>'},
  'Businesses & entities':      {p:'entities',     i:'<rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>'},
  'Invoices & income':          {p:'invoices',     i:'<rect x="3" y="1.5" width="10" height="13" rx="1.2"/><line x1="5.5" y1="5" x2="10.5" y2="5"/><line x1="5.5" y1="8" x2="10.5" y2="8"/><line x1="5.5" y1="11" x2="8.5" y2="11"/>'},
  'Expenses & bills':           {p:'expenses',     i:'<circle cx="8" cy="8" r="6.2"/><path d="M8 4.5v7M6.2 9.6c0 .9.8 1.4 1.8 1.4s1.8-.5 1.8-1.4S8.9 8.2 8 8.2s-1.8-.6-1.8-1.4S7.1 5 8 5s1.8.5 1.8 1.4"/>'},
  'Payroll':                    {p:'payroll',      i:'<circle cx="6" cy="5" r="2.4"/><path d="M1.5 13c0-2.7 2.2-4.6 4.5-4.6"/><path d="M9.8 9.2l1.6 1.6 2.8-2.8"/>'},
  'Banking & reconciliation':   {p:'banking',      i:'<path d="M1.5 6L8 2l6.5 4"/><rect x="3" y="6.5" width="2.2" height="5.5"/><rect x="6.9" y="6.5" width="2.2" height="5.5"/><rect x="10.8" y="6.5" width="2.2" height="5.5"/><line x1="1.5" y1="12.5" x2="14.5" y2="12.5"/>'},
  'Inventory':                  {p:'inventory',    i:'<path d="M8 1.6l6 3v7l-6 3-6-3v-7z"/><path d="M2 4.6l6 3 6-3M8 7.6v6.4"/>'},
  'Reports, GL & tax':          {p:'reports',      i:'<rect x="1.5" y="1.5" width="13" height="13" rx="1.2"/><polyline points="4,11 6.5,6.5 9.5,8.5 12,4.5"/>'},
  'Importing & migrating':      {p:'connections',  i:'<path d="M4 6l-2.5 2L4 10"/><path d="M12 6l2.5 2L12 10"/><line x1="6.5" y1="12" x2="9.5" y2="4"/>'},
  'Working with your accountant':{p:'my-accountant',i:'<circle cx="8" cy="5" r="2.6"/><path d="M2.5 13.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>'},
  'Account & security':         {p:'settings',     i:'<path d="M8 1.5l5 2v4c0 3.2-2.2 5.6-5 6.5-2.8-.9-5-3.3-5-6.5v-4z"/><path d="M5.8 8l1.6 1.6 3-3.2"/>'}
};
var HELP_ARTICLE_TOURS = {
  'Create an invoice':'create-invoice','Log an expense':'log-expense','Run payroll':'run-payroll',
  'Connect a bank feed':'connect-bank','Add another business (entity)':'add-entity','Reconcile transactions':'reconcile'
};

// ── Guided tours — spotlight + tooltip walkthroughs on the real UI ─────────────
var HELP_TOURS = {
  'create-invoice': { title:'Create an invoice', steps:[
    {page:'invoices', sel:".nav-item[onclick^=\"showPage('invoices'\"]", title:'Open Invoices', body:'Invoices lives here in the sidebar \u2014 every bill you send is created and tracked from this page.'},
    {page:'invoices', sel:'button[onclick="openInvoiceModal()"]', title:'Start a new invoice', body:'Click \u201c+ New invoice\u201d, choose the customer, add line items, and set the issue and due dates.'},
    {page:'invoices', sel:null, title:'Save & get paid', body:'Saving posts it to your books and shows it in Outstanding until paid. Use \u201cRecord payment\u201d or a pay link when it settles.'}
  ]},
  'log-expense': { title:'Log an expense', steps:[
    {page:'expenses', sel:".nav-item[onclick^=\"showPage('expenses'\"]", title:'Open Expenses', body:'Track money going out here. Bills to suppliers (accounts payable) live on the Bills page instead.'},
    {page:'expenses', sel:'button[onclick="openExpenseModal()"]', title:'Add an expense', body:'Enter the amount, category and date \u2014 or use Scan receipt to auto-extract the vendor, amount and date from a photo or PDF.'}
  ]},
  'run-payroll': { title:'Run payroll', steps:[
    {page:'payroll', sel:'#nav-payroll', title:'Open Payroll', body:'Add your employees here, then create a pay run for the period.'},
    {page:'payroll', sel:null, title:'Approve, then pay', body:'Review gross, bonus and overtime, then Approve \u2014 that posts to the books. \u201cMark paid\u201d records the cash-out; a paid run can\u2019t be reverted.'}
  ]},
  'connect-bank': { title:'Connect a bank feed', steps:[
    {page:'banking', sel:".nav-item[onclick^=\"showPage('banking'\"]", title:'Open Banking', body:'Link a live bank feed (Plaid for US/CA/UK/EU, Belvo for Latin America).'},
    {page:'banking', sel:null, title:'No coverage? Import instead', body:'Upload an OFX/QFX/CSV statement from any bank \u2014 the transactions flow into the same place as a live feed.'}
  ]},
  'add-entity': { title:'Add another business', steps:[
    {page:'entities', sel:'button[onclick="openAddBizModal(event)"]', title:'Add a business', body:'Each business is its own set of books. Add one with its name, currency and country \u2014 the timezone is inferred automatically.'},
    {page:'entities', sel:null, title:'Consolidate them', body:'Switch the entity picker to the consolidated view to see every business combined in your base currency, converted at each transaction\u2019s own FX rate.'}
  ]},
  'reconcile': { title:'Reconcile transactions', steps:[
    {page:'banking', sel:'button[onclick="openReconcileModal()"]', title:'Open Reconcile', body:'Match feed or imported lines against your invoices, bills and expenses.'},
    {page:'banking', sel:null, title:'Matched once, never twice', body:'A matched item posts to the books a single time \u2014 reconciliation never double-counts.'}
  ]}
};
(function ensureTourStyle(){
  if(document.getElementById('tour-style')) return;
  var s=document.createElement('style'); s.id='tour-style';
  s.textContent='.tour-dim{position:fixed;inset:0;z-index:1400;background:transparent}'
    +'.tour-ring{position:fixed;z-index:1401;border-radius:9px;box-shadow:0 0 0 9999px rgba(8,6,4,.66),0 0 0 2px var(--acc);transition:all .22s ease;pointer-events:none}'
    +'.tour-tip{position:fixed;z-index:1402;max-width:310px;background:var(--bg1);border:1px solid var(--bd2);border-radius:13px;padding:16px 17px;box-shadow:0 16px 50px rgba(0,0,0,.6)}'
    +'.tour-tip h4{margin:0 0 6px;font-size:14.5px;color:var(--t1);font-weight:600}'
    +'.tour-tip p{margin:0 0 13px;font-size:12.7px;color:var(--t2);line-height:1.55}'
    +'.tour-tip .tr{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    +'.tour-dot{display:flex;gap:4px}.tour-dot i{width:5px;height:5px;border-radius:50%;background:var(--bd2)}.tour-dot i.on{background:var(--acc)}';
  document.head.appendChild(s);
})();
window.startTour = function(id){
  var t=HELP_TOURS[id]; if(!t) return;
  var i=0, dim=null, ring=null, tip=null;
  function clean(){ [dim,ring,tip].forEach(function(n){ if(n&&n.parentNode) n.parentNode.removeChild(n); }); document.removeEventListener('keydown',key); }
  function key(e){ if(e.key==='Escape') clean(); else if(e.key==='ArrowRight') go(1); else if(e.key==='ArrowLeft') go(-1); }
  function go(d){ i+=d; if(i<0)i=0; if(i>=t.steps.length){ clean(); return; } render(); }
  function render(){
    var step=t.steps[i];
    if(step.page && window.showPage){ try{ window.showPage(step.page); }catch(e){} }
    setTimeout(function(){ place(step); }, step.page?280:0);
  }
  function place(step){
    if(!dim){ dim=document.createElement('div'); dim.className='tour-dim'; dim.onclick=clean; document.body.appendChild(dim); }
    if(!ring){ ring=document.createElement('div'); ring.className='tour-ring'; document.body.appendChild(ring); }
    if(!tip){ tip=document.createElement('div'); tip.className='tour-tip'; document.body.appendChild(tip); }
    var el=step.sel?document.querySelector(step.sel):null, r=null;
    if(el){ try{ el.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){} r=el.getBoundingClientRect(); }
    if(r && r.width){ ring.style.display='block'; ring.style.left=(r.left-6)+'px'; ring.style.top=(r.top-6)+'px'; ring.style.width=(r.width+12)+'px'; ring.style.height=(r.height+12)+'px'; }
    else { ring.style.display='none'; }
    var dots=t.steps.map(function(_,k){ return '<i class="'+(k===i?'on':'')+'"></i>'; }).join('');
    var last=i===t.steps.length-1;
    tip.innerHTML='<h4>'+_helpEsc(step.title)+'</h4><p>'+_helpEsc(step.body)+'</p>'
      +'<div class="tr"><span class="tour-dot">'+dots+'</span><span style="display:flex;gap:6px">'
      +(i>0?'<button class="btn btn-ghost btn-sm" id="tour-back">Back</button>':'')
      +'<button class="btn btn-primary btn-sm" id="tour-next">'+(last?'Done':'Next')+'</button></span></div>';
    // position tooltip: below the ring if room, else centered
    var tw=310, th=tip.offsetHeight||150, vw=window.innerWidth, vh=window.innerHeight, L, T;
    if(r && r.width){ T=r.bottom+12; if(T+th>vh-10) T=Math.max(10,r.top-th-12); L=Math.min(Math.max(10,r.left), vw-tw-10); }
    else { L=(vw-tw)/2; T=(vh-th)/2; }
    tip.style.left=L+'px'; tip.style.top=T+'px';
    var nb=document.getElementById('tour-next'); if(nb) nb.onclick=function(){ go(1); };
    var bb=document.getElementById('tour-back'); if(bb) bb.onclick=function(){ go(-1); };
  }
  document.addEventListener('keydown',key);
  render();
};

// ── Ask FinFlow — grounded AI help ─────────────────────────────────────────────
function _helpLinkChips(links){
  if(!links||!links.length) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">'+links.map(function(l){
    return '<button class="btn btn-ghost btn-sm" onclick="if(window.showPage)window.showPage(\''+l.page+'\')">'+_helpEsc(l.label)+' \u2192</button>';
  }).join('')+'</div>';
}
// Threaded, multi-turn conversation state (survives navigation; cleared by "New chat").
var _helpConvo=[];
function _helpRenderThread(){
  var t=document.getElementById('help-ask-thread'); if(!t) return;
  if(!_helpConvo.length){ t.innerHTML='<div style="color:var(--t3);font-size:12.5px;padding:6px 2px">Ask anything about using FinFlow \u2014 e.g. \u201chow do I consolidate my two businesses?\u201d It remembers the conversation, so you can follow up.</div>'; return; }
  var html=_helpConvo.map(function(m){
    if(m.role==='user') return '<div style="text-align:right;margin:8px 0"><span style="display:inline-block;background:var(--acc);color:#16120d;border-radius:12px 12px 3px 12px;padding:8px 11px;font-size:12.7px;max-width:85%;text-align:left">'+_helpEsc(m.content)+'</span></div>';
    if(m.role==='assistant') return '<div style="margin:8px 0"><div style="display:inline-block;background:var(--bg3);border:1px solid var(--bd);border-radius:12px 12px 12px 3px;padding:9px 12px;font-size:12.9px;color:var(--t1);line-height:1.55;white-space:pre-wrap;max-width:92%">'+_helpEsc(m.content)+'</div>'+(m.links?_helpLinkChips(m.links):'')+'</div>';
    return '<div style="margin:8px 0;font-size:12px;color:var(--green);background:var(--green-bg);border:1px solid var(--green-bd);border-radius:8px;padding:8px 11px">'+_helpEsc(m.content)+'</div>';
  }).join('');
  var hasAnswer=_helpConvo.some(function(m){return m.role==='assistant'&&!m.pending;});
  if(hasAnswer) html+='<div style="display:flex;justify-content:flex-end;margin-top:4px"><button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="window.helpEscalate(this)">Still need help? Send this to support \u2192</button></div>';
  t.innerHTML=html; t.scrollTop=t.scrollHeight;
}
window.helpNewChat=function(){ _helpConvo=[]; _helpRenderThread(); var i=document.getElementById('help-ask-input'); if(i)i.value=''; };
window.helpAsk=function(q){
  var input=document.getElementById('help-ask-input');
  var question=(q!=null?q:(input?input.value:''))||''; question=String(question).trim();
  if(!question) return;
  if(input) input.value='';
  var history=_helpConvo.filter(function(m){return m.role==='user'||m.role==='assistant';}).map(function(m){return {role:m.role,content:m.content};});
  _helpConvo.push({role:'user',content:question});
  _helpConvo.push({role:'assistant',content:'Thinking\u2026',pending:true});
  _helpRenderThread();
  fetch('/api/help/ask',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({question:question,history:history})})
    .then(function(r){ return r.json().catch(function(){return {};}); })
    .then(function(d){
      _helpConvo=_helpConvo.filter(function(m){return !m.pending;});
      if(d&&d.reply){ _helpConvo.push({role:'assistant',content:d.reply,links:d.links}); }
      else { _helpConvo.push({role:'assistant',content:(d&&d.message)||(d&&d.error)||'Here are the guides that match your question.',links:d&&d.links}); }
      _helpRenderThread();
    })
    .catch(function(){ _helpConvo=_helpConvo.filter(function(m){return !m.pending;}); _helpConvo.push({role:'assistant',content:'Couldn\u2019t reach help right now \u2014 try the guides below or contact us.'}); _helpRenderThread(); });
};
window.helpEscalate=function(btn){
  var turns=_helpConvo.filter(function(m){return (m.role==='user'||m.role==='assistant')&&!m.pending;});
  if(!turns.length) return;
  var transcript=turns.map(function(m){ return (m.role==='user'?'You: ':'Ask FinFlow: ')+m.content; }).join('\n\n');
  if(btn){ btn.disabled=true; btn.textContent='Sending\u2026'; }
  fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({subject:'Help request (via Ask FinFlow)',message:'[Escalated from the Ask FinFlow assistant]\n\n'+transcript,category:'ai-escalation'})})
    .then(function(r){ return r.ok?r.json():Promise.reject(); })
    .then(function(){ _helpConvo.push({role:'system',content:'\u2713 Sent to support with this conversation \u2014 we\u2019ll reply by email. Track it under \u201cYour requests\u201d below.'}); _helpRenderThread(); if(typeof renderTickets==='function') renderTickets(); })
    .catch(function(){ if(btn){ btn.disabled=false; btn.textContent='Still need help? Send this to support \u2192'; } if(typeof notify==='function') notify('Could not send \u2014 please use the contact form below.',true); });
};
function renderAskPanel(){
  var el=document.getElementById('help-ask'); if(!el) return;
  el.innerHTML='<div style="background:linear-gradient(180deg,var(--acc-bg),var(--bg1));border:1px solid var(--bd2);border-radius:14px;padding:16px 17px">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px"><svg viewBox="0 0 16 16" style="width:16px;height:16px;fill:var(--acc)"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z"/></svg><span style="font-family:var(--font-display);font-style:italic;font-size:18px;color:var(--acc-light)">Ask FinFlow</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="window.helpNewChat()">New chat</button></div>'
    +'<div id="help-ask-thread" style="max-height:340px;overflow-y:auto;margin-bottom:10px"></div>'
    +'<div style="display:flex;gap:8px"><input id="help-ask-input" placeholder="Ask a question\u2026" autocomplete="off" style="flex:1;box-sizing:border-box;background:var(--bg2);border:1px solid var(--bd);border-radius:9px;color:var(--t1);padding:10px 12px;font-size:13px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.helpAsk();}">'
    +'<button class="btn btn-primary btn-sm" onclick="window.helpAsk()">Ask</button></div></div>';
  _helpRenderThread();
}

// ── Getting-started checklist (live from real data) ─────────────────────────────
function renderChecklist(){
  var el=document.getElementById('help-checklist'); if(!el) return;
  el.innerHTML='<div style="color:var(--t3);font-size:12px;padding:4px 2px">Loading your setup progress\u2026</div>';
  fetch('/api/help/progress',{credentials:'include'}).then(function(r){ return r.ok?r.json():null; }).then(function(d){
    if(!d||!d.steps){ el.innerHTML=''; return; }
    var pct=Math.round((d.completed/d.total)*100);
    var rows=d.steps.map(function(s){
      var check=s.done
        ? '<svg viewBox="0 0 16 16" style="width:17px;height:17px;flex-shrink:0"><circle cx="8" cy="8" r="8" fill="var(--acc)"/><path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="#16120d" stroke-width="1.6"/></svg>'
        : '<svg viewBox="0 0 16 16" style="width:17px;height:17px;flex-shrink:0"><circle cx="8" cy="8" r="7.2" fill="none" stroke="var(--bd2)" stroke-width="1.4"/></svg>';
      var action=s.done
        ? '<span style="font-size:11px;color:var(--acc)">Done</span>'
        : (s.tour
            ? '<button class="btn btn-ghost btn-sm" onclick="window.startTour(\''+s.tour+'\')">Show me how</button>'
            : '<button class="btn btn-ghost btn-sm" onclick="if(window.showPage)window.showPage(\''+s.page+'\')">Open \u2192</button>');
      return '<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid var(--bd)">'+check
        +'<span style="flex:1;font-size:13px;color:'+(s.done?'var(--t2)':'var(--t1)')+';'+(s.done?'text-decoration:line-through;text-decoration-color:var(--t3)':'')+'">'+_helpEsc(s.label)+'</span>'+action+'</div>';
    }).join('');
    var head=d.allDone
      ? '<div style="font-size:13px;color:var(--acc-light)">You\u2019re all set \u2014 every setup step is complete. \u2728</div>'
      : '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc)">Getting started \u00b7 '+d.completed+' of '+d.total+'</span><span style="font-size:11px;color:var(--t3)">'+pct+'%</span></div>'
        +'<div style="height:5px;background:var(--bg3);border-radius:3px;margin:8px 0 2px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:var(--acc);border-radius:3px;transition:width .4s"></div></div>';
    el.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:16px 17px">'+head+rows+'</div>';
  }).catch(function(){ el.innerHTML=''; });
}

// ── My tickets (the caller's own support requests) ──────────────────────────────
function renderTickets(){
  var el=document.getElementById('help-tickets'); if(!el) return;
  fetch('/api/support',{credentials:'include'}).then(function(r){ return r.ok?r.json():null; }).then(function(d){
    if(!d||!d.requests||!d.requests.length){ el.innerHTML=''; return; }
    var rows=d.requests.slice(0,10).map(function(t){
      var open=(t.status||'open')==='open';
      var badge='<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:'+(open?'var(--amber-bg)':'var(--green-bg)')+';color:'+(open?'var(--amber)':'var(--green)')+'">'+(open?'Open':'Resolved')+'</span>';
      var when=t.created_at?new Date(t.created_at).toLocaleDateString():'';
      var resp=t.response?'<div style="margin-top:7px;padding:8px 10px;background:var(--bg2);border-left:2px solid var(--acc);border-radius:5px;font-size:12px;color:var(--t2);white-space:pre-wrap">'+_helpEsc(t.response)+'</div>':'';
      return '<div style="padding:11px 0;border-top:1px solid var(--bd)"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:13px;color:var(--t1)">'+_helpEsc(t.subject||'(no subject)')+'</span>'+badge+'</div>'
        +'<div style="font-size:11.5px;color:var(--t3);margin-top:2px">'+_helpEsc(t.category||'general')+' \u00b7 '+when+'</div>'+resp+'</div>';
    }).join('');
    el.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:16px 17px"><div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin-bottom:2px">Your requests</div>'+rows+'</div>';
  }).catch(function(){ el.innerHTML=''; });
}

// ── Category cards + article accordion ──────────────────────────────────────────
function renderCats(filterCat){
  var root=document.getElementById('help-cats'); if(!root) return;
  var cats=[], byCat={};
  HELP_ARTICLES.forEach(function(a){ if(!byCat[a.c]){ byCat[a.c]=[]; cats.push(a.c); } byCat[a.c].push(a); });
  // category chips
  var chips='<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:20px">'
    +'<button class="help-chip btn btn-'+(!filterCat?'primary':'ghost')+' btn-sm" onclick="window._helpFilterCat(\'\')">All</button>'
    +cats.map(function(c){
      var m=HELP_CAT_META[c]||{i:''};
      return '<button class="help-chip btn btn-'+(filterCat===c?'primary':'ghost')+' btn-sm" onclick="window._helpFilterCat(\''+c.replace(/'/g,"\\'")+'\')"><svg viewBox="0 0 16 16" style="width:12px;height:12px;vertical-align:-1px;margin-right:5px;fill:none;stroke:currentColor;stroke-width:1.3">'+m.i+'</svg>'+_helpEsc(c)+'</button>';
    }).join('')+'</div>';
  var shown=filterCat?[filterCat]:cats;
  var body=shown.map(function(cat){
    var m=HELP_CAT_META[cat]||{i:'',p:'help'};
    var items=byCat[cat].map(function(a){
      var steps=a.s.map(function(st){ return '<li style="margin:4px 0">'+_helpEsc(st)+'</li>'; }).join('');
      var rel=byCat[cat].filter(function(x){ return x!==a; }).slice(0,2).map(function(x){
        return '<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="window._helpOpenArticle(\''+_helpSlug(x.q)+'\')">'+_helpEsc(x.q)+'</button>'; }).join('');
      var tour=HELP_ARTICLE_TOURS[a.q];
      var actions='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">'
        +(tour?'<button class="btn btn-primary btn-sm" onclick="event.preventDefault();window.startTour(\''+tour+'\')">\u25b6 Show me how</button>':'')
        +'<button class="btn btn-ghost btn-sm" onclick="event.preventDefault();if(window.showPage)window.showPage(\''+m.p+'\')">Open '+_helpEsc(cat.split(/[ ,&]/)[0])+' \u2192</button></div>';
      var relBlock=rel?'<div style="margin-top:10px"><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-bottom:5px">Related</div><div style="display:flex;flex-wrap:wrap;gap:6px">'+rel+'</div></div>':'';
      return '<details class="help-art" id="art-'+_helpSlug(a.q)+'" data-text="'+_helpEsc((cat+' '+a.q+' '+a.s.join(' ')).toLowerCase())+'" style="border-top:1px solid var(--bd);padding:10px 0">'
        +'<summary style="cursor:pointer;font-size:13.5px;color:var(--t1);font-weight:500;list-style:none">'+_helpEsc(a.q)+'</summary>'
        +'<ol style="margin:9px 0 2px;padding-left:20px;color:var(--t2);font-size:12.7px;line-height:1.6">'+steps+'</ol>'+actions+relBlock+'</details>';
    }).join('');
    return '<div class="help-cat" style="background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:6px 17px 12px;margin-bottom:14px">'
      +'<div style="display:flex;align-items:center;gap:9px;padding:12px 0 4px"><span style="display:inline-flex;width:30px;height:30px;border-radius:8px;background:var(--acc-bg);align-items:center;justify-content:center"><svg viewBox="0 0 16 16" style="width:16px;height:16px;fill:none;stroke:var(--acc);stroke-width:1.3">'+m.i+'</svg></span>'
      +'<span style="font-family:var(--font-display);font-size:18px;color:var(--t1)">'+_helpEsc(cat)+'</span></div>'+items+'</div>';
  }).join('');
  root.innerHTML=chips+body;
}
function _helpSlug(q){ return String(q).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
window._helpFilterCat=function(c){ renderCats(c); };
window._helpOpenArticle=function(slug){
  renderCats('');
  setTimeout(function(){ var d=document.getElementById('art-'+slug); if(d){ d.setAttribute('open','open'); d.scrollIntoView({block:'center',behavior:'smooth'}); } },40);
};

// contact form (reuses /api/support)
function wireContact(){
  var cel=document.getElementById('help-contact'); if(!cel || cel.getAttribute('data-wired')) return;
  cel.setAttribute('data-wired','1');
  cel.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:16px 17px"><div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin-bottom:8px">Still stuck? Contact us</div>'
    +'<input id="hc-subject" placeholder="Subject" style="width:100%;box-sizing:border-box;background:var(--bg2);border:1px solid var(--bd);border-radius:7px;color:var(--t1);padding:9px 11px;font-size:13px;margin-bottom:8px">'
    +'<textarea id="hc-msg" placeholder="How can we help?" style="width:100%;box-sizing:border-box;min-height:90px;resize:vertical;background:var(--bg2);border:1px solid var(--bd);border-radius:7px;color:var(--t1);padding:9px 11px;font-size:13px"></textarea>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px"><span style="font-size:11.5px;color:var(--t3)">or email <a href="mailto:support@finflow.app" style="color:var(--acc)">support@finflow.app</a></span><button id="hc-send" class="btn btn-primary btn-sm">Send message</button></div>'
    +'<div id="hc-status" style="font-size:12px;margin-top:6px"></div></div>';
  var btn=document.getElementById('hc-send');
  if(btn) btn.onclick=async function(){
    var subj=(document.getElementById('hc-subject')||{}).value||'';
    var msg=(document.getElementById('hc-msg')||{}).value||'';
    var st=document.getElementById('hc-status');
    if(!msg.trim()){ if(st){ st.style.color='var(--red)'; st.textContent='Please add a message.'; } return; }
    btn.disabled=true; btn.textContent='Sending\u2026';
    try{
      var r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({subject:subj,message:msg,category:'help-center'})});
      if(!r.ok){ var j=await r.json().catch(function(){return {};}); if(st){ st.style.color='var(--red)'; st.textContent=j.error||'Could not send \u2014 please email us instead.'; } btn.disabled=false; btn.textContent='Send message'; return; }
      if(st){ st.style.color='var(--green)'; st.textContent='Sent \u2713 We\u2019ll reply by email.'; }
      var s1=document.getElementById('hc-subject'), m1=document.getElementById('hc-msg'); if(s1)s1.value=''; if(m1)m1.value='';
      btn.textContent='Sent \u2713';
      renderTickets();
    }catch(e){ if(st){ st.style.color='var(--red)'; st.textContent='Network error \u2014 please email us instead.'; } btn.disabled=false; btn.textContent='Send message'; }
  };
}

// search filter
function wireSearch(){
  var sb=document.getElementById('help-search'); if(!sb || sb.getAttribute('data-wired')) return;
  sb.setAttribute('data-wired','1');
  sb.addEventListener('input',function(){
    var q=sb.value.trim().toLowerCase(); var any=false;
    if(q) window._helpFilterCat('');
    document.querySelectorAll('#help-cats .help-art').forEach(function(el){ var m=!q||el.getAttribute('data-text').indexOf(q)>=0; el.style.display=m?'':'none'; if(m)any=true; if(q&&m)el.setAttribute('open','open'); if(!q)el.removeAttribute('open'); });
    document.querySelectorAll('#help-cats .help-cat').forEach(function(cat){ var vis=[].some.call(cat.querySelectorAll('.help-art'),function(a){return a.style.display!=='none';}); cat.style.display=vis?'':'none'; });
    var em=document.getElementById('help-empty'); if(em) em.style.display=(q&&!any)?'':'none';
  });
}

window.renderHelpCenter = function(){
  if(!document.getElementById('help-cats')) return;
  renderAskPanel(); renderChecklist(); renderCats(''); renderTickets(); wireContact(); wireSearch();
};

// ── Cmd/Ctrl-K command palette — search help + jump to any page ──────────────────
var HELP_PALETTE_PAGES=[
  ['dashboard','Dashboard'],['invoices','Invoices'],['expenses','Expenses'],['bills','Bills'],['payroll','Payroll'],
  ['banking','Banking'],['bank-rec','Bank reconciliation'],['reports','Reports'],['inventory','Inventory'],['entities','Businesses'],
  ['customers','Customers'],['vendors','Vendors'],['quotes','Quotes'],['items','Items & products'],['projects','Projects'],
  ['timesheet','Timesheets'],['budget','Budget'],['chart-of-accounts','Chart of accounts'],['manual-journals','Manual journals'],
  ['connections','API connections'],['my-accountant','My accountant'],['team','Team & roles'],['transaction-locking','Transaction locking'],
  ['settings','Settings'],['help','Help Center']
];
window.openHelpPalette=function(){
  if(document.getElementById('help-palette')) return;
  var ov=document.createElement('div'); ov.id='help-palette';
  ov.style.cssText='position:fixed;inset:0;z-index:1500;background:rgba(8,6,4,.55);display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px';
  ov.innerHTML='<div style="width:100%;max-width:560px;background:var(--bg1);border:1px solid var(--bd2);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden">'
    +'<input id="hp-input" placeholder="Search help or jump to a page\u2026" autocomplete="off" style="width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid var(--bd);color:var(--t1);padding:15px 17px;font-size:15px;outline:none">'
    +'<div id="hp-results" style="max-height:52vh;overflow:auto;padding:6px"></div></div>';
  document.body.appendChild(ov);
  ov.onclick=function(e){ if(e.target===ov) close(); };
  var input=document.getElementById('hp-input'), results=document.getElementById('hp-results'), sel=0, items=[];
  function close(){ if(ov.parentNode) ov.parentNode.removeChild(ov); document.removeEventListener('keydown',key); }
  function build(q){
    q=(q||'').trim().toLowerCase(); items=[];
    if(q){ items.push({t:'\u2728 Ask FinFlow: \u201c'+q+'\u201d',act:function(){ close(); if(window.showPage)window.showPage('help'); setTimeout(function(){ window.helpAsk(q); var ap=document.getElementById('help-ask'); if(ap)ap.scrollIntoView({block:'center'}); },60); },tag:'AI'}); }
    HELP_ARTICLES.forEach(function(a){ var hay=(a.c+' '+a.q+' '+a.s.join(' ')).toLowerCase(); if(!q||hay.indexOf(q)>=0) items.push({t:a.q,sub:a.c,act:function(){ close(); if(window.showPage)window.showPage('help'); setTimeout(function(){ window._helpOpenArticle(_helpSlug(a.q)); },60); },tag:'Guide'}); });
    HELP_PALETTE_PAGES.forEach(function(p){ if(!q||p[1].toLowerCase().indexOf(q)>=0) items.push({t:p[1],act:function(){ close(); if(window.showPage)window.showPage(p[0]); },tag:'Page'}); });
    items=items.slice(0,40); sel=0; paint();
  }
  function paint(){
    results.innerHTML=items.map(function(it,k){
      return '<div class="hp-row" data-k="'+k+'" style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;cursor:pointer;'+(k===sel?'background:var(--acc-bg)':'')+'">'
        +'<span style="flex:1;font-size:13.5px;color:var(--t1)">'+_helpEsc(it.t)+(it.sub?' <span style=\"color:var(--t3);font-size:11.5px\">\u00b7 '+_helpEsc(it.sub)+'</span>':'')+'</span>'
        +'<span style="font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);border:1px solid var(--bd);border-radius:5px;padding:2px 6px">'+it.tag+'</span></div>';
    }).join('')||'<div style="padding:14px;color:var(--t3);font-size:13px">No matches.</div>';
    [].forEach.call(results.querySelectorAll('.hp-row'),function(row){ row.onclick=function(){ var it=items[+row.getAttribute('data-k')]; if(it&&it.act) it.act(); }; });
  }
  function key(e){
    if(e.key==='Escape'){ close(); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); sel=Math.min(items.length-1,sel+1); paint(); var r=results.querySelector('.hp-row[data-k="'+sel+'"]'); if(r)r.scrollIntoView({block:'nearest'}); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); sel=Math.max(0,sel-1); paint(); var r2=results.querySelector('.hp-row[data-k="'+sel+'"]'); if(r2)r2.scrollIntoView({block:'nearest'}); }
    else if(e.key==='Enter'){ e.preventDefault(); var it=items[sel]; if(it&&it.act) it.act(); }
  }
  input.addEventListener('input',function(){ build(input.value); });
  document.addEventListener('keydown',key);
  build(''); input.focus();
};
document.addEventListener('keydown',function(e){ if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==='k'||e.key==='K')){ e.preventDefault(); window.openHelpPalette(); } });

(function(){ var _sp=window.showPage; if(_sp){ window.showPage=function(id,el){ var r=_sp.apply(this,arguments); if(id==='help'){ try{ renderHelpCenter(); }catch(e){} } return r; }; } })();

// ffHelp getting-started overlay retired — superseded by the full Help Center (page-help / renderHelpCenter).

// ── Bank statement import: upload an OFX/QFX/CSV file from any bank (incl. local banks). ──
window.ffImportStatement = function(){
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.ofx,.qfx,.csv,.txt';
  inp.onchange = function(){
    var file = inp.files && inp.files[0]; if(!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var format = (ext === 'ofx' || ext === 'qfx') ? 'ofx' : (ext === 'csv' ? 'csv' : 'ofx');
    var reader = new FileReader();
    reader.onload = async function(){
      try{
        var r = await fetch('/api/banking/import', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ format: format, content: String(reader.result || '') })});
        var j = await r.json().catch(function(){return {};});
        if(!r.ok){ if(typeof notify==='function') notify(j.error || 'Could not import the statement.', true); return; }
        if(typeof notify==='function') notify('Imported ' + j.imported + ' transaction' + (j.imported===1?'':'s') + (j.skipped ? ' (' + j.skipped + ' already there)' : '') + '.');
        if(typeof loadBankingFromDB==='function') loadBankingFromDB();
      }catch(e){ if(typeof notify==='function') notify('Network error importing the statement.', true); }
    };
    reader.readAsText(file);
  };
  inp.click();
};

// ── Direct CSV import: bring invoices/expenses/bills/customers/vendors in from a CSV export. ──
// Preview (dry-run) → confirm → commit. Money imports report whether the books tied out afterward.
window.ffImportCsv = function(type){
  type = type || 'invoices';
  var inp = document.createElement('input'); inp.type='file'; inp.accept='.csv,.txt';
  inp.onchange = function(){
    var file = inp.files && inp.files[0]; if(!file) return;
    var reader = new FileReader();
    reader.onload = async function(){
      var content = String(reader.result || '');
      try{
        var pr = await fetch('/api/import/csv', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ type: type, content: content, dryRun: true })});
        var pj = await pr.json().catch(function(){return {};});
        if(!pr.ok){ if(typeof notify==='function') notify(pj.error || 'Could not read the CSV.', true); return; }
        if(!pj.added){ if(typeof notify==='function') notify('No importable ' + type + ' rows found in that file.', true); return; }
        var okc = (typeof window._confirmModal === 'function') ? await window._confirmModal('Import ' + pj.added + ' ' + type + ' from this file?' + (pj.skipped ? (' (' + pj.skipped + ' rows skipped)') : '')) : true;
        if(!okc) return;
        var cr = await fetch('/api/import/csv', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ type: type, content: content })});
        var cj = await cr.json().catch(function(){return {};});
        if(!cr.ok){ if(typeof notify==='function') notify(cj.error || 'Import failed.', true); return; }
        var msg = 'Imported ' + cj.added + ' ' + type + (cj.duplicate ? (' (' + cj.duplicate + ' already there)') : '') + ' ✓';
        if(cj.reconcile && cj.reconcile.tiedOut) msg += ' — books verified: trial balance ties ✓';
        if(typeof notify==='function') notify(msg);
        try{ if(window.finflow && window.finflow.refresh) window.finflow.refresh(['dashboard','reports','invoices','bills','expenses','customers','vendors']); }catch(e){}
        try{ if(window.loadInvoicesFromDB) window.loadInvoicesFromDB(); }catch(e){}
      }catch(e){ if(typeof notify==='function') notify('Network error during import.', true); }
    };
    reader.readAsText(file);
  };
  inp.click();
};

// ── Invoice "Pay now" link: generate a hosted payment link via a connected processor. ──
window.ffInvoicePaymentLink = async function(invoiceId, provider){
  try{
    var r=await fetch('/api/invoices/'+invoiceId+'/payment-link',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(provider?{provider:provider}:{})});
    var j=await r.json().catch(function(){return {};});
    if(!r.ok){ if(typeof notify==='function') notify(j.error||'Could not create a payment link.', true); return null; }
    if(typeof notify==='function') notify('Payment link created ('+j.provider+').');
    try{ await navigator.clipboard.writeText(j.payment_link); if(typeof notify==='function') notify('Link copied to clipboard.'); }catch(e){}
    try{ window.open(j.payment_link,'_blank'); }catch(e){}
    return j.payment_link;
  }catch(e){ if(typeof notify==='function') notify('Network error creating payment link.', true); return null; }
};

// F185: when >1 payment processor is connected, let the user CHOOSE which generates the link
// (the button used to silently default to the first-connected = Stripe). 0 connected → honest prompt;
// exactly 1 → use it directly; >1 → small picker, then ffInvoicePaymentLink(id, chosen).
window.ffInvoicePayLinkChoose = async function(invoiceId){
  var PROVS=[['stripe','Stripe'],['wipay','WiPay'],['mercadopago','Mercado Pago'],['dlocal','dLocal']];
  var connected=[];
  await Promise.all(PROVS.map(function(pr){
    return fetch('/api/'+pr[0]+'/status',{credentials:'include'})
      .then(function(r){return r.ok?r.json():{};})
      .then(function(d){ if(d&&d.connected) connected.push(pr); })
      .catch(function(){});
  }));
  if(connected.length===0){ if(typeof notify==='function') notify('Connect a payment processor first (API connections).', true); return; }
  if(connected.length===1){ return window.ffInvoicePaymentLink(invoiceId, connected[0][0]); }
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3200;display:flex;align-items:center;justify-content:center';
  var rows=connected.map(function(pr){ return '<button data-p="'+pr[0]+'" class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;margin:4px 0">'+pr[1]+' &#8599;</button>'; }).join('');
  ov.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:12px;width:100%;max-width:320px;padding:20px">'
    +'<div style="font-family:var(--font-display);font-style:italic;font-size:17px;color:var(--acc-light);margin-bottom:4px">Choose a processor</div>'
    +'<div style="font-size:12px;color:var(--t2);margin-bottom:12px">You have more than one connected. Which should generate this payment link?</div>'
    +rows
    +'<div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="pc-cancel" class="btn btn-ghost btn-sm">Cancel</button></div></div>';
  document.body.appendChild(ov);
  var close=function(){ try{ov.remove();}catch(e){} };
  ov.querySelector('#pc-cancel').onclick=close;
  ov.onclick=function(e){ if(e.target===ov) close(); };
  ov.querySelectorAll('button[data-p]').forEach(function(b){ b.onclick=function(){ var p=b.getAttribute('data-p'); close(); window.ffInvoicePaymentLink(invoiceId, p); }; });
};

// ── Banking-page Plaid controls: real linked state + link/sync/unlink ──
window.renderPlaidLinked = async function(){
  const strip = document.getElementById('plaid-linked-strip');
  if(!strip) return;
  let d = {};
  try{
    const r = await fetch('/api/plaid/items', {credentials:'include'});
    if(r.status===401 || r.status===403){ strip.innerHTML=''; return; }
    d = await r.json().catch(()=>({}));
  }catch(e){ strip.innerHTML=''; return; }
  const items = (d && d.items) || [];
  if(!d.configured && !items.length){
    strip.innerHTML = '<div style="font-size:11.5px;color:var(--t3);padding:6px 0 10px">Bank linking isn\'t set up yet. Add your Plaid keys (PLAID_CLIENT_ID, PLAID_SECRET) to enable one-click bank linking.</div>';
    return;
  }
  if(!items.length){ strip.innerHTML=''; return; }
  strip.innerHTML = items.map(it => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--radius);margin-bottom:6px">
      <span class="badge b-green" style="font-size:10px">Linked ✓</span>
      <div style="flex:1;font-size:12.5px;color:var(--t1)">${(it.institution_name||'Bank').replace(/[<>&]/g,'')}</div>
      <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px" onclick="ffBankSync()">↻ Sync</button>
      <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;color:var(--red)" onclick="ffBankUnlink('${it.item_id}')">Unlink</button>
    </div>`).join('') + `<div style="font-size:11px;color:var(--t3);margin:2px 0 10px">Linked via Plaid (${(d.env||'sandbox')}). Sync pulls new transactions into your books.</div>`;
};
// F192/A4 — route "Link bank" by the active entity's COUNTRY to the provider that serves it, falling
// back to whichever aggregator is actually configured, and finally to manual statement import (always
// available via the ⬆ Import button). No dishonest "coming soon" — an unserved region is told plainly
// to use Import. Belvo covers Latin America; Plaid covers US/CA/UK/EU.
window.ffBankLinkFromPage = async function(){
  const ent = (window.ENTITIES||[]).find(e=>e.active) || (window.ENTITIES||[])[0] || {};
  const country = String(ent.country||'').toUpperCase();
  // Region markets. BELVO = LatAm; PLAID = US/CA/UK + EU open-banking (per Plaid's supported-country
  // list). A country outside BOTH (e.g. TT and most of the Caribbean) has no aggregator → manual only.
  const BELVO_MARKETS = ['MX','BR','CO','AR','CL','PE','EC','BO','PY','UY','VE','GT','CR','PA','DO'];
  const PLAID_MARKETS = ['US','CA','GB','AT','BE','DK','EE','FI','FR','DE','IE','IT','LV','LT','NL','NO','PL','PT','ES','SE'];
  const onDone = ()=>{ try{ renderPlaidLinked(); }catch(e){} if(typeof loadBankingFromDB==='function') loadBankingFromDB(); };
  const cfg = async (path, key) => { try{ return !!(await (await fetch(path,{credentials:'include'})).json())[key]; }catch(e){ return false; } };
  const manual = (why) => { if(typeof notify==='function') notify(why, true); };
  const IMPORT = ' — use “⬆ Import” to add an OFX/QFX/CSV statement from any bank.';
  // REGION-STRICT: a country uses ONLY its own region's aggregator. Never the wrong-region provider —
  // pointing a Belvo-market bank at Plaid (or a Plaid-market bank at Belvo) simply can't find the
  // institution, so a cross-region "fallback" is a dead end, not a help. Uncovered → manual import.
  const region = BELVO_MARKETS.indexOf(country) >= 0 ? 'belvo'
               : PLAID_MARKETS.indexOf(country) >= 0 ? 'plaid'
               : null;
  if (region === 'belvo') {
    if (await cfg('/api/belvo/status','configured')) return window.ffLinkBelvo(onDone);
    return manual('Automatic bank linking for '+country+' (via Belvo) isn’t enabled yet'+IMPORT);
  }
  if (region === 'plaid') {
    if (await cfg('/api/plaid/items','configured')) return window.ffLinkBank(onDone);
    return manual('Automatic bank linking for '+country+' (via Plaid) isn’t enabled yet'+IMPORT);
  }
  return manual('Automatic bank linking isn’t available'+(country?(' for '+country):'')+' yet'+IMPORT);
};
window.ffBankSync = async function(){
  if(typeof notify==='function') notify('Syncing bank transactions…');
  try{
    const r = await fetch('/api/plaid/sync', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:'{}'});
    const j = await r.json().catch(()=>({}));
    if(!r.ok){ if(typeof notify==='function') notify(j.error||'Sync failed.', true); return; }
    if(typeof notify==='function') notify('Synced — '+(j.added||0)+' new transaction'+((j.added===1)?'':'s')+'.');
    if(typeof loadBankingFromDB==='function') loadBankingFromDB();
  }catch(e){ if(typeof notify==='function') notify('Network error during sync.', true); }
};
window.ffBankUnlink = async function(itemId){
  try{
    const r = await fetch('/api/plaid/unlink', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({item_id:itemId})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok){ if(typeof notify==='function') notify(j.error||'Could not unlink.', true); return; }
    if(typeof notify==='function') notify('Bank unlinked.');
    renderPlaidLinked();
  }catch(e){ if(typeof notify==='function') notify('Network error.', true); }
};
// Rule 1-safe: wrap the FINAL showPage (after all wiring overrides) once the DOM is ready, saving
// and calling the prior winner, then refresh the linked-bank strip when the banking page opens.
document.addEventListener('DOMContentLoaded', function(){
  if(typeof window.showPage === 'function'){
    const _origSP = window.showPage;
    window.showPage = function(id){ const out = _origSP.apply(this, arguments); if(id==='banking'){ try{ renderPlaidLinked(); }catch(e){} } return out; };
  }
});
