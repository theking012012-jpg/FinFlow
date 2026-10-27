// ════════════════════════════════════════════
// sendPrompt STUB — replaced by host when embedded
// ════════════════════════════════════════════
if(typeof sendPrompt==='undefined'){
  window.sendPrompt=function(msg){ console.log('[FinFlow] sendPrompt:',msg); };
}

// ════════════════════════════════════════════
// LOCAL DATE HELPER (F37)
// ════════════════════════════════════════════
// new Date().toISOString() emits a UTC calendar date — for users behind or
// ahead of UTC it rolls over near midnight and defaults date fields to the
// wrong day. Format from LOCAL components so "today" means the user's today.
function toLocalYMD(d){
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayLocal(){ return toLocalYMD(new Date()); }

// ── withSubmitGuard — the single shared double-submit guard (Rule 9) ───────────────────
// Wrap any mutating submit handler so a double/triple-click cannot fire it twice. While fn is in
// flight the button is disabled (optionally relabelled); a second call for the SAME button is
// refused and returns undefined; and the button is ALWAYS restored in a finally — including when fn
// throws, the failure mode ad-hoc per-button guards keep leaking (a button left stuck disabled on
// error). Idempotency at the write (server unique key) is the durable layer; this is the client
// layer that stops the second request from ever being sent. Returns fn's resolved value.
async function withSubmitGuard(btn, fn, opts){
  opts = opts || {};
  if (btn) {
    if (btn.dataset.ffSubmitting === '1') return undefined;   // already in flight → refuse re-entry
    btn.dataset.ffSubmitting = '1';
    btn.dataset.ffPrevHtml = btn.innerHTML;
    btn.disabled = true;
    if (opts.label != null) btn.textContent = opts.label;
  }
  try {
    return await fn();
  } finally {
    if (btn) {
      btn.disabled = false;
      if (opts.label != null && btn.dataset.ffPrevHtml != null) btn.innerHTML = btn.dataset.ffPrevHtml;
      delete btn.dataset.ffPrevHtml;
      btn.dataset.ffSubmitting = '';
    }
  }
}
window.withSubmitGuard = withSubmitGuard;
// C3/F37: expose the LOCAL-date helpers so every client file uses the viewer's local calendar date
// for record-date defaults, never `new Date().toISOString().slice(0,10)` (which is the UTC date and,
// at a negative UTC offset after ~20:00 local, stamps a record into TOMORROW → wrong month/period).
window.todayLocal = todayLocal;
window.toLocalYMD = toLocalYMD;

// ════════════════════════════════════════════
// MULTI-CURRENCY ENGINE
// ════════════════════════════════════════════
// ── ALL WORLD CURRENCIES (rates vs USD, Apr 2026) ─────────────────────────
// LA15b: the table lives in finflow-currency.js (loaded before this file) so pages without app-main share it.
const CURRENCIES = window.FinFlowCurrency.CURRENCIES;
// Make the full currency table available globally so cross-script FX helpers
// (_safeFX, fxConvert, etc.) always find the complete rate table.
window.CURRENCIES = CURRENCIES;

// ── COUNTRY → CURRENCY MAP (auto-select on country pick) ──────────────────
// LA15c: the map lives in finflow-currency.js (shared with the accountant sign-up page).
const COUNTRY_CURRENCY = window.FinFlowCurrency.COUNTRY_CURRENCY;

let activeCurrency = 'USD';
let _currencySearch = '';

function toggleCurrencyMenu(e){
  // BLOCKER FIX: without stopPropagation the SAME click bubbles to the document-level
  // closeAllDropdowns listener (:536) which sets #currency-menu back to display:none, so the
  // menu opened then instantly re-closed — the header pill's setCurrency was never reachable.
  // (The sibling toggleBizMenu already does exactly this; the currency toggle was missing it.)
  if(e && e.stopPropagation) e.stopPropagation();
  const m = document.getElementById('currency-menu');
  const isOpen = m.style.display !== 'none';
  closeAllDropdowns();
  if(!isOpen){ buildCurrencyMenu(''); m.style.display='block'; }
}

function buildCurrencyMenu(search){
  const list = document.getElementById('currency-list');
  const entries = Object.entries(CURRENCIES)
    .filter(([code,c])=> !search ||
      code.toLowerCase().includes(search.toLowerCase()) ||
      (c.name||'').toLowerCase().includes(search.toLowerCase())
    )
    .sort(([a],[b])=>{
      // Pin active to top, then common currencies, then alphabetical
      const priority = ['USD','EUR','GBP','JPY','CAD','AUD','CHF','TTD','XCD','JMD','BBD','GYD'];
      const ai = priority.indexOf(a), bi = priority.indexOf(b);
      if(ai>-1&&bi>-1) return ai-bi;
      if(ai>-1) return -1; if(bi>-1) return 1;
      return a.localeCompare(b);
    });

  list.innerHTML = `
    <div style="padding:6px 8px;border-bottom:1px solid var(--bd)">
      <input class="finput" placeholder="Search currencies…" style="font-size:12px;padding:5px 8px"
        value="${search}" oninput="buildCurrencyMenu(this.value)"
        onclick="event.stopPropagation()" id="currency-search-input">
    </div>
    <div style="max-height:240px;overflow-y:auto">
    ${entries.map(([code,c])=>`
      <div onclick="setCurrency('${code}')" style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;transition:background .1s;font-size:12.5px;
        background:${activeCurrency===code?'var(--bg2)':''}"
        onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background='${activeCurrency===code?'var(--bg2)':''}'"
      >
        <span style="font-size:14px;width:20px;text-align:center;flex-shrink:0">${c.flag}</span>
        <span style="font-weight:600;color:var(--t1);width:36px;flex-shrink:0">${code}</span>
        <span style="color:var(--t3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name||'')}</span>
        <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--t3);flex-shrink:0">${code==='USD'?'base':(typeof c.rate==='number'?'×'+c.rate.toFixed(2):'')}</span>
        ${activeCurrency===code?'<span style="color:var(--acc);font-size:12px;flex-shrink:0">✓</span>':''}
      </div>`).join('')}
    ${entries.length===0?'<div style="padding:12px;text-align:center;color:var(--t3);font-size:12px">No currencies found</div>':''}
    </div>`;
}

// ── COUNTRY SEARCH FOR ADD BUSINESS MODAL ─────────────────────────────────
function showCountryDropdown(){ filterCountries(document.getElementById('nb-country-input').value); }

function filterCountries(q){
  const dd = document.getElementById('nb-country-dropdown');
  const countries = Object.keys(COUNTRY_CURRENCY).sort();
  const filtered = q ? countries.filter(c=>c.toLowerCase().includes(q.toLowerCase())) : countries;
  dd.style.display = 'block';
  dd.innerHTML = filtered.slice(0,30).map(country=>{
    const code = COUNTRY_CURRENCY[country];
    const cur  = CURRENCIES[code];
    return `<div onclick="selectCountry('${country.replace(/'/g,"\\'")}','${code}')"
      style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;font-size:12.5px;transition:background .1s"
      onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
      <span style="font-size:14px">${cur?.flag||'🌐'}</span>
      <span style="flex:1;color:var(--t1)">${country}</span>
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--acc);font-weight:600">${code}</span>
    </div>`;
  }).join('') + (filtered.length===0?'<div style="padding:10px;color:var(--t3);font-size:12px;text-align:center">No matches</div>':'');
}

function selectCountry(country, currencyCode){
  document.getElementById('nb-country-input').value = country;
  document.getElementById('nb-country').value = country;
  document.getElementById('nb-currency').value = currencyCode;
  document.getElementById('nb-country-dropdown').style.display = 'none';
  // Show currency chip
  const cur = CURRENCIES[currencyCode];
  const chip = document.getElementById('nb-currency-chip');
  document.getElementById('nb-chip-flag').textContent = cur?.flag||'🌐';
  document.getElementById('nb-chip-text').textContent = `${currencyCode} — ${esc(cur?.name||currencyCode)}`;
  document.getElementById('nb-chip-rate').textContent = currencyCode==='USD'?'base':'1 '+currencyCode+' = '+(1/cur.rate).toFixed(4)+' USD';
  document.getElementById('nb-currency-preview').textContent = currencyCode;
  chip.style.display = 'flex';
  document.getElementById('nb-currency-override').style.display = 'none';
}

function overrideCurrency(){
  document.getElementById('nb-currency-override').style.display = 'block';
  filterCurrencyOverride('');
}

function filterCurrencyOverride(q){
  const dd = document.getElementById('nb-override-dropdown');
  const entries = Object.entries(CURRENCIES)
    .filter(([code,c])=>!q||code.toLowerCase().includes(q.toLowerCase())||c.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0,20);
  dd.innerHTML = entries.map(([code,c])=>`
    <div onclick="pickOverrideCurrency('${code}')"
      style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px;transition:background .1s"
      onmouseenter="this.style.background='var(--bg1)'" onmouseleave="this.style.background=''">
      <span>${c.flag}</span><span style="font-weight:600;color:var(--t1)">${code}</span>
      <span style="color:var(--t3);flex:1">${esc(c.name)}</span>
    </div>`).join('');
}

function pickOverrideCurrency(code){
  document.getElementById('nb-currency').value = code;
  const cur = CURRENCIES[code];
  document.getElementById('nb-chip-flag').textContent = cur?.flag||'🌐';
  document.getElementById('nb-chip-text').textContent = `${code} — ${esc(cur?.name||code)} (overridden)`;
  document.getElementById('nb-chip-rate').textContent = code==='USD'?'base':'1 '+code+' = '+(1/cur.rate).toFixed(4)+' USD';
  document.getElementById('nb-currency-preview').textContent = code;
  document.getElementById('nb-currency-override').style.display = 'none';
  document.getElementById('nb-currency-chip').style.display = 'flex';
}

// Close country dropdown on outside click
document.addEventListener('click', e=>{
  const dd = document.getElementById('nb-country-dropdown');
  if(dd && !dd.contains(e.target) && e.target.id!=='nb-country-input') dd.style.display='none';
});

function setCurrency(code){
  activeCurrency = code;
  const c = CURRENCIES[code];
  // F34 fix: route the header pill through the SAME display-currency path so it CONVERTS (sets
  // _displayCurrency → _applyConvertedKPIs), not just relabels. Previously it set currencySymbol +
  // refreshAllPeriodData but never _displayCurrency, so the conversion overlay never ran.
  _applyDisplayCurrency(code);
  // Update per-business default currency display
  const biz = businesses.find(b=>b.id===activeBizId);
  if(biz) biz.displayCurrency = code;
  // display-currency preference is in-memory only; entities are persisted via API
  document.getElementById('currency-menu').style.display='none';
  _syncCurrencyControls(code);   // mirror into Settings / mobile-drawer / header-pill flag+label
  // Personal finance display currency stays a SEPARATE path — business figures only go through
  // _displayCurrency; don't cross business/personal FX.
  // C2 (personal/business wall): this used to call setPersCurrency(code) — so switching to a TTD business (switchBusiness
  // → setCurrency) flipped the Personal page to TTD. Personal never depends on the business in view; its currency is
  // changed only from the Personal page.
  notify(`Display currency: ${c.flag} ${code}`);
}

// fxConvert defined in multi-entity block below

// ════════════════════════════════════════════
// MULTI-BUSINESS ENGINE
// ════════════════════════════════════════════
const BIZ_COLORS = ['var(--acc)','var(--purple)','var(--teal)','var(--amber)','var(--green)','var(--red)'];
const BIZ_ICONS  = ['📊','🏗','💻','🛒','🍽','🏥','🏠','📦'];

let businesses = []; // loaded from DB entities
let activeBizId = null;

function toggleBizMenu(e){
  e.stopPropagation();
  const m = document.getElementById('biz-menu');
  const isOpen = m.style.display !== 'none';
  closeAllDropdowns();
  if(!isOpen){ buildBizMenu(); m.style.display='block'; }
}

function renderBusinessSwitcher(){
  // Update the brand header with active business
  const active = businesses.find(b=>b.active) || businesses[0];
  if(!active) return;
  activeBizId = active.id;
  const nameEl = document.getElementById('sb-brand-name');
  const badgeEl = document.getElementById('biz-currency-badge');
  if(nameEl) nameEl.textContent = active.name;
  if(badgeEl) badgeEl.textContent = active.currency + ' · ' + (typeof _planLabel==='function' ? _planLabel() : 'Pro');   // C27: the real plan (was hard-coded "Pro", so the badge flipped Pro ↔ Business)
}

function buildBizMenu(){
  const list = document.getElementById('biz-list');
  list.innerHTML = businesses.map(b=>`
    <div onclick="switchBusiness('${b.id}')" style="display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer;transition:background .1s;
      background:${b.id===activeBizId?'var(--bg2)':''}"
      onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background='${b.id===activeBizId?'var(--bg2)':''}'"
    >
      <div style="width:28px;height:28px;border-radius:8px;background:${b.color};opacity:.15;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;position:relative">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:7">${esc(b.icon || String(b.name||'?').trim().charAt(0).toUpperCase() || '?')}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:${b.id===activeBizId?600:400};color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.name)}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(b.industry)} · ${esc(b.currency)}</div>
      </div>
      ${b.id===activeBizId?'<span style="color:var(--acc);font-size:14px;flex-shrink:0">✓</span>':''}
    </div>`).join('');
}

function switchBusiness(id){
  activeBizId = id;
  const biz = businesses.find(b=>b.id===id);
  if(!biz) return;
  document.getElementById('biz-menu').style.display='none';
  // Update UI
  document.getElementById('sb-brand-name').textContent = biz.name;
  document.getElementById('biz-currency-badge').textContent = biz.currency + ' · ' + _planLabel();
  // Switch display currency
  if(typeof setCurrency==='function') setCurrency(biz.displayCurrency || biz.currency);
  // Switch entity via DB - use _dbId
  const entityIdx = biz._dbId ? ENTITIES.findIndex(e=>e._dbId===biz._dbId) : ENTITIES.findIndex(e=>e.name===biz.name);
  if(entityIdx >= 0){
    window.switchEntity(entityIdx);
  }
}

function flashTopbar(color){
  const tb = document.querySelector('.topbar');
  if(!tb) return;
  tb.style.transition = 'border-color .3s';
  tb.style.borderBottomColor = color;
  setTimeout(()=>{ tb.style.borderBottomColor=''; }, 1200);
}

function openAddBizModal(e){
  if(e) e.stopPropagation();
  document.getElementById('biz-menu').style.display='none';
  // Same plan gate as openAddEntityModal — the sidebar "+ Add business" button
  // must not bypass the multi-entity limit. (Server-side enforcement is separate.)
  if(_entityCapReached()){
    if(typeof showUpgradeModal==='function') showUpgradeModal('entity');
    return;
  }
  openCreateBusinessPage('dashboard');
}

function openCreateBusinessPage(fromPage){
  window._cbPrev = fromPage || 'entities';
  ['nb-name','nb-tax-id','nb-address','nb-website','nb-user-name','nb-user-initials','nb-email','nb-phone'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const cur=document.getElementById('nb-currency'); if(cur) cur.value='USD';
  const ind=document.getElementById('nb-industry'); if(ind) ind.selectedIndex=0;
  const fy=document.getElementById('nb-fiscal');   if(fy)  fy.selectedIndex=0;
  const isFirst=typeof ENTITIES==='undefined'||ENTITIES.length===0;
  const profileSec=document.getElementById('cb-profile-section');
  if(profileSec) profileSec.style.display=isFirst?'':'none';
  const cancelBtn=document.getElementById('cb-cancel-btn');
  if(cancelBtn) cancelBtn.style.display=isFirst?'none':'';
  // Pre-fill the profile section from the logged-in user (first business only),
  // mirroring the Settings profile screen. Only fill empty fields; phone stays
  // blank; initials are computed from the name via the existing nbAutoInitials.
  if(isFirst){
    const _cu=window.CURRENT_USER||{};
    const _nn=document.getElementById('nb-user-name'); if(_nn&&!_nn.value&&_cu.name) _nn.value=_cu.name;
    const _ne=document.getElementById('nb-email');     if(_ne&&!_ne.value&&_cu.email) _ne.value=_cu.email;
    if(typeof nbAutoInitials==='function') nbAutoInitials();
  }
  // F191 fix: populate the Timezone/Country selects from the curated F94 region list
  // every time the page opens (init-time fill can run before this DOM exists, leaving
  // only the placeholder option). Idempotent — _fillRegionSelect rebuilds the options.
  try { if (typeof window._f94FillRegion === 'function') window._f94FillRegion(); } catch(_){}
  showPage('create-business', null);
}

function nbAutoInitials(){
  const name=(document.getElementById('nb-user-name')||{}).value||'';
  const parts=name.trim().split(/\s+/);
  const initials=(parts.length>=2?parts[0][0]+parts[parts.length-1][0]:name.slice(0,2)).toUpperCase();
  const el=document.getElementById('nb-user-initials'); if(el&&!el._manual) el.value=initials;
}

let _cbSubmitting=false;
async function submitCreateBusiness(){
  const name=(document.getElementById('nb-name')||{}).value.trim();
  if(!name){ notify('Please enter a business name'); return; }
  // Guard against double-submission: ignore re-entry while a create is in
  // flight and disable the button so a fast double-click can't POST twice.
  if(_cbSubmitting) return;
  _cbSubmitting=true;
  const _cbBtn=document.getElementById('cb-submit-btn');
  const _cbBtnHtml=_cbBtn?_cbBtn.innerHTML:'';
  if(_cbBtn){ _cbBtn.disabled=true; _cbBtn.innerHTML='Creating…'; }
  const currency=(document.getElementById('nb-currency')||{}).value||'USD';
  const industry=(document.getElementById('nb-industry')||{}).value||'Other';
  // F191: capture entity timezone + country so F88 scheduling (day-edge + holiday shift) engages.
  // Both optional; server validates (IANA / ISO-2) and allows blank. Selects populated by finflow-f94.js.
  const timezone=(document.getElementById('nb-timezone')||{}).value||'';
  const country=(document.getElementById('nb-country')||{}).value||'';
  // Country is required on create (mirrors the server rule) — it drives tax + filing. Reset the
  // in-flight guard/button so the user can pick one and resubmit.
  if(!country){
    notify('Please select a country');
    _cbSubmitting=false;
    if(_cbBtn){ _cbBtn.disabled=false; _cbBtn.innerHTML=_cbBtnHtml; }
    const _cc=document.getElementById('nb-country'); if(_cc&&_cc.focus) _cc.focus();
    return;
  }
  const isFirst=typeof ENTITIES==='undefined'||ENTITIES.length===0;
  const color='#c9a84c';
  const tag=isFirst?'Parent':'Subsidiary';
  try {
    const res=await fetch('/api/entities',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name,currency,color,tag,timezone,country,sort_order:typeof ENTITIES!=='undefined'?ENTITIES.length:0})});
    if(!res.ok) throw new Error((await res.json()).error);
    // F149: ONLY the first business seeds account-level settings. A 2nd+ business is fully
    // defined by its own entity row (POST /api/entities above carries name+currency+color+tag),
    // so an additional create must NOT write /api/settings at all. Why this matters: the settings
    // handler renames the CURRENTLY-ACTIVE entity from business_name (server.js ~1733). On a 2nd
    // business the active entity is the PREVIOUS one — so creating "B" renamed the user's existing
    // business "A" in the DB. The shared profile fields (tax_id/address/fiscal_year/industry/
    // currency) are account-wide too and a subsidiary must not clobber them. Per-entity business
    // profiles (own tax_id/address, and moving rename off the settings side-effect) = F149-b.
    if(isFirst){
      const profile={
        business_name: name,
        industry,
        currency,
        tax_id:        (document.getElementById('nb-tax-id')||{}).value||'',
        fiscal_year:   (document.getElementById('nb-fiscal')||{}).value||'January',
        address:       (document.getElementById('nb-address')||{}).value||'',
        website:       (document.getElementById('nb-website')||{}).value||'',
      };
      const _un=(document.getElementById('nb-user-name')||{}).value.trim();
      const _ue=(document.getElementById('nb-email')||{}).value.trim();
      const _up=(document.getElementById('nb-phone')||{}).value.trim();
      // Only include fields the user actually provided — a blank field must not
      // overwrite an existing profile name/email/phone with an empty string.
      if(_un) profile.name  = _un;
      if(_ue) profile.email = _ue;
      if(_up) profile.phone = _up;
      await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(profile)});
    }
    if(typeof loadEntitiesFromDB==='function') await loadEntitiesFromDB(true); // F50 Step 2: force — a new entity must bypass the boot memo
    notify('Business "'+esc(name)+'" created ✦');
    showPage('dashboard', null);
  } catch(e){ notify('Error: '+(e.message||'Failed to create business')); }
  finally {
    // Always clear the guard + restore the button (success hides the page,
    // failure leaves it so the user can retry).
    _cbSubmitting=false;
    if(_cbBtn){ _cbBtn.disabled=false; _cbBtn.innerHTML=_cbBtnHtml; }
  }
}

function closeAllDropdowns(){
  const bm = document.getElementById('biz-menu'); if(bm) bm.style.display='none';
  const cm = document.getElementById('currency-menu'); if(cm) cm.style.display='none';
}

// Close dropdowns on outside click
document.addEventListener('click', closeAllDropdowns);

// ── SINGLE money formatter — the one K→M→B rollover every abbreviating formatter delegates
// to (window.S / S2 / SP / SPfrom / S2b), so thresholds can't drift apart again. The
// "$35179.8K" bug was a K-only formatter with no M rollover; this is the same class as the
// KPI-math duplication the audit already fought. Handles sub-$1K exact, K/M/B, negatives, zero,
// and takes the currency symbol from the caller so both F34 display-currency and persCurrency work.
function _fmtMoney(value, symbol){
  const sym = (symbol == null ? '$' : symbol);
  let n = Number(value);
  if(!isFinite(n)) n = 0;
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  let body;
  if(a >= 1e9)      body = (a/1e9).toFixed(1) + 'B';
  else if(a >= 1e6) body = (a/1e6).toFixed(1) + 'M';
  else if(a >= 1e3) body = (a/1e3).toFixed(1) + 'K';
  else              body = Math.round(a).toLocaleString('en-US');
  return sign + sym + body;
}
window._fmtMoney = _fmtMoney;

// F64: abbreviated, FX-aware (K/M/B) — for dashboard tiles + chart axes that must stay compact.
function _fmtMoneyAbbr(n){
  const converted = typeof fxConvert === 'function' ? fxConvert(n) : (parseFloat(n)||0);
  const sym = CURRENCIES[activeCurrency]?.symbol || '$';
  return _fmtMoney(converted, sym);
}
window._fmtMoneyAbbr = _fmtMoneyAbbr;

// F64: EXACT, FX-aware — honours "Show cents" (#s-cents). General-purpose renderer for rows/detail.
function _fmtMoneyExact(n){
  const converted = typeof fxConvert === 'function' ? fxConvert(n) : (parseFloat(n)||0);
  const sym = CURRENCIES[activeCurrency]?.symbol || '$';
  const cents = document.getElementById('s-cents')?.checked;
  const sign = converted < 0 ? '-' : '';
  const abs = Math.abs(converted);
  const body = cents
    ? abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
    : Math.round(abs).toLocaleString('en-US');
  return sign + sym + body;
}
window._fmtMoneyExact = _fmtMoneyExact;

// F124: NATIVE-currency renderer — the ENTITY's own symbol, deliberately NOT activeCurrency.
//
// Use this on any surface whose values are the entity's own money and are NOT FX-converted.
// Under a display currency `activeCurrency` is the DISPLAY currency, so stamping it on an
// unconverted figure is mislabelled money — the F34/F59/F70 defect, which is what a hardcoded
// '$' also produces the moment the entity's currency is not USD. Both failure modes disappear by
// matching the symbol to the currency the value is genuinely in.
//
// The rule for choosing between the three renderers:
//   value already in activeCurrency (server-converted, or native-and-no-display-currency)
//       → _fmtMoneyAbbr / _fmtMoneyExact / the CURRENCIES[activeCurrency] symbol lookup
//   value in the ENTITY's currency with no conversion applied to it
//       → _fmtMoneyNative  (this)
// A surface that ought to be converted and is not is a FINDING, not a formatting choice —
// see F126. This renderer makes such a surface HONEST, it does not make it converted.
function _nativeSymbol(){
  return CURRENCIES[_activeEntityCurrency()]?.symbol || '$';
}
// L29 (F64 residue): EXACT like _fmtMoneyExact — honours "Show cents" — but in the entity's own symbol and
// never converted. It used to delegate to the K/M/B abbreviator, so every report line, budget row and scenario
// figure ≥ 1,000 read "TT$12.3K". Compact axes/tiles use _fmtMoneyNativeAbbr explicitly.
function _fmtMoneyNative(n){
  const v = parseFloat(n) || 0;
  const cents = document.getElementById('s-cents')?.checked;
  const abs = Math.abs(v);
  const body = cents
    ? abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
    : Math.round(abs).toLocaleString('en-US');
  return (v < 0 && body !== '0' ? '-' : '') + _nativeSymbol() + body;
}
function _fmtMoneyNativeAbbr(n){ return _fmtMoney(n, _nativeSymbol()); }
window._nativeSymbol   = _nativeSymbol;     // for sites that render exact, not abbreviated
window._fmtMoneyNative = _fmtMoneyNative;
window._fmtMoneyNativeAbbr = _fmtMoneyNativeAbbr;

// F94: a future-dated document is SCHEDULED — excluded from every figure by D2, and badged in its
// list so it isn't mistaken for lost data. Tz-free calendar compare (Rule 10), on the SAME date the
// D2 recognition leg excludes on (issue_date, with created_at/date fallbacks).
// F88 step 4: the "today" boundary is the ACTIVE ENTITY's, not the server's UTC day. A US entity and a
// Canadian one can disagree on whether a given date is still future — the badge must match the entity the
// user is looking at, exactly as the server scheduler resolves per-entity (F88 step 3). No active entity,
// or one with no timezone, ⇒ null ⇒ resolvedToday falls back to UTC — byte-identical to prior behavior.
function _activeEntityTz(){
  try { const a=(typeof ENTITIES!=='undefined'?ENTITIES:(window.ENTITIES||[])).find(e=>e.active); return (a&&a.timezone)||null; } catch(e){ return null; }
}
window._activeEntityTz = _activeEntityTz;
// L36 (Rule 10): the ENTITY's calendar "today" — every client ACCOUNTING boundary (AR, overdue, D2 issued/scheduled,
// fiscal context, period windows, bills due, banking month) uses it, mirroring the server's entityTodayYmd. A bare
// resolvedToday(new Date()) is the UTC day: for a business far from UTC it moved invoices across the overdue / issued
// line near midnight, so client and server disagreed. No active entity or no zone ⇒ UTC, byte-identical to before.
function _entityToday(){ return window.FinFlowDates.resolvedToday(new Date(), _activeEntityTz()); }
window._entityToday = _entityToday;
window._isScheduled = function(dateStr){
  try { const y = window.FinFlowDates._toYmd(dateStr); return y != null && y > window.FinFlowDates.resolvedToday(new Date(), _activeEntityTz()); }
  catch(_){ return false; }
};

// ════════════════════════════════════════════
// PATCH S() to apply FX conversion
// (runs after original S() is defined at bottom of script)
// ════════════════════════════════════════════
function patchSFormatter(){
  const origS = window.S;
  if(!origS) return;
  window.S = function(n){ return _fmtMoneyExact(n); };
}


const ROLES = {
  owner:      {label:'Owner',     color:'var(--acc)',   nav:null},       // null = all
  accountant: {label:'Accountant',color:'var(--purple)',
               nav:['dashboard','manual-journals','chart-of-accounts','reports','transaction-locking','banking']},
  bookkeeper: {label:'Bookkeeper',color:'var(--teal)',
               nav:['dashboard','banking','invoices','expenses','bills','customers','vendors','payroll']},
};
let currentRole = 'owner';
let currentUserPlan = 'trial';   // F132: honest default (was 'pro' — showed "Pro" for trial/expired users until /auth/me landed); set from data.user.plan on auth
// Human label for the CURRENT plan — used by the workspace badge + nav pill so they never hardcode "Pro".
function _planLabel(){
  const p = String(currentUserPlan || '').toLowerCase();
  return ({ trial:'Trial', free:'Free', pro:'Pro', business:'Business', scale:'Scale', enterprise:'Enterprise' })[p]
    || (p ? p.charAt(0).toUpperCase() + p.slice(1) : '—');
}
window._planLabel = _planLabel;
// F147: the ONE place every auth path applies the authenticated user to client state (plan +
// CURRENT_USER + the sidebar plan label). Fresh login and register set the plan inline; the
// session-restore path (finflow-api-wiring-final.js, GET /api/auth/me) previously set NEITHER, so
// after any page RELOAD a business user silently reverted to the trial cap (entity limit 1) and hit
// the "Multiple Entities requires the Business plan" modal despite being on business. Routing all
// three paths through this setter is the single-mechanism fix (Rule 13) — same class as F116.
window._applySessionUser = function (user) {
  window.CURRENT_USER = user || {};
  if (user && user.plan) {
    currentUserPlan = user.plan;
    const planEl = document.getElementById('sb-user-plan');
    if (planEl) planEl.textContent = user.plan.charAt(0).toUpperCase() + user.plan.slice(1) + ' plan';
    const _navPlan = document.getElementById('nav-plan-badge');
    if (_navPlan) _navPlan.textContent = _planLabel().toUpperCase();
    const _bcb = document.getElementById('biz-currency-badge');
    if (_bcb && /· /.test(_bcb.textContent)) _bcb.textContent = _bcb.textContent.replace(/· .*$/, '· ' + _planLabel());
    if (typeof _updatePricingCTAs === 'function') _updatePricingCTAs();
  }
};
// PL#3: client-side entity cap — MUST mirror the server ENTITY_LIMITS (server.js POST /api/entities).
// The server is the real enforcer (returns 402); this just shows the upgrade modal instead of a
// failed create. business now caps at 5 (was silently unbounded on the client).
// D-A: the limit comes from plans.js (the definition the server enforces) — null means no limit.
function _entityLimitFor(plan){
  if(window.FinFlowPlans) return window.FinFlowPlans.limit(plan, 'entities');
  return 1;   // plans.js not loaded: the most restrictive answer; the server still decides
}
function _entityCapReached(){
  if(typeof ENTITIES === 'undefined') return false;
  const lim = _entityLimitFor(currentUserPlan);
  return lim != null && ENTITIES.length >= lim;
}

// Accessible "Retry" control for the scoped three-state (loading / empty / failed)
// data cards. Returns a REAL <button> — natively focusable and Enter/Space-activatable
// — styled as an inline link, so the failure state doesn't add a new a11y gap.
// `onclick` is a JS expression string invoked in global scope.
window._ffRetryBtn = function(onclick, label){
  return '<button type="button" class="ff-retry" onclick="'+onclick+'">'+(label||'Retry')+'</button>';
};

function showLoginForm(){
  document.getElementById('login-form-panel').style.display='';
  document.getElementById('register-form-panel').style.display='none';
  document.getElementById('forgot-form-panel').style.display='none';
  document.getElementById('login-screen-subtitle').textContent='Sign in to your workspace';
}
function showRegister(){
  document.getElementById('login-form-panel').style.display='none';
  document.getElementById('register-form-panel').style.display='';
  document.getElementById('forgot-form-panel').style.display='none';
  document.getElementById('login-screen-subtitle').textContent='Create your free account';
}
function showForgotPassword(){
  document.getElementById('login-form-panel').style.display='none';
  document.getElementById('register-form-panel').style.display='none';
  document.getElementById('forgot-form-panel').style.display='';
  document.getElementById('login-screen-subtitle').textContent='Password recovery';
}
function _setUserDisplay(u){
  if(!u) return;
  var n=document.getElementById('sb-user-name');
  if(n && u.name) n.textContent=u.name;
  var e=document.getElementById('settings-user-email');
  if(e) e.textContent=u.email||'';
}

async function doLogin(){
  const email = document.getElementById('login-email')?.value?.trim();
  const pw    = document.getElementById('login-pw')?.value;
  const errEl = document.getElementById('login-error');
  if(errEl) errEl.textContent='';
  if(!email||!pw){ if(errEl) errEl.textContent='Email and password required.'; return; }
  const btn = document.getElementById('login-btn');
  if(btn){ btn.disabled=true; btn.textContent='Signing in…'; }
  try{
    const res = await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})});
    const data = await res.json();
    if(!res.ok){
      if(errEl) errEl.textContent=data.error||'Sign-in failed.';
      if(data.code==='SSO_REQUIRED'){ const sb=document.getElementById('sso-btn'); if(sb){ sb.className='btn btn-primary'; sb.focus(); } }   // D-H
      return;
    }
    if(data.today) window._serverToday = data.today; // F116: prime server-truth date on fresh login (mirrors auth/me path)
    const r = 'owner';
    currentRole = r;
    sessionStorage.setItem('ff_role', r);
    applyRole(r);
    document.getElementById('login-screen').style.display='none';
    window.CURRENT_USER = data.user || {};
    _setUserDisplay(data.user);
    injectRoleBadge(r);
    window._applySessionUser(data.user); // F147: shared setter (plan + CURRENT_USER + label)
    notify('Welcome back' + (data.user?.name ? ', '+data.user.name : '') + ' ✴');
    window._ffAuthed = true;
    window.dispatchEvent(new Event('ff:authed'));
    if(typeof bootFinFlowAPI === 'function') bootFinFlowAPI();
    await loadEntitiesFromDB(true); // F50 Step 2: force — explicit login must load fresh, not a stale boot memo
    if(typeof loadBankingFromDB === 'function') await loadBankingFromDB();
  }catch(e){
    if(errEl) errEl.textContent='Network error — is the server running?';
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Sign in →'; }
  }
}

// D-H: single sign-on — find the company's identity provider from the work e-mail and go there. The provider sends the
// person back to /api/auth/sso/callback, which signs them in (or returns here with ?sso_error=… saying why not).
window._ffGo = url => { window.location.assign(url); };
async function ffSsoSignIn(){
  const email = document.getElementById('login-email')?.value?.trim();
  const errEl = document.getElementById('login-error');
  if(errEl) errEl.textContent='';
  if(!email){ if(errEl) errEl.textContent='Enter your work e-mail, then choose single sign-on.'; document.getElementById('login-email')?.focus(); return; }
  try{
    const res = await fetch('/api/auth/sso/start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    const d = await res.json().catch(()=>({}));
    if(!res.ok || !d.url){ if(errEl) errEl.textContent=d.error||'Single sign-on is not available right now.'; return; }
    window._ffGo(d.url);
  }catch(e){ if(errEl) errEl.textContent='Network error — please try again.'; }
}
window.ffSsoSignIn = ffSsoSignIn;
// a failed single sign-on comes back with the reason
(function(){ try { const m = /[?&]sso_error=([^&]*)/.exec(location.search); if(!m) return;
  const show = () => { const el = document.getElementById('login-error'); if(el) el.textContent = 'Single sign-on did not complete: ' + decodeURIComponent(m[1].replace(/\+/g,' ')); };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show(); } catch(_){} })();

async function doRegister(){
  const name  = document.getElementById('reg-name')?.value?.trim();
  const email = document.getElementById('reg-email')?.value?.trim();
  const pw    = document.getElementById('reg-pw')?.value;
  const errEl = document.getElementById('register-error');
  if(errEl) errEl.textContent='';
  if(!email||!pw){ if(errEl) errEl.textContent='Email and password required.'; return; }
  const btn = document.getElementById('register-btn');
  if(btn){ btn.disabled=true; btn.textContent='Creating account…'; }
  try{
    // F10: forward the accountant referral code (from /register?ref=CODE → /app?...&ref=CODE)
    // so the backend links this signup to the referring accountant. Same URL-read
    // pattern as `plan` below. Omitted when absent so nothing changes for normal signups.
    const ref = new URLSearchParams(window.location.search).get('ref');
    const res = await fetch('/api/auth/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password:pw,referralCode:ref||undefined})});
    const data = await res.json();
    if(!res.ok){ if(errEl) errEl.textContent=data.error||'Registration failed.'; return; }
    if(data.today) window._serverToday = data.today; // L30 (F116): a new account's first session needs it too (date defaults, F115)
    const plan = new URLSearchParams(window.location.search).get('plan');
    if(plan && (plan==='pro'||plan==='business')){
      try{
        const sr = await fetch('/api/stripe/checkout',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan})});
        const sd = await sr.json();
        if(sd.url){ window.location.href = sd.url; return; }
      }catch(e){}
    }
    const r = 'owner';
    currentRole = r;
    sessionStorage.setItem('ff_role', r);
    applyRole(r);
    document.getElementById('login-screen').style.display='none';
    window.CURRENT_USER = data.user || {};
    _setUserDisplay(data.user);
    injectRoleBadge(r);
    window._applySessionUser(data.user); // F147: shared setter (plan + CURRENT_USER + label)
    notify('Account created ✴ Welcome to FinFlow!');
    window._ffAuthed = true;
    window.dispatchEvent(new Event('ff:authed'));
    if(typeof bootFinFlowAPI === 'function') bootFinFlowAPI();
    await loadEntitiesFromDB(true); // F50 Step 2: force — a just-registered account must load fresh, not a stale boot memo
    if(typeof loadBankingFromDB === 'function') await loadBankingFromDB();
  }catch(e){
    if(errEl) errEl.textContent='Network error — is the server running?';
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Create account →'; }
  }
}

async function doForgotPassword(){
  const email = document.getElementById('forgot-email')?.value?.trim();
  const msgEl = document.getElementById('forgot-msg');
  const btn   = document.getElementById('forgot-btn');
  if(!email){ if(msgEl){ msgEl.style.color='var(--red,#e05454)'; msgEl.textContent='Email required.'; } return; }
  if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
  try{
    await fetch('/api/auth/forgot-password',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    if(msgEl){ msgEl.style.color='var(--green)'; msgEl.textContent='If that email exists, a reset link is on its way.'; }
  }catch(e){
    if(msgEl){ msgEl.style.color='var(--red,#e05454)'; msgEl.textContent='Network error. Try again.'; }
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Send reset link →'; }
  }
}

window.logoutUser = async function(){
  try{ await fetch('/api/auth/logout',{method:'POST',credentials:'include'}); }catch(e){}
  window.location.href='/';
};

function applyRole(role){
  const allowed = ROLES[role].nav;
  if(!allowed) return; // owner sees everything
  // Hide nav items not in allowed list
  document.querySelectorAll('.nav-item[onclick*="showPage"],.nav-group-header').forEach(el=>{
    const match = (el.getAttribute('onclick')||'').match(/showPage\('([^']+)'/);
    if(!match) return;
    const page = match[1];
    el.style.display = allowed.some(a=>page.startsWith(a.split('-')[0]))||allowed.includes(page) ? '' : 'none';
  });
  // Hide payroll salary details from accountant
  if(role === 'accountant'){
    document.querySelectorAll('#payroll-list .payroll-gross, #payroll-list .payroll-net').forEach(el=>el.textContent='••••');
  }
}

function injectRoleBadge(role){
  const existing = document.getElementById('role-badge');
  if(existing) existing.remove();
  const badge = document.createElement('div');
  badge.id = 'role-badge';
  badge.style.cssText = `
    display:inline-flex;align-items:center;gap:6px;padding:4px 10px;
    border-radius:20px;border:1px solid ${ROLES[role]?.color||'#888'};
    background:rgba(0,0,0,.2);font-size:11px;color:${ROLES[role]?.color||'#888'};
    font-weight:500;cursor:pointer;margin-right:4px;
  `;
  badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${ROLES[role]?.color||'#888'}"></span>${ROLES[role]?.label||role} <span style="opacity:.5;font-size:10px">▾</span>`;
  badge.title = 'Click to switch role';
  badge.onclick = () => {
    document.getElementById('login-screen').style.display = 'flex';
    // reset role radio to current
    const radio = document.querySelector(`input[name="login-role"][value="${currentRole}"]`);
    if(radio) radio.checked = true;
  };
  const tr = document.querySelector('.topbar-right');
  if(tr) tr.insertBefore(badge, tr.firstChild);
}

// ════════════════════════════════════════════
// ② PERSISTENCE — DB-only, no localStorage
// ════════════════════════════════════════════
// All data lives in PostgreSQL. lsSave/lsLoad are no-ops so any legacy
// call sites do nothing. persistAll/loadPersistedData are also no-ops.
function lsSave(){}
function lsLoad(key, fallback){ return fallback; }
function persistAfter(origFn){ return origFn; }
function persistAll(){}
function loadPersistedData(){}

// CSV export — page-aware, exports the data from whichever page is currently active
// xlsx export — writes the SAME rows the CSV export builds as a real .xlsx, via lazy-loaded
// SheetJS (vendored at /vendor/xlsx.mini.min.js, same-origin). Loaded only on first xlsx export.
window._ffLoadXlsx = function(cb){
  if (window.XLSX) { cb(); return; }
  if (window._xlsxLoading) { (window._xlsxQ = window._xlsxQ || []).push(cb); return; }
  window._xlsxLoading = true; window._xlsxQ = [cb];
  var s = document.createElement('script');
  s.src = '/vendor/xlsx.mini.min.js';
  s.onload = function(){ (window._xlsxQ || []).forEach(function(fn){ try{ fn(); }catch(e){} }); window._xlsxQ = []; };
  s.onerror = function(){ window._xlsxLoading = false; if (typeof notify === 'function') notify('Could not load the spreadsheet exporter.', true); };
  document.head.appendChild(s);
};
window._ffExportXlsx = function(rows, filename){
  window._ffLoadXlsx(function(){
    try{
      var X = window.XLSX;
      var ws = X.utils.aoa_to_sheet(rows);
      var wb = X.utils.book_new();
      var base = String(filename || 'Sheet').replace('.csv', '') || 'Sheet';
      X.utils.book_append_sheet(wb, ws, base.slice(0, 31));
      var outName = String(filename || 'export.csv').replace('.csv', '.xlsx');
      X.writeFile(wb, outName);
      if (typeof notify === 'function') notify('Exported ' + outName);
    }catch(e){ if (typeof notify === 'function') notify('XLSX export failed: ' + (e && e.message || e), true); }
  });
};
// PDF export — a REAL downloadable .pdf (not just print-to-PDF). Lazy-loads the vendored jsPDF +
// autotable (self-hosted at /vendor, same-origin → CSP unchanged) on first use, then renders the SAME
// page-aware rows the CSV/XLSX export builds as a titled table and triggers a file download via doc.save.
window._ffLoadPdfLib = function(cb){
  var ready = function(){ return window.jspdf && window.jspdf.jsPDF; };
  if (ready()) { cb(); return; }
  if (window._pdfLoading) { (window._pdfQ = window._pdfQ || []).push(cb); return; }
  window._pdfLoading = true; window._pdfQ = [cb];
  var load = function(src, next){ var s = document.createElement('script'); s.src = src; s.onload = next; s.onerror = function(){ window._pdfLoading = false; if (typeof notify === 'function') notify('Could not load the PDF exporter.', true); }; document.head.appendChild(s); };
  // autotable augments the jsPDF prototype, so it MUST load after jsPDF itself.
  load('/vendor/jspdf.umd.min.js', function(){
    load('/vendor/jspdf.plugin.autotable.min.js', function(){
      (window._pdfQ || []).forEach(function(fn){ try{ fn(); }catch(e){} }); window._pdfQ = [];
    });
  });
};
// C15: `more` (optional) = further [{ title, rows }] tables printed below the first — a report with a statement and a
// month-by-month table exports both.
window._ffExportPdf = function(rows, filename, title, more){
  window._ffLoadPdfLib(function(){
    try{
      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      var head = (rows && rows.length) ? [rows[0]] : [[]];
      var body = (rows && rows.length) ? rows.slice(1) : [];
      var ttl = title || String(filename || 'Report').replace(/\.(csv|pdf)$/, '');
      doc.setFontSize(16); doc.text(String(ttl), 40, 40);
      doc.setFontSize(9); doc.setTextColor(120);
      doc.text('FinFlow · ' + new Date().toLocaleDateString(), 40, 56);
      var _tblOpts = { styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: [201,168,76], textColor: 20 }, alternateRowStyles: { fillColor: [245,242,235] }, margin: { left: 40, right: 40 } };
      doc.autoTable(Object.assign({ head: head, body: body, startY: 72 }, _tblOpts));
      (more || []).forEach(function(sec){
        if (!sec || !sec.rows || !sec.rows.length) return;
        var y = ((doc.lastAutoTable && doc.lastAutoTable.finalY) || 72) + 26;
        doc.setFontSize(11); doc.setTextColor(40); doc.text(String(sec.title || ''), 40, y);
        doc.autoTable(Object.assign({ head: [sec.rows[0]], body: sec.rows.slice(1), startY: y + 8 }, _tblOpts));
      });
      var outName = String(filename || 'export.pdf').replace(/\.(csv|xlsx)$/, '.pdf');
      if (!/\.pdf$/.test(outName)) outName += '.pdf';
      doc.save(outName);
      if (typeof notify === 'function') notify('Exported ' + outName + ' ✦');
    }catch(e){ if (typeof notify === 'function') notify('PDF export failed: ' + (e && e.message || e), true); }
  });
};
window.exportAllCSV = function(format){
  // C15: with a report open, Export exports THAT report (its own figures), not the page behind it.
  const _rm = document.getElementById('report-gen-modal');
  if (_rm && !_rm.classList.contains('hidden') && typeof window._rptExport === 'function') return window._rptExport(String(format) === 'pdf' ? 'pdf' : 'csv');
  const activePage = Array.from(document.querySelectorAll('.page'))
    .find(el => el.classList.contains('active') || (el.style.display && el.style.display !== 'none'))?.id || '';

  let rows = [], filename = 'finflow-export.csv';

  // L16: exports read the SERVER rows the pages render (ISO calendar dates, with the year — the old
  // display labels "Aug 5" lost it) and the globals the page loaders actually assign. Several read names
  // nothing ever set (allVendors, allBills, _quotes/allQuotes, userItems/allItems) and so always said
  // "No data to export." with rows on screen.
  const _ymd = v => (window.FinFlowDates && window.FinFlowDates._toYmd(v)) || (v || '');
  if (activePage.includes('invoice')) {
    const inv = window._realInvoices || window.userInvoices || [];
    rows = [['Client','Amount','Paid','Credits applied','Status','Issue Date','Due Date','Notes'],   // FA-M6b: cash paid and credit applied apart
      ...inv.map(i => [i.client||'', Number(i.amount||0).toFixed(2), (Number(i.amount_paid||0) - Number(i.credit_applied||0)).toFixed(2), Number(i.credit_applied||0).toFixed(2), i.status||'', _ymd(i.issue_date||i.created_at), _ymd(i.due_date||i.due), i.notes||''])];
    filename = 'invoices.csv';
  } else if (activePage.includes('expense')) {
    const exp = window._realExpenses || window.bizExpenses || bizExpenses || [];
    // L16: 'no' is a truthy STRING — `(ded||deductible) ? 'Yes' : 'No'` exported every expense as deductible.
    const _dedLabel = e => { const f = window.FinFlowDates.deductibleFactor(e.deductible != null ? e.deductible : e.ded);   // M15
      return f === 1 ? 'Yes' : f === 0.5 ? 'Half (50%)' : 'No'; };
    rows = [['Description','Category','Amount','Date','Tax Deductible'],
      ...exp.map(e => [e.description||e.desc||'', e.category||e.cat||'', Number(e.amount||0).toFixed(2), _ymd(e.expense_date||e.date), _dedLabel(e)])];
    filename = 'expenses.csv';
  } else if (activePage.includes('payroll')) {
    const emps = [...(window.ownerPayroll ? [{...window.ownerPayroll, isOwner:true}] : []), ...(window.payrollEmployees||[])];
    rows = [['Name','Role','Type','Gross','Deductions','Net Pay'],
      ...emps.map(e => [(e.fname||'')+' '+(e.lname||''), e.role||'', e.type||e.emp_type||'', Number(e.gross||0).toFixed(2), dedTotal(e.gross, e.deductions).toFixed(2), netFromDeductions(e.gross, e.deductions)])];
    filename = 'payroll.csv';
  } else if (activePage.includes('customer')) {
    const custs = window.customers || customers || [];
    rows = [['First Name','Last Name','Company','Email','Phone','Revenue','Status'],
      ...custs.map(c => [c.fname||'', c.lname||'', c.company||'', c.email||'', c.phone||'', Number(c.revenue||0).toFixed(2), c.status||''])];
    filename = 'customers.csv';
  } else if (activePage.includes('inventor')) {
    const inv = window.inventory || inventory || [];
    rows = [['Product','SKU','Units','Max Units','Cost','Stock Status'],
      ...inv.map(i => [i.name||'', i.sku||'', i.units||0, i.max||i.max_units||0, Number(i.cost||0).toFixed(2), i.low?'Low Stock':'OK'])];
    filename = 'inventory.csv';
  } else if (activePage.includes('item')) {
    const items = window.items || window.itemsData || [];
    rows = [['Name','Type','Price','Status'],
      ...items.map(i => [i.name||'', i.type||'', Number(i.price||i.rate||0).toFixed(2), i.status||''])];
    filename = 'items.csv';
  } else if (activePage.includes('vendor')) {
    // L16: owing / YTD paid are the computed vendor figures the Vendors page shows (20861a9), not a typed balance.
    const vendors = window.vendors || [];
    rows = [['Vendor','Category','Contact','Owing','YTD Paid'],
      ...vendors.map(v => [v.name||'', v.category||'', v.contact||'', Number(v.owing||0).toFixed(2), Number(v.ytd_paid||0).toFixed(2)])];
    filename = 'vendors.csv';
  } else if (activePage.includes('quote')) {
    const quotes = window.quotes || [];
    rows = [['Client','Amount','Status','Valid Until','Notes'],
      ...quotes.map(q => [q.client||'', Number(q.amount||0).toFixed(2), q.status||'', _ymd(q.expiry_date||q.valid_until), q.notes||''])];
    filename = 'quotes.csv';
  } else if (activePage.includes('bill')) {
    const bills = window.bills || [];
    rows = [['Vendor','Bill #','Amount','Paid','Credits applied','Balance','Status','Issue Date','Due Date'],
      ...bills.map(b => { const a = Number(b.amount||0), pd = Number(b.amount_paid||0), cr = Number(b.credit_applied||0);
        return [b.vendor||b.vendor_name||'', b.num||'', a.toFixed(2), (pd - cr).toFixed(2), cr.toFixed(2), Math.max(0, a - pd).toFixed(2), b.status||'', _ymd(b.issue_date||b.created_at), _ymd(b.due_date)]; })];
    filename = 'bills.csv';
  } else {
    // Generic — scrape the visible table
    const activePg = document.querySelector('.page.active') || document.querySelector('[id="'+activePage+'"]');
    const table = activePg?.querySelector('table, .data-table');
    if (table) {
      rows = Array.from(table.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('th,td')).map(td => td.textContent.trim()));
      filename = (activePage.replace('page-','') || 'export') + '.csv';
    } else {
      notify(activePage.includes('report') ? 'Open a report (Generate ↗), then export it with its CSV or PDF button.' : 'Nothing to export on this page.', true);   // C15
      return;
    }
  }

  if (rows.length <= 1) { notify('No data to export.', true); return; }
  if (String(format) === 'xlsx') { return window._ffExportXlsx(rows, filename); }
  if (String(format) === 'pdf')  { var _t = String(filename||'Report').replace(/\.csv$/,''); return window._ffExportPdf(rows, _t + '.pdf', _t.charAt(0).toUpperCase() + _t.slice(1)); }
  window._ffDownloadCsv(rows, filename);
};
// C15: the one CSV writer (page exports and report exports). UTF-8 with a BOM so Excel reads accents/currency signs.
window._ffDownloadCsv = function(rows, filename){
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"';
  const csv = rows.map(r => r.map(q).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href:url, download:filename});
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  notify('Exported ' + filename + ' ✦');
};

window.exportAuditCSV = async function(){
  try {
    const res = await fetch('/api/audit-log?limit=10000', {credentials:'include'});
    if (!res.ok) { notify('Could not load audit log.', true); return; }
    const data = await res.json();
    const entries = Array.isArray(data) ? data : (data.rows || []);
    if (!entries.length) { notify('No audit entries to export.', true); return; }
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"';
    const rows = [['TIMESTAMP','ACTION','TABLE','RECORD ID'],
      ...entries.map(e => [e.created_at||'', e.action||'', e.table_name||'', e.record_id||''])];
    const csv = rows.map(r => r.map(q).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const filename = 'finflow-audit-' + todayLocal() + '.csv';
    const a = Object.assign(document.createElement('a'), {href:url, download:filename});
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    notify('Exported ' + filename + ' ✦');
  } catch(e) { notify('Export failed: ' + e.message, true); }
};

// ════════════════════════════════════════════
// ③ BANK RECONCILIATION ENGINE
// ════════════════════════════════════════════
// B7b / G2 (2026-10-23): a finished reconciliation is SAVED on the server (it used to live in this page's memory only and
// vanished on reload). A line a saved reconciliation cleared comes back ticked and LOCKED (t._reconId) — it counts toward
// the cleared total like any ticked line, and cannot be unticked or deleted until that reconciliation is undone.
function openReconcileModal(){
  // Build transaction list
  const list = document.getElementById('recon-txn-list');
  list.innerHTML = bankTxns.map((t,i)=>{
    const locked = t._reconId != null;
    return `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--bd);cursor:${locked?'default':'pointer'};transition:background .1s${locked?';opacity:.75':''}" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
      <input type="checkbox" data-idx="${i}"${t._dbId!=null?` data-id="${t._dbId}"`:''} style="accent-color:var(--acc);flex-shrink:0"
        ${locked?'checked disabled':''} onchange="updateReconSummary()">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--t1);font-weight:500">${esc(t.desc||'')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(t.cat||'')} · ${esc(t.date||'')}${locked?' · 🔒 reconciled':''}</div>
      </div>
      <span style="font-family:var(--font-mono);font-size:13px;font-weight:600;flex-shrink:0;color:${t.type==='credit'?'var(--green)':'var(--red)'}">
        ${t.type==='credit'?'+':'-'}${S(t.amount)}
      </span>
    </label>`; }).join('');
  const _sd = document.getElementById('recon-stmt-date');
  if(_sd && !_sd.value) _sd.value = _entityToday();   // the business's today, never the viewer's clock (Rule 10)
  updateReconSummary();
  document.getElementById('reconcile-modal').classList.remove('hidden');
}

// LR16: amounts are SIGNED (money in +, money out −) — every line used to be added as a positive amount. Book balance =
// the business's bank lines in FinFlow; the statement is reconciled against the lines TICKED as on the statement
// (difference = statement balance − ticked lines). It was "book − ticked", the wrong way round, and never shown.
const _reconSigned = t => (t.type === 'credit' ? 1 : -1) * Math.abs(parseFloat(t.amount) || 0);
function updateReconSummary(){
  const stmtBal = parseFloat(document.getElementById('recon-stmt-bal').value) || 0;
  const _txs = (typeof bankTxns!=='undefined'?bankTxns:window.bankTxns||[]);
  const bookBal = Math.round(_txs.reduce((s,t)=>s+_reconSigned(t),0)*100)/100;
  const checked = [...document.querySelectorAll('#recon-txn-list input[type=checkbox]:checked')];
  const clearedSum = Math.round(checked.reduce((sum, cb)=>sum + _reconSigned(_txs[parseInt(cb.dataset.idx)]||{}), 0)*100)/100;
  const _bb = document.getElementById('recon-book-bal');
  if(_bb) _bb.textContent = (bookBal < 0 ? '-' : '') + _nativeSymbol() + Math.abs(bookBal).toFixed(2);
  const diff = Math.round((stmtBal - clearedSum)*100)/100;
  const diffEl = document.getElementById('recon-diff');
  const statusEl = document.getElementById('recon-status');
  // L29: the entity's symbol (was a literal '$'), and a NEGATIVE difference keeps its minus sign (it printed unsigned).
  diffEl.textContent = (diff === 0 ? _nativeSymbol() + '0.00' : (diff > 0 ? '+' : '-') + _nativeSymbol() + Math.abs(diff).toFixed(2));
  diffEl.style.color = diff === 0 ? 'var(--green)' : 'var(--amber)';
  if(diff === 0 && stmtBal > 0){
    statusEl.innerHTML = '<span class="badge b-green">✓ Balanced</span>';
  } else if(stmtBal > 0){
    statusEl.innerHTML = `<span class="badge b-amber">${checked.length} cleared</span>`;
  } else {
    statusEl.innerHTML = '';
  }
  // LR16: the business's own name — was a hard-coded "Main Checking ****4821".
  const _rEnt = (window.ENTITIES || []).find(e => e && e.active);
  document.getElementById('recon-sub').textContent =
    `${(_rEnt && _rEnt.name) || 'This business'} · bank lines · ${checked.length} of ${_txs.length} ticked as on the statement`;
}

// B7b: undo the LATEST saved reconciliation (the server refuses an older one) — its lines unlock; the record stays, marked undone.
window.ffUndoReconciliation = async function(id){
  const ok = (typeof window._confirmModal==='function') ? await window._confirmModal('Undo this reconciliation? Its lines will be unlocked and can be ticked again. The record stays in the report, marked undone.', {okText:'Undo reconciliation'}) : true;
  if(!ok) return;
  try{
    const res = await fetch('/api/bank-reconciliation/statements/'+id+'/undo',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});
    const d = await res.json().catch(()=>({}));
    if(!res.ok){ notify(d.error || 'Could not undo the reconciliation', true); return; }
    notify('Reconciliation undone — its lines are unlocked.');
    if(typeof loadBankingFromDB==='function') await loadBankingFromDB();
    if(typeof window.generateReport==='function') window.generateReport('Bank Reconciliation');
  } catch(e){ notify('Could not undo the reconciliation — check your connection and try again', true); }
};
let _reconSaving = false, _reconToken = null;
async function finishReconciliation(){
  if(_reconSaving) return;
  const diffTxt = (document.getElementById('recon-diff')||{}).textContent || '';
  const diff = parseFloat(diffTxt.replace(/[^0-9.-]/g,''));
  if(isNaN(diff) || Math.abs(diff) > 0.01){
    // G2: says how far off it is, in the business's currency (it printed a literal "$0.00").
    notify('The difference is '+(isNaN(diff)?'not worked out yet':diffTxt.trim())+' — tick or untick lines until it is '+_nativeSymbol()+'0.00 to finish.', true); return;
  }
  const fresh = [...document.querySelectorAll('#recon-txn-list input[type=checkbox]:checked:not(:disabled)')];
  const lineIds = fresh.map(cb => parseInt(cb.dataset.id,10)).filter(n => Number.isInteger(n));
  const stmtDate = (document.getElementById('recon-stmt-date')||{}).value || _entityToday();
  if(!_reconToken) _reconToken = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random());   // one save per intent (Rule 9)
  _reconSaving = true;
  try{
    const res = await fetch('/api/bank-reconciliation/statements',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ statement_date: stmtDate, statement_balance: parseFloat(document.getElementById('recon-stmt-bal').value), line_ids: lineIds, idempotency_key: _reconToken })});
    const d = await res.json().catch(()=>({}));
    if(!res.ok){ notify(d.error || 'Could not save the reconciliation', true); if(res.status!==409) _reconToken = null; return; }
    _reconToken = null;
    closeModal('reconcile-modal');
    const _rEnt = (window.ENTITIES || []).find(e => e && e.active);
    const _n = lineIds.length;
    notify('Reconciliation saved — '+((_rEnt && _rEnt.name) || 'this business')+' · statement '+(window.FinFlowDates?window.FinFlowDates.fmtLabel(stmtDate,{year:true}):stmtDate)
      +' · '+_n+' line'+(_n===1?'':'s')+' cleared and locked. It is in Reports → Bank Reconciliation.');
    const _sd = document.getElementById('recon-stmt-date'); if(_sd) _sd.value = '';
    if(typeof loadBankingFromDB==='function') await loadBankingFromDB();
  } catch(e){ notify('Could not save the reconciliation — check your connection and try again', true); }
  finally{ _reconSaving = false; }
}

// ════════════════════════════════════════════
// ④ DOUBLE-ENTRY JOURNAL WITH LIVE COA
// ════════════════════════════════════════════
let journalEntries = []; // loaded from API by renderJournalsLive()
// FA-M7: ONE chart of accounts per business — GET /api/chart (journal-chart.js). The picker offers exactly what the
// Chart of Accounts page shows; each line carries the account's `acct` and posts to THAT account. (The fixed 16-account
// template that lived here posted every line to a separate "Journal 5000" account.)
window._jeChart = window._jeChart || null;
async function _loadJournalChart(){
  try{ const r=await fetch('/api/chart',{credentials:'include'}); const j=r.ok?await r.json():null; window._jeChart=(j&&Array.isArray(j.accounts))?j.accounts:[]; }
  catch(e){ window._jeChart=[]; }
  if(document.getElementById('je-lines')) renderJELines();
}

function openJournalEntryModal(){
  // Restore lines to 2 blank rows
  window._jeLines = [{acct:'',dr:0,cr:0},{acct:'',dr:0,cr:0}];
  window._jeChart = null;
  renderJELines();
  _loadJournalChart();
  document.getElementById('je-date').value = todayLocal();
  document.getElementById('je-notes').value = '';
  updateJETotals();
  window._jeIdemKey = null;   // C1 Wave 1: fresh submit-intent → a genuine new journal entry never reuses the last token
  document.getElementById('journal-entry-modal').classList.remove('hidden');
}

function renderJELines(){
  const container = document.getElementById('je-lines');
  container.innerHTML = window._jeLines.map((line,i)=>`
    <div style="display:grid;grid-template-columns:1fr 90px 90px 28px;gap:6px;margin-bottom:5px" id="je-line-${i}">
      <select class="finput" style="font-size:12px" onchange="jeLineChange(${i},'acct',this.value)" aria-label="Account">
        ${_jeAccountOptions(line.acct)}
      </select>
      <input class="finput" type="number" placeholder="0.00" style="font-size:12px" value="${line.dr||''}"
        oninput="jeLineChange(${i},'dr',parseFloat(this.value)||0)" min="0">
      <input class="finput" type="number" placeholder="0.00" style="font-size:12px" value="${line.cr||''}"
        oninput="jeLineChange(${i},'cr',parseFloat(this.value)||0)" min="0">
      <button class="btn btn-ghost btn-sm" style="padding:4px;font-size:16px;line-height:1" onclick="removeJELine(${i})" ${window._jeLines.length<=2?'disabled':''}>×</button>
    </div>`).join('');
}

function _jeAccountOptions(sel){
  const ch=window._jeChart;
  if(ch==null) return '<option value="">Loading your chart of accounts…</option>';
  const usable=ch.filter(a=>a.journal);
  if(!usable.length) return '<option value="">No accounts — add one on the Chart of Accounts page</option>';
  const groups={}; usable.forEach(a=>{(groups[a.category]=groups[a.category]||[]).push(a);});
  return '<option value="">— Select account —</option>'+Object.entries(groups).map(([g,accs])=>'<optgroup label="'+esc(g)+'">'
    +accs.map(a=>'<option value="'+esc(a.acct)+'"'+(sel===a.acct?' selected':'')+'>'+esc(a.code)+' '+esc(a.name)+(a.kind==='older'?' (older journal account)':'')+'</option>').join('')+'</optgroup>').join('');
}
function jeLineChange(idx, field, val){
  window._jeLines[idx][field] = val;
  updateJETotals();
}
function addJELine(){
  window._jeLines.push({acct:'',dr:0,cr:0});
  renderJELines();
  updateJETotals();
}
function removeJELine(idx){
  if(window._jeLines.length <= 2) return;
  window._jeLines.splice(idx,1);
  renderJELines();
  updateJETotals();
}

function updateJETotals(){
  const lines = window._jeLines;
  const totalDr = lines.reduce((s,l)=>s+(l.dr||0),0);
  const totalCr = lines.reduce((s,l)=>s+(l.cr||0),0);
  document.getElementById('je-total-dr').textContent = _nativeSymbol()+totalDr.toLocaleString(undefined,{minimumFractionDigits:2});  // F129: entity symbol, not literal $
  document.getElementById('je-total-cr').textContent = _nativeSymbol()+totalCr.toLocaleString(undefined,{minimumFractionDigits:2});  // F129
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0;
  const balEl = document.getElementById('je-balanced');
  balEl.textContent = balanced ? '✓ Balanced' : 'Not balanced';
  balEl.style.color = balanced ? 'var(--green)' : 'var(--amber)';
  document.getElementById('je-post-btn').disabled = !balanced;
}

function saveJournalEntry(status){
  const lines = window._jeLines.filter(l=>l.code && (l.dr>0||l.cr>0));
  if(lines.length < 2){ notify('Add at least 2 lines','error'); return; }
  const totalDr = lines.reduce((s,l)=>s+(l.dr||0),0);
  const totalCr = lines.reduce((s,l)=>s+(l.cr||0),0);
  if(status==='Posted' && Math.abs(totalDr-totalCr)>0.01){
    notify('Debits must equal credits to post','error'); return;
  }
  const ref = 'JE-' + String(journalEntries.length + 43).padStart(4,'0');
  const entry = {
    date: document.getElementById('je-date').value,
    notes: document.getElementById('je-notes').value || 'Manual journal entry',
    ref,
    debit: totalDr,
    credit: totalCr,
    status,
    lines,
  };
  journalEntries.unshift(entry);
  renderJournals();
  renderCOA(); // refresh balances
  closeModal('journal-entry-modal');
  notify(`Journal entry ${ref} ${status.toLowerCase()}`);
}

// ════════════════════════════════════════════
// PATCH renderJournals to include live entries
// ════════════════════════════════════════════
const _origRenderJournals = renderJournals;

// ════════════════════════════════════════════
// PATCH renderCOA to use live balances
// ════════════════════════════════════════════

async function renderCOALive(){
  const l=document.getElementById('coa-list');if(!l)return;
  try{
    // FA-M7: the ONE chart (/api/chart) — built-in accounts, the business's own, and older journal accounts, each with
    // its ledger balance (all-time, natural side). The journal pickers read the same list.
    const res=await fetch('/api/chart',{credentials:'include'});
    if(!res.ok) throw new Error();
    const accounts=((await res.json())||{}).accounts||[];
    window._jeChart=accounts;
    const sum=t=>accounts.filter(a=>a.type===t).reduce((s,a)=>s+(parseFloat(a.balance)||0),0);
    const assets=sum('asset'), liabs=sum('liability');
    const S = n=>(n<0?'-':'')+_nativeSymbol()+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});   // F129: entity symbol
    const setEl = (id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    setEl('coa-count', accounts.length);
    setEl('coa-assets', S(assets));
    setEl('coa-liabs',  S(liabs));
    setEl('coa-equity', S(assets - liabs));
    if(!accounts.length){ l.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">No accounts yet.</div>'; return; }
    const grouped={};
    accounts.forEach(a=>{(grouped[a.category]=grouped[a.category]||[]).push(a);});
    const tag=a=>a.kind==='own'?'<span style="font-size:10px;color:var(--t3);margin-left:6px">yours</span>'
      :a.kind==='older'?'<span style="font-size:10px;color:var(--t3);margin-left:6px">older journal account</span>'
      :(!a.journal?'<span style="font-size:10px;color:var(--t3);margin-left:6px" title="'+esc(a.why||'')+'">from its documents</span>':'');
    l.innerHTML=Object.entries(grouped).map(([type,accs])=>`
      <div style="margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;color:var(--acc);text-transform:uppercase;letter-spacing:.1em;padding:.5rem 0;border-bottom:1px solid var(--bd)">${esc(type)}</div>
        ${accs.map(a=>`
        <div class="coa-row" style="display:grid;grid-template-columns:60px 1fr 90px 70px;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="color:var(--t3);font-family:var(--font-mono)">${esc(a.code||'')}</span>
          <span style="color:var(--t1)">${esc(a.name||'')}${tag(a)}</span>
          <span style="font-family:var(--font-mono);text-align:right;color:var(--t1)">${_fmtMoneyNative(a.balance||0)}</span>
          <span style="color:var(--t3);text-align:right">${a.normal==='debit'?'Debit':'Credit'}</span>
        </div>`).join('')}
      </div>`).join('');
  }catch(e){
    l.innerHTML='<div style="padding:2rem;text-align:center;color:var(--t3)">Could not load the chart of accounts. Please refresh.</div>';
  }
}

async function renderJournalsLive(){
  const l=document.getElementById('journals-list');if(!l)return;
  l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Loading…</div>';
  try{
    const res=await fetch('/api/journals',{credentials:'include'});
    if(!res.ok)throw new Error();
    const journals=await res.json();

    // Update KPI cards with real data
    const S = n=>_nativeSymbol()+n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});   // F129: entity symbol, not literal $ (journal amounts are entity-currency)
    const setEl = (id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    // L5: the Debits/Credits cards are labelled "This month" — this calendar month's entries only.
    const _jMonth = journals.filter(j=> typeof window._inThisMonth==='function' ? window._inThisMonth(j.date) : true);
    const totalDebits  = _jMonth.reduce((s,j)=>s+(parseFloat(j.debit)||0),0);
    const totalCredits = _jMonth.reduce((s,j)=>s+(parseFloat(j.credit)||0),0);
    const draftCount   = journals.filter(j=>j.status!=='Posted').length;
    setEl('jnl-count',   journals.length);
    setEl('jnl-debits',  S(totalDebits));
    setEl('jnl-credits', S(totalCredits));
    setEl('jnl-drafts',  draftCount);
    const balEl = document.getElementById('jnl-balance-label');
    if(balEl) balEl.textContent = Math.abs(totalDebits-totalCredits)<0.01 ? 'Balanced' : 'Unbalanced';

    if(!journals.length){l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">No journal entries yet.</div>';return;}
    l.innerHTML=journals.map(j=>`
      <div class="table-row" style="grid-template-columns:90px 1fr 80px 80px 80px 70px">
        <span style="color:var(--t3)">${esc(j.date||'')}</span>
        <span style="font-weight:500">${esc(j.notes||j.description||'')}</span>
        <span style="color:var(--t3)">${esc(j.ref||'')}</span>
        <span style="font-family:var(--font-mono);color:var(--red)">${_nativeSymbol()}${(j.debit||0).toLocaleString()}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${_nativeSymbol()}${(j.credit||0).toLocaleString()}</span>
        <span><span class="badge ${(j.status||'Draft')==='Posted'?'b-green':'b-amber'}">${esc(j.status||'Draft')}</span></span>
      </div>`).join('');
  }catch(e){
    const allEntries=[...journalEntries,...journalsData.map(j=>({...j,lines:null}))];
    l.innerHTML=allEntries.map(j=>`
      <div class="table-row" style="grid-template-columns:90px 1fr 80px 80px 80px 70px">
        <span style="color:var(--t3)">${esc(j.date||'')}</span><span style="font-weight:500">${esc(j.notes||'')}</span>
        <span style="color:var(--t3)">${esc(j.ref||'')}</span>
        <span style="font-family:var(--font-mono);color:var(--red)">${_nativeSymbol()}${(j.debit||0).toLocaleString()}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${_nativeSymbol()}${(j.credit||0).toLocaleString()}</span>
        <span><span class="badge ${j.status==='Posted'?'b-green':'b-amber'}">${j.status}</span></span>
      </div>`).join('');
  }
}

// Override the static render functions with live ones
window.renderCOA = renderCOALive;
window.renderJournals = renderJournalsLive;

// ════════════════════════════════════════════
// INIT — run after DOM is ready
// ════════════════════════════════════════════
function initEnhancements(){
  loadPersistedData();
  // Init business switcher
  const activeBiz = businesses.find(b=>b.id===activeBizId) || businesses[0];
  if(activeBiz){
    document.getElementById('sb-brand-name').textContent = activeBiz.name;
    document.getElementById('biz-currency-badge').textContent = `${activeBiz.currency} · ${_planLabel()}`;
    activeCurrency = activeBiz.displayCurrency || activeBiz.currency;
    currencySymbol = CURRENCIES[activeCurrency]?.symbol || '$';
    document.getElementById('currency-flag').textContent  = CURRENCIES[activeCurrency]?.flag || '🇺🇸';
    document.getElementById('currency-code-label').textContent = activeCurrency;
  }
  // Patch S() to apply FX
  patchSFormatter();
  // F57/D3: cache the cash-flow rows at BOOT so the dashboard cash card never depends on the
  // Cash Flow report having been opened first. Fire-and-forget; it repaints when it resolves.
  _loadCashMonthly();
  // F64: "Show cents" was read only by the ORIGINAL S(), which patchSFormatter overwrites — the
  // toggle rendered nothing. _fmtMoneyExact reads it live, but nothing re-rendered on change.
  document.getElementById('s-cents')?.addEventListener('change', ()=>{ try{ if(typeof updateDashboard==='function') updateDashboard(); if(typeof renderInvoices==='function') renderInvoices(); }catch(_){} });
  // Style login radio labels on change
  document.querySelectorAll('input[name="login-role"]').forEach(radio=>{
    radio.addEventListener('change',()=>{
      document.querySelectorAll('input[name="login-role"]').forEach(r=>{
        r.closest('label').style.borderColor = r.checked ? 'var(--acc)' : 'var(--bd)';
      });
    });
  });
  // Pre-highlight checked
  const checked = document.querySelector('input[name="login-role"]:checked');
  if(checked) checked.closest('label').style.borderColor = 'var(--acc)';
  // Always verify server session before firing ff:authed — avoids 401 race
  // when sessionStorage has ff_role but the cookie has expired server-side.
  // LA2 (live audit 2026-10-13): /api/me starts now, but its answer is ACTED ON only once the document is fully
  // parsed (DOMContentLoaded). On a real network /api/me answers while the parser is still waiting on the production
  // build's blocking /_gen scripts — before the lazy-screen hook (end of <body>) and the deferred bundle exist — and
  // everything listening to ff:authed ran against a half-built page: the boot render hooks threw "Cannot set
  // properties of null" (7 per live boot) and ran the SHADOWED app-main copies (renderInvoices, renderPayroll, …).
  // Same race as F50 / F50 REOPEN / F97, removed at its source rather than re-fired afterwards.
  const _ffDomReady = document.readyState === 'loading'
    ? new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }))
    : Promise.resolve();
  fetch('/api/me', {credentials:'include'}).then(async r => {
    if (!r.ok) { sessionStorage.removeItem('ff_role'); return; }
    const data = await r.json();
    await _ffDomReady;
    window.CURRENT_USER = data.user;
    _setUserDisplay(data.user);
    const role = sessionStorage.getItem('ff_role') || 'owner';
    currentRole = role;
    applyRole(role);
    sessionStorage.setItem('ff_role', role);
    document.getElementById('login-screen').style.display = 'none';
    injectRoleBadge(role);
    window._ffAuthed = true;
    window.dispatchEvent(new Event('ff:authed'));
    if(typeof loadEntitiesFromDB === 'function') await loadEntitiesFromDB();
    if(typeof loadBankingFromDB === 'function') loadBankingFromDB();
  }).catch(()=>{});
}

// ── AUTO SESSION CHECK ON LOAD ──────────────────────────────────────────────
// Session restoration is handled by initEnhancements() — duplicate removed (H-15).

// ════════════════════════════════════════════
// PATCH saveCustomer / saveInvoice / etc to persist
// ════════════════════════════════════════════
// (Called after original functions are defined — see bottom of script)


function computeMonthFull(){
  var fyStart=(document.getElementById('s-fy')||{}).value||'January';
  var mNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var fyStartIdx=Math.max(0,mNames.indexOf(fyStart));
  var today=new Date();
  var todayYear=today.getFullYear();
  var todayMonth=today.getMonth();
  var fyStartYear=(todayMonth>=fyStartIdx)?todayYear:todayYear-1;
  var result=[];
  for(var i=0;i<12;i++){
    var d=new Date(fyStartYear,fyStartIdx+i,1);
    result.push(d.toLocaleString('en-US',{month:'short',year:'numeric'}));
  }
  return result;
}
var MONTH_FULL=computeMonthFull();
var MONTHS=MONTH_FULL.map(function(m){return m.split(' ')[0];});
// LC2b: ONE place that rebuilds the fiscal month list AND repaints every label derived from it (header, AI, month nav).
// It used to rebuild in loadEntityData / saveSettings without repainting, so a non-January business kept the January
// months in its period label after a load. Called whenever the fiscal-year start may have changed.
function _ffFiscalMonthsChanged(){
  MONTH_FULL=computeMonthFull();
  MONTHS=MONTH_FULL.map(function(m){return m.split(' ')[0];});
  if(typeof _ffSyncPeriodLabels==='function') _ffSyncPeriodLabels();
}
window._ffFiscalMonthsChanged=_ffFiscalMonthsChanged;
// ══════════════════════════════════════════════════════════════
// ENTITY DATA — each entity has its own financials, invoices,
// expenses, payroll, customers & inventory
// ══════════════════════════════════════════════════════════════
const ENTITY_DATA = {
  0: { REV: new Array(12).fill(0), EXP: new Array(12).fill(0), invoices: [], expenses: [], inventory: [], customers: [], payroll: [], srcPct:[0.25,0.2,0.3,0.25] },
  1: { REV: new Array(12).fill(0), EXP: new Array(12).fill(0), invoices: [], expenses: [], inventory: [], customers: [], payroll: [], srcPct:[0.25,0.2,0.3,0.25] },
  2: { REV: new Array(12).fill(0), EXP: new Array(12).fill(0), invoices: [], expenses: [], inventory: [], customers: [], payroll: [], srcPct:[0.25,0.2,0.3,0.25] },
};
// Active entity index (mirrors ENTITIES active flag)
let activeEntityIdx = 0;

// Live data pointers — these get swapped on entity switch
let REV    = new Array(12).fill(0);
let EXP    = new Array(12).fill(0);
let PROFIT = new Array(12).fill(0);
// F153: the single in-app writer for the monthly chart arrays REV[]/EXP[]/PROFIT[]. Exposed as a
// window setter so the wiring path (_refreshDashboardUI, which holds the real data via
// window._realInvoices) can fill them WITHOUT reaching the `let` bindings cross-file (the F125 rule).
// buildCharts reads REV/EXP; before this, _refreshDashboardUI built the monthly arrays then dropped
// them, so the overview chart drew zeros even though the KPIs had real data.
window._setMonthlyArrays = function(revArr, expArr){
  if(!Array.isArray(revArr) || !Array.isArray(expArr)) return;
  REV.splice(0,12,...revArr); EXP.splice(0,12,...expArr);
  for(let i=0;i<12;i++) PROFIT[i] = (REV[i]||0) - (EXP[i]||0);
};
const EXP_SAL  = new Array(12).fill(0);
const EXP_RENT = new Array(12).fill(0);
const EXP_SW   = new Array(12).fill(0);
const EXP_MKT  = new Array(12).fill(0);
// Revenue source arrays - populated from real invoice data grouped by client
let SRC_RETAILCO  = new Array(12).fill(0);
let SRC_TECHSTART = new Array(12).fill(0);
let SRC_STRIPE    = new Array(12).fill(0);
let SRC_CONSULT   = new Array(12).fill(0);
// Top clients derived from real invoices - set by loadEntityData()
let _topClients = []; // [{label, monthly, total}]

// Load entity data into live pointers
let _loadEntityDataRunning = false;
async function loadEntityData(idx){
  if (_loadEntityDataRunning) { console.warn('[Entity] loadEntityData already running, skipping'); return; }
  _loadEntityDataRunning = true;
  try { activeEntityIdx = idx; _ffApplyCurrencyLabels(); } catch (_) {}   // FA-M13: the labels follow the business at once
  var _leSeq = window._entitySwitchSeq || 0;   // F151 stale-response guard: captured at load start, re-checked before the data is applied
  activeEntityIdx = idx;
  // F50 Step 1 (flash fix): do NOT zero REV/EXP/PROFIT here. The old entry-zeroing opened a $0
  // window — any render firing between here and the refill (line ~1406) painted all-zero KPIs, and
  // in the boot race a render could land in that window with nothing to correct it (the $0-until-
  // manual-refresh bug). The refill below already replaces all three arrays ATOMICALLY via splice,
  // so the previous (real) values stay visible until the new data lands — stale-but-real for a beat
  // beats a $0 flash. On a genuine entity SWITCH the atomic swap likewise avoids any zero frame.

  const _clrEl = id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; };

  try {
    // Pass entity_id explicitly — don't rely on session
    const _entityObj = ENTITIES[idx] || ENTITIES.find(e=>e.active);
    const _eid = _entityObj?._dbId;
    if (!_eid) { console.warn('[Entity] No _dbId found for idx', idx); _loadEntityDataRunning = false; return; }
    const _eq = '?entity_id='+_eid;
    console.log('[Entity] Loading data for entity_id='+_eid+' ('+_entityObj?.name+')');
    const [invRes, expRes, custRes, invtRes, payRes] = await Promise.all([
      fetch('/api/invoices'+_eq,   {credentials:'include'}),
      fetch('/api/expenses'+_eq,   {credentials:'include'}),
      fetch('/api/customers'+_eq,  {credentials:'include'}),
      fetch('/api/inventory'+_eq,  {credentials:'include'}),
      fetch('/api/payroll'+_eq,    {credentials:'include'}),
    ]);
    // F67 (F31/F62 class, client side): a failed response must NOT become an empty array. The old
    // `res.ok ? json : []` turned a 500 into "this business has no invoices" and painted a $0
    // dashboard with no error state — indistinguishable from a genuinely empty account. A 401/403
    // IS legitimately empty here (logged out / no access), so only 5xx-and-network failures are
    // treated as errors. Any failure on the two MONEY collections (invoices, expenses) aborts the
    // load and surfaces the dashboard's error state rather than painting fabricated zeros.
    // FATAL vs DEGRADE. invoices and expenses drive every money figure on the dashboard — if
    // either fails we must NOT paint, because a partial set renders as smaller (wrong) totals with
    // no indication anything is missing. customers/inventory/payroll are list surfaces: losing one
    // empties that list but corrupts no money, so it degrades to [] and warns rather than taking
    // the whole dashboard down with it. (An earlier revision of this fix made all five fatal,
    // which turned a failed customers fetch into a dead dashboard — worse than the bug.)
    const _pick = (res, label, fatal) => {
      if (res.ok) return res.json().then(j => j || []);
      if (res.status === 401 || res.status === 403) return [];   // not authorised ⇒ genuinely nothing
      // F130: an expired trial is not a load failure and must not be reported as one. Every /api
      // read 402s at once, so this fires on whichever loader lands first; the paywall is idempotent
      // and the flag short-circuits the error state below. Checked BEFORE the fatal/non-fatal split
      // because it applies to both — a 402 on `customers` is the same event as a 402 on `invoices`.
      if (res.status === 402) {
        return res.json().catch(()=>({})).then(j => {
          if (j && j.code === 'TRIAL_EXPIRED' && typeof window._ffShowTrialExpired === 'function') {
            window._ffShowTrialExpired(j.error);
          }
          const err = new Error(label + ' blocked (HTTP 402)');
          err.status = 402; err.code = (j && j.code) || 'PAYMENT_REQUIRED'; err.label = label;
          throw err;
        });
      }
      if (!fatal) { console.warn('[Entity] ' + label + ' failed (HTTP ' + res.status + ') — list will be empty'); return []; }
      const err = new Error(label + ' failed (HTTP ' + res.status + ')');
      err.status = res.status; err.label = label;
      throw err;
    };
    const [invoices, expenses, custs, invt, payroll] = await Promise.all([
      _pick(invRes,  'invoices',  true),    // money — fatal
      _pick(expRes,  'expenses',  true),    // money — fatal
      _pick(custRes, 'customers', false),
      _pick(invtRes, 'inventory', false),
      _pick(payRes,  'payroll',   false),
    ]);

    // Atomically swap global arrays now that all data has arrived
    userInvoices.length = 0;
    bizExpenses.length = 0;
    customers.length = 0;
    inventory.length = 0;
    payrollEmployees.length = 0;
    ownerPayroll = null;
    window.ownerPayroll = null;
    _clrEl('invoice-list'); _clrEl('expense-list'); _clrEl('customer-list');
    _clrEl('inventory-list'); _clrEl('payroll-list');

    // Replace userInvoices
    userInvoices = invoices.map(r=>({
      _dbId:r.id, client:r.client, amount:r.amount,
      amount_paid: r.amount_paid,   // F48 follow-up: carry so markInvoicePaid settles only the REMAINING balance (partials don't overpay→400)
      credit_applied: r.credit_applied || 0,   // FA-M6b: the part of amount_paid that is an applied credit, not cash
      due: r.due_date ? (window.FinFlowDates ? window.FinFlowDates.fmtLabel(r.due_date) : r.due_date) : 'No due date',   // F195: TZ-safe calendar date (was new Date().toLocaleDateString → shifted west of UTC)
      due_date:r.due_date, status:r.status, notes:r.notes||'', number:r.number||null,   // B1b
      color: r.status?.toLowerCase()==='overdue'?'var(--red)':'var(--t2)',
    }));

    // Replace bizExpenses
    bizExpenses = expenses.map(mapBizExpenseRow);   // C9: the one mapper

    // Replace customers
    customers = custs.map(c=>({...c, _dbId:c.id}));

    // Replace inventory
    inventory = invt.map(r=>({_dbId:r.id, sku:r.sku, name:r.name, units:r.units, max:r.max_units||200, reorder_level:(r.reorder_level!=null&&r.reorder_level!=='')?Number(r.reorder_level):null, cost:r.cost, low:!!r.low_stock}));   // G5
    // C1: the Inventory page (finflow-api-wiring-medium.js renderInventory, the runtime winner) reads window.inventory,
    // which only the boot loader set — so after a business switch the page kept the PREVIOUS business's stock.
    window.inventory = inventory;

    // Update payroll — always reset employees per entity (no stale cross-entity rows)
    payrollEmployees = (payroll||[]).filter(r=>!r.is_owner).map(r=>({
      _dbId:r.id, fname:r.fname, lname:r.lname, role:r.role||'', type:r.emp_type||'Full-time',
      gross:r.gross, deductions:r.deductions||[], net:netFromDeductions(r.gross, r.deductions),
      initials:((r.fname||'')[0]+((r.lname||'')[0]||'')).toUpperCase(), avClass:r.av_class||'av-blue', isOwner:false,
    }));
    window.payrollEmployees = payrollEmployees;

    // Restore owner payroll PER-ENTITY — index by the entity idx we're loading
    const ownerRow = (payroll||[]).find(r=>r.is_owner);
    if(typeof ownerPayrollByEntity === 'undefined') window.ownerPayrollByEntity = window.ownerPayrollByEntity || {};
    if(ownerRow){
      const _entity = ENTITIES[idx];
      const owner = {
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
        currency: _entity?.currency || 'USD',
        entityName: _entity?.name || 'Entity',
        isOwner:  true,
        // Link to the recurring personal-income profile the payroll salary syncs to.
        // The bundle keys find-or-create off THIS id (never fuzzy-matches) so re-saves
        // update one profile instead of spawning duplicates.
        salary_profile_id: ownerRow.salary_profile_id != null ? Number(ownerRow.salary_profile_id) : null,
      };
      ownerPayrollByEntity[idx] = owner;
      window.ownerPayrollByEntity = ownerPayrollByEntity;
      // Sync compat pointer if this is the active entity
      if (ENTITIES[idx]?.active) {
        ownerPayroll = owner;
        window.ownerPayroll = owner;
      }
      console.log('[loadEntityData] Restored owner payroll for entity idx', idx, '('+_entity?.name+'):', owner.fname, owner.lname, '| gross:', owner.gross);
    } else {
      // No owner record for this entity — clear any stale mapping for this idx
      if (ownerPayrollByEntity[idx]) {
        delete ownerPayrollByEntity[idx];
        if (ENTITIES[idx]?.active) { ownerPayroll = null; window.ownerPayroll = null; }
      }
    }

    // Sync to Personal Finance (salary income line + banner)
    if (typeof syncAllPayrollsToPersonal === 'function') {
      try { syncAllPayrollsToPersonal(); } catch(e) { console.warn('[loadEntityData] syncAllPayrollsToPersonal failed:', e.message); }
    }

    // F151 stale-response guard: if the user switched entities while this load was in flight, a NEWER
    // load owns the dashboard now — discard this one so the previous entity's data can't clobber it
    // (the tab-refocus "Saige under Acme" bug).
    if ((window._entitySwitchSeq || 0) !== _leSeq) return;
    // Store globally for dashboard wiring — MUST update before calling updateDashboard
    window._realInvoices = invoices || [];
    window._realExpenses = expenses || [];
    // ENTITY-ISOLATION (money leak): window.userInvoices is the Invoices-table + CSV/XLSX-export +
    // invoice-action source, but loadEntityData only ever refreshed the LEXICAL userInvoices and
    // window._realInvoices — never window.userInvoices. So on an entity SWITCH it kept the PREVIOUS
    // entity's invoices (a TT company's Invoices page/export listing the US entity's invoices with the
    // new entity's currency symbol stamped on them). Keep it canonical on EVERY load, here under the
    // same stale-response guard so a late in-flight load can't clobber the new entity's rows.
    window.userInvoices = userInvoices;

    // Monthly chart arrays come from the SINGLE canonical fiscal builder (the dashboard
    // wiring's window._buildMonthlyArrays) on the F32 issue-based basis (issued invoices by
    // created_at + receipts). The old paid-only/due_date builder that used to live here was
    // DELETED — it was a second, divergent basis that Stage 1 missed (logged as a Stage-1
    // gap under F32/F33). If the wiring hasn't loaded yet, _refreshDashboardUI fills REV[]
    // once it does. Payroll is NOT in EXP[] — computeExpenseBreakdown adds it once (canonical).
    if(typeof window._buildMonthlyArrays==='function'){
      const _mb=window._buildMonthlyArrays(invoices, expenses);
      if(_mb && _mb.revByMonth){ window._setMonthlyArrays(_mb.revByMonth, _mb.expByMonth); }   // F153: route through the single writer
    }

    const _safeRender = (fn) => { try { if(typeof fn==='function') fn(); } catch(e) { console.warn('render error:', e.message); } };
    _safeRender(renderInvoices);
    _safeRender(renderExpenses);
    _safeRender(renderCustomers);
    _safeRender(renderInventory);
    _safeRender(renderPayroll);
    _safeRender(updateDashboard);
    _safeRender(buildCharts);

    // Refresh dashboard wiring KPIs with correct entity data
    if(typeof window._bootDashboardWiring==='function') {
      try { await window._bootDashboardWiring(); } catch(e) {}
    }
    // Also refresh banking for this entity
    if(typeof loadBankingFromDB==='function') loadBankingFromDB();
    // F102 — payroll runs are the basis-C source of the payroll OpEx leg (computeExpenseBreakdown
    // reads window.payrollRuns). Their loader only fired on a Payroll-page visit or a payroll mutation,
    // so on a cold boot window.payrollRuns was empty and Expenses/Profit OMITTED payroll until the page
    // was opened — then a refresh reset it. Every SIBLING money store already loads at boot: expenses
    // above, bills/paymentsMade from the pages wiring's boot IIFE; payroll runs were the lone omission.
    // Fire the SAME loader here so the KPI engine has the runs at boot AND on every entity switch.
    // Fire-and-forget: loadPayrollRuns() stashes window.payrollRuns then calls refreshFinancials()
    // itself, repainting on arrival exactly like loadBankingFromDB above. This does NOT remove the
    // second (client) implementation of the payroll leg — the client still recomputes what the server
    // already computes in computeBooks; that consolidation is the money-engine work in step 4 of
    // VERIFICATION.md's sequencing, which A6's client cross-engine probe will then guard automatically.
    if(typeof loadPayrollRuns==='function') loadPayrollRuns();

    // Build _topClients on the SAME accrual basis computeRevenue uses (F69). Was paid-only, but the
    // income-source bar %s divide by ACCRUAL revenue, so paid-only made the bars sum to well under
    // 100% on any account with unpaid invoices. Recognized allowlist (issue-based, excludes draft):
    // pending/overdue/partial/paid — identical to the server _REC set and computeRevenue.
    const _clientTotals = {};
    const _REC_INV = ['pending','overdue','partial','paid'];
    invoices.filter(i=>_REC_INV.includes((i.status||'').toLowerCase())).forEach(i=>{
      const c = i.client||'Other';
      _clientTotals[c] = (_clientTotals[c]||0) + (parseFloat(i.amount)||0);
    });
    _topClients = Object.entries(_clientTotals)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,4)
      .map(([label,total])=>({label,total}));

    console.log('[Entity] Loaded real data — invoices:'+invoices.length+' expenses:'+expenses.length+' top clients:'+_topClients.length);

    // F154 (F150/F151 entity-isolation class — Rule 13): business investment positions are entity-
    // scoped and MUST reload on every switch. loadEntityData reloads invoices/expenses/customers/
    // inventory/payroll above, but window.bizHoldings was never enumerated — so the dashboard
    // Investments card and renderBizInvestments (both read window.bizHoldings) kept the PREVIOUS
    // entity's portfolio, leaking one entity's holdings onto another (e.g. Saige's under empty Acme).
    // Pass the explicit switched entity id (_eid) so the reload never depends on session timing.
    if(typeof window._loadBizHoldingsFromDB === 'function'){ try{ await window._loadBizHoldingsFromDB(_eid); }catch(_){} }
  } catch(e){
    // F67: an authenticated load failure must be VISIBLE. Previously this warned to console and
    // left whatever was on screen — which, on a cold boot, was a full set of $0 cards the user
    // had no way to tell apart from real data. 401/403 never reaches here (handled as genuinely
    // empty above), so anything landing here is a real failure worth showing.
    console.error('[Entity] loadEntityData failed:', e.message);
    // F130: the paywall OWNS the screen when the trial has expired — do not paint "Unable to load"
    // underneath it. This is the short-circuit, not a cosmetic skip: the whole defect was an
    // expired trial being reported as a broken app.
    if(e && (e.code === 'TRIAL_EXPIRED' || window._ffTrialExpiredActive)) return;
    if(window._ffAuthed && typeof window._dashSetState==='function'){
      try{ window._dashSetState('error'); }catch(_){}
    }
  } finally {
    _ffFiscalMonthsChanged();   // LC2b: rebuild + repaint the period labels
    _loadEntityDataRunning=false;
    // F151: active entity's data loaded → SCHEDULE the reveal (debounced). updateDashboard reschedules
    // it on every subsequent render, so the splash lifts only once the numbers stop changing.
    if(typeof window._bootSplashSettle==='function') window._bootSplashSettle();
  }
}
window.loadEntityData = loadEntityData; // expose for medium.js payroll reload hook

// F151 — BOOT SPLASH CONTROL. The splash (#ff-splash) is visible by default and covers the whole
// boot so nothing half-loaded (login flash, $0 cards, empty chart) is ever shown. It is hidden ONCE
// (idempotent) at the first data-ready moment: loadEntityData's finally (active entity loaded), the
// genuinely-empty-account path, or the auth-401 path (via _showLoginScreen). A hard safety timeout
// guarantees it can NEVER get stuck — a stuck splash would be a dead app.
window._hideBootSplash = function(){
  var s=document.getElementById('ff-splash'); if(!s||s._ffHidden) return; s._ffHidden=true;
  if(window._bootSplashTimer){ clearTimeout(window._bootSplashTimer); window._bootSplashTimer=null; }
  if(window._bootSplashSafety){ clearTimeout(window._bootSplashSafety); window._bootSplashSafety=null; }
  s.style.opacity='0'; setTimeout(function(){ s.style.display='none'; }, 400);
};
// F151 — RE-SHOW the splash for an entity SWITCH. Switching changes the currency/brand immediately
// while the previous entity's numbers are still in memory, so an intermediate render pairs the old
// entity's figures with the new currency (e.g. Saige's 206K shown in Acme/TTD) before the new data
// loads. Covering the switch with the same splash (lifted on network-idle once the new entity's data
// settles) removes that flash. Carries its own safety cap so a switch can never leave it stuck.
window._showBootSplash = function(){
  var s=document.getElementById('ff-splash'); if(!s) return;
  if(window._bootSplashTimer){ clearTimeout(window._bootSplashTimer); window._bootSplashTimer=null; }
  s._ffHidden=false; s.style.display='flex'; void s.offsetWidth; s.style.opacity='1';
  if(window._bootSplashSafety) clearTimeout(window._bootSplashSafety);
  window._bootSplashSafety = setTimeout(function(){ if(window._hideBootSplash) window._hideBootSplash(); }, 8000);
};
// F151 — DEBOUNCED lift (the fix for the "blinks"). The boot fires SEVERAL dashboard renders as its
// data loads resolve, and one intermediate render can pair the wrong entity's numbers with the active
// currency (e.g. Saige's figures shown in TTD). Lifting after the FIRST load exposes the rest. Instead,
// every dashboard render (updateDashboard — the canonical writer of d-rev/d-exp/d-profit) reschedules
// the lift, so the splash stays up until the numbers STOP changing, then reveals the single final
// dashboard. The hard safety cap below still guarantees it can never stick.
window._bootSplashSettle = function(){
  var s=document.getElementById('ff-splash'); if(!s||s._ffHidden) return;   // already lifted — no-op post-boot
  if(window._bootSplashTimer) clearTimeout(window._bootSplashTimer);
  window._bootSplashTimer = setTimeout(function(){ if(window._hideBootSplash) window._hideBootSplash(); }, 750);
};
window._showLoginScreen = function(){
  if(typeof window._hideBootSplash==='function') window._hideBootSplash();
  var l=document.getElementById('login-screen'); if(l) l.style.display='flex';
};
setTimeout(function(){ try{ window._hideBootSplash && window._hideBootSplash(); }catch(e){} }, 10000);  // hard safety: never stuck

// F151 — NETWORK-IDLE splash gate. A fixed timer can lift the splash between two boot loads that are
// spaced further apart than the timer (the "blink leaks after the splash" symptom). Instead, count
// in-flight fetches WHILE the splash is up and reschedule the debounced lift every time one settles —
// so the splash lifts only once the network goes quiet (all boot data loaded) and the numbers stop
// moving. Once the splash is gone this wrapper is a pure passthrough, so there is ZERO effect on any
// post-boot request. The 10s hard cap above still guarantees it can never stick.
(function(){
  var origFetch = window.fetch;
  if(!origFetch || origFetch._ffSplashWrapped) return;
  var wrapped = function(){
    var s = document.getElementById('ff-splash');
    if(!s || s._ffHidden) return origFetch.apply(this, arguments);   // splash already lifted → plain passthrough
    var settle = function(){ if(window._bootSplashSettle) window._bootSplashSettle(); };
    var p;
    try { p = origFetch.apply(this, arguments); } catch(e){ settle(); throw e; }
    return Promise.resolve(p).then(function(r){ settle(); return r; }, function(e){ settle(); throw e; });
  };
  wrapped._ffSplashWrapped = true;
  window.fetch = wrapped;
})();

const INVOICES_BASE = []; // populated from DB via loadEntityData

// Start with empty arrays — loadEntityData fills these from the real API
let bizExpenses = [];
// C9: ONE mapper for a business expense row → the Expenses page's shape. Three loaders built this list (this file's
// loadEntityData, finflow-api-wiring-medium.js and finflow-api-wiring-postgres.js); only one carried the editable
// date, class and location, so after a reload or business switch "Edit" opened with the date blank and refused to save.
function mapBizExpenseRow(r){
  return {
    _dbId: r.id, desc: r.description, cat: r.category, amount: r.amount, ded: r.deductible, vendor: r.vendor || '',
    expense_date: r.expense_date ? String(r.expense_date).slice(0, 10) : '',
    class: r.class || '', location: r.location || '',
    date: r.expense_date ? (window.FinFlowDates ? window.FinFlowDates.fmtLabel(r.expense_date) : r.expense_date) : 'Today',   // F195: TZ-safe calendar date
  };
}
window.mapBizExpenseRow = mapBizExpenseRow;
// Inventory
let inventory = [];
// Customers
let customers = [];
let nextCustId = 10;
const AVATAR_COLORS = ['av-blue','av-green','av-purple','av-amber','av-red','av-teal'];
// Payroll
let payrollEmployees = [];
let ownerPayrollByEntity = {};
let ownerPayroll = null;
let activeOwnerEntityIdx = 0;
// Personal
let spending = [];
let goals = [];
let persTransactions = [];
// (retired) basePersonalIncome — owner salary is now a linked recurring income
// profile counted through the unified occurrence-driven projection in _applyPersFilter.
// User invoices — populated from DB via loadEntityData
let userInvoices = [];
let nextInvId = 100;
// Period state
let darkMode = true;
let currentPeriod = 'year';
window.currentPeriod = 'year'; // mirrored to window so the bundle's KPI engine reads the same period
// Default the month stepper to the CURRENT fiscal month, not a fixed index 11 (which was
// December under a January fiscal year — the QA "selected period showed Dec 2026" bug).
let currentMonthIdx = (function(){ try { return _fyContext().curFyIdx; } catch(_){ return 11; } })();
let charts = {};
let currencySymbol = '$';

// ════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════
function S(n,s=false){
  const showCents=document.getElementById('s-cents')?.checked;
  const abs=Math.abs(Number(n));
  const fmt=showCents?abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):Math.round(abs).toLocaleString();
  const str=currencySymbol+fmt;
  return s?(n>=0?'+'+str:'-'+str):str;
}
function sum(arr,s,e){return arr.slice(s,e).reduce((a,v)=>a+v,0)}
function pct(a,b){if(!b)return 0;return Math.round((a-b)/Math.abs(b)*100)}
function chg(cur,prev,invert=false){
  if(prev==null)return{txt:'Year to date',cls:'neutral'};   // FIX-2: the year counts what is dated up to today (D2), not the whole year
  const p=pct(cur,prev);
  const good=invert?p<=0:p>=0;
  return{txt:(p>=0?'↑ ':'↓ ')+Math.abs(p)+'% vs prior period',cls:good?'up':'dn'};
}
function getInitials(f,l){return((f||'')[0]||'').toUpperCase()+((l||'')[0]||'').toUpperCase()}
function notify(msg,isError=false){
  const el=document.getElementById('notif');
  const icon=document.getElementById('notif-icon');
  const prog=document.getElementById('notif-progress');
  document.getElementById('notif-text').textContent=msg;
  el.className='notif'+(isError?' error':'');
  icon.style.background=isError?'var(--red-bg)':'var(--green-bg)';
  icon.style.color=isError?'var(--red)':'var(--green)';
  icon.innerHTML=isError?'<svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>':'<svg viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3"/></svg>';
  if(prog){prog.style.background=isError?'var(--red)':'var(--green)';prog.style.transition='none';prog.style.transform='scaleX(1)';requestAnimationFrame(()=>{requestAnimationFrame(()=>{prog.style.transition='transform 3.2s linear';prog.style.transform='scaleX(0)';})})}
  clearTimeout(el._t);clearTimeout(el._t2);
  el._t2=setTimeout(()=>{el.classList.add('hiding');el._t=setTimeout(()=>el.className='notif hidden',260);},3400);
}
let _modalFocusCleanup = null;
function closeModal(id){
  document.getElementById(id).classList.add('hidden');
  if(_modalFocusCleanup){ _modalFocusCleanup(); _modalFocusCleanup = null; }
}
function openModal(id){
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  _ffApplyCurrencyLabels();   // FA-M13: a form's money labels say the currency it is in
  // Apply focus trap to the inner .modal element (first child that is the panel)
  const panel = el.querySelector('.modal') || el;
  if(window.trapFocus){ if(_modalFocusCleanup) _modalFocusCleanup(); _modalFocusCleanup = window.trapFocus(panel); }
}
function emptyState(icon,title,desc,ctaLabel,ctaFn){
  return`<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 16 16">${icon}</svg></div><h3>${title}</h3><p>${desc}</p>${ctaLabel?`<button class="btn btn-primary btn-sm" onclick="${ctaFn}">${ctaLabel}</button>`:''}</div>`;
}

// ════════════════════════════════════════════
// PERIOD DATA
// ════════════════════════════════════════════
function getPeriodData(){
  if(currentPeriod==='month'){
    const i=currentMonthIdx, p=Math.max(0,i-1);
    return{
      rev:REV[i],exp:EXP[i],profit:PROFIT[i],
      prevRev:REV[p],prevExp:EXP[p],prevProfit:PROFIT[p],
      labels:[MONTHS[i]],revArr:[REV[i]],expArr:[EXP[i]],
      sal:EXP_SAL[i],rent:EXP_RENT[i],sw:EXP_SW[i],mkt:EXP_MKT[i],
      srcRC:0,srcTS:0,srcST:0,srcCO:0,
      months:1, label:MONTH_FULL[i]
    };
  } else if(currentPeriod==='quarter'){
    // The ACTUAL current fiscal quarter (F33) — not a hardcoded Q4. Indices are fiscal-year
    // positions into REV[]/EXP[] (which the unified fiscal builder fills), so chart + label
    // track the real quarter.
    const qs=Math.floor(_fyContext().curFyIdx/3)*3, e=qs+3, ps=Math.max(0,qs-3), pe=qs;
    return{
      rev:sum(REV,qs,e),exp:sum(EXP,qs,e),profit:sum(PROFIT,qs,e),
      prevRev:sum(REV,ps,pe),prevExp:sum(EXP,ps,pe),prevProfit:sum(PROFIT,ps,pe),
      labels:MONTHS.slice(qs,e),revArr:REV.slice(qs,e),expArr:EXP.slice(qs,e),
      // F60: rent is SUMMED over the quarter like every other category. It used to be
      // EXP_RENT[0]*3 — one month's rent multiplied out, a fabricated figure (and, before the
      // fiscal-index fix, not even the right month). If rent was recorded once, this invented
      // three months of it; if it varied, it reported a number that was never spent.
      sal:sum(EXP_SAL,qs,e),rent:sum(EXP_RENT,qs,e),sw:sum(EXP_SW,qs,e),mkt:sum(EXP_MKT,qs,e),
      srcRC:0,srcTS:0,srcST:0,srcCO:0,
      months:3, label:(typeof _periodWindow==='function'?_periodWindow('quarter').label:'Quarter')
    };
  } else {
    return{
      rev:sum(REV,0,12),exp:sum(EXP,0,12),profit:sum(PROFIT,0,12),
      prevRev:null,prevExp:null,prevProfit:null,
      labels:MONTHS,revArr:REV,expArr:EXP,
      // F60: summed over the fiscal year, not EXP_RENT[0]*12 (see the quarter branch above).
      sal:sum(EXP_SAL,0,12),rent:sum(EXP_RENT,0,12),sw:sum(EXP_SW,0,12),mkt:sum(EXP_MKT,0,12),
      srcRC:0,srcTS:0,srcST:0,srcCO:0,
      months:12, label:'Year to date · '+MONTH_FULL[0]+' – '+MONTH_FULL[(typeof _fyContext==='function'?_fyContext().curFyIdx:11)]   // FIX-2: up to today's fiscal month (D2)
    };
  }
}

// ════════════════════════════════════════════
// CANONICAL EXPENSE BREAKDOWN  (single source of truth)
// ════════════════════════════════════════════
// Both the dashboard Expenses/Net-Profit KPIs and the Expenses-page
// Total/Business/Tax-deductible KPIs call THIS function. Given the active
// entity's real expense rows (window._realExpenses), issued bills accrued as
// expense (window.bills — F38 Step 4), orphan bill payments (window.paymentsMade,
// bill_id IS NULL) and entity payroll (window.ownerPayroll + window.payrollEmployees),
// it returns totals that are identical on every screen for the same entity + period.
// No fabricated ratios anywhere.
function computeExpenseBreakdown(period, monthIdx){
  period = period || (typeof currentPeriod !== 'undefined' ? currentPeriod : (window.currentPeriod || 'year'));
  // Period window is the SAME canonical resolver the revenue engine + server use (F33/F25),
  // so expenses, revenue and payroll all bound to one window. Payroll accrues per ELAPSED
  // month within that window (never forward-projected): month = 1 (if started), quarter =
  // months of the quarter started, year = elapsed fiscal months (min(now, fyEnd)) — Year is
  // now a real fiscal year, not calendar-YTD payroll against all-time rows (F25).
  const w = _periodWindow(period, monthIdx);
  const months = w.elapsedMonths;
  const inPeriod = (val)=> w.inWin(val);
  // Real expense rows in the period
  const rows = (window._realExpenses || []).filter(e=>inPeriod(e.expense_date || e.date || e.created_at));
  const realExpenses = rows.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  // Tax-deductible from REAL rows only: yes=100%, half=50%, no=0
  const deductible = rows.reduce((s,e)=>{
    const amt = parseFloat(e.amount)||0;
    // M15: the shared vocabulary map (finflow-dates.js) — the same reader the server tax leg uses.
    return s + amt * window.FinFlowDates.deductibleFactor(e.deductible!=null ? e.deductible : e.ded);
  },0);
  // Category breakdown from REAL rows only
  const byCategory = {};
  rows.forEach(e=>{ const c=e.category||e.cat||'Other'; byCategory[c]=(byCategory[c]||0)+(parseFloat(e.amount)||0); });
  // F38 Step 4 — issued bills accrue as expense (mirror of the F32 revenue accrual): every
  // RECOGNIZED bill at its FULL amount, keyed on its issue_date (created_at fallback — the same
  // time-boxed transition as invoices), in the window. window.bills is entity-scoped by its
  // loader (GET /api/bills). Uses the SAME _periodWindow as revenue so server == client.
  // M34: the shared opex-bill rule (recognised, and not a stock purchase's bill — that cost is inventory / COGS).
  const issuedBills = (window.bills || [])
    .filter(b=>window.FinFlowDates.isOpexBill(b) && inPeriod(b.issue_date||b.created_at||b.due_date))
    .reduce((s,b)=>s+(parseFloat(b.amount)||0),0);
  // Only ORPHAN payments (bill_id IS NULL) stay expense — a bill-linked payment is a settlement
  // (Dr AP / Cr Cash), not a fresh expense; counting it double-counts the issued-bill leg.
  const pmade = (window.paymentsMade || []).filter(p=>p.bill_id==null && inPeriod(p.date||p.created_at));
  const paymentsMade = pmade.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  // ── PAYROLL — BASIS C: payroll runs are the SINGLE SOURCE OF TRUTH ───────────────────────
  // Mirrors the server (computeBooks): Σ run LINES recognised in the PERIOD the run is FOR (F85,
  // first-of-period-month), not run_date (creation time).
  // A payroll run is the event that creates the expense, exactly as an issued invoice creates
  // revenue (F32). Replaces `monthlyPayroll × elapsedMonths` — today's ROSTER × time — which had
  // no effective dating (hiring someone today changed last January), double-counted against any
  // salary logged as an expense row, and put payroll on a cash-ish basis while revenue was
  // accrual. The roster is now a TEMPLATE for creating a run; NO total reads from it.
  const runs = window.payrollRuns || [];
  // F80 / VERIFICATION.md ACCOUNTING BASIS decision 2: a payroll run is recognised as expense at
  // `approved`; `draft` contributes 0; `paid` adds nothing further (already recognised at approved).
  // MUST be IN ('approved','paid'), NOT ='approved' — a paid run was approved first, so approved-only
  // would make the expense DISAPPEAR when a run is marked paid (the ⚠️ implementation trap on decision 2).
  // Mirror of the server predicate in computeBooks (server.js). payrollRunCount still counts every
  // in-period run (unchanged) — the status gate applies to the recognised EXPENSE only.
  const PAYROLL_RECOGNIZED = ['approved','paid'];
  let payroll = 0, payrollRunCount = 0;
  runs.forEach(r=>{
    // F85 (2026-08-07, accrual): recognise the run in the PERIOD IT IS FOR — first of the run's
    // `period` month ('YYYY-MM' → 'YYYY-MM-01'), a tz-free calendar date — not run_date (creation
    // time). Mirrors the server computeBooks _payDate so client and server agree. run_date is metadata.
    if(!inPeriod(window.FinFlowDates.payrollPeriodYmd(r.period, r.run_date))) return;   // F-H1: robust period parse
    payrollRunCount++;
    if(!PAYROLL_RECOGNIZED.includes(String(r.status||'').toLowerCase())) return;   // draft ⇒ 0
    (r.lines||[]).forEach(l=>{
      payroll += (parseFloat(l.gross)||0) + (parseFloat(l.bonus)||0) + (parseFloat(l.overtime)||0);
    });
  });
  // Roster cost — INFORMATIONAL ONLY, for the Payroll page template + empty state. Not in a total.
  const op = window.ownerPayroll;
  const emps = window.payrollEmployees || [];
  const allPay = op ? [op, ...emps] : [...emps];
  const rosterMonthlyCost = allPay.reduce((s,e)=>s+(parseFloat(e.gross)||0),0);
  // F58 — VENDOR CREDITS reduce opex (contra leg), the mirror of credit notes on revenue.
  // Same Open/Applied allowlist and same window as the server's vendorCreditsTotal in
  // computeBooks (Rule 6). AP is deliberately NOT reduced — P&L contra only (F58 scope).
  const RECOGNIZED_CREDIT = ['open','applied'];
  const vendorCredits = (window.vendorCredits || [])
    .filter(v=>RECOGNIZED_CREDIT.includes((v.status||'').toLowerCase()) && inPeriod(v.date||v.created_at))
    .reduce((s,v)=>s+(parseFloat(v.amount)||0),0);
  // N20: posted manual journals' EXPENSE leg (5xxx-9xxx accounts) adds to opex — the client mirror
  // of the server's jeOpex (computeBooks reads it from the GL). Same window as every other leg.
  const journalExpense = (typeof _journalPnL==='function') ? _journalPnL(w).expense : 0;
  // FA-M9: the same total by SOURCE and by VENDOR — each map adds up to `total` because each is built from THESE legs
  // (the rows filtered above), never re-derived. By category is _expenseCategoryRows (D3), the one every surface uses.
  const _vcRows = (window.vendorCredits || []).filter(v=>RECOGNIZED_CREDIT.includes((v.status||'').toLowerCase()) && inPeriod(v.date||v.created_at));
  const _billRows = (window.bills || []).filter(b=>window.FinFlowDates.isOpexBill(b) && inPeriod(b.issue_date||b.created_at||b.due_date));
  const _put = (m, k, v) => { if (Math.abs(v) >= 0.005) m[k] = (m[k] || 0) + v; };
  const bySource = {};
  _put(bySource, 'Recorded expenses', realExpenses); _put(bySource, 'Bills', issuedBills); _put(bySource, 'Payments made (no bill)', paymentsMade);
  _put(bySource, 'Payroll', payroll); _put(bySource, 'Vendor credits', -vendorCredits); _put(bySource, 'Journal entries', journalExpense);
  const byVendor = {}, _vName = {};   // vendors match case- and space-insensitively; the most-used spelling is shown
  const _addV = (name, amt) => {
    const disp = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
    const k = disp.toLowerCase(); if (!k) { _put(byVendor, 'No vendor', amt); return; }
    _vName[k] = _vName[k] || {}; _vName[k][disp] = (_vName[k][disp] || 0) + Math.abs(amt);
    byVendor['\u0000' + k] = (byVendor['\u0000' + k] || 0) + amt;
  };
  rows.forEach(e=>_addV(e.vendor, parseFloat(e.amount)||0));
  _billRows.forEach(b=>_addV(b.vendor, parseFloat(b.amount)||0));
  pmade.forEach(p=>_addV(p.vendor, parseFloat(p.amount)||0));
  _vcRows.forEach(v=>_addV(v.vendor, -(parseFloat(v.amount)||0)));
  _put(byVendor, 'Payroll (employees)', payroll); _put(byVendor, 'Journal entries', journalExpense);
  Object.keys(byVendor).filter(k=>k[0]==='\u0000').forEach(k=>{ const v = byVendor[k]; delete byVendor[k];
    const name = Object.entries(_vName[k.slice(1)]).sort((x,y)=>y[1]-x[1])[0][0]; if (Math.abs(v) >= 0.005) byVendor[name] = (byVendor[name] || 0) + v; });
  return {
    total: realExpenses + issuedBills + paymentsMade + payroll - vendorCredits + journalExpense,
    realExpenses, issuedBills, paymentsMade, payroll, vendorCredits, journalExpense,
    bySource, byVendor,
    payrollRunCount, rosterMonthlyCost,
    business: realExpenses,   // data model has no personal/business split — all recorded rows are business
    deductible, byCategory, months, period,
  };
}
window.computeExpenseBreakdown = computeExpenseBreakdown;

// Phase 1.1 — the ONE category decomposition of the opex total, shared by every client surface that
// breaks expenses down (dashboard bars, Expenses page bars, AI insights). Mirrors the server
// computeBooks.expenseBreakdown exactly: direct-expense categories + Payroll + "Bills & vendors"
// (issued bills + orphan payments − vendor credits) + "Journal entries" (posted expense JEs), so
// Σ(rows) == bd.total by construction. Before this, each surface built
// its own list and each dropped a different leg (the Expenses page showed only orphan payments as
// "Bill payments"; every surface dropped posted journals), so no breakdown summed to its headline.
// ≤4 categories show by name, more ⇒ top 3 + "Other".
function _expenseCategoryRows(bd, opts){
  if(!bd) return [];
  const all = !!(opts && opts.all);   // L14: a statement lists every category; the 4 bars roll the tail into "Other"
  const cats = {};
  Object.entries(bd.byCategory || {}).forEach(([c, v]) => { if(v) cats[c] = (cats[c] || 0) + v; });
  if(bd.payroll) cats['Payroll'] = (cats['Payroll'] || 0) + bd.payroll;
  const apNet = (bd.issuedBills || 0) + (bd.paymentsMade || 0) - (bd.vendorCredits || 0);
  if(apNet) cats['Bills & vendors'] = (cats['Bills & vendors'] || 0) + apNet;
  if(bd.journalExpense) cats['Journal entries'] = (cats['Journal entries'] || 0) + bd.journalExpense;
  const sorted = Object.entries(cats).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => b[1] - a[1]);
  // Four bars: ≤4 categories show by name; more ⇒ top 3 + an "Other" rollup (same rule as the server).
  if(all) return sorted;
  const keep = sorted.length <= 4 ? 4 : 3;
  const rows = sorted.slice(0, keep);
  const rest = sorted.slice(keep).reduce((s, [, v]) => s + v, 0);
  if(Math.abs(rest) > 0.005) rows.push(['Other', rest]);
  return rows;
}
window._expenseCategoryRows = _expenseCategoryRows;

// ════════════════════════════════════════════
// CANONICAL REVENUE  (single source of truth)
// ════════════════════════════════════════════
// Mirrors the dashboard's revenue basis exactly: paid invoices + sales receipts
// + payments received, period-scoped. The dashboard, AI insights and health
// score all call THIS, so every screen agrees on revenue (and therefore profit).
// ════════════════════════════════════════════
// CANONICAL PERIOD WINDOW  (single source of truth — F33/F25)
// ════════════════════════════════════════════
// Resolves the SELECTED period to a concrete calendar window, honoring the fiscal-year
// start (s-fy, default January) and the month stepper (currentMonthIdx, a FISCAL-year
// index 0..11 into MONTH_FULL). Both KPI engines (computeRevenue / computeExpenseBreakdown)
// AND the server (computeBooks, via ?start&end&elapsedMonths) filter to the SAME window,
// so the value never silently follows `new Date()` regardless of the selected month (F33).
//   month   → the one fiscal-index month; elapsedMonths = 1 if it has started, else 0.
//   quarter → the fiscal quarter containing the anchor month (NOT a hardcoded Q4).
//   year    → the whole fiscal year [fyStart, fyStart+12mo); payroll × elapsed fiscal
//             months (min(now, fyEnd)) — Year is now internally consistent (F25), no
//             longer all-time revenue mixed with calendar-YTD payroll.
// Single source of fiscal-year context (start month, start year, elapsed months, and the
// fiscal-year index of "now") — shared by the window resolver and the delta baseline so the
// two can't drift (drift between two period sources is exactly what produced F33).
function _fyContext(){
  const mNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const fyName=(typeof document!=='undefined' && (document.getElementById('s-fy')||{}).value) || (window._fyStart||'January');
  const fyStartIdx=Math.max(0,mNames.indexOf(fyName));
  // F87: derive the fiscal-year context from the CALENDAR date (UTC via resolvedToday), NOT from
  // local getMonth/getFullYear — so "which fiscal month is it" never depends on the viewer's TZ.
  const today=_entityToday();   // 'YYYY-MM-DD' — the ENTITY's day (L36), as the server's entityTodayYmd
  const ty=parseInt(today.slice(0,4),10), tm0=parseInt(today.slice(5,7),10)-1;
  const fyStartYear=(tm0>=fyStartIdx)?ty:ty-1;
  const monthsInFY=Math.min(12,Math.max(1,(ty-fyStartYear)*12+(tm0-fyStartIdx)+1));
  return { fyStartIdx, fyStartYear, monthsInFY, curFyIdx:Math.min(11,Math.max(0,monthsInFY-1)), today };
}
window._fyContext = _fyContext;

// L9: the ONE answer to "which month index does this period mean" — month ⇒ the month browsed in the
// Month view (currentMonthIdx), quarter ⇒ TODAY's fiscal quarter, year ⇒ none. The native engine
// (_periodWindow) and every request that sends a period intent to the server (_cogsPeriodParams,
// _applyConvertedKPIs) use it, so a Quarter view never mixes two quarters. Before, the requests sent
// currentMonthIdx for quarter too: browse to June, switch to Quarter, and COGS / the display-currency
// KPIs came back for Q2 while revenue and expenses were Q3.
function _periodIntentIdx(period){
  const { curFyIdx } = _fyContext();
  if(period==='month') return (typeof currentMonthIdx!=='undefined') ? currentMonthIdx : curFyIdx;
  if(period==='quarter') return curFyIdx;
  return null;
}
window._periodIntentIdx = _periodIntentIdx;

function _periodWindow(period, monthIdx){
  // F87: boundaries come from the canonical resolver as 'YYYY-MM-DD' STRINGS, inWin is a STRING
  // compare + D2 (never recognise a row dated after today) — identical to the server. No
  // new Date(y,m,1) local midnight anywhere; `start`/`end` are strings now (callers send intent).
  const { fyStartIdx, curFyIdx } = _fyContext();
  const today=_entityToday();
  const _MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _lbl=ymd=>_MN[parseInt(ymd.slice(5,7),10)-1]+' '+ymd.slice(0,4);              // 'YYYY-MM-DD' → 'Mon YYYY'
  const _absOf=ymd=>parseInt(ymd.slice(0,4),10)*12+(parseInt(ymd.slice(5,7),10)-1);
  const _lastLbl=end=>{const a=_absOf(end)-1;return _MN[a%12]+' '+Math.floor(a/12);};   // last INCLUDED month (end is exclusive)
  const kind=(period==='month'||period==='quarter')?period:'year';
  const idx=(kind==='year') ? null : ((monthIdx==null) ? _periodIntentIdx(kind) : monthIdx);   // L9
  const rp=window.FinFlowDates.resolvePeriod({ period:kind, monthIdx:idx, fyStartMonth:fyStartIdx, today });
  const start=rp.start, end=rp.end;                                                    // half-open [start,end) strings
  const inWin=d=>{const y=window.FinFlowDates._toYmd(d);return y!=null&&y<=today&&y>=start&&y<end;};
  let label;
  if(kind==='month') label=_lbl(start);
  else if(kind==='quarter'){ const q=Math.floor(idx/3); label='Q'+(((q%4)+4)%4+1)+' · '+_lbl(start)+' – '+_lastLbl(end); }
  else label='Year to date · '+_lbl(start)+' – '+_lbl(today);   // FIX-2: inWin stops at today (D2), so the label does too
  return { inWin, elapsedMonths:rp.elapsedMonths, label, start, end };
}
window._periodWindow = _periodWindow;

// ── F57 / decision D3 — CASH-BASIS period summation ─────────────────────────────────────────
// Sums the monthly rows from POST /api/reports/cash-flow (the SAME endpoint the Cash Flow
// report reads) over a period window. Pure: rows in, totals out, no DOM and no fetch — so the
// arithmetic is testable without booting the app (Rule 5: assert on executed values).
//
// Each row is a whole MONTH keyed 'YYYY-MM', so it is filed by its first day. That is correct
// against _periodWindow's half-open [start,end) string compare: a month belongs to a period iff
// its first day does. NOTE the D2 clause in inWin (`y <= today`) applies to that first day, not
// to the events inside the row — the server's cash-flow endpoint applies no D2 of its own, so a
// future-dated cash event inside the CURRENT month is included. That matches what the Cash Flow
// report already shows (same rows, same source), and the seed has no future cash event, so it is
// not exercised either way — recorded here because it is a real difference from the accrual
// path's per-row D2, not a settled equivalence.
function cashForPeriod(rows, period, monthIdx){
  const w = _periodWindow(period, monthIdx);
  let cin = 0, cout = 0;
  (rows || []).forEach(r => {
    if (w.inWin(r.key + '-01')) { cin += parseFloat(r.inflow) || 0; cout += parseFloat(r.outflow) || 0; }
  });
  return { in: cin, out: cout, net: cin - cout };
}
window.cashForPeriod = cashForPeriod;

// Boot-time cache of the cash-flow rows. Populated once at init so the dashboard card does not
// depend on the Cash Flow report having been opened first (the load-order trap, Rule 13 — the
// same shape as the credit-note boot question in F58). Null = not yet loaded, which the card
// renders as '…' rather than as a confident 0.
window._cashMonthly = null;
async function _loadCashMonthly(){
  try{
    const r = await fetch('/api/reports/cash-flow',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!r.ok) return;
    const d = await r.json();
    window._cashMonthly = d.rows || [];
    // Repaint: the boot fetch resolves AFTER the first paint, so without this the card keeps
    // whatever it showed while loading (F55/F102 class — data landing with nothing re-reading it).
    if(typeof updateCashflow==='function') updateCashflow();
  }catch(_){ /* leave null → card shows '…', never a fabricated 0 */ }
}
window._loadCashMonthly = _loadCashMonthly;

// ════════════════════════════════════════════
// CANONICAL OUTSTANDING / AR  (single source of truth — F56)
// ════════════════════════════════════════════
// Mirrors the server's computeBooks AR leg EXACTLY (server.js ~4110):
//   Σ max(0, amount − amount_paid) over RECOGNIZED statuses.
// NOT "Σ amount where status !== 'paid'", which three separate client surfaces used and which
// was wrong twice over: it counted the FULL amount of a partially-paid invoice (ignoring what
// had already been collected), and it counted rows in non-recognized statuses (draft/void) that
// the server excludes. A fully-paid invoice has amount_paid == amount, so it contributes 0 on
// its own — no status filter is needed, and the max(0, …) floor stops an over-credited invoice
// subtracting from receivables. Returns the counts too so callers never re-derive them.
// AR is an all-time balance-sheet figure by design — it does NOT take a period window.
function arOutstanding(invoices){
  const RECOGNIZED = ['pending','overdue','partial','paid'];
  // D2 — a future-dated invoice is SCHEDULED, not yet receivable (mirrors the server AR leg).
  const _arToday = _entityToday();
  let total=0, count=0, overdueTotal=0, overdueCount=0;
  // FA-M2: overdue and credits are kept PER CUSTOMER (the same contact key as server.js _contactKey — case and spacing
  // never split a customer), so a credit note nets only its own customer's overdue.
  const _ck=v=>String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ');
  const _ovdBy={}, _cnBy={};
  (invoices||[]).forEach(i=>{
    const st=(i.status||'').toLowerCase();
    if(!RECOGNIZED.includes(st)) return;
    const _dy=window.FinFlowDates._toYmd(i.issue_date||i.created_at||i.date);
    if(_dy==null||_dy>_arToday) return;   // D2: exclude scheduled (future) invoices
    const due=Math.max(0,(parseFloat(i.amount)||0)-(parseFloat(i.amount_paid)||0));
    if(due<=0) return;
    total+=due; count++;
    // F-C1: overdue = unpaid & past its due date (entity-local today), not a literal 'overdue' status.
    const _ovd=window.FinFlowDates._toYmd(i.due_date);
    if(st==='overdue' || (_ovd!=null && _ovd<_arToday)){ overdueTotal+=due; overdueCount++; const k=_ck(i.client); _ovdBy[k]=(_ovdBy[k]||0)+due; }
  });
  // F58 CLOSE: open|applied credit notes are a receivable contra — the customer owes that much less.
  // Net them out of the AR TOTAL so the dashboard Outstanding, the AR report total and the server
  // balance sheet (computeBooks.outstanding) all agree on the SAME net receivable. Same basis as the
  // server: status open|applied, D2-bounded (date <= today). Floored at 0.
  let _cnTotal=0;
  (window.creditNotes||[]).forEach(cn=>{
    const cst=(cn.status||'').toLowerCase();
    if(cst!=='open'&&cst!=='applied') return;
    const _cy=window.FinFlowDates._toYmd(cn.date||cn.created_at);
    if(_cy==null||_cy>_arToday) return;
    const c=Math.max(0,(parseFloat(cn.amount)||0)-(parseFloat(cn.applied)||0));   // FA-M6b: the applied part is already off its invoice
    _cnTotal+=c;
    const k=_ck(cn.customer||cn.client); _cnBy[k]=(_cnBy[k]||0)+c;
  });
  const invoiceTotal=total;   // LA6: before the credit-note contra — the captions show what makes up the net figure
  total=Math.max(0,total-_cnTotal);
  // L35: overdue nets the SAME contra and is clamped to [0, total] — mirror of computeBooks.arSummary.overdueTotal
  // and /api/reports `overdue` (server.js). Un-netted it read ABOVE outstanding whenever a credit note was open
  // (live: Overdue $14,300 > Outstanding $13,550) — impossible, overdue is a subset of outstanding.
  // FA-M2: …but only each customer's OWN credits, never below 0 for that customer (one customer's credit used to hide
  // another's past-due money). Mirror of computeBooks.arSummary.overdueTotal.
  overdueTotal=Math.max(0,Math.min(total,Object.keys(_ovdBy).reduce((s,k)=>s+Math.max(0,_ovdBy[k]-(_cnBy[k]||0)),0)));
  return { total, count, overdueTotal, overdueCount, invoiceTotal, creditTotal:_cnTotal };
}
window._arOutstanding = arOutstanding;
// LA6 (live audit 2026-10-13 M3): "Outstanding $2,400 · 2 invoices" while the two invoices totalled $2,700 — the open
// credit note is netted in (correct: an issued credit note reduces what the customer owes, applied or not), but the
// caption hid it. Every caption of the net Outstanding appends this, so it says what the figure is made of.
// showAmounts=false under a display currency (F59: native amounts never under a foreign symbol).
window._arCreditSuffix = function(ar, money, showAmounts){
  if(!ar || !(ar.creditTotal > 0.005)) return '';
  if(showAmounts === false) return ' · less credit notes';
  return ' · ' + money(ar.invoiceTotal) + ' less ' + money(ar.creditTotal) + ' in credit notes';
};

// N20 (dashboard parity): the CLIENT mirror of the server's manual-journal P&L leg. The server
// (computeBooks) reads posted journals back FROM the GL (source_type='journal') and folds the
// income leg into revenue and the expense leg into opex. These helpers reproduce that leg on the
// client from window._journals so the dashboard KPIs + chart agree with the P&L/Reports/GL (Rule 6).
// Classification is the EXACT mirror of the server's _journalLineType (server.js): leading digit of
// the account code → type (1 asset · 2 liability · 3 equity · 4 income · 5-9 expense). A journal's
// GL posting is ABORTED server-side if any line is untypeable, so such a journal contributes 0 to
// the GL (and thus to computeBooks) — mirrored here by skipping it. Draft journals are not in the
// GL, so only status 'Posted' counts; a reversed (Posted→Draft) journal drops out by the same gate.
function _jLineType(code){
  const d = String(code == null ? '' : code).trim()[0];
  return d === '1' ? 'asset' : d === '2' ? 'liability' : d === '3' ? 'equity'
       : d === '4' ? 'income' : (d >= '5' && d <= '9') ? 'expense' : null;
}
window._jLineType = _jLineType;
// Sum the posted-journal income/expense legs over the window `w` (a _periodWindow result).
// income line = credit − debit (4xxx); expense line = debit − credit (5xxx-9xxx). Returns native
// amounts, matching the other client legs (display-currency views use the server-converted KPIs).
function _journalPnL(w){
  let income = 0, expense = 0;
  const js = window._journals || [];
  for(const j of js){
    if(String(j.status || '').toLowerCase() !== 'posted') continue;
    if(!w.inWin(j.date || j.created_at)) continue;
    let lines = [];
    try { lines = Array.isArray(j.lines) ? j.lines : JSON.parse(j.lines || '[]'); } catch(_){ lines = []; }
    let inc = 0, exp = 0, bad = false;
    for(const l of lines){
      const t = _jLineType(l.code != null ? l.code : l.account);
      if(!t){ bad = true; break; }                 // untypeable ⇒ server never booked it ⇒ 0
      const dr = parseFloat(l.debit) || 0, cr = parseFloat(l.credit) || 0;
      if(t === 'income')  inc += (cr - dr);
      else if(t === 'expense') exp += (dr - cr);
    }
    if(bad) continue;
    income += inc; expense += exp;
  }
  return { income, expense };
}
window._journalPnL = _journalPnL;

function computeRevenue(period, monthIdx){
  period = period || (typeof currentPeriod !== 'undefined' ? currentPeriod : (window.currentPeriod || 'year'));
  // Issue-based accrual (F32) over the SELECTED period window (F33/F25): recognize every
  // ISSUED invoice at its FULL amount in the period of its ISSUE date (created_at), plus
  // cash sales receipts in the window. No new Date()-only window; the stepper's month is
  // honored via _periodWindow. Reads window.receipts (the name the loader sets).
  const w = _periodWindow(period, monthIdx);
  const RECOGNIZED = ['pending','overdue','partial','paid'];
  const isIssued = i => RECOGNIZED.includes((i.status||'').toLowerCase());
  const invoices = window._realInvoices || [];
  const receipts = window.receipts      || [];
  let rev = 0;
  // F36: recognize on issue_date; created_at fallback is a TIME-BOXED transition (created_at is
  // UTC; at a negative UTC offset a first-of-month row can misassign locally — see server
  // computeBooks issueDate). Retire the fallback once every row carries issue_date.
  invoices.forEach(i => { if(isIssued(i) && w.inWin(i.issue_date || i.created_at || i.date)) rev += parseFloat(i.amount)||0; });
  receipts.forEach(r => { if(w.inWin(r.date)) rev += parseFloat(r.amount)||0; });
  // F58 — CREDIT NOTES reduce revenue (contra leg). Mirror of the server's creditNotesTotal in
  // computeBooks: same Open/Applied allowlist (credit notes have their OWN vocabulary — see
  // server.js:2307 — NOT the invoice one), same `date` field, same window. Rule 6: this must
  // agree with the server because they are two implementations of one figure.
  // AR is deliberately NOT reduced — P&L contra only, per the F58 scope decision.
  const RECOGNIZED_CREDIT = ['open','applied'];
  (window.creditNotes || []).forEach(cn => {
    if(RECOGNIZED_CREDIT.includes((cn.status||'').toLowerCase()) && w.inWin(cn.date || cn.created_at)) rev -= parseFloat(cn.amount)||0;
  });
  // N20: posted manual journals' INCOME leg (4xxx accounts) flows into revenue — the client mirror
  // of the server's jeRevenue (computeBooks reads it from the GL). Same window. Rule 6: must equal
  // the server, so the dashboard Revenue KPI matches the P&L/Reports/GL once a journal is posted.
  rev += _journalPnL(w).income;
  return rev;
}
window.computeRevenue = computeRevenue;

// ════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════
// Mobile quick-add FAB — single source of the pages where the "+" has an action. On every
// other page (dashboard/banking/reports/budget/mrr/…) the FAB used to just toast a useless
// "choose a section", so it's hidden there. showPage syncs it on each page change; the FAB
// onclick reuses this same set to dispatch.
const FAB_PAGES = ['invoices','expenses','customers','personal'];
window.FAB_PAGES = FAB_PAGES;
function _syncMobileFab(id){
  const f = document.querySelector('.mobile-fab');
  if(!f) return;
  // Inline display toggles only the MOBILE case: '' falls back to the @media(max-width:700px)
  // .mobile-fab display:flex; 'none' hides it. The @media(min-width:701px) !important rule keeps
  // it hidden on desktop regardless, so this never resurfaces the FAB there.
  f.style.display = FAB_PAGES.includes(id) ? '' : 'none';
}
window._syncMobileFab = _syncMobileFab;

// FA-B12: a page change closes every open form (.modal-overlay) — a form belongs to the page it was opened on. The Cowork
// test stacked 15 forms open across page changes. Closed through closeModal (its wrappers reset edit state / focus trap);
// a form shown by style.display is hidden the same way. The confirm dialog and onboarding are not forms (other classes).
function _ffCloseOpenForms(){
  document.querySelectorAll('.modal-overlay').forEach(m=>{
    const shown = !m.classList.contains('hidden') && m.style.display !== 'none';
    if(!shown) return;
    if(m.style.display){ m.style.display = 'none'; return; }   // a form shown by style.display (e.g. edit employee) is closed the same way it opens
    try { if(m.id && typeof window.closeModal==='function') window.closeModal(m.id); else m.classList.add('hidden'); } catch(_){ m.classList.add('hidden'); }
  });
}
window._ffCloseOpenForms=_ffCloseOpenForms;
function showPage(id, el){
  _ffCloseOpenForms();   // FA-B12
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+id);
  if(pg)pg.classList.add('active');
  if(el)el.classList.add('active');
  const titles={
    dashboard:'Dashboard',cashflow:'Cash flow',customers:'Customers',invoices:'Invoices',
    expenses:'Expenses',payroll:'Payroll',inventory:'Inventory',connections:'API Connections',
    personal:'Personal Finance',ai:'AI Insights',settings:'Settings',
    items:'Items',banking:'Banking',quotes:'Quotes','sales-receipts':'Sales Receipts',
    'payments-received':'Payments Received','recurring-invoices':'Recurring Invoices',
    'credit-notes':'Credit Notes',vendors:'Vendors',bills:'Bills','payments-made':'Payments Made',
    'recurring-bills':'Recurring Bills','vendor-credits':'Vendor Credits',
    projects:'Projects',timesheet:'Timesheet','manual-journals':'Manual Journals',
    'chart-of-accounts':'Chart of Accounts','transaction-locking':'Transaction Locking',
    reports:'Reports',documents:'Documents',templates:'Templates','scheduled-documents':'Scheduled Documents',
    investments:'Investments',
    'create-business':'Create Business',
  };
  document.getElementById('pageTitle').textContent=titles[id]||id;
  _syncMobileFab(id);   // hide the mobile quick-add FAB on pages with no add action
  // Page-specific renders — every call typeof-guarded so a missing wiring
  // file (or a render function loaded later via deferred IIFE) never throws
  // ReferenceError and crashes the rest of showPage. The cascade-fail was
  // what was nuking sibling KPI updates further down the function.
  const _call = (fn) => { try { fn(); } catch (e) { console.warn('[showPage] render error for', id, ':', e.message); } };
  if(id==='investments'&&typeof renderInvestments==='function')_call(renderInvestments);
  if(id==='cashflow'&&typeof renderCashflow==='function')_call(renderCashflow);
  if(id==='customers'&&typeof renderCustomers==='function')_call(renderCustomers);
  if(id==='payroll'&&typeof renderPayroll==='function')_call(renderPayroll);
  if(id==='personal'&&typeof renderPersonal==='function')_call(renderPersonal);
  if(id==='invoices'&&typeof renderInvoices==='function')_call(renderInvoices);
  if(id==='expenses'&&typeof renderExpenses==='function')_call(renderExpenses);
  if(id==='inventory'&&typeof renderInventory==='function')_call(renderInventory);
  if(id==='connections'&&typeof connRenderAll==='function')_call(connRenderAll);
  if(id==='ai'&&typeof updateAI==='function')_call(updateAI);
  if(id==='items'&&typeof renderItems==='function')_call(renderItems);
  if(id==='banking'&&typeof renderBanking==='function')_call(renderBanking);
  if(id==='quotes'&&typeof renderQuotes==='function')_call(renderQuotes);
  if(id==='sales-receipts'&&typeof renderReceipts==='function')_call(renderReceipts);
  if(id==='payments-received'&&typeof renderPaymentsReceived==='function')_call(renderPaymentsReceived);
  if(id==='recurring-invoices'&&typeof renderRecurringInvoices==='function')_call(renderRecurringInvoices);
  if(id==='credit-notes'&&typeof renderCreditNotes==='function')_call(renderCreditNotes);
  if(id==='vendors'&&typeof renderVendors==='function')_call(renderVendors);
  if(id==='bills'&&typeof renderBills==='function')_call(renderBills);
  if(id==='payments-made'&&typeof renderPaymentsMade==='function')_call(renderPaymentsMade);
  if(id==='recurring-bills'&&typeof renderRecurringBills==='function')_call(renderRecurringBills);
  if(id==='vendor-credits'&&typeof renderVendorCredits==='function')_call(renderVendorCredits);
  if(id==='projects'&&typeof renderProjects==='function')_call(renderProjects);
  if(id==='timesheet'&&typeof renderTimesheet==='function')_call(renderTimesheet);
  if(id==='manual-journals'&&typeof renderJournals==='function')_call(renderJournals);
  if(id==='chart-of-accounts'&&typeof renderCOA==='function')_call(renderCOA);
  if(id==='transaction-locking'&&typeof renderLockHistory==='function')_call(renderLockHistory);
  if(id==='reports'&&typeof renderReports==='function')_call(renderReports);
  if(id==='documents'&&typeof renderDocuments==='function')_call(renderDocuments);
  if(id==='templates'&&typeof renderTemplates==='function')_call(renderTemplates);
  // Trigger bar animations on the new page
  setTimeout(()=>{ if(pg) animateBarsOnPage(pg); },80);
  // Animate metric counters
  setTimeout(()=>{ if(pg) animateCounters(pg); },60);
}

// ── ANIMATED PROGRESS BARS ────────────────────────────────────────────────
function animateBarsOnPage(page){
  const fills=page.querySelectorAll('.bar-fill,.stock-fill');
  fills.forEach(el=>{
    const inlineW=el.style.width;
    if(!inlineW||inlineW==='0%')return;
    el.style.setProperty('--bar-w',inlineW);
    el.style.width='0%';
    el.closest('.bar-row,.inv-item-row')?.classList.remove('bars-animated');
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{el.style.width=inlineW;});
    });
  });
}

// ── ANIMATED METRIC COUNTERS ──────────────────────────────────────────────
// LA1 (live audit 2026-10-13 B1): animateCounter / animateCounters live in finflow-counter.js (loaded
// before this file). The copy that was here replayed its start-of-animation snapshot over a value
// painted later — a card showing "$0" when the animation began ended at "$0" after the real figure
// landed. Do not re-declare them here: a top-level function declaration would shadow the fixed one.

// ════════════════════════════════════════════
// PERIOD SWITCHER
// ════════════════════════════════════════════
function setPeriod(el, p){
  currentPeriod=p;
  window.currentPeriod=p; // keep the bundle's KPI engine in sync with the period switcher
  ['pMonth','pQ','pY'].forEach(id=>{
    const b=document.getElementById(id);
    b.style.borderColor='var(--bd2)';b.style.color='var(--t2)';
  });
  el.style.borderColor='var(--acc)';el.style.color='var(--acc)';
  // Show/hide month navigator
  document.getElementById('month-nav').style.display=p==='month'?'flex':'none';
  refreshAllPeriodData();
}
function shiftMonth(dir){
  currentMonthIdx=Math.max(0,Math.min(11,currentMonthIdx+dir));
  document.getElementById('month-nav-label').textContent=MONTH_FULL[currentMonthIdx];
  document.getElementById('month-next').disabled=currentMonthIdx===11;
  refreshAllPeriodData();
}
function refreshAllPeriodData(){
  // Brief skeleton flash on chart containers
  document.querySelectorAll('.canvas-wrap').forEach(el=>{el.classList.add('loading')});
  setTimeout(()=>document.querySelectorAll('.canvas-wrap').forEach(el=>el.classList.remove('loading')),220);
  const d=getPeriodData();
  // Update period label in topbar
  document.getElementById('period-label').textContent=d.label;
  // Keep the month navigator label fresh too (previously only shiftMonth set it, so
  // it could show a stale value on first entry into Month view).
  const _mnl=document.getElementById('month-nav-label');
  if(_mnl && typeof MONTH_FULL!=='undefined' && MONTH_FULL.length) _mnl.textContent=MONTH_FULL[currentMonthIdx];
  updateDashboard(d);
  updateCashflow(d);
  updateExpenses(d);
  if(typeof window._loadBudgetFromDB==='function'){ try{ window._loadBudgetFromDB(); }catch(_){} }   // LR19: the Budget page follows the period too
  if(typeof window.updateInvoices==='function') window.updateInvoices(d);
  updateCharts(d);
  updateAI(d);
  // F25: COGS is period-scoped like revenue/expenses. updateDashboard above paints Net with the
  // PREVIOUS period's cached COGS (correct for year, where COGS == all-time); this async refetch
  // corrects it for month/quarter and repaints only if it changed (paint-then-correct, exactly as
  // the FX overlay does). Skipped when computeExpenseBreakdown-style data isn't ready yet.
  if(typeof _loadPeriodCOGS==='function') _loadPeriodCOGS();
}

// Text form of the active period's date range — for the AI suggested-prompt seed
// (kept dynamic instead of a hardcoded "May 2025 – April 2026").
window._ffPeriodRangeText = function(){
  return (typeof MONTH_FULL!=='undefined' && MONTH_FULL.length) ? (MONTH_FULL[0]+' – '+MONTH_FULL[11]) : 'the current fiscal year';
};
// Populate the topbar + AI date labels from the COMPUTED fiscal range. Called on load
// (so no stale hardcoded sample date ever shows before the first dashboard render) and
// after a fiscal-year change. Safe pre-auth: only reads MONTH_FULL / currentPeriod.
function _ffSyncPeriodLabels(){
  try{
    const d=getPeriodData();
    const set=(id,v)=>{const el=document.getElementById(id); if(el && v!=null) el.textContent=v;};
    set('period-label', d.label);
    set('ai-period-label', d.label);
    if(typeof MONTH_FULL!=='undefined' && MONTH_FULL.length)
      set('month-nav-label', MONTH_FULL[typeof currentMonthIdx!=='undefined'?currentMonthIdx:0]);
  }catch(_){}
}
window._ffSyncPeriodLabels=_ffSyncPeriodLabels;
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', _ffSyncPeriodLabels);
else _ffSyncPeriodLabels();

// ════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════
function updateDashboard(d=getPeriodData()){
  // F151: every dashboard paint reschedules the boot-splash lift (no-op once the splash is gone), so
  // the splash covers ALL the boot "blinks" and lifts only after the numbers settle.
  if(typeof window._bootSplashSettle==='function') window._bootSplashSettle();
  // F98: a failed entities load latches window._dashLoadError. SAME SHAPE as the _fxPending guard
  // a few lines down (comment "Honest-empty over confidently-wrong") — a second boolean flag on
  // the paint, not a new mechanism. updateDashboard is the canonical writer of d-rev/d-exp/d-profit
  // (and _applyConvertedKPIs, its only other writer, is called from here), so guarding here is what
  // makes the error state STICK instead of being overwritten by a fabricated $0 computed from the
  // empty client stores. Delegates to the shared error renderer and paints nothing else.
  // The flag is set ONLY on genuine failure (never on a successful-but-empty load), so a brand-new
  // user with zero entities never lands here.
  if(window._dashLoadError){
    if(typeof window._dashSetState==='function'){ try{ window._dashSetState('error'); }catch(_){} }
    return;
  }
  // Expenses/Profit use the canonical total (real expenses + bill payments +
  // elapsed-month payroll) so this matches the Expenses page, AI insights and
  // health score even if the bundle's KPI engine hasn't run yet.
  const _ddBd = (typeof computeExpenseBreakdown==='function') ? computeExpenseBreakdown() : null;
  const _ddExp = _ddBd ? _ddBd.total : (d.exp||0);
  const _ddRev = (typeof computeRevenue==='function') ? computeRevenue() : (d.rev||0);
  // Canonical Net = Revenue − COGS − OpEx. COGS is the entity-scoped FIFO total stashed by
  // loadCOGS/boot (window._cogsTotal); non-inventory businesses → 0 → net == rev − opex.
  const _ddCogs = parseFloat(window._cogsTotal)||0;
  const _ddProfit = _ddRev - _ddCogs - _ddExp;
  // F34 Step 2 / F59: with a non-native display currency active, do NOT paint the native figures
  // first. S() stamps the DISPLAY currency's symbol, so a native value written here renders under
  // a foreign sign for the whole fetch — mislabelled money, and permanently so if the fetch failed
  // (pre-F59 it returned silently). Paint an honest loading dash instead; _applyConvertedKPIs fills
  // in the server-converted figures, or "—" + a hint when it cannot. Honest-empty over
  // confidently-wrong. Native path is unchanged — byte-identical to before.
  const _fxPending = !!window._displayCurrency;
  document.getElementById('d-rev').textContent    = _fxPending ? '…' : _fmtMoneyAbbr(_ddRev);
  document.getElementById('d-exp').textContent    = _fxPending ? '…' : _fmtMoneyAbbr(_ddExp);
  document.getElementById('d-profit').textContent = _fxPending ? '…' : _fmtMoneyAbbr(_ddProfit);
  if(_fxPending) _applyConvertedKPIs(window._displayCurrency);
  else _applyServerBooks();   // money audit 2026-10-09 (M10/M29/M37/M38/M39): the native path reads the server books too
  document.getElementById('d-chart-title').textContent='Revenue vs Expenses — '+d.label;
  // Prior-period baseline from the SAME windowed compute (same basis, payroll included) — NOT
  // the old getPeriodData REV[]/EXP[] arrays, which used a different (payroll-excluded) basis
  // and a stepper-varying index against a now-pinned numerator → the F33 ↑700%/↓39% deltas.
  let _pRev=null,_pExp=null,_pProfit=null;
  if(currentPeriod==='month'){
    _pRev = computeRevenue('month', currentMonthIdx-1);
    _pExp = computeExpenseBreakdown('month', currentMonthIdx-1).total;
    _pProfit = _pRev - _pExp;                       // COGS is an all-time snapshot, not period-delta'd
  } else if(currentPeriod==='quarter'){
    const _priorQ = _fyContext().curFyIdx - 3;      // one fiscal quarter before the current one
    _pRev = computeRevenue('quarter', _priorQ);
    _pExp = computeExpenseBreakdown('quarter', _priorQ).total;
    _pProfit = _pRev - _pExp;
  } // year → null baseline → chg() shows the neutral "Year to date"
  const rc=chg(_ddRev,_pRev);
  const ec=chg(_ddExp,_pExp,true);
  const pc=chg(_ddProfit,_pProfit);
  set('d-rev-chg',rc.txt,rc.cls);
  set('d-exp-chg',ec.txt,ec.cls);
  set('d-profit-chg',pc.txt,pc.cls);
  // F56: the Outstanding card is owned SOLELY by updateKPIs (finflow-api-wiring-dashboard.js),
  // matching the ownership split already documented there for the other non-canonical cards.
  // The duplicate that used to live here was wrong three ways: it only ran on the 'year' period
  // (so Month/Quarter showed a stale figure), it used a divergent formula (Σ amount over
  // status !== 'paid', overstating every partially-paid invoice), and its subtitle printed
  // "All invoices paid" whenever nothing was OVERDUE — which is how a $1.4K Outstanding card
  // ended up captioned "All invoices paid". Two writers on one card is the F7 defect class.
  // Expense bars
  const maxE=d.sal;
  document.getElementById('exp-sal').textContent=S(d.sal);
  document.getElementById('exp-rent').textContent=S(d.rent);
  document.getElementById('exp-sw').textContent=S(d.sw);
  document.getElementById('exp-mkt').textContent=S(d.mkt);
  const _maxExpAmt=Math.max(d.sal||0,d.rent||0,d.sw||0,d.mkt||0,1);
  const _sb=function(id,amt){const el=document.getElementById(id);if(!el)return;const w=Math.round(amt/_maxExpAmt*100)+'%';el.style.setProperty('width',w,'important');el.style.setProperty('--bar-w',w);};
  _sb('exp-sal-bar',d.sal||0);_sb('exp-rent-bar',d.rent||0);_sb('exp-sw-bar',d.sw||0);_sb('exp-mkt-bar',d.mkt||0);
  // Business transactions (period-contextual) — read the SAME entity-scoped
  // source the bundle's updateTransactions uses (_realInvoices/_realExpenses),
  // never the unscoped userInvoices/bizExpenses, so this widget can't bleed
  // cross-entity rows.
  const _allTxns = [
    ...((window._realInvoices||[]).slice(0,5).map(i=>({name:i.client, cat:'Revenue · '+i.status, amt:parseFloat(i.amount)||0, type:'income'}))),
    ...((window._realExpenses||[]).slice(0,5).map(e=>({name:e.desc||e.description, cat:'Expense · '+(e.cat||e.category||'Other'), amt:parseFloat(e.amount)||0, type:'expense'}))),
  ];
  const txns = _allTxns
  document.getElementById('d-txns').innerHTML=txns.map(t=>`
    <div class="tx-row">
      <div class="tx-left">
        <div class="tx-icon ${t.type==='income'?'av-green':'av-red'}"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${t.type==='income'?'<polyline points="1,8 6,3 10,7 15,2"/><polyline points="10,2 15,2 15,7"/>':'<polyline points="1,5 5,10 9,7 15,13"/><polyline points="10,13 15,13 15,8"/>'}</svg></div>
        <div><div class="tx-name">${esc(t.name||'')}</div><div class="tx-cat">${esc(t.cat||'')}</div></div>
      </div>
      <div class="tx-amt ${t.type==='income'?'up':'dn'}">${t.type==='income'?'+':'-'}${S(t.amt)}</div>
    </div>`).join('');
  // Rebuild river diagram with current period data
  setTimeout(()=>buildRiver(d),50);
}
function set(id,txt,cls=''){const el=document.getElementById(id);if(el){el.textContent=txt;if(cls)el.className='mc-change '+cls}}

// ════════════════════════════════════════════
// CASH FLOW
// ════════════════════════════════════════════
function updateCashflow(d=getPeriodData()){
  // ── F57 / decision D3 — GENUINE CASH BASIS ────────────────────────────────────────────────
  // These three cells used to read d.rev / d.exp / d.profit — the getPeriodData() ACCRUAL
  // buckets. That was a cash-flow card showing accrual figures, and because those buckets also
  // omit payroll and COGS it was a THIRD number disagreeing with both the dashboard KPIs and
  // the Cash Flow report. Now sourced from the same POST /api/reports/cash-flow rows the report
  // reads, summed over the SAME _periodWindow — so card == report == server by construction
  // (Rule 6), not by two implementations happening to agree.
  const _cash = (typeof cashForPeriod==='function' && window._cashMonthly)
    ? cashForPeriod(window._cashMonthly, currentPeriod, currentMonthIdx) : null;
  // Honest loading state: null means the boot fetch has not resolved (or failed). A cash card
  // that renders 0 in that window is indistinguishable from a business with no cash movement.
  document.getElementById('cf-in').textContent  = _cash ? S(_cash.in)  : '…';
  document.getElementById('cf-out').textContent = _cash ? S(_cash.out) : '…';
  document.getElementById('cf-net').textContent = _cash ? S(_cash.net) : '…';
  // cf-avg and cf-runway derive from the NET, so they move to cash with it — leaving them on
  // d.profit would reintroduce the accrual/cash mix inside a single card.
  const _cashNet = _cash ? _cash.net : null;
  // M46 (money audit 2026-10-09): the average is over the months that have HAPPENED in the period (the window's
  // elapsedMonths — the same divisor the expense engine uses), not its nominal length: on 25 July the Year view
  // divided seven months of cash by 12.
  const _cfMonths = (()=>{ try{
    const _c=_fyContext().curFyIdx;
    if(currentPeriod==='month') return 1;
    if(currentPeriod==='quarter') return Math.max(1, Math.min(3, _c - Math.floor(_c/3)*3 + 1));   // months of this quarter so far
    return Math.max(1, _c + 1);                                                                 // fiscal months so far (incl. this one)
  }catch(_){ return d.months||1; } })();
  document.getElementById('cf-avg').textContent = (_cashNet!=null && _cfMonths>0) ? S(Math.round(_cashNet/_cfMonths)) : '…';
  document.getElementById('cf-avg-lbl').textContent=_cfMonths===1?'Net this month':'Avg monthly net';
  // Fixed vs variable from REAL categorised expense rows (no fabricated ratio).
  // Fixed = recurring-overhead categories; variable = everything else. Honest
  // empty state when there are no expense rows.
  // ⚠️ F57 SCOPE FLAG: this split is an ACCRUAL expense-category mix living in a cash card, and
  // it is NOT part of the cash In/Out/Net above. The period argument is now passed explicitly —
  // previously it was called with NO arguments, so it silently defaulted to `currentPeriod`
  // while the rest of the card was scoped by the caller's `d`; the two could describe different
  // windows. Whether these cells belong here at all is an owner decision, deliberately not taken
  // in this commit.
  const _cfBd = (typeof computeExpenseBreakdown==='function') ? computeExpenseBreakdown(currentPeriod, currentMonthIdx) : null;
  const _fixedCats = ['Rent','Salaries','Software','Insurance','Utilities','Lease','Subscriptions'];
  let _cfFixed=0,_cfVar=0;
  if(_cfBd){ for(const [cat,amt] of Object.entries(_cfBd.byCategory)){ if(_fixedCats.includes(cat)) _cfFixed+=amt; else _cfVar+=amt; } }
  const _cfHasExp = !!_cfBd && (_cfFixed+_cfVar)>0;
  document.getElementById('cf-fixed').textContent=_cfHasExp?S(_cfFixed):'—';
  document.getElementById('cf-variable').textContent=_cfHasExp?S(_cfVar):'—';
  // True runway = cash balance ÷ monthly burn. We don't track a cash balance,
  // so don't fabricate a number: report cash-flow status honestly instead.
  // F57: runway is a CASH statement, so it reads the cash net, not the accrual profit.
  const _monthlyNet = (_cashNet==null) ? null : (_cfMonths>0 ? _cashNet/_cfMonths : _cashNet);   // M46
  document.getElementById('cf-runway').textContent = _monthlyNet==null ? '…' : (_monthlyNet>=0 ? 'Cash-flow positive' : '—');
  // Income sources bars
  // Income sources — built from real invoice data grouped by client
  const _src_colors = ['var(--green)','#7db87d','#7db87d99','#7db87d66'];
  // M28: this period's sources, each as a share of this period's sales (same basis) — it was the all-time ranking
  // divided by the period's revenue, which could exceed 100%.
  const _srcTc = _periodTopClients(currentPeriod);
  const _srcList = _srcTc.list.slice(0,4);
  const _maxSrc = _srcList.length ? _srcList[0].total : 1;
  document.getElementById('cf-sources').innerHTML = _srcList.length
    ? _srcList.map((s,i)=>{const pct=_srcTc.total>0?Math.round(s.total/_srcTc.total*100):0;return`<div class="bar-row"><span class="bar-label">${esc(s.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${_src_colors[i]||'var(--green)'}"></div></div><span class="bar-val">${S(s.total)}</span></div>`;}).join('')
    : '<div style="color:var(--t3);font-size:12px;padding:8px 0">No revenue data yet</div>';
  // Change indicators. F57: these read d.rev/d.prevRev — ACCRUAL deltas. With the cells above
  // them now showing CASH, a delta computed on a different basis sitting under a cash figure is
  // a mislabelled number, so it is cleared rather than shown wrong. Restoring it needs a
  // prior-period CASH comparison (cashForPeriod over the preceding window); that is a real
  // change, not a relabel, and is deliberately left for the owner rather than guessed at here.
  set('cf-in-chg','','');set('cf-out-chg','','');
  // cf-net-chg replaces the hardcoded "Healthy" that index.html rendered unconditionally — it
  // read as a verdict on the books while being a literal string in the markup, true even when
  // the period was cash-flow negative. This reflects the sign of the figure actually shown.
  set('cf-net-chg', _cashNet==null ? '' : (_cashNet>=0 ? 'Positive' : 'Negative'), _cashNet==null ? '' : (_cashNet>=0 ? 'up' : 'dn'));
}
function renderCashflow(){updateCashflow()}

// ════════════════════════════════════════════
// INVOICES
// ════════════════════════════════════════════
// LA7 (live audit 2026-10-13): updateInvoices lives ONLY in finflow-api-wiring-postgres.js (window.updateInvoices —
// the F56/D2/M27 AR definition). The copy that stood here was shadowed (never executed — instrumented boot, 0 calls)
// and still held the pre-F56 Outstanding formula (Σ amount over status ≠ paid: drafts and partial payments counted
// whole). Deleted so it cannot regrow if the override ever moves (Rule 1). Callers below go through window.
function renderInvoices(){
  if(typeof window.updateInvoices==='function') window.updateInvoices();
  if(!userInvoices) userInvoices=[];
  const badgeCls={'paid':'b-green','pending':'b-amber','overdue':'b-red','partial':'b-blue'};
  document.getElementById('invoice-list').innerHTML=userInvoices.map((inv,idx)=>{
    const paid=parseFloat(inv.amount_paid)||0;
    const total=parseFloat(inv.amount)||0;
    const paidStr=paid>0?S(paid):'—';
    const statusLabel=inv.status==='partial'?`partial (${S(paid)} of ${S(total)})`:inv.status;
    return`<div class="table-row inv-cols">
      <span>${esc(inv.client)}</span>
      <span style="font-weight:600;font-family:var(--font-mono)">${esc(S(inv.amount))}</span>
      <span style="font-family:var(--font-mono);color:${paid>0?'var(--green)':'var(--t3)'}">${paidStr}</span>
      <span style="color:${esc(inv.color)}">${esc(inv.due)}</span>
      <span class="table-actions" style="display:flex;gap:4px;flex-wrap:wrap">
        <span class="badge ${badgeCls[inv.status]||'b-amber'}">${esc(statusLabel)}</span>
        ${inv.status!=='paid'?`<button class="btn btn-ghost btn-sm inv-remind-btn" style="font-size:10px;padding:3px 7px" data-idx="${Number(idx)}" data-id="${inv.id||''}" data-client="${esc(inv.client)}" data-amount="${esc(S(inv.amount))}">Record Payment</button>`:''}
        ${inv.status==='overdue'?`<button class="btn btn-ghost btn-sm inv-remind-btn-r" style="font-size:10px;padding:3px 7px" data-idx="${Number(idx)}" data-client="${esc(inv.client)}" data-amount="${esc(S(inv.amount))}">Remind ↗</button>`:''}
      </span>
    </div>`;
  }).join('');
  // Record Payment button delegation
  document.getElementById('invoice-list').querySelectorAll('.inv-remind-btn').forEach(btn=>{
    btn.onclick=function(){
      const invId=this.getAttribute('data-id');
      const invIdx=this.getAttribute('data-idx');
      openRecordPaymentModal(invId||invIdx,this.getAttribute('data-client'),this.getAttribute('data-amount'));
    };
  });
}
// Event delegation for invoice remind buttons — no user data embedded in onclick
document.addEventListener('click', function(e){
  const btn = e.target.closest('.inv-remind-btn');
  if(!btn) return;
  const client = btn.getAttribute('data-client') || 'the client';
  const amount = btn.getAttribute('data-amount') || 'the outstanding amount';
  sendPrompt(`Write a professional overdue invoice reminder for ${esc(client)} — amount due: ${amount}`);
});
function markInvoicePaid(idx){
  userInvoices[idx].status='paid';
  userInvoices[idx].color='var(--t2)';
  renderInvoices();
  notify('Invoice marked as paid');
}
// Batch 9 (D3): the invoice / bill forms PICK from this business's saved contacts (a typed new name is still fine — the
// server saves it as a contact). The list is refreshed every time the form opens, so a contact saved elsewhere appears.
async function _fillContactPicker(inputId, listId, url, nameOf){
  const inp=document.getElementById(inputId); if(!inp) return;
  let dl=document.getElementById(listId);
  if(!dl){ dl=document.createElement('datalist'); dl.id=listId; document.body.appendChild(dl); }
  inp.setAttribute('list', listId); inp.setAttribute('autocomplete','off');
  try {
    const r=await fetch(url,{credentials:'include'}); const rows=r.ok?await r.json():[];
    const names=[...new Set((Array.isArray(rows)?rows:[]).map(nameOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    dl.innerHTML=names.map(n=>`<option value="${esc(n)}"></option>`).join('');
  } catch(_){}
}
window._fillContactPicker=_fillContactPicker;
const _custDisplayName=c=>String(c.company||'').trim()||`${c.fname||''} ${c.lname||''}`.trim();
window._custDisplayName=_custDisplayName;
// FA-U1: the theme's tertiary text colour (4.5:1+ on every background in both themes) — chart axis labels read it.
window._ffT3=function(){ try { return getComputedStyle(document.documentElement).getPropertyValue('--t3').trim()||'#988a72'; } catch(_){ return '#988a72'; } };
// FA-B8: every currency select offers every currency FinFlow supports (finflow-currency.js — Create Business, Settings
// and onboarding offered 6, 6 and 5). The value already chosen is kept.
function _ffFillCurrencySelects(){
  const T=(window.FinFlowCurrency&&window.FinFlowCurrency.CURRENCIES)||null; if(!T) return;
  const codes=Object.keys(T).sort((a,b)=>a.localeCompare(b));
  ['nb-currency','s-currency','ob-currency'].forEach(id=>{
    const sel=document.getElementById(id); if(!sel||sel._ffAllCur) return;
    const cur=sel.value||'USD';
    sel.innerHTML=codes.map(c=>'<option value="'+c+'">'+c+' — '+esc(T[c].name||c)+' ('+esc(T[c].symbol||c)+')</option>').join('');
    sel.value=codes.includes(cur)?cur:'USD'; sel._ffAllCur=true;
  });
}
window._ffFillCurrencySelects=_ffFillCurrencySelects;
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',_ffFillCurrencySelects); else _ffFillCurrencySelects();
// FA-B4: every document that names a customer / vendor offers the saved ones (the server saves and links a new name).
window._pickCustomer=id=>_fillContactPicker(id,'ff-cust-list','/api/customers',_custDisplayName);
window._pickVendor=id=>_fillContactPicker(id,'ff-vend-list','/api/vendors',v=>v.name);
// Batch 9 (D3): "Save all…" — a preview of every name from invoices (or bills) not saved as a contact. Each is ticked,
// EXCEPT a name that looks like a contact already saved ("ACME Limited" ~ "Acme Ltd"): that one starts unticked with the
// reason, so a near-duplicate is never created by accident. Nothing is saved until "Save selected".
window.openSaveAllContacts=async function(kind){
  const base=kind==='vendor'?'/api/vendors':'/api/customers', what=kind==='vendor'?'vendor':'customer';
  let rows=[]; try { const r=await fetch(base+'/unsaved',{credentials:'include'}); rows=r.ok?await r.json():[]; } catch(_){}
  if(!rows.length){ notify('Every name is already saved as a '+what+'.'); return; }
  const ex=document.getElementById('ff-saveall'); if(ex) ex.remove();
  const o=document.createElement('div'); o.id='ff-saveall';
  o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem';
  o.innerHTML='<div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-lg);padding:1.25rem;max-width:460px;width:100%;max-height:80vh;overflow:auto">'
    +'<div style="font-size:15px;font-weight:600;margin-bottom:4px">Save '+rows.length+' name'+(rows.length===1?'':'s')+' as '+what+'s</div>'
    +'<div style="font-size:12px;color:var(--t3);margin-bottom:10px">Untick any you do not want. A name that looks like one you already have starts unticked.</div>'
    +rows.map(u=>`<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--bd);font-size:13px;cursor:pointer"><input type="checkbox" data-name="${esc(u.name)}" ${u.similar_to?'':'checked'} style="margin-top:3px"><span><span style="color:var(--t1)">${esc(u.name)}</span>${u.similar_to?`<br><span style="font-size:11.5px;color:var(--amber)">Looks like your ${what} “${esc(u.similar_to)}” — tick only if it is a different one</span>`:''}</span></label>`).join('')
    +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" id="ff-saveall-no" style="font-size:12px">Cancel</button><button class="btn btn-primary" id="ff-saveall-yes" style="font-size:12px">Save selected</button></div></div>';
  document.body.appendChild(o);
  const close=()=>o.remove();
  o.addEventListener('click',e=>{ if(e.target===o) close(); });
  document.getElementById('ff-saveall-no').onclick=close;
  document.getElementById('ff-saveall-yes').onclick=async()=>{
    const names=[...o.querySelectorAll('input[type=checkbox]:checked')].map(b=>b.getAttribute('data-name'));
    if(!names.length){ close(); return; }
    try {
      const r=await fetch(base+'/save-unsaved',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({names})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){ notify(d.error||'Could not save them',true); return; }
      close(); notify('Saved '+d.created+' '+what+(d.created===1?'':'s')+' ✦');
      if(kind==='vendor'){ if(typeof window.loadVendorsFromDB==='function') await window.loadVendorsFromDB(); }
      else {   // the list the page RENDERS (top-level customers), re-read as the customer save does (L17)
        try { const fr=await fetch('/api/customers',{credentials:'include'}); const rows=fr.ok?await fr.json():null; if(Array.isArray(rows)) customers=rows.map(c=>({...c,_dbId:c.id})); } catch(_){}
        window._custUnsaved=null; if(typeof renderCustomers==='function') renderCustomers();
      }
    } catch(_){ notify('Could not save them — check your connection and try again',true); }
  };
};
// Batch 8: this business's payment terms (Settings → Payment terms; 30 until set) and the due date they give. The server
// applies the same rule when a due date is left blank — the note says it before anyone saves.
function _bizPaymentTerms(){ try { const a=(window.ENTITIES||[]).find(e=>e&&e.active); return (a&&a.payment_terms!=null&&isFinite(a.payment_terms))?Number(a.payment_terms):30; } catch(_){ return 30; } }
window._bizPaymentTerms=_bizPaymentTerms;
// FA-M5b: the same hint for bills (bill-issue / bill-due / bill-due-hint) — the server gives bills the same rule.
window._invDueHint=function(prefix){
  const p=prefix||'inv';
  const el=document.getElementById(p+'-due-hint'); if(!el) return;
  const iss=(document.getElementById(p+'-issue')||{}).value||'', due=(document.getElementById(p+'-due')||{}).value||'';
  const t=_bizPaymentTerms(), fl=v=>(window.FinFlowDates?window.FinFlowDates.fmtLabel(v,{year:true}):v);
  if(due){ el.textContent='Due '+fl(due)+(t?'':' (your terms: due on receipt)'); return; }
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iss); if(!m){ el.textContent=''; return; }
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+t)).toISOString().slice(0,10);   // calendar arithmetic, no timezone
  el.textContent='Due '+fl(d)+' ('+(t?'Net '+t:'due on receipt')+') — from your payment terms in Settings. Pick a date to change it.';
};
// FA-B5: per-document terms. The Terms list sets this document's due date from its issue date ("Your terms" leaves the
// due date to the business's payment terms, as before); a changed issue date moves a terms-set due date with it; typing a
// due date makes the terms "Custom". The printed Terms line reads the document's own dates (finflow-docview docTerms).
const _addDaysYmd=(ymd,n)=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd||''); return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+n)).toISOString().slice(0,10):''; };
window._docTermsChange=function(p, fromIssue){
  const sel=document.getElementById(p+'-terms'), due=document.getElementById(p+'-due'); if(!sel||!due) return window._invDueHint(p);
  const v=sel.value, iss=(document.getElementById(p+'-issue')||{}).value||((typeof _entityToday==='function')?_entityToday():'');
  if(v===''){ if(!fromIssue) due.value=''; }
  else if(v!=='custom'){ due.value=_addDaysYmd(iss, Number(v)); }
  window._invDueHint(p);
};
window._docDueTyped=function(p){ const sel=document.getElementById(p+'-terms'); if(sel) sel.value=(document.getElementById(p+'-due')||{}).value?'custom':''; window._invDueHint(p); };
// Reset (new document) or show a saved document's terms (edit): the option matching its dates, else Custom.
window._docTermsSet=function(p, issue, due){
  const sel=document.getElementById(p+'-terms'); if(!sel) return;
  const t=_bizPaymentTerms(); const own=sel.querySelector('option[value=""]'); if(own) own.textContent='Your terms ('+(t?'Net '+t:'due on receipt')+')';
  const n=(issue&&due&&window._ffDocTerms)?window._ffDocTerms({issue_date:issue,due_date:due}):null;
  sel.value = (n==null) ? '' : (sel.querySelector('option[value="'+n+'"]') ? String(n) : 'custom');
};
function openInvoiceModal(){
  // F117 commit B: a fresh invoice modal = a fresh submit-intent. Clear the idempotency token so
  // the next Create mints a NEW one — two genuinely separate invoices carry DIFFERENT tokens and
  // both land. saveInvoice also clears it on success; this covers reopen-after-a-failed-submit.
  window._invIdemKey = null;
  window._invEditId = null;   // batch 7: "+ New invoice" is never an edit of the last invoice opened
  { const t=document.querySelector('#invoice-modal .modal-title'); if(t) t.textContent='New invoice';
    const st=document.querySelector('#invoice-modal .modal-sub'); if(st) st.textContent='Create and track a new client invoice'; }
  const _sv=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
  _sv('inv-client','');
  _sv('inv-amount','');
  _sv('inv-issue', (typeof todayLocal==='function'?todayLocal():'')); // F36: default issue date = today (LOCAL, F37), backdatable
  _sv('inv-due','');
  _sv('inv-status','pending');
  _sv('inv-desc','');
  try { if (window.ffInvLineItems) window.ffInvLineItems.reset(); } catch(_){}  // F194: clear line-items editor + unlock amount
  window._docTermsSet('inv');   // FA-B5: "Your terms (Net N)" until another is picked
  window._invDueHint();   // batch 8: the due date the terms give, shown before saving
  _fillContactPicker('inv-client','ff-cust-list','/api/customers',_custDisplayName);   // batch 9: pick a saved customer
  openModal('invoice-modal');
}
function saveInvoice(){
  const client=sanitizeText(document.getElementById('inv-client').value,200);
  const amountRaw=validateAmount(document.getElementById('inv-amount').value);
  if(!client){notify('Client name is required',true);return;}
  if(amountRaw===null||amountRaw<=0){notify('A valid positive amount is required',true);return;}
  if(currentUserPlan==='pro'&&(userInvoices||[]).length>=50){
    if(typeof showUpgradeModal==='function') showUpgradeModal('invoice_limit');
    return;
  }
  const amount=amountRaw;
  const due=document.getElementById('inv-due').value;
  const status=document.getElementById('inv-status').value;
  const dueStr=due?(window.FinFlowDates?window.FinFlowDates.fmtLabel(due):due):'No due date';   // batch 8 (+ F195: a calendar date, never an instant)
  if(!userInvoices) userInvoices = [];
  userInvoices.push({client,amount,due:dueStr,color:status==='overdue'?'var(--red)':'var(--t2)',status});
  closeModal('invoice-modal');
  renderInvoices();
  notify(`Invoice created for ${esc(client)}`);
}

// ════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════
function updateExpenses(d=getPeriodData()){
  // All KPIs come from the canonical breakdown — no fabricated ratios.
  const b = computeExpenseBreakdown();
  const _set=(id,v)=>{const el=document.getElementById(id); if(el) el.textContent=v;};
  // Total expenses = real rows + bill payments + payroll (same number the dashboard shows)
  _set('ex-total', S(b.total));
  // Business = real recorded expense rows (data model has no personal/business split)
  _set('ex-biz', S(b.business));
  const _bizPct=document.getElementById('ex-biz-pct');
  // LA8 (live audit 2026-10-13): this card is the recorded expense ENTRIES only — bills and payroll are in the total, not
  // here — and it was labelled "Business". The label and caption now say so; the figure is unchanged.
  if(_bizPct){ _bizPct.textContent = b.total>0 ? 'Excl. bills & payroll · '+Math.round(b.business/b.total*100)+'% of total' : 'Excl. bills & payroll'; _bizPct.className='mc-change neutral'; }
  // Tax deductible = real sum of deductible rows (yes 100% + half 50%)
  _set('ex-ded', S(b.deductible));
  const _dedEl=document.getElementById('ex-ded-save');
  if(_dedEl){ _dedEl.textContent = b.business>0 ? Math.round(b.deductible/b.business*100)+'% of expense entries' : ''; _dedEl.className='mc-change up'; }   // LA8: name the base
  const ec=chg(b.total, d?d.prevExp:null, true);
  set('ex-total-chg',ec.txt,ec.cls);
  // Largest cost + breakdown bars — operating categories PLUS Payroll and Bill
  // payments as their own lines, so the bars reconcile with the headline total
  // (no mystery gap between "Expenses $X" and the category breakdown).
  // Phase 1.1: the shared decomposition (Σ rows == b.total) — same categories as the dashboard bars.
  const sorted = _expenseCategoryRows(b);
  const _exTopEl=document.getElementById('ex-top'); if(_exTopEl) _exTopEl.textContent = sorted[0]?.[0] || '—';
  const _exTopPctEl=document.getElementById('ex-top-pct');
  if(_exTopPctEl) _exTopPctEl.textContent = (sorted[0] && b.total>0) ? _fmtMoneyAbbr(sorted[0][1])+' · '+Math.round(sorted[0][1]/b.total*100)+'%' : '';
  const _maxAmt=sorted[0]?.[1]||1;
  [['ex-sal'],['ex-rent'],['ex-sw2'],['ex-other']].forEach(([elId],i)=>{
    const el=document.getElementById(elId); if(!el) return;
    const row=el.closest?.('.bar-row');
    if(sorted[i]){
      const[cat,amt]=sorted[i];
      el.textContent=S(amt);
      if(row){const lbl=row.querySelector('.bar-label');if(lbl)lbl.textContent=cat;const fill=row.querySelector('.bar-fill');if(fill)fill.style.width=Math.round(amt/_maxAmt*100)+'%';}
    }else{
      el.textContent='—';
      if(row){const lbl=row.querySelector('.bar-label');if(lbl)lbl.textContent='—';const fill=row.querySelector('.bar-fill');if(fill)fill.style.width='0%';}
    }
  });
}
function renderExpenses(){
  updateExpenses();
  if(!bizExpenses) bizExpenses=[];
  document.getElementById('expense-list').innerHTML=bizExpenses.slice(0,6).map(e=>`
    <div class="tx-row">
      <div><div class="tx-name">${esc(e.desc)}</div><div class="tx-cat">${esc(e.cat)} · ${esc(e.date)}${e.ded!=='no'?' · '+(e.ded==='half'?'50%':'100%')+' deductible':''}</div></div>
      <div class="tx-amt dn">-${S(e.amount)}</div>
    </div>`).join('');
}
function openExpenseModal(){
  const _sv=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
  _sv('bexp-desc','');
  _sv('bexp-vendor','');   // FA-M9
  if(typeof window._fillContactPicker==='function') window._fillContactPicker('bexp-vendor','ff-exp-vend-list','/api/vendors',v=>v.name);   // a saved vendor, or type a new one
  _sv('bexp-amount','');
  _sv('bexp-date', todayLocal());   // M49: default today (editable), like the invoice issue date (F36)
  if(typeof window._expModalMode==='function') window._expModalMode(false);   // M52: Add always opens in add mode
  window._expIdemKey = null;   // C1 Wave 1: fresh submit-intent → a genuine new expense never reuses the last token
  openModal('expense-modal');
}
function saveExpense(){
  const desc=sanitizeText(document.getElementById('bexp-desc').value,300);
  const amountRaw=validateAmount(document.getElementById('bexp-amount').value);
  if(!desc){notify('Description is required',true);return;}
  if(amountRaw===null||amountRaw<=0){notify('A valid positive amount is required',true);return;}
  const amount=amountRaw;
  if(!bizExpenses) bizExpenses = [];
  bizExpenses.unshift({desc,cat:document.getElementById('bexp-cat').value,amount,ded:document.getElementById('bexp-ded').value,date:'Today'});
  closeModal('expense-modal');
  renderExpenses();
  notify('Expense logged');
}

// ════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════
// LA5 (live audit 2026-10-13 M2): an item's stock value is the FIFO value of the layers left (server /api/cogs
// inventoryValueByItem — the same loop as the Inventory value card and the Balance Sheet), never units × the item's
// current cost field (Widget: 5 × 15 = 75 under a card of 90). null = not loaded yet → the row shows "—".
window._invItemValue = function(item){
  const by = window._inventoryValueByItem;
  if(!item || item._dbId == null || !by) return null;
  const v = by[item._dbId];
  return v == null ? 0 : (parseFloat(v) || 0);
};
// Shadowed at runtime by finflow-api-wiring-medium.js window.renderInventory (a replacement override). Kept on the
// same sources so it can never re-grow C7/LA5 if it ever runs.
function renderInventory(){
  if(!inventory) inventory=[];
  const lowCount=inventory.filter(i=>i.low).length;
  document.getElementById('badge-inv2').textContent=lowCount;
  document.getElementById('badge-inv2').style.display=lowCount>0?'':'none';
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('inv-skus',inventory.length);
  set('inv-lowstock',lowCount);
  set('inv-value',window._inventoryValue!=null?S(window._inventoryValue):'—');   // C7
  document.getElementById('inventory-list').innerHTML=inventory.map((item,idx)=>{
    const pct=Math.min(100,Math.round(item.units/item.max*100));
    const col=pct<10?'var(--red)':pct<20?'var(--amber)':'var(--green)';
    const val=window._invItemValue(item);   // LA5
    const cogsVal=item.cogs!=null?S(item.cogs):'—';
    return`<div class="inv-item-row">
      <span style="color:var(--t3);font-family:var(--font-mono)">${esc(item.sku)}</span>
      <span>${esc(item.name)}</span>
      <span style="color:${item.low?'var(--red)':'var(--t1)'}">${item.units} units${item.low?' ⚠':''}</span>
      <div class="stock-bar"><div class="stock-fill" style="width:${pct}%;background:${col}"></div></div>
      <span style="color:${item.low?'var(--red)':'var(--t1)'};">${val==null?'—':S(val)}</span>
      <span style="text-align:right;font-family:var(--font-mono);color:var(--t2)">${cogsVal}</span>
      <span class="table-actions" style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="openStockInModal(${idx})">+ In</button>
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="openStockOutModal(${idx})">- Out</button>
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="restockItem(${idx})">Restock</button>
      </span>
    </div>`;
  }).join('');
}
function restockItem(idx){
  if(idx<0||idx>=inventory.length)return;
  notify('Use the Stock In modal to restock this item.');
  return;
}
function openProductModal(){openModal('product-modal')}
function saveProduct(){
  const name=sanitizeText(document.getElementById('prod-name').value,200);
  if(!name){notify('Product name is required',true);return;}
  const unitsRaw=parseInt(document.getElementById('prod-units').value)||0;
  const units=Math.max(0,Math.min(unitsRaw,1000000));
  const costRaw=validateAmount(document.getElementById('prod-cost').value);
  const cost=costRaw!==null?costRaw:0;
  const thresh=Math.max(0,parseInt(document.getElementById('prod-thresh').value)||20);
  const sku='#'+String(1048+(inventory||[]).length).padStart(4,'0');
  if(!inventory) inventory=[];
  inventory.push({sku,name,units,max:Math.max(units*2,100),cost,low:units<thresh});
  closeModal('product-modal');
  renderInventory();
  notify(`${name} added to inventory`);
}

// ════════════════════════════════════════════
// PAYROLL
// ════════════════════════════════════════════
// ── USER-DEFINED DEDUCTIONS (FinFlow performs NO tax calculation) ─────────────
// Each record carries deduction rows { label, value, type:'percent'|'fixed' }.
// percent → gross×value/100 ; fixed → value. net = gross − Σ. Zero tax knowledge.
const DED_DISCLAIMER = "You define these deductions. FinFlow does not calculate, determine, or verify any tax or deduction — it only subtracts the percentages and amounts you enter. You are responsible for confirming every figure with your accountant or the relevant tax authority.";
const DED_DISCLAIMER_OUTPUT = "Estimate only, based on the deductions you entered. FinFlow performs no tax calculation and is not responsible for tax accuracy.";
function _dedList(d){ return Array.isArray(d) ? d : []; }
function dedTotal(gross, deductions){
  const g = parseFloat(gross)||0;
  return Math.round(_dedList(deductions).reduce((s,d)=>{
    const v = parseFloat(d && d.value)||0;
    return s + (d && d.type==='fixed' ? v : g*v/100);
  },0)*100)/100;
}
function netFromDeductions(gross, deductions){
  return Math.round(((parseFloat(gross)||0) - dedTotal(gross, deductions))*100)/100;
}
function dedRowHTML(d, previewFn){
  d = d || {label:'',value:'',type:'percent'};
  const pv = previewFn ? previewFn+'()' : '';
  const valAttr = (d.value!=null && d.value!=='') ? d.value : '';
  return '<div class="ded-row" style="display:flex;gap:6px;align-items:center;margin-bottom:5px">'
    + '<input class="finput ded-label" placeholder="Label (e.g. PAYE, NIS, CPP)" value="'+esc(d.label||'')+'" oninput="'+pv+'" style="flex:1;min-width:0">'
    + '<input class="finput ded-value" type="number" step="0.01" min="0" placeholder="0" value="'+valAttr+'" oninput="'+pv+'" style="width:82px">'
    + '<select class="finput ded-type" onchange="'+pv+'" style="width:74px"><option value="percent"'+(d.type==='fixed'?'':' selected')+'>%</option><option value="fixed"'+(d.type==='fixed'?' selected':'')+'>fixed</option></select>'
    + '<button type="button" onclick="this.closest(\'.ded-row\').remove();'+pv+'" title="Remove deduction" style="border:none;background:none;color:var(--t3);cursor:pointer;font-size:14px;line-height:1;padding:2px 4px">✕</button>'
    + '</div>';
}
function setDedRows(containerId, previewFn, deductions){
  const c = document.getElementById(containerId);
  if(!c) return;
  c.innerHTML = _dedList(deductions).map(d=>dedRowHTML(d, previewFn)).join('');
}
function addDedRow(containerId, previewFn, d){
  const c = document.getElementById(containerId);
  if(!c) return;
  c.insertAdjacentHTML('beforeend', dedRowHTML(d, previewFn));
  if(previewFn && typeof window[previewFn]==='function') window[previewFn]();
}
function readDedRows(containerId){
  const c = document.getElementById(containerId);
  if(!c) return [];
  return Array.from(c.querySelectorAll('.ded-row')).map(r=>({
    label: (r.querySelector('.ded-label')?.value||'').trim(),
    value: parseFloat(r.querySelector('.ded-value')?.value)||0,
    type: r.querySelector('.ded-type')?.value==='fixed'?'fixed':'percent',
  })).filter(d=>d.label || d.value);
}
window.dedTotal=dedTotal; window.netFromDeductions=netFromDeductions; window.dedRowHTML=dedRowHTML;
window.setDedRows=setDedRows; window.addDedRow=addDedRow; window.readDedRows=readDedRows;
window.DED_DISCLAIMER=DED_DISCLAIMER; window.DED_DISCLAIMER_OUTPUT=DED_DISCLAIMER_OUTPUT;

function renderPayroll(){
  const allEmps=ownerPayroll?[{...ownerPayroll,isOwner:true},...(payrollEmployees||[])]:( payrollEmployees||[]);
  const totalGross=allEmps.reduce((a,e)=>a+(parseFloat(e.gross)||0),0);
  const totalDed=allEmps.reduce((a,e)=>a+dedTotal(e.gross, e.deductions),0);
  document.getElementById('pr-total').textContent=S(totalGross);
  document.getElementById('pr-headcount').textContent=allEmps.length+' employee'+(allEmps.length!==1?'s':'');
  document.getElementById('pr-tax').textContent=S(totalDed);
  if(ownerPayroll){
    document.getElementById('pr-owner-net').textContent=S(ownerPayroll.net);
    document.getElementById('pr-owner-label').textContent='Your net salary';
    document.getElementById('owner-cta').style.display='none';
    document.getElementById('payroll-link-card').style.display='flex';
    document.getElementById('link-net-display').textContent=S(ownerPayroll.net)+'/mo';
  } else {
    document.getElementById('pr-owner-net').textContent='—';
    document.getElementById('pr-owner-label').textContent='Not on payroll';
    document.getElementById('owner-cta').style.display='block';
    document.getElementById('payroll-link-card').style.display='none';
    document.getElementById('link-net-display').textContent='—';   // C1
  }
  document.getElementById('payroll-list').innerHTML=allEmps.map(e=>{
    const net=netFromDeductions(e.gross, e.deductions);
    const tax=dedTotal(e.gross, e.deductions);
    return`<div class="payroll-row">
      <div class="emp-info">
        <div class="emp-init ${e.avClass||'av-blue'}">${e.initials||getInitials(e.fname,e.lname)}</div>
        <div><div class="emp-name">${esc(e.fname)} ${esc(e.lname)}${e.isOwner?` <span class="badge b-blue" style="font-size:9px">You</span>`:''}</div><div class="emp-role">${esc(e.type||'Full-time')}</div></div>
      </div>
      <span style="color:var(--t2);font-size:12px">${esc(e.role)}</span>
      <span style="font-family:var(--font-mono);color:var(--t1)">${S(e.gross)}</span>
      <span style="color:var(--red);font-family:var(--font-mono)">${tax>0?'-'+S(tax):'—'}</span>
      <span style="font-weight:600;font-family:var(--font-mono);color:${e.isOwner?'var(--acc)':'var(--t1)'}">${S(net)}</span>
      ${e.isOwner
        ?`<button class="btn-icon" onclick="openOwnerModal()" title="Edit" style="border:none;background:none;color:var(--acc)"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11 2l3 3L5 14H2v-3z"/></svg></button>`
        :`<button onclick="openEditEmployee(${e._dbId||e.id||0})" style="background:none;border:none;cursor:pointer;color:var(--t3);padding:4px;font-size:14px;line-height:1" title="Edit employee">✏</button>`}
    </div>`;
  }).join('');
}
function previewOwnerNet(){
  const g=Number(document.getElementById('own-gross').value)||0;
  const deds=readDedRows('own-deductions-rows');
  const entity = ENTITIES[activeOwnerEntityIdx];
  const sym = entity ? (window.CURRENCIES[entity.currency]?.symbol||'$') : '$';
  document.getElementById('own-net-preview').value=g>0?(sym+Math.round(netFromDeductions(g, deds)).toLocaleString()):'—';
  updateOwnerEntitySummary();
}

function getActiveEntityOwnerPayroll(){
  return ownerPayrollByEntity[activeOwnerEntityIdx] || null;
}

function calcTotalOwnerNetUSD(){
  const _entities = (typeof ENTITIES !== 'undefined' ? ENTITIES : null) || window.ENTITIES || [];
  return Object.entries(ownerPayrollByEntity).reduce((total, [idx, ep])=>{
    if(!ep) return total;
    const entity = _entities[parseInt(idx)];
    const cur = ep.currency || entity?.currency || 'USD';
    return total + _safeFX(ep.net, cur, 'USD');
  }, 0);
}

function updateOwnerEntitySummary(){
  const summaryEl = document.getElementById('owner-entity-summary');
  const totalEl = document.getElementById('owner-total-net');
  if(!summaryEl) return;

  // Get current unsaved value for active entity
  const pendingGross = Number(document.getElementById('own-gross')?.value)||0;
  const pendingDeds = readDedRows('own-deductions-rows');
  const pendingNet = pendingGross > 0 ? Math.round(netFromDeductions(pendingGross, pendingDeds)) : 0;

  summaryEl.innerHTML = ENTITIES.map((e,i)=>{
    const ep = i === activeOwnerEntityIdx && pendingNet > 0
      ? {net: pendingNet, gross: pendingGross, deductions: pendingDeds}
      : ownerPayrollByEntity[i];
    const cur = window.CURRENCIES[e.currency] || {symbol:'$'};
    const netUSD = ep ? Math.round(_safeFX(ep.net, e.currency, 'USD')) : 0;
    const badge = ep
      ? `<span style="color:var(--green);font-family:var(--font-mono);font-size:12px">${cur.symbol}${ep.net.toLocaleString()}/mo</span><span style="font-size:10px;color:var(--t3);margin-left:4px">(≈$${netUSD.toLocaleString()} USD)</span>`
      : `<span style="color:var(--t3);font-size:11px">Not added</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px">
      <span style="display:flex;align-items:center;gap:6px">
        <span style="width:20px;height:20px;border-radius:4px;background:${e.color};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#0e0b08;flex-shrink:0">${esc(e.name.slice(0,2).toUpperCase())}</span>
        <span style="color:var(--t2)">${esc(e.name)}</span>
        <span style="font-size:9px;color:var(--t3)">${e.currency}</span>
      </span>
      ${badge}
    </div>`;
  }).join('');

  // Total in USD
  let totalUSD = calcTotalOwnerNetUSD();
  // Add pending (active entity) contribution if not yet saved
  if(pendingNet > 0 && !ownerPayrollByEntity[activeOwnerEntityIdx]){
    const activeCur = ENTITIES[activeOwnerEntityIdx]?.currency || 'USD';
    totalUSD += _safeFX(pendingNet, activeCur, 'USD');
  }
  if(totalEl) totalEl.textContent = totalUSD > 0 ? ('$'+Math.round(totalUSD).toLocaleString()+' USD/mo') : '—';
}

function renderOwnerModalTabs(){
  const tabs = document.getElementById('owner-entity-tabs');
  const curLabel = document.getElementById('owner-entity-currency-label');
  if(!tabs) return;
  tabs.innerHTML = ENTITIES.map((e,i)=>{
    const ep = ownerPayrollByEntity[i];
    const active = i === activeOwnerEntityIdx;
    return `<button onclick="switchOwnerEntityTab(${i})" style="flex:1;padding:5px 6px;border:none;border-radius:calc(var(--radius) - 1px);font-size:11.5px;font-family:var(--font);cursor:pointer;transition:all .15s;background:${active?'var(--bg1)':'transparent'};color:${active?'var(--t1)':'var(--t3)'};font-weight:${active?'500':'400'};display:flex;align-items:center;justify-content:center;gap:5px">
      <span style="width:16px;height:16px;border-radius:3px;background:${e.color};display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#0e0b08;flex-shrink:0">${esc(e.name.slice(0,2).toUpperCase())}</span>
      ${esc(e.name.split(' ')[0])}
      ${ep ? '<span style="width:5px;height:5px;border-radius:50%;background:var(--green);flex-shrink:0"></span>' : ''}
    </button>`;
  }).join('');

  const entity = ENTITIES[activeOwnerEntityIdx];
  const cur = window.CURRENCIES[entity?.currency] || {symbol:'$',name:'USD'};
  if(curLabel) curLabel.textContent = `Entering salary in ${entity?.currency || 'USD'} (${esc(cur.name)}) — automatically converted to USD in Personal Finance`;

  const symEl = document.getElementById('own-currency-sym');
  if(symEl) symEl.textContent = `(${cur.symbol})`;
}

window.switchOwnerEntityTab = function(idx){
  // AUTO-SAVE current tab before switching (if gross is filled in)
  const curFname = document.getElementById('own-fname')?.value?.trim()||'';
  const curLname = document.getElementById('own-lname')?.value?.trim()||'';
  const curGross = Number(document.getElementById('own-gross')?.value||0);
  const curDeds  = readDedRows('own-deductions-rows');
  const curRole  = document.getElementById('own-role')?.value||'CEO / Founder';
  const curType  = document.getElementById('own-type')?.value||'owner';

  if(curFname && curGross > 0){
    const curEntity = ENTITIES[activeOwnerEntityIdx];
    const existing = ownerPayrollByEntity[activeOwnerEntityIdx] || {};
    ownerPayrollByEntity[activeOwnerEntityIdx] = {
      _dbId: existing._dbId,
      fname: curFname, lname: curLname,
      role: curRole, type: curType,
      gross: curGross, deductions: curDeds,
      net: netFromDeductions(curGross, curDeds),
      currency: curEntity?.currency||'USD',
      initials: getInitials(curFname,curLname),
      avClass: 'av-blue',
      entityName: curEntity?.name||'Entity'
    };
  }

  // Switch to new tab
  activeOwnerEntityIdx = idx;
  const ep = ownerPayrollByEntity[idx];

  // Populate fields — use saved data if exists, else carry over name/role from previous tab
  if(ep){
    document.getElementById('own-fname').value  = ep.fname;
    document.getElementById('own-lname').value  = ep.lname;
    document.getElementById('own-role').value   = ep.role;
    document.getElementById('own-type').value   = ep.type;
    document.getElementById('own-gross').value  = ep.gross;
    setDedRows('own-deductions-rows','previewOwnerNet', ep.deductions);
    document.getElementById('owner-remove-btn').style.display = 'inline-flex';
  } else {
    // Carry over name and role from previous tab — only clear the salary
    document.getElementById('own-fname').value  = curFname;
    document.getElementById('own-lname').value  = curLname;
    document.getElementById('own-role').value   = curRole;
    document.getElementById('own-type').value   = curType;
    document.getElementById('own-gross').value  = '';
    setDedRows('own-deductions-rows','previewOwnerNet', []);
    document.getElementById('own-net-preview').value = '—';
    document.getElementById('owner-remove-btn').style.display = 'none';
  }

  renderOwnerModalTabs();
  previewOwnerNet();
  updateOwnerEntitySummary();
};

function openOwnerPayrollModal(){
  activeOwnerEntityIdx = ENTITIES.findIndex(e=>e.active);
  if(activeOwnerEntityIdx < 0) activeOwnerEntityIdx = 0;

  const ep = ownerPayrollByEntity[activeOwnerEntityIdx];
  const hasAny = Object.keys(ownerPayrollByEntity).length > 0;
  document.getElementById('owner-modal-title').textContent = hasAny ? 'Your payroll — all entities' : 'Add yourself to payroll';

  // Get user's real name from sidebar footer
  const userNameEl = document.getElementById('sb-user-name');
  const userName = (userNameEl?.textContent||'').trim().split(' ');
  const defaultFirst = userName[0]||'';
  const defaultLast  = userName.slice(1).join(' ')||'';

  if(ep){
    document.getElementById('own-fname').value   = ep.fname;
    document.getElementById('own-lname').value   = ep.lname;
    document.getElementById('own-role').value    = ep.role;
    document.getElementById('own-type').value    = ep.type;
    document.getElementById('own-gross').value   = ep.gross;
    setDedRows('own-deductions-rows','previewOwnerNet', ep.deductions);
    document.getElementById('owner-remove-btn').style.display = 'inline-flex';
  } else {
    document.getElementById('own-fname').value   = defaultFirst;
    document.getElementById('own-lname').value   = defaultLast;
    document.getElementById('own-role').value    = 'CEO / Founder';
    document.getElementById('own-type').value    = 'owner';
    document.getElementById('own-gross').value   = '';
    document.getElementById('own-net-preview').value = '—';
    setDedRows('own-deductions-rows','previewOwnerNet', []);
    document.getElementById('owner-remove-btn').style.display = 'none';
  }

  renderOwnerModalTabs();
  updateOwnerEntitySummary();
  previewOwnerNet();
  openModal('owner-modal');
}

function saveOwnerPayroll(){
  const fname   = document.getElementById('own-fname')?.value?.trim()||'';
  const lname   = document.getElementById('own-lname')?.value?.trim()||'';
  const gross   = Number(document.getElementById('own-gross')?.value||0);
  const deductions = readDedRows('own-deductions-rows');
  const role    = document.getElementById('own-role')?.value||'CEO / Founder';
  const type    = document.getElementById('own-type')?.value||'owner';

  if(!fname){ notify('Please enter your first name', true); return; }

  // Save current tab if it has a salary filled in
  if(gross > 0){
    const entity = ENTITIES[activeOwnerEntityIdx];
    const existing = ownerPayrollByEntity[activeOwnerEntityIdx] || {};
    ownerPayrollByEntity[activeOwnerEntityIdx] = {
      _dbId: existing._dbId, // preserve so medium.js does PUT, not POST (no dupes)
      fname, lname, role, type,
      gross, deductions,
      net: netFromDeductions(gross, deductions),
      currency: entity?.currency||'USD',
      initials: getInitials(fname,lname),
      avClass: 'av-blue',
      entityName: entity?.name||'Entity'
    };
  }

  // Require at least one entity to have a salary
  const savedCount = Object.keys(ownerPayrollByEntity).length;
  if(savedCount === 0){
    notify('Enter a salary for at least one entity', true);
    return;
  }

  // Sync ownerPayroll compat pointer to currently active entity
  ownerPayroll = ownerPayrollByEntity[ENTITIES.findIndex(e=>e.active)] || null;   // C1: this business only — never another's

  syncAllPayrollsToPersonal();
  closeModal('owner-modal');
  renderPayroll();

  const entityNames = Object.entries(ownerPayrollByEntity).map(([i])=>ENTITIES[i]?.name||'Entity').join(', ');
  notify(`Payroll saved for ${esc(entityNames)} — Personal Finance synced ✦`);
}

function removeOwnerFromPayroll(){
  const entity = ENTITIES[activeOwnerEntityIdx];
  delete ownerPayrollByEntity[activeOwnerEntityIdx];
  // Update compat pointer
  const activeIdx = ENTITIES.findIndex(e=>e.active);
  ownerPayroll = ownerPayrollByEntity[activeIdx] || null;   // C1: this business only — never another's
  syncAllPayrollsToPersonal();
  renderOwnerModalTabs();
  updateOwnerEntitySummary();
  // Clear form for this tab
  document.getElementById('own-gross').value = '';
  document.getElementById('own-net-preview').value = '—';
  document.getElementById('owner-remove-btn').style.display = 'none';
  renderPayroll();
  notify(`Removed from ${esc(entity?.name||'entity')} payroll ✦`);
}

// (Removed autoSetPayrollJurisdiction — FinFlow no longer has jurisdictions.)

window.openEditEmployee = function(id){
  const emp = (window.payrollEmployees||[]).find(e=>(e._dbId||e.id)===id);
  if(!emp) return;
  document.getElementById('edit-emp-id').value = id;
  document.getElementById('edit-emp-name').value = ((emp.fname||'')+' '+(emp.lname||'')).trim();
  document.getElementById('edit-emp-role').value = emp.role||'';
  document.getElementById('edit-emp-type').value = emp.type||emp.emp_type||'Full-time';
  document.getElementById('edit-emp-gross').value = emp.gross||0;
  setDedRows('edit-emp-deductions-rows','previewEditEmpNet', emp.deductions);
  const _own=document.getElementById('edit-emp-is-owner'); if(_own) _own.checked=false;   // LA3: this list holds non-owners only
  document.getElementById('modal-edit-employee').style.display='flex';
};

window.closeEditEmployee = function(){
  document.getElementById('modal-edit-employee').style.display='none';
};
window.previewEditEmpNet = function(){
  const gross = parseFloat(document.getElementById('edit-emp-gross')?.value)||0;
  const el = document.getElementById('edit-emp-net-preview');
  if(el) el.textContent = gross>0 ? _nativeSymbol()+netFromDeductions(gross, readDedRows('edit-emp-deductions-rows')).toLocaleString() : '—';  // F129
};

window.saveEditEmployee = async function(){
  const id = parseInt(document.getElementById('edit-emp-id').value);
  const role = (document.getElementById('edit-emp-role').value||'').trim().slice(0,100);
  const emp_type = document.getElementById('edit-emp-type').value;
  const gross = parseFloat(document.getElementById('edit-emp-gross').value)||0;
  const deductions = readDedRows('edit-emp-deductions-rows');
  const makeOwner = !!document.getElementById('edit-emp-is-owner')?.checked;   // LA3: mark an existing employee as you
  if(!id) return;
  const btn = document.querySelector('#modal-edit-employee .btn-primary');
  btn.disabled=true; btn.textContent='Saving…';
  try{
    const body = {role,emp_type,gross,deductions};
    if(makeOwner) body.is_owner = true;
    const res = await fetch('/api/payroll/'+id,{
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!res.ok){ let m=''; try{ m=(await res.json()).error||''; }catch(_){ } throw new Error(m||('HTTP '+res.status)); }
    if(makeOwner){
      window.closeEditEmployee();
      const _ai=(typeof ENTITIES!=='undefined')?ENTITIES.findIndex(e=>e.active):-1;
      if(typeof window.loadEntityData==='function' && _ai>=0) await window.loadEntityData(_ai);
      if(typeof renderPayroll==='function') renderPayroll();
      notify('Marked as you, the owner ✦');
      return;
    }
    const emp = (window.payrollEmployees||[]).find(e=>(e._dbId||e.id)===id);
    if(emp){ emp.role=role; emp.type=emp_type; emp.gross=gross; emp.deductions=deductions; emp.net=netFromDeductions(gross, deductions); }
    window.closeEditEmployee();
    if(typeof renderPayroll==='function') renderPayroll();
    notify('Employee updated ✦');
  }catch(e){
    notify('Failed to save: '+e.message, true);  // C2: native alert → toast
  }finally{
    btn.disabled=false; btn.textContent='Save changes';
  }
};

// Delete an employee. The server route (DELETE /api/payroll/:id, payroll:write) already existed;
// only the client handler was missing — which is why non-owner rows had no delete control (the
// runtime renderPayroll override rendered an empty <span> there). Mirrors saveEditEmployee's shape
// (raw fetch, in-memory update, repaint) and the delete convention used across the app.
window.deleteEmployee = async function(id){
  const emp = (window.payrollEmployees||[]).find(e=>(e._dbId||e.id)===id);
  if(!emp) return;
  const nm = ((emp.fname||'')+' '+(emp.lname||'')).trim() || 'this employee';
  if(!(await window._confirmModal(`Delete ${nm} from payroll? This cannot be undone.`, {danger:true}))) return;
  try{
    const res = await fetch('/api/payroll/'+id,{method:'DELETE',credentials:'include'});
    if(!res.ok) throw new Error((await res.text())||('HTTP '+res.status));
    window.payrollEmployees = (window.payrollEmployees||[]).filter(e=>(e._dbId||e.id)!==id);
    if(typeof payrollEmployees!=='undefined') payrollEmployees = window.payrollEmployees;   // keep the module binding in sync with the window one
    if(typeof renderPayroll==='function') renderPayroll();
    if(typeof syncAllPayrollsToPersonal==='function'){ try{ syncAllPayrollsToPersonal(); }catch(_){}}
    notify('Employee removed');
    if(typeof window.refreshFinancials==='function') window.refreshFinancials('none');
  }catch(e){
    notify('Could not remove employee — '+e.message, true);
  }
};

function syncAllPayrollsToPersonal(){
  const entries = Object.entries(ownerPayrollByEntity);
  const totalUSD = calcTotalOwnerNetUSD();   // banner/breakdown display only (not an income term)

  // M35 (money audit 2026-10-09): NO fabricated rows. This used to unshift an in-memory "Salary — <entity> (April)"
  // row dated "Apr 30" per entity into the personal list and running balance (a hard-coded month, the ROSTER's net,
  // not a real transaction). The owner's salary reaches Personal only as real rows from paid payroll runs (M14).

  // M55: no roster banner / per-business breakdown on the Personal page (personal/business wall).

  // C1 (personal/business wall): this used to write the business Payroll page's "Your net pay" card with the owner's
  // roster net summed across EVERY business and converted to the PERSONAL currency — so Island Traders showed
  // Northwind's pay. That card belongs to renderPayroll (this business only, its own currency).
  renderPersonal();
}
// openOwnerModal — all call sites now route to the full multi-entity modal
function openOwnerModal(){
  openOwnerPayrollModal();
}

// Safe fxConvert wrapper — works even if fxConvert not yet defined
function _safeFX(amount, from, to){
  // Use local CURRENCIES const (same script block) — window.CURRENCIES may not be set yet
  const r = (typeof CURRENCIES !== 'undefined' ? CURRENCIES : null) || window.CURRENCIES;
  if(!r || !r[from] || !r[to]) return amount;
  if(from === to) return amount;
  return (amount / r[from].rate) * r[to].rate;
}

function syncPayrollToPersonal(netPay,fname,lname){
  // Legacy shim — use syncAllPayrollsToPersonal instead
  syncAllPayrollsToPersonal();
}
window.syncPayrollToPersonal = syncAllPayrollsToPersonal;

// ════════════════════════════════════════════
// PERSONAL
// ════════════════════════════════════════════
function refreshPersonal(){renderPersonal()}

// Personal finance display currency (all values stored in USD, displayed in persCurrency)
let persCurrency = 'USD';

function setPersCurrency(code){
  persCurrency = code;
  _ffApplyCurrencyLabels();   // FA-M13
  // Update button states
  document.querySelectorAll('.pers-cur-btn').forEach(b=>{
    b.classList.toggle('active-preset', b.dataset.code===code);
  });
  // Update rate label
  const lbl = document.getElementById('pers-fx-label');
  const cur = window.CURRENCIES?.[code];
  if(lbl){
    lbl.textContent = (code!=='USD' && cur)
      ? `1 USD = ${cur.rate.toFixed(cur.rate<1?4:cur.rate>100?0:2)} ${code}`
      : '';
  }
  // M51 (fix pass round 2): ONE writer of the personal cards. The currency switch repaints through renderPersonal
  // (the same figures a page load paints) and the assets / liabilities list. A separate "fast path" used to rewrite
  // the KPI cards itself — with a fabricated Net worth (baseNetWorth + 2 × surplus) and "+surplus this month",
  // overwritten in the same tick — and never repainted the accounts list, which stayed in the old currency.
  renderPersonal();
  renderPersAccounts();
  // Re-render payroll banner & breakdown with new currency
  if(typeof syncAllPayrollsToPersonal === 'function') syncAllPayrollsToPersonal();
}

// Convert USD amount to persCurrency and format with symbol
function SP(usdAmount){
  const _cur_map = (typeof CURRENCIES !== 'undefined' ? CURRENCIES : null) || window.CURRENCIES || {};
  const cur = _cur_map[persCurrency] || {symbol:'$', rate:1};
  const converted = usdAmount * cur.rate;
  return _fmtMoney(converted, cur.symbol);   // K→M→B rollover + sign via the shared formatter
}

// Format a NATIVE-currency amount for display: convert fromCur → persCurrency and
// format with the persCurrency symbol. When persCurrency===fromCur, _safeFX
// short-circuits (from===to) → the viewer sees their EXACT entered figure, never
// an FX round-trip. Aggregate figures normalized to USD use SP (fromCur 'USD').
function SPfrom(amount, fromCur){
  const _m = (typeof CURRENCIES !== 'undefined' ? CURRENCIES : null) || window.CURRENCIES || {};
  const cur = _m[persCurrency] || {symbol:'$'};
  const conv = _safeFX(amount, fromCur || 'USD', persCurrency);
  return _fmtMoney(conv, cur.symbol);   // K→M→B rollover + sign via the shared formatter
}
// Full (non-abbreviated) native-amount display — used in the transaction ledger so
// a same-currency viewer reads the exact figure (e.g. TT$11,250, not TT$11.3K).
function SPfromFull(amount, fromCur){
  const _m = (typeof CURRENCIES !== 'undefined' ? CURRENCIES : null) || window.CURRENCIES || {};
  const cur = _m[persCurrency] || {symbol:'$'};
  const conv = _safeFX(amount, fromCur || 'USD', persCurrency);
  return cur.symbol + Math.round(Math.abs(conv)).toLocaleString();
}
// Per-row pay/pay-out currency: personal transactions each store their own currency
// (the currency the money is actually in), independent of the view toggle. Legacy
// rows without one default to 'USD' — exactly the pre-currency-field assumption.
function _txCurOf(t){ return (t && t.currency) || 'USD'; }
// Options for the transaction-entry currency <select>s (built from CURRENCIES).
function _persCurrencyOptionsHtml(){
  const _m = (typeof CURRENCIES !== 'undefined' ? CURRENCIES : null) || window.CURRENCIES || {};
  return Object.entries(_m).map(([code,c])=>`<option value="${code}">${code} ${c.symbol||''}</option>`).join('');
}
// Populate the three entry currency pickers once; first population defaults to the
// current view currency (a sensible default — fully overridable, and never re-clobbered
// on later calls so a user's explicit choice sticks).
function _ensureTxCurrencyOptions(){
  ['qa-currency','qai-currency','tx-currency'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    if(!el.options||el.options.length===0){ el.innerHTML=_persCurrencyOptionsHtml(); el.value=persCurrency; }
  });
}
window._ensureTxCurrencyOptions=_ensureTxCurrencyOptions;

function renderPersonal(){
  const cur = window.CURRENCIES?.[persCurrency] || {symbol:'$', rate:1};
  const rate = cur.rate;

  // Income scaled to the selected period window (recurring × months + one-time),
  // all USD-normalized in _applyPersFilter; 0 before the first filter runs.
  const incomeUSD = (typeof window._persPeriodIncome==='number') ? window._persPeriodIncome : 0;
  _ensureTxCurrencyOptions();
  // Spending is stored in USD — convert for display
  const totalSpendUSD = spending.reduce((a,s)=>a+s.amount,0);
  const surplusUSD = incomeUSD - totalSpendUSD;

  const target = parseInt(document.getElementById('s-savings-target')?.value)||40;
  const savingsRate = incomeUSD>0 ? Math.round(surplusUSD/incomeUSD*100) : 0;
  // REAL net worth = manual assets + live portfolio − manual liabilities.
  const _pnw = computePersNetWorth();
  const nwUSD = Math.round(_pnw.netWorth);

  document.getElementById('pers-income').textContent = SP(incomeUSD);
  document.getElementById('pers-spend').textContent  = SP(totalSpendUSD);
  // KPI labels reflect the selected period.
  const _perWord = {month:'Monthly',quarter:'Quarterly',year:'Yearly'}[window._persPeriod||'year'] || 'Monthly';
  const _ilEl=document.getElementById('mc-income-label'); if(_ilEl) _ilEl.textContent=_perWord+' income';
  const _slEl=document.getElementById('mc-spend-label');  if(_slEl) _slEl.textContent=_perWord+' spending';
  document.getElementById('pers-savings').textContent = savingsRate+'%';
  document.getElementById('pers-savings-vs').textContent = (savingsRate>=target?'Above ':'Below ')+target+'% target';
  document.getElementById('pers-savings-vs').className = 'mc-change '+(savingsRate>=target?'up':'dn');
  document.getElementById('pers-nw').textContent   = SP(nwUSD);
  // Personal Investments — the live portfolio value (entity_id IS NULL holdings) that folds into
  // Net Worth above (netWorth = assets + portfolio − liabs), surfaced on its own personal card.
  const _piEl = document.getElementById('pers-invest');
  if(_piEl) _piEl.textContent = SP(_pnw.portfolio);
  const _picEl = document.getElementById('pers-invest-chg');
  if(_picEl){
    const _n = (typeof holdings!=='undefined'?holdings:[]).length;
    _picEl.textContent = _n ? (_n+' holding'+(_n!==1?'s':'')) : 'No holdings';
    _picEl.className = 'mc-change neutral';
  }
  // Real month-over-month delta from snapshots (≥2 needed); else honest "—".
  const _nwChg = personalNetWorthChange();
  const _chgEl = document.getElementById('pers-nw-chg');
  if(_chgEl){
    if(_nwChg.has){ _chgEl.textContent = (_nwChg.delta>=0?'+':'-')+SP(Math.abs(_nwChg.delta))+' this month'; _chgEl.className='mc-change '+(_nwChg.delta>=0?'up':'dn'); }
    else { _chgEl.textContent='—'; _chgEl.className='mc-change neutral'; }
  }

  // M55 (personal/business wall): the income caption names no business and no roster figure — the owner's salary is
  // in the income only as rows from PAID payroll runs (M14), like any other income row.
  const _incSrcEl = document.getElementById('pers-income-src');
  if(_incSrcEl) _incSrcEl.textContent = `After tax (${persCurrency})`;

  // Cash flow
  document.getElementById('p-cf-income').textContent  = '+'+SP(incomeUSD);
  document.getElementById('p-cf-income').style.color  = incomeUSD > 0 ? 'var(--green)' : 'var(--t2)';
  document.getElementById('p-cf-spend').textContent   = '-'+SP(totalSpendUSD);
  document.getElementById('p-cf-spend').style.color   = totalSpendUSD > 0 ? 'var(--red)' : 'var(--t2)';
  document.getElementById('p-cf-surplus').textContent = SP(surplusUSD);
  document.getElementById('p-cf-surplus').style.color = surplusUSD > 0 ? 'var(--acc)' : surplusUSD < 0 ? 'var(--red)' : 'var(--t2)';
  document.getElementById('p-cf-rate').textContent    = savingsRate+'%';
  document.getElementById('pers-spend-total').textContent = SP(totalSpendUSD);

  // Spending bars (read-only display; the confusing "Edit" budget editor was removed)
  const maxSpend = Math.max(...spending.map(s=>s.amount), 1);
  const _spFooter = document.getElementById('spending-footer-row');
  {
    if(spending.length === 0){
      document.getElementById('spending-bars').innerHTML = '<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No spending recorded yet — add a transaction to get started.</div>';
      if(_spFooter) _spFooter.style.display = 'none';
    } else {
      document.getElementById('spending-bars').innerHTML = spending.map(s=>`
        <div class="bar-row">
          <span class="bar-label">${s.label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round(s.amount/maxSpend*100)}%;background:${s.color}"></div></div>
          <span class="bar-val">${SP(s.amount)}</span>
        </div>`).join('');
      if(_spFooter) _spFooter.style.display = '';
    }
  }

  // Goals (convert from USD)
  const goalColors = ['var(--green)','var(--acc)','var(--acc-light)','var(--amber)','var(--purple)','var(--teal)'];
  document.getElementById('goals-list').innerHTML = goals.length===0
    ? '<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No goals yet — add one above</div>'
    : goals.map((g,i)=>{
        const p = g.target>0 ? Math.min(100,Math.round(g.current/g.target*100)) : 100;
        const m = g.monthly>0&&g.current<g.target ? Math.ceil((g.target-g.current)/g.monthly) : null;
        g.color = g.color||goalColors[i%goalColors.length];
        return `<div class="goal">
          <div class="goal-header">
            <span class="goal-name">${esc(g.name)}</span>
            <span style="display:flex;align-items:center;gap:6px">
              <span class="goal-val">${SP(g.current)}${g.target?' / '+SP(g.target):''}</span>
              ${g._dbId?`<button onclick="deletePersGoal(${g._dbId})" title="Delete goal" style="background:none;border:none;cursor:pointer;color:var(--t3);padding:0 1px;font-size:11px;line-height:1">✕</button>`:''}
            </span>
          </div>
          <div class="goal-track"><div class="goal-fill bar-fill" style="width:${p}%;background:${g.color}"></div></div>
          <div class="goal-sub">${p}%${m?' — ~'+m+' months remaining':' — goal reached!'}</div>
        </div>`;
      }).join('');

  // Transactions
  _renderPersTxList();
  if(typeof renderQAPills==='function') renderQAPills();
  if(typeof renderQAiPills==='function') renderQAiPills();

  renderPersonalSections();
  updateHealthScore(savingsRate, incomeUSD, surplusUSD);
}
// (Spending inline-edit / budget editor removed — Spending breakdown is now
// a read-only reflection of real transactions.)

function openGoalModal(){document.getElementById('goal-name').value='';document.getElementById('goal-current').value='';document.getElementById('goal-target').value='';document.getElementById('goal-monthly').value='';openModal('goal-modal')}
// Persist to /api/goals, then push into the module `goals` array renderPersonal
// reads, so the goal shows immediately without navigation. (Owned by app-main;
// the stale bundle override was removed — see finflow-api-wiring.js.)
async function saveGoal(){
  const name=document.getElementById('goal-name').value.trim();
  if(!name){notify('Goal name required',true);return;}
  // FA-M13: the form is in the personal display currency (its labels say which); goals are stored in USD, the basis
  // SP() converts from — so convert what was typed. It used to store the typed number AS USD whatever the currency shown.
  const _gc = ((typeof CURRENCIES !== 'undefined' ? CURRENCIES : window.CURRENCIES) || {})[persCurrency] || { rate: 1 };
  const _toUsd = v => (Number(_gc.rate) > 0 ? Math.round((v / Number(_gc.rate)) * 100) / 100 : v);
  const current=_toUsd(Number(document.getElementById('goal-current').value)||0);
  const target=_toUsd(Number(document.getElementById('goal-target').value)||0);
  const monthly=_toUsd(Number(document.getElementById('goal-monthly').value)||0);
  if(!target){notify('Target amount required',true);return;}
  try{
    const res=await fetch('/api/goals',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name,current_val:current,target_val:target,monthly_contrib:monthly,color:'var(--acc)'})});
    if(!res.ok) throw new Error((await res.json()).error||'Failed');
    const saved=await res.json();
    goals.push({_dbId:saved.id,name,current,target,monthly,color:'var(--acc)'});
    closeModal('goal-modal');
    renderPersonal();
    window.finflow?.refresh(['dashboard']);
    notify('Goal added ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save goal'));}
}
async function deletePersGoal(dbId){
  if(dbId==null) return;
  if(!(await window._confirmModal('Delete this goal?', {danger:true}))) return;
  try{
    const res=await fetch('/api/goals/'+dbId,{method:'DELETE',credentials:'include'});
    if(!res.ok) throw new Error('Failed');
    goals=goals.filter(g=>g._dbId!==dbId);
    renderPersonal();
    window.finflow?.refresh(['dashboard']);
    notify('Goal deleted');
  }catch(e){notify('Error: '+(e.message||'Failed to delete goal'));}
}

// ── Transaction entry: categories, inline quick-add + polished modal ───
// One category vocabulary shared by the quick-add pills, the modal pills, and
// the list rows (icon + colour). type drives which pills show.
const PERS_CATS=[
  {key:'Rent/Mortgage',type:'expense',color:'var(--acc)',   bg:'var(--acc-bg)',   icon:'home'},
  {key:'Groceries',    type:'expense',color:'var(--green)', bg:'var(--green-bg)', icon:'basket'},
  {key:'Dining out',   type:'expense',color:'var(--amber)', bg:'var(--amber-bg)', icon:'cup'},
  {key:'Transport',    type:'expense',color:'var(--teal)',  bg:'var(--teal-bg)',  icon:'car'},
  {key:'Entertainment',type:'expense',color:'var(--purple)',bg:'var(--purple-bg)',icon:'play'},
  {key:'Healthcare',   type:'expense',color:'var(--red)',   bg:'var(--red-bg)',   icon:'heart'},
  {key:'Shopping',     type:'expense',color:'var(--amber)', bg:'var(--amber-bg)', icon:'bag'},
  {key:'Subscriptions',type:'expense',color:'var(--acc2)',  bg:'var(--acc-bg)',   icon:'repeat'},
  {key:'Other',        type:'expense',color:'var(--t2)',    bg:'var(--bg3)',      icon:'dots'},
  {key:'Transfer',     type:'expense',color:'var(--t3)',    bg:'var(--bg3)',      icon:'repeat'},   // FA-M14: not spending
  {key:'Salary',       type:'income', color:'var(--green)', bg:'var(--green-bg)', icon:'cash'},
  {key:'Freelance',    type:'income', color:'var(--teal)',  bg:'var(--teal-bg)',  icon:'briefcase'},
  {key:'Other Income', type:'income', color:'var(--green)', bg:'var(--green-bg)', icon:'coins'},
  {key:'Transfer',     type:'income', color:'var(--t3)',    bg:'var(--bg3)',      icon:'repeat'},   // FA-M14: not income
];
function persCatMeta(cat){ return PERS_CATS.find(c=>c.key===cat) || PERS_CATS.find(c=>c.key==='Other'); }
function persCatIconSvg(icon){
  const P={
    home:'<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
    basket:'<path d="M5 9h14l-1.3 9H6.3z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
    cup:'<path d="M6 9h10v4a5 5 0 0 1-10 0z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="M6 20h10"/>',
    car:'<path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M4 13h16v4H4z"/><circle cx="7.5" cy="17.5" r="1.2"/><circle cx="16.5" cy="17.5" r="1.2"/>',
    play:'<circle cx="12" cy="12" r="8.5"/><path d="M10.5 9l4.5 3-4.5 3z"/>',
    heart:'<path d="M12 20s-6.5-4.2-6.5-8.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 6.5 3.5C18.5 15.8 12 20 12 20z"/>',
    bag:'<path d="M6 8h12l1 12H5z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    repeat:'<path d="M4 8l3-3 3 3"/><path d="M7 5v7a3 3 0 0 0 3 3h7"/><path d="M20 16l-3 3-3-3"/><path d="M17 19v-7a3 3 0 0 0-3-3H7"/>',
    dots:'<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
    cash:'<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    briefcase:'<rect x="3" y="7.5" width="18" height="11" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/>',
    coins:'<ellipse cx="9" cy="8" rx="5" ry="2.5"/><path d="M4 8v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V8"/><path d="M10 15.5c.3 1.3 2.4 2.3 5 2.3 2.8 0 5-1.1 5-2.5v-4c0-1-1.1-1.8-2.8-2.2"/>',
  };
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[icon]||P.dots}</svg>`;
}
function persPillHtml(c,active,onclick){
  const style=active?` style="background:${c.color};border-color:${c.color};color:#0e0b08"`:'';
  return `<button type="button" class="cat-pill${active?' active':''}"${style} onclick="${onclick}">${persCatIconSvg(c.icon)}${c.key}</button>`;
}

// ── Inline quick-add — EXPENSE-FIRST (primary) ────────────────────────
// The primary bar is the expense entry by definition (no type toggle). Income
// is a tucked, collapsed-by-default secondary bar below it. Both funnel through
// the same _persCommitTx pipeline; only the category set + type differ.
window._qaCat='Other';        // primary expense category
window._qaiCat='Salary';      // secondary income category
function persQAsetCat(key){ window._qaCat=key; renderQAPills(); }
function renderQAPills(){
  const el=document.getElementById('qa-cat-pills'); if(!el) return;
  const cats=PERS_CATS.filter(c=>c.type==='expense');
  if(!cats.some(c=>c.key===window._qaCat)) window._qaCat='Other';
  el.innerHTML=cats.map(c=>persPillHtml(c,window._qaCat===c.key,`persQAsetCat('${c.key.replace(/'/g,"\\'")}')`)).join('');
}
async function persQuickAdd(){
  const amount=Number(document.getElementById('qa-amount')?.value);
  if(!amount||amount<=0){notify('Enter an amount',true);return;}
  const cat=window._qaCat||'Other';
  const desc=(document.getElementById('qa-desc')?.value||'').trim()||cat;
  const currency=document.getElementById('qa-currency')?.value||persCurrency;
  try{
    await _persCommitTx({desc,amount,cat,type:'expense',date:todayLocal(),currency});
    const a=document.getElementById('qa-amount'); if(a) a.value='';
    const d=document.getElementById('qa-desc');   if(d) d.value='';
    if(a) a.focus();
    notify('Expense added ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save'));}
}

// ── Income — SECONDARY, collapsed by default ──────────────────────────
function toggleIncomeEntry(){
  const box=document.getElementById('qa-income'); if(!box) return;
  // `open` = should we open it? True only when it's currently hidden. NB: an
  // opened panel has display==='' (empty), so the old `|| !box.style.display`
  // clause made it read as "hidden" and re-open forever — the X never closed it.
  const open = box.style.display==='none';
  box.style.display = open ? '' : 'none';
  const btn=document.getElementById('qa-income-toggle'); if(btn) btn.style.display = open ? 'none' : '';
  if(open){ renderQAiPills(); document.getElementById('qai-amount')?.focus(); }
}
function persQAiSetCat(key){ window._qaiCat=key; renderQAiPills(); }
function renderQAiPills(){
  const el=document.getElementById('qai-cat-pills'); if(!el) return;
  const cats=PERS_CATS.filter(c=>c.type==='income');
  if(!cats.some(c=>c.key===window._qaiCat)) window._qaiCat=cats[0].key;
  el.innerHTML=cats.map(c=>persPillHtml(c,window._qaiCat===c.key,`persQAiSetCat('${c.key.replace(/'/g,"\\'")}')`)).join('');
}
async function persIncomeAdd(){
  const amount=Number(document.getElementById('qai-amount')?.value);
  if(!amount||amount<=0){notify('Enter an amount',true);return;}
  const cat=window._qaiCat||'Salary';
  const desc=(document.getElementById('qai-desc')?.value||'').trim()||cat;
  const currency=document.getElementById('qai-currency')?.value||persCurrency;
  try{
    await _persCommitTx({desc,amount,cat,type:'income',date:todayLocal(),currency});
    const a=document.getElementById('qai-amount'); if(a) a.value='';
    const d=document.getElementById('qai-desc');   if(d) d.value='';
    if(a) a.focus();
    notify('Income added ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save'));}
}

// ── "More details" modal (custom date, notes, editing) ────────────────
window._txmType='expense';
window._txmCat='Other';
function txmSetType(type,keepCat){
  window._txmType=type;
  document.getElementById('txm-type-exp')?.classList.toggle('active',type==='expense');
  document.getElementById('txm-type-inc')?.classList.toggle('active',type==='income');
  if(!keepCat) window._txmCat = type==='income' ? 'Other Income' : 'Other';
  renderTxmPills();
}
function txmSetCat(key){ window._txmCat=key; renderTxmPills(); }
function renderTxmPills(){
  const el=document.getElementById('tx-cat-pills'); if(!el) return;
  const type=window._txmType||'expense';
  const cats=PERS_CATS.filter(c=>c.type===type);
  if(!cats.some(c=>c.key===window._txmCat)) window._txmCat=cats[cats.length-1].key;
  el.innerHTML=cats.map(c=>persPillHtml(c,window._txmCat===c.key,`txmSetCat('${c.key.replace(/'/g,"\\'")}')`)).join('');
}
function openTransactionModal(type,editTx){
  const isEdit=!!(editTx&&editTx._dbId);
  const t=isEdit?(editTx.flow||editTx.type):(type||'expense');   // FA-M14: a transfer edits on its money direction
  const setV=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  setV('tx-edit-id', isEdit?editTx._dbId:'');
  // Carry over anything already typed in the quick-add bar for a smooth handoff.
  setV('tx-amount', isEdit?editTx.amount:(document.getElementById('qa-amount')?.value||''));
  setV('tx-desc',   isEdit?editTx.desc:(document.getElementById('qa-desc')?.value||''));
  setV('tx-date',   isEdit?(editTx.date||todayLocal()):todayLocal());
  // Currency picker: populate options, then default (new → view currency; edit →
  // the transaction's OWN stored currency so it shows and can be changed).
  _ensureTxCurrencyOptions();
  const _curEl=document.getElementById('tx-currency'); if(_curEl) _curEl.value = isEdit ? _txCurOf(editTx) : persCurrency;
  const titleEl=document.getElementById('txm-title'); if(titleEl) titleEl.textContent=isEdit?'Edit transaction':'Add transaction';
  const btnEl=document.getElementById('txm-save-btn'); if(btnEl) btnEl.textContent=isEdit?'Save changes':'Add transaction';
  window._txmCat = isEdit?editTx.cat:(window._qaCat||(t==='income'?'Other Income':'Other'));
  txmSetType(t,true);   // keep the category we just set
  // Recurring toggle: offered for BOTH new and edited transactions. Reset to a
  // clean state first; on edit we then async-prefill from the tied profile (if any).
  setV('tx-recurring-id','');
  const _rc=document.getElementById('tx-recurring'); if(_rc) _rc.checked=false;
  const _ro=document.getElementById('tx-recurring-opts'); if(_ro) _ro.style.display='none';
  const _rf=document.getElementById('tx-freq'); if(_rf) _rf.value='Monthly';
  const _re=document.getElementById('tx-end-date'); if(_re) _re.value='';
  const _rw=document.getElementById('txm-recurring-wrap'); if(_rw) _rw.style.display='';
  if(isEdit) _prefillRecurringForEdit(editTx);
  openModal('transaction-modal');
}
// On edit, find the recurring profile tied to this transaction (no FK exists, so
// match on description+type+amount — the same fields the create flow copies) and
// reflect its state in the modal. Async; guards against a stale/reopened modal.
async function _prefillRecurringForEdit(editTx){
  // F96 class — DATA LOSS, not cosmetic: if this prefill fails, the "recurring" toggle stays at its
  // unchecked default; saveTransaction would then commit recurring_profile_id = null and
  // _persCommitTx UNLINKS the occurrence ("On edit, null unlinks") — silently converting a
  // recurring transaction to one-time from a failed READ. The flag below makes saveTransaction
  // LEAVE the recurring link untouched when the state was never loaded (the server PUT preserves an
  // omitted recurring_profile_id), so a failed read can no longer destroy the setting.
  window._txRecurringUnknown = false;
  try{
    const r=await fetch('/api/recurring-personal-transactions',{credentials:'include'});
    if(!r.ok){
      if(r.status !== 401 && r.status !== 403){
        console.error('[Recurring] prefill failed (HTTP '+r.status+') — recurring status will be left unchanged');
        window._txRecurringUnknown = true;
        if(typeof notify === 'function') notify('Could not load recurring status — it will be left unchanged on save', true);
      }
      return;
    }
    const profs=await r.json();
    const match=(profs||[]).find(p=>
      (p.description||'').trim()===(editTx.desc||'').trim() &&
      (p.tx_type||'expense')===(editTx.type||'expense') &&
      Math.abs((parseFloat(p.amount)||0)-(parseFloat(editTx.amount)||0))<0.005 &&
      (p.status||'active')!=='cancelled');
    if(!match) return;
    // Only apply if the modal is still editing this same transaction.
    if((document.getElementById('tx-edit-id')?.value||'')!==String(editTx._dbId)) return;
    const idEl=document.getElementById('tx-recurring-id'); if(idEl) idEl.value=match.id;
    const rc=document.getElementById('tx-recurring'); if(rc) rc.checked=true;
    const ro=document.getElementById('tx-recurring-opts'); if(ro) ro.style.display='';
    const rf=document.getElementById('tx-freq'); if(rf) rf.value=match.frequency||'Monthly';
    const re=document.getElementById('tx-end-date'); if(re) re.value=(match.end_date||'').slice(0,10);
  }catch(e){
    // F96 class — the NETWORK-failure path (fetch rejected) lands HERE, not in the !r.ok branch
    // above, and this catch used to be silent — so a dropped connection left the recurring state
    // unloaded AND unflagged, and a save would then unlink the profile (data loss). Flag it here
    // too so saveTransaction preserves the link on a network failure exactly as on a 500.
    console.error('[Recurring] prefill errored — recurring status will be left unchanged:', e && e.message);
    window._txRecurringUnknown = true;
    if(typeof notify === 'function') notify('Could not load recurring status — it will be left unchanged on save', true);
  }
}
// Next occurrence for a recurring personal transaction (mirrors server nextRunDate).
// F159/Rule 10: a next_run is a calendar date. The old `new Date(dateStr)` + local setMonth made
// the result depend on the VIEWER's timezone (a 1st-of-month date rolled back a day west of UTC).
// Compute with integer Y/M/D + UTC-only day math so no timezone can shift it.
function _txNextRun(dateStr,freq){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr||todayLocal()).slice(0,10));
  if(!m) return null;
  let y=+m[1], mo=+m[2], d=+m[3];
  const f=String(freq||'').trim().toLowerCase();
  if(f==='weekly') return new Date(Date.UTC(y,mo-1,d)+7*86400000).toISOString().slice(0,10);
  if(f==='quarterly')                                     mo+=3;
  else if(f==='yearly'||f==='annually'||f==='annual')     y+=1;
  else                                                    mo+=1; // Monthly / default
  y+=Math.floor((mo-1)/12); mo=((mo-1)%12)+1;
  const dim=new Date(Date.UTC(y,mo,0)).getUTCDate(); if(d>dim) d=dim;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
async function saveTransaction(){
  const amount=Number(document.getElementById('tx-amount')?.value);
  const desc=(document.getElementById('tx-desc')?.value||'').trim();
  if(!desc||!amount||amount<=0){notify('Description and a valid amount are required',true);return;}
  const cat=window._txmCat||'Other';
  const type=window._txmType||'expense';
  const date=document.getElementById('tx-date')?.value||todayLocal();
  const currency=document.getElementById('tx-currency')?.value||persCurrency;
  const editId=document.getElementById('tx-edit-id')?.value||'';
  const recurring=!!document.getElementById('tx-recurring')?.checked;
  const recurringId=document.getElementById('tx-recurring-id')?.value||'';
  const frequency=document.getElementById('tx-freq')?.value||'Monthly';
  const endDate=document.getElementById('tx-end-date')?.value||null;
  try{
    // Resolve the recurring profile FIRST so the occurrence can be committed with
    // its id (hard link). Update an existing profile (no duplicate), create a new
    // one scheduled for the NEXT cycle (next_run strictly after the date so today's
    // row isn't duplicated), or cancel it if the toggle was cleared. The resulting
    // profileId is stamped onto the occurrence so the period-KPI math can exclude
    // this materialised row and project the profile instead (no double-count).
    // F96 class: if the recurring state was never loaded (prefill fetch failed on an edit), do NOT
    // touch the profile OR the link. `undefined` makes _persCommitTx omit recurring_profile_id, and
    // the server PUT preserves an omitted field (server.js:1184) — so the existing recurrence
    // survives a failed read instead of being silently cleared.
    let profileId = recurring ? (recurringId ? Number(recurringId) : null) : null;
    if(editId && window._txRecurringUnknown){
      profileId = undefined;   // leave the link exactly as it is
    } else {
    try{
      if(recurring){
        const _body={description:desc,category:cat,amount,tx_type:type,frequency,status:'active',end_date:endDate,currency};
        if(recurringId){
          const res=await fetch('/api/recurring-personal-transactions/'+recurringId,{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',
            body:JSON.stringify(_body)});
          if(!res.ok) throw new Error((await res.json()).error||'Failed');
          profileId=Number(recurringId);
        }else{
          const res=await fetch('/api/recurring-personal-transactions',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
            body:JSON.stringify({..._body,next_run:_txNextRun(date,frequency)})});
          if(!res.ok) throw new Error((await res.json()).error||'Failed');
          const _prow=await res.json(); profileId=(_prow&&_prow.id!=null)?Number(_prow.id):null;
        }
      }else if(recurringId){
        // Toggle cleared on a transaction that had a profile → stop the recurrence.
        await fetch('/api/recurring-personal-transactions/'+recurringId,{method:'DELETE',credentials:'include'});
        profileId=null;
      }
    }catch(re){notify('Saved, but recurring setup failed — '+(re.message||''),true);}
    }
    // Commit the occurrence, linking it to (profileId) or clearing it from (null) the profile.
    await _persCommitTx({desc,amount,cat,type,date,editId:editId||null,recurringProfileId:profileId,currency});
    closeModal('transaction-modal');
    notify(editId?'Transaction updated ✦':(recurring?'Recurring expense set up ✦':'Transaction added ✦'));
  }catch(e){notify('Error: '+(e.message||'Failed to save'));}
}
function editPersTx(dbId){
  if(dbId==null) return;
  const t=(persTransactions||[]).find(x=>x._dbId===dbId)||(window._allPersTxs||[]).find(x=>x._dbId===dbId);
  if(t) openTransactionModal(null,t);
}
// Single commit path for BOTH quick-add and the modal → always refreshes the
// rebuilt personal pipeline (list, tiles, donut) + the main dashboard.
async function _persCommitTx({desc,amount,cat,type,date,editId,recurringProfileId,currency}){
  const body={description:desc,category:cat,amount,tx_type:type,tx_date:date,currency:currency||persCurrency};
  // Only send the link when the caller supplies it (saveTransaction). Quick-add
  // leaves it undefined → server stores null (one-time). On edit, null unlinks.
  if(recurringProfileId!==undefined) body.recurring_profile_id=recurringProfileId;
  const url=editId?('/api/personal-transactions/'+editId):'/api/personal-transactions';
  const res=await fetch(url,{method:editId?'PUT':'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
  if(!res.ok) throw new Error((await res.json()).error||'Failed');
  if(typeof loadPersonalFinance==='function') await loadPersonalFinance();
  window.finflow?.refresh(['dashboard']);
}


function payrollCardPreviewNet(){
  const gross=parseFloat(document.getElementById('payroll-cta-gross')?.value)||0;
  const net=netFromDeductions(gross, readDedRows('cta-deductions-rows'));
  const el=document.getElementById('payroll-cta-net');
  if(el) el.textContent=gross>0?'Net: '+S(net)+'/mo':'';
}

async function saveOwnerPayrollCard(){
  const fname=(document.getElementById('payroll-cta-fname')?.value||'').trim();
  const lname=(document.getElementById('payroll-cta-lname')?.value||'').trim();
  const gross=parseFloat(document.getElementById('payroll-cta-gross')?.value)||0;
  const deductions=readDedRows('cta-deductions-rows');
  const role=(document.getElementById('payroll-cta-role')?.value||'Owner').trim();
  if(!fname){notify('Please enter your first name');return;}
  if(!gross){notify('Please enter your monthly salary');return;}
  const activeIdx=typeof ENTITIES!=='undefined'?ENTITIES.findIndex(e=>e.active):-1;
  const entity=activeIdx>=0?ENTITIES[activeIdx]:null;
  const existing=activeIdx>=0?(ownerPayrollByEntity[activeIdx]||null):null;
  const payload={fname,lname,gross,deductions,is_owner:true,entity_id:entity?._dbId||null,role,emp_type:'owner',av_class:'av-blue'};
  try{
    let saved;
    if(existing?._dbId){
      const r=await fetch('/api/payroll/'+existing._dbId,{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
      if(!r.ok) throw new Error((await r.json()).error||'Failed');
      saved=await r.json();
    }else{
      const r=await fetch('/api/payroll',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
      if(!r.ok) throw new Error((await r.json()).error||'Failed');
      saved=await r.json();
    }
    if(activeIdx>=0){
      ownerPayrollByEntity[activeIdx]={
        _dbId:saved.id,fname,lname,role,
        gross,deductions,
        net:netFromDeductions(gross, deductions),
        currency:entity?.currency||'USD',
        initials:((fname[0]||'')+(lname[0]||'')).toUpperCase(),
        avClass:'av-blue',
        entityName:entity?.name||'Entity',
      };
      window.ownerPayrollByEntity=ownerPayrollByEntity;
      ownerPayroll=ownerPayrollByEntity[activeIdx];
      window.ownerPayroll=ownerPayroll;
    }
    if(typeof syncAllPayrollsToPersonal==='function') syncAllPayrollsToPersonal();
    if(typeof loadPersonalFinance==='function') await loadPersonalFinance();
    if(typeof renderPayroll==='function') renderPayroll();
    window.finflow?.refresh(['payroll','dashboard','personal-finance']);
    notify('Payroll saved — Personal Finance synced ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save'));}
}

function openAddEmployeeModal(){
  const _sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  _sv('emp-fname',''); _sv('emp-lname',''); _sv('emp-jobtitle','');
  _sv('emp-type','Full-time'); _sv('emp-gross',''); _sv('emp-startdate','');
  setDedRows('emp-deductions-rows','previewEmpNet', []);
  const _own=document.getElementById('emp-is-owner'); if(_own) _own.checked=false;   // LA3
  const prev=document.getElementById('emp-net-preview');
  if(prev) prev.textContent='—';
  openModal('add-employee-modal');
}

function previewEmpNet(){
  const gross=parseFloat(document.getElementById('emp-gross')?.value)||0;
  const net=netFromDeductions(gross, readDedRows('emp-deductions-rows'));
  const el=document.getElementById('emp-net-preview');
  if(el) el.textContent=gross>0?_nativeSymbol()+net.toLocaleString():'—';  // F129
}

async function saveNewEmployee(){
  const fname=(document.getElementById('emp-fname')?.value||'').trim();
  const lname=(document.getElementById('emp-lname')?.value||'').trim();
  const role=(document.getElementById('emp-jobtitle')?.value||'').trim();
  const empType=document.getElementById('emp-type')?.value||'Full-time';
  const gross=parseFloat(document.getElementById('emp-gross')?.value)||0;
  const deductions=readDedRows('emp-deductions-rows');
  if(!fname){notify('First name is required');return;}
  if(!gross){notify('Monthly gross salary is required');return;}
  const colors=['av-blue','av-green','av-purple','av-amber','av-teal'];
  const avClass=colors[Math.floor(Math.random()*colors.length)];
  const activeIdx=typeof ENTITIES!=='undefined'?ENTITIES.findIndex(e=>e.active):-1;
  const entity=activeIdx>=0?ENTITIES[activeIdx]:null;
  // LA3 (live audit 2026-10-13 B2): this form always saved is_owner:false, so an owner added here was an ordinary
  // employee and a paid run crossed nothing to Personal. "This is me" flags the roster entry as the owner.
  const isOwner=!!document.getElementById('emp-is-owner')?.checked;
  try{
    const r=await fetch('/api/payroll',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({fname,lname,role,emp_type:empType,gross,deductions,is_owner:isOwner,av_class:avClass,entity_id:entity?._dbId||null})});
    if(!r.ok) throw new Error((await r.json()).error||'Failed to save');
    const saved=await r.json();
    if(isOwner){
      // The owner is drawn from the roster by loadEntityData (owner card + payroll link) — reload rather than guess.
      closeModal('add-employee-modal');
      if(typeof window.loadEntityData==='function' && activeIdx>=0) await window.loadEntityData(activeIdx);
      if(typeof renderPayroll==='function') renderPayroll();
      window.finflow?.refresh(['payroll','dashboard']);
      notify(fname+' '+lname+' added as you, the owner ✦');
      return;
    }
    const net=netFromDeductions(gross, deductions);
    const initials=((fname[0]||'')+(lname[0]||'')).toUpperCase();
    payrollEmployees.push({_dbId:saved.id,fname,lname,role,type:empType,gross,deductions,net,initials,avClass,isOwner:false});
    window.payrollEmployees=payrollEmployees;
    closeModal('add-employee-modal');
    renderPayroll();
    window.finflow?.refresh(['payroll','dashboard']);
    notify(fname+' '+lname+' added to payroll ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save employee'));}
}

function _renderPersTxList(){
  const filter=window._persTxFilter||'all';
  const txs=persTransactions.filter(t=>filter==='all'||t.type===filter);
  const el=document.getElementById('pers-transactions');
  if(!el) return;
  if(txs.length===0){
    el.innerHTML='<div class="empty-state" style="padding:1.5rem .75rem"><div style="font-size:12.5px;color:var(--t3);text-align:center">'+(filter==='all'?'No transactions yet — add one above ↑':'No '+filter+' transactions in this view')+'</div></div>';
    const balRow=document.getElementById('pers-tx-balance');
    if(balRow) balRow.style.display='none';
    return;
  }
  const _curMap=(typeof CURRENCIES!=='undefined'?CURRENCIES:null)||window.CURRENCIES||{};
  let running=0;   // accumulated in USD so mixed-currency rows are additive
  el.innerHTML=txs.map(t=>{
    const _c=_txCurOf(t);
    running+=((t.flow||t.type)==='income'?1:-1)*_safeFX(t.amount,_c,'USD');   // FA-M14: a transfer still moves money
    const m=persCatMeta(t.cat);
    // Ledger shows each row in its OWN currency (the exact figure entered), with a
    // muted ≈ conversion into the view currency when they differ, and the ISO code on
    // the meta line for disambiguation — so a mixed-currency list stays legible.
    const _nsym=(_curMap[_c]||{symbol:''}).symbol||'';
    const _native=_nsym+Math.round(Math.abs(t.amount)).toLocaleString();
    const _conv=(_c!==persCurrency)?` <span style="color:var(--t3);font-size:10px;font-weight:400">≈ ${SPfromFull(t.amount,_c)}</span>`:'';
    const _codeTag=(_c!==persCurrency)?` · ${esc(_c)}`:'';
    return `<div class="tx-row pers-tx-row" style="align-items:center">
      <div class="tx-left" style="flex:1;min-width:0">
        <div class="tx-icon" style="background:${m.bg};color:${m.color}">${persCatIconSvg(m.icon)}</div>
        <div style="min-width:0"><div class="tx-name">${esc(t.desc)}</div><div class="tx-cat">${esc(t.cat)} · ${esc(t.date)}${_codeTag}</div></div>
      </div>
      <div class="tx-amt ${t.type==='transfer'?'':((t.flow||t.type)==='income'?'up':'dn')}" style="margin-right:6px"${t.type==='transfer'?' title="A transfer — not counted as spending or income"':''}>${(t.flow||t.type)==='income'?'+':'-'}${_native}${_conv}</div>
      ${t._dbId?`<button class="tx-act tx-edit" onclick="editPersTx(${t._dbId})" title="Edit transaction" aria-label="Edit transaction"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></button>`:''}
      ${t._dbId?`<button class="tx-act tx-del" onclick="deletePersonalTransaction(${t._dbId})" style="font-size:12px" title="Delete transaction" aria-label="Delete transaction">✕</button>`:''}
    </div>`;
  }).join('');
  const balRow=document.getElementById('pers-tx-balance');
  const balVal=document.getElementById('pers-tx-balance-val');
  if(balRow){balRow.style.display='flex';}
  if(balVal){balVal.textContent=SP(Math.abs(running));balVal.style.color=running>=0?'var(--green)':'var(--red)';}
}

window._persSideIncome=0;
window._persPeriod='year';
window._persTxFilter='all';
window._allPersTxs=[];
window._persRecurring=[];

// Monthly-equivalent value of a recurring amount given its frequency (mirrors the
// helper in finflow-bundle.js). Weekly→×52/12, Quarterly→/3, Yearly→/12, else as-is.
function _persMonthlyEquiv(amount,frequency){
  const a=parseFloat(amount)||0; const f=String(frequency||'Monthly').toLowerCase();
  if(f.startsWith('week')) return a*52/12;
  if(f.startsWith('quarter')) return a/3;
  if(f.startsWith('year')||f.startsWith('annual')) return a/12;
  return a;
}

// Rule 10 (F87 class): the personal window is CALENDAR-date strings ('YYYY-MM-DD', inclusive of today) —
// it used local-midnight Date bounds against new Date(t.date) (UTC midnight), so west of UTC a row dated the
// 1st fell before the month start and dropped out of its own month.
function _persPeriodRange(){
  const today=window.FinFlowDates.resolvedToday(new Date());
  const y=today.slice(0,4), m=parseInt(today.slice(5,7),10);
  if(window._persPeriod==='month') return{from:y+'-'+String(m).padStart(2,'0')+'-01',to:today};
  if(window._persPeriod==='quarter') return{from:y+'-'+String(Math.floor((m-1)/3)*3+1).padStart(2,'0')+'-01',to:today};
  return{from:y+'-01-01',to:today};
}

function setPersPeriod(period){
  window._persPeriod=period;
  document.querySelectorAll('.pers-period-btn').forEach(b=>{
    b.classList.toggle('active-preset',b.dataset.period===period);
  });
  _applyPersFilter();
}

function setPersTxFilter(filter){
  window._persTxFilter=filter;
  document.querySelectorAll('.pers-tx-filter-btn').forEach(b=>{
    b.classList.toggle('active-preset',b.dataset.filter===filter);
  });
  _renderPersTxList();
}

function _applyPersFilter(){
  const{from,to}=_persPeriodRange();
  const CAT_GROUP={'Rent/Mortgage':'Housing','Groceries':'Food','Dining out':'Food','Transport':'Transport','Entertainment':'Entertainment','Healthcare':'Healthcare','Shopping':'Shopping','Subscriptions':'Subscriptions','Other':'Other','Income':'Other'};
  const CAT_COLOR={Housing:'var(--acc)',Food:'var(--green)',Transport:'var(--teal)',Entertainment:'var(--purple)',Healthcare:'var(--red)',Shopping:'var(--amber)',Subscriptions:'var(--acc2)',Other:'var(--t3)'};
  // Months the window spans (Month=1, Quarter=3, Year=12) — kept for callers that label the period; no figure is
  // scaled by it any more (M12).
  const monthsInWindow={month:1,quarter:3,year:12}[window._persPeriod]||1;
  window._persPeriodMonths=monthsInWindow;
  // All actual transactions in the window — drives the transaction LIST, running
  // balance and _persSideIncome (meaning unchanged: real income seen in-window).
  persTransactions=window._allPersTxs.filter(t=>{
    const d=window.FinFlowDates._toYmd(t.date);return d!=null&&d>=from&&d<=to;   // Rule 10: string compare
  });
  // Per-row FX normalization: each personal amount is stored in its OWN currency;
  // every aggregate below sums in USD via _fxu so mixed-currency rows are additive.
  // (No amount is ever stored as USD — normalization happens only here, at read.)
  const _fxu=(amt,cur)=>_safeFX(amt, cur||'USD', 'USD');
  window._persSideIncome=persTransactions.filter(t=>t.type==='income').reduce((a,t)=>a+_fxu(t.amount,_txCurOf(t)),0);

  // ── M12 (money audit 2026-10-09): what ACTUALLY happened in the window — every in-window row counts ONCE at its
  // own amount (USD-normalised per row), recurring or not. A recurring source used to be counted once and then
  // SCALED to monthlyEquivalent × the period's NOMINAL months (Year = 12): one 1,000 salary occurrence in July
  // read as 12,000 for the year, and a raise re-priced all twelve months retroactively — the roster × months
  // pattern basis C removed from the business side. Recurring rows still split out for the income-sources card.
  const profById=new Map((window._persRecurring||[]).map(p=>[p.id,p]));
  const isRecur=t=>t.recurringProfileId!=null && profById.has(t.recurringProfileId);
  const catTotals={};
  persTransactions.filter(t=>t.type==='expense').forEach(t=>{const c=CAT_GROUP[t.cat]||'Other';catTotals[c]=(catTotals[c]||0)+_fxu(t.amount,_txCurOf(t));});
  spending=Object.entries(catTotals).map(([label,amount])=>({label,amount,color:CAT_COLOR[label]||'var(--t3)',budget:0}));
  const recurIncome=persTransactions.filter(t=>isRecur(t)&&t.type==='income').reduce((a,t)=>a+_fxu(t.amount,_txCurOf(t)),0);
  const oneTimeIncome=persTransactions.filter(t=>!isRecur(t)&&t.type==='income').reduce((a,t)=>a+_fxu(t.amount,_txCurOf(t)),0);
  window._persPeriodRecurIncome=recurIncome;
  window._persPeriodOneTimeIncome=oneTimeIncome;
  window._persPeriodIncome=oneTimeIncome+recurIncome;
  renderPersonal();
}

async function deletePersonalTransaction(dbId){
  try{
    const res=await fetch('/api/personal-transactions/'+dbId,{method:'DELETE',credentials:'include'});
    if(!res.ok) throw new Error('Failed');
    await loadPersonalFinance();
    notify('Transaction deleted');
  }catch(e){notify('Error: '+(e.message||'Failed to delete'));}
}

async function loadPersonalFinance(){
  console.log('[PersFinance] starting loadPersonalFinance');
  try{
    const r=await fetch('/api/personal-transactions',{credentials:'include'});
    if(!r.ok){
      console.warn('[PersFinance] /api/personal-transactions returned',r.status,'— continuing without transactions');
    } else {
      const txs=await r.json();
      window._allPersTxs=txs.map(t=>({_dbId:t.id,desc:t.description||'',cat:t.category||'Other',amount:parseFloat(t.amount)||0,currency:t.currency||'USD',type:window.FinFlowDates.personalTxKind(t),flow:window.FinFlowDates.personalTxType(t),date:(t.tx_date||t.created_at||'').slice(0,10),recurringProfileId:(t.recurring_profile_id!=null?Number(t.recurring_profile_id):null)}));
    }
    // Active recurring profiles feed the period-KPI projection (base × months).
    try{
      const rr=await fetch('/api/recurring-personal-transactions',{credentials:'include'});
      window._persRecurring = rr.ok ? ((await rr.json())||[]).map(p=>({id:p.id,description:p.description||'',category:p.category||'Other',amount:parseFloat(p.amount)||0,currency:p.currency||'USD',tx_type:p.tx_type||'expense',frequency:p.frequency||'Monthly',status:p.status||'active',end_date:p.end_date||null})) : (window._persRecurring||[]);
    }catch(_){ window._persRecurring=window._persRecurring||[]; }
    // NOTE: owner salary is no longer a separate `basePersonalIncome` term. It is a
    // linked recurring personal-income profile (created by the payroll sync), so it
    // flows through the SAME occurrence-driven projection as any other recurring
    // income in _applyPersFilter — one representation, no double-count, currency-aware.
    // Real assets/liabilities + net-worth snapshots.
    try{
      const aRes=await fetch('/api/personal-accounts',{credentials:'include'});
      window._persAccounts = aRes.ok ? ((await aRes.json())||[]).map(_mapPersAccount) : (window._persAccounts||[]);
    }catch(_){ window._persAccounts=window._persAccounts||[]; }
    // Capture this month's net-worth snapshot — throttled (render path), never blocks render.
    _ffCaptureSnap('networth');
    try{
      const sRes=await fetch('/api/snapshots?kind=networth',{credentials:'include'});
      window._nwSnapshots = sRes.ok ? ((await sRes.json())||[]).map(s=>({value:parseFloat(s.value)||0,date:s.date||''})) : (window._nwSnapshots||[]);
    }catch(_){ window._nwSnapshots=window._nwSnapshots||[]; }
    // Goals — load into the module `goals` array renderPersonal reads (owned by
    // app-main now; the bundle's loadGoalsFromDB override was removed).
    try{
      const gRes=await fetch('/api/goals',{credentials:'include'});
      if(gRes.ok){
        const gRows=await gRes.json();
        goals=(gRows||[]).map(g=>({_dbId:g.id,name:g.name,current:parseFloat(g.current_val)||0,target:parseFloat(g.target_val)||0,monthly:parseFloat(g.monthly_contrib)||0,color:g.color||'var(--acc)'}));
      }
    }catch(_){}
    if(typeof renderPersAccounts==='function'){ try{ renderPersAccounts(); }catch(_){}}
    if(typeof window.ffPersBankRender==='function'){ try{ window.ffPersBankRender(); }catch(_){}}   // M60: the person's own bank card
    _applyPersFilter();
    renderPersHistory();   // LC3c — not awaited: the history never holds up the figures
  }catch(e){console.warn('[Personal] Load failed:',e.message);}
}
window.loadPersonalFinance=loadPersonalFinance;

// LC3c: Personal's own history (GET /api/personal-history — the person's rows, whichever business is in view). Shown
// here only; it is never written to, or read from, the business audit trail.
const _PH_KIND={personal_transactions:'Transaction',bank_lines:'Bank line',bank_import:'Statement import',bank_sync:'Bank sync',bank_link:'Linked bank',bank_settings:'Bank settings',personal_accounts:'Asset / liability',goals:'Goal',holdings:'Investment',snapshots:'Net-worth snapshot',recurring_personal_transactions:'Recurring transaction',owner_salary:'Owner salary'};
const _PH_ACT={CREATE:'Added',UPDATE:'Changed',DELETE:'Deleted',LINK:'Linked',UNLINK:'Unlinked',IMPORT:'Imported',SYNC:'Synced',CAPTURE:'Captured'};
function _phWhat(r){
  const d=r.after_data||r.before_data||{};
  if(r.kind==='bank_import') return (d.imported||0)+' line'+(d.imported===1?'':'s');
  if(r.kind==='bank_sync') return (d.provider||'')+' · '+(d.added||0)+' new';
  if(r.kind==='bank_link') return d.institution||d.provider||'';
  if(r.kind==='bank_settings') return [d.country,d.currency].filter(Boolean).join(' · ');
  return d.description||d.name||d.ticker||d.kind||'';
}
async function renderPersHistory(){
  const el=document.getElementById('pers-history-list'); if(!el) return;
  try{
    const r=await fetch('/api/personal-history?limit=50',{credentials:'include'});
    if(!r.ok){ el.innerHTML='<div style="font-size:12px;color:var(--red);padding:.25rem 0">Could not load your history — try again.</div>'; return; }
    const rows=await r.json();
    if(!rows.length){ el.innerHTML='<div style="font-size:12px;color:var(--t3);padding:.25rem 0">No changes recorded yet.</div>'; return; }
    el.innerHTML=rows.map(x=>`<div class="tx-row"><div class="tx-left"><div><div class="tx-name">${esc((_PH_ACT[x.action]||x.action)+' · '+(_PH_KIND[x.kind]||x.kind))}</div><div class="tx-cat">${esc(_phWhat(x))}${x.actor_type==='system'?' · automatic':''}</div></div></div><span class="tx-amt" style="color:var(--t3);font-size:11px">${esc(x.at?new Date(x.at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'')}</span></div>`).join('');
  }catch(e){ el.innerHTML='<div style="font-size:12px;color:var(--red);padding:.25rem 0">Could not load your history — check your connection.</div>'; }
}
window.renderPersHistory=renderPersHistory;

// ── PERSONAL NET WORTH (real, from personal_accounts + live portfolio) ─────────
function personalPortfolioValue(){ return (typeof holdings!=='undefined'?holdings:[]).reduce((a,h)=>a+((parseFloat(h.price)||0)*(parseFloat(h.shares)||0)),0); }
function computePersNetWorth(){
  const accts=window._persAccounts||[];
  const assets=accts.filter(a=>a.kind==='asset').reduce((s,a)=>s+_acctUsd(a),0);       // M13: per-row USD
  const liabs =accts.filter(a=>a.kind==='liability').reduce((s,a)=>s+_acctUsd(a),0);
  const portfolio=personalPortfolioValue();
  return { assets, liabs, portfolio, netWorth: assets + portfolio - liabs };
}
// Real month-over-month delta from stored snapshots. Needs ≥2 monthly snapshots;
// otherwise {has:false} → the UI shows "—". Never a surplus-relabel.
function personalNetWorthChange(){
  const s=(window._nwSnapshots||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(s.length<2) return {has:false,delta:0};
  return {has:true, delta:(parseFloat(s[s.length-1].value)||0)-(parseFloat(s[s.length-2].value)||0)};
}

// ── PERSONAL ACCOUNTS CRUD (assets & liabilities) ─────────────────────────────
async function loadPersonalAccounts(){
  try{
    const r=await fetch('/api/personal-accounts',{credentials:'include'});
    window._persAccounts = r.ok ? ((await r.json())||[]).map(_mapPersAccount) : (window._persAccounts||[]);
  }catch(_){ window._persAccounts=window._persAccounts||[]; }
  renderPersAccounts();
}
window.loadPersonalAccounts=loadPersonalAccounts;

// M13 (money audit 2026-10-09): a personal asset / liability carries the CURRENCY it was entered in. Its value is
// normalised to USD per row (the personal side's basis, like transactions — _safeFX) and SP() shows it in the
// personal display currency. It had no currency and SP() multiplied the raw number by the display rate as if it
// were USD: a TT$ owner's 1,000,000 house showed as TT$6.8M (while the edit box said 1,000,000). Rows saved before
// currencies existed read as USD — exactly how they have always been shown.
// ONE row mapper for both loaders (loadPersonalFinance and loadPersonalAccounts) — two copies meant one dropped
// the currency and the page-load net worth read every row as USD.
function _mapPersAccount(a){ return {_dbId:a.id,kind:a.kind||'asset',name:a.name||'',type:a.type||'other',value:parseFloat(a.value)||0,currency:a.currency||'USD'}; }
function _acctUsd(a){ return _safeFX(parseFloat(a && a.value)||0, (a && a.currency)||'USD', 'USD'); }
function renderPersAccounts(){
  const el=document.getElementById('pers-accounts-list');
  if(!el) return;
  const accts=window._persAccounts||[];
  if(!accts.length){ el.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No accounts yet — add an asset or liability to track your real net worth</div>'; return; }
  const assets=accts.filter(a=>a.kind==='asset');
  const liabs =accts.filter(a=>a.kind==='liability');
  const row=(a)=>`<div class="bar-row" style="gap:8px">
      <span class="bar-label" style="flex:1">${esc(a.name)} <span style="font-size:10px;color:var(--t3)">· ${esc(a.type)}</span></span>
      <span class="bar-val" style="color:${a.kind==='asset'?'var(--green)':'var(--red)'}">${a.kind==='asset'?'':'-'}${SP(_acctUsd(a))}</span>
      <button class="btn btn-ghost btn-sm" style="padding:2px 6px" onclick="openAccountModal('${a.kind}',${a._dbId})" title="Edit">✏</button>
      <button class="btn btn-ghost btn-sm" style="padding:2px 6px;color:var(--red);opacity:.7" onclick="deletePersAccount(${a._dbId})" title="Delete">✕</button>
    </div>`;
  let html='';
  html+='<div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin:2px 0 4px">Assets</div>';
  html+= assets.length ? assets.map(row).join('') : '<div style="font-size:11.5px;color:var(--t3);padding:2px 0">None yet</div>';
  html+='<div style="height:1px;background:var(--bd);margin:8px 0"></div><div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin:2px 0 4px">Liabilities</div>';
  html+= liabs.length ? liabs.map(row).join('') : '<div style="font-size:11.5px;color:var(--t3);padding:2px 0">None yet</div>';
  el.innerHTML=html;
}
window.renderPersAccounts=renderPersAccounts;

window.openAccountModal=function(kind,id){
  const isEdit=id!=null;
  document.getElementById('acct-edit-id').value=isEdit?id:'';
  document.getElementById('acct-modal-title').textContent=(isEdit?'Edit ':'Add ')+(kind==='liability'?'liability':'asset');
  document.getElementById('acct-kind').value=kind;
  // Populate type options for the chosen kind.
  const typeSel=document.getElementById('acct-type');
  const opts = kind==='liability' ? ['loan','credit_card','mortgage','other'] : ['cash','savings','investment','property','other'];
  typeSel.innerHTML=opts.map(o=>`<option value="${o}">${o.replace('_',' ')}</option>`).join('');
  const a=isEdit?(window._persAccounts||[]).find(x=>x._dbId===id):null;
  document.getElementById('acct-name').value=a?a.name:'';
  document.getElementById('acct-value').value=a?a.value:'';
  if(a) typeSel.value=a.type;
  const curSel=document.getElementById('acct-currency');
  if(curSel){ if(!curSel.options || !curSel.options.length) curSel.innerHTML=_persCurrencyOptionsHtml(); curSel.value=a ? (a.currency||'USD') : persCurrency; }   // M13
  openModal('account-modal');
};
window.saveAccount=async function(){
  const id=document.getElementById('acct-edit-id').value;
  const kind=document.getElementById('acct-kind').value==='liability'?'liability':'asset';
  const name=(document.getElementById('acct-name').value||'').trim();
  const type=document.getElementById('acct-type').value||'other';
  const value=parseFloat(document.getElementById('acct-value').value)||0;
  const currency=(document.getElementById('acct-currency')||{}).value||persCurrency||'USD';   // M13
  const value_usd=Math.round(_safeFX(value, currency, 'USD')*100)/100;
  if(!name){ notify('Name is required',true); return; }
  try{
    if(id){
      const r=await fetch('/api/personal-accounts/'+id,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,type,kind,value,currency,value_usd})});
      if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||'Failed');
    }else{
      const r=await fetch('/api/personal-accounts',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,type,kind,value,currency,value_usd})});
      if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||'Failed');
    }
    closeModal('account-modal');
    await loadPersonalAccounts();
    // Net worth changed → capture a fresh snapshot immediately (forced) + re-render.
    _ffCaptureSnap('networth', true);
    if(typeof renderPersonal==='function') renderPersonal();
    if(typeof renderPersonalSections==='function') renderPersonalSections();
    notify(kind==='liability'?'Liability saved ✦':'Asset saved ✦');
  }catch(e){ notify('Could not save — '+(e.message||'error'),true); }
};
window.deletePersAccount=async function(id){
  if(!(await window._confirmModal('Delete this account?', {danger:true}))) return;
  try{
    const r=await fetch('/api/personal-accounts/'+id,{method:'DELETE',credentials:'include'});
    if(!r.ok) throw new Error('Failed');
    await loadPersonalAccounts();
    _ffCaptureSnap('networth', true);
    if(typeof renderPersonal==='function') renderPersonal();
    if(typeof renderPersonalSections==='function') renderPersonalSections();
    notify('Account deleted');
  }catch(e){ notify('Could not delete',true); }
};

function renderPersonalSections(){
  // Income breakdown from the SAME period figures the KPI uses (USD-normalized).
  // Recurring income (salary + any other recurring source, projected ×months) and
  // one-time income in-window. No phantom doubled "side income": the salary lives in
  // the recurring bucket, not duplicated as a separate base term.
  const recurInc=window._persPeriodRecurIncome||0;
  const oneTimeInc=window._persPeriodOneTimeIncome||0;
  const totalInc=recurInc+oneTimeInc;
  const totalExp=spending.reduce((a,s)=>a+s.amount,0);

  // Income sources
  const inEl=document.getElementById('income-sources-list');
  if(inEl){
    if(totalInc===0){
      inEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No income recorded — add payroll or income transactions</div>';
    }else{
      const rows=[];
      if(recurInc>0) rows.push({label:'Recurring income',amount:recurInc,color:'var(--acc)'});
      if(oneTimeInc>0) rows.push({label:'One-time income',amount:oneTimeInc,color:'var(--green)'});
      inEl.innerHTML=rows.map(r=>`<div class="bar-row"><span class="bar-label">${r.label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.amount/totalInc*100)}%;background:${r.color}"></div></div><span class="bar-val">${SP(r.amount)}</span></div>`).join('')
        +'<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--t2)">Total income</span><span style="color:var(--t1);font-weight:600;font-family:var(--font-mono)">'+SP(totalInc)+'</span></div>';
    }
  }

  // Budget vs Actual
  const budgetTarget=parseInt(document.getElementById('s-budget')?.value)||0;
  const usedPct=budgetTarget>0?Math.min(100,Math.round(totalExp/budgetTarget*100)):0;
  const variance=budgetTarget-totalExp;
  const bvEl=document.getElementById('budget-vs-actual-list');
  if(bvEl){
    if(totalExp===0&&budgetTarget===0){
      bvEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">Set a budget in Settings and add transactions to track</div>';
    }else{
      bvEl.innerHTML=`
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:8px"><span style="color:var(--t2)">Monthly budget</span><span style="font-family:var(--font-mono);font-weight:600;color:var(--t1)">${SP(budgetTarget)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:10px"><span style="color:var(--t2)">Actual spending</span><span style="font-family:var(--font-mono);font-weight:600;color:var(--t1)">${SP(totalExp)}</span></div>
        <div class="bar-track" style="margin-bottom:6px"><div class="bar-fill" style="width:${usedPct}%;background:${usedPct>90?'var(--red)':usedPct>70?'var(--amber)':'var(--green)'}"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--t3);margin-bottom:10px"><span>${usedPct}% used</span>${budgetTarget>0?`<span>${SP(budgetTarget)} limit</span>`:''}</div>
        <div style="height:1px;background:var(--bd);margin-bottom:10px"></div>
        <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--t1);font-weight:500">Variance</span><span style="font-family:var(--font-mono);font-weight:700;color:${variance>=0?'var(--green)':'var(--red)'}">${variance>=0?'+':''}${SP(variance)}</span></div>`;
    }
  }

  // Net worth breakdown — REAL assets & liabilities from personal_accounts +
  // live investment portfolio (no inferred cash-flow model).
  const _nwb=computePersNetWorth();
  const _accts=window._persAccounts||[];
  const _assetRows=_accts.filter(a=>a.kind==='asset');
  const _liabRows =_accts.filter(a=>a.kind==='liability');
  const netWorth=_nwb.netWorth;
  const nwEl=document.getElementById('nw-breakdown-list');
  const nwSub=document.getElementById('nw-sub');
  if(nwSub) nwSub.textContent=SP(Math.abs(Math.round(netWorth)))+(netWorth<0?' deficit':' total');
  if(nwEl){
    if(_assetRows.length===0&&_liabRows.length===0&&_nwb.portfolio===0){
      nwEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No accounts yet — add assets & liabilities below to track net worth</div>';
    }else{
      const _line=(label,val,color)=>`<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:var(--t2)">${esc(label)}</span><span style="color:${color};font-family:var(--font-mono)">${val<0?'-':''}${SP(Math.abs(val))}</span></div>`;
      let _h='<div style="display:flex;flex-direction:column;gap:4px"><div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Assets</div>';
      _assetRows.forEach(a=>{ _h+=_line(a.name,_acctUsd(a),'var(--green)'); });   // M13: per-row USD
      if(_nwb.portfolio>0) _h+=_line('Investment portfolio',_nwb.portfolio,'var(--green)');
      if(_assetRows.length===0&&_nwb.portfolio===0) _h+='<div style="font-size:12px;color:var(--t3);padding:3px 0">$0</div>';
      _h+='<div style="height:1px;background:var(--bd);margin:6px 0"></div><div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Liabilities</div>';
      if(_liabRows.length){ _liabRows.forEach(l=>{ _h+=_line(l.name,-_acctUsd(l),'var(--red)'); }); }
      else _h+='<div style="font-size:12px;color:var(--t3);padding:3px 0">$0</div>';
      _h+='<div style="height:1px;background:var(--bd);margin:6px 0"></div><div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:var(--t1);font-weight:600">Net worth</span><span style="font-family:var(--font-mono);font-weight:700;color:'+(netWorth>=0?'var(--acc)':'var(--red)')+'">'+(netWorth<0?'-':'')+SP(Math.abs(Math.round(netWorth)))+'</span></div></div>';
      nwEl.innerHTML=_h;
    }
  }

  // Expense categories breakdown (raw categories, not grouped buckets)
  const CAT_COLORS_RAW={'Rent/Mortgage':'var(--acc)','Groceries':'var(--green)','Dining out':'var(--teal)','Transport':'var(--teal)','Subscriptions':'var(--acc2)','Healthcare':'var(--red)','Entertainment':'var(--purple)','Shopping':'var(--amber)','Other':'var(--t3)'};
  const catEl=document.getElementById('expense-cat-list');
  if(catEl){
    const rawCats={};
    persTransactions.filter(t=>t.type==='expense').forEach(t=>{rawCats[t.cat]=(rawCats[t.cat]||0)+_safeFX(t.amount,_txCurOf(t),'USD');});
    const catEntries=Object.entries(rawCats).sort((a,b)=>b[1]-a[1]);
    if(catEntries.length===0){
      catEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No expenses recorded yet</div>';
    }else{
      const catMax=Math.max(...catEntries.map(e=>e[1]),1);
      catEl.innerHTML=catEntries.map(([label,amount])=>`
        <div class="bar-row">
          <span class="bar-label">${label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round(amount/catMax*100)}%;background:${CAT_COLORS_RAW[label]||'var(--t3)'}"></div></div>
          <span class="bar-val">${SP(amount)}</span>
        </div>`).join('')
        +'<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--t2)">Total</span><span style="color:var(--t1);font-weight:600;font-family:var(--font-mono)">'+SP(totalExp)+'</span></div>';
    }
    if(typeof renderPersSpendDonut==='function') renderPersSpendDonut(catEntries);
  }

  // Tax estimate — monthly income basis (USD-normalized), consistent with the KPI:
  // monthly recurring income (period recurring ÷ months) + one-time income dated in
  // the CURRENT calendar month. Recurring is annualized ×12; one-time is not scaled
  // beyond the month it fell in (it isn't recurring).
  const taxEl=document.getElementById('tax-estimate-list');
  if(taxEl){
    const _monthlyRecur=(window._persPeriodRecurIncome||0)/(window._persPeriodMonths||1);
    const _mNow=new Date(); const _mKey=_mNow.getFullYear()+'-'+String(_mNow.getMonth()+1).padStart(2,'0');
    const _oneTimeThisMonth=(window._allPersTxs||[]).filter(t=>t.type==='income'&&t.recurringProfileId==null&&String(t.date||'').slice(0,7)===_mKey).reduce((a,t)=>a+_safeFX(t.amount,_txCurOf(t),'USD'),0);
    const monthlyInc=_monthlyRecur+_oneTimeThisMonth;
    // FinFlow performs NO tax calculation (F8) — the flat-rate tax estimate was removed.
    taxEl.innerHTML='<div style="font-size:12px;color:var(--t3);line-height:1.6;padding:.5rem 0">'+DED_DISCLAIMER_OUTPUT+'</div>';
  }
}

// ════════════════════════════════════════════
// INVESTMENTS
// ════════════════════════════════════════════
let holdings=[];
let invPeriod='1m';
let invPerfChart=null;
let invDonutChart=null;

function S2(n){return _fmtMoney(n, '$');}   // personal-investments '$' figures — shared rollover

function calcPortfolio(){
  let totalValue=0,totalCost=0,totalDiv=0,_dayChgSum=0,_haveDay=false;
  holdings.forEach(h=>{
    totalValue+=h.price*h.shares;
    totalCost+=h.cost*h.shares;
    totalDiv+=(h.div||0)*h.shares;
    // F-E1: day change = Σ (per-holding live day-change price × shares) — the actual intraday price
    // movement, identical to the business-investments engine (index.html applyBizQuotes).
    if(typeof h.dayChgPx==='number'){ _dayChgSum += h.dayChgPx*h.shares; _haveDay=true; }
  });
  // F-E1: the old "current value − prior-day SNAPSHOT" compared two DIFFERENT portfolio
  // compositions (holdings added/removed since the snapshot) and reported a nonsensical figure
  // (e.g. −151% of the portfolio) whenever the snapshot predated a holdings change.
  const dayChg = _haveDay ? _dayChgSum : null;
  return{totalValue,totalCost,totalGain:totalValue-totalCost,totalDiv,dayChg};
}

function renderInvestments(){
  const{totalValue,totalCost,totalGain,totalDiv,dayChg}=calcPortfolio();
  const gainPct=totalCost>0?((totalGain/totalCost)*100).toFixed(1):0;
  // Don't paint STORED (entry-time) prices as a live portfolio value on a cold load: holdings load from
  // the DB with a stored price, then live quotes overwrite it ~1s later. On a fresh boot (`_invBootPending`,
  // set by the investments init() and cleared when the first refresh pass finishes) show a neutral loading
  // state until a live quote lands (`_invLive`). `needsQuote` keeps an all-cash / empty book instant; and
  // because the flag is only set by the real boot, direct render calls (tests, mid-session nav) show values.
  const needsQuote = holdings.some(h => String(h.ticker||'').toUpperCase() !== 'CASH');
  const invLoading = needsQuote && window._invBootPending && !window._invLive;
  const hasDay = !invLoading && dayChg != null;
  const dayPct = (hasDay && totalValue>0) ? (dayChg/totalValue*100).toFixed(2) : null;
  const gainPos=totalGain>=0;

  // Metrics
  const tChg=document.getElementById('inv-total-chg');
  const gLbl=document.getElementById('inv-gain-lbl');
  if(invLoading){
    document.getElementById('inv-total-val').textContent='—';
    tChg.textContent='Fetching live prices…'; tChg.className='mc-change neutral';
    document.getElementById('inv-gain').textContent='—';
    gLbl.textContent='Fetching live prices…'; gLbl.className='mc-change neutral';
  } else {
    document.getElementById('inv-total-val').textContent=S2(totalValue);
    tChg.textContent=(gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% all time'; tChg.className='mc-change '+(gainPos?'up':'dn');
    document.getElementById('inv-gain').textContent=(gainPos?'+':'')+S2(totalGain);
    gLbl.textContent=(gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% return'; gLbl.className='mc-change '+(gainPos?'up':'dn');
  }
  // Day change — real (prior-day snapshot) or honest "—" until one exists (or while loading).
  document.getElementById('inv-day-chg').textContent = hasDay ? ((dayChg>=0?'+':'')+S2(dayChg)) : '—';
  const dLbl=document.getElementById('inv-day-lbl');
  if(hasDay){ dLbl.textContent=(dayChg>=0?'▲ ':'▼ ')+Math.abs(dayPct)+'% today'; dLbl.className='mc-change '+(dayChg>=0?'up':'dn'); }
  else { dLbl.textContent = invLoading ? 'Fetching live prices…' : 'Builds after 1 day'; dLbl.className='mc-change neutral'; }
  document.getElementById('inv-yield').textContent=S2(totalDiv);

  // Holdings list
  document.getElementById('inv-asset-count').textContent=holdings.length;
  document.getElementById('inv-holdings-list').innerHTML=holdings.map((h,i)=>{
    const val=h.price*h.shares;
    const cost=h.cost*h.shares;
    const gl=val-cost;
    const glPct=cost>0?((gl/cost)*100).toFixed(1):0;
    const pos=gl>=0;
    const colors=['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a4e3a'];
    const bg=h.color||colors[i%colors.length];
    return`<div class="inv-holding-row">
      <div class="inv-ticker-badge" style="background:${bg}22;color:${bg};border-color:${bg}44;font-size:9px">${esc(h.ticker.slice(0,4))}</div>
      <div>
        <div style="font-weight:500;font-size:12.5px">${esc(h.name)} <span class="badge b-blue" style="font-size:9px;padding:1px 5px">${esc(h.type)}</span>${h._noQuote?' <span title="No live price — check the ticker symbol (e.g. enter MSFT, not Microsoft; BTC, not Bitcoin)" style="color:var(--amber,#e0a500);font-size:10px;font-weight:600">⚠ check ticker</span>':((h._resolved&&h._resolved!==String(h.ticker||'').toUpperCase())?` <span title="Quoted as ${esc(h._resolved)}" style="color:var(--t3);font-size:10px">→ ${esc(h._resolved)}</span>`:'')}</div>
        <div style="font-size:11px;color:var(--t3)">${(val/totalValue*100).toFixed(1)}% of portfolio</div>
        <div class="inv-alloc-bar"><div class="inv-alloc-fill" style="width:${(val/totalValue*100).toFixed(1)}%;background:${bg}"></div></div>
      </div>
      <div style="text-align:right;font-family:var(--font-mono);color:${h._noQuote?'var(--t3)':'inherit'}" title="${h._noQuote?'Cost basis — no live price':'Live price'}">$${h.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <div style="text-align:right;color:var(--t2)">${h.shares}</div>
      <div style="text-align:right;font-family:var(--font-mono);font-weight:500">${S2(val)}</div>
      <div style="text-align:right;font-family:var(--font-mono);color:var(--t3)">${S2(cost)}</div>
      <div style="text-align:right">
        <span class="inv-perf-chip ${pos?'inv-perf-up':'inv-perf-dn'}">${pos?'▲':'▼'} ${Math.abs(glPct)}%</span>
        ${h.id!=null?`<div class="inv-row-actions" style="margin-top:3px;display:flex;gap:4px;justify-content:flex-end">
          <button class="btn btn-ghost" style="padding:1px 7px;font-size:10px" title="Edit holding" onclick="event.stopPropagation();editHolding(${h.id})">Edit</button>
          <button class="btn btn-ghost" style="padding:1px 6px;font-size:10px;color:var(--red)" title="Remove holding" onclick="event.stopPropagation();deleteHolding(${h.id})">✕</button>
        </div>`:''}
      </div>
    </div>`;
  }).join('');

  // Donut chart
  buildInvDonut(holdings,totalValue);
  // Real forward-only performance series: capture today's value + load snapshots,
  // then render. Fire-and-forget — never blocks this render.
  loadPortfolioSnapshots();
  updateInvAI(totalValue,totalGain,gainPct,totalDiv);
  updateNetWorthPanel(totalValue);

  // F155: the business Performance box (#biz-perf-port / #biz-perf-summary) lives on
  // page-biz-investments and is now owned by renderBizInvestments (business data). This PERSONAL
  // render used to write it from the personal `holdings` array — a cross-wire that displayed the
  // personal cost basis on the business page, identical across every entity and matching none.
  // Removed so the personal render only touches personal-page elements.
}

// Personal spend-by-category donut (real transaction category totals).
let persSpendDonutChart=null;
function renderPersSpendDonut(entries){
  const canvas=document.getElementById('persSpendDonut');
  if(!canvas||typeof Chart==='undefined'||canvas.offsetParent===null) return;
  const ctx=canvas.getContext('2d'); if(!ctx) return;
  if(persSpendDonutChart){ persSpendDonutChart.destroy(); persSpendDonutChart=null; }
  if(!entries||!entries.length){ ctx.clearRect(0,0,canvas.width,canvas.height); return; }
  const palette=['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a9ec9','#b0894a'];
  const labels=entries.map(e=>e[0]);
  const vals=entries.map(e=>e[1]);
  const colors=entries.map((e,i)=>palette[i%palette.length]);
  const total=vals.reduce((a,b)=>a+b,0)||1;
  persSpendDonutChart=new Chart(canvas,{type:'doughnut',
    data:{labels,datasets:[{data:vals,backgroundColor:colors.map(c=>c+'cc'),borderColor:colors,borderWidth:1.5}]},
    options:{responsive:false,cutout:'66%',plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(22,18,13,0.95)',titleColor:'#f2e8d5',bodyColor:'#9e8e73',padding:8,cornerRadius:6,callbacks:{label:c=>`${c.label}: ${(c.raw/total*100).toFixed(0)}%`}}}}
  });
}
window.renderPersSpendDonut=renderPersSpendDonut;

function buildInvDonut(hs,totalValue){
  const canvas=document.getElementById('invDonut');
  if(!canvas||typeof Chart==='undefined'||canvas.offsetWidth===0||canvas.offsetParent===null)return;
  const ctx=canvas.getContext('2d');
  const vals=hs.map(h=>h.price*h.shares);
  const colors=hs.map(h=>h.color||'#c9a84c');
  if(invDonutChart){invDonutChart.destroy();}
  invDonutChart=new Chart(ctx,{
    type:'doughnut',
    data:{datasets:[{data:vals,backgroundColor:colors.map(c=>c+'cc'),borderColor:colors,borderWidth:1.5,hoverBorderWidth:2}],
          labels:hs.map(h=>h.ticker)},
    options:{responsive:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{
      backgroundColor:'rgba(22,18,13,0.95)',titleColor:'#f2e8d5',bodyColor:'#9e8e73',padding:8,cornerRadius:6,
      callbacks:{label:ctx=>`${ctx.label}: ${(ctx.raw/totalValue*100).toFixed(1)}%`}
    }}}
  });
  // Legend
  const leg=document.getElementById('inv-legend');
  if(leg)leg.innerHTML=hs.map(h=>`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <span style="width:8px;height:8px;border-radius:2px;background:${h.color};flex-shrink:0"></span>
      <span style="font-size:11px;color:var(--t2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.ticker)}</span>
      <span style="font-size:11px;font-weight:600;color:var(--t1);font-family:var(--font-mono)">${(h.price*h.shares/totalValue*100).toFixed(1)}%</span>
    </div>`).join('');
}

// F-poll: throttle snapshot captures. A snapshot is a daily (portfolio) / monthly (networth) UPSERT,
// so re-POSTing it every 60s render is pure chatter. Render paths capture at most once / 5 min per kind;
// real data changes (add/edit/delete an account) pass force=true to record the new value immediately.
window._ffSnapLast = window._ffSnapLast || {};
function _ffCaptureSnap(kind, force){
  try{
    const now = Date.now();
    if(!force && (now - (window._ffSnapLast[kind] || 0) < 5*60*1000)) return;
    window._ffSnapLast[kind] = now;
    fetch('/api/snapshots/capture',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind})}).catch(()=>{});
  }catch(_){}
}

// Fire-and-forget: capture today's portfolio value, load the REAL stored series,
// then render. Never throws into the render path.
async function loadPortfolioSnapshots(){
  try{
    _ffCaptureSnap('portfolio');
    const r=await fetch('/api/snapshots?kind=portfolio',{credentials:'include'});
    window._portSnapshots = r.ok ? ((await r.json())||[]).map(s=>({value:parseFloat(s.value)||0,date:s.date||''})) : (window._portSnapshots||[]);
  }catch(_){ window._portSnapshots=window._portSnapshots||[]; }
  try{ buildInvPerfChart(invPeriod); }catch(_){}
}
window.loadPortfolioSnapshots=loadPortfolioSnapshots;

function buildInvPerfChart(period){
  const canvas=document.getElementById('invPerfChart');
  if(!canvas||typeof Chart==='undefined'||canvas.offsetWidth===0||canvas.offsetParent===null)return;
  const retEl=document.getElementById('inv-perf-return');
  const _clear=(msg)=>{ if(retEl) retEl.textContent=msg; if(invPerfChart){ invPerfChart.destroy(); invPerfChart=null; } const ctx=canvas.getContext('2d'); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); };
  if(!holdings || holdings.length===0){ _clear('No data — add holdings to see performance'); return; }
  // REAL snapshots only — never fabricated. Honest "building" state until ≥2 points.
  let snaps=(window._portSnapshots||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const now=new Date(); let cutoff=null;
  if(period==='1m'){cutoff=new Date(now);cutoff.setMonth(now.getMonth()-1);}
  else if(period==='3m'){cutoff=new Date(now);cutoff.setMonth(now.getMonth()-3);}
  else if(period==='ytd'){cutoff=new Date(now.getFullYear(),0,1);}
  else if(period==='1y'){cutoff=new Date(now);cutoff.setFullYear(now.getFullYear()-1);}
  let series = cutoff ? snaps.filter(s=>new Date(s.date)>=cutoff) : snaps;
  if(series.length<2) series = snaps;   // window too sparse → show whatever real history exists
  if(series.length<2){ _clear('Performance history builds over time — check back as data accumulates'); return; }
  const pts=series.map(s=>s.value);
  const labels=series.map((s,i)=>i===0?'Start':i===series.length-1?'Now':'');
  const first=pts[0]||1;
  const retPct=(((pts[pts.length-1]-first)/first)*100).toFixed(1);
  if(retEl) retEl.textContent=`Portfolio ${retPct>=0?'+':''}${retPct}% since ${series[0].date}`;
  const{tc,gc}=chartDefaults();
  if(invPerfChart){invPerfChart.destroy();}
  const portCtx=canvas.getContext('2d');
  if(!portCtx)return;
  const portGrad=portCtx.createLinearGradient(0,0,0,130);
  portGrad.addColorStop(0,'rgba(201,168,76,0.2)');portGrad.addColorStop(1,'rgba(201,168,76,0)');
  invPerfChart=new Chart(canvas,{
    type:'line',
    data:{labels,datasets:[
      {label:'Portfolio value',data:pts,borderColor:'#c9a84c',borderWidth:2,fill:true,backgroundColor:portGrad,tension:0.35,pointRadius:0,pointHoverRadius:4}
    ]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(22,18,13,0.95)',titleColor:'#f2e8d5',bodyColor:'#9e8e73',padding:8,cornerRadius:6,callbacks:{label:c=>S2(c.raw)}}},
      scales:{x:{display:false},y:{grid:{color:gc},ticks:{color:tc,font:{size:10},callback:v=>S2(v)},border:{display:false}}}
    }
  });
}

function setInvPeriod(p,btn){
  invPeriod=p;
  ['1m','3m','ytd','1y'].forEach(k=>{
    const el=document.getElementById('inv-per-'+k);
    if(el){el.style.background='';el.style.borderColor='';el.style.color='';}
  });
  if(btn){btn.style.background='var(--acc-bg)';btn.style.borderColor='var(--acc)';btn.style.color='var(--acc)';}
  buildInvPerfChart(p);
}

function updateInvAI(totalValue,totalGain,gainPct,totalDiv){
  const top=holdings.slice().sort((a,b)=>b.price*b.shares-a.price*a.shares).slice(0,2);
  const topPct=top.reduce((s,h)=>s+h.price*h.shares,0)/totalValue*100;
  const yieldPct=(totalDiv/totalValue*100).toFixed(1);
  const i1=document.getElementById('inv-ai-1');
  const i2=document.getElementById('inv-ai-2');
  const i3=document.getElementById('inv-ai-3');
  if (holdings.length === 0) {
    if(i1)i1.textContent='No holdings yet. Add positions to see performance insights.';
    if(i2)i2.textContent='';
    if(i3)i3.textContent='';
    return;
  }
  const gPos = parseFloat(gainPct) >= 0;
  if(i1)i1.textContent=`Your portfolio is ${gPos?'up':'down'} ${Math.abs(gainPct)}% on a ${S2(totalValue-totalGain)} cost basis. Unrealised ${gPos?'gain':'loss'}: ${gPos?'+':''}$${Math.round(totalGain).toLocaleString()}.`;
  if(i2)i2.textContent=`${top.map(h=>h.ticker).join(' & ')} together represent ${topPct.toFixed(0)}% of portfolio value — consider diversifying if concentration risk concerns you.`;
  if(i3 && totalDiv>0)i3.textContent=`Dividend income of $${Math.round(totalDiv).toLocaleString()}/yr adds a ${yieldPct}% yield.`;
  else if(i3)i3.textContent='No dividend-paying positions in this portfolio.';
}

function updateNetWorthPanel(portValue){
  // REAL breakdown from personal_accounts (no hardcoded cash/other). Cash =
  // cash+savings assets; Other = every other asset; total = assets + live
  // portfolio − liabilities (same net-worth definition renderPersonal uses).
  const accts=window._persAccounts||[];
  // M13: each account's USD equivalent (_acctUsd) — this panel shows USD ('$', S2).
  const cash = accts.filter(a=>a.kind==='asset' && (a.type==='cash'||a.type==='savings')).reduce((s,a)=>s+_acctUsd(a),0);
  const other= accts.filter(a=>a.kind==='asset' && !(a.type==='cash'||a.type==='savings')).reduce((s,a)=>s+_acctUsd(a),0);
  const liab = accts.filter(a=>a.kind==='liability').reduce((s,a)=>s+_acctUsd(a),0);
  const total=cash+portValue+other-liab;
  const max=Math.max(cash,portValue,other,1);
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('nw-port-val',S2(portValue));
  set('nw-cash-val',S2(cash));
  set('nw-other-val',S2(other));
  const pb=document.getElementById('nw-port-bar');if(pb)pb.style.width=(portValue/max*100).toFixed(0)+'%';
  const cb=document.getElementById('nw-cash-bar');if(cb)cb.style.width=(cash/max*100).toFixed(0)+'%';
  const ob=document.getElementById('nw-other-bar');if(ob)ob.style.width=(other/max*100).toFixed(0)+'%';
  set('nw-total-display',S2(total));
  const pp=document.getElementById('nw-port-pct');if(pp)pp.textContent=total>0?(portValue/total*100).toFixed(0)+'%':'0%';
  // NOTE: pers-nw is owned by renderPersonal (real accounts+portfolio−liab) — not clobbered here.
}

function openAddHoldingModal(scope){
  // Context: 'personal' (default) writes entity_id NULL rows; 'business' writes rows scoped
  // to the active entity. The Add buttons on each page pass their own scope.
  window._holdingScope = (scope==='business') ? 'business' : 'personal';
  ['h-ticker','h-name','h-shares','h-cost','h-price','h-div'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  // Clear any edit state so this is a fresh ADD — otherwise the patched saveHolding
  // (which routes on #holding-edit-id) would PUT-update the last-edited holding.
  const _eid=document.getElementById('holding-edit-id'); if(_eid) _eid.value='';
  if(typeof window._ffHoldingHideSuggest==='function') window._ffHoldingHideSuggest();   // clear any stale symbol-picker results
  const _modal=document.getElementById('holding-modal');
  if(_modal){ const _t=_modal.querySelector('.modal-title'); if(_t) _t.textContent='Add holding';
    const _b=_modal.querySelector('button[onclick*="saveHolding"]'); if(_b) _b.textContent='Add holding'; }
  openModal('holding-modal');
}
function saveHolding(){
  const ticker=(document.getElementById('h-ticker').value||'').trim().toUpperCase();
  const name=(document.getElementById('h-name').value||'').trim()||ticker;
  const shares=parseFloat(document.getElementById('h-shares').value)||0;
  const cost=parseFloat(document.getElementById('h-cost').value)||0;
  const price=parseFloat(document.getElementById('h-price').value)||cost;
  const div=parseFloat(document.getElementById('h-div').value)||0;
  const type=document.getElementById('h-type').value||'Stock';
  if(!ticker||!shares){notify('Ticker and shares are required',true);return;}
  const colors=['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a4e3a'];
  holdings.push({ticker,name,type,shares,cost,price,div,color:colors[holdings.length%colors.length]});
  closeModal('holding-modal');
  renderInvestments();
  notify(`${ticker} added to portfolio ✦`);
}

// G11: one rebalance view for both sides — Personal passes nothing (its own holdings), the business investments page
// passes window.bizHoldings with scope 'business'. Never a mix (the personal/business wall).
function openRebalanceModal(list, scope){
  const _biz = scope==='business';
  const _L = _biz ? (Array.isArray(list)?list:[]) : holdings;
  const _val = h => (parseFloat(h.shares)||0) * (parseFloat(h.price)||parseFloat(h._lastPrice)||parseFloat(h.costPer)||parseFloat(h.cost)||0);
  const totalValue = _biz ? _L.reduce((s,h)=>s+_val(h),0) : calcPortfolio().totalValue;
  const targets={Stock:60,ETF:20,Bond:10,Cash:5,Crypto:3,Other:2};
  const actual={};
  _L.forEach(h=>{const t=h.type||'Other'; actual[t]=(actual[t]||0)+_val(h);});
  { const m=document.getElementById('rebalance-modal'); const h=m&&m.querySelector('.modal-title'); if(h) h.textContent=_biz?'Rebalance business investments':'Rebalance portfolio'; }
  const html=Object.entries(targets).map(([type,tgt])=>{
    const act=actual[type]||0;
    const actPct=totalValue>0?(act/totalValue*100).toFixed(1):0;
    const diff=(parseFloat(actPct)-tgt).toFixed(1);
    const over=parseFloat(diff)>0;
    return`<div class="inv-rebalance-row">
      <span style="flex:1;font-weight:500">${type}</span>
      <span style="color:var(--t2);width:60px;text-align:right">${actPct}%</span>
      <span style="color:var(--t3);width:60px;text-align:right">→ ${tgt}%</span>
      <span style="width:70px;text-align:right;color:${over?'var(--amber)':parseFloat(diff)<-2?'var(--red)':'var(--green)'}">
        ${parseFloat(diff)===0?'On target':over?'▲ +'+Math.abs(diff)+'%':'▼ '+Math.abs(diff)+'%'}
      </span>
    </div>`;
  }).join('');
  const rb=document.getElementById('rebalance-content');
  if(rb)rb.innerHTML=`<div style="display:flex;gap:8px;padding:0 0 6px;font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--bd);margin-bottom:2px">
    <span style="flex:1">Type</span><span style="width:60px;text-align:right">Current</span><span style="width:60px;text-align:right">Target</span><span style="width:70px;text-align:right">Variance</span>
  </div>${html}<div style="margin-top:12px;font-size:11.5px;color:var(--t2);padding-top:8px;border-top:1px solid var(--bd)">Target allocation is a suggested default. Ask the AI to customise it for your risk profile.</div>`;
  openModal('rebalance-modal');
}

// ════════════════════════════════════════════
// AI INSIGHTS
// ════════════════════════════════════════════
// M11 (money audit 2026-10-09): revenue growth over the fiscal year so far — the last COMPLETE fiscal month vs the
// first fiscal month. It compared REV[11] (the last fiscal month) with REV[0]; for eleven months of the year REV[11]
// is in the future and 0, so the AI said "−100% growth" and the Health Score's Growth read 0. null when there is no
// complete month after the first, or the first month has no revenue (nothing to grow from).
function _fyGrowth(){
  const _ctx=_fyContext(); const last=(_ctx && Number.isInteger(_ctx.curFyIdx)) ? _ctx.curFyIdx-1 : -1;
  if(last<1 || !(REV[0]>0)) return null;
  const ratio=(REV[last]-REV[0])/REV[0];
  return { from:0, to:last, ratio, pct:Math.round(ratio*100) };
}
// M20 (money audit 2026-10-09; Rule 12): every AI payroll figure comes from PAYROLL RUNS — the cost from the
// canonical expense breakdown's run leg (_bd.payroll: approved|paid runs in the period), the withholdings from the
// same runs' lines (gross + bonus + overtime − net pay). They used d.sal (expense rows CATEGORISED as salary — 0
// under basis C) and the ROSTER's deduction template (a figure for months no run exists).
function _periodPayrollWithheld(){
  const _w=_periodWindow(currentPeriod, currentPeriod==='year'?null:currentMonthIdx);
  return (window.payrollRuns||[]).filter(r=>['approved','paid'].includes(String(r.status||'').toLowerCase()) && _w.inWin(window.FinFlowDates.payrollPeriodYmd(r.period, r.run_date)))
    .reduce((s,r)=>s+(r.lines||[]).filter(Boolean).reduce((a,l)=>a+((parseFloat(l.gross)||0)+(parseFloat(l.bonus)||0)+(parseFloat(l.overtime)||0)-(parseFloat(l.net_pay)||0)),0),0);
}
// M28 (money audit 2026-10-09): period-true labels and rankings.
//  · the quarter insight names the CURRENT fiscal quarter (it hard-coded fiscal months 9–11, Oct–Dec) and compares
//    with the quarter before it (it hard-coded fiscal months 6–8);
//  · "top client this month / quarter" ranks THAT period's sales (it was the all-time ranking), and its share is of
//    the same period's sales, so it can never exceed 100% (all-time ÷ period revenue could).
function _curQuarterStart(){ const i=_periodIntentIdx('quarter'); return Math.floor((Number.isInteger(i)?i:0)/3)*3; }
function _periodTopClients(period=currentPeriod){
  const _w=_periodWindow(period, period==='year'?null:_periodIntentIdx(period));
  const tot={}, ISSUED=['pending','overdue','partial','paid'];
  (window._realInvoices||[]).forEach(i=>{ if(!ISSUED.includes(String(i.status||'').toLowerCase())) return; if(!_w.inWin(i.issue_date||i.created_at||i.date)) return; const k=i.client||'Unknown'; tot[k]=(tot[k]||0)+(parseFloat(i.amount)||0); });
  (window.receipts||[]).forEach(r=>{ if(!_w.inWin(r.date||r.created_at)) return; const k=r.customer||'Walk-in'; tot[k]=(tot[k]||0)+(parseFloat(r.amount)||0); });
  const list=Object.entries(tot).map(([label,total])=>({label,total})).filter(c=>c.total>0).sort((a,b)=>b.total-a.total);
  return { list, total: list.reduce((s,c)=>s+c.total,0) };
}
function updateAI(d=getPeriodData()){
  document.getElementById('ai-period-label').textContent=d.label;
  // Revenue, expenses, profit & margin ALL use the canonical helpers
  // (computeRevenue + computeExpenseBreakdown) — the SAME basis the dashboard
  // uses — so every screen agrees. d.rev/d.profit (operating-only) are not used
  // for headline figures; REV[]/PROFIT[] remain only for relative trend deltas.
  const _bd = (typeof computeExpenseBreakdown==='function') ? computeExpenseBreakdown() : null;
  const _exp = _bd ? _bd.total : (d.exp||0);
  const _rev = (typeof computeRevenue==='function') ? computeRevenue() : (d.rev||0);
  const _profit = _rev - (parseFloat(window._cogsTotal)||0) - _exp;  // canonical Net (incl COGS)
  const margin = _rev > 0 ? Math.round(_profit/_rev*100) : 0;
  const insights=currentPeriod==='year'?[
    (()=>{ const _gr=_fyGrowth(); return _gr!==null?`Year-to-date revenue: ${S(_rev)} — ${_gr.pct>=0?"+":""}${_gr.pct}% growth, ${MONTH_FULL[_gr.to]} vs ${MONTH_FULL[_gr.from]}.`:`Year-to-date revenue: ${S(_rev)} — not enough complete months yet to measure growth.`; })(),
    // FA-M12a: it ranks REVENUE, so it says revenue; and only months that have happened — the highest over the fiscal
    // months so far (this month included), the lowest over COMPLETED months (a month in progress or a future month at $0
    // is not "the lowest"). It used to scan all 12 slots: a future month at $0 came out "weakest".
    (()=>{ const _fc=_fyContext(); const _n=Math.max(1,Math.min(12,(_fc&&_fc.monthsInFY)||12)); const _done=Math.max(0,_n-1); let _xi=0; for(let i=0;i<_n;i++){ if(REV[i]>REV[_xi])_xi=i; } let _mi=-1; for(let i=0;i<_done;i++){ if(_mi<0||REV[i]<REV[_mi])_mi=i; } if(!REV.slice(0,_n).some(v=>v>0)) return `Add invoices to see your highest and lowest revenue months.`; return `Highest revenue month: ${MONTH_FULL[_xi]} at ${S(REV[_xi])}.`+(_mi>=0?` Lowest revenue month: ${MONTH_FULL[_mi]} at ${S(REV[_mi])}.`:''); })(),
    `Net profit margin: ${margin}%. Annual profit: ${S(_profit)}. Business is ${_profit<0?'running at a loss':margin>=20?'highly profitable':margin>=10?'profitable':'breaking even'}.`,
    _rev > 0 ? `Payroll-to-revenue: ${Math.round(((_bd&&_bd.payroll)||0)/_rev*100)}%.` : `Add paid invoices to calculate your payroll-to-revenue ratio.`,
    (()=>{ const _low=(inventory||[]).filter(i=>i.low); return _low.length?`${_low.length} item${_low.length>1?'s':''} low on stock: ${_low.slice(0,3).map(i=>i.name).join(', ')}${_low.length>3?'…':''}.`:`No low-stock items.`; })(),
  ]:currentPeriod==='quarter'?[
    (()=>{ const _q0=_curQuarterStart(); return `${MONTH_FULL[_q0]}–${MONTH_FULL[_q0+2]} revenue: ${S(_rev)}. Net profit: ${S(_profit)} (${margin}% margin).`; })(),
    (()=>{ const _q0=_curQuarterStart(); const _em=_bd?Math.max(_bd.months,1):3; const _cur=Math.round(_profit/_em); if(_q0<3) return `Monthly average profit this quarter: ${S(_cur)} — first quarter of the fiscal year, no prior quarter to compare.`; const _prev=Math.round(sum(PROFIT,_q0-3,_q0)/3); return `Monthly average profit this quarter: ${S(_cur)} — ${_cur>=_prev?'up from':'down from'} ${S(_prev)} in the prior quarter (operating).`; })(),
    (()=>{ const _tc=_periodTopClients(); return _tc.list.length ? `Top client this quarter: ${_tc.list[0].label} at ${S(_tc.list[0].total)} (${_tc.total>0?Math.round(_tc.list[0].total/_tc.total*100):0}% of this quarter's sales).` : `Add invoices to see client revenue breakdown.`; })(),
    `Payroll cost this quarter: ${S((_bd&&_bd.payroll)||0)}${_rev>0?` — ${Math.round(((_bd&&_bd.payroll)||0)/_rev*100)}% of revenue`:''}.`,
    `Cash trend: ${_profit >= 0 ? 'Net positive' : 'Net negative'} at ${S(_profit)} this quarter.`,
  ]:[
    `${MONTH_FULL[currentMonthIdx]} revenue: ${S(_rev)} — ${margin}% profit margin.`,
    (()=>{ const _cats=_bd?_expenseCategoryRows(_bd).filter(c=>c[1]>0):[]; const _top=_cats[0]; return `Expenses this month: ${S(_exp)}.${(_top&&_exp>0)?` Largest cost: ${_top[0]} at ${S(_top[1])} (${Math.round(_top[1]/_exp*100)}%).`:''}`; })(),
    `Net profit: ${S(_profit)} — ${currentMonthIdx>0?`${pct(d.profit,PROFIT[currentMonthIdx-1])>0?'up':'down'} ${Math.abs(pct(d.profit,PROFIT[currentMonthIdx-1]))}% vs last month (operating)`:'first month on record'}.`,
    (()=>{ const _tc=_periodTopClients(); return _tc.list.length ? `Top client this month: ${_tc.list[0].label} at ${S(_tc.list[0].total)} (${_tc.total>0?Math.round(_tc.list[0].total/_tc.total*100):0}% of this month's sales).` : `Add invoices to track client revenue.`; })(),
    (()=>{ const _wh=_periodPayrollWithheld(); return _wh>0?`Payroll deductions this month: ${S(Math.round(_wh))}, from this month's approved payroll runs.`:`No payroll run with deductions this month yet.`; })(),
    (()=>{ const _low=(inventory||[]).filter(i=>i.low); return _low.length?`Inventory alert: ${_low.length} item${_low.length>1?'s':''} low on stock — ${_low.slice(0,3).map(i=>i.name).join(', ')}${_low.length>3?'…':''}.`:`No low-stock items — inventory healthy.`; })(),
  ];
  document.getElementById('ai-insights-list').innerHTML=insights.map(t=>`<div class="ai-insight">${esc(t)}</div>`).join('');
  document.getElementById('ai-period-label').textContent=d.label;
}
function updateHealthScore(savingsRate=0,income=0,surplus=0){
  const d=getPeriodData();
  const _clamp=v=>Math.max(0,Math.min(100,Math.round(v)));
  const _inv=((typeof userInvoices!=='undefined'?userInvoices:window.userInvoices)||[]);
  // Each sub-score is computed ONLY from real data; when the data needed for a
  // metric doesn't exist, the score is null and the panel shows "—" — never a
  // fabricated baseline. Signed metrics (cash flow / profitability / growth) use
  // 50 as the break-even midpoint of REAL values, not a default for empty data.
  // Revenue/expenses/profit use the SAME canonical helpers as the dashboard & AI insights.
  const _bd = (typeof computeExpenseBreakdown==='function') ? computeExpenseBreakdown() : null;
  const _exp = _bd ? _bd.total : (d.exp||0);
  const _rev = (typeof computeRevenue==='function') ? computeRevenue() : (d.rev||0);
  const _profit = _rev - (parseFloat(window._cogsTotal)||0) - _exp;  // canonical Net (incl COGS)
  const throughput=_rev+_exp;
  const margin = _rev>0 ? _profit/_rev*100 : 0;
  // Cash flow — real net relative to total money moved this period.
  const cfScore = throughput>0 ? _clamp(50 + (_profit/throughput)*50) : null;
  // Profitability — real margin (50 = break-even).
  const prScore = _rev>0 ? _clamp(50 + margin) : null;
  // Receivables — real % of invoiced value actually collected. M30 (money audit 2026-10-09): over RECOGNISED
  // invoices only (issued, dated on or before today — drafts and scheduled invoices are not owed), and collected =
  // amount_paid, so a part-payment counts. It summed the face value of status-'paid' invoices over EVERY invoice
  // (a 9,999 draft included), ignoring part-payments (the F56 class).
  const _today=_entityToday(), _ISSUED=['pending','overdue','partial','paid'];
  const _recog=_inv.filter(i=>_ISSUED.includes(String(i.status||'').toLowerCase()) && (window.FinFlowDates._toYmd(i.issue_date||i.created_at||i.date)||'') <= _today);
  // FA-M6b: an applied credit note is not money collected — it lowers what was owed instead
  const _invoiced=_recog.reduce((s,i)=>s+(parseFloat(i.amount)||0)-(parseFloat(i.credit_applied)||0),0);
  const _paid=_recog.reduce((s,i)=>s+Math.min((parseFloat(i.amount)||0)-(parseFloat(i.credit_applied)||0), (parseFloat(i.amount_paid)||0)-(parseFloat(i.credit_applied)||0)),0);
  const recScore = _invoiced>0 ? _clamp(_paid/_invoiced*100) : null;
  // Growth — real period-over-period revenue (needs a prior period to compare). M11: the same elapsed-month
  // comparison as the AI insight (_fyGrowth), never the last fiscal month, which is in the future all year.
  const _grw = _fyGrowth();
  const grScore = _grw!==null ? _clamp(50 + _grw.ratio*50) : null;
  const _scores=[cfScore,prScore,recScore,grScore].filter(s=>s!=null);
  // Composite needs at least 2 real sub-scores — one metric alone (e.g. only
  // Receivables) must not be presented as a whole-business "EXCELLENT" score.
  const overall=_scores.length>=2?Math.round(_scores.reduce((a,b)=>a+b,0)/_scores.length):null;
  const el=document.getElementById('health-score');
  if(el)el.textContent=overall!=null?overall:'—';
  const lbl=document.getElementById('health-label');
  if(lbl)lbl.textContent=overall==null?'Not enough data yet':`out of 100 — ${overall>=90?'Excellent':overall>=80?'Good':overall>=70?'Fair':'Needs attention'}`;
  const _setHs=(barId,score,valId)=>{ const bar=document.getElementById(barId),val=document.getElementById(valId); if(score==null){ if(bar){bar.style.width='0%';bar.style.background='var(--bd2)';} if(val)val.textContent='—'; } else setBar(barId,score,valId); };
  _setHs('hs-cf',cfScore,'hs-cf-v');_setHs('hs-pr',prScore,'hs-pr-v');_setHs('hs-rec',recScore,'hs-rec-v');_setHs('hs-gr',grScore,'hs-gr-v');
}
function setBar(barId,score,valId){
  const bar=document.getElementById(barId);if(bar)bar.style.width=score+'%';
  const val=document.getElementById(valId);if(val)val.textContent=score+'/100';
  if(bar)bar.style.background=score>=80?'var(--green)':score>=60?'var(--amber)':'var(--red)';
}

// ════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════
// LA4 (live audit 2026-10-13 M1): invoices carry a free-text client; one that matches no saved customer was counted
// nowhere, so this page read "0 customers · $0 lifetime revenue" beside $23K of invoices. Those names now come from
// GET /api/customers/unsaved (same attribution and basis as the saved list) and are listed as "Not saved yet", with
// a Save that opens the add form pre-filled. Nothing is written until the person saves (Rule 8).
// Cache is keyed by business; a response for another business (switch mid-flight) is dropped (C1).
window._custUnsaved = window._custUnsaved || { eid: null, rows: [], error: false };
let _custUnsavedSeq = 0;
function _custActiveEid(){ const e=(typeof ENTITIES!=='undefined'?ENTITIES:(window.ENTITIES||[])).find(x=>x.active); return e?e._dbId:null; }
async function _loadUnsavedCustomers(){
  const eid=_custActiveEid(); if(!eid) return;
  const seq=++_custUnsavedSeq;
  let next;
  try{
    const r=await fetch('/api/customers/unsaved?entity_id='+eid,{credentials:'include'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const rows=await r.json();
    next={ eid, rows: Array.isArray(rows)?rows:[], error:false };
  }catch(e){ console.error('[Customers] could not load invoice clients:', e && e.message); next={ eid, rows:[], error:true }; }
  if(seq!==_custUnsavedSeq || _custActiveEid()!==eid) return;
  window._custUnsaved=next;
  renderCustomers((document.getElementById('cust-search')||{}).value||'', true);
}
window._loadUnsavedCustomers=_loadUnsavedCustomers;
function openCustomerModalFromUnsaved(i){
  const u=((window._custUnsaved||{}).rows||[])[i]; if(!u) return;
  openCustomerModal();
  const parts=String(u.name||'').trim().split(/\s+/);
  document.getElementById('cust-fname').value=parts[0]||'';
  document.getElementById('cust-lname').value=parts.slice(1).join(' ');
  document.getElementById('cust-company').value=u.name||'';   // the invoice name — matches by company whatever the person names the contact
  document.getElementById('cust-modal-sub').textContent='From your invoices to "'+(u.name||'')+'" — add an email to save';
}
window.openCustomerModalFromUnsaved=openCustomerModalFromUnsaved;
function renderCustomers(filter='', _fromUnsaved){
  if(!customers) customers=[];
  if(!_fromUnsaved && !filter) _loadUnsavedCustomers();
  const eid=_custActiveEid();
  const cu=window._custUnsaved||{};
  const unsaved=(cu.eid===eid)?(cu.rows||[]):[];
  const q=filter.toLowerCase();
  const filtered=customers.filter(c=>(c.fname+' '+c.lname+' '+c.company+' '+c.email).toLowerCase().includes(q));
  const unsavedShown=unsaved.map((u,i)=>({u,i})).filter(x=>String(x.u.name||'').toLowerCase().includes(q));
  document.getElementById('cust-total').textContent=customers.length+unsaved.length;
  const _ts=document.getElementById('cust-total-sub');
  if(_ts) _ts.textContent=unsaved.length?(customers.length+' saved · '+unsaved.length+' from invoices, not saved yet'):(cu.error&&cu.eid===eid?'Invoice clients could not be loaded':'In your CRM');
  document.getElementById('cust-active').textContent=customers.filter(c=>c.billed_recently).length;   // FA-M12d: billed in the last 12 months (server book), not the CRM status field
  document.getElementById('cust-revenue').textContent=S(customers.reduce((a,c)=>a+Number(c.revenue),0)+unsaved.reduce((a,u)=>a+Number(u.revenue),0));
  // Batch 9 (D3): one click saves them all — with a preview that holds back look-alikes of saved customers.
  const unsavedHead=unsaved.length?`<div class="ff-saveall-head" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;margin:4px 0;background:var(--bg2);border-radius:var(--radius)"><div><div style="font-weight:500;color:var(--t1)">${unsaved.length} name${unsaved.length===1?'':'s'} from invoices not saved as customers</div><div style="font-size:11.5px;color:var(--t3)">Review them and save in one go</div></div><button class="btn btn-primary btn-sm" onclick="openSaveAllContacts('customer')">Save all…</button></div>`:'';   // a header, not a contact row
  const unsavedHtml=unsavedHead+unsavedShown.map(({u,i})=>`<div class="cust-row" onclick="openCustomerModalFromUnsaved(${i})">
      <div class="cust-avatar av-amber">${esc(getInitials(String(u.name||'').split(/\s+/)[0]||'',String(u.name||'').split(/\s+/)[1]||''))}</div>
      <div><div class="cust-name">${esc(u.name)}</div><div class="cust-email">${u.invoices} invoice${u.invoices===1?'':'s'} · not saved as a customer yet</div></div>
      <span style="font-size:12px;color:var(--t2)">—</span>
      <span style="font-family:var(--font-mono);font-weight:600">${esc(S(u.revenue))}</span>
      <span><span class="badge b-amber">Not saved</span></span>
      <span class="table-actions"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openCustomerModalFromUnsaved(${i})">Save</button></span>
    </div>`).join('');
  if(!filtered.length && !unsavedShown.length){document.getElementById('customers-list').innerHTML=`<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 16 16"><circle cx="5.5" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4.5 4.5-4.5"/><circle cx="11.5" cy="5" r="2.5"/><path d="M15 13c0-2.5-2-4.5-4.5-4.5"/></svg></div><h3>No customers found</h3><p>Try a different search term, or add your first customer to get started.</p><button class="btn btn-primary btn-sm" onclick="openCustomerModal()">+ Add customer</button></div>`;return;}
  document.getElementById('customers-list').innerHTML=filtered.map(c=>{
    const av=AVATAR_COLORS[(parseInt(c.id)||0)%AVATAR_COLORS.length];
    const ini=(c.fname||c.lname)?getInitials(c.fname,c.lname):getInitials(String(c.company||'').split(' ')[0]||'',String(c.company||'').split(' ')[1]||'');   // batch 9: a company-only customer
    const badge={active:'b-green',inactive:'b-purple',prospect:'b-amber'}[c.status]||'b-blue';
    return`<div class="cust-row" onclick="openCustomerModal(${Number(c.id)})">
      <div class="cust-avatar ${esc(av)}">${esc(ini)}</div>
      <div><div class="cust-name">${(c.fname||c.lname)?esc(c.fname)+' '+esc(c.lname):esc(c.company||'—')}</div><div class="cust-email">${esc(c.email)}</div></div>
      <span style="font-size:12px;color:var(--t2)">${esc(c.company||'—')}</span>
      <span style="font-family:var(--font-mono);font-weight:600">${esc(S(c.revenue))}</span>
      <span><span class="badge ${esc(badge)}">${esc(c.status)}</span></span>
      <span class="table-actions"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openCustomerModal(${Number(c.id)})">Edit</button></span>
    </div>`;
  }).join('')+unsavedHtml;
}
function filterCustomers(){renderCustomers(document.getElementById('cust-search').value)}
function openCustomerModal(id=null){
  const del=document.getElementById('cust-delete-btn');
  if(id){
    const c=customers.find(x=>x.id===id);if(!c)return;
    document.getElementById('cust-modal-title').textContent='Edit customer';
    document.getElementById('cust-modal-sub').textContent='Update the details below';
    document.getElementById('cust-edit-id').value=id;
    document.getElementById('cust-fname').value=c.fname;document.getElementById('cust-lname').value=c.lname;
    document.getElementById('cust-company').value=c.company;document.getElementById('cust-email').value=c.email;
    document.getElementById('cust-phone').value=c.phone;   // L17: revenue is derived, not edited
    document.getElementById('cust-status').value=c.status;document.getElementById('cust-notes').value=c.notes;
    const ind=document.getElementById('cust-industry');for(let o of ind.options){if(o.value===c.industry){o.selected=true;break;}}
    del.style.display='inline-flex';
  } else {
    document.getElementById('cust-modal-title').textContent='Add customer';
    document.getElementById('cust-modal-sub').textContent='Fill in the customer details';
    document.getElementById('cust-edit-id').value='';
    ['cust-fname','cust-lname','cust-company','cust-email','cust-phone','cust-notes'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('cust-status').value='active';
    del.style.display='none';
  }
  openModal('customer-modal');
}
function saveCustomer(){
  const fname=sanitizeText(document.getElementById('cust-fname').value,100);
  const lname=sanitizeText(document.getElementById('cust-lname').value,100);
  const email=document.getElementById('cust-email').value.trim().toLowerCase().slice(0,254);
  if(!fname||!lname){notify('First name and last name are required',true);return;}
  if(!email||!validateEmail(email)){notify('A valid email address is required',true);return;}
  const data={   // L17: no typed revenue — the server derives it from the customer's invoices
    fname,lname,email,
    company:sanitizeText(document.getElementById('cust-company').value,200),
    industry:document.getElementById('cust-industry').value,
    phone:sanitizePhone(document.getElementById('cust-phone').value),
    status:document.getElementById('cust-status').value,
    notes:sanitizeText(document.getElementById('cust-notes').value,1000)
  };
  const editId=document.getElementById('cust-edit-id').value;
  if(editId){const idx=customers.findIndex(c=>c.id===Number(editId));if(idx>-1)customers[idx]={...customers[idx],...data};notify('Customer updated');}
  else{data.id=nextCustId++;customers.push(data);notify('Customer added');}
  closeModal('customer-modal');renderCustomers(document.getElementById('cust-search').value);
}
async function deleteCustomer(){
  const id=Number(document.getElementById('cust-edit-id').value);
  if(!id)return;
  if(!(await window._confirmModal('Delete this customer? This cannot be undone.', {danger:true})))return;
  customers=customers.filter(c=>c.id!==id);
  closeModal('customer-modal');renderCustomers();notify('Customer deleted');
}

// ════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════
function updateBrandName(){document.getElementById('sb-brand-name').textContent=document.getElementById('s-biz-name').value||'FinFlow'}
function updateUserName(){document.getElementById('sb-user-name').textContent=document.getElementById('s-user-name').value||'User'}
function updateUserAvatar(){document.getElementById('sb-user-avatar').textContent=document.getElementById('s-user-initials').value.toUpperCase()||'?'}
// ════════════════════════════════════════════
// F130 — TRIAL-EXPIRED PAYWALL
// ════════════════════════════════════════════
// On trial expiry the server 402s EVERY /api data read with {code:'TRIAL_EXPIRED'} (checkPlan,
// server.js:400). Auth routes are exempt, so the user logs in fine, the app boots fine, and then
// every money surface fails — landing in the F67/F96 "Unable to load" error state. The one piece of
// trial UI is a countdown banner that bails on `daysLeft<=0` (index.html), i.e. it disappears at the
// exact moment it is needed. Net effect: a paying-intent customer sees a BROKEN APP, with nothing
// on screen saying the trial ended or offering a way to fix it.
//
// This renders ONE blocking, full-screen state instead. Deliberately:
//   · IDEMPOTENT — five loaders can hit 402 in the same boot; they must not stack five overlays.
//   · SHORT-CIRCUITS the per-card error path — the caller returns before _dashSetState('error'),
//     so the user never sees "Unable to load" underneath a paywall. An expired trial is not a
//     failure to load, and reporting it as one is what makes it look like a bug in the product.
//   · Lives in app-main.js, which loads SYNCHRONOUSLY before index.html's inline scripts and before
//     the deferred bundle — so every caller can reach it whenever the 402 lands.
//   · Uses the existing showPage('pricing') route for the CTA, with a hard href fallback if the
//     SPA router is not up yet (the whole point is that this fires when things are degraded).
//
// SCOPE, stated: this is the honest FAILURE state, not a product decision. Whether an expired trial
// should hard-lock or drop to READ-ONLY (books visible, writes blocked) is an open owner question —
// read-only is the friendlier answer and is what most accounting products do, since locking someone
// out of their own books to sell them a plan is a poor trade. Not built here; flagged on F130.
function _ffShowTrialExpired(message){
  if(document.getElementById('ff-trial-gate')) return;   // idempotent
  window._ffTrialExpiredActive = true;
  const g = document.createElement('div');
  g.id = 'ff-trial-gate';
  g.setAttribute('role','dialog');
  g.setAttribute('aria-modal','true');
  g.setAttribute('aria-labelledby','ff-trial-gate-title');
  g.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(14,11,8,.92);backdrop-filter:blur(3px);font-family:Jost,system-ui,sans-serif;padding:24px';
  const safe = String(message || 'Your free trial has ended.').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  g.innerHTML =
     '<div style="max-width:420px;width:100%;background:var(--bg1,#16120d);border:1px solid var(--bd,rgba(201,168,76,.25));'
   + 'border-radius:12px;padding:28px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.45)">'
   + '<div style="font-size:32px;margin-bottom:10px">&#9889;</div>'
   + '<div id="ff-trial-gate-title" style="font-size:19px;font-weight:600;color:var(--t1,#f2e8d5);margin-bottom:8px">'
   + 'Your free trial has ended</div>'
   + '<div style="font-size:13px;color:var(--t2,#9e8e73);line-height:1.55;margin-bottom:20px">' + safe
   + '<br><br>You can still <strong>view</strong> your books — making changes needs an upgrade. Your data is safe.</div>'
   + '<button id="ff-trial-upgrade" class="btn btn-primary" style="width:100%;padding:11px;font-size:14px;font-weight:600">'
   + 'Upgrade to make changes &#8599;</button>'
   + '<button id="ff-trial-dismiss" class="btn btn-ghost" style="width:100%;padding:9px;font-size:13px;margin-top:8px">Keep viewing (read-only)</button>'
   + '<div style="margin-top:14px;font-size:11px;color:var(--t3,#6b5c42)">'
   + 'Questions? <a href="mailto:support@finflow.app" style="color:var(--acc,#c9a84c)">support@finflow.app</a></div>'
   + '</div>';
  document.body.appendChild(g);
  // F132: DISMISSABLE now. Reads work post-expiry, so dismissing lands on the user's real (read-only)
  // books — never the old escapable $0 "broken app". Only a WRITE (402 TRIAL_EXPIRED) opens this.
  const _close = function(){ g.remove(); window._ffTrialExpiredActive = false; };
  const btn = document.getElementById('ff-trial-upgrade');
  if(btn) btn.onclick = function(){
    if(typeof window.startUpgrade === 'function') window.startUpgrade();
    else if(typeof showPage === 'function'){ _close(); showPage('pricing', null); }
    else window.location.href = '/app#pricing';
  };
  const dz = document.getElementById('ff-trial-dismiss');
  if(dz) dz.onclick = _close;
  g.addEventListener('click', function(e){ if(e.target === g) _close(); });   // backdrop dismiss
}
window._ffShowTrialExpired = _ffShowTrialExpired;

// F132: start a REAL Stripe checkout (POST /api/stripe/checkout → session URL). Graceful fallback
// when billing isn't configured yet (Stripe key unset → 400 'Stripe not configured.'), so the button
// is never a broken click. /stripe/ is open in checkPlan, so an EXPIRED trial can still reach it.
window.startUpgrade = async function(){
  try{
    const res = await fetch('/api/stripe/checkout', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ plan:'business' }) });
    const data = await res.json().catch(function(){ return {}; });
    if(res.ok && data && data.url){ window.location.href = data.url; return; }
    const msg = (data && data.error === 'Stripe not configured.')
      ? 'Upgrades are opening soon — email support@finflow.app to upgrade now.'
      : ((data && data.error) || 'Could not start checkout — email support@finflow.app.');
    if(typeof notify === 'function') notify(msg, true);
  }catch(e){ if(typeof notify === 'function') notify('Could not start checkout — email support@finflow.app.', true); }
};

// F34 Step 2: the display currency the dashboard renders business figures in. null ⇒ native (the
// active entity's own currency) ⇒ no ?display= param ⇒ server returns native (identity, Step 1).
window._displayCurrency = window._displayCurrency || null;
// FA-M13: every form money label says the currency it is in — business forms the active business's currency code
// ("Amount (TTD)"), Personal goal forms the personal display currency. One writer, run on every business load / switch
// and every personal currency change. A code, not "$": USD, TTD, JMD, CAD all write "$".
function _ffApplyCurrencyLabels(){
  try {
    const biz = _activeEntityCurrency() || 'USD';
    document.querySelectorAll('[data-cur="biz"]').forEach(el => { el.textContent = biz; });
    document.querySelectorAll('[data-cur="pers"]').forEach(el => { el.textContent = (typeof persCurrency === 'string' && persCurrency) || 'USD'; });
  } catch (_) {}
}
window._ffApplyCurrencyLabels = _ffApplyCurrencyLabels;
function _activeEntityCurrency(){
  try { const a=(typeof ENTITIES!=='undefined'?ENTITIES:(window.ENTITIES||[])).find(e=>e.active); return (a&&a.currency)||'USD'; } catch(e){ return 'USD'; }
}
// F34 core — the ONE display-currency path. Every currency control (header pill, Settings, mobile
// drawer) routes through this so they genuinely CONVERT, not just relabel: selecting the active
// entity's OWN currency ⇒ _displayCurrency=null ⇒ identity/native (no ?display= param); a non-native
// currency ⇒ _displayCurrency=code ⇒ refreshAllPeriodData → updateDashboard → _applyConvertedKPIs
// re-fetches /api/reports?display=<CCY> and renders the server-converted figures. No client FX math.
function _applyDisplayCurrency(code){
  const map={USD:'$',EUR:'€',GBP:'£',TTD:'TT$',CAD:'C$',AUD:'A$'};
  currencySymbol=map[code]||(window.CURRENCIES&&window.CURRENCIES[code]&&window.CURRENCIES[code].symbol)||'$';
  // F70: activeCurrency IS the display currency — the patched S() stamps its symbol on EVERY
  // figure (app-main.js:573). Set it HERE, in the single funnel all three currency controls
  // route through, not in one caller. Previously only setCurrency() (the header pill) assigned
  // it, so switching from Settings (#s-currency → updateCurrency) or the mobile drawer
  // (#smc-currency → updateCurrency) converted the VALUES via the server but left S() stamping
  // the PREVIOUS currency's symbol — converted money under the wrong sign, on 2 of the 3
  // controls. Assignment is idempotent for setCurrency, which already sets it before calling us.
  activeCurrency=code;
  window._displayCurrency=(code && code!==_activeEntityCurrency())?code:null;
  refreshAllPeriodData();
}
// Keep every currency control reflecting the same active display currency, both directions, so
// changing one updates the others' displayed value. Called by updateCurrency() AND setCurrency().
function _syncCurrencyControls(code){
  const s=document.getElementById('s-currency');   if(s && s.value!==code) s.value=code;   // Settings
  const m=document.getElementById('smc-currency'); if(m && m.value!==code) m.value=code;   // mobile drawer
  const lbl=document.getElementById('currency-code-label'); if(lbl) lbl.textContent=code;  // header pill label
  const c=(window.CURRENCIES||{})[code]; const flag=document.getElementById('currency-flag');
  if(flag && c && c.flag) flag.textContent=c.flag;                                          // header pill flag
}
function updateCurrency(){
  const code=document.getElementById('s-currency').value;
  _applyDisplayCurrency(code);
  _syncCurrencyControls(code);
  notify('Currency updated to '+code);
}
// F25: build the entity + period-window query for /api/cogs, so the client asks the server for a
// PERIOD-SCOPED COGS instead of caching an all-time figure. Shared by _loadPeriodCOGS (dashboard)
// and loadCOGS (the COGS page) so the two can never ask for different windows. COGS is now handled
// exactly like its siblings computeRevenue / computeExpenseBreakdown — period-aware — rather than
// being the one leg frozen at all-time (F25).
function _cogsPeriodParams(){
  const qs=new URLSearchParams();
  const eid=(window.ENTITIES||[]).find(e=>e.active)?._dbId;
  if(eid) qs.set('entity_id', eid);
  // F87: send INTENT (period + monthIdx + fyStart); the server resolves the calendar window, so
  // no local-midnight window crosses the wire. Mirrors the /api/reports contract.
  const period=(typeof currentPeriod!=='undefined')?currentPeriod:'year';
  qs.set('period', period);
  const _mi=_periodIntentIdx(period); if(_mi!=null) qs.set('monthIdx', String(_mi));   // L9: same quarter as the native KPIs
  const _fyNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  qs.set('fyStart', String(Math.max(0,_fyNames.indexOf((document.getElementById('s-fy')||{}).value||'January'))));
  return qs;
}
window._cogsPeriodParams=_cogsPeriodParams;

// F25: refetch the period-scoped COGS and repaint the cards that subtract it. Called on every
// period/month switch. On failure it LEAVES the prior value (never fabricates $0 — F62 class) and
// skips the repaint when the figure is unchanged, so a period with the same COGS causes no churn.
let _cogsInFlight=false;
async function _loadPeriodCOGS(){
  if(_cogsInFlight) return; _cogsInFlight=true;
  try{
    const r=await fetch('/api/cogs?'+_cogsPeriodParams().toString(),{credentials:'include'});
    if(!r.ok) return;                                   // keep prior _cogsTotal; honest-stale > fake-zero
    const j=await r.json();
    const next=parseFloat(j&&j.totalCOGS)||0;
    if(next===(parseFloat(window._cogsTotal)||0)) return;   // unchanged → no repaint
    window._cogsTotal=next;
    if(typeof updateDashboard==='function') updateDashboard();
    if(typeof updateAI==='function') updateAI();
  }catch(e){ /* leave _cogsTotal as-is */ }
  finally{ _cogsInFlight=false; }
}
window._loadPeriodCOGS=_loadPeriodCOGS;

// F34 Step 2: overlay the server-converted canonical KPIs for the active period+entity. Uses the
// SAME _periodWindow the client filters on so server==client at every period; a stale response
// (currency changed mid-flight) is dropped. Native/identity path never calls this.
async function _applyConvertedKPIs(ccy){
  // F59: these two helpers live OUTSIDE the try so the catch can reach them. Previously the whole
  // body was inside a `try{...}catch(e){}` with an `if(!r.ok) return;` — so a failed or errored
  // conversion left the NATIVE figures on screen under the newly-relabelled foreign currency.
  // That is mislabelled money: the exact defect F34 was opened for, alive on the failure path.
  const set =(id,v)=>{const el=document.getElementById(id); if(el){el.textContent=_fmtMoney(v, CURRENCIES[ccy]?.symbol || '$'); el.title='';}};
  const dash=(id,hint)=>{const el=document.getElementById(id); if(el){el.textContent='—'; el.title=hint||'';}};
  const _FX_CARDS=['d-rev','d-exp','d-profit','d-outstanding','d-invest'];
  try{
    const period=(typeof currentPeriod!=='undefined')?currentPeriod:'year';
    const qs=new URLSearchParams({display:ccy});
    // F87: send INTENT; the server resolves the window (no local-midnight window on the wire).
    qs.set('period', period);
    const _mi=_periodIntentIdx(period); if(_mi!=null) qs.set('monthIdx', String(_mi));   // L9: same quarter as the native KPIs
    // F34 B: fiscal-year start month (matches the client overview-chart indexing) so the server's
    // converted monthly buckets align with the chart's fiscal months.
    const _fyNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
    qs.set('fyStart', String(Math.max(0,_fyNames.indexOf((document.getElementById('s-fy')||{}).value||'January'))));
    const r=await fetch('/api/reports?'+qs.toString(),{credentials:'include'});
    if(!r.ok) throw new Error('HTTP '+r.status);   // F59: fall through to the honest "—" handler
    const j=await r.json();
    if(window._displayCurrency!==ccy) return; // currency changed while in flight — drop stale
    const cov=j.fxCoverage||{};
    if(cov.complete===false){
      // FIX (completes the F34/F59 mislabel guard): no FX rate exists for this pair, so NO surface
      // can be converted. Blanking only the KPIs (prior behaviour) still left the overview chart,
      // expense breakdown and txns list repainted with NATIVE magnitudes under the freshly-stamped
      // foreign symbol -- the axis tick is symbol-only by design (F120) and relies on pre-converted
      // data, which here does not exist. That is mislabeled money on 3 surfaces. The honest,
      // non-destructive fix: revert the display to the entity's BASE currency, repaint every surface
      // consistently, and tell the user to add a rate. _displayCurrency is nulled FIRST so the native
      // refresh below does not re-enter this path (updateDashboard gates the overlay on it).
      const from=(cov.unconvertible&&cov.unconvertible[0]&&cov.unconvertible[0].from)||_activeEntityCurrency();
      const base=_activeEntityCurrency();
      const _symMap={USD:'$',EUR:'\u20AC',GBP:'\u00A3',TTD:'TT$',CAD:'C$',AUD:'A$'};
      currencySymbol=_symMap[base]||(window.CURRENCIES&&window.CURRENCIES[base]&&window.CURRENCIES[base].symbol)||'$';
      activeCurrency=base;
      window._displayCurrency=null;
      if(typeof _syncCurrencyControls==='function') _syncCurrencyControls(base);
      if(typeof notify==='function') notify('No FX rate for '+from+'\u2192'+ccy+'. Add one under FX / Currency to convert. Showing '+base+'.', true);
      if(typeof refreshAllPeriodData==='function') refreshAllPeriodData();
      return;
    } else {
      // Server-converted canonical figures (historical per-transaction FX). No client conversion math.
      set('d-rev', j.revenue||0);
      set('d-exp', j.expenses||0);
      set('d-profit', j.netProfit||0);
      { const _ce=document.getElementById('d-profit-cogs'); if(_ce){ _ce.textContent=''; _ce.style.display='none'; } }   // LA13: native COGS never under a foreign symbol (F59)
      set('d-outstanding', j.outstanding||0);   // Outstanding/AR converts at each invoice's issue date
      _applyConvertedChart(j.monthly);          // F34 B surface 1 — overview chart from server buckets
      _applyConvertedBreakdown(j.expenseBreakdown); // F34 B surface 2 — expense breakdown from server
      _applyConvertedTxns(j.transactions);      // F34 B surface 3 — transactions list from server (per-row)
    }
    // Investments (BUSINESS positions, USD-priced) — converted EXPLICITLY via the server's rateAsOf
    // (USD→display, today). Reads window.bizHoldings (same source as the dashboard wiring, post
    // cross-wire fix — NOT personal window.holdings), with the SAME Σ shares×(price||…) formula, so
    // display=native ⇒ investRate 1 ⇒ byte-identical to the native card. No USD→display rate ⇒
    // investRate null ⇒ "—" + hint (never a relabel).
    if(j.investRate!=null){
      const _hold = window.bizHoldings || [];
      const _usd = _hold.reduce((s,h)=> s + (parseFloat(h.shares)||0)*(parseFloat(h.price)||parseFloat(h._lastPrice)||parseFloat(h.costPer)||parseFloat(h.cost)||0), 0);
      set('d-invest', _usd * j.investRate);
    } else {
      dash('d-invest','No FX rate for USD→'+ccy+'. Add one under FX / Currency to convert investments.');
    }
  }catch(e){
    // F59: a conversion failure must NEVER leave native figures under a foreign currency label.
    // Blank them to "—" with a hint. Honest-empty beats confidently-wrong money (class C6/C7).
    if(window._displayCurrency!==ccy) return;   // stale — a newer call owns the cards now
    console.error('[FX] display-currency conversion to '+ccy+' failed:', e && e.message);
    const hint='Could not convert to '+ccy+'. Figures unavailable — check your connection, then switch currency again to retry.';
    _FX_CARDS.forEach(id=>dash(id,hint));
  }
}
// Money audit 2026-10-09 — ONE source for the native dashboard. The display-currency path above already paints
// from /api/reports (computeBooks); the NATIVE path recomputed the same books in the browser — a second
// implementation that drifted: payroll dropped from the monthly arrays (M10), future-dated rows in the chart
// (M38), expense rows dated by expense_date only (M39), a profit delta comparing net-with-COGS to a prior period
// without COGS (M29), and the river's third profit figure (M37). The browser's figures stay as the instant first
// paint; this overlay then replaces the headline cards, their "vs prior period" deltas, and the monthly REV[]/EXP[]
// arrays (which the overview chart, cash chart, river, AI insights and health score all read) with the server's.
// A stale response (entity switch, period change, currency change mid-flight) is dropped. On a failed fetch the
// provisional figures stay (same basis); nothing is fabricated.
let _serverBooksSeq = 0;
async function _applyServerBooks(){
  const seq = ++_serverBooksSeq;
  const period = (typeof currentPeriod!=='undefined') ? currentPeriod : 'year';
  const _fyNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const fyStart = Math.max(0,_fyNames.indexOf((document.getElementById('s-fy')||{}).value||'January'));
  const ent = (typeof ENTITIES!=='undefined'?ENTITIES:(window.ENTITIES||[])).find(e=>e.active);
  const eid = ent && ent._dbId;
  const q = (p, mi) => { const qs=new URLSearchParams({period:p, fyStart:String(fyStart)}); if(mi!=null) qs.set('monthIdx', String(mi)); if(eid) qs.set('entity_id', String(eid)); return '/api/reports?'+qs.toString(); };
  const mi = _periodIntentIdx(period);
  let priorIdx = null;
  if(period==='month') priorIdx = (typeof currentMonthIdx!=='undefined' ? currentMonthIdx : _fyContext().curFyIdx) - 1;
  else if(period==='quarter') priorIdx = _fyContext().curFyIdx - 3;
  // LR3: …or the business changed while the fetch was in flight — the previous business's books must never land.
  const _activeEid = () => { const a=(typeof ENTITIES!=='undefined'?ENTITIES:(window.ENTITIES||[])).find(e=>e.active); return a && a._dbId; };
  const stale = () => seq!==_serverBooksSeq || !!window._displayCurrency || ((typeof currentPeriod!=='undefined'?currentPeriod:'year')!==period) || _activeEid()!==eid;
  try{
    const [cur, prior, year] = await Promise.all([
      fetch(q(period, mi), {credentials:'include'}).then(r=>r.ok?r.json():null),
      (priorIdx!=null && priorIdx>=0) ? fetch(q(period, priorIdx), {credentials:'include'}).then(r=>r.ok?r.json():null) : Promise.resolve(null),
      period==='year' ? Promise.resolve(null) : fetch(q('year', null), {credentials:'include'}).then(r=>r.ok?r.json():null),
    ]);
    if(stale() || !cur) return;
    const _set=(id,v)=>{const el=document.getElementById(id); if(el) el.textContent=_fmtMoneyAbbr(v);};
    _set('d-rev', cur.revenue||0);
    _set('d-exp', cur.expenses||0);
    _set('d-profit', cur.netProfit||0);
    // LA13 (live audit 2026-10-13): Net = Revenue − COGS − Expenses, and COGS is on no card, so the three cards did not
    // visibly reconcile. Name the COGS under Net Profit — the server's figure for the same period. Sole writer.
    { const _ce=document.getElementById('d-profit-cogs'); if(_ce){ const _c=Number(cur.cogs!=null?cur.cogs:cur.totalCOGS)||0;
      if(_c>0.005){ _ce.textContent='after '+S(_c)+' cost of goods sold'; _ce.style.display=''; } else { _ce.textContent=''; _ce.style.display='none'; } } }
    // Outstanding stays EXACT, as the native card shows it (money(), not abbreviated) — it is the AR balance.
    { const _el=document.getElementById('d-outstanding'); if(_el) _el.textContent=S(cur.outstanding||0); }
    // M36: business holdings are USD-priced — convert with the server's USD→entity rate; no rate ⇒ "—" + hint.
    { const _el=document.getElementById('d-invest'); if(_el){
      const _hold=window.bizHoldings||[];
      const _usd=_hold.reduce((s,h)=> s + (parseFloat(h.shares)||0)*(parseFloat(h.price)||parseFloat(h._lastPrice)||parseFloat(h.costPer)||parseFloat(h.cost)||0), 0);
      if(cur.investRate!=null){ _el.textContent=_fmtMoneyAbbr(_usd*cur.investRate); _el.title=''; }
      else if(_usd>0){ _el.textContent='—'; _el.title='No FX rate for USD→'+(cur.investCurrency||_activeEntityCurrency())+'. Add one under FX / Currency to value investments in this business\'s currency.'; }
    } }
    window._serverBooks = { period, monthIdx: mi, revenue: cur.revenue||0, cogs: cur.totalCOGS!=null?cur.totalCOGS:(cur.cogs||0), expenses: cur.expenses||0, netProfit: cur.netProfit||0, outstanding: cur.outstanding||0, overdue: cur.overdue||0 };
    // M29: the delta compares like with like — both periods from the server, both net of COGS.
    if(prior){
      const rc=chg(cur.revenue||0, prior.revenue||0), ec=chg(cur.expenses||0, prior.expenses||0, true), pc=chg(cur.netProfit||0, prior.netProfit||0);
      set('d-rev-chg',rc.txt,rc.cls); set('d-exp-chg',ec.txt,ec.cls); set('d-profit-chg',pc.txt,pc.cls);
    }
    // M10/M38/M39: the monthly arrays are the server's fiscal-year buckets (same for every period view).
    const mon = (cur.monthly && cur.monthly.revByMonth) ? cur.monthly : (year && year.monthly);
    if(mon && Array.isArray(mon.revByMonth) && mon.revByMonth.length===12 && typeof window._setMonthlyArrays==='function'){
      window._setMonthlyArrays(mon.revByMonth, mon.expByMonth);
      if(typeof updateCharts==='function'){ try{ updateCharts(); }catch(_){} }
      if(typeof buildRiver==='function'){ try{ buildRiver(getPeriodData()); }catch(_){} }
    }
  }catch(e){ console.warn('[dashboard] server books overlay failed — provisional figures kept:', e && e.message); }
}
window._applyServerBooks = _applyServerBooks;

// F34 B surface 1 — overlay the overview chart with the server's CONVERTED monthly buckets. Updates
// the Chart.js datasets ONLY (never REV/EXP/MONTHS globals, so native period surfaces stay native and
// there's no double-conversion). No rate for the pair (monthly.complete false) ⇒ leave the native
// chart (the KPIs already show "—" + hint) rather than paint fabricated zeros.
function _applyConvertedChart(monthly){
  if(!monthly || monthly.complete===false) return;
  const safe = a => (a||[]).map(v=>Math.max(0, v||0));
  // ⚠️ F125 — this read was `window.charts && window.charts.overview` and was ALWAYS UNDEFINED.
  // `charts` is declared `let charts = {}` (:1598), and a top-level `let` in a classic script binds
  // in the script scope, NOT on the global object — proven by execution in jsdom, not assumed. So
  // this whole overlay has never run once: F34 Path B "surface 1 — overview chart from server
  // buckets" has never rendered, and neither had the cash conversion below when it was written
  // against the same dead guard. Using the script-scoped binding — the one every other line in this
  // file already uses (`charts.overview`, `charts.cash`) — is what makes the overlay reachable.
  // NOT fixed by exposing `window.charts` globally, which would ALSO wake 5 dead sites in
  // finflow-api-wiring-dashboard.js, one of which (:465-472) writes these same two datasets — a
  // second writer of one figure, this codebase's failure mode 2. That is F125's decision, not a
  // side effect of a currency fix.
  const chart = charts && charts.overview;
  if(chart && chart.data && chart.data.datasets){
    chart.data.labels = monthly.labels || chart.data.labels;
    chart.data.datasets[0].data = safe(monthly.revByMonth);
    chart.data.datasets[1].data = safe(monthly.expByMonth);
    try{ chart.update('none'); }catch(e){ try{ chart.update(); }catch(_){} }
  }
  // F124: the CASH chart too. It was left native while its axis and tooltip both stamped
  // activeCurrency, so under a display currency it showed the entity's own figures under a
  // foreign symbol — F34's defect, on the one dashboard chart F34 never enumerated.
  //
  // No new FX wiring and no client rate math: monthly profit IS revenue − expenses (the native
  // path computes PROFIT[i] = REV[i] − EXP[i] at :1483), so subtracting the two SERVER-converted
  // buckets already in this payload gives the converted profit by the same arithmetic. Not
  // clamped at 0 the way the bars are — a loss is a real value on this chart and Math.max would
  // silently erase it (the seed's June loss is exactly that case).
  const cash = charts && charts.cash;
  if(cash && cash.data && cash.data.datasets){
    const rev = monthly.revByMonth || [], exp = monthly.expByMonth || [];
    const n = Math.max(rev.length, exp.length);
    const profit = Array.from({length:n}, (_,i) => (rev[i]||0) - (exp[i]||0));
    const {actual, forecast} = _cashSeries(profit);
    cash.data.datasets[0].data = actual;
    cash.data.datasets[1].data = forecast;
    try{ cash.update('none'); }catch(e){ try{ cash.update(); }catch(_){} }
  }
}
// F34 B surface 2 — overlay the expense-breakdown bars with the server's CONVERTED per-category
// totals (same top-4 rows + width% as the bundle updateExpenseBars, but values via S() in the
// display currency). No rate ⇒ leave native (KPIs already show "—"). Writes the same DOM as the
// bundle renderer, so NO bundle source changes.
function _applyConvertedBreakdown(bd){
  if(!bd || bd.complete===false || !bd.rows) return;
  const total = bd.rows.reduce((s,r)=>s+(r.amount||0),0) || 1;
  const ids=[['exp-sal','exp-sal-bar','exp-sal-lbl'],['exp-rent','exp-rent-bar','exp-rent-lbl'],['exp-sw','exp-sw-bar','exp-sw-lbl'],['exp-mkt','exp-mkt-bar','exp-mkt-lbl']];
  bd.rows.slice(0,4).forEach((r,i)=>{
    const [vId,bId,lId]=ids[i];
    const v=document.getElementById(vId), b=document.getElementById(bId), l=document.getElementById(lId);
    if(v) v.textContent=S(r.amount);
    if(b){ const w=Math.round(r.amount/total*100)+'%'; b.style.setProperty('width',w,'important'); b.style.setProperty('--bar-w',w); }
    if(l) l.textContent=r.category;
  });
}
// F34 B surface 3 — overlay the recent-transactions list with the server's per-row CONVERTED amounts
// (same #d-txns row markup as the bundle updateTransactions; amount via S(), or "—" if that row's pair
// has no rate). Only runs for a non-native display, so native list stays byte-identical → no bundle change.
function _applyConvertedTxns(txns){
  const el=document.getElementById('d-txns');
  if(!el || !Array.isArray(txns) || !txns.length) return;
  const _e=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  el.innerHTML=txns.map(t=>{
    const inc=t.type==='income';
    const icon=inc?'<polyline points="1,8 6,3 10,7 15,2"/><polyline points="10,2 15,2 15,7"/>':'<polyline points="1,5 5,10 9,7 15,13"/><polyline points="10,13 15,13 15,8"/>';
    const amt=(t.amount==null)?'—':((inc?'+':'-')+S(t.amount));
    return '<div class="tx-row"><div class="tx-left"><div class="tx-icon '+(inc?'av-green':'av-red')+'">'
      +'<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">'+icon+'</svg></div>'
      +'<div><div class="tx-name">'+_e(t.name)+'</div><div class="tx-cat">'+_e(t.cat)+'</div></div></div>'
      +'<div class="tx-amt '+(inc?'up':'dn')+'">'+amt+'</div></div>';
  }).join('');
}
function toggleCompact(){
  document.getElementById('sidebar').classList.toggle('compact',document.getElementById('s-compact').checked);
}
async function saveSettings(){
  const v = id => (document.getElementById(id)||{}).value;
  const c = id => !!document.getElementById(id)?.checked;
  const b = {
    name:          v('s-user-name'),
    currency:      v('s-currency'),
    business_name: v('s-biz-name'),
    industry:      v('s-industry'),
    address:       v('s-address'),
    email:         v('s-email'),
    phone:         v('s-phone'),
    website:       v('s-website'),
    tax_id:        v('s-tax-id'),
    fiscal_year:   v('s-fy'),
    dark_mode:     c('s-dark') ? 1 : 0,
    show_cents:    c('s-cents') ? 1 : 0,
    notif_email:   c('s-email-alerts') ? 1 : 0,
  };
  try {
    await fetch('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(b) });
    if (window.CURRENT_USER && b.name) window.CURRENT_USER.name = b.name;
    notify('Settings saved ✦');
    // A fiscal-year change must re-sync the computed month range everywhere (header,
    // month nav, chart, AI) — otherwise MONTH_FULL only recomputes on the next entity
    // load, so the header/chart lag until then.
    _ffFiscalMonthsChanged();   // LC2b
    if(typeof refreshAllPeriodData==='function') refreshAllPeriodData();
  } catch(e) { notify('Failed to save settings'); }
}

function openAddEntityModal(){
  if(_entityCapReached()){
    if(typeof showUpgradeModal==='function') showUpgradeModal('entity');
    return;
  }
  openCreateBusinessPage('entities');
}

async function changePassword(){
  const cur = document.getElementById('s-cur-pw')?.value;
  const nw  = document.getElementById('s-new-pw')?.value;
  if(!cur||!nw){ notify('Both fields required'); return; }
  try {
    const res = await fetch('/api/auth/change-password', { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({currentPassword:cur, newPassword:nw}) });
    const d = await res.json();
    if(!res.ok) throw new Error(d.error);
    document.getElementById('s-cur-pw').value='';
    document.getElementById('s-new-pw').value='';
    notify('Password updated ✦');
  } catch(e){ notify('Error: '+(e.message||'Failed')); }
}

function openDeleteAccountModal(){
  document.getElementById('del-acct-pw').value='';
  document.getElementById('delete-account-modal').classList.remove('hidden');
}

async function confirmDeleteAccount(){
  const pw = document.getElementById('del-acct-pw')?.value;
  if(!pw){ notify('Password required'); return; }
  try {
    const res = await fetch('/api/auth/account', { method:'DELETE', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({password:pw}) });
    const d = await res.json();
    if(!res.ok) throw new Error(d.error);
    closeModal('delete-account-modal');
    notify('Account deleted. Redirecting…');
    setTimeout(()=>{ window.location.href='/'; }, 1500);
  } catch(e){ notify('Error: '+(e.message||'Failed to delete account')); }
}
function connectAPI(platform){document.getElementById(platform+'-modal-inline').style.display='block'}
function saveConnection(platform){
  document.getElementById(platform+'-modal-inline').style.display='none';
  document.getElementById(platform+'-dot').className='dot dot-green';
  document.getElementById(platform+'-status').textContent='Connected';
  document.getElementById(platform+'-status').style.color='var(--green)';
  document.getElementById(platform+'-btn').textContent='Manage';
  document.getElementById(platform+'-btn').onclick=null;
  notify(platform.charAt(0).toUpperCase()+platform.slice(1)+' connected successfully');
}

// ════════════════════════════════════════════
// THEME
// ════════════════════════════════════════════
function toggleTheme(){
  darkMode=!darkMode;
  document.getElementById('app').classList.toggle('light-mode',!darkMode);
  document.getElementById('themeBtn').textContent=darkMode?'☀ Light':'☾ Dark';
  const s=document.getElementById('s-dark');if(s)s.checked=darkMode;
  // Rebuild charts with correct gradients for new theme
  if(charts.overview){charts.overview.destroy();delete charts.overview;}
  if(charts.cash){charts.cash.destroy();delete charts.cash;}
  loadChartJS(function(){buildCharts();buildCashChart();updateCharts();});
  setTimeout(()=>buildRiver(getPeriodData()),60);
}

// ════════════════════════════════════════════
// CHARTS
// ════════════════════════════════════════════
function chartDefaults(){return{tc:darkMode?'#9e8e73':'#6b5c42',gc:darkMode?'rgba(201,168,76,0.06)':'rgba(0,0,0,0.05)'}}

function buildCharts(){
  if(typeof Chart==='undefined'){if(typeof loadChartJS==='function')loadChartJS(buildCharts);else console.warn('Chart.js not loaded — charts skipped');return;}
  // Destroy ALL orphaned Chart instances (prevents "instance 0" ghost conflict on re-render)
  Object.keys(Chart.instances).forEach(key=>{try{Chart.instances[key].destroy();}catch(e){}});
  // Destroy existing charts to prevent canvas reuse error
  if(window.charts){
    Object.values(window.charts).forEach(c=>{try{if(c&&typeof c.destroy==='function')c.destroy();}catch(e){}});
    window.charts={};
  }
  const{tc,gc}=chartDefaults();
  const _oc=document.getElementById('overviewChart');
  if(!_oc||_oc.offsetWidth===0||_oc.offsetParent===null)return;
  const ctx=_oc.getContext('2d');
  if(!ctx)return;
  // Gradient fill for revenue bars
  const revGrad=ctx.createLinearGradient(0,0,0,180);
  revGrad.addColorStop(0,'rgba(201,168,76,0.95)');
  revGrad.addColorStop(1,'rgba(201,168,76,0.55)');
  const expGrad=ctx.createLinearGradient(0,0,0,180);
  expGrad.addColorStop(0,darkMode?'rgba(58,46,30,0.9)':'rgba(180,160,120,0.5)');
  expGrad.addColorStop(1,darkMode?'rgba(35,29,22,0.6)':'rgba(200,185,155,0.25)');
  charts.overview=new Chart(ctx,{
    type:'bar',
    data:{labels:MONTHS,datasets:[
      {label:'Revenue', data:REV, backgroundColor:revGrad,borderRadius:5,borderSkipped:false,hoverBackgroundColor:'#e4c97a'},
      {label:'Expenses',data:EXP, backgroundColor:expGrad,borderRadius:5,borderSkipped:false,hoverBackgroundColor:darkMode?'rgba(80,60,35,0.9)':'rgba(210,195,165,0.7)'}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:darkMode?'rgba(22,18,13,0.95)':'rgba(255,252,245,0.97)',
          borderColor:darkMode?'rgba(201,168,76,0.3)':'rgba(158,122,42,0.2)',
          borderWidth:1,
          titleColor:darkMode?'#f2e8d5':'#1e1810',
          bodyColor:darkMode?'#9e8e73':'#6b5c42',
          padding:10,cornerRadius:6,
          callbacks:{label:ctx=>S(ctx.raw)}
        }
      },
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'}},border:{display:false}},
        // F120: the symbol is resolved LIVE, not hardcoded '$'. The values on this axis are always
        // already in `activeCurrency`: native ⇒ activeCurrency IS the entity's currency; a display
        // currency ⇒ _applyConvertedChart has overwritten both datasets with the SERVER-converted
        // buckets. So the axis needs the symbol only — deliberately NOT _fmtMoneyAbbr, whose
        // fxConvert() call would double-convert a server-converted figure the day the F59 arity
        // landmine is "fixed". Same shape as _applyConvertedKPIs' own set() helper (:4719).
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'},callback:v=>_fmtMoney(v, CURRENCIES[activeCurrency]?.symbol||'$')},border:{display:false}}
      }
    }
  });
}

// F124: the cash chart's two datasets, from ONE monthly-profit array. Extracted verbatim from
// buildCashChart so the native path and the FX overlay build the series with the SAME code — a
// second copy here would be the multi-writer class (failure mode 2) in miniature, and the two
// would drift the first time the forecast rule changed.
// Behaviour is byte-identical to the inline version it replaces, INCLUDING the forecast array
// being one element longer than `labels` (12 nulls + 4 values against 15 labels). That is
// pre-existing and deliberately NOT "tidied" here: changing it would alter the native chart in a
// commit about currency labelling, and Chart.js ignores the surplus point. Logged, not fixed.
function _cashSeries(profit){
  const recent=profit.filter(v=>v!==0);
  const has=recent.length>0;
  const avg=has?recent.slice(-3).reduce((a,b)=>a+b,0)/Math.min(recent.slice(-3).length,3):0;
  return {
    actual:[...profit,null,null,null],
    forecast:[...profit.map(()=>null),has?profit[11]:null,has?Math.round(avg*1.02):null,has?Math.round(avg*1.04):null,has?Math.round(avg*1.06):null],
  };
}

function buildCashChart(){
  if(typeof Chart==='undefined'){if(typeof loadChartJS==='function')loadChartJS(buildCashChart);else console.warn('Chart.js not loaded — cash chart skipped');return;}
  const{tc,gc}=chartDefaults();
  const _cc=document.getElementById('cashChart');
  if(!_cc||_cc.offsetWidth===0||_cc.offsetParent===null)return;
  const ctx=_cc.getContext('2d');
  if(!ctx)return;
  const labels=[...MONTHS,'May \'26*','Jun \'26*','Jul \'26*'];
  const {actual,forecast}=_cashSeries(PROFIT);
  // Gradient fill under profit line
  const profitGrad=ctx.createLinearGradient(0,0,0,160);
  profitGrad.addColorStop(0,'rgba(201,168,76,0.22)');
  profitGrad.addColorStop(0.7,'rgba(201,168,76,0.04)');
  profitGrad.addColorStop(1,'rgba(201,168,76,0)');
  if(charts.cash){charts.cash.destroy();}
  charts.cash=new Chart(ctx,{
    type:'line',
    data:{labels,datasets:[
      {label:'Net profit',data:actual,  borderColor:'#c9a84c',borderWidth:2,backgroundColor:profitGrad,fill:true,tension:0.42,pointRadius:4,pointHoverRadius:6,pointBackgroundColor:'#c9a84c',pointBorderColor:darkMode?'#16120d':'#fff',pointBorderWidth:2},
      {label:'Forecast', data:forecast, borderColor:'#7db87d',borderWidth:2,borderDash:[6,4],tension:0.42,pointRadius:4,pointHoverRadius:6,pointBackgroundColor:'#7db87d',pointBorderColor:darkMode?'#16120d':'#fff',pointBorderWidth:2,fill:false}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:darkMode?'rgba(22,18,13,0.95)':'rgba(255,252,245,0.97)',
          borderColor:darkMode?'rgba(201,168,76,0.3)':'rgba(158,122,42,0.2)',
          borderWidth:1,
          titleColor:darkMode?'#f2e8d5':'#1e1810',
          bodyColor:darkMode?'#9e8e73':'#6b5c42',
          padding:10,cornerRadius:6,
          callbacks:{label:ctx=>ctx.raw!=null?S(Math.round(ctx.raw)):''}
        }
      },
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'}},border:{display:false}},
        // F120: live symbol, as in buildCharts above — matching this chart's own tooltip, which
        // already stamps activeCurrency via S().
        // F124 (was flagged here as still open, now CLOSED): the series is FX-converted too.
        // _applyConvertedChart replaces both datasets with rev−exp from the server's converted
        // monthly buckets, and updateCharts restores the native series whenever no display
        // currency is armed — so the value and the symbol are always the same currency.
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'},callback:v=>_fmtMoney(v, CURRENCIES[activeCurrency]?.symbol||'$')},border:{display:false}}
      }
    }
  });
}

function updateCharts(d=getPeriodData()){
  if(!charts.overview)return;
  const{tc,gc}=chartDefaults();
  // Overview chart — show selected period data
  let labels,rev,exp;
  if(currentPeriod==='quarter'){
    labels=MONTHS.slice(9,12);rev=REV.slice(9,12);exp=EXP.slice(9,12);
  } else if(currentPeriod==='month'){
    labels=[MONTHS[currentMonthIdx]];rev=[REV[currentMonthIdx]];exp=[EXP[currentMonthIdx]];
  } else {
    labels=MONTHS;rev=REV;exp=EXP;
  }
  charts.overview.data.labels=labels;
  charts.overview.data.datasets[0].data=rev;
  charts.overview.data.datasets[1].data=exp;
  charts.overview.options.scales.x.ticks.color=tc;charts.overview.options.scales.y.ticks.color=tc;
  charts.overview.options.scales.x.grid.color=gc;charts.overview.options.scales.y.grid.color=gc;
  charts.overview.options.plugins.tooltip.callbacks.label=ctx=>S(ctx.raw);
  // Guard the update like _applyConvertedChart (:5082) does. Chart.js throws inside update() when the
  // canvas is detached (dashboard page hidden while the user is on another tab), and updateCharts runs
  // SYNCHRONOUSLY inside refreshAllPeriodData ← setCurrency ← switchBusiness — an uncaught throw here
  // aborted the sidebar entity switch BEFORE it reached switchEntity, desyncing the two entity pickers.
  try{ charts.overview.update(); }catch(_){ /* detached/hidden canvas — chart rebuilds when its page is shown */ }
  // Cash chart always shows full year + forecast
  if(charts.cash){
    // F124: repaint the NATIVE series here, exactly as the overview chart is repainted from
    // REV/EXP above. Without it the cash chart had no way back: _applyConvertedChart now writes
    // converted data into it, nothing else ever rewrote those datasets, and switching back to the
    // native currency would have left converted figures under the native symbol — the same
    // mislabelling in the opposite direction. This runs BEFORE the async overlay lands (see
    // refreshAllPeriodData: updateDashboard kicks the fetch off, updateCharts is synchronous), so
    // native paints first and the overlay wins when a display currency is armed — the
    // paint-then-correct order the KPI tiles already use.
    if(charts.cash.data && charts.cash.data.datasets){
      const _c=_cashSeries(PROFIT);
      charts.cash.data.datasets[0].data=_c.actual;
      charts.cash.data.datasets[1].data=_c.forecast;
    }
    charts.cash.options.scales.x.ticks.color=tc;charts.cash.options.scales.y.ticks.color=tc;
    charts.cash.options.scales.x.grid.color=gc;charts.cash.options.scales.y.grid.color=gc;
    try{ charts.cash.update(); }catch(_){ /* detached/hidden canvas — chart rebuilds when its page is shown */ }
  }
}

// ════════════════════════════════════════════
// PDF EXPORT
// ════════════════════════════════════════════
function exportPDF(){
  // Downloadable PDF: data pages render a REAL .pdf via jsPDF (exportAllCSV('pdf') reuses the same
  // page-aware row builder as CSV/XLSX, then doc.save() downloads it). Visual pages with no table
  // (dashboard, reports, charts) fall back to the browser's print-to-PDF.
  var _rm = document.getElementById('report-gen-modal');   // C15: an open report exports as a real PDF of its figures
  if (_rm && !_rm.classList.contains('hidden') && typeof window._rptExport === 'function') { window._rptExport('pdf'); return; }
  var ap = (document.querySelector('.page.active') || {}).id || '';
  var visual = /dashboard|report|mrr|budget|cashflow|investment|scenario|segment|connection|setting|help|audit/.test(ap);
  if (!visual && typeof window.exportAllCSV === 'function') {
    try { window.exportAllCSV('pdf'); return; } catch(e){ console.warn('[exportPDF] data path failed, printing:', e && e.message); }
  }
  const title = document.getElementById('pageTitle')?.textContent || document.querySelector('.page.active .card-title')?.textContent || 'FinFlow Report';
  const orig = document.title;
  document.title = title + ' — FinFlow';
  window.print();
  document.title = orig;
}

// ════════════════════════════════════════════
// NAV GROUPS (collapsible)
// ════════════════════════════════════════════
window.toggleGroup = function(name) {
  var grp = document.getElementById('nav-group-' + name);
  var arr = document.getElementById('arr-' + name);
  var hdr = document.getElementById('grp-' + name);
  if (!grp) return;
  var isOpen = grp.classList.contains('open');
  if (!isOpen) {
    grp.classList.add('open');
    grp.style.height = '';
    if (arr) arr.classList.add('open');
    if (hdr) { hdr.classList.add('active'); hdr.setAttribute('aria-expanded', 'true'); }
    // Scroll sidebar to show the header of the opened group
    setTimeout(function(){
      var hdrEl = document.getElementById('grp-' + name);
      if (hdrEl) hdrEl.scrollIntoView({behavior:'smooth', block:'start'});
    }, 50);
  } else {
    grp.classList.remove('open');
    grp.style.height = '';
    if (arr) arr.classList.remove('open');
    if (hdr) { hdr.classList.remove('active'); hdr.setAttribute('aria-expanded', 'false'); }
  }
};

// ════════════════════════════════════════════
// ITEMS PAGE
// ════════════════════════════════════════════
const itemsData=[];
let itemsFilter='all';
// Honesty pass (F51/F65): the app-main renderItems / filterItems /
// filterItemsBySearch / openNewItemModal are DEAD — each is overridden at runtime by
// finflow-api-wiring-medium.js (window.renderItems, .filterItems,
// .filterItemsBySearch, .openNewItemModal), which loads after app-main.js in the
// bundle and provides real, DB-backed controls (openEditItemModal → PUT /api/items).
// The dead copies here toasted fake success ("Edit item: NAME", "New Item modal —
// add your products & services") and never rendered. Deleted so they cannot be
// re-exposed. Runtime winner is unchanged (Rule 1 confirmed).

// ════════════════════════════════════════════
// BANKING PAGE
// ════════════════════════════════════════════
const bankAccounts=[]; // populated from DB via loadBankingFromDB()
let bankTxns=[];

async function loadBankingFromDB(){
  try {
    const res = await fetch('/api/banking',{credentials:'include'});
    // F96 class: a non-ok response must NOT silently leave the Banking page empty, which reads as
    // a genuinely empty banking history (money surface). 401/403 = logged out (auth gate owns it);
    // anything else is a real failure — make it visible rather than fabricating emptiness.
    if(!res.ok){
      if(res.status === 401 || res.status === 403) return;
      console.error('[Banking] load failed (HTTP '+res.status+')');
      if(typeof notify === 'function') notify('Could not load banking — check your connection and retry', true);
      return;
    }
    const rows = await res.json();
    bankTxns = rows.map(r=>{
      // F23: read canonical tx_type/tx_date, falling back to legacy type/date rows.
      const _iso = (r.tx_date || r.date) || '';
      return {
        _dbId: r.id,
        _reconId: r.reconciliation_id != null ? r.reconciliation_id : null,   // B7b: cleared by a saved reconciliation → locked
        desc: r.description,
        amount: Math.abs(r.amount),
        type: (r.tx_type || r.type)==='credit'?'credit':'debit',
        _iso,   // raw YYYY-MM-DD for month filtering (display `date` below is localized)
        date: _iso ? (window.FinFlowDates ? window.FinFlowDates.fmtLabel(_iso) : _iso) : 'Today',   // F195: TZ-safe calendar date
        cat: r.category||'Other',
      };
    });
    // V2 (D7): the linked banks' accounts with the bank's own balance, and the books' cash to compare with. Either read
    // failing leaves "—" / no comparison — never a made-up 0.
    try {
      const pr = await fetch('/api/plaid/items',{credentials:'include'});
      const pj = pr.ok ? await pr.json() : null;
      bankAccounts.length = 0;
      ((pj && pj.items) || []).forEach(it => (it.accounts||[]).forEach(a => bankAccounts.push(Object.assign({ bank: it.institution_name }, a))));
    } catch(_e){ bankAccounts.length = 0; }
    // The books' cash (a full balance sheet on the server) is read only when the Banking page is actually OPEN —
    // renderBanking fetches it on demand. Reading it here ran that heavy computation at EVERY sign-in.
    window._bankBooksCash = undefined;
    if(typeof renderBanking==='function') renderBanking();
  } catch(e){
    // F96 class — NETWORK-failure path (fetch rejected). Same visibility as the !res.ok branch
    // above: a dropped connection must not read as an empty banking history.
    console.error('[Banking] load failed:', e && e.message);
    if(typeof notify === 'function') notify('Could not load banking — check your connection and retry', true);
  }
}

// LR11: returns true once the line is saved. `date` is the line's calendar date (YYYY-MM-DD, the business's own today by
// default); `idemKey` is the per-submit token (idx_personal_transactions_idem_key) — reused on a retry, so a retried or
// double-sent submit lands once. The line belongs to the business in view (server: M56 / M60); never Personal from here.
async function saveBankTxn(desc, amount, type, cat, date, idemKey){
  // F46: reject an unknown tx_type here instead of letting it fall through to 'debit' server-side
  // (which would silently book an inflow as an outflow). Only 'credit'/'debit' are valid.
  if(type != null && type !== 'credit' && type !== 'debit'){
    if(typeof notify==='function') notify("Transaction type must be 'credit' or 'debit'", true);
    return false;
  }
  try {
    const res = await fetch('/api/banking',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({desc, amount, type, cat, date:date||_entityToday(), idempotency_key:idemKey||undefined})});
    if(!res.ok){ const d=await res.json().catch(()=>({})); throw new Error(d.error||'Save failed'); }
    await loadBankingFromDB();
    window.finflow?.refresh(['banking','dashboard','reports']);
    return true;
  } catch(e){ if(typeof notify==='function') notify('Error saving transaction — '+(e.message||''), true); return false; }
}
// The books comparison is only worth a balance-sheet read when there is a bank balance in the business's currency.
function _bankAccountsReadyForCompare(v){ return v!=null; }
function renderBanking(){
  // KPI cards: Total Balance · Inflow (MTD) · Outflow (MTD) · Uncategorized
  const _bkSet = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  // V2 (D7, 2026-10-23): bankAccounts = the linked banks' accounts with the bank's OWN balance (loadBankingFromDB). Totals
  // are PER CURRENCY — two currencies are never added into one figure; the business's currency comes first. No account
  // reporting a balance → "—" (LR16), never a fabricated $0.
  const _cur = _activeEntityCurrency();
  const _symOf = c => { const t=(window.FinFlowCurrency&&window.FinFlowCurrency.CURRENCIES)||window.CURRENCIES||{}; return (t[c]&&t[c].symbol) || (c ? c+' ' : ''); };
  const _m2 = (n,c) => (n<0?'-':'')+_symOf(c)+Math.abs(+n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const _byCur = {};
  (bankAccounts||[]).forEach(a => { if(a && a.current!=null && a.currency){ _byCur[a.currency]=Math.round(((_byCur[a.currency]||0)+a.current)*100)/100; } });
  const _curs = Object.keys(_byCur).sort((x,y)=>(x===_cur?-1:y===_cur?1:x.localeCompare(y)));
  const _bkHasBal = _curs.length > 0;
  // F87: the MTD month key comes from the CALENDAR date (UTC via resolvedToday), not local
  // getMonth — so Inflow/Outflow (MTD) don't shift by the viewer's timezone. Row side is a
  // string prefix match on the row's own 'YYYY-MM-DD'.
  const _ym = _entityToday().slice(0,7);
  const _bkMtd = (bankTxns||[]).filter(t => (t._iso||'').startsWith(_ym));
  const _bkIn  = _bkMtd.filter(t => t.type==='credit').reduce((s,t)=>s+Math.abs(parseFloat(t.amount)||0),0);
  const _bkOut = _bkMtd.filter(t => t.type!=='credit').reduce((s,t)=>s+Math.abs(parseFloat(t.amount)||0),0);
  const _bkUncat = (bankTxns||[]).filter(t => !t.cat || /uncategor/i.test(t.cat)).length;
  _bkSet('bank-total-bal', _bkHasBal ? _curs.map(c=>_m2(_byCur[c],c)).join(' · ') : '—');
  _bkSet('bank-inflow',    S(_bkIn));
  _bkSet('bank-outflow',   S(_bkOut));
  _bkSet('bank-uncat',     _bkUncat);
  window._refreshDashboardUI?.();
  const al=document.getElementById('bank-accounts-list');
  const _asOf = v => { if(!v) return ''; const d=new Date(v); return isNaN(d) ? '' : 'as of '+d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };
  if(al)al.innerHTML=bankAccounts.map(a=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:36px;height:36px;border-radius:var(--radius);background:var(--acc-bg);border:1px solid var(--acc2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--acc)">🏦</div>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${esc(a.name)}</div><div style="font-size:11px;color:var(--t3)">${esc(a.bank||'Bank')}${a.mask?' · ****'+esc(a.mask):''}${a.subtype?' · '+esc(a.subtype):''}</div></div>
      </div>
      <div style="text-align:right"><div style="font-size:14px;font-weight:600;font-family:var(--font-mono);color:var(--t1)">${a.current!=null?_m2(a.current,a.currency):'—'}</div><div style="font-size:10px;color:var(--t3)">${a.available!=null&&a.available!==a.current?_m2(a.available,a.currency)+' available · ':''}${esc(_asOf(a.as_of))}</div></div>
    </div>`).join('');
  // V2: ONE honest comparison — the books hold a single cash account per business (bank lines do not record a per-account
  // ledger yet), so the bank total in the BUSINESS's currency is set against the cash in the books, with the difference and
  // the way to explain it (Bank Rec). Accounts in other currencies are named, never folded in.
  let cmp=document.getElementById('bank-books-compare');
  if(al && !cmp){ cmp=document.createElement('div'); cmp.id='bank-books-compare'; cmp.style.cssText='font-size:12px;color:var(--t2);padding:10px 0 2px;line-height:1.6'; al.parentNode.insertBefore(cmp, al.nextSibling); }
  if(cmp){
    // Books' cash on demand: only while the Banking page is showing, once per load (undefined = not read yet).
    const _bkOpen=!!(document.getElementById('page-banking')||{classList:{contains:()=>false}}).classList.contains('active');
    if(window._bankBooksCash===undefined && _bankAccountsReadyForCompare(_byCur[_cur]) && _bkOpen && !window._bankBooksCashLoading){
      window._bankBooksCashLoading=true;
      fetch('/api/reports/balance-sheet',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'})
        .then(r=>r.ok?r.json():null)
        .then(bj=>{ window._bankBooksCash = bj ? { tracked: bj.cashTracked === true && bj.cash != null, cash: parseFloat(bj.cash)||0 } : null; })
        .catch(()=>{ window._bankBooksCash = null; })
        .finally(()=>{ window._bankBooksCashLoading=false; if(typeof renderBanking==='function') renderBanking(); });
    }
    const bc=window._bankBooksCash||null, others=_curs.filter(c=>c!==_cur);
    let h='';
    if(_byCur[_cur]!=null){
      if(bc && bc.tracked){
        const diff=Math.round((_byCur[_cur]-bc.cash)*100)/100;
        h='Bank ('+esc(_cur)+'): <strong>'+_m2(_byCur[_cur],_cur)+'</strong> · Cash in your books: <strong>'+_m2(bc.cash,_cur)+'</strong> · Difference: <strong style="color:'+(Math.abs(diff)<0.005?'var(--green)':'var(--amber)')+'">'+_m2(diff,_cur)+'</strong>'
          +(Math.abs(diff)<0.005?' ✓':' — <a href="#" onclick="showPage(\'bank-rec\');return false">reconcile it in Bank Rec</a>');
      } else if(bc) h='Cash is not tracked in your books yet for this business, so there is no bank-vs-books difference to show.';
      else if(window._bankBooksCash===undefined) h='Bank ('+esc(_cur)+'): <strong>'+_m2(_byCur[_cur],_cur)+'</strong> · checking your books…';
    }
    if(others.length) h+=(h?'<br>':'')+'Accounts in '+others.map(esc).join(', ')+' are shown separately and not compared with your '+esc(_cur)+' books.';
    cmp.innerHTML=h;
  }
  const tl=document.getElementById('bank-txns-list');
  if(tl)tl.innerHTML=bankTxns.map(t=>`
    <div class="tx-row">
      <div class="tx-left">
        <div class="tx-icon" style="background:${t.type==='credit'?'var(--green-bg)':'var(--red-bg)'};color:${t.type==='credit'?'var(--green)':'var(--red)'}"><svg viewBox="0 0 16 16"><line x1="8" y1="3" x2="8" y2="13"/><polyline points="${t.type==='credit'?'4,9 8,13 12,9':'4,7 8,3 12,7'}"/></svg></div>
        <div><div class="tx-name">${esc(t.desc||'')}</div><div class="tx-cat">${esc(t.cat||'')} · ${esc(t.date||'')}</div></div>
      </div>
      <span class="tx-amt" style="color:${t.type==='credit'?'var(--green)':'var(--red)'}">${t.type==='credit'?'+':''}${S(t.amount)}</span>
    </div>`).join('');
}
// LR25 (decision 2026-10-21): "+ Add Account" was a toast-only stub. A business adds a bank in one of two real ways —
// link it, or import a statement from any bank — so the button offers exactly those (business scope, never Personal).
function openAddAccountModal(){
  let m=document.getElementById('bank-add-account-modal');
  if(!m){
    m=document.createElement('div');
    m.id='bank-add-account-modal';
    m.className='modal-overlay hidden';
    m.innerHTML=`<div class="modal" style="max-width:380px">
      <div class="modal-header">
        <div><div class="modal-title">Add a bank account</div><div class="modal-sub">For this business</div></div>
        <button class="modal-close" onclick="closeModal('bank-add-account-modal')"><svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary" onclick="closeModal('bank-add-account-modal');window.ffBankLinkFromPage&&window.ffBankLinkFromPage()">🔗 Link a bank</button>
        <div style="font-size:11.5px;color:var(--t3);margin:-4px 2px 4px">Connect securely so transactions sync automatically (where your bank is supported).</div>
        <button class="btn btn-ghost" onclick="closeModal('bank-add-account-modal');window.ffImportStatement&&window.ffImportStatement()">⬆ Import a statement</button>
        <div style="font-size:11.5px;color:var(--t3);margin:-4px 2px 0">Upload an OFX, QFX or CSV statement downloaded from any bank.</div>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  openModal('bank-add-account-modal');
}
// LR11: Banking "+ Add" — a manual bank line on the business in view (was a toast-only stub). Audited server-side
// (bank_lines); no ledger entry — like an imported line, it is booked when matched in Bank Rec.
function openAddTxnModal(){
  let m=document.getElementById('bank-add-modal');
  if(!m){
    m=document.createElement('div');
    m.id='bank-add-modal';
    m.className='modal-overlay hidden';
    m.innerHTML=`<div class="modal" style="max-width:400px">
      <div class="modal-header">
        <div><div class="modal-title">Add bank line</div><div class="modal-sub">A line from this business's bank statement</div></div>
        <button class="modal-close" onclick="closeModal('bank-add-modal')"><svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label" for="bank-add-date">Date *</label><input class="finput" id="bank-add-date" type="date"></div>
        <div class="field-wrap"><label class="field-label" for="bank-add-dir">Money</label>
          <select class="finput" id="bank-add-dir"><option value="out">Out (paid from the bank)</option><option value="in">In (paid into the bank)</option></select>
        </div>
      </div>
      <div class="field-wrap"><label class="field-label" for="bank-add-desc">Description *</label><input class="finput" id="bank-add-desc" maxlength="200" placeholder="As it reads on the statement"></div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label" for="bank-add-amount">Amount *</label><input class="finput" id="bank-add-amount" type="number" min="0.01" step="0.01" inputmode="decimal"></div>
        <div class="field-wrap"><label class="field-label" for="bank-add-cat">Category</label><input class="finput" id="bank-add-cat" maxlength="60" placeholder="Uncategorized"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('bank-add-modal')">Cancel</button>
        <button class="btn btn-primary" id="bank-add-save" onclick="submitBankLine(this)">Add line</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  document.getElementById('bank-add-date').value=_entityToday();
  document.getElementById('bank-add-dir').value='out';
  document.getElementById('bank-add-desc').value='';
  document.getElementById('bank-add-amount').value='';
  document.getElementById('bank-add-cat').value='';
  window._bankLineIdemKey=null;   // fresh submit-intent → a genuine new line never reuses the last token
  openModal('bank-add-modal');
}
async function submitBankLine(btn){
  return withSubmitGuard(btn, async ()=>{
    const date=document.getElementById('bank-add-date').value;
    const desc=document.getElementById('bank-add-desc').value.trim();
    const amount=parseFloat(document.getElementById('bank-add-amount').value);
    const type=document.getElementById('bank-add-dir').value==='in'?'credit':'debit';
    const cat=document.getElementById('bank-add-cat').value.trim()||'Uncategorized';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!desc){notify('Date and description are required',true);return;}
    if(!(Number.isFinite(amount)&&amount>0)){notify('Amount must be greater than 0',true);return;}
    // One token per submit-intent: kept on failure (an idempotent retry), cleared on success.
    window._bankLineIdemKey=window._bankLineIdemKey||(window.crypto?.randomUUID?window.crypto.randomUUID():'bank-'+Date.now()+'-'+Math.random().toString(36).slice(2));
    if(await saveBankTxn(desc, amount, type, cat, date, window._bankLineIdemKey)){
      window._bankLineIdemKey=null;
      closeModal('bank-add-modal');
      notify('Bank line added ✦');
    }
  });
}
window.submitBankLine=submitBankLine;

// ════════════════════════════════════════════
// QUOTES, RECEIPTS, PAYMENTS RECEIVED, RECURRING INVOICES, CREDIT NOTES
// → fully wired in finflow-api-wiring-stubs.js and finflow-api-wiring-final5.js
// ════════════════════════════════════════════

// ════════════════════════════════════════════
// VENDORS, BILLS, PAYMENTS MADE, RECURRING BILLS, VENDOR CREDITS
// → fully wired in finflow-api-wiring-stubs.js and finflow-api-wiring-final5.js
// ════════════════════════════════════════════
// ════════════════════════════════════════════
// PROJECTS PAGE
// ════════════════════════════════════════════
const projectsData=[]; // populated from API by finflow-api-wiring-extra.js
function renderProjects(){
  const l=document.getElementById('projects-list');if(!l)return;
  l.innerHTML=projectsData.map(p=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${esc(p.name)}</div><div style="font-size:11px;color:var(--t3)">${esc(p.client)} · ${p.hours}h logged</div></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="text-align:right"><div style="font-size:11px;color:var(--t3)">Billed / Budget</div><div style="font-size:12px;font-weight:600;font-family:var(--font-mono)">${_fmtMoneyNative(p.billed)} / ${_fmtMoneyNative(p.budget)}</div></div>
          <span class="badge ${p.status==='Completed'?'b-green':'b-blue'}">${p.status}</span>
        </div>
      </div>
      <div class="bar-track" style="height:4px"><div class="bar-fill" style="width:${p.progress}%;background:${p.status==='Completed'?'var(--green)':'var(--acc)'}"></div></div>
    </div>`).join('');
}
function openNewProjectModal(){notify('New project modal');}

// ════════════════════════════════════════════
// TIMESHEET PAGE
// ════════════════════════════════════════════
const timesheetData=[]; // populated from API by finflow-api-wiring-extra.js
function renderTimesheet(){
  const l=document.getElementById('timesheet-list');if(!l)return;
  l.innerHTML=timesheetData.map(t=>`
    <div class="table-row" style="grid-template-columns:1fr 100px 80px 70px 70px 70px">
      <span style="font-weight:500">${esc(t.employee)}</span>
      <span style="color:var(--t2)">${esc(t.project)}</span>
      <span style="color:var(--t3)">${esc(t.date)}</span>
      <span style="font-family:var(--font-mono)">${t.hours} hrs</span>
      <span style="font-family:var(--font-mono);color:${t.billable>0?'var(--green)':'var(--t3)'}">${t.billable} hrs</span>
      <span style="font-family:var(--font-mono)">$${t.rate}/hr</span>
    </div>`).join('');
}
function openLogTimeModal(){notify('Log time entry');}

// ════════════════════════════════════════════
// MANUAL JOURNALS PAGE
// ════════════════════════════════════════════
const journalsData=[]; // populated from API by renderJournalsLive()
function renderJournals(){
  const l=document.getElementById('journals-list');if(!l)return;
  l.innerHTML=journalsData.map(j=>`
    <div class="table-row" style="grid-template-columns:90px 1fr 80px 80px 80px 70px">
      <span style="color:var(--t3)">${esc(j.date||'')}</span>
      <span style="font-weight:500">${esc(j.notes||'')}</span>
      <span style="color:var(--t3)">${esc(j.ref||'')}</span>
      <span style="font-family:var(--font-mono);color:var(--red)">${_nativeSymbol()}${(j.debit||0).toLocaleString()}</span>
      <span style="font-family:var(--font-mono);color:var(--green)">${_nativeSymbol()}${(j.credit||0).toLocaleString()}</span>
      <span><span class="badge ${j.status==='Posted'?'b-green':'b-amber'}">${j.status}</span></span>
    </div>`).join('');
}
function openNewJournalModal(){openJournalEntryModal();}

// ════════════════════════════════════════════
// CHART OF ACCOUNTS PAGE — empty until user creates accounts
// (Data loaded from /api/chart-of-accounts if/when wired by extra scripts.)
// ════════════════════════════════════════════
const coaData=[]; // populated by API wiring; no hardcoded demo data
function renderCOA(){
  const l=document.getElementById('coa-list');if(!l)return;
  if(!coaData.length){
    l.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">No accounts yet. Click "+ New account" to add your chart of accounts.</div>';
    return;
  }
  l.innerHTML=coaData.map(section=>`
    <div style="margin-bottom:1rem">
      <div style="font-size:11px;font-weight:700;color:var(--acc);text-transform:uppercase;letter-spacing:.1em;padding:.5rem 0;border-bottom:1px solid var(--bd)">${section.type}</div>
      ${section.accounts.map(a=>`
        <div style="display:grid;grid-template-columns:60px 1fr 80px 70px;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="color:var(--t3);font-family:var(--font-mono)">${a.code}</span>
          <span style="color:var(--t1)">${esc(a.name)}</span>
          <span style="font-family:var(--font-mono);text-align:right;color:var(--t1)">$${(a.balance||0).toLocaleString()}</span>
          <span style="color:var(--t3);text-align:right">${a.nature}</span>
        </div>`).join('')}
    </div>`).join('');
}
function openNewAccountModal(){
  let m=document.getElementById('coa-new-modal');
  if(!m){
    m=document.createElement('div');
    m.id='coa-new-modal';
    m.className='modal-overlay hidden';
    m.innerHTML=`<div class="modal" style="max-width:380px">
      <div class="modal-header">
        <div><div class="modal-title">New account</div><div class="modal-sub">Add a chart-of-accounts entry</div></div>
        <button class="modal-close" onclick="document.getElementById('coa-new-modal').classList.add('hidden')"><svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Code *</label><input class="finput" id="coa-code" placeholder="e.g. 6950" maxlength="20"></div>
        <div class="field-wrap"><label class="field-label">Name *</label><input class="finput" id="coa-name" placeholder="e.g. Website costs" maxlength="200"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Category *</label>
          <select class="finput" id="coa-cat">
            <option value="Assets">Assets</option>
            <option value="Liabilities">Liabilities</option>
            <option value="Equity">Equity</option>
            <option value="Revenue">Revenue</option>
            <option value="Expenses">Expenses</option>
          </select>
        </div>
      </div>
      <div style="font-size:11.5px;color:var(--t3);line-height:1.5;margin:-2px 0 6px">The account starts at zero. To give it an opening balance, post a journal to it (Manual Journals) — so the figure is in your books, not just on this page.</div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('coa-new-modal').classList.add('hidden')">Cancel</button>
        <button class="btn btn-primary" onclick="saveNewAccount()">Add account</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  document.getElementById('coa-code').value='';
  document.getElementById('coa-name').value='';
  document.getElementById('coa-cat').value='Assets';
  window._coaIdemKey=null;   // C1 Wave 1b: fresh submit-intent → a genuine new account never reuses the last token
  m.classList.remove('hidden');
}
async function saveNewAccount(){
  if(window._savingAccount) return;   // C1 Wave 1b: in-flight re-entry lock
  const code=document.getElementById('coa-code').value.trim();
  const name=document.getElementById('coa-name').value.trim();
  const category=document.getElementById('coa-cat').value;
  if(!code||!name){notify('Code and name are required',true);return;}
  // One idempotency token per submit-intent (reused on retry, reset on modal-open + success).
  window._coaIdemKey=window._coaIdemKey||(window.crypto?.randomUUID?window.crypto.randomUUID():'coa-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  window._savingAccount=true;
  const _coaBtn=document.querySelector('#coa-new-modal .btn-primary');
  if(_coaBtn)_coaBtn.disabled=true;
  try{
    const r=await fetch('/api/chart-of-accounts',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name,category,idempotency_key:window._coaIdemKey})});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||'API error');}
    window._coaIdemKey=null;   // success → next account mints a fresh token
    document.getElementById('coa-new-modal').classList.add('hidden');
    notify('Account added ✦');
    window.finflow?.refresh(['journal','dashboard','reports','chart-of-accounts']);
    if(typeof renderCOA==='function')renderCOA();
  }catch(e){notify('Could not add account — '+e.message,true);}   // keep _coaIdemKey for idempotent retry
  finally{window._savingAccount=false;if(_coaBtn)_coaBtn.disabled=false;}
}

// ════════════════════════════════════════════
// TRANSACTION LOCKING PAGE
// ════════════════════════════════════════════
const lockHistory=[]; // lock history loaded from /api/lock-settings
async function renderLockHistory(){
  const l=document.getElementById('lock-history');if(!l)return;
  try {
    const res=await fetch('/api/lock-settings',{credentials:'include'});
    if(!res.ok){l.innerHTML='';return;}
    const s=await res.json();
    window._lockServerEnabled=!!(s.enabled&&s.lock_date);   // C10: what is saved now
    if(s.enabled&&s.lock_date){
      document.getElementById('lock-enabled').checked=true;
      document.getElementById('lock-date').value=s.lock_date;
      document.getElementById('lock-date-display').textContent=_fmtYmdLong(s.lock_date);   // Rule 10
    } else {
      // C10: an unlocked business shows unlocked (this used to keep whatever the page showed before — e.g. another business's lock)
      document.getElementById('lock-enabled').checked=false;
    }
    toggleLocking();
    // Show audit log entries related to lock
    const auditRes=await fetch('/api/audit-log?type=lock_settings&limit=10',{credentials:'include'});
    if(!auditRes.ok){l.innerHTML='';return;}
    const {rows}=await auditRes.json();
    l.innerHTML=rows.length?rows.map(h=>`
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
        <div><span style="font-weight:500;color:var(--t1)">${esc(h.action)}</span></div>
        <div style="text-align:right;color:var(--t3)">${new Date(h.created_at).toLocaleDateString()}</div>
      </div>`).join(''):'<div style="padding:1rem;color:var(--t3);font-size:13px">No lock history yet</div>';
  } catch(e){l.innerHTML='';}
}
// Rule 10: a lock date is a CALENDAR date — format the 'YYYY-MM-DD' string's own parts, never via a Date
// instant (new Date('2026-03-31') is UTC midnight ⇒ "March 30" for every viewer west of UTC).
function _fmtYmdLong(ymd){
  const y=(window.FinFlowDates && window.FinFlowDates._toYmd(ymd)) || '';
  const m=y.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m) return ymd || '';
  const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return MN[+m[2]-1]+' '+(+m[3])+', '+m[1];
}
window._fmtYmdLong=_fmtYmdLong;
function toggleLocking(){
  const enabled=document.getElementById('lock-enabled').checked;
  // C10: switching OFF a lock that is saved ON must leave a way to save it off. The Save button lived inside lock-config,
  // which this hid — so the lock could never be turned off. Off + saved-on → show "Turn off lock" (and the password
  // field, for a password-protected lock); off + saved-off → nothing to save.
  const turningOff=!enabled && !!window._lockServerEnabled;
  document.getElementById('lock-config').style.display=(enabled||turningOff)?'block':'none';
  const dw=document.getElementById('lock-date'); if(dw&&dw.closest('.field-wrap')) dw.closest('.field-wrap').style.display=enabled?'':'none';
  const btn=document.getElementById('lock-save-btn'); if(btn) btn.textContent=turningOff?'Turn off lock':'Save lock settings';
  document.getElementById('lock-status-display').style.display=enabled?'block':'none';
  if(enabled){
    const d=document.getElementById('lock-date').value||'2026-03-31';
    document.getElementById('lock-date-display').textContent=_fmtYmdLong(d);   // Rule 10
  }
}
async function saveLockSettings(){
  const d=document.getElementById('lock-date').value;
  const pw=document.getElementById('lock-password').value;
  const enabled=document.getElementById('lock-enabled').checked;
  try {
    const res=await fetch('/api/lock-settings',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({enabled,lock_date:d,password:pw||undefined})});
    // N19: show the server's refusal (e.g. a password-protected lock) instead of a false "saved".
    if(!res.ok){ const e=await res.json().catch(()=>({})); notify(e.error||'Failed to save lock settings', true); renderLockHistory(); return; }
    if(enabled&&d) document.getElementById('lock-date-display').textContent=_fmtYmdLong(d);   // Rule 10
    const pwEl=document.getElementById('lock-password'); if(pwEl) pwEl.value='';
    notify(enabled?'Lock settings saved ✦':'Lock settings saved — the lock is off ✦');
    renderLockHistory();
  } catch(e){ notify('Failed to save lock settings', true); }
}

// ════════════════════════════════════════════
// REPORTS PAGE
// ════════════════════════════════════════════
const reportsData=[
  {name:'Profit & Loss Statement',desc:'Income vs expenses for a period',icon:'📊'},
  {name:'Balance Sheet',desc:'Assets, liabilities and equity',icon:'⚖️'},
  {name:'Cash Flow Statement',desc:'Cash inflows and outflows',icon:'💰'},
  {name:'Accounts Receivable',desc:'Outstanding customer balances',icon:'📥'},
  {name:'Accounts Payable',desc:'Outstanding vendor balances',icon:'📤'},
  {name:'Sales by Customer',desc:'Revenue breakdown by client',icon:'👥'},
  {name:'Expense Report',desc:'Spending by category and vendor',icon:'🧾'},
  {name:'Payroll Summary',desc:'Staff costs and deductions',icon:'👔'},
  // LA10 (owner decision 2026-10-14): was "1099 / W-2 Summary" under Tax reports — US form names on a multi-region,
  // estimates-only product. It is each person's pay from payroll runs, so it is a payroll report.
  {name:'Payroll by person',desc:'Gross, deductions and net pay per person',icon:'🧾'},
  {name:'Bank Reconciliation',desc:'Saved statement reconciliations and the lines each cleared',icon:'🏦'},   // B7b
];
// LA9 (live audit 2026-10-13): no "VAT Return" tile — FinFlow has no VAT/GST engine by design (tax = estimates only),
// so it could only ever answer "not tracked". generateReport('VAT Return') still answers that honestly if called.
const taxReportsData=[
  {name:'Income Tax Estimate',desc:'Estimated quarterly taxes',icon:'📋'},
  {name:'Tax-Deductible Expenses',desc:'All deductible business costs',icon:'✅'},
];
async function renderReports(){
  const l=document.getElementById('reports-list');if(!l)return;
  // F128 hygiene (2026-08-23): report bodies are rendered by the window.generateReport winner
  // (finflow-api-wiring-extra.js), which sources canonical figures from the server and ignores any
  // numeric args — so this menu passes only the report NAME. The prior paid-only revenue/expenses
  // recompute here fed args the winner never read (inert, pre-F32 basis) and is removed. The
  // window.renderReports wrapper overwrites the metric cards with canonical figures after this paints.
  // Update stat cards
  const mc1=document.querySelector('#page-reports .mc-val');
  if(mc1)mc1.textContent=(reportsData.length+taxReportsData.length);
  l.innerHTML=reportsData.map(r=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">${r.icon}</span>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${esc(r.name)}</div><div style="font-size:11px;color:var(--t3)">${esc(r.desc)}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="generateReport('${esc(r.name)}')">Generate ↗</button>
    </div>`).join('');
  const t=document.getElementById('tax-reports-list');if(!t)return;
  t.innerHTML=taxReportsData.map(r=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">${r.icon}</span>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${esc(r.name)}</div><div style="font-size:11px;color:var(--t3)">${esc(r.desc)}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="generateReport('${esc(r.name)}')">Generate ↗</button>
    </div>`).join('');
}

// F137 / Failure #1 (F75): the `generateReport` that lived here was a DEAD SHADOW. It handled only
// P&L / Balance Sheet / Cash Flow and "not yet available" for the rest, and was overwritten at runtime
// by `window.generateReport` in finflow-api-wiring-extra.js (the bundle loads AFTER app-main.js), so
// this copy never ran. Now that the winner renders all 12 reports (F137-a…m, rich + print), this dead
// copy is deleted so only the one runtime winner remains. Do not reintroduce a generateReport here.

// ════════════════════════════════════════════
// DOCUMENTS PAGE
// ════════════════════════════════════════════
const documentsData=[]; // not used — renderDocuments() fetches from /api/documents
let docsFilter='all';
let _docsCache=[];
// LR13: a document's size is stored in BYTES — one formatter for the list and the Storage card.
function _fmtBytes(n){ n=parseFloat(n); if(!Number.isFinite(n)||n<0) return ''; if(n<1024) return Math.round(n)+' B'; if(n<1048576) return (Math.round(n/102.4)/10).toString().replace(/\.0$/,'')+' KB'; return (Math.round(n/104857.6)/10).toString().replace(/\.0$/,'')+' MB'; }
window._fmtBytes=_fmtBytes;
async function renderDocuments(){
  const l=document.getElementById('documents-list');if(!l)return;
  l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Loading…</div>';
  try{
    const res=await fetch('/api/documents',{credentials:'include'});
    if(!res.ok)throw new Error();
    _docsCache=await res.json();
  }catch(e){_docsCache=[];}
  window._docsCache=_docsCache;   // LR13: the cards (finflow-api-wiring-medium.js) read window._docsCache — a script `let` is not on window
  const filtered=docsFilter==='all'?_docsCache:_docsCache.filter(d=>d.type===docsFilter);
  if(!filtered.length){l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">No documents yet. Click Upload to add your first file.</div>';return;}
  l.innerHTML=filtered.map(d=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:var(--radius);background:var(--acc-bg);border:1px solid var(--acc2);display:flex;align-items:center;justify-content:center;font-size:14px">${(d.name||'').endsWith('.pdf')?'📄':'📊'}</div>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${esc(d.name||'')}</div><div style="font-size:11px;color:var(--t3)">${esc(_fmtBytes(d.size))} · ${d.uploaded_at?d.uploaded_at.slice(0,10):''} · ${d.type||''}</div></div>
      </div>
      <div style="display:flex;gap:6px">
        <span class="badge b-blue">${d.type||'file'}</span>
        <button class="btn btn-ghost btn-sm" onclick="downloadDoc(${d.id})" title="Download">↓</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteDoc(${d.id})" title="Delete">✕</button>
      </div>
    </div>`).join('');
}
function filterDocs(f){docsFilter=f;renderDocuments();}
async function downloadDoc(id){window.open('/api/documents/'+id+'/download','_blank');}
async function deleteDoc(id){
  if(!(await window._confirmModal('Delete this document?', {danger:true})))return;
  const res=await fetch('/api/documents/'+id,{method:'DELETE',credentials:'include'});
  if(res.ok){ renderDocuments(); window.finflow?.refresh(['documents','dashboard']); }else notify('Delete failed');
}
function openUploadModal(){
  let m=document.getElementById('doc-upload-modal');
  if(!m){
    m=document.createElement('div');
    m.id='doc-upload-modal';
    m.className='modal-overlay';
    m.innerHTML=`<div class="modal" style="width:420px">
      <div class="modal-header"><span class="modal-title">Upload Document</span><button class="modal-close" onclick="closeModal('doc-upload-modal')">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div><label class="field-label">File (max 5 MB)</label><input type="file" id="doc-file-input" class="finput" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.docx,.txt"></div>
        <div><label class="field-label">Document type</label>
          <select id="doc-type-input" class="finput"><option>invoice</option><option>receipt</option><option>contract</option><option>quote</option><option>report</option><option>other</option></select></div>
        <div><label class="field-label">Notes (optional)</label><input id="doc-notes-input" class="finput" placeholder="e.g. Linked to INV-0042"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('doc-upload-modal')">Cancel</button><button class="btn btn-primary" onclick="uploadDocument()">Upload</button></div>
    </div>`;
    document.body.appendChild(m);
  }
  const fi=document.getElementById('doc-file-input');if(fi)fi.value='';
  const ni=document.getElementById('doc-notes-input');if(ni)ni.value='';
  m.style.display='flex';
}
async function uploadDocument(){
  const fileInput=document.getElementById('doc-file-input');
  if(!fileInput||!fileInput.files.length){notify('Please select a file');return;}
  const file=fileInput.files[0];
  if(file.size>5*1024*1024){notify('File must be under 5 MB');return;}
  const reader=new FileReader();
  reader.onload=async function(e){
    const b64=e.target.result.split(',')[1];
    try{
      const res=await fetch('/api/documents',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:file.name,type:document.getElementById('doc-type-input').value,
          size:Math.round(file.size/1024)+' KB',notes:document.getElementById('doc-notes-input').value,
          file_data:b64,media_type:file.type})});
      if(!res.ok){const d=await res.json();notify(d.error||'Upload failed');return;}
      closeModal('doc-upload-modal');renderDocuments();window.finflow?.refresh(['documents','dashboard']);notify('Document uploaded ✦');
    }catch(e){notify('Upload failed');}
  };
  reader.readAsDataURL(file);
}

// ════════════════════════════════════════════
// ════════════════════════════════════════════
// TEMPLATES PAGE
// ════════════════════════════════════════════
// FA-B1 part 2: the designs the document renderer (finflow-docview.js) REALLY draws — every invoice, quote, bill, receipt
// and credit note uses the one this business picks. They used to be preview-only styles with sample data.
const invTemplatesData=[
  {id:'classic',name:'Classic',type:'All documents',preview:'Serif title, dark table header'},
  {id:'minimal',name:'Modern minimal',type:'All documents',preview:'Colour header band, clean lines'},
  {id:'compact',name:'Compact',type:'All documents',preview:'Narrow receipt-style page'},
];
// ── FA-B1: AUTOMATIC EMAILS (Templates page + the Settings overdue alert) ─────────────────────────────────────────────
// What FinFlow REALLY sends, per business (server: auto-emails.js + the hourly job). Off until turned on. The editor saves
// to the business and "Send test" mails the owner a sample — no "coming soon".
const _AE_LABELS = { reminder: ['Payment reminder', 'days after the due date'], overdue: ['Overdue notice', 'days overdue'],
  receipt: ['Payment receipt', 'when a payment is recorded'], statement: ['Monthly statement', 'on the 1st of each month'] };
window._ffAutoEmails = null;
async function _ffLoadAutoEmails(){
  try { const r = await fetch('/api/auto-emails', { credentials: 'include' }); window._ffAutoEmails = r.ok ? await r.json() : null; }
  catch(_) { window._ffAutoEmails = null; }
  return window._ffAutoEmails;
}
async function _ffSaveAutoEmails(body){
  const r = await fetch('/api/auto-emails', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { notify(j.error || 'Could not save', true); return null; }
  window._ffAutoEmails = Object.assign({}, window._ffAutoEmails || {}, j);
  return j;
}
window._ffRenderAutoEmails = async function(){
  const el = document.getElementById('email-templates-list'); if (!el) return;
  const d = window._ffAutoEmails || await _ffLoadAutoEmails();
  if (!d) { el.innerHTML = '<div style="padding:9px 0;font-size:12px;color:var(--t3)">Choose a business to set up its automatic emails.</div>'; return; }
  const s = d.settings || {};
  el.innerHTML = (d.email_configured ? '' : '<div style="padding:8px 0;font-size:11.5px;color:var(--amber)">Email sending is not set up on this server yet — these will send once it is.</div>')
    + Object.keys(_AE_LABELS).map(k => {
      const [name, when] = _AE_LABELS[k], st = s[k] || {}, dayKey = k === 'reminder' ? 'days_after_due' : k === 'overdue' ? 'days_overdue' : null;
      return '<div style="padding:9px 0;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:8px">'
        + '<div style="min-width:0"><div style="font-size:13px;font-weight:500;color:var(--t1)">' + esc(name) + '</div><div style="font-size:11px;color:var(--t3)">'
        + (st.on ? 'On' : 'Off') + ' · ' + (dayKey ? '<input class="finput" type="number" min="1" max="90" step="1" value="' + Number(st[dayKey] || 0) + '" aria-label="' + esc(name) + ' — days" style="width:58px;padding:2px 6px;font-size:11px;display:inline-block" onchange="_ffSetAutoEmail(\'' + k + '\', null, this.value)"> ' : '') + esc(when) + '</div></div>'
        + '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0">'
        + '<label class="toggle" title="' + (st.on ? 'Turn off' : 'Turn on') + '"><input type="checkbox" data-ae="' + k + '"' + (st.on ? ' checked' : '') + ' onchange="_ffSetAutoEmail(\'' + k + '\', this.checked)" aria-label="' + esc(name) + ' on or off"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>'
        + '<button class="btn btn-ghost btn-sm" onclick="openEmailTemplateEditor(\'' + k + '\')">Edit</button></div></div>';
    }).join('');
};
window._ffSetAutoEmail = async function(kind, on, days){
  const cur = ((window._ffAutoEmails || {}).settings || {})[kind] || {};
  const next = Object.assign({}, cur);
  if (on != null) next.on = !!on;
  if (days != null) next[kind === 'reminder' ? 'days_after_due' : 'days_overdue'] = parseInt(days, 10);
  const ok = await _ffSaveAutoEmails({ settings: { [kind]: next } });
  if (ok) notify((_AE_LABELS[kind] ? _AE_LABELS[kind][0] : 'Email') + (next.on ? ' is on' : ' is off'));
  window._ffRenderAutoEmails();
};
// the Settings switch: email ME when an invoice goes overdue (this business)
window._ffSetOwnerAlert = async function(on){ await _ffSaveAutoEmails({ settings: { owner_alert: { on: !!on } } }); notify(on ? 'You will get an email when an invoice goes overdue' : 'Overdue emails to you are off'); };
window._ffSyncOwnerAlert = async function(){ const d = await _ffLoadAutoEmails(); /* always this business */ const cb = document.getElementById('s-email-alerts'); if (cb && d && d.settings) cb.checked = !!(d.settings.owner_alert || {}).on; };

window.openEmailTemplateEditor = async function(kind){
  const d = window._ffAutoEmails || await _ffLoadAutoEmails(); if (!d || !d.templates || !d.templates[kind]) return;
  const t = d.templates[kind], name = (_AE_LABELS[kind] || [kind])[0];
  const existing = document.getElementById('email-tmpl-editor'); if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'email-tmpl-editor';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)';
  const chips = (d.allowed[kind] || []).map(p => '<code title="' + esc((d.placeholders || {})[p] || '') + '" style="font-size:11px;background:var(--bg2);padding:1px 5px;border-radius:4px">{{' + p + '}}</code>').join(' ');
  overlay.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Edit ' + esc(name) + '" style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-xl);width:100%;max-width:560px;box-shadow:var(--shadow-lg);overflow:hidden">'
    + '<div style="padding:.85rem 1.25rem;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between"><div style="font-size:14px;font-weight:500;color:var(--t1)">Edit — ' + esc(name) + '</div>'
    + '<button onclick="document.getElementById(\'email-tmpl-editor\').remove()" class="btn btn-ghost btn-sm">✕ Close</button></div>'
    + '<div style="padding:1.25rem;display:flex;flex-direction:column;gap:1rem">'
    + '<div class="field-wrap"><label class="field-label" for="ae-subject">Subject line</label><input class="finput" id="ae-subject" maxlength="200" value="' + esc(t.subject) + '"></div>'
    + '<div class="field-wrap"><label class="field-label" for="ae-body">Message</label><textarea class="finput" id="ae-body" rows="8" maxlength="5000" style="resize:vertical;line-height:1.6">' + esc(t.body) + '</textarea></div>'
    + '<div style="font-size:11px;color:var(--t3);line-height:1.8">This email can fill: ' + chips + '</div>'
    + '<div style="display:flex;gap:8px"><button class="btn btn-primary" style="flex:1;justify-content:center" onclick="_ffSaveEmailTemplate(\'' + kind + '\')">Save</button>'
    + '<button class="btn btn-ghost" onclick="_ffTestEmailTemplate(\'' + kind + '\')">Send a test to me</button></div></div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};
const _aeForm = () => ({ subject: (document.getElementById('ae-subject') || {}).value || '', body: (document.getElementById('ae-body') || {}).value || '' });
window._ffSaveEmailTemplate = async function(kind){
  const ok = await _ffSaveAutoEmails({ templates: { [kind]: _aeForm() } });
  if (ok) { notify('Saved ✦'); const o = document.getElementById('email-tmpl-editor'); if (o) o.remove(); }
};
window._ffTestEmailTemplate = async function(kind){
  const r = await fetch('/api/auto-emails/test', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, template: _aeForm() }) });
  const j = await r.json().catch(() => ({}));
  notify(r.ok ? 'Test sent to ' + j.to : (j.error || 'Could not send the test'), !r.ok);
};

// Per-template settings (logo, color, poweredBy)
const templateSettings = {};

function getTemplateSetting(id, key, fallback){
  return (templateSettings[id]||{})[key] ?? fallback;
}
function setTemplateSetting(id, key, value){
  if(!templateSettings[id]) templateSettings[id]={};
  templateSettings[id][key]=value;
}

function renderTemplates(){
  const il=document.getElementById('inv-templates-list');
  const _ds = window.FinFlowDocStyle ? window.FinFlowDocStyle(((window.ENTITIES||[]).find(e=>e&&e.active)||{}).doc_style) : { template:'classic' };
  if(il)il.innerHTML=invTemplatesData.map(t=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:500;color:var(--t1)">${esc(t.name)} ${t.id===_ds.template?'<span class="badge b-green" style="font-size:9px">In use</span>':''}</div>
          <div style="font-size:11px;color:var(--t3)">${esc(t.preview)}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" onclick="openTemplatePreview('${t.id}')">Preview</button>
          ${t.id===_ds.template ? '<button class="btn btn-primary btn-sm" onclick="openTemplateEditor(\''+t.id+'\')">Customise</button>' : '<button class="btn btn-ghost btn-sm" onclick="useDocDesign(\''+t.id+'\')">Use this design</button>'}
        </div>
      </div>
    </div>`).join('');
  window._ffAutoEmails = null;   // FA-B1: re-read for the business in view
  if(typeof window._ffRenderAutoEmails==='function') window._ffRenderAutoEmails();
}

// ── INVOICE HTML RENDERER ─────────────────────────────────────────
// FA-B1 part 2: a sample document drawn by the REAL renderer — what a customer receives, in this business's style.
function _ffSampleDoc(kind){
  const today = (typeof _entityToday==='function') ? _entityToday() : new Date().toISOString().slice(0,10);
  const t = (typeof _bizPaymentTerms==='function') ? _bizPaymentTerms() : 30;
  const p = today.split('-').map(Number), due = new Date(Date.UTC(p[0], p[1]-1, p[2]+t)).toISOString().slice(0,10);
  return { number: kind==='quote' ? 'QT-0042' : 'INV-0042', party: 'Sample Customer Ltd', issue_date: today, due_date: kind==='quote' ? null : due,
    status: 'pending', line_items: [{desc:'Consulting',qty:10,rate:150},{desc:'Website design',qty:1,rate:2400}], notes: 'Thank you for your business.' };
}
// Kept for callers that preview by template id: now the real renderer with a sample document (no made-up tax line).
function buildInvoiceHTML(templateId, logoDataURL, settings){
  const map = { classic:'classic', minimal:'minimal', compact:'compact', receipt:'compact', retainer:'classic' };
  const kind = templateId==='retainer' ? 'quote' : 'invoice';
  settings = settings || {};
  const style = { template: map[templateId] || 'classic' };
  if (settings.accentColor) style.accent = settings.accentColor;
  if (settings.poweredBy != null) style.powered_by = settings.poweredBy !== false;
  return window.buildDocumentHTML ? window.buildDocumentHTML(_ffSampleDoc(kind), kind, style) : '';
}
window.buildInvoiceHTML = buildInvoiceHTML;

function _ffDocOverlay(title, inner){
  const old = document.getElementById('tmpl-preview-overlay'); if (old) old.remove();
  const o = document.createElement('div'); o.id = 'tmpl-preview-overlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px';
  o.innerHTML = '<div role="dialog" aria-modal="true" aria-label="'+esc(title)+'" style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-xl);width:100%;max-width:820px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">'
    + '<div style="padding:.85rem 1.25rem;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between"><div style="font-size:14px;font-weight:500;color:var(--t1)">'+esc(title)+'</div>'
    + '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'tmpl-preview-overlay\').remove()">✕ Close</button></div>' + inner + '</div>';
  document.body.appendChild(o);
  o.addEventListener('click', e => { if (e.target === o) o.remove(); });
  return o;
}
window.openTemplatePreview = function(id){
  const t = invTemplatesData.find(x=>x.id===id) || invTemplatesData[0];
  const o = _ffDocOverlay('Preview — ' + t.name, '<iframe id="tmpl-preview-frame" title="Document preview" style="flex:1;min-height:70vh;border:0;background:#e8e8e8"></iframe>');
  const f = o.querySelector('iframe'); if (f) f.srcdoc = window.buildDocumentHTML(_ffSampleDoc('invoice'), 'invoice', { template: id });
};
async function _ffSaveDocStyle(patch){
  const ent = (window.ENTITIES||[]).find(e=>e&&e.active); if (!ent || ent._dbId == null) { notify('Choose a business first', true); return false; }
  try {
    const r = await fetch('/api/entities/' + ent._dbId, { method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) { notify(j.error || 'Could not save', true); return false; }
    if (patch.doc_style) ent.doc_style = Object.assign({}, ent.doc_style || {}, patch.doc_style);
    if ('logo' in patch) { ent.profile = Object.assign({}, ent.profile || {}, { logo: patch.logo }); }
    return true;
  } catch(_) { notify('Could not save — check your connection', true); return false; }
}
window.useDocDesign = async function(id){
  if (await _ffSaveDocStyle({ doc_style: { template: id } })) { notify((invTemplatesData.find(x=>x.id===id)||{}).name + ' is now used for your documents ✦'); renderTemplates(); }
};
// The editor: accent colour, the FinFlow footer line, and the business logo — a live preview, then Save (to the business).
window.openTemplateEditor = function(id){
  const ent = (window.ENTITIES||[]).find(e=>e&&e.active) || {};
  const cur = window.FinFlowDocStyle ? window.FinFlowDocStyle(ent.doc_style) : { template:'classic', accent:'#c9a84c', poweredBy:true };
  window._ffDocDraft = { template: invTemplatesData.some(x=>x.id===id) ? id : cur.template, accent: cur.accent, powered_by: cur.poweredBy };
  const sw = ['#c9a84c','#1f6feb','#1a7f4b','#c0392b','#6f42c1','#222222'].map(c=>'<button type="button" aria-label="Colour '+c+'" onclick="setTemplateColor(\''+c+'\')" style="width:26px;height:26px;border-radius:6px;border:2px solid transparent;background:'+c+';cursor:pointer"></button>').join('');
  const inner = '<div style="display:grid;grid-template-columns:260px 1fr;flex:1;min-height:0">'
    + '<div style="padding:1rem 1.25rem;border-right:1px solid var(--bd);display:flex;flex-direction:column;gap:14px;overflow:auto">'
    + '<div><div class="field-label">Accent colour</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">'+sw+'</div><input class="finput" id="tmpl-accent" value="'+esc(cur.accent)+'" aria-label="Accent colour, hex" oninput="setTemplateColor(this.value)"></div>'
    + '<label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--t2)"><input type="checkbox" id="tmpl-poweredby"'+(cur.poweredBy?' checked':'')+' onchange="setTemplatePoweredBy(this.checked)"> Show "Powered by FinFlow"</label>'
    + '<div><div class="field-label">Logo (your business logo, on every document)</div><input type="file" id="tmpl-logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="finput" onchange="handleLogoUpload(this)"><button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="removeLogo()">Remove logo</button></div>'
    + '<button class="btn btn-primary" style="justify-content:center" onclick="saveTemplateSettings()">Save</button>'
    + '</div><iframe id="tmpl-edit-preview" title="Live preview" style="width:100%;min-height:70vh;border:0;background:#e8e8e8"></iframe></div>';
  _ffDocOverlay('Customise — ' + ((invTemplatesData.find(x=>x.id===window._ffDocDraft.template)||{}).name || 'Design'), inner);
  refreshEditorPreview();
};
function refreshEditorPreview(){
  const f = document.getElementById('tmpl-edit-preview'); if (!f || !window._ffDocDraft) return;
  f.srcdoc = window.buildDocumentHTML(_ffSampleDoc('invoice'), 'invoice', window._ffDocDraft);
}
window.setTemplateColor = function(color){
  if(!/^#[0-9a-fA-F]{6}$/.test(String(color))) return;
  window._ffDocDraft = Object.assign({}, window._ffDocDraft || {}, { accent: color });
  const hex = document.getElementById('tmpl-accent'); if (hex && hex.value !== color) hex.value = color;
  refreshEditorPreview();
};
window.setTemplatePoweredBy = function(checked){ window._ffDocDraft = Object.assign({}, window._ffDocDraft || {}, { powered_by: !!checked }); refreshEditorPreview(); };
window.handleLogoUpload = function(input){
  const file = input && input.files && input.files[0]; if(!file) return;
  if(file.size > 2*1024*1024){ notify('Logo must be under 2 MB', true); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const dataURL = e.target.result;
    if(!dataURL || !String(dataURL).startsWith('data:image/')) { notify('That is not an image file', true); return; }
    if (await _ffSaveDocStyle({ logo: dataURL })) { notify('Logo saved — it is on every document ✦'); refreshEditorPreview(); }
  };
  reader.readAsDataURL(file);
};
window.removeLogo = async function(){ if (await _ffSaveDocStyle({ logo: null })) { notify('Logo removed'); refreshEditorPreview(); } };
window.saveTemplateSettings = async function(){
  const d = window._ffDocDraft || {};
  if (await _ffSaveDocStyle({ doc_style: { template: d.template, accent: d.accent, powered_by: d.powered_by !== false } })) {
    notify('Saved — your invoices, quotes and other documents use it ✦');
    const o = document.getElementById('tmpl-preview-overlay'); if (o) o.remove();
    renderTemplates();
  }
};

// FA-B1: the old email editor (Save / Send test said "coming soon") is replaced by the one above.


// ════════════════════════════════════════════
// CLOSE MODALS ON OVERLAY CLICK
// ════════════════════════════════════════════
document.querySelectorAll('.modal-overlay').forEach(el=>{
  el.addEventListener('click',function(e){if(e.target===this)this.classList.add('hidden')});
});

// ── Global ESC closes open modal overlays and AI panel ──────────
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  // Close any open modal overlay
  const openOverlay = document.querySelector('.modal-overlay:not(.hidden)');
  if(openOverlay){ openOverlay.classList.add('hidden'); if(_modalFocusCleanup){_modalFocusCleanup();_modalFocusCleanup=null;} return; }
  // Close AI panel
  const aiPanel = document.getElementById('ai-panel');
  if(aiPanel && aiPanel.classList.contains('open')){ aiPanel.classList.remove('open'); return; }
});

// ════════════════════════════════════════════
// RIVER / SANKEY DIAGRAM — HERO ELEMENT
// ════════════════════════════════════════════
function buildRiver(d){
  const wrap=document.getElementById('river-wrap');
  if(!wrap)return;
  if(wrap.offsetWidth===0||wrap.offsetParent===null)return;
  // M37 (money audit 2026-10-09): the river is NOT a third profit figure. Its totals are the dashboard's own
  // server books for the same period (revenue · COGS + operating expenses · net profit) — it used the monthly
  // arrays alone, with no COGS and (pre-M10) no payroll. Category ribbons keep their split; "Other" carries the
  // rest (payroll runs, COGS, bills), so the ribbons always sum to the costs shown.
  const _sb = window._serverBooks;
  if (d && _sb && _sb.period === ((typeof currentPeriod!=='undefined')?currentPeriod:'year') && (_sb.monthIdx == null || _sb.monthIdx === _periodIntentIdx(_sb.period))) {
    d = Object.assign({}, d, { rev: _sb.revenue, exp: (_sb.cogs||0) + (_sb.expenses||0), profit: _sb.netProfit });
  }
  // Guard: skip render if any required input is NaN/undefined/non-finite.
  // Otherwise SVG path math produces NaN coords which Chrome logs as
  // "<path> attribute d: Expected number, ..." spam in the console.
  const _num = v => (typeof v === 'number' && isFinite(v));
  if (!d || ![d.rev,d.exp,d.profit,d.sal,d.rent,d.sw,d.mkt].every(_num)) {
    wrap.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12.5px">No cash flow data yet — add invoices and expenses to see the river chart.</div>';
    return;
  }
  const dark=darkMode;
  const W=wrap.clientWidth||wrap.getBoundingClientRect().width||560,H=200;
  const rev=d.rev||0, exp=d.exp||0, profit=d.profit||0;
  const sal=d.sal||0, rent=d.rent||0, sw=d.sw||0, mkt=d.mkt||0;
  // If revenue is zero, ratio math below would divide by zero → NaN. Skip.
  if (rev <= 0 || exp <= 0) {
    wrap.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12.5px">Add revenue and expenses to see the cash-flow river.</div>';
    return;
  }
  const other=Math.max(0, exp-sal-rent-sw-mkt);

  // Color palette
  const C={
    rev:'#c9a84c', revLight:'rgba(201,168,76,0.18)',
    profit:'#7db87d', profitLight:'rgba(125,184,125,0.18)',
    exp:'#c46a5a', expLight:'rgba(196,106,90,0.12)',
    sal:'rgba(196,106,90,0.7)',
    rent:'rgba(196,106,90,0.55)',
    sw:'rgba(158,143,191,0.7)',
    mkt:'rgba(90,170,158,0.7)',
    other:'rgba(212,150,74,0.6)',
    text:dark?'#9e8e73':'#6b5c42',
    textBright:dark?'#f2e8d5':'#1e1810',
    bg:dark?'rgba(22,18,13,0)':'rgba(255,252,245,0)',
  };

  // Layout: 4 columns — SOURCE | MID | SPLIT | DESTINATIONS
  const col=[60, W*0.32, W*0.58, W-60];
  const maxH=H-40; // usable height
  const totalH=maxH;

  // Heights proportional to values — clamp to 0 to prevent negative SVG rect heights
  const revH=Math.min(totalH*0.9, totalH);
  const profitH=Math.max(0, Math.round(revH*(profit/rev)));
  const expH=Math.max(0, revH-profitH);

  // Expense breakdown heights — clamp each to prevent negative values
  const salH=Math.max(0, Math.round(expH*(sal/exp)));
  const rentH=Math.max(0, Math.round(expH*(rent/exp)));
  const swH=Math.max(0, Math.round(expH*(sw/exp)));
  const mktH=Math.max(0, Math.round(expH*(mkt/exp)));
  const otherH=Math.max(2, expH-salH-rentH-swH-mktH);

  // Vertical centers
  const revY=H/2;
  const profitY=H/2 - expH/2 - profitH/2 + profitH/2; // top portion
  const expY=H/2 + profitH/2 + expH/2 - expH/2;       // bottom portion

  // Better layout: revenue centered, profit top, expenses bottom
  const revTop=revY-revH/2;
  const profTop=revTop;
  const expTop=revTop+profitH;

  // Destination nodes
  const dests=[
    {label:'Salaries',  val:sal,  h:salH,  color:C.sal},
    {label:'Rent',      val:rent, h:rentH, color:C.rent},
    {label:'Software',  val:sw,   h:swH,   color:C.sw},
    {label:'Marketing', val:mkt,  h:mktH,  color:C.mkt},
    {label:'Other',     val:other,h:otherH,color:C.other},
  ];
  // Stack destinations
  let destY=expTop+profitH-expH; // start from expTop aligned
  // Actually recalc: profit block + expense block stacked from center
  const blockTop=(H-revH)/2;
  const profitBlock={top:blockTop, h:profitH};
  const expBlock={top:blockTop+profitH, h:expH};
  let stackY=expBlock.top;
  dests.forEach(d=>{d.top=stackY;stackY+=d.h;});

  function cubicPath(x1,y1,x2,y2,h1,h2,color,opacity=0.7){
    const mx=(x1+x2)/2;
    const top1=y1, bot1=y1+h1, top2=y2, bot2=y2+h2;
    return `<path d="M${x1},${top1} C${mx},${top1} ${mx},${top2} ${x2},${top2} L${x2},${bot2} C${mx},${bot2} ${mx},${bot1} ${x1},${bot1} Z"
      fill="${color}" opacity="${opacity}" class="river-flow"/>`;
  }

  // Build SVG
  let svg=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
  <defs>
    <style>@keyframes ff-ptcl{0%,5%{opacity:0;offset-distance:0%}15%,80%{opacity:.7}95%,100%{opacity:0;offset-distance:100%}}</style>
    <linearGradient id="rg-rev" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.rev}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${C.rev}" stop-opacity="0.5"/>
    </linearGradient>
    <linearGradient id="rg-profit" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.profit}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${C.profit}" stop-opacity="0.85"/>
    </linearGradient>`;

  dests.forEach((d,i)=>{
    svg+=`<linearGradient id="rg-d${i}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${d.color}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${d.color}" stop-opacity="0.85"/>
    </linearGradient>`;
  });

  svg+=`</defs>`;

  // Revenue node (col 0)
  svg+=`<rect x="${col[0]-14}" y="${profitBlock.top}" width="14" height="${Math.max(0,revH)}" rx="3" fill="${C.rev}" opacity="0.9"/>`;

  // Revenue → mid split (col1): full block
  svg+=cubicPath(col[0],profitBlock.top,col[1],profitBlock.top,revH,revH,'url(#rg-rev)',0.35);

  // Mid split → profit (top) and expenses (bottom)
  // Profit flow
  svg+=cubicPath(col[1],profitBlock.top,col[2],profitBlock.top,profitH,profitH,'url(#rg-profit)',0.55);
  // Expense flow
  svg+=cubicPath(col[1],profitBlock.top+profitH,col[2],expBlock.top,expH,expH,`${C.exp}`,0.22);

  // Profit node at col2
  svg+=`<rect x="${col[2]}" y="${profitBlock.top}" width="12" height="${Math.max(0,profitH)}" rx="3" fill="${C.profit}" opacity="0.85"/>`;

  // Profit → label
  const _lx1=col[2]+12, _lx2=col[3]-4, _ly=profitBlock.top+profitH/2;
  svg+=`<line x1="${_lx1}" y1="${_ly}" x2="${_lx2}" y2="${_ly}" stroke="${C.profit}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.5"/>`;

  // Expense breakdown flows col2 → col3
  dests.forEach((dest,i)=>{
    const srcTop=expBlock.top + dests.slice(0,i).reduce((a,x)=>a+x.h,0);
    svg+=cubicPath(col[2],srcTop,col[3]-12,dest.top,dest.h,dest.h,`url(#rg-d${i})`,0.6);
    // Destination node bar
    svg+=`<rect x="${col[3]-12}" y="${dest.top}" width="10" height="${Math.max(dest.h,2)}" rx="2" fill="${dest.color}" opacity="0.9"/>`;
  });

  // Animated flow particles — subtle dots traveling along flows
  // Revenue particle
  const revMidY=profitBlock.top+revH/2;
  const profMidY=profitBlock.top+profitH/2;
  const expMidY=expBlock.top+expH/2;
  function flowParticle(x1,y1,x2,y2,color,delay,dur=2.8){
    const mx=(x1+x2)/2;
    return `<circle r="2" fill="${color}" style="offset-path:path('M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}');offset-distance:0%;animation:ff-ptcl ${dur}s ${delay}s infinite linear"></circle>`;
  }

  // Particles on revenue → mid
  for(let i=0;i<4;i++){
    const yOff=(Math.random()-.5)*revH*.6;
    svg+=flowParticle(col[0],revMidY+yOff,col[1],revMidY+yOff,C.rev,i*0.7);
  }
  // Particles on profit flow
  for(let i=0;i<3;i++){
    const yOff=(Math.random()-.5)*profitH*.5;
    svg+=flowParticle(col[1],profMidY+yOff,col[2],profMidY+yOff,C.profit,i*0.9);
  }
  // Particles on expense flows
  dests.forEach((dest,i)=>{
    const srcTop=expBlock.top+dests.slice(0,i).reduce((a,x)=>a+x.h,0);
    const srcMid=srcTop+dest.h/2;
    const dstMid=dest.top+dest.h/2;
    svg+=flowParticle(col[2],srcMid,col[3]-14,dstMid,dest.color,i*0.5);
  });

  // Labels — left
  svg+=`<text x="${col[0]-20}" y="${profitBlock.top+revH/2+4}" text-anchor="end" class="river-node-value" style="font-size:15px;fill:${C.rev}">${S(rev)}</text>
  <text x="${col[0]-20}" y="${profitBlock.top+revH/2-14}" text-anchor="end" class="river-node-label">Revenue</text>`;

  // Label — profit right side
  svg+=`<text x="${col[3]+4}" y="${profitBlock.top+profitH/2+4}" text-anchor="start" class="river-node-value" style="font-size:13px;fill:${C.profit}">${S(profit)}</text>
  <text x="${col[3]+4}" y="${profitBlock.top+profitH/2-12}" text-anchor="start" class="river-node-label" style="fill:${C.profit}">Net profit</text>`;

  // Labels — destinations
  dests.forEach((dest,i)=>{
    if(dest.h>=8){
      const midY=dest.top+dest.h/2;
      svg+=`<text x="${col[3]+4}" y="${midY+4}" text-anchor="start" class="river-node-label">${dest.label}</text>`;
    }
  });

  svg+=`</svg>`;
  wrap.innerHTML=svg;
  document.getElementById('river-sub').textContent=`${S(profit)} net profit · ${Math.round(profit/rev*100)}% margin`;
}
var _heavyInit=function(){
if(!window._ffAuthed){window.addEventListener('ff:authed',_heavyInit,{once:true});return;}
setTimeout(function(){
  var _fns=[
    function(){loadChartJS(function(){buildCharts();buildCashChart();});},
    refreshAllPeriodData,
    renderPayroll,
    renderPersonal,
    renderCustomers,
    renderInventory,
    renderInvoices,
    renderExpenses,
    renderItems,
    renderBanking,
    function(){if(typeof renderQuotes==='function')renderQuotes();},
    function(){if(typeof renderReceipts==='function')renderReceipts();},
    function(){if(typeof renderPaymentsReceived==='function')renderPaymentsReceived();},
    function(){if(typeof renderRecurringInvoices==='function')renderRecurringInvoices();},
    function(){if(typeof renderCreditNotes==='function')renderCreditNotes();},
    function(){if(typeof renderVendors==='function')renderVendors();},
    function(){if(typeof renderBills==='function')renderBills();},
    function(){if(typeof renderPaymentsMade==='function')renderPaymentsMade();},
    function(){if(typeof renderRecurringBills==='function')renderRecurringBills();},
    function(){if(typeof renderVendorCredits==='function')renderVendorCredits();},
    function(){if(typeof renderProjects==='function')renderProjects();},
    function(){if(typeof renderTimesheet==='function')renderTimesheet();},
    function(){if(typeof renderJournals==='function')renderJournals();},
    function(){if(typeof renderCOA==='function')renderCOA();},
    function(){if(typeof renderLockHistory==='function')renderLockHistory();},
    function(){if(typeof renderReports==='function')renderReports();},
    function(){if(typeof renderDocuments==='function')renderDocuments();},
    function(){if(typeof renderTemplates==='function')renderTemplates();}
  ];
  var _hi = 0;
  function _hdrain() {
    if (_hi >= _fns.length) return;
    var fn = _fns[_hi++];
    try { if(typeof fn==='function') fn(); } catch(e){
      // C6: surface the failure, don't hide it. LA2 (live audit 2026-10-13): name the hook and where it threw —
      // the live account logged "Cannot set properties of null" with no way to tell which render it was.
      const _hn = (fn && fn.name) || String(fn).replace(/\s+/g,' ').slice(0,90);
      console.error('[boot] a deferred render hook threw (skipped, boot continues):', e && e.message, '| hook #'+(_hi-1)+': '+_hn, (e && e.stack) ? '\n'+String(e.stack).split('\n').slice(0,4).join('\n') : '');
    }
    (window.requestIdleCallback || function(cb){ setTimeout(cb,0); })(function(){ _hdrain(); });
  }
  _hdrain();
},0);
};
setTimeout(_heavyInit,0);
// Sales group starts closed - user clicks to open
// Set default month nav label
document.getElementById('month-nav-label').textContent=MONTH_FULL[currentMonthIdx];
// Trigger animations on the initial active page
setTimeout(()=>{
  const activePage=document.querySelector('.page.active');
  if(activePage){animateBarsOnPage(activePage);animateCounters(activePage);}
},200);

// ── RIVER RESIZE OBSERVER — redraws if wrap was 0-width at first paint ────
(function(){
  const wrap=document.getElementById('river-wrap');
  if(!wrap||typeof ResizeObserver==='undefined')return;
  let lastW=0, rafId=null;
  const ro=new ResizeObserver(entries=>{
    // Defer DOM write to next animation frame to avoid ResizeObserver loop
    if(rafId) cancelAnimationFrame(rafId);
    rafId=requestAnimationFrame(()=>{
      const w=entries[0].contentRect.width;
      // LR2 / LR3: buildRiver does not paint while the Dashboard is hidden (0 width), so a change made on another
      // page — a new expense, a business switch — left the old river (or "Loading…") in place. Hiding reported width 0
      // but kept lastW, so coming back at the SAME width repainted nothing until a full reload. Hidden → shown
      // always repaints now, from the current data.
      if(w===0){ lastW=0; return; }
      if(Math.abs(w-lastW)>2){lastW=w;buildRiver(getPeriodData());}
    });
  });
  ro.observe(wrap);
})();

// ── PATCH SAVE FUNCTIONS TO PERSIST (removed — data persisted via API) ───

// ── INIT ENHANCEMENTS (login, persistence, reconciliation) ──────────────
initEnhancements();

// ── 3D TILT ON METRIC CARDS ───────────────────────────────────────────────
document.addEventListener('mousemove',e=>{
  document.querySelectorAll('.mc').forEach(card=>{
    const r=card.getBoundingClientRect();
    if(e.clientX<r.left-60||e.clientX>r.right+60||e.clientY<r.top-60||e.clientY>r.bottom+60){
      card.style.transform='';return;
    }
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dx=(e.clientX-cx)/r.width, dy=(e.clientY-cy)/r.height;
    const rx=dy*-6, ry=dx*6;
    card.style.transform=`perspective(400px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-1px)`;
    card.style.transition='transform .08s ease';
  });
});
document.addEventListener('mouseleave',()=>{
  document.querySelectorAll('.mc').forEach(c=>{c.style.transform='';c.style.transition='transform .4s cubic-bezier(.34,1.3,.64,1)';});
});

// ════════════════════════════════════════════
// GAP CLOSERS v6
// ════════════════════════════════════════════
(function injectGapClosers(){

// ── 1. MOBILE RESPONSIVE CSS ─────────────────────────────────────────────
const mobileCSS = document.createElement('style');
mobileCSS.textContent = `
@media (max-width: 700px) {
  /* Mobile fix: removed the sidebar display:none rule — it overrode the off-canvas drawer and made
     the hamburger appear dead. The drawer opens via .sidebar.open (openSidebar in index.html). */
  .topbar-right #themeBtn { display: none; }
  #currency-picker-wrap { display: none; }
  #pMonth,#pQ,#pY { display: none; }
  #month-nav { display: none !important; }
  .metrics-grid { grid-template-columns: 1fr 1fr !important; gap: 7px; }
  .metrics-grid-3 { grid-template-columns: 1fr 1fr !important; gap: 7px; }
  .two-col { grid-template-columns: 1fr !important; }
  .mc-val { font-size: 26px !important; }
  .mc { padding: .65rem .8rem; }
  .canvas-wrap { height: 140px !important; }
  #river-card { display: none !important; }
  .page-title { font-size: 14px; }
  .period-label { display: none; }
  .field-group { grid-template-columns: 1fr !important; }
  /* Mobile fix: removed the injected mobile-bottom-nav display:flex bar + its mob-nav-item styling —
     it was a SECOND bottom nav duplicating index.html's canonical mob-bottom-nav. The injected bar
     is no longer appended (appendChild commented below). */
  .mobile-fab {
    position: fixed; bottom: 72px; right: 16px; width: 48px; height: 48px;
    border-radius: 50%; background: var(--acc); color: #0e0b08; border: none;
    font-size: 24px; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 20px var(--acc-glow); cursor: pointer; z-index: 501;
    transition: transform .15s cubic-bezier(.34,1.6,.64,1), box-shadow .15s;
  }
  .mobile-fab:active { transform: scale(.93); }
}
@media (min-width: 701px) {
  #mobile-bottom-nav { display: none !important; }
  .mobile-fab { display: none !important; }
}
`;
document.head.appendChild(mobileCSS);

// ── INJECT BOTTOM NAV ────────────────────────────────────────────────────
const bottomNav = document.createElement('nav');
bottomNav.id = 'mobile-bottom-nav';
bottomNav.style.display = 'none';
bottomNav.innerHTML = `
  <button class="mob-nav-item active" id="mob-dashboard" onclick="showPage('dashboard',null);setMobActive('mob-dashboard')">
    <svg viewBox="0 0 16 16"><rect x="1" y="1" width="6.5" height="6.5" rx="1.2"/><rect x="8.5" y="1" width="6.5" height="6.5" rx="1.2"/><rect x="1" y="8.5" width="6.5" height="6.5" rx="1.2"/><rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1.2"/></svg>
    Home
  </button>
  <button class="mob-nav-item" id="mob-invoices" onclick="showPage('invoices',null);setMobActive('mob-invoices')">
    <svg viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="1.2"/><line x1="5" y1="5" x2="11" y2="5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="9" y2="11"/></svg>
    Invoices
  </button>
  <button class="mob-nav-item" id="mob-expenses" onclick="showPage('expenses',null);setMobActive('mob-expenses')">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v6M6 9.5c0 .83.67 1.5 2 1.5s2-.67 2-1.5S9 8 8 8s-2-.67-2-1.5S7 5 8 5s2 .67 2 1.5"/></svg>
    Expenses
  </button>
  <button class="mob-nav-item" id="mob-personal" onclick="showPage('personal',null);setMobActive('mob-personal')">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6"/></svg>
    Personal
  </button>
  <button class="mob-nav-item" id="mob-ai" onclick="showPage('ai',null);setMobActive('mob-ai')">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5"/><line x1="8" y1="1" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="15"/><line x1="1" y1="8" x2="3.5" y2="8"/><line x1="12.5" y1="8" x2="15" y2="8"/></svg>
    AI
  </button>
`;
// Mobile fix: do NOT inject this second bottom nav — index.html ships the canonical `.mob-bottom-nav`.
// (Was active in the repo; commented so the injected `#mobile-bottom-nav` stays un-injected.)
// document.body.appendChild(bottomNav);

window.setMobActive = function(id){
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(id);
  if(el) el.classList.add('active');
};

const fab = document.createElement('button');
fab.className = 'mobile-fab';
fab.innerHTML = '+';
fab.title = 'Quick add';
fab.onclick = () => {
  const page = document.querySelector('.page.active');
  const id = page?.id?.replace('page-', '') || 'dashboard';
  if(!FAB_PAGES.includes(id)) return;   // FAB is hidden on these pages anyway — no useless toast
  if(id==='invoices') openInvoiceModal();
  else if(id==='expenses') openExpenseModal();
  else if(id==='customers') openCustomerModal();
  else if(id==='personal') openTransactionModal();
};
document.body.appendChild(fab);
// Correct on first paint (dashboard = hidden); showPage syncs it on every change thereafter.
_syncMobileFab((document.querySelector('.page.active')?.id || 'page-dashboard').replace('page-',''));


// ── 2. ADVISOR NETWORK PAGE — REMOVED (G11 / D4) ──
// The "Find Advisor" nav item opened an "Advisor Network — Coming Soon" page that duplicated Find Accountant. Both
// are gone; the old 'advisors' page id still redirects to the Find Accountant directory (index.html).

// Honesty pass (F51/F65): the advisor directory was dead — ADVISORS is empty and
// the "Find Advisor" nav redirects to the real Find Accountant directory
// (index.html marketplace block), so renderAdvisors rendered into a non-existent
// #adv-list and bailed, and openAdvisorCertModal / submitAdvisorApp had no caller
// anywhere. Their fake toasts ("Connecting you with…", "Message sent to…",
// "Application submitted — we'll review within 2 business days ✦") are removed so
// they cannot be re-exposed. The "Advisor Network — Coming Soon" page is left as an
// honest placeholder (it is never reached at runtime due to the redirect).


// ── 3. TAX FILING — REMOVED (D1 + honesty pass) ──────────────────────────
// The "Tax Filing" nav item + "Coming Soon" page promised direct e-file to IRS/HMRC,
// W-2/1099 generation and auto-calculated estimates — none of which FinFlow does or (per
// D1) intends to: FinFlow holds no tax knowledge and filing is explicitly out of scope. The
// card advertised capabilities the app lacks (and named the wrong tax authorities for its
// Americas/Caribbean/Europe scope), so it is removed rather than shipped as a false promise.
// What FinFlow legitimately offers stays under Reports: the owner-driven Income Tax Estimate
// worksheet and the W-2/1099 SUMMARY report. Real filing, if ever pursued, is a post-launch
// third-party integration — logged, not stubbed.
//
// (An earlier interactive tax page here was already deleted for FABRICATING a "tax paid YTD"
// figure — ytdPaid = liability × 0.75 with no payment ledger. Do NOT reintroduce a tax-filing
// page without a real filing backend.)


// ── 4. INTEGRATION MARKETPLACE UPGRADE ──────────────────────────────────
// Honesty pass (F51/F65): removed the "FinFlow Integration Marketplace" banner.
// Its "750+ apps & services · Browse, connect, and automate your entire stack"
// copy and its "Browse all 750+ ↗" / "Build an app +" buttons all fired fake
// toasts ("Opening full marketplace…") for capabilities that do not exist — no
// integration in the catalogue actually connects (see connToggle). Banner deleted
// outright; the browse-only catalogue below stays.

// ── 5. PATCH showPage for new pages ─────────────────────────────────────
const _origShowPage = window.showPage;
window.showPage = function(id, el){
  _origShowPage(id, el);
  const extra = {'advisors':'Advisor Network'};
  if(extra[id]) document.getElementById('pageTitle').textContent = extra[id];
  // Advisor render hook removed with the dead advisor directory (honesty pass); the
  // 'advisors' nav redirects to Find Accountant (index.html marketplace block).
  // 'tax-filing' nav + page removed (honesty pass / D1) — see section 3 above.
};

// ── 6. PATCH showPage to close sidebar on mobile ──────────────────────────
const _origShowPage2 = window.showPage;
window.showPage = function(id, el){
  _origShowPage2(id, el);
  if(window.innerWidth <= 768) closeSidebar();
};

})(); // end injectGapClosers
