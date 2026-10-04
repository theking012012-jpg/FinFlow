
// ── MOBILE BOTTOM NAV HELPER ────────────────────────────────────────────────
window.mobNavActive=function(id){
  document.querySelectorAll('.mob-nav-item').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById(id);
  if(el)el.classList.add('active');
};

// ── SWIPE GESTURE NAVIGATION ────────────────────────────────────────────────
(function(){
  // Mobile fix: swipe only across the three core pages, and read the LIVE active page each time
  // (the old handler tracked a local currentPageIdx that drifted out of sync the moment the user
  // navigated via the bottom nav / sidebar, jumping to the wrong page on the next swipe).
  const PAGES=['dashboard','invoices','expenses','banking'];
  // Every swipe page has a matching bottom-bar button — keep the two in lock-step so the
  // highlight never goes blank (showPage alone doesn't touch the bar; the buttons pair it
  // with mobNavActive, so the swipe must too).
  const NAV={dashboard:'mbn-dashboard',invoices:'mbn-invoices',expenses:'mbn-expenses',banking:'mbn-banking'};
  const _go=p=>{ showPage(p,null); if(NAV[p]) mobNavActive(NAV[p]); };
  let touchStartX=0,touchStartY=0;
  const _activePage=()=>{ const el=document.querySelector('.page.active'); return el?(el.id||'').replace('page-',''):'dashboard'; };
  document.addEventListener('touchstart',e=>{touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;},{passive:true});
  document.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-touchStartX;
    const dy=Math.abs(e.changedTouches[0].clientY-touchStartY);
    if(Math.abs(dx)<60||dy>50)return;
    const idx=PAGES.indexOf(_activePage());
    if(idx<0)return;                                  // not on a swipeable page — ignore
    if(dx<0&&idx<PAGES.length-1) _go(PAGES[idx+1]);
    else if(dx>0&&idx>0) _go(PAGES[idx-1]);
  },{passive:true});
})();

// ── MULTI-ENTITY DATA & RENDERER ────────────────────────────────────────────
// Raw entity data in native currencies (USD, GBP, TTD)
window.ENTITIES=window.ENTITIES||[];
const ENTITIES=window.ENTITIES=[];

