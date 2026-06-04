// ── FEATURE 1: AUDIT TRAIL ────────────────────────────────────────────────────
async function loadAuditTrail(){
  const tbody=document.getElementById('audit-trail-body');
  const countEl=document.getElementById('audit-event-count');
  const lastTimeEl=document.getElementById('audit-last-time');
  const lastActEl=document.getElementById('audit-last-action');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--t3)">Loading…</td></tr>';
  try{
    const tbl=document.getElementById('audit-filter-table')?.value||'all';
    const act=document.getElementById('audit-filter-action')?.value||'all';
    const params=new URLSearchParams();
    if(tbl&&tbl!=='all')params.set('table',tbl);
    if(act&&act!=='all')params.set('action',act);
    const res=await fetch('/api/audit-trail'+(params.toString()?'?'+params.toString():''),{credentials:'include'});
    if(!res.ok)throw new Error(res.status);
    const rows=await res.json();
    if(countEl)countEl.textContent=rows.length;
    if(rows.length&&lastTimeEl){
      const d=new Date(rows[0].changed_at);
      lastTimeEl.textContent=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      if(lastActEl)lastActEl.textContent=rows[0].action||'—';
    }
    if(!rows.length){
      tbody.innerHTML='<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--t3)">No audit events found.</td></tr>';
      return;
    }
    const actionBadge={CREATE:'b-green',UPDATE:'b-amber',DELETE:'b-red'};
    tbody.innerHTML=rows.map(r=>{
      const d=new Date(r.changed_at);
      const dStr=d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
      return`<tr style="border-bottom:1px solid var(--bd)">
        <td style="padding:5px 8px;color:var(--t2);font-size:11px;white-space:nowrap">${esc(dStr)}</td>
        <td style="padding:5px 8px;font-family:var(--font-mono);font-size:11px">${esc(r.table_name||'')}</td>
        <td style="padding:5px 8px;font-family:var(--font-mono);font-size:11px">${r.record_id||'—'}</td>
        <td style="padding:5px 8px"><span class="badge ${actionBadge[r.action]||'b-amber'}" style="font-size:9px">${esc(r.action||'')}</span></td>
        <td style="padding:5px 8px;color:var(--t2)">${esc(r.field_name||'—')}</td>
        <td style="padding:5px 8px;color:var(--red);font-family:var(--font-mono);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.old_value||'')}">${esc(r.old_value||'—')}</td>
        <td style="padding:5px 8px;color:var(--green);font-family:var(--font-mono);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.new_value||'')}">${esc(r.new_value||'—')}</td>
      </tr>`;
    }).join('');
  }catch(e){
    tbody.innerHTML='<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--red)">Failed to load audit trail.</td></tr>';
  }
}

