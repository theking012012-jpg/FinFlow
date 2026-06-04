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
  if(currentUserPlan==='pro'){ if(typeof showUpgradeModal==='function') showUpgradeModal('scanner'); return; }
  document.getElementById('scanner-drop').classList.remove('drag-over');
  scanFile(file);
};

window.handleScannerDrop=function(e){
  e.preventDefault();
  document.getElementById('scanner-drop').classList.remove('drag-over');
  if(currentUserPlan==='pro'){ if(typeof showUpgradeModal==='function') showUpgradeModal('scanner'); return; }
  const file=e.dataTransfer.files[0];
  if(file)scanFile(file);
};

window.addScannedExpense=function(){
  if(!scannedData)return;
  notify(`Expense added: ${scannedData.vendor||'Receipt'} · ${scannedData.currency||'$'}${scannedData.amount||'0'} ✦`);
  // Optionally push into expense list
  if(window.EXPENSES){
    window.EXPENSES.unshift({
      name:scannedData.vendor||'Scanned receipt',
      cat:scannedData.category||'Other',
      amt:-(parseFloat(scannedData.amount)||0),
      date:scannedData.date||'Today',
      deductible:scannedData.tax_deductible
    });
  }
  resetScanner();
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