// ── Load real entities from API on boot ──────────────────────────
async function _loadEntitiesFromDBImpl(){
  // F98: clear the dashboard error latch at the START of every attempt. It is re-set to true
  // ONLY in the catch below (genuine failure). The two success returns — "no active entity"
  // (empty account) and normal completion — leave it false, so a brand-new user with zero
  // entities is NEVER shown "Unable to load". Genuine-failure vs successful-empty is therefore
  // distinguished by exactly one thing: the flag is set true only where an exception was thrown.
  window._dashLoadError = false;
  try {
    const res = await fetch('/api/entities', {credentials:'include'});
    // F96 (F67 class): a non-ok response must NOT silently leave ENTITIES empty and paint a
    // "Create a business" dashboard indistinguishable from a real new account. 401/403 = genuinely
    // logged out (the auth gate owns that); anything else is a real failure — throw so the outer
    // catch surfaces the dashboard error state. Returning true here latches the memo (F97): a
    // logged-out answer is definitive, not a transient failure to retry.
    if(!res.ok){
      if(res.status === 401 || res.status === 403) return true;
      // F130: TRIAL EXPIRED — the server 402s every /api data read (checkPlan, server.js:400), and
      // this is the FIRST one on a cold boot, so this is where the user's experience is decided.
      // Render the paywall and return TRUE: the answer is definitive, exactly as 401/403 is, so the
      // boot memo should latch it (F97) rather than re-fetching a 402 on every trigger. Returning
      // false here would both retry pointlessly and mark the load "incomplete", which is what fed
      // the "Unable to load" cards. An expired trial is a known, explainable state — not a failure.
      if(res.status === 402){
        const _b = await res.json().catch(()=>({}));
        if(_b && _b.code === 'TRIAL_EXPIRED'){
          console.warn('[Entities] trial expired — showing upgrade gate');
          if(typeof window._ffShowTrialExpired === 'function') window._ffShowTrialExpired(_b.error);
          return true;
        }
      }
      const _e = new Error('entities failed (HTTP '+res.status+')'); _e.status = res.status; throw _e;
    }
    const rows = await res.json();
    // Sort by id — consistent order always
    rows.sort((a,b) => a.id - b.id);

    ENTITIES.length = 0;
    rows.forEach(e => ENTITIES.push({
      _dbId:    e.id,
      name:     e.name,
      tag:      e.tag || 'Entity',
      color:    e.color || '#c9a84c',
      currency: e.currency || 'USD',
      active:   e.is_active == 1 || e.is_active === true,
      // F88/F191 + F94 B3: these live in the entity's `data` JSONB (spread onto the row by rowToObj) and
      // must travel onto the in-memory entity, or the client never sees them after a reload — the F88
      // timezone/country chips read blank and the Scheduled-Documents runway (opening_cash) reverts to
      // its honest line even right after a save (saveRegion → reload() rebuilds ENTITIES right here).
      timezone:     e.timezone || null,
      country:      e.country || null,
      opening_cash: (e.opening_cash != null && e.opening_cash !== '' ? Number(e.opening_cash) : null),
      data:     {rev:0,cogs:0,grossProfit:0,opex:0,netProfit:0},
      // F196 Tier 2: the entity's OWN letterhead profile. A document is issued BY this entity, so
      // its business name/address/contact/tax-id must travel with it rather than being read from the
      // account-wide settings blob (which is ONE row per account and mislabels every entity but one).
      // Absent fields stay undefined so the letterhead falls back to the account blob (no migration).
      profile: {
        business_name: e.business_name || null,
        address:       e.address       || null,
        email:         e.email         || null,
        phone:         e.phone         || null,
        tax_id:        e.tax_id        || null,
        website:       e.website       || null,
        logo:          e.logo          || null,
      },
    }));

    // If none active, activate first one
    if(ENTITIES.length && !ENTITIES.some(e=>e.active)) ENTITIES[0].active = true;

    // F197-followup: an account that already HAS entities is, by definition, past onboarding — even if
    // its legacy user_settings row never persisted onboarding_done (the OLD ffOnAuth suppressed the
    // wizard via browser storage ONLY, never server-side, so the flag was never truly saved). Dismiss
    // the wizard on this definitive signal so a set-up account never sees it in a browser that lacks
    // the stale local flag. Only a genuinely empty + not-onboarded account still reaches the wizard.
    if (ENTITIES.length > 0) {
      try{ localStorage.setItem('ff_onboarded','1'); }catch(e){}
      try{ sessionStorage.setItem('ff_onboarded','1'); }catch(e){}
      var _obw = document.getElementById('ob-overlay'); if (_obw) _obw.remove();
    }

    // Sync businesses sidebar with real entities
    if(typeof businesses !== 'undefined'){
      businesses.length = 0;
      ENTITIES.forEach(e => businesses.push({
        id: 'biz-'+e._dbId,
        _dbId: e._dbId,
        name: e.name,
        industry: e.tag || 'Business',
        currency: e.currency || 'USD',
        color: e.color || '#c9a84c',
        active: e.active,
      }));
    }

    renderEntities();
    if(typeof renderBusinessSwitcher === 'function') renderBusinessSwitcher();

    // F196 Tier 2: paint the Business-profile panel from the ACTIVE ENTITY now that ENTITIES exists.
    // loadSettingsFromDB (finflow-api-wiring.js) races this loader and can finish FIRST, and when it
    // does there is no entity to read yet — so it fills the panel from the account-wide blob and the
    // per-entity profile never lands. Both paths call the same repaint, so whichever finishes last
    // produces the correct final state regardless of the order they resolve in.
    try { if (typeof window._ffApplyEntityProfile === 'function') window._ffApplyEntityProfile(); }
    catch(e5){ console.warn('[Entities] business-profile paint failed:', e5 && e5.message); }

    // Update sidebar brand
    const active = ENTITIES.find(e=>e.active);
    const nameEl = document.getElementById('sb-brand-name');
    const badgeEl = document.getElementById('biz-currency-badge');
    if(active){
      if(nameEl) nameEl.textContent = active.name;
      if(badgeEl) badgeEl.textContent = active.currency + ' · ' + (typeof _planLabel==='function'?_planLabel():'Pro');
    } else {
      if(nameEl) nameEl.textContent = 'Create a business';
      if(badgeEl) badgeEl.textContent = '';
      // Highlight the + Add business button
      const addBizBtn = document.querySelector('#biz-menu button');
      if(addBizBtn){ addBizBtn.classList.remove('btn-ghost'); addBizBtn.classList.add('btn-primary'); }
      if(typeof window._hideBootSplash==='function') window._hideBootSplash();  // F151: empty account is a COMPLETE load → reveal
      return true;   // F97: a genuinely-empty account (0 entities) is a COMPLETE load — latch it
    }

    // Activate in session FIRST, then load data
    const activeIdx = ENTITIES.findIndex(e=>e.active);
    if(activeIdx >= 0){
      const act = ENTITIES[activeIdx];
      if(act._dbId){
        const r = await fetch('/api/entities/'+act._dbId+'/activate',{method:'POST',credentials:'include'});
        if(!r.ok) console.warn('[Entities] Activate failed');
      }
      await loadEntityData(activeIdx);
    }

    // Bulk-load owner payroll for ALL entities so multi-entity Personal sync works.
    // We do this after entity activation so each fetch is scoped by entity_id.
    try {
      window.ownerPayrollByEntity = window.ownerPayrollByEntity || {};
      // PERF: fetch the non-active entities' owner payroll in PARALLEL, not one-at-a-time.
      // Independent per entity (reads ENTITIES[i], writes ownerPayrollByEntity[i]), so no race.
      // Verified vs live data: parallel output byte-identical to the old serial loop.
      await Promise.all(ENTITIES.map(async (e, i) => {
        if (i === activeIdx) return;
        if (!e?._dbId) return;
        try {
          const pr = await fetch('/api/payroll?entity_id=' + e._dbId, {credentials:'include'});
          if (!pr.ok) return;
          const rows = await pr.json();
          const ownerRow = (rows||[]).find(r=>r.is_owner);
          if (ownerRow) {
            window.ownerPayrollByEntity[i] = {
              _dbId:    ownerRow.id,
              fname:    ownerRow.fname,
              lname:    ownerRow.lname || '',
              role:     ownerRow.role || 'CEO / Founder',
              type:     ownerRow.emp_type || 'owner',
              gross:    parseFloat(ownerRow.gross) || 0,
              deductions: ownerRow.deductions || [],
              net:      netFromDeductions(ownerRow.gross, ownerRow.deductions),
              initials: ((ownerRow.fname||'')[0]+((ownerRow.lname||'')[0]||'')).toUpperCase(),
              avClass:  ownerRow.av_class || 'av-blue',
              currency: e.currency || 'USD',
              entityName: e.name || 'Entity',
              isOwner:  true,
            };
          }
        } catch (err) { console.warn('[Entities] payroll load failed for entity idx', i, '-', err.message); }
      }));
      ownerPayrollByEntity = window.ownerPayrollByEntity;
      // Sync Personal Finance one more time now that all entities are loaded
      if (typeof syncAllPayrollsToPersonal === 'function') {
        try { syncAllPayrollsToPersonal(); } catch(e) {}
      }
    } catch (e) { console.warn('[Entities] Bulk payroll load failed:', e.message); }
    return true;   // F97: a complete, successful load — latch the memo
  } catch(e){
    // F96/F67: an authenticated boot-load failure must be VISIBLE, not a silent empty dashboard.
    // The old `console.warn`-only path left a full set of $0/empty surfaces the user could not
    // tell apart from real data. Paint the shared dashboard error state (gated on _ffAuthed, same
    // as loadEntityData at app-main.js:1498).
    console.error('[Entities] Boot load failed:', e.message);
    // F98: latch the error BEFORE painting, so any updateDashboard that runs afterwards sees it
    // and refuses to repaint a fabricated $0 over the error state (the multi-writer overwrite the
    // plain _dashSetState('error') call could not survive on its own).
    window._dashLoadError = true;
    if(window._ffAuthed && typeof window._dashSetState === 'function'){
      try{ window._dashSetState('error'); }catch(_){}
    }
    // F98 (req 2): the SIDEBAR must not read "Create a business" on a load FAILURE — that tells the
    // user their business is gone. That text is the genuinely-empty-account state (set on the
    // success path above); a failure is different and must say so.
    const _nb = document.getElementById('sb-brand-name');
    if(_nb) _nb.textContent = 'Unable to load';
    return false;   // F97: signal an incomplete load so the boot memo (below) does not latch it
  }
}

// F50 Step 2 — dedupe the boot loader storm. FOUR paths trigger an entities load within ~1s of
// page load: A finflow-api boot (via ffLoadData, separate), B initEnhancements /api/me, C the
// dashboard _run (+600ms), D the postgres wiring. Each used to re-run the full entities +
// per-entity load → the 6–8× loader storm. Memoize the FIRST load in window._ffBootPromise; boot
// callers await the same settled promise instead of re-loading.
//   force=true BYPASSES the memo for genuine user-initiated reloads (login / register /
//   create-business) that must pick up a changed entity set. It also refreshes the cached promise
//   so any late boot straggler awaits the fresh load.
//   A real entity SWITCH is unaffected: switchEntity() calls loadEntityData(idx) DIRECTLY, not this,
//   so switching still reloads. The in-function _loadEntityDataRunning concurrency guard is kept
//   untouched (belt-and-suspenders against overlap). _loadEntitiesFromDBImpl never throws (its outer
//   catch swallows), so the memoized promise always resolves — no rejection-poisoning.
function loadEntitiesFromDB(force){
  if(!force && window._ffBootPromise) return window._ffBootPromise;
  var p = _loadEntitiesFromDBImpl();
  window._ffBootPromise = p;
  // F50 REOPEN (cold-boot race): the dashboard's monthly-array builder window._buildMonthlyArrays
  // lives in the DEFERRED bundle. On cold boot this load is kicked off by initEnhancements' tiny
  // /api/me, which frequently resolves BEFORE the 304KB deferred bundle has executed — so
  // loadEntityData finds the builder undefined, never fills REV[]/EXP[]/PROFIT[], and paints $0.
  // Pre-fix the memo latched that empty load forever. Un-latch a load that ran WITHOUT the builder
  // so a later trigger re-runs a COMPLETE one; a load that HAD the builder stays latched, so the
  // F50 boot-dedupe is fully intact for the normal (bundle-ready) case. _loadEntitiesFromDBImpl
  // never rejects (its outer catch swallows), so this .then always runs.
  p.then(function(ok){
    // F97: un-latch on ANY incomplete load, not just a missing builder. Incomplete =
    //   (a) the load FAILED — _loadEntitiesFromDBImpl resolved false (fetch non-ok), so ENTITIES
    //       was never populated. Previously this stayed latched forever when the bundle was
    //       present, and only a hard refresh recovered; OR
    //   (b) the deferred builder wasn't ready, so REV[]/EXP[] never filled (the original F50
    //       cold-boot case).
    // A genuinely-empty account is a COMPLETE load (ok===true) and latches normally.
    var incomplete = (ok === false) || (typeof window._buildMonthlyArrays !== 'function');
    if(incomplete && window._ffBootPromise === p){
      window._ffBootPromise = null;   // incomplete → don't hand this dead load to the next caller
    }
  });
  return p;
}
window.loadEntitiesFromDB = loadEntitiesFromDB;

