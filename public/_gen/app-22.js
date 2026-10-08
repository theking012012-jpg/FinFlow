
/* ── PAYMENT REMINDERS (self-contained) ────────────────────────────────────────
   Renders /api/payment-reminders (deterministic predict + draft), lets the owner edit,
   optionally AI-improve the wording, and send ONE reminder at a time. Same defensive
   pattern as the Review page: wraps window.showPage, own credentialed fetches, reuses
   existing endpoints only. Sending is per-invoice and owner-initiated. */
(function(){
  var loading=false, byId={}, biz='';
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function activeEntityId(){ try{ var e=(window.ENTITIES||[]).find(function(x){return x.active;}); return e&&e._dbId?e._dbId:null; }catch(e){ return null; } }
  function setText(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; }
  function money(n,cur){ var x=Number(n)||0; var s=x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); return (cur?cur+' ':'')+s; }
  var SEV={ high:{bg:'rgba(201,74,74,.14)',fg:'#c94a4a'}, medium:{bg:'rgba(201,168,76,.16)',fg:'#9e7d1e'}, upcoming:{bg:'rgba(120,120,120,.14)',fg:'var(--t2)'} };
  function sevLabel(it){ if(it.days_overdue>0) return it.days_overdue+' days overdue'; if(it.days_overdue===0) return 'Due today'; return 'Due in '+(-it.days_overdue)+' days'; }

  function render(data){
    var box=document.getElementById('rem-list'); if(!box) return;
    var items=(data&&data.items)||[], s=(data&&data.summary)||{}, cur=data&&data.currency||'';
    biz=(data&&data.business_name)||'';
    setText('rem-overdue', s.overdue||0);
    setText('rem-soon', s.due_soon||0);
    setText('rem-risk', s.predicted_late||0);
    setText('rem-out', money(s.ar_outstanding!=null ? s.ar_outstanding : (s.total_outstanding||0), cur));   // L35: canonical netted AR
    var b=document.getElementById('badge-reminders'); if(b){ if((s.overdue||0)>0){ b.textContent=s.overdue; b.style.display=''; } else { b.style.display='none'; } }
    byId={}; items.forEach(function(it){ byId[it.invoice_id]=it; });
    if(!items.length){ box.innerHTML='<div style="padding:28px 8px;text-align:center;color:var(--t2)">No invoices need chasing right now — everything is paid or not yet due.</div>'; return; }
    var html='';
    items.forEach(function(it){
      var sev=SEV[it.severity]||SEV.upcoming;
      var risk=it.predicted_late?'<span style="font-size:10px;color:#9e7d1e;margin-left:6px">· predicted late</span>':'';
      html+='<div style="border-bottom:1px solid var(--bd,rgba(120,120,120,.14));padding:11px 2px">'
        + '<div style="display:flex;align-items:center;gap:12px">'
        +   '<span style="flex:0 0 auto;font-size:10px;font-weight:600;padding:2px 8px;border-radius:9px;background:'+sev.bg+';color:'+sev.fg+'">'+esc(sevLabel(it))+'</span>'
        +   '<div style="flex:1 1 auto;min-width:0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.customer_name||it.client)+risk+'</div>'
        +     '<div style="font-size:11.5px;color:var(--t2)">Invoice due '+esc(it.due_date)+(it.has_email?' · '+esc(it.email):' · <span style="color:#c94a4a">no email on file</span>')+'</div></div>'
        +   '<div style="flex:0 0 auto;text-align:right;font-variant-numeric:tabular-nums;min-width:90px">'+money(it.amount_outstanding,cur)+'</div>'
        +   '<button class="btn btn-ghost btn-sm" style="flex:0 0 auto" onclick="ffRemToggle('+Number(it.invoice_id)+')">Review &amp; send</button>'
        + '</div>'
        + '<div id="rem-draft-'+Number(it.invoice_id)+'" style="display:none;margin:10px 0 2px;padding:10px;background:rgba(120,120,120,.06);border-radius:8px">'
        +   '<input id="rem-subj-'+Number(it.invoice_id)+'" value="'+esc(it.draft.subject)+'" style="width:100%;box-sizing:border-box;margin-bottom:7px;padding:7px 9px;border:1px solid var(--bd,rgba(120,120,120,.25));border-radius:6px;background:var(--bg,transparent);color:inherit;font-size:12.5px">'
        +   '<textarea id="rem-body-'+Number(it.invoice_id)+'" rows="7" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid var(--bd,rgba(120,120,120,.25));border-radius:6px;background:var(--bg,transparent);color:inherit;font-size:12.5px;line-height:1.5;resize:vertical">'+esc(it.draft.body)+'</textarea>'
        +   '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">'
        +     '<button class="btn btn-ghost btn-sm" onclick="ffRemAi('+Number(it.invoice_id)+',this)">Improve with AI</button>'
        +     '<button class="btn btn-sm" style="background:var(--amber,#c9a84c);color:#1a140a;border:none" onclick="ffRemSend('+Number(it.invoice_id)+',this)"'+(it.has_email?'':' disabled title="Add a customer email first"')+'>Send reminder</button>'
        +     '<span id="rem-status-'+Number(it.invoice_id)+'" style="font-size:11.5px;color:var(--t2)"></span>'
        +   '</div>'
        + '</div></div>';
    });
    box.innerHTML=html;
  }

  window.ffLoadReminders=async function(){
    var box=document.getElementById('rem-list'); if(!box) return;
    if(loading) return; loading=true; box.textContent='Loading…';
    try{
      var eid=activeEntityId();
      var res=await fetch('/api/payment-reminders'+(eid?'?entity_id='+encodeURIComponent(eid):''),{credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      if(!res.ok){ box.innerHTML='<div style="padding:20px 8px;color:var(--t2)">Couldn’t load reminders (error '+res.status+'). Try Refresh.</div>'; loading=false; return; }
      render(await res.json());
    }catch(e){ box.innerHTML='<div style="padding:20px 8px;color:var(--t2)">Couldn’t load reminders. Check your connection and try Refresh.</div>'; }
    loading=false;
  };

  window.ffRemToggle=function(id){ var d=document.getElementById('rem-draft-'+id); if(d) d.style.display=(d.style.display==='none'?'':'none'); };

  window.ffRemAi=async function(id,btn){
    var body=document.getElementById('rem-body-'+id); if(!body) return;
    if(btn){ btn.disabled=true; btn.textContent='Improving…'; }
    try{
      var res=await fetch('/api/payment-reminders/draft',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoice_id:id})});
      var data=await res.json().catch(function(){return {};});
      if(res.ok&&data.body){ body.value=data.body; var subj=document.getElementById('rem-subj-'+id); if(subj&&data.subject) subj.value=data.subject;
        if(typeof window.notify==='function') window.notify(data.source==='ai'?'AI rewrote the draft.':'Using the standard draft (AI not available).'); }
      else if(typeof window.notify==='function') window.notify(data.error||'Couldn’t improve the draft.',true);
    }catch(e){ if(typeof window.notify==='function') window.notify('Couldn’t improve the draft.',true); }
    if(btn){ btn.disabled=false; btn.textContent='Improve with AI'; }
  };

  window.ffRemSend=async function(id,btn){
    var subj=document.getElementById('rem-subj-'+id), body=document.getElementById('rem-body-'+id);
    var st=document.getElementById('rem-status-'+id);
    if(!subj||!body) return;
    if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
    try{
      var res=await fetch('/api/payment-reminders/send',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoice_id:id,subject:subj.value,body:body.value})});
      var data=await res.json().catch(function(){return {};});
      if(res.ok){ if(st){ st.textContent=data.deduped?'Already sent moments ago.':('Sent'+(data.to?' to '+data.to:'')+'.'); st.style.color='var(--green,#4a9e6a)'; }
        if(btn){ btn.textContent='Sent'; } if(typeof window.notify==='function') window.notify('Reminder sent.'); }
      else { if(st){ st.textContent=data.error||'Send failed.'; st.style.color='#c94a4a'; } if(btn){ btn.disabled=false; btn.textContent='Send reminder'; }
        if(typeof window.notify==='function') window.notify(data.error||'Couldn’t send.',true); }
    }catch(e){ if(st){ st.textContent='Send failed.'; st.style.color='#c94a4a'; } if(btn){ btn.disabled=false; btn.textContent='Send reminder'; } }
  };

  function wrap(){ if(typeof window.showPage!=='function') return false; var o=window.showPage;
    window.showPage=function(id){ var r=o.apply(this,arguments); if(id==='reminders'){ try{ window.ffLoadReminders(); }catch(e){} } return r; }; return true; }
  if(!wrap()){ var t=0,iv=setInterval(function(){ if(wrap()||++t>80) clearInterval(iv); },25); }
})();
