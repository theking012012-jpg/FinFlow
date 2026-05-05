// FinFlow API Wiring — Final5
// Modules: Sales Receipts, Payments Received, Credit Notes, Payments Made, Vendor Credits, AI

/* ══════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════ */
async function apiFetch(path, opts={}){
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if(!res.ok){ const e = await res.json().catch(()=>({})); throw new Error(e.error||res.status); }
  return res.json();
}

function fmtMoney(n){ return '$' + Number(n||0).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0}); }
function fmtDate(s){ if(!s)return ''; const d=new Date(s); return isNaN(d)?s:d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function nextNum(prefix, list, field='num'){
  const nums = list.map(r=>(r[field]||'').replace(prefix+'-','0')).map(Number).filter(n=>!isNaN(n));
  const next = nums.length ? Math.max(...nums)+1 : 1;
  return prefix + '-' + String(next).padStart(4,'0');
}

/* ══════════════════════════════════════════════════════════════════
   SALES RECEIPTS
══════════════════════════════════════════════════════════════════ */
let _receipts = [];

async function loadReceipts(){
  try{ _receipts = await apiFetch('/api/sales-receipts'); } catch(e){ _receipts=[]; }
}

function renderReceipts(){
  loadReceipts().then(()=>{
    const l = document.getElementById('receipts-list'); if(!l) return;
    if(!_receipts.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No sales receipts yet. Click + New Receipt to add one.</div>'; return; }
    l.innerHTML = _receipts.map(r=>`
      <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 80px">
        <span style="font-weight:500">${r.customer||''}</span>
        <span style="color:var(--t3)">${r.num||''}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${fmtMoney(r.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(r.date)||r.date||''}</span>
        <span><span class="badge b-blue">${r.method||''}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditReceiptModal(${r.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteReceipt(${r.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openNewReceiptModal(){
  document.getElementById('receipt-modal-title').textContent = 'New Sales Receipt';
  document.getElementById('receipt-id').value = '';
  document.getElementById('receipt-customer').value = '';
  document.getElementById('receipt-amount').value = '';
  document.getElementById('receipt-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('receipt-method').value = 'Card';
  document.getElementById('receipt-notes').value = '';
  openModal('modal-receipt');
}

function openEditReceiptModal(id){
  const r = _receipts.find(x=>x.id===id); if(!r) return;
  document.getElementById('receipt-modal-title').textContent = 'Edit Sales Receipt';
  document.getElementById('receipt-id').value = id;
  document.getElementById('receipt-customer').value = r.customer||'';
  document.getElementById('receipt-amount').value = r.amount||'';
  document.getElementById('receipt-date').value = (r.date||'').slice(0,10)||new Date().toISOString().slice(0,10);
  document.getElementById('receipt-method').value = r.method||'Card';
  document.getElementById('receipt-notes').value = r.notes||'';
  openModal('modal-receipt');
}

async function saveReceipt(){
  const id = document.getElementById('receipt-id').value;
  const payload = {
    customer: document.getElementById('receipt-customer').value.trim(),
    amount:   parseFloat(document.getElementById('receipt-amount').value)||0,
    date:     document.getElementById('receipt-date').value,
    method:   document.getElementById('receipt-method').value,
    notes:    document.getElementById('receipt-notes').value.trim(),
    num:      id ? (_receipts.find(r=>r.id===+id)||{}).num : nextNum('SR', _receipts),
  };
  if(!payload.customer){ alert('Customer is required'); return; }
  try{
    if(id){ await apiFetch('/api/sales-receipts/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/sales-receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-receipt');
    renderReceipts();
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deleteReceipt(id){
  if(!confirm('Delete this receipt?')) return;
  await apiFetch('/api/sales-receipts/'+id,{method:'DELETE'});
  renderReceipts();
}

/* ══════════════════════════════════════════════════════════════════
   PAYMENTS RECEIVED
══════════════════════════════════════════════════════════════════ */
let _paymentsReceived = [];

async function loadPaymentsReceived(){
  try{ _paymentsReceived = await apiFetch('/api/payments-received'); } catch(e){ _paymentsReceived=[]; }
}

function renderPaymentsReceived(){
  loadPaymentsReceived().then(()=>{
    const l = document.getElementById('payments-recv-list'); if(!l) return;
    if(!_paymentsReceived.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No payments recorded yet. Click + Record Payment to add one.</div>'; return; }
    l.innerHTML = _paymentsReceived.map(p=>`
      <div class="table-row" style="grid-template-columns:1fr 110px 80px 80px 70px 80px">
        <span style="font-weight:500">${p.customer||''}</span>
        <span style="color:var(--t3)">${p.invoice_ref||''}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${fmtMoney(p.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(p.date)||p.date||''}</span>
        <span><span class="badge b-blue">${p.method||''}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditPaymentReceivedModal(${p.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deletePaymentReceived(${p.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openRecordPaymentModal(){
  document.getElementById('pr-modal-title').textContent = 'Record Payment Received';
  document.getElementById('pr-id').value = '';
  document.getElementById('pr-customer').value = '';
  document.getElementById('pr-invoice-ref').value = '';
  document.getElementById('pr-amount').value = '';
  document.getElementById('pr-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('pr-method').value = 'Bank Transfer';
  document.getElementById('pr-notes').value = '';
  openModal('modal-payment-received');
}

function openEditPaymentReceivedModal(id){
  const p = _paymentsReceived.find(x=>x.id===id); if(!p) return;
  document.getElementById('pr-modal-title').textContent = 'Edit Payment Received';
  document.getElementById('pr-id').value = id;
  document.getElementById('pr-customer').value = p.customer||'';
  document.getElementById('pr-invoice-ref').value = p.invoice_ref||'';
  document.getElementById('pr-amount').value = p.amount||'';
  document.getElementById('pr-date').value = (p.date||'').slice(0,10)||new Date().toISOString().slice(0,10);
  document.getElementById('pr-method').value = p.method||'Bank Transfer';
  document.getElementById('pr-notes').value = p.notes||'';
  openModal('modal-payment-received');
}

async function savePaymentReceived(){
  const id = document.getElementById('pr-id').value;
  const payload = {
    customer:    document.getElementById('pr-customer').value.trim(),
    invoice_ref: document.getElementById('pr-invoice-ref').value.trim(),
    amount:      parseFloat(document.getElementById('pr-amount').value)||0,
    date:        document.getElementById('pr-date').value,
    method:      document.getElementById('pr-method').value,
    notes:       document.getElementById('pr-notes').value.trim(),
  };
  if(!payload.customer){ alert('Customer is required'); return; }
  try{
    if(id){ await apiFetch('/api/payments-received/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/payments-received',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-payment-received');
    renderPaymentsReceived();
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deletePaymentReceived(id){
  if(!confirm('Delete this payment?')) return;
  await apiFetch('/api/payments-received/'+id,{method:'DELETE'});
  renderPaymentsReceived();
}

/* ══════════════════════════════════════════════════════════════════
   CREDIT NOTES
══════════════════════════════════════════════════════════════════ */
let _creditNotes = [];

async function loadCreditNotes(){
  try{ _creditNotes = await apiFetch('/api/credit-notes'); } catch(e){ _creditNotes=[]; }
}

function renderCreditNotes(){
  loadCreditNotes().then(()=>{
    const l = document.getElementById('credit-notes-list'); if(!l) return;
    if(!_creditNotes.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No credit notes yet. Click + New Credit Note to add one.</div>'; return; }
    l.innerHTML = _creditNotes.map(c=>`
      <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 80px">
        <span style="font-weight:500">${c.customer||''}</span>
        <span style="color:var(--t3)">${c.num||''}</span>
        <span style="font-family:var(--font-mono);color:var(--amber)">${fmtMoney(c.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(c.date)||c.date||''}</span>
        <span><span class="badge ${c.status==='Applied'?'b-green':'b-amber'}">${c.status||'Open'}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditCreditNoteModal(${c.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteCreditNote(${c.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openNewCreditNoteModal(){
  document.getElementById('cn-modal-title').textContent = 'New Credit Note';
  document.getElementById('cn-id').value = '';
  document.getElementById('cn-customer').value = '';
  document.getElementById('cn-amount').value = '';
  document.getElementById('cn-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('cn-status').value = 'Open';
  document.getElementById('cn-reason').value = '';
  openModal('modal-credit-note');
}

function openEditCreditNoteModal(id){
  const c = _creditNotes.find(x=>x.id===id); if(!c) return;
  document.getElementById('cn-modal-title').textContent = 'Edit Credit Note';
  document.getElementById('cn-id').value = id;
  document.getElementById('cn-customer').value = c.customer||'';
  document.getElementById('cn-amount').value = c.amount||'';
  document.getElementById('cn-date').value = (c.date||'').slice(0,10)||new Date().toISOString().slice(0,10);
  document.getElementById('cn-status').value = c.status||'Open';
  document.getElementById('cn-reason').value = c.reason||'';
  openModal('modal-credit-note');
}

async function saveCreditNote(){
  const id = document.getElementById('cn-id').value;
  const existing = id ? _creditNotes.find(c=>c.id===+id) : null;
  const payload = {
    customer: document.getElementById('cn-customer').value.trim(),
    amount:   parseFloat(document.getElementById('cn-amount').value)||0,
    date:     document.getElementById('cn-date').value,
    status:   document.getElementById('cn-status').value,
    reason:   document.getElementById('cn-reason').value.trim(),
    num:      existing ? existing.num : nextNum('CN', _creditNotes),
  };
  if(!payload.customer){ alert('Customer is required'); return; }
  try{
    if(id){ await apiFetch('/api/credit-notes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/credit-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-credit-note');
    renderCreditNotes();
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deleteCreditNote(id){
  if(!confirm('Delete this credit note?')) return;
  await apiFetch('/api/credit-notes/'+id,{method:'DELETE'});
  renderCreditNotes();
}

/* ══════════════════════════════════════════════════════════════════
   PAYMENTS MADE
══════════════════════════════════════════════════════════════════ */
let _paymentsMade = [];

async function loadPaymentsMade(){
  try{ _paymentsMade = await apiFetch('/api/payments-made'); } catch(e){ _paymentsMade=[]; }
}

function renderPaymentsMade(){
  loadPaymentsMade().then(()=>{
    const l = document.getElementById('payments-made-list'); if(!l) return;
    if(!_paymentsMade.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No payments recorded yet. Click + Make Payment to add one.</div>'; return; }
    l.innerHTML = _paymentsMade.map(p=>`
      <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 80px">
        <span style="font-weight:500">${p.vendor||''}</span>
        <span style="color:var(--t3)">${p.ref||''}</span>
        <span style="font-family:var(--font-mono);color:var(--red)">${fmtMoney(p.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(p.date)||p.date||''}</span>
        <span><span class="badge b-blue">${p.method||''}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditPaymentMadeModal(${p.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deletePaymentMade(${p.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openMakePaymentModal(){
  document.getElementById('pm-modal-title').textContent = 'Make Payment';
  document.getElementById('pm-id').value = '';
  document.getElementById('pm-vendor').value = '';
  document.getElementById('pm-amount').value = '';
  document.getElementById('pm-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('pm-method').value = 'Bank Transfer';
  document.getElementById('pm-notes').value = '';
  openModal('modal-payment-made');
}

function openEditPaymentMadeModal(id){
  const p = _paymentsMade.find(x=>x.id===id); if(!p) return;
  document.getElementById('pm-modal-title').textContent = 'Edit Payment';
  document.getElementById('pm-id').value = id;
  document.getElementById('pm-vendor').value = p.vendor||'';
  document.getElementById('pm-amount').value = p.amount||'';
  document.getElementById('pm-date').value = (p.date||'').slice(0,10)||new Date().toISOString().slice(0,10);
  document.getElementById('pm-method').value = p.method||'Bank Transfer';
  document.getElementById('pm-notes').value = p.notes||'';
  openModal('modal-payment-made');
}

async function savePaymentMade(){
  const id = document.getElementById('pm-id').value;
  const existing = id ? _paymentsMade.find(p=>p.id===+id) : null;
  const payload = {
    vendor: document.getElementById('pm-vendor').value.trim(),
    amount: parseFloat(document.getElementById('pm-amount').value)||0,
    date:   document.getElementById('pm-date').value,
    method: document.getElementById('pm-method').value,
    notes:  document.getElementById('pm-notes').value.trim(),
    ref:    existing ? existing.ref : nextNum('PM', _paymentsMade, 'ref'),
  };
  if(!payload.vendor){ alert('Vendor is required'); return; }
  try{
    if(id){ await apiFetch('/api/payments-made/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/payments-made',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-payment-made');
    renderPaymentsMade();
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deletePaymentMade(id){
  if(!confirm('Delete this payment?')) return;
  await apiFetch('/api/payments-made/'+id,{method:'DELETE'});
  renderPaymentsMade();
}

/* ══════════════════════════════════════════════════════════════════
   VENDOR CREDITS
══════════════════════════════════════════════════════════════════ */
let _vendorCredits = [];

async function loadVendorCredits(){
  try{ _vendorCredits = await apiFetch('/api/vendor-credits'); } catch(e){ _vendorCredits=[]; }
}

function renderVendorCredits(){
  loadVendorCredits().then(()=>{
    const l = document.getElementById('vendor-credits-list'); if(!l) return;
    if(!_vendorCredits.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No vendor credits yet. Click + New Credit to add one.</div>'; return; }
    l.innerHTML = _vendorCredits.map(c=>`
      <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 80px">
        <span style="font-weight:500">${c.vendor||''}</span>
        <span style="color:var(--t3)">${c.num||''}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${fmtMoney(c.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(c.date)||c.date||''}</span>
        <span><span class="badge ${c.status==='Applied'?'b-blue':'b-green'}">${c.status||'Open'}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditVendorCreditModal(${c.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteVendorCredit(${c.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openNewVendorCreditModal(){
  document.getElementById('vc-modal-title').textContent = 'New Vendor Credit';
  document.getElementById('vc-id').value = '';
  document.getElementById('vc-vendor').value = '';
  document.getElementById('vc-amount').value = '';
  document.getElementById('vc-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('vc-status').value = 'Open';
  document.getElementById('vc-reason').value = '';
  openModal('modal-vendor-credit');
}

function openEditVendorCreditModal(id){
  const c = _vendorCredits.find(x=>x.id===id); if(!c) return;
  document.getElementById('vc-modal-title').textContent = 'Edit Vendor Credit';
  document.getElementById('vc-id').value = id;
  document.getElementById('vc-vendor').value = c.vendor||'';
  document.getElementById('vc-amount').value = c.amount||'';
  document.getElementById('vc-date').value = (c.date||'').slice(0,10)||new Date().toISOString().slice(0,10);
  document.getElementById('vc-status').value = c.status||'Open';
  document.getElementById('vc-reason').value = c.reason||'';
  openModal('modal-vendor-credit');
}

async function saveVendorCredit(){
  const id = document.getElementById('vc-id').value;
  const existing = id ? _vendorCredits.find(c=>c.id===+id) : null;
  const payload = {
    vendor:  document.getElementById('vc-vendor').value.trim(),
    amount:  parseFloat(document.getElementById('vc-amount').value)||0,
    date:    document.getElementById('vc-date').value,
    status:  document.getElementById('vc-status').value,
    reason:  document.getElementById('vc-reason').value.trim(),
    num:     existing ? existing.num : nextNum('VC', _vendorCredits),
  };
  if(!payload.vendor){ alert('Vendor is required'); return; }
  try{
    if(id){ await apiFetch('/api/vendor-credits/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/vendor-credits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-vendor-credit');
    renderVendorCredits();
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deleteVendorCredit(id){
  if(!confirm('Delete this vendor credit?')) return;
  await apiFetch('/api/vendor-credits/'+id,{method:'DELETE'});
  renderVendorCredits();
}

/* ══════════════════════════════════════════════════════════════════
   AI CHAT
══════════════════════════════════════════════════════════════════ */
let _aiHistory = [];

function renderAIPage(){
  const container = document.getElementById('ai-chat-messages');
  if(!container) return;
  if(!_aiHistory.length){
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
      <div style="font-size:32px;margin-bottom:12px">✦</div>
      <div style="font-size:14px;font-weight:600;color:var(--t2);margin-bottom:8px">FinFlow AI</div>
      <div style="font-size:13px">Ask me anything about your business — revenue, expenses, cash flow, forecasting, or financial strategy.</div>
    </div>`;
    return;
  }
  container.innerHTML = _aiHistory.map(m=>`
    <div style="display:flex;flex-direction:${m.role==='user'?'row-reverse':'row'};gap:10px;margin-bottom:16px;align-items:flex-start">
      <div style="width:30px;height:30px;border-radius:50%;background:${m.role==='user'?'var(--accent)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${m.role==='user'?'#fff':'var(--t1)'};flex-shrink:0">${m.role==='user'?'U':'✦'}</div>
      <div style="max-width:75%;background:${m.role==='user'?'var(--accent)':'var(--bg2)'};color:${m.role==='user'?'#fff':'var(--t1)'};border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.5;white-space:pre-wrap">${escHTML(m.content)}</div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function escHTML(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendAIMessage(){
  const input = document.getElementById('ai-input'); if(!input) return;
  const message = input.value.trim(); if(!message) return;
  input.value = '';

  _aiHistory.push({ role: 'user', content: message });
  renderAIPage();

  // Show typing indicator
  const container = document.getElementById('ai-chat-messages');
  if(container){
    const typing = document.createElement('div');
    typing.id = 'ai-typing';
    typing.style.cssText = 'display:flex;gap:10px;margin-bottom:16px;align-items:flex-start';
    typing.innerHTML = `<div style="width:30px;height:30px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:12px">✦</div><div style="background:var(--bg2);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--t3)">Thinking…</div>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  try{
    const data = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: _aiHistory.slice(0,-1) })
    });
    const typing2 = document.getElementById('ai-typing'); if(typing2) typing2.remove();
    _aiHistory.push({ role: 'assistant', content: data.reply || 'No response.' });
  } catch(e){
    const typing3 = document.getElementById('ai-typing'); if(typing3) typing3.remove();
    _aiHistory.push({ role: 'assistant', content: 'Error: ' + (e.message || 'Could not reach AI. Make sure ANTHROPIC_API_KEY is set in .env') });
  }
  renderAIPage();
}

function clearAIChat(){
  _aiHistory = [];
  renderAIPage();
}

// Hook up AI send button and enter key
document.addEventListener('DOMContentLoaded', ()=>{
  const sendBtn = document.getElementById('ai-send-btn');
  if(sendBtn) sendBtn.addEventListener('click', sendAIMessage);
  const inp = document.getElementById('ai-input');
  if(inp) inp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendAIMessage(); } });
  const clearBtn = document.getElementById('ai-clear-btn');
  if(clearBtn) clearBtn.addEventListener('click', clearAIChat);
});