// F50 REOPEN part 2 — deterministic COMPLETE re-fire. Deferred scripts finish executing BEFORE
// DOMContentLoaded, so by then window._buildMonthlyArrays is guaranteed present. Ensure exactly one
// complete boot load has happened: if an earlier /api/me-triggered load un-latched itself (part 1
// above) the memo is null and this re-runs it — now with the builder available, so it paints real
// data. If a complete load already latched, the memo dedupes and this is a no-op (no redundant
// reload). Gated on _ffAuthed: initEnhancements sets it true synchronously BEFORE it ever calls
// loadEntitiesFromDB, so whenever an incomplete boot load exists, _ffAuthed is already true.
function _ffEnsureCompleteBoot(){
  if(typeof window._buildMonthlyArrays !== 'function') return;   // bundle not ready yet — a later net covers it
  if(window._ffAuthed && !window._ffBootPromise && typeof window.loadEntitiesFromDB === 'function'){
    window.loadEntitiesFromDB();   // through the memo → complete load latches
  }
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _ffEnsureCompleteBoot);
else _ffEnsureCompleteBoot();
window.addEventListener('load', _ffEnsureCompleteBoot);   // final net for slow bundles / late /api/me
window.addEventListener('ff:authed', function(){ setTimeout(_ffEnsureCompleteBoot, 0); });  // net if auth lands after the bundle

// window.CURRENCIES is already set from the full CURRENCIES const above.

let consolCurrency = 'USD'; // default consolidation currency
window.consolCurrency = consolCurrency; // exposed so the wiring fetches the consolidated report in this currency

function fxConvert(amount, fromCurrency, toCurrency){
  // Convert via USD as base
  const rates = window.CURRENCIES;
  if(!rates || !rates[fromCurrency] || !rates[toCurrency]) return amount;
  const inUSD = amount / rates[fromCurrency].rate;
  return inUSD * rates[toCurrency].rate;
}

function fmtConsol(value, fromCurrency){
  // `value` is ALREADY in the consolidation currency (per-entity server conversion) — format directly,
  // no client static-rate re-conversion.
  const sym = (window.CURRENCIES[consolCurrency]||{symbol:'$'}).symbol;
  return window._fmtMoney(value, sym);   // shared K→M→B rollover in the consol currency
}

function getConsolTotal(rowKey){
  // FX-CONSOLIDATION FIX: each entity's e.data is ALREADY in the consolidation currency (the per-entity
  // loop fetches /api/reports?entity_id=<id>&display=<consolCurrency> — server per-leg conversion), so
  // the consolidated total is a PLAIN SUM. No client static-rate re-conversion (that diverged from the
  // engine + double-converted when a display currency was active; verify-fx-client-consolidation). F31:
  // any entity that failed to load ⇒ honest "—", never a fabricated figure from incomplete data.
  if (ENTITIES.some(e => e.data && e.data.unavailable)) return null;
  return ENTITIES.reduce((sum, e) => sum + ((e.data && e.data[rowKey]) || 0), 0);
}

function fmtTotal(val){
  if (val === null) return '—';   // F31: incomplete consolidation → honest dash, never $0
  const sym = (window.CURRENCIES[consolCurrency]||{symbol:'$'}).symbol;
  return window._fmtMoney(val, sym);   // shared K→M→B rollover in the consol currency
}

const CONSOL_ROW_DEFS=[
  {label:'Revenue',     key:'rev',         color:'var(--green)'},
  {label:'Cost of goods',key:'cogs',       color:'var(--red)'},
  {label:'Gross profit',key:'grossProfit', color:'var(--acc)'},
  {label:'Operating exp.',key:'opex',      color:'var(--red)'},
  {label:'Net profit',  key:'netProfit',   color:'var(--green)'},
];

window.setConsolCurrency = function(code){
  consolCurrency = code;
  window.consolCurrency = code;
  // Update selector UI
  document.querySelectorAll('.consol-cur-btn').forEach(b=>{
    b.classList.toggle('active-preset', b.dataset.code===code);
  });
  // Update rate label
  const rateEl = document.getElementById('consol-fx-rate');
  if(rateEl){
    const cur = window.CURRENCIES[code];
    if(cur && code !== 'USD'){
      rateEl.textContent = `1 USD = ${cur.rate.toFixed(cur.rate<1?4:cur.rate>100?0:2)} ${code}`;
    } else {
      rateEl.textContent = 'Base currency · no conversion';
    }
  }
  // Refetch every entity in the new currency (server per-leg conversion), then re-render — renderEntities
  // re-runs the per-entity loop with display=<code>. Fall back to a plain render if the wiring isn't loaded.
  if (typeof window.renderEntities === 'function') window.renderEntities();
  else renderConsolPL();
};

function renderConsolPL(){
  const pl = document.getElementById('consol-pl');
  if(!pl) return;
  const cur = window.CURRENCIES[consolCurrency] || {symbol:'$'};
  const n = ENTITIES.length;
  const cols = n > 0 ? `1fr repeat(${n},80px) 90px` : '1fr 90px';

  // Update header with real entity names
  const hdr = document.getElementById('consol-pl-header');
  if(hdr){
    hdr.style.gridTemplateColumns = cols;
    hdr.innerHTML = '<span>Line</span>' +
      ENTITIES.map(e=>`<span style="text-align:right">${e.name}</span>`).join('') +
      '<span style="text-align:right">Consolidated</span>';
  }

  pl.innerHTML = CONSOL_ROW_DEFS.map(row=>{
    const entityVals = ENTITIES.map(e=>{
      // F31: an entity whose data failed to load shows "—", never a fabricated $0.
      const cell = (e.data && e.data.unavailable) ? '—' : fmtConsol(e.data[row.key], e.currency);
      return `<span style="text-align:right;color:var(--t2);font-family:var(--font-mono)">${cell}</span>`;
    }).join('');
    const total = getConsolTotal(row.key);
    return `
      <div style="display:grid;grid-template-columns:${cols};gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);align-items:center;font-size:12px">
        <span style="color:var(--t1);font-weight:500">${row.label}</span>
        ${entityVals}
        <span style="text-align:right;font-family:var(--font-mono);font-weight:600;color:${(total===0||total===null)?'var(--t2)':row.color}">${fmtTotal(total)}</span>
      </div>`;
  }).join('');
}

