
/* ── DEVELOPER / API (self-contained) ──────────────────────────────────────────
   Manages public API keys (create once / list / revoke) and renders the API reference.
   Session-authed management calls; same defensive pattern as the other surfaces. */
(function(){
  var loading=false;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function fmtDate(s){ if(!s) return '—'; try{ return new Date(s).toISOString().slice(0,10); }catch(e){ return '—'; } }

  function fillScope(){
    var sel=document.getElementById('apikey-scope'); if(!sel) return;
    var ents=(window.ENTITIES||[]);
    sel.innerHTML='<option value="all">All entities</option>'+ents.map(function(e){ return '<option value="'+esc(e._dbId)+'">'+esc(e.name||('Entity '+e._dbId))+'</option>'; }).join('');
  }
  function renderRef(){
    var ref=document.getElementById('api-ref'); if(!ref) return;
    var base=(window.location && window.location.origin ? window.location.origin : '') + '/api/v1';
    ref.innerHTML =
      '<p style="margin:0 0 8px"><strong>Base URL</strong> &nbsp;<code>'+esc(base)+'</code></p>'
      + '<p style="margin:0 0 8px"><strong>Auth</strong> &nbsp;send your key on every request: <code>Authorization: Bearer ffk_live_…</code> &nbsp;(or <code>X-API-Key: …</code>)</p>'
      + '<p style="margin:0 0 4px"><strong>Read-only endpoints</strong></p>'
      + '<ul style="margin:0 0 8px;padding-left:18px">'
      + '<li><code>GET /me</code> — verify the key and see its scope</li>'
      + '<li><code>GET /invoices</code> — your invoices &nbsp;<span style="opacity:.8">(<code>?limit=</code> ≤200, <code>?since=</code> ISO date for polling)</span></li>'
      + '<li><code>GET /expenses</code> — your expenses &nbsp;<span style="opacity:.8">(same <code>limit</code>/<code>since</code>)</span></li>'
      + '<li><code>GET /customers</code> — your customers</li>'
      + '<li><code>GET /reports/summary</code> — revenue, expenses, net profit, outstanding</li>'
      + '</ul>'
      + '<p style="margin:0 0 8px">Responses are JSON: <code>{ "object":"list", "count":N, "data":[…] }</code>. An entity-scoped key returns only that entity’s rows; an all-entities key returns everything you own.</p>'
      + '<p style="margin:0"><strong>Zapier</strong> — create a key above, then in Zapier add an <em>API Request</em> / <em>Webhooks</em> action (or a custom app) with the Base URL and the <code>Authorization</code> header. For a "new invoice" trigger, poll <code>GET /invoices?since=</code> and advance the <code>since</code> timestamp. Write actions (create invoice/expense) are coming next.</p>';
  }

  function render(keys){
    var box=document.getElementById('apikey-list'); if(!box) return;
    if(!keys.length){ box.innerHTML='<div style="color:var(--t2);padding:10px 2px">No keys yet. Create one above to start using the API.</div>'; return; }
    var rows='<table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;color:var(--t2);font-size:11px"><th style="padding:5px 6px">Name</th><th style="padding:5px 6px">Key</th><th style="padding:5px 6px">Scope</th><th style="padding:5px 6px">Last used</th><th></th></tr></thead><tbody>';
    keys.forEach(function(k){
      rows+='<tr style="border-top:1px solid var(--bd,rgba(120,120,120,.12))">'
        +'<td style="padding:6px">'+esc(k.name||'Key')+'</td>'
        +'<td style="padding:6px"><code style="font-size:11px">'+esc(k.display||'••••')+'</code></td>'
        +'<td style="padding:6px">'+(k.entity_id?('Entity '+esc(k.entity_id)):'All')+'</td>'
        +'<td style="padding:6px;color:var(--t2)">'+esc(fmtDate(k.last_used_at))+'</td>'
        +'<td style="padding:6px;text-align:right"><button class="btn btn-ghost btn-sm" style="color:#c94a4a" onclick="ffRevokeApiKey('+Number(k.id)+',this)">Revoke</button></td></tr>';
    });
    rows+='</tbody></table>';
    box.innerHTML=rows;
  }

  window.ffLoadApiKeys=async function(){
    var box=document.getElementById('apikey-list'); if(!box) return;
    if(loading) return; loading=true; box.textContent='Loading…'; fillScope(); renderRef();
    try{
      var res=await fetch('/api/api-keys',{credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      if(!res.ok){ box.innerHTML='<div style="color:var(--t2);padding:10px 2px">Couldn’t load keys (error '+res.status+').</div>'; loading=false; return; }
      render(await res.json());
    }catch(e){ box.innerHTML='<div style="color:var(--t2);padding:10px 2px">Couldn’t load keys.</div>'; }
    loading=false;
  };

  window.ffCreateApiKey=async function(btn){
    var nameEl=document.getElementById('apikey-name'), scopeEl=document.getElementById('apikey-scope');
    var name=(nameEl&&nameEl.value.trim())||'API key';
    var scope=(scopeEl&&scopeEl.value)||'all';
    if(btn){ btn.disabled=true; btn.textContent='Creating…'; }
    try{
      var res=await fetch('/api/api-keys',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name, entity_id: scope})});
      var data=await res.json().catch(function(){return {};});
      if(res.ok&&data.key){
        var box=document.getElementById('apikey-new'), val=document.getElementById('apikey-new-val');
        if(val) val.textContent=data.key; if(box) box.style.display='';
        if(nameEl) nameEl.value='';
        if(typeof window.notify==='function') window.notify('Key created — copy it now.');
        await window.ffLoadApiKeys();
      } else { if(typeof window.notify==='function') window.notify(data.error||'Couldn’t create key.', true); }
    }catch(e){ if(typeof window.notify==='function') window.notify('Couldn’t create key.', true); }
    if(btn){ btn.disabled=false; btn.textContent='Create key'; }
  };

  window.ffCopyApiKey=function(btn){
    var val=document.getElementById('apikey-new-val'); if(!val) return;
    try{ navigator.clipboard.writeText(val.textContent); if(btn){ btn.textContent='Copied'; setTimeout(function(){ btn.textContent='Copy'; },1500); } }catch(e){}
  };

  window.ffRevokeApiKey=async function(id,el){
    if(!window.confirm('Revoke this key? Anything using it will stop working immediately. This cannot be undone.')) return;
    if(el){ el.disabled=true; el.textContent='Revoking…'; }
    try{
      var res=await fetch('/api/api-keys/'+encodeURIComponent(id),{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      if(res.ok){ if(typeof window.notify==='function') window.notify('Key revoked.'); await window.ffLoadApiKeys(); }
      else { if(el){ el.disabled=false; el.textContent='Revoke'; } if(typeof window.notify==='function') window.notify('Couldn’t revoke.', true); }
    }catch(e){ if(el){ el.disabled=false; el.textContent='Revoke'; } }
  };

  function wrap(){ if(typeof window.showPage!=='function') return false; var o=window.showPage;
    window.showPage=function(id){ var r=o.apply(this,arguments); if(id==='api'){ try{ window.ffLoadApiKeys(); }catch(e){} } return r; }; return true; }
  if(!wrap()){ var t=0,iv=setInterval(function(){ if(wrap()||++t>80) clearInterval(iv); },25); }
})();
