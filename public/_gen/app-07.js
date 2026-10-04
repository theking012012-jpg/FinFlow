
(function(){
// F197-fix: do NOT gate on the browser-global ff_onboarded flag. It leaked across users (a prior
// onboarded user suppressed a NEW signup's wizard) and cannot distinguish users at parse time.
// The overlay is built HIDDEN below and shown ONLY by _ffDecideOnboarding(), which reads the
// per-user server onboarding_done on every auth. Server truth is the sole authority.

const STEPS = 4;
let currentStep = 1;
let bizType = null;

const overlay = document.createElement('div');
overlay.className = 'ob-overlay';
overlay.id = 'ob-overlay';
overlay.style.display = 'none'; // F197-fix: built hidden; _ffDecideOnboarding() reveals it only for a not-onboarded user
overlay.innerHTML = `
<div class="ob-modal" id="ob-modal">
  <div class="ob-header">
    <div class="ob-logo"><svg viewBox="0 0 16 16"><polyline points="1,11 5,6 8,9 11,4 15,7"/><line x1="1" y1="14" x2="15" y2="14"/></svg></div>
    <div class="ob-title">Welcome to FinFlow Pro</div>
    <div class="ob-sub">Let's get your workspace set up in under 2 minutes.</div>
  </div>
  <div class="ob-steps" id="ob-steps">
    <div class="ob-step-dot active" id="ob-dot-1"></div>
    <div class="ob-step-dot" id="ob-dot-2"></div>
    <div class="ob-step-dot" id="ob-dot-3"></div>
    <div class="ob-step-dot" id="ob-dot-4"></div>
  </div>
  <div class="ob-body">

    <!-- STEP 1: Business basics -->
    <div class="ob-step active" id="ob-s1">
      <div class="ob-field">
        <label class="ob-label" for="ob-biz-name">Business name *</label>
        <input class="ob-input" id="ob-biz-name" placeholder="Enter your business name" value="">
      </div>
      <div class="ob-field">
        <label class="ob-label" for="ob-industry">Industry *</label>
        <select class="ob-input" id="ob-industry">
          <option value="">Select an industry…</option>
          <option value="Technology">Technology</option>
          <option value="Retail">Retail</option>
          <option value="Finance">Finance</option>
          <option value="Healthcare">Healthcare</option>
          <option value="Consulting">Consulting / Services</option>
          <option value="Manufacturing">Manufacturing</option>
          <option value="Construction">Construction</option>
          <option value="Food & Beverage">Food &amp; Beverage</option>
          <option value="Real Estate">Real Estate</option>
          <option value="Media & Creative">Media &amp; Creative</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="ob-field">
        <label class="ob-label" for="ob-user-name">Your name *</label>
        <input class="ob-input" id="ob-user-name" placeholder="Your full name" value="">
      </div>
      <div class="ob-field">
        <label class="ob-label" for="ob-email">Email *</label>
        <input class="ob-input" id="ob-email" type="email" placeholder="you@company.com" value="">
      </div>
      <div class="ob-field">
        <label class="ob-label" for="ob-address">Business address *</label>
        <textarea class="ob-input" id="ob-address" style="min-height:48px;resize:vertical" placeholder="Street, City, Country"></textarea>
      </div>
      <div class="ob-field">
        <label class="ob-label" for="ob-currency">Primary currency</label>
        <select class="ob-input" aria-label="Primary currency" id="ob-currency">
          <option value="USD">🇺🇸 USD — US Dollar</option>
          <option value="TTD">🇹🇹 TTD — TT Dollar</option>
          <option value="GBP">🇬🇧 GBP — British Pound</option>
          <option value="EUR">🇪🇺 EUR — Euro</option>
          <option value="CAD">🇨🇦 CAD — Canadian Dollar</option>
        </select>
      </div>
      <div class="ob-field">
        <label class="ob-label" for="ob-country">Country *</label>
        <select class="ob-input" aria-label="Country" id="ob-country"><option value="">Select a country…</option><option value="CA">Canada</option><option value="US">United States</option><option value="MX">Mexico</option><option value="GT">Guatemala</option><option value="BZ">Belize</option><option value="SV">El Salvador</option><option value="HN">Honduras</option><option value="NI">Nicaragua</option><option value="CR">Costa Rica</option><option value="PA">Panama</option><option value="BR">Brazil</option><option value="AR">Argentina</option><option value="CO">Colombia</option><option value="CL">Chile</option><option value="PE">Peru</option><option value="VE">Venezuela</option><option value="EC">Ecuador</option><option value="BO">Bolivia</option><option value="PY">Paraguay</option><option value="UY">Uruguay</option><option value="GY">Guyana</option><option value="SR">Suriname</option><option value="TT">Trinidad &amp; Tobago</option><option value="JM">Jamaica</option><option value="BB">Barbados</option><option value="BS">Bahamas</option><option value="DO">Dominican Republic</option><option value="HT">Haiti</option><option value="GD">Grenada</option><option value="LC">St. Lucia</option><option value="VC">St. Vincent</option><option value="AG">Antigua &amp; Barbuda</option><option value="DM">Dominica</option><option value="KN">St. Kitts &amp; Nevis</option><option value="CU">Cuba</option><option value="PR">Puerto Rico</option><option value="GB">United Kingdom</option><option value="IE">Ireland</option><option value="FR">France</option><option value="DE">Germany</option><option value="ES">Spain</option><option value="PT">Portugal</option><option value="IT">Italy</option><option value="NL">Netherlands</option><option value="BE">Belgium</option><option value="SE">Sweden</option><option value="NO">Norway</option><option value="DK">Denmark</option><option value="FI">Finland</option><option value="PL">Poland</option><option value="CH">Switzerland</option><option value="AT">Austria</option><option value="GR">Greece</option></select>
      </div>
    </div>

    <!-- STEP 2: Business type -->
    <div class="ob-step" id="ob-s2">
      <div class="ob-label" style="margin-bottom:10px">What kind of business do you run?</div>
      <div class="ob-option-grid">
        <div class="ob-option" onclick="selectBizType(this,'freelancer')">
          <span class="ob-option-icon">💻</span>
          <div><div class="ob-option-label">Freelancer</div><div class="ob-option-desc">Solo & client work</div></div>
        </div>
        <div class="ob-option" onclick="selectBizType(this,'small-biz')">
          <span class="ob-option-icon">🏢</span>
          <div><div class="ob-option-label">Small business</div><div class="ob-option-desc">Team of 2–50</div></div>
        </div>
        <div class="ob-option" onclick="selectBizType(this,'startup')">
          <span class="ob-option-icon">🚀</span>
          <div><div class="ob-option-label">Startup</div><div class="ob-option-desc">Scaling fast</div></div>
        </div>
        <div class="ob-option" onclick="selectBizType(this,'ecommerce')">
          <span class="ob-option-icon">🛒</span>
          <div><div class="ob-option-label">E-commerce</div><div class="ob-option-desc">Products & inventory</div></div>
        </div>
      </div>
    </div>

    <!-- STEP 3: Connect data -->
    <div class="ob-step" id="ob-s3">
      <div class="ob-label" style="margin-bottom:10px">Connect your accounts to unlock live data</div>
      <div class="ob-checklist">
        <div class="ob-check-item" style="cursor:pointer" onclick="obConnectBank(this)">
          <div class="ob-ck-icon" id="ob-ck-bank">🏦</div>
          <div style="flex:1"><div style="font-weight:500">Bank account</div><div style="font-size:11px;color:var(--t3)">Plaid · 12,000+ institutions</div></div>
          <span class="badge b-amber" id="ob-bank-badge">Connect</span>
        </div>
        <div class="ob-check-item" style="cursor:pointer" onclick="obConnectStripe(this)">
          <div class="ob-ck-icon" id="ob-ck-stripe">💳</div>
          <div style="flex:1"><div style="font-weight:500">Stripe payments</div><div style="font-size:11px;color:var(--t3)">Sync revenue & payouts</div></div>
          <span class="badge b-amber" id="ob-stripe-badge">Connect</span>
        </div>
        <div class="ob-check-item" style="cursor:pointer" onclick="obConnectPayroll(this)">
          <div class="ob-ck-icon" id="ob-ck-payroll">👥</div>
          <div style="flex:1"><div style="font-weight:500">Payroll provider</div><div style="font-size:11px;color:var(--t3)">Gusto, ADP, Rippling & more</div></div>
          <span class="badge b-amber" id="ob-payroll-badge">Connect</span>
        </div>
      </div>
      <div style="font-size:11.5px;color:var(--t3);margin-top:.85rem">You can always connect these later from <strong style="color:var(--t2)">Connections</strong>.</div>
    </div>

    <!-- STEP 4: All done -->
    <div class="ob-step" id="ob-s4">
      <div class="ob-success">
        <div class="ob-success-ring">✓</div>
        <div style="font-size:16px;font-family:var(--font-display);font-style:italic;color:var(--acc-light);margin-bottom:6px" id="ob-done-title">You're all set!</div>
        <div style="font-size:12.5px;color:var(--t2);line-height:1.6" id="ob-done-sub">Your workspace is ready. Add your first entity, create an invoice, or record an expense to get started.</div>
      </div>
    </div>

  </div>
  <div class="ob-footer">
    <span class="ob-skip" onclick="skipOnboarding()">Skip for now</span>
    <span class="ob-progress" id="ob-progress">Step 1 of 4</span>
    <button class="btn btn-primary" id="ob-next-btn" onclick="obNext()">Continue →</button>
  </div>
</div>`;

document.body.appendChild(overlay);

window.selectBizType = function(el, type){
  bizType = type;
  document.querySelectorAll('.ob-option').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
};

// Honest Step 3: these integrations are set up AFTER onboarding on the Connections page —
// nothing connects here. Clicking only flags the item as "set up later" (toggleable); it must
// never claim "Connected", which would be a fake-success control (the class F158 flagged).
function obMarkLater(badgeId){
  const badge = document.getElementById(badgeId);
  if(!badge) return;
  const on = badge.dataset.later === '1';
  if(on){ badge.dataset.later=''; badge.className='badge b-amber'; badge.textContent='Connect'; }
  else  { badge.dataset.later='1'; badge.className='badge'; badge.textContent='Set up later'; }
}
// Bank is a REAL Plaid link now. On success show the true linked state; if linking isn't
// available (no keys / cancelled), fall back to the honest "set up later" chip — never a fake ✓.
window.obConnectBank = function(){
  const badge = document.getElementById('ob-bank-badge');
  if(badge){ badge.className='badge'; badge.textContent='Linking…'; }
  window.ffLinkBank(
    (res)=>{ const b=document.getElementById('ob-bank-badge'); if(b){ b.className='badge b-green'; b.textContent='Linked: '+((res&&res.institution_name)||'Bank')+' ✓'; b.dataset.later=''; } },
    ()=>{ const b=document.getElementById('ob-bank-badge'); if(b){ b.className='badge'; b.dataset.later=''; } obMarkLater('ob-bank-badge'); }
  );
};
// Payroll is a REAL Finch connection now (covers Gusto/ADP/Rippling/Paychex/… via one link).
window.obConnectPayroll = function(){
  const badge = document.getElementById('ob-payroll-badge');
  if(badge){ badge.className='badge'; badge.textContent='Connecting…'; }
  window.ffConnectProvider({
    urlEndpoint:'/api/finch/connect-url', urlKey:'connect_url', statusEndpoint:'/api/finch/status',
    onConnected:(s)=>{ const b=document.getElementById('ob-payroll-badge'); if(b){ b.className='badge b-green'; b.textContent='Connected ✓'; b.dataset.later=''; } }
  });
  // If linking isn't available (no keys), ffConnectProvider notifies; leave an honest chip.
  setTimeout(()=>{ const b=document.getElementById('ob-payroll-badge'); if(b && b.textContent==='Connecting…'){ b.className='badge'; obMarkLater('ob-payroll-badge'); } }, 1500);
};
// Stripe payments is a REAL Stripe Connect (read-only) link now.
window.obConnectStripe = function(){
  const badge = document.getElementById('ob-stripe-badge');
  if(badge){ badge.className='badge'; badge.textContent='Connecting…'; }
  window.ffConnectProvider({
    urlEndpoint:'/api/stripe/connect-url', urlKey:'connect_url', statusEndpoint:'/api/stripe/status',
    onConnected:(s)=>{ const b=document.getElementById('ob-stripe-badge'); if(b){ b.className='badge b-green'; b.textContent='Connected ✓'; b.dataset.later=''; } }
  });
  setTimeout(()=>{ const b=document.getElementById('ob-stripe-badge'); if(b && b.textContent==='Connecting…'){ b.className='badge'; obMarkLater('ob-stripe-badge'); } }, 1500);
};

function updateDots(step){
  for(let i=1;i<=STEPS;i++){
    const d = document.getElementById('ob-dot-'+i);
    if(!d) continue;
    d.className='ob-step-dot'+(i<step?' done':i===step?' active':'');
  }
  document.getElementById('ob-progress').textContent=`Step ${Math.min(step,STEPS)} of ${STEPS}`;
}

window.obNext = function(){
  // Apply step 1 values to app
  if(currentStep===1){
    const name = document.getElementById('ob-biz-name').value.trim();
    const user = document.getElementById('ob-user-name').value.trim();
    const email = (document.getElementById('ob-email')?.value||'').trim();
    if(!name){ if(typeof notify==='function') notify('Business name is required', true); return; }
    if(!user){ if(typeof notify==='function') notify('Your name is required', true); return; }
    if(!email || !/^.+@.+\..+$/.test(email)){ if(typeof notify==='function') notify('A valid email is required', true); return; }
    const industry = (document.getElementById('ob-industry')?.value||'').trim();
    const address = (document.getElementById('ob-address')?.value||'').trim();
    if(!industry){ if(typeof notify==='function') notify('Industry is required', true); return; }
    if(!address){ if(typeof notify==='function') notify('Business address is required', true); return; }
    if(name && document.getElementById('sb-brand-name')) document.getElementById('sb-brand-name').textContent=name;
    if(user && document.querySelector('.user-name')) document.querySelector('.user-name').textContent=user;
  }
  if(currentStep===STEPS){
    finishOnboarding(); return;
  }
  document.getElementById('ob-s'+currentStep).classList.remove('active');
  currentStep++;
  document.getElementById('ob-s'+currentStep).classList.add('active');
  updateDots(currentStep);
  if(currentStep===STEPS){
    document.getElementById('ob-next-btn').textContent='Get started →';
    const skipEl=document.querySelector('.ob-skip');if(skipEl)skipEl.style.display='none';
  }
};

async function finishOnboarding(){
  const bizName=(document.getElementById('ob-biz-name')?.value||'').trim();
  const userName=(document.getElementById('ob-user-name')?.value||'').trim();
  const industry=document.getElementById('ob-industry')?.value||'';
  const email=(document.getElementById('ob-email')?.value||'').trim();
  const address=(document.getElementById('ob-address')?.value||'').trim();
  const currency=document.getElementById('ob-currency')?.value||'USD';
  const country=(document.getElementById('ob-country')?.value||'').trim();
  return _completeOnboarding({bizName,userName,industry,email,address,currency,country});
}

// Server-confirmed completion. Provisions the FIRST entity server-side (name+country+currency are
// REQUIRED by POST /api/entities) and saves account settings, and ONLY marks the user onboarded
// when BOTH round-trips succeed. A failed save no longer silently sets the onboarded flag and
// strands the user in an empty workspace (the old bug: empty try/catch + unconditional flag).
async function _completeOnboarding(d){
  if(!d.bizName){ if(typeof notify==='function') notify('Business name is required', true); _obGotoStep(1); return; }
  if(!d.country){ if(typeof notify==='function') notify('Country is required \u2014 it sets tax & filing for your business', true); _obGotoStep(1); return; }
  if(!d.industry){ if(typeof notify==='function') notify('Industry is required', true); _obGotoStep(1); return; }
  if(!d.address){ if(typeof notify==='function') notify('Business address is required', true); _obGotoStep(1); return; }
  const _btn=document.getElementById('ob-next-btn'); if(_btn) _btn.disabled=true;
  try{
    // 1) Provision the first entity. Clean path is a single POST (201). On a 402 (entity cap) a PRIOR
    //    half-completed attempt already created this account's one entity but its settings save failed;
    //    outside the 5s dedupe window a blind re-create would dead-end the retry (Rule 9). So on 402
    //    only, verify an entity actually exists and, if so, complete onboarding off it. A real input
    //    error (400) / server error (500) still aborts.
    const entRes=await fetch('/api/entities',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({name:d.bizName,currency:d.currency,country:d.country})});
    if(!entRes.ok){
      let _entityExists=false;
      if(entRes.status===402){
        try{ const gr=await fetch('/api/entities',{credentials:'include'}); if(gr.ok){ const rows=await gr.json(); _entityExists=Array.isArray(rows)&&rows.length>0; } }catch(_e){}
      }
      if(!_entityExists){ const e=await entRes.json().catch(()=>({})); if(typeof notify==='function') notify(e.error||'Could not create your business. Please try again.', true); if(_btn)_btn.disabled=false; return; }
    }
    // 2) Save account settings.
    const setRes=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({business_name:d.bizName,business_type:bizType||'',industry:d.industry,email:d.email,address:d.address,name:d.userName,currency:d.currency,onboarding_done:1})});
    if(!setRes.ok){ const e=await setRes.json().catch(()=>({})); if(typeof notify==='function') notify(e.error||'Could not save your settings. Please try again.', true); if(_btn)_btn.disabled=false; return; }
  }catch(err){
    if(typeof notify==='function') notify('Network error finishing setup \u2014 please try again.', true);
    if(_btn)_btn.disabled=false; return;
  }
  // Only now that BOTH the entity and the settings persisted do we mark the user onboarded.
  try{ localStorage.setItem('ff_onboarded','1'); }catch(e){}
  try{ sessionStorage.setItem('ff_onboarded','1'); }catch(e){}
  const o=document.getElementById('ob-overlay');
  if(o){ o.style.opacity='0'; o.style.transition='opacity .25s ease'; setTimeout(()=>o.remove(),260); }
  if(typeof doLogin==='function'){ doLogin(); }
  else{ const ls=document.getElementById('login-screen'); if(ls)ls.style.display='none'; }
  notify('Welcome to FinFlow! Your workspace is ready \u2726');
}