window.renderEntities=function(){
  // Update entity count KPI card
  const cntEl=document.getElementById('ent-count');
  if(cntEl) cntEl.textContent=ENTITIES.length;

  // Update consolidated KPI cards
  const totalRev=getConsolTotal('rev');
  const totalProfit=getConsolTotal('netProfit');
  const consolMarginPct=totalRev>0?Math.round(totalProfit/totalRev*100):null;
  const revEl=document.getElementById('ent-consol-rev');
  if(revEl) revEl.textContent=fmtTotal(totalRev);
  const profEl=document.getElementById('ent-consol-profit');
  if(profEl) profEl.textContent=fmtTotal(totalProfit);
  const marginEl=document.getElementById('ent-consol-margin');
  if(marginEl) marginEl.textContent=consolMarginPct!==null?consolMarginPct+'% margin':'—';

  const el=document.getElementById('entity-list');
  if(el)el.innerHTML=ENTITIES.map((e,i)=>{
    const _unavail = e.data && e.data.unavailable;   // F31: failed fetch → honest "—", not $0
    const revConverted = _unavail ? '—' : fmtConsol(e.data.rev, e.currency);
    const margin = (!_unavail && e.data.rev) ? Math.round(e.data.netProfit/e.data.rev*100*10)/10 : null;
    return `
    <div class="entity-card${e.active?' active-entity':''}" onclick="switchEntity(${i})">
      <div class="entity-logo" style="background:${e.color}">${e.name.slice(0,2).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div class="entity-name">${e.name}</div>
        <div class="entity-meta">${e.currency} · <span class="entity-tag">${e.tag}</span></div>
      </div>
      <div class="entity-stat">
        <div class="entity-stat-val">${revConverted}</div>
        <div class="entity-stat-lbl">${_unavail ? 'Failed to load' : (margin!==null?'Revenue · '+margin+'% margin':'—')}</div>
      </div>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="event.stopPropagation();openEntityProfile(${i})" title="Edit business profile / letterhead">Profile</button>
      ${e.active?`<span class="badge b-green" style="flex-shrink:0">Active</span>`:`<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();switchEntity(${i})">Switch</button>`}
    </div>`;
  }).join('');

  renderConsolPL();
};

// ── F196 Tier 2 — PER-ENTITY BUSINESS PROFILE editor ────────────────────────────────────────────
// The server (POST/PUT /api/entities, normalizeEntityProfile) and the docview letterhead already
// support a per-entity profile with an account-wide fallback; this is the missing WRITE UI. A blank
// text field is a deliberate clear (stored null → falls back to the account blob). The logo mirrors
// the server guard exactly (data: URI, image types, 256 KB) so the client never sends what the
// server would 400.
var _epLogo;              // undefined = untouched, null = cleared, string = new data URI
var _EP_LOGO_MAX = 256 * 1024;
var _EP_LOGO_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i;

window.openEntityProfile = function(i){
  var e = (typeof ENTITIES !== 'undefined') ? ENTITIES[i] : null;
  if(!e){ if(typeof notify==='function') notify('Entity not found', true); return; }
  var p = e.profile || {};
  _epLogo = undefined;
  var set = function(id,v){ var el=document.getElementById(id); if(el) el.value = v || ''; };
  set('ep-entity-id', e._dbId);
  set('ep-business-name', p.business_name);
  set('ep-email', p.email);
  set('ep-phone', p.phone);
  set('ep-tax-id', p.tax_id);
  set('ep-website', p.website);
  set('ep-address', p.address);
  var sub=document.getElementById('ep-sub'); if(sub) sub.textContent = 'Letterhead for ' + (e.name||'this entity') + ' \u2014 invoices, quotes & receipts';
  var fileEl=document.getElementById('ep-logo-file'); if(fileEl) fileEl.value='';
  _epRenderLogo(p.logo || null);
  if(typeof openModal==='function') openModal('entity-profile-modal');
};

function _epRenderLogo(dataUrl){
  var img=document.getElementById('ep-logo-preview'); var rm=document.getElementById('ep-logo-remove');
  if(dataUrl){ if(img){ img.src=dataUrl; img.style.display=''; } if(rm) rm.style.display=''; }
  else { if(img){ img.removeAttribute('src'); img.style.display='none'; } if(rm) rm.style.display='none'; }
}

window.epLogoClear = function(){
  _epLogo = null;                               // explicit clear → PUT sends logo:null
  var f=document.getElementById('ep-logo-file'); if(f) f.value='';
  _epRenderLogo(null);
};

window.epLogoPick = function(input){
  var file = input && input.files && input.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    var url = String(reader.result||'');
    if(!_EP_LOGO_RE.test(url)){ if(typeof notify==='function') notify('Logo must be a PNG, JPG, WebP, GIF or SVG image', true); input.value=''; return; }
    if(url.length > _EP_LOGO_MAX){ if(typeof notify==='function') notify('Logo is too large (max 256\u00a0KB)', true); input.value=''; return; }
    _epLogo = url;
    _epRenderLogo(url);
  };
  reader.onerror = function(){ if(typeof notify==='function') notify('Could not read that image', true); };
  reader.readAsDataURL(file);
};

window.saveEntityProfile = async function(btn){
  var id = (document.getElementById('ep-entity-id')||{}).value;
  if(!id){ if(typeof notify==='function') notify('No entity selected', true); return; }
  var v = function(x){ return ((document.getElementById(x)||{}).value||'').trim(); };
  // Text fields are always sent — a blank is a deliberate clear (server stores null → account fallback).
  var body = {
    business_name: v('ep-business-name'),
    email:         v('ep-email'),
    phone:         v('ep-phone'),
    tax_id:        v('ep-tax-id'),
    website:       v('ep-website'),
    address:       v('ep-address'),
  };
  if(_epLogo !== undefined) body.logo = _epLogo;   // only send logo when the user changed it
  if(btn){ btn.disabled=true; }
  try{
    var res = await fetch('/api/entities/'+encodeURIComponent(id), {method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
    if(!res.ok){ var er=await res.json().catch(()=>({})); if(typeof notify==='function') notify(er.error||'Could not save profile', true); if(btn) btn.disabled=false; return; }
    if(typeof loadEntitiesFromDB==='function') await loadEntitiesFromDB(true);
    if(typeof renderEntities==='function') renderEntities();
    if(typeof closeModal==='function') closeModal('entity-profile-modal');
    if(typeof notify==='function') notify('Business profile saved \u2726');
  }catch(err){
    if(typeof notify==='function') notify('Network error saving profile \u2014 please try again', true);
  } finally { if(btn) btn.disabled=false; }
};

window.switchEntity=async function(idx){
  ENTITIES.forEach((e,i)=>e.active=i===idx);
  const e=ENTITIES[idx];
  if(!e) return;
  // F151 stale-response guard: bump the switch generation so any data load still in flight for the
  // PREVIOUS entity is discarded when it resolves (the tab-refocus bug: a backgrounded Saige fetch
  // completing late and clobbering Acme's dashboard with Saige's numbers).
  window._entitySwitchSeq = (window._entitySwitchSeq || 0) + 1;
  // F151: cover the switch with the splash so the intermediate "old numbers in new currency" render
  // (e.g. Saige's 206K shown in Acme/TTD) is never seen; lifted on network-idle once new data settles.
  if(window._showBootSplash) window._showBootSplash();

  // Update sidebar brand immediately
  const nameEl=document.getElementById('sb-brand-name');
  const badgeEl=document.getElementById('biz-currency-badge');
  if(nameEl) nameEl.textContent=e.name;
  if(badgeEl) badgeEl.textContent=e.currency+' · '+(typeof _planLabel==='function'?_planLabel():'Pro');

  // Reset the DISPLAY currency to the new entity's — exactly what boot does (app-main.js:1320-1323).
  // The switch path relabelled the badge to e.currency but never reset activeCurrency, so S() (→
  // _fmtMoneyExact, which reads CURRENCIES[activeCurrency] LIVE) kept stamping the PREVIOUS entity's
  // symbol on the NEW entity's native figures — e.g. Saige/USD rendered as TT$207.7K until a refresh
  // re-ran boot. This is app-wide (dashboard, invoices, reports, every S()-formatted surface), not
  // dashboard-only. The F151 splash only hid the transient; the end-state symbol stayed wrong.
  try {
    activeCurrency = e.displayCurrency || e.currency;
    currencySymbol = (CURRENCIES[activeCurrency] && CURRENCIES[activeCurrency].symbol) || '$';
    var _cflag = document.getElementById('currency-flag'); if(_cflag) _cflag.textContent = (CURRENCIES[activeCurrency] && CURRENCIES[activeCurrency].flag) || '🇺🇸';
    var _clabel = document.getElementById('currency-code-label'); if(_clabel) _clabel.textContent = activeCurrency;
  } catch(e2){ console.warn('[Entity] currency reset failed:', e2 && e2.message); }

  // F-ENT: the money-flow river is a rendered SVG with the PREVIOUS entity's figures + currency baked in
  // (e.g. -TT$210 lingering on a CAD entity). Resetting currencySymbol above does NOT re-render existing
  // SVG, so clear it now; buildRiver repaints with the new entity's data + currency once it loads.
  try { var _rw=document.getElementById('river-wrap'); if(_rw) _rw.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12.5px">Loading…</div>'; var _rs=document.getElementById('river-sub'); if(_rs) _rs.textContent='Where every dollar goes'; } catch(_e){}

  // Refresh entity list UI
  renderEntities();

  // F196 Tier 2: repaint the Business-profile panel for the NEW entity. /api/settings is ONE row per
  // ACCOUNT and is loaded once at boot, so without this the panel (and any document rendered from it)
  // keeps showing the PREVIOUS entity's business name/address/tax-id after a switch — the same
  // per-user-setting-on-per-entity-output class as the letterhead bug itself. ENTITIES already carries
  // each entity's profile from /api/entities, so this is a repaint, not a refetch.
  try { if (typeof window._ffApplyEntityProfile === 'function') window._ffApplyEntityProfile(); }
  catch(e4){ console.warn('[Entity] business-profile repaint failed:', e4 && e4.message); }

  // Keep the sidebar's PARALLEL `businesses` model in lockstep with ENTITIES. `businesses` is derived
  // from ENTITIES on every entity-load (copying active:e.active, index.html:~6182) and is what the
  // sidebar switcher (renderBusinessSwitcher / buildBizMenu) reads — but a direct switchEntity (the
  // Scheduled-Documents dropdown, the Entities page) never updated it, so the sidebar repainted the
  // PREVIOUS business over the new one (Acme shown while Saige was the active entity). Mirror the active
  // flag by _dbId and re-render the switcher so both indicators always move together.
  try {
    if (typeof businesses !== 'undefined' && Array.isArray(businesses)) {
      businesses.forEach(function(b){ b.active = (b._dbId != null && b._dbId === e._dbId); });
      if (e._dbId != null && typeof activeBizId !== 'undefined') activeBizId = 'biz-' + e._dbId;
      if (typeof renderBusinessSwitcher === 'function') renderBusinessSwitcher();
    }
  } catch(e3){ console.warn('[Entity] business-switcher sync failed:', e3 && e3.message); }

  // MUST activate in session and wait for response before loading data
  if(e._dbId){
    try {
      const r = await fetch('/api/entities/'+e._dbId+'/activate',{method:'POST',credentials:'include'});
      if(!r.ok) console.warn('[Entity] Activate failed:', await r.text());
    } catch(err){ console.warn('[Entity] Activate error:', err.message); }
  }

  // Small pause to ensure session is committed server-side
  await new Promise(res => setTimeout(res, 100));

  // Load real data for this entity
  await loadEntityData(idx);

  // F151/entity-isolation: loadEntityData reloads invoices/expenses/customers/inventory/payroll for the
  // new entity, but NOT the other money collections. Their loaders ran once at boot for the PREVIOUS
  // entity and are never re-run on a switch, so window.creditNotes / vendorCredits / bills / receipts /
  // payments keep the OLD entity's rows — which the dashboard compute then applies to the NEW entity
  // (e.g. Saige's credit notes dragging empty Acme to −$1.2K). Reload them now (the session is already
  // the new entity, via the activate above) and recompute once. The network-idle splash covers this.
  await Promise.all([
    window._loadCreditNotesFromDB,  window._loadVendorCreditsFromDB,
    window._loadBillsFromDB,        window._loadReceiptsFromDB,
    window._loadPaymentsMadeFromDB, window._loadPaymentsRecvFromDB,
    window._loadVendorsFromDB,      window._loadTimesheetFromDB,
    window._loadProjectsFromDB,
  ].map(fn => { try { return typeof fn === 'function' ? Promise.resolve(fn()).catch(()=>{}) : null; } catch(e){ return null; } }));
  if(typeof updateDashboard === 'function'){ try { updateDashboard(); } catch(e){} }

  // F94: the Scheduled Documents tab is not wired into loadEntityData/updateDashboard, so a sidebar or
  // entity-card switch re-scoped the session + reloaded data but left the tab rendering the PREVIOUS
  // entity until a manual refresh. Re-render it when it's the visible page. (The in-page entity dropdown
  // already re-renders through its own onchange handler; _f94Open is idempotent, so any overlap is safe.)
  try {
    var _sdPage = document.getElementById('page-scheduled-documents');
    if(_sdPage && _sdPage.classList.contains('active') && typeof window._f94Open === 'function') window._f94Open();
  } catch(e){}

  // Documents are entity-scoped server-side (GET /api/documents null-inclusive). renderDocuments()
  // refetches fresh, so if the Documents page is open when a sidebar/entity-card switch happens,
  // repaint it for the new entity rather than leaving the PREVIOUS entity's files on screen.
  try {
    var _docPage = document.getElementById('page-documents');
    if(_docPage && _docPage.classList.contains('active') && typeof renderDocuments === 'function') renderDocuments();
  } catch(e){}

  // Audit trail is entity-scoped server-side (/api/audit-log reads audit_trail, active-entity + account
  // events). Re-fetch if the page is open so a switch shows the new entity's history, not the old one's.
  try {
    var _audPage = document.getElementById('page-audit');
    if(_audPage && _audPage.classList.contains('active') && typeof loadAuditTrail === 'function') loadAuditTrail();
  } catch(e){}

  // Books-lock is per-entity; if the Transaction Locking page is open, repaint it for the new business
  // so the toggle reflects THIS business's lock, not the previous one's.
  try {
    var _lockPage = document.getElementById('page-transaction-locking');
    if(_lockPage && _lockPage.classList.contains('active') && typeof renderLockHistory === 'function') renderLockHistory();
  } catch(e){}

  // API connections are per-entity (Stripe, Finch, Codat, Belvo, WiPay); repaint the Connections page
  // for the new business if open.
  try {
    var _connPage = document.getElementById('page-connections');
    if(_connPage && _connPage.classList.contains('active') && typeof window._connHydrate === 'function') window._connHydrate();
  } catch(e){}

  // Plaid-linked banks are per-entity; if the Banking page is open, repaint the linked-bank strip for
  // the new business so it shows THIS business's banks, not the previous one's.
  try {
    var _bankPage = document.getElementById('page-banking');
    if(_bankPage && _bankPage.classList.contains('active') && typeof window.renderPlaidLinked === 'function') window.renderPlaidLinked();
  } catch(e){}

  notify('Switched to '+e.name+' ✦');
};

// Populate the "More…" dropdowns with all CURRENCIES keys
(function initConsolSelect(){
  const QUICK = ['USD','GBP','EUR','TTD'];
  // Consolidated P&L select
  const sel = document.getElementById('consol-more-select');
  // Personal finance select
  const psel = document.getElementById('pers-cur-more');
  if(window.CURRENCIES){
    Object.entries(window.CURRENCIES).forEach(([code,cur])=>{
      if(QUICK.includes(code)) return;
      if(sel){
        const opt = document.createElement('option');
        opt.value = code; opt.textContent = `${cur.flag} ${code} — ${cur.name}`;
        sel.appendChild(opt);
      }
      if(psel){
        const opt2 = document.createElement('option');
        opt2.value = code; opt2.textContent = `${cur.flag} ${code} — ${cur.name}`;
        psel.appendChild(opt2);
      }
    });
  }
})();

// ── TEAM & RBAC ─────────────────────────────────────────────────────────────
const TEAM=[];
const ROLE_LABELS={owner:'Owner',admin:'Admin',accountant:'Accountant',viewer:'Viewer'};
const ROLE_CLASSES={owner:'role-owner',admin:'role-admin',accountant:'role-accountant',viewer:'role-viewer'};
const PERMS=[
  {label:'View all reports',desc:'P&L, cash flow, balance sheet',o:true,a:true,ac:true,v:true},
  {label:'Create invoices',desc:'Draft, send & mark paid',o:true,a:true,ac:true,v:false},
  {label:'Manage expenses',desc:'Add, edit, delete expenses',o:true,a:true,ac:true,v:false},
  {label:'Run payroll',desc:'Execute payroll runs',o:true,a:true,ac:false,v:false},
  {label:'Manage team',desc:'Invite, remove, change roles',o:true,a:true,ac:false,v:false},
  {label:'Bank connections',desc:'Link & manage bank accounts',o:true,a:false,ac:false,v:false},
  {label:'Entity management',desc:'Add/remove business entities',o:true,a:false,ac:false,v:false},
  {label:'Audit log',desc:'View full change history',o:true,a:true,ac:false,v:false},
  {label:'API access',desc:'Generate API keys',o:true,a:false,ac:false,v:false},
];
window.renderTeam=function(){
  const tl=document.getElementById('team-list');
  const active=TEAM.filter(m=>m.lastSeen!=='Pending');
  const pending=TEAM.filter(m=>m.lastSeen==='Pending');
  const tc=document.getElementById('team-count');if(tc)tc.textContent=active.length;
  const tp=document.getElementById('team-pending');if(tp)tp.textContent=pending.length;
  if(tl){
    if(!TEAM.length){tl.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">No team members yet. Click + Invite to add someone.</div>';}
    else tl.innerHTML=TEAM.map(m=>`
    <div class="team-member-row">
      <div class="team-avatar" style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}44">${m.avatar}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</div>
        <div style="font-size:11px;color:var(--t3)">${m.email}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <span class="role-badge ${ROLE_CLASSES[m.role]}">${ROLE_LABELS[m.role]}</span>
        <span style="font-size:10px;color:var(--t3)">${m.lastSeen}</span>
      </div>
    </div>`).join('');
  }

  const pl=document.getElementById('perm-list');
  // Read-only reference: shows the role defaults enforced server-side by rbac.js.
  // Every cell is disabled — per-account customization is a tracked follow-up.
  if(pl)pl.innerHTML=PERMS.map((p,pi)=>{
    const chk=(on)=>`<input type="checkbox" ${on?'checked':''} disabled style="width:16px;height:16px;accent-color:var(--acc);cursor:default;margin:0 auto;display:block">`;
    return `<div class="perm-row" style="display:grid;grid-template-columns:1fr repeat(4,32px);gap:6px;align-items:center">
      <div><div class="perm-label">${p.label}</div><div class="perm-desc">${p.desc}</div></div>
      ${chk(p.o)}${chk(p.a)}${chk(p.ac)}${chk(p.v)}
    </div>`;
  }).join('');
};

// ── AUDIT TRAIL — all data from DB via /api/audit-log ──────────────────────
const AUDIT_EVENTS=[]; // intentionally empty — no hardcoded demo data
const ICON_SVG={
  receipt:'<rect x="2" y="1" width="12" height="14" rx="1.2"/><line x1="5" y1="5" x2="11" y2="5"/><line x1="5" y1="8" x2="9" y2="8"/>',
  dollar:'<circle cx="8" cy="8" r="6.5"/><path d="M8 5v6M6 9.5c0 .83.67 1.5 2 1.5s2-.67 2-1.5"/>',
  users:'<circle cx="5.5" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4.5 4.5-4.5"/><circle cx="11.5" cy="5" r="2.5"/><path d="M15 13c0-2.5-2-4.5-4.5-4.5"/>',
  user:'<circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6"/>',
  settings:'<circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
  check:'<polyline points="2,8 6,12 14,4"/>',
  grid:'<rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  trash:'<polyline points="2,4 14,4"/><path d="M5 4V2h6v2"/><rect x="3" y="4" width="10" height="10" rx="1"/>',
};

let auditFilter='all';
window.filterAudit=function(val){auditFilter=val;renderAudit();};
window.renderAudit=async function(){
  const el=document.getElementById('audit-list');
  if(!el)return;
  el.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Loading…</div>';
  try{
    const params=auditFilter!=='all'?'?type='+encodeURIComponent(auditFilter):'';
    const res=await fetch('/api/audit-log'+params,{credentials:'include'});
    if(!res.ok)throw new Error();
    const data=await res.json();
    const entries=Array.isArray(data)?data:(data.rows||data.entries||[]);
    if(!entries.length){el.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">No audit events yet.</div>';return;}
    el.innerHTML=entries.map(e=>`
      <div class="audit-row">
        <div class="audit-icon" style="background:var(--acc-bg);color:var(--acc)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><polyline points="8,5 8,8 10,10"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div><span class="audit-user">You</span> <span class="audit-action">${e.action||''}</span> <span class="audit-target">${e.table_name||''}${e.record_id?' #'+e.record_id:''}</span></div>
          <div class="audit-time">${e.created_at?new Date(e.created_at).toLocaleString():''}</div>
        </div>
      </div>`).join('');
    // Update KPI cards with real data
    (function(){
      const _set=(id,v)=>{const _e=document.getElementById(id);if(_e)_e.textContent=v;};
      _set('audit-event-count', entries.length);
      const _last=entries[0];
      if(_last){
        const _d=_last.created_at?new Date(_last.created_at):null;
        const _now=new Date();
        let _rel='—';
        if(_d){
          const _diff=Math.floor((_now-_d)/1000);
          if(_diff<60)_rel=_diff+'s ago';
          else if(_diff<3600)_rel=Math.floor(_diff/60)+'m ago';
          else if(_diff<86400)_rel=Math.floor(_diff/3600)+'h ago';
          else _rel=_d.toLocaleDateString();
        }
        _set('audit-last-time',_rel);
        _set('audit-last-action',(_last.action||'')+(_last.table_name?' · '+_last.table_name:''));
      }
    })();
  }catch(err){
    el.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Could not load audit log. Check your connection.</div>';
  }
};

// ── SWIPE HINT (show once on mobile) ────────────────────────────────────────
(function(){
  if(window.innerWidth<=768&&!sessionStorage.getItem('ff_swipe_shown')){
    setTimeout(()=>{
      const h=document.getElementById('swipe-hint');
      if(h){h.style.display='block';sessionStorage.setItem('ff_swipe_shown','1');}
    },2500);
  }
})();

// Add to command palette
const _extraCmds=[
  {group:'Navigate',icon:'<rect x="1" y="1" width="6" height="6" rx="1.2"/><rect x="9" y="1" width="6" height="6" rx="1.2"/><rect x="1" y="9" width="6" height="6" rx="1.2"/><rect x="9" y="9" width="6" height="6" rx="1.2"/>',label:'Entities',action:()=>showPage('entities',null)},
  {group:'Navigate',icon:'<circle cx="5.5" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4.5 4.5-4.5"/>',label:'Team & roles',action:()=>showPage('team',null)},
  {group:'Navigate',icon:'<rect x="2" y="2" width="12" height="12"/><polyline points="2,6 14,6"/><polyline points="8,2 8,6"/>',label:'Audit trail',action:()=>showPage('audit',null)},
  {group:'Actions',icon:'<circle cx="5.5" cy="5" r="2.5"/>',label:'Invite team member',action:()=>{showPage('team',null);setTimeout(()=>notify('Invite modal opening…'),200);}},
  {group:'Actions',icon:'<rect x="1" y="1" width="6" height="6" rx="1.2"/>',label:'Switch entity',action:()=>showPage('entities',null)},
  {group:'Actions',icon:'<rect x="2" y="1" width="12" height="14" rx="1.2"/><path d="M9 11l1.5 1.5 2.5-2.5"/>',label:'Scan receipt',action:()=>showPage('expenses',null)},
];
requestAnimationFrame(()=>{if(window.CMD_ITEMS)CMD_ITEMS.push(..._extraCmds);});

// ── PRICING PAGE ─────────────────────────────────────────────────────────────
(function(){

const PRO_FEATURES=[
  {text:'1 business entity',ok:true},
  {text:'Up to 3 team members',ok:true},
  {text:'Unlimited invoicing & quotes',ok:true},
  {text:'Expense tracking',ok:true},
  {text:'Stripe live feed',ok:true},
  {text:'Budget vs actuals',ok:true},
  {text:'50 AI queries / month',ok:true},
  {text:'Multi-currency',ok:true},
  {text:'Bank sync via Plaid',ok:false},
  {text:'AI receipt & invoice scanner',ok:false},
  {text:'MRR / SaaS dashboard',ok:false},
  {text:'Multi-entity accounting',ok:false},
  {text:'Full RBAC — 4 role tiers',ok:false},
  {text:'Unlimited AI queries',ok:false},
];

const BIZ_FEATURES=[
  {text:'Up to 5 entities (separate ledgers)',ok:true},
  {text:'Up to 15 team members',ok:true},
  {text:'Everything in Pro (unlimited invoices)',ok:true},
  {text:'MRR / SaaS dashboard',ok:true},
  {text:'Bank sync via Plaid',ok:true},
  {text:'AI receipt & invoice scanner',ok:true},
  {text:'Unlimited AI queries',ok:true},
  {text:'Full RBAC — 4 role tiers',ok:true},
  {text:'7-year audit trail',ok:true},
  {text:'Consolidated multi-entity P&L',ok:true},
  {text:'Budget variance tracking',ok:true},
  {text:'Priority email support',ok:true},
];

const SCALE_FEATURES=[
  {text:'Up to 10 entities (separate ledgers)',ok:true},
  {text:'Everything in Business',ok:true},
  {text:'Consolidated group reporting',ok:true},
  {text:'5,000 AI queries / month',ok:true},
  {text:'Priority support',ok:true},
  {text:'Onboarding assistance',ok:true},
];

const ENT_FEATURES=[
  {text:'Unlimited entities',ok:true},
  {text:'Unlimited team members',ok:true},
  {text:'White-label (your branding)',ok:true},
  {text:'Dedicated account manager',ok:true},
  {text:'Custom AI context & prompts',ok:true},
  {text:'SSO / SAML integration',ok:true},
  {text:'SLA with 99.9% uptime guarantee',ok:true},
  {text:'Custom integrations & API',ok:true},
  {text:'On-premise deployment option',ok:true},
  {text:'Annual audit support',ok:true},
];

const COMPARE_ROWS=[
  {feature:'Single business /mo (multi-currency tier)',ff:'$79 (Pro)',qb:'$75',xero:'$55',fb:'$30',ffWins:false},
  {feature:'5 businesses — total /mo',ff:'$249 (one plan)',qb:'$375 (5 subs)',xero:'$450 (5 orgs)',fb:'✗',ffWins:true},
  {feature:'10 businesses — total /mo',ff:'$400 (Scale)',qb:'$750 (10 subs)',xero:'$900 (10 orgs)',fb:'✗',ffWins:true},
  {feature:'Native AI assistant',ff:'✓ Claude (Business)',qb:'Limited',xero:'✗',fb:'✗',ffWins:true},
  {feature:'Multi-entity (same plan)',ff:'✓ Business',qb:'✗ Extra sub',xero:'✗ Extra org',fb:'✗',ffWins:true},
  {feature:'AI receipt scanner',ff:'✓ Business',qb:'Basic OCR',xero:'Basic OCR',fb:'✗',ffWins:true},
  {feature:'Live bank sync (Plaid)',ff:'✓ Business',qb:'✓',xero:'✓',fb:'Limited',ffWins:false},
  {feature:'7-year audit trail',ff:'✓ Business',qb:'✓',xero:'✓',fb:'✗',ffWins:false},
  {feature:'MRR / SaaS dashboard',ff:'✓ Business',qb:'✗',xero:'✗',fb:'✗',ffWins:true},
  {feature:'Budget variance tracking',ff:'✓ Pro & Business',qb:'Add-on',xero:'Limited',fb:'✗',ffWins:true},
  {feature:'Command palette',ff:'✓',qb:'✗',xero:'✗',fb:'✗',ffWins:true},
  {feature:'Annual discount',ff:'20% off',qb:'10% off',xero:'10% off',fb:'10% off',ffWins:true},
  {feature:'Free trial',ff:'30 days',qb:'30 days',xero:'30 days',fb:'30 days',ffWins:false},
];

const FAQ=[
  {q:'Can I switch plans at any time?',a:'Yes — upgrade or downgrade instantly. If you upgrade mid-cycle you\'re charged the prorated difference. Downgrades take effect at the next billing date.'},
  {q:'What happens to my data if I cancel?',a:'Your data is retained for 90 days after cancellation. You can export everything as CSV, PDF, or JSON at any point — including after cancelling.'},
  {q:'Is the 30-day trial really free?',a:'100%. No credit card required. You get full Business tier access for 30 days, then choose a plan or your account moves to read-only mode.'},
  {q:'Do you charge per entity on Business?',a:'No — Business includes up to 5 separate entities with fully independent ledgers, currencies, and chart of accounts. No per-entity fees.'},
  {q:'What AI model powers FinFlow AI?',a:'FinFlow uses Claude by Anthropic — one of the most capable AI models available. All AI runs through FinFlow backend — no API key needed on your end.'},
  {q:'Is my financial data secure?',a:'All data is encrypted at rest and in transit using industry-standard AES-256. FinFlow never sells or shares your data. AI features run entirely on FinFlow\'s own servers — you never need to provide an API key.'},
];

let isAnnual=false;

window.toggleBilling=function(){
  const cb=document.getElementById('billing-toggle');
  isAnnual=cb?cb.checked:!isAnnual;
  const pro=isAnnual?63:79;
  const biz=isAnnual?199:249;
  const scale=isAnnual?320:400;
  const proEl=document.getElementById('price-pro');
  const bizEl=document.getElementById('price-biz');
  const scaleEl=document.getElementById('price-scale');
  const proSub=document.getElementById('price-pro-sub');
  const bizSub=document.getElementById('price-biz-sub');
  const scaleSub=document.getElementById('price-scale-sub');
  if(proEl)proEl.textContent='$'+pro;
  if(bizEl)bizEl.textContent='$'+biz;
  if(scaleEl)scaleEl.textContent='$'+scale;
  if(proSub)proSub.textContent=isAnnual?`$${pro*12}/yr · save $${(79-pro)*12}`:'Billed monthly';
  if(bizSub)bizSub.textContent=isAnnual?`$${biz*12}/yr · save $${(249-biz)*12}`:'Billed monthly';
  if(scaleSub)scaleSub.textContent=isAnnual?`$${scale*12}/yr · save $${(400-scale)*12}`:'Billed monthly';
};

function check(ok){
  return ok
    ?`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><polyline points="2,8 6,12 14,4"/></svg>`
    :`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--t3)" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
}

