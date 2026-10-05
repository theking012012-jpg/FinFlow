
/* ── REVIEW / CLEANUP QUEUE (self-contained) ───────────────────────────────────
   Renders the read-only /api/books-review queue. Self-contained and defensive: it
   wraps window.showPage (whichever copy won the load order — Rule 1) so it needs no
   render-dispatch hook, does its own credentialed fetch rather than depending on an
   IIFE-scoped api(), and reuses EXISTING endpoints for the only mutations:
   /api/autocat-rules/ai-suggest (AI category suggestions) and PUT /api/expenses/:id
   (apply a category). It introduces no new money logic. */
(function(){
  var loading = false, lastData = null, suggestions = null;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(n){ try { if (typeof window.S === 'function') return window.S(n); } catch(e){} var x = Number(n)||0; return x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function activeEntityId(){ try { var e=(window.ENTITIES||[]).find(function(x){return x.active;}); return e && e._dbId ? e._dbId : null; } catch(e){ return null; } }
  function setText(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; }
  var PAGE_OF = { expense:'expenses', invoice:'invoices', bill:'bills' };
  var SEV = { high:{bg:'rgba(201,74,74,.14)',fg:'#c94a4a',label:'Duplicate'}, medium:{bg:'rgba(201,168,76,.16)',fg:'#9e7d1e',label:'Needs info'}, low:{bg:'rgba(120,120,120,.14)',fg:'var(--t2)',label:'Review'} };
  var TYPE_LABEL = { duplicate:'Possible duplicate', missing:'Missing info', uncategorized:'Uncategorized', outlier:'Unusually large' };

  function render(){
    var box = document.getElementById('rev-list'); if(!box) return;
    if (!lastData){ box.textContent = 'Loading…'; return; }
    var items = lastData.items || [], s = lastData.summary || {};
    setText('rev-dup', s.duplicate||0);
    setText('rev-fix', (s.missing||0)+(s.uncategorized||0));
    setText('rev-out', s.outlier||0);
    var badge = document.getElementById('badge-review');
    if (badge){ if ((s.total||0)>0){ badge.textContent = s.total; badge.style.display=''; } else { badge.style.display='none'; } }

    if (!items.length){ box.innerHTML = '<div style="padding:28px 8px;text-align:center;color:var(--t2)">Your books look clean — nothing to review right now.</div>'; return; }

    var html = '';
    var uncat = items.filter(function(i){ return i.type==='uncategorized'; });
    if (uncat.length){
      html += '<div style="display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:9px 11px;background:rgba(120,120,120,.07);border-radius:8px">'
        + '<div style="font-size:12px;color:var(--t2)">' + uncat.length + ' uncategorized expense' + (uncat.length===1?'':'s') + '. Let AI propose categories — you approve each one.</div>'
        + '<button class="btn btn-ghost btn-sm" id="rev-ai-btn" style="margin-left:auto" onclick="ffReviewSuggest&&ffReviewSuggest()">Suggest categories (AI)</button></div>';
    }
    items.forEach(function(it){
      var sev = SEV[it.severity] || SEV.low;
      var sug = suggestions && it.type==='uncategorized' ? suggestions[it.id] : null;
      html += '<div class="tx-row" style="display:flex;align-items:center;gap:12px;padding:10px 2px;border-bottom:1px solid var(--bd,rgba(120,120,120,.14))">'
        + '<span style="flex:0 0 auto;font-size:10px;font-weight:600;padding:2px 8px;border-radius:9px;background:'+sev.bg+';color:'+sev.fg+'">'+esc(TYPE_LABEL[it.type]||sev.label)+'</span>'
        + '<div style="flex:1 1 auto;min-width:0">'
        +   '<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.title)+'</div>'
        +   '<div style="font-size:11.5px;color:var(--t2)">'+esc(it.detail)+(it.date?' · '+esc(it.date):'')+'</div>'
        + '</div>'
        + '<div style="flex:0 0 auto;text-align:right;font-variant-numeric:tabular-nums;min-width:90px">'+money(it.amount)+'</div>'
        + '<div style="flex:0 0 auto;display:flex;gap:6px;align-items:center">';
      if (sug && sug.category){
        html += '<span style="font-size:11px;color:var(--t2)">→ '+esc(sug.category)+'</span>'
          + '<button class="btn btn-ghost btn-sm" onclick="ffReviewApplyCat('+Number(it.id)+',this)" data-cat="'+esc(sug.category)+'">Apply</button>';
      } else {
        html += '<button class="btn btn-ghost btn-sm" onclick="window.showPage&&window.showPage(\''+(PAGE_OF[it.kind]||'dashboard')+'\')">View</button>';
      }
      html += '</div></div>';
    });
    box.innerHTML = html;
  }

  window.ffLoadReview = async function(){
    var box = document.getElementById('rev-list'); if(!box) return;
    if (loading) return; loading = true; suggestions = null;
    box.textContent = 'Loading…';
    try {
      var eid = activeEntityId();
      var res = await fetch('/api/books-review' + (eid ? '?entity_id='+encodeURIComponent(eid) : ''), { credentials:'same-origin', headers:{'Content-Type':'application/json'} });
      if (!res.ok){ box.innerHTML = '<div style="padding:20px 8px;color:var(--t2)">Couldn\'t load the review queue (error '+res.status+'). Try Refresh.</div>'; loading=false; return; }
      lastData = await res.json();
      render();
    } catch(e){
      box.innerHTML = '<div style="padding:20px 8px;color:var(--t2)">Couldn\'t load the review queue. Check your connection and try Refresh.</div>';
    }
    loading = false;
  };

  window.ffReviewSuggest = async function(){
    var btn = document.getElementById('rev-ai-btn');
    if (btn){ btn.disabled = true; btn.textContent = 'Asking AI…'; }
    try {
      var res = await fetch('/api/autocat-rules/ai-suggest', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:'{}' });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok){
        if (typeof window.notify === 'function') window.notify(data.error || 'AI suggestions unavailable.', true);
        if (btn){ btn.disabled = false; btn.textContent = 'Suggest categories (AI)'; }
        return;
      }
      suggestions = {};
      (data.suggestions||[]).forEach(function(sg){ if (sg && sg.expense_id!=null && sg.category) suggestions[sg.expense_id] = { category: sg.category, confidence: sg.confidence, source: sg.source }; });
      render();
      if (typeof window.notify === 'function') window.notify('AI proposed categories — review and Apply each.');
    } catch(e){
      if (typeof window.notify === 'function') window.notify('AI suggestions unavailable.', true);
      if (btn){ btn.disabled = false; btn.textContent = 'Suggest categories (AI)'; }
    }
  };

  window.ffReviewApplyCat = async function(id, el){
    var cat = el && el.getAttribute('data-cat'); if (!cat) return;
    el.disabled = true; el.textContent = 'Applying…';
    try {
      var res = await fetch('/api/expenses/'+encodeURIComponent(id), { method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ category: cat }) });
      if (!res.ok){ el.disabled=false; el.textContent='Apply'; if (typeof window.notify==='function') window.notify('Couldn\'t apply category.', true); return; }
      if (suggestions) delete suggestions[id];
      if (typeof window.notify === 'function') window.notify('Category applied.');
      await window.ffLoadReview();   // re-scan so the item leaves the queue and counts update
    } catch(e){ el.disabled=false; el.textContent='Apply'; if (typeof window.notify==='function') window.notify('Couldn\'t apply category.', true); }
  };

  // Wrap whichever showPage won the load order so the queue loads on navigation (Rule 1 safe).
  function wrap(){
    if (typeof window.showPage !== 'function') return false;
    var orig = window.showPage;
    window.showPage = function(id){ var r = orig.apply(this, arguments); if (id==='review'){ try { window.ffLoadReview(); } catch(e){} } return r; };
    return true;
  }
  if (!wrap()){ var tries=0, iv=setInterval(function(){ if (wrap()||++tries>80) clearInterval(iv); }, 25); }
})();