function exportAuditCSV(){
  const rows=document.querySelectorAll('#audit-trail-body tr');
  if(!rows.length)return;
  const headers=['Date','Table','Record ID','Action','Field','Old Value','New Value'];
  const lines=[headers.join(',')];
  rows.forEach(tr=>{
    const cells=tr.querySelectorAll('td');
    if(cells.length<7)return;
    const row=Array.from(cells).map(td=>'"'+td.textContent.replace(/"/g,'""')+'"');
    lines.push(row.join(','));
  });
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='audit-trail.csv';
  a.click();
}

// ── FEATURE 2: PARTIAL PAYMENTS ───────────────────────────────────────────────
let _rpInvoiceId=null;
function openRecordPaymentModal(invoiceId,client,amount){
  _rpInvoiceId=invoiceId;
  const sub=document.getElementById('rp-sub');
  if(sub)sub.textContent=(client?client+' — ':'')+(amount||'');
  const idEl=document.getElementById('rp-invoice-id');
  if(idEl)idEl.value=invoiceId||'';
  const amtEl=document.getElementById('rp-amount');
  if(amtEl)amtEl.value='';
  const dateEl=document.getElementById('rp-date');
  if(dateEl)dateEl.value=new Date().toISOString().slice(0,10);
  const refEl=document.getElementById('rp-reference');
  if(refEl)refEl.value='';
  const notesEl=document.getElementById('rp-notes');
  if(notesEl)notesEl.value='';
  openModal('record-payment-modal');
}
async function recordPayment(){
  const invoiceId=document.getElementById('rp-invoice-id')?.value;
  const amount=parseFloat(document.getElementById('rp-amount')?.value||0);
  const date=document.getElementById('rp-date')?.value;
  const method=document.getElementById('rp-method')?.value||'bank_transfer';
  const reference=document.getElementById('rp-reference')?.value||'';
  const notes=document.getElementById('rp-notes')?.value||'';
  if(!invoiceId){notify('No invoice selected',true);return;}
  if(!amount||amount<=0){notify('Enter a valid amount',true);return;}
  if(!date){notify('Select a payment date',true);return;}
  try{
    const res=await fetch('/api/invoice-payments',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({invoice_id:invoiceId,amount,payment_date:date,method,reference,notes}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    closeModal('record-payment-modal');
    notify('✓ Payment recorded');
    if(typeof renderInvoices==='function')renderInvoices();
  }catch(e){notify('Could not record payment',true);}
}

// ── FEATURE 2b: BANK RECONCILIATION ──────────────────────────────────────────
let _brecBankSelected=null;
async function loadBankRec(){
  try{
    const res=await fetch('/api/bank-reconciliation',{credentials:'include'});
    const data=await res.json();
    const bankList=document.getElementById('brec-bank-list');
    const payList=document.getElementById('brec-pay-list');
    const matchedList=document.getElementById('brec-matched-list');
    const ubEl=document.getElementById('brec-unmatched-bank');
    const upEl=document.getElementById('brec-unmatched-pay');
    const mcEl=document.getElementById('brec-matched-count');

    const unbank=data.unmatched_bank||[];
    const unpay=data.unmatched_payments||[];
    const matched=data.matched||[];

    if(ubEl)ubEl.textContent=unbank.length;
    if(upEl)upEl.textContent=unpay.length;
    if(mcEl)mcEl.textContent=matched.length;

    if(bankList){
      bankList.innerHTML=unbank.length?unbank.map(b=>`
        <div class="tx-row" style="cursor:pointer;border-left:2px solid transparent;padding-left:8px;transition:border-color .15s" id="bbtx-${b.id}"
          onclick="selectBankTx(${b.id},this)">
          <div><div class="tx-name">${esc(b.description||b.merchant||'Transaction')}</div>
          <div class="tx-cat">${esc(b.date||'')} · ${esc(b.account_name||'')}</div></div>
          <div class="tx-amt ${parseFloat(b.amount)>=0?'up':'dn'}">${parseFloat(b.amount)>=0?'+':''}${S(Math.abs(parseFloat(b.amount)))}</div>
        </div>`).join('')
        :'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">All bank transactions matched</div>';
    }
    if(payList){
      payList.innerHTML=unpay.length?unpay.map(p=>`
        <div class="tx-row" style="cursor:pointer" onclick="matchBankRec(_brecBankSelected,${p.id})">
          <div><div class="tx-name">${esc(p.client||'Invoice payment')}</div>
          <div class="tx-cat">${esc(p.payment_date||'')} · ${esc(p.method||'')}</div></div>
          <div class="tx-amt up">+${S(parseFloat(p.amount))}</div>
        </div>`).join('')
        :'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">All payments matched</div>';
    }
    if(matchedList){
      matchedList.innerHTML=matched.length?matched.map(m=>`
        <div class="tx-row">
          <div><div class="tx-name">Bank ID ${m.banking_id} ↔ Payment ID ${m.invoice_payment_id}</div>
          <div class="tx-cat">${esc(m.status||'matched')} · ${new Date(m.matched_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></div>
          <button class="btn btn-ghost btn-sm" style="font-size:10px" onclick="unmatchBankRec(${m.id})">Unmatch</button>
        </div>`).join('')
        :'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">No matched pairs yet — select a bank transaction then a payment to match.</div>';
    }
  }catch(e){if(typeof notify==='function')notify('Could not load bank reconciliation');}
}
function selectBankTx(id,el){
  _brecBankSelected=id;
  document.querySelectorAll('[id^="bbtx-"]').forEach(el2=>{el2.style.borderLeftColor='transparent';});
  if(el)el.style.borderLeftColor='var(--acc)';
  if(typeof notify==='function')notify('Bank transaction selected — now click a payment to match');
}
async function matchBankRec(bankingId,paymentId){
  if(!bankingId){notify('Select a bank transaction first',true);return;}
  try{
    const res=await fetch('/api/bank-reconciliation/match',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({banking_id:bankingId,invoice_payment_id:paymentId}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    _brecBankSelected=null;
    notify('✓ Matched');
    loadBankRec();
  }catch(e){notify('Could not match',true);}
}
async function unmatchBankRec(recId){
  try{
    await fetch('/api/bank-reconciliation/'+recId,{method:'DELETE',credentials:'include'});
    notify('Unmatched');
    loadBankRec();
  }catch(e){notify('Could not unmatch',true);}
}

// ── FEATURE 3: PAYROLL RUNS ───────────────────────────────────────────────────
function runTaxPreview(){
  const gross=parseFloat(document.getElementById('tax-prev-gross')?.value||0);
  const jur=document.getElementById('tax-prev-jur')?.value||'TT';
  const bonus=parseFloat(document.getElementById('tax-prev-bonus')?.value||0);
  const overtime=parseFloat(document.getElementById('tax-prev-overtime')?.value||0);
  const resultEl=document.getElementById('tax-preview-result');
  if(!resultEl)return;
  if(!gross||gross<=0){resultEl.innerHTML='<span style="color:var(--t3)">Enter a gross amount to see the tax breakdown.</span>';return;}
  fetch(`/api/payroll/preview?gross=${gross}&jurisdiction=${jur}&bonus=${bonus}&overtime=${overtime}`,{credentials:'include'})
    .then(r=>r.json())
    .then(d=>{
      if(d.error){resultEl.innerHTML='<span style="color:var(--red)">'+esc(d.error)+'</span>';return;}
      resultEl.innerHTML=`
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div class="mc" style="margin:0"><div class="mc-label">Total Gross</div><div class="mc-val" style="font-size:16px">${S(d.totalGross)}</div></div>
          <div class="mc" style="margin:0"><div class="mc-label">Total Deductions</div><div class="mc-val" style="font-size:16px;color:var(--red)">${S(d.totalDeductions)}</div></div>
          <div class="mc" style="margin:0"><div class="mc-label">Net Pay</div><div class="mc-val" style="font-size:16px;color:var(--green)">${S(d.netPay)}</div></div>
        </div>
        <div style="margin-top:.6rem;font-size:11.5px;color:var(--t2);display:flex;gap:12px;flex-wrap:wrap">
          ${d.tax1>0?`<span>${esc(d.tax1_label)}: <strong style="color:var(--t1)">${S(d.tax1)}</strong></span>`:''}
          ${d.tax2>0?`<span>${esc(d.tax2_label)}: <strong style="color:var(--t1)">${S(d.tax2)}</strong></span>`:''}
          ${d.tax3>0?`<span>${esc(d.tax3_label)}: <strong style="color:var(--t1)">${S(d.tax3)}</strong></span>`:''}
          ${d.bonus>0?`<span>Bonus: <strong style="color:var(--t1)">${S(d.bonus)}</strong></span>`:''}
          ${d.overtime>0?`<span>Overtime: <strong style="color:var(--t1)">${S(d.overtime)}</strong></span>`:''}
        </div>`;
    })
    .catch(()=>{if(resultEl)resultEl.innerHTML='<span style="color:var(--red)">Preview unavailable</span>';});
}

async function loadPayrollRuns(){
  const el=document.getElementById('payroll-runs-list');
  if(!el)return;
  try{
    const res=await fetch('/api/payroll-runs',{credentials:'include'});
    const rows=await res.json();
    if(!rows.length){el.innerHTML='<div style="padding:1rem;color:var(--t3);text-align:center;font-size:12px">No payroll runs yet.</div>';return;}
    const statusBadge={draft:'b-amber',approved:'b-blue',paid:'b-green'};
    el.innerHTML=rows.map(r=>`
      <div class="tx-row" style="align-items:flex-start">
        <div style="flex:1">
          <div class="tx-name">${esc(r.period)} — ${esc(r.jurisdiction||'TT')}</div>
          <div class="tx-cat">${esc(r.run_date||'')} · Gross: ${S(parseFloat(r.total_gross||0))} · Net: ${S(parseFloat(r.total_net||0))}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <span class="badge ${statusBadge[r.status]||'b-amber'}" style="font-size:9px">${esc(r.status)}</span>
          ${r.status==='draft'?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="approvePayrollRun(${r.id})">Approve</button>`:''}
          ${r.status==='approved'?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="markPayrollPaid(${r.id})">Mark Paid</button>`:''}
        </div>
      </div>`).join('');
  }catch(e){el.innerHTML='<div style="color:var(--red);padding:1rem;font-size:12px">Could not load payroll runs</div>';}
}

function openRunPayrollModal(){
  const period=document.getElementById('prm-period');
  if(period){const d=new Date();period.value=d.toLocaleString('en-US',{month:'long',year:'numeric'});}
  const runDate=document.getElementById('prm-date');
  if(runDate)runDate.value=new Date().toISOString().slice(0,10);
  const notesEl=document.getElementById('prm-notes');
  if(notesEl)notesEl.value='';
  const preview=document.getElementById('prm-preview');
  if(preview){
    const jur=document.getElementById('payroll-jurisdiction')?.value||'TT';
    const emps=window.payrollEmployees||[];
    const owner=window.ownerPayroll;
    const all=owner?[owner,...emps]:emps;
    if(!all.length){preview.innerHTML='<span style="color:var(--t3)">No employees on payroll yet.</span>';return;}
    preview.innerHTML=all.map(e=>{
      const net=Math.round((parseFloat(e.gross)||0)*(1-(parseFloat(e.taxRate)||20)/100));
      return`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--t1)">${esc(e.fname||'')} ${esc(e.lname||'')}</span><span style="font-family:var(--font-mono);color:var(--green)">${S(net)} net</span></div>`;
    }).join('');
  }
  openModal('run-payroll-modal');
}

async function submitPayrollRun(){
  const period=document.getElementById('prm-period')?.value?.trim();
  const runDate=document.getElementById('prm-date')?.value;
  const notes=document.getElementById('prm-notes')?.value||'';
  const jur=document.getElementById('payroll-jurisdiction')?.value||'TT';
  if(!period){notify('Enter a pay period',true);return;}
  if(!runDate){notify('Select a run date',true);return;}
  const emps=window.payrollEmployees||[];
  const owner=window.ownerPayroll;
  const all=owner?[owner,...emps]:emps;
  if(!all.length){notify('No employees on payroll',true);return;}
  const lines=all.map(e=>({
    employee_name:(e.fname||'')+ ' '+(e.lname||''),
    gross:parseFloat(e.gross)||0,
    bonus:0,overtime:0,
    payroll_id:null,
  }));
  try{
    const res=await fetch('/api/payroll-runs',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({period,jurisdiction:jur,run_date:runDate,notes,lines}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    closeModal('run-payroll-modal');
    notify('✓ Payroll run created — '+data.run?.period);
    loadPayrollRuns();
  }catch(e){notify('Could not create payroll run',true);}
}

async function approvePayrollRun(id){
  try{
    await fetch('/api/payroll-runs/'+id+'/approve',{method:'PUT',credentials:'include'});
    notify('✓ Payroll approved');
    loadPayrollRuns();
  }catch(e){notify('Could not approve',true);}
}
async function markPayrollPaid(id){
  try{
    await fetch('/api/payroll-runs/'+id+'/mark-paid',{method:'PUT',credentials:'include'});
    notify('✓ Payroll marked paid');
    loadPayrollRuns();
  }catch(e){notify('Could not update',true);}
}

// ── FEATURE 4: INVENTORY COGS ─────────────────────────────────────────────────
let _stockInIdx=null,_stockOutIdx=null;
function openStockInModal(idx){
  _stockInIdx=idx;
  const item=(inventory||[])[idx];
  const sub=document.getElementById('si-sub');
  if(sub&&item)sub.textContent='Stock in for '+esc(item.name||'');
  const idxEl=document.getElementById('si-item-idx');
  if(idxEl)idxEl.value=idx;
  ['si-qty','si-cost','si-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  openModal('stock-in-modal');
}
function openStockOutModal(idx){
  _stockOutIdx=idx;
  const item=(inventory||[])[idx];
  const sub=document.getElementById('so-sub');
  if(sub&&item)sub.textContent='Stock out for '+esc(item.name||'');
  const idxEl=document.getElementById('so-item-idx');
  if(idxEl)idxEl.value=idx;
  ['so-qty','so-ref'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const prev=document.getElementById('so-cogs-preview');
  if(prev)prev.style.display='none';
  openModal('stock-out-modal');
}
async function submitStockIn(){
  const idx=parseInt(document.getElementById('si-item-idx')?.value);
  const qty=parseFloat(document.getElementById('si-qty')?.value||0);
  const cost=parseFloat(document.getElementById('si-cost')?.value||0);
  const notes=document.getElementById('si-notes')?.value||'';
  if(isNaN(idx)||idx<0){notify('Invalid item',true);return;}
  if(!qty||qty<=0){notify('Enter a valid quantity',true);return;}
  if(!cost||cost<0){notify('Enter a valid unit cost',true);return;}
  const item=(inventory||[])[idx];
  if(!item){notify('Item not found',true);return;}
  try{
    const res=await fetch('/api/inventory-movements',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({inventory_id:item.dbId||idx,type:'purchase',quantity:qty,unit_cost:cost,notes}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    item.units=(item.units||0)+qty;
    item.cost=cost;
    item.low=item.units<(item.max||0)*.1;
    closeModal('stock-in-modal');
    notify(`✓ +${qty} units at ${S(cost)} each`);
    if(typeof renderInventory==='function')renderInventory();
    loadCOGS();
  }catch(e){notify('Could not record stock in',true);}
}
async function submitStockOut(){
  const idx=parseInt(document.getElementById('so-item-idx')?.value);
  const qty=parseFloat(document.getElementById('so-qty')?.value||0);
  const ref=document.getElementById('so-ref')?.value||'';
  if(isNaN(idx)||idx<0){notify('Invalid item',true);return;}
  if(!qty||qty<=0){notify('Enter a valid quantity',true);return;}
  const item=(inventory||[])[idx];
  if(!item){notify('Item not found',true);return;}
  if(qty>item.units){notify('Quantity exceeds stock on hand',true);return;}
  try{
    const cogsRes=await fetch('/api/cogs/calculate',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({inventory_id:item.dbId||idx,quantity_sold:qty}),
    });
    const cogsData=await cogsRes.json();
    const cogs=cogsData.cogs||0;
    const prev=document.getElementById('so-cogs-preview');
    if(prev){
      prev.style.display='block';
      prev.innerHTML=`FIFO COGS for ${qty} units: <strong style="color:var(--t1)">${S(cogs)}</strong>`;
    }
    const res=await fetch('/api/inventory-movements',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({inventory_id:item.dbId||idx,type:'sale',quantity:qty,unit_cost:cogs/qty,reference:ref}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    item.units=Math.max(0,(item.units||0)-qty);
    item.cogs=(parseFloat(item.cogs)||0)+cogs;
    item.low=item.units<(item.max||0)*.1;
    closeModal('stock-out-modal');
    notify(`✓ -${qty} units · COGS ${S(cogs)}`);
    if(typeof renderInventory==='function')renderInventory();
    loadCOGS();
  }catch(e){notify('Could not record stock out',true);}
}
async function loadCOGS(){
  try{
    const res=await fetch('/api/cogs',{credentials:'include'});
    const data=await res.json();
    const totalEl=document.getElementById('cogs-total');
    const revEl=document.getElementById('cogs-revenue');
    const gpEl=document.getElementById('cogs-gross-profit');
    const bdEl=document.getElementById('cogs-breakdown');
    if(totalEl)totalEl.textContent=S(parseFloat(data.total_cogs||0));
    if(revEl)revEl.textContent=S(parseFloat(data.revenue||0));
    if(gpEl){
      const gp=parseFloat(data.gross_profit||0);
      gpEl.textContent=S(gp);
      gpEl.style.color=gp>=0?'var(--green)':'var(--red)';
    }
    const breakdown=data.breakdown||[];
    if(bdEl){
      bdEl.innerHTML=breakdown.length?breakdown.map(b=>`
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bd);font-size:12px">
          <span style="color:var(--t1)">${esc(b.name||b.inventory_id||'Item')}</span>
          <span style="font-family:var(--font-mono);color:var(--t2)">${S(parseFloat(b.cogs||0))}</span>
        </div>`).join('')
        :'<div style="padding:1rem;color:var(--t3);text-align:center;font-size:12px">No COGS recorded yet. Record stock out movements to calculate.</div>';
    }
    if(data.by_item){
      (inventory||[]).forEach(item=>{
        const found=(data.by_item||[]).find(b=>b.inventory_id===(item.dbId||item.id));
        if(found)item.cogs=parseFloat(found.cogs)||0;
      });
      if(typeof renderInventory==='function')renderInventory();
    }
  }catch(e){}
}

// ── FEATURE 5: FX GAIN/LOSS ───────────────────────────────────────────────────
async function loadFXData(){
  try{
    const [sumRes,ratesRes,txRes]=await Promise.all([
      fetch('/api/fx-summary',{credentials:'include'}),
      fetch('/api/fx-rates',{credentials:'include'}),
      fetch('/api/fx-transactions',{credentials:'include'}),
    ]);
    const summary=await sumRes.json();
    const rates=await ratesRes.json();
    const txs=await txRes.json();

    const unrel=parseFloat(summary.unrealised||0);
    const rel=parseFloat(summary.realised||0);
    const net=unrel+rel;
    const fmtFX=v=>(v>=0?'+':'')+S(Math.abs(v));
    const colFX=v=>v>=0?'var(--green)':'var(--red)';

    const uEl=document.getElementById('fx-unrealised');
    const rEl=document.getElementById('fx-realised');
    const nEl=document.getElementById('fx-net');
    if(uEl){uEl.textContent=fmtFX(unrel);uEl.style.color=colFX(unrel);}
    if(rEl){rEl.textContent=fmtFX(rel);rEl.style.color=colFX(rel);}
    if(nEl){nEl.textContent=fmtFX(net);nEl.style.color=colFX(net);}

    const ratesList=document.getElementById('fx-rates-list');
    if(ratesList){
      ratesList.innerHTML=(rates.length?rates:[] ).map(r=>`
        <div style="display:grid;grid-template-columns:60px 60px 90px 90px 40px;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px;align-items:center">
          <span style="font-family:var(--font-mono)">${esc(r.from_currency)}</span>
          <span style="font-family:var(--font-mono)">${esc(r.to_currency)}</span>
          <span style="font-family:var(--font-mono)">${parseFloat(r.rate).toFixed(4)}</span>
          <span style="color:var(--t3)">${esc(r.rate_date||'')}</span>
          <span></span>
        </div>`).join('')||'<div style="padding:1rem;color:var(--t3);font-size:12px;text-align:center">No rates yet</div>';
    }

    const txList=document.getElementById('fx-tx-list');
    if(txList){
      txList.innerHTML=(txs.length?txs:[]).map(t=>{
        const gl=parseFloat(t.status==='settled'?t.realised_gain_loss:t.unrealised_gain_loss)||0;
        const glColor=gl>=0?'var(--green)':'var(--red)';
        return`<tr style="border-bottom:1px solid var(--bd)">
          <td style="padding:5px 6px;font-family:var(--font-mono)">${esc(t.foreign_currency)}</td>
          <td style="padding:5px 6px;font-family:var(--font-mono)">${S(parseFloat(t.foreign_amount))}</td>
          <td style="padding:5px 6px;font-family:var(--font-mono);color:var(--t2)">${parseFloat(t.rate_at_transaction||0).toFixed(4)}</td>
          <td style="padding:5px 6px;font-family:var(--font-mono);color:${glColor}">${gl>=0?'+':''}${S(Math.abs(gl))}</td>
          <td style="padding:5px 6px"><span class="badge ${t.status==='settled'?'b-green':'b-amber'}" style="font-size:9px">${esc(t.status)}</span></td>
          <td style="padding:5px 6px">${t.status!=='settled'?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px" onclick="settleFXTransaction(${t.id})">Settle</button>`:''}</td>
        </tr>`;
      }).join('');
    }
  }catch(e){if(typeof notify==='function')notify('Could not load FX data');}
}

async function addFXRate(){
  const from=(document.getElementById('fxr-from')?.value||'').trim().toUpperCase();
  const to=(document.getElementById('fxr-to')?.value||'').trim().toUpperCase();
  const rate=parseFloat(document.getElementById('fxr-rate')?.value||0);
  const date=document.getElementById('fxr-date')?.value||new Date().toISOString().slice(0,10);
  if(!from||!to){notify('Enter both currencies',true);return;}
  if(!rate||rate<=0){notify('Enter a valid rate',true);return;}
  try{
    const res=await fetch('/api/fx-rates',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({from_currency:from,to_currency:to,rate,rate_date:date}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    closeModal('fx-rate-modal');
    notify('✓ FX rate saved');
    loadFXData();
  }catch(e){notify('Could not save rate',true);}
}

async function addFXTransaction(){
  const currency=(document.getElementById('fxt-currency')?.value||'').trim().toUpperCase();
  const amount=parseFloat(document.getElementById('fxt-amount')?.value||0);
  const base=(document.getElementById('fxt-base')?.value||'USD').trim().toUpperCase();
  const rate=parseFloat(document.getElementById('fxt-rate')?.value||0);
  const refType=document.getElementById('fxt-ref-type')?.value||'other';
  const refId=parseInt(document.getElementById('fxt-ref-id')?.value||0)||null;
  if(!currency){notify('Enter foreign currency',true);return;}
  if(!amount||amount<=0){notify('Enter a valid amount',true);return;}
  if(!rate||rate<=0){notify('Enter a valid rate',true);return;}
  try{
    const res=await fetch('/api/fx-transactions',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({foreign_currency:currency,foreign_amount:amount,base_currency:base,rate_at_transaction:rate,reference_type:refType,reference_id:refId}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    closeModal('fx-tx-modal');
    notify('✓ FX transaction saved');
    loadFXData();
  }catch(e){notify('Could not save transaction',true);}
}

async function settleFXTransaction(id){
  // TODO: Replace with modal input — prompt() removed per audit Finding 34
  if(!confirm('Settle this FX transaction? You can update the rate in the transaction detail view.')) return;
  notify('Open the FX transaction detail to enter the settlement rate.', true); return;
  const rateStr=null; // unreachable — replaced above
  if(!rateStr)return;
  const rate=parseFloat(rateStr);
  if(!rate||rate<=0){notify('Invalid rate',true);return;}
  try{
    const res=await fetch('/api/fx-transactions/'+id+'/settle',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rate_at_settlement:rate}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    const gl=parseFloat(data.transaction?.realised_gain_loss||0);
    notify('✓ Settled · Gain/Loss: '+(gl>=0?'+':'')+S(Math.abs(gl)));
    loadFXData();
  }catch(e){notify('Could not settle',true);}
}