function renderFeatureList(id, items){
  const el=document.getElementById(id);
  if(!el)return;
  el.innerHTML=items.map(f=>`
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;color:${f.ok?'var(--t1)':'var(--t3)'}">
      <span style="flex-shrink:0">${check(f.ok)}</span>
      <span>${f.text}</span>
    </div>`).join('');
}

function renderCompareTable(){
  const body=document.getElementById('compare-table-body');
  if(!body)return;
  body.innerHTML=COMPARE_ROWS.map((r,i)=>`
    <tr style="border-bottom:1px solid var(--bd);${i%2===0?'':'background:rgba(255,255,255,.01)'}">
      <td style="padding:7px 8px;color:var(--t2)">${r.feature}</td>
      <td style="padding:7px 8px;text-align:center;background:var(--acc-bg);font-weight:${r.ffWins?'600':'400'};color:${r.ffWins?'var(--acc)':'var(--t1)'}">${r.ff}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--t2)">${r.qb}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--t2)">${r.xero}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--t2)">${r.fb}</td>
    </tr>`).join('');
}

function renderFAQ(){
  const el=document.getElementById('faq-list');
  if(!el)return;
  el.innerHTML=FAQ.map((f,i)=>`
    <div style="border-bottom:1px solid var(--bd);${i===FAQ.length-1?'border-bottom:none':''}">
      <div onclick="toggleFAQ(${i})" style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;cursor:pointer;user-select:none">
        <span style="font-size:13px;font-weight:500;color:var(--t1)">${f.q}</span>
        <svg id="faq-arr-${i}" width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="var(--t3)" stroke-width="1.5" stroke-linecap="round" style="flex-shrink:0;transition:transform .2s"><polyline points="2,3 5,7 8,3"/></svg>
      </div>
      <div id="faq-ans-${i}" style="display:none;font-size:12.5px;color:var(--t2);line-height:1.65;padding-bottom:.85rem">${f.a}</div>
    </div>`).join('');
}

