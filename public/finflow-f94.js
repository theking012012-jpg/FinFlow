'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * finflow-f94.js — F94 SCHEDULED DOCUMENTS (its own top-level sidebar tab).
 *
 * A unified, calendar-first agenda of everything set to POST ahead for the ACTIVE entity:
 * recurring invoices / bills / personal runs (runRecurringScheduler) + future-dated one-off docs
 * (window._isScheduled). Reads the account's REAL entities + schedules at runtime — NOTHING is
 * hardcoded (the F94 design prototype's sample companies never ship). Each entity is its own world:
 * amounts total in ITS currency, dates resolve in ITS timezone, holidays follow ITS country (F88).
 *
 * Ships DIRECTLY (not a bundle source): loaded by a <script defer> AFTER finflow-bundle.js in
 * index.html, so its showPage wrapper is the runtime winner (Rule 1). No bundle regen.
 *
 * Read-first: the list + calendar + forecast are a view. Row actions (Pause/Resume/Skip/Cancel)
 * call the EXISTING recurring routes (PUT/DELETE /api/recurring-*). There is deliberately no
 * "run now" — a schedule posts on its date via the server scheduler, never on a client click.
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var SYM = { USD:'$', CAD:'C$', EUR:'€', GBP:'£', TTD:'TT$', AUD:'A$', NGN:'₦', ZAR:'R', BRL:'R$', MXN:'MX$', INR:'₹', JPY:'¥' };
  var MON  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var ICONS = {
    invoice:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2h6l2 2v10H4z"/><path d="M6 7h4M6 10h4"/></svg>',
    bill:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="12" height="9" rx="1"/><path d="M2 7h12M5 10h3"/></svg>',
    personal:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4"/></svg>'
  };
  var icClass = { invoice:'inv', bill:'bill', personal:'pers' };

  // F191 — region capture. Curated to the served markets (Canada, N/C/S America, the Caribbean, Europe);
  // the server validates any value (Intl for tz, ISO-2 regex for country), so this list is a convenience,
  // not the authority. Both are OPTIONAL — blank ⇒ the entity resolves in UTC with the shift inactive.
  var TIMEZONES = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Toronto','America/Vancouver','America/Halifax','America/Mexico_City','America/Bogota','America/Lima','America/Sao_Paulo','America/Argentina/Buenos_Aires','America/Santiago','America/Caracas','America/Panama','America/Costa_Rica','America/Port_of_Spain','America/Jamaica','America/Barbados','America/Santo_Domingo','America/Puerto_Rico','Europe/London','Europe/Dublin','Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Lisbon','Europe/Rome','Europe/Amsterdam','Europe/Brussels','Europe/Stockholm','Europe/Oslo','Europe/Copenhagen','Europe/Helsinki','Europe/Warsaw','Europe/Zurich','Europe/Vienna','Europe/Athens','UTC'];
  var COUNTRIES = [['CA','Canada'],['US','United States'],['MX','Mexico'],['GT','Guatemala'],['BZ','Belize'],['SV','El Salvador'],['HN','Honduras'],['NI','Nicaragua'],['CR','Costa Rica'],['PA','Panama'],['BR','Brazil'],['AR','Argentina'],['CO','Colombia'],['CL','Chile'],['PE','Peru'],['VE','Venezuela'],['EC','Ecuador'],['BO','Bolivia'],['PY','Paraguay'],['UY','Uruguay'],['GY','Guyana'],['SR','Suriname'],['TT','Trinidad & Tobago'],['JM','Jamaica'],['BB','Barbados'],['BS','Bahamas'],['DO','Dominican Republic'],['HT','Haiti'],['GD','Grenada'],['LC','St. Lucia'],['VC','St. Vincent'],['AG','Antigua & Barbuda'],['DM','Dominica'],['KN','St. Kitts & Nevis'],['CU','Cuba'],['PR','Puerto Rico'],['GB','United Kingdom'],['IE','Ireland'],['FR','France'],['DE','Germany'],['ES','Spain'],['PT','Portugal'],['IT','Italy'],['NL','Netherlands'],['BE','Belgium'],['SE','Sweden'],['NO','Norway'],['DK','Denmark'],['FI','Finland'],['PL','Poland'],['CH','Switzerland'],['AT','Austria'],['GR','Greece']];
  function _fillRegionSelect(sel, kind, current){
    if (!sel) return;
    var blank = '<option value="">— none (UTC) —</option>';
    var opts = kind === 'tz'
      ? TIMEZONES.map(function(z){ return '<option value="'+z+'"'+(z===current?' selected':'')+'>'+z+'</option>'; }).join('')
      : COUNTRIES.map(function(c){ return '<option value="'+c[0]+'"'+(c[0]===current?' selected':'')+'>'+esc(c[1])+' ('+c[0]+')</option>'; }).join('');
    sel.innerHTML = blank + opts;
    sel.value = current || '';
  }
  // Exposed so the static Create-Business form (nb-timezone / nb-country) can be filled by the same list.
  window._f94FillRegion = function(){
    _fillRegionSelect(document.getElementById('nb-timezone'), 'tz', '');
    _fillRegionSelect(document.getElementById('nb-country'), 'country', '');
  };

  // ── module state ──
  var filter = 'all', showPaused = true, dayFilter = null, viewY = null, viewM = null, _booted = false, _busy = false;

  function sym(cur){ return SYM[cur] || (cur ? cur + ' ' : '$'); }
  function fmt(n){ return Math.round(n).toLocaleString('en-US'); }
  function ents(){ try { return (typeof ENTITIES !== 'undefined' ? ENTITIES : null) || window.ENTITIES || []; } catch(e){ return window.ENTITIES || []; } }
  function activeEntity(){ var a = ents().find(function(e){ return e.active; }); return a || ents()[0] || null; }
  // The server clock's "today" for the active entity (F88). Falls back to UTC when tz absent.
  function entityToday(){
    try {
      var e = activeEntity();
      if (window.FinFlowDates && typeof window.FinFlowDates.resolvedToday === 'function')
        return window.FinFlowDates.resolvedToday(new Date(), (e && e.timezone) || null);
    } catch(_){}
    return new Date().toISOString().slice(0,10);
  }
  function toYmd(v){ try { return window.FinFlowDates ? window.FinFlowDates._toYmd(v) : String(v).slice(0,10); } catch(_){ return (v==null?null:String(v).slice(0,10)); } }

  // ── assemble the active entity's scheduled items from LIVE data ──
  function buildItems(){
    var e = activeEntity();
    if (!e) return [];
    var eid = e._dbId != null ? e._dbId : null;
    var out = [];
    var pushRecur = function(rows, kind, who){
      (rows || []).forEach(function(r){
        // recurring rows carry entity_id + {client|vendor|description, amount, next_run, frequency, end_date, status, currency}
        if (kind !== 'personal' && eid != null && r.entity_id != null && r.entity_id !== eid) return; // per-entity scope
        if (!r.next_run) return;
        out.push({
          id: r.id, kind: kind, src: 'recurring',
          who: r[who] || r.client || r.vendor || r.description || '—',
          amount: parseFloat(r.amount) || 0,
          cur: r.currency || e.currency || 'USD',
          date: toYmd(r.next_run), freq: r.frequency || 'Monthly',
          end: r.end_date ? toYmd(r.end_date) : null,
          status: (r.status === 'paused') ? 'paused' : 'active'
        });
      });
    };
    pushRecur(window.recurringInvoices, 'invoice', 'client');
    pushRecur(window.recurringBills,    'bill',    'vendor');
    // personal recurring transactions are user-level (no entity_id); show them in every entity's agenda
    pushRecur(window.recurringPersonal || window.recurringPersonalTransactions, 'personal', 'description');

    // future-dated one-off documents (D2 "scheduled") — invoices/bills dated ahead of the entity's today.
    // Source the RAW arrays the app loads (_realInvoices / bills), NOT the display-mapped userInvoices —
    // the mapper drops issue_date + entity_id (and there is no window.userBills at all). Auto-generated
    // rows (recurring_*_id set) are already represented by their recurring template, so exclude them here.
    var isSched = (typeof window._isScheduled === 'function') ? window._isScheduled : function(){ return false; };
    var rawInv = window._realInvoices || window.userInvoices || [];
    rawInv.forEach(function(inv){
      if (inv.recurring_invoice_id != null) return;                                  // shown via its recurring row
      var d = inv.issue_date || inv.date;
      if (eid != null && inv.entity_id != null && inv.entity_id !== eid) return;
      if (d && isSched(d)) out.push({ id: inv.id != null ? inv.id : inv._dbId, kind:'invoice', src:'oneoff', who: inv.client || '—', amount: parseFloat(inv.amount)||0, cur: inv.currency || e.currency || 'USD', date: toYmd(d), freq:'One-off', end:null, status:'scheduled' });
    });
    var rawBills = window.bills || window.userBills || [];
    rawBills.forEach(function(b){
      if (b.recurring_bill_id != null) return;                                        // shown via its recurring row
      var d = b.issue_date || b.date || b.due;
      if (eid != null && b.entity_id != null && b.entity_id !== eid) return;
      if (d && isSched(d)) out.push({ id: b.id != null ? b.id : b._dbId, kind:'bill', src:'oneoff', who: b.vendor || '—', amount: parseFloat(b.amount)||0, cur: b.currency || e.currency || 'USD', date: toYmd(d), freq:'One-off', end:null, status:'scheduled' });
    });

    out = out.filter(function(it){ return it.date; });
    // per-row last-posted lineage: attach the most recent MATERIALISED doc for each recurring row,
    // matched ONLY by the durable link (recurring_invoice_id / recurring_bill_id / recurring_profile_id).
    // No fuzzy party/amount matching — an unlinked historical row simply shows no lineage.
    out.forEach(function(it){ if (it.src === 'recurring') it.lastPosted = lastPostedFor(it); });
    out.sort(function(a,b){ return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  // Last materialised occurrence of a recurring row (link-exact, dated on/before the entity's today).
  function lastPostedFor(it){
    var today = entityToday(), best = null, count = 0;
    var scan = function(rows, matchId, dateOf){
      (rows || []).forEach(function(r){
        if (Number(matchId(r)) !== Number(it.id)) return;
        var d = toYmd(dateOf(r)); if (!d || d > today) return;   // only what has actually posted
        count++; if (!best || d > best) best = d;
      });
    };
    if (it.kind === 'invoice') scan(window._realInvoices || window.userInvoices, function(r){ return r.recurring_invoice_id; }, function(r){ return r.due_date || r.issue_date; });
    else if (it.kind === 'bill') scan(window.bills || window.userBills, function(r){ return r.recurring_bill_id; }, function(r){ return r.due_date || r.issue_date; });
    else scan(window._allPersTxs, function(r){ return r.recurringProfileId; }, function(r){ return r.date; });
    return best ? { date: best, count: count } : null;
  }

  // ── predicates ──
  function passKind(it){
    if (!showPaused && it.status === 'paused') return false;
    if (filter === 'all') return true;
    if (filter === 'recurring') return it.src === 'recurring';
    if (filter === 'oneoff') return it.src === 'oneoff';
    return it.kind === filter;
  }
  function matches(it){ return passKind(it) && (!dayFilter || it.date === dayFilter); }
  function signed(it){ return it.kind === 'invoice' ? it.amount : -it.amount; }  // entity-native currency (no FX assumptions)
  function relLabel(d){
    var today = entityToday();
    var days = Math.round((new Date(d) - new Date(today)) / 86400000);
    if (days < 0) return 'overdue'; if (days === 0) return 'today'; if (days === 1) return 'tomorrow';
    if (days < 7) return 'in ' + days + ' days'; if (days < 14) return 'next week'; return null;
  }
  function runsLeft(it){
    if (it.freq === 'One-off' || !it.end) return null;
    var d = new Date(it.date), end = new Date(it.end), n = 0;
    while (d <= end && n < 99) { n++; if (it.freq === 'Weekly') d.setDate(d.getDate()+7); else d.setMonth(d.getMonth()+1); }
    return n;
  }
  function nextDate(d, freq){
    var p = String(d).split('-'), dt = new Date(+p[0], +p[1]-1, +p[2]);
    if (freq === 'Weekly') dt.setDate(dt.getDate()+7); else if (freq === 'One-off') return d; else dt.setMonth(dt.getMonth()+1);
    return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
  function $(id){ return document.getElementById(id); }

  // ── entity bar ──
  function renderEntity(){
    var sel = $('f94-entSel'); if (!sel) return;
    var list = ents(), e = activeEntity();
    sel.innerHTML = list.map(function(x, i){ return '<option value="'+i+'"'+(x.active?' selected':'')+'>'+esc(x.name || ('Entity '+(i+1)))+'</option>'; }).join('');
    var meta = $('f94-entMeta');
    if (meta && e) {
      meta.innerHTML =
        '<span class="chiplet"><span class="dot"></span> '+esc(e.currency||'USD')+' '+sym(e.currency||'USD')+'</span>'
      + '<span class="chiplet">🕓 <code>'+esc(e.timezone||'UTC (no zone set)')+'</code></span>'
      + '<span class="chiplet">Holidays · '+esc(e.country||'—')+'</span>';
    }
    var note = $('f94-entNote');
    if (note && e) {
      var summary = e.timezone
        ? 'This entity schedules in <b>'+esc(e.timezone)+'</b> and totals in <b>'+esc(e.currency||'USD')+'</b>'+(e.country?', with <b>'+esc(e.country)+'</b> public holidays':' (no country set — holiday shift inactive)')+'.'
        : 'No timezone/country set — dates resolve in UTC and the holiday shift is inactive.';
      // F191: inline region editor so an EXISTING entity can be localised (there is no other entity-edit UI).
      note.innerHTML = summary
        + ' <button class="f94-linkbtn" data-f94act="region-toggle">'+(e.timezone||e.country?'Edit region':'Set timezone &amp; country')+'</button>'
        + '<div id="f94-region" style="display:none;margin-top:9px;padding-top:9px;border-top:1px dashed var(--bd);display:none">'
        + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">'
        + '<label style="font-size:10.5px;color:var(--t2)">Timezone<br><select id="f94-tz" style="font-family:var(--font);font-size:12px;padding:5px 7px;background:var(--bg2);color:var(--t1);border:1px solid var(--bd);border-radius:6px;min-width:180px"></select></label>'
        + '<label style="font-size:10.5px;color:var(--t2)">Country (holidays)<br><select id="f94-country" style="font-family:var(--font);font-size:12px;padding:5px 7px;background:var(--bg2);color:var(--t1);border:1px solid var(--bd);border-radius:6px;min-width:180px"></select></label>'
        + '<button class="f94-newbtn" style="margin:0" data-f94act="region-save">Save</button>'
        + '<button class="f94-linkbtn" data-f94act="region-cancel">Cancel</button>'
        + '</div></div>';
      _fillRegionSelect($('f94-tz'), 'tz', e.timezone || '');
      _fillRegionSelect($('f94-country'), 'country', e.country || '');
    }
  }

  // ── needs-attention (real signals only) ──
  function renderAttn(items){
    var host = $('f94-attn'); if (!host) return;
    var e = activeEntity(), rows = [];
    items.forEach(function(it){
      if (it.src === 'recurring' && it.end) {
        var left = runsLeft(it);
        if (left != null && left <= 1) rows.push({ who: it.who, ref: (it.kind).toUpperCase()+' · '+it.date, why: 'Last scheduled run before its end date ('+it.end+') — the series stops after this.' });
      }
    });
    if (!rows.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
    host.style.display = '';
    host.innerHTML = '<div class="attn-head"><span class="ico">!</span><span class="lbl">Needs attention</span><span class="cnt">'+rows.length+'</span></div>'
      + rows.map(function(r){ return '<div class="attn-row"><div><div class="who">'+esc(r.who)+'</div><div class="why">'+esc(r.why)+'</div></div><div class="ref">'+esc(r.ref)+'</div></div>'; }).join('');
  }

  // ── KPIs (30-day window, entity-native currency) ──
  function renderKpis(items){
    var host = $('f94-kpis'); if (!host) return;
    var e = activeEntity(), s = sym(e ? e.currency : 'USD');
    var today = entityToday(), horizon = new Date(today); horizon.setDate(horizon.getDate()+30);
    var hz = horizon.toISOString().slice(0,10);
    var inn = 0, out = 0, cnt = 0;
    items.forEach(function(it){ if (it.status==='paused') return; if (it.date >= today && it.date <= hz) { cnt++; if (it.kind==='invoice') inn += it.amount; else out += it.amount; } });
    var net = inn - out;
    host.innerHTML =
      kpi('Scheduled (next 30d)', cnt, '', 'documents set to post')
    + kpi('Expected in', s+fmt(inn), 'mono', 'invoices posting')
    + kpi('Expected out', s+fmt(out), 'mono red', 'bills + draws posting')
    + kpi('Net effect', (net<0?'−':'')+s+fmt(Math.abs(net)), 'mono'+(net<0?' red':''), 'on cash over 30 days');
  }
  function kpi(label, val, cls, sub){
    return '<div class="mc"><div class="mc-label">'+label+'</div><div class="mc-val '+(cls||'')+'">'+val+'</div><div class="mc-sub">'+sub+'</div></div>';
  }

  // Calendar-safe day add (Rule 10): epoch-ms arithmetic on the UTC instant, read back as a UTC ymd.
  function addDaysYmd(ymd, n){ var p = String(ymd).split('-'); var d = new Date(Date.UTC(+p[0], +p[1]-1, +p[2]) + n*86400000); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
  function dlabel(ymd){ var p = String(ymd).split('-'); return (+p[2])+' '+MONS[+p[1]-1]; }

  // ── cash-flow forecast: cumulative NET impact of the scheduled runs over the horizon (entity-native
  //    currency). Starts at 0 (the impact of what's scheduled), not an absolute balance — we don't
  //    fabricate a starting cash position. Invoices add, bills/personal subtract; paused excluded. ──
  var FC_HORIZON = 60;
  function renderForecast(items){
    var svg = $('f94-fcChart'); if (!svg) return;
    var e = activeEntity(), s = sym(e ? e.currency : 'USD');
    var today = entityToday(), last = addDaysYmd(today, FC_HORIZON);
    var net = {};
    items.forEach(function(it){ if (it.status === 'paused') return; if (it.date >= today && it.date <= last) net[it.date] = (net[it.date] || 0) + signed(it); });
    var pts = [{ x: today, y: 0 }], cum = 0;
    for (var i = 1; i <= FC_HORIZON; i++){ var ds = addDaysYmd(today, i); cum += (net[ds] || 0); pts.push({ x: ds, y: cum }); }
    var W = 720, H = 170, padL = 8, padR = 8, padT = 14, padB = 16;
    var ys = pts.map(function(p){ return p.y; });
    var yMax = Math.max.apply(null, ys.concat([0])), yMin = Math.min.apply(null, ys.concat([0]));
    if (yMax === yMin){ yMax += 1; yMin -= 1; }
    var X = function(i){ return padL + (i/(pts.length-1))*(W-padL-padR); };
    var Y = function(v){ return padT + (1-(v-yMin)/(yMax-yMin))*(H-padT-padB); };
    var line = pts.map(function(p,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+Y(p.y).toFixed(1); }).join(' ');
    var zeroY = Y(0).toFixed(1);
    svg.innerHTML =
        '<line x1="'+padL+'" y1="'+zeroY+'" x2="'+(W-padR)+'" y2="'+zeroY+'" stroke="var(--red)" stroke-width="1" stroke-dasharray="2 3" opacity=".55"/>'
      + '<path d="'+line+'" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    var xs = $('f94-fcX');
    if (xs) xs.innerHTML = '<span>'+dlabel(today)+'</span><span>'+dlabel(pts[Math.floor(pts.length/2)].x)+'</span><span>'+dlabel(last)+'</span>';
    var sub = $('f94-fcSub'); if (sub) sub.textContent = 'Net cash impact of scheduled runs · next '+FC_HORIZON+' days';
    var flag = $('f94-fcFlag');
    if (flag){ var neg = cum < 0; flag.className = 'fc-flag '+(neg?'bad':'ok'); flag.textContent = (neg?'Net −':'Net +')+s+fmt(Math.abs(cum)); }
  }

  // ── calendar ──
  function renderCal(items){
    var host = $('f94-cal'); if (!host) return;
    var today = entityToday(), tp = today.split('-');
    if (viewY == null) { viewY = +tp[0]; viewM = +tp[1]-1; }
    $('f94-calMonth').textContent = MON[viewM] + ' ' + viewY;
    var byDay = {};
    items.forEach(function(it){ if (!passKind(it)) return; var p = it.date.split('-'); if (+p[0]===viewY && (+p[1]-1)===viewM) { (byDay[+p[2]] = byDay[+p[2]] || []).push(it); } });
    var first = new Date(viewY, viewM, 1).getDay(), dim = new Date(viewY, viewM+1, 0).getDate();
    var html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function(d){ return '<div class="cdow">'+d+'</div>'; }).join('');
    for (var i=0;i<first;i++) html += '<div class="cell pad"></div>';
    for (var d=1; d<=dim; d++){
      var ds = viewY+'-'+String(viewM+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var its = byDay[d] || [], isToday = ds===today, sel = dayFilter===ds;
      var chips = its.slice(0,3).map(function(it){ return '<span class="chip '+icClass[it.kind]+'"><span class="cd" style="background:currentColor"></span>'+esc(it.who)+'</span>'; }).join('');
      if (its.length>3) chips += '<span class="chip more">+'+(its.length-3)+'</span>';
      var dots = its.slice(0,4).map(function(it){ return '<span class="d '+icClass[it.kind]+'" style="background:currentColor"></span>'; }).join('');
      html += '<div class="cell'+(its.length?' has':'')+(isToday?' today':'')+(sel?' sel':'')+'" data-day="'+ds+'"><span class="num">'+d+'</span>'+chips+'<span class="dots">'+dots+'</span></div>';
    }
    host.innerHTML = html;
    host.querySelectorAll('.cell[data-day]').forEach(function(c){ c.onclick = function(){ var ds = c.getAttribute('data-day'); dayFilter = (dayFilter===ds) ? null : ds; render(); }; });  // F94 Phase 4: every day cell (not only days with items) toggles the day filter
  }

  // ── agenda ──
  function render(){
    if (!$('f94-agenda')) return;
    var items = buildItems();
    renderEntity(); renderAttn(items); renderKpis(items); renderForecast(items); renderCal(items); renderCounts(items);
    var shown = items.filter(matches);
    var host = $('f94-agenda');
    // day filter chip
    var df = $('f94-dayFilter');
    if (df) { if (dayFilter) { df.classList.add('on'); $('f94-dayFilterLabel').textContent = 'Only '+dayFilter; } else df.classList.remove('on'); }
    // F94 Phase 4: when a calendar day is selected, offer "+ New on this day" (opens the create
    // modal pre-filled with that date). Shown in both the empty and populated agenda states.
    var newDay = dayFilter ? '<button type="button" id="f94-newDayBtn" class="f94-newday" style="display:block;width:100%;margin:0 0 10px;padding:9px 12px;border:1px dashed var(--acc,#c9a84c);border-radius:8px;background:transparent;color:var(--acc,#c9a84c);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer">+ New on '+esc(dlabel(dayFilter))+'</button>' : '';
    var _wireNewDay = function(){ var nd = $('f94-newDayBtn'); if (nd) nd.onclick = function(){ openModal(dayFilter); }; };
    if (!shown.length) {
      host.innerHTML = newDay + '<div class="empty">'+(items.length ? 'Nothing matches this filter.' : 'No scheduled documents for this entity yet. Recurring invoices, bills and future-dated documents will appear here.')+'</div>';
      _wireNewDay();
      return;
    }
    // group by date
    var groups = [], byDate = {};
    shown.forEach(function(it){ if (!byDate[it.date]) { byDate[it.date] = []; groups.push(it.date); } byDate[it.date].push(it); });
    var e = activeEntity(), s = sym(e ? e.currency : 'USD');
    host.innerHTML = newDay + groups.map(function(date){
      var its = byDate[date], p = date.split('-'), dt = new Date(+p[0], +p[1]-1, +p[2]);
      var dow = ['SUN','MON','TUE','WED','THU','FRI','SAT'][dt.getDay()];
      var rel = relLabel(date), tot = its.reduce(function(a,it){ return a + signed(it); }, 0);
      var head = '<div class="dayhead"><span class="dow">'+dow+'</span><span class="date">'+(+p[2])+' '+MONS[+p[1]-1]+'</span>'
        + (rel ? '<span class="rel">'+rel+'</span>' : '')
        + '<span class="daytot">'+(tot<0?'−':'+')+s+fmt(Math.abs(tot))+'</span></div>';
      var rows = its.map(itemRow).join('');
      return '<div class="daygroup">'+head+rows+'</div>';
    }).join('');
    // wire kebabs
    host.querySelectorAll('[data-kebab]').forEach(function(btn){
      btn.onclick = function(ev){ ev.stopPropagation(); var m = btn.nextElementSibling; var open = m.classList.contains('open'); closeMenus(); if (!open) m.classList.add('open'); };
    });
    _wireNewDay();
  }

  function itemRow(it){
    var e = activeEntity(), s = sym(it.cur);
    var badge = it.status==='paused' ? '<span class="badge b-amber">Paused</span>'
      : it.src==='oneoff' ? '<span class="badge b-blue">Scheduled</span>'
      : '<span class="badge b-green">Active</span>';
    var left = runsLeft(it), leftTag = (left!=null && left<=2) ? '<span class="badge b-amber">'+left+' run'+(left===1?'':'s')+' left</span>' : '';
    var freq = '<span class="freq">'+esc(it.freq)+'</span>';
    var amtCls = it.kind==='invoice' ? 'out' : 'owe';
    var actions = it.src==='recurring'
      ? '<button class="mi" data-act="'+(it.status==='paused'?'resume':'pause')+'"><span class="mi-ic">'+(it.status==='paused'?'▶':'⏸')+'</span>'+(it.status==='paused'?'Resume':'Pause')+'</button>'
        + '<button class="mi" data-act="skip"><span class="mi-ic">⤼</span>Skip this run</button><hr>'
        + '<button class="mi danger" data-act="cancel"><span class="mi-ic">✕</span>Cancel schedule</button>'
      : '<button class="mi danger" data-act="cancel"><span class="mi-ic">✕</span>Delete document</button>';
    var menu = '<div class="menu" data-id="'+it.id+'" data-kind="'+it.kind+'" data-src="'+it.src+'" data-date="'+it.date+'" data-freq="'+esc(it.freq)+'">'+actions+'</div>';
    return '<div class="item'+(it.status==='paused'?' paused':'')+'">'
      + '<div class="ic '+icClass[it.kind]+'">'+ICONS[it.kind]+'</div>'
      + '<div><div class="who">'+esc(it.who)+' '+badge+' '+leftTag+'</div><div class="meta">'+freq+'<span class="sep">·</span><span>'+(it.kind==='invoice'?'money in':it.kind==='bill'?'money out':'owner draw')+'</span>'
      + (it.lastPosted ? '<span class="sep">·</span><span class="lineage" title="Most recent document this schedule has posted">Last posted '+esc(dlabel(it.lastPosted.date))+(it.lastPosted.count>1?' ('+it.lastPosted.count+' total)':'')+'</span>' : '')
      + '</div></div>'
      + '<div class="right"><div class="amt '+amtCls+'"><span class="cur">'+esc(it.cur)+'</span>'+fmt(it.amount)+'</div>'
      + '<button class="kebab" data-kebab aria-label="Actions">⋯</button>'+menu+'</div></div>';
  }

  function renderCounts(items){
    var map = { all:0, invoice:0, bill:0, personal:0, recurring:0, oneoff:0 };
    items.forEach(function(it){ if (!showPaused && it.status==='paused') return; map.all++; map[it.kind]++; map[it.src==='recurring'?'recurring':'oneoff']++; });
    document.querySelectorAll('#f94-tabs .tab').forEach(function(t){ var f = t.getAttribute('data-f'); var c = t.querySelector('.cnt'); if (c) c.textContent = map[f] != null ? map[f] : ''; });
  }

  function closeMenus(){ document.querySelectorAll('#page-scheduled-documents .menu.open').forEach(function(m){ m.classList.remove('open'); }); }

  // ── row actions → existing recurring routes (Rule: schedules post on their date, never on a click) ──
  function routeFor(kind, src){
    if (src === 'oneoff') return kind==='invoice' ? '/api/invoices' : '/api/bills';
    return kind==='invoice' ? '/api/recurring-invoices' : kind==='bill' ? '/api/recurring-bills' : '/api/recurring-personal-transactions';
  }
  async function act(menu, action){
    if (_busy) return; _busy = true;
    var id = menu.getAttribute('data-id'), kind = menu.getAttribute('data-kind'), src = menu.getAttribute('data-src');
    var base = routeFor(kind, src);
    try {
      if (action === 'pause' || action === 'resume') {
        await apiJSON('PUT', base + '/' + id, { status: action==='pause' ? 'paused' : 'active' });
        toast(action==='pause' ? 'Schedule paused' : 'Schedule resumed');
      } else if (action === 'skip') {
        var d = menu.getAttribute('data-date'), freq = menu.getAttribute('data-freq');
        await apiJSON('PUT', base + '/' + id, { next_run: nextDate(d, freq) });
        toast('Skipped — next run advanced');
      } else if (action === 'cancel') {
        await apiJSON('DELETE', base + '/' + id);
        toast(src==='oneoff' ? 'Document deleted' : 'Schedule cancelled');
      }
      await reload();
    } catch (e) { toast('Could not complete — ' + (e && e.message || 'error'), true); }
    finally { _busy = false; closeMenus(); render(); }
  }
  async function apiJSON(method, path, body){
    var res = await fetch(path, { method: method, credentials: 'same-origin', headers: { 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { var er = await res.json().catch(function(){ return {}; }); throw new Error(er.error || ('API ' + res.status)); }
    return res.json().catch(function(){ return {}; });
  }

  function toast(msg, warn){
    var w = $('f94-toasts'); if (!w) return;
    var t = document.createElement('div'); t.className = 'toast'+(warn?' warn':''); t.innerHTML = '<span class="tk"></span>'+esc(msg);
    w.appendChild(t); setTimeout(function(){ t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 300); }, 2600);
  }

  // ── data load: reuse the app's own recurring loaders, then read window.* ──
  async function reload(){
    var jobs = [];
    if (typeof window._loadRecurringInvFromDB === 'function') jobs.push(Promise.resolve(window._loadRecurringInvFromDB()).catch(function(){}));
    if (typeof window._loadRecurringBillsFromDB === 'function') jobs.push(Promise.resolve(window._loadRecurringBillsFromDB()).catch(function(){}));
    if (typeof window._loadRecurringPersonalFromDB === 'function') jobs.push(Promise.resolve(window._loadRecurringPersonalFromDB()).catch(function(){}));
    if (typeof window.loadEntitiesFromDB === 'function') jobs.push(Promise.resolve(window.loadEntitiesFromDB()).catch(function(){}));
    // Also refresh the materialised collections the one-off + lineage views read (window._realInvoices,
    // window.bills, window._allPersTxs) — the recurring loaders above don't touch these.
    if (typeof window.refreshFinancials === 'function') jobs.push(Promise.resolve(window.refreshFinancials('invoices')).catch(function(){}));
    if (typeof window._loadBillsFromDB === 'function') jobs.push(Promise.resolve(window._loadBillsFromDB()).catch(function(){}));
    if (typeof window.loadPersonalFinance === 'function') jobs.push(Promise.resolve(window.loadPersonalFinance()).catch(function(){}));
    try { await Promise.all(jobs); } catch(_){}
  }

  // ── wire static controls once ──
  function wire(){
    if (_booted) return; if (!$('f94-agenda')) return; _booted = true;
    var sel = $('f94-entSel'); if (sel) sel.onchange = async function(){
      // Switch through the APP's real switcher — switchEntity(INDEX) flips the active flag, POSTs
      // /api/entities/:id/activate to re-scope the server session, and reloads the per-entity money
      // collections (index.html:6403). It does NOT reload the recurring collections, so we re-fetch
      // those ourselves (reload) after it resolves — then render, never before (stale-data guard).
      var i = +sel.value;
      viewY = null; viewM = null; dayFilter = null;
      if (typeof window.switchEntity === 'function') { try { await window.switchEntity(i); } catch(_){} }
      else { ents().forEach(function(x, ix){ x.active = (ix===i); }); }
      await reload();
      render();
    };
    document.querySelectorAll('#f94-tabs .tab').forEach(function(t){ t.onclick = function(){ document.querySelectorAll('#f94-tabs .tab').forEach(function(x){ x.classList.remove('active'); }); t.classList.add('active'); filter = t.getAttribute('data-f'); render(); }; });
    var cp = $('f94-calPrev'), cn = $('f94-calNext');
    if (cp) cp.onclick = function(){ viewM--; if (viewM<0){ viewM=11; viewY--; } render(); };
    if (cn) cn.onclick = function(){ viewM++; if (viewM>11){ viewM=0; viewY++; } render(); };
    var dc = $('f94-dayFilterClear'); if (dc) dc.onclick = function(){ dayFilter = null; render(); };
    var pt = $('f94-pausedToggle'); if (pt) pt.onclick = function(){ showPaused = !showPaused; pt.classList.toggle('on', showPaused); pt.setAttribute('aria-checked', showPaused); render(); };
    // action delegation
    $('page-scheduled-documents').addEventListener('click', function(ev){
      var t = ev.target.closest ? ev.target : null;
      var reg = t && t.closest ? t.closest('[data-f94act]') : null;
      if (reg) {
        var a = reg.getAttribute('data-f94act');
        if (a === 'region-toggle') { var box = $('f94-region'); if (box) box.style.display = (box.style.display === 'none' ? 'block' : 'none'); return; }
        if (a === 'region-cancel') { var b2 = $('f94-region'); if (b2) b2.style.display = 'none'; return; }
        if (a === 'region-save') { saveRegion(); return; }
      }
      var b = t && t.closest ? t.closest('.mi') : null;
      if (b && b.getAttribute('data-act')) { var menu = b.closest('.menu'); if (menu) act(menu, b.getAttribute('data-act')); }
      else if (!t || !t.closest('.menu, [data-kebab], [data-f94act], #f94-region')) closeMenus();
    });
    // create-schedule modal wiring
    var nb = $('f94-new'); if (nb) nb.onclick = openModal;
    document.querySelectorAll('#f94-segType button').forEach(function(b){ b.onclick = function(){ setModalType(b.getAttribute('data-t')); }; });
    var mc = $('f94-mCancel'); if (mc) mc.onclick = closeModal;
    var ms = $('f94-mSave'); if (ms) ms.onclick = saveSchedule;
    var ov = $('f94-overlay'); if (ov) ov.onclick = function(ev){ if (ev.target === ov) closeModal(); };
    // F191: fill the static Create-Business form's region selects from the same curated list
    try { if (typeof window._f94FillRegion === 'function') window._f94FillRegion(); } catch(_){}
  }

  // F191: persist an existing entity's timezone + country (server validates; F88 step 1 route).
  async function saveRegion(){
    if (_busy) return;
    var e = activeEntity(); if (!e || e._dbId == null) { toast('Select an entity first', true); return; }
    var tz = ($('f94-tz') || {}).value || '', country = ($('f94-country') || {}).value || '';
    _busy = true;
    try {
      await apiJSON('PUT', '/api/entities/' + e._dbId, { timezone: tz, country: country });
      e.timezone = tz || null; e.country = country || null;   // reflect immediately
      toast('Region saved — scheduling now localised');
      await reload();
    } catch (err) { toast('Could not save region — ' + (err && err.message || 'error'), true); }
    finally { _busy = false; render(); }
  }

  // ── create modal: add a schedule without leaving the tab ─────────────────────
  // POSTs to the SAME recurring routes the row actions use. entity_id is applied SERVER-side from the
  // active session (req.entityId) — the same session the entity switcher re-scopes — so a schedule
  // created here belongs to the entity currently shown. Fields verified against server.js:2595/2637/2676.
  var modalType = 'invoice';
  function setModalType(t){
    modalType = (t === 'bill' || t === 'personal') ? t : 'invoice';
    var seg = document.querySelectorAll('#f94-segType button');
    for (var i = 0; i < seg.length; i++) seg[i].classList.toggle('on', seg[i].getAttribute('data-t') === modalType);
    var m = modalType === 'invoice' ? ['Customer', 'e.g. Acme Corp', 'New recurring invoice']
          : modalType === 'bill'    ? ['Vendor', 'e.g. Con Edison', 'New recurring bill']
          :                           ['Description', 'e.g. Owner draw', 'New recurring personal run'];
    var lbl = $('f94-partyLabel'); if (lbl) lbl.textContent = m[0];
    var who = $('f94-mWho'); if (who) who.placeholder = m[1];
    var ttl = $('f94-modalTitle'); if (ttl) ttl.textContent = m[2];
  }
  function _mnote(msg, isErr){ var n = $('f94-mNote'); if (!n) return; n.textContent = msg || ''; n.style.color = isErr ? 'var(--red)' : ''; }
  function openModal(prefillDate){
    var ov = $('f94-overlay'); if (!ov) return;
    var e = activeEntity();
    setModalType('invoice');
    var who = $('f94-mWho'), amt = $('f94-mAmount'), freq = $('f94-mFreq'), date = $('f94-mDate'), end = $('f94-mEnd');
    if (who) who.value = ''; if (amt) amt.value = ''; if (freq) freq.value = 'Monthly';
    if (date) date.value = prefillDate || entityToday();   // F94 Phase 4: pre-fill from a clicked calendar day; else entity 'today' (Rule 10 safe)
    if (end) end.value = '';
    _mnote('', false);
    var sub = $('f94-modalSub');
    if (sub) sub.textContent = e ? ('For ' + (e.name || 'this entity') + ' · posts in ' + (e.timezone || 'UTC') + ', totals in ' + (e.currency || 'USD') + '.') : '';
    ov.classList.add('open');
    try { if (who) who.focus(); } catch(_){}
  }
  function closeModal(){ var ov = $('f94-overlay'); if (ov) ov.classList.remove('open'); }
  async function saveSchedule(){
    if (_busy) return;
    var who = String(($('f94-mWho') || {}).value || '').trim();
    var amt = parseFloat(($('f94-mAmount') || {}).value);
    var freq = ($('f94-mFreq') || {}).value || 'Monthly';
    var date = ($('f94-mDate') || {}).value || '';
    var end = ($('f94-mEnd') || {}).value || '';
    if (!who) return _mnote(modalType === 'invoice' ? 'Enter a customer name.' : modalType === 'bill' ? 'Enter a vendor name.' : 'Enter a description.', true);
    if (!(amt > 0)) return _mnote('Enter an amount greater than 0.', true);
    if (!date) return _mnote('Pick a next date.', true);
    if (end && end < date) return _mnote('End date can’t be before the next date.', true);
    var e = activeEntity(), path, body;
    if (modalType === 'invoice') { path = '/api/recurring-invoices'; body = { client: who, amount: amt, frequency: freq, next_run: date, status: 'active', end_date: end || null }; }
    else if (modalType === 'bill') { path = '/api/recurring-bills'; body = { vendor: who, amount: amt, frequency: freq, next_run: date, status: 'active', end_date: end || null }; }
    else { path = '/api/recurring-personal-transactions'; body = { description: who, amount: amt, tx_type: 'expense', frequency: freq, next_run: date, status: 'active', end_date: end || null, currency: (e && e.currency) || 'USD' }; }
    _busy = true; _mnote('Saving…', false);
    try {
      await apiJSON('POST', path, body);
      closeModal();
      toast('Schedule created');
      await reload();
    } catch (err) { _mnote('Could not save — ' + (err && err.message || 'error'), true); }
    finally { _busy = false; render(); }
  }

  // ── open hook: when the tab is shown, load + render ──
  async function open(){ wire(); render(); await reload(); render(); }

  // wrap showPage (this file loads AFTER the bundle, so this wrapper wins — Rule 1)
  function install(){
    var prev = window.showPage;
    window.showPage = function(id, el){
      var r = (typeof prev === 'function') ? prev.apply(this, arguments) : undefined;
      if (id === 'scheduled-documents') { try { open(); } catch(e){ console.warn('[F94]', e && e.message); } }
      return r;
    };
    window.renderScheduledDocuments = render;
    window._f94Open = open;
    window._f94OpenModal = openModal;
    window._f94SaveSchedule = saveSchedule;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
