
// ── FEATURE 1: AUDIT TRAIL ────────────────────────────────────────────────────
// PL#4 (Option B+): the page used to read /api/audit-trail (audit_trail table — only 2 CREATE-only
// writers with NO field payload, so the Field/Old/New columns were always "—" and a normal account
// saw "No audit events found"). Real history lives in audit_log (12 writers, full old/new objects)
// via /api/audit-log. We repoint here and reconstruct field-level rows with a CLIENT-SIDE diff of
// old_data → new_data so the existing columns stay meaningful. Both routes are gated identically by
// requirePerm('audit:read') (F5), so the permission gate is unchanged. NOTE: this diff is computed
// on the client from whole-object snapshots — a server-side field-level rewrite across the 12
// logAudit sites (Option A) is the durable follow-up. Neither is tamper-proof: audit_log is a
// mutable table, so true immutability is a separate DB-level hardening concern.
const _AUDIT_NOISE=new Set(['id','user_id','entity_id','created_at','updated_at','ip','_dbId']);
function _auditFlatten(o){
  if(!o||typeof o!=='object')return {};
  const out={};
  for(const k of Object.keys(o)){
    const v=o[k];
    if(k==='data'&&v&&typeof v==='object'&&!Array.isArray(v)) Object.assign(out,_auditFlatten(v));
    else out[k]=v;
  }
  return out;
}
function _auditParse(s){ if(s==null)return null; if(typeof s==='object')return s; try{return JSON.parse(s);}catch(e){return null;} }
function _auditVal(v){ if(v==null)return ''; if(typeof v==='object')return JSON.stringify(v); return String(v); }
// One audit_log event → one or more display rows (one per changed field). CREATE lists new values,
// DELETE lists old values, UPDATE lists only fields whose value actually changed.
// LR8 (decision 2026-10-21): a budget target is stored as an ANNUAL figure — the Audit line says so ("300 per year"),
// so a $25 / month entry is not misread as a $300 change.
function _auditUnit(r,v){
  if(v==null||v==='') return v;
  return (r&&r.table_name==='budget_targets'&&/^-?\d+(\.\d+)?$/.test(String(v).trim())) ? String(v).trim()+' per year' : v;
}
function _auditDiff(action,oldRaw,newRaw){
  const o=_auditFlatten(_auditParse(oldRaw)), n=_auditFlatten(_auditParse(newRaw));
  const keys=[...new Set([...Object.keys(o),...Object.keys(n)])].filter(k=>!_AUDIT_NOISE.has(k));
  const changed=[];
  for(const k of keys){
    const ov=_auditVal(o[k]), nv=_auditVal(n[k]);
    if(ov!==nv) changed.push({field:k,old:ov,new:nv});
  }
  if(!changed.length) changed.push({field:'—',old:'',new:''}); // payload-less events (e.g. CHANGE_PASSWORD)
  return changed;
}
async function loadAuditTrail(){
  const tbody=document.getElementById('audit-trail-body');
  const countEl=document.getElementById('audit-event-count');
  const lastTimeEl=document.getElementById('audit-last-time');
  const lastActEl=document.getElementById('audit-last-action');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="8" style="padding:1.5rem;text-align:center;color:var(--t3)">Loading…</td></tr>';
  try{
    const tbl=document.getElementById('audit-filter-table')?.value||'all';
    const act=document.getElementById('audit-filter-action')?.value||'all';
    const params=new URLSearchParams();
    params.set('limit','500');
    if(tbl&&tbl!=='all')params.set('type',tbl);           // /api/audit-log filters table via `type`
    const res=await fetch('/api/audit-log?'+params.toString(),{credentials:'include'});
    if(!res.ok)throw new Error(res.status);
    const data=await res.json();
    let events=Array.isArray(data)?data:(data.rows||[]);   // /api/audit-log returns {total, rows}
    if(act&&act!=='all'){ const _acts=act.split(','); events=events.filter(r=>_acts.includes(r.action)); }  // action filtered client-side; C29: a value may be a group
    if(countEl)countEl.textContent=events.length;
    if(events.length&&lastTimeEl){
      const d=new Date(events[0].created_at);
      lastTimeEl.textContent=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      if(lastActEl)lastActEl.textContent=events[0].action||'—';
    }
    if(!events.length){
      tbody.innerHTML='<tr><td colspan="8" style="padding:1.5rem;text-align:center;color:var(--t3)">No audit events found.</td></tr>';
      return;
    }
    const actionBadge={CREATE:'b-green',UPDATE:'b-amber',DELETE:'b-red'};
    tbody.innerHTML=events.map(r=>{
      const d=new Date(r.created_at);
      const dStr=d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
      const badge=actionBadge[r.action]||'b-amber';
      return _auditDiff(r.action,r.old_data,r.new_data).map(f=>`<tr style="border-bottom:1px solid var(--bd)">
        <td style="padding:5px 8px;color:var(--t2);font-size:11px;white-space:nowrap">${esc(dStr)}</td>
        <td style="padding:5px 8px;color:var(--t1);font-family:var(--font-mono);font-size:11px">${esc(r.table_name||'')}</td>
        <td style="padding:5px 8px;color:var(--t1);font-family:var(--font-mono);font-size:11px">${r.record_id||'—'}</td>
        <td style="padding:5px 8px"><span class="badge ${badge}" style="font-size:9px">${esc(r.action||'')}</span>${r.actor_type==='admin'?'<span class="badge b-blue" style="font-size:9px;margin-left:4px" title="Changed by FinFlow support">FinFlow support</span>':''}</td>
        <td style="padding:5px 8px;color:var(--t1);white-space:nowrap">${esc(r.actor_name||'—')}</td>
        <td style="padding:5px 8px;color:var(--t2)">${esc(f.field||'—')}</td>
        <td style="padding:5px 8px;color:var(--red);font-family:var(--font-mono);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(_auditUnit(r,f.old)||'')}">${esc(_auditUnit(r,f.old)||'—')}</td>
        <td style="padding:5px 8px;color:var(--green);font-family:var(--font-mono);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(_auditUnit(r,f.new)||'')}">${esc(_auditUnit(r,f.new)||'—')}</td>
      </tr>`).join('');
    }).join('');
  }catch(e){
    tbody.innerHTML='<tr><td colspan="8" style="padding:1.5rem;text-align:center;color:var(--red)">Failed to load audit trail.</td></tr>';
  }
}

