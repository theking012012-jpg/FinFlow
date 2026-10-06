
/* ── CLASSES & LOCATIONS / SEGMENTS (self-contained) ───────────────────────────
   Renders /api/reports/segments (pure buildSegments engine, read-only) and keeps the
   class/location tag datalists populated from values already in use. Same defensive
   pattern as the other new surfaces: wraps window.showPage, own credentialed fetches. */
(function(){
  var dim='class', loading=false;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function activeEntityId(){ try{ var e=(window.ENTITIES||[]).find(function(x){return x.active;}); return e&&e._dbId?e._dbId:null; }catch(e){ return null; } }
  function money(n,cur){ if(n==null) return '—'; var x=Number(n)||0; var neg=x<0; var s=Math.abs(x).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); return (neg?'-':'')+(cur?cur+' ':'')+s; }

  function fillDatalist(id, values){
    var dl=document.getElementById(id); if(!dl) return;
    dl.innerHTML=(values||[]).map(function(v){ return '<option value="'+esc(v)+'"></option>'; }).join('');
  }
  // Keep the tag suggestion lists current from whatever is already in use.
  window.ffRefreshSegValues=async function(){
    try{
      var eid=activeEntityId(); var q=eid?('&entity_id='+encodeURIComponent(eid)):'';
      var keysOf=function(d){ return (d.segments||[]).map(function(s){return s.key;}).filter(function(k){return k && k!=='(unassigned)';}); };
      var rc=await fetch('/api/reports/segments?dim=class'+q,{credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      if(rc.ok) fillDatalist('seg-classes-dl', keysOf(await rc.json()));
      var rl=await fetch('/api/reports/segments?dim=location'+q,{credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      if(rl.ok) fillDatalist('seg-locations-dl', keysOf(await rl.json()));
    }catch(e){}
  };

  function render(data){
    var box=document.getElementById('seg-list'); if(!box) return;
    var cur=data.currency||'', segs=data.segments||[], t=data.totals||{};
    var basis=document.getElementById('seg-basis'); if(basis) basis.textContent = data.basis ? ('Basis: '+data.basis+'.') : '';
    if(!segs.length){ box.innerHTML='<div style="padding:26px 8px;text-align:center;color:var(--t2)">Nothing tagged yet. Add a class or location on an expense or invoice, then come back.</div>'; return; }
    var rows='<table style="width:100%;border-collapse:collapse;min-width:460px"><thead><tr style="text-align:right;color:var(--t2);font-size:11px">'
      +'<th style="text-align:left;padding:5px 8px">'+(dim==='class'?'Class':'Location')+'</th><th style="padding:5px 8px">Revenue</th><th style="padding:5px 8px">Cost</th><th style="padding:5px 8px">Net</th></tr></thead><tbody>';
    segs.forEach(function(s){
      var un = s.key==='(unassigned)';
      rows+='<tr style="text-align:right;border-top:1px solid var(--bd,rgba(120,120,120,.12))'+(un?';opacity:.72':'')+'">'
        +'<td style="text-align:left;padding:5px 8px;font-weight:'+(un?'400':'600')+'">'+esc(s.key)+'</td>'
        +'<td style="padding:5px 8px">'+money(s.revenue,'')+'</td>'
        +'<td style="padding:5px 8px">'+money(s.expense,'')+'</td>'
        +'<td style="padding:5px 8px;font-weight:600;color:'+(s.net<0?'#c94a4a':'inherit')+'">'+money(s.net,'')+'</td></tr>';
    });
    rows+='</tbody><tfoot><tr style="text-align:right;border-top:2px solid var(--bd,rgba(120,120,120,.3));font-weight:700">'
      +'<td style="text-align:left;padding:6px 8px">Total ('+cur+')</td>'
      +'<td style="padding:6px 8px">'+money(t.revenue,'')+'</td><td style="padding:6px 8px">'+money(t.expense,'')+'</td>'
      +'<td style="padding:6px 8px;color:'+((t.net||0)<0?'#c94a4a':'inherit')+'">'+money(t.net,'')+'</td></tr></tfoot></table>';
    box.innerHTML=rows;
  }

  window.ffSegSetDim=function(d){ dim=(d==='location'?'location':'class');
    var cb=document.getElementById('seg-dim-class'), lb=document.getElementById('seg-dim-location');
    if(cb) cb.style.fontWeight=(dim==='class'?'700':''); if(lb) lb.style.fontWeight=(dim==='location'?'700':'');
    window.ffLoadSegments(); };

  window.ffLoadSegments=async function(){
    var box=document.getElementById('seg-list'); if(!box) return;
    if(loading) return; loading=true; box.textContent='Loading…';
    try{
      var eid=activeEntityId();
      var res=await fetch('/api/reports/segments?dim='+dim+(eid?'&entity_id='+encodeURIComponent(eid):''),{credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      if(!res.ok){ box.innerHTML='<div style="padding:20px 8px;color:var(--t2)">Couldn’t load segments (error '+res.status+').</div>'; loading=false; return; }
      render(await res.json());
    }catch(e){ box.innerHTML='<div style="padding:20px 8px;color:var(--t2)">Couldn’t load segments.</div>'; }
    loading=false;
  };

  function wrap(){ if(typeof window.showPage!=='function') return false; var o=window.showPage;
    window.showPage=function(id){ var r=o.apply(this,arguments); if(id==='segments'){ try{ window.ffLoadSegments(); }catch(e){} } return r; }; return true; }
  if(!wrap()){ var t=0,iv=setInterval(function(){ if(wrap()||++t>80) clearInterval(iv); },25); }
  // Populate tag datalists shortly after boot so suggestions work on the first expense/invoice.
  setTimeout(function(){ try{ window.ffRefreshSegValues(); }catch(e){} }, 1500);
})();