// Jump the onboarding wizard back to a given step (used when a required field is missing at finish).
function _obGotoStep(n){
  try{
    for(let i=1;i<=STEPS;i++){ const st=document.getElementById('ob-s'+i); if(st) st.classList.toggle('active', i===n); }
    currentStep=n; if(typeof updateDots==='function') updateDots(currentStep);
    const nb=document.getElementById('ob-next-btn'); if(nb){ nb.textContent='Continue \u2192'; nb.disabled=false; }
    const sk=document.querySelector('.ob-skip'); if(sk) sk.style.display='';
  }catch(e){}
}

window.skipOnboarding = function(){
  // Skip no longer drops the user into an empty workspace: it still provisions the first entity via
  // the same server-confirmed path. If the minimum (name + country) isn't set, it routes back to
  // Step 1 instead of completing.
  finishOnboarding();
};

// ── F197-fix: per-user, server-truth onboarding visibility ──────────────────────
// Overlay is built hidden; shown ONLY when the server says THIS user is not onboarded, hidden
// otherwise. Runs on every auth (login/register via ff:authed) and on page-load/auth-restore
// (loadSettingsFromDB passes its settings in). No reliance on the browser-global flag, so it can
// neither leak to a new user nor re-trigger for a returning one.
window._ffShowOnboarding = function(){ const o=document.getElementById('ob-overlay'); if(o) o.style.display=''; };
window._ffHideOnboarding = function(){ const o=document.getElementById('ob-overlay'); if(o) o.remove(); };
window._ffDecideOnboarding = async function(settings){
  try{
    let s = settings;
    if(!s){ const r = await fetch('/api/settings',{credentials:'include'}); if(!r.ok) return; s = await r.json(); }
    let onboarded = !!(s && (s.onboarding_done==1 || s.onboarding_done===true));
    if(!onboarded){
      // Legacy accounts whose onboarding_done never persisted: an account that already has an
      // entity is, by definition, past onboarding.
      try{ const er=await fetch('/api/entities',{credentials:'include'}); if(er.ok){ const rows=await er.json(); if(Array.isArray(rows)&&rows.length>0) onboarded=true; } }catch(_e){}
    }
    if(onboarded){ window._ffHideOnboarding(); } else { window._ffShowOnboarding(); }
  }catch(e){}
};
window.addEventListener('ff:authed', function(){ try{ window._ffDecideOnboarding(); }catch(e){} });

})();
