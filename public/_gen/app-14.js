
(function(){

let scannedData = null;

function toBase64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}

function setStatus(show, text){
  const s=document.getElementById('scanner-status');
  const t=document.getElementById('scanner-status-text');
  if(!s)return;
  s.style.display=show?'flex':'none';
  if(t&&text)t.textContent=text;
}

function showPreview(file){
  const img=document.getElementById('scanner-preview');
  if(!img)return;
  if(file.type.startsWith('image/')){
    img.src=URL.createObjectURL(file);
    img.style.display='block';
  } else {
    img.style.display='none';
  }
}

async function scanFile(file){
  const drop=document.getElementById('scanner-drop');
  const result=document.getElementById('scanner-result');
  if(result)result.style.display='none';

  // Validate file type against allowlist
  const ALLOWED_TYPES=['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
  if(!ALLOWED_TYPES.includes(file.type)){
    notify('Unsupported file type — please upload a JPEG, PNG, WebP, GIF, or PDF.',true);
    return;
  }

  // Validate file size (max 10 MB) before reading
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  if(file.size > MAX_FILE_BYTES){
    notify('File too large — maximum size is 10 MB.',true);
    return;
  }

  // Apply unified rate limit
  if(!apiRateLimit()){
    notify('Too many AI requests — please wait a moment before trying again.',true);
    return;
  }

  showPreview(file);
  setStatus(true,'Reading file…');

  let base64,mediaType;
  try{
    base64=await toBase64(file);
    mediaType=file.type||'image/jpeg';
  }catch(e){
    setStatus(false);
    notify('Could not read file',true);
    return;
  }

  setStatus(true,'Scanning with Claude Vision…');

  const isPDF = file.type === 'application/pdf';

  try{
    const res = await fetch('/api/ai/scan', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({base64, mediaType, isPDF})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'AI service error');
    scannedData = data;
    setStatus(false);
    renderScanResult(scannedData);
  }catch(err){
    setStatus(false);
    notify('Could not parse receipt — try a clearer image');
    console.error('Scanner error:',err);
  }
}

function renderScanResult(d){
  const result=document.getElementById('scanner-result');
  if(!result)return;
  // Restore normal result HTML in case it was replaced by key prompt
  result.innerHTML=`
    <div style="font-size:11px;color:var(--acc);font-weight:500;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.5rem">✦ Extracted data</div>
    <div class="scanner-result-row"><span class="scanner-result-label">Vendor</span><span class="scanner-result-val" id="sc-vendor">—</span></div>
    <div class="scanner-result-row"><span class="scanner-result-label">Amount</span><span class="scanner-result-val" id="sc-amount" style="color:var(--green);font-family:var(--font-mono)">—</span></div>
    <div class="scanner-result-row"><span class="scanner-result-label">Date</span><span class="scanner-result-val" id="sc-date">—</span></div>
    <div class="scanner-result-row"><span class="scanner-result-label">Category</span><span class="scanner-result-val" id="sc-category">—</span></div>
    <div class="scanner-result-row"><span class="scanner-result-label">Tax deductible</span><span class="scanner-result-val" id="sc-tax">—</span></div>
    <div class="scanner-result-row"><span class="scanner-result-label">Notes</span><span class="scanner-result-val" id="sc-notes" style="font-size:11.5px;color:var(--t2);text-align:right;max-width:60%">—</span></div>
    <div style="display:flex;gap:8px;margin-top:.85rem">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="addScannedExpense()">+ Add to expenses</button>
      <button class="btn btn-ghost" onclick="resetScanner()">Clear</button>
    </div>`;
  result.style.display='block';

  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val||'—';};
  set('sc-vendor', d.vendor);
  set('sc-amount', d.amount ? `${d.currency||'$'} ${parseFloat(d.amount).toFixed(2)}` : null);
  set('sc-date', d.date);
  set('sc-category', d.category);
  set('sc-tax', d.tax_deductible===true ? '✓ Yes' : d.tax_deductible===false ? '✗ No' : '—');
  set('sc-notes', d.notes);
}

window.handleScannerFile=function(file){
  if(!file)return;
  if(window.FinFlowPlans&&!window.FinFlowPlans.has(currentUserPlan,'scanner')){ if(typeof showUpgradeModal==='function') showUpgradeModal('scanner'); return; }   // D-F: by plan feature
  document.getElementById('scanner-drop').classList.remove('drag-over');
  scanFile(file);
};

window.handleScannerDrop=function(e){
  e.preventDefault();
  document.getElementById('scanner-drop').classList.remove('drag-over');
  if(window.FinFlowPlans&&!window.FinFlowPlans.has(currentUserPlan,'scanner')){ if(typeof showUpgradeModal==='function') showUpgradeModal('scanner'); return; }   // D-F: by plan feature
  const file=e.dataTransfer.files[0];
  if(file)scanFile(file);
};

// M4 (money audit 2026-10-09): "+ Add to expenses" SAVES the scanned receipt through POST /api/expenses — the
// same server route (and idempotency index) as the Add expense form — and only says "added" once the server has
// stored it. It used to toast success and push into an undefined window.EXPENSES, saving nothing.
window.addScannedExpense=async function(){
  if(!scannedData||window._savingScanned)return;
  const d=scannedData;
  const amount=Math.round((parseFloat(String(d.amount==null?'':d.amount).replace(/[^0-9.\-]/g,''))||0)*100)/100;
  if(!(amount>0)){notify('The scanned amount is not a valid positive number — add this receipt manually.',true);return;}
  const ent=(window.ENTITIES||[]).find(e=>e.active)||null;
  const bookCur=String((ent&&ent.currency)||'USD').toUpperCase();
  const scanCur=String(d.currency||'').trim().toUpperCase();
  // A receipt in another currency is never booked as if it were this business's currency.
  if(/^[A-Z]{3}$/.test(scanCur)&&scanCur!==bookCur){notify(`This receipt is in ${scanCur} but this business books in ${bookCur}. Add it manually with the converted amount.`,true);return;}
  const date=/^\d{4}-\d{2}-\d{2}$/.test(String(d.date||''))?String(d.date):(window.todayLocal?window.todayLocal():undefined);
  const ded=(d.tax_deductible===true||/^(yes|true|1|full)$/i.test(String(d.tax_deductible||'')))?'yes':'no';
  window._scanIdemKey=window._scanIdemKey||(window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():'scan-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  window._savingScanned=true;
  try{
    const res=await fetch('/api/expenses',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      description:String(d.vendor||'Scanned receipt').slice(0,300),
      category:d.category||'Other',
      amount,
      deductible:ded,
      expense_date:date,
      entity_id:(ent&&ent._dbId)||null,
      idempotency_key:window._scanIdemKey,
    })});
    if(!res.ok){const j=await res.json().catch(()=>({}));throw new Error(j.error||('API error '+res.status));}
    window._scanIdemKey=null;
    notify(`Expense added: ${d.vendor||'Receipt'} · ${amount.toFixed(2)} ✦`);
    resetScanner();
    if(typeof window._loadExpensesFromDB==='function')window._loadExpensesFromDB().catch(()=>{});
    window._refreshDashboardUI?.();
    if(typeof window.refreshFinancials==='function')window.refreshFinancials('expenses');
  }catch(e){
    // Keep the scan and the token so a retry of this same receipt is idempotent.
    notify('Could not add the expense — '+(e&&e.message||'unknown error'),true);
  }finally{window._savingScanned=false;}
};

window.resetScanner=function(){
  scannedData=null;
  const preview=document.getElementById('scanner-preview');
  const result=document.getElementById('scanner-result');
  const input=document.getElementById('scanner-file-input');
  if(preview){preview.src='';preview.style.display='none';}
  if(result)result.style.display='none';
  if(input)input.value='';
  setStatus(false);
};

})();