function exportAuditCSV(){
  const rows=document.querySelectorAll('#audit-trail-body tr');
  if(!rows.length)return;
  const headers=['Date','Table','Record ID','Action','By','Field','Old Value','New Value'];   // LR12: By
  const lines=[headers.join(',')];
  rows.forEach(tr=>{
    const cells=tr.querySelectorAll('td');
    if(cells.length<8)return;
    const row=Array.from(cells).map(td=>'"'+td.textContent.replace(/"/g,'""')+'"');
    lines.push(row.join(','));
  });
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='audit-trail.csv';
  a.click();
}

// ── FEATURE 2: PARTIAL PAYMENTS — F113/F114/F115: the sole invoice-settle path ────
// Replaces markInvoicePaid (deleted, finflow-api-wiring-medium.js). Opened with the FULL
// invoice object (not bare id/client/amount strings) so Total/Paid/Remaining can be shown and
// the overpayment guard can be checked inline, before the server ever sees the request.
let _rpInvoiceId=null;
let _rpRemaining=0;
function openRecordPaymentModal(inv){
  if(!inv) return;
  _rpInvoiceId = inv._dbId ?? inv.id ?? null;
  window._ipIdemKey=null;   // C1 Wave 1b: fresh submit-intent → a payment for a newly-opened invoice never reuses the last token
  const total = parseFloat(inv.amount) || 0;
  const paid  = parseFloat(inv.amount_paid) || 0;
  _rpRemaining = Math.round((total - paid) * 100) / 100;
  const sub=document.getElementById('rp-sub');
  // inv.num is a seed-only field — real (UI-created) invoices never get one (server.js's
  // POST /api/invoices accepts no `num`), so show client + total instead of relying on it.
  if(sub) sub.textContent=[inv.client, S(total)].filter(Boolean).join(' — ');
  const tEl=document.getElementById('rp-total');     if(tEl) tEl.textContent=S(total);
  const pEl=document.getElementById('rp-paid');      if(pEl) pEl.textContent=S(paid);
  const rEl=document.getElementById('rp-remaining'); if(rEl) rEl.textContent=S(_rpRemaining);
  const idEl=document.getElementById('rp-invoice-id');
  if(idEl)idEl.value=_rpInvoiceId||'';
  const amtEl=document.getElementById('rp-amount');
  if(amtEl)amtEl.value = _rpRemaining>0 ? _rpRemaining : '';
  // F115: date defaults ONLY from the server-resolved today (window._serverToday, set at boot
  // from GET /api/auth/me). NEVER the browser clock — if it hasn't loaded yet, block the field
  // and Save instead of falling back (locked decision).
  const dateEl=document.getElementById('rp-date');
  if(dateEl){
    if(window._serverToday){ dateEl.value=window._serverToday; dateEl.disabled=false; dateEl.placeholder=''; }
    else { dateEl.value=''; dateEl.disabled=true; dateEl.placeholder='Loading…'; }
  }
  const refEl=document.getElementById('rp-reference');
  if(refEl)refEl.value='';
  const notesEl=document.getElementById('rp-notes');
  if(notesEl)notesEl.value='';
  _rpCheckOverpay();
  openModal('record-payment-modal');
}
function _rpFillFull(){
  const amtEl=document.getElementById('rp-amount');
  if(amtEl) amtEl.value=_rpRemaining;
  _rpCheckOverpay();
}
function _rpCheckOverpay(){
  const amt=parseFloat(document.getElementById('rp-amount')?.value||0);
  const over=amt > _rpRemaining + 0.005;
  const warnEl=document.getElementById('rp-overpay-warn');
  if(warnEl) warnEl.classList.toggle('hidden', !over);
  const saveBtn=document.getElementById('rp-save-btn');
  if(saveBtn) saveBtn.disabled = over || !window._serverToday;
}
async function recordPayment(){
  if(window._savingPayment) return;   // C1 Wave 1b: in-flight re-entry lock — a double-click can't book a 2nd payment
  const invoiceId=document.getElementById('rp-invoice-id')?.value;
  const amount=parseFloat(document.getElementById('rp-amount')?.value||0);
  const date=document.getElementById('rp-date')?.value;
  const method=document.getElementById('rp-method')?.value||'bank_transfer';
  const reference=document.getElementById('rp-reference')?.value||'';
  const notes=document.getElementById('rp-notes')?.value||'';
  if(!invoiceId){notify('No invoice selected',true);return;}
  if(!amount||amount<=0){notify('Enter a valid amount',true);return;}
  if(!window._serverToday||!date){notify("Still loading today's date — try again in a moment",true);return;}
  if(amount > _rpRemaining + 0.005){notify('Amount exceeds the remaining balance',true);return;}
  if(!window._ipIdemKey) window._ipIdemKey=(window.crypto?.randomUUID?window.crypto.randomUUID():'ip-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  window._savingPayment=true;
  const _rpBtn=document.querySelector('#record-payment-modal .btn-primary');
  if(_rpBtn)_rpBtn.disabled=true;
  try{
    const res=await fetch('/api/invoice-payments',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({invoice_id:invoiceId,amount,payment_date:date,method,reference,notes,idempotency_key:window._ipIdemKey}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    window._ipIdemKey=null;   // success → next payment mints a fresh token
    closeModal('record-payment-modal');
    notify('✓ Payment recorded');
    // F113/F114: the established live-refresh triple (finflow-api-wiring-pages.js's own save
    // handlers already use this same sequence) — NOT window.finflow.refresh(), whose dispatch
    // table has no working 'payments-received' entry. refreshFinancials('invoices') refetches
    // /api/invoices, rebuilds window.userInvoices/_realInvoices, and re-renders whichever page
    // is currently active (the invoice row flips paid/partial live); the other two force the
    // ledger and dashboard to refresh even when they aren't the active page right now.
    if(typeof window.refreshFinancials==='function') await window.refreshFinancials('invoices');
    window._loadPaymentsRecvFromDB?.();
    window._refreshDashboardUI?.();
  }catch(e){notify('Could not record payment',true);}   // keep _ipIdemKey for an idempotent retry (same token → 23505 → original)
  finally{window._savingPayment=false;if(_rpBtn)_rpBtn.disabled=false;}
}

// ── FEATURE 2b: BANK RECONCILIATION ──────────────────────────────────────────
let _brecBankSelected=null;
// F101: staged (unsaved) matches held client-side. Each pairing queues here instead of firing its
// own POST; "Save matches" commits the whole set in ONE batch request (/match-batch).
let _brecPending=[];
let _brecSaving=false;
// G4 (2026-10-22): ONE scorer for every bank-rec match suggestion — money out → open bills, money in → recorded invoice
// payments. It weighs the amount, the name on the bank line and the date, says WHY each suggestion is made, and
// preselects only a clear winner: C17 fell back to the FIRST open bill when nothing matched (a $5,850 debit arrived
// with a $44 bill selected) and broke ties silently, so one click could book the wrong match.
// cand: { amount, name, date, kind: 'bill' | 'payment' }. A suggestion needs an exact amount or the name on the line.
function _brecScore(line, cand){
  const amt=Math.abs(parseFloat(line.amount)||0), ca=Math.abs(parseFloat(cand.amount)||0);
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const desc=' '+norm(line.description||line.merchant)+' ', name=norm(cand.name);
  const words=name.split(' ').filter(w=>w.length>=3);
  const why=[]; let score=0;
  if(Math.abs(ca-amt)<0.005){ score+=100; why.push('exact amount'); }
  else if(amt>0&&Math.abs(ca-amt)<=amt*0.01){ score+=40; why.push('amount within 1%'); }
  if(name&&(desc.indexOf(' '+name+' ')>=0||(words.length&&words.every(w=>desc.indexOf(' '+w+' ')>=0)))){ score+=60; why.push((cand.kind==='bill'?'vendor':'customer')+' named on the line'); }
  const ld=window.FinFlowDates?window.FinFlowDates._toYmd(line.tx_date||line.date):null, cd=window.FinFlowDates?window.FinFlowDates._toYmd(cand.date):null;
  if(ld&&cd){   // two calendar dates, both read as UTC midnight — the gap in days is the same for every viewer
    const days=Math.round(Math.abs(Date.parse(ld+'T00:00:00Z')-Date.parse(cd+'T00:00:00Z'))/864e5);
    if(days<=14){ score+=15-days; why.push(days===0?'same day':(days+' day'+(days===1?'':'s')+' apart')); }
  }
  return { score, why, suggested: score>=60 };
}
// Ranks candidates; `pick` is the single clear winner (suggested and strictly ahead of the next), else null.
function _brecRank(line, cands){
  const amt=Math.abs(parseFloat(line.amount)||0);
  const ranked=cands.map(c=>Object.assign({ c }, _brecScore(line, c)))
    .sort((a,b)=>(b.score-a.score)||(Math.abs(Math.abs(a.c.amount)-amt)-Math.abs(Math.abs(b.c.amount)-amt)));
  const sug=ranked.filter(r=>r.suggested);
  const pick=sug.length&&(sug.length===1||sug[0].score>sug[1].score)?sug[0]:null;
  return { ranked, sug, pick };
}
window._brecRank=_brecRank;
// Money in: the recorded payments, ranked against the selected bank line when there is one.
function _brecRenderPay(){
  const payList=document.getElementById('brec-pay-list'); if(!payList) return;
  const last=window._brecLast||{ unbank:[], unpay:[] };
  const line=_brecBankSelected!=null?(last.unbank||[]).find(b=>b.id===_brecBankSelected):null;
  let rows=(last.unpay||[]).map(p=>({ p, suggested:false, why:[] }));
  if(line){
    const r=_brecRank(line,(last.unpay||[]).map(p=>({ amount:p.amount, name:p.client, date:p.payment_date, kind:'payment', p })));
    rows=r.ranked.map(x=>({ p:x.c.p, suggested:x.suggested, why:x.why }));
  }
  payList.innerHTML=rows.length?rows.map(({p,suggested,why})=>`
        <div class="tx-row" style="cursor:pointer" onclick="matchBankRec(_brecBankSelected,${p.id})">
          <div><div class="tx-name">${esc(p.client||'Invoice payment')}${suggested?` <span class="badge b-green" style="font-size:9.5px">Suggested · ${esc(why.join(' · '))}</span>`:''}</div>
          <div class="tx-cat">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(p.payment_date,{year:true}):(p.payment_date||''))||'—')} · ${esc(p.method||'')}</div></div>
          <div class="tx-amt up">+${S(parseFloat(p.amount))}</div>
        </div>`).join('')
    :'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">All payments matched</div>';
}
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

    let unbank=data.unmatchedBanking||data.unmatched_bank||[];
    let unpay=data.unmatchedPayments||data.unmatched_payments||[];
    const matched=data.matched||[];

    // F101: hide staged bank tx + payments from the "unmatched" columns so the same row can't be
    // staged twice; they render in the pending block below until Save commits them.
    const _stagedBank=new Set(_brecPending.map(m=>m.banking_id));
    const _stagedPay =new Set(_brecPending.map(m=>m.invoice_payment_id));
    unbank=unbank.filter(b=>!_stagedBank.has(b.id));
    unpay =unpay.filter(p=>!_stagedPay.has(p.id));

    // C8: lines still needing attention — credits to match plus debits not yet booked / matched / ignored.
    if(ubEl)ubEl.textContent=unbank.length+(data.unmatchedDebits||[]).length;
    if(upEl)upEl.textContent=unpay.length;
    if(mcEl)mcEl.textContent=matched.length;

    if(bankList){
      bankList.innerHTML=unbank.length?unbank.map(b=>`
        <div class="tx-row" style="cursor:pointer;border-left:2px solid transparent;padding-left:8px;transition:border-color .15s" id="bbtx-${b.id}"
          onclick="selectBankTx(${b.id},this)">
          <div><div class="tx-name">${esc(b.description||b.merchant||'Transaction')}</div>
          <div class="tx-cat">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(b.tx_date||b.date,{year:true}):(b.tx_date||b.date||''))||'—')}${b.account_name?' · '+esc(b.account_name):''}</div></div>
          <div class="tx-amt up">+${S(Math.abs(parseFloat(b.amount)))}</div>
        </div>`).join('')
        :'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">All bank transactions matched</div>';
    }
    window._brecLast={ unbank, unpay };   // G4: the selected line re-ranks these without a refetch
    if(payList) _brecRenderPay();
    if(matchedList){
      // F101: pending (unsaved) block first, with the single Save button that commits ALL staged
      // pairs in one batch POST; then the persisted matches from the server.
      const pendingHtml=_brecPending.length?`
        <div style="padding:8px;margin-bottom:8px;border:1px dashed var(--acc);border-radius:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-size:12px">${_brecPending.length} pending (unsaved)</strong>
            <button class="btn btn-primary btn-sm" style="font-size:11px" onclick="saveBankRecMatches()">Save ${_brecPending.length} match${_brecPending.length===1?'':'es'}</button>
          </div>
          ${_brecPending.map((m,i)=>`<div class="tx-row"><div><div class="tx-name">Bank ID ${m.banking_id} ↔ Payment ID ${m.invoice_payment_id}</div><div class="tx-cat">pending — unsaved</div></div><button class="btn btn-ghost btn-sm" style="font-size:10px" onclick="unstageBankRec(${i})">Remove</button></div>`).join('')}
        </div>`:'';
      const savedHtml=matched.length?matched.map(m=>`
        <div class="tx-row">
          <div><div class="tx-name">Bank ID ${m.banking_id} ↔ Payment ID ${m.invoice_payment_id}</div>
          <div class="tx-cat">${esc(m.status||'matched')} · ${new Date(m.matched_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></div>
          <button class="btn btn-ghost btn-sm" style="font-size:10px" onclick="unmatchBankRec(${m.id})">Unmatch</button>
        </div>`).join('')
        :(_brecPending.length?'':'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">No matched pairs yet — select a bank transaction then a payment to match.</div>');
      matchedList.innerHTML=pendingHtml+savedHtml;
    }
    const debEl=document.getElementById('brec-debits-list');
    if(debEl){
      const debits=data.unmatchedDebits||[];
      // G4 (replaces C17's first-bill fallback): the bills are ranked by the shared scorer against each debit — what is still
      // owed vs the line, the vendor named on the line, the due date. Suggestions come first with their reason; only a
      // single clear winner is preselected; with nothing suggested (or a tie) the dropdown starts on "Choose…" and the
      // line says why, so "Match bill" can never book a guess.
      const _bills=(data.openBills||[]);
      const _rem=function(b){return Math.round(((parseFloat(b.amount)||0)-(parseFloat(b.amount_paid)||0))*100)/100;};
      const _rankFor=function(d){return _brecRank(d,_bills.map(function(b){return { amount:_rem(b), name:b.vendor, date:b.due_date, kind:'bill', b:b };}));};
      const _opt=function(x,pick){const b=x.c.b;return '<option value="'+b.id+'"'+(pick&&pick.c.b.id===b.id?' selected':'')+'>'+(x.suggested?'★ ':'')+esc((b.vendor||'Bill')+' - '+S(_rem(b))+(x.suggested?' · '+x.why.join(' · '):''))+'</option>';};
      const billOptsFor=function(d,r){
        const rest=r.ranked.filter(function(x){return !x.suggested;});
        return '<option value="">Choose the bill this pays…</option>'
          +(r.sug.length?'<optgroup label="Suggested">'+r.sug.map(function(x){return _opt(x,r.pick);}).join('')+'</optgroup>':'')
          +(rest.length?'<optgroup label="'+(r.sug.length?'Other open bills':'Open bills')+'">'+rest.map(function(x){return _opt(x,null);}).join('')+'</optgroup>':'');
      };
      const _whyFor=function(r){
        if(r.pick) return 'Suggested: '+r.pick.why.join(' · ');
        if(r.sug.length>1) return r.sug.length+' bills match equally — choose one';
        return 'No open bill matches this amount or name';
      };
      const billOpts=_bills.length?'1':'';
      debEl.innerHTML=debits.length?debits.map(function(d){
        const when=(window.FinFlowDates?window.FinFlowDates.fmtLabel(d.tx_date||d.date,{year:true}):(d.tx_date||d.date||''))||'—';
        const _r=billOpts?_rankFor(d):null;
        const whyLine=_r?'<div class="tx-cat" id="brec-why-'+d.id+'" style="color:'+(_r.pick?'var(--green)':'var(--t3)')+'">'+esc(_whyFor(_r))+'</div>':'';
        const billSel=billOpts?('<select id="brec-bill-'+d.id+'" aria-describedby="brec-why-'+d.id+'" style="font-size:10px;background:var(--card);color:var(--t2);border:1px solid var(--bd);border-radius:5px;padding:2px 4px;max-width:220px">'+billOptsFor(d,_r)+'</select><button class="btn btn-ghost btn-sm" style="font-size:10px" onclick="ffBankMatchBill('+d.id+')">Match bill</button>'):'';
        return '<div class="tx-row" style="align-items:center">'+
          '<div><div class="tx-name">'+esc(d.description||'Debit')+'</div><div class="tx-cat">'+esc(when)+' - money out</div>'+whyLine+'</div>'+
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end">'+
            '<div class="tx-amt dn" style="margin-right:6px">'+S(Math.abs(parseFloat(d.amount)||0))+'</div>'+
            '<button class="btn btn-ghost btn-sm" style="font-size:10px" onclick="ffBankBookExpense('+d.id+')">Book expense</button>'+
            billSel+
            '<button class="btn btn-ghost btn-sm" style="font-size:10px;opacity:.7" onclick="ffBankIgnore('+d.id+')">Ignore</button>'+
          '</div></div>';
      }).join(''):'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">No unreconciled business debits.</div>';
    }
    // LR16: every handled line, with what was done — nothing leaves Bank Rec without a trace.
    const hEl=document.getElementById('brec-handled-list');
    if(hEl){
      const _hs={expense:'Booked as an expense',bill:'Matched to a bill',ignored:'Ignored (not a business cost)'};
      const hl=data.handled||[];
      hEl.innerHTML=hl.length?hl.map(h=>`<div class="tx-row"><div><div class="tx-name">${esc(h.description||'Transaction')}</div><div class="tx-cat">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(h.tx_date,{year:true}):(h.tx_date||''))||'—')} · ${esc(_hs[h.reconcile_state]||h.reconcile_state)}</div></div><span class="tx-amt" style="color:${h.tx_type==='credit'?'var(--green)':'var(--red)'}">${h.tx_type==='credit'?'+':'−'}${S(h.amount)}</span></div>`).join(''):'<div style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">No handled lines yet.</div>';
    }
  }catch(e){if(typeof notify==='function')notify('Could not load bank reconciliation');}
}
async function _brecAction(url,body,okMsg){
  try{
    const r=await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
    if(typeof notify==='function') notify(d.duplicate?'Already reconciled':okMsg,false);
    await loadBankRec();
    if(typeof window.refreshFinancials==='function'){ try{ await window.refreshFinancials('all'); }catch(_){} }
    if(typeof window.updateDashboard==='function') window.updateDashboard();
    if(typeof window._refreshDashboardUI==='function') window._refreshDashboardUI();
  }catch(e){ if(typeof notify==='function') notify('Could not reconcile - '+(e.message||'try again'),true); }
}
window.ffBankBookExpense=function(id){ _brecAction('/api/bank-reconciliation/book-expense',{banking_id:id},'Booked as expense'); };
window.ffBankIgnore=function(id){ _brecAction('/api/bank-reconciliation/ignore',{banking_id:id},'Ignored'); };
window.ffBankMatchBill=function(id){ const sel=document.getElementById('brec-bill-'+id); const billId=sel?parseInt(sel.value,10):0; if(!billId){ if(typeof notify==='function')notify('Choose the bill this payment settles first',true); return; } _brecAction('/api/bank-reconciliation/match-bill',{banking_id:id,bill_id:billId},'Matched to bill - marked paid'); };
function selectBankTx(id,el){
  _brecBankSelected=id;
  document.querySelectorAll('[id^="bbtx-"]').forEach(el2=>{el2.style.borderLeftColor='transparent';});
  if(el)el.style.borderLeftColor='var(--acc)';
  _brecRenderPay();   // G4: the recorded payments re-rank against this line; matches are marked Suggested, with why
  if(typeof notify==='function')notify('Bank line selected — the payments that match it are marked Suggested. Click one to match.');
}
// F101: pairing no longer fires a POST — it STAGES the pair. All staged pairs commit in one batch
// request via saveBankRecMatches(). Same two-click interaction (select bank tx, click payment).
function matchBankRec(bankingId,paymentId){
  if(!bankingId){notify('Select a bank transaction first',true);return;}
  if(_brecPending.some(m=>m.banking_id===bankingId||m.invoice_payment_id===paymentId)){notify('Already staged',true);return;}
  _brecPending.push({banking_id:bankingId,invoice_payment_id:paymentId});
  _brecBankSelected=null;
  notify('✓ Staged ('+_brecPending.length+' pending) — click "Save matches" to commit');
  loadBankRec();
}
function unstageBankRec(i){ if(i>=0&&i<_brecPending.length){_brecPending.splice(i,1); loadBankRec();} }
async function saveBankRecMatches(){
  if(_brecSaving)return;                                   // in-flight lock — one batch at a time
  if(!_brecPending.length){notify('Nothing to save',true);return;}
  _brecSaving=true;
  try{
    const res=await fetch('/api/bank-reconciliation/match-batch',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({matches:_brecPending.map(m=>({banking_id:m.banking_id,invoice_payment_id:m.invoice_payment_id}))}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}   // keep pending so the user can retry
    const n=data.matched||0, sk=data.skipped||0;
    _brecPending=[];
    notify('✓ Saved '+n+' match'+(n===1?'':'es')+(sk?(' ('+sk+' already matched, skipped)'):''));
    loadBankRec();
  }catch(e){notify('Could not save matches',true);}
  finally{_brecSaving=false;}
}
async function unmatchBankRec(recId){
  try{
    await fetch('/api/bank-reconciliation/'+recId,{method:'DELETE',credentials:'include'});
    notify('Unmatched');
    loadBankRec();
  }catch(e){notify('Could not unmatch',true);}
}

// ── FEATURE 3: PAYROLL RUNS ───────────────────────────────────────────────────
// (Removed runTaxPreview + the Tax Preview Calculator — FinFlow performs no tax calc.)

// Basis C empty state. Shown ONLY when no runs exist — a real 0 with an explanation, never a
// bare $0. Names the roster as the template so the next action is obvious.
function _renderPayrollEmptyState(rows){
  const box=document.getElementById('payroll-empty-state');
  if(!box)return;
  const has=Array.isArray(rows)&&rows.length>0;
  box.style.display=has?'none':'';
  if(has)return;
  const info=document.getElementById('payroll-empty-roster');
  if(!info)return;
  const op=window.ownerPayroll, emps=window.payrollEmployees||[];
  const all=op?[op,...emps]:[...emps];
  const cost=all.reduce((s,e)=>s+(parseFloat(e.gross)||0),0);
  info.textContent = all.length
    ? `Your roster: ${all.length} ${all.length===1?'person':'people'} · ${S(cost)}/month — used as the template for a run.`
    : 'Add someone to your roster first, then run payroll.';
}
window._renderPayrollEmptyState=_renderPayrollEmptyState;

async function loadPayrollRuns(){
  const el=document.getElementById('payroll-runs-list');
  // Basis C: run lines are now the SOLE source of payroll expense, so this data has to reach the
  // KPI engine even when the Payroll page has never been opened. Fetch and stash first; only the
  // list rendering below depends on the DOM element existing.
  let rows=[];
  try{
    const res=await fetch('/api/payroll-runs',{credentials:'include'});
    if(res.ok) rows=await res.json()||[];
    window.payrollRuns=rows;                       // read by computeExpenseBreakdown (basis C)
    _renderPayrollEmptyState(rows);
    if(typeof window.refreshFinancials==='function') window.refreshFinancials('none');
  }catch(e){ /* leave window.payrollRuns as-is; the empty state below reports honestly */ }
  if(!el)return;
  try{
    if(!rows.length){el.innerHTML='<div style="padding:1rem;color:var(--t3);text-align:center;font-size:12px">No payroll runs yet.</div>';return;}
    const statusBadge={draft:'b-amber',approved:'b-blue',paid:'b-green',voided:'b-red'};
    el.innerHTML=rows.map(r=>`
      <div class="tx-row" style="align-items:flex-start">
        <div style="flex:1">
          <div class="tx-name">${esc(r.period)}</div>
          <div class="tx-cat">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(r.run_date,{year:true}):(r.run_date||''))||'—')} · Gross: ${S(parseFloat(r.total_gross||0))} · Net: ${S(parseFloat(r.total_net||0))}</div>
          ${_runWithholdingsLine(r)}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <span class="badge ${statusBadge[r.status]||'b-amber'}" style="font-size:9px">${esc(r.status)}</span>
          ${r.status==='draft'?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="approvePayrollRun(${r.id})">Approve</button>`:''}
          ${r.status==='approved'?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="markPayrollPaid(${r.id})">Mark Paid</button>`:''}
          ${(r.status==='paid'&&r.paid_basis==='net'&&!r.withholdings_remitted_date&&_runWithholdings(r)>0)?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="openRemitWithholdings(${r.id})">Remit</button>`:''}
          ${r.status==='draft'?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px;color:var(--red)" onclick="deletePayrollRun(${r.id})">Delete</button>`:''}
          ${(r.status==='approved'||r.status==='paid')?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px;color:var(--red)" onclick="voidPayrollRun(${r.id})">Void</button>`:''}
        </div>
      </div>`).join('');
  }catch(e){el.innerHTML='<div style="color:var(--red);padding:1rem;font-size:12px">Could not load payroll runs</div>';}
}

// V1 (D1, 2026-10-22): the pay period is a MONTH, picked — never typed. A typed period the date reader could not parse
// silently fell back to the run date (G7), and the default came from the viewer's clock, not the business's (G8, Rule 10).
// The run still stores the display form ("August 2026") every earlier run uses, so the one-run-per-period rule holds.
const _PRM_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function _prmPeriodLabel(ym){ const m=/^(\d{4})-(\d{2})$/.exec(String(ym||'')); return m&&_PRM_MONTHS[+m[2]-1] ? _PRM_MONTHS[+m[2]-1]+' '+m[1] : null; }
function _prmPeriodHint(){
  const el=document.getElementById('prm-period-hint'); if(!el) return;
  const ym=(document.getElementById('prm-period')||{}).value||'';
  const lbl=_prmPeriodLabel(ym); if(!lbl){ el.textContent=''; return; }
  const start=ym+'-01', today=(typeof _entityToday==='function'?_entityToday():'');
  // Says where the money lands BEFORE anyone saves: the expense on the period's first day; cash paid sooner is prepaid.
  el.textContent='Expense recorded in '+lbl+' (from '+(window.FinFlowDates?window.FinFlowDates.fmtLabel(start,{year:true}):start)+')'
    +(today && today<start ? ' · this month has not started — paying before then records prepaid payroll' : '');
}
window._prmPeriodHint=_prmPeriodHint;
function openRunPayrollModal(){
  const period=document.getElementById('prm-period');
  if(period){ period.value=(typeof _entityToday==='function'?_entityToday():new Date().toISOString().slice(0,10)).slice(0,7); _prmPeriodHint(); }
  const runDate=document.getElementById('prm-date');
  if(runDate)runDate.value=(window.todayLocal?window.todayLocal():new Date().toISOString().slice(0,10));  // C3/F37: local date, not UTC
  const notesEl=document.getElementById('prm-notes');
  if(notesEl)notesEl.value='';
  const preview=document.getElementById('prm-preview');
  if(preview){
    const emps=window.payrollEmployees||[];
    const owner=window.ownerPayroll;
    const all=owner?[owner,...emps]:emps;
    if(!all.length){preview.innerHTML='<span style="color:var(--t3)">No employees on payroll yet.</span>';return;}
    preview.innerHTML=all.map(e=>{
      const net=netFromDeductions(e.gross, e.deductions);
      return`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--t1)">${esc(e.fname||'')} ${esc(e.lname||'')}</span><span style="font-family:var(--font-mono);color:var(--green)">${S(net)} net</span></div>`;
    }).join('')
      + '<div class="ded-disclaimer" style="margin-top:8px">Estimate only, based on the deductions you entered. FinFlow performs no tax calculation and is not responsible for tax accuracy.</div>';
  }
  openModal('run-payroll-modal');
}

// C1 durable fix — the idempotency token is minted at ACTION INTENT, not at form-open (form-open
// doesn't exist for shortcuts/bulk/API). It is minted ONCE and REUSED for any retry of the same
// in-flight intent — a double-click, a re-fired shortcut — so every copy carries ONE token and the
// server's UNIQUE(idempotency_key) collapses them to a single row. Cleared only when the intent
// resolves, so the NEXT distinct run mints a fresh token. (Payroll ALSO has the natural-key
// constraint (user_id,entity_id,period) as the primary guarantee; this token is the general
// mechanism/belt-and-suspenders — it becomes operative once the server persists it in the migration
// step. Sent now so the client plumbing is in place and identical across every mutating action.)
let _payrollSubmitToken=null;
function _mintToken(){ try{ return crypto.randomUUID(); }catch(_){ return 'k_'+Date.now()+'_'+Math.random().toString(36).slice(2); } }
async function submitPayrollRun(){
  if(window._savingPayrollRun) return;             // C1: in-flight re-entry lock — a double-click can't fire a 2nd run
  // V1: 'YYYY-MM' from the month picker → the stored display form. A browser without a month picker shows a text box;
  // anything that is not a month is refused here rather than filed under the run date.
  const _pRaw=(document.getElementById('prm-period')?.value||'').trim();
  const period=_prmPeriodLabel(_pRaw) || (/^[A-Za-z]+\s+\d{4}$/.test(_pRaw) && window.FinFlowDates && /^\d{4}-\d{2}-01$/.test(String(window.FinFlowDates.payrollPeriodYmd(_pRaw,null)||'')) ? _pRaw : null);
  const runDate=document.getElementById('prm-date')?.value;
  const notes=document.getElementById('prm-notes')?.value||'';
  if(!period){notify(_pRaw?'Choose the pay period as a month (for example 2026-08)':'Choose a pay period',true);return;}
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
  // Mint at intent; reuse the same token if this intent is retried before it resolves.
  if(!_payrollSubmitToken) _payrollSubmitToken=_mintToken();
  const idempotency_key=_payrollSubmitToken;
  window._savingPayrollRun=true;
  const _prBtn=document.querySelector('#run-payroll-modal .btn-primary');
  if(_prBtn) _prBtn.disabled=true;
  try{
    const res=await fetch('/api/payroll-runs',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({period,run_date:runDate,notes,lines,idempotency_key}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    _payrollSubmitToken=null;                      // intent resolved — next run mints fresh
    closeModal('run-payroll-modal');
    notify(data.already_exists ? 'Payroll for '+(data.period||period)+' already exists — run #'+data.id+' ('+(data.status||'')+')' : '✓ Payroll run created — '+(data.period||data.run?.period||''));   // LR1: never "created" for an existing run
    loadPayrollRuns();
  }catch(e){ notify('Could not create payroll run',true); }   // keep _payrollSubmitToken for an idempotent retry (same token → 23505 → original)
  finally{ window._savingPayrollRun=false; if(_prBtn) _prBtn.disabled=false; }
}

async function approvePayrollRun(id){
  try{
    const res=await fetch('/api/payroll-runs/'+id+'/approve',{method:'PUT',credentials:'include'});
    const d=await res.json().catch(()=>({}));
    if(!res.ok){notify('⚠ '+(d.error||'Could not approve'),true);loadPayrollRuns();return;}   // N58: surface the server's refusal, never a fake ✓
    notify('✓ Payroll approved');
    loadPayrollRuns();
  }catch(e){notify('Could not approve',true);}
}
// M41 (fix pass round 2): withholdings (tax, pension …) are held back from net pay and owed to the authority until
// remitted. A run paid on the 'net' basis shows what is owed and a Remit action; the amount comes from the run's
// LINES (basis C): Σ (gross + bonus + overtime) − Σ net pay. Runs paid before this existed took them out with wages.
function _runWithholdings(r){
  const ls=(r&&Array.isArray(r.lines)?r.lines:[]).filter(Boolean);
  const g=ls.reduce((a,l)=>a+(parseFloat(l.gross)||0)+(parseFloat(l.bonus)||0)+(parseFloat(l.overtime)||0),0);
  const n=ls.reduce((a,l)=>a+(l.net_pay!=null?(parseFloat(l.net_pay)||0):((parseFloat(l.gross)||0)+(parseFloat(l.bonus)||0)+(parseFloat(l.overtime)||0))),0);
  return Math.max(0,Math.round((g-n)*100)/100);
}
function _runWithholdingsLine(r){
  if(!r||r.status!=='paid'||r.paid_basis!=='net') return '';
  const w=_runWithholdings(r); if(!(w>0)) return '';
  const fmt=d=>esc(window.FinFlowDates?window.FinFlowDates.fmtLabel(String(d).slice(0,10),{year:true}):String(d).slice(0,10));
  return r.withholdings_remitted_date
    ? `<div class="tx-cat" style="color:var(--green)">Withholdings ${S(w)} remitted ${fmt(r.withholdings_remitted_date)}</div>`
    : `<div class="tx-cat" style="color:var(--amber)">Withholdings owed: ${S(w)} — remit to the tax authority / fund, then record it here</div>`;
}
function openRemitWithholdings(id){
  const r=(window.payrollRuns||[]).find(x=>x.id===id); if(!r) return;
  document.getElementById('rw-run-id').value=id;
  document.getElementById('rw-sub').textContent=(r.period||'')+' — '+S(_runWithholdings(r))+' withheld';
  const dEl=document.getElementById('rw-date');
  if(window._serverToday){ dEl.value=window._serverToday; dEl.disabled=false; } else { dEl.value=''; dEl.disabled=true; }   // F115: server today only
  openModal('remit-withholdings-modal');
}
async function saveRemitWithholdings(){
  if(window._savingRemit) return;   // in-flight lock; the server stamps the remittance once (idempotent)
  const id=document.getElementById('rw-run-id').value, date=document.getElementById('rw-date').value;
  if(!id) return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){ notify('Enter the date the withholdings were paid',true); return; }
  window._savingRemit=true;
  const btn=document.querySelector('#remit-withholdings-modal .btn-primary'); if(btn) btn.disabled=true;
  try{
    const res=await fetch('/api/payroll-runs/'+encodeURIComponent(id)+'/remit',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({date})});
    const d=await res.json().catch(()=>({}));
    if(!res.ok){ notify('⚠ '+(d.error||'Could not record the remittance'),true); return; }
    closeModal('remit-withholdings-modal');
    notify('✓ Withholdings remitted');
    loadPayrollRuns();
    if(typeof window.refreshFinancials==='function') window.refreshFinancials('expenses');
  }catch(e){ notify('Could not record the remittance',true); }
  finally{ window._savingRemit=false; if(btn) btn.disabled=false; }
}
async function markPayrollPaid(id){
  try{
    let res=await fetch('/api/payroll-runs/'+id+'/mark-paid',{method:'PUT',credentials:'include'});
    let d=await res.json().catch(()=>({}));
    // V1 (D1): a run whose month has not started is paid only once the owner confirms — the server says, in words,
    // when the expense lands; the money is recorded as prepaid payroll until then.
    if(res.status===409&&d.code==='FUTURE_PERIOD'){
      const ok=(typeof window._confirmModal==='function')?await window._confirmModal(d.error+' Pay it now?',{okText:'Pay in advance',cancelText:'Not yet'}):false;
      if(!ok){ notify('Not paid — the run stays approved.'); return; }
      res=await fetch('/api/payroll-runs/'+id+'/mark-paid',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm_future:true})});
      d=await res.json().catch(()=>({}));
    }
    if(!res.ok){notify('⚠ '+(d.error||'Could not update'),true);loadPayrollRuns();return;}   // N58: e.g. "Approve this payroll run before marking it paid."
    // LA3 (live audit 2026-10-13 B2): say what crossed to Personal — or why nothing did. It used to be silent.
    const os=d.owner_salary||{};
    const _m=b=>Number(b.amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+b.currency;   // the business currency, never a display conversion
    if(os.error) notify('✓ Payroll marked paid. ⚠ '+os.error,true);
    else if(os.booked&&os.booked.length) notify('✓ Payroll marked paid · your salary ('+os.booked.map(_m).join(', ')+') is in your Personal income');
    else notify('✓ Payroll marked paid. Nobody on this run is marked as you (the owner), so nothing was added to Personal. To change that, edit yourself on the roster and tick "This is me".',true);
    loadPayrollRuns();
    if(typeof window.loadPersonalFinance==='function'){ try{ window.loadPersonalFinance(); }catch(_){} }
  }catch(e){notify('Could not update',true);}
}
// F106 (HYBRID): a DRAFT run is deleted outright (never recognised); an approved/paid run is VOIDED
// (stays in history marked Voided, drops from the books). loadPayrollRuns() re-stashes
// window.payrollRuns and triggers the financial refresh, so the KPI/chart update immediately.
async function deletePayrollRun(id){
  if(!(await window._confirmModal('Delete this draft payroll run? This cannot be undone.', {danger:true})))return;
  try{
    const res=await fetch('/api/payroll-runs/'+id,{method:'DELETE',credentials:'include'});
    const d=await res.json().catch(()=>({}));
    if(!res.ok){notify('⚠ '+(d.error||'Could not delete'),true);return;}
    notify('✓ Draft run deleted');
    loadPayrollRuns();
  }catch(e){notify('Could not delete run',true);}
}
async function voidPayrollRun(id){
  if(!(await window._confirmModal('Void this payroll run? It stays in history marked Voided and stops counting in your books.', {danger:true})))return;
  try{
    const res=await fetch('/api/payroll-runs/'+id+'/void',{method:'PUT',credentials:'include'});
    const d=await res.json().catch(()=>({}));
    if(!res.ok){notify('⚠ '+(d.error||'Could not void'),true);return;}
    notify('✓ Run voided');
    loadPayrollRuns();
  }catch(e){notify('Could not void run',true);}
}

// ── FEATURE 4: INVENTORY COGS ─────────────────────────────────────────────────
let _stockInIdx=null,_stockOutIdx=null;
function openStockInModal(idx){
  _stockInIdx=idx;
  const item=(window.inventory||[])[idx];
  const sub=document.getElementById('si-sub');
  if(sub&&item)sub.textContent='Stock in for '+esc(item.name||'');
  const idxEl=document.getElementById('si-item-idx');
  if(idxEl)idxEl.value=idx;
  ['si-qty','si-cost','si-notes','si-vendor','si-due'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  { const _f=document.getElementById('si-funding'); if(_f) _f.value='cash'; _siFundingChange(); }   // M34
  { const _d=document.getElementById('si-date'); if(_d) _d.value=(window.todayLocal?window.todayLocal():new Date().toISOString().slice(0,10)); }   // M32: the business day, editable
  window._stockInIdemKey=null;   // C1 Wave 1b: fresh submit-intent → never reuses the last token
  openModal('stock-in-modal');
}
function openStockOutModal(idx){
  _stockOutIdx=idx;
  const item=(window.inventory||[])[idx];
  const sub=document.getElementById('so-sub');
  if(sub&&item)sub.textContent='Stock out for '+esc(item.name||'');
  const idxEl=document.getElementById('so-item-idx');
  if(idxEl)idxEl.value=idx;
  ['so-qty','so-ref'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  { const _d=document.getElementById('so-date'); if(_d) _d.value=(window.todayLocal?window.todayLocal():new Date().toISOString().slice(0,10)); }   // M32: the business day, editable
  const prev=document.getElementById('so-cogs-preview');
  if(prev)prev.style.display='none';
  window._stockOutIdemKey=null;   // C1 Wave 1b: fresh submit-intent → never reuses the last token
  openModal('stock-out-modal');
}
function _siFundingChange(){   // M34: supplier + due date only for a purchase on credit
  const on=(document.getElementById('si-funding')||{}).value==='bill';
  const g=document.getElementById('si-bill-fields'); if(g) g.classList.toggle('hidden',!on);
}
async function submitStockIn(){
  const idx=parseInt(document.getElementById('si-item-idx')?.value);
  const qty=parseFloat(document.getElementById('si-qty')?.value||0);
  const cost=parseFloat(document.getElementById('si-cost')?.value||0);
  const notes=document.getElementById('si-notes')?.value||'';
  if(isNaN(idx)||idx<0){notify('Invalid item',true);return;}
  if(!qty||qty<=0){notify('Enter a valid quantity',true);return;}
  if(!cost||cost<0){notify('Enter a valid unit cost',true);return;}
  const funding=(document.getElementById('si-funding')||{}).value==='bill'?'bill':'cash';   // M34
  const vendor=(document.getElementById('si-vendor')?.value||'').trim();
  const due_date=document.getElementById('si-due')?.value||undefined;
  if(funding==='bill'&&!vendor){notify('Enter the supplier for a purchase on credit',true);return;}
  const item=(window.inventory||[])[idx];
  if(!item){notify('Item not found',true);return;}
  // N110: the item's DATABASE id. This sent item.dbId||idx — items carry _dbId, so the array INDEX went
  // out as inventory_id and the movement landed on whichever item had that id (or 400 for index 0).
  if(!item._dbId){notify('Save this item before recording stock against it',true);return;}
  if(window._savingStockIn) return;   // C1 Wave 1b: in-flight re-entry lock
  if(!window._stockInIdemKey) window._stockInIdemKey=(window.crypto?.randomUUID?window.crypto.randomUUID():'sin-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  window._savingStockIn=true;
  const _siBtn=document.querySelector('#stock-in-modal .btn-primary');
  if(_siBtn)_siBtn.disabled=true;
  try{
    const res=await fetch('/api/inventory-movements',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({inventory_id:item._dbId,type:'purchase',quantity:qty,unit_cost:cost,notes,date:(document.getElementById('si-date')?.value||undefined),funding,vendor:funding==='bill'?vendor:undefined,due_date:funding==='bill'?due_date:undefined,idempotency_key:window._stockInIdemKey}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    window._stockInIdemKey=null;   // success → next movement mints a fresh token
    item.units=(item.units||0)+qty;
    item.cost=cost;
    item.low=item.units<(item.max||0)*.1;
    closeModal('stock-in-modal');
    notify(funding==='bill'?`✓ +${qty} units on credit — bill from ${vendor} added`:`✓ +${qty} units at ${S(cost)} each`);
    if(typeof renderInventory==='function')renderInventory();
    loadCOGS();
    if(funding==='bill'&&typeof window.refreshFinancials==='function') window.refreshFinancials('expenses');   // M34: the new bill / AP
  }catch(e){notify('Could not record stock in',true);}   // keep _stockInIdemKey for idempotent retry
  finally{window._savingStockIn=false;if(_siBtn)_siBtn.disabled=false;}
}
async function submitStockOut(){
  const idx=parseInt(document.getElementById('so-item-idx')?.value);
  const qty=parseFloat(document.getElementById('so-qty')?.value||0);
  const ref=document.getElementById('so-ref')?.value||'';
  if(isNaN(idx)||idx<0){notify('Invalid item',true);return;}
  if(!qty||qty<=0){notify('Enter a valid quantity',true);return;}
  const item=(window.inventory||[])[idx];
  if(!item){notify('Item not found',true);return;}
  if(!item._dbId){notify('Save this item before recording stock against it',true);return;}   // N110
  if(qty>item.units){notify('Quantity exceeds stock on hand',true);return;}
  if(window._savingStockOut) return;   // C1 Wave 1b: in-flight re-entry lock — a double-clicked sale can't double-consume FIFO
  if(!window._stockOutIdemKey) window._stockOutIdemKey=(window.crypto?.randomUUID?window.crypto.randomUUID():'sout-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  window._savingStockOut=true;
  const _soBtn=document.querySelector('#stock-out-modal .btn-primary');
  if(_soBtn)_soBtn.disabled=true;
  try{
    const cogsRes=await fetch('/api/cogs/calculate',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({inventory_id:item._dbId,quantity:qty}),   // N111: the server reads `quantity` (was quantity_sold → 400 → preview 0)
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
      body:JSON.stringify({inventory_id:item._dbId,type:'sale',quantity:qty,unit_cost:cogs/qty,reference:ref,date:(document.getElementById('so-date')?.value||undefined),idempotency_key:window._stockOutIdemKey}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    window._stockOutIdemKey=null;   // success → next movement mints a fresh token
    item.units=Math.max(0,(item.units||0)-qty);
    item.cogs=(parseFloat(item.cogs)||0)+cogs;
    item.low=item.units<(item.max||0)*.1;
    closeModal('stock-out-modal');
    notify(`✓ -${qty} units · COGS ${S(cogs)}`);
    if(typeof renderInventory==='function')renderInventory();
    loadCOGS();
  }catch(e){notify('Could not record stock out',true);}   // keep _stockOutIdemKey for idempotent retry
  finally{window._savingStockOut=false;if(_soBtn)_soBtn.disabled=false;}
}
async function loadCOGS(){
  // LR31: renderInventory asks for COGS while the stock value is unknown, and this repaints renderInventory — so while a
  // load is running, the render it triggers must not start another (window._cogsLoading; renderInventory checks it).
  // Explicit loads (page open, Refresh, period change, switch) are never dropped.
  window._cogsLoading=(window._cogsLoading||0)+1;
  try{
    // F25: fetch the CURRENT PERIOD's COGS (same window the dashboard uses), so opening the COGS
    // page on a Month/Quarter view no longer clobbers window._cogsTotal back to the all-time figure
    // and silently re-breaks the dashboard Net. Falls back to all-time if the helper isn't loaded.
    const _q=(typeof window._cogsPeriodParams==='function')?('?'+window._cogsPeriodParams().toString()):'';
    const res=await fetch('/api/cogs'+_q,{credentials:'include'});
    if(!res.ok) throw new Error('/api/cogs '+res.status);   // LR31: an error reply is not books — keep the last figures, never COGS 0
    const data=await res.json();
    // Stash the entity-scoped FIFO total for the canonical Net (Revenue − COGS − OpEx) used by
    // the dashboard / AI / health score, then re-render them so COGS flows through immediately.
    window._cogsTotal=parseFloat(data.totalCOGS)||0;
    // C7: stock on hand at FIFO cost — the Inventory value card shows this (one figure with the Balance Sheet).
    window._inventoryValue=(data.inventoryValue!=null)?(parseFloat(data.inventoryValue)||0):null;
    window._inventoryValueByItem=(data.inventoryValueByItem&&typeof data.inventoryValueByItem==='object')?data.inventoryValueByItem:null;   // LA5: each row's FIFO value
    { const _iv=document.getElementById('inv-value'); if(_iv && window._inventoryValue!=null) _iv.textContent=S(window._inventoryValue); }
    if(typeof window.renderInventory==='function'){ try{ window.renderInventory(); }catch(e){ console.error('[COGS] inventory repaint failed:', e && e.message); } }   // LA5: rows read the per-item values just loaded
    ['updateDashboard','updateAI','updateHealthScore'].forEach(fn=>{if(typeof window[fn]==='function'){try{window[fn]();}catch(e){}}});
    const totalEl=document.getElementById('cogs-total');
    const revEl=document.getElementById('cogs-revenue');
    const gpEl=document.getElementById('cogs-gross-profit');
    const bdEl=document.getElementById('cogs-breakdown');
    if(totalEl)totalEl.textContent=S(parseFloat(data.totalCOGS||0));
    if(revEl)revEl.textContent=S(parseFloat(data.revenue||0));
    if(gpEl){
      const gp=parseFloat(data.grossProfit||0);
      gpEl.textContent=S(gp);
      gpEl.style.color=gp>=0?'var(--green)':'var(--red)';
    }
    const breakdown=data.breakdown||[];
    if(bdEl){
      const warn=parseInt(data.uncoveredItems||0)>0
        ?`<div style="padding:7px 9px;margin-bottom:6px;border:1px solid var(--red);border-radius:6px;background:rgba(200,60,60,.08);color:var(--red);font-size:11px">⚠ ${data.uncoveredItems} item(s) sold beyond purchase history — those units have no cost basis (FIFO). COGS excludes them, so gross profit is overstated until you record the matching purchases.</div>`
        :'';
      bdEl.innerHTML=breakdown.length?warn+breakdown.map(b=>`
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bd);font-size:12px">
          <span style="color:var(--t1)">${esc(b.name||b.inventory_id||'Item')}${b.no_cost_basis?` <span style="color:var(--red);font-size:10px">⚠ ${b.uncovered_units} unit(s) no cost basis</span>`:''}</span>
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
  }catch(e){ console.warn('[COGS] load failed:', e && e.message); }
  finally{ window._cogsLoading=Math.max(0,(window._cogsLoading||1)-1); }
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

    const unrel=parseFloat(summary.totalUnrealised||0);
    const rel=parseFloat(summary.totalRealised||0);
    const net=parseFloat(summary.netFX!=null?summary.netFX:unrel+rel);
    const noRate=parseInt(summary.openWithoutRate||0);
    const fmtFX=v=>(v>=0?'+':'')+S(Math.abs(v));
    const colFX=v=>v>=0?'var(--green)':'var(--red)';

    const uEl=document.getElementById('fx-unrealised');
    const rEl=document.getElementById('fx-realised');
    const nEl=document.getElementById('fx-net');
    if(uEl){
      uEl.textContent=fmtFX(unrel);uEl.style.color=colFX(unrel);
      // Honest about open positions we couldn't measure (no current rate entered).
      uEl.title=noRate>0?`${noRate} open position(s) excluded — no current rate entered for their currency. Add a rate under FX Rates to include them.`:'';
    }
    if(rEl){rEl.textContent=fmtFX(rel);rEl.style.color=colFX(rel);}
    if(nEl){nEl.textContent=fmtFX(net);nEl.style.color=colFX(net);}

    const ratesList=document.getElementById('fx-rates-list');
    if(ratesList){
      ratesList.innerHTML=(rates.length?rates:[] ).map(r=>`
        <div style="display:grid;grid-template-columns:52px 52px 80px 78px 60px 30px;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px;align-items:center">
          <span style="font-family:var(--font-mono)">${esc(r.from_currency)}</span>
          <span style="font-family:var(--font-mono)">${esc(r.to_currency)}</span>
          <span style="font-family:var(--font-mono)">${parseFloat(r.rate).toFixed(4)}</span>
          <span style="color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(r.rate_date,{year:true}):(r.rate_date||''))||'—')}</span>
          <span>${r.source==='live'?'<span class="badge b-green" style="font-size:9px">Live</span>':'<span class="badge b-amber" style="font-size:9px">Manual</span>'}</span>
          <span style="text-align:right"><button onclick="deleteFXRate(${r.id})" title="Delete rate" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:13px;line-height:1;padding:2px 0 2px 8px" onmouseenter="this.style.color='var(--red)'" onmouseleave="this.style.color='var(--t3)'">✕</button></span>
        </div>`).join('')||'<div style="padding:1rem;color:var(--t3);font-size:12px;text-align:center">No rates yet</div>';
    }

    const txList=document.getElementById('fx-tx-list');
    if(txList){
      txList.innerHTML=(txs.length?txs:[]).map(t=>{
        // Open positions carry a COMPUTED unrealised (null if no current rate); settled carry realised.
        const raw=t.status==='settled'?t.realised_gain_loss:t.unrealised_gain_loss;
        const hasGL=raw!=null;
        const gl=parseFloat(raw)||0;
        const glColor=!hasGL?'var(--t3)':(gl>=0?'var(--green)':'var(--red)');
        const glText=!hasGL?'—':`${gl>=0?'+':''}${S(Math.abs(gl))}`;
        const glTitle=!hasGL?' title="No current rate entered for this currency — add one under FX Rates to see unrealised P/L"':'';
        return`<tr style="border-bottom:1px solid var(--bd)">
          <td style="padding:5px 6px;color:var(--t1);font-family:var(--font-mono)">${esc(t.foreign_currency)}</td>
          <td style="padding:5px 6px;color:var(--t1);font-family:var(--font-mono)">${S(parseFloat(t.foreign_amount))}</td>
          <td style="padding:5px 6px;font-family:var(--font-mono);color:var(--t2)">${parseFloat(t.rate_at_transaction||0).toFixed(4)}</td>
          <td style="padding:5px 6px;font-family:var(--font-mono);color:${glColor}"${glTitle}>${glText}</td>
          <td style="padding:5px 6px"><span class="badge ${t.status==='settled'?'b-green':'b-amber'}" style="font-size:9px">${esc(t.status)}</span></td>
          <td style="padding:5px 6px">${t.status!=='settled'?`<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px" onclick="settleFXTransaction(${t.id})">Settle</button>`:''}</td>
        </tr>`;
      }).join('');
    }
  }catch(e){if(typeof notify==='function')notify('Could not load FX data');}
}

async function addFXRate(btn){
  const from=(document.getElementById('fxr-from')?.value||'').trim().toUpperCase();
  const to=(document.getElementById('fxr-to')?.value||'').trim().toUpperCase();
  const rate=parseFloat(document.getElementById('fxr-rate')?.value||0);
  const date=document.getElementById('fxr-date')?.value||undefined;   // N102: blank ⇒ the server stamps the ENTITY's today (never the UTC day)
  if(!from||!to){notify('Enter both currencies',true);return;}
  if(!rate||rate<=0){notify('Enter a valid rate',true);return;}
  // C1/F117 client layer: route through the shared double-submit guard (disable + re-entry block +
  // guaranteed re-enable in finally). Validation stays ABOVE the guard so bad input never locks btn.
  return withSubmitGuard(btn, async () => {
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
  });
}

// In-app confirm modal (styled like the app; no native "railway.app says" dialog). Returns a
// Promise<boolean>. Reusable — other native (await window._confirmModal(, {danger:true})) sites can migrate to it later.
window._confirmModal=function(message, opts){
  opts=opts||{};
  return new Promise(function(resolve){
    var ex=document.getElementById('_confirm-overlay'); if(ex) ex.remove();
    var overlay=document.createElement('div');
    overlay.id='_confirm-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem';
    var done=function(v){ overlay.remove(); document.removeEventListener('keydown',onKey); resolve(v); };
    function onKey(e){ if(e.key==='Escape') done(false); else if(e.key==='Enter') done(true); }
    overlay.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-lg);padding:1.5rem;max-width:340px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.5)">'
      +'<div style="font-size:13.5px;color:var(--t1);line-height:1.5;margin-bottom:1.25rem">'+esc(message)+'</div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end">'
      +'<button class="btn btn-ghost" id="_confirm-no" style="font-size:12px">'+esc(opts.cancelText||'Cancel')+'</button>'
      +'<button class="btn btn-primary" id="_confirm-yes" style="font-size:12px'+(opts.danger?';background:var(--red);border-color:var(--red)':'')+'">'+esc(opts.okText||'Confirm')+'</button>'
      +'</div></div>';
    overlay.addEventListener('click',function(e){ if(e.target===overlay) done(false); });
    document.body.appendChild(overlay);
    document.getElementById('_confirm-no').onclick=function(){ done(false); };
    document.getElementById('_confirm-yes').onclick=function(){ done(true); };
    document.addEventListener('keydown',onKey);
  });
};

async function deleteFXRate(id){
  if(!(await _confirmModal('Delete this FX rate? This cannot be undone.', {okText:'Delete', danger:true}))) return;
  try{
    const res=await fetch('/api/fx-rates/'+id,{method:'DELETE',credentials:'include'});
    if(!res.ok){notify('Could not delete rate',true);return;}
    notify('✓ Rate deleted');
    loadFXData();
  }catch(e){notify('Could not delete rate',true);}
}

async function addFXTransaction(btn){
  const currency=(document.getElementById('fxt-currency')?.value||'').trim().toUpperCase();
  const amount=parseFloat(document.getElementById('fxt-amount')?.value||0);
  const base=(document.getElementById('fxt-base')?.value||'USD').trim().toUpperCase();
  const rate=parseFloat(document.getElementById('fxt-rate')?.value||0);
  const refType=document.getElementById('fxt-ref-type')?.value||'other';
  const refId=parseInt(document.getElementById('fxt-ref-id')?.value||0)||null;
  if(!currency){notify('Enter foreign currency',true);return;}
  if(!amount||amount<=0){notify('Enter a valid amount',true);return;}
  if(!rate||rate<=0){notify('Enter a valid rate',true);return;}
  // C1/F117 client layer: route through the shared double-submit guard (see withSubmitGuard).
  return withSubmitGuard(btn, async () => {
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
  });
}

// PL#6: settlement rate is collected via #fx-settle-modal (prompt() was removed per audit).
let _fxSettleId=null;
function settleFXTransaction(id){
  _fxSettleId=id;
  const el=document.getElementById('fx-settle-rate'); if(el) el.value='';
  openModal('fx-settle-modal');
}
async function saveFXSettlement(){
  const id=_fxSettleId;
  if(id==null){closeModal('fx-settle-modal');return;}
  const rate=parseFloat(document.getElementById('fx-settle-rate')?.value);
  if(!rate||rate<=0){notify('Enter a valid settlement rate',true);return;}
  try{
    const res=await fetch('/api/fx-transactions/'+id+'/settle',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rate_at_settlement:rate}),
    });
    const data=await res.json();
    if(data.error){notify('⚠ '+data.error,true);return;}
    closeModal('fx-settle-modal');
    _fxSettleId=null;
    const gl=parseFloat(data.transaction?.realised_gain_loss||0);
    notify('✓ Settled · Gain/Loss: '+(gl>=0?'+':'')+S(Math.abs(gl)));
    loadFXData();
  }catch(e){notify('Could not settle',true);}
}
