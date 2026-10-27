// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
      // Live symbol picker for the Add/Edit Holding form — as-you-type, the field queries the keyed
      // search proxy (crypto→CoinGecko, else Finnhub) and shows real matches (symbol · name · class).
      // Picking one fills the exchange ticker + name, so bad symbols can't be entered in the first place.
      (function(){
        var timer, items = [], active = -1;
        function box(){ return document.getElementById('h-ticker-suggest'); }
        function hide(){ var b=box(); if(b){ b.style.display='none'; b.innerHTML=''; } items=[]; active=-1; }
        window._ffHoldingHideSuggest = hide;
        function paint(){
          var b=box(); if(!b) return;
          if(!items.length){ hide(); return; }
          b.innerHTML = items.map(function(r,i){
            // Compact the asset-class label so the right column stays narrow (Finnhub returns verbose
            // strings like "Common Stock"). Keeps the row from clipping at the dropdown edge.
            var ty = String(r.type||'');
            if(/common stock/i.test(ty)) ty='Stock'; else if(/^crypto/i.test(ty)) ty='Crypto'; else if(/etp|etf|fund/i.test(ty)) ty='ETF';
            return '<div data-i="'+i+'" onmousedown="event.preventDefault();window.ffHoldingPick('+i+')" '
              +'style="padding:9px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--bd);'
              +(i===active?'background:var(--acc-bg,#2a2418)':'')+'">'
              +'<span style="font-weight:700;color:var(--t1);font-family:var(--font-mono);min-width:66px;flex-shrink:0;font-size:13px">'+esc(r.symbol||'')+'</span>'
              +'<span style="flex:1;min-width:0;color:var(--t2);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.description||'')+'</span>'
              +'<span style="color:var(--t3);font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0;min-width:38px;text-align:right">'+esc(ty)+'</span>'
              +'</div>';
          }).join('');
          b.style.display='block';
        }
        // Pull the live quote for a symbol into the "Current price" field. Overwrite=true on an explicit
        // pick (they just chose it); on blur we only fill when the field is empty so a manual price stands.
        function fillPrice(sym, type, overwrite){
          var pe=document.getElementById('h-price'); if(!pe || !sym) return;
          if(pe.value && !overwrite) return;
          var prev=pe.placeholder; pe.placeholder='Fetching live price…'; if(overwrite) pe.value='';
          fetch('/api/stock-price?symbol='+encodeURIComponent(sym)+(type==='crypto'?'&type=crypto':''),{credentials:'include'})
            .then(function(r){return r.json();})
            .then(function(d){
              if(d && d.price!=null){ pe.value=Number(d.price); pe.placeholder=prev;
                if(typeof notify==='function') notify('Live price for '+sym+': '+d.price); }
              else { pe.placeholder='No live price — enter manually'; }
            })
            .catch(function(){ pe.placeholder=prev; });
        }
        window.ffHoldingFillPrice = fillPrice;
        function cryptoType(){ return /crypto/i.test((document.getElementById('h-type')||{}).value||'') ? 'crypto' : ''; }
        window.ffHoldingPick = function(i){
          var r = items[i]; if(!r) return;
          var tk=document.getElementById('h-ticker'); if(tk) tk.value=(r.symbol||'').toUpperCase();
          var nm=document.getElementById('h-name'); if(nm && !nm.value) nm.value=r.description||'';
          hide();
          fillPrice((r.symbol||'').toUpperCase(), cryptoType(), true);   // explicit pick → refresh live price
        };
        // Blur: hide the dropdown, and if the user typed a symbol directly (no pick) and left price empty,
        // resolve it and fill the live price. Resolver lives in the investments module (window._ffResolveSymbol).
        window.ffHoldingTickerBlur = function(){
          setTimeout(function(){ if(window._ffHoldingHideSuggest) window._ffHoldingHideSuggest(); }, 150);
          var tk=document.getElementById('h-ticker'), pe=document.getElementById('h-price');
          var type=(document.getElementById('h-type')||{}).value||'';
          if(!tk || !pe || pe.value || !(tk.value||'').trim() || /cash/i.test(type)) return;
          var raw=tk.value.trim(), ct=cryptoType();
          if(typeof window._ffResolveSymbol==='function'){
            Promise.resolve(window._ffResolveSymbol(raw, ct)).then(function(sym){ if(sym && sym!=='CASH') fillPrice(sym, ct, false); }).catch(function(){});
          } else { fillPrice(raw.toUpperCase(), ct, false); }
        };
        window.ffHoldingSearch = function(){
          var tk=document.getElementById('h-ticker'); if(!tk) return;
          var q=(tk.value||'').trim();
          var type=(document.getElementById('h-type')||{}).value||'';
          clearTimeout(timer);
          if(q.length<2 || /cash/i.test(type)){ hide(); return; }
          timer=setTimeout(function(){
            var isC=/crypto/i.test(type);
            fetch('/api/symbol-search?q='+encodeURIComponent(q)+(isC?'&type=crypto':''),{credentials:'include'})
              .then(function(r){return r.json();})
              .then(function(j){ items=(j&&j.results)||[]; active=-1; paint(); })
              .catch(function(){ hide(); });
          }, 260);
        };
        window.ffHoldingSearchKey = function(ev){
          var b=box(); if(!b || b.style.display==='none') return;
          if(ev.key==='Escape'){ hide(); return; }
          if(ev.key==='ArrowDown'){ ev.preventDefault(); active=Math.min(active+1, items.length-1); paint(); }
          else if(ev.key==='ArrowUp'){ ev.preventDefault(); active=Math.max(active-1, 0); paint(); }
          else if(ev.key==='Enter' && active>=0){ ev.preventDefault(); window.ffHoldingPick(active); }
        };
      })();
