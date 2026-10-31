/* ── finflow-api.js ── */
'use strict';
(function () {

  async function api(method, path, body) {
    var opts = { method: method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) {
      // F130: PRESERVE the response. `throw new Error(data.error || res.status)` discarded both the
      // status and the machine-readable `code`, so every caller could only see a message string —
      // and a 402 {code:'TRIAL_EXPIRED'} became indistinguishable from any other failure, landing in
      // the generic "Unable to load" path. A caller cannot branch on information the thrower threw
      // away. The message is unchanged, so nothing that reads err.message behaves differently.
      var err = new Error(data.error || res.status);
      err.status = res.status;
      err.code = data.code;
      err.mfaRequired = data.mfaRequired;  // owner MFA login gate reveals the code field on this
      if (data.code === 'TRIAL_EXPIRED' && typeof window._ffShowTrialExpired === 'function') {
        window._ffShowTrialExpired(data.error);
      }
      throw err;
    }
    return data;
  }

  window.FF_API = {
    register:     function(e,p,n,ref) { var b={email:e,password:p,name:n}; if(ref) b.referralCode=ref; return api('POST','/api/auth/register',b); },
    login:        function(e,p,t) { return api('POST','/api/auth/login', t ? {email:e,password:p,token:t} : {email:e,password:p}); },
    logout:       function()      { return api('POST','/api/auth/logout'); },
    me:           function()      { return api('GET','/api/auth/me'); },
    getInvoices:  function()      { return api('GET','/api/invoices'); },
    getExpenses:  function()      { return api('GET','/api/expenses'); },
    getCustomers: function()      { return api('GET','/api/customers'); },
    getInventory: function()      { return api('GET','/api/inventory'); },
    getPayroll:   function()      { return api('GET','/api/payroll'); },
    getGoals:     function()      { return api('GET','/api/goals'); },
    getHoldings:  function()      { return api('GET','/api/holdings?scope=personal'); },
  };

  function _ffUrlParam(k) { try { return new URLSearchParams(window.location.search).get(k); } catch (e) { return null; } }

  function showAuthGate() {
    var gate = document.createElement('div');
    gate.id = 'ff-auth-gate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0e0b08;font-family:Jost,system-ui,sans-serif';
    if (window.ffAdoptCss) window.ffAdoptCss('ff-auth-gate', '#ff-box{width:100%;max-width:380px;padding:2rem 2.25rem;background:#16120d;border:1px solid #3d3222;border-radius:14px}.ff-t{font-size:22px;font-family:"Cormorant Garamond",serif;font-style:italic;color:#e4c97a;margin-bottom:4px}.ff-s{font-size:13px;color:#7d7060;margin-bottom:1.5rem}.ff-tabs{display:flex;gap:4px;margin-bottom:1.25rem;background:#0e0b08;border-radius:8px;padding:4px}.ff-tab{flex:1;padding:6px;border:none;border-radius:5px;font-size:12.5px;cursor:pointer;color:#7d7060;background:transparent}.ff-tab.on{background:#1c1712;color:#f2e8d5}.ff-err{font-size:12px;color:#c46a5a;background:#1e0d0a;border:1px solid #3d1a14;border-radius:6px;padding:8px;margin-bottom:1rem;display:none}.ff-lbl{font-size:11.5px;color:#9e8e73;display:block;margin-bottom:5px}.ff-inp{width:100%;padding:9px 11px;border:1px solid #3d3222;border-radius:6px;background:#1c1712;color:#f2e8d5;font-size:13px;outline:none;margin-bottom:.9rem;box-sizing:border-box;font-family:Jost,system-ui}.ff-btn{width:100%;padding:10px;border:none;border-radius:6px;background:#c9a84c;color:#0e0b08;font-size:13.5px;font-weight:600;cursor:pointer}.ff-btn:disabled{opacity:.5}.ff-hint{font-size:11.5px;color:#7d7060;text-align:center;margin-top:1rem}.ff-hint span{color:#c9a84c;cursor:pointer}');   // FA-P1: no <style> in markup under the strict CSP
    gate.innerHTML = '<div id="ff-box"><div class="ff-t">FinFlow</div><div class="ff-s">Sign in to your workspace</div><div class="ff-tabs"><button class="ff-tab on" id="fft-li" data-on-click="ffTab(\'login\')">Sign in</button><button class="ff-tab" id="fft-re" data-on-click="ffTab(\'register\')">Create account</button></div><div id="ff-err" class="ff-err"></div><div id="ff-li"><label class="ff-lbl">Email</label><input class="ff-inp" id="ff-le" type="email" placeholder="you@example.com"><label class="ff-lbl">Password</label><input class="ff-inp" id="ff-lp" type="password" placeholder="••••••••"><div id="ff-mfa-group" data-style="display:none"><label class="ff-lbl">Authenticator code</label><input class="ff-inp" id="ff-lm" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"></div><button class="ff-btn" id="ff-lb" data-on-click="ffLogin()">Sign in &rarr;</button><div class="ff-hint" data-style="margin-top:.75rem"><span data-on-click="ffTab(\'forgot\')">Forgot password?</span></div><div class="ff-hint">No account? <span data-on-click="ffTab(\'register\')">Create one</span></div></div><div id="ff-re" data-style="display:none"><label class="ff-lbl">Name</label><input class="ff-inp" id="ff-rn" type="text" placeholder="Your name"><label class="ff-lbl">Email</label><input class="ff-inp" id="ff-re2" type="email" placeholder="you@example.com"><label class="ff-lbl">Password (min 8 characters)</label><input class="ff-inp" id="ff-rp" type="password" placeholder="Choose a password"><button class="ff-btn" id="ff-rb" data-on-click="ffRegister()">Create account &rarr;</button><div class="ff-hint">Have one? <span data-on-click="ffTab(\'login\')">Sign in</span></div></div><div id="ff-fp" data-style="display:none"><label class="ff-lbl">Email</label><input class="ff-inp" id="ff-fe" type="email" placeholder="you@example.com"><button class="ff-btn" id="ff-fb" data-on-click="ffForgot()">Send reset link &rarr;</button><div class="ff-hint"><span data-on-click="ffTab(\'login\')">&larr; Back to sign in</span></div></div></div>';
    document.body.appendChild(gate);
    // C26: "Start free trial" (landing → /app?signup=1) and the accountant referral link (/join, /register →
    // /app?signup=1&ref=CODE) open on Create account. This gate covers the older #login-screen, whose
    // ?signup=1 handler therefore never showed — every free-trial click landed on Sign in.
    if (_ffUrlParam('signup') === '1') window.ffTab('register');
    gate.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      var _fp=document.getElementById('ff-fp');
      if (_fp && _fp.style.display !== 'none') { ffForgot(); return; }
      if (document.getElementById('ff-re').style.display === 'none') ffLogin(); else ffRegister();
    });
  }

  window.ffTab = function(t) {
    document.getElementById('ff-li').style.display = t==='login'?'':'none';
    document.getElementById('ff-re').style.display = t==='register'?'':'none';
    var _fp=document.getElementById('ff-fp'); if(_fp) _fp.style.display = t==='forgot'?'':'none';
    document.getElementById('fft-li').className = 'ff-tab'+(t==='login'?' on':'');
    document.getElementById('fft-re').className = 'ff-tab'+(t==='register'?' on':'');
    document.getElementById('ff-err').style.display = 'none';
    var _mg=document.getElementById('ff-mfa-group'); if(_mg){_mg.style.display='none'; var _lm=document.getElementById('ff-lm'); if(_lm)_lm.value='';}
  };

  function ffErr(m) { var e=document.getElementById('ff-err'); e.textContent=m; e.style.display=m?'block':'none'; }
  function ffBusy(id,b) { var b2=document.getElementById(id); b2.disabled=b; b2.innerHTML=b?'Please wait&hellip;':(id==='ff-lb'?'Sign in &rarr;':id==='ff-fb'?'Send reset link &rarr;':'Create account &rarr;'); }

  window.ffLogin = async function() {
    var e=document.getElementById('ff-le').value.trim(), p=document.getElementById('ff-lp').value;
    if(!e||!p){ffErr('Please fill in all fields.');return;}
    var _mg=document.getElementById('ff-mfa-group');
    var _lm=document.getElementById('ff-lm');
    var tok=(_lm && _lm.value.trim())||'';
    ffBusy('ff-lb',true);
    // On success, RELOAD rather than an in-page transition. The dashboard + all money data are painted
    // by the separate wiring boot (finflow-api-wiring-final.js `_run` → _ffApiBootEasy/Medium → the
    // entity path), which runs ONCE on page load and 401s while logged-out; it does not re-run after an
    // in-page login, so ffOnAuth's partial ffLoadData left the app blank until a manual refresh. A reload
    // re-enters that wiring boot with the now-durable session — identical to the refresh that already works.
    try { await FF_API.login(e,p,tok||undefined); location.reload(); }
    catch(err) {
      if (err && err.mfaRequired) {
        if(_mg) _mg.style.display='';
        if(_lm) _lm.focus();
        ffErr(tok ? 'That code didn\'t match — try again.' : 'Enter the 6-digit code from your authenticator app to finish signing in.');
        ffBusy('ff-lb',false);
        return;
      }
      ffErr(err.message||'Login failed.'); ffBusy('ff-lb',false);
    }
  };

  window.ffRegister = async function() {
    var n=document.getElementById('ff-rn').value.trim(), e=document.getElementById('ff-re2').value.trim(), p=document.getElementById('ff-rp').value;
    if(!e||!p){ffErr('Email and password required.');return;}
    ffBusy('ff-rb',true);
    // Same reason as ffLogin: reload so the wiring boot paints the app with the fresh session.
    // C26: forward the accountant referral code (?ref=) so the server links this signup to the accountant
    // (F10). Only the covered #login-screen's doRegister sent it, so referred signups were never linked.
    try { await FF_API.register(e,p,n,_ffUrlParam('ref')||undefined); location.reload(); }
    catch(err) { ffErr(err.message||'Registration failed.'); ffBusy('ff-rb',false); }
  };

  window.ffForgot = async function() {
    var e=document.getElementById('ff-fe').value.trim();
    if(!e){ffErr('Please enter your email.');return;}
    ffBusy('ff-fb',true);
    try {
      await api('POST','/api/auth/forgot-password',{email:e});
      ffErr('');
      var fp=document.getElementById('ff-fp');
      if(fp) fp.innerHTML='<div class="ff-hint" data-style="color:#7fbf7f;line-height:1.5">If an account exists for that email, a reset link is on its way — check your inbox.</div><div class="ff-hint"><span data-on-click="ffTab(\'login\')">&larr; Back to sign in</span></div>';
    } catch(err) {
      ffErr(err.message||'Could not send reset link. Please try again.'); ffBusy('ff-fb',false);
    }
  };

  async function ffOnAuth(user) {
    var gate=document.getElementById('ff-auth-gate'); if(gate) gate.remove();
    // F197: do NOT tear the onboarding wizard down here. This block ran for EVERY authenticated user
    // and unconditionally marked them onboarded, so a brand-new user's wizard was destroyed at boot
    // and their first entity was never provisioned (empty-workspace bug). Onboarded state is now
    // honoured from the server's onboarding_done in loadSettingsFromDB (finflow-api-wiring.js); a
    // genuinely new user keeps the wizard so onboarding can provision their first entity.
    var ls=document.getElementById('login-screen'); if(ls) ls.style.display='none';
    if(user&&user.name){var ne=document.querySelector('.user-name');if(ne)ne.textContent=user.name;}
    try{ await ffLoadData(); }catch(e){ console.warn('[FinFlow] data load failed:',e.message); }
  }

  async function ffLoadData() {
    var res = await Promise.all([
      FF_API.getInvoices().catch(function(){return [];}),
      FF_API.getExpenses().catch(function(){return [];}),
      FF_API.getCustomers().catch(function(){return [];}),
      FF_API.getInventory().catch(function(){return [];}),
      FF_API.getPayroll().catch(function(){return [];}),
      FF_API.getGoals().catch(function(){return [];}),
      FF_API.getHoldings().catch(function(){return [];}),
    ]);

    if(typeof window.userInvoices!=='undefined')
      window.userInvoices=res[0].map(function(r){return{_dbId:r.id,id:r.id,client:r.client,amount:r.amount,amount_paid:r.amount_paid,due:r.due_date||'—',color:r.status==='overdue'?'var(--red)':'var(--t2)',status:r.status,notes:r.notes||''};});

    if(typeof window.bizExpenses!=='undefined')
      window.bizExpenses=res[1].map(function(r){return{_dbId:r.id,id:r.id,desc:r.description,cat:r.category,amount:r.amount,ded:r.deductible,date:r.expense_date};});

    if(typeof window.customers!=='undefined')
      window.customers=res[2].map(function(r){return{_dbId:r.id,id:r.id,fname:r.fname,lname:r.lname,company:r.company,industry:r.industry,email:r.email,phone:r.phone,revenue:r.revenue,status:r.status,notes:r.notes||''};});

    if(typeof window.inventory!=='undefined')
      window.inventory=res[3].map(function(r){return{_dbId:r.id,id:r.id,sku:r.sku,name:r.name,units:r.units,max:r.max_units,cost:r.cost,low:r.low_stock===1};});

    if(typeof window.payrollEmployees!=='undefined')
      window.payrollEmployees=res[4].filter(function(r){return!r.is_owner;}).map(function(r){return{_dbId:r.id,id:r.id,fname:r.fname,lname:r.lname,role:r.role,type:r.emp_type,gross:r.gross,deductions:r.deductions||[],net:(window.netFromDeductions?window.netFromDeductions(r.gross,r.deductions):r.gross),initials:(r.fname[0]||'')+(r.lname[0]||''),avClass:r.av_class};});

    if(typeof window.goals!=='undefined')
      window.goals=res[5].map(function(r){return{_dbId:r.id,id:r.id,name:r.name,current:r.current_val,target:r.target_val,monthly:r.monthly_contrib,color:r.color};});

    if(typeof window.holdings!=='undefined')
      window.holdings=res[6].map(function(r){return{_dbId:r.id,id:r.id,ticker:r.ticker,name:r.name,type:r.asset_type,shares:r.shares,cost:r.cost_per,price:r.price,div:r.dividend,color:r.color};});

    // F50 Step 3: do NOT paint the dashboard from here. ffLoadData loads NON-entity-scoped data
    // (all invoices/expenses across entities) and never builds REV[]/EXP[] monthly arrays, so its
    // updateDashboard was the main source of the redundant/$0 dashboard paint in the boot race.
    // The entity path (loadEntityData → _buildMonthlyArrays → updateDashboard) is now the SOLE owner
    // of the dashboard paint. Other list renders below are kept — they're harmless and give the list
    // pages an initial paint before the entity load resolves.
    ['renderInvoices','renderExpenses','renderCustomers','renderInventory',
     'renderPayroll','renderPersonal','renderInvestments','updateAI'
    ].forEach(function(fn){ if(typeof window[fn]==='function'){try{window[fn]();}catch(e){}} });
  }

  window.ffLogout = async function() { try{await FF_API.logout();}catch(e){} location.reload(); };

  async function boot() {
    try { var r=await FF_API.me(); await ffOnAuth(r.user); }
    catch(e) { showAuthGate(); }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
  else boot();

})();


;
/* ── finflow-api-wiring.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — API WIRING PATCH
// Drop this file into /public and add ONE script tag at the bottom
// of index.html, just before </body>:
//   <script src="/finflow-api-wiring.js"></script>
//
// This file patches all in-memory-only save functions to also persist
// data to the backend API. It does NOT touch any existing code — it
// only wraps/replaces functions after they are defined.
//
// Covers all EASY fixes from the checklist:
//   ✅ saveSettings()        → PUT  /api/settings
//   ✅ Boot: load settings   → GET  /api/settings
//   ✅ saveGoal()            → POST /api/goals
//   ✅ deleteGoal()          → DELETE /api/goals/:id  (new function)
//   ✅ saveTransaction()     → POST /api/personal-transactions
//   ✅ saveHolding()         → POST /api/holdings
//   ✅ Boot: load personal   → GET  /api/personal-transactions
//   ✅ saveCustomer() create → POST /api/customers
//   ✅ saveCustomer() edit   → PUT  /api/customers/:id
//   ✅ deleteCustomer()      → DELETE /api/customers/:id
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Shared fetch helper ────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `API error ${res.status}`);
    }
    return res.json();
  }

  // ── Wait for DOM + existing scripts to finish ──────────────────────
  // We patch after DOMContentLoaded so all original functions exist.
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }

    // ════════════════════════════════════════════
    // 1. SETTINGS — load on boot + save
    // ════════════════════════════════════════════
    // F196 Tier 2 — PER-ENTITY BUSINESS PROFILE.
    // The letterhead on every document is issued BY an entity, but /api/settings is ONE row per
    // ACCOUNT (server.js: `WHERE user_id=$1 AND data->>'key' IS NULL`), loaded once at boot and never
    // reloaded on an entity switch. So a multi-entity account printed the same business name, address,
    // tax-id and contact on every entity's documents. That is the Rule 10 "under investigation" class:
    // a setting stored PER-USER applied to PER-ENTITY output.
    //
    // The Business-profile panel now edits the ACTIVE ENTITY's profile, with the account blob kept as
    // the fallback for any field the entity has not set (so nothing changes for a single-entity account
    // and no data migration is required — Rule 8).
    //
    // NOTE the deliberate split: `s-biz-email` / `s-biz-phone` are the BUSINESS contact that prints on
    // documents; `s-email` / `s-phone` under "Your profile" remain the USER's own and are NOT touched
    // here. The letterhead previously read the user's fields, so a business document printed the
    // user's personal contact details.
    var ENT_PROFILE_FIELDS = {
      business_name: 's-biz-name',
      address:       's-address',
      email:         's-biz-email',
      phone:         's-biz-phone',
      tax_id:        's-tax-id',
      website:       's-website',
    };
    var _accountProfile = {};   // the account-wide blob, cached at boot as the per-field FALLBACK

    function _activeEntity() {
      try { return (window.ENTITIES || []).find(function (e) { return e && e.active; }) || null; }
      catch (_) { return null; }
    }

    // Paint the Business-profile inputs for whichever entity is active RIGHT NOW. Every field is
    // recomputed from scratch (entity ?? account ?? '') rather than only overwritten when the entity
    // has a value — otherwise a switch would leave the previous entity's values on screen for any
    // field the new entity has not set.
    function applyEntityProfileFields() {
      var ent = _activeEntity();
      var prof = (ent && ent.profile) || {};
      Object.keys(ENT_PROFILE_FIELDS).forEach(function (f) {
        var el = document.getElementById(ENT_PROFILE_FIELDS[f]);
        if (!el) return;
        var v = prof[f];
        if (v == null || v === '') v = _accountProfile[f];
        // business_name falls back to the entity's own switcher name before the account blob, so a
        // brand-new entity shows its own name rather than another entity's business name.
        if ((v == null || v === '') && f === 'business_name' && ent && ent.name) v = ent.name;
        el.value = (v == null) ? '' : v;
      });
      // B1b: this business's invoice-number prefix (repainted on a switch like the profile; "INV-" when unset).
      var _pfx = document.getElementById('s-inv-prefix');
      if (_pfx) _pfx.value = (ent && ent.invoice_prefix) || 'INV-';
      var _bpx = document.getElementById('s-bill-prefix');   // FA-M5c
      if (_bpx) _bpx.value = (ent && ent.bill_prefix) || 'BILL-';
      // Batch 8: this business's payment terms (30 until set — what the field has always shown).
      var _pt = document.getElementById('s-pay-terms');
      if (_pt) _pt.value = (ent && ent.payment_terms != null) ? String(ent.payment_terms) : '30';
      if (typeof window._ffSyncOwnerAlert === 'function') window._ffSyncOwnerAlert();   // FA-B1: this business's overdue alert
      if (typeof window.updateBrandName === 'function') { try { window.updateBrandName(); } catch (_) {} }
    }
    // Exposed so the entity switcher can repaint the panel without a page reload (index.html switchEntity).
    window._ffApplyEntityProfile = applyEntityProfileFields;

    // LA21 (owner decision 2026-10-15): the account's reporting currency. `saved` = the owner's choice (null = default:
    // the first business's currency); `effective` = the currency the server reports "All entities" in. The dropdown lists
    // every supported currency (the shared table, finflow-currency.js); the consolidation view follows `effective` —
    // it used to start from a hardcoded 'USD' whatever the account's businesses were.
    window._ffApplyReportingCurrency = function (saved, effective) {
      const sel = document.getElementById('s-reporting-currency');
      if (sel) {
        const C = (window.FinFlowCurrency && window.FinFlowCurrency.CURRENCIES) || window.CURRENCIES || {};
        if (sel.options.length <= 1) {
          Object.keys(C).sort().forEach(code => {
            const o = document.createElement('option'); o.value = code; o.textContent = code + ' — ' + ((C[code] && C[code].name) || code); sel.appendChild(o);
          });
        }
        sel.options[0].textContent = "Your first business's currency" + (!saved && effective ? ' (' + effective + ')' : '');
        sel.value = saved || '';
        sel.dataset.saved = saved || '';
      }
      if (effective && typeof window.setConsolCurrency === 'function' && window.consolCurrency !== effective) window.setConsolCurrency(effective);
    };
    window.saveReportingCurrency = async function () {
      const sel = document.getElementById('s-reporting-currency');
      if (!sel) return;
      const v = sel.value || null;
      try {
        const r = await fetch('/api/settings', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reporting_currency: v }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        window._ffApplyReportingCurrency(v, j.reporting_currency_effective || v);
        if (typeof notify === 'function') notify('All-businesses totals now shown in ' + (j.reporting_currency_effective || v));
      } catch (e) {
        sel.value = sel.dataset.saved || '';   // the server refused — show what is actually saved
        if (typeof notify === 'function') notify('Could not save the reporting currency: ' + (e && e.message), true);
      }
    };

    // Load settings from DB and apply them to the form fields
    async function loadSettingsFromDB() {
      try {
        const s = await api('GET', '/api/settings');
        // F197: honour the server's onboarding_done — the ONLY correct "this user finished onboarding"
        // signal. Suppress + remove the wizard for onboarded users; a user WITHOUT the flag keeps the
        // wizard so onboarding can provision their first entity. (Replaces the unconditional teardown
        // that ffOnAuth used to do for every authenticated user — the F197 empty-workspace root cause.)
        // F197-fix: delegate the show/hide decision to the per-user, server-truth resolver
        // (defined in index.html). It shows the wizard only when THIS user is not onboarded, and
        // hides it otherwise. `s` is already fetched, so no extra round-trip on the page-load path.
        try { if (typeof window._ffDecideOnboarding === 'function') window._ffDecideOnboarding(s); } catch (e) {}
        // LA21: the reporting ("All entities") currency — fills the Settings dropdown and starts the consolidation view in it.
        try { window._ffApplyReportingCurrency(s.reporting_currency, s.reporting_currency_effective); } catch (e) {}
        // Apply currency
        if (s.currency) {
          const sel = document.getElementById('s-currency');
          if (sel) {
            sel.value = s.currency;
            // Trigger currency update
            const map = { USD: '$', EUR: '€', GBP: '£', TTD: 'TT$', CAD: 'C$', AUD: 'A$' };
            // C3: a business's figures are in the BUSINESS's currency. The account setting applies only while no
            // business is active; otherwise this late-arriving setting stamped "$" on a TT$ business after a reload.
            const _actEnt = (window.ENTITIES || []).find(e => e.active);
            if (_actEnt && typeof window._ffApplyEntityCurrency === 'function') window._ffApplyEntityCurrency(_actEnt);
            else if (!_actEnt) window.currencySymbol = map[s.currency] || '$';
          }
        }
        // Apply dark mode
        if (s.dark_mode != null) {
          window.darkMode = !!s.dark_mode;
          document.getElementById('app')?.classList.toggle('light-mode', !window.darkMode);
          const tog = document.getElementById('s-dark-toggle');
          if (tog) tog.checked = !!s.dark_mode;
        }
        // Apply show cents
        if (s.show_cents != null) {
          const sc = document.getElementById('s-cents');
          if (sc) sc.checked = !!s.show_cents;
        }
        // Apply notification toggles
        if (s.notif_email != null) {
          const el = document.getElementById('s-notif-email');
          if (el) el.checked = !!s.notif_email;
        }
        if (s.notif_inv != null) {
          const el = document.getElementById('s-notif-inv');
          if (el) el.checked = !!s.notif_inv;
        }
        if (s.notif_pay != null) {
          const el = document.getElementById('s-notif-pay');
          if (el) el.checked = !!s.notif_pay;
        }
        // Business profile fields (set from onboarding or earlier saves)
        // LR21: a <select> shows a stored value even if its list lacks it (a legacy or renamed option) — never blank.
        const setField = (id, val) => {
          const el = document.getElementById(id);
          if (!el || val == null) return;
          if (el.tagName === 'SELECT' && val !== '' && ![...el.options].some(o => o.value === String(val))) el.add(new Option(String(val), String(val)));
          el.value = val;
        };
        setField('s-biz-name', s.business_name);
        setField('s-industry', s.industry);
        setField('s-address',  s.address);
        setField('s-email',    s.email);
        setField('s-phone',    s.phone);
        setField('s-website',  s.website);
        setField('s-tax-id',   s.tax_id);
        setField('s-fy',       s.fiscal_year);
        if (typeof window._ffFiscalMonthsChanged === 'function') window._ffFiscalMonthsChanged();   // LC2b: the fiscal year just arrived — rebuild the months and repaint their labels
        // F196 Tier 2: the account blob above is ONE row per account, so on a multi-entity account it
        // labels every entity with the same business. Cache it as the FALLBACK, then overlay the
        // ACTIVE entity's own profile on top. Cached (rather than re-fetched) so an entity switch can
        // recompute every field deterministically: entity value ?? account value ?? '' — otherwise
        // switching from an entity that HAS an address to one that does not would leave the previous
        // entity's address on screen (the same stale-carry-over class as F151).
        _accountProfile = {
          business_name: s.business_name, address: s.address, email: s.email,
          phone: s.phone, tax_id: s.tax_id, website: s.website,
        };
        applyEntityProfileFields();
      } catch (e) {
        // Not logged in yet or no settings saved — fine, use defaults
      }
    }
    loadSettingsFromDB();

    // Patch saveSettings to actually persist
    window.saveSettings = async function () {
      const currency = document.getElementById('s-currency')?.value;
      const dark_mode = document.getElementById('s-dark-toggle')?.checked || document.getElementById('s-dark')?.checked;
      const show_cents = document.getElementById('s-cents')?.checked;
      const notif_email = document.getElementById('s-notif-email')?.checked;
      const notif_inv = document.getElementById('s-notif-inv')?.checked;
      const notif_pay = document.getElementById('s-notif-pay')?.checked;
      const name = document.getElementById('s-user-name')?.value?.trim();
      // Business profile fields — these are audit-logged on the server
      const business_name = document.getElementById('s-biz-name')?.value?.trim();
      const industry      = document.getElementById('s-industry')?.value;
      const address       = document.getElementById('s-address')?.value?.trim();
      const email         = document.getElementById('s-email')?.value?.trim();
      const phone         = document.getElementById('s-phone')?.value?.trim();
      const website       = document.getElementById('s-website')?.value?.trim();
      const tax_id        = document.getElementById('s-tax-id')?.value?.trim();
      const fiscal_year   = document.getElementById('s-fy')?.value;

      try {
        await api('PUT', '/api/settings', {
          currency,
          dark_mode,
          show_cents,
          notif_email,
          notif_inv,
          notif_pay,
          name,
          business_name,
          // F149-b: this is the deliberate "rename the business I'm viewing" action, so it opts in
          // to the server's entity rename (server.js ~1733). No other /api/settings caller sends this,
          // so a settings write can never rename an entity by accident (that was F149).
          rename_active_entity: true,
          industry,
          address,
          email,
          phone,
          website,
          tax_id,
          fiscal_year,
        });
        notify('Settings saved successfully ✦');
        // F196 Tier 2: the Business profile belongs to the ACTIVE ENTITY — write it there too, so a
        // multi-entity account gets per-entity letterheads instead of one account-wide business.
        // The /api/settings write above is deliberately left intact: it keeps the account blob current
        // as the FALLBACK for entities with no profile, and it is what a role holding `settings:manage`
        // but NOT `entities:manage` is permitted to do. Both writers take the SAME input fields, so
        // they cannot disagree (Rule 2) — the entity copy simply wins when present.
        try {
          const _ent = _activeEntity();
          if (_ent && _ent._dbId) {
            const _profile = {
              business_name: document.getElementById('s-biz-name')?.value?.trim() || '',
              address:       document.getElementById('s-address')?.value?.trim() || '',
              email:         document.getElementById('s-biz-email')?.value?.trim() || '',
              phone:         document.getElementById('s-biz-phone')?.value?.trim() || '',
              tax_id:        document.getElementById('s-tax-id')?.value?.trim() || '',
              website:       document.getElementById('s-website')?.value?.trim() || '',
            };
            // B1b: the invoice-number prefix is this business's too (it was a field nothing read). Sent only when the field
            // exists; the server refuses anything but plain text, and the message reaches the owner below.
            const _pfx = document.getElementById('s-inv-prefix');
            const _ptEl = document.getElementById('s-pay-terms');   // batch 8: payment terms travel with the prefix
            const _bpx = document.getElementById('s-bill-prefix');   // FA-M5c: the bill-number prefix travels with them
            await api('PUT', '/api/entities/' + _ent._dbId, Object.assign({}, _profile, _pfx ? { invoice_prefix: _pfx.value.trim() } : {}, _bpx ? { bill_prefix: _bpx.value.trim() } : {}, _ptEl && _ptEl.value !== '' ? { payment_terms: _ptEl.value.trim() } : {}));
            if (_pfx) _ent.invoice_prefix = _pfx.value.trim();
            if (_bpx) _ent.bill_prefix = _bpx.value.trim();
            if (_ptEl && _ptEl.value !== '') _ent.payment_terms = Number(_ptEl.value);
            // Keep the in-memory entity in lockstep so the next document renders the new letterhead
            // without a page reload (the letterhead reads ENTITIES[i].profile, not the DB).
            _ent.profile = Object.assign({}, _ent.profile || {}, _profile);
          }
        } catch (e2) {
          // Never silent: the account-level save succeeded but the per-entity letterhead did not, and
          // the user must know which one they are looking at.
          notify('Saved, but this entity\'s business profile did not update — ' + e2.message, true);
        }
        // Refresh all financial displays so currency symbol + format changes apply immediately
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('all');
      } catch (e) {
        notify('Could not save settings — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 2 + 3. GOALS & PERSONAL TRANSACTIONS — owned by app-main.js
    // ════════════════════════════════════════════
    // REMOVED the stale window.saveGoal / deleteGoal / loadGoalsFromDB and
    // window.saveTransaction / loadPersonalTransactionsFromDB overrides. They wrote
    // the legacy window.goals / window.persTransactions arrays and refreshed only the
    // business dashboard (_refreshDashboardUI) — disconnected from app-main's rebuilt
    // personal pipeline (module goals / _allPersTxs → _applyPersFilter → renderPersonal),
    // so goals and transactions "saved but didn't show until re-nav". app-main.js now
    // owns saveGoal / deletePersGoal / saveTransaction (+ inline quick-add), each POSTing
    // and calling loadPersonalFinance(), which loads goals + transactions from the DB and
    // re-renders. The showPage('personal') hook below calls loadPersonalFinance() so the
    // initial load is covered too. (Holdings overrides intentionally left for a separate
    // Investments-page pass.)

    // ════════════════════════════════════════════
    // 4. HOLDINGS — save
    // ════════════════════════════════════════════
    window.saveHolding = async function () {
      const ticker = (document.getElementById('h-ticker')?.value || '').trim().toUpperCase();
      const name   = (document.getElementById('h-name')?.value   || '').trim() || ticker;
      const shares = parseFloat(document.getElementById('h-shares')?.value) || 0;
      const cost   = parseFloat(document.getElementById('h-cost')?.value)   || 0;
      const price  = parseFloat(document.getElementById('h-price')?.value)  || cost;
      const div    = parseFloat(document.getElementById('h-div')?.value)    || 0;
      const type   = document.getElementById('h-type')?.value || 'Stock';

      if (!ticker || !shares) { notify('Ticker and shares are required', true); return; }

      const colors = ['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a4e3a'];
      const color  = colors[window.holdings.length % colors.length];

      try {
        const saved = await api('POST', '/api/holdings', {
          ticker,
          name,
          asset_type: type,
          shares,
          cost_per: cost,
          price,
          dividend: div,
          color,
        });
        if (!window.holdings) window.holdings = [];
        window.holdings.push({ _dbId: saved.id, ticker, name, type, shares, cost, price, div, color });
        closeModal('holding-modal');
        if (typeof renderInvestments === 'function') renderInvestments();
        notify(`${ticker} added to portfolio ✦`);
        if (typeof window._loadHoldingsFromDB === 'function') window._loadHoldingsFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
      } catch (e) {
        notify('Could not save holding — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 5. CUSTOMERS — save (create + edit) + delete
    // ════════════════════════════════════════════
    window.saveCustomer = async function () {
      // Input helpers — use same sanitize/validate functions already in the app
      const fname = (typeof sanitizeText === 'function')
        ? sanitizeText(document.getElementById('cust-fname')?.value, 100)
        : document.getElementById('cust-fname')?.value?.trim();
      const lname = (typeof sanitizeText === 'function')
        ? sanitizeText(document.getElementById('cust-lname')?.value, 100)
        : document.getElementById('cust-lname')?.value?.trim();
      const email = document.getElementById('cust-email')?.value?.trim().toLowerCase().slice(0, 254);

      // FA-B4: a customer is a person (first + last name) or a company — the same rule the server and the invoice form's
      // auto-saved contacts use; the email is optional (checked only when given).
      const _co = (document.getElementById('cust-company')?.value || '').trim();
      if (!((fname && lname) || _co)) { notify('Enter a first and last name, or a company name', true); return; }
      if (email && typeof validateEmail === 'function' && !validateEmail(email)) { notify('That email address is not valid', true); return; }

      // L17: no typed revenue — GET /api/customers derives it from the customer's invoices.
      const data = {
        fname, lname, email,
        company:  (typeof sanitizeText === 'function') ? sanitizeText(document.getElementById('cust-company')?.value, 200)  : document.getElementById('cust-company')?.value?.trim(),
        industry: document.getElementById('cust-industry')?.value,
        phone:    (typeof sanitizePhone === 'function')  ? sanitizePhone(document.getElementById('cust-phone')?.value)       : document.getElementById('cust-phone')?.value?.trim(),
        status:   document.getElementById('cust-status')?.value,
        notes:    (typeof sanitizeText === 'function') ? sanitizeText(document.getElementById('cust-notes')?.value, 1000) : document.getElementById('cust-notes')?.value?.trim(),
      };

      const editId = document.getElementById('cust-edit-id')?.value;

      try {
        if (!window.customers) window.customers = [];
        if (editId) {
          // Find DB id
          const cust = window.customers.find(c => c.id === Number(editId));
          const dbId = cust?._dbId || editId;
          await api('PUT', `/api/customers/${dbId}`, data);
          const idx = window.customers.findIndex(c => c.id === Number(editId));
          if (idx > -1) window.customers[idx] = { ...window.customers[idx], ...data };
          notify('Customer updated ✦');
        } else {
          const saved = await api('POST', '/api/customers', data);
          data.id    = window.nextCustId++;
          data._dbId = saved.id;
          window.customers.push(data);
          notify('Customer added ✦');
        }
        // L17: revenue is DERIVED on the server, so re-read the list after a save — into the list the page
        // RENDERS (app-main's top-level `customers`, mapped exactly like the boot load), not just
        // window.customers (a different binding renderCustomers never reads).
        try {
          const _fresh = await api('GET', '/api/customers');
          if (Array.isArray(_fresh)) {
            const _mapped = _fresh.map(c => ({ ...c, _dbId: c.id }));
            if (typeof customers !== 'undefined') customers = _mapped;   // eslint-disable-line no-undef
            window.customers = _mapped;
          }
        } catch (_) { /* keep the optimistic list; the next boot re-derives */ }
        closeModal('customer-modal');
        const search = document.getElementById('cust-search')?.value;
        if (typeof renderCustomers === 'function') renderCustomers(search);
      } catch (e) {
        notify('Could not save customer — ' + e.message, true);
      }
    };

    window.deleteCustomer = async function () {
      const id = Number(document.getElementById('cust-edit-id')?.value);
      if (!id) return;
      if (!(await window._confirmModal('Delete this customer? This cannot be undone.', {danger:true}))) return;

      const cust = (window.customers || []).find(c => c.id === id);
      const dbId = cust?._dbId || id;

      try {
        await api('DELETE', `/api/customers/${dbId}`);
        window.customers = (window.customers || []).filter(c => c.id !== id);
        closeModal('customer-modal');
        if (typeof renderCustomers === 'function') renderCustomers();
        notify('Customer deleted');
      } catch (e) {
        notify('Could not delete customer — ' + e.message, true);
      }
    };

    // ── showPage hook: reload personal data when user visits that page ─
    // Goals + personal transactions now load via app-main's loadPersonalFinance()
    // (the rebuilt pipeline), not the removed legacy loaders.
    const _wiringOrig = window.showPage;
    if (typeof _wiringOrig === 'function') {
      window.showPage = function (id, navEl) {
        _wiringOrig(id, navEl);
        if (id === 'personal' && typeof window.loadPersonalFinance === 'function') {
          window.loadPersonalFinance();
        }
      };
    }

    console.log('[FinFlow API Wiring] ✅ All easy patches applied');
  })()

})();


;
/* ── finflow-api-wiring-medium.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — API WIRING PATCH (MEDIUM FIXES)
// Drop into /public and add ONE script tag after the easy-fixes tag:
//   <script src="/finflow-api-wiring-medium.js"></script>
//
// Covers all MEDIUM fixes from the checklist:
//   ✅ saveInvoice()         → POST /api/invoices
//   ✅ markInvoicePaid()     → DELETED (F113/F114/F115) — replaced by index.html's
//                              Record Payment modal (openRecordPaymentModal/recordPayment)
//   ✅ deleteInvoice()       → DELETE /api/invoices/:id  (new)
//   ✅ Boot: load invoices   → GET  /api/invoices
//   ✅ renderInvoices()      → patched to show delete button
//
//   ✅ saveExpense()         → POST /api/expenses
//   ✅ deleteExpense()       → DELETE /api/expenses/:id  (new)
//   ✅ Boot: load expenses   → GET  /api/expenses
//   ✅ renderExpenses()      → patched to show delete button
//
//   ✅ saveProduct()         → POST /api/inventory
//   ✅ restockItem()         → POST /api/inventory/:id/restock
//   ✅ deleteInventoryItem() → DELETE /api/inventory/:id  (new)
//   ✅ Boot: load inventory  → GET  /api/inventory
//   ✅ renderInventory()     → patched to show delete button
//
//   ✅ saveOwnerPayroll()    → POST/PUT /api/payroll
//   ✅ Boot: load payroll    → GET  /api/payroll
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Shared fetch helper ────────────────────────────────────────────
  // Coalesce concurrent identical GETs. On a cold boot each list loader is fired from the
  // module init AND again from the render pass before the first fetch resolves; sharing the
  // in-flight promise collapses those duplicates into ONE request. GET-only (never mutations),
  // and the entry clears as soon as it settles, so a later reload still fetches fresh data.
  const _inflightGets = new Map();
  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const isGet = String(method).toUpperCase() === 'GET';
    if (isGet && _inflightGets.has(path)) return _inflightGets.get(path);
    const p = (async () => {
      const res = await fetch(path, opts);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || `API error ${res.status}`);
        err.status = res.status; err.code = data.code;   // preserve machine-readable code (e.g. INVOICE_LIMIT)
        throw err;
      }
      return res.json();
    })();
    if (isGet) { _inflightGets.set(path, p); const done = () => { if (_inflightGets.get(path) === p) _inflightGets.delete(path); }; p.then(done, done); }
    return p;
  }

  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }

    // ════════════════════════════════════════════
    // 1. INVOICES
    // ════════════════════════════════════════════

    // Boot: load all saved invoices from DB
    async function loadInvoicesFromDB() {
      try {
        // Activate the current entity in session first
        const _activeEnt = (window.ENTITIES || []).find(e => e.active);
        if (_activeEnt?._dbId) {
          try { await api('POST', `/api/entities/${_activeEnt._dbId}/activate`); } catch(e) {}
        }
        const rows = await api('GET', '/api/invoices' + (_activeEnt?._dbId ? '?entity_id=' + _activeEnt._dbId : ''));
        // C1: an EMPTY answer is a real answer — it replaces the list. Skipping it kept the previous business's rows.
        if (Array.isArray(rows)) {
          // Map DB shape → frontend shape, prepend to seed data or replace
          const mapped = rows.map(r => ({
            _dbId:  r.id,
            client: r.client,
            amount: r.amount,
            credit_applied: r.credit_applied || 0,   // FA-M6b: the credit-note part of amount_paid (not cash)
            amount_paid: r.amount_paid,   // F119: THE dropping mapper — this is the winning boot loader
                                          // for window.userInvoices; without amount_paid a partially-paid
                                          // invoice showed its FULL amount as "remaining" in Record Payment,
                                          // defeating the overpay guard (under-warn) and 400ing on settle.
            due:    r.due_date
                      ? (window.FinFlowDates ? window.FinFlowDates.fmtLabel(r.due_date) : r.due_date)   // F195: TZ-safe calendar date
                      : 'No due date',
            due_date: r.due_date,
            status: r.status,
            number: r.number || null,   // B1b: the invoice's number
            notes:  r.notes || '',
            color:  r.status?.toLowerCase() === 'overdue' ? 'var(--red)' : 'var(--t2)',
          }));
          // Prepend user-created invoices before seed data
          if (!window.userInvoices) window.userInvoices = [];
          window.userInvoices = [...mapped, ...window.userInvoices.filter(i => !i._dbId)];
          if (typeof renderInvoices === 'function') renderInvoices();
        }
      } catch (e) {
        // Not logged in yet or first run — fine
      }
    }
    loadInvoicesFromDB();

    // Batch 7: open the invoice form PRE-FILLED for an existing invoice — every field and its line items (the shared
    // editor's load(), as the LR9 quote edit) — titled with its number; saveInvoice then PUTs to the same invoice.
    window.editInvoice = async function (idx) {
      const inv = (window.userInvoices || [])[idx];
      if (!inv || inv._dbId == null) { notify('That invoice could not be found — refresh and try again', true); return; }
      let raw = (window._realInvoices || []).find(r => r.id === inv._dbId);
      if (!raw) { try { raw = await api('GET', '/api/invoices/' + inv._dbId); } catch (_) { raw = null; } }
      const r = Object.assign({}, raw || {}, inv);
      if (typeof openInvoiceModal === 'function') openInvoiceModal();   // a clean form first (fresh token, lines reset)
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
      const ymd = v => (window.FinFlowDates ? (window.FinFlowDates._toYmd(v) || '') : String(v || '').slice(0, 10));
      set('inv-client', r.client); set('inv-amount', r.amount != null ? Number(r.amount) : '');
      set('inv-issue', ymd(r.issue_date)); set('inv-due', ymd(r.due_date));
      if (window._docTermsSet) window._docTermsSet('inv', ymd(r.issue_date), ymd(r.due_date));   // FA-B5: this invoice's own terms
      // E2E-1: the form offers Unpaid (issued) / Paid / Draft. Overdue and part-paid are worked out from the due date and
      // the payments, so they open as "Unpaid — issued" (saving keeps the payments; the server re-derives the status, G3).
      { const _st = String(r.status || 'pending').toLowerCase(); set('inv-status', (_st === 'draft' || _st === 'paid') ? _st : 'pending'); }
      set('inv-desc', r.notes);
      const lines = Array.isArray(raw && raw.line_items) ? raw.line_items : (Array.isArray(r.line_items) ? r.line_items : []);
      if (lines.length && window.ffInvLineItems && window.ffInvLineItems.load) window.ffInvLineItems.load(lines);
      window._invEditId = inv._dbId;
      const t = document.querySelector('#invoice-modal .modal-title'); if (t) t.textContent = 'Edit invoice' + (r.number ? ' ' + r.number : '');
      const st = document.querySelector('#invoice-modal .modal-sub'); if (st) st.textContent = 'Changes are saved to this invoice and shown in its history';
    };

    // E2E-1: a DRAFT invoice is not issued — it is in no total (Rule 11: revenue counts pending / overdue / partial / paid).
    // Issuing it is one status change on the same invoice (PUT, audited, the ledger follows the flip — GL Phase 2), so
    // it then counts on its own issue date. The server refuses the change inside a locked period and says why.
    window.issueInvoice = async function (idx) {
      const inv = (window.userInvoices || [])[idx];
      if (!inv || inv._dbId == null) { notify('That invoice could not be found — refresh and try again', true); return; }
      if (window._issuingInvoice) return;
      window._issuingInvoice = true;
      try {
        const upd = await api('PUT', '/api/invoices/' + inv._dbId, { status: 'pending' });
        notify('Invoice ' + ((upd && upd.number) || inv.number || '') + ' issued — it now counts in your books ✦');
        await loadInvoicesFromDB().catch(() => {});
        if (typeof renderInvoices === 'function') renderInvoices();
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        notify(e.message || 'Could not issue the invoice', true);
      } finally { window._issuingInvoice = false; }
    };

    // Patch saveInvoice to persist to API
    window.saveInvoice = async function () {
      // F117 commit B: in-flight re-entry lock — a double-click / impatient re-click cannot fire a
      // 2nd POST. This is a UX layer only; the durable guarantee is the DB idempotency index
      // (commit A), which also covers two tabs / network replay the client lock can't (Rule 9).
      if (window._savingInvoice) return;

      const client    = (typeof sanitizeText === 'function')
        ? sanitizeText(document.getElementById('inv-client')?.value, 200)
        : document.getElementById('inv-client')?.value?.trim();
      const amountRaw = (typeof validateAmount === 'function')
        ? validateAmount(document.getElementById('inv-amount')?.value)
        : parseFloat(document.getElementById('inv-amount')?.value) || null;

      if (!client)                      { notify('Client name is required', true); return; }
      if (amountRaw === null || amountRaw <= 0) { notify('A valid positive amount is required', true); return; }

      const due    = document.getElementById('inv-due')?.value;
      const status = document.getElementById('inv-status')?.value || 'pending';
      const notes  = document.getElementById('inv-desc')?.value?.trim() || '';
      // F36: business issue date (default today, backdatable). Recognition keys on this.
      const issue_date = document.getElementById('inv-issue')?.value || (typeof todayLocal==='function'?todayLocal():null);
      const dueStr = due ? (window.FinFlowDates ? window.FinFlowDates.fmtLabel(due) : due) : 'No due date';   // F195: TZ-safe calendar date

      // Batch 7: EDIT — the same form saved to the SAME invoice (PUT). The server re-derives the amount from the lines,
      // keeps the ledger in step, refuses an amount below what is already paid (G3) and records old → new for History.
      if (window._invEditId != null) {
        const _id = window._invEditId;
        window._savingInvoice = true;
        const _eb = document.querySelector('#invoice-modal .btn-primary'); if (_eb) _eb.disabled = true;
        try {
          const _li = (window.ffInvLineItems && typeof window.ffInvLineItems.get === 'function') ? window.ffInvLineItems.get() : null;
          const upd = await api('PUT', '/api/invoices/' + _id, Object.assign({ client, due_date: due || null, issue_date, status, notes },
            _li ? { line_items: _li } : { amount: amountRaw, line_items: null }));
          window._invEditId = null;
          closeModal('invoice-modal');
          notify('Invoice ' + ((upd && upd.number) || '') + ' updated ✦');
          await loadInvoicesFromDB().catch(() => {});
          if (typeof renderInvoices === 'function') renderInvoices();
          window._refreshDashboardUI?.();
          if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
        } catch (e) {
          notify(e.message || 'Could not update the invoice', true);   // e.g. G3: "This invoice has 250.00 USD paid against it…"
        } finally {
          window._savingInvoice = false; if (_eb) _eb.disabled = false;
        }
        return;
      }

      // One idempotency token per submit-intent: minted lazily now, reused on any retry of THIS
      // modal, and reset to null on modal open (openInvoiceModal) and on success below. So a
      // double-submit of the same intent reuses it (→ DB dedupes, commit A) while a genuine
      // re-invoice from a reopened modal gets a NEW token and is allowed. crypto.randomUUID with a
      // non-crypto fallback (the token only needs to be unique per intent, not cryptographic).
      window._invIdemKey = window._invIdemKey || (window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : 'inv-' + Date.now() + '-' + Math.random().toString(36).slice(2));

      window._savingInvoice = true;
      const _saveBtn = document.querySelector('#invoice-modal .btn-primary');
      if (_saveBtn) _saveBtn.disabled = true;
      try {
        // Get active entity_id from ENTITIES array
        const _activeEnt = (window.ENTITIES || []).find(e => e.active);
        const _entityId = _activeEnt?._dbId || null;

        // F194: optional line items. When present, the SERVER re-derives amount = Σ qty×rate and
        // returns it — that server figure (saved.amount) is canonical, never amountRaw (Rule 2).
        const _lineItems = (window.ffInvLineItems && typeof window.ffInvLineItems.get === 'function')
          ? window.ffInvLineItems.get() : null;

        const saved = await api('POST', '/api/invoices', {
          client,
          amount:   amountRaw,
          due_date: due || null,
          issue_date,
          status,
          notes,
          entity_id: _entityId,
          class:    (document.getElementById('inv-class') && document.getElementById('inv-class').value.trim()) || undefined,
          location: (document.getElementById('inv-location') && document.getElementById('inv-location').value.trim()) || undefined,
          idempotency_key: window._invIdemKey,   // F117 commit B — the token commit A's index enforces
          ...(_lineItems ? { line_items: _lineItems } : {}),
        });

        // Trust the server's stored amount (derived from line_items when present); fall back to what
        // the user typed only if the response omitted it.
        const _savedAmount = (saved && saved.amount != null) ? parseFloat(saved.amount) : amountRaw;

        if (!window.userInvoices) window.userInvoices = [];
        window.userInvoices.unshift({
          _dbId:    saved.id,
          client,
          amount:   _savedAmount,
          amount_paid: (saved && saved.amount_paid != null) ? parseFloat(saved.amount_paid) : 0,
                            // F119: a freshly-created invoice has nothing paid; carry the field so
                            // EVERY object in userInvoices has amount_paid (partials always arrive via
                            // a loader that carries the real value → Record Payment can't over-collect)
          due:      dueStr,
          due_date: due || null,
          status,
          notes,
          line_items: _lineItems || null,   // F194: so an immediate View renders the rows without a refetch
          color:    status === 'overdue' ? 'var(--red)' : 'var(--t2)',
        });
        if (Array.isArray(window._realInvoices) && saved) window._realInvoices.unshift(saved);

        window._invIdemKey = null;   // success → the next invoice mints a fresh token
        closeModal('invoice-modal');
        if (typeof renderInvoices === 'function') renderInvoices();
        notify(status === 'draft' ? `Draft invoice saved for ${client} — it is not in your books until you issue it` : `Invoice created for ${client} ✦`);   // E2E-1
        loadInvoicesFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        // Keep _invIdemKey so a manual retry of this SAME submit is idempotent: if the row did land
        // server-side despite the error, the retry carries the same token → 23505 → original row, no dup.
        if (e && e.code === 'INVOICE_LIMIT') {
          // Pro monthly cap (server 402) — show the upgrade path, not a generic error.
          if (typeof showUpgradeModal === 'function') showUpgradeModal('invoice_limit');
          else notify(e.message || 'Monthly invoice limit reached — upgrade for unlimited invoicing.', true);
        } else {
          notify('Could not save invoice — ' + e.message, true);
        }
      } finally {
        window._savingInvoice = false;
        if (_saveBtn) _saveBtn.disabled = false;
      }
    };

    // F113/F114/F115: markInvoicePaid DELETED — replaced outright, not deferred, by the revived
    // Record Payment modal (index.html openRecordPaymentModal/recordPayment), which does
    // everything this used to do (settle via POST /api/invoice-payments, same server route,
    // same recalcInvoiceStatus) plus the two things it never could: a genuine partial-amount
    // path (F114) and a server-resolved payment_date instead of the browser's local clock
    // (F115 — this function's `_d.getFullYear()/getMonth()/getDate()` construction was the bug).
    // Confirmed no other caller exists (grepped the whole repo) before deleting.

    // New: deleteInvoice
    window.deleteInvoice = async function (idx) {
      const inv = window.userInvoices[idx];
      if (!inv) return;
      if (!(await window._confirmModal(`Delete invoice for ${inv.client}? This cannot be undone.`, {danger:true}))) return;
      try {
        if (inv._dbId) await api('DELETE', `/api/invoices/${inv._dbId}`);
        window.userInvoices.splice(idx, 1);
        if (typeof renderInvoices === 'function') renderInvoices();
        notify('Invoice deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        notify('Could not delete invoice — ' + e.message, true);
      }
    };

    // Patch renderInvoices to add a delete button
    // F114: 'partial' gains its own badge class (b-blue — distinct accent color, already defined
    // in index.html's CSS, used elsewhere for badges) instead of falling through to the 'pending'
    // amber default. F113/F114: 'Record Payment' replaces 'Mark paid' for BOTH pending AND
    // partial invoices — partial previously had NO action button at all (only delete), which was
    // the concrete gap F114 named. Passes the full invoice object (not idx/client/amount strings)
    // so the modal can show Total/Paid/Remaining and check overpayment inline.
    window.renderInvoices = function () {
      if (typeof updateInvoices === 'function') updateInvoices();
      const badgeCls = { paid: 'b-green', pending: 'b-amber', partial: 'b-blue', overdue: 'b-red', draft: 'b-grey' };
      const el = document.getElementById('invoice-list');
      if (!el) return;
      // F206 (perf): render the table incrementally. The full window.userInvoices array is untouched
      // (every aggregation still sees all rows) — only the DOM is capped so an account with thousands
      // of invoices never paints thousands of <div>s at once. `idx` still indexes the FULL array
      // (slice keeps 0-based indices), so every onclick handler (viewInvoice/deleteInvoice/…) stays valid.
      const _allInv = window.userInvoices || [];
      if (typeof window._invRenderLimit !== 'number') window._invRenderLimit = 100;
      const _shownInv = _allInv.slice(0, window._invRenderLimit);
      // FA-M4: the "Paid" column — what was received (a paid-status row with no stored figure counts as paid in full),
      // and on a part-paid invoice what is left. "—" when nothing was paid. Same amount_paid the AR figure reads.
      const _invPaidCell = inv => {
        const amt = parseFloat(inv.amount) || 0;
        const settled = String(inv.status || '').toLowerCase() === 'paid' && !(parseFloat(inv.amount_paid) > 0) ? amt : Math.min(amt, parseFloat(inv.amount_paid) || 0);
        const credit = Math.min(settled, parseFloat(inv.credit_applied) || 0), paid = settled - credit;   // FA-M6b: a credit is not money received
        const left = Math.max(0, amt - settled);
        if (!(paid > 0.005)) return (credit > 0.005 ? '<span class="inv-paid-lbl" data-style="color:var(--t3)">Credited </span><span data-style="font-family:var(--font-mono)">' + esc(S(credit)) + '</span>' + (left > 0.005 ? '<br><span data-style="font-size:11px;color:var(--t3)">' + esc(S(left)) + ' left</span>' : '') : '<span class="inv-paid-lbl" data-style="color:var(--t3)">Paid </span><span data-style="color:var(--t3)">—</span>');
        return '<span class="inv-paid-lbl" data-style="color:var(--t3)">Paid </span><span data-style="font-family:var(--font-mono);color:var(--green)">' + esc(S(paid)) + '</span>'
          + (credit > 0.005 ? '<br><span data-style="font-size:11px;color:var(--t3)">+ ' + esc(S(credit)) + ' credited</span>' : '')
          + (left > 0.005 ? '<br><span data-style="font-size:11px;color:var(--t3)">' + esc(S(left)) + ' left</span>' : '');
      };
      window._invShowMore = function () { window._invRenderLimit += 200; if (typeof window.renderInvoices === 'function') window.renderInvoices(); };
      el.innerHTML = _shownInv.map((inv, idx) => `
        <div class="table-row inv-cols">
          <span>${esc(inv.client)}${inv.number ? `<br><span class="inv-number" data-style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(inv.number)}</span>` : ''}</span>
          <span data-style="font-weight:600;font-family:var(--font-mono)">${esc(S(inv.amount))}</span>
          <span class="inv-paid">${_invPaidCell(inv)}</span>
          <span data-style="color:${esc(inv.color)}">${esc(inv.due)}</span>
          <span>${window._isScheduled(inv.issue_date||inv.created_at||inv.date) ? '<span class="badge b-blue" title="Future-dated — scheduled, not yet counted in your books">Scheduled</span> ' : ''}<span class="badge ${badgeCls[inv.status] || 'b-amber'}"${inv.status?.toLowerCase() === 'draft' ? ' title="Not issued yet — not in your revenue, receivables or reports until you issue it"' : ''}>${esc(inv.status)}</span></span>
          <span class="table-actions">
            ${inv.status?.toLowerCase() === 'overdue'
              ? `<button class="btn btn-ghost btn-sm inv-remind-btn"
                   data-idx="${idx}"
                   data-client="${esc(inv.client)}"
                   data-amount="${esc(S(inv.amount))}">Remind ↗</button>`
              : ''}
            <button class="btn btn-ghost btn-sm" data-arg-idx="${idx}" data-on-click="viewInvoice(Number(this.dataset.argIdx))">View</button>
            <button class="btn btn-ghost btn-sm" data-arg-idx="${idx}" data-on-click="editInvoice(Number(this.dataset.argIdx))">Edit</button>
            ${inv.status?.toLowerCase() === 'draft'
              ? `<button class="btn btn-ghost btn-sm" title="Issue this invoice — it then counts in your revenue and receivables" data-arg-idx="${idx}" data-on-click="issueInvoice(Number(this.dataset.argIdx))">Issue</button>`
              : ''}
            ${(inv.status?.toLowerCase() === 'pending' || inv.status?.toLowerCase() === 'partial')
              ? `<button class="btn btn-ghost btn-sm" data-arg-idx="${idx}" data-on-click="openRecordPaymentModal(window.userInvoices[Number(this.dataset.argIdx)])">Record Payment</button>`
                + `<button class="btn btn-ghost btn-sm" title="Generate a hosted payment link via a connected processor" data-arg-idx="${idx}" data-on-click="ffInvoicePayLinkChoose(window.userInvoices[Number(this.dataset.argIdx)]._dbId)">Pay link ↗</button>`
              : ''}
            <button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7"
              data-arg-idx="${idx}" data-on-click="deleteInvoice(Number(this.dataset.argIdx))">✕</button>
          </span>
        </div>`).join('')
        + (_allInv.length > _shownInv.length
            ? `<div class="table-row" data-style="justify-content:center;padding:10px"><button class="btn btn-ghost btn-sm" data-on-click="window._invShowMore()">Show more — ${_allInv.length - _shownInv.length} of ${_allInv.length} hidden</button></div>`
            : '');
    };


    // ════════════════════════════════════════════
    // 2. EXPENSES
    // ════════════════════════════════════════════

    // Boot: load saved expenses
    async function loadExpensesFromDB() {
      try {
        const _eidExp = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/expenses' + (_eidExp ? '?entity_id=' + _eidExp : ''));
        if (Array.isArray(rows)) {   // C1: an empty answer replaces the list
          const mapped = rows.map(window.mapBizExpenseRow);   // C9: the one mapper (app-main.js) — date, class, location
          if (!window.bizExpenses) window.bizExpenses = [];
          window.bizExpenses = [...mapped, ...window.bizExpenses.filter(e => !e._dbId)];
          if (typeof renderExpenses === 'function') renderExpenses();
        }
      } catch (e) {
        // Ignore — not logged in yet
      }
    }
    loadExpensesFromDB();

    // Patch saveExpense
    window.saveExpense = async function () {
      // C1 Wave 1: in-flight re-entry lock — a double-click / impatient re-click cannot fire a 2nd
      // POST. UX layer only; the durable guarantee is the DB idempotency index (idx_expenses_idem_key).
      if (window._savingExpense) return;
      const desc = (typeof sanitizeText === 'function')
        ? sanitizeText(document.getElementById('bexp-desc')?.value, 300)
        : document.getElementById('bexp-desc')?.value?.trim();
      const amountRaw = (typeof validateAmount === 'function')
        ? validateAmount(document.getElementById('bexp-amount')?.value)
        : parseFloat(document.getElementById('bexp-amount')?.value) || null;

      if (!desc)                             { notify('Description is required', true); return; }
      if (amountRaw === null || amountRaw <= 0) { notify('A valid positive amount is required', true); return; }

      const cat = document.getElementById('bexp-cat')?.value  || 'Other';
      const ded = document.getElementById('bexp-ded')?.value  || 'no';
      // M49: the date the user picked (default today). An expense used to be stamped "today" always, so a back-dated
      // receipt filed into the wrong period.
      const _expDateIn = (document.getElementById('bexp-date')?.value || '').trim();
      if (_expDateIn && !/^\d{4}-\d{2}-\d{2}$/.test(_expDateIn)) { notify('Enter a valid date', true); return; }
      const expense_date = _expDateIn || (window.todayLocal ? window.todayLocal() : new Date().toISOString().slice(0, 10));

      // One idempotency token per submit-intent: minted lazily now, reused on any retry of THIS
      // modal, reset to null on modal open (openExpenseModal) and on success below. A double-submit
      // of the same intent reuses it (→ DB dedupes); a genuine new expense from a reopened modal
      // gets a fresh token and is allowed.
      window._expIdemKey = window._expIdemKey || (window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : 'exp-' + Date.now() + '-' + Math.random().toString(36).slice(2));

      window._savingExpense = true;
      const _expSaveBtn = document.querySelector('#expense-modal .btn-primary');
      if (_expSaveBtn) _expSaveBtn.disabled = true;
      try {
        const _activeEnt2 = (window.ENTITIES || []).find(e => e.active);
        const _entityId2 = _activeEnt2?._dbId || null;

        const saved = await api('POST', '/api/expenses', {
          description: desc,
          category:    cat,
          amount:      amountRaw,
          deductible:  ded,
          expense_date,   // M49: the picked date (C3/F37: a calendar date, never a UTC instant)
          entity_id: _entityId2,
          class:    (document.getElementById('bexp-class') && document.getElementById('bexp-class').value.trim()) || undefined,
          location: (document.getElementById('bexp-location') && document.getElementById('bexp-location').value.trim()) || undefined,
          vendor: (document.getElementById('bexp-vendor') && document.getElementById('bexp-vendor').value.trim()) || undefined,   // FA-M9
          idempotency_key: window._expIdemKey,   // C1 Wave 1 — the token idx_expenses_idem_key enforces
        });

        if (!window.bizExpenses) window.bizExpenses = [];
        window.bizExpenses.unshift({
          _dbId:  saved.id,
          desc,
          cat,
          amount: amountRaw,
          ded,
          date:   window.FinFlowDates ? window.FinFlowDates.fmtLabel(expense_date) : expense_date,   // M49
        });

        window._expIdemKey = null;   // success → the next expense mints a fresh token
        closeModal('expense-modal');
        if (typeof renderExpenses === 'function') renderExpenses();
        notify('Expense logged ✦');
        loadExpensesFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) {
        // Keep _expIdemKey so a manual retry of this SAME submit is idempotent (same token → 23505 → original row).
        notify('Could not log expense — ' + e.message, true);
      } finally {
        window._savingExpense = false;
        if (_expSaveBtn) _expSaveBtn.disabled = false;
      }
    };

    // New: deleteExpense
    window.deleteExpense = async function (idx) {
      const exp = window.bizExpenses[idx];
      if (!exp) return;
      if (!(await window._confirmModal(`Delete expense "${exp.desc}"? This cannot be undone.`, {danger:true}))) return;
      try {
        if (exp._dbId) await api('DELETE', `/api/expenses/${exp._dbId}`);
        window.bizExpenses.splice(idx, 1);
        if (typeof renderExpenses === 'function') renderExpenses();
        notify('Expense deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) {
        notify('Could not delete expense — ' + e.message, true);
      }
    };

    // Patch renderExpenses to show delete button
    window.renderExpenses = function () {
      if (typeof updateExpenses === 'function') updateExpenses();
      const el = document.getElementById('expense-list');
      if (!el) return;
      el.innerHTML = (window.bizExpenses||[]).slice(0, 20).map((e, idx) => `
        <div class="tx-row" data-style="display:flex;align-items:center;justify-content:space-between">
          <div data-style="flex:1">
            <div class="tx-name">${esc(e.desc)}</div>
            <div class="tx-cat">${esc(e.cat)} · ${esc(e.date)}${(() => { const f = window.FinFlowDates.deductibleFactor(e.ded);   // M15
              return f === 1 ? ' · 100% deductible' : f === 0.5 ? ' · 50% deductible' : ''; })()}</div>
          </div>
          <div data-style="display:flex;align-items:center;gap:8px">
            <div class="tx-amt dn">-${S(e.amount)}</div>
            ${e._dbId ? `<button class="btn btn-ghost btn-sm" data-style="padding:2px 6px" title="Edit"
              data-arg-idx="${idx}" data-on-click="editExpense(Number(this.dataset.argIdx))">✏</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7;padding:2px 6px"
              data-arg-idx="${idx}" data-on-click="deleteExpense(Number(this.dataset.argIdx))">✕</button>
          </div>
        </div>`).join('');
    };


    // ════════════════════════════════════════════
    // 3. INVENTORY
    // ════════════════════════════════════════════

    // Boot: load saved inventory
    let _inventoryFetched = false;

    async function loadInventoryFromDB() {
      try {
        const _eidInv = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/inventory' + (_eidInv ? '?entity_id=' + _eidInv : ''));
        _inventoryFetched = true;
        console.log('[Inventory] API returned', rows ? rows.length : 0, 'rows');
        if (Array.isArray(rows)) {   // C1: an empty answer replaces the list (an empty business kept the previous one's stock)
          const mapped = rows.map(r => ({
            _dbId: r.id,
            sku:   r.sku,
            name:  r.name,
            units: r.units,
            max:   r.max_units || 200,
            reorder_level: r.reorder_level != null && r.reorder_level !== '' ? Number(r.reorder_level) : null,   // G5
            cost:  r.cost,
            low:   !!r.low_stock,
          }));
          window.inventory = [...mapped, ...(window.inventory || []).filter(i => !i._dbId)];
          if (typeof renderInventory === 'function') renderInventory();
          if (_itemsFetched && typeof window.renderItems === 'function') window.renderItems();   // LA16: Items lists stock too
        }
      } catch (e) {
        console.warn('[Inventory] loadInventoryFromDB failed:', e.message);
      }
    }
    loadInventoryFromDB();

    function nextSku() {
      const nums = (window.inventory || [])
        .map(i => parseInt((i.sku || '').replace(/\D/g, ''), 10))
        .filter(n => !isNaN(n));
      const max = nums.length ? Math.max(...nums) : 1047;
      return '#' + String(max + 1).padStart(4, '0');
    }

    // Patch openProductModal to pre-fill SKU with next available number
    window.openProductModal = function () {
      const skuEl = document.getElementById('prod-sku');
      if (skuEl) skuEl.value = nextSku();
      openModal('product-modal');
    };

    // Patch saveProduct (add new inventory item)
    window.saveProduct = async function () {
      const name = (typeof sanitizeText === 'function')
        ? sanitizeText(document.getElementById('prod-name')?.value, 200)
        : document.getElementById('prod-name')?.value?.trim();
      if (!name) { notify('Product name is required', true); return; }

      const unitsRaw = parseInt(document.getElementById('prod-units')?.value) || 0;
      const units    = Math.max(0, Math.min(unitsRaw, 1000000));
      const costRaw  = (typeof validateAmount === 'function')
        ? validateAmount(document.getElementById('prod-cost')?.value)
        : parseFloat(document.getElementById('prod-cost')?.value) || 0;
      const cost     = costRaw !== null ? costRaw : 0;
      const thresh   = Math.max(0, parseInt(document.getElementById('prod-thresh')?.value) || 20);
      const skuInput = document.getElementById('prod-sku')?.value?.trim();
      const sku      = skuInput || nextSku();
      const max      = Math.max(units * 2, 100);

      try {
        const _eidProd = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        const saved = await api('POST', '/api/inventory', {
          sku,
          name,
          units,
          max_units: max,
          cost,
          entity_id: _eidProd,
        });

        if (!window.inventory) window.inventory = [];
        window.inventory.push({
          _dbId: saved.id,
          sku,
          name,
          units,
          max,
          cost,
          low: units < thresh,
        });

        closeModal('product-modal');
        if (typeof renderInventory === 'function') renderInventory();
        notify(`${name} added to inventory ✦`);
        loadInventoryFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not add product — ' + e.message, true);
      }
    };

    // Tracks the _dbId (or index for local-only items) of the item being restocked
    let _restockDbId = null;
    let _restockLocalIdx = -1;

    // Patch restockItem to open modal instead of prompt()
    window.restockItem = async function (idx) {
      if (!window.inventory || !Array.isArray(window.inventory)) {
        await loadInventoryFromDB();
      }
      if (!window.inventory || idx < 0 || idx >= window.inventory.length) return;
      const item = window.inventory[idx];
      _restockDbId = item._dbId || null;
      _restockLocalIdx = item._dbId ? -1 : idx;
      const titleEl = document.getElementById('restock-modal-title');
      if (titleEl) titleEl.textContent = `Restock ${item.name}`;
      const qtyEl = document.getElementById('restock-qty');
      if (qtyEl) { qtyEl.value = ''; }
      openModal('restock-modal');
    };

    window.saveRestock = async function () {
      // Find item by _dbId (stable) rather than by index (shifts on array changes)
      const item = _restockDbId != null
        ? (window.inventory || []).find(i => i._dbId === _restockDbId)
        : (window.inventory || [])[_restockLocalIdx];
      if (!item) { closeModal('restock-modal'); return; }

      const qtyRaw = parseInt(document.getElementById('restock-qty')?.value);
      if (!qtyRaw || isNaN(qtyRaw) || qtyRaw <= 0) {
        notify('Enter a valid quantity', true);
        return;
      }
      const qty = Math.min(qtyRaw, 100000);
      try {
        if (item._dbId) {
          // N69: a restock is a purchase at the item's unit cost — the server records the movement (FIFO
          // layer + ledger) and returns the new units. It used to PUT units += qty with no cost behind it.
          const saved = await api('POST', `/api/inventory/${item._dbId}/restock`, { qty, unit_cost: item.cost });
          item.units = parseFloat(saved && saved.units) || (item.units + qty);
        } else {
          item.units += qty;
        }
        item.low = item.units < item.max * 0.1;
        closeModal('restock-modal');
        if (typeof renderInventory === 'function') renderInventory();
        notify(`+${qty} units added to ${esc(item.name)} ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not restock — ' + e.message, true);
      }
    };

    // New: deleteInventoryItem
    window.deleteInventoryItem = async function (idx) {
      const item = window.inventory[idx];
      if (!item) return;
      if (!(await window._confirmModal(`Delete "${item.name}" from inventory? This cannot be undone.`, {danger:true}))) return;
      try {
        if (item._dbId) await api('DELETE', `/api/inventory/${item._dbId}`);
        window.inventory.splice(idx, 1);
        if (typeof renderInventory === 'function') renderInventory();
        notify('Item removed from inventory');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not delete item — ' + e.message, true);
      }
    };

    // Patch renderInventory to show delete button
    window.renderInventory = function () {
      // If DB data hasn't been fetched yet (e.g. user wasn't authed at boot), fetch now
      if (!_inventoryFetched) {
        loadInventoryFromDB(); // async — will re-render when data arrives
      }
      if (!window.inventory) window.inventory = [];
      const lowCount = window.inventory.filter(i => i.low).length;   // G5: the server's flag, set by the one rule (FinFlowDates.isLowStock)
      // KPI cards: Total SKUs · Inventory value (units × cost) · Low stock · COGS
      const _invKpi = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      _invKpi('inv-skus', window.inventory.length);
      // C7: stock on hand at FIFO cost from the server (/api/cogs inventoryValue) — the Balance Sheet's figure. It was
      // units × the item's current cost field (75 vs the Balance Sheet's 90). "—" until loaded, never a different number.
      _invKpi('inv-value', window._inventoryValue != null ? S(window._inventoryValue) : '—');
      // LR31: never while a loadCOGS is running — its own repaint lands here, and a reply without the value looped forever.
      if (window._inventoryValue == null && !window._cogsLoading && typeof window.loadCOGS === 'function') { try { window.loadCOGS(); } catch (e) {} }
      _invKpi('inv-lowstock', lowCount);
      // F-K1: COGS is cost of goods SOLD (FIFO, server /api/cogs), NOT inventory value (units×cost).
      // The old units×cost duplicated the Inventory-value KPI and contradicted the FIFO COGS Summary.
      _invKpi('inv-cogs',  S(window._cogsTotal || 0));
      // LR15: _cogsTotal is the SELECTED period's COGS (every writer fetches /api/cogs for the dashboard period) — the
      // card says which period, never a fixed "this month" on a year figure.
      { const _cl = document.getElementById('inv-cogs-label');
        let _pl = ''; try { _pl = (typeof window.getPeriodData === 'function' ? window.getPeriodData() : getPeriodData()).label || ''; } catch (e) {}
        if (_cl) _cl.textContent = 'COGS' + (_pl ? ' · ' + _pl : ''); }
      if (typeof window.loadCOGS === 'function' && window._cogsTotal == null && !window._cogsLoading) { try { window.loadCOGS(); } catch (e) {} }
      window._refreshDashboardUI?.();
      const badge2 = document.getElementById('badge-inv2');
      if (badge2) {
        badge2.textContent = lowCount;
        badge2.style.display = lowCount > 0 ? '' : 'none';
      }
      const el = document.getElementById('inventory-list');
      if (!el) return;
      el.innerHTML = window.inventory.map((item, idx) => {
        const pct = Math.min(100, Math.round(item.units / item.max * 100));
        const col = pct < 10 ? 'var(--red)' : pct < 20 ? 'var(--amber)' : 'var(--green)';
        const val = window._invItemValue(item);   // LA5: FIFO value of what is left — the card's figure, per item
        return `<div class="inv-item-row">
          <span data-style="color:var(--t3);font-family:var(--font-mono)">${esc(item.sku)}</span>
          <span>${esc(item.name)}</span>
          <span data-style="color:${item.low ? 'var(--red)' : 'var(--t1)'}">${item.units} units${item.low ? ' ⚠' : ''}</span>
          <div class="stock-bar"><div class="stock-fill" data-style="width:${pct}%;background:${col}"></div></div>
          <span data-style="color:${item.low ? 'var(--red)' : 'var(--t1)'}">${val == null ? '—' : S(val)}</span>
          <span class="table-actions">
            ${item._dbId ? `<button class="btn btn-ghost btn-sm" data-arg-idx="${idx}" data-on-click="openStockInModal(Number(this.dataset.argIdx))" title="Record a purchase (adds a FIFO cost layer)">+ In</button><button class="btn btn-ghost btn-sm" data-arg-idx="${idx}" data-on-click="openStockOutModal(Number(this.dataset.argIdx))" title="Record a sale (its receipt or invoice is made with it) or a write-off">− Out</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-arg-idx="${idx}" data-on-click="restockItem(Number(this.dataset.argIdx))">Restock</button>
            ${item._dbId ? `<button class="btn btn-ghost btn-sm" data-arg-db-id="${item._dbId}" data-on-click="openEditInvModal(Number(this.dataset.argDbId))">Edit</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7"
              data-arg-idx="${idx}" data-on-click="deleteInventoryItem(Number(this.dataset.argIdx))">✕</button>
          </span>
        </div>`;
      }).join('');
    };


    // ════════════════════════════════════════════
    // 4. PAYROLL
    // ════════════════════════════════════════════

    // Note: payroll loading is now driven by loadEntityData() in index.html
    // which fetches /api/payroll?entity_id=X per-entity and populates
    // window.ownerPayrollByEntity correctly. We no longer do an unscoped
    // /api/payroll GET here — that returned ALL rows and mis-mapped the
    // owner entry to the wrong entity index.
    //
    // For showPage/refresh hooks that need to reload payroll for the active
    // entity, delegate to loadEntityData(activeIdx) which handles both
    // employees and owner-per-entity restoration.
    async function loadPayrollFromDB() {
      const ents = window.ENTITIES || [];
      const activeIdx = ents.findIndex(e => e.active);
      if (activeIdx < 0 || !ents[activeIdx]?._dbId) return;
      if (typeof window.loadEntityData === 'function') {
        try { await window.loadEntityData(activeIdx); } catch (e) { console.warn('[Payroll] reload via loadEntityData failed:', e.message); }
      }
    }

    // Override renderPayroll to read from window.ownerPayroll (set by loadPayrollFromDB).
    // `let ownerPayroll` in index.html is script-scoped — not accessible via window —
    // so loadPayrollFromDB correctly sets window.ownerPayroll but the original renderPayroll
    // reads the stale let-binding. This override reads from window.* instead.
    window.renderPayroll = function () {
      const op      = window.ownerPayroll || null;
      const emps    = window.payrollEmployees || [];
      const allEmps = op ? [{...op, isOwner:true}, ...emps] : emps;
      const fn      = typeof esc === 'function' ? esc : (s => String(s == null ? '' : s).replace(/</g,'&lt;').replace(/>/g,'&gt;'));
      const sm      = typeof S   === 'function' ? S   : (n => '$' + (parseFloat(n)||0).toLocaleString());
      const set     = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      const totalGross = allEmps.reduce((a, e) => a + (parseFloat(e.gross)   || 0), 0);
      const totalDed   = allEmps.reduce((a, e) => a + (window.dedTotal ? window.dedTotal(e.gross, e.deductions) : 0), 0);
      set('pr-total',    sm(totalGross));
      set('pr-headcount', allEmps.length + (allEmps.length !== 1 ? ' people' : ' person') + ' · planned per month');   // E2E-3: a plan, not this month's cost
      set('pr-tax',      sm(totalDed));

      if (op) {
        set('pr-owner-net',   sm(op.net));
        set('pr-owner-label', 'Your planned net salary / month');   // E2E-3: the roster — Personal gets it only from a PAID run
        const ownerCta    = document.getElementById('owner-cta');
        if (ownerCta)    ownerCta.style.display    = 'none';
        const payrollLink = document.getElementById('payroll-link-card');
        if (payrollLink) payrollLink.style.display  = 'flex';
        const linkNet     = document.getElementById('link-net-display');
        if (linkNet)     linkNet.textContent = sm(op.net) + '/mo';
      } else {
        set('pr-owner-net',   '—');
        set('pr-owner-label', 'Not on payroll');
        const ownerCta    = document.getElementById('owner-cta');
        if (ownerCta)    ownerCta.style.display    = 'block';
        const payrollLink = document.getElementById('payroll-link-card');
        if (payrollLink) payrollLink.style.display  = 'none';
        set('link-net-display', '—');   // C1: never keep another business's figure, even hidden
      }

      const list = document.getElementById('payroll-list');
      if (!list) return;
      list.innerHTML = allEmps.map(e => {
        const net      = window.netFromDeductions ? window.netFromDeductions(e.gross, e.deductions) : (parseFloat(e.gross)||0);
        const tax      = window.dedTotal ? window.dedTotal(e.gross, e.deductions) : 0;
        const initials = e.initials || (typeof getInitials === 'function' ? getInitials(e.fname, e.lname) : ((e.fname||'')[0] + ((e.lname||'')[0]||'')).toUpperCase());
        return `<div class="payroll-row">
          <div class="emp-info">
            <div class="emp-init ${e.avClass||'av-blue'}">${initials}</div>
            <div><div class="emp-name">${fn(e.fname)} ${fn(e.lname)}${e.isOwner ? ' <span class="badge b-blue" data-style="font-size:9px">You</span>' : ''}</div><div class="emp-role">${fn(e.type||'Full-time')}</div></div>
          </div>
          <span data-style="color:var(--t2);font-size:12px">${fn(e.role||'')}</span>
          <!-- PL#9 root fix: this override is the RUNTIME renderPayroll (it shadows the app-main
               copy the earlier 2a70564 fix patched, so that fix never rendered). Gross was missing
               a color token and inherited a near-black default — invisible on the dark table while
               its Net sibling (which sets color) stayed legible. Themed via --t1 (legible in BOTH
               light and dark), matching Net. -->
          <span data-style="font-family:var(--font-mono);color:var(--t1)">${sm(e.gross)}</span>
          <span data-style="color:var(--red);font-family:var(--font-mono)">${tax > 0 ? '-' + sm(tax) : '—'}</span>
          <span data-style="font-weight:600;font-family:var(--font-mono);color:${e.isOwner?'var(--acc)':'var(--t1)'}">${sm(net)}</span>
          ${e.isOwner
            ? `<button class="btn-icon" data-on-click="openOwnerModal()" title="Edit" data-style="border:none;background:none;color:var(--acc)"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11 2l3 3L5 14H2v-3z"/></svg></button>`
            : `<span data-style="display:inline-flex;gap:2px;align-items:center">
                 <button class="btn-icon" data-arg-id="${e._dbId||e.id||0}" data-on-click="openEditEmployee(Number(this.dataset.argId))" title="Edit employee" data-style="border:none;background:none;color:var(--t3);cursor:pointer;padding:4px"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11 2l3 3L5 14H2v-3z"/></svg></button>
                 <button class="btn-icon" data-arg-id="${e._dbId||e.id||0}" data-on-click="deleteEmployee(Number(this.dataset.argId))" title="Remove employee" data-style="border:none;background:none;color:var(--red);cursor:pointer;padding:4px;opacity:.75"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4h11M6 4V2.5h4V4M5 4l.7 9.5h4.6L15 4z" transform="scale(0.9) translate(1,0)"/></svg></button>
               </span>`}
        </div>`;
      }).join('');
    };

    // Patch saveOwnerPayroll to persist per-entity to DB
    const _origSaveOwnerPayroll = window.saveOwnerPayroll;
    window.saveOwnerPayroll = async function () {
      // Run the original in-memory save first
      if (typeof _origSaveOwnerPayroll === 'function') _origSaveOwnerPayroll();

      // Persist every entity's owner payroll to DB, each scoped to its entity_id
      const byEntity = window.ownerPayrollByEntity || {};
      const ENTITIES = window.ENTITIES || [];

      console.log('[Payroll Save] ownerPayrollByEntity keys:', Object.keys(byEntity), '| ENTITIES:', ENTITIES.map(e=>e.name+'('+e._dbId+')'));
      try {
        for (const [idxStr, op] of Object.entries(byEntity)) {
          const idx = parseInt(idxStr);
          const entity = ENTITIES[idx];
          const entityDbId = entity?._dbId || null;

          if (op._dbId) {
            // Update existing record
            console.log('[Payroll Save] PUT /api/payroll/' + op._dbId, '| entity:', entity?.name, '| gross:', op.gross);
            await api('PUT', `/api/payroll/${op._dbId}`, {
              fname:     op.fname,
              lname:     op.lname,
              role:      op.role,
              emp_type:  op.type,
              gross:     op.gross,
              deductions: op.deductions || [],
              av_class:  op.avClass || 'av-blue',
              entity_id: entityDbId,
            });
            console.log('[Payroll Save] PUT success for dbId:', op._dbId);
          } else {
            // Create new record scoped to this entity
            const payload = {
              fname:     op.fname,
              lname:     op.lname,
              role:      op.role     || 'CEO / Founder',
              emp_type:  op.type     || 'owner',
              gross:     op.gross,
              deductions: op.deductions || [],
              av_class:  op.avClass  || 'av-blue',
              is_owner:  true,
              entity_id: entityDbId,
            };
            console.log('[Payroll Save] POST /api/payroll', payload);
            const saved = await api('POST', '/api/payroll', payload);
            console.log('[Payroll Save] POST response:', saved);
            // Store DB id back so next save does a PUT
            byEntity[idxStr]._dbId = saved.id;
            if (window.ownerPayroll && !window.ownerPayroll._dbId) {
              window.ownerPayroll._dbId = saved.id;
            }
          }
        }
        console.log('[Payroll Save] ✅ Owner payroll persisted per-entity. window.ownerPayroll:', window.ownerPayroll);

        // M14 (money audit 2026-10-09; Rule 12): saving the owner's salary NO LONGER creates a recurring
        // personal-income profile or a "this month" occurrence. The salary saved here is the ROSTER — a template
        // for payroll runs — and it produced personal income for months no run was approved, paid or voided. The
        // owner's personal salary income now comes from PAID payroll runs (server: syncOwnerSalaryFromRun, at
        // mark-paid; removed again on void), the same single source as the business's payroll expense.

        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
        if (typeof window.loadPersonalFinance === 'function') {
          window.loadPersonalFinance().catch(() => {});
        }
        if (window.finflow?.refresh) window.finflow.refresh(['personal-finance']);
      } catch (e) {
        console.error('[Payroll Save] ❌ Failed:', e.message);
        notify('Payroll saved locally but could not sync to server — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // INVENTORY EDIT
    // ════════════════════════════════════════════

    let _editInvDbId = null;

    window.openEditInvModal = function (dbId) {
      const item = (window.inventory || []).find(i => i._dbId === dbId);
      if (!item) return;
      _editInvDbId = dbId;
      document.getElementById('edit-inv-name').value  = item.name  || '';
      document.getElementById('edit-inv-units').value = item.units != null ? item.units : '';
      document.getElementById('edit-inv-cost').value  = item.cost  != null ? item.cost  : '';
      document.getElementById('edit-inv-max').value   = item.max   != null ? item.max   : 200;
      { const _r = document.getElementById('edit-inv-reorder'); if (_r) _r.value = item.reorder_level != null ? item.reorder_level : ''; }   // G5
      openModal('edit-inv-modal');
    };

    window.saveEditInv = async function () {
      const item = (window.inventory || []).find(i => i._dbId === _editInvDbId);
      if (!item) { closeModal('edit-inv-modal'); return; }
      const name = document.getElementById('edit-inv-name')?.value?.trim();
      if (!name) { notify('Name is required', true); return; }
      const units = item.units;   // N69: read-only here — Stock In / Stock Out / Restock change it
      const cost  = parseFloat(document.getElementById('edit-inv-cost')?.value)  || 0;
      const max   = Math.max(1, parseInt(document.getElementById('edit-inv-max')?.value)   || 200);
      try {
        const _rv = (document.getElementById('edit-inv-reorder') || {}).value;   // G5: '' clears it
        const reorder_level = _rv == null || String(_rv).trim() === '' ? '' : parseInt(_rv, 10);
        await api('PUT', `/api/inventory/${item._dbId}`, { name, cost, max_units: max, reorder_level });   // N69: units change only via stock movements
        item.name  = name;
        item.units = units;
        item.cost  = cost;
        item.max   = max;
        item.reorder_level = reorder_level === '' ? null : reorder_level;
        item.low   = window.FinFlowDates.isLowStock({ units, reorder_level: item.reorder_level, max_units: max });   // G5: the one rule
        closeModal('edit-inv-modal');
        if (typeof renderInventory === 'function') renderInventory();
        notify(`${esc(name)} updated ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not save — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 5. ITEMS PAGE
    // ════════════════════════════════════════════

    let _itemsFetched = false;

    async function loadItemsFromDB() {
      try {
        const rows = await api('GET', '/api/items');
        _itemsFetched = true;
        console.log('[Items] API returned', rows ? rows.length : 0, 'rows');
        window.itemsData = (rows || []).map(r => ({
          _dbId:  r.id,
          name:   r.name,
          type:   r.type,
          price:  r.price,
          unit:   r.unit,
          stock:  r.stock,
          status: r.status,
          sku:    r.sku || '',
          cost:   r.cost != null ? r.cost : null,
        }));
        window.items = window.itemsData;
        if (typeof renderItems === 'function') renderItems();
      } catch (e) {
        console.warn('[Items] loadItemsFromDB failed:', e.message);
      }
    }
    loadItemsFromDB();

    function renderItemRow(i) {
      return `<div class="table-row" data-style="grid-template-columns:1fr 80px 80px 70px 80px 60px">
        <span data-style="font-weight:500">${esc(i.name)}<br><span data-style="font-size:11px;color:var(--t3)">${esc(i.sku || '')}</span></span>
        <span><span class="badge ${i.type === 'Service' ? 'b-blue' : 'b-purple'}">${esc(i.type)}</span></span>
        <span data-style="font-family:var(--font-mono)">${(window._nativeSymbol ? window._nativeSymbol() : '$') + (parseFloat(i.price) || 0).toLocaleString('en-US', { minimumFractionDigits: (parseFloat(i.price) || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}<span data-style="font-size:10px;color:var(--t3)">/${esc(i.unit || '')}</span></span>
        <span data-style="color:var(--t2)">${i.stock != null ? i.stock + ' units' : '—'}</span>
        <span><span class="badge ${i.status === 'Active' ? 'b-green' : i.status === 'Low Stock' ? 'b-amber' : 'b-red'}">${esc(i.status || '')}</span></span>
        <div class="table-actions">
          <button class="btn btn-ghost btn-sm" data-arg-db-id="${i._dbId}" data-on-click="openEditItemModal(Number(this.dataset.argDbId))">Edit</button>
          <button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-db-id="${i._dbId}" data-on-click="deleteItem(Number(this.dataset.argDbId))">✕</button>
        </div>
      </div>`;
    }

    // LA16 (HANDOVER C19 Items; owner decision 2026-10-14: ONE product list). Stocked products (Inventory) are listed
    // on Items too, read-only, opening Inventory — a business with stock but no catalogue entries read "0 items".
    // A product already in the catalogue (same SKU, or same name when it has no SKU) is listed once, as the item.
    function _stockOnlyItems(data) {
      const k = v => String(v || '').trim().toLowerCase();
      const skus = new Set(data.map(i => k(i.sku)).filter(Boolean)), names = new Set(data.map(i => k(i.name)));
      return (window.inventory || []).filter(iv => iv && iv._dbId != null && !(iv.sku ? skus.has(k(iv.sku)) : names.has(k(iv.name))))
        .map(iv => ({ _stock: true, _invDbId: iv._dbId, name: iv.name, sku: iv.sku || '', type: 'Stock item',
          stock: parseFloat(iv.units) || 0, status: 'Active', low: !!iv.low }));   // G5: low stock is shown, never a status
    }
    function renderStockItemRow(i) {
      return `<div class="table-row" data-style="grid-template-columns:1fr 80px 80px 70px 80px 60px">
        <span data-style="font-weight:500">${esc(i.name)}<br><span data-style="font-size:11px;color:var(--t3)">${esc(i.sku || '')}</span></span>
        <span><span class="badge b-amber">Stock item</span></span>
        <span data-style="color:var(--t3)" title="Stock is valued on Inventory; add it as an item to set a sale price">—</span>
        <span data-style="color:var(--t2)">${i.stock} units</span>
        <span><span class="badge ${i.status === 'Active' ? 'b-green' : 'b-amber'}">${esc(i.status)}</span>${i.low ? ' <span class="badge b-amber" title="At or below its reorder level">Low</span>' : ''}</span>
        <div class="table-actions"><button class="btn btn-ghost btn-sm" data-on-click="showPage('inventory')">Inventory</button></div>
      </div>`;
    }

    window.renderItems = function (filter) {
      if (filter === undefined) filter = window.itemsFilter || 'all';
      window.itemsFilter = filter;
      const list = document.getElementById('items-list');
      if (!list) return;

      // If DB data hasn't been fetched yet, kick off a load and show a loading state
      if (!_itemsFetched) {
        loadItemsFromDB(); // async — will call renderItems() again when data arrives
        list.innerHTML = '<div data-style="padding:2rem;text-align:center;color:var(--t3)">Loading…</div>';
        return;
      }

      const data = window.itemsData || [];
      const stockOnly = _stockOnlyItems(data);   // LA16
      const all = data.concat(stockOnly);
      // KPI cards: Total Items · Active · Low Stock · Avg Margin
      // Items only carry a price (no cost), so margin can't be computed;
      // we show "—" rather than invent a percentage.
      const _itKpi = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      _itKpi('items-total', all.length);
      _itKpi('items-active', all.filter(i => i.status === 'Active').length);
      _itKpi('items-lowstock', (window.inventory || []).filter(i => i.low).length);   // G5: the same figure as Inventory's alerts
      const _withMargin = data.filter(i => (parseFloat(i.price) || 0) > 0 && i.cost != null && (parseFloat(i.cost) || 0) > 0);
      const _avgMargin = _withMargin.length
        ? Math.round(_withMargin.reduce((s, i) => s + (i.price - i.cost) / i.price * 100, 0) / _withMargin.length)
        : null;
      _itKpi('items-margin', _avgMargin != null ? _avgMargin + '%' : '—');
      window._refreshDashboardUI?.();
      const filtered = all.filter(i => filter === 'all' || (i._stock ? filter === 'product' : (i.type || '').toLowerCase() === filter));
      list.innerHTML = filtered.length
        ? filtered.map(i => i._stock ? renderStockItemRow(i) : renderItemRow(i)).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No items found</div>';
    };

    window.filterItems = function (f) { window.renderItems(f); };

    window.filterItemsBySearch = function (v) {
      const data = window.itemsData || [];
      const list = document.getElementById('items-list');
      if (!list) return;
      const q = v.toLowerCase();
      const filtered = data.concat(_stockOnlyItems(data)).filter(i =>   // LA16: search covers stock items
        String(i.name || '').toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q)
      );
      list.innerHTML = filtered.length
        ? filtered.map(i => i._stock ? renderStockItemRow(i) : renderItemRow(i)).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No items found</div>';
    };

    let _itemModalMode = 'new';
    let _editItemDbId  = null;

    window.openNewItemModal = function () {
      _itemModalMode = 'new';
      _editItemDbId  = null;
      document.getElementById('item-modal-title').textContent = 'New Item';
      ['item-name', 'item-sku', 'item-price', 'item-cost', 'item-unit', 'item-stock'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const typeEl = document.getElementById('item-type');
      if (typeEl) typeEl.value = 'Product';
      const unitEl = document.getElementById('item-unit');
      if (unitEl) unitEl.value = 'each';
      const statusEl = document.getElementById('item-status');
      if (statusEl) statusEl.value = 'Active';
      openModal('item-modal');
    };

    window.openEditItemModal = function (dbId) {
      const data = window.itemsData || [];
      const item = data.find(i => i._dbId === dbId);
      if (!item) return;
      _itemModalMode = 'edit';
      _editItemDbId  = dbId;
      document.getElementById('item-modal-title').textContent = 'Edit Item';
      document.getElementById('item-name').value   = item.name   || '';
      document.getElementById('item-type').value   = item.type   || 'Product';
      document.getElementById('item-price').value  = item.price  != null ? item.price  : '';
      document.getElementById('item-cost').value   = item.cost   != null ? item.cost   : '';
      document.getElementById('item-unit').value   = item.unit   || 'each';
      document.getElementById('item-stock').value  = item.stock  != null ? item.stock  : '';
      document.getElementById('item-status').value = (item.status === 'Inactive') ? 'Inactive' : 'Active';   // FA-M6: low stock is worked out, never a status
      document.getElementById('item-sku').value    = item.sku    || '';
      openModal('item-modal');
    };

    window.saveItem = async function () {
      const name = document.getElementById('item-name')?.value?.trim();
      if (!name) { notify('Name is required', true); return; }
      const type   = document.getElementById('item-type')?.value   || 'Product';
      const price  = parseFloat(document.getElementById('item-price')?.value)  || 0;
      const costEl = document.getElementById('item-cost');
      const cost   = costEl?.value !== '' && costEl?.value != null ? (parseFloat(costEl.value) || null) : null;
      const unit   = document.getElementById('item-unit')?.value?.trim() || 'each';
      const stockEl = document.getElementById('item-stock');
      const stock  = stockEl?.value !== '' && stockEl?.value != null ? parseInt(stockEl.value) : null;
      const status = document.getElementById('item-status')?.value  || 'Active';
      const sku    = document.getElementById('item-sku')?.value?.trim() || '';
      try {
        if (_itemModalMode === 'edit' && _editItemDbId != null) {
          await api('PUT', `/api/items/${_editItemDbId}`, { name, type, price, cost, unit, stock, status, sku });
          const item = (window.itemsData || []).find(i => i._dbId === _editItemDbId);
          if (item) Object.assign(item, { name, type, price, cost, unit, stock, status, sku });
        } else {
          const saved = await api('POST', '/api/items', { name, type, price, cost, unit, stock, status, sku });
          if (!window.itemsData) window.itemsData = [];
          window.itemsData.unshift({ _dbId: saved.id, name, type, price, cost, unit, stock, status, sku });
        }
        closeModal('item-modal');
        window.items = window.itemsData;
        if (typeof renderItems === 'function') renderItems();
        notify(`${esc(name)} saved ✦`);
        loadItemsFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not save item — ' + e.message, true);
      }
    };

    window.deleteItem = async function (dbId) {
      const item = (window.itemsData || []).find(i => i._dbId === dbId);
      if (!item) return;
      if (!(await window._confirmModal(`Delete "${item.name}"? This cannot be undone.`, {danger:true}))) return;
      try {
        await api('DELETE', `/api/items/${dbId}`);
        window.itemsData = (window.itemsData || []).filter(i => i._dbId !== dbId);
        if (typeof renderItems === 'function') renderItems();
        notify('Item deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not delete item — ' + e.message, true);
      }
    };

    // ── Expose load functions so entity-switch and showPage can reload ─
    window._loadInvoicesFromDB  = loadInvoicesFromDB;
    window._loadExpensesFromDB  = loadExpensesFromDB;
    window._loadInventoryFromDB = loadInventoryFromDB;
    window._loadPayrollFromDB   = loadPayrollFromDB;
    window._loadItemsFromDB     = loadItemsFromDB;

    // ── Scenario BASE sync: populate from real invoice/expense data ───
    // L24 (audit F44): the baseline IS the dashboard's Year — computeRevenue('year') and
    // computeExpenseBreakdown('year').total (issued invoices, receipts, JEs, credit notes; expenses, bills,
    // payments made, payroll runs, vendor credits) plus the fiscal-year COGS, so baseline net profit equals
    // the dashboard's Year net. It used to be paid-only invoices and all-time raw expense rows, no COGS.
    // COGS comes from /api/cogs (period=year); until it lands the last fetched figure for this entity is used,
    // then the scenario repaints once with the fetched value.
    window._syncScenarioBase = function () {
      const rev = typeof window.computeRevenue === 'function' ? (window.computeRevenue('year') || 0) : 0;
      const bd = typeof window.computeExpenseBreakdown === 'function' ? window.computeExpenseBreakdown('year') : null;
      const opex = bd ? (bd.total || 0) : 0;
      const eid = ((window.ENTITIES || []).find(e => e.active) || {})._dbId;
      const cached = window._scenarioCogs && window._scenarioCogs.eid === eid ? window._scenarioCogs.v : 0;
      const exp = opex + cached;
      window.BASE = { rev, exp, cash: 0, burn: exp / 12 };
      if (typeof window._cogsPeriodParams !== 'function') return;
      const qs = window._cogsPeriodParams();
      qs.set('period', 'year'); qs.delete('monthIdx');
      // Resolves once the fetched COGS is in BASE and the scenario has repainted (awaitable by callers/tests).
      window._scenarioBaseReady = apiGetStatus('/api/cogs?' + qs.toString()).then(c => {
        const v = parseFloat(c && c.totalCOGS) || 0;
        window._scenarioCogs = { eid, v };
        if (Math.abs(v - cached) < 0.005) return;
        window.BASE = { rev, exp: opex + v, cash: 0, burn: (opex + v) / 12 };
        if (typeof window.updateScenario === 'function') window.updateScenario();
      }).catch(() => {});
      return window._scenarioBaseReady;
    };

    // ── Entity KPI cards: update after renderEntities() ───────────────
    const _medOrigRenderEntities = window.renderEntities;
    window.renderEntities = function () {
      if (typeof _medOrigRenderEntities === 'function') _medOrigRenderEntities();
      const ents = typeof ENTITIES !== 'undefined' ? ENTITIES : (window.ENTITIES || []);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('ent-count', ents.length);
      const S = v => typeof window.S === 'function' ? window.S(v) : '$' + (parseFloat(v) || 0).toLocaleString();
      const _invSrc = (window._realInvoices && window._realInvoices.length)
        ? window._realInvoices
        : (window.userInvoices || []);
      if (!_invSrc.length && !window._entRevFetching) {
        window._entRevFetching = true;
        // F151: scope this fallback to the ACTIVE entity explicitly (never the session, which the
        // consolidated loop below can transiently move), and guard the write against a switch landing
        // mid-fetch — otherwise an empty active entity fetched the wrong entity's invoices.
        var _aEnt = (window.ENTITIES || []).find(e => e && e.active);
        var _aeq = _aEnt && _aEnt._dbId ? '?entity_id=' + _aEnt._dbId : '';
        var _rSeq = window._entitySwitchSeq || 0;
        fetch('/api/invoices' + _aeq, { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : [])
          .then(rows => {
            window._entRevFetching = false;
            if ((window._entitySwitchSeq || 0) !== _rSeq) return;   // stale — a switch happened, discard
            if (rows && rows.length) { window._realInvoices = rows; if (typeof window.renderEntities === 'function') window.renderEntities(); }
          })
          .catch(() => { window._entRevFetching = false; });
      }
      // F24: populate EVERY entity's canonical P&L from /api/reports?entity_id= (computeBooks —
      // the same basis as the dashboard / books / report routes, incl. FIFO COGS + payroll
      // accrual), then re-render the consolidated view. Previously only the ACTIVE entity got
      // real figures and COGS was hardcoded 0 (so gross profit == revenue). The consolidated
      // KPI cards (ent-consol-rev/profit/margin) are then set by the original renderEntities
      // from getConsolTotal(e.data). Guarded so a re-render we trigger doesn't loop/refetch.
      // FX-CONSOLIDATION FIX: fetch EACH entity in the consolidation currency (server per-leg
      // conversion) so e.data is consol-native; getConsolTotal then plain-SUMS across entities — no
      // client static-rate re-sum (the dashboard consolidated bug), and no extra aggregate fetch.
      if (!window._consolFetching && ents.length) {
        window._consolFetching = true;
        // M23 (money audit 2026-10-09): the CONSOLIDATED column is the server's own consolidation —
        // /api/reports?entity_id=all = computeBooks(null): every entity once, legacy entity-less rows once,
        // converted per leg to the consolidation currency. A plain sum of the per-entity figures counted each
        // entity-less row once PER ENTITY (every entity view includes them by design).
        const _consolCc = window.consolCurrency;
        const _consolP = fetch('/api/reports?entity_id=all' + (_consolCc ? '&display=' + encodeURIComponent(_consolCc) : ''), { credentials: 'same-origin' })
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(d => { window._consolBooks = { currency: _consolCc || null, rev: d.revenue || 0, cogs: d.cogs || 0, grossProfit: d.grossProfit || 0, opex: d.expenses || 0, netProfit: d.netProfit || 0, complete: !(d.fxCoverage && d.fxCoverage.complete === false), intercompany: d.intercompany ? (parseFloat(d.intercompany.revenue) || 0) : null }; })   // LR14: detected internal trade
          .catch(() => { window._consolBooks = { currency: _consolCc || null, unavailable: true }; });
        Promise.all([_consolP].concat(ents.map(e => {
          const _id = e._dbId || e.id;
          if (!_id) return Promise.resolve();
          // Fetch in the CONSOLIDATION currency so columns + total are server-converted & consistent.
          // Skip &display when the entity is ALREADY in that currency (native identity) — avoids running
          // the server FX-conversion path for same-currency entities (perf; result is byte-identical).
          const _cc = window.consolCurrency;
          const _fxDisp = (_cc && _cc !== e.currency) ? ('&display=' + encodeURIComponent(_cc)) : '';
          return fetch('/api/reports?entity_id=' + _id + _fxDisp, { credentials: 'same-origin' })
            // F31: a 200 with real figures (incl. an honest $0 for a genuinely empty
            // entity) populates e.data; a 500 / failed fetch marks the entity UNAVAILABLE
            // so the consolidated view renders "—", never a fabricated $0 for data that
            // actually failed to load (the report layer now throws instead of faking $0).
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => { e.data = { rev: d.revenue || 0, cogs: d.cogs || 0, grossProfit: d.grossProfit || 0, opex: d.expenses || 0, netProfit: d.netProfit || 0 }; })
            .catch(() => { e.data = { unavailable: true }; });
        }))).then(() => {
          window._consolFetching = false;
          if (typeof _medOrigRenderEntities === 'function') _medOrigRenderEntities(); // recompute KPI cards (getConsolTotal sums e.data)
          if (typeof renderConsolPL === 'function') renderConsolPL();                 // consolidated table from server-converted e.data
        });
      }
    };

    // ── Document KPI cards: update after renderDocuments() ────────────
    const _medOrigRenderDocuments = window.renderDocuments;
    if (typeof _medOrigRenderDocuments === 'function') {
      window.renderDocuments = async function () {
        await _medOrigRenderDocuments();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        // FA-P1d: a failed load (or anything that is not a list) shows "—" on every card — not 0, not the last visit's figures.
        if (window._docsLoadFailed || !Array.isArray(window._docsCache)) { ['docs-count', 'docs-storage', 'docs-added'].forEach(id => set(id, '—')); return; }
        const cache = window._docsCache;
        set('docs-count', cache.length);
        // LR13: size is BYTES (a number) — it was parsed as KB. Same formatter as the list (app-main _fmtBytes).
        const totalBytes = cache.reduce((s, d) => s + (parseFloat(d.size) || 0), 0);
        set('docs-storage', typeof window._fmtBytes === 'function' ? (window._fmtBytes(totalBytes) || '0 B') : Math.round(totalBytes) + ' B');
        // F87-class: "this month" by canonical UTC calendar month, not viewer-local
        // getMonth/getFullYear. uploaded_at is a genuine timestamp → phase-1 resolves it in UTC
        // (entity-timezone resolution for genuine timestamps is the unbuilt phase-2 hook).
        const _docToday = (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date()));
        const thisMonth = cache.filter(d => {
          if (!d.uploaded_at) return false;
          const _u = window.FinFlowDates._toYmd(d.uploaded_at);
          return _u != null && _u.slice(0, 7) === _docToday.slice(0, 7);
        });
        set('docs-added', thisMonth.length);
      };
    }

    // ── Timesheet title: set to current month dynamically ─────────────
    function _setTimesheetTitle() {
      const el = document.getElementById('timesheet-title');
      if (!el) return;
      const now = new Date();
      el.textContent = 'Timesheet — ' + now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }

    // ════════════════════════════════════════════
    // BUDGET TARGETS — load + KPI wiring
    // ════════════════════════════════════════════
    // Status-aware GET for the scoped three-state loaders — attaches the HTTP status
    // so a genuine failure (5xx / network) is distinguishable from logged-out (401/403).
    // Local to this scoped surface; the shared api() copies are left untouched.
    async function apiGetStatus(path) {
      const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) { const e = new Error('API error ' + res.status); e.status = res.status; throw e; }
      return res.json();
    }
    // Budget KPI card three-state renderer. 'loaded'/'empty' come from the normal
    // render below (real values / "No targets set"); this handles loading + failed.
    function _budgetSetState(state) {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      const sub = document.getElementById('budget-total-sub');
      if (state === 'loading') {
        ['budget-total', 'budget-spent', 'budget-remaining', 'budget-variance'].forEach(id => set(id, '…'));
        if (sub) { sub.textContent = 'Loading…'; sub.className = 'mc-change neutral'; }
      } else if (state === 'error') {
        ['budget-total', 'budget-spent', 'budget-remaining', 'budget-variance'].forEach(id => set(id, '—'));
        if (sub) {
          sub.innerHTML = 'Unable to load · ' + (window._ffRetryBtn ? window._ffRetryBtn('_loadBudgetFromDB') : 'Retry');
          sub.className = 'mc-change dn';
        }
      }
    }

    async function loadBudgetFromDB() {
      _budgetSetState('loading');
      try {
        const res = await apiGetStatus('/api/budget-targets');
        if (!res || typeof res !== 'object') return;
        // Accept both shapes: flat {Rent:5000} or wrapped {targets:{Rent:5000}}
        const targets = (res.targets && typeof res.targets === 'object') ? res.targets : res;

        // L25 (audit F45): targets are stored ANNUAL (the modal converts monthly × 12), so actuals are THIS FISCAL
        // YEAR's spend per category — the shared breakdown every expense surface uses (D3: direct categories +
        // Payroll + Bills & vendors + Journal entries), matched case-insensitively. It used to be Σ raw expense
        // rows of all time: last year's spend counted against this year, and a Payroll target always read 0.
        const catActuals = {};
        // LR19: the page follows the SELECTED period (Month / Quarter / Year) — actuals for that period from the same
        // breakdown every expense surface uses; the ANNUAL target is scaled to it below (month ÷ 12, quarter ÷ 4).
        const _bp = (typeof currentPeriod !== 'undefined' && currentPeriod) || window.currentPeriod || 'year';
        const _bScale = _bp === 'month' ? 1 / 12 : _bp === 'quarter' ? 1 / 4 : 1;
        let _bLabel = ''; try { _bLabel = (typeof window.getPeriodData === 'function' ? window.getPeriodData() : getPeriodData()).label || ''; } catch (e) {}
        const _bd = typeof window.computeExpenseBreakdown === 'function' ? window.computeExpenseBreakdown(_bp) : null;
        const _rows = typeof window._expenseCategoryRows === 'function' ? window._expenseCategoryRows(_bd, { all: true }) : [];
        _rows.forEach(([cat, v]) => {
          const k = String(cat || 'Other').toLowerCase();
          catActuals[k] = (catActuals[k] || 0) + (parseFloat(v) || 0);
        });

        const COLORS = ['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a'];
        const bd = window.BUDGET_DATA;
        if (bd) { bd.length = 0; }
        // F-G1: only actuals of BUDGETED categories count toward budget usage. Summing ALL expenses
        // (incl. unbudgeted categories like Rent) against a partial budget produced a nonsensical
        // "570% over budget" while the one budgeted category was actually under.
        let totalBudget = 0, totalSpent = 0;

        Object.entries(targets).forEach(([cat, budget], i) => {
          const bAmt = Math.round((parseFloat(budget) || 0) * _bScale * 100) / 100;   // LR19: the annual target for this period
          const actual = catActuals[cat.toLowerCase()] || 0;
          totalBudget += bAmt;
          totalSpent += actual;   // F-G1: budgeted-category actuals only
          if (bd) bd.push({ cat, budget: bAmt, actual, color: COLORS[i % COLORS.length] });
        });

        const remaining = totalBudget - totalSpent;
        const pct = totalBudget > 0 ? Math.round(totalSpent / totalBudget * 100) : 0;
        const sm = v => typeof window.S === 'function' ? window.S(v) : '$' + Math.round(v).toLocaleString();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

        set('budget-total',    sm(totalBudget));
        set('budget-total-sub', totalBudget > 0 ? Object.keys(targets).length + ' categor' + (Object.keys(targets).length === 1 ? 'y' : 'ies') + (_bLabel ? ' · ' + _bLabel : '') : 'No targets set');
        set('budget-spent',    sm(totalSpent));
        set('budget-spent-pct', pct + '% used');
        set('budget-remaining', sm(Math.max(0, remaining)));
        set('budget-remaining-sub', remaining >= 0 ? 'On track' : 'Over budget');
        set('budget-variance',  sm(Math.abs(remaining)));
        set('budget-variance-sub', remaining >= 0 ? 'Under budget' : 'Over budget');

        if (typeof renderBudget === 'function') renderBudget();
      } catch (e) {
        // Logged-out (401/403) or pre-auth: stay silent — correct pre-login behavior.
        // Only a genuinely authenticated failure surfaces the in-place error state.
        if (!window._ffAuthed || e.status === 401 || e.status === 403) return;
        console.warn('[Budget] Load failed:', e.message);
        _budgetSetState('error');
      }
    }
    window._loadBudgetFromDB = loadBudgetFromDB;

    // Budget targets modal — fully editable: user can add, remove, and set
    // monthly/annual targets per category. Saves to /api/budget-targets.
    // FA-B8: the breakdown's own row names (Payroll — not "Salaries", which never matched — the expense categories, Bills & vendors).
    const SUGGESTED_CATS = (window.FinFlowCategories && window.FinFlowCategories.BUDGET_SUGGESTIONS) || ['Payroll', 'Other'];
    const esc = s => String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});

    // LR7: targets are STORED annual. Each row keeps its annual figure in data-bt-annual — the one source of truth; the
    // Annual / Monthly toggle only changes what is DISPLAYED (annual or annual ÷ 12), and only typing changes the
    // figure. It used to relabel the view without converting the rows, then multiply every row by 12 on save — and the
    // modal is reused, so reopening it after picking Monthly did the same (Rent 60,000/yr saved as 720,000).
    const _btPeriod = () => (document.getElementById('_budget-targets-modal') || {}).dataset?.period || 'annual';
    const _btShow = annual => {
      if (annual === '' || annual == null || !Number.isFinite(Number(annual))) return '';
      const v = _btPeriod() === 'monthly' ? Number(annual) / 12 : Number(annual);
      return String(Math.round(v * 100) / 100);
    };
    const _btRowHtml = (cat, annual) => `
          <input type="text" class="finput" placeholder="Category" data-bt-cat value="${esc(cat||'')}" data-style="flex:1.4;font-size:12.5px;padding:5px 8px">
          <input type="number" class="finput" placeholder="Amount" min="0" step="50" data-bt-amt value="${esc(_btShow(annual))}" data-style="flex:1;font-size:12.5px;padding:5px 8px">
          <button class="btn btn-ghost btn-sm" data-on-click="this.closest('._bt-row').remove()" title="Remove" data-style="color:var(--red);opacity:.7;padding:0 6px">✕</button>`;
    const _btAnnualAttr = annual => (annual === '' || annual == null || !Number.isFinite(Number(annual)) ? '' : String(Number(annual)));

    function _renderBudgetTargetRows(targets) {
      const rowsEl = document.getElementById('_budget-target-rows');
      if (!rowsEl) return;
      const entries = Object.entries(targets);
      if (!entries.length) {
        rowsEl.innerHTML = '<div data-style="padding:14px;text-align:center;color:var(--t3);font-size:12.5px">No categories yet — add one below</div>';
        return;
      }
      rowsEl.innerHTML = entries.map(([cat, val]) => `
        <div class="_bt-row" data-bt-annual="${esc(_btAnnualAttr(val))}" data-style="display:flex;align-items:center;gap:8px">${_btRowHtml(cat, val)}
        </div>`).join('');
    }

    function _addBudgetTargetRow(cat, val) {
      const rowsEl = document.getElementById('_budget-target-rows');
      if (!rowsEl) return;
      const empty = rowsEl.querySelector('div[style*="No categories yet"]');
      if (empty) empty.remove();
      const wrap = document.createElement('div');
      wrap.className = '_bt-row';
      wrap.dataset.btAnnual = _btAnnualAttr(val);
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px';
      wrap.innerHTML = _btRowHtml(cat, val);
      rowsEl.appendChild(wrap);
      wrap.querySelector('[data-bt-cat]').focus();
    }

    // Typing in an amount sets that row's annual figure from what is shown (×12 in the Monthly view).
    function _btOnAmountInput(ev) {
      const inp = ev.target;
      if (!inp || !inp.matches || !inp.matches('[data-bt-amt]')) return;
      const row = inp.closest('._bt-row');
      if (!row) return;
      const v = parseFloat(inp.value);
      row.dataset.btAnnual = Number.isFinite(v) ? String(_btPeriod() === 'monthly' ? v * 12 : v) : '';
    }
    function _btSetPeriod(modal, period) {
      modal.dataset.period = period;
      modal.querySelectorAll('._bt-period').forEach(b => { b.style.fontWeight = b.dataset.period === period ? '600' : ''; });
      const lbl = document.getElementById('_bt-period-label');
      if (lbl) lbl.textContent = period;
      modal.querySelectorAll('#_budget-target-rows ._bt-row').forEach(row => {
        const amt = row.querySelector('[data-bt-amt]');
        if (amt) amt.value = _btShow(row.dataset.btAnnual);
      });
    }
    window._addBudgetTargetRow = _addBudgetTargetRow;

    window.openBudgetTargetsModal = async function () {
      let currentTargets = {};
      try {
        const res = await api('GET', '/api/budget-targets');
        // Server returns the targets object directly (or empty object). Be
        // permissive: accept either {Rent:5000,...} or {targets:{Rent:5000}}.
        if (res && typeof res === 'object') {
          currentTargets = res.targets && typeof res.targets === 'object' ? res.targets : res;
        }
      } catch (e) { /* no saved targets yet */ }

      let existing = document.getElementById('_budget-targets-modal');
      if (!existing) {
        existing = document.createElement('div');
        existing.id = '_budget-targets-modal';
        existing.className = 'modal-overlay hidden';
        existing.innerHTML = `
          <div class="modal" data-style="max-width:460px">
            <div class="modal-header">
              <div><div class="modal-title">Budget targets</div><div class="modal-sub">Set <span id="_bt-period-label">annual</span> targets per expense category</div></div>
              <button class="modal-close" data-on-click="document.getElementById('_budget-targets-modal').classList.add('hidden')"><svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
            </div>
            <div data-style="display:flex;gap:6px;margin:4px 0 10px">
              <button class="btn btn-ghost btn-sm _bt-period" data-period="annual" data-style="font-weight:600">Annual</button>
              <button class="btn btn-ghost btn-sm _bt-period" data-period="monthly">Monthly</button>
            </div>
            <div id="_budget-target-rows" data-style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;padding:4px 0"></div>
            <div data-style="display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;padding-top:8px;border-top:1px dashed var(--bd)">
              <span data-style="font-size:11px;color:var(--t3);align-self:center;margin-right:4px">Quick add:</span>
              <span id="_bt-suggested"></span>
              <button class="btn btn-ghost btn-sm" data-style="margin-left:auto;color:var(--acc)" data-on-click="window._addBudgetTargetRow('', '')">+ Add custom</button>
            </div>
            <div class="modal-footer" data-style="margin-top:14px">
              <button class="btn btn-ghost" data-on-click="document.getElementById('_budget-targets-modal').classList.add('hidden')">Cancel</button>
              <button class="btn btn-primary" data-on-click="window._saveBudgetTargets()">Save targets</button>
            </div>
          </div>`;
        document.body.appendChild(existing);

        // Wire period toggle — re-displays the rows; never changes a stored figure (LR7)
        existing.querySelectorAll('._bt-period').forEach(btn => {
          btn.onclick = () => _btSetPeriod(existing, btn.dataset.period);
        });
        document.getElementById('_budget-target-rows').addEventListener('input', _btOnAmountInput);

        // Wire suggested category chips
        document.getElementById('_bt-suggested').innerHTML = SUGGESTED_CATS.map(cat =>
          `<button class="btn btn-ghost btn-sm" data-style="font-size:10.5px;padding:2px 7px;border:1px solid var(--bd)" data-arg-cat="${esc(cat)}" data-on-click="window._addBudgetTargetRow(this.dataset.argCat,'')">${esc(cat)}</button>`
        ).join(' ');
      }

      existing.dataset.period = 'annual';   // LR7: every open starts in the stored (annual) view
      _renderBudgetTargetRows(currentTargets);
      _btSetPeriod(existing, 'annual');
      existing.classList.remove('hidden');
    };

    window._saveBudgetTargets = async function () {
      const modal = document.getElementById('_budget-targets-modal');
      const rows = document.querySelectorAll('#_budget-target-rows ._bt-row');
      const targets = {};
      rows.forEach(row => {
        const cat = row.querySelector('[data-bt-cat]')?.value?.trim();
        // LR7: the row's annual figure — never the displayed number × 12
        const v   = parseFloat(row.dataset.btAnnual);
        if (!cat || !(v > 0)) return;
        targets[cat] = Math.round(v);
      });
      try {
        await api('PUT', '/api/budget-targets', { targets });
        modal.classList.add('hidden');
        await loadBudgetFromDB();
        if (typeof notify === 'function') notify('Budget targets saved ✦');
      } catch (e) {
        if (typeof notify === 'function') notify('Could not save targets — ' + e.message, true);
      }
    };

    // Load budget on boot
    loadBudgetFromDB();

    // ── showPage hooks: reload when navigating to entity-scoped pages ─
    const _medOrig = window.showPage;
    if (typeof _medOrig === 'function') {
      window.showPage = function (id, navEl) {
        _medOrig(id, navEl);
        if (id === 'invoices')   loadInvoicesFromDB();
        if (id === 'expenses')   loadExpensesFromDB();
        if (id === 'inventory')  loadInventoryFromDB();
        if (id === 'payroll')    loadPayrollFromDB();
        if (id === 'items')      loadItemsFromDB();
        if (id === 'budget')     loadBudgetFromDB();
        if (id === 'timesheet')  _setTimesheetTitle();
        if (id === 'documents')  { if (typeof window.renderDocuments === 'function') window.renderDocuments(); }
        if (id === 'settings')   { const _sEl = document.getElementById('settings-user-email'); if (_sEl) _sEl.textContent = window.CURRENT_USER?.email || ''; if (window.loadOwnerMfa) window.loadOwnerMfa(); }
      };
    }

    // Set timesheet title immediately on load
    _setTimesheetTitle();

    console.log('[FinFlow API Wiring — Medium] ✅ Invoices, Expenses, Inventory, Payroll, Items patched');
  })()

})();


;
/* ── finflow-api-wiring-final.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — API WIRING FINAL PATCH
// Covers:
//   ✅ Session restore on boot (auto-login if session cookie active)
//   ✅ Expense edit  → PUT /api/expenses/:id
//   ✅ Holdings edit → PUT /api/holdings/:id
//   ✅ Holdings delete → DELETE /api/holdings/:id
//   ✅ Logout via API (clear session)
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `API error ${res.status}`);
    }
    return res.json();
  }

  // ─────────────────────────────────────────────────────────────────
  // SESSION RESTORE — check if user already has a valid session
  // on page load, and if so skip the login screen
  // ─────────────────────────────────────────────────────────────────
  window.bootFinFlowAPI = async function () {
    // Load all data from API
    if (typeof window._apiBootDone === 'undefined') {
      window._apiBootDone = true;
      // Trigger the existing wiring boot functions if they haven't fired
      // (the easy + medium wiring files listen for DOMContentLoaded which
      //  has already fired by now — so we call them directly if exposed)
      if (typeof window._ffApiBootEasy === 'function')  window._ffApiBootEasy();
      if (typeof window._ffApiBootMedium === 'function') window._ffApiBootMedium();
    }
  };

  (async function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }

    // ── Auto-restore session ────────────────────────────────────────
    try {
      const data = await api('GET', '/api/auth/me');
      if (data && data.user) {
        // F113/F115: the server-resolved calendar date, same lifecycle as window._realInvoices —
        // set once at boot, read by the Record Payment modal to default its date field WITHOUT
        // ever reading the browser clock (that was the F115 bug). No fallback to new Date() is
        // wired anywhere for this — if it's not set yet, the modal blocks/shows loading instead.
        if (data.today) window._serverToday = data.today;
        // F147: apply the restored user's plan/CURRENT_USER too — WAS MISSING here, so a page
        // reload left currentUserPlan at its 'trial' default and re-gated business users at the
        // entity cap of 1 (the "requires Business" modal). Same setter the login/register paths use.
        if (typeof window._applySessionUser === 'function') window._applySessionUser(data.user);
        // Valid session — skip login screen
        const r = 'owner';
        window.currentRole = r;
        sessionStorage.setItem('ff_role', r);
        if (typeof applyRole === 'function') applyRole(r);
        const loginScreen = document.getElementById('login-screen');
        if (loginScreen) loginScreen.style.display = 'none';
        if (typeof injectRoleBadge === 'function') injectRoleBadge(r);
        // Boot data load
        setTimeout(() => {
          if (typeof window._ffApiBootEasy === 'function')  window._ffApiBootEasy();
          if (typeof window._ffApiBootMedium === 'function') window._ffApiBootMedium();
        }, 0);
      }
    } catch (e) {
      // 401 = not logged in → F151: the login screen now defaults to display:none (so it can't FLASH
      // during this /auth/me round-trip), so we must explicitly reveal it here and drop the splash.
      if (typeof window._showLoginScreen === 'function') { window._showLoginScreen(); }
      else {
        var _l = document.getElementById('login-screen'); if (_l) _l.style.display = 'flex';
        var _s = document.getElementById('ff-splash');     if (_s) _s.style.display = 'none';
      }
    }

    // ── API Logout ─────────────────────────────────────────────────
    // Patch any existing logout function or topbar logout button
    const origLogout = window.doLogout;
    window.doLogout = async function () {
      try { await api('POST', '/api/auth/logout'); } catch (e) { /* ignore */ }
      if (typeof origLogout === 'function') origLogout();
      else {
        sessionStorage.removeItem('ff_role');
        location.reload();
      }
    };

    // Wire any logout buttons that use onclick="doLogout()"
    // (the topbar profile menu likely has one)
    document.querySelectorAll('[data-on-click*="logout"],[data-on-click*="Logout"],[data-on-click*="signOut"]').forEach(el => {
      const existing = el.getAttribute('data-on-click');
      if (!existing.includes('doLogout')) return;
      el.setAttribute('data-on-click', 'doLogout()');
    });

    // ── EXPENSE EDIT ───────────────────────────────────────────────
    // M52 (fix pass round 2): edit a business expense in the SAME modal Add uses (bexp-* fields, incl. the M49 date).
    // The row's Edit button is rendered by renderExpenses itself (medium wiring) — no DOM patching after the fact.
    // This block was dead: it patched `#expense-list tr / .expense-row` (rows are `.tx-row`), read `exp-*` ids that do
    // not exist and looked rows up in `window.expenses` — so no expense could ever be edited.
    const _mediumSaveExpense = window.saveExpense;
    const _expModalMode = (edit) => {
      const modal = document.getElementById('expense-modal');
      if (!modal) return;
      const title = modal.querySelector('.modal-title');
      if (title) title.textContent = edit ? 'Edit expense' : 'Add expense';
      const saveBtn = modal.querySelector('button[data-on-click*="saveExpense"]');
      if (saveBtn) saveBtn.textContent = edit ? 'Save changes' : 'Add expense';
      const eid = document.getElementById('expense-edit-id');
      if (eid && !edit) eid.value = '';
    };
    window._expModalMode = _expModalMode;

    window.saveExpense = async function () {
      const editId = document.getElementById('expense-edit-id')?.value;
      if (!editId) {
        // No edit id — delegate to medium wiring (POST create)
        if (typeof _mediumSaveExpense === 'function') return _mediumSaveExpense();
        return;
      }
      if (window._savingExpense) return;   // in-flight re-entry lock (PUT is idempotent; this stops a double request)
      const v = (id) => (document.getElementById(id)?.value ?? '');
      const description = v('bexp-desc').trim();
      const amount = parseFloat(v('bexp-amount'));
      const expense_date = v('bexp-date').trim();
      if (!description) { notify('Description is required', true); return; }
      if (!Number.isFinite(amount) || amount <= 0) { notify('A valid positive amount is required', true); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) { notify('Enter a valid date', true); return; }
      const body = { description, amount, expense_date, category: v('bexp-cat') || 'Other', deductible: v('bexp-ded') || 'no',
                     class: v('bexp-class').trim(), location: v('bexp-location').trim(), vendor: v('bexp-vendor').trim() };   // FA-M9
      window._savingExpense = true;
      const _btn = document.querySelector('#expense-modal .btn-primary');
      if (_btn) _btn.disabled = true;
      try {
        await api('PUT', `/api/expenses/${encodeURIComponent(editId)}`, body);
        if (typeof closeModal === 'function') closeModal('expense-modal');
        notify('Expense updated ✦');
        if (typeof window._loadExpensesFromDB === 'function') await window._loadExpensesFromDB().catch(() => {});
        if (typeof renderExpenses === 'function') renderExpenses();
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) {
        notify('Could not update expense — ' + e.message, true);
      } finally {
        window._savingExpense = false;
        if (_btn) _btn.disabled = false;
      }
    };

    // Inject hidden edit-id field into expense modal if not present
    const expModal = document.getElementById('expense-modal');
    if (expModal && !document.getElementById('expense-edit-id')) {
      const hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.id   = 'expense-edit-id';
      expModal.appendChild(hiddenInput);
    }

    // Edit expense — populate the Add modal from the row (bizExpenses index, as Delete uses) and switch it to edit mode.
    window.editExpense = function (idx) {
      const exp = (window.bizExpenses || [])[idx];
      if (!exp || !exp._dbId) return;
      const f = (fieldId, val) => { const el = document.getElementById(fieldId); if (el) el.value = val ?? ''; };
      f('bexp-desc',     exp.desc);
      f('bexp-amount',   exp.amount);
      f('bexp-date',     exp.expense_date ? String(exp.expense_date).slice(0, 10) : '');
      // A category the picker does not list (e.g. one booked from the bank feed) is added, never silently replaced.
      const cat = document.getElementById('bexp-cat');
      if (cat && exp.cat && !Array.from(cat.options).some(o => o.value === exp.cat)) { const o = document.createElement('option'); o.value = o.textContent = exp.cat; cat.appendChild(o); }
      f('bexp-cat',      exp.cat || 'Other');
      f('bexp-ded',      exp.ded || 'no');
      f('bexp-class',    exp.class || '');
      f('bexp-location', exp.location || '');
      f('bexp-vendor',   exp.vendor || '');   // FA-M9
      f('expense-edit-id', exp._dbId);
      _expModalMode(true);
      if (typeof openModal === 'function') openModal('expense-modal');
    };

    // Reset edit state when expense modal closes
    const origCloseModal = window.closeModal;
    if (typeof origCloseModal === 'function') {
      window.closeModal = function (id) {
        if (id === 'expense-modal') _expModalMode(false);
        origCloseModal(id);
      };
    }

    // ── HOLDINGS EDIT / DELETE ─────────────────────────────────────
    // Patch saveHolding() to support edit mode
    const _origSaveHolding = window.saveHolding;
    window.saveHolding = async function () {
      const editId = document.getElementById('holding-edit-id')?.value;
      if (!editId) {
        if (typeof _origSaveHolding === 'function') return _origSaveHolding();
        return;
      }

      // Live modal uses h-* field ids (not hold-*).
      const ticker    = document.getElementById('h-ticker')?.value?.trim().toUpperCase();
      const name      = document.getElementById('h-name')?.value?.trim();
      const assetType = document.getElementById('h-type')?.value || 'Stock';
      const shares    = parseFloat(document.getElementById('h-shares')?.value) || 0;
      const costPer   = parseFloat(document.getElementById('h-cost')?.value)   || 0;
      const price     = parseFloat(document.getElementById('h-price')?.value)  || costPer;
      const dividend  = parseFloat(document.getElementById('h-div')?.value)    || 0;

      if (!ticker || !shares) { notify('Ticker and shares required.', true); return; }

      // Look up the row in whichever portfolio it belongs to (personal or business).
      const _scope = window._holdingScope === 'business' ? 'business' : 'personal';
      const _list  = _scope === 'business' ? (window.bizHoldings || []) : (window.holdings || window.portfolioHoldings || []);
      const h    = _list.find(h => h.id === Number(editId));
      const dbId = h?._dbId || editId;

      try {
        await api('PUT', `/api/holdings/${dbId}`, { ticker, name: name||ticker, asset_type: assetType, shares, cost_per: costPer, price, dividend });
        if (typeof closeModal === 'function') closeModal('holding-modal');
        notify('Holding updated ✦');
        const _eid = document.getElementById('holding-edit-id'); if (_eid) _eid.value = '';
        // Reload + repaint the CORRECT list (+ dashboard d-invest) from the DB — no manual reload.
        if (typeof window._refreshHoldings === 'function') window._refreshHoldings(_scope);
        else if (typeof renderInvestments === 'function') renderInvestments();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not update holding — ' + e.message, true);
      }
    };

    // deleteHolding — resolves the row's portfolio (personal or business) and repaints that one.
    window.deleteHolding = async function (id) {
      if (!(await window._confirmModal('Remove this holding? This cannot be undone.', {danger:true}))) return;
      let h = (window.holdings || window.portfolioHoldings || []).find(x => x.id === id);
      let scope = 'personal';
      if (!h) { h = (window.bizHoldings || []).find(x => x.id === id); if (h) scope = 'business'; }
      const dbId = h?._dbId || id;
      try {
        await api('DELETE', `/api/holdings/${dbId}`);
        if (scope === 'business') {
          if (window.bizHoldings) window.bizHoldings = window.bizHoldings.filter(x => x.id !== id);
        } else {
          if (window.holdings) window.holdings = window.holdings.filter(x => x.id !== id);
          if (window.portfolioHoldings) window.portfolioHoldings = window.portfolioHoldings.filter(x => x.id !== id);
        }
        notify('Holding removed');
        if (typeof window._refreshHoldings === 'function') window._refreshHoldings(scope);
        else if (typeof renderInvestments === 'function') renderInvestments();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not remove holding — ' + e.message, true);
      }
    };

    // editHolding — populate modal from whichever portfolio the row lives in
    window.editHolding = function (id) {
      let h = (window.holdings || window.portfolioHoldings || []).find(x => x.id === id);
      let scope = 'personal';
      if (!h) { h = (window.bizHoldings || []).find(x => x.id === id); if (h) scope = 'business'; }
      if (!h) return;
      window._holdingScope = scope;   // so the Save (edit) path repaints the right list
      const modal = document.getElementById('holding-modal');
      if (!modal) return;

      // The live modal uses h-* field ids; the holding object (loaded from the DB, finflow-api.js)
      // exposes type/cost/div — NOT asset_type/cost_per/dividend. Populate the real fields/props.
      const f = (fieldId, val) => { const el = document.getElementById(fieldId); if (el) el.value = val ?? ''; };
      f('h-ticker',  h.ticker);
      f('h-name',    h.name);
      f('h-type',    h.type ?? h.asset_type);
      f('h-shares',  h.shares);
      f('h-cost',    h.cost ?? h.cost_per);
      f('h-price',   h.price);
      f('h-div',     h.div ?? h.dividend);

      // Inject hidden field
      let hiddenEl = document.getElementById('holding-edit-id');
      if (!hiddenEl) {
        hiddenEl = document.createElement('input');
        hiddenEl.type = 'hidden';
        hiddenEl.id   = 'holding-edit-id';
        modal.appendChild(hiddenEl);
      }
      hiddenEl.value = id;

      const title = modal.querySelector('.modal-title');
      if (title) title.textContent = 'Edit Holding';
      const saveBtn = modal.querySelector('button[data-on-click*="saveHolding"]');
      if (saveBtn) saveBtn.textContent = 'Save changes';

      if (typeof openModal === 'function') openModal('holding-modal');
      else modal.classList.remove('hidden');
    };

    // NOTE: Edit/✕ buttons are now rendered directly inside renderInvestments()'s row markup
    // (app-main.js), calling editHolding(h.id)/deleteHolding(h.id). The previous setTimeout patch
    // here targeted window.renderHoldings/renderPortfolio + #holdings-list — none of which exist in
    // the shipped app (the real renderer is renderInvestments, the list is #inv-holdings-list) — so
    // it silently no-op'd and no buttons ever appeared. Removed as the root cause of the edit gap.

    console.log('[FinFlow Final Wiring] ✅ Session restore, expense edit, holdings edit/delete patched');
  })()

})();


;
/* ── finflow-api-wiring-stubs.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — STUBS WIRING  (RETIRED — F145, 2026-08-09)
// ════════════════════════════════════════════════════════════════════
// This file previously wired Quotes / Bills / Vendors / Recurring Bills /
// Recurring Invoices to the real API. Every one of those subsystems is now
// implemented in finflow-api-wiring-pages.js, which loads AFTER this file and
// therefore WON every runtime binding. Confirmed dead-shadow (F145):
//
//   • 13 window.X = function assignments here were overridden by real
//     `window.X = function` winners in pages.js (openNew*/save*/markBillPaid/
//     filterVendorsBySearch/showPage — showPage also in extra.js + postgres.js).
//   • 5 edit* openers (editQuote/editVendor/editBill/editRecurringBill/
//     editRecurringInvoice) had ZERO live callers — referenced only by this
//     file's own (also-dead) render HTML.
//   • window.render{Quotes,Vendors,Bills,RecurringBills,RecurringInvoices}
//     overridden by pages.js + postgres.js.
//   • The entity-switch reload hooks window._load{Vendors,Bills,Quotes,
//     RecurringBills,RecurringInv}FromDB are re-assigned by pages.js
//     (see pages.js:1163-1172, "overrides stubs.js — pages.js wins"); the
//     live caller (postgres.js entity-switch) therefore hits pages.js copies.
//   • The money vars window.{quotes,vendors,bills,recurringBills,
//     recurringInvoices} are set by pages.js, so removing this file's copies
//     cannot blank an AP / dashboard figure.
//
// Kept as an empty module (rather than removed from the bundle/index) so load
// order and the bundle manifest are unchanged. Do NOT re-add wiring here — it
// would be dead on arrival behind pages.js. Add to pages.js instead.
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  // Intentionally empty. See header (F145). All wiring lives in
  // finflow-api-wiring-pages.js.
})();


;
/* ── finflow-api-wiring-final5.js ── */
// FinFlow API Wiring — Final5
// Modules: Sales Receipts, Payments Received, Credit Notes, Payments Made, Vendor Credits, AI

/* ══════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════ */
async function apiFetch(path, opts={}){
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if(!res.ok){ const e = await res.json().catch(()=>({})); throw new Error(e.error||res.status); }
  return res.json();
}

function fmtMoney(n){ return '$' + Number(n||0).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0}); }
function fmtDate(s){ if(!s)return ''; return window.FinFlowDates ? window.FinFlowDates.fmtLabel(s, { year: true }) : s; }   // F195: TZ-safe calendar date (was new Date().toLocaleDateString → shifted west of UTC)
function nextNum(prefix, list, field='num'){
  const nums = list.map(r=>(r[field]||'').replace(prefix+'-','0')).map(Number).filter(n=>!isNaN(n));
  const next = nums.length ? Math.max(...nums)+1 : 1;
  return prefix + '-' + String(next).padStart(4,'0');
}

/* ══════════════════════════════════════════════════════════════════
   SALES RECEIPTS
══════════════════════════════════════════════════════════════════ */



function _sv(id,v){const el=document.getElementById(id); if(el) el.value=v;}
function _st(id,v){const el=document.getElementById(id); if(el) el.textContent=v;}




/* ══════════════════════════════════════════════════════════════════
   PAYMENTS RECEIVED
══════════════════════════════════════════════════════════════════ */



// F35 Step 5: renamed off the colliding `openRecordPaymentModal` name — that name is now
// exclusively the invoice Store-B opener (index.html:4160). This is the Store-A received-payment
// opener for the Payments-Received page. (pages.js also defines window.openPaymentReceivedModal
// and wins by load order; this decl is the same Store-A intent.)




/* ══════════════════════════════════════════════════════════════════
   CREDIT NOTES
══════════════════════════════════════════════════════════════════ */






// F84 / Failure #1 (F75): the `savePaymentMade` that once lived here was a DEAD SHADOW. The bundle
// loads this file (finflow-bundle.js:3175) BEFORE finflow-api-wiring-pages.js's
// `window.savePaymentMade = …` (:4178), which overwrote this global — so this copy never ran, and it
// omitted `bill_id` (the F84 double-count). It is deleted so only the one pages.js runtime winner
// remains. Do not reintroduce a savePaymentMade here.


/* ══════════════════════════════════════════════════════════════════
   VENDOR CREDITS
══════════════════════════════════════════════════════════════════ */







/* ══════════════════════════════════════════════════════════════════
   AI CHAT
══════════════════════════════════════════════════════════════════ */
let _aiHistory = [];

function renderAIPage(){
  const container = document.getElementById('ai-chat-messages');
  if(!container) return;
  if(!_aiHistory.length){
    container.innerHTML = `<div data-style="text-align:center;padding:40px 20px;color:var(--t3)">
      <div data-style="font-size:32px;margin-bottom:12px">✦</div>
      <div data-style="font-size:14px;font-weight:600;color:var(--t2);margin-bottom:8px">FinFlow AI</div>
      <div data-style="font-size:13px">Ask me anything about your business — revenue, expenses, cash flow, forecasting, or financial strategy.</div>
    </div>`;
    return;
  }
  container.innerHTML = _aiHistory.map(m=>`
    <div data-style="display:flex;flex-direction:${m.role==='user'?'row-reverse':'row'};gap:10px;margin-bottom:16px;align-items:flex-start">
      <div data-style="width:30px;height:30px;border-radius:50%;background:${m.role==='user'?'var(--accent)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${m.role==='user'?'#fff':'var(--t1)'};flex-shrink:0">${m.role==='user'?'U':'✦'}</div>
      <div data-style="max-width:75%;background:${m.role==='user'?'var(--accent)':'var(--bg2)'};color:${m.role==='user'?'#fff':'var(--t1)'};border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.5;white-space:pre-wrap">${escHTML(m.content)}</div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function escHTML(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendAIMessage(){
  const input = document.getElementById('ai-input'); if(!input) return;
  const message = input.value.trim(); if(!message) return;
  input.value = '';

  _aiHistory.push({ role: 'user', content: message });
  renderAIPage();

  // Show typing indicator
  const container = document.getElementById('ai-chat-messages');
  if(container){
    const typing = document.createElement('div');
    typing.id = 'ai-typing';
    typing.style.cssText = 'display:flex;gap:10px;margin-bottom:16px;align-items:flex-start';
    typing.innerHTML = `<div data-style="width:30px;height:30px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:12px">✦</div><div data-style="background:var(--bg2);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--t3)">Thinking…</div>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  try{
    const data = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: _aiHistory.slice(0,-1) })
    });
    const typing2 = document.getElementById('ai-typing'); if(typing2) typing2.remove();
    _aiHistory.push({ role: 'assistant', content: data.reply || 'No response.' });
  } catch(e){
    const typing3 = document.getElementById('ai-typing'); if(typing3) typing3.remove();
    _aiHistory.push({ role: 'assistant', content: 'Error: ' + (e.message || 'Could not reach the AI assistant. Please try again, or contact FinFlow support if it keeps happening.') });
  }
  renderAIPage();
}

function clearAIChat(){
  _aiHistory = [];
  renderAIPage();
}

// Hook up AI send button and enter key
(function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
  const sendBtn = document.getElementById('ai-send-btn');
  if(sendBtn) sendBtn.addEventListener('click', sendAIMessage);
  const inp = document.getElementById('ai-input');
  if(inp) inp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendAIMessage(); } });
  const clearBtn = document.getElementById('ai-clear-btn');
  if(clearBtn) clearBtn.addEventListener('click', clearAIChat);
})();


;
/* ── finflow-api-wiring-pages.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — API WIRING (ALL REMAINING PAGES)
// Wires: Quotes, Sales Receipts, Payments Received, Recurring Invoices,
//        Credit Notes, Vendors, Bills, Payments Made, Recurring Bills,
//        Vendor Credits
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Coalesce concurrent identical GETs. On a cold boot each list loader is fired from the
  // module init AND again from the render pass before the first fetch resolves; sharing the
  // in-flight promise collapses those duplicates into ONE request. GET-only (never mutations),
  // and the entry clears as soon as it settles, so a later reload still fetches fresh data.
  const _inflightGets = new Map();
  // F-B2: humanize raw payment-method enums ("bank_transfer"→"Bank transfer", "other"→"Other").
  // Already-formatted values ("Card (Stripe)") are left untouched.
  window._humanPayMethod = function (m) {
    const s = String(m || '').trim();
    if (!s) return '';
    if (/[A-Z(]/.test(s)) return s;            // already nicely formatted
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
  };

  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const isGet = String(method).toUpperCase() === 'GET';
    if (isGet && _inflightGets.has(path)) return _inflightGets.get(path);
    const p = (async () => {
      const res = await fetch(path, opts);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `API error ${res.status}`); }
      return res.json();
    })();
    if (isGet) { _inflightGets.set(path, p); const done = () => { if (_inflightGets.get(path) === p) _inflightGets.delete(path); }; p.then(done, done); }
    return p;
  }

  const todayStr = () => (window.todayLocal ? window.todayLocal() : new Date().toISOString().slice(0, 10));  // C3/F37: local date, not UTC
  // FA-M6c: document numbers come from the server's per-business sequence — the browser never makes one up

  // ── KPI card helpers ──────────────────────────────────────────────
  // Sets the .mc-val cells of a page by index; null/undefined entries are
  // skipped so cards with no derivable value keep their placeholder.
  function setKpiCards(pageId, vals) {
    const els = document.querySelectorAll('#' + pageId + ' .mc-val');
    vals.forEach((v, i) => { if (v != null && els[i]) els[i].textContent = v; });
  }
  // Monthly-equivalent value of a recurring amount given its frequency.
  function monthlyEquiv(amount, frequency) {
    const a = parseFloat(amount) || 0;
    const f = String(frequency || 'Monthly').toLowerCase();
    if (f.startsWith('week'))    return a * 52 / 12;
    if (f.startsWith('quarter')) return a / 3;
    if (f.startsWith('year') || f.startsWith('annual')) return a / 12;
    return a;
  }
  function inThisMonth(d) {
    if (!d) return false;
    // F87-class: decide "this month" by CALENDAR month via the canonical resolver, not local
    // getMonth/getFullYear — those pick the month in the VIEWER's timezone, so the same row lands
    // in different months for viewers in different zones. Compare 'YYYY-MM' string prefixes (UTC).
    const _dy = window.FinFlowDates._toYmd(d);
    if (_dy == null) return false;
    return _dy.slice(0, 7) === (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date())).slice(0, 7);
  }
  // L5: the ONE "is this row in this calendar month" test for every card labelled "This month"
  // (here, app-main journals, wiring-extra projects/timesheet) — several such cards summed ALL TIME.
  window._inThisMonth = inThisMonth;

  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }

    // ════════════════════════════════════════════
    // QUOTES
    // ════════════════════════════════════════════
    let _quotesData = [], _quotesFetched = false;

    async function loadQuotes() {
      try {
        const rows = await api('GET', '/api/quotes');
        _quotesFetched = true;
        _quotesData = rows || [];
        window.quotes = _quotesData;
        console.log('[Quotes] loaded', _quotesData.length);
        renderQuotes();
      } catch (e) { console.warn('[Quotes]', e.message); }
    }
    loadQuotes();

    window.renderQuotes = function () {
      if (!_quotesFetched) { loadQuotes(); return; }
      const el = document.getElementById('quotes-list');
      if (!el) return;
      const cls = { pending: 'b-amber', accepted: 'b-green', declined: 'b-red', converted: 'b-blue' };
      el.innerHTML = _quotesData.length
        ? _quotesData.map(q => `
          <div class="table-row" data-style="grid-template-columns:1fr 100px 80px 80px 70px 110px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span data-style="font-weight:500">${esc(q.client)}</span>
            <span data-style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(q.num || '')}</span>
            <span data-style="font-family:var(--font-mono)">${S(q.amount)}</span>
            <span data-style="color:var(--t2)">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(q.expiry_date,{year:true}):(q.expiry_date||''))||'—')}</span>
            <span><span class="badge ${cls[q.status] || 'b-amber'}">${esc(q.status)}</span></span>
            <div data-style="display:flex;gap:4px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-arg-id="${q.id}" data-on-click="viewQuote(Number(this.dataset.argId))">View</button>${String(q.status || '').toLowerCase() === 'converted' ? '' : `<button class="btn btn-ghost btn-sm" title="Edit" data-arg-id="${q.id}" data-on-click="editQuote(Number(this.dataset.argId))">✎</button><button class="btn btn-ghost btn-sm" title="Create a draft invoice from this quote" data-arg-id="${q.id}" data-on-click="convertQuote(Number(this.dataset.argId))">→ Invoice</button>`}<button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-id="${q.id}" data-on-click="deleteQuote(Number(this.dataset.argId))">✕</button></div>
          </div>`).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No quotes yet — click + New Quote to create one</div>';
      const accepted = _quotesData.filter(q => q.status?.toLowerCase() === 'accepted').length;
      const pending  = _quotesData.filter(q => q.status?.toLowerCase() === 'pending').length;
      const openVal  = _quotesData.filter(q => q.status?.toLowerCase() === 'pending').reduce((s, q) => s + (q.amount || 0), 0);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('qt-total', _quotesData.filter(q => inThisMonth(q.date || q.created_at)).length);   // L5: "This month" (quotes carry no business date → created_at)
      set('qt-accepted', accepted);
      set('qt-pending', pending);
      set('qt-value', S(openVal));
    };

    window.openNewQuoteModal = function () {
      window._quoteEditId = null;   // LR9: a NEW quote — never the last one edited
      ['quote-client','quote-amount','quote-expiry','quote-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      window._pickCustomer?.('quote-client');   // FA-B4
      const s = document.getElementById('quote-status'); if (s) s.value = 'pending';
      const _qt = (t, sub) => { const m = document.getElementById('quote-modal'); if (!m) return; const h = m.querySelector('.modal-title'); if (h) h.textContent = t; const st = m.querySelector('.modal-sub'); if (st) st.textContent = sub; };   // FA-B6
      if (window.ffQuoteLineItems && window.ffQuoteLineItems.reset) window.ffQuoteLineItems.reset();
      _qt('New Quote', 'Create a quote for a client');
      openModal('quote-modal');
    };

    // LR9 (decision 2026-10-21): EDIT a quote — the same form, pre-filled with its lines (the total stays derived from
    // them, Rule 2); Save sends PUT for that quote.
    window._quoteEditId = null;
    window.editQuote = async function (id) {
      let q = _quotesData.find(r => r.id === id);
      if (!q) { try { await loadQuotes(); } catch (_) {} q = _quotesData.find(r => r.id === id); }
      if (!q) { notify('That quote could not be found — refresh and try again', true); return; }
      if (String(q.status || '').toLowerCase() === 'converted') { notify('This quote was converted to an invoice — edit the invoice instead', true); return; }
      const set = (fid, v) => { const el = document.getElementById(fid); if (el) el.value = v == null ? '' : v; };
      set('quote-client', q.client); window._pickCustomer?.('quote-client');   // FA-B4
      set('quote-expiry', String(q.expiry_date || '').slice(0, 10)); set('quote-notes', q.notes);
      set('quote-status', q.status || 'pending'); set('quote-amount', q.amount != null ? Number(q.amount) : '');
      if (window.ffQuoteLineItems && window.ffQuoteLineItems.load) window.ffQuoteLineItems.load(Array.isArray(q.line_items) ? q.line_items : []);
      window._quoteEditId = id;
      const _qt = (t, sub) => { const m = document.getElementById('quote-modal'); if (!m) return; const h = m.querySelector('.modal-title'); if (h) h.textContent = t; const st = m.querySelector('.modal-sub'); if (st) st.textContent = sub; };   // FA-B6
      _qt('Edit quote' + (q.client ? ' — ' + q.client : ''), 'Change this quote; its total follows its lines');
      openModal('quote-modal');
    };

    // LR9: CONVERT a quote to an invoice — through the ONE invoice writer (POST /api/invoices), as a DRAFT (not revenue
    // until the user issues it), idempotency key "quote-<id>" so a double click or a second tab makes ONE invoice (Rule 9);
    // then the quote is marked "converted" with the invoice id.
    const _converting = new Set();
    window.convertQuote = async function (id) {
      if (_converting.has(id)) return;
      _converting.add(id);
      try {
        let q = _quotesData.find(r => r.id === id);
        if (!q) { await loadQuotes(); q = _quotesData.find(r => r.id === id); }
        if (!q) { notify('That quote could not be found', true); return; }
        if (String(q.status || '').toLowerCase() === 'converted') { notify('Already converted — see Invoices'); return; }
        const items = Array.isArray(q.line_items) && q.line_items.length ? q.line_items : null;
        const today = (typeof window._entityToday === 'function') ? window._entityToday() : new Date().toISOString().slice(0, 10);
        const inv = await api('POST', '/api/invoices', {
          client: q.client, amount: Number(q.amount), status: 'draft', issue_date: today,
          due_date: q.expiry_date ? String(q.expiry_date).slice(0, 10) : undefined,
          notes: ('From quote ' + (q.num || '#' + q.id) + (q.notes ? ' — ' + q.notes : '')).slice(0, 500),
          idempotency_key: 'quote-' + id, ...(items ? { line_items: items } : {}),
        });
        const invId = (inv && (inv.id || (inv.row && inv.row.id)));
        await api('PUT', `/api/quotes/${id}`, { status: 'converted', invoice_id: invId });
        await loadQuotes();
        notify(`Draft invoice created from ${esc(q.num || 'the quote')} ✦ — review and issue it on Invoices`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not convert — ' + e.message, true); }
      finally { _converting.delete(id); }
    };

    window.saveQuote = async function () {
      const client = document.getElementById('quote-client')?.value?.trim();
      const amount = parseFloat(document.getElementById('quote-amount')?.value);
      if (!client) { notify('Client name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const expiry_date = document.getElementById('quote-expiry')?.value || null;
      const status = document.getElementById('quote-status')?.value || 'pending';
      const notes  = document.getElementById('quote-notes')?.value?.trim() || '';
      // F194 Phase 2b: attach line_items when the user added any. The server re-derives the amount
      // from them (Rule 2) — the `amount` here is only the locked on-screen mirror.
      const _qli = (window.ffQuoteLineItems && window.ffQuoteLineItems.get && window.ffQuoteLineItems.get()) || null;
      if (window._quoteSaving) return;   // one save at a time
      window._quoteSaving = true;
      const editId = window._quoteEditId;
      try {
        if (editId != null) {
          // LR9: edit — PUT the quote (lines present ⇒ the server re-derives the amount from them; none ⇒ the amount).
          await api('PUT', `/api/quotes/${editId}`, { client, expiry_date, status, notes, ...(_qli ? { line_items: _qli } : { amount, line_items: null }) });   // null clears stored lines (no stale lines beside a typed total)
          window._quoteEditId = null;
        } else {
          const saved = await api('POST', '/api/quotes', { client, amount, expiry_date, status, notes, ...(_qli ? { line_items: _qli } : {}) });
          _quotesData.unshift(saved.row || saved);
        }
        window.quotes = _quotesData;
        closeModal('quote-modal');
        renderQuotes();
        notify(editId != null ? `Quote for ${esc(client)} updated ✦` : `Quote for ${esc(client)} saved ✦`);
        loadQuotes().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
      finally { window._quoteSaving = false; }
    };

    window.deleteQuote = async function (id) {
      const q = _quotesData.find(r => r.id === id);
      if (!q || !(await window._confirmModal(`Delete quote for ${q.client}? This cannot be undone.`, {danger:true}))) return;
      try {
        await api('DELETE', `/api/quotes/${id}`);
        _quotesData = _quotesData.filter(r => r.id !== id);
        renderQuotes();
        notify('Quote deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // SALES RECEIPTS
    // ════════════════════════════════════════════
    let _receiptsData = [], _receiptsFetched = false;

    async function loadReceipts() {
      try {
        const rows = await api('GET', '/api/sales-receipts');
        _receiptsFetched = true;
        _receiptsData = rows || [];
        window.receipts = _receiptsData;
        console.log('[Receipts] loaded', _receiptsData.length);
        renderReceipts();
      } catch (e) { console.warn('[Receipts]', e.message); }
    }
    window.loadReceipts = loadReceipts;   // expose so other flows (e.g. Stripe reconcile → books) can reload window.receipts + repaint
    loadReceipts();

    window.renderReceipts = function () {
      if (!_receiptsFetched) { loadReceipts(); return; }
      const el = document.getElementById('receipts-list');
      if (!el) return;
      el.innerHTML = _receiptsData.length
        ? _receiptsData.map(r => `
          <div class="table-row" data-style="grid-template-columns:1fr 100px 80px 80px 70px 110px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span data-style="font-weight:500">${esc(r.customer || '')}</span>
            <span data-style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span data-style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span data-style="color:var(--t2)">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(r.date,{year:true}):(r.date||''))||'—')}</span>
            <span data-style="color:var(--t2)">${esc(window._humanPayMethod(r.method))}</span>
            <div data-style="display:flex;gap:4px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-arg-id="${r.id}" data-on-click="viewReceipt(Number(this.dataset.argId))">View</button><button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-id="${r.id}" data-on-click="deleteReceipt(Number(this.dataset.argId))">✕</button></div>
          </div>`).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No receipts yet</div>';
      // KPI cards: count · cash sales · card/stripe sales · refunds
      const _rcCash = _receiptsData.filter(r => /cash/i.test(r.method || '')).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _rcCard = _receiptsData.filter(r => /card|stripe/i.test(r.method || '')).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _rcRefund = _receiptsData.filter(r => (parseFloat(r.amount) || 0) < 0).reduce((s, r) => s + Math.abs(parseFloat(r.amount) || 0), 0);
      setKpiCards('page-sales-receipts', [_receiptsData.filter(r => inThisMonth(r.date)).length, S(_rcCash), S(_rcCard), S(_rcRefund)]);   // L5: count is "This month"
      window._refreshDashboardUI?.();
    };

    window.openNewReceiptModal = function () {
      ['receipt-customer','receipt-amount','receipt-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      window._pickCustomer?.('receipt-customer');   // FA-B4
      const d = document.getElementById('receipt-date'); if (d) d.value = todayStr();
      const m = document.getElementById('receipt-method'); if (m) m.value = 'Card';
      window._srIdemKey = null;   // C1 Wave 1: fresh submit-intent → a genuine new receipt never reuses the last token
      openModal('modal-receipt');
    };

    window.saveReceipt = async function () {
      // C1 Wave 1: in-flight re-entry lock — a double-click cannot fire a 2nd POST. UX layer only;
      // the durable guarantee is the DB idempotency index (idx_sales_receipts_idem_key).
      if (window._savingReceipt) return;
      const customer = document.getElementById('receipt-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('receipt-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('receipt-date')?.value   || todayStr();
      const method = document.getElementById('receipt-method')?.value || 'Card';
      const notes  = document.getElementById('receipt-notes')?.value?.trim() || '';
      // One idempotency token per submit-intent: minted lazily, reused on retry of THIS modal, reset
      // on modal open and on success below. Double-submit reuses it (→ DB dedupes); a genuine new
      // receipt from a reopened modal gets a fresh token and is allowed.
      window._srIdemKey = window._srIdemKey || (window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : 'sr-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      window._savingReceipt = true;
      const _srSaveBtn = document.querySelector('#modal-receipt .ff-save-btn');
      if (_srSaveBtn) _srSaveBtn.disabled = true;
      try {
        const saved = await api('POST', '/api/sales-receipts', { customer, amount, date, method, notes, idempotency_key: window._srIdemKey });
        _receiptsData.unshift(saved.row || saved);
        window.receipts = _receiptsData;
        window._srIdemKey = null;   // success → the next receipt mints a fresh token
        closeModal('modal-receipt');
        renderReceipts();
        notify(`Receipt for ${esc(customer)} saved ✦`);
        loadReceipts().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        // Keep _srIdemKey so a manual retry of this SAME submit is idempotent (same token → 23505 → original row).
        notify('Could not save — ' + e.message, true);
      } finally {
        window._savingReceipt = false;
        if (_srSaveBtn) _srSaveBtn.disabled = false;
      }
    };

    window.deleteReceipt = async function (id) {
      if (!(await window._confirmModal('Delete this receipt? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/sales-receipts/${id}`);
        _receiptsData = _receiptsData.filter(r => r.id !== id);
        renderReceipts();
        notify('Receipt deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // PAYMENTS RECEIVED
    // ════════════════════════════════════════════
    let _paymentsRecvData = [], _paymentsRecvFetched = false;

    // F95 step 2/3: this page is now a READ-ONLY LEDGER of invoice_payments (Store B — real
    // settlements, real payment_date), not payments_received (Store A — confirmed empty in
    // production, F86). The no-invoice_id call hits the list branch added to
    // GET /api/invoice-payments for exactly this page (server.js). Recording a payment happens
    // on the Invoices page via "Mark paid" (which already writes Store B); this page no longer
    // offers a way to record or delete a payment itself — see the orphaned functions below.
    async function loadPaymentsReceived() {
      try {
        const rows = await api('GET', '/api/invoice-payments');
        _paymentsRecvFetched = true;
        _paymentsRecvData = rows || [];
        window.paymentsReceived = _paymentsRecvData;
        console.log('[Payments Received] loaded', _paymentsRecvData.length);
        renderPaymentsReceived();
      } catch (e) { console.warn('[Payments Received]', e.message); }
    }
    loadPaymentsReceived();

    window.renderPaymentsReceived = function () {
      if (!_paymentsRecvFetched) { loadPaymentsReceived(); return; }
      const el = document.getElementById('payments-recv-list');
      if (!el) return;
      // Store B rows carry invoice_id, not a customer name or a free-text invoice_ref — resolve
      // both from window._realInvoices (already loaded below for the Outstanding/Overdue KPI;
      // same array, same load-order assumption the KPI already relied on). A payment whose
      // invoice isn't in that array yet (not loaded, or a different entity) falls back to '—'
      // rather than guessing — same tolerance the KPI below already has for an empty array.
      const _prInvById = new Map((window._realInvoices || []).map(inv => [inv.id, inv]));
      el.innerHTML = _paymentsRecvData.length
        ? _paymentsRecvData.map(r => {
            const _prInv = _prInvById.get(r.invoice_id);
            return `
          <div class="table-row" data-style="grid-template-columns:1fr 100px 80px 80px 70px 90px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span data-style="font-weight:500">${esc(_prInv?.client || '—')}</span>
            <span data-style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(_prInv?.number || _prInv?.num || '—')}</span>
            <span data-style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span data-style="color:var(--t2)">${esc((window.FinFlowDates ? window.FinFlowDates.fmtLabel(r.payment_date, {year:true}) : (r.payment_date || '')) || '—')}</span>
            <span data-style="color:var(--t2)">${esc(window._humanPayMethod(r.method))}</span>
            <button class="btn btn-ghost btn-sm" data-style="justify-self:end" data-arg-id="${r.id}" data-on-click="viewPaymentReceived(Number(this.dataset.argId))">View</button>
          </div>`;
          }).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No payments received yet</div>';
      // KPI cards: total received · outstanding · overdue · avg days to pay
      // Outstanding/overdue are derived from window._realInvoices (set by the dashboard wiring).
      // FA-M12c: avg days to pay = for each invoice PAID IN FULL, the days from its issue date to its last payment,
      // averaged — calendar dates as strings (Rule 10), from the payments on this page. It was never computed.
      // FA-M12e: none paid → "—". A skipped (null) slot kept the PREVIOUS business's figure after a switch.
      // L5: the card is labelled "This month" — sum this calendar month's payments, not all time.
      const _prTotal = _paymentsRecvData.filter(r => inThisMonth(r.payment_date)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _prInvs = window._realInvoices || [];
      // F56: same canonical AR definition as the dashboard card, the Invoices page and the
      // server — otherwise this page showed a different Outstanding than the dashboard did.
      const _prAr = (typeof window._arOutstanding === 'function')
        ? window._arOutstanding(_prInvs) : { total: 0, overdueTotal: 0 };
      const _prOut = _prAr.total;
      const _prOver = _prAr.overdueTotal;
      const _lastPay = {};
      _paymentsRecvData.forEach(r => { const d = String(r.payment_date || '').slice(0, 10); if (r.invoice_id != null && /^\d{4}-\d{2}-\d{2}$/.test(d) && (!_lastPay[r.invoice_id] || d > _lastPay[r.invoice_id])) _lastPay[r.invoice_id] = d; });
      const _dayN = s => { const p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; };
      const _spans = _prInvs.filter(i => String(i.status || '').toLowerCase() === 'paid' && _lastPay[i.id] && /^\d{4}-\d{2}-\d{2}/.test(String(i.issue_date || '')))
        .map(i => Math.max(0, _dayN(_lastPay[i.id]) - _dayN(String(i.issue_date).slice(0, 10))));
      const _avgDays = _spans.length ? Math.round(_spans.reduce((s, x) => s + x, 0) / _spans.length) : null;
      setKpiCards('page-payments-received', [S(_prTotal), S(_prOut), S(_prOver), _avgDays == null ? '—' : _avgDays + (_avgDays === 1 ? ' day' : ' days')]);
      { const _sub = document.querySelectorAll('#page-payments-received .mc-change')[3];
        if (_sub) _sub.textContent = _spans.length ? (_spans.length + ' paid invoice' + (_spans.length === 1 ? '' : 's')) : 'No paid invoices yet'; }
      window._refreshDashboardUI?.();
    };

    // F35 Step 5: this Store-A "payment received" opener is renamed off the colliding
    // `openRecordPaymentModal` name (which now belongs SOLELY to the invoice Store-B opener,
    // index.html:4160). The invoice "Record Payment" button therefore reaches Store B (real
    // invoice_id, flips status via recalcInvoiceStatus), not this blank received-payment form.
    //
    // F95 step 2/3: ORPHANED, PENDING ROUTE RETIREMENT. The "+ Record Payment" button that called
    // this was removed from index.html (#page-payments-received) — this page no longer calls
    // openPaymentReceivedModal/savePaymentReceived/deletePaymentReceived at all. Left defined,
    // not deleted: the underlying Store-A routes (POST/PUT/DELETE /api/payments-received) are
    // NOT gated yet — that's a separate, later step — so this function still works if invoked
    // directly, it just has no remaining caller on this page.
    window.openPaymentReceivedModal = function () {
      ['pr-customer','pr-invoice-ref','pr-amount','pr-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('pr-date'); if (d) d.value = todayStr();
      const m = document.getElementById('pr-method'); if (m) m.value = 'Bank Transfer';
      window._prIdemKey = null;   // C1 Wave 1: fresh submit-intent → a genuine new receipt never reuses the last token
      openModal('modal-payment-received');
    };

    window.savePaymentReceived = async function () {
      // C1 Wave 1: in-flight re-entry lock — a double-click cannot fire a 2nd receipt POST. UX layer
      // only; the durable guarantee is the DB idempotency index (idx_payments_received_idem_key).
      if (window._savingPaymentReceived) return;
      const customer = document.getElementById('pr-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('pr-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const invoice_ref = document.getElementById('pr-invoice-ref')?.value?.trim() || '';
      const date        = document.getElementById('pr-date')?.value   || todayStr();
      const method      = document.getElementById('pr-method')?.value || 'Bank Transfer';
      const notes       = document.getElementById('pr-notes')?.value?.trim() || '';
      // One idempotency token per submit-intent: minted lazily, reused on retry of THIS modal, reset
      // on modal open and on success below. Double-submit reuses it (→ DB dedupes); a genuine new
      // receipt from a reopened modal gets a fresh token and is allowed.
      window._prIdemKey = window._prIdemKey || (window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : 'pr-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      window._savingPaymentReceived = true;
      const _prSaveBtn = document.querySelector('#modal-payment-received .ff-save-btn');
      if (_prSaveBtn) _prSaveBtn.disabled = true;
      try {
        // F95 step 2: the optimistic `_paymentsRecvData.unshift(saved Store-A row)` that used to
        // sit here is REMOVED — _paymentsRecvData is Store-B-shaped now (invoice_id/payment_date,
        // no customer/invoice_ref), so splicing a Store-A row into it rendered a garbled row for
        // one frame before loadPaymentsReceived() below overwrote it anyway. This does NOT change
        // where the payment is written (still POST /api/payments-received, still Store A, still
        // step 3's job) — it only removes a now-incorrect render side effect of THIS step's change.
        closeModal('modal-payment-received');
        await api('POST', '/api/payments-received', { customer, invoice_ref, amount, date, method, notes, idempotency_key: window._prIdemKey });
        window._prIdemKey = null;   // success → the next receipt mints a fresh token
        notify(`Payment from ${esc(customer)} recorded ✦`);
        loadPaymentsReceived().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        // Keep _prIdemKey so a manual retry of this SAME submit is idempotent (same token → 23505 → original row).
        notify('Could not save — ' + e.message, true);
      } finally {
        window._savingPaymentReceived = false;
        if (_prSaveBtn) _prSaveBtn.disabled = false;
      }
    };

    // F95 step 2: no longer called from the row template (the delete "✕" column was removed —
    // deleting by `r.id` against Store A would be wrong/dangerous now that rows are Store-B
    // invoice_payments; the two tables are independent SERIAL sequences, so an id collision could
    // delete an unrelated Store-A row instead of 404ing safely). Left defined, unreferenced,
    // pending the step-3 write-path decision — not deleted, so re-wiring it later is a one-line
    // change, not a rewrite.
    window.deletePaymentReceived = async function (id) {
      if (!(await window._confirmModal('Delete this payment record? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/payments-received/${id}`);
        _paymentsRecvData = _paymentsRecvData.filter(r => r.id !== id);
        renderPaymentsReceived();
        notify('Payment record deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // RECURRING INVOICES
    // ════════════════════════════════════════════
    let _recurringInvData = [], _recurringInvFetched = false;

    async function loadRecurringInvoices() {
      try {
        const rows = await api('GET', '/api/recurring-invoices');
        _recurringInvFetched = true;
        _recurringInvData = rows || [];
        window.recurringInvoices = _recurringInvData;
        console.log('[Recurring Invoices] loaded', _recurringInvData.length);
        renderRecurringInvoices();
      } catch (e) { console.warn('[Recurring Invoices]', e.message); }
    }
    loadRecurringInvoices();

    window.renderRecurringInvoices = function () {
      if (!_recurringInvFetched) { loadRecurringInvoices(); return; }
      const el = document.getElementById('recurring-inv-list');
      if (!el) return;
      const cls = { active: 'b-green', paused: 'b-amber' };
      el.innerHTML = _recurringInvData.length
        ? _recurringInvData.map(r => `
          <div data-style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div data-style="font-weight:500;font-size:13px">${esc(r.client)}</div>
              <div data-style="font-size:11px;color:var(--t3);margin-top:2px">${esc(r.frequency)} · Next: ${esc(r.next_run || '—')}</div>
            </div>
            <div data-style="display:flex;align-items:center;gap:10px">
              <span data-style="font-family:var(--font-mono);font-weight:600">${S(r.amount)}</span>
              <span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status)}</span>
              <button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-id="${r.id}" data-on-click="deleteRecurringInvoice(Number(this.dataset.argId))">✕</button>
            </div>
          </div>`).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No recurring invoice profiles yet</div>';
      // KPI cards: active count · monthly value · next run · YTD generated (M31: _recurringYtd)
      // YTD comes from invoices that the recurring scheduler created (server
      // tags them with notes "Auto-generated from recurring schedule").
      const _riActive = _recurringInvData.filter(r => r.status?.toLowerCase() === 'active');
      const _riMonthly = _riActive.reduce((s, r) => s + monthlyEquiv(r.amount, r.frequency), 0);
      const _riNext = _riActive.map(r => r.next_run).filter(Boolean).sort()[0] || '—';
      // M31: fiscal-year-to-date (it was all-time), by the durable recurring_invoice_id lineage (legacy generated
      // invoices carry only the scheduler's note, so that still counts).
      const _riYtd = _recurringYtd(window._realInvoices, 'recurring_invoice_id', i => i.issue_date || i.created_at, i => (i.notes || '').includes('recurring schedule'));
      setKpiCards('page-recurring-invoices', [_riActive.length, S(_riMonthly), _riNext, S(_riYtd)]);
      window._refreshDashboardUI?.();
    };

    window.openNewRecurringModal = function () {
      ['ri-client','ri-amount','ri-end'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      window._pickCustomer?.('ri-client');   // FA-B4
      const f = document.getElementById('ri-freq'); if (f) f.value = 'Monthly';
      const n = document.getElementById('ri-next'); if (n) n.value = todayStr();
      const s = document.getElementById('ri-status'); if (s) s.value = 'active';
      openModal('recurring-inv-modal');
    };

    window.saveRecurringInvoice = async function () {
      const client = document.getElementById('ri-client')?.value?.trim();
      const amount = parseFloat(document.getElementById('ri-amount')?.value);
      if (!client) { notify('Client name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const frequency = document.getElementById('ri-freq')?.value   || 'Monthly';
      const next_run  = document.getElementById('ri-next')?.value   || todayStr();
      const status    = document.getElementById('ri-status')?.value || 'active';
      const end_date  = document.getElementById('ri-end')?.value    || null;
      try {
        const saved = await api('POST', '/api/recurring-invoices', { client, amount, frequency, next_run, status, end_date });
        _recurringInvData.unshift(saved.row || saved);
        window.recurringInvoices = _recurringInvData;
        closeModal('recurring-inv-modal');
        renderRecurringInvoices();
        notify(`Recurring profile for ${esc(client)} saved ✦`);
        loadRecurringInvoices().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteRecurringInvoice = async function (id) {
      if (!(await window._confirmModal('Delete this recurring profile? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/recurring-invoices/${id}`);
        _recurringInvData = _recurringInvData.filter(r => r.id !== id);
        renderRecurringInvoices();
        notify('Profile deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // CREDIT NOTES
    // ════════════════════════════════════════════
    let _creditNotesData = [], _creditNotesFetched = false;
      // FA-M6: void / reopen a credit (the only statuses a person sets — Applied comes from applying it)
      window.setCreditStatus = async function (kind, id, status) {
        try { await api('PUT', '/api/' + kind + '/' + id, { status }); }
        catch (e) { notify((e && e.message) || 'Could not update the credit', true); return; }
        notify(status === 'Void' ? 'Voided — it no longer reduces revenue' : 'Reopened');
        if (kind === 'credit-notes') loadCreditNotes(); else loadVendorCredits();
      };
    // FA-M6b: a credit shows what is left of it; Apply settles part of one of ITS customer's invoices / vendor's bills.
    // One row builder and one set of cards for both kinds, so credit notes and vendor credits cannot drift apart again
    // (their status colours had: Open was amber on one page and green on the other).
    const _CREDIT_UI = {
      credit_note:   { party: 'customer', path: 'credit-notes',   view: 'viewCreditNote',   del: 'deleteCreditNote',   docs: () => window._realInvoices || window.userInvoices || [], docParty: d => d.client, docNum: d => d.number || ('#' + (d._dbId || d.id)), docWord: 'invoice', word: 'credit note' },
      vendor_credit: { party: 'vendor',   path: 'vendor-credits', view: 'viewVendorCredit', del: 'deleteVendorCredit', docs: () => window.bills || [], docParty: d => d.vendor || d.vendor_name, docNum: d => d.num || ('#' + d.id), docWord: 'bill', word: 'vendor credit' },
    };
    const _creditLeft = r => Math.max(0, Math.round(((parseFloat(r.amount) || 0) - (parseFloat(r.applied) || 0)) * 100) / 100);
    const _creditRowsHTML = (rows, kind) => {
      const u = _CREDIT_UI[kind], cls = { Open: 'b-amber', Applied: 'b-green', Void: 'b-red' };
      return rows.map(r => {
        const left = _creditLeft(r), applied = parseFloat(r.applied) || 0, isVoid = r.status === 'Void';
        const actions = '<button class="btn btn-ghost btn-sm" data-arg-fn="' + u.view + '" data-arg-id="' + r.id + '" data-on-click="window[this.dataset.argFn](Number(this.dataset.argId))">View</button>'
          + (isVoid ? '' : '<button class="btn btn-ghost btn-sm" data-arg-kind="' + kind + '" data-arg-id="' + r.id + '" data-on-click="openApplyCredit(this.dataset.argKind, Number(this.dataset.argId))">' + (left > 0.005 ? 'Apply' : 'Applied to') + '</button>')
          + (isVoid ? '<button class="btn btn-ghost btn-sm" data-arg-path="' + u.path + '" data-arg-id="' + r.id + '" data-on-click="setCreditStatus(this.dataset.argPath, Number(this.dataset.argId), \'Open\')">Reopen</button>'
            : (applied > 0.005 ? '' : '<button class="btn btn-ghost btn-sm" data-arg-path="' + u.path + '" data-arg-id="' + r.id + '" data-on-click="setCreditStatus(this.dataset.argPath, Number(this.dataset.argId), \'Void\')">Void</button>'))
          + '<button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" aria-label="Delete" data-arg-fn="' + u.del + '" data-arg-id="' + r.id + '" data-on-click="window[this.dataset.argFn](Number(this.dataset.argId))">✕</button>';
        return `
          <div class="table-row" data-style="grid-template-columns:1fr 90px 90px 80px 70px 170px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span data-style="font-weight:500">${esc(r[u.party] || '')}</span>
            <span data-style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span data-style="font-family:var(--font-mono)">${S(r.amount)}${applied > 0.005 && !isVoid ? '<br><span class="credit-left" data-style="font-size:11px;color:var(--t3)">' + esc(S(left)) + ' left</span>' : ''}</span>
            <span data-style="color:var(--t2)">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(r.date,{year:true}):(r.date||''))||'—')}</span>
            <span><span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status || 'Open')}</span></span>
            <div data-style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">${actions}</div>
          </div>`;
      }).join('');
    };
    const _creditCards = rows => {
      const live = rows.filter(r => r.status !== 'Void');
      const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
      return [S(sum(live, r => parseFloat(r.amount) || 0)), S(sum(live, _creditLeft)), S(sum(live, r => parseFloat(r.applied) || 0)),
        S(sum(live.filter(r => inThisMonth(r.date)), r => parseFloat(r.amount) || 0))];
    };
    // The Apply dialog: what this credit is already applied to (each can be unapplied) and, while some is left, the
    // party's open documents with what each still owes. The server re-checks every limit under a lock.
    window.openApplyCredit = async function (kind, id) {
      const u = _CREDIT_UI[kind];
      const list = kind === 'credit_note' ? _creditNotesData : _vendorCreditsData;
      const cr = (list || []).find(x => x.id === id); if (!cr) return;
      let apps = [];
      try { apps = (await api('GET', '/api/credit-applications?kind=' + kind + '&credit_id=' + id)) || []; } catch (e) { notify('Could not load this credit — ' + e.message, true); return; }
      const key = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
      const docs = u.docs();
      const docId = d => d._dbId || d.id;
      const owed = d => Math.max(0, Math.round(((parseFloat(d.amount) || 0) - (parseFloat(d.amount_paid) || 0)) * 100) / 100);
      const issued = d => { const s = String(d.status || '').toLowerCase(); return s && s !== 'draft' && s !== 'void'; };
      const open = docs.filter(d => key(u.docParty(d)) === key(cr[u.party]) && issued(d) && owed(d) > 0.005);
      const left = _creditLeft(cr);
      const old = document.getElementById('apply-credit-overlay'); if (old) old.remove();
      const o = document.createElement('div'); o.id = 'apply-credit-overlay';
      o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
      const appRows = apps.map(a => { const d = docs.find(x => docId(x) === a.doc_id);
        return '<div data-style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bd)"><span>' + esc(d ? u.docNum(d) : (u.docWord + ' #' + a.doc_id)) + ' · ' + esc(window.FinFlowDates ? window.FinFlowDates.fmtLabel(a.applied_date, { year: true }) : a.applied_date) + '</span><span data-style="font-family:var(--font-mono)">' + esc(S(a.amount)) + '</span><button class="btn btn-ghost btn-sm" data-arg-kind="' + kind + '" data-arg-id="' + id + '" data-arg-id-2="' + a.id + '" data-on-click="unapplyCredit(this.dataset.argKind, Number(this.dataset.argId), Number(this.dataset.argId2))">Unapply</button></div>'; }).join('');
      const docOpts = open.map(d => '<option value="' + docId(d) + '" data-owed="' + owed(d) + '">' + esc(u.docNum(d)) + ' — ' + esc(S(owed(d))) + ' owed</option>').join('');
      const today = window._entityToday ? window._entityToday() : new Date().toISOString().slice(0, 10);
      const form = left > 0.005
        ? (open.length
          ? '<label class="form-label" for="apc-doc">Apply to</label><select id="apc-doc" class="form-input" data-on-change="_apcSuggest()">' + docOpts + '</select>'
            + '<div data-style="display:flex;gap:8px;margin-top:8px"><div data-style="flex:1"><label class="form-label" for="apc-amount">Amount</label><input id="apc-amount" class="form-input" type="number" min="0.01" step="0.01"></div>'
            + '<div data-style="flex:1"><label class="form-label" for="apc-date">Date</label><input id="apc-date" class="form-input" type="date" value="' + esc(today) + '"></div></div>'
            + '<button class="btn btn-primary" data-style="margin-top:12px;width:100%" data-arg-kind="' + kind + '" data-arg-id="' + id + '" data-on-click="submitApplyCredit(this.dataset.argKind, Number(this.dataset.argId))">Apply credit</button>'
          : '<div data-style="color:var(--t2);font-size:13px">' + esc(cr[u.party] || 'This ' + u.party) + ' has no open ' + u.docWord + 's to apply it to. The credit still lowers what they owe in total.</div>')
        : '<div data-style="color:var(--t2);font-size:13px">All of this credit is applied.</div>';
      o.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Apply ' + esc(u.word) + '" data-style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-xl);width:100%;max-width:460px;max-height:90vh;overflow:auto;padding:1rem 1.25rem">'
        + '<div data-style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div data-style="font-size:14px;font-weight:500">' + esc(u.word.charAt(0).toUpperCase() + u.word.slice(1)) + ' ' + esc(cr.num || '') + ' · ' + esc(cr[u.party] || '') + '</div><button class="btn btn-ghost btn-sm" data-on-click="document.getElementById(\'apply-credit-overlay\').remove()">✕ Close</button></div>'
        + '<div data-style="font-size:13px;color:var(--t2);margin-bottom:10px">' + esc(S(cr.amount)) + ' credit · <strong class="apc-left">' + esc(S(left)) + ' left to apply</strong></div>'
        + (appRows ? '<div data-style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-top:6px">Applied to</div>' + appRows + '<div data-style="height:10px"></div>' : '')
        + form + '</div>';
      document.body.appendChild(o);
      o.addEventListener('click', e => { if (e.target === o) o.remove(); });
      o.dataset.left = String(left);
      window._apcSuggest();
    };
    window._apcSuggest = function () {
      const o = document.getElementById('apply-credit-overlay'), sel = document.getElementById('apc-doc'), amt = document.getElementById('apc-amount');
      if (!o || !sel || !amt) return;
      const opt = sel.options[sel.selectedIndex];
      amt.value = Math.min(parseFloat(o.dataset.left) || 0, parseFloat(opt && opt.dataset.owed) || 0).toFixed(2);
    };
    window.submitApplyCredit = async function (kind, id) {
      const sel = document.getElementById('apc-doc'), amt = document.getElementById('apc-amount'), dt = document.getElementById('apc-date');
      if (!sel || !amt) return;
      const o = document.getElementById('apply-credit-overlay');
      if (o && o.dataset.busy) return;
      if (o) o.dataset.busy = '1';
      // one key per dialog submission: a double-click or a retried request lands once (the server holds it, Rule 9)
      const idem = (o && o.dataset.key) || ('apc-' + id + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      if (o) o.dataset.key = idem;
      try {
        await api('POST', '/api/credit-applications', { kind, credit_id: id, doc_id: Number(sel.value), amount: parseFloat(amt.value), date: dt && dt.value, idempotency_key: idem });
      } catch (e) { if (o) delete o.dataset.busy; notify((e && e.message) || 'Could not apply the credit', true); return; }
      notify('Credit applied');
      await _afterCreditChange(kind);
      window.openApplyCredit(kind, id);
    };
    window.unapplyCredit = async function (kind, id, appId) {
      try { await api('DELETE', '/api/credit-applications/' + appId); }
      catch (e) { notify((e && e.message) || 'Could not unapply the credit', true); return; }
      notify('Unapplied — the amount is back on the credit');
      await _afterCreditChange(kind);
      window.openApplyCredit(kind, id);
    };
    async function _afterCreditChange(kind) {
      if (kind === 'credit_note') await loadCreditNotes(); else await loadVendorCredits();
      if (typeof window.refreshFinancials === 'function') await window.refreshFinancials(kind === 'credit_note' ? 'invoices' : 'bills');
      if (kind === 'vendor_credit' && typeof window._loadBillsFromDB === 'function') await window._loadBillsFromDB();
    }
    async function loadCreditNotes() {
      try {
        const rows = await api('GET', '/api/credit-notes');
        _creditNotesFetched = true;
        _creditNotesData = rows || [];
        window.creditNotes = _creditNotesData;
        console.log('[Credit Notes] loaded', _creditNotesData.length);
        renderCreditNotes();
      } catch (e) { console.warn('[Credit Notes]', e.message); }
    }
    loadCreditNotes();

    window.renderCreditNotes = function () {
      if (!_creditNotesFetched) { loadCreditNotes(); return; }
      const el = document.getElementById('credit-notes-list');
      if (!el) return;
      el.innerHTML = _creditNotesData.length
        ? _creditRowsHTML(_creditNotesData, 'credit_note')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No credit notes yet</div>';
      // KPI cards (FA-M6b): issued (not void) · still to apply · applied to invoices · issued this month — money, each
      setKpiCards('page-credit-notes', _creditCards(_creditNotesData));
      window._refreshDashboardUI?.();
    };

    window.openNewCreditNoteModal = function () {
      ['cn-customer','cn-amount','cn-reason'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      window._pickCustomer?.('cn-customer');   // FA-B4
      const d = document.getElementById('cn-date'); if (d) d.value = todayStr();
      const s = document.getElementById('cn-status'); if (s) s.value = 'Open';
      window._cnIdemKey = null;   // C1 Wave 1: fresh submit-intent → a genuine new credit note never reuses the last token
      openModal('modal-credit-note');
    };

    window.saveCreditNote = async function () {
      // C1 Wave 1: in-flight re-entry lock — a double-click cannot fire a 2nd POST. UX layer only;
      // the durable guarantee is the DB idempotency index (idx_credit_notes_idem_key).
      if (window._savingCreditNote) return;
      const customer = document.getElementById('cn-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('cn-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('cn-date')?.value?.trim()   || todayStr();
      const status = document.getElementById('cn-status')?.value          || 'Open';
      const reason = document.getElementById('cn-reason')?.value?.trim()  || '';
      // One idempotency token per submit-intent: minted lazily, reused on retry of THIS modal, reset
      // on modal open and on success below. Double-submit reuses it (→ DB dedupes); a genuine new
      // credit note from a reopened modal gets a fresh token and is allowed.
      window._cnIdemKey = window._cnIdemKey || (window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : 'cn-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      window._savingCreditNote = true;
      const _cnSaveBtn = document.querySelector('#modal-credit-note .ff-save-btn');
      if (_cnSaveBtn) _cnSaveBtn.disabled = true;
      try {
        const saved = await api('POST', '/api/credit-notes', { customer, amount, date, status, reason, idempotency_key: window._cnIdemKey });
        _creditNotesData.unshift(saved.row || saved);
        window.creditNotes = _creditNotesData;
        window._cnIdemKey = null;   // success → the next credit note mints a fresh token
        closeModal('modal-credit-note');
        renderCreditNotes();
        notify(`Credit note for ${esc(customer)} saved ✦`);
        loadCreditNotes().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        // Keep _cnIdemKey so a manual retry of this SAME submit is idempotent (same token → 23505 → original row).
        notify('Could not save — ' + e.message, true);
      } finally {
        window._savingCreditNote = false;
        if (_cnSaveBtn) _cnSaveBtn.disabled = false;
      }
    };

    window.deleteCreditNote = async function (id) {
      if (!(await window._confirmModal('Delete this credit note? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/credit-notes/${id}`);
        _creditNotesData = _creditNotesData.filter(r => r.id !== id);
        renderCreditNotes();
        notify('Credit note deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // VENDORS
    // ════════════════════════════════════════════
    let _vendorsData = [], _vendorsFetched = false;
    // LA14 (HANDOVER C19, Vendors part — same class as LA4): bill / payment vendors that match no saved vendor
    // (GET /api/vendors/unsaved, the same pass as the saved list). Keyed by business; a stale response is dropped (C1).
    let _vendorsUnsaved = { eid: null, rows: [] }, _vendorsUnsavedSeq = 0;
    const _vendorsEid = () => (window.ENTITIES || []).find(e => e.active)?._dbId || null;
    const _vendorsUnsavedNow = () => (_vendorsUnsaved.eid === _vendorsEid() ? _vendorsUnsaved.rows : []);

    async function loadVendors() {
      const seq = ++_vendorsUnsavedSeq;
      try {
        const _eidV2 = _vendorsEid();
        const _q = _eidV2 ? '?entity_id=' + _eidV2 : '';
        const [rows, unsaved] = await Promise.all([
          api('GET', '/api/vendors' + _q),
          api('GET', '/api/vendors/unsaved' + _q).catch(e => { console.error('[Vendors] could not load bill vendors:', e.message); return []; }),
        ]);
        _vendorsFetched = true;
        _vendorsData = rows || [];
        window.vendors = _vendorsData;
        if (seq === _vendorsUnsavedSeq && _vendorsEid() === _eidV2) _vendorsUnsaved = { eid: _eidV2, rows: Array.isArray(unsaved) ? unsaved : [] };
        console.log('[Vendors] loaded', _vendorsData.length, '+', _vendorsUnsavedNow().length, 'not saved');
        renderVendors();
      } catch (e) { console.warn('[Vendors]', e.message); }
    }
    loadVendors();
    window.loadVendorsFromDB = loadVendors;   // batch 9: "Save all" refreshes the list

    window.openVendorModalFromUnsaved = function (i) {
      const u = _vendorsUnsavedNow()[i]; if (!u) return;
      window.openNewVendorModal();
      const n = document.getElementById('vendor-name'); if (n) n.value = u.name || '';
    };

    function renderVendorRows(list, unsavedList) {
      const el = document.getElementById('vendors-list');
      if (!el) return;
      const unsaved = (unsavedList || _vendorsUnsavedNow()).map(u => ({ u, i: _vendorsUnsavedNow().indexOf(u) }));
      // Batch 9 (D3): one click saves them all — with a preview that holds back look-alikes of saved vendors.
      const unsavedHead = unsaved.length ? `<div class="ff-saveall-head" data-style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:8px 10px;margin:4px 0;border-radius:var(--radius);background:var(--bg2)"><div><div data-style="font-weight:500">${unsaved.length} vendor name${unsaved.length === 1 ? '' : 's'} from bills not saved as vendors</div><div data-style="font-size:11px;color:var(--t3)">Review them and save in one go</div></div><button class="btn btn-primary btn-sm" data-on-click="openSaveAllContacts('vendor')">Save all…</button></div>` : '';
      const unsavedHtml = unsavedHead + unsaved.map(({ u, i }) => `
          <div class="table-row" data-style="grid-template-columns:1fr 100px 90px 90px 80px 50px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div data-style="font-weight:500">${esc(u.name)}</div>
              <div data-style="font-size:11px;color:var(--t3)">${u.bills} bill${u.bills === 1 ? '' : 's'} · not saved as a vendor yet</div>
            </div>
            <span data-style="color:var(--t3)">—</span>
            <span data-style="color:${u.owing > 0 ? 'var(--amber)' : 'var(--t2)'}">
              ${u.owing > 0 ? S(u.owing) + ' owing' : '—'}
            </span>
            <span data-style="color:var(--t2)">${S(u.ytd_paid || 0)} YTD</span>
            <span><span class="badge b-amber">Not saved</span></span>
            <button class="btn btn-ghost btn-sm" data-arg-i="${i}" data-on-click="openVendorModalFromUnsaved(Number(this.dataset.argI))">Save</button>
          </div>`).join('');
      el.innerHTML = (list.length || unsaved.length)
        ? list.map(v => `
          <div class="table-row" data-style="grid-template-columns:1fr 100px 90px 90px 80px 50px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div data-style="font-weight:500">${esc(v.name)}</div>
              <div data-style="font-size:11px;color:var(--t3)">${esc(v.contact || '—')}</div>
            </div>
            <span><span class="badge b-blue" data-style="font-size:10px">${esc(v.category || 'Other')}</span></span>
            <span data-style="color:${v.owing > 0 ? 'var(--amber)' : 'var(--t2)'}">
              ${v.owing > 0 ? S(v.owing) + ' owing' : '—'}
            </span>
            <span data-style="color:var(--t2)">${S(v.ytd_paid || 0)} YTD</span>
            <span><span class="badge ${v.status === 'active' ? 'b-green' : 'b-red'}">${esc(v.status || 'active')}</span></span>
            <button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-id="${v.id}" data-on-click="deleteVendor(Number(this.dataset.argId))">✕</button>
          </div>`).join('') + unsavedHtml
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No vendors yet</div>';
    }

    // F-C1: bills/vendors overdue = Σ balance of UNPAID bills past their due date (entity-local today).
    // Replaces the old status==='overdue' literal (never set) and the hardcoded null on vendors.
    window._billsOverdueSum = function (bills) {
      const today = window.FinFlowDates ? (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date())) : new Date().toISOString().slice(0, 10);
      const UNPAID = ['unpaid', 'due_soon', 'overdue', 'partial', 'pending'];
      return (bills || []).reduce((s, b) => {
        const st = (b.status || '').toLowerCase();
        if (!UNPAID.includes(st)) return s;
        const d = b.due_date ? String(b.due_date).slice(0, 10) : null;
        if (!d || d >= today) return s;   // no due date, or not yet past due
        return s + Math.max(0, (parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0));
      }, 0);
    };

    // C16: a bill's DISPLAY status — "overdue" when it still has a balance past its due date (the same date rule as
    // _billsOverdueSum and the Overdue card). Nothing stores 'overdue', so the row badge showed "unpaid" while the
    // card counted the bill as overdue.
    window._billDisplayStatus = function (b) {
      const st = String((b && b.status) || '').toLowerCase();
      if (st === 'paid') return 'paid';
      const today = window.FinFlowDates ? (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date())) : new Date().toISOString().slice(0, 10);
      const d = b && b.due_date ? String(b.due_date).slice(0, 10) : null;
      const bal = (parseFloat(b && b.amount) || 0) - (parseFloat(b && b.amount_paid) || 0);
      if (d && d < today && bal > 0.005) return 'overdue';
      return st || 'unpaid';
    };

    // N24b: the payables card is the CANONICAL accounts payable — the balance sheet's figure (computeBooks:
    // recognised bills issued on or before today, less open|applied vendor credits). It used to be recomputed
    // here from the bills list (every non-paid bill, future-dated ones included, vendor credits ignored), so the
    // Vendors page and the Balance Sheet / AP report showed two different payables totals.
    let _vendorsApSeq = 0;
    async function _refreshVendorsPayables() {
      const seq = ++_vendorsApSeq;
      try {
        const _eid = (window.ENTITIES || []).find(e => e.active)?._dbId;
        const bs = await api('POST', '/api/reports/balance-sheet' + (_eid ? '?entity_id=' + _eid : ''), {});
        if (seq !== _vendorsApSeq) return;   // a newer refresh is in flight
        const ap = bs && bs.accountsPayable != null ? parseFloat(bs.accountsPayable) : NaN;
        setKpiCards('page-vendors', [null, Number.isFinite(ap) ? S(ap) : '—']);
      } catch (e) {
        if (seq === _vendorsApSeq) setKpiCards('page-vendors', [null, '—']);   // never a stale or recomputed figure
        console.warn('[Vendors] payables', e.message);
      }
    }

    window.renderVendors = function () {
      if (!_vendorsFetched) { loadVendors(); return; }
      renderVendorRows(_vendorsData);
      // KPI cards: count · total payables (canonical AP, filled by _refreshVendorsPayables) · overdue · paid
      const _vPaid = _paymentsMadeData.filter(r => inThisMonth(r.date)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);   // L5: "This month"
      const _vOverdue = window._billsOverdueSum(_billsData);   // F-C1: was hardcoded null → static $0
      setKpiCards('page-vendors', [_vendorsData.length + _vendorsUnsavedNow().length, null, S(_vOverdue), S(_vPaid)]);   // LA14: incl. not-saved bill vendors
      _refreshVendorsPayables();
      window._refreshDashboardUI?.();
    };

    window.filterVendorsBySearch = function (v) {
      const q = v.toLowerCase();
      renderVendorRows(q
        ? _vendorsData.filter(r => (r.name || '').toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || (r.contact || '').toLowerCase().includes(q))
        : _vendorsData,
        q ? _vendorsUnsavedNow().filter(u => (u.name || '').toLowerCase().includes(q)) : null);
    };

    window.openNewVendorModal = function () {
      ['vendor-name','vendor-contact'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const c = document.getElementById('vendor-category'); if (c) c.value = 'Software';
      openModal('vendor-modal');
    };

    window.saveVendor = async function () {
      const name = document.getElementById('vendor-name')?.value?.trim();
      if (!name) { notify('Vendor name required', true); return; }
      const contact  = document.getElementById('vendor-contact')?.value?.trim()  || '';
      const category = document.getElementById('vendor-category')?.value          || 'Other';
      try {
        const _eidVNew = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        // N24: owing / YTD paid come from the vendor's bills and payments (server-derived) — not typed in.
        const saved = await api('POST', '/api/vendors', { name, contact, category, status: 'active', entity_id: _eidVNew });
        _vendorsData.unshift(saved.row || saved);
        window.vendors = _vendorsData;
        closeModal('vendor-modal');
        renderVendors();
        notify(`${esc(name)} added ✦`);
        loadVendors().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteVendor = async function (id) {
      const v = _vendorsData.find(r => r.id === id);
      if (!v || !(await window._confirmModal(`Delete vendor ${v.name}? This cannot be undone.`, {danger:true}))) return;
      try {
        await api('DELETE', `/api/vendors/${id}`);
        _vendorsData = _vendorsData.filter(r => r.id !== id);
        renderVendors();
        notify('Vendor deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // BILLS
    // ════════════════════════════════════════════
    let _billsData = [], _billsFetched = false;

    async function loadBills() {
      try {
        const _eidB2 = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/bills' + (_eidB2 ? '?entity_id=' + _eidB2 : ''));
        _billsFetched = true;
        _billsData = rows || [];
        window.bills = _billsData;
        console.log('[Bills] loaded', _billsData.length);
        renderBills();
      } catch (e) { console.warn('[Bills]', e.message); }
    }
    loadBills();

    window.renderBills = function () {
      if (!_billsFetched) { loadBills(); return; }
      const el = document.getElementById('bills-list');
      if (!el) return;
      const cls = { unpaid: 'b-amber', due_soon: 'b-amber', overdue: 'b-red', paid: 'b-green' };
      el.innerHTML = _billsData.length
        ? _billsData.map(b => `
          <div class="table-row" data-style="grid-template-columns:1fr 100px 80px 90px 80px 160px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span data-style="font-weight:500">${esc(b.vendor)}</span>
            <span data-style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(b.num || '')}</span>
            <span data-style="font-family:var(--font-mono)">${S(b.amount)}</span>
            <span data-style="color:${window._billDisplayStatus(b) === 'overdue' ? 'var(--red)' : 'var(--t2)'}">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(b.due_date,{year:true}):(b.due_date||''))||'No due date')}</span>
            <span>${window._isScheduled(b.issue_date||b.created_at||b.due_date) ? '<span class="badge b-blue" title="Future-dated — scheduled, not yet counted in your books">Scheduled</span> ' : ''}${window.FinFlowDates.isInventoryBill(b) ? '<span class="badge b-blue" title="Stock bought on credit — the cost is inventory, reaching the P&amp;L as COGS when sold">Stock</span> ' : ''}<span class="badge ${cls[window._billDisplayStatus(b)] || 'b-amber'}">${esc(window._billDisplayStatus(b))}</span></span>
            <div data-style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm" data-arg-id="${b.id}" data-on-click="viewBill(Number(this.dataset.argId))">View</button>
              <button class="btn btn-ghost btn-sm" data-arg-id="${b.id}" data-on-click="editBill(Number(this.dataset.argId))">Edit</button>
              ${b.status?.toLowerCase() !== 'paid' ? `<button class="btn btn-ghost btn-sm" data-arg-id="${b.id}" data-on-click="markBillPaid(Number(this.dataset.argId))">Pay</button>` : ''}
              ${window.FinFlowDates.isInventoryBill(b) ? '' : `<button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-id="${b.id}" data-on-click="deleteBill(Number(this.dataset.argId))">✕</button>`}
            </div>
          </div>`).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No bills yet</div>';

      // badge
      // M25: the badge counts bills PAST DUE with a balance — the same date-based rule as the Overdue card
      // (_billsOverdueSum). It counted the literal statuses 'overdue' / 'due_soon', which nothing sets.
      const _bdToday = window.FinFlowDates ? (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date())) : new Date().toISOString().slice(0, 10);
      const overdue = _billsData.filter(b => window._billsOverdueSum([b]) > 0 && String(b.due_date || '').slice(0, 10) < _bdToday).length;
      const badge = document.getElementById('badge-bills');
      if (badge) { badge.textContent = overdue; badge.style.display = overdue > 0 ? '' : 'none'; }
      // KPI cards: count · due-this-week sum · overdue sum · paid sum
      const _blOverdue = window._billsOverdueSum(_billsData);   // F-C1: date-based (due_date past + unpaid), not status-literal
      // L5: "Paid · This month" = cash paid AGAINST bills this calendar month (bill-linked payments made),
      // the same rows the Vendors and Payments Made "Paid" cards draw from. It was Σ amount of FULLY-paid
      // bills, all-time — a partly-paid bill counted 0, and nothing was month-scoped.
      const _blPaid = _paymentsMadeData.filter(r => r.bill_id != null && inThisMonth(r.date)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      // L8 (Rule 10): due dates are CALENDAR dates — compare 'YYYY-MM-DD' strings over [today, today+7], never
      // Date instants (new Date('2026-07-25') is UTC midnight, which lands on the previous local day west of
      // UTC and dropped a bill due today). Balance, not the face amount, is what is still due.
      const _blToday = (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date()));
      const _blWeek = (() => { const p = _blToday.split('-').map(Number); const t = Date.UTC(p[0], p[1] - 1, p[2] + 7); return new Date(t).toISOString().slice(0, 10); })();
      const _blDueWeek = _billsData.filter(b => {
        if (b.status?.toLowerCase() === 'paid' || !b.due_date) return false;
        const d = window.FinFlowDates._toYmd(b.due_date); return d != null && d >= _blToday && d <= _blWeek;
      }).reduce((s, b) => s + Math.max(0, (parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0)), 0);
      setKpiCards('page-bills', [_billsData.length, S(_blDueWeek), S(_blOverdue), S(_blPaid)]);
      window._refreshDashboardUI?.();
    };

    window.openNewBillModal = function () {
      ['bill-vendor','bill-amount','bill-notes','bill-end-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const iss = document.getElementById('bill-issue'); if (iss) iss.value = (typeof todayLocal==='function'?todayLocal():todayStr()); // F36: default issue date = today (local)
      const d = document.getElementById('bill-due'); if (d) d.value = '';
      const s = document.getElementById('bill-status'); if (s) s.value = 'unpaid';
      const rc = document.getElementById('bill-recurring'); if (rc) rc.checked = false;
      const ro = document.getElementById('bill-recurring-opts'); if (ro) ro.style.display = 'none';
      const bf = document.getElementById('bill-freq'); if (bf) bf.value = 'Monthly';
      window._billIdemKey = null;   // C1 Wave 1: fresh submit-intent → a genuine new bill never reuses the last token
      window._billEditId = null;    // batch 7: "New bill" is never an edit of the last bill opened
      { const t = document.querySelector('#bill-modal .modal-title'); if (t) t.textContent = 'New Bill'; }
      try { if (window.ffBillLineItems && window.ffBillLineItems.reset) window.ffBillLineItems.reset(); } catch (_) {}
      if (typeof window._fillContactPicker === 'function') window._fillContactPicker('bill-vendor', 'ff-vend-list', '/api/vendors', v => v.name);   // batch 9: pick a saved vendor
      if (window._docTermsSet) window._docTermsSet('bill');   // FA-B5
      if (typeof window._invDueHint === 'function') window._invDueHint('bill');   // FA-M5b: the due date the terms give, before saving
      openModal('bill-modal');
    };

    // Batch 7: open the bill form PRE-FILLED for an existing bill (fields + line items); saveBill then PUTs to it.
    window.editBill = async function (id) {
      let b = (_billsData || []).find(r => r.id === id);
      if (!b) { try { await loadBills(); } catch (_) {} b = (_billsData || []).find(r => r.id === id); }
      if (!b) { notify('That bill could not be found — refresh and try again', true); return; }
      window.openNewBillModal();
      const set = (fid, v) => { const el = document.getElementById(fid); if (el) el.value = v == null ? '' : v; };
      const ymd = v => (window.FinFlowDates ? (window.FinFlowDates._toYmd(v) || '') : String(v || '').slice(0, 10));
      set('bill-vendor', b.vendor); set('bill-amount', b.amount != null ? Number(b.amount) : '');
      set('bill-issue', ymd(b.issue_date)); set('bill-due', ymd(b.due_date));
      if (window._docTermsSet) window._docTermsSet('bill', ymd(b.issue_date), ymd(b.due_date));   // FA-B5: this bill's own terms
      set('bill-status', String(b.status || 'unpaid').toLowerCase()); set('bill-notes', b.notes);
      if (Array.isArray(b.line_items) && b.line_items.length && window.ffBillLineItems && window.ffBillLineItems.load) window.ffBillLineItems.load(b.line_items);
      window._billEditId = b.id;
      if (typeof window._invDueHint === 'function') window._invDueHint('bill');   // FA-M5b
      const t = document.querySelector('#bill-modal .modal-title'); if (t) t.textContent = 'Edit bill — ' + (b.vendor || '');
    };

    // Next occurrence date for a recurring bill (mirrors server nextRunDate).
    // F159/Rule 10: a next_run is a calendar date. The old `new Date(dateStr)` + local setMonth
    // made the result depend on the VIEWER's timezone (a 1st-of-month date rolled back a day west
    // of UTC). Compute with integer Y/M/D + UTC-only day math so no timezone can shift it.
    function _billNextRun(dateStr, freq) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || todayStr()).slice(0, 10));
      if (!m) return null;
      let y = +m[1], mo = +m[2], d = +m[3];
      const f = String(freq || '').trim().toLowerCase();
      if (f === 'weekly') return new Date(Date.UTC(y, mo - 1, d) + 7 * 86400000).toISOString().slice(0, 10);
      if (f === 'quarterly')                                   mo += 3;
      else if (f === 'yearly' || f === 'annually' || f === 'annual') y += 1;
      else                                                    mo += 1; // Monthly / default
      y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12) + 1;
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(); if (d > dim) d = dim;
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    window.saveBill = async function () {
      // C1 Wave 1: in-flight re-entry lock — a double-click cannot fire a 2nd POST. UX layer only;
      // the durable guarantee is the DB idempotency index (idx_bills_idem_key).
      if (window._savingBill) return;
      const vendor = document.getElementById('bill-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('bill-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const due_date = document.getElementById('bill-due')?.value    || null;
      const issue_date = document.getElementById('bill-issue')?.value || (typeof todayLocal==='function'?todayLocal():todayStr()); // F36/F38
      const status   = document.getElementById('bill-status')?.value || 'unpaid';
      const notes    = document.getElementById('bill-notes')?.value?.trim() || '';
      const recurring = !!document.getElementById('bill-recurring')?.checked;
      const frequency = document.getElementById('bill-freq')?.value || 'Monthly';
      const endDate   = document.getElementById('bill-end-date')?.value || null;
      // Batch 7: EDIT — saved to the SAME bill (PUT). The server keeps the ledger in step, refuses an amount below what is
      // paid (G3) and keeps a stock purchase's amount/date with the purchase (M34); its reason reaches the owner as is.
      if (window._billEditId != null) {
        const _id = window._billEditId;
        window._savingBill = true;
        const _eb = document.querySelector('#bill-modal .ff-save-btn'); if (_eb) _eb.disabled = true;
        try {
          const _bli = (window.ffBillLineItems && window.ffBillLineItems.get && window.ffBillLineItems.get()) || null;
          await api('PUT', '/api/bills/' + _id, Object.assign({ vendor, due_date, issue_date, status, notes }, _bli ? { line_items: _bli } : { amount, line_items: null }));
          window._billEditId = null;
          closeModal('bill-modal');
          notify(`Bill from ${esc(vendor)} updated ✦`);
          await loadBills().catch(() => {});
          renderBills();
          window._refreshDashboardUI?.();
          if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
        } catch (e) { notify(e.message || 'Could not update the bill', true); }
        finally { window._savingBill = false; if (_eb) _eb.disabled = false; }
        return;
      }
      // One idempotency token per submit-intent: minted lazily, reused on retry of THIS modal, reset
      // on modal open (openNewBillModal) and on success below. Double-submit reuses it (→ DB dedupes);
      // a genuine new bill from a reopened modal gets a fresh token and is allowed.
      window._billIdemKey = window._billIdemKey || (window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : 'bill-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      window._savingBill = true;
      const _billSaveBtn = document.querySelector('#bill-modal .ff-save-btn');
      if (_billSaveBtn) _billSaveBtn.disabled = true;
      try {
        const _eidBNew = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        // F194 Phase 2b: attach line_items when present. The server re-derives amount = Σ qty×rate
        // (Rule 2) and that derived amount flows to expense recognition; `amount` here is the mirror.
        const _bli = (window.ffBillLineItems && window.ffBillLineItems.get && window.ffBillLineItems.get()) || null;
        const saved = await api('POST', '/api/bills', { vendor, amount, due_date, issue_date, status, notes, entity_id: _eidBNew, idempotency_key: window._billIdemKey, ...(_bli ? { line_items: _bli } : {}) });
        _billsData.unshift(saved.row || saved);
        window.bills = _billsData;
        // Recurring: this bill IS the current occurrence; also create a recurring
        // profile scheduled for the NEXT cycle so the server's hourly scheduler
        // (runRecurringScheduler) generates future bills. next_run is strictly
        // after the due date, so today's bill is never duplicated. Reuses the
        // existing /api/recurring-bills route + table; end_date is optional.
        if (recurring) {
          try {
            await api('POST', '/api/recurring-bills', {
              vendor, amount, frequency,
              next_run: _billNextRun(due_date, frequency),
              status: 'active', end_date: endDate,
            });
            if (typeof loadRecurringBills === 'function') loadRecurringBills().catch(()=>{});
          } catch (re) { notify('Bill saved, but recurring setup failed — ' + re.message, true); }
        }
        window._billIdemKey = null;   // success → the next bill mints a fresh token
        closeModal('bill-modal');
        renderBills();
        notify(recurring ? `Recurring bill for ${esc(vendor)} set up ✦` : `Bill from ${esc(vendor)} saved ✦`);
        loadBills().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) {
        // Keep _billIdemKey so a manual retry of this SAME submit is idempotent (same token → 23505 → original row).
        notify('Could not save — ' + e.message, true);
      } finally {
        window._savingBill = false;
        if (_billSaveBtn) _billSaveBtn.disabled = false;
      }
    };

    // M48 (money audit 2026-10-09): "Pay" on a bill opens the Make Payment form LINKED to that bill — amount defaults
    // to the outstanding balance and the date to today, both editable — so a partial payment is just a smaller amount
    // (server recalcBillStatus → 'partial'; checkBillPayment refuses an overpayment). It used to post the whole
    // outstanding balance, dated the browser's today, on one click: no partial path, no back-dating, and a second
    // writer of bill payments beside savePaymentMade (no idempotency token). One writer now: savePaymentMade.
    window.markBillPaid = function (id) {
      const b = _billsData.find(r => r.id === id);
      if (!b) { notify('Bill not found', true); return; }
      window.openMakePaymentModal();
      const sel = document.getElementById('pm-bill');
      if (sel) { sel.value = String(id); window.onPmBillChange(); }
    };

    window.deleteBill = async function (id) {
      if (!(await window._confirmModal('Delete this bill? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/bills/${id}`);
        _billsData = _billsData.filter(r => r.id !== id);
        renderBills();
        notify('Bill deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // PAYMENTS MADE
    // ════════════════════════════════════════════
    let _paymentsMadeData = [], _paymentsMadeFetched = false;

    async function loadPaymentsMade() {
      try {
        const rows = await api('GET', '/api/payments-made');
        _paymentsMadeFetched = true;
        _paymentsMadeData = rows || [];
        window.paymentsMade = _paymentsMadeData;
        console.log('[Payments Made] loaded', _paymentsMadeData.length);
        renderPaymentsMade();
      } catch (e) { console.warn('[Payments Made]', e.message); }
    }
    loadPaymentsMade();

    window.renderPaymentsMade = function () {
      if (!_paymentsMadeFetched) { loadPaymentsMade(); return; }
      const el = document.getElementById('payments-made-list');
      if (!el) return;
      el.innerHTML = _paymentsMadeData.length
        ? _paymentsMadeData.map(r => `
          <div class="table-row" data-style="grid-template-columns:1fr 100px 80px 80px 90px 110px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span data-style="font-weight:500">${esc(r.vendor || '')}</span>
            <span data-style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.ref || '')}</span>
            <span data-style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span data-style="color:var(--t2)">${esc((window.FinFlowDates?window.FinFlowDates.fmtLabel(r.date,{year:true}):(r.date||''))||'—')}</span>
            <span data-style="color:var(--t2)">${esc(window._humanPayMethod(r.method))}</span>
            <div data-style="display:flex;gap:4px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-arg-id="${r.id}" data-on-click="viewPaymentMade(Number(this.dataset.argId))">View</button><button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-id="${r.id}" data-on-click="deletePaymentMade(Number(this.dataset.argId))">✕</button></div>
          </div>`).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No payments made yet</div>';
      // KPI cards: total paid · unique vendor count · largest single · avg
      // L5: "Paid" and "Vendors Paid" are labelled "This month"; Largest/Avg carry no period (all payments).
      const _pmMonth = _paymentsMadeData.filter(r => inThisMonth(r.date));
      const _pmTotal = _pmMonth.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _pmVendors = new Set(_pmMonth.map(r => r.vendor)).size;
      const _pmAmts = _paymentsMadeData.map(r => parseFloat(r.amount) || 0);
      const _pmLargest = _pmAmts.length ? Math.max(..._pmAmts) : 0;
      const _pmAvg = _pmAmts.length ? _pmAmts.reduce((s, a) => s + a, 0) / _pmAmts.length : 0;
      setKpiCards('page-payments-made', [S(_pmTotal), _pmVendors, S(_pmLargest), S(_pmAvg)]);
      window._refreshDashboardUI?.();
    };

    window.openMakePaymentModal = function () {
      ['pm-vendor','pm-amount','pm-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      window._pickVendor?.('pm-vendor');   // FA-B4
      const d = document.getElementById('pm-date'); if (d) d.value = todayStr();
      const m = document.getElementById('pm-method'); if (m) m.value = 'Bank Transfer';
      // F84: populate the (optional) bill selector from OPEN bills. Picking a bill links the payment
      // to it, so the server counts it as a SETTLEMENT (Dr AP / Cr Cash) — excluded from expense, no
      // double-count — and drops AP. Blank = a direct disbursement with no bill. Partial amounts are
      // allowed (server recalcBillStatus handles part-payment → status 'partial').
      const sel = document.getElementById('pm-bill');
      if (sel) {
        const open = (_billsData || []).filter(b => (b.status || '').toLowerCase() !== 'paid'
          && ((parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0)) > 0);
        sel.innerHTML = '<option value="">— none (direct expense) —</option>'
          + open.map(b => {
              const out = Math.round((((parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0))) * 100) / 100;
              return `<option value="${b.id}">${esc(b.vendor || 'Bill')} · ${esc(b.num || ('#' + b.id))} · ${S(out)} due</option>`;
            }).join('');
        sel.value = '';
      }
      window._pmIdemKey = null;   // C1 Wave 1: fresh submit-intent → a genuine new payment never reuses the last token
      openModal('modal-payment-made');
    };

    // F84: when a bill is chosen, prefill the vendor and default the amount to the bill's outstanding
    // balance — both still editable, so a partial payment is simply a smaller amount. Selecting the
    // blank "none" option changes nothing the user typed.
    window.onPmBillChange = function () {
      const sel = document.getElementById('pm-bill');
      if (!sel || !sel.value) return;
      const b = (_billsData || []).find(r => String(r.id) === String(sel.value));
      if (!b) return;
      const out = Math.round((((parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0))) * 100) / 100;
      const v = document.getElementById('pm-vendor'); if (v) v.value = b.vendor || '';
      const a = document.getElementById('pm-amount'); if (a) a.value = String(out);
    };

    window.savePaymentMade = async function () {
      // C1 Wave 1: in-flight re-entry lock — a double-click cannot fire a 2nd payment POST. UX layer
      // only; the durable guarantee is the DB idempotency index (idx_payments_made_idem_key).
      if (window._savingPaymentMade) return;
      const vendor = document.getElementById('pm-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('pm-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('pm-date')?.value   || todayStr();
      const method = document.getElementById('pm-method')?.value || 'Bank Transfer';
      const notes  = document.getElementById('pm-notes')?.value?.trim() || '';
      // F84: a selected bill links this payment — the server treats it as a settlement (Dr AP / Cr
      // Cash), excludes it from expense (the sole double-count guard, server.js:4378) and reduces AP.
      // Empty ⇒ omit bill_id ⇒ a direct disbursement that stays an expense (unchanged behaviour).
      const _billSel = document.getElementById('pm-bill')?.value;
      // One idempotency token per submit-intent: minted lazily, reused on retry of THIS modal, reset
      // on modal open (openMakePaymentModal) and on success below. Double-submit reuses it (→ DB
      // dedupes); a genuine new payment from a reopened modal gets a fresh token and is allowed.
      window._pmIdemKey = window._pmIdemKey || (window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : 'pm-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      const body = { vendor, amount, date, method, notes, idempotency_key: window._pmIdemKey };   // FA-M6c: the server numbers it
      if (_billSel) body.bill_id = Number(_billSel);
      window._savingPaymentMade = true;
      const _pmSaveBtn = document.querySelector('#modal-payment-made .ff-save-btn');
      if (_pmSaveBtn) _pmSaveBtn.disabled = true;
      try {
        const saved = await api('POST', '/api/payments-made', body);
        _paymentsMadeData.unshift(saved.row || saved);
        if (body.bill_id) { loadBills().catch(() => {}); }   // M48: the bill row flips partial / paid
        window.paymentsMade = _paymentsMadeData;
        window._pmIdemKey = null;   // success → the next payment mints a fresh token
        closeModal('modal-payment-made');
        renderPaymentsMade();
        notify(`Payment to ${esc(vendor)} recorded ✦`);
        loadPaymentsMade().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) {
        // Keep _pmIdemKey so a manual retry of this SAME submit is idempotent (same token → 23505 → original row).
        notify('Could not save — ' + e.message, true);
      } finally {
        window._savingPaymentMade = false;
        if (_pmSaveBtn) _pmSaveBtn.disabled = false;
      }
    };

    window.deletePaymentMade = async function (id) {
      if (!(await window._confirmModal('Delete this payment record? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/payments-made/${id}`);
        _paymentsMadeData = _paymentsMadeData.filter(r => r.id !== id);
        renderPaymentsMade();
        notify('Payment deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // RECURRING BILLS
    // ════════════════════════════════════════════
    let _recurringBillsData = [], _recurringBillsFetched = false;

    async function loadRecurringBills() {
      try {
        const rows = await api('GET', '/api/recurring-bills');
        _recurringBillsFetched = true;
        _recurringBillsData = rows || [];
        window.recurringBills = _recurringBillsData;
        console.log('[Recurring Bills] loaded', _recurringBillsData.length);
        renderRecurringBills();
      } catch (e) { console.warn('[Recurring Bills]', e.message); }
    }
    loadRecurringBills();

    window.renderRecurringBills = function () {
      if (!_recurringBillsFetched) { loadRecurringBills(); return; }
      const el = document.getElementById('recurring-bills-list');
      if (!el) return;
      const cls = { active: 'b-green', paused: 'b-amber' };
      el.innerHTML = _recurringBillsData.length
        ? _recurringBillsData.map(r => `
          <div data-style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div data-style="font-weight:500;font-size:13px">${esc(r.vendor)}</div>
              <div data-style="font-size:11px;color:var(--t3);margin-top:2px">${esc(r.frequency)} · Next: ${esc(r.next_run || '—')}</div>
            </div>
            <div data-style="display:flex;align-items:center;gap:10px">
              <span data-style="font-family:var(--font-mono);font-weight:600">${S(r.amount)}</span>
              <span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status)}</span>
              <button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7" data-arg-id="${r.id}" data-on-click="deleteRecurringBill(Number(this.dataset.argId))">✕</button>
            </div>
          </div>`).join('')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No recurring bill profiles yet</div>';
      // KPI cards: active count · monthly cost · next due · YTD total
      // YTD is approximated as monthly × elapsed months (Jan = 1 … current
      // month). No global "_realBills" array exists, so we can't filter
      // server-tagged bills the way recurring-invoices does.
      const _rbActive = _recurringBillsData.filter(r => r.status?.toLowerCase() === 'active');
      const _rbMonthly = _rbActive.reduce((s, r) => s + monthlyEquiv(r.amount, r.frequency), 0);
      const _rbNext = _rbActive.map(r => r.next_run).filter(Boolean).sort()[0] || '—';
      // M31 (money audit 2026-10-09): YTD = the bills the schedules ACTUALLY generated (recurring_bill_id lineage)
      // in this fiscal year to date — it was monthly cost × calendar month number, a projection that showed 700
      // in July for a profile whose first run is in August.
      const _rbYtd = _recurringYtd(window.bills, 'recurring_bill_id', b => b.issue_date || b.created_at);
      setKpiCards('page-recurring-bills', [_rbActive.length, S(_rbMonthly), _rbNext, S(_rbYtd)]);
      window._refreshDashboardUI?.();
    };

    window.openNewRecurringBillModal = function () {
      ['rb-vendor','rb-amount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      window._pickVendor?.('rb-vendor');   // FA-B4
      const f = document.getElementById('rb-freq'); if (f) f.value = 'Monthly';
      const n = document.getElementById('rb-next'); if (n) n.value = todayStr();
      const s = document.getElementById('rb-status'); if (s) s.value = 'active';
      openModal('recurring-bill-modal');
    };

    window.saveRecurringBill = async function () {
      const vendor = document.getElementById('rb-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('rb-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const frequency = document.getElementById('rb-freq')?.value   || 'Monthly';
      const next_run  = document.getElementById('rb-next')?.value   || todayStr();
      const status    = document.getElementById('rb-status')?.value || 'active';
      try {
        const saved = await api('POST', '/api/recurring-bills', { vendor, amount, frequency, next_run, status });
        _recurringBillsData.unshift(saved.row || saved);
        window.recurringBills = _recurringBillsData;
        closeModal('recurring-bill-modal');
        renderRecurringBills();
        notify(`Recurring bill for ${esc(vendor)} saved ✦`);
        loadRecurringBills().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteRecurringBill = async function (id) {
      if (!(await window._confirmModal('Delete this recurring profile? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/recurring-bills/${id}`);
        _recurringBillsData = _recurringBillsData.filter(r => r.id !== id);
        renderRecurringBills();
        notify('Profile deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // VENDOR CREDITS
    // ════════════════════════════════════════════
    let _vendorCreditsData = [], _vendorCreditsFetched = false;

    async function loadVendorCredits() {
      try {
        const rows = await api('GET', '/api/vendor-credits');
        _vendorCreditsFetched = true;
        _vendorCreditsData = rows || [];
        window.vendorCredits = _vendorCreditsData;
        console.log('[Vendor Credits] loaded', _vendorCreditsData.length);
        renderVendorCredits();
      } catch (e) { console.warn('[Vendor Credits]', e.message); }
    }
    loadVendorCredits();

    window.renderVendorCredits = function () {
      if (!_vendorCreditsFetched) { loadVendorCredits(); return; }
      const el = document.getElementById('vendor-credits-list');
      if (!el) return;
      el.innerHTML = _vendorCreditsData.length
        ? _creditRowsHTML(_vendorCreditsData, 'vendor_credit')
        : '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No vendor credits yet</div>';
      setKpiCards('page-vendor-credits', _creditCards(_vendorCreditsData));   // FA-M6b: same four figures as credit notes
      window._refreshDashboardUI?.();
    };

    window.openNewVendorCreditModal = function () {
      ['vc-vendor','vc-amount','vc-reason'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      window._pickVendor?.('vc-vendor');   // FA-B4
      const d = document.getElementById('vc-date'); if (d) d.value = todayStr();
      const s = document.getElementById('vc-status'); if (s) s.value = 'Open';
      openModal('modal-vendor-credit');
    };

    window.saveVendorCredit = async function () {
      const vendor = document.getElementById('vc-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('vc-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('vc-date')?.value?.trim()   || todayStr();
      const status = document.getElementById('vc-status')?.value          || 'Open';
      const reason = document.getElementById('vc-reason')?.value?.trim()  || '';
      try {
        const saved = await api('POST', '/api/vendor-credits', { vendor, amount, date, status, reason });
        _vendorCreditsData.unshift(saved.row || saved);
        window.vendorCredits = _vendorCreditsData;
        closeModal('modal-vendor-credit');
        renderVendorCredits();
        notify(`Vendor credit from ${esc(vendor)} saved ✦`);
        loadVendorCredits().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteVendorCredit = async function (id) {
      if (!(await window._confirmModal('Delete this vendor credit? This cannot be undone.', {danger:true}))) return;
      try {
        await api('DELETE', `/api/vendor-credits/${id}`);
        _vendorCreditsData = _vendorCreditsData.filter(r => r.id !== id);
        renderVendorCredits();
        notify('Vendor credit deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };

    // M31: Σ amount of documents a recurring schedule generated (lineage field, or the legacy note) issued in the
    // current fiscal year up to today — the same window as the dashboard's Year view.
    function _recurringYtd(rows, lineageField, dateOf, legacyMatch) {
      const _w = (typeof window._periodWindow === 'function') ? window._periodWindow('year', null) : null;
      return (rows || []).filter(r => (r[lineageField] != null || (legacyMatch && legacyMatch(r))) && String((r.status || '')).toLowerCase() !== 'draft' && (!_w || _w.inWin(dateOf(r))))
        .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    }

    // ── Expose load functions so entity-switch + showPage can reload ──
    window._loadVendorsFromDB        = loadVendors;       // overrides stubs.js — pages.js wins
    window._loadBillsFromDB          = loadBills;         // overrides stubs.js — pages.js wins
    window._loadReceiptsFromDB       = loadReceipts;
    window._loadPaymentsRecvFromDB   = loadPaymentsReceived;
    window._loadCreditNotesFromDB    = loadCreditNotes;
    window._loadPaymentsMadeFromDB   = loadPaymentsMade;
    window._loadVendorCreditsFromDB  = loadVendorCredits;
    window._loadRecurringBillsFromDB = loadRecurringBills;
    window._loadRecurringInvFromDB   = loadRecurringInvoices;
    window._loadQuotesFromDB         = loadQuotes;

    // ── showPage hooks for pages not already covered by stubs.js ─────
    const _pagesOrig = window.showPage;
    if (typeof _pagesOrig === 'function') {
      window.showPage = function (id, navEl) {
        _pagesOrig(id, navEl);
        if (id === 'sales-receipts')     loadReceipts();
        if (id === 'payments-received')  loadPaymentsReceived();
        if (id === 'credit-notes')       loadCreditNotes();
        if (id === 'payments-made')      loadPaymentsMade();
        if (id === 'vendor-credits')     loadVendorCredits();
        if (id === 'vendors')            loadVendors();
        if (id === 'bills')              loadBills();
        if (id === 'quotes')             loadQuotes();
        if (id === 'recurring-invoices') loadRecurringInvoices();
        if (id === 'recurring-bills')    loadRecurringBills();
      };
    }

    // ── F194 Phase 3: rich document View for every Money In/Out list (reuses ffOpenDocView) ──
    // Each viewX finds the record in its already-loaded array (closure-scoped here) and maps it to the
    // shared doc shape. The viewer (finflow-docview.js) owns letterhead (F196), TZ-safe dates (F195)
    // and the line-items table (Phase 2b) for free — nothing money-related is written, display only.
    window.viewBill = function (id) {
      const b = (_billsData || []).find(x => x.id === id); if (!b) return;
      window.ffOpenDocView({
        number: b.num, party: b.vendor, issue_date: b.issue_date || b.created_at || null,
        due_date: b.due_date || null, status: b.status || '', notes: b.notes || '',
        amount: b.amount, amount_paid: b.amount_paid, credit_applied: b.credit_applied || 0, tax: b.tax || 0, line_items: b.line_items || null, currency: b.currency || null,   // FA-M3: Amount Due nets payments made
      }, 'bill');
      if (window.ffDocHistory) window.ffDocHistory('bills', b.id);   // batch 7: what changed
    };
    window.viewQuote = function (id) {
      const q = (_quotesData || []).find(x => x.id === id); if (!q) return;
      window.ffOpenDocView({
        number: q.num, party: q.client, issue_date: q.issue_date || q.created_at || null,
        due_date: q.expiry_date || null, status: q.status || '', notes: q.notes || '',
        amount: q.amount, line_items: q.line_items || null, currency: q.currency || null,
      }, 'quote');
    };
    window.viewReceipt = function (id) {
      const r = (_receiptsData || []).find(x => x.id === id); if (!r) return;
      window.ffOpenDocView({
        number: r.num, party: r.customer, issue_date: r.date || null, status: r.status || 'paid',
        notes: r.notes || (r.method ? 'Payment method: ' + r.method : ''),
        amount: r.amount, line_items: r.line_items || null, currency: r.currency || null,
      }, 'receipt');
    };
    window.viewPaymentReceived = function (id) {
      const r = (_paymentsRecvData || []).find(x => x.id === id); if (!r) return;
      // Store-B rows carry invoice_id, not a party name — resolve client + num from _realInvoices,
      // exactly like renderPaymentsReceived does (same array, same tolerance for a missing invoice).
      const inv = new Map((window._realInvoices || []).map(i => [i.id, i])).get(r.invoice_id) || null;
      window.ffOpenDocView({
        number: r.num || (inv && (inv.number || inv.num)) || '', party: (inv && inv.client) || r.client || '—',   // G17: B1b stores `number`
        issue_date: r.payment_date || r.date || null, status: 'paid',
        notes: r.method ? 'Payment method: ' + r.method : (inv ? 'Payment for ' + (inv.number || inv.num || 'invoice') : ''),
        amount: r.amount, currency: r.currency || null,
      }, 'payment');
    };
    window.viewCreditNote = function (id) {
      const r = (_creditNotesData || []).find(x => x.id === id); if (!r) return;
      window.ffOpenDocView({
        number: r.num, party: r.customer, issue_date: r.date || null, status: r.status || 'Open',
        notes: r.notes || r.reason || '', amount: r.amount, line_items: r.line_items || null, currency: r.currency || null,
      }, 'credit-note');
    };
    window.viewVendorCredit = function (id) {
      const r = (_vendorCreditsData || []).find(x => x.id === id); if (!r) return;
      window.ffOpenDocView({
        number: r.num, party: r.vendor, issue_date: r.date || null, status: r.status || 'Open',
        notes: r.notes || r.reason || '', amount: r.amount, line_items: r.line_items || null, currency: r.currency || null,
      }, 'vendor-credit');
    };
    window.viewPaymentMade = function (id) {
      const r = (_paymentsMadeData || []).find(x => x.id === id); if (!r) return;
      window.ffOpenDocView({
        number: r.num, party: r.vendor, issue_date: r.date || null, status: 'paid',
        notes: r.method ? 'Payment method: ' + r.method : (r.bill_id ? 'Payment for bill' : ''),
        amount: r.amount, currency: r.currency || null,
      }, 'payment');
    };

    console.log('[FinFlow API Wiring — Pages] ✅ Quotes, Receipts, Payments Received, Recurring Invoices, Credit Notes, Vendors, Bills, Payments Made, Recurring Bills, Vendor Credits wired');
  })()
})();


;
/* ── finflow-api-wiring-extra.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — EXTRA WIRING
// Fixes: 1) Invoice View modal   2) Timesheet page (full wiring)
//        3) Reports live metrics 4) Budget live rows
//        5) Investments from API 6) Team from payroll API
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Coalesce concurrent identical GETs. On a cold boot each list loader is fired from the
  // module init AND again from the render pass before the first fetch resolves; sharing the
  // in-flight promise collapses those duplicates into ONE request. GET-only (never mutations),
  // and the entry clears as soon as it settles, so a later reload still fetches fresh data.
  const _inflightGets = new Map();
  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const isGet = String(method).toUpperCase() === 'GET';
    if (isGet && _inflightGets.has(path)) return _inflightGets.get(path);
    const p = (async () => {
      const res = await fetch(path, opts);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `API error ${res.status}`); }
      return res.json();
    })();
    if (isGet) { _inflightGets.set(path, p); const done = () => { if (_inflightGets.get(path) === p) _inflightGets.delete(path); }; p.then(done, done); }
    return p;
  }

  function e(s) {
    return typeof window.esc === 'function'
      ? window.esc(s)
      : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) { return typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toFixed(2); }
  function tip(msg, isErr) { if (typeof notify === 'function') notify(msg, isErr); else console.warn(msg); }
  const today = () => (window.todayLocal ? window.todayLocal() : new Date().toISOString().slice(0, 10));  // C3/F37: local date, not UTC

  // ══════════════════════════════════════════════════════
  // 1. INVOICE VIEW MODAL
  // ══════════════════════════════════════════════════════
  window.viewInvoice = function (idx) {
    const inv = (window.userInvoices || [])[idx];
    if (!inv) return;

    let modal = document.getElementById('inv-view-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'inv-view-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `<div class="modal">
        <div class="modal-header">
          <div><div class="modal-title">Invoice Details</div><div class="modal-sub" id="ivm-sub"></div></div>
          <button class="modal-close" data-on-click="document.getElementById('inv-view-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div id="ivm-body" data-style="margin-top:4px"></div>
      </div>`;
      document.body.appendChild(modal);
    }

    const _st = (inv.status || '').toLowerCase();
    const _stTitle = _st ? _st.charAt(0).toUpperCase() + _st.slice(1) : 'Invoice';
    const _stBadge = { paid:'b-green', pending:'b-amber', partial:'b-blue', overdue:'b-red' }[_st] || 'b-amber';
    document.getElementById('ivm-sub').textContent = _stTitle + ' invoice — ' + (inv.client || '');
    document.getElementById('ivm-body').innerHTML = `
      <div data-style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px">
        <div>
          <div data-style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Client</div>
          <div data-style="font-size:14px;font-weight:600;color:var(--t1);margin-top:4px">${e(inv.client)}</div>
        </div>
        <div>
          <div data-style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Amount</div>
          <div data-style="font-size:14px;font-weight:600;color:var(--acc);margin-top:4px;font-family:var(--font-mono)">${money(inv.amount)}</div>
        </div>
        <div>
          <div data-style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Due Date</div>
          <div data-style="font-size:13px;color:var(--t2);margin-top:4px">${e(inv.due || '—')}</div>
        </div>
        <div>
          <div data-style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Status</div>
          <div data-style="margin-top:4px"><span class="badge ${_stBadge}">${e(inv.status)}</span></div>
        </div>
      </div>
      ${inv.notes ? `<div data-style="margin-top:16px;padding:10px;background:var(--bg2);border-radius:var(--radius);font-size:12px;color:var(--t2);line-height:1.5">${e(inv.notes)}</div>` : ''}
    `;
    modal.classList.remove('hidden');
    if (typeof window._ffApplyCurrencyLabels === 'function') window._ffApplyCurrencyLabels();   // FA-M13
  };

  // ══════════════════════════════════════════════════════
  // 2. TIMESHEET — full wiring
  // ══════════════════════════════════════════════════════
  let _tsData = [], _tsFetched = false;

  async function loadTimesheet() {
    try {
      const rows = await api('GET', '/api/timesheet');
      _tsFetched = true;
      _tsData = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      window.timesheet = _tsData;
      window.timesheetData = _tsData;
      renderTimesheetList();
      updateTimesheetMetrics();
    } catch (err) { console.warn('[Timesheet]', err.message); }
  }
  // Expose under the name the user-facing code expects
  window.renderTimesheet     = renderTimesheetList;
  window.loadTimesheetFromDB = loadTimesheet;

  const _isBillable = t => {
    const b = t.billable;
    if (b === true  || b === 1)              return true;
    if (b === false || b === 0 || b == null) return false;
    return String(b).toLowerCase() === 'yes';
  };
  window._isBillable = _isBillable;

  function renderTimesheetList() {
    const el = document.getElementById('timesheet-list');
    if (!el) return;
    if (!_tsData.length) {
      el.innerHTML = '<div data-style="padding:2rem;text-align:center;color:var(--t3)">No time entries yet — click + Log Time to add one</div>';
      return;
    }
    el.innerHTML = _tsData.map(t => `
      <div data-style="display:grid;grid-template-columns:1fr 100px 80px 70px 70px 70px 36px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
        <span data-style="font-weight:500">${e(t.employee)}</span>
        <span data-style="color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(_tsProjectLabel(t) || '—')}</span>
        <span data-style="color:var(--t2)">${e(t.date || '—')}</span>
        <span data-style="font-family:var(--font-mono)">${(t.hours || 0)}h</span>
        <span><span class="badge ${_isBillable(t) ? 'b-green' : 'b-amber'}">${_isBillable(t) ? 'Yes' : 'No'}</span></span>
        <span data-style="font-family:var(--font-mono);color:var(--t2)">${t.rate ? (typeof window._nativeSymbol === 'function' ? window._nativeSymbol() : '$') + t.rate + '/h' : '—'}</span>
        <span data-style="display:inline-flex;gap:2px"><button class="btn btn-ghost btn-sm" data-style="padding:0 4px" title="Edit" data-arg-id="${t.id}" data-on-click="editTimesheetEntry(Number(this.dataset.argId))">✎</button><button class="btn btn-ghost btn-sm" data-style="color:var(--red);opacity:.7;padding:0 4px" data-arg-id="${t.id}" data-on-click="deleteTimesheetEntry(Number(this.dataset.argId))">✕</button></span>
      </div>`).join('');
  }

  // FIX-1: a linked entry shows its project's CURRENT name; an unlinked one its free-text label.
  function _tsProjectLabel(t) {
    const p = t.project_id != null ? (window.projects || []).find(x => x.id === t.project_id) : null;
    return p ? p.name : t.project;
  }

  function updateTimesheetMetrics() {
    // L5: "Hours Logged" is labelled "This month", and Billable / Non-Billable / rate / Avg per Day are
    // its breakdown — all four read this calendar month's entries (they summed all time).
    const _inM     = typeof window._inThisMonth === 'function' ? window._inThisMonth : () => true;
    const _tsM     = _tsData.filter(t => _inM(t.date));
    const total    = _tsM.reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);
    const billable = _tsM.filter(_isBillable).reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);
    const nb       = total - billable;
    const rate     = total > 0 ? Math.round(billable / total * 100) : 0;
    const days     = new Set(_tsM.map(t => t.date)).size;
    const avg      = days > 0 ? total / days : 0;

    // Format hours: integers as "5h", decimals as "5.5h", zero as "0h"
    const fmtH = (n) => {
      if (!n || n === 0) return '0h';
      const rounded = Math.round(n * 10) / 10;
      return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + 'h';
    };

    const mcs = document.querySelectorAll('#page-timesheet .mc-val');
    if (mcs[0]) mcs[0].textContent = fmtH(total);
    if (mcs[1]) mcs[1].textContent = fmtH(billable);
    if (mcs[2]) mcs[2].textContent = fmtH(nb);
    if (mcs[3]) mcs[3].textContent = fmtH(avg);
    const chgs = document.querySelectorAll('#page-timesheet .mc-change');
    if (chgs[1]) chgs[1].textContent = rate + '% billable rate';
  }

  function buildTimesheetModal() {
    let modal = document.getElementById('ts-log-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'ts-log-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `<div class="modal">
      <div class="modal-header">
        <div><div class="modal-title">Log Time</div><div class="modal-sub">Record a time entry</div></div>
        <button class="modal-close" data-on-click="document.getElementById('ts-log-modal').classList.add('hidden')">
          <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
        </button>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Employee *</label><input class="finput" id="ts-employee" placeholder="Name or team member"></div>
        <div class="field-wrap"><label class="field-label">Project</label><select class="finput" id="ts-project-id"></select></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Label (if no project)</label><input class="finput" id="ts-project" placeholder="e.g. client or task — not counted on a project"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Date</label><input class="finput" id="ts-date" type="date"></div>
        <div class="field-wrap"><label class="field-label">Hours *</label><input class="finput" id="ts-hours" type="number" min="0.25" step="0.25" placeholder="e.g. 2.5"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Billable?</label><select class="finput" id="ts-billable"><option value="Yes">Yes — billable</option><option value="No">No — internal</option></select></div>
        <div class="field-wrap"><label class="field-label">Rate (<span data-cur="biz">USD</span>/hr)</label><input class="finput" id="ts-rate" type="number" min="0" placeholder="0"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-on-click="document.getElementById('ts-log-modal').classList.add('hidden')">Cancel</button>
        <button class="btn btn-primary" data-on-click="saveTimesheetEntry()">Save entry →</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  // FIX-1: the project picker lists this business's projects (time logged to one counts on that project).
  function _fillTsProjects() {
    const sel = document.getElementById('ts-project-id');
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">— No project —</option>' +
      (window.projects || []).slice().sort((x, y) => String(x.name).localeCompare(String(y.name)))
        .map(p => `<option value="${p.id}">${e(p.name)}</option>`).join('');
    if (keep && sel.querySelector(`option[value="${keep}"]`)) sel.value = keep;
  }

  // LR10 (decision 2026-10-21): an entry can be EDITED — the same modal, pre-filled; Save sends PUT for that entry.
  // _tsEditId is the entry being edited (null = a new entry); every open of "+ Log Time" clears it.
  window._tsEditId = null;
  window.editTimesheetEntry = async function (id) {
    let t = _tsData.find(x => x.id === id);
    if (!t) { try { await loadTimesheet(); } catch (_) {} t = _tsData.find(x => x.id === id); }   // not cached yet (e.g. added elsewhere) → fetch
    if (!t) { tip('That time entry could not be found — refresh and try again', true); return; }
    const modal = buildTimesheetModal();
    // The project list MUST be loaded before the form is filled: an entry whose project is not in the list would save
    // with no project — silently unlinking it.
    if (!_projectsFetched || !(window.projects || []).some(p => String(p.id) === String(t.project_id))) { try { await loadProjects(); } catch (_) {} }
    _fillTsProjects();
    document.getElementById('ts-employee').value = t.employee || '';
    document.getElementById('ts-project').value = t.project || '';
    document.getElementById('ts-project-id').value = t.project_id != null ? String(t.project_id) : '';
    document.getElementById('ts-date').value = String(t.date || '').slice(0, 10) || today();
    document.getElementById('ts-hours').value = t.hours != null ? String(t.hours) : '';
    document.getElementById('ts-rate').value = t.rate ? String(t.rate) : '';
    document.getElementById('ts-billable').value = t.billable || 'Yes';
    { const h = modal.querySelector('.modal-title'); const st = modal.querySelector('.modal-sub');   // FA-B6: the title says new or edit
      if (h) h.textContent = 'Edit time entry'; if (st) st.textContent = 'Change this time entry'; }
    window._tsEditId = id;
    modal.classList.remove('hidden');
    if (typeof window._ffApplyCurrencyLabels === 'function') window._ffApplyCurrencyLabels();   // FA-M13
  };

  window.openLogTimeModal = function () {
    const modal = buildTimesheetModal();
    window._tsEditId = null;   // LR10: a new entry, never the last one edited
    { const h = modal.querySelector('.modal-title'); const st = modal.querySelector('.modal-sub');   // FA-B6: the title says new or edit
      if (h) h.textContent = 'Log Time'; if (st) st.textContent = 'Record a time entry'; }
    document.getElementById('ts-employee').value = '';
    document.getElementById('ts-project').value  = '';
    document.getElementById('ts-project-id').value = '';
    _fillTsProjects();
    if (!_projectsFetched) loadProjects().then(_fillTsProjects).catch(() => {});
    document.getElementById('ts-date').value     = today();
    document.getElementById('ts-hours').value    = '';
    document.getElementById('ts-rate').value     = '';
    document.getElementById('ts-billable').value = 'Yes';
    modal.classList.remove('hidden');
    if (typeof window._ffApplyCurrencyLabels === 'function') window._ffApplyCurrencyLabels();   // FA-M13
  };

  window.saveTimesheetEntry = async function () {
    const employee = document.getElementById('ts-employee')?.value?.trim();
    const hours    = parseFloat(document.getElementById('ts-hours')?.value);
    if (!employee) { tip('Employee name required', true); return; }
    if (!hours || hours <= 0) { tip('Valid hours required', true); return; }
    const project  = document.getElementById('ts-project')?.value?.trim()  || '';
    const project_id = parseInt(document.getElementById('ts-project-id')?.value, 10) || null;
    const date     = document.getElementById('ts-date')?.value             || today();
    const billable = document.getElementById('ts-billable')?.value         || 'Yes';
    const rate     = parseFloat(document.getElementById('ts-rate')?.value) || 0;
    if (window._tsSaving) return;   // one save at a time (a double click never sends twice)
    window._tsSaving = true;
    const editId = window._tsEditId;
    try {
      if (editId != null) {
        // LR10: edit — PUT the entry (server re-checks the project link against the entry's own business; audited).
        const updated = await api('PUT', `/api/timesheet/${editId}`, { employee, project, project_id, date, hours, billable, rate });
        _tsData = _tsData.map(t => t.id === editId ? Object.assign({}, t, updated && updated.id ? updated : { employee, project, project_id, date, hours, billable, rate }) : t);
        window._tsEditId = null;
      } else {
        const saved = await api('POST', '/api/timesheet', { employee, project, project_id, date, hours, billable, rate });
        _tsData.unshift(saved.row || saved);
      }
      window.timesheet = _tsData;
      document.getElementById('ts-log-modal')?.classList.add('hidden');
      renderTimesheetList();
      updateTimesheetMetrics();
      tip(editId != null ? 'Time entry updated ✦' : 'Time entry saved ✦');
      loadTimesheet().catch(()=>{});
      loadProjects().catch(()=>{});   // FIX-1: the project's hours / billed come from its entries
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not save — ' + err.message, true); }
    finally { window._tsSaving = false; }
  };

  window.deleteTimesheetEntry = async function (id) {
    if (!(await window._confirmModal('Delete this time entry?', {danger:true}))) return;
    try {
      await api('DELETE', `/api/timesheet/${id}`);
      _tsData = _tsData.filter(t => t.id !== id);
      renderTimesheetList();
      updateTimesheetMetrics();
      tip('Entry deleted');
      loadProjects().catch(()=>{});   // FIX-1
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not delete — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 3. REPORTS — enrich top metrics with live data
  // ══════════════════════════════════════════════════════
  // Status-aware GET for this scoped surface — attaches HTTP status so a genuine
  // failure (5xx / network) is distinguishable from logged-out (401/403). Local;
  // the shared api() copies are left untouched.
  async function apiGetStatus(path) {
    const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { const e = new Error('API error ' + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  // Reports KPI three-state renderer. 'loaded' is set inline below; this covers the
  // loading and load-failed states over the #page-reports metric cards.
  function _reportsSetState(state) {
    const mcs  = document.querySelectorAll('#page-reports .mc-val');
    const chgs = document.querySelectorAll('#page-reports .mc-change');
    if (state === 'loading') {
      [0, 1, 2].forEach(i => { if (mcs[i]) mcs[i].textContent = '…'; });
      if (chgs[1]) { chgs[1].textContent = 'Loading…'; chgs[1].className = 'mc-change neutral'; }
    } else if (state === 'error') {
      [0, 1, 2].forEach(i => { if (mcs[i]) mcs[i].textContent = '—'; });
      if (chgs[1]) {
        chgs[1].innerHTML = 'Unable to load · ' + (window._ffRetryBtn ? window._ffRetryBtn('renderReports') : 'Retry');
        chgs[1].className = 'mc-change dn';
      }
    }
  }
  const _origRenderReports = typeof renderReports === 'function' ? renderReports : null;
  window.renderReports = async function () {
    if (_origRenderReports) _origRenderReports();   // static lists render immediately
    _reportsSetState('loading');
    try {
      const [invoices, expenses] = await Promise.all([
        apiGetStatus('/api/invoices'),
        apiGetStatus('/api/expenses'),
      ]);
      // ── F128 (second half): DELEGATE, exactly as generateReport does. ────────────────────────
      // This is the SAME defect as the report modal's, on the page BEHIND it: paid-only revenue
      // (the pre-F32 basis), Σ-expenses-only opex (no bills, no payroll, no F58 contras) and no
      // period window. The two were written separately and drifted together — which is why fixing
      // one and not the other would have left the Reports PAGE contradicting the Reports MODAL
      // launched from it, and both contradicting the dashboard.
      //
      // Rule 1 note: this function is a WRAPPER — it calls _origRenderReports() above (which paints
      // the static report lists) and then overwrites the metric cards. So these three cards are the
      // runtime-winning values; app-main's own paid-only recompute feeds only the onclick args that
      // the replacement generateReport ignores. Fixing it there would have rendered nothing.
      //
      // Same three sources as the modal, so page, modal and dashboard cannot disagree (Rule 6).
      if (typeof window.computeRevenue !== 'function' || typeof window.computeExpenseBreakdown !== 'function') {
        // Honest failure, never a fabricated total: the engines read window._realInvoices /
        // _realExpenses, so if they are absent a "0" here would read as a business with no revenue.
        const _e = new Error('Report engine not ready'); _e.status = 0; throw _e;
      }
      const period   = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
      const revenue  = window.computeRevenue(period);
      const expTotal = window.computeExpenseBreakdown(period).total;
      const cogs     = parseFloat(window._cogsTotal) || 0;
      const profit   = revenue - cogs - expTotal;      // the dashboard's composition (app-main.js:2167)
      // Native symbol: these come out of the engines unconverted (F124), and the shared money()
      // helper routes through S(), which would stamp activeCurrency on an unconverted figure.
      const _m = n => (typeof window._fmtMoneyNative === 'function') ? window._fmtMoneyNative(n) : money(n);
      const PERIOD_LABEL = { month: 'this month', quarter: 'this quarter', year: 'this fiscal year to date' };

      const mcs  = document.querySelectorAll('#page-reports .mc-val');
      const chgs = document.querySelectorAll('#page-reports .mc-change');
      // The three cards' static labels ("Reports Available"/"Last Generated"/"Scheduled") described a
      // different set of stats than the figures this wrapper actually paints (records-on-file / revenue /
      // net result). Relabel them so the title, value and caption of each card agree.
      const lbls = document.querySelectorAll('#page-reports .mc-label');
      if (lbls[0]) lbls[0].textContent = 'Records on File';
      if (lbls[1]) lbls[1].textContent = 'Revenue';
      if (lbls[2]) lbls[2].textContent = 'Net Result';
      if (mcs[0])  mcs[0].textContent  = invoices.length + expenses.length;
      if (chgs[0]) chgs[0].textContent  = 'Invoices & expenses on file';
      if (mcs[1])  mcs[1].textContent  = _m(revenue);
      // The old caption read "Paid revenue this period" — wrong on BOTH counts once this is accrual
      // AND period-scoped, and a stale caption on a corrected figure is its own defect.
      if (chgs[1]) { chgs[1].textContent = 'Revenue issued, ' + (PERIOD_LABEL[period] || period); chgs[1].className = 'mc-change up'; }
      if (mcs[2])  mcs[2].textContent  = _m(profit);
      if (chgs[2]) { chgs[2].textContent = profit >= 0 ? 'Net profit' : 'Net loss'; chgs[2].className = 'mc-change ' + (profit >= 0 ? 'up' : 'dn'); }
    } catch (err) {
      // Logged-out (401/403) or pre-auth: keep the static content, stay silent.
      // Only a genuinely authenticated failure shows the in-place error state.
      if (!window._ffAuthed || err.status === 401 || err.status === 403) return;
      _reportsSetState('error');
    }
  };

  // ══════════════════════════════════════════════════════
  // 4. BUDGET — handled by finflow-api-wiring-medium.js (loadBudgetFromDB)
  // which reads real /api/budget-targets and real /api/expenses. No hardcoded
  // targets here.
  // ══════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // 5. INVESTMENTS — load holdings from API into local array
  // ══════════════════════════════════════════════════════
  async function loadHoldingsFromDB() {
    try {
      const rows = await api('GET', '/api/holdings?scope=personal');   // personal = entity_id NULL only
      const mapped = (rows || []).map(r => ({
        _dbId: r.id, id: r.id, ticker: r.ticker, name: r.name,
        type: r.asset_type, shares: r.shares, cost: r.cost_per,
        price: r.price, div: r.dividend, color: r.color,
      }));
      window.holdings = mapped;
      // holdings is declared as `let` in index.html — splice to update in-place
      // so renderInvestments() picks up the API data
      if (typeof holdings !== 'undefined') {
        holdings.splice(0, holdings.length, ...mapped);
        // Fresh DB rows carry STORED (entry-time) prices, not live market prices. Clear the live flag so
        // renderInvestments shows its loading state rather than flashing the stale figure, then re-seed
        // from any live quote held in memory this session (warm cache → a reload/switch stays live).
        window._invLive = false;
        if (typeof window._reseedLive === 'function') window._reseedLive(holdings, 'personal');
        if (typeof renderInvestments === 'function') renderInvestments();
        if (typeof window._kickMarketRefresh === 'function') window._kickMarketRefresh();
      }
    } catch (err) { console.warn('[Holdings]', err.message); }
  }

  // ══════════════════════════════════════════════════════
  // 6. TEAM — load from payroll-based /api/team endpoint
  // ══════════════════════════════════════════════════════
  const _origRenderTeam = typeof window.renderTeam === 'function' ? window.renderTeam : null;
  window.renderTeam = async function () {
    if (_origRenderTeam) _origRenderTeam();   // show static TEAM array first
    try {
      const members = await api('GET', '/api/team');
      const tl = document.getElementById('team-list');
      if (!tl || !members.length) return;

      const roleLabels  = { owner: 'Owner', admin: 'Admin', accountant: 'Accountant', viewer: 'Viewer' };
      const roleClasses = { owner: 'role-owner', admin: 'role-admin', accountant: 'role-accountant', viewer: 'role-viewer' };
      const palette     = ['#c9a84c', '#5aaa9e', '#9e8fbf', '#7db87d', '#d4964a', '#5a4e3a', '#888'];

      tl.innerHTML = members.map((m, i) => {
        const initials  = m.name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
        const col       = palette[i % palette.length];
        const roleLabel = roleLabels[m.role] || m.role || 'Member';
        const roleCls   = roleClasses[m.role] || 'role-viewer';
        return `<div class="team-member-row">
          <div class="team-avatar" data-style="background:${col}22;color:${col};border:1px solid ${col}44">${e(initials)}</div>
          <div data-style="flex:1;min-width:0">
            <div data-style="font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(m.name)}</div>
            <div data-style="font-size:11px;color:var(--t3)">${e(m.email || '')}</div>
          </div>
          <div data-style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
            <span class="role-badge ${roleCls}">${e(roleLabel)}</span>
            <span data-style="font-size:10px;color:var(--t3)">${e(m.lastSeen || 'Active')}</span>
            ${m._tmId ? `<button class="btn btn-ghost btn-sm" data-style="font-size:10px;padding:2px 8px" data-arg-id="${m._tmId}" data-arg-access="${String(JSON.stringify(m.entity_access || null)).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-on-click="openMemberAccess(Number(this.dataset.argId), JSON.parse(this.dataset.argAccess))">Businesses</button>` : ''}
          </div>
        </div>`;
      }).join('');

      // D-C: edit seats used / included — viewers and accountants are free and never use one.
      try {
        const s = await api('GET', '/api/team/seats');
        let box = document.getElementById('team-seats');
        if (!box) { box = document.createElement('div'); box.id = 'team-seats'; box.style.cssText = 'font-size:12px;color:var(--t2);padding:6px 0 10px;border-bottom:1px solid var(--bd);margin-bottom:6px'; tl.parentNode.insertBefore(box, tl); }
        box.textContent = (s.limit == null ? s.used + ' edit seat' + (s.used === 1 ? '' : 's') + ' used (unlimited on your plan)' : s.used + ' of ' + s.limit + ' edit seats used')
          + ' · Viewers and accountants are free and unlimited.';
        window._teamSeats = s;
      } catch (_) {}

      const pendingCount = members.filter(m => m.status === 'pending').length;
      const _tc = document.getElementById('team-count');
      const _tp = document.getElementById('team-pending');
      if (_tc) _tc.textContent = members.length - pendingCount;   // Active users = total − pending
      if (_tp) _tp.textContent = pendingCount;                    // Pending invites (target by id — .mc-val[1] is the Roles tile)
    } catch (err) { console.warn('[Team]', err.message); }
  };

  // Edit which businesses an existing member can access → PUT /api/team/:id { entity_ids }.
  // `access` is the member's current grant (array) or null (= all businesses).
  window.openMemberAccess = async function (tmId, access) {
    let modal = document.getElementById('member-access-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'member-access-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `<div class="modal" data-style="max-width:360px">
        <div class="modal-header">
          <div class="modal-title">Business access</div>
          <button class="modal-close" data-on-click="document.getElementById('member-access-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div data-style="margin-top:8px"><label class="flabel">Businesses this member can access</label>
          <div id="ma-entities" data-style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius);padding:8px">
            <div data-style="font-size:12px;color:var(--t3)">Loading…</div>
          </div>
        </div>
        <div class="modal-footer" data-style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" data-on-click="document.getElementById('member-access-modal').classList.add('hidden')">Cancel</button>
          <button class="btn btn-primary btn-sm" data-on-click="saveMemberAccess()">Save access</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    modal.dataset.tmId = tmId;
    modal.classList.remove('hidden');
    if (typeof window._ffApplyCurrencyLabels === 'function') window._ffApplyCurrencyLabels();   // FA-M13
    try {
      const ents = await api('GET', '/api/entities');
      const granted = Array.isArray(access) ? access.map(Number) : null;   // null = all currently
      const box = document.getElementById('ma-entities');
      if (box) box.innerHTML = (ents && ents.length)
        ? ents.map(en => `<label data-style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);cursor:pointer"><input type="checkbox" class="ma-ent-cb" value="${en.id}" ${(!granted || granted.includes(en.id)) ? 'checked' : ''}> ${e(en.name || ('Business ' + en.id))}</label>`).join('')
        : '<div data-style="font-size:12px;color:var(--t3)">No businesses yet</div>';
    } catch (_) {}
  };

  window.saveMemberAccess = async function () {
    const modal = document.getElementById('member-access-modal');
    if (!modal) return;
    const tmId = modal.dataset.tmId;
    const entity_ids = Array.from(modal.querySelectorAll('.ma-ent-cb:checked')).map(cb => Number(cb.value));
    if (!entity_ids.length) { tip('Select at least one business', true); return; }
    try {
      await api('PUT', '/api/team/' + tmId, { entity_ids });
      modal.classList.add('hidden');
      tip('Business access updated');
      if (typeof window.renderTeam === 'function') window.renderTeam();
    } catch (err) { tip('Could not update access — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 7. PROJECTS — wire to /api/projects
  // ══════════════════════════════════════════════════════
  let _projects = [], _projectsFetched = false;

  async function loadProjects() {
    try {
      const rows = await api('GET', '/api/projects');
      _projects = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      _projectsFetched = true;
      window.projects = _projects;
      window.projectsData = _projects;
      renderProjectsList();
    } catch (err) { console.warn('[Projects]', err.message); }
  }
  window.renderProjectsList = function() { renderProjectsList(); };
  window.loadProjectsFromDB = loadProjects;

  function renderProjectsList() {
    const l = document.getElementById('projects-list');
    if (!l) return;
    // KPI cards: Active Projects · Billable Hours · Billable value · Budget remaining (LC1b: time is never invoiced)
    const _pjKpi = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    _pjKpi('proj-active', _projects.filter(p => p.status === 'In Progress').length);
    const _tsAll = window.timesheetData || window.timesheet || [];
    const _billFn = window._isBillable || (t => t.billable === true || t.billable === 1 || String(t.billable || '').toLowerCase() === 'yes');
    const _inM = typeof window._inThisMonth === 'function' ? window._inThisMonth : () => true;
    const _billHrs = _tsAll.filter(t => _billFn(t) && _inM(t.date)).reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);   // L5: "This month"
    _pjKpi('proj-hours', _billHrs.toFixed(1) + ' hrs');
    _pjKpi('proj-revenue', money(_projects.reduce((s, p) => s + (parseFloat(p.billed) || 0), 0)));
    _pjKpi('proj-unbilled', money(_projects.reduce((s, p) => s + Math.max(0, (parseFloat(p.budget) || 0) - (parseFloat(p.billed) || 0)), 0)));
    window._refreshDashboardUI?.();
    if (!_projects.length) {
      l.innerHTML = '<div data-style="padding:16px 0;color:var(--t3);font-size:13px">No projects yet. Click + New Project to add one.</div>';
      return;
    }
    const colorMap = { 'In Progress': 'b-blue', 'Completed': 'b-green', 'On Hold': 'b-amber' };
    l.innerHTML = _projects.map(p => {
      const billed = p.billed || 0;
      const budget = p.budget || 0;
      const pct    = budget > 0 ? Math.min(100, Math.round((billed / budget) * 100)) : 0;
      return `<div data-style="padding:10px 0;border-bottom:1px solid var(--bd)">
        <div data-style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div>
            <div data-style="font-size:13px;font-weight:500;color:var(--t1)">${e(p.name)}</div>
            <div data-style="font-size:11px;color:var(--t3)">${e(p.client || '—')} · ${e(p.hours || 0)}h logged</div>
          </div>
          <div data-style="display:flex;align-items:center;gap:10px">
            <div data-style="text-align:right">
              <div data-style="font-size:11px;color:var(--t3)">Billable value / Budget</div>
              <div data-style="font-size:12px;font-weight:600;font-family:var(--font-mono)">${window._fmtMoneyNative(billed)} / ${window._fmtMoneyNative(budget)}</div>
            </div>
            <span class="badge ${colorMap[p.status] || 'b-blue'}">${e(p.status)}</span>
            <button class="btn btn-ghost btn-sm" data-arg-id="${p.id}" data-on-click="deleteProject(Number(this.dataset.argId))" data-style="color:var(--red);padding:2px 6px" title="Delete">✕</button>
          </div>
        </div>
        <div class="bar-track" data-style="height:4px"><div class="bar-fill" data-style="width:${pct}%;background:${p.status === 'Completed' ? 'var(--green)' : 'var(--acc)'}"></div></div>
      </div>`;
    }).join('');
  }

  window.openNewProjectModal = function () {
    let modal = document.getElementById('proj-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'proj-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `<div class="modal">
        <div class="modal-header">
          <div class="modal-title">New Project</div>
          <button class="modal-close" data-on-click="document.getElementById('proj-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div data-style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <div><label class="flabel">Project Name *</label><input id="proj-name" class="finput" placeholder="e.g. RetailCo Portal v2"></div>
          <div><label class="flabel">Client</label><input id="proj-client" class="finput" placeholder="Client name"></div>
          <div><label class="flabel">Budget (<span data-cur="biz">USD</span>)</label><input id="proj-budget" class="finput" type="number" min="0" placeholder="0"></div>
          <div><label class="flabel">Status</label>
            <select id="proj-status" class="finput">
              <option value="In Progress">In Progress</option>
              <option value="On Hold">On Hold</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        </div>
        <div class="modal-footer" data-style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" data-on-click="document.getElementById('proj-modal').classList.add('hidden')">Cancel</button>
          <button class="btn btn-primary btn-sm" data-on-click="saveProject()">Save Project</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    ['proj-name', 'proj-client', 'proj-budget'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('proj-status').value = 'In Progress';
    modal.classList.remove('hidden');
    if (typeof window._ffApplyCurrencyLabels === 'function') window._ffApplyCurrencyLabels();   // FA-M13
  };

  window.saveProject = async function () {
    const name = (document.getElementById('proj-name')?.value || '').trim();
    if (!name) { tip('Project name is required', true); return; }
    const body = {
      name,
      client: (document.getElementById('proj-client')?.value || '').trim(),
      budget: parseFloat(document.getElementById('proj-budget')?.value) || 0,
      status: document.getElementById('proj-status')?.value || 'In Progress',
    };
    try {
      const row = await api('POST', '/api/projects', body);
      _projects.unshift(row);
      window.projects = _projects;
      renderProjectsList();
      document.getElementById('proj-modal').classList.add('hidden');
      tip(`Project "${e(row.name)}" created`);
      loadProjects().catch(()=>{});
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not save — ' + err.message, true); }
  };

  window.deleteProject = async function (id) {
    if (!(await window._confirmModal('Delete this project?', {danger:true}))) return;
    try {
      await api('DELETE', `/api/projects/${id}`);
      _projects = _projects.filter(p => p.id !== id);
      renderProjectsList();
      tip('Project deleted');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not delete — ' + err.message, true); }
  };

  const _origRenderProjects = typeof renderProjects === 'function' ? renderProjects : null;
  window.renderProjects = function () {
    if (_projectsFetched) { renderProjectsList(); return; }
    if (_origRenderProjects) _origRenderProjects();
    loadProjects();
  };

  // ══════════════════════════════════════════════════════
  // 8. REPORTS GENERATE — real summary modal
  // ══════════════════════════════════════════════════════
  // C15: export the report that is open. A report that set window._rptExportData exports its own figures; any other
  // report exports the label / value lines it shows. CSV via the shared writer, PDF via jsPDF (a real file, not the
  // print dialog).
  window._rptExport = function (fmt) {
    const title = (document.getElementById('rpt-title') || {}).textContent || 'Report';
    let data = window._rptExportData;
    if (!data) {
      const body = document.getElementById('rpt-body');
      const rows = [['Line', 'Value']];
      if (body) body.querySelectorAll('div').forEach(el => {
        const sp = Array.from(el.children).filter(c => c.tagName === 'SPAN');
        if (el.children.length === 2 && sp.length === 2) rows.push([sp[0].textContent.trim(), sp[1].textContent.trim()]);
      });
      data = { title, file: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report', sections: [{ title, rows }] };
    }
    const secs = data.sections.filter(sc => sc.rows && sc.rows.length > 1);
    if (!secs.length) { if (typeof notify === 'function') notify('Nothing to export in this report yet.', true); return; }
    if (fmt === 'pdf') return window._ffExportPdf(secs[0].rows, data.file + '.pdf', data.title, secs.slice(1));
    const rows = [];
    secs.forEach((sc, i) => { if (i) rows.push([]), rows.push([sc.title]); rows.push(...sc.rows); });
    return window._ffDownloadCsv(rows, data.file + '.csv');
  };

  window.generateReport = async function (name) {
    let modal = document.getElementById('report-gen-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'report-gen-modal';
      modal.className = 'modal-overlay hidden';
      // F137-g: the rich reports are taller than the viewport, so the shell is a flex column capped at
      // 88vh with a SCROLLING body — otherwise the modal overflows and clips the top KPIs / bottom Net
      // Profit (as it did on first ship). Header + footer stay pinned; #rpt-body scrolls (min-height:0
      // lets the flex child actually shrink and scroll).
      modal.innerHTML = `<div class="modal" data-style="max-width:480px;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" data-style="flex:0 0 auto">
          <div>
            <div class="modal-title" id="rpt-title"></div>
            <div class="modal-sub" id="rpt-sub"></div>
          </div>
          <button class="modal-close" data-on-click="document.getElementById('report-gen-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div id="rpt-body" data-style="margin-top:12px;font-size:13px;color:var(--t2);overflow-y:auto;flex:1 1 auto;min-height:0">Loading…</div>
        <div class="modal-footer" data-style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;flex:0 0 auto">
          <button class="btn btn-ghost btn-sm" data-on-click="document.getElementById('report-gen-modal').classList.add('hidden')">Close</button>
          <button class="btn btn-ghost btn-sm" id="rpt-csv-btn" data-on-click="window._rptExport('csv')">CSV</button>
          <button class="btn btn-ghost btn-sm" id="rpt-pdf-btn" data-on-click="window._rptExport('pdf')">PDF</button>
          <button class="btn btn-primary btn-sm" data-on-click="window.print()">Print ↗</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    // F137 print-optimization: the "Print" button calls window.print(), which otherwise prints the
    // whole dark app. This @media-print sheet (injected once) hides everything except the report and
    // REDEFINES the theme CSS variables to a light palette scoped to the modal — because the report is
    // built from var(--...)-driven inline styles, flipping the vars re-themes every element (tiles,
    // bars, text) to dark-on-white for paper without touching the on-screen (dark) rendering.
    // NOTE: on-paper appearance is owner-confirmed via print preview — jsdom cannot render @media print.
    // FA-P1: a constructed stylesheet (no <style> element under the strict Content-Security-Policy), added once, the
    // first time a report is generated — exactly when the <style> used to be.
    if (window.ffAdoptCss && !window.ffAdoptCss.has('rpt-print-css')) {
      window.ffAdoptCss('rpt-print-css', '@media print {'
        + ' body > *:not(#report-gen-modal){display:none !important;}'
        + ' #report-gen-modal{position:static !important;background:#fff !important;}'
        + ' #report-gen-modal .modal{--bg2:#f4f1ea;--bd:#d9d2c4;--t1:#1a1712;--t2:#3a352c;--t3:#6a6255;--green:#1f7a44;--red:#a23b2e;--acc:#9a7d2e;background:#fff !important;color:#111 !important;max-width:none !important;max-height:none !important;box-shadow:none !important;border:none !important;}'
        + ' #report-gen-modal #rpt-body{overflow:visible !important;max-height:none !important;}'
        + ' #report-gen-modal .modal-footer, #report-gen-modal .modal-close{display:none !important;}'
        + ' @page{margin:14mm;}'
        + '}');
    }
    window._rptExportData = null;   // C15: the renderer below sets it (a report's own figures, as plain numbers)
    document.getElementById('rpt-title').textContent = name;
    document.getElementById('rpt-sub').textContent = 'Generated ' + new Date().toLocaleDateString();
    document.getElementById('rpt-body').innerHTML = '<div data-style="color:var(--t3)">Loading data…</div>';
    modal.classList.remove('hidden');
    if (typeof window._ffApplyCurrencyLabels === 'function') window._ffApplyCurrencyLabels();   // FA-M13

    try {
      // ── F137 (per-report renderers). Shared cell helpers. `m` is the app's native money formatter,
      // so these reports read money exactly as every other surface does (F124). ─────────────────────
      const m = n => (typeof window._fmtMoneyNative === 'function')
        ? window._fmtMoneyNative(n)
        : (typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toFixed(2));
      const hdr = l => `<div data-style="font-size:11px;color:var(--acc, #c8a44a);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:9px 0 4px;border-bottom:1px solid var(--acc-bg, rgba(200,164,74,.18));margin-bottom:2px">${l}</div>`;
      const row = (label, val, opts = {}) => `<div data-style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd)${opts.bold ? ';font-weight:600' : ''}"><span data-style="color:var(--t2)">${e(label)}</span><span data-style="font-family:var(--font-mono)${opts.color ? `;color:${opts.color}` : ''}">${val}</span></div>`;
      const _rptBody = html => { document.getElementById('rpt-body').innerHTML = html; };
      // L12/L13: every report covers the dashboard's ACTIVE period (year ⇒ fiscal year) — the convention
      // P&L / Sales by Customer / Expense Report already followed. Payroll runs belong to the period they
      // are FOR (F85: payrollPeriodYmd), and only approved + paid runs are payroll expense (decision 2).
      const _rptPeriod = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
      const _RPT_PAYROLL_RECOGNISED = ['approved', 'paid'];
      const _rptRunsInPeriod = runs => {
        const w = (typeof window._periodWindow === 'function') ? window._periodWindow(_rptPeriod) : null;
        const FD = window.FinFlowDates;
        return (runs || []).filter(r => !w || !FD || w.inWin(FD.payrollPeriodYmd(r.period, r.run_date)));
      };
      // ── F137 rich shared helpers (used across the report renderers). ────────────────────────────
      const _gold = 'var(--acc, #c8a44a)';
      const tile = (label, val, sub, cls) => `<div data-style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:9px 10px"><div data-style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3)">${e(label)}</div><div data-style="font-size:17px;font-weight:600;margin-top:4px;color:${cls || 'var(--t1)'};font-family:var(--font-mono)">${val}</div>${sub ? `<div data-style="font-size:10px;color:var(--t3);margin-top:2px">${e(sub)}</div>` : ''}</div>`;
      const tiles = arr => `<div data-style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">${arr.join('')}</div>`;
      const pillHtml = t => `<span data-style="font-size:10px;font-weight:600;color:${_gold};background:rgba(200,164,74,.14);border-radius:5px;padding:2px 7px;margin-left:6px">${e(t)}</span>`;
      // A share-bar row: label + amount + a proportional bar (share of `denom`).
      const shareRow = (label, amt, denom, color) => `<div data-style="padding:6px 0"><div data-style="display:flex;justify-content:space-between;font-size:13px"><span data-style="color:var(--t2)">${e(label)}</span><span data-style="font-family:var(--font-mono);color:${color || 'var(--t1)'}">${m(amt)}</span></div><div data-style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i data-style="display:block;height:100%;background:${_gold};opacity:.75;width:${denom > 0 ? Math.max(2, Math.round(Math.abs(amt) / denom * 100)) : 0}%"></i></div></div>`;
      // Paired-series monthly SVG bar chart (rows: [{label, a, b}]). Inline SVG → prints cleanly.
      const barChart = (cap, series, aLabel, bLabel) => {
        const rws = series.slice(-6);
        if (!rws.length) return '';
        const maxV = Math.max(1, ...rws.map(r => Math.max(Math.abs(r.a || 0), Math.abs(r.b || 0))));
        const CW = 440, CH = 108, base = CH - 4, gw = CW / rws.length, bw = Math.min(15, gw / 3.2);
        let bars = '';
        rws.forEach((r, i) => {
          const cx = i * gw + gw / 2;
          const ah = Math.round((Math.abs(r.a || 0) / maxV) * (base - 6));
          const bh = Math.round((Math.abs(r.b || 0) / maxV) * (base - 6));
          bars += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${base - ah}" width="${bw.toFixed(1)}" height="${ah}" rx="1" fill="${_gold}"/>`;
          bars += `<rect x="${(cx + 1).toFixed(1)}" y="${base - bh}" width="${bw.toFixed(1)}" height="${bh}" rx="1" fill="var(--t3)"/>`;
        });
        const xl = rws.map(r => `<span data-style="flex:1;text-align:center">${e(r.label || '')}</span>`).join('');
        return `<div data-style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:11px 12px;margin-bottom:14px">
          <div data-style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:8px">${e(cap)}</div>
          <svg viewBox="0 0 ${CW} ${CH}" data-style="width:100%;height:104px;display:block" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${base}" x2="${CW}" y2="${base}" stroke="var(--bd,#2b2620)"/>${bars}</svg>
          <div data-style="display:flex;font-size:9px;color:var(--t3);margin-top:3px">${xl}</div>
          <div data-style="font-size:10px;color:var(--t3);text-align:right;margin-top:6px"><span data-style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${_gold};margin:0 4px 0 8px;vertical-align:middle"></span>${e(aLabel)}<span data-style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--t3);margin:0 4px 0 10px;vertical-align:middle"></span>${e(bLabel)}</div>
        </div>`;
      };

      // ── B7b (2026-10-23): Bank Reconciliation — every SAVED statement reconciliation for this business, newest first,
      // with the lines each one cleared. Always to the cent (a reconciliation ties to the cent, so whole-unit rounding
      // would hide the very difference it proves is zero). A line the bank changed after it was reconciled is flagged.
      if (name === 'Bank Reconciliation') {
        const d = await api('GET', '/api/bank-reconciliation/statements');
        const list = (d && d.reconciliations) || [];
        const sym = typeof window._nativeSymbol === 'function' ? window._nativeSymbol() : '$';
        const c2 = n => (n < 0 ? '-' : '') + sym + Math.abs(+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fd = ymd => (window.FinFlowDates ? window.FinFlowDates.fmtLabel(ymd, { year: true }) : ymd);
        const live = list.filter(r => r.status === 'complete');
        const latest = live[0] || null;
        _rptBody(
          tiles([
            tile('Reconciliations', String(live.length), list.length > live.length ? (list.length - live.length) + ' undone' : 'saved'),
            tile('Last statement', latest ? fd(latest.statement_date) : '—', latest ? c2(latest.statement_balance) + ' closing' : 'none yet'),
          ])
          + (list.length ? list.map(r => {
              const n = (r.lines || []).length;
              return hdr('Statement ' + e(fd(r.statement_date)) + (r.status === 'undone' ? ' — undone' : ''))
                + row('Statement closing balance', c2(r.statement_balance), { bold: true })
                + row('Cleared to date', c2(r.cleared_total))
                + row('Lines cleared', n + ' line' + (n === 1 ? '' : 's'))
                + row('Saved by', e(r.created_by || '—') + ' · ' + e(fd(String(r.created_at || '').slice(0, 10))))
                + (r.status === 'undone' ? row('Undone by', e(r.undone_by || '—') + ' · ' + e(fd(String(r.undone_at || '').slice(0, 10)))) : '')
                + (r.changed_since ? `<div data-style="font-size:12px;color:var(--amber);padding:4px 0">⚠ ${r.changed_since} line${r.changed_since === 1 ? '' : 's'} changed by the bank after this reconciliation — review before trusting it.</div>` : '')
                + (r.lines || []).map(l => `<div data-style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0 2px 10px;color:var(--t3)"><span>${e(l.missing ? '(line no longer in the feed)' : fd(l.date) + ' · ' + (l.description || ''))}</span><span data-style="font-family:var(--font-mono)">${l.missing ? '' : c2(l.amount)}</span></div>`).join('')
                + (latest && r.id === latest.id ? `<div data-style="text-align:right;margin:6px 0 10px"><button class="btn btn-ghost btn-sm" data-style="font-size:11px" data-arg-id="${r.id}" data-on-click="ffUndoReconciliation(Number(this.dataset.argId))">Undo this reconciliation</button></div>` : '');
            }).join('')
            : '<div data-style="padding:1rem;text-align:center;color:var(--t3);font-size:12px">No reconciliations saved yet. Bank Rec → Reconcile: enter your statement\'s closing balance, tick the lines on it, and finish at a 0.00 difference.</div>'));
        return;
      }

      // ── F137-a: the Balance Sheet report must render an ACTUAL balance sheet (assets /
      // liabilities / equity), NOT the generic P&L overview below. app-main.js:5647 had this but is
      // dead-shadowed by this winner. Delegates to the canonical /api/reports/balance-sheet (AR via
      // computeBooks; AP = Σ max(0, amount − amount_paid), which F135 made correct), and honors F123:
      // cash is NOT tracked, so it is shown as "Not tracked", never a fabricated $0, and Total Assets
      // is labelled as excluding it. Returns before the generic render so the P&L cards do not also show.
      if (name === 'Balance Sheet') {
        const bs = await api('POST', '/api/reports/balance-sheet', {});
        const cashCell = bs.cashTracked === false ? '<span data-style="color:var(--t3)">Not tracked</span>' : m(bs.cash);
        const ta = parseFloat(bs.totalAssets) || 0, tl = parseFloat(bs.totalLiabilities) || 0, eq = parseFloat(bs.equity) || 0;
        const denomBS = Math.max(1, ta, tl);
        // GL Phase 5b: the balance sheet may now be ledger-sourced (bs.source==='gl') with a REAL cash
        // balance and extra lines; labels/rows below are DATA-DRIVEN so the AR-only stub renders exactly
        // as before when served from computeBooks (bs.totalAssetsExcludesCash===true).
        const _inv = parseFloat(bs.inventory) || 0;
        const _taxP = parseFloat(bs.taxPayable) || 0;
        const _payL = parseFloat(bs.payrollLiabilities) || 0;
        const _taLabel = bs.totalAssetsExcludesCash ? 'Total Assets (excl. untracked cash)' : 'Total Assets';
        // GL consolidation: ASC 830 Cumulative Translation Adjustment (consolidated multi-currency only).
        const _cta = (typeof bs.cta === 'number') ? bs.cta : 0;
        // L6c: a ledger-sourced statement carries EVERY line (bs.lines — a partition of the accounts its totals are
        // summed from), so it renders those and foots by construction: Equipment, Credit Card, Owner's Equity, any
        // typed account. The AR-only stub (no bs.lines) renders exactly as before.
        const _L = (bs.lines && Array.isArray(bs.lines.assets)) ? bs.lines : null;
        const _lineRows = (arr, color) => (arr || []).map(l => row(l.label, m(l.amount), { color })).join('');
        _rptBody(
          tiles([
            tile('Total Assets', m(ta), bs.totalAssetsExcludesCash ? 'excl. untracked cash' : 'incl. cash', 'var(--green)'),
            tile('Total Liabilities', m(tl), _L ? 'all liabilities' : 'accounts payable', 'var(--red)'),
            tile('Equity', m(eq), 'assets − liabilities', eq >= 0 ? 'var(--green)' : 'var(--red)'),
            tile('Receivable', m(bs.accountsReceivable), 'outstanding AR'),
          ])
          + hdr('Assets vs Liabilities')
          + shareRow('Assets', ta, denomBS, 'var(--green)')
          + shareRow('Liabilities', tl, denomBS, 'var(--red)')
          + hdr('Assets')
          + (_L ? _lineRows(_L.assets, 'var(--green)')
               : row('Cash & Equivalents', cashCell)
                 + row('Accounts Receivable', m(bs.accountsReceivable), { color: 'var(--green)' })
                 + (_inv > 0 ? row('Inventory', m(_inv), { color: 'var(--green)' }) : ''))
          + row(_taLabel, m(ta), { bold: true })
          + hdr('Liabilities')
          + (_L ? _lineRows(_L.liabilities, 'var(--red)')
               : row('Accounts Payable', m(bs.accountsPayable), { color: 'var(--red)' })
                 + (_taxP > 0 ? row('Tax Payable', m(_taxP), { color: 'var(--red)' }) : '')
                 + (_payL > 0 ? row('Payroll Liabilities', m(_payL), { color: 'var(--red)' }) : ''))
          + row('Total Liabilities', m(tl), { color: 'var(--red)', bold: true })
          + (_L ? hdr('Equity') + _lineRows(_L.equity, 'var(--t2)') : '')
          + `<div data-style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Equity</span><span data-style="font-family:var(--font-mono);color:${eq >= 0 ? 'var(--green)' : 'var(--red)'}">${m(eq)}</span></div>`
          // ASC 830 CTA is SUPPLEMENTARY (the closing-rate translation view); it is not part of the Equity total above,
          // so it renders after that total — between the equity lines and their total it would break the footing.
          + (Math.abs(_cta) >= 0.01 ? row('Cumulative Translation Adjustment (ASC 830, supplementary)', m(_cta), { color: 'var(--t2)' }) : '')
          // F207: business investment holdings are tracked in the Investments module but are NOT posted to
          // the double-entry ledger, so they are intentionally excluded here (this statement ties to the GL).
          // Surface that explicitly so the two screens never *silently* disagree.
          + (() => {
              const _h = window.bizHoldings || [];
              const _mv = _h.reduce((s, x) => s + (parseFloat(x.shares) || 0) * (parseFloat(x.price) || parseFloat(x._lastPrice) || parseFloat(x.costPer) || parseFloat(x.cost) || 0), 0);
              return _mv > 0 ? `<div data-style="margin-top:12px;font-size:11px;color:var(--t3);line-height:1.5">Note: business investment holdings (market value ${m(_mv)}) are tracked in <strong>Investments</strong> and are not posted to the double-entry books, so they are excluded from this balance sheet. It reflects only booked activity.</div>` : '';
            })());
        return;
      }

      // ── F137-b: Cash Flow Statement — monthly inflow/outflow/net from the SHARED cash cache
      // (_cashMonthly, POST /api/reports/cash-flow), the same array the dashboard cash card reads,
      // so the two cannot drift (F57/D3). Pure delegation — no recompute. ──────────────────────────
      if (name === 'Cash Flow Statement') {
        if (typeof window._loadCashMonthly === 'function') await window._loadCashMonthly();
        // L12: the ACTIVE period's months only (year ⇒ the fiscal year) — the same _periodWindow the
        // Cash Flow page's cashForPeriod cards use. It listed every month ever, so it disagreed with them.
        const _cfW = (typeof window._periodWindow === 'function') ? window._periodWindow(_rptPeriod) : null;
        const rows = (window._cashMonthly || []).filter(r => !_cfW || _cfW.inWin(r.key + '-01'));
        const tin = rows.reduce((s, r) => s + (parseFloat(r.inflow) || 0), 0);
        const tout = rows.reduce((s, r) => s + (parseFloat(r.outflow) || 0), 0);
        const net = tin - tout;
        const detail = rows.map(r => {
          const rn = (parseFloat(r.inflow) || 0) - (parseFloat(r.outflow) || 0);
          return `<div data-style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd)"><span data-style="color:var(--t2)">${e(r.month || '')}</span><span data-style="color:var(--t3);font-family:var(--font-mono);font-size:11px">${m(r.inflow)} in / ${m(r.outflow)} out</span><span data-style="font-family:var(--font-mono);color:${rn >= 0 ? 'var(--green)' : 'var(--red)'}">${m(rn)}</span></div>`;
        }).join('');
        _rptBody(
          tiles([
            tile('Net Cash Flow', m(net), 'inflow − outflow', net >= 0 ? 'var(--green)' : 'var(--red)'),
            tile('Total Inflow', m(tin), 'received', 'var(--green)'),
            tile('Total Outflow', m(tout), 'paid out', 'var(--red)'),
            tile('Active Months', String(rows.length), 'with cash activity'),
          ])
          + barChart('Cash in vs out — monthly', rows.map(r => ({ label: r.month, a: parseFloat(r.inflow) || 0, b: parseFloat(r.outflow) || 0 })), 'Inflow', 'Outflow')
          + hdr('Monthly detail')
          + (detail || '<div data-style="padding:8px 0;color:var(--t3);font-size:12px">No cash movement recorded.</div>')
          + `<div data-style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Net Cash Flow</span><span data-style="font-family:var(--font-mono);color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${m(net)}</span></div>`);
        return;
      }

      // ── F137-c: Accounts Receivable — outstanding customer balances. The TOTAL is the canonical
      // _arOutstanding (F56, the same figure the dashboard/balance-sheet use). The per-customer rows
      // are a breakdown using the IDENTICAL per-invoice rule (RECOGNIZED, not future-dated,
      // Σ max(0, amount − amount_paid)), so Σ rows == total by construction (asserted in the harness),
      // not a second implementation of the total. ─────────────────────────────────────────────────
      if (name === 'Accounts Receivable') {
        // F204: prefer the SERVER-computed per-customer AR (GET /api/reports/ar-by-customer) so this
        // report no longer loads the full invoice list. Σ(rows)==total is guaranteed server-side
        // (built from the same recognized+D2 set + FX path as computeBooks.outstanding). If the
        // endpoint is unavailable, fall back to the identical client computation so it degrades safely.
        let ar, entries;
        try {
          const srv = await api('GET', '/api/reports/ar-by-customer');
          if (srv && Array.isArray(srv.rows)) {
            ar = { total: srv.total, count: srv.openCount, overdueTotal: srv.overdueTotal, overdueCount: srv.overdueCount };
            entries = srv.rows.map(r => [r.customer, r.amount]).filter(e => Math.abs(e[1]) >= 0.005).sort((a, b) => b[1] - a[1]);
          }
        } catch (_) { /* fall through to the client computation below */ }
        if (!ar) {
          const invs = (await api('GET', '/api/invoices')) || [];
          const _arCNs = (await api('GET', '/api/credit-notes')) || [];
          window.creditNotes = _arCNs;
          ar = (typeof window._arOutstanding === 'function') ? window._arOutstanding(invs) : { total: 0 };
          const REC = ['pending', 'overdue', 'partial', 'paid'];
          const today = window.FinFlowDates ? (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date())) : null;
          const byCust = {};
          invs.forEach(i => {
            const st = (i.status || '').toLowerCase(); if (!REC.includes(st)) return;
            const dy = window.FinFlowDates ? window.FinFlowDates._toYmd(i.issue_date || i.created_at || i.date) : null;
            if (today != null && (dy == null || dy > today)) return;
            const due = Math.max(0, (parseFloat(i.amount) || 0) - (parseFloat(i.amount_paid) || 0));
            if (due <= 0) return;
            const cst = i.client || '—'; byCust[cst] = (byCust[cst] || 0) + due;
          });
          _arCNs.forEach(cn => {
            const cst = (cn.status || '').toLowerCase(); if (cst !== 'open' && cst !== 'applied') return;
            const dy = window.FinFlowDates ? window.FinFlowDates._toYmd(cn.date || cn.created_at) : null;
            if (today != null && (dy == null || dy > today)) return;
            const amt = (parseFloat(cn.amount) || 0) - (parseFloat(cn.applied) || 0); if (amt <= 0.005) return;   // FA-M6b: what is left of it
            const c = cn.customer || '—';
            if (byCust[c] != null) byCust[c] -= amt; else byCust['Unattributed credits'] = (byCust['Unattributed credits'] || 0) - amt;
          });
          Object.keys(byCust).forEach(k => { if (Math.abs(byCust[k]) < 0.005) delete byCust[k]; });
          entries = Object.entries(byCust).sort((a, b) => b[1] - a[1]);
        }
        // L39: the total IS the balance-sheet AR line — a control account (customer subledger + posted journal AR legs,
        // D16). The journal leg has no customer, so it is its own explicit row: Σ rows == total == balance sheet.
        let _arBs = null; try { _arBs = await api('POST', '/api/reports/balance-sheet', {}); } catch (_) { _arBs = null; }
        const _arJe = (_arBs && _arBs.journalAdjustments) ? (parseFloat(_arBs.journalAdjustments.ar) || 0) : 0;
        if (Math.abs(_arJe) >= 0.005) entries.push(['Manual journal entries (no customer)', _arJe]);
        const _arTotal = (_arBs && _arBs.accountsReceivable != null) ? (parseFloat(_arBs.accountsReceivable) || 0) : ar.total;
        const rows = entries.map(([c, amt]) => shareRow(c, amt, _arTotal || 1, 'var(--red)')).join('');
        _rptBody(
          tiles([
            tile('Total Receivable', m(_arTotal), (ar.count || 0) + ' open', 'var(--green)'),
            tile('Overdue', m(ar.overdueTotal || 0), (ar.overdueCount || 0) + ' invoices', (ar.overdueTotal || 0) > 0 ? 'var(--red)' : 'var(--t2)'),
          ])
          + hdr('Outstanding by customer')
          + (rows || '<div data-style="padding:8px 0;color:var(--t3);font-size:12px">No outstanding receivables.</div>')
          + row('Total Receivable', m(_arTotal), { bold: true, color: 'var(--green)' }));
        return;
      }

      // ── F137-d: Accounts Payable — outstanding vendor balances. The TOTAL is the canonical
      // /api/reports/balance-sheet accountsPayable (Σ max(0, amount − amount_paid), F135). Per-vendor
      // rows use the IDENTICAL server AP rule (RECOGNIZED_BILL, not future-dated), so Σ rows == total. ─
      if (name === 'Accounts Payable') {
        const bs = await api('POST', '/api/reports/balance-sheet', {});
        const bills = (await api('GET', '/api/bills')) || [];
        const _apVCs = (await api('GET', '/api/vendor-credits')) || [];   // F58: net vendor credits per vendor
        const REC = ['unpaid', 'due_soon', 'overdue', 'partial', 'paid'];
        const today = window.FinFlowDates ? (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date())) : null;
        const byVendor = {};
        bills.forEach(b => {
          const st = (b.status || '').toLowerCase(); if (!REC.includes(st)) return;
          const dy = window.FinFlowDates ? window.FinFlowDates._toYmd(b.issue_date || b.created_at || b.due_date) : null;
          if (today != null && (dy == null || dy > today)) return;
          const due = Math.max(0, (parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0));
          if (due <= 0) return;
          const v = b.vendor || '—'; byVendor[v] = (byVendor[v] || 0) + due;
        });
        // F58 CLOSE (AP side): net open|applied vendor credits into each vendor's balance (payables
        // contra), D2-bounded, so Σ rows == the canonical net AP total. An unmatched vendor's credit
        // reduces an explicit 'Unattributed credits' bucket — the breakdown never drifts from the total.
        _apVCs.forEach(vc => {
          const st = (vc.status || '').toLowerCase(); if (st !== 'open' && st !== 'applied') return;
          const dy = window.FinFlowDates ? window.FinFlowDates._toYmd(vc.date || vc.created_at) : null;
          if (today != null && (dy == null || dy > today)) return;
          const amt = (parseFloat(vc.amount) || 0) - (parseFloat(vc.applied) || 0); if (amt <= 0.005) return;   // FA-M6b: what is left of it
          const v = vc.vendor || '—';
          if (byVendor[v] != null) byVendor[v] -= amt; else byVendor['Unattributed credits'] = (byVendor['Unattributed credits'] || 0) - amt;
        });
        Object.keys(byVendor).forEach(k => { if (Math.abs(byVendor[k]) < 0.005) delete byVendor[k]; });
        const apTotal = parseFloat(bs.accountsPayable) || 0;
        const vendorEntries = Object.entries(byVendor).sort((a, b) => b[1] - a[1]);
        const entries = vendorEntries.slice();
        // L39: balance-sheet AP is a control account (bills subledger + posted journal AP legs, D16); the journal leg has
        // no vendor, so it is its own explicit row — Σ rows == Total Payable again (it broke when L6b moved the total).
        const _apJe = (bs && bs.journalAdjustments) ? (parseFloat(bs.journalAdjustments.ap) || 0) : 0;
        if (Math.abs(_apJe) >= 0.005) entries.push(['Manual journal entries (no vendor)', _apJe]);
        const rows = entries.map(([v, amt]) => shareRow(v, amt, apTotal || 1, 'var(--red)')).join('');
        _rptBody(
          tiles([
            tile('Total Payable', m(apTotal), vendorEntries.length + ' vendor' + (vendorEntries.length === 1 ? '' : 's'), 'var(--red)'),
            tile('Largest', vendorEntries.length ? m(vendorEntries[0][1]) : m(0), vendorEntries.length ? String(vendorEntries[0][0]) : '—'),
          ])
          + hdr('Outstanding by vendor')
          + (rows || '<div data-style="padding:8px 0;color:var(--t3);font-size:12px">No outstanding payables.</div>')
          + row('Total Payable', m(apTotal), { bold: true, color: 'var(--red)' }));
        return;
      }

      // ── F137-e: Sales by Customer — recognized revenue grouped by client, over the active period.
      // Per-customer rows mirror computeRevenue's INVOICE leg EXACTLY (same _realInvoices, same
      // _periodWindow, same RECOGNIZED allowlist, issue-date basis — F32), so their sum equals the
      // invoice portion of the canonical computeRevenue by construction. The TOTAL is computeRevenue
      // itself; any gap (cash receipts +, credit notes −, neither customer-attributed) is shown as one
      // explicit "unattributed" row so Σ(rows) == Total, not a second revenue implementation. ────────
      if (name === 'Sales by Customer') {
        const period = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
        const PERIOD_LABEL = { month: 'this month', quarter: 'this quarter', year: 'this fiscal year to date' };
        const w = (typeof window._periodWindow === 'function') ? window._periodWindow(period) : null;
        // FA-M8: EVERY revenue leg that names a customer counts for that customer — invoices (+), cash sales receipts (+)
        // and credit notes (−), each on computeRevenue's own rule (same allowlists, same date field, same window) — and a
        // name matches case- and space-insensitively ("Acme" = "ACME "). Only what names no customer stays apart, named
        // for what it is. Before: invoices only, so a credit note and a named cash sale fell into one "unattributed" line.
        const REC = ['pending', 'overdue', 'partial', 'paid'];
        const REC_CREDIT = ['open', 'applied'];
        const _ck = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
        const byCust = {}, shown = {};
        let attributed = 0, noCustSales = 0;
        const _nameAmt = {};   // of the spellings of one customer, the one carrying the most revenue is shown
        const add = (name, amt) => {
          const k = _ck(name); if (!k) return false;
          const disp = String(name).trim().replace(/\s+/g, ' ');
          _nameAmt[k] = _nameAmt[k] || {}; _nameAmt[k][disp] = (_nameAmt[k][disp] || 0) + Math.abs(amt);
          shown[k] = Object.entries(_nameAmt[k]).sort((x, y) => y[1] - x[1])[0][0];
          byCust[k] = (byCust[k] || 0) + amt; attributed += amt; return true;
        };
        (window._realInvoices || []).forEach(i => {
          if (!REC.includes((i.status || '').toLowerCase())) return;
          if (w && !w.inWin(i.issue_date || i.created_at || i.date)) return;
          add(i.client, parseFloat(i.amount) || 0);
        });
        (window.receipts || []).forEach(r => {
          if (w && !w.inWin(r.date)) return;
          const amt = parseFloat(r.amount) || 0;
          if (!add(r.customer, amt)) noCustSales += amt;
        });
        (window.creditNotes || []).forEach(cn => {
          if (!REC_CREDIT.includes((cn.status || '').toLowerCase())) return;
          if (w && !w.inWin(cn.date || cn.created_at)) return;
          add(cn.customer, -(parseFloat(cn.amount) || 0));
        });
        const total = (typeof window.computeRevenue === 'function') ? window.computeRevenue(period) : attributed + noCustSales;
        const entries = Object.entries(byCust).filter(([, amt]) => Math.abs(amt) >= 0.005).sort((a, b) => b[1] - a[1]).map(([k, amt]) => [shown[k], amt]);
        const denomS = Math.max(1, total, attributed);
        const custRows = entries.map(([c, amt]) => shareRow(c, amt, denomS, 'var(--green)')).join('');
        const noCustRow = Math.abs(noCustSales) >= 0.01 ? row('Cash sales — no customer', m(noCustSales), { color: 'var(--t2)' }) : '';
        // What is left is revenue that has no customer by nature (posted manual journals' income) — shown so Σ rows == Total.
        const remainder = Math.round((total - attributed - noCustSales) * 100) / 100;
        const remRow = noCustRow + (Math.abs(remainder) >= 0.01 ? row('Manual journal entries (no customer)', m(remainder), { color: 'var(--t2)' }) : '');
        _rptBody(
          tiles([
            tile('Total Revenue', m(total), PERIOD_LABEL[period] || period, 'var(--green)'),
            tile('Top Customer', entries.length ? m(entries[0][1]) : m(0), entries.length ? String(entries[0][0]) : '—'),
          ])
          + hdr('Revenue by customer — ' + (PERIOD_LABEL[period] || period))
          + (custRows || '<div data-style="padding:8px 0;color:var(--t3);font-size:12px">No revenue from named customers in this period.</div>')
          + remRow
          + row('Total Revenue', m(total), { bold: true, color: 'var(--green)' }));
        return;
      }

      // ── F137-f: Payroll Summary — one row per payroll run (period · status · gross · net). Gross is
      // Σ of the run's LINE items (gross+bonus+overtime), the SINGLE SOURCE OF TRUTH per basis C /
      // Rule 12 — NOT the stored total_gross header (which can diverge; that divergence is F-space, not
      // reconciled silently here). Net is Σ line net_pay. ────────────────────────────────────────────
      if (name === 'Payroll Summary') {
        // L12: runs IN the active period (by the period each run is FOR — F85), and totals over the runs
        // the P&L recognises (approved + paid, decision 2). A draft or voided run is listed but is not
        // payroll expense, so it is not in the totals. It summed every run ever, drafts included.
        const runs = _rptRunsInPeriod((await api('GET', '/api/payroll-runs')) || []);
        const lineGross = l => (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0);
        const runData = runs.map(r => {
          const lines = Array.isArray(r.lines) ? r.lines.filter(Boolean) : [];
          return { period: r.period || '', status: (r.status || '').toLowerCase(),
            g: lines.reduce((s, l) => s + lineGross(l), 0), n: lines.reduce((s, l) => s + (parseFloat(l.net_pay) || 0), 0) };
        });
        const _recog = runData.filter(x => _RPT_PAYROLL_RECOGNISED.includes(x.status));
        const tGross = _recog.reduce((s, x) => s + x.g, 0);
        const tNet = _recog.reduce((s, x) => s + x.n, 0);
        const gDen = Math.max(1, ...runData.map(x => x.g));
        const runRows = runData.map(x => `<div data-style="padding:6px 0"><div data-style="display:flex;justify-content:space-between;font-size:13px"><span data-style="color:var(--t2)">${e(x.period)} <span data-style="color:var(--t3);font-size:11px">${e(x.status)}${_RPT_PAYROLL_RECOGNISED.includes(x.status) ? '' : ' · not in totals'}</span></span><span data-style="font-family:var(--font-mono)">net ${m(x.n)}</span></div><div data-style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i data-style="display:block;height:100%;background:${_gold};opacity:.75;width:${Math.max(2, Math.round(x.g / gDen * 100))}%"></i></div><div data-style="font-size:10px;color:var(--t3);margin-top:2px">gross ${m(x.g)}</div></div>`).join('');
        _rptBody(
          tiles([
            tile('Total Gross', m(tGross), 'approved + paid runs (Σ line items)', 'var(--red)'),
            tile('Total Net', m(tNet), 'take-home', 'var(--green)'),
            tile('Runs', String(runData.length), 'payroll runs'),
            tile('Deductions', m(Math.round((tGross - tNet) * 100) / 100), 'gross − net'),
          ])
          + hdr('Payroll runs (gross = Σ line items, basis C)')
          + (runRows || '<div data-style="padding:8px 0;color:var(--t3);font-size:12px">No payroll runs yet.</div>')
          + `<div data-style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Total Gross / Net</span><span data-style="font-family:var(--font-mono)">${m(tGross)} / ${m(tNet)}</span></div>`);
        return;
      }

      // ── F137-g: Profit & Loss Statement — a RICH statement: hero KPI tiles, a monthly
      // revenue-vs-expenses chart (inline SVG — prints/exports cleanly, unlike a canvas), then the
      // full statement with per-category expense share-bars and margin pills. Delegates to
      // /api/reports/profit-loss (canonical computeBooks totals + dated monthly rows) for the figures
      // and window.computeExpenseBreakdown for the manual-category split; every category + Payroll +
      // a "Bills & other" remainder reconcile to the canonical Total Operating Expenses. ────────────
      if (name === 'Profit & Loss Statement') {
        // N41: send the period INTENT the dashboard uses (period + monthIdx + fiscal-year start + entity),
        // so the totals cover the same period as the Operating-Expenses breakdown below.
        const _plq = (typeof window._cogsPeriodParams === 'function') ? '?' + window._cogsPeriodParams().toString() : '';
        const d = await api('POST', '/api/reports/profit-loss' + _plq, {});
        const prows = Array.isArray(d.rows) ? d.rows : [];
        const rev = parseFloat(d.totalRevenue) || 0, cogs = parseFloat(d.cogs) || 0, gp = parseFloat(d.grossProfit) || 0;
        const pay = parseFloat(d.payroll) || 0, exp = parseFloat(d.totalExpenses) || 0, net = parseFloat(d.netProfit) || 0;
        const period = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
        const pct = (n, dd) => dd > 0 ? (Math.round((n / dd) * 1000) / 10) + '%' : '—';
        const gold = 'var(--acc, #c8a44a)';

        // Hero KPI tiles. M45 (money audit 2026-10-09): "Expenses" is OPERATING expenses (totalExpenses — COGS is
        // already taken in Gross Profit); its caption said "incl. payroll + COGS" over a value that excludes COGS.
        const tile = (label, val, sub, cls) => `<div data-style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:9px 10px"><div data-style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3)">${e(label)}</div><div data-style="font-size:17px;font-weight:600;margin-top:4px;color:${cls || 'var(--t1)'};font-family:var(--font-mono)">${val}</div><div data-style="font-size:10px;color:var(--t3);margin-top:2px">${e(sub)}</div></div>`;
        const kpis = `<div data-style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          ${tile('Revenue', m(rev), 'issued', 'var(--green)')}
          ${tile('Gross Profit', m(gp), pct(gp, rev) + ' margin')}
          ${tile('Net Profit', m(net), pct(net, rev) + ' net margin', net >= 0 ? 'var(--green)' : 'var(--red)')}
          ${tile('Expenses', m(exp), 'operating, incl. payroll', 'var(--red)')}
        </div>`;

        // Monthly revenue-vs-expenses chart. C14: every month of the period (it kept only the last 6, so a year that
        // began in March showed May onward); capped at the latest 12 only for a period longer than a year.
        const rws = prows.slice(-12);
        let chart = '';
        if (rws.length) {
          const maxV = Math.max(1, ...rws.map(r => Math.max(parseFloat(r.revenue) || 0, parseFloat(r.expenses) || 0)));
          const CW = 440, CH = 108, base = CH - 4, groupW = CW / rws.length, bw = Math.min(15, groupW / 3.2);
          let bars = '';
          rws.forEach((r, i) => {
            const cx = i * groupW + groupW / 2;
            const rh = Math.round(((parseFloat(r.revenue) || 0) / maxV) * (base - 6));
            const eh = Math.round(((parseFloat(r.expenses) || 0) / maxV) * (base - 6));
            bars += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${base - rh}" width="${bw.toFixed(1)}" height="${rh}" rx="1" fill="${gold}"/>`;
            bars += `<rect x="${(cx + 1).toFixed(1)}" y="${base - eh}" width="${bw.toFixed(1)}" height="${eh}" rx="1" fill="var(--t3)"/>`;
          });
          const xl = rws.map(r => `<span data-style="flex:1;text-align:center">${e(r.month || '')}</span>`).join('');
          chart = `<div data-style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:11px 12px;margin-bottom:14px">
            <div data-style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:8px">Revenue vs Expenses — monthly</div>
            <svg viewBox="0 0 ${CW} ${CH}" data-style="width:100%;height:104px;display:block" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${base}" x2="${CW}" y2="${base}" stroke="var(--bd,#2b2620)"/>${bars}</svg>
            <div data-style="display:flex;font-size:9px;color:var(--t3);margin-top:3px">${xl}</div>
            <div data-style="font-size:10px;color:var(--t3);text-align:right;margin-top:6px"><span data-style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${gold};margin:0 4px 0 8px;vertical-align:middle"></span>Revenue<span data-style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--t3);margin:0 4px 0 10px;vertical-align:middle"></span>Expenses</div>
          </div>`;
        }

        // Operating-expense category share-bars: manual categories + Payroll + a reconciling
        // "Bills & other" remainder, so Σ == the canonical Total Operating Expenses (exp).
        // byCategory is MANUAL expense rows only; bd.total is the FULL opex (bills + payments +
        // payroll too), so the remainder must be exp − payroll − Σ(manual categories), NOT
        // exp − payroll − bd.total (which double-subtracts and drove a bogus negative "Bills & other").
        // L14: the ONE category list (D3 — direct categories + Payroll + Bills & vendors + Journal entries),
        // every category listed. It used to fold every non-direct leg into one "Bills & other" remainder, so
        // the statement's lines disagreed with the dashboard / Expenses page. If the client decomposition and
        // the server total ever differ, the gap stays VISIBLE as "Unreconciled difference" (never hidden).
        const _cats = () => { const b = (typeof window.computeExpenseBreakdown === 'function') ? window.computeExpenseBreakdown(period) : null;
          return (b && typeof window._expenseCategoryRows === 'function') ? window._expenseCategoryRows(b, { all: true }).map(([c, a]) => [c, a]) : [['Payroll', pay]]; };
        let catList = _cats();
        let _gap = Math.round((exp - catList.reduce((s, kv) => s + kv[1], 0)) * 100) / 100;
        // Batch 9: a statement opened while the page is still LOADING its data (just after sign-in) showed a false
        // "Unreconciled difference" — the server total was in, the page's own lists were not yet. Give the loaders up to
        // 3 s to land, recomputing; a gap that remains after that is real and is shown, never hidden.
        for (let _t = 0; Math.abs(_gap) >= 0.01 && _t < 12; _t++) {
          await new Promise(r => setTimeout(r, 250));
          catList = _cats();
          _gap = Math.round((exp - catList.reduce((s, kv) => s + kv[1], 0)) * 100) / 100;
        }
        if (Math.abs(_gap) >= 0.01) catList.push(['Unreconciled difference', _gap]);
        catList.sort((a, b) => b[1] - a[1]);
        const catBar = ([label, amt]) => `<div data-style="padding:6px 0"><div data-style="display:flex;justify-content:space-between;font-size:13px"><span data-style="color:var(--t2)">${e(label)}</span><span data-style="font-family:var(--font-mono);color:var(--red)">${m(amt)}</span></div><div data-style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i data-style="display:block;height:100%;background:${gold};opacity:.75;width:${exp > 0 ? Math.max(2, Math.round((amt / exp) * 100)) : 0}%"></i></div></div>`;
        const pill = t => `<span data-style="font-size:10px;font-weight:600;color:${gold};background:rgba(200,164,74,.14);border-radius:5px;padding:2px 7px;margin-left:6px">${e(t)}</span>`;

        // C14: the month-by-month table (every month of the period). Its total row is the statement's own totals; if
        // the months ever fail to add up to them the gap is shown, never hidden.
        let monthly = '';
        if (prows.length) {
          const n = v => parseFloat(v) || 0;
          const cell = (v, c) => `<td data-style="padding:4px 6px;text-align:right;font-family:var(--font-mono);${c ? 'color:' + c : ''}">${v}</td>`;
          const sum = k => Math.round(prows.reduce((t, r) => t + n(r[k]), 0) * 100) / 100;
          const off = [['revenue', rev], ['cogs', cogs], ['expenses', exp], ['netProfit', net]].filter(([k, t]) => Math.abs(sum(k) - t) >= 0.01);
          monthly = hdr('By month')
            + `<table id="pl-monthly" data-style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px"><thead><tr data-style="color:var(--t3);font-size:10px;text-transform:uppercase;letter-spacing:.06em">`
            + `<th data-style="text-align:left;padding:4px 6px">Month</th><th data-style="text-align:right;padding:4px 6px">Revenue</th><th data-style="text-align:right;padding:4px 6px">Cost of goods</th><th data-style="text-align:right;padding:4px 6px">Expenses</th><th data-style="text-align:right;padding:4px 6px">Net</th></tr></thead><tbody>`
            + prows.map(r => `<tr data-style="border-top:1px solid var(--bd)"><td data-style="padding:4px 6px;color:var(--t2)">${e(r.month || '')}</td>${cell(m(n(r.revenue)))}${cell(m(n(r.cogs)))}${cell(m(n(r.expenses)))}${cell(m(n(r.netProfit)), n(r.netProfit) >= 0 ? 'var(--green)' : 'var(--red)')}</tr>`).join('')
            + `<tr data-style="border-top:2px solid var(--bd);font-weight:700"><td data-style="padding:4px 6px">Total</td>${cell(m(rev))}${cell(m(cogs))}${cell(m(exp))}${cell(m(net), net >= 0 ? 'var(--green)' : 'var(--red)')}</tr>`
            + `</tbody></table>`
            + (off.length ? `<div data-style="font-size:11px;color:var(--red);margin:-6px 0 10px">The months do not add up to the totals (${off.map(([k]) => k).join(', ')}) — please report this.</div>` : '');
        }

        // C15: what CSV / PDF export — the statement and the monthly table, as plain numbers (2 dp) in the
        // business's currency. Same values the screen shows (rev, cogs, catList, exp, net, prows).
        {
          const n2 = v => (Math.round((parseFloat(v) || 0) * 100) / 100).toFixed(2);
          const _cur = ((window.ENTITIES || []).find(x => x && x.active) || {}).currency || '';
          const _per = prows.length ? (prows[0].month + (prows.length > 1 ? ' to ' + prows[prows.length - 1].month : '')) : ((d.period && d.period.start) || '');
          window._rptExportData = {
            title: 'Profit & Loss', file: 'profit-and-loss',
            sections: [
              { title: 'Statement', rows: [['Line', 'Amount' + (_cur ? ' (' + _cur + ')' : '')], ['Period', _per],
                ['Revenue', n2(rev)], ['Cost of goods sold', n2(cogs)], ['Gross profit', n2(gp)]]
                .concat(catList.map(([c, a]) => ['Operating expense: ' + c, n2(a)]))
                .concat([['Total operating expenses', n2(exp)], ['Net profit', n2(net)]]) },
              { title: 'By month', rows: [['Month', 'Revenue', 'Cost of goods', 'Expenses', 'Net']]
                .concat(prows.map(r => [r.month || '', n2(r.revenue), n2(r.cogs), n2(r.expenses), n2(r.netProfit)]))
                .concat(prows.length ? [['Total', n2(rev), n2(cogs), n2(exp), n2(net)]] : []) },
            ],
          };
        }

        _rptBody(
          kpis
          + chart
          + monthly
          + hdr('Revenue')
          + row('Total Revenue', m(rev), { bold: true, color: 'var(--green)' })
          + hdr('Cost of Sales')
          + row('Cost of Goods Sold (FIFO)', '− ' + m(cogs), { color: 'var(--red)' })
          + `<div data-style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd);font-weight:600"><span>Gross Profit ${pill(pct(gp, rev) + ' margin')}</span><span data-style="font-family:var(--font-mono)">${m(gp)}</span></div>`
          + hdr('Operating Expenses')
          + catList.map(catBar).join('')
          + row('Total Operating Expenses', m(exp), { bold: true, color: 'var(--red)' })
          + `<div data-style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:700"><span>Net Profit ${pill(pct(net, rev) + ' net margin')}</span><span data-style="font-family:var(--font-mono);color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${m(net)}</span></div>`
          + ((() => {
              // GL consolidation: when viewing the consolidated group, surface DETECTED intercompany trade
              // and the eliminated group P&L. Only renders when the server returns intercompany data
              // (consolidated view); single-entity reports are unaffected.
              const ic = d.intercompany, el = d.eliminated;
              const icRev = ic ? (parseFloat(ic.revenue) || 0) : 0, icExp = ic ? (parseFloat(ic.expense) || 0) : 0;
              if (!ic || (Math.abs(icRev) < 0.01 && Math.abs(icExp) < 0.01)) return '';
              return hdr('Intercompany (group consolidation)')
                + row('Intercompany revenue (detected)', '\u2212 ' + m(icRev), { color: 'var(--t2)' })
                + row('Intercompany expense (detected)', '\u2212 ' + m(icExp), { color: 'var(--t2)' })
                + (el ? `<div data-style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--bd);display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700"><span>Group Net Profit (eliminated) ${pill('intercompany removed')}</span><span data-style="font-family:var(--font-mono);color:${(parseFloat(el.netProfit)||0) >= 0 ? 'var(--green)' : 'var(--red)'}">${m(parseFloat(el.netProfit)||0)}</span></div>` : '')
                + `<div data-style="font-size:10px;color:var(--t3);margin-top:6px">Detected by matching a customer/vendor name to another of your entities. The figures above are the primary (transaction-precise) consolidation; eliminated is the group view net of internal trade.</div>`;
            })()));
        return;
      }

      // ── F137-j: Tax-Deductible Expenses — deductible business costs grouped by category. Real
      // data: expenses carry a `deductible` flag (server.js:1036); same basis as /api/tax-filing.
      // Σ(category rows) == Total Deductible by construction. ──────────────────────────────────────
      if (name === 'Tax-Deductible Expenses') {
        // L13: the active period's expenses (year ⇒ fiscal year), weighted by the SERVER's deductible rule
        // (computeBooks tax.deductible / the Income Tax Estimate: yes = 100%, half = 50%). It summed only
        // 'yes' rows, all time — so it disagreed with the Income Tax Estimate on the same page.
        const _tdW = (typeof window._periodWindow === 'function') ? window._periodWindow(_rptPeriod) : null;
        const exps = ((await api('GET', '/api/expenses')) || []).filter(x => !_tdW || _tdW.inWin(x.expense_date || x.date || x.created_at));
        const dedShare = x => window.FinFlowDates.deductibleFactor(x.deductible);   // M15: one shared vocabulary map
        const byCat = {}; let ded = 0, nonDed = 0, dedCount = 0;
        exps.forEach(x => {
          const amt = parseFloat(x.amount) || 0, sh = dedShare(x);
          if (sh > 0) { const c = x.category || 'Other'; byCat[c] = (byCat[c] || 0) + amt * sh; ded += amt * sh; dedCount++; }
          nonDed += amt * (1 - sh);
        });
        const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        const rows = entries.map(([c, a]) => shareRow(c, a, ded || 1, 'var(--green)')).join('');
        _rptBody(
          tiles([
            tile('Total Deductible', m(ded), dedCount + ' expense' + (dedCount === 1 ? '' : 's'), 'var(--green)'),
            tile('Not Deductible', m(nonDed), 'excluded from tax', 'var(--t2)'),
          ])
          + hdr('Deductible by category')
          + (rows || '<div data-style="padding:8px 0;color:var(--t3);font-size:12px">No deductible expenses recorded.</div>')
          + row('Total Deductible', m(ded), { bold: true, color: 'var(--green)' }));
        return;
      }

      // ── F137-k: Income Tax Estimate — consumes /api/tax-filing (taxable = revenue − deductibles;
      // estimatedTax = taxable × 25%; quarterly = /4). The 25% is a FLAT PLACEHOLDER (server.js:3720),
      // surfaced as an explicit "rough estimate, not tax advice" banner — never authoritative. ──────
      if (name === 'Income Tax Estimate') {
        // Multi-line estimate WORKSHEET (F137-k). Each line is a % of taxable income, a % of revenue,
        // or a fixed amount, summed. Cross-border obligations (foreign tax credits, worldwide income,
        // capital gains not tracked here) are entered as fixed lines. NOT a tax engine — a worksheet.
        // F139: send the client's fiscal-year start so /api/tax-filing windows revenue + deductible
        // over the SAME fiscal year as the dashboard/reports (computeBooks 'year'). _fyContext() is
        // the shared client resolver (app-main.js); absent → January (0), the server default.
        const _fyi = window._fyContext ? window._fyContext().fyStartIdx : 0;
        const [t, st] = await Promise.all([
          api('GET', '/api/tax-filing?fyStart=' + _fyi).catch(() => ({})),
          api('GET', '/api/settings').catch(() => ({})),
        ]);
        window._taxTaxable = parseFloat((t || {}).taxableIncome) || 0;
        window._taxRevenue = parseFloat((t || {}).revenue) || 0;
        let saved = Array.isArray(st && st.tax_lines) ? st.tax_lines : null;
        if (!saved || !saved.length) {
          const legacy = (st && st.tax_rate != null && st.tax_rate !== '') ? parseFloat(st.tax_rate) : 25;
          saved = [{ label: 'Income tax', type: 'taxable', value: isFinite(legacy) ? legacy : 25, note: '' }];
        }
        window._taxLines = saved.map(l => ({
          label: String((l && l.label) || ''),
          type: ['taxable', 'revenue', 'fixed'].includes(l && l.type) ? l.type : 'taxable',
          value: parseFloat(l && l.value) || 0,
          note: String((l && l.note) || ''),
        }));

        const lineAmt = l => { const v = parseFloat(l.value) || 0; return l.type === 'revenue' ? (window._taxRevenue || 0) * v / 100 : l.type === 'fixed' ? v : (window._taxTaxable || 0) * v / 100; };
        const r2 = n => Math.round(n * 100) / 100;
        const totalTax = () => r2(window._taxLines.reduce((s, l) => s + lineAmt(l), 0));
        const persistTax = () => {
          const total = totalTax(), tx = window._taxTaxable || 0;
          // C4: the effective rate the accountant portal reads. With no taxable income yet (0 or a loss) total/taxable is
          // undefined — it used to save 0, so the rate the owner typed was lost ("Client has not set a tax rate"). Then the
          // rate IS the sum of the %-of-taxable lines the owner entered.
          const eff = tx > 0 ? r2(total / tx * 100)
            : r2(window._taxLines.filter(l => l.type === 'taxable').reduce((a, l) => a + (parseFloat(l.value) || 0), 0));
          clearTimeout(window._taxSave);
          window._taxSave = setTimeout(() => { try { api('PUT', '/api/settings', { tax_lines: window._taxLines, tax_rate: eff }); } catch (_) { /* ignore */ } }, 500);
        };
        window._readTaxInputs = () => window._taxLines.forEach((l, i) => {
          const g = id => document.getElementById(id + i);
          if (g('tl-label-')) l.label = g('tl-label-').value;
          if (g('tl-val-')) l.value = parseFloat(g('tl-val-').value) || 0;
          if (g('tl-type-')) l.type = g('tl-type-').value;
          if (g('tl-note-')) l.note = g('tl-note-').value;
        });
        window.onTaxEdit = () => {
          window._readTaxInputs();
          window._taxLines.forEach((l, i) => { const a = document.getElementById('tl-amt-' + i); if (a) a.textContent = m(r2(lineAmt(l))); });
          const total = totalTax(), q = Math.round(total / 4);
          ['tl-total', 'tl-total2'].forEach(id => { const x = document.getElementById(id); if (x) x.textContent = m(total); });
          ['tl-quarter', 'tl-fq'].forEach(id => { const x = document.getElementById(id); if (x) x.textContent = m(q); });
          persistTax();
        };
        window.addTaxLine = () => { window._readTaxInputs(); window._taxLines.push({ label: '', type: 'taxable', value: 0, note: '' }); window._renderTaxWorksheet(); persistTax(); };
        window.removeTaxLine = (i) => { window._readTaxInputs(); window._taxLines.splice(i, 1); if (!window._taxLines.length) window._taxLines.push({ label: 'Income tax', type: 'taxable', value: 0, note: '' }); window._renderTaxWorksheet(); persistTax(); };
        window._renderTaxWorksheet = () => {
          const opt = (v, lbl, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${lbl}</option>`;
          const lineRows = window._taxLines.map((l, i) => `<div data-style="padding:8px 0;border-bottom:1px solid var(--bd)">
            <div data-style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
              <input id="tl-label-${i}" value="${e(l.label)}" data-on-input="onTaxEdit()" placeholder="Tax name" data-style="flex:1;min-width:0;background:var(--bg2,#1c1712);border:1px solid var(--bd,#2e2619);color:var(--t1);border-radius:6px;padding:5px 7px;font-size:12px">
              <input id="tl-val-${i}" type="number" step="0.1" min="0" value="${l.value}" data-on-input="onTaxEdit()" data-style="width:62px;text-align:right;font-family:var(--font-mono);background:var(--bg2,#1c1712);border:1px solid var(--bd,#2e2619);color:var(--t1);border-radius:6px;padding:5px 6px;font-size:12px">
              <select id="tl-type-${i}" data-on-change="onTaxEdit()" data-style="background:var(--bg2,#1c1712);border:1px solid var(--bd,#2e2619);color:var(--t1);border-radius:6px;padding:5px 4px;font-size:11px">${opt('taxable', '% taxable', l.type)}${opt('revenue', '% revenue', l.type)}${opt('fixed', 'fixed $', l.type)}</select>
              <button data-arg-i="${i}" data-on-click="removeTaxLine(Number(this.dataset.argI))" title="Remove" data-style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 3px">✕</button>
            </div>
            <div data-style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <input id="tl-note-${i}" value="${e(l.note)}" data-on-input="onTaxEdit()" placeholder="note (optional)" data-style="flex:1;min-width:0;background:none;border:none;color:var(--t3);font-size:11px;padding:0">
              <span data-style="font-family:var(--font-mono);color:var(--red);font-size:12px">= <span id="tl-amt-${i}">${m(r2(lineAmt(l)))}</span></span>
            </div></div>`).join('');
          const total = totalTax(), q = Math.round(total / 4);
          _rptBody(
            `<div data-style="background:rgba(200,164,74,.12);border:1px solid var(--acc-bg, rgba(200,164,74,.3));border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:11px;color:var(--t2)">Add a line per tax you owe — each a % of taxable income, % of revenue, or a fixed amount. <strong>Rough estimate — not tax advice.</strong> Cross-border obligations (foreign tax credits, worldwide income, capital gains) aren't computed here — enter them as fixed amounts and consult a professional. Your lines also feed your accountant's Tax Summary.</div>`
            + tiles([
              tile('Estimated Tax', `<span id="tl-total">${m(total)}</span>`, 'sum of all lines', 'var(--red)'),
              tile('Per Quarter', `<span id="tl-quarter">${m(q)}</span>`, 'set aside each Q', 'var(--red)'),
              tile('Taxable Income', m(window._taxTaxable || 0), 'revenue − costs (non-deductible expenses added back)'),
              tile('Revenue', m(window._taxRevenue || 0), 'gross income'),
            ])
            + hdr('Tax lines')
            + lineRows
            + `<button data-on-click="addTaxLine()" data-style="margin-top:8px;background:none;border:1px dashed var(--acc,#c8a44a);color:var(--acc,#c8a44a);border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;width:100%">+ Add tax line</button>`
            + `<div data-style="margin-top:12px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:700"><span>Total Estimated Tax <span data-style="color:var(--t3);font-size:11px;font-weight:500">(<span id="tl-fq">${m(q)}</span>/quarter)</span></span><span data-style="font-family:var(--font-mono);color:var(--red)" id="tl-total2">${m(total)}</span></div>`);
        };
        window._renderTaxWorksheet();
        return;
      }

      // ── F137-l: VAT Return — FinFlow tracks NO VAT/GST (server.js:4009/4142). Honest "not tracked"
      // state (F123 class), never a fabricated return. ────────────────────────────────────────────
      if (name === 'VAT Return') {
        _rptBody(
          `<div data-style="text-align:center;padding:28px 16px;color:var(--t2)">
            <div data-style="font-size:30px;margin-bottom:10px">🧾</div>
            <div data-style="font-size:15px;font-weight:600;color:var(--t1);margin-bottom:6px">VAT / GST is not tracked</div>
            <div data-style="font-size:12px;color:var(--t3);line-height:1.5;max-width:340px;margin:0 auto">FinFlow doesn’t record VAT or sales tax on invoices or bills, so a VAT return can’t be produced from your data. If you’re VAT/GST-registered and need this, VAT tracking can be added as a feature.</div>
          </div>`);
        return;
      }

      // ── F137-m / LA10: Payroll by person — each person's pay from real payroll runs (gross = Σ line items,
      // basis C). Was "1099 / W-2 Summary" (US form names; owner decision 2026-10-14). The old name still opens it,
      // so a saved or scheduled reference does not break. ─────────────────────────────────────────────────
      if (name === 'Payroll by person' || name === '1099 / W-2 Summary') {
        // L12: wages from the runs the P&L recognises (approved + paid — a draft or voided run is not
        // payroll), in the active period (year ⇒ fiscal year). It summed every run ever, drafts included.
        // (Whether W-2 should count only runs marked PAID is an owner tax-policy question — Owner Handoff.)
        const runs = _rptRunsInPeriod((await api('GET', '/api/payroll-runs')) || []).filter(r => _RPT_PAYROLL_RECOGNISED.includes(String(r.status || '').toLowerCase()));
        const lg = l => (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0);
        const byEmp = {}; let tG = 0, tN = 0;
        runs.forEach(r => (Array.isArray(r.lines) ? r.lines : []).filter(Boolean).forEach(l => {
          const nm = l.employee_name || '—'; const g = lg(l), n = parseFloat(l.net_pay) || 0;
          if (!byEmp[nm]) byEmp[nm] = { g: 0, n: 0 };
          byEmp[nm].g += g; byEmp[nm].n += n; tG += g; tN += n;
        }));
        const emps = Object.entries(byEmp).sort((a, b) => b[1].g - a[1].g);
        const gDen = Math.max(1, ...emps.map(([, v]) => v.g));
        const rows = emps.map(([nm, v]) => `<div data-style="padding:6px 0"><div data-style="display:flex;justify-content:space-between;font-size:13px"><span data-style="color:var(--t2)">${e(nm)}</span><span data-style="font-family:var(--font-mono)">gross ${m(v.g)} · net ${m(v.n)}</span></div><div data-style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i data-style="display:block;height:100%;background:${_gold};opacity:.75;width:${Math.max(2, Math.round(v.g / gDen * 100))}%"></i></div></div>`).join('');
        _rptBody(
          tiles([
            tile('People', String(emps.length), 'on payroll runs'),
            tile('Total Wages', m(tG), 'approved + paid runs, gross Σ line items', 'var(--red)'),
            tile('Total Withheld', m(Math.round((tG - tN) * 100) / 100), 'deductions'),
            tile('Total Net', m(tN), 'take-home', 'var(--green)'),
          ])
          + `<div data-style="background:rgba(200,164,74,.12);border:1px solid var(--acc-bg, rgba(200,164,74,.3));border-radius:8px;padding:8px 11px;margin-bottom:10px;font-size:11px;color:var(--t2)">Pay per person from approved and paid payroll runs. <strong>Payments to contractors outside payroll are not included</strong> — they are expenses or bills.</div>`
          + hdr('Pay by person')
          + (rows || '<div data-style="padding:8px 0;color:var(--t3);font-size:12px">No payroll runs recorded.</div>')
          + `<div data-style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Total Wages / Net</span><span data-style="font-family:var(--font-mono)">${m(tG)} / ${m(tN)}</span></div>`);
        return;
      }
      // ── F128: DELEGATE to the canonical client engines. Do NOT recompute. ────────────────────
      //
      // What was here: `invoices.filter(i => i.status === 'paid')` summed at full amount, plus
      // `Σ expenses` alone, both unwindowed. Three defects in four lines:
      //   · PAID-ONLY revenue is the PRE-F32 basis. F32 (owner decision, 18 July) moved
      //     recognition to ACCRUAL, ISSUE-BASED — allowlist pending/overdue/partial/paid — across
      //     computeBooks, computeRevenue, /api/reports, /books, the monthly buckets and the
      //     accountant portal. This function was missed, so the Reports page reported a revenue
      //     figure no other surface in the product agreed with. Same survival F76 records for
      //     GET /api/tax-filing — except that endpoint is unconsumed and this button is not.
      //   · EXPENSES omitted issued bills, orphan payments made and payroll entirely, so "Net
      //     Profit" was revenue-minus-some-expenses.
      //   · NO PERIOD. Both legs were all-time regardless of the period selector.
      // Credit notes and vendor credits (F58) were absent from both legs as well.
      //
      // The fix is delegation, not better arithmetic. Rule 2: this figure already has four
      // implementations (computeBooks, /api/reports, the client pair, and this) — writing a fifth
      // correct one just moves the next divergence. computeRevenue / computeExpenseBreakdown are
      // the canonical CLIENT pair the dashboard KPIs read, they carry every leg including the F58
      // contras, and step 4 gates them against VERIFICATION across four timezones. Sourcing from
      // them makes Reports agree with the dashboard BY CONSTRUCTION rather than by coincidence
      // (Rule 6) — a future basis change lands on both at once, which is the whole point.
      //
      // PERIOD — stated, not assumed. This report follows the app's ACTIVE period selector, the
      // same window every other money surface uses, and the modal now LABELS it. Previously it was
      // silently all-time; changing that without saying so on screen would move a number the user
      // had no way to explain. `currentPeriod` is a top-level `let` in app-main.js, so it lives in
      // the shared global LEXICAL scope, not on `window` (see F125) — hence the bare read with a
      // typeof guard, the pattern already used for it in the dashboard wiring.
      const period = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
      const PERIOD_LABEL = { month: 'this month', quarter: 'this quarter', year: 'this fiscal year to date' };
      if (typeof window.computeRevenue !== 'function' || typeof window.computeExpenseBreakdown !== 'function') {
        // Honest failure, never a fabricated total (class C6/C7): if the engines are not loaded
        // there is no figure to report, and a zero here would read as a business with no revenue.
        throw new Error('Report engine not ready — reload the page and try again.');
      }
      // F124 rule: these figures come out of the client engines NATIVE — nothing converts them —
      // so they carry the ENTITY's symbol. The shared `money()` helper in this file routes through
      // S(), which stamps activeCurrency, and would label an unconverted figure with the display
      // currency under a non-native selection. Scoped to this function; the other `money()` call
      // sites in this file are F129's sweep, not this commit's.
      const money = n => (typeof window._fmtMoneyNative === 'function')
        ? window._fmtMoneyNative(n)
        : (typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toFixed(2));
      const revenue  = window.computeRevenue(period);
      const breakdown = window.computeExpenseBreakdown(period);
      const expTotal = breakdown.total;
      // COGS is the THIRD leg of the canonical net, and leaving it out was the remaining way this
      // report could disagree with the dashboard. `updateDashboard` composes d-profit as
      // `revenue − COGS − opex` (app-main.js:2167), and the AI/insight surfaces use the identical
      // line at :4502 and :4539. Reproduced here rather than approximated: on the seed, omitting it
      // gives −300 where every other surface says −1,700 — the exact 1,400 of FY COGS.
      // `window._cogsTotal` is the client's PERIOD-SCOPED COGS, refetched by _loadPeriodCOGS on
      // every period switch (F25); a non-inventory business leaves it 0 and net == revenue − opex.
      const cogs     = parseFloat(window._cogsTotal) || 0;
      const profit   = revenue - cogs - expTotal;
      // Outstanding stays as it was: already canonical via _arOutstanding (F56), and AR is an
      // all-time balance-sheet figure by design — it deliberately does NOT take the period window.
      const invoices = await api('GET', '/api/invoices');
      const outstanding = (typeof window._arOutstanding === 'function')
        ? window._arOutstanding(invoices).total
        : invoices.filter(i => i.status?.toLowerCase() !== 'paid').reduce((s, i) => s + (i.amount || 0), 0);
      // Category rows come from the same breakdown, so they are period-scoped and consistent with
      // the total above them. NOTE they cover the manual-expense rows only — byCategory is built
      // from those (app-main.js) — so they do not sum to expTotal, which also carries bills,
      // payments made and payroll. Labelled in the heading rather than left to be discovered.
      // FA-M9: the total broken down three ways — by source, by category, by vendor — each map comes from
      // computeExpenseBreakdown itself and adds up to the Expenses figure above (it used to list expense categories only).
      const _tbl = (title, m) => {
        const rows = Object.entries(m || {}).sort((a, b) => b[1] - a[1])
          .map(([k, amt]) => `<tr><td data-style="padding:3px 0;color:var(--t2)">${e(k)}</td><td data-style="text-align:right;font-family:var(--font-mono);color:var(--t1)">${money(amt)}</td></tr>`).join('');
        return rows ? `<div data-style="font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px">${e(title)}</div>
        <table data-style="width:100%;border-collapse:collapse">${rows}<tr data-style="border-top:1px solid var(--bd)"><td data-style="padding:3px 0;font-weight:600">Total</td><td data-style="text-align:right;font-family:var(--font-mono);font-weight:600">${money(expTotal)}</td></tr></table>` : '';
      };
      const _byCat = (typeof window._expenseCategoryRows === 'function') ? Object.fromEntries(window._expenseCategoryRows(breakdown, { all: true })) : {};   // D3: the one category decomposition
      const catRows = _tbl('By source', breakdown.bySource) + _tbl('By category', _byCat) + _tbl('By vendor', breakdown.byVendor);

      document.getElementById('rpt-body').innerHTML = `
        <div data-style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div data-style="background:var(--bg2);border-radius:6px;padding:10px">
            <div data-style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Revenue</div>
            <div data-style="font-size:16px;font-weight:600;color:var(--green)">${money(revenue)}</div>
            <div data-style="font-size:10px;color:var(--t3)">issued, ${e(PERIOD_LABEL[period] || period)}</div>
          </div>
          <div data-style="background:var(--bg2);border-radius:6px;padding:10px">
            <div data-style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Expenses</div>
            <div data-style="font-size:16px;font-weight:600;color:var(--red)">${money(expTotal)}</div>
            <div data-style="font-size:10px;color:var(--t3)">incl. bills &amp; payroll</div>
          </div>
          <div data-style="background:var(--bg2);border-radius:6px;padding:10px">
            <div data-style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Net Profit</div>
            <div data-style="font-size:16px;font-weight:600;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${money(profit)}</div>
          </div>
          <div data-style="background:var(--bg2);border-radius:6px;padding:10px">
            <div data-style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Outstanding</div>
            <div data-style="font-size:16px;font-weight:600;color:var(--amber)">${money(outstanding)}</div>
            <div data-style="font-size:10px;color:var(--t3)">all time</div>
          </div>
        </div>
        ${catRows}`;
    } catch (err) {
      document.getElementById('rpt-body').textContent = 'Could not load data: ' + err.message;
    }
  };


  // ══════════════════════════════════════════════════════
  // 9. BUDGET TARGETS — handled by finflow-api-wiring-medium.js
  // (window.openBudgetTargetsModal + window._saveBudgetTargets there).
  // ══════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // 10. ADD HOLDING — override saveHolding to POST /api/holdings
  // ══════════════════════════════════════════════════════
  window.saveHolding = async function () {
    const ticker = (document.getElementById('h-ticker')?.value || '').trim().toUpperCase();
    const name   = (document.getElementById('h-name')?.value || '').trim() || ticker;
    const shares = parseFloat(document.getElementById('h-shares')?.value) || 0;
    const cost   = parseFloat(document.getElementById('h-cost')?.value) || 0;
    const price  = parseFloat(document.getElementById('h-price')?.value) || cost;
    const div    = parseFloat(document.getElementById('h-div')?.value) || 0;
    const type   = document.getElementById('h-type')?.value || 'Stock';
    if (!ticker || !shares) { tip('Ticker and shares are required', true); return; }
    // Entry-time symbol validation (prevents the "no live data" trap at the source): resolve the typed
    // ticker/name to a real exchange symbol — company/coin NAMES and wrong tickers get corrected HERE,
    // not silently stored. Crypto routes to CoinGecko, everything else to Finnhub. If nothing resolves
    // (a private/OTC/unlisted holding), we still allow it — but the user confirms, and it saves with
    // whatever they typed so the live view can flag it. Cash is never a market symbol.
    let storeTicker = ticker;
    if (type !== 'Cash' && typeof window._ffResolveSymbol === 'function') {
      let resolved = null;
      try { resolved = await window._ffResolveSymbol(ticker, type); } catch (_) {}
      if (resolved && resolved !== 'CASH') {
        storeTicker = resolved;                    // "MICROSOFT" → "MSFT", "Bitcoin" → "BTC"
        if (resolved !== ticker) tip('Saved as ' + resolved);
      } else {
        const msg = 'No live market symbol found for “' + ticker + '”. Save it anyway? It will use your entered price with no live quotes. For live prices use an exchange ticker (e.g. MSFT, BTC).';
        const ok = (typeof window._confirmModal === 'function') ? await window._confirmModal(msg) : true;
        if (!ok) return;
      }
    }
    // Scope the write to the page the modal was opened from (personal vs business entity).
    const scope = window._holdingScope === 'business' ? 'business' : 'personal';
    try {
      await api('POST', '/api/holdings', {
        ticker: storeTicker, name, asset_type: type, shares, cost_per: cost, price, dividend: div, scope,
      });
      if (typeof closeModal === 'function') closeModal('holding-modal');
      tip(`${e(ticker)} added to portfolio`);
      // Repaint the CORRECT list (+ dashboard d-invest) — no manual reload.
      if (typeof window._refreshHoldings === 'function') window._refreshHoldings(scope);
      else await loadHoldingsFromDB();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not save holding — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 11. TEAM INVITE — modal + POST /api/team
  // ══════════════════════════════════════════════════════
  window.openInviteModal = async function () {
    // Member invites re-enabled with per-entity access (was F54 "coming soon"). The invitee is granted
    // only the businesses checked below; the server binds role + account + entity grant to the invite row.
    let modal = document.getElementById('invite-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'invite-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `<div class="modal" data-style="max-width:360px">
        <div class="modal-header">
          <div class="modal-title">Invite Team Member</div>
          <button class="modal-close" data-on-click="document.getElementById('invite-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div data-style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <div><label class="flabel">Name *</label><input id="inv-name" class="finput" placeholder="Full name"></div>
          <div><label class="flabel">Email *</label><input id="inv-email" class="finput" type="email" placeholder="email@company.com"></div>
          <div><label class="flabel">Role</label>
            <select id="inv-role" class="finput">
              <option value="admin">Admin</option>
              <option value="accountant">Accountant</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div><label class="flabel">Businesses this member can access</label>
            <div id="inv-entities" data-style="display:flex;flex-direction:column;gap:6px;max-height:150px;overflow:auto;border:1px solid var(--bd);border-radius:var(--radius);padding:8px">
              <div data-style="font-size:12px;color:var(--t3)">Loading…</div>
            </div>
          </div>
        </div>
        <div class="modal-footer" data-style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" data-on-click="document.getElementById('invite-modal').classList.add('hidden')">Cancel</button>
          <button class="btn btn-primary btn-sm" data-on-click="sendInvite()">Send Invite</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    ['inv-name', 'inv-email'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const roleEl = document.getElementById('inv-role');
    if (roleEl) roleEl.value = 'accountant';
    // D-C: when every edit seat is in use, Admin is unavailable here — and says why — instead of failing on Send.
    try {
      const s = await api('GET', '/api/team/seats');
      const opt = roleEl && roleEl.querySelector('option[value="admin"]');
      if (opt) {
        const full = s.limit != null && s.used >= s.limit;
        opt.disabled = full;
        opt.textContent = full ? 'Admin — no edit seats left (' + s.used + ' of ' + s.limit + ')' : 'Admin';
      }
    } catch (_) {}
    modal.classList.remove('hidden');
    if (typeof window._ffApplyCurrencyLabels === 'function') window._ffApplyCurrencyLabels();   // FA-M13
    // Populate the per-entity checkboxes from the account's businesses (all checked = full access).
    try {
      const ents = await api('GET', '/api/entities');
      const box = document.getElementById('inv-entities');
      if (box) box.innerHTML = (ents && ents.length)
        ? ents.map(en => `<label data-style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);cursor:pointer"><input type="checkbox" class="inv-ent-cb" value="${en.id}" checked> ${e(en.name || ('Business ' + en.id))}</label>`).join('')
        : '<div data-style="font-size:12px;color:var(--t3)">No businesses yet</div>';
    } catch (_) {}
  };

  window.sendInvite = async function () {
    const name  = (document.getElementById('inv-name')?.value || '').trim();
    const email = (document.getElementById('inv-email')?.value || '').trim();
    const role  = document.getElementById('inv-role')?.value || 'viewer';
    const entity_ids = Array.from(document.querySelectorAll('#inv-entities .inv-ent-cb:checked')).map(cb => Number(cb.value));
    if (!name || !email) { tip('Name and email are required', true); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { tip('Invalid email address', true); return; }
    if (!entity_ids.length) { tip('Select at least one business this member can access', true); return; }
    try {
      // Real RBAC invite (Step A): creates a pending membership + emails a secure,
      // single-use accept link. Role/account/entity-grant are bound to the invite row server-side.
      const _inv = await api('POST', '/api/team/invite', { name, email, role, entity_ids });
      document.getElementById('invite-modal').classList.add('hidden');
      if (_inv && _inv.emailStatus === 'sent') tip(`Invitation emailed to ${e(email)}`);
      else tip(`Invite created for ${e(email)}, but the email wasn't sent (email service not configured yet). The accept link is in the server log.`, true);
      if (typeof window.renderTeam === 'function') window.renderTeam();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not invite — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 11b. PLAN & BILLING (D-G / D-B) — Settings → Plan & billing, from GET /api/billing
  // ══════════════════════════════════════════════════════
  const _bDate = isoStr => { try { return new Date(isoStr).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return String(isoStr || '').slice(0, 10); } };
  window.ffRenderBilling = async function () {
    const el = document.getElementById('billing-panel');
    if (!el) return;
    try {
      const b = await api('GET', '/api/billing');
      window._billing = b;
      let h;
      if (b.paid) {
        const per = b.interval === 'year' ? 'year' : 'month';
        h = `<div data-style="font-size:15px;color:var(--t1);font-weight:500">${e(b.planName)} · billed ${b.interval === 'year' ? 'yearly' : 'monthly'} · $${Number(b.price).toLocaleString('en-US')} a ${per}</div>`
          + (b.periodEnd
              ? (b.cancelAtPeriodEnd
                  ? `<div data-style="color:var(--amber)">Cancels on ${e(_bDate(b.periodEnd))} — you keep full access until then.</div>`
                  : `<div>Renews on ${e(_bDate(b.periodEnd))}.</div>`)
              : '');
      } else if (b.readOnly) {
        h = `<div data-style="font-size:15px;color:var(--t1);font-weight:500">No active plan — your books are read-only</div><div>You can view and export everything. Choose a plan to make changes again.</div>`
          // D-G step 4: when a PAID plan ended, the books are kept 90 days, then deleted — say when, and how to keep them.
          + (b.deleteOn ? `<div data-style="margin-top:6px;color:var(--amber)">Your plan ended on ${e(_bDate(b.accessEndedAt))}. Your books will be deleted on <strong>${e(_bDate(b.deleteOn))}</strong> unless you choose a plan before then — we e-mail you 14 days before. Export a copy any time: Settings → Your data → Download my data.</div>` : '');
      } else {
        h = `<div data-style="font-size:15px;color:var(--t1);font-weight:500">${e(b.planName)}</div>` + (b.trialEnds ? `<div>Ends on ${e(_bDate(b.trialEnds))}. No card needed until you choose a plan.</div>` : '');
      }
      h += `<div data-style="margin-top:.75rem;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-on-click="showPage('pricing')">${b.paid ? 'Change plan' : 'Choose a plan'}</button>`
        + (b.paid && !b.cancelAtPeriodEnd ? `<button class="btn btn-ghost btn-sm" data-style="color:var(--red)" data-on-click="ffCancelPlan()">Cancel plan</button>` : '')
        + (b.paid && b.cancelAtPeriodEnd ? `<button class="btn btn-primary btn-sm" data-on-click="ffResumePlan()">Keep my plan</button>` : '')
        + `</div><div id="billing-cancel-box"></div>`;
      el.innerHTML = h;
    } catch (err) { el.textContent = 'Could not load your plan — ' + err.message; }
  };
  const _money2 = v => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // D-G / D-B: what cancelling does — shown BEFORE confirming (the server recomputes it on confirm).
  window.ffCancelPlan = async function () {
    const box = document.getElementById('billing-cancel-box');
    if (!box) return;
    try {
      const p = await api('GET', '/api/billing/cancel-preview');
      const keep = 'After that your books stay available, read-only, for 90 days — you can view and export everything — and we email you 14 days before anything is deleted.';
      const what = p.mode === 'period_end'
        ? `Your plan ends on <strong>${e(_bDate(p.accessUntil))}</strong>. You keep full access until then, and you can change your mind until that day. No refund is due for the month you are in. ${keep}`
        : `You paid <strong>${_money2(p.paid)}</strong> for this year. ${p.monthsUsed} month${p.monthsUsed === 1 ? '' : 's'} used × ${_money2(p.monthlyPrice)} (the monthly price) = ${_money2(p.used)}. `
          + (p.refund > 0 ? `We refund <strong>${_money2(p.refund)}</strong> to the card you paid with. ` : 'No refund is due. ')
          + `Access ends today. ${keep}`;
      box.innerHTML = `<div data-style="margin-top:.75rem;padding:12px 14px;border:1px solid var(--red-bd);border-radius:var(--radius);background:var(--red-bg)">
          <div data-style="color:var(--t1);margin-bottom:8px">${what}</div>
          <div data-style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm" id="billing-cancel-confirm" data-style="background:var(--red);color:#fff" data-on-click="ffConfirmCancel()">Cancel my plan</button>
          <button class="btn btn-ghost btn-sm" data-on-click="document.getElementById('billing-cancel-box').innerHTML=''">Keep my plan</button></div></div>`;
    } catch (err) { box.textContent = 'Could not prepare the cancellation — ' + err.message; }
  };
  window.ffConfirmCancel = async function () {
    const btn = document.getElementById('billing-cancel-confirm');
    if (btn) btn.disabled = true;
    try {
      const r = await api('POST', '/api/billing/cancel', { confirm: true });
      tip(r.mode === 'period_end' ? 'Your plan will end on ' + _bDate(r.accessUntil) + '.' : (r.refund > 0 ? 'Your plan has ended. ' + _money2(r.refund) + ' is on its way back to your card.' : 'Your plan has ended.'));
      await window.ffRenderBilling();
    } catch (err) { tip('Could not cancel — ' + err.message, true); if (btn) btn.disabled = false; }
  };
  window.ffResumePlan = async function () {
    try { await api('POST', '/api/billing/resume', {}); tip('Your plan will continue.'); await window.ffRenderBilling(); }
    catch (err) { tip('Could not keep the plan — ' + err.message, true); }
  };
  // ══════════════════════════════════════════════════════
  // 11c. SAAS METRICS (D-D) — MRR page → Growth & retention, from GET /api/saas-metrics (a COMPLETED month)
  // ══════════════════════════════════════════════════════
  const _ymLabel = m => { try { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (_) { return m; } };
  const _ymPrev = (m, k) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) - k; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); };
  window.ffRenderSaas = async function (month) {
    const body = document.getElementById('saas-body'), sel = document.getElementById('saas-month'), title = document.getElementById('saas-title');
    if (!body) return;
    const today = (window._entityToday ? window._entityToday() : new Date().toISOString().slice(0, 10)).slice(0, 7);
    const m = month || _ymPrev(today, 1);   // the last COMPLETED month
    if (sel && !sel.options.length) for (let i = 1; i <= 12; i++) { const v = _ymPrev(today, i); const o = document.createElement('option'); o.value = v; o.textContent = _ymLabel(v); sel.appendChild(o); }
    if (sel) sel.value = m;
    let d;
    try { d = await api('GET', '/api/saas-metrics?month=' + encodeURIComponent(m)); }
    catch (err) { body.innerHTML = `<div data-style="color:var(--t3)">${e(err.message)}</div>`; return; }
    window._saas = d;
    const x = d.metrics || {}, cur = d.currency || 'USD';
    const sym = (window.CURRENCIES && window.CURRENCIES[cur] && window.CURRENCIES[cur].symbol) || (cur === 'USD' ? '$' : cur + ' ');
    const money = v => sym + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const whole = v => sym + Math.round(Number(v || 0)).toLocaleString('en-US');
    const pc = v => (v == null ? '—' : Number(v).toFixed(2) + '%');
    const nm = k => (d.names && d.names[k]) || String(k).replace(/^(ff|stripe):/, '');
    if (title) title.textContent = 'Growth & retention — ' + _ymLabel(m);
    const flagFor = re => (x.flags || []).find(f => re.test(f));
    const tile = (id, label, val, key, hint) => `<button type="button" class="mrr-metric" id="${id}" data-working="${key || ''}" data-style="text-align:left;cursor:${key ? 'pointer' : 'default'};border:1px solid var(--bd);background:none;border-radius:var(--radius);padding:10px" title="${e(hint || 'Show how this is worked out')}">
        <div class="mrr-val" data-style="font-size:18px">${val}</div><div class="mrr-label">${e(label)}</div></button>`;
    const ltvTxt = x.ltv != null ? money(x.ltv) : `<span data-style="font-size:12px;color:var(--t3)">${e(flagFor(/Lifetime value/) || 'Not available')}</span>`;
    const cacTxt = x.cac != null ? money(x.cac) : `<span data-style="font-size:12px;color:var(--t3)">${e(flagFor(/new customers/) || 'Not available')}</span>`;
    const mvRow = (label, amt, keys, color) => `<div data-style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--bd)"><span><span data-style="color:var(--t1)">${e(label)}</span> <span data-style="color:var(--t3)">${(keys || []).map(k => e(nm(k))).join(', ') || '—'}</span></span><span data-style="font-family:var(--font-mono);color:${color}">${money(amt)}</span></div>`;
    const cohorts = (d.cohorts || []).slice(-12);
    const maxOff = cohorts.reduce((mx, g) => Math.max(mx, g.months.length), 0);
    const cohortHtml = cohorts.length ? `<div data-style="overflow-x:auto"><table data-style="border-collapse:collapse;font-size:11.5px;min-width:420px"><thead><tr><th data-style="text-align:left;padding:4px 6px;color:var(--t3)">Started</th><th data-style="padding:4px 6px;color:var(--t3)">Customers</th>${Array.from({ length: maxOff }, (_, i) => `<th data-style="padding:4px 6px;color:var(--t3)">M${i}</th>`).join('')}</tr></thead><tbody>`
      + cohorts.map(g => `<tr><td data-style="padding:4px 6px;color:var(--t1)">${e(_ymLabel(g.start).replace(/ (\d{4})$/, ' $1'))}</td><td data-style="padding:4px 6px;text-align:center">${g.size}</td>${g.months.map(r => `<td data-style="padding:4px 6px;text-align:center;background:rgba(201,168,76,${(r.customerPct || 0) / 400})" title="Revenue retained: ${r.mrrPct == null ? '—' : r.mrrPct + '%'}">${r.customerPct}%</td>`).join('')}</tr>`).join('')
      + `</tbody></table><div data-style="font-size:11px;color:var(--t3);margin-top:4px">Share of each starting group of customers still paying; hover a cell for the share of their revenue kept.</div></div>` : '<div data-style="color:var(--t3)">No subscription history yet.</div>';
    const st = d.settings || {};
    body.innerHTML =
      `<div data-style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px">`
      + tile('saas-nrr', 'Net revenue retention', pc(x.nrr), 'nrr') + tile('saas-grr', 'Gross revenue retention', pc(x.grr), 'grr')
      + tile('saas-customer-churn', 'Customer churn', pc(x.customerChurnRate), 'customerChurnRate') + tile('saas-revenue-churn', 'Revenue churn', pc(x.revenueChurnRate), 'revenueChurnRate')
      + tile('saas-arpa', 'Revenue per customer (ARPA)', x.arpa != null ? money(x.arpa) : '—', 'arpa') + tile('saas-cac', 'Cost to win a customer (CAC)', cacTxt, x.cac != null ? 'cac' : '')
      + tile('saas-payback', 'Months to earn back CAC', x.paybackMonths != null ? Number(x.paybackMonths).toFixed(1) + ' months' : '—', x.paybackMonths != null ? 'paybackMonths' : '')
      + tile('saas-ltv', 'Lifetime value (LTV)', ltvTxt, x.ltv != null ? 'ltv' : '')
      + `</div><div id="saas-working" data-style="display:none;margin-bottom:12px;padding:10px 12px;border:1px solid var(--acc);border-radius:var(--radius);font-size:12px"></div>`
      + `<div data-style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">`
      +   `<div id="saas-movement"><div data-style="font-weight:600;color:var(--t1);margin-bottom:4px">What changed in ${e(_ymLabel(m))}</div>`
      +     mvRow('New', x.newMrr, x.newCustomers, 'var(--green)') + mvRow('Came back', x.reactivation, [], 'var(--green)') + mvRow('Expanded', x.expansion, x.expandedCustomers, 'var(--acc)')
      +     mvRow('Reduced', -(x.contraction || 0), x.contractedCustomers, 'var(--amber)') + mvRow('Left', -(x.churnedMrr || 0), x.churnedCustomers, 'var(--red)') + `</div>`
      +   `<div id="saas-cohorts"><div data-style="font-weight:600;color:var(--t1);margin-bottom:4px">Retention by starting month</div>${cohortHtml}</div>`
      + `</div>`
      + `<div data-style="margin-top:14px;padding-top:10px;border-top:1px solid var(--bd);display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">`
      +   `<div data-style="flex:1 1 260px"><label class="flabel" for="saas-cats">Expense categories that count as winning customers</label><input class="finput" id="saas-cats" value="${e((st.acquisitionCategories || []).join(', '))}"></div>`
      +   `<div data-style="width:150px"><label class="flabel" for="saas-payroll-pct">Share of payroll (%)</label><input class="finput" id="saas-payroll-pct" type="number" min="0" max="100" value="${Number(st.salesPayrollPct || 0)}"></div>`
      +   `<button class="btn btn-ghost btn-sm" data-on-click="ffSaveSaasSettings()">Save</button></div>`
      + `<div data-style="font-size:11px;color:var(--t3);margin-top:6px">Sources: ${d.sources && d.sources.finflowLines || 0} recurring invoices in FinFlow${d.sources && d.sources.stripeConnected ? ', ' + (d.sources.stripeLines || 0) + ' Stripe subscription invoices' : ''}${d.sources && d.sources.otherCurrencySkipped ? ' · ' + d.sources.otherCurrencySkipped + ' Stripe invoices in another currency not included' : ''}${d.sources && d.sources.stripeError ? ' · Stripe could not be read: ' + e(d.sources.stripeError) : ''}. Gross margin from your books: ${d.grossMargin == null ? '—' : (d.grossMargin * 100).toFixed(1) + '%'}.</div>`;
    body.querySelectorAll('[data-working]').forEach(b => { const k = b.getAttribute('data-working'); if (!k) return; b.onclick = () => {
      const wv = (x.working || {})[k], box = document.getElementById('saas-working');
      if (!wv || !box) return;
      const inp = Object.entries(wv.inputs || {}).filter(([kk, v]) => typeof v !== 'object' || Array.isArray(v)).map(([kk, v]) => `<div><span data-style="color:var(--t3)">${e(kk)}</span>: ${e(Array.isArray(v) ? v.join(', ') : v)}</div>`).join('');
      box.innerHTML = `<div data-style="color:var(--t1);font-weight:600;margin-bottom:4px">${e(b.querySelector('.mrr-label').textContent)}</div><div data-style="margin-bottom:6px">${e(wv.formula)}</div>${inp}`;
      box.style.display = 'block'; }; });
    // the breakdown tiles + the churn card, for the same completed month (ONE writer — the engine)
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('mrr-new', whole((x.newMrr || 0) + (x.reactivation || 0)));
    set('mrr-churned', whole(x.churnedMrr || 0));
    set('mrr-expansion', whole(x.expansion || 0));
    set('mrr-net', whole((x.newMrr || 0) + (x.reactivation || 0) + (x.expansion || 0) - (x.contraction || 0) - (x.churnedMrr || 0)));
    set('mrr-churn', pc(x.customerChurnRate));
    set('mrr-churn-note', 'Customers lost in ' + _ymLabel(m));
  };
  window.ffSaveSaasSettings = async function () {
    const cats = String((document.getElementById('saas-cats') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean);
    const pctP = Number((document.getElementById('saas-payroll-pct') || {}).value || 0);
    try { await api('PUT', '/api/saas-metrics/settings', { acquisitionCategories: cats, salesPayrollPct: pctP }); tip('Saved'); await window.ffRenderSaas((document.getElementById('saas-month') || {}).value); }
    catch (err) { tip('Could not save — ' + err.message, true); }
  };
  // ══════════════════════════════════════════════════════
  // 11d. SINGLE SIGN-ON (D-H) — Settings → Single sign-on, for the Enterprise owner
  // ══════════════════════════════════════════════════════
  window.ffRenderSso = async function () {
    const el = document.getElementById('sso-panel');
    if (!el) return;
    let c;
    try { c = await api('GET', '/api/sso/config'); } catch (err) { el.textContent = err.message; return; }
    const ent = window.FinFlowPlans && window.FinFlowPlans.has(typeof currentUserPlan !== 'undefined' ? currentUserPlan : '', 'sso');
    if (!ent) { el.innerHTML = `<div>Sign in through your company's identity provider (Google Workspace, Microsoft Entra ID, Okta and other OpenID Connect providers). Single sign-on is part of the Enterprise plan — <a href="#" data-on-click="showPage('pricing');return false" data-style="color:var(--acc)">talk to us</a>.</div>`; return; }
    el.innerHTML = `<div data-style="margin-bottom:8px">${c.enabled ? '<strong data-style="color:var(--green)">On</strong> for ' + e((c.domains || []).join(', ')) : 'Off'} — your team signs in through your identity provider (OpenID Connect: Google Workspace, Microsoft Entra ID, Okta, Auth0…). SAML is not supported.</div>
      <div data-style="font-size:11.5px;color:var(--t3);margin-bottom:8px">In your provider, register this redirect URL: <code id="sso-redirect">${e(c.redirectUri || '')}</code></div>
      <div class="field-wrap"><label class="field-label" for="sso-issuer">Issuer URL</label><input class="finput" id="sso-issuer" placeholder="https://login.example.com" value="${e(c.issuer || '')}"></div>
      <div class="field-group"><div class="field-wrap"><label class="field-label" for="sso-client">Client ID</label><input class="finput" id="sso-client" value="${e(c.client_id || '')}"></div>
        <div class="field-wrap"><label class="field-label" for="sso-secret">Client secret</label><input class="finput" id="sso-secret" type="password" placeholder="${c.hasSecret ? 'Saved — leave blank to keep' : ''}"></div></div>
      <div class="field-wrap"><label class="field-label" for="sso-domains">E-mail domains (comma-separated)</label><input class="finput" id="sso-domains" placeholder="yourcompany.com" value="${e((c.domains || []).join(', '))}"></div>
      <label data-style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" id="sso-enforce" ${c.enforce ? 'checked' : ''}> Require single sign-on for these domains (you, the owner, can always use your password)</label>
      <label data-style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" id="sso-jit" ${c.jitViewer ? 'checked' : ''}> New people from these domains can join as Viewers</label>
      <div data-style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary btn-sm" data-on-click="ffSaveSso()">Save</button>${c.enabled ? '<button class="btn btn-ghost btn-sm" data-on-click="ffSaveSso(false)">Turn off</button>' : ''}</div>`;
  };
  window.ffSaveSso = async function (on) {
    const v = id => (document.getElementById(id) || {}).value || '';
    const body = on === false ? { enabled: false } : { issuer: v('sso-issuer').trim(), client_id: v('sso-client').trim(), client_secret: v('sso-secret'), domains: v('sso-domains'),
      enforce: !!(document.getElementById('sso-enforce') || {}).checked, jitViewer: !!(document.getElementById('sso-jit') || {}).checked };
    try { await api('PUT', '/api/sso/config', body); tip(on === false ? 'Single sign-on turned off' : 'Single sign-on saved ✦'); await window.ffRenderSso(); }
    catch (err) { tip('Could not save — ' + err.message, true); }
  };
  { const _spSso = window.showPage;
    if (typeof _spSso === 'function') window.showPage = function (id) { const r = _spSso.apply(this, arguments); if (id === 'settings') window.ffRenderSso(); return r; }; }
  { const _spSaas = window.showPage;
    if (typeof _spSaas === 'function') window.showPage = function (id) { const r = _spSaas.apply(this, arguments); if (id === 'mrr') window.ffRenderSaas(); return r; }; }
  { const _spBilling = window.showPage;
    if (typeof _spBilling === 'function') window.showPage = function (id) { const r = _spBilling.apply(this, arguments); if (id === 'settings') window.ffRenderBilling(); return r; }; }

  // ══════════════════════════════════════════════════════
  // 12. PERSONAL FINANCE — owned by app-main.js
  // ══════════════════════════════════════════════════════
  // REMOVED the stale window.loadPersonalFinance override. It populated the
  // legacy window.persTransactions / window.spending arrays, but app-main's
  // rebuilt render path reads window._allPersTxs → _applyPersFilter → module
  // persTransactions/spending. Because this file is concatenated after app-main
  // and loaded deferred, its override WON at runtime and _allPersTxs was never
  // populated — so the transaction list, Monthly Spending and the donut stayed
  // empty even though rows loaded. app-main.js now owns loadPersonalFinance
  // (it GETs /api/personal-transactions into window._allPersTxs and renders);
  // the showPage('personal') hook below calls it so nav-based loads still work.

  // ══════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    loadTimesheet();
    loadHoldingsFromDB();
    loadProjects();
    // Personal finance loads via app-main's loadPersonalFinance() on the
    // showPage('personal') hook below (no boot preload needed here).

    // Expose so entity-switch and external callers can reload
    window._loadTimesheetFromDB  = loadTimesheet;
    window._loadHoldingsFromDB   = loadHoldingsFromDB;
    window._loadProjectsFromDB   = loadProjects;

    // Re-load when navigating to these pages via showPage
    const _orig = window.showPage;
    if (typeof _orig === 'function') {
      window.showPage = function (id, navEl) {
        _orig(id, navEl);
        if (id === 'timesheet') {
          if (!_tsFetched) loadTimesheet();
          else { renderTimesheetList(); updateTimesheetMetrics(); }
        }
        if (id === 'investments') loadHoldingsFromDB();
        if (id === 'biz-investments' && typeof window._loadBizHoldingsFromDB === 'function') window._loadBizHoldingsFromDB();
        if (id === 'personal') window.loadPersonalFinance().catch(() => {});
        if (id === 'projects') {
          if (!_projectsFetched) loadProjects();
          else renderProjectsList();
        }
        if (id === 'settings') {
          const _se = document.getElementById('settings-user-email');
          if (_se && window.CURRENT_USER?.email) _se.textContent = window.CURRENT_USER.email;
          const _sn = document.getElementById('s-user-name');
          if (_sn && !_sn.value && window.CURRENT_USER?.name) _sn.value = window.CURRENT_USER.name;
        }
      };
    }
  })()

  console.log('[FinFlow Extra Wiring] ✅ Invoice View, Timesheet, Reports, Budget, Investments, Team, Projects, Generate Report, Budget Targets, Add Holding, Invite Member');
})();


;
/* ── finflow-api-wiring-dashboard.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — DASHBOARD WIRING
// Replaces all hardcoded chart/KPI data with real API data.
// Wires:
//   ✅ Dashboard KPIs (revenue, expenses, profit, outstanding)
//   ✅ Overview bar chart (real monthly revenue vs expenses)
//   ✅ Expense breakdown bars (by category from real data)
//   ✅ Business transactions list (from real invoices/expenses)
//   ✅ Invoice stats (paid count, outstanding amount)
//   ✅ Cash flow section (real numbers)
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  async function api(method, path) {
    const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `API ${res.status}`); }
    return res.json();
  }

  function money(n) { return typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toLocaleString(); }

  // ── Parse a date string (ISO or "Apr 30" style) into a Date ──────
  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s);
    if (!isNaN(d)) return d;
    // Try "Mon DD" or "Mon D" format (no year — assume current/last year)
    const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
    if (m) {
      const now = new Date();
      const mo = months[m[1]];
      if (mo === undefined) return null;
      // If month is in the future relative to now, use last year
      let yr = now.getFullYear();
      const candidate = new Date(yr, mo, parseInt(m[2]));
      if (candidate > now) yr--;
      return new Date(yr, mo, parseInt(m[2]));
    }
    return null;
  }

  // ── Build 12-month arrays (last 12 months) from flat rows ────────
  function buildMonthlyArrays(invoices, expenses) {
    window._buildMonthlyArrays = buildMonthlyArrays; // expose globally
    // FISCAL-YEAR indexed (F33): index i = the i-th month of the current fiscal year. F87: the 12
    // buckets are ABSOLUTE-MONTH string keys (no new Date(y,m,1) local midnight) and each row
    // buckets by its calendar month via _toYmd(...).slice(0,7) — so no bucket depends on the
    // viewer's timezone. Legs unchanged (invoices@issue + receipts + expenses + issued bills +
    // orphan payments).
    const FD = window.FinFlowDates;
    const _MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _fym = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const _fyName = (typeof document !== 'undefined' && (document.getElementById('s-fy')||{}).value) || 'January';
    const _fyStartIdx = Math.max(0, _fym.indexOf(_fyName));
    const _fyWin = FD.resolvePeriod({ period: 'year', fyStartMonth: _fyStartIdx, today: (window._entityToday ? window._entityToday() : FD.resolvedToday(new Date())) });
    const _baseAbs = parseInt(_fyWin.start.slice(0,4),10)*12 + (parseInt(_fyWin.start.slice(5,7),10)-1);
    const months = [];
    for (let i = 0; i < 12; i++) { const _a = _baseAbs + i; months.push({ ym: Math.floor(_a/12)+'-'+String((_a%12)+1).padStart(2,'0'), label: _MN[_a%12] }); }
    // M38/M39 (money audit 2026-10-09): this is the instant first paint; the server's monthly buckets replace it
    // (_applyServerBooks). It mirrors the server exactly: a row dated after today is not in the books (D2), and
    // every leg falls back through the same date fields as computeBooks.
    const _today = (window._entityToday ? window._entityToday() : FD.resolvedToday(new Date()));
    const _idxOf = v => { const y = FD._toYmd(v); if (y == null || y > _today) return -1; const k = y.slice(0,7); return months.findIndex(m => m.ym === k); };

    const revByMonth  = new Array(12).fill(0);
    const expByMonth  = new Array(12).fill(0);

    invoices.forEach(inv => {
      const idx = _idxOf(inv.issue_date || inv.created_at || inv.date);   // F36 issue_date; created_at fallback (transition)
      if (idx >= 0 && ['pending','overdue','partial','paid'].includes(inv.status?.toLowerCase())) revByMonth[idx] += parseFloat(inv.amount) || 0;
    });
    // Cash sales receipts count as revenue; payments_received is NOT revenue (F32).
    (window.receipts || []).forEach(r => { const idx = _idxOf(r.date || r.created_at); if (idx >= 0) revByMonth[idx] += parseFloat(r.amount) || 0; });
    expenses.forEach(exp => { const idx = _idxOf(exp.expense_date || exp.date || exp.created_at); if (idx >= 0) expByMonth[idx] += parseFloat(exp.amount) || 0; });   // M39
    // F38 Step 4: issued bills accrue as expense in their ISSUE month, FULL amount — M34: FinFlowDates.isOpexBill (a stock
    // purchase's bill is inventory, reaching the P&L as COGS when sold).
    (window.bills || []).forEach(b => { if (!window.FinFlowDates.isOpexBill(b)) return; const idx = _idxOf(b.issue_date || b.created_at || b.due_date); if (idx >= 0) expByMonth[idx] += parseFloat(b.amount) || 0; });
    // ONLY orphan payments (bill_id IS NULL) — a linked payment settles AP, not a fresh expense.
    (window.paymentsMade || []).filter(p => p.bill_id == null).forEach(p => { const idx = _idxOf(p.date || p.created_at); if (idx >= 0) expByMonth[idx] += parseFloat(p.amount) || 0; });
    // F58: contra legs, bucketed on their OWN date. Mirror of the server's monthly buckets in
    // POST /api/reports/profit-loss, so the client chart and the server chart agree (Rule 6).
    // Credit notes have their OWN vocabulary (Open/Applied/Void, server.js:2307) — Void = 0.
    const _RECCREDIT = ['open','applied'];
    (window.creditNotes || []).forEach(c => { if (!_RECCREDIT.includes((c.status || '').toLowerCase())) return; const idx = _idxOf(c.date || c.created_at); if (idx >= 0) revByMonth[idx] -= parseFloat(c.amount) || 0; });
    (window.vendorCredits || []).forEach(v => { if (!_RECCREDIT.includes((v.status || '').toLowerCase())) return; const idx = _idxOf(v.date || v.created_at); if (idx >= 0) expByMonth[idx] -= parseFloat(v.amount) || 0; });
    // F33-C: bucket PAYROLL into its run month so the overview chart's expense line reconciles with
    // the Expenses KPI (computeExpenseBreakdown opex, which includes payroll). EXACT mirror of that
    // recognition + the server P&L bump: approved/paid runs, Σ lines(gross+bonus+overtime). F85
    // (2026-08-07, accrual): dated on the run's `period` (the month it is FOR), not run_date —
    // matching the server so chart and KPI agree. COGS is excluded — grossProfit, not opex.
    (window.payrollRuns || []).forEach(r => {
      if (!['approved', 'paid'].includes(String(r.status || '').toLowerCase())) return;
      // M10: the canonical period parser (handles the UI's "July 2026" as well as "2026-07") — the slice(0,7) form
      // turned "July 2026" into 2001-07-20 and dropped every UI-created run from the chart.
      const idx = _idxOf(FD.payrollPeriodYmd(r.period, r.run_date));
      if (idx < 0) return;
      (r.lines || []).forEach(l => { expByMonth[idx] += (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0); });
    });
    // N20: posted manual journals' P&L legs, bucketed by ENTRY MONTH — the client mirror of the
    // server monthly je buckets (computeBooks) and of computeRevenue/computeExpenseBreakdown's
    // journal leg (Rule 6), so the overview chart shows a journal in its month like the P&L chart.
    // income line = credit − debit (4xxx) → revByMonth; expense line = debit − credit (5xxx-9xxx)
    // → expByMonth. An untypeable code aborts the server GL posting ⇒ contributes 0 (skip).
    const _jt = window._jLineType || (c => { const d = String(c == null ? '' : c).trim()[0]; return d === '1' ? 'asset' : d === '2' ? 'liability' : d === '3' ? 'equity' : d === '4' ? 'income' : (d >= '5' && d <= '9') ? 'expense' : null; });
    (window._journals || []).forEach(j => {
      if (String(j.status || '').toLowerCase() !== 'posted') return;
      const idx = _idxOf(j.date || j.created_at);
      if (idx < 0) return;
      let lines = [];
      try { lines = Array.isArray(j.lines) ? j.lines : JSON.parse(j.lines || '[]'); } catch(_) { return; }
      let inc = 0, exp = 0, bad = false;
      for (const l of lines) {
        const t = _jt(l.code != null ? l.code : l.account);
        if (!t) { bad = true; break; }
        const dr = parseFloat(l.debit) || 0, cr = parseFloat(l.credit) || 0;
        if (t === 'income') inc += (cr - dr);
        else if (t === 'expense') exp += (dr - cr);
      }
      if (bad) return;
      revByMonth[idx] += inc; expByMonth[idx] += exp;
    });

    return { months: months.map(m => m.label), revByMonth, expByMonth };
  }

  // ── F125 (dead-code removal, 2026-08-07): `updateOverviewChart` DELETED. It returned immediately on
  // `!window.charts`, and `window.charts` is ONLY ever assigned inside `if(window.charts){…}`
  // (app-main.js:5094) — a self-referential guard that can never fire — so `window.charts` is
  // `undefined` forever and this function's window.REV/EXP splice AND its chart write NEVER RAN. The
  // overview chart is owned by app-main: `buildCharts` seeds it from the script-scoped REV/EXP and
  // `_applyConvertedChart` overlays the server-converted series. Removing this eliminates the dead
  // "second writer" of the same datasets (F75 / failure-mode-2). UNEXECUTED: charts don't render in
  // jsdom (no layout → buildCharts early-returns), so this is a STATIC-dead removal — owner to
  // confirm the overview chart still renders on deploy. ────────────────────────────────────────────

  // (calcMTD removed — F87-class dead code: current-month MTD via local getMonth/getFullYear,
  // zero call sites repo-wide. Deleted rather than fixed since nothing invoked it.)

  // ── Update KPI cards ─────────────────────────────────────────────
  function updateKPIs(invoices, expenses, period) {
    let rev = 0, exp = 0;

    // Revenue: issue-based accrual (F32) — issued invoices (recognized statuses) at FULL amount by
    // ISSUE date + cash sales receipts. Expenses = real expenses + issued bills + orphan payments.
    // F87: filter through the CANONICAL string-compare window (_periodWindow), NOT local getMonth/
    // getFullYear — pass RAW date values; inWin reduces to calendar dates and carries D2. Current
    // month/quarter tracked by currentMonthIdx (the stepper), matching the dashboard. This rev is
    // NOT written to d-rev (app-main updateDashboard owns that, F7); it feeds the returned object.
    const RECOGNIZED = ['pending','overdue','partial','paid'];
    const isIssued = i => RECOGNIZED.includes(i.status?.toLowerCase());
    const receipts     = window.receipts      || [];
    const paymentsMade = window.paymentsMade || [];
    const _mi = (period === 'year') ? null : (typeof currentMonthIdx !== 'undefined' ? currentMonthIdx : null);
    const _w  = (typeof _periodWindow === 'function') ? _periodWindow(period, _mi) : { inWin: () => true };
    const inP = v => _w.inWin(v);
    rev  = invoices.filter(i => isIssued(i) && inP(i.issue_date || i.created_at || i.date)).reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
    rev += receipts.filter(r => inP(r.date)).reduce((s,r)=>s+(parseFloat(r.amount)||0),0);
    exp  = expenses.filter(e => inP(e.expense_date || e.date || e.created_at)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
    // F38 Step 4: issued bills accrue as expense by ISSUE date, FULL amount — M34: FinFlowDates.isOpexBill.
    exp += (window.bills || []).filter(b => window.FinFlowDates.isOpexBill(b) && inP(b.issue_date || b.created_at || b.due_date)).reduce((s,b)=>s+(parseFloat(b.amount)||0),0);
    // Only ORPHAN payments (bill_id IS NULL) stay expense — a linked payment settles AP, not a
    // fresh expense (would double-count the issued-bill leg). Sole double-count guard.
    exp += paymentsMade.filter(p => p.bill_id == null && inP(p.date || p.created_at)).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);

    const profit = rev - exp;
    // F56: one canonical AR definition, mirroring the server (app-main.js arOutstanding).
    const _ar = (typeof window._arOutstanding === 'function')
      ? window._arOutstanding(invoices)
      : { total: 0, count: 0, overdueTotal: 0, overdueCount: 0 };
    const outstanding = _ar.total;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    // d-rev / d-exp / d-profit are written ONLY by app-main updateDashboard (canonical R1/E1
    // − COGS), so this wiring can't overwrite them with a divergent basis (root of F7). This
    // function still owns the non-conflicting cards below. rev/exp/profit are still computed
    // above for the returned object (used by _refreshDashboardUI's other cards).
    // F59: when a non-native display currency is active, _applyConvertedKPIs OWNS d-outstanding
    // and d-invest (it paints server-converted values, or "—" + hint). This function runs AFTER
    // it in the patched updateDashboard, so writing here would stamp NATIVE amounts under the
    // foreign symbol until the async overlay landed — a visible native→converted flip, and a
    // permanent mislabel on the overlay's failure path. Native path is unchanged.
    const _fxOwned = !!window._displayCurrency;
    if (!_fxOwned) set('d-outstanding', money(outstanding));
    // F56: THREE-way subtitle. It previously only wrote when something was overdue, so with
    // nothing overdue the card kept whatever app-main had left — "All invoices paid" — even
    // with real money outstanding. Amounts are omitted under a display currency (they'd be
    // native figures under a foreign symbol, F59); counts are currency-agnostic and always safe.
    const chgEl = document.getElementById('d-outstanding-chg');
    if (chgEl) {
      if (_ar.overdueCount > 0) {
        chgEl.textContent = `${_ar.overdueCount} overdue${_fxOwned ? '' : ' · ' + money(_ar.overdueTotal)}`;
        // L35: overdue is NET of open credit notes and never exceeds Outstanding (arOutstanding mirrors the server).
        chgEl.title = 'Past-due balances, net of open credit notes.';
        chgEl.className = 'mc-change dn';
      } else if (_ar.count > 0) {
        chgEl.textContent = `${_ar.count} unpaid invoice${_ar.count === 1 ? '' : 's'}` + (window._arCreditSuffix ? window._arCreditSuffix(_ar, money, !_fxOwned) : '');   // LA6
        chgEl.className = 'mc-change neutral';
      } else {
        chgEl.textContent = 'All invoices paid';
        chgEl.className = 'mc-change up';
      }
    }

    // ── Investments: total value of the BUSINESS investment positions ─────
    // Reads window.bizHoldings (business dataset), NOT window.holdings — that personal
    // portfolio was the cross-wire that leaked personal holdings onto the business card.
    // Business positions are empty today ⇒ $0. Value = shares × current price; the field
    // fallbacks tolerate both the personal ({price,cost}) and biz ({_lastPrice,costPer}) shapes.
    const holdings = window.bizHoldings || [];
    const portfolio = holdings.reduce((s, h) => s + (parseFloat(h.shares) || 0) * (parseFloat(h.price) || parseFloat(h._lastPrice) || parseFloat(h.costPer) || parseFloat(h.cost) || 0), 0);
    const basis     = holdings.reduce((s, h) => s + (parseFloat(h.shares) || 0) * (parseFloat(h.costPer) || parseFloat(h.cost)  || 0), 0);
    // M36: holdings are USD-priced; a non-USD business shows them only once the server-books overlay has converted
    // them (app-main _applyServerBooks) — never the USD amount under this business's symbol.
    const _entCur = ((window.ENTITIES || []).find(e => e.active) || {}).currency || 'USD';
    if (!_fxOwned) set('d-invest', String(_entCur).toUpperCase() === 'USD' ? money(portfolio) : (portfolio > 0 ? '…' : money(0)));   // F59: overlay owns this under a display currency
    const invChgEl = document.getElementById('d-invest-chg');
    if (invChgEl) {
      if (basis > 0 && !_fxOwned) {
        const pl  = portfolio - basis;
        const pct = Math.round(pl / basis * 100);
        invChgEl.textContent = (pl >= 0 ? '+' : '') + money(pl) + ' · ' + (pct >= 0 ? '+' : '') + pct + '%';
        invChgEl.className   = 'mc-change ' + (pl >= 0 ? 'up' : 'dn');
      } else if (basis > 0 && _fxOwned) {
        // P/L % is currency-agnostic; the absolute amount is not — show the ratio only.
        const pct = Math.round((portfolio - basis) / basis * 100);
        invChgEl.textContent = (pct >= 0 ? '+' : '') + pct + '%';
        invChgEl.className   = 'mc-change ' + (pct >= 0 ? 'up' : 'dn');
      } else {
        invChgEl.textContent = holdings.length ? holdings.length + ' holding' + (holdings.length !== 1 ? 's' : '') : 'No holdings';
        invChgEl.className   = 'mc-change neutral';
      }
    }

    return { rev, exp, profit, outstanding, portfolio };
  }

  // ── Update expense breakdown bars ────────────────────────────────
  function updateExpenseBars(expenses) {
    // F61: period-scope the rows. This function runs LAST in the patched updateDashboard, so it
    // is the final writer for the four bars — and it used to aggregate ALL-TIME categories with no
    // date filter, which made the expense breakdown ignore the period selector entirely: switching
    // to Month or Quarter changed every other card but not these. Filter through the SAME canonical
    // _periodWindow both KPI engines and the server use (F33/F25), so the bars agree with the
    // Expenses KPI above them. currentPeriod/currentMonthIdx are top-level `let`s in app-main.js —
    // shared global lexical scope across classic scripts — hence the typeof guards rather than
    // window.* lookups, which would be undefined.
    const _p = (typeof currentPeriod !== 'undefined') ? currentPeriod : (window.currentPeriod || 'year');
    const _mi = (typeof currentMonthIdx !== 'undefined') ? currentMonthIdx : window.currentMonthIdx;
    // M1: decompose the SAME period-scoped opex the Expenses KPI shows (computeExpenseBreakdown:
    // direct categories + payroll + bills − vendor credits) so the four bars reconcile to the KPI
    // above them, not just direct expenses. Fall back to direct-expense binning only if the engine
    // is unavailable (keeps the pre-M1 behaviour rather than blanking the widget).
    const _bd = (typeof computeExpenseBreakdown === 'function') ? computeExpenseBreakdown(_p, _mi) : null;
    // Phase 1.1: the categories come from the ONE shared decomposition (app-main _expenseCategoryRows:
    // direct categories + Payroll + Bills & vendors + Journal entries; ≤4 by name, else top 3 + "Other"), the same list the
    // Expenses page and the server breakdown use, so Σ(four bars) == the opex KPI on every surface.
    let sorted;
    if (_bd && typeof window._expenseCategoryRows === 'function') {
      sorted = window._expenseCategoryRows(_bd);
    } else {
      const cats = {};
      const _w = (typeof window._periodWindow === 'function') ? window._periodWindow(_p) : null;
      const _rows = _w ? (expenses || []).filter(e => _w.inWin(e.expense_date || e.date || e.created_at)) : (expenses || []);
      _rows.forEach(e => { const cat = e.category || 'Other'; cats[cat] = (cats[cat] || 0) + (parseFloat(e.amount) || 0); });
      const _sorted0 = Object.entries(cats).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => b[1] - a[1]);
      const _rest = _sorted0.slice(3).reduce((s, [, v]) => s + v, 0);
      sorted = _sorted0.slice(0, 3);
      if (Math.abs(_rest) > 0.005) sorted.push(['Other', _rest]);
    }
    const total = (_bd ? (_bd.total || 0) : 0) || sorted.reduce((s, [, v]) => s + v, 0) || 1;

    // Update the 4 expense bar rows (sal, rent, sw, mkt) with top 4 categories
    const barIds = [
      ['exp-sal', 'exp-sal-bar'],
      ['exp-rent', 'exp-rent-bar'],
      ['exp-sw', 'exp-sw-bar'],
      ['exp-mkt', 'exp-mkt-bar'],
    ];
    const labelIds = ['exp-sal-lbl', 'exp-rent-lbl', 'exp-sw-lbl', 'exp-mkt-lbl'];

    // F61: CLEAR all four rows before painting. The loop below only writes as many rows as there
    // are categories, so a period with fewer than 4 used to leave the surplus rows showing the
    // PREVIOUS period's amounts and labels — stale money presented as current. Now an absent row
    // reads "—" / no bar, which is honest and obviously empty.
    const _paint = (i, cat, amt) => {
      const valEl = document.getElementById(barIds[i][0]);
      const barEl = document.getElementById(barIds[i][1]);
      const lblEl = document.getElementById(labelIds[i]);
      if (valEl) valEl.textContent = (amt == null) ? '—' : money(amt);
      if (barEl) {
        const w = (amt == null) ? '0%' : Math.max(0, Math.round(amt / total * 100)) + '%';
        barEl.style.setProperty('width', w, 'important');
        barEl.style.setProperty('--bar-w', w);
      }
      if (lblEl && cat != null) lblEl.textContent = cat;
    };
    for (let i = 0; i < 4; i++) _paint(i, '', null);            // F-A1: clear label too (empty rows), not just value
    sorted.slice(0, 4).forEach(([cat, amt], i) => _paint(i, cat, amt));   // then paint
  }

  // ── Update business transactions list ────────────────────────────
  function updateTransactions(invoices, expenses) {
    const el = document.getElementById('d-txns');
    if (!el) return;

    // F187: the transactions feed must apply the same recognised-revenue allowlist as the KPI
    // (Rule 11) — a `draft` invoice is NOT revenue and must not appear here as income. Without this
    // filter the draft INV-4 ($9,999) rendered as "Revenue · draft +$9,999".
    const _RECOGNISED_INV = ['pending', 'overdue', 'partial', 'paid'];
    const allTxns = [
      ...invoices.filter(i => _RECOGNISED_INV.includes(String(i.status || '').toLowerCase())).slice(0, 5).map(i => ({
        name: i.client || 'Invoice',
        cat: `Revenue · ${i.status}`,
        amt: parseFloat(i.amount) || 0,
        type: 'income',
        date: parseDate(i.date || i.due_date || i.created_at),
      })),
      ...expenses.slice(0, 5).map(e => ({
        name: e.description || e.category || 'Expense',
        cat: `Expense · ${e.category || 'Other'}`,
        amt: parseFloat(e.amount) || 0,
        type: 'expense',
        date: parseDate(e.expense_date),
      })),
    ].sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 6);

    if (!allTxns.length) return;

    el.innerHTML = allTxns.map(t => `
      <div class="tx-row">
        <div class="tx-left">
          <div class="tx-icon ${t.type === 'income' ? 'av-green' : 'av-red'}">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              ${t.type === 'income'
                ? '<polyline points="1,8 6,3 10,7 15,2"/><polyline points="10,2 15,2 15,7"/>'
                : '<polyline points="1,5 5,10 9,7 15,13"/><polyline points="10,13 15,13 15,8"/>'}
            </svg>
          </div>
          <div>
            <div class="tx-name">${(t.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div class="tx-cat">${(t.cat || '').replace(/</g,'&lt;')}</div>
          </div>
        </div>
        <div class="tx-amt ${t.type === 'income' ? 'up' : 'dn'}">${t.type === 'income' ? '+' : '-'}${money(t.amt)}</div>
      </div>`).join('');
  }

  // ── Update invoice stats panel ────────────────────────────────────
  function updateInvoiceStats(invoices) {
    // M27 (money audit 2026-10-09): ONE writer for the Invoices page cards — window.updateInvoices
    // (finflow-api-wiring-postgres.js: recognised, non-future invoices; collected ÷ billed). This was a second
    // writer of inv-out / inv-paid-pct with its own formula (Σ paid over ALL invoices ÷ (paid + net AR)), so the
    // card showed 29% or 30% depending on which ran last.
    if (typeof window.updateInvoices === 'function') { try { window.updateInvoices(); } catch (_) {} }
  }

  // Status-aware GET for this scoped surface — attaches HTTP status so a genuine
  // failure (5xx / network) is distinguishable from logged-out (401/403). Local;
  // the shared api() copies are left untouched.
  async function apiGetStatus(path) {
    const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { const e = new Error('API error ' + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  // Dashboard KPI three-state renderer. 'loaded' comes from updateKPIs/_forceKPIs on
  // the success path; this covers loading + load-failed so an authenticated failure
  // shows in-place instead of misleading $0s.
  function _dashSetState(state) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const ids = ['d-rev', 'd-exp', 'd-profit', 'd-outstanding', 'd-invest'];
    const chg = document.getElementById('d-rev-chg');
    if (state === 'loading') {
      ids.forEach(id => set(id, '…'));
      if (chg) { chg.textContent = 'Loading…'; chg.className = 'mc-change'; }
    } else if (state === 'error') {
      ids.forEach(id => set(id, '—'));
      if (chg) {
        chg.innerHTML = 'Unable to load · ' + (window._ffRetryBtn ? window._ffRetryBtn('_bootDashboardWiring') : 'Retry');
        chg.className = 'mc-change dn';
      }
    }
  }

  // ── Main boot: load data and wire everything ─────────────────────
  async function bootDashboardWiring() {
    _dashSetState('loading');
    var _bdwSeq = window._entitySwitchSeq || 0;   // F151 stale-response guard: token captured at start
    try {
      // Get active entity_id to filter correctly
      const activeEntity = (window.ENTITIES || []).find(e => e.active);
      const eid = activeEntity?._dbId;
      const eq = eid ? '?entity_id=' + eid : '';
      const [invoices, expenses, journals] = await Promise.all([
        apiGetStatus('/api/invoices' + eq),
        apiGetStatus('/api/expenses' + eq),
        apiGetStatus('/api/journals' + eq).catch(() => []),   // N20: journals feed the P&L mirror (KPIs + chart)
      ]);

      // F151 stale-response guard: if a switch happened while these fetches were in flight, a newer
      // load owns the dashboard — discard this stale result instead of clobbering _realInvoices (the
      // tab-refocus bug where a backgrounded Saige fetch resolved late and painted Saige under Acme).
      if ((window._entitySwitchSeq || 0) !== _bdwSeq) return;
      // Store globally so period switching can re-use
      window._realInvoices = invoices || [];
      window._realExpenses = expenses || [];
      window._journals     = journals  || [];   // N20: posted manual journals for computeRevenue/computeExpenseBreakdown/buildMonthlyArrays

      // Stash the PERIOD-scoped FIFO COGS total for the canonical Net (Revenue − COGS − OpEx)
      // that app-main updateDashboard / AI / health score subtract. Non-inventory → 0.
      // F186: was '/api/cogs'+eq (entity-only ⇒ ALL-TIME COGS), which is wrong for a fiscal year
      // that excludes prior-year inventory (FY-2026 COGS 1,400 ≠ all-time 1,650) AND raced the
      // period-scoped _loadPeriodCOGS writer, so Net painted with whichever landed last. Load the
      // SAME period-scoped figure _loadPeriodCOGS uses, so there is one consistent value.
      const _cogsUrl = (typeof window._cogsPeriodParams === 'function')
        ? '/api/cogs?' + window._cogsPeriodParams().toString()
        : '/api/cogs' + eq;
      try { const _c = await apiGetStatus(_cogsUrl); window._cogsTotal = parseFloat(_c && _c.totalCOGS) || 0; }
      catch (e) { window._cogsTotal = window._cogsTotal || 0; }

      // F125: the overview chart is owned by app-main (buildCharts + _applyConvertedChart); the dead
      // updateOverviewChart writer was removed, so its monthly-array feed here is gone too.

      // Update KPIs (default to year view)
      updateKPIs(window._realInvoices, window._realExpenses, 'year');
      updateExpenseBars(window._realExpenses);
      updateTransactions(window._realInvoices, window._realExpenses);
      updateInvoiceStats(window._realInvoices);

      // Patch updateDashboard so period switching uses real data.
      // F63: guard against re-wrapping. bootDashboardWiring runs on EVERY entity load
      // (loadEntityData → _bootDashboardWiring), so without this guard each switch added another
      // wrapper layer and one updateDashboard() re-ran the four renderers once per past switch —
      // unbounded DOM churn for the session. The wrapper reads the always-current window._real*
      // globals, so wrapping exactly once is correct; the body still sees fresh data every call.
      if (!window.updateDashboard || !window.updateDashboard._ffDashWrapped) {
        const _origUpdateDashboard = window.updateDashboard;
        const _wrapped = function (d) {
          // Call original first for any non-overridden elements
          if (typeof _origUpdateDashboard === 'function') {
            try { _origUpdateDashboard(d); } catch (e) { /* ignore */ }
          }
          // Overwrite with real data
          const period = window.currentPeriod || 'year';
          updateKPIs(window._realInvoices, window._realExpenses, period);
          updateExpenseBars(window._realExpenses);
          updateTransactions(window._realInvoices, window._realExpenses);
          updateInvoiceStats(window._realInvoices);
        };
        _wrapped._ffDashWrapped = true;
        window.updateDashboard = _wrapped;
      }

      // Force a full UI refresh so KPIs + chart render with real data on page load
      // F152: route through loadChartJS so Chart.js (lazy CDN load) is present BEFORE buildCharts
      // runs — calling it raw here fired before the library loaded → "Chart.js not loaded — charts skipped".
      if (!window.charts?.overview && typeof buildCharts === 'function') { if (typeof loadChartJS === 'function') loadChartJS(buildCharts); else buildCharts(); }
      if (typeof window._refreshDashboardUI === 'function') window._refreshDashboardUI();

      // Canonical writer owns d-rev/d-exp/d-profit — call it LAST at boot so those cards show
      // the single canonical Net (Revenue − COGS − OpEx). Replaces the old _forceKPIs IIFE
      // that wrote a divergent paid-only/no-COGS basis — the root of the F7 last-writer flicker.
      if (typeof window.updateDashboard === 'function') { try { window.updateDashboard(); } catch (e) {} }

      console.log('[Dashboard Wiring] ✅ Real data loaded — invoices:', invoices.length, 'expenses:', expenses.length);
    } catch (err) {
      console.warn('[Dashboard Wiring] Could not load real data:', err.message);
      // Logged-out (401/403) or pre-auth: stay silent — correct pre-login behavior.
      // Only a genuinely authenticated failure surfaces the in-place error state.
      if (!window._ffAuthed || err.status === 401 || err.status === 403) return;
      _dashSetState('error');
    }
  }

  // bootDashboardWiring is now called by loadEntityData — no separate boot needed
  // Expose it so loadEntityData can call it after entities are loaded
  window._bootDashboardWiring = bootDashboardWiring;
  // F67: exported so app-main's loadEntityData can surface the SAME dashboard error state when an
  // entity fetch fails, instead of maintaining a second copy of the error-paint logic (or, as
  // before, warning to console and leaving fabricated $0 cards on screen).
  window._dashSetState = _dashSetState;

  // Direct UI refresh — called by refreshFinancials() after it updates
  // _realInvoices/_realExpenses. Bypasses the updateDashboard patch so it
  // works even if bootDashboardWiring hasn't run yet.
  window._refreshDashboardUI = function () {
    const invs = window._realInvoices;
    const exps = window._realExpenses;
    if (!invs || !exps) return;
    const period = window.currentPeriod || 'year';
    const { months, revByMonth, expByMonth } = buildMonthlyArrays(invs, exps);
    if (typeof window._setMonthlyArrays === 'function') window._setMonthlyArrays(revByMonth, expByMonth);   // F153: fill the global REV[]/EXP[] the overview chart reads — this path holds the real data (app-main's early fill at :1552 ran before data arrived, leaving zeros)

    // Populate EXP_SAL/RENT/SW/MKT per-month so getPeriodData() has real values.
    // F60: these MUST be indexed on the FISCAL year, exactly like buildMonthlyArrays above and
    // like REV[]/EXP[]/MONTH_FULL[]/currentMonthIdx. They previously used a ROLLING last-12-months
    // index (new Date(now.getMonth() - i)), while getPeriodData() sliced them with FISCAL indices —
    // so the two axes disagreed by (fiscal-start → 12-months-ago) months. With a January fiscal
    // year in July 2026 that is a 5-month offset: the Salaries/Rent/Software/Marketing figures,
    // the river diagram and the AI payroll insight all read the WRONG month's data. Reuse the same
    // month list buildMonthlyArrays builds so the two can never drift apart again.
    if (typeof window.EXP_SAL !== 'undefined') {
      // F87: same ABSOLUTE-MONTH string keys as buildMonthlyArrays (no local getMonth / new
      // Date(y,m,1)), so these per-category monthly arrays bucket identically and never depend on
      // the viewer's timezone. Mirror of the buildMonthlyArrays fix — kept in lockstep (F60).
      const FD = window.FinFlowDates;
      const _fym = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const _fyName = (typeof document !== 'undefined' && (document.getElementById('s-fy') || {}).value) || 'January';
      const _fyStartIdx = Math.max(0, _fym.indexOf(_fyName));
      const _fyWin = FD.resolvePeriod({ period: 'year', fyStartMonth: _fyStartIdx, today: (window._entityToday ? window._entityToday() : FD.resolvedToday(new Date())) });
      const _baseAbs = parseInt(_fyWin.start.slice(0,4),10)*12 + (parseInt(_fyWin.start.slice(5,7),10)-1);
      const _ms = [];
      for (let _i = 0; _i < 12; _i++) { const _a = _baseAbs + _i; _ms.push(Math.floor(_a/12)+'-'+String((_a%12)+1).padStart(2,'0')); }
      window.EXP_SAL.fill(0); window.EXP_RENT.fill(0); window.EXP_SW.fill(0); window.EXP_MKT.fill(0);
      exps.forEach(e => {
        const _y2 = FD._toYmd(e.expense_date || e.date || e.created_at);
        if (_y2 == null) return;
        const _ix = _ms.indexOf(_y2.slice(0,7));
        if (_ix < 0) return;
        const _c = (e.category || '').toLowerCase();
        const _a = parseFloat(e.amount) || 0;
        if (/salary|salaries|payroll/.test(_c))    window.EXP_SAL[_ix]  += _a;
        else if (/rent|lease|office/.test(_c))     window.EXP_RENT[_ix] += _a;
        else if (/software|saas|subscript/.test(_c)) window.EXP_SW[_ix] += _a;
        else if (/marketing|adverti/.test(_c))     window.EXP_MKT[_ix] += _a;
      });
    }

    if (!window.charts?.overview && typeof buildCharts === 'function') { if (typeof loadChartJS === 'function') loadChartJS(buildCharts); else buildCharts(); }   // LIVE: builds the app-main-owned chart — F152: via loadChartJS so Chart.js is present first
    // F125: dead second-writer removed — the updateOverviewChart no-op call and the
    // `if (window.charts?.overview){…}` block below it never ran (window.charts is undefined forever),
    // so they wrote nothing. buildCharts() above still (re)builds/refreshes the overview chart.
    // UNEXECUTED (charts don't render in jsdom) — owner to confirm the chart on deploy.
    updateKPIs(invs, exps, period);
    // (Removed the payroll patch that re-wrote d-exp/d-profit here — those cards are owned
    // solely by app-main updateDashboard, the canonical Revenue − COGS − OpEx writer.
    // computeExpenseBreakdown already accrues payroll into the canonical OpEx.)
    // ⚠️ F55: this function does NOT write d-rev/d-exp/d-profit. Every caller MUST call
    // window.updateDashboard() after it, or those three cards never repaint. Callers today:
    // bootDashboardWiring (below, :398-400) and refreshFinancials (finflow-api-wiring-postgres.js).
    // An earlier version of this comment claimed refreshFinancials already did — it did not,
    // because the call sat behind an `else if` that could never be reached. That was F55.

    updateExpenseBars(exps);
    updateTransactions(invs, exps);
    updateInvoiceStats(invs);
  };

})();

// ── ENTITY BOOT (runs after ALL scripts) ────────────────────────────────────
(function() {
  // Only run once on initial page load, never on entity switch
  let _booted = false;
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    setTimeout(async function() {
      if (_booted) return;
      _booted = true;
      try {
        const r = await fetch('/api/me', {credentials:'include'});
        if (!r.ok) return;
        const _meData = await r.json().catch(() => ({}));
        window.CURRENT_USER = _meData.user || _meData;
        const _seEl = document.getElementById('settings-user-email'); if (_seEl && window.CURRENT_USER?.email) _seEl.textContent = window.CURRENT_USER.email;
        if (typeof loadEntitiesFromDB === 'function') await loadEntitiesFromDB();
      } catch(e) {}
    }, 600);
  })()
})();


;
/* ── finflow-api-wiring-postgres.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — POSTGRES FINAL WIRING
// Completes the localStorage → Postgres migration by:
//   ✅ Neutralising loadPersistedData() — data comes from the API
//   ✅ Neutralising persistAll()        — API is now the source of truth
//   ✅ saveJournalEntry()  → POST /api/journals
//   ✅ addBusiness()       → POST /api/entities (then reload)
//   ✅ Clearing stale journalEntries array on boot
//   ✅ Replacing the "browser-only" data-safety banner with a cloud message
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `API ${res.status}`);
    }
    return res.json();
  }

  function tip(msg, isErr) {
    if (typeof window.notify === 'function') window.notify(msg, isErr);
    else console.warn('[FinFlow]', msg);
  }

  // ── 1. Neutralise localStorage persistence ────────────────────────
  // Data is now durably stored in PostgreSQL — no need to mirror it
  // to localStorage. Making these no-ops prevents stale local data from
  // conflicting with the authoritative API responses.
  window.loadPersistedData = function () {};
  window.persistAll        = function () {};

  // Also clear any locally-cached journal entries that came from
  // localStorage so renderJournalsLive() shows only what's in the DB.
  if (typeof window.journalEntries !== 'undefined') {
    window.journalEntries.length = 0;
  }

  // ── 2. Wire saveJournalEntry → POST /api/journals ─────────────────
  window.saveJournalEntry = async function (status) {
    // C1 Wave 1: in-flight re-entry lock — a double-click on Draft/Post cannot fire a 2nd POST. UX
    // layer only; the durable guarantee is the DB idempotency index (idx_journals_idem_key).
    if (window._savingJournal) return;
    // FA-M7: a line names its account by `acct` (from the business's chart, /api/chart) — every line with an amount needs one.
    const _withAmt = (window._jeLines || []).filter(l => l.dr > 0 || l.cr > 0);
    if (_withAmt.some(l => !l.acct)) { tip('Choose an account for every line with an amount', true); return; }
    const rawLines = _withAmt;
    if (rawLines.length < 2) { tip('Add at least 2 lines', true); return; }

    const totalDr = rawLines.reduce((s, l) => s + (l.dr || 0), 0);
    const totalCr = rawLines.reduce((s, l) => s + (l.cr || 0), 0);
    if (status === 'Posted' && Math.abs(totalDr - totalCr) > 0.01) {
      tip('Debits must equal credits to post', true); return;
    }

    const date        = document.getElementById('je-date')?.value || (window.todayLocal ? window.todayLocal() : new Date().toISOString().slice(0, 10));  // C3/F37: local date, not UTC
    const description = document.getElementById('je-notes')?.value?.trim() || 'Manual journal entry';

    // Map frontend dr/cr fields → API debit/credit field names
    const apiLines = rawLines.map(l => ({
      acct:   l.acct,
      debit:  l.dr    || 0,
      credit: l.cr    || 0,
    }));

    // One idempotency token per submit-intent: minted lazily, reused on retry of THIS modal, reset
    // on modal open (openJournalEntryModal) and on success below. A double-click (same status)
    // reuses it (→ DB dedupes); a Draft then a later Post are separate intents — the modal closes
    // and resets the token between them, so each posts once.
    window._jeIdemKey = window._jeIdemKey || (window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : 'je-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    window._savingJournal = true;
    const _jeBtns = document.querySelectorAll('#journal-entry-modal [data-on-click*="saveJournalEntry"]');
    _jeBtns.forEach(b => { b.disabled = true; });
    try {
      await api('POST', '/api/journals', { date, description, lines: apiLines, status, idempotency_key: window._jeIdemKey });
      window._jeIdemKey = null;   // success → the next entry mints a fresh token
      if (typeof window.renderJournals === 'function') window.renderJournals();
      if (typeof window.renderCOA      === 'function') window.renderCOA();
      if (typeof window.closeModal     === 'function') window.closeModal('journal-entry-modal');
      // N20: a posted/reversed journal changes the P&L, so repaint the dashboard KPIs + chart (which
      // now include the journal leg) immediately — previously only the Journals list refreshed, so the
      // dashboard stayed stale until a reload. refreshFinancials('journals') refetches window._journals.
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('all');
      tip('Journal entry ' + status.toLowerCase());
    } catch (e) {
      // Keep _jeIdemKey so a manual retry of this SAME submit is idempotent (same token → 23505 → original row).
      tip('Could not save journal entry — ' + e.message, true);
    } finally {
      window._savingJournal = false;
      _jeBtns.forEach(b => { b.disabled = false; });
    }
  };

  // ── 3. Wire addBusiness → POST /api/entities ──────────────────────
  // The old addBusiness() only saved to localStorage. Now it persists
  // to Postgres and reloads entities so the sidebar stays in sync.
  window.addBusiness = async function () {
    const name = document.getElementById('nb-name')?.value?.trim();
    if (!name) { tip('Please enter a business name', true); return; }

    const currency = document.getElementById('nb-currency')?.value || 'USD';
    const industry = document.getElementById('nb-industry')?.value || '';

    // Pick a colour from the same cycle the old code used
    const colors   = ['#c9a84c', '#9e8fbf', '#5aaa9e', '#d4964a', '#7db87d', '#c46a5a'];
    const color    = colors[(window.businesses || []).length % colors.length];

    try {
      await api('POST', '/api/entities', { name, currency, color, tag: industry || 'Business' });
      if (typeof window.closeModal === 'function') window.closeModal('add-biz-modal');
      // Reload entities from DB so sidebar + switcher update
      if (typeof window.loadEntitiesFromDB === 'function') await window.loadEntitiesFromDB();
      tip(`Business "${name}" created ✦`);
    } catch (e) {
      tip('Could not create business — ' + e.message, true);
    }
  };

  // ── 4. Live refresh helper ───────────────────────────────────────────
  // Called after any create/edit/delete so the dashboard and lists
  // immediately reflect the authoritative API state without a page reload.
  // Targeted refresh. `hint` filters which collections re-fetch:
  //   'all'              — invoices + expenses (default, backwards-compatible)
  //   'invoices'|'revenue' — invoices only
  //   'expenses'|'costs'   — expenses only
  //   'none'             — skip API fetches, just re-render the active page
  window.refreshFinancials = async function (hint) {
    if (hint === undefined) hint = 'all';
    try {
      const activeEntity = (window.ENTITIES || []).find(e => e.active);
      const eid = activeEntity?._dbId;
      const eq  = eid ? '?entity_id=' + eid : '';

      const fetchInv = ['all','invoices','revenue'].includes(hint);
      const fetchExp = ['all','expenses','costs'].includes(hint);
      // N20: posted manual journals contribute to BOTH revenue and opex, so refresh them whenever
      // either leg is refreshed (or explicitly via the 'journals' hint). Keeps window._journals —
      // the source for computeRevenue/computeExpenseBreakdown/buildMonthlyArrays — current after a
      // journal is posted, edited or reversed, so the dashboard repaints in sync with the P&L/GL.
      const fetchJrnl = ['all','invoices','revenue','expenses','costs','journals'].includes(hint);
      const fetches = [
        fetchInv ? api('GET', '/api/invoices' + eq) : Promise.resolve(null),
        fetchExp ? api('GET', '/api/expenses' + eq) : Promise.resolve(null),
        fetchJrnl ? api('GET', '/api/journals' + eq).catch(() => null) : Promise.resolve(null),
      ];
      const [invoices, expenses, journals] = await Promise.all(fetches);
      if (fetchJrnl && journals) window._journals = journals;

      // ── Refresh canonical arrays only when re-fetched ──────────────
      if (fetchInv && invoices) {
        window.userInvoices = invoices.map(r => ({
          _dbId:    r.id,
          client:   r.client,
          amount:   r.amount,
          // F56: carry amount_paid — loadEntityData already does, but this mapper dropped it, so
          // after ANY refresh userInvoices lost it. markInvoicePaid settles `amount − amount_paid`,
          // so on a partially-paid invoice it would then try to pay the FULL amount again and be
          // rejected 400 by the server's overpayment guard. Also feeds the canonical AR figure.
          amount_paid: r.amount_paid,
          credit_applied: r.credit_applied || 0,   // FA-M6b
          due:      r.due_date
            ? (window.FinFlowDates ? window.FinFlowDates.fmtLabel(r.due_date) : r.due_date)   // F195: TZ-safe calendar date (was new Date().toLocaleDateString → shifted west of UTC)
            : 'No due date',
          due_date: r.due_date,
          status:   r.status,
          number:   r.number || null,   // B1b: the invoice's number
          notes:    r.notes || '',
          color:    r.status?.toLowerCase() === 'overdue' ? 'var(--red)' : 'var(--t2)',
        }));
        window._realInvoices = invoices;
      }

      if (fetchExp && expenses) {
        window.bizExpenses = expenses.map(window.mapBizExpenseRow);   // C9: the one mapper (app-main.js)
        window._realExpenses = expenses;
      }

      // ── Detect the currently open page ────────────────────────────
      // window.currentPage is set by the showPage tracking wrapper below.
      // Fall back to DOM inspection for robustness.
      const _curPage = window.currentPage
        || document.querySelector('.page.active')?.id?.replace('page-', '')
        || 'dashboard';

      // ── Re-render the active page (list rows + stat cards) ─────────
      // Each page's render function rebuilds BOTH the table rows and the
      // stat/KPI cards at the top of that page from the current in-memory
      // arrays (which the save handler already updated optimistically).
      const _renderDispatch = {
        'invoices':           () => { if (typeof window.renderInvoices          === 'function') window.renderInvoices(); },
        'expenses':           () => { if (typeof window.renderExpenses          === 'function') window.renderExpenses(); },
        'customers':          () => { if (typeof window.renderCustomers         === 'function') window.renderCustomers(); },
        'payroll':            () => { if (typeof window.renderPayroll           === 'function') window.renderPayroll(); },
        'inventory':          () => { if (typeof window.renderInventory         === 'function') window.renderInventory(); },
        'items':              () => { if (typeof window.renderItems             === 'function') window.renderItems(); },
        'quotes':             () => { if (typeof window.renderQuotes            === 'function') window.renderQuotes(); },
        'vendors':            () => { if (typeof window.renderVendors           === 'function') window.renderVendors(); },
        'bills':              () => { if (typeof window.renderBills             === 'function') window.renderBills(); },
        'payments-received':  () => { if (typeof window.renderPaymentsReceived  === 'function') window.renderPaymentsReceived(); },
        'payments-made':      () => { if (typeof window.renderPaymentsMade      === 'function') window.renderPaymentsMade(); },
        'sales-receipts':     () => { if (typeof window.renderReceipts          === 'function') window.renderReceipts(); },
        'recurring-invoices': () => { if (typeof window.renderRecurringInvoices === 'function') window.renderRecurringInvoices(); },
        'recurring-bills':    () => { if (typeof window.renderRecurringBills    === 'function') window.renderRecurringBills(); },
        'credit-notes':       () => { if (typeof window.renderCreditNotes       === 'function') window.renderCreditNotes(); },
        'vendor-credits':     () => { if (typeof window.renderVendorCredits     === 'function') window.renderVendorCredits(); },
        'projects':           () => { if (typeof window.renderProjects          === 'function') window.renderProjects(); },
        'timesheet':          () => { if (typeof window.renderTimesheet         === 'function') window.renderTimesheet(); },
        'investments':        () => { if (typeof window.renderInvestments       === 'function') window.renderInvestments(); },
        'personal':           () => { if (typeof window.renderPersonal          === 'function') window.renderPersonal(); },
        'manual-journals':    () => { if (typeof window.renderJournals          === 'function') window.renderJournals(); },
        'chart-of-accounts':  () => { if (typeof window.renderCOA              === 'function') window.renderCOA(); },
        'reports':            () => { if (typeof window.renderReports           === 'function') window.renderReports(); },
        'budget':             () => { if (typeof window.renderBudget            === 'function') window.renderBudget(); },
        'cashflow':           () => { if (typeof window.renderCashflow          === 'function') window.renderCashflow(); },
        // PL#11: tax-filing is a static placeholder — no render hook (calcAndRenderTax removed).
      };

      const _pgFn = _renderDispatch[_curPage];
      if (_pgFn) _pgFn();

      // ── Always rebuild dashboard KPIs + charts ─────────────────────
      // F55: these are TWO SEQUENTIAL STEPS, not alternatives. _refreshDashboardUI rebuilds the
      // chart + the non-canonical cards but deliberately does NOT write d-rev/d-exp/d-profit —
      // only app-main's updateDashboard (the canonical Revenue − COGS − OpEx writer) does. The
      // old `else if` made that second call UNREACHABLE, because the dashboard wiring always
      // defines _refreshDashboardUI — so the KPI trio never repainted after a save or delete and
      // stayed stale until a period switch or reload. This now mirrors the BOOT path exactly
      // (finflow-api-wiring-dashboard.js:398-400 — _refreshDashboardUI() then updateDashboard()
      // LAST), so the mutation path and the boot path paint the same cards the same way.
      if (typeof window._refreshDashboardUI === 'function') window._refreshDashboardUI();
      if (typeof window.updateDashboard === 'function') {
        // Guarded so a KPI render error can't abort the personal-finance/budget refreshes below.
        // LOGGED, never swallowed (audit class C6).
        try { window.updateDashboard(); }
        catch (e) { console.error('[FinFlow] updateDashboard failed during refresh:', e.message); }
      }

      // ── Refresh journal and COA KPI cards if on those pages ────────
      if (_curPage === 'manual-journals' && typeof window.renderJournals === 'function') {
        window.renderJournals();
      }
      if (_curPage === 'chart-of-accounts' && typeof window.renderCOA === 'function') {
        window.renderCOA();
      }

      // ── Refresh personal finance income from payroll ────────────────
      if (typeof window.syncPayrollToPersonal === 'function') {
        window.syncPayrollToPersonal();
      }

      // ── Reload budget progress bars with fresh expense data ─────────
      if (typeof window._loadBudgetFromDB === 'function') {
        window._loadBudgetFromDB().catch(() => {});
      }

      // ── Refresh journal + COA KPI cards ────────────────────────────
      if (typeof window.renderJournals === 'function' && (_curPage === 'manual-journals' || _curPage === 'chart-of-accounts')) {
        window.renderJournals();
      }
      if (typeof window.renderCOA === 'function' && _curPage === 'chart-of-accounts') {
        window.renderCOA();
      }

      // ── Refresh personal finance surfaces (net worth, transactions) ─
      if (typeof window.loadPersonalFinance === 'function') {
        window.loadPersonalFinance().catch(() => {});
      }

      console.log('[FinFlow] refreshFinancials ✅ page:', _curPage,
        '— hint:', hint,
        '— inv:', invoices ? invoices.length : 'skipped',
        'exp:',  expenses ? expenses.length : 'skipped');
    } catch (err) {
      console.warn('[FinFlow] refreshFinancials failed:', err.message);
    }
  };

  // ── 5. Patch updateInvoices to read from API data ────────────────
  // index.html declares `let userInvoices = []` which is NOT window.userInvoices —
  // so the original updateInvoices() always reads an empty/stale closure binding.
  // We replace it with a version that reads from window._realInvoices (API source
  // of truth) and also updates the count subtitles which have no IDs in the HTML.
  window.updateInvoices = function (d) {
    const invs = window._realInvoices || window.userInvoices;
    if (!invs) return;
    const money  = n => typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toLocaleString();
    const set    = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const period = d || (typeof getPeriodData === 'function' ? getPeriodData() : { label: 'All time' });

    // F56: the Invoices page must use the SAME AR definition as the dashboard card and the
    // server — Σ max(0, amount − amount_paid) over recognized statuses. The old paid-vs-unpaid
    // split put a partially-paid invoice ENTIRELY on one side, so Billed / Collected /
    // Outstanding did not reconcile with each other or with /api/reports.
    const _arP = (typeof window._arOutstanding === 'function')
      ? window._arOutstanding(invs)
      : { total: 0, count: 0, overdueTotal: 0, overdueCount: 0 };
    // D2 (mirror of _arOutstanding + the server): Billed / Collected / % must use the SAME recognized,
    // NON-future set as Outstanding. Summing every invoice let a future-dated (scheduled) invoice inflate
    // Billed and drag the collection % down, and broke reconciliation (Billed − Collected ≠ Outstanding).
    // A future-dated doc is scheduled, not yet on the books (server.js:6312) — excluded until its date.
    const _recToday = (window.FinFlowDates ? (window._entityToday ? window._entityToday() : window.FinFlowDates.resolvedToday(new Date())) : new Date().toISOString().slice(0,10));
    const _REC = ['pending', 'overdue', 'partial', 'paid'];
    const _recognized = invs.filter(i => {
      if (!_REC.includes((i.status || '').toLowerCase())) return false;
      const _d = window.FinFlowDates ? window.FinFlowDates._toYmd(i.issue_date || i.created_at || i.date) : (i.issue_date || i.created_at || i.date || '').slice(0, 10);
      return _d != null && _d <= _recToday;   // exclude scheduled (future-dated) invoices
    });
    const totalBilled  = _recognized.reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const collected    = _recognized.reduce((a, i) => a + (parseFloat(i.amount_paid) || 0) - (parseFloat(i.credit_applied) || 0), 0);   // FA-M6b: an applied credit is not money collected
    const outstanding  = _arP.total;
    const overdue      = _arP.overdueTotal;
    const overdueCount = _arP.overdueCount;
    const outCount     = _arP.count;
    // FA-M6b: the share collected of what was really owed — a credited part was never going to be paid
    const _owedBilled  = totalBilled - _recognized.reduce((a, i) => a + (parseFloat(i.credit_applied) || 0), 0);
    const pctCollected = _owedBilled > 0 ? Math.round(collected / _owedBilled * 100) : 0;

    set('inv-billed',     money(totalBilled));
    set('inv-paid',       money(collected));
    set('inv-paid-pct',   pctCollected + '% collected');
    set('inv-out',        money(outstanding));
    set('inv-over',       money(overdue));
    // M27: Billed / Collected / Outstanding are ALL-TIME to date (every recognised invoice issued on or before
    // today), not the dashboard period — the card said "Jul 2026" over an all-time figure.
    const lblEl = document.getElementById('inv-billed-lbl');
    if (lblEl) { lblEl.textContent = 'All time, to date'; lblEl.className = 'mc-change neutral'; }
    const titleEl = document.getElementById('inv-table-title');
    if (titleEl) titleEl.textContent = 'Invoices — ' + (period.label || 'All time');

    // Update "N invoices" count subtitles (id="inv-out-cnt" / "inv-over-cnt")
    set('inv-out-cnt',  outCount     + ' invoice' + (outCount     !== 1 ? 's' : '') + (window._arCreditSuffix ? window._arCreditSuffix(_arP, money) : ''));   // LA6
    set('inv-over-cnt', overdueCount + ' invoice' + (overdueCount !== 1 ? 's' : ''));

    // Navigation badge
    const badge = document.getElementById('badge-inv');
    if (badge) { badge.textContent = overdueCount; badge.style.display = overdueCount > 0 ? '' : 'none'; }
  };

  // ── 6. Update data-safety banner to reflect cloud storage ─────────
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    // Small delay so the banner has been injected into the DOM first
    setTimeout(function () {
      const banner = document.getElementById('data-safety-banner');
      if (!banner) return;
      const span = banner.querySelector('span[style*="flex"]');
      if (span) {
        span.innerHTML =
          'Your data is <strong data-style="color:#f2e8d5">securely stored in the cloud</strong> ' +
          '— backed by PostgreSQL on Supabase. It\'s safe across all browsers and devices.';
      }
    }, 600);
  })();

  // ── 7. Track current page so refreshFinancials dispatches correctly ─
  // ── Also wrap loadEntitiesFromDB to reload vendors/bills on entity switch
  (function _run2() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run2); return; }
    // Outermost showPage wrapper — runs first, sets currentPage, then calls chain
    const _pgTrack = window.showPage;
    if (typeof _pgTrack === 'function') {
      window.showPage = function (id, navEl) {
        window.currentPage = id;
        return _pgTrack(id, navEl);
      };
    }
    // Set initial page from DOM in case showPage was never called yet
    if (!window.currentPage) {
      window.currentPage = document.querySelector('.page:not(.hidden)')?.id?.replace('page-', '') || 'dashboard';
    }

    // Wrap loadEntitiesFromDB to also reload vendors/bills after entity switch
    const _origLoadEnt = (typeof loadEntitiesFromDB === 'function') ? loadEntitiesFromDB : null;
    if (_origLoadEnt) {
      // F50 Step 2: forward `force` so a user-initiated reload (create-business/login/register)
      // bypasses the boot-dedupe memo through this wrapper instead of getting the cached promise.
      window.loadEntitiesFromDB = async function (force) {
        await _origLoadEnt(force);
        if (typeof window._loadVendorsFromDB === 'function') try { await window._loadVendorsFromDB(); } catch(e) {}
        if (typeof window._loadBillsFromDB   === 'function') try { await window._loadBillsFromDB();   } catch(e) {}
      };
    }
  })();

  // ── window.finflow.refresh(sections[]) ────────────────────────────
  // Global real-time refresh dispatcher. Call after any DB write with an
  // array of affected section names. Falls back to full refreshFinancials.
  window.finflow = window.finflow || {};
  window.finflow.refresh = function (sections) {
    const all = sections || [];
    // Page-specific re-renders
    const dispatch = {
      'invoices':           () => { if (typeof window.renderInvoices          === 'function') window.renderInvoices(); },
      'expenses':           () => { if (typeof window.renderExpenses          === 'function') window.renderExpenses(); },
      'customers':          () => { if (typeof window.renderCustomers         === 'function') window.renderCustomers(); },
      'payroll':            () => { if (typeof window.renderPayroll           === 'function') window.renderPayroll(); },
      'inventory':          () => { if (typeof window.renderInventory         === 'function') window.renderInventory(); },
      'budget':             () => { if (typeof window.renderBudget            === 'function') window.renderBudget(); if (typeof window._loadBudgetFromDB === 'function') window._loadBudgetFromDB().catch(()=>{}); },
      'banking':            () => { if (typeof window._loadVendorsFromDB      === 'function') window._loadVendorsFromDB().catch(()=>{}); if (typeof window._loadBillsFromDB === 'function') window._loadBillsFromDB().catch(()=>{}); },
      'journal':            () => { if (typeof window.renderJournals          === 'function') window.renderJournals(); },
      'chart-of-accounts':  () => { if (typeof window.renderCOA              === 'function') window.renderCOA(); },
      'reports':            () => { if (typeof window.renderReports           === 'function') window.renderReports(); },
      'cashflow':           () => { if (typeof window.renderCashflow          === 'function') window.renderCashflow(); },
      // PL#11: tax-filing is a static placeholder — no render hook (calcAndRenderTax removed).
      'time-tracking':      () => { if (typeof window.renderTimesheet         === 'function') window.renderTimesheet(); },
      'investments':        () => { if (typeof window.renderInvestments       === 'function') window.renderInvestments(); },
      'documents':          () => { if (typeof window.renderDocuments         === 'function') window.renderDocuments(); },
      'mrr':                () => { if (typeof window.renderMRR               === 'function') window.renderMRR(); },
      'money-in':           () => { if (typeof window.renderInvoices          === 'function') window.renderInvoices(); },
      'money-out':          () => { if (typeof window.renderExpenses          === 'function') window.renderExpenses(); },
      'personal-finance':   () => { if (typeof window.loadPersonalFinance     === 'function') window.loadPersonalFinance().catch(()=>{}); },
    };
    all.forEach(s => { const fn = dispatch[s]; if (fn) fn(); });
    // Always refresh dashboard when requested or when dashboard is in the list.
    // Pick a narrower hint when the affected sections only touch one side.
    if (!all.length || all.includes('dashboard')) {
      const hasInc = all.some(s => ['invoices','money-in','quotes','receipts','payments-received','credit-notes','recurring-invoices','revenue'].includes(s));
      const hasExp = all.some(s => ['expenses','money-out','vendors','bills','payments-made','vendor-credits','recurring-bills','payroll','budget','costs'].includes(s));
      const hint = (hasInc && !hasExp) ? 'invoices' : (hasExp && !hasInc) ? 'expenses' : 'all';
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials(hint);
    } else if (typeof window._refreshDashboardUI === 'function') {
      window._refreshDashboardUI();
    }
  };

  console.log('[FinFlow] Postgres wiring active — DB-only, zero localStorage.');

  // ── Define renderMRR so the finflow.refresh dispatch actually works ──
  // index.html exposes renderMRRChart + loadMRRData but not a unified renderMRR.
  // This wrapper calls both so any save that triggers 'mrr' refresh rebuilds
  // both the chart and the subscriber data.
  window.renderMRR = function () {
    if (typeof window.loadMRRData      === 'function') window.loadMRRData().catch(() => {});
    if (typeof window.renderMRRChart   === 'function') window.renderMRRChart();
  };

})();

