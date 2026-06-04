(function(){
// Only show onboarding once (use sessionStorage so it shows on first load)
if(sessionStorage.getItem('ff_onboarded')) return;

const STEPS = 4;
let currentStep = 1;
let bizType = null;

const overlay = document.createElement('div');
overlay.className = 'ob-overlay';
overlay.id = 'ob-overlay';
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
        <label class="ob-label" for="ob-industry">Industry</label>
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
        <label class="ob-label" for="ob-address">Business address</label>
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

window.obConnectBank = function(el){
  const badge = document.getElementById('ob-bank-badge');
  const icon = document.getElementById('ob-ck-bank');
  badge.className='badge b-green'; badge.textContent='Connected ✓'; icon.textContent='✓';
};
window.obConnectStripe = function(el){
  const badge = document.getElementById('ob-stripe-badge');
  const icon = document.getElementById('ob-ck-stripe');
  badge.className='badge b-green'; badge.textContent='Connected ✓'; icon.textContent='✓';
};
window.obConnectPayroll = function(el){
  const badge = document.getElementById('ob-payroll-badge');
  const icon = document.getElementById('ob-ck-payroll');
  badge.className='badge b-green'; badge.textContent='Connected ✓'; icon.textContent='✓';
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
  if(bizName||bizType||currency){
    try{
      await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',
        body:JSON.stringify({
          business_name:bizName,
          business_type:bizType||'',
          industry,
          email,
          address,
          name:userName,
          currency,
          onboarding_done:1
        })});
    }catch(e){}
  }
  sessionStorage.setItem('ff_onboarded','1');
  const o=document.getElementById('ob-overlay');
  o.style.opacity='0';o.style.transition='opacity .25s ease';
  setTimeout(()=>o.remove(),260);
  if(typeof doLogin==='function'){
    doLogin();
  }else{
    const ls=document.getElementById('login-screen');
    if(ls)ls.style.display='none';
  }
  notify('Welcome to FinFlow Pro! Your workspace is ready ✦');
}

window.skipOnboarding = function(){
  finishOnboarding();
};

})();