window.toggleFAQ=function(i){
  const ans=document.getElementById('faq-ans-'+i);
  const arr=document.getElementById('faq-arr-'+i);
  if(!ans)return;
  const open=ans.style.display==='block';
  ans.style.display=open?'none':'block';
  if(arr)arr.style.transform=open?'':'rotate(180deg)';
};

function _updatePricingCTAs(){
  const plan = String((typeof currentUserPlan!=='undefined'?currentUserPlan:'') || '').toLowerCase();
  const rank = { pro:1, business:2, scale:3, enterprise:4 };
  const name = { pro:'Pro', business:'Business', scale:'Scale', enterprise:'Enterprise' };
  const cur = rank[plan] || 0;   // 0 = trial/free → not on a paid plan yet, so the free-trial CTA is valid
  const setMuted  = (b,txt) => { b.textContent=txt; b.onclick=null; b.disabled=true; b.style.opacity='.55'; b.style.cursor='default'; };
  const setAction = (b,tier,txt) => { b.disabled=false; b.style.opacity=''; b.style.cursor=''; b.textContent=txt; b.onclick=()=>startTrial(tier); };
  [['cta-pro','pro'],['cta-biz','business'],['cta-scale','scale']].forEach(([id,tier])=>{
    const b=document.getElementById(id); if(!b) return;
    const r=rank[tier];
    if(cur===0) setAction(b,tier,'Start free trial');          // trial/free user — free trial still applies
    else if(r===cur) setMuted(b,'Current plan');               // the plan they already pay for
    else if(r>cur) setAction(b,tier,'Upgrade to '+name[tier]); // upgrades are self-serve
    else setMuted(b,'Included in your plan');                  // lower tier — NO self-serve downgrade; a higher plan already includes it
  });
  const be=document.getElementById('cta-ent');
  if(be && cur===4) setMuted(be,'Current plan');               // on Enterprise → "Current plan"; else leave "Contact sales"
}
window._updatePricingCTAs=_updatePricingCTAs;

function initPricing(){
  renderFeatureList('pro-features',PRO_FEATURES);
  renderFeatureList('biz-features',BIZ_FEATURES);
  renderFeatureList('scale-features',SCALE_FEATURES);
  renderFeatureList('ent-features',ENT_FEATURES);
  renderCompareTable();
  renderFAQ();
  _updatePricingCTAs();
}

// Init on page load and when navigated to
requestAnimationFrame(initPricing);
const _spOld=window.showPage;
window.showPage=function(id,el){
  _spOld(id,el);
  if(id==='pricing'){document.getElementById('pageTitle').textContent='Plans & pricing';setTimeout(initPricing,80);}
};

})();
