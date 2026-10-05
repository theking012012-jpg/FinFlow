
/* ── 13-WEEK CASH-FLOW FORECAST (self-contained) ───────────────────────────────
   Renders /api/cashflow-forecast into the Cash Flow page. Read-only; wraps showPage
   like the Review/Reminders surfaces. Draws a projected-balance line as inline SVG
   (no chart-lib dependency) plus a summary and a weekly table. */
(function(){
  var loading=false;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function activeEntityId(){ try{ var e=(window.ENTITIES||[]).find(function(x){return x.active;}); return e&&e._dbId?e._dbId:null; }catch(e){ return null; } }
  function money(n,cur){ if(n==null) return '—'; var x=Number(n)||0; var neg=x<0; var s=Math.abs(x).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}); return (neg?'-':'')+(cur?cur+' ':'')+s; }
  function tile(label,val,sub,color){ return '<div class="mc"><div class="mc-label">'+esc(label)+'</div><div class="mc-val" style="font-size:19px'+(color?';color:'+color:'')+'">'+val+'</div><div class="mc-change neutral">'+esc(sub||'')+'</div></div>'; }

  function svgLine(periods, cashTracked, cur){
    var W=640, H=170, padL=8, padR=8, padT=14, padB=22;
    var vals = cashTracked ? periods.map(function(p){return p.balance;}) : (function(){ var c=0; return periods.map(function(p){ c=p.cumulative; return c; }); })();
    var n=vals.length; if(!n) return '';
    var min=Math.min.apply(null, vals.concat([0])), max=Math.max.apply(null, vals.concat([0]));
    if(min===max){ min-=1; max+=1; }
    var ix=function(i){ return padL + (W-padL-padR)*(n<=1?0:(i/(n-1))); };
    var iy=function(v){ return padT + (H-padT-padB)*(1-(v-min)/(max-min)); };
    var zeroY=iy(0);
    var pts=vals.map(function(v,i){ return ix(i).toFixed(1)+','+iy(v).toFixed(1); }).join(' ');
    // area under the line to the zero baseline
    var area='M '+ix(0).toFixed(1)+' '+zeroY.toFixed(1)+' L '+vals.map(function(v,i){return ix(i).toFixed(1)+' '+iy(v).toFixed(1);}).join(' L ')+' L '+ix(n-1).toFixed(1)+' '+zeroY.toFixed(1)+' Z';
    var lastNeg = vals[n-1] < 0;
    var stroke = lastNeg ? '#c94a4a' : 'var(--green,#4a9e6a)';
    var dots='';
    vals.forEach(function(v,i){ dots+='<circle cx="'+ix(i).toFixed(1)+'" cy="'+iy(v).toFixed(1)+'" r="2" fill="'+(v<0?'#c94a4a':stroke)+'"/>'; });
    return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="170" preserveAspectRatio="none" role="img" aria-label="Projected cash balance over 13 weeks">'
      + '<line x1="'+padL+'" y1="'+zeroY.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+zeroY.toFixed(1)+'" stroke="var(--bd,rgba(120,120,120,.4))" stroke-width="1" stroke-dasharray="3 3"/>'
      + '<path d="'+area+'" fill="'+stroke+'" opacity="0.08"/>'
      + '<polyline points="'+pts+'" fill="none" stroke="'+stroke+'" stroke-width="2" stroke-linejoin="round"/>'
      + dots
      + '<text x="'+padL+'" y="10" font-size="9" fill="var(--t2)">'+esc(money(max,cur))+'</text>'
      + '<text x="'+padL+'" y="'+(H-6)+'" font-size="9" fill="var(--t2)">wk1</text>'
      + '<text x="'+(W-padR-18)+'" y="'+(H-6)+'" font-size="9" fill="var(--t2)">wk'+n+'</text>'
      + '</svg>';
  }

  function render(data){
    var cur=data.currency||'', s=data.summary||{}, periods=data.periods||[];
    var sumBox=document.getElementById('cff-summary'); if(!sumBox) return;
    var tiles='';
    if(s.cash_tracked){
      tiles+=tile('Cash now', money(s.starting_cash,cur), 'From your ledger');
      tiles+=tile('In 13 weeks', money(s.ending_balance,cur), 'Projected balance', s.ending_balance<0?'#c94a4a':'');
      tiles+=tile('Lowest point', s.lowest_balance?money(s.lowest_balance.amount,cur):'—', s.lowest_balance?('Week '+s.lowest_balance.week):'', (s.lowest_balance&&s.lowest_balance.amount<0)?'#c94a4a':'');
      tiles+=tile('Runway', s.runway_weeks?('Week '+s.runway_weeks):'13+ weeks', s.runway_weeks?'Cash goes negative':'Stays positive', s.runway_weeks?'#c94a4a':'var(--green,#4a9e6a)');
    } else {
      tiles+=tile('Net 13-wk flow', money(s.net_change,cur), 'Expected in minus out', s.net_change<0?'#c94a4a':'');
      tiles+=tile('Expected in', money(s.total_inflow,cur), 'AR + recurring');
      tiles+=tile('Expected out', money(s.total_outflow,cur), 'AP + recurring + opex');
      tiles+=tile('Cash balance', 'Not tracked', 'Reconcile GL to project balance');
    }
    sumBox.innerHTML=tiles;
    document.getElementById('cff-chart').innerHTML = svgLine(periods, s.cash_tracked, cur);
    var rows='<table style="width:100%;border-collapse:collapse;min-width:460px"><thead><tr style="text-align:right;color:var(--t2);font-size:11px">'
      +'<th style="text-align:left;padding:4px 6px">Week</th><th style="padding:4px 6px">In</th><th style="padding:4px 6px">Out</th><th style="padding:4px 6px">Net</th>'
      +(s.cash_tracked?'<th style="padding:4px 6px">Balance</th>':'<th style="padding:4px 6px">Cumulative</th>')+'</tr></thead><tbody>';
    periods.forEach(function(p){
      var bal = s.cash_tracked ? p.balance : p.cumulative;
      rows+='<tr style="text-align:right;border-top:1px solid var(--bd,rgba(120,120,120,.12))">'
        +'<td style="text-align:left;padding:4px 6px;color:var(--t2)">'+p.week+' <span style="font-size:10px">'+esc(p.start_date||'')+'</span></td>'
        +'<td style="padding:4px 6px">'+(p.inflow?money(p.inflow,''):'·')+'</td>'
        +'<td style="padding:4px 6px">'+(p.outflow?money(p.outflow,''):'·')+'</td>'
        +'<td style="padding:4px 6px;color:'+(p.net<0?'#c94a4a':'inherit')+'">'+money(p.net,'')+'</td>'
        +'<td style="padding:4px 6px;font-weight:600;color:'+(bal<0?'#c94a4a':'inherit')+'">'+money(bal,'')+'</td></tr>';
    });
    rows+='</tbody></table>';
    document.getElementById('cff-table').innerHTML=rows;
  }

  window.ffLoadForecast=async function(){
    var box=document.getElementById('cff-summary'); if(!box) return;
    if(loading) return; loading=true;
    try{
      var eid=activeEntityId();
      var res=await fetch('/api/cashflow-forecast'+(eid?'?entity_id='+encodeURIComponent(eid):''),{credentials:'same-origin',headers:{'Content-Type':'application/json'}});
      if(!res.ok){ box.innerHTML='<div style="color:var(--t2);font-size:12px">Couldn’t load the forecast (error '+res.status+').</div>'; loading=false; return; }
      render(await res.json());
    }catch(e){ box.innerHTML='<div style="color:var(--t2);font-size:12px">Couldn’t load the forecast.</div>'; }
    loading=false;
  };

  function wrap(){ if(typeof window.showPage!=='function') return false; var o=window.showPage;
    window.showPage=function(id){ var r=o.apply(this,arguments); if(id==='cashflow'){ try{ window.ffLoadForecast(); }catch(e){} } return r; }; return true; }
  if(!wrap()){ var t=0,iv=setInterval(function(){ if(wrap()||++t>80) clearInterval(iv); },25); }
})();
