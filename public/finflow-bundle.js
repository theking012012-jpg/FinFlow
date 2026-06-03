/* ── finflow-api.js ── */
'use strict';
(function () {

  async function api(method, path, body) {
    var opts = { method: method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  }

  window.FF_API = {
    register:     function(e,p,n) { return api('POST','/api/auth/register',{email:e,password:p,name:n}); },
    login:        function(e,p)   { return api('POST','/api/auth/login',{email:e,password:p}); },
    logout:       function()      { return api('POST','/api/auth/logout'); },
    me:           function()      { return api('GET','/api/auth/me'); },
    getInvoices:  function()      { return api('GET','/api/invoices'); },
    getExpenses:  function()      { return api('GET','/api/expenses'); },
    getCustomers: function()      { return api('GET','/api/customers'); },
    getInventory: function()      { return api('GET','/api/inventory'); },
    getPayroll:   function()      { return api('GET','/api/payroll'); },
    getGoals:     function()      { return api('GET','/api/goals'); },
    getHoldings:  function()      { return api('GET','/api/holdings'); },
  };

  function showAuthGate() {
    var gate = document.createElement('div');
    gate.id = 'ff-auth-gate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0e0b08;font-family:Jost,system-ui,sans-serif';
    gate.innerHTML = '<style>#ff-box{width:100%;max-width:380px;padding:2rem 2.25rem;background:#16120d;border:1px solid #3d3222;border-radius:14px}.ff-t{font-size:22px;font-family:"Cormorant Garamond",serif;font-style:italic;color:#e4c97a;margin-bottom:4px}.ff-s{font-size:13px;color:#7d7060;margin-bottom:1.5rem}.ff-tabs{display:flex;gap:4px;margin-bottom:1.25rem;background:#0e0b08;border-radius:8px;padding:4px}.ff-tab{flex:1;padding:6px;border:none;border-radius:5px;font-size:12.5px;cursor:pointer;color:#7d7060;background:transparent}.ff-tab.on{background:#1c1712;color:#f2e8d5}.ff-err{font-size:12px;color:#c46a5a;background:#1e0d0a;border:1px solid #3d1a14;border-radius:6px;padding:8px;margin-bottom:1rem;display:none}.ff-lbl{font-size:11.5px;color:#9e8e73;display:block;margin-bottom:5px}.ff-inp{width:100%;padding:9px 11px;border:1px solid #3d3222;border-radius:6px;background:#1c1712;color:#f2e8d5;font-size:13px;outline:none;margin-bottom:.9rem;box-sizing:border-box;font-family:Jost,system-ui}.ff-btn{width:100%;padding:10px;border:none;border-radius:6px;background:#c9a84c;color:#0e0b08;font-size:13.5px;font-weight:600;cursor:pointer}.ff-btn:disabled{opacity:.5}.ff-hint{font-size:11.5px;color:#7d7060;text-align:center;margin-top:1rem}.ff-hint span{color:#c9a84c;cursor:pointer}</style><div id="ff-box"><div class="ff-t">FinFlow</div><div class="ff-s">Sign in to your workspace</div><div class="ff-tabs"><button class="ff-tab on" id="fft-li" onclick="ffTab(\'login\')">Sign in</button><button class="ff-tab" id="fft-re" onclick="ffTab(\'register\')">Create account</button></div><div id="ff-err" class="ff-err"></div><div id="ff-li"><label class="ff-lbl" for="ff-le">Email</label><input class="ff-inp" id="ff-le" type="email" placeholder="you@example.com"><label class="ff-lbl" for="ff-lp">Password</label><input class="ff-inp" id="ff-lp" type="password" placeholder="••••••••"><button class="ff-btn" id="ff-lb" onclick="ffLogin()">Sign in &rarr;</button><div class="ff-hint">No account? <span onclick="ffTab(\'register\')">Create one</span></div></div><div id="ff-re" style="display:none"><label class="ff-lbl" for="ff-rn">Name</label><input class="ff-inp" id="ff-rn" type="text" placeholder="Your name"><label class="ff-lbl" for="ff-re2">Email</label><input class="ff-inp" id="ff-re2" type="email" placeholder="you@example.com"><label class="ff-lbl" for="ff-rp">Password (min 8 chars)</label><input class="ff-inp" id="ff-rp" type="password" placeholder="Choose a password"><button class="ff-btn" id="ff-rb" onclick="ffRegister()">Create account &rarr;</button><div class="ff-hint">Have one? <span onclick="ffTab(\'login\')">Sign in</span></div></div></div>';
    document.body.appendChild(gate);
    gate.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      if (document.getElementById('ff-re').style.display === 'none') ffLogin(); else ffRegister();
    });
  }

  window.ffTab = function(t) {
    document.getElementById('ff-li').style.display = t==='login'?'':'none';
    document.getElementById('ff-re').style.display = t==='register'?'':'none';
    document.getElementById('fft-li').className = 'ff-tab'+(t==='login'?' on':'');
    document.getElementById('fft-re').className = 'ff-tab'+(t==='register'?' on':'');
    document.getElementById('ff-err').style.display = 'none';
  };

  function ffErr(m) { var e=document.getElementById('ff-err'); e.textContent=m; e.style.display=m?'block':'none'; }
  function ffBusy(id,b) { var b2=document.getElementById(id); b2.disabled=b; b2.innerHTML=b?'Please wait&hellip;':(id==='ff-lb'?'Sign in &rarr;':'Create account &rarr;'); }

  window.ffLogin = async function() {
    var e=document.getElementById('ff-le').value.trim(), p=document.getElementById('ff-lp').value;
    if(!e||!p){ffErr('Please fill in all fields.');return;}
    ffBusy('ff-lb',true);
    try { var r=await FF_API.login(e,p); await ffOnAuth(r.user); }
    catch(err) { ffErr(err.message||'Login failed.'); ffBusy('ff-lb',false); }
  };

  window.ffRegister = async function() {
    var n=document.getElementById('ff-rn').value.trim(), e=document.getElementById('ff-re2').value.trim(), p=document.getElementById('ff-rp').value;
    if(!e||!p){ffErr('Email and password required.');return;}
    ffBusy('ff-rb',true);
    try { var r=await FF_API.register(e,p,n); await ffOnAuth(r.user); }
    catch(err) { ffErr(err.message||'Registration failed.'); ffBusy('ff-rb',false); }
  };

  async function ffOnAuth(user) {
    try {
      var gate=document.getElementById('ff-auth-gate'); if(gate) gate.remove();
      try{sessionStorage.setItem('ff_onboarded','1');}catch(e){}
      var ob=document.getElementById('ob-overlay'); if(ob) ob.remove();
      var ls=document.getElementById('login-screen'); if(ls) ls.style.display='none';
      if(user&&user.name){var ne=document.querySelector('.user-name');if(ne)ne.textContent=user.name;}
      try{ await ffLoadData(); }catch(e){ console.warn('[FinFlow] data load failed:',e.message); }
      window._ffAuthed=true; window.dispatchEvent(new Event('ff:authed'));
    } catch(err) {
      console.error('[FinFlow] ffOnAuth crashed:',err);
    }
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
      window.userInvoices=res[0].map(function(r){return{_dbId:r.id,id:r.id,client:r.client,amount:r.amount,due:r.due_date||'—',color:r.status==='overdue'?'var(--red)':'var(--t2)',status:r.status,notes:r.notes||''};});

    if(typeof window.bizExpenses!=='undefined')
      window.bizExpenses=res[1].map(function(r){return{_dbId:r.id,id:r.id,desc:r.description,cat:r.category,amount:r.amount,ded:r.deductible,date:r.expense_date};});

    if(typeof window.customers!=='undefined')
      window.customers=res[2].map(function(r){return{_dbId:r.id,id:r.id,fname:r.fname,lname:r.lname,company:r.company,industry:r.industry,email:r.email,phone:r.phone,revenue:r.revenue,status:r.status,notes:r.notes||''};});

    if(typeof window.inventory!=='undefined')
      window.inventory=res[3].map(function(r){return{_dbId:r.id,id:r.id,sku:r.sku,name:r.name,units:r.units,max:r.max_units,cost:r.cost,low:r.low_stock===1};});

    if(typeof window.payrollEmployees!=='undefined')
      window.payrollEmployees=res[4].filter(function(r){return!r.is_owner;}).map(function(r){return{_dbId:r.id,id:r.id,fname:r.fname,lname:r.lname,role:r.role,type:r.emp_type,gross:r.gross,taxRate:r.tax_rate,initials:(r.fname[0]||'')+(r.lname[0]||''),avClass:r.av_class};});

    if(typeof window.goals!=='undefined')
      window.goals=res[5].map(function(r){return{_dbId:r.id,id:r.id,name:r.name,current:r.current_val,target:r.target_val,monthly:r.monthly_contrib,color:r.color};});

    if(typeof window.holdings!=='undefined')
      window.holdings=res[6].map(function(r){return{_dbId:r.id,id:r.id,ticker:r.ticker,name:r.name,type:r.asset_type,shares:r.shares,cost:r.cost_per,price:r.price,div:r.dividend,color:r.color};});

    setTimeout(function(){
      if(typeof window['updateDashboard']==='function'){try{window['updateDashboard']();}catch(e){}}
    }, 0);
    var _deferred=['renderInvoices','renderExpenses','renderCustomers','renderInventory',
      'renderPayroll','renderPersonal','renderInvestments','updateAI'];
    _deferred.forEach(function(fn,i){
      setTimeout(function(){ if(typeof window[fn]==='function'){try{window[fn]();}catch(e){}} }, i*16);
    });
  }

  window.ffLogout = async function() { try{await FF_API.logout();}catch(e){} location.reload(); };

  async function boot() {
    if (window._ffAuthed) return;
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
    if (!window._ffAuthed) { window.addEventListener('ff:authed', _run, {once:true}); return; }

    // ════════════════════════════════════════════
    // 1. SETTINGS — load on boot + save
    // ════════════════════════════════════════════
    // Load settings from DB and apply them to the form fields
    async function loadSettingsFromDB() {
      try {
        const s = await api('GET', '/api/settings');
        // Apply currency
        if (s.currency) {
          const sel = document.getElementById('s-currency');
          if (sel) {
            sel.value = s.currency;
            // Trigger currency update
            const map = { USD: '$', EUR: '€', GBP: '£', TTD: 'TT$', CAD: 'C$', AUD: 'A$' };
            window.currencySymbol = map[s.currency] || '$';
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
        const setField = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
        setField('s-biz-name', s.business_name);
        setField('s-industry', s.industry);
        setField('s-address',  s.address);
        setField('s-email',    s.email);
        setField('s-phone',    s.phone);
        setField('s-website',  s.website);
        setField('s-tax-id',   s.tax_id);
        setField('s-fy',       s.fiscal_year);
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
          industry,
          address,
          email,
          phone,
          website,
          tax_id,
          fiscal_year,
        });
        notify('Settings saved successfully ✦');
        // Refresh all financial displays so currency symbol + format changes apply immediately
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('all');
      } catch (e) {
        notify('Could not save settings — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 2. GOALS — save + delete
    // ════════════════════════════════════════════
    const _origSaveGoal = window.saveGoal;
    window.saveGoal = async function () {
      const name = document.getElementById('goal-name')?.value?.trim();
      if (!name) { notify('Goal name required', true); return; }

      const current_val = Number(document.getElementById('goal-current')?.value) || 0;
      const target_val  = Number(document.getElementById('goal-target')?.value)  || 0;
      const monthly     = Number(document.getElementById('goal-monthly')?.value) || 0;

      if (!target_val) { notify('Target amount required', true); return; }

      try {
        const saved = await api('POST', '/api/goals', {
          name,
          current_val,
          target_val,
          monthly_contrib: monthly,
          color: 'var(--acc)',
        });
        // Push with DB id so we can delete later
        if (!window.goals) window.goals = [];
        window.goals.push({
          _dbId: saved.id,
          name,
          current: current_val,
          target: target_val,
          monthly,
          color: 'var(--acc)',
        });
        closeModal('goal-modal');
        if (typeof renderPersonal === 'function') renderPersonal();
        notify('Goal added ✦');
        loadGoalsFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
      } catch (e) {
        notify('Could not save goal — ' + e.message, true);
      }
    };

    // New: deleteGoal — call from goal row buttons (wire up in renderPersonal if needed)
    window.deleteGoal = async function (idx) {
      const goal = window.goals[idx];
      if (!goal) return;
      if (!confirm('Delete this goal? This cannot be undone.')) return;
      try {
        if (goal._dbId) await api('DELETE', `/api/goals/${goal._dbId}`);
        window.goals.splice(idx, 1);
        if (typeof renderPersonal === 'function') renderPersonal();
        notify('Goal deleted');
      } catch (e) {
        notify('Could not delete goal — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 2b. GOALS — load on boot
    // ════════════════════════════════════════════
    async function loadGoalsFromDB() {
      try {
        const rows = await api('GET', '/api/goals');
        if (rows && rows.length > 0) {
          if (!window.goals) window.goals = [];
          window.goals.length = 0;
          rows.forEach(g => window.goals.push({
            _dbId:   g.id,
            name:    g.name,
            current: g.current_val,
            target:  g.target_val,
            monthly: g.monthly_contrib,
            color:   g.color || 'var(--acc)',
          }));
          if (typeof renderPersonal === 'function') renderPersonal();
        }
      } catch (e) {
        // Not logged in yet or no goals — fine
      }
    }
    loadGoalsFromDB();

    // ════════════════════════════════════════════
    // 3. PERSONAL TRANSACTIONS — load on boot + save
    // ════════════════════════════════════════════
    async function loadPersonalTransactionsFromDB() {
      try {
        const txns = await api('GET', '/api/personal-transactions');
        if (txns && txns.length > 0) {
          // Map DB fields to frontend shape
          window.persTransactions = txns.map(t => ({
            _dbId: t.id,
            desc: t.description,
            cat: t.category,
            amount: t.amount,
            type: t.tx_type,
            date: t.tx_date,
          }));
          if (typeof renderPersonal === 'function') renderPersonal();
        }
      } catch (e) {
        // Not logged in yet — ignore
      }
    }
    loadPersonalTransactionsFromDB();

    window.saveTransaction = async function () {
      const desc   = document.getElementById('tx-desc')?.value?.trim();
      const amount = Number(document.getElementById('tx-amount')?.value);
      const cat    = document.getElementById('tx-cat-sel')?.value  || 'Other';
      const type   = document.getElementById('tx-type')?.value     || 'expense';

      if (!desc || !amount) { notify('Description and amount required', true); return; }

      try {
        const saved = await api('POST', '/api/personal-transactions', {
          description: desc,
          category: cat,
          amount,
          tx_type: type,
          tx_date: new Date().toISOString().slice(0, 10),
        });
        window.persTransactions.unshift({
          _dbId: saved.id,
          desc,
          cat,
          amount,
          type,
          date: 'Today',
        });
        closeModal('transaction-modal');
        if (typeof renderPersonal === 'function') renderPersonal();
        notify('Transaction added ✦');
        loadPersonalTransactionsFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
      } catch (e) {
        notify('Could not save transaction — ' + e.message, true);
      }
    };

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

      if (!fname || !lname) { notify('First name and last name are required', true); return; }
      if (!email || (typeof validateEmail === 'function' && !validateEmail(email))) {
        notify('A valid email address is required', true); return;
      }

      const revRaw = (typeof validateAmount === 'function')
        ? validateAmount(document.getElementById('cust-revenue-val')?.value)
        : parseFloat(document.getElementById('cust-revenue-val')?.value) || 0;

      const data = {
        fname, lname, email,
        company:  (typeof sanitizeText === 'function') ? sanitizeText(document.getElementById('cust-company')?.value, 200)  : document.getElementById('cust-company')?.value?.trim(),
        industry: document.getElementById('cust-industry')?.value,
        phone:    (typeof sanitizePhone === 'function')  ? sanitizePhone(document.getElementById('cust-phone')?.value)       : document.getElementById('cust-phone')?.value?.trim(),
        revenue:  revRaw !== null ? revRaw : 0,
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
      if (!confirm('Delete this customer? This cannot be undone.')) return;

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

    // ── Expose load functions for entity-switch and external callers ─
    window._loadGoalsFromDB                = loadGoalsFromDB;
    window._loadPersonalTransactionsFromDB = loadPersonalTransactionsFromDB;

    // ── showPage hook: reload personal data when user visits that page ─
    const _wiringOrig = window.showPage;
    if (typeof _wiringOrig === 'function') {
      window.showPage = function (id, navEl) {
        _wiringOrig(id, navEl);
        if (id === 'personal') {
          loadGoalsFromDB();
          loadPersonalTransactionsFromDB();
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
//   ✅ markInvoicePaid()     → PUT  /api/invoices/:id
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
  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `API error ${res.status}`);
    }
    return res.json();
  }

  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    if (!window._ffAuthed) { window.addEventListener('ff:authed', _run, {once:true}); return; }

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
        if (rows && rows.length > 0) {
          // Map DB shape → frontend shape, prepend to seed data or replace
          const mapped = rows.map(r => ({
            _dbId:  r.id,
            client: r.client,
            amount: r.amount,
            due:    r.due_date
                      ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : 'TBD',
            due_date: r.due_date,
            status: r.status,
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

    // Patch saveInvoice to persist to API
    window.saveInvoice = async function () {
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
      const dueStr = due ? new Date(due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD';

      try {
        // Get active entity_id from ENTITIES array
        const _activeEnt = (window.ENTITIES || []).find(e => e.active);
        const _entityId = _activeEnt?._dbId || null;

        const saved = await api('POST', '/api/invoices', {
          client,
          amount:   amountRaw,
          due_date: due || null,
          status,
          notes,
          entity_id: _entityId,
        });

        if (!window.userInvoices) window.userInvoices = [];
        window.userInvoices.unshift({
          _dbId:    saved.id,
          client,
          amount:   amountRaw,
          due:      dueStr,
          due_date: due || null,
          status,
          notes,
          color:    status === 'overdue' ? 'var(--red)' : 'var(--t2)',
        });

        closeModal('invoice-modal');
        if (typeof renderInvoices === 'function') renderInvoices();
        notify(`Invoice created for ${client} ✦`);
        loadInvoicesFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        notify('Could not save invoice — ' + e.message, true);
      }
    };

    // Patch markInvoicePaid to also update DB
    window.markInvoicePaid = async function (idx) {
      const inv = window.userInvoices[idx];
      if (!inv) return;
      try {
        if (inv._dbId) {
          await api('PUT', `/api/invoices/${inv._dbId}`, { status: 'paid' });
        }
        window.userInvoices[idx].status = 'paid';
        window.userInvoices[idx].color  = 'var(--t2)';
        if (typeof renderInvoices === 'function') renderInvoices();
        notify('Invoice marked as paid ✦');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) {
        notify('Could not update invoice — ' + e.message, true);
      }
    };

    // New: deleteInvoice
    window.deleteInvoice = async function (idx) {
      const inv = window.userInvoices[idx];
      if (!inv) return;
      if (!confirm(`Delete invoice for ${inv.client}? This cannot be undone.`)) return;
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
    window.renderInvoices = function () {
      if (typeof updateInvoices === 'function') updateInvoices();
      const badgeCls = { paid: 'b-green', pending: 'b-amber', overdue: 'b-red' };
      const el = document.getElementById('invoice-list');
      if (!el) return;
      el.innerHTML = (window.userInvoices||[]).map((inv, idx) => `
        <div class="table-row inv-cols">
          <span>${esc(inv.client)}</span>
          <span style="font-weight:600;font-family:var(--font-mono)">${esc(S(inv.amount))}</span>
          <span style="color:${esc(inv.color)}">${esc(inv.due)}</span>
          <span><span class="badge ${badgeCls[inv.status] || 'b-amber'}">${esc(inv.status)}</span></span>
          <span class="table-actions">
            ${inv.status?.toLowerCase() === 'overdue'
              ? `<button class="btn btn-ghost btn-sm inv-remind-btn"
                   data-idx="${idx}"
                   data-client="${esc(inv.client)}"
                   data-amount="${esc(S(inv.amount))}">Remind ↗</button>`
              : ''}
            ${inv.status?.toLowerCase() === 'paid'
              ? `<button class="btn btn-ghost btn-sm" onclick="viewInvoice(${idx})">View</button>`
              : ''}
            ${inv.status?.toLowerCase() === 'pending'
              ? `<button class="btn btn-ghost btn-sm" onclick="markInvoicePaid(${idx})">Mark paid</button>`
              : ''}
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7"
              onclick="deleteInvoice(${idx})">✕</button>
          </span>
        </div>`).join('');
    };


    // ════════════════════════════════════════════
    // 2. EXPENSES
    // ════════════════════════════════════════════

    // Boot: load saved expenses
    async function loadExpensesFromDB() {
      try {
        const _eidExp = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/expenses' + (_eidExp ? '?entity_id=' + _eidExp : ''));
        if (rows && rows.length > 0) {
          const mapped = rows.map(r => ({
            _dbId:  r.id,
            desc:   r.description,
            cat:    r.category,
            amount: r.amount,
            ded:    r.deductible,
            date:   r.expense_date
                      ? new Date(r.expense_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : 'Today',
          }));
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

      try {
        const _activeEnt2 = (window.ENTITIES || []).find(e => e.active);
        const _entityId2 = _activeEnt2?._dbId || null;

        const saved = await api('POST', '/api/expenses', {
          description: desc,
          category:    cat,
          amount:      amountRaw,
          deductible:  ded,
          expense_date: new Date().toISOString().slice(0, 10),
          entity_id: _entityId2,
        });

        if (!window.bizExpenses) window.bizExpenses = [];
        window.bizExpenses.unshift({
          _dbId:  saved.id,
          desc,
          cat,
          amount: amountRaw,
          ded,
          date:   'Today',
        });

        closeModal('expense-modal');
        if (typeof renderExpenses === 'function') renderExpenses();
        notify('Expense logged ✦');
        loadExpensesFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) {
        notify('Could not log expense — ' + e.message, true);
      }
    };

    // New: deleteExpense
    window.deleteExpense = async function (idx) {
      const exp = window.bizExpenses[idx];
      if (!exp) return;
      if (!confirm(`Delete expense "${exp.desc}"? This cannot be undone.`)) return;
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
        <div class="tx-row" style="display:flex;align-items:center;justify-content:space-between">
          <div style="flex:1">
            <div class="tx-name">${esc(e.desc)}</div>
            <div class="tx-cat">${esc(e.cat)} · ${esc(e.date)}${e.ded !== 'no'
              ? ' · ' + (e.ded === 'half' ? '50%' : '100%') + ' deductible'
              : ''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="tx-amt dn">-${S(e.amount)}</div>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7;padding:2px 6px"
              onclick="deleteExpense(${idx})">✕</button>
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
        if (rows && rows.length > 0) {
          const mapped = rows.map(r => ({
            _dbId: r.id,
            sku:   r.sku,
            name:  r.name,
            units: r.units,
            max:   r.max_units || 200,
            cost:  r.cost,
            low:   !!r.low_stock,
          }));
          window.inventory = [...mapped, ...(window.inventory || []).filter(i => !i._dbId)];
          if (typeof renderInventory === 'function') renderInventory();
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
          const newUnits = item.units + qty;
          await api('PUT', `/api/inventory/${item._dbId}`, { units: newUnits });
          item.units = newUnits;
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
      if (!confirm(`Delete "${item.name}" from inventory? This cannot be undone.`)) return;
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
      const lowCount = window.inventory.filter(i => i.low || (parseFloat(i.units) || 0) < 5).length;
      // KPI cards: Total SKUs · Inventory value (units × cost) · Low stock · COGS
      const _invKpi = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      _invKpi('inv-skus', window.inventory.length);
      _invKpi('inv-value', S(window.inventory.reduce((s, i) => s + (parseFloat(i.units) || 0) * (parseFloat(i.cost) || 0), 0)));
      _invKpi('inv-lowstock', lowCount);
      _invKpi('inv-cogs',  S(window.inventory.reduce((s, i) => s + (parseFloat(i.units) || 0) * (parseFloat(i.cost) || 0), 0)));
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
        const val = item.units * item.cost;
        return `<div class="inv-item-row">
          <span style="color:var(--t3);font-family:var(--font-mono)">${esc(item.sku)}</span>
          <span>${esc(item.name)}</span>
          <span style="color:${item.low ? 'var(--red)' : 'var(--t1)'}">${item.units} units${item.low ? ' ⚠' : ''}</span>
          <div class="stock-bar"><div class="stock-fill" style="width:${pct}%;background:${col}"></div></div>
          <span style="color:${item.low ? 'var(--red)' : 'var(--t1)'}">${S(val)}</span>
          <span class="table-actions">
            <button class="btn btn-ghost btn-sm" onclick="restockItem(${idx})">Restock</button>
            ${item._dbId ? `<button class="btn btn-ghost btn-sm" onclick="openEditInvModal(${item._dbId})">Edit</button>` : ''}
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7"
              onclick="deleteInventoryItem(${idx})">✕</button>
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
      // Auto-set jurisdiction from active entity currency
      (function(){
        const active = (window.ENTITIES||[]).find(e=>e.active);
        const cur = (active?.currency||'USD').toUpperCase();
        const MAP = {USD:'US',GBP:'GB',EUR:'OTHER',CAD:'CA',AUD:'OTHER',NZD:'OTHER',SGD:'OTHER',TTD:'TT',ZAR:'OTHER',JMD:'JM',BBD:'BB',MXN:'MX',COP:'CO'};
        const jur = MAP[cur]||'US';
        ['payroll-jurisdiction','tax-prev-jur'].forEach(id=>{
          const sel = document.getElementById(id);
          if(sel && !sel._userSet){ const opt=Array.from(sel.options).find(o=>o.value===jur); if(opt) sel.value=jur; }
        });
      })();
      const op      = window.ownerPayroll || null;
      const emps    = window.payrollEmployees || [];
      const allEmps = op ? [{...op, isOwner:true}, ...emps] : emps;
      const fn      = typeof esc === 'function' ? esc : (s => String(s == null ? '' : s).replace(/</g,'&lt;').replace(/>/g,'&gt;'));
      const sm      = typeof S   === 'function' ? S   : (n => '$' + (parseFloat(n)||0).toLocaleString());
      const set     = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      const totalGross = allEmps.reduce((a, e) => a + (parseFloat(e.gross)   || 0), 0);
      const totalTax   = allEmps.reduce((a, e) => a + Math.round((parseFloat(e.gross)||0) * (parseFloat(e.taxRate)||0) / 100), 0);
      set('pr-total',    sm(totalGross));
      set('pr-headcount', allEmps.length + ' employee' + (allEmps.length !== 1 ? 's' : ''));
      set('pr-tax',      sm(totalTax));

      if (op) {
        set('pr-owner-net',   sm(op.net));
        set('pr-owner-label', 'Your net salary');
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
      }

      const list = document.getElementById('payroll-list');
      if (!list) return;
      list.innerHTML = allEmps.map(e => {
        const net      = Math.round((parseFloat(e.gross)||0) * (1 - (parseFloat(e.taxRate)||0) / 100));
        const tax      = Math.round((parseFloat(e.gross)||0) * (parseFloat(e.taxRate)||0) / 100);
        const initials = e.initials || (typeof getInitials === 'function' ? getInitials(e.fname, e.lname) : ((e.fname||'')[0] + ((e.lname||'')[0]||'')).toUpperCase());
        return `<div class="payroll-row">
          <div class="emp-info">
            <div class="emp-init ${e.avClass||'av-blue'}">${initials}</div>
            <div><div class="emp-name">${fn(e.fname)} ${fn(e.lname)}${e.isOwner ? ' <span class="badge b-blue" style="font-size:9px">You</span>' : ''}</div><div class="emp-role">${fn(e.type||'Full-time')}</div></div>
          </div>
          <span style="color:var(--t2);font-size:12px">${fn(e.role||'')}</span>
          <span style="font-family:var(--font-mono)">${sm(e.gross)}</span>
          <span style="color:var(--red);font-family:var(--font-mono)">${(parseFloat(e.taxRate)||0) > 0 ? '-' + sm(tax) : '—'}</span>
          <span style="font-weight:600;font-family:var(--font-mono);color:${e.isOwner?'var(--acc)':'var(--t1)'}">${sm(net)}</span>
          ${e.isOwner
            ? `<button class="btn-icon" onclick="openOwnerModal()" title="Edit" style="border:none;background:none;color:var(--acc)"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11 2l3 3L5 14H2v-3z"/></svg></button>`
            : `<button onclick="openEditEmployee(${e._dbId||e.id||0})" style="background:none;border:none;cursor:pointer;color:var(--t3);padding:4px;font-size:14px;line-height:1" title="Edit employee">✏</button>`}
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
              tax_rate:  op.taxRate,
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
              tax_rate:  op.taxRate,
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

        // Auto-post each entity's owner net salary as a personal-finance
        // income transaction so Personal Finance reflects the salary income.
        // Idempotent per (entity-name, calendar month): updates the existing
        // row if one already exists for this month rather than appending a
        // new entry on every save.
        try {
          const existingPersonal = await api('GET', '/api/personal-transactions').catch(() => []);
          const today = new Date().toISOString().slice(0, 10);
          const monthStart = today.slice(0, 8) + '01';
          for (const [idxStr, op] of Object.entries(byEntity)) {
            const idx = parseInt(idxStr);
            const entity = ENTITIES[idx];
            const entityName = entity?.name || 'Business';
            const gross = parseFloat(op.gross) || 0;
            const taxRate = parseFloat(op.taxRate) || 0;
            const net = Math.round(gross * (1 - taxRate / 100));
            if (net <= 0) continue;
            const description = `Owner salary — ${entityName}`;
            const existing = (existingPersonal || []).find(t =>
              t && t.description === description && (t.tx_date || '') >= monthStart
            );
            try {
              if (existing) {
                await api('PUT', `/api/personal-transactions/${existing.id}`, { amount: net });
              } else {
                await api('POST', '/api/personal-transactions', {
                  description, amount: net, tx_type: 'income',
                  category: 'Salary', tx_date: today,
                });
              }
            } catch (perr) {
              console.warn('[OwnerSalary→Personal] sync failed for', entityName, ':', perr.message);
            }
          }
        } catch (e) {
          console.warn('[OwnerSalary→Personal] sync block failed:', e.message);
        }

        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
        if (typeof window.loadPersonalFinance === 'function') {
          window.loadPersonalFinance().catch(() => {});
        }
        if (window.finflow?.refresh) window.finflow.refresh(['personal-finance']);
        // Refresh dashboard KPIs immediately after owner payroll save
        const _activeIdx = (window.ENTITIES||[]).findIndex(e => e.active);
        // Sync window.ownerPayroll to new form values so renderPayroll reads current data
        const _savedOp = (window.ownerPayrollByEntity||{})[_activeIdx] || Object.values(window.ownerPayrollByEntity||{})[0] || null;
        if (_savedOp) window.ownerPayroll = _savedOp;
        if (_activeIdx >= 0 && typeof window.loadEntityData === 'function') {
          window.loadEntityData(_activeIdx).catch(() => {});
        }
        if (typeof window.renderPayroll === 'function') window.renderPayroll();
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
      openModal('edit-inv-modal');
    };

    window.saveEditInv = async function () {
      const item = (window.inventory || []).find(i => i._dbId === _editInvDbId);
      if (!item) { closeModal('edit-inv-modal'); return; }
      const name = document.getElementById('edit-inv-name')?.value?.trim();
      if (!name) { notify('Name is required', true); return; }
      const units = Math.max(0, parseInt(document.getElementById('edit-inv-units')?.value) || 0);
      const cost  = parseFloat(document.getElementById('edit-inv-cost')?.value)  || 0;
      const max   = Math.max(1, parseInt(document.getElementById('edit-inv-max')?.value)   || 200);
      try {
        await api('PUT', `/api/inventory/${item._dbId}`, { name, units, cost, max_units: max });
        item.name  = name;
        item.units = units;
        item.cost  = cost;
        item.max   = max;
        item.low   = units < max * 0.1;
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
      return `<div class="table-row" style="grid-template-columns:1fr 80px 80px 70px 80px 60px">
        <span style="font-weight:500">${esc(i.name)}<br><span style="font-size:11px;color:var(--t3)">${esc(i.sku || '')}</span></span>
        <span><span class="badge ${i.type === 'Service' ? 'b-blue' : 'b-purple'}">${esc(i.type)}</span></span>
        <span style="font-family:var(--font-mono)">$${i.price}<span style="font-size:10px;color:var(--t3)">/${esc(i.unit || '')}</span></span>
        <span style="color:var(--t2)">${i.stock != null ? i.stock + ' units' : '—'}</span>
        <span><span class="badge ${i.status === 'Active' ? 'b-green' : i.status === 'Low Stock' ? 'b-amber' : 'b-red'}">${esc(i.status || '')}</span></span>
        <div class="table-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEditItemModal(${i._dbId})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteItem(${i._dbId})">✕</button>
        </div>
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
        list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--t3)">Loading…</div>';
        return;
      }

      const data = window.itemsData || [];
      // KPI cards: Total Items · Active · Low Stock · Avg Margin
      // Items only carry a price (no cost), so margin can't be computed;
      // we show "—" rather than invent a percentage.
      const _itKpi = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      _itKpi('items-total', data.length);
      _itKpi('items-active', data.filter(i => i.status === 'Active').length);
      _itKpi('items-lowstock', data.filter(i => i.stock !== null && i.stock !== undefined && i.stock < 10).length);
      const _withMargin = data.filter(i => (parseFloat(i.price) || 0) > 0 && i.cost != null && (parseFloat(i.cost) || 0) > 0);
      const _avgMargin = _withMargin.length
        ? Math.round(_withMargin.reduce((s, i) => s + (i.price - i.cost) / i.price * 100, 0) / _withMargin.length)
        : null;
      _itKpi('items-margin', _avgMargin != null ? _avgMargin + '%' : '—');
      window._refreshDashboardUI?.();
      const filtered = data.filter(i => filter === 'all' || (i.type || '').toLowerCase() === filter);
      list.innerHTML = filtered.length
        ? filtered.map(i => renderItemRow(i)).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No items found</div>';
    };

    window.filterItems = function (f) { window.renderItems(f); };

    window.filterItemsBySearch = function (v) {
      const data = window.itemsData || [];
      const list = document.getElementById('items-list');
      if (!list) return;
      const q = v.toLowerCase();
      const filtered = data.filter(i =>
        i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q)
      );
      list.innerHTML = filtered.length
        ? filtered.map(i => renderItemRow(i)).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No items found</div>';
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
      document.getElementById('item-status').value = item.status || 'Active';
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
      if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
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
    window._syncScenarioBase = function () {
      const invs = window._realInvoices || [];
      const exps = window._realExpenses || [];
      const annualRev = invs.filter(i => i.status?.toLowerCase() === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const annualExp = exps.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const monthlyExp = annualExp / 12;
      window.BASE = { rev: annualRev, exp: annualExp, cash: 0, burn: monthlyExp };
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
        fetch('/api/invoices', { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : [])
          .then(rows => {
            window._entRevFetching = false;
            if (rows && rows.length) { window._realInvoices = rows; if (typeof window.renderEntities === 'function') window.renderEntities(); }
          })
          .catch(() => { window._entRevFetching = false; });
      }
      const totalRev = _invSrc
        .filter(i => i.status?.toLowerCase() === 'paid')
        .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const totalExp = (window._realExpenses||[]).reduce((s,e)=>s+Number(e.amount||0),0);
      const _payAll = [...(Array.isArray(window.payrollEmployees)?window.payrollEmployees:[]), ...(window.ownerPayroll?[window.ownerPayroll]:[])];
      const payrollExp = _payAll.reduce((s,p)=>s+Number(p.gross||p.salary||0),0);
      const consolidatedProfit = totalRev - totalExp - payrollExp;
      set('ent-consol-rev', S(totalRev));
      set('ent-consol-profit', S(consolidatedProfit));
      if (totalRev > 0) {
        const margin = Math.round(consolidatedProfit / totalRev * 100);
        set('ent-consol-margin', margin + '% margin');
      }
    };

    // ── Document KPI cards: update after renderDocuments() ────────────
    const _medOrigRenderDocuments = window.renderDocuments;
    if (typeof _medOrigRenderDocuments === 'function') {
      window.renderDocuments = async function () {
        await _medOrigRenderDocuments();
        const cache = window._docsCache || [];
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('docs-count', cache.length);
        const totalKB = cache.reduce((s, d) => {
          const kb = parseFloat((d.size || '').replace(/[^0-9.]/g, '')) || 0;
          return s + kb;
        }, 0);
        set('docs-storage', totalKB >= 1024 ? (totalKB / 1024).toFixed(1) + ' MB' : Math.round(totalKB) + ' KB');
        const now = new Date();
        const thisMonth = cache.filter(d => {
          if (!d.uploaded_at) return false;
          const u = new Date(d.uploaded_at);
          return u.getFullYear() === now.getFullYear() && u.getMonth() === now.getMonth();
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
    async function loadBudgetFromDB() {
      try {
        const res = await api('GET', '/api/budget-targets');
        if (!res || typeof res !== 'object') return;
        // Accept both shapes: flat {Rent:5000} or wrapped {targets:{Rent:5000}}
        const targets = (res.targets && typeof res.targets === 'object') ? res.targets : res;

        // Fetch expenses directly — window._realExpenses may be stale or empty on first load
        let expenses = window._realExpenses || [];
        if (!expenses.length) {
          try {
            const active = (window.ENTITIES || []).find(e => e.active);
            const eq = active?._dbId ? '?entity_id=' + active._dbId : '';
            expenses = await api('GET', '/api/expenses' + eq);
          } catch (_) { expenses = []; }
        }
        if (!Array.isArray(expenses)) expenses = [];

        // Aggregate actual spend per category — case-insensitive match
        const catActuals = {};
        expenses.forEach(e => {
          const cat = (e.category || 'Other').toLowerCase();
          catActuals[cat] = (catActuals[cat] || 0) + (parseFloat(e.amount) || 0);
        });

        const COLORS = ['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a'];
        const bd = window.BUDGET_DATA;
        if (bd) { bd.length = 0; }
        let totalBudget = 0;
        const totalSpent = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

        Object.entries(targets).forEach(([cat, budget], i) => {
          const bAmt = parseFloat(budget) || 0;
          const actual = catActuals[cat.toLowerCase()] || 0;
          totalBudget += bAmt;
          if (bd) bd.push({ cat, budget: bAmt, actual, color: COLORS[i % COLORS.length] });
        });

        const remaining = totalBudget - totalSpent;
        const pct = totalBudget > 0 ? Math.round(totalSpent / totalBudget * 100) : 0;
        const sm = v => typeof window.S === 'function' ? window.S(v) : '$' + Math.round(v).toLocaleString();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

        set('budget-total',    sm(totalBudget));
        set('budget-total-sub', totalBudget > 0 ? Object.keys(targets).length + ' categor' + (Object.keys(targets).length === 1 ? 'y' : 'ies') : 'No targets set');
        set('budget-spent',    sm(totalSpent));
        set('budget-spent-pct', pct + '% used');
        set('budget-remaining', sm(Math.max(0, remaining)));
        set('budget-remaining-sub', remaining >= 0 ? 'On track' : 'Over budget');
        set('budget-variance',  sm(Math.abs(remaining)));
        set('budget-variance-sub', remaining >= 0 ? 'Under budget' : 'Over budget');

        if (typeof renderBudget === 'function') renderBudget();
      } catch (e) {
        console.warn('[Budget] Load failed:', e.message);
      }
    }
    window._loadBudgetFromDB = loadBudgetFromDB;

    // Budget targets modal — fully editable: user can add, remove, and set
    // monthly/annual targets per category. Saves to /api/budget-targets.
    const SUGGESTED_CATS = ['Salaries','Rent','Software','Marketing','Travel','Meals','Office','Utilities','Other'];
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    function _renderBudgetTargetRows(targets) {
      const rowsEl = document.getElementById('_budget-target-rows');
      if (!rowsEl) return;
      const entries = Object.entries(targets);
      if (!entries.length) {
        rowsEl.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t3);font-size:12.5px">No categories yet — add one below</div>';
        return;
      }
      rowsEl.innerHTML = entries.map(([cat, val]) => `
        <div class="_bt-row" style="display:flex;align-items:center;gap:8px">
          <input type="text" class="finput" placeholder="Category" data-bt-cat value="${esc(cat)}" style="flex:1.4;font-size:12.5px;padding:5px 8px">
          <input type="number" class="finput" placeholder="Amount" min="0" step="50" data-bt-amt value="${val||''}" style="flex:1;font-size:12.5px;padding:5px 8px">
          <button class="btn btn-ghost btn-sm" onclick="this.closest('._bt-row').remove()" title="Remove" style="color:var(--red);opacity:.7;padding:0 6px">✕</button>
        </div>`).join('');
    }

    function _addBudgetTargetRow(cat, val) {
      const rowsEl = document.getElementById('_budget-target-rows');
      if (!rowsEl) return;
      const empty = rowsEl.querySelector('div[style*="No categories yet"]');
      if (empty) empty.remove();
      const wrap = document.createElement('div');
      wrap.className = '_bt-row';
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px';
      wrap.innerHTML = `
        <input type="text" class="finput" placeholder="Category" data-bt-cat value="${esc(cat||'')}" style="flex:1.4;font-size:12.5px;padding:5px 8px">
        <input type="number" class="finput" placeholder="Amount" min="0" step="50" data-bt-amt value="${val||''}" style="flex:1;font-size:12.5px;padding:5px 8px">
        <button class="btn btn-ghost btn-sm" onclick="this.closest('._bt-row').remove()" title="Remove" style="color:var(--red);opacity:.7;padding:0 6px">✕</button>`;
      rowsEl.appendChild(wrap);
      wrap.querySelector('[data-bt-cat]').focus();
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
          <div class="modal" style="max-width:460px">
            <div class="modal-header">
              <div><div class="modal-title">Budget targets</div><div class="modal-sub">Set <span id="_bt-period-label">annual</span> targets per expense category</div></div>
              <button class="modal-close" onclick="document.getElementById('_budget-targets-modal').classList.add('hidden')"><svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
            </div>
            <div style="display:flex;gap:6px;margin:4px 0 10px">
              <button class="btn btn-ghost btn-sm _bt-period" data-period="annual" style="font-weight:600">Annual</button>
              <button class="btn btn-ghost btn-sm _bt-period" data-period="monthly">Monthly</button>
            </div>
            <div id="_budget-target-rows" style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;padding:4px 0"></div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;padding-top:8px;border-top:1px dashed var(--bd)">
              <span style="font-size:11px;color:var(--t3);align-self:center;margin-right:4px">Quick add:</span>
              <span id="_bt-suggested"></span>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto;color:var(--acc)" onclick="window._addBudgetTargetRow('', '')">+ Add custom</button>
            </div>
            <div class="modal-footer" style="margin-top:14px">
              <button class="btn btn-ghost" onclick="document.getElementById('_budget-targets-modal').classList.add('hidden')">Cancel</button>
              <button class="btn btn-primary" onclick="window._saveBudgetTargets()">Save targets</button>
            </div>
          </div>`;
        document.body.appendChild(existing);

        // Wire period toggle
        existing.querySelectorAll('._bt-period').forEach(btn => {
          btn.onclick = () => {
            existing.querySelectorAll('._bt-period').forEach(b => b.style.fontWeight = '');
            btn.style.fontWeight = '600';
            existing.dataset.period = btn.dataset.period;
            const lbl = document.getElementById('_bt-period-label');
            if (lbl) lbl.textContent = btn.dataset.period;
          };
        });
        existing.dataset.period = 'annual';

        // Wire suggested category chips
        document.getElementById('_bt-suggested').innerHTML = SUGGESTED_CATS.map(cat =>
          `<button class="btn btn-ghost btn-sm" style="font-size:10.5px;padding:2px 7px;border:1px solid var(--bd)" onclick="window._addBudgetTargetRow('${esc(cat)}','')">${esc(cat)}</button>`
        ).join(' ');
      }

      _renderBudgetTargetRows(currentTargets);
      existing.classList.remove('hidden');
    };

    window._saveBudgetTargets = async function () {
      const modal = document.getElementById('_budget-targets-modal');
      const period = (modal && modal.dataset.period) || 'annual';
      const rows = document.querySelectorAll('#_budget-target-rows ._bt-row');
      const targets = {};
      rows.forEach(row => {
        const cat = row.querySelector('[data-bt-cat]')?.value?.trim();
        const v   = parseFloat(row.querySelector('[data-bt-amt]')?.value);
        if (!cat || !(v > 0)) return;
        // Store annual values in DB; convert monthly→annual on save
        targets[cat] = period === 'monthly' ? Math.round(v * 12) : Math.round(v);
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
        if (id === 'settings')   { const _sEl = document.getElementById('settings-user-email'); if (_sEl) _sEl.textContent = window.CURRENT_USER?.email || ''; }
        if (id === 'my-accountant') { if (typeof window.loadAccountantMessages === 'function') window.loadAccountantMessages(); }
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
  window.bootFinFlowAPI = function() {
    // Legacy stub — initialization now handled via ff:authed event
    if (!window._ffAuthed) window.dispatchEvent(new Event('ff:authed'));
  };

  (async function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }

    // ── Auto-restore session ────────────────────────────────────────
    try {
      const data = await api('GET', '/api/auth/me');
      if (data && data.user) {
        // Valid session — skip login screen
        const r = 'owner';
        window.currentRole = r;
        sessionStorage.setItem('ff_role', r);
        if (typeof applyRole === 'function') applyRole(r);
        const loginScreen = document.getElementById('login-screen');
        if (loginScreen) loginScreen.style.display = 'none';
        if (typeof injectRoleBadge === 'function') injectRoleBadge(r);
        if (!window._ffAuthed) {
          window._ffAuthed = true;
          window.dispatchEvent(new Event('ff:authed'));
        }
        // Boot data load
        setTimeout(() => {
          if (typeof window._ffApiBootEasy === 'function')  window._ffApiBootEasy();
          if (typeof window._ffApiBootMedium === 'function') window._ffApiBootMedium();
        }, 0);
      }
    } catch (e) {
      // 401 = not logged in, show login screen as normal
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
    document.querySelectorAll('[onclick*="logout"],[onclick*="Logout"],[onclick*="signOut"]').forEach(el => {
      const existing = el.getAttribute('onclick');
      if (!existing.includes('doLogout')) return;
      el.setAttribute('onclick', 'doLogout()');
    });

    // ── EXPENSE EDIT ───────────────────────────────────────────────
    // The expense modal needs to support edit mode.
    // We intercept saveExpense() which already exists in the medium
    // wiring file and upgrade it to PUT when editing.

    const _mediumSaveExpense = window.saveExpense;
    window.saveExpense = async function () {
      const editId = document.getElementById('expense-edit-id')?.value;
      if (!editId) {
        // No edit id — delegate to medium wiring (POST create)
        if (typeof _mediumSaveExpense === 'function') return _mediumSaveExpense();
        return;
      }

      // Edit mode — find the DB id
      const description = document.getElementById('exp-desc')?.value?.trim();
      const category    = document.getElementById('exp-category')?.value;
      const amount      = parseFloat(document.getElementById('exp-amount')?.value) || 0;
      const deductible  = document.getElementById('exp-deductible')?.value || 'no';
      const expense_date = document.getElementById('exp-date')?.value || new Date().toISOString().slice(0, 10);

      if (!description || !amount) { notify('Description and amount required.', true); return; }

      const exp   = (window.expenses || []).find(e => e.id === Number(editId));
      const dbId  = exp?._dbId || editId;

      try {
        const updated = await api('PUT', `/api/expenses/${dbId}`, { description, category, amount, deductible, expense_date });
        const idx = (window.expenses || []).findIndex(e => e.id === Number(editId));
        if (idx > -1 && window.expenses) {
          window.expenses[idx] = { ...window.expenses[idx], description, category, amount, deductible, expense_date };
        }
        if (typeof closeModal === 'function') closeModal('expense-modal');
        if (typeof renderExpenses === 'function') renderExpenses();
        notify('Expense updated ✦');
        document.getElementById('expense-edit-id').value = '';
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) {
        notify('Could not update expense — ' + e.message, true);
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

    // Patch renderExpenses to add Edit buttons (after medium wiring has set it up)
    // We hook into the existing render after a tick
    setTimeout(() => {
      const origRenderExpenses = window.renderExpenses;
      if (typeof origRenderExpenses === 'function') {
        window.renderExpenses = function (...args) {
          origRenderExpenses(...args);
          // Add edit buttons to each row that only has a delete button
          document.querySelectorAll('#expense-list tr, #expense-list .expense-row').forEach(row => {
            if (row.querySelector('.ff-edit-exp')) return; // already has edit
            const delBtn = row.querySelector('button[onclick*="deleteExpense"]');
            if (!delBtn) return;
            const expId = (delBtn.getAttribute('onclick') || '').match(/\d+/)?.[0];
            if (!expId) return;
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-ghost ff-edit-exp';
            editBtn.style.cssText = 'padding:2px 8px;font-size:11px;margin-right:4px';
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => editExpense(Number(expId));
            delBtn.parentNode.insertBefore(editBtn, delBtn);
          });
        };
      }
    }, 500);

    // Edit expense — populate modal
    window.editExpense = function (id) {
      const exp = (window.expenses || []).find(e => e.id === id);
      if (!exp) return;
      const modal = document.getElementById('expense-modal');
      if (!modal) return;

      // Populate fields
      const f = (fieldId, val) => { const el = document.getElementById(fieldId); if (el) el.value = val ?? ''; };
      f('exp-desc',       exp.description);
      f('exp-category',   exp.category);
      f('exp-amount',     exp.amount);
      f('exp-deductible', exp.deductible);
      f('exp-date',       exp.expense_date);
      f('expense-edit-id', id);

      // Update modal title and button if they exist
      const title = modal.querySelector('.modal-title');
      if (title) title.textContent = 'Edit Expense';
      const saveBtn = modal.querySelector('button[onclick*="saveExpense"]');
      if (saveBtn) saveBtn.textContent = 'Save changes →';

      if (typeof openModal === 'function') openModal('expense-modal');
      else modal.classList.remove('hidden');
    };

    // Reset edit state when expense modal closes
    const origCloseModal = window.closeModal;
    if (typeof origCloseModal === 'function') {
      window.closeModal = function (id) {
        if (id === 'expense-modal') {
          const eid = document.getElementById('expense-edit-id');
          if (eid) eid.value = '';
          const modal = document.getElementById('expense-modal');
          if (modal) {
            const title = modal.querySelector('.modal-title');
            if (title) title.textContent = 'Add Expense';
            const saveBtn = modal.querySelector('button[onclick*="saveExpense"]');
            if (saveBtn) saveBtn.textContent = 'Save expense →';
          }
        }
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

      const ticker    = document.getElementById('hold-ticker')?.value?.trim().toUpperCase();
      const name      = document.getElementById('hold-name')?.value?.trim();
      const assetType = document.getElementById('hold-type')?.value || 'Stock';
      const shares    = parseFloat(document.getElementById('hold-shares')?.value) || 0;
      const costPer   = parseFloat(document.getElementById('hold-cost')?.value)   || 0;
      const price     = parseFloat(document.getElementById('hold-price')?.value)  || costPer;
      const dividend  = parseFloat(document.getElementById('hold-div')?.value)    || 0;

      if (!ticker || !shares) { notify('Ticker and shares required.', true); return; }

      const h    = (window.holdings || window.portfolioHoldings || []).find(h => h.id === Number(editId));
      const dbId = h?._dbId || editId;

      try {
        await api('PUT', `/api/holdings/${dbId}`, { ticker, name: name||ticker, asset_type: assetType, shares, cost_per: costPer, price, dividend });
        const list = window.holdings || window.portfolioHoldings;
        if (list) {
          const idx = list.findIndex(h => h.id === Number(editId));
          if (idx > -1) list[idx] = { ...list[idx], ticker, name: name||ticker, asset_type: assetType, shares, cost_per: costPer, price, dividend };
        }
        if (typeof closeModal === 'function') closeModal('holding-modal');
        if (typeof renderHoldings === 'function') renderHoldings();
        else if (typeof renderPortfolio === 'function') renderPortfolio();
        notify('Holding updated ✦');
        document.getElementById('holding-edit-id').value = '';
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not update holding — ' + e.message, true);
      }
    };

    // deleteHolding — new function
    window.deleteHolding = async function (id) {
      if (!confirm('Remove this holding? This cannot be undone.')) return;
      const list = window.holdings || window.portfolioHoldings || [];
      const h    = list.find(h => h.id === id);
      const dbId = h?._dbId || id;
      try {
        await api('DELETE', `/api/holdings/${dbId}`);
        if (window.holdings) window.holdings = window.holdings.filter(h => h.id !== id);
        if (window.portfolioHoldings) window.portfolioHoldings = window.portfolioHoldings.filter(h => h.id !== id);
        if (typeof renderHoldings === 'function') renderHoldings();
        else if (typeof renderPortfolio === 'function') renderPortfolio();
        notify('Holding removed');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
      } catch (e) {
        notify('Could not remove holding — ' + e.message, true);
      }
    };

    // editHolding — populate modal
    window.editHolding = function (id) {
      const list = window.holdings || window.portfolioHoldings || [];
      const h = list.find(h => h.id === id);
      if (!h) return;
      const modal = document.getElementById('holding-modal');
      if (!modal) return;

      const f = (fieldId, val) => { const el = document.getElementById(fieldId); if (el) el.value = val ?? ''; };
      f('hold-ticker',  h.ticker);
      f('hold-name',    h.name);
      f('hold-type',    h.asset_type);
      f('hold-shares',  h.shares);
      f('hold-cost',    h.cost_per);
      f('hold-price',   h.price);
      f('hold-div',     h.dividend);

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

      if (typeof openModal === 'function') openModal('holding-modal');
      else modal.classList.remove('hidden');
    };

    // Patch renderHoldings to inject Edit + Delete buttons
    setTimeout(() => {
      const origRender = window.renderHoldings || window.renderPortfolio;
      const renderKey  = window.renderHoldings ? 'renderHoldings' : 'renderPortfolio';
      if (typeof origRender === 'function') {
        window[renderKey] = function (...args) {
          origRender(...args);
          // Inject edit/delete buttons into holding rows
          document.querySelectorAll('#holdings-list tr, #holdings-list .holding-row, #portfolio-list tr').forEach(row => {
            if (row.querySelector('.ff-edit-hold')) return;
            // Find the delete button if it exists
            const delBtn = row.querySelector('button[onclick*="deleteHolding"]');
            // Try to find holding id from existing delete or from data
            let hId;
            if (delBtn) {
              hId = Number((delBtn.getAttribute('onclick') || '').match(/\d+/)?.[0]);
            } else {
              // Try to identify from ticker text in the row
              const list = window.holdings || window.portfolioHoldings || [];
              const tickerEl = row.querySelector('td:first-child, .ticker');
              if (tickerEl) {
                const ticker = tickerEl.textContent.trim();
                const h = list.find(h => h.ticker === ticker);
                if (h) hId = h.id;
              }
            }
            if (!hId) return;

            const td = delBtn ? delBtn.parentNode : row.lastElementChild;
            if (!td) return;

            // Add edit button
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-ghost ff-edit-hold';
            editBtn.style.cssText = 'padding:2px 8px;font-size:11px;margin-right:4px';
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => editHolding(hId);
            td.insertBefore(editBtn, td.firstChild);

            // Add delete button if not already there
            if (!delBtn) {
              const newDelBtn = document.createElement('button');
              newDelBtn.className = 'btn btn-ghost';
              newDelBtn.style.cssText = 'padding:2px 8px;font-size:11px;color:var(--red,#e05454)';
              newDelBtn.textContent = '✕';
              newDelBtn.title = 'Remove holding';
              newDelBtn.onclick = () => deleteHolding(hId);
              td.appendChild(newDelBtn);
            }
          });
        };
      }
    }, 600);

    console.log('[FinFlow Final Wiring] ✅ Session restore, expense edit, holdings edit/delete patched');
  })()

})();


;
/* ── finflow-api-wiring-stubs.js ── */
// ════════════════════════════════════════════════════════════════════
// FINFLOW — STUBS WIRING
// Replaces all static/hardcoded data with real API calls for:
//   ✅ Quotes       (GET/POST/PUT/DELETE /api/quotes)
//   ✅ Bills        (GET/POST/PUT/DELETE /api/bills)
//   ✅ Vendors      (GET/POST/PUT/DELETE /api/vendors)
//   ✅ Recurring Bills     (GET/POST/PUT/DELETE /api/recurring-bills)
//   ✅ Recurring Invoices  (GET/POST/PUT/DELETE /api/recurring-invoices)
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  // SHARED API HELPER
  // ─────────────────────────────────────────────────────────────────
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
  // MODAL HELPERS
  // ─────────────────────────────────────────────────────────────────
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.style.display = '';
  }
  function closeModalById(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.style.display = 'none';
  }
  function fieldVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }
  function setField(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  }
  function showNotify(msg, isErr) {
    if (typeof window.notify === 'function') window.notify(msg, isErr);
    else alert(msg);
  }

  // ─────────────────────────────────────────────────────────────────
  // STATUS BADGE HELPER
  // ─────────────────────────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      accepted: 'b-green', active: 'b-green',
      pending: 'b-amber',  due_soon: 'b-amber', paused: 'b-amber',
      declined: 'b-red',   overdue: 'b-red',
      paid: 'b-green',     unpaid: 'b-amber',
    };
    const cls = map[status?.toLowerCase()] || 'b-amber';
    const label = status ? status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function escHTML(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}

  // ─────────────────────────────────────────────────────────────────
  // ══ QUOTES ══
  // ─────────────────────────────────────────────────────────────────
  let _quotes = [];
  let _quoteEditId = null;

  async function loadQuotes() {
    try {
      _quotes = await api('GET', '/api/quotes') || [];
      window.quotes = _quotes;
      renderQuotesList();
      updateQuoteMetrics();
    } catch (e) { console.warn('[Quotes] load error', e); }
  }

  function updateQuoteMetrics() {
    const total   = _quotes.length;
    const pending = _quotes.filter(q => q.status?.toLowerCase() === 'pending').length;
    const value   = _quotes.reduce((s, q) => s + Number(q.amount || 0), 0);
    const accepted = _quotes.filter(q => q.status?.toLowerCase() === 'accepted').length;
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('qt-total',    total);
    setMC('qt-pending',  pending);
    setMC('qt-value',    '$' + value.toLocaleString());
    setMC('qt-accepted', accepted);
  }

  function renderQuotesList() {
    const list = document.getElementById('quotes-list');
    if (!list) return;
    if (!_quotes.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No quotes yet — create your first one</div>';
      return;
    }
    list.innerHTML = _quotes.map(q => `
      <div class="table-row" style="grid-template-columns:1fr 100px 90px 90px 80px 100px">
        <span style="font-weight:500">${escHTML(q.client)}</span>
        <span style="color:var(--t3)">${q.num}</span>
        <span style="font-family:var(--font-mono)">$${Number(q.amount).toLocaleString()}</span>
        <span style="color:var(--t2)">${q.expiry_date || '—'}</span>
        <span>${statusBadge(q.status)}</span>
        <div class="table-actions" style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="editQuote(${q.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteQuote(${q.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderQuotes = renderQuotesList;

  window.openNewQuoteModal = function () {
    _quoteEditId = null;
    setField('quote-client', ''); setField('quote-amount', '');
    setField('quote-expiry', ''); setField('quote-status', 'pending');
    setField('quote-notes', '');
    const title = document.querySelector('#quote-modal .modal-title');
    if (title) title.textContent = 'New Quote';
    const btn = document.querySelector('#quote-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save quote →';
    openModal('quote-modal');
  };

  window.editQuote = function (id) {
    const q = _quotes.find(x => x.id === id);
    if (!q) return;
    _quoteEditId = id;
    setField('quote-client', q.client);
    setField('quote-amount', q.amount);
    setField('quote-expiry', q.expiry_date);
    setField('quote-status', q.status);
    setField('quote-notes',  q.notes);
    const title = document.querySelector('#quote-modal .modal-title');
    if (title) title.textContent = 'Edit Quote';
    const btn = document.querySelector('#quote-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('quote-modal');
  };

  window.saveQuote = async function () {
    const client      = fieldVal('quote-client').trim();
    const amount      = parseFloat(fieldVal('quote-amount')) || 0;
    const expiry_date = fieldVal('quote-expiry');
    const status      = fieldVal('quote-status') || 'pending';
    const notes       = fieldVal('quote-notes');
    if (!client || !amount) { showNotify('Client and amount required.', true); return; }
    try {
      if (_quoteEditId) {
        await api('PUT', `/api/quotes/${_quoteEditId}`, { client, amount, expiry_date, status, notes });
        const idx = _quotes.findIndex(x => x.id === _quoteEditId);
        if (idx > -1) _quotes[idx] = { ..._quotes[idx], client, amount, expiry_date, status, notes };
        showNotify('Quote updated ✦');
      } else {
        const row = await api('POST', '/api/quotes', { client, amount, expiry_date, status, notes });
        _quotes.unshift(row);
        showNotify('Quote created ✦');
      }
      closeModalById('quote-modal');
      window.quotes = _quotes;
      renderQuotesList();
      updateQuoteMetrics();
      loadQuotes().catch(()=>{});
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
    } catch (e) { showNotify('Could not save quote — ' + e.message, true); }
  };

  window.deleteQuote = async function (id) {
    if (!confirm('Delete this quote?')) return;
    try {
      await api('DELETE', `/api/quotes/${id}`);
      _quotes = _quotes.filter(x => x.id !== id);
      renderQuotesList(); updateQuoteMetrics();
      showNotify('Quote deleted');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ VENDORS ══
  // ─────────────────────────────────────────────────────────────────
  let _vendors = [];
  let _vendorEditId = null;
  let _vendorSearch = '';

  async function loadVendors() {
    try {
      const _eidV = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
      _vendors = await api('GET', '/api/vendors' + (_eidV ? '?entity_id=' + _eidV : '')) || [];
      window.vendors = _vendors;
      renderVendorsList();
      updateVendorMetrics();
    } catch (e) { console.warn('[Vendors] load error', e); }
  }

  function updateVendorMetrics() {
    const total   = _vendors.length;
    const payables = _vendors.reduce((s, v) => s + Number(v.owing || 0), 0);
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('vendor-total', total);
    setMC('vendor-payables', '$' + payables.toLocaleString());
  }

  function renderVendorsList() {
    const list = document.getElementById('vendors-list');
    if (!list) return;
    const filtered = _vendorSearch
      ? _vendors.filter(v => v.name.toLowerCase().includes(_vendorSearch) || (v.contact || '').toLowerCase().includes(_vendorSearch) || (v.category || '').toLowerCase().includes(_vendorSearch))
      : _vendors;
    if (!filtered.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No vendors found</div>';
      return;
    }
    list.innerHTML = filtered.map(v => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="emp-init av-blue" style="font-size:10px;font-weight:700">${escHTML(v.name.slice(0,2).toUpperCase())}</div>
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--t1)">${escHTML(v.name)}</div>
            <div style="font-size:11px;color:var(--t3)">${escHTML(v.contact || '—')} · ${escHTML(v.category || '—')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:right"><div style="font-size:12px;color:var(--t3)">Owing</div><div style="font-weight:600;font-family:var(--font-mono);color:${Number(v.owing)>0?'var(--red)':'var(--green)'}">$${Number(v.owing||0).toLocaleString()}</div></div>
          <div style="text-align:right"><div style="font-size:12px;color:var(--t3)">YTD paid</div><div style="font-weight:600;font-family:var(--font-mono);color:var(--t1)">$${Number(v.ytd_paid||0).toLocaleString()}</div></div>
          <button class="btn btn-ghost btn-sm" onclick="editVendor(${v.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteVendor(${v.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderVendors = renderVendorsList;

  window.filterVendorsBySearch = function (val) {
    _vendorSearch = val.toLowerCase();
    renderVendorsList();
  };

  window.openNewVendorModal = function () {
    _vendorEditId = null;
    setField('vendor-name', ''); setField('vendor-contact', '');
    setField('vendor-category', ''); setField('vendor-owing', '0');
    setField('vendor-ytd', '0');
    const title = document.querySelector('#vendor-modal .modal-title');
    if (title) title.textContent = 'New Vendor';
    const btn = document.querySelector('#vendor-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save vendor →';
    openModal('vendor-modal');
  };

  window.editVendor = function (id) {
    const v = _vendors.find(x => x.id === id);
    if (!v) return;
    _vendorEditId = id;
    setField('vendor-name',     v.name);
    setField('vendor-contact',  v.contact);
    setField('vendor-category', v.category);
    setField('vendor-owing',    v.owing);
    setField('vendor-ytd',      v.ytd_paid);
    const title = document.querySelector('#vendor-modal .modal-title');
    if (title) title.textContent = 'Edit Vendor';
    const btn = document.querySelector('#vendor-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('vendor-modal');
  };

  window.saveVendor = async function () {
    const name     = fieldVal('vendor-name').trim();
    const contact  = fieldVal('vendor-contact').trim();
    const category = fieldVal('vendor-category').trim();
    const owing    = parseFloat(fieldVal('vendor-owing')) || 0;
    const ytd_paid = parseFloat(fieldVal('vendor-ytd'))  || 0;
    if (!name) { showNotify('Vendor name required.', true); return; }
    try {
      if (_vendorEditId) {
        await api('PUT', `/api/vendors/${_vendorEditId}`, { name, contact, category, owing, ytd_paid });
        const idx = _vendors.findIndex(x => x.id === _vendorEditId);
        if (idx > -1) _vendors[idx] = { ..._vendors[idx], name, contact, category, owing, ytd_paid };
        showNotify('Vendor updated ✦');
      } else {
        const _eidVS = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        const row = await api('POST', '/api/vendors', { name, contact, category, owing, ytd_paid, entity_id: _eidVS });
        _vendors.push(row);
        _vendors.sort((a,b) => a.name.localeCompare(b.name));
        showNotify('Vendor added ✦');
      }
      closeModalById('vendor-modal');
      window.vendors = _vendors;
      renderVendorsList(); updateVendorMetrics();
      loadVendors().catch(()=>{});
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
    } catch (e) { showNotify('Could not save vendor — ' + e.message, true); }
  };

  window.deleteVendor = async function (id) {
    if (!confirm('Remove this vendor?')) return;
    try {
      await api('DELETE', `/api/vendors/${id}`);
      _vendors = _vendors.filter(x => x.id !== id);
      renderVendorsList(); updateVendorMetrics();
      showNotify('Vendor removed');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ BILLS ══
  // ─────────────────────────────────────────────────────────────────
  let _bills = [];
  let _billEditId = null;

  async function loadBills() {
    try {
      const _eidB = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
      _bills = await api('GET', '/api/bills' + (_eidB ? '?entity_id=' + _eidB : '')) || [];
      window.bills = _bills;
      renderBillsList();
      updateBillMetrics();
    } catch (e) { console.warn('[Bills] load error', e); }
  }

  function updateBillMetrics() {
    const unpaid  = _bills.filter(b => b.status?.toLowerCase() !== 'paid').reduce((s,b) => s + Number(b.amount||0), 0);
    const overdue = _bills.filter(b => b.status?.toLowerCase() === 'overdue').length;
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('bills-total',   '$' + unpaid.toLocaleString());
    setMC('bills-overdue', overdue);
  }

  function renderBillsList() {
    const list = document.getElementById('bills-list');
    if (!list) return;
    if (!_bills.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No bills yet</div>';
      return;
    }
    list.innerHTML = _bills.map(b => `
      <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 80px 110px">
        <span style="font-weight:500">${escHTML(b.vendor)}</span>
        <span style="color:var(--t3)">${b.num}</span>
        <span style="font-family:var(--font-mono)">$${Number(b.amount||0).toLocaleString()}</span>
        <span style="color:${b.status?.toLowerCase()==='overdue'?'var(--red)':'var(--t2)'}">${b.due_date || '—'}</span>
        <span>${statusBadge(b.status)}</span>
        <div class="table-actions" style="display:flex;gap:4px">
          ${b.status?.toLowerCase() !== 'paid' ? `<button class="btn btn-ghost btn-sm" onclick="markBillPaid(${b.id})">Pay</button>` : '<span style="font-size:11px;color:var(--t3)">✓ Paid</span>'}
          <button class="btn btn-ghost btn-sm" onclick="editBill(${b.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteBill(${b.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderBills = renderBillsList;

  window.markBillPaid = async function (id) {
    try {
      await api('PUT', `/api/bills/${id}`, { status: 'paid' });
      const b = _bills.find(x => x.id === id);
      if (b) {
        // Update vendor owing too
        const vendor = _vendors.find(v => v.name === b.vendor);
        if (vendor) {
          const newOwing = Math.max(0, Number(vendor.owing || 0) - Number(b.amount || 0));
          const newYtd   = Number(vendor.ytd_paid || 0) + Number(b.amount || 0);
          await api('PUT', `/api/vendors/${vendor.id}`, { ...vendor, owing: newOwing, ytd_paid: newYtd });
          vendor.owing    = newOwing;
          vendor.ytd_paid = newYtd;
        }
        b.status = 'paid';
      }
      renderBillsList(); updateBillMetrics();
      renderVendorsList(); updateVendorMetrics();
      showNotify('Bill marked as paid ✦');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
    } catch (e) { showNotify('Could not update — ' + e.message, true); }
  };

  window.openNewBillModal = function () {
    _billEditId = null;
    setField('bill-vendor', ''); setField('bill-amount', '');
    setField('bill-due', ''); setField('bill-status', 'unpaid');
    setField('bill-notes', '');
    const title = document.querySelector('#bill-modal .modal-title');
    if (title) title.textContent = 'New Bill';
    const btn = document.querySelector('#bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save bill →';
    openModal('bill-modal');
  };

  window.editBill = function (id) {
    const b = _bills.find(x => x.id === id);
    if (!b) return;
    _billEditId = id;
    setField('bill-vendor', b.vendor);
    setField('bill-amount', b.amount);
    setField('bill-due',    b.due_date);
    setField('bill-status', b.status);
    setField('bill-notes',  b.notes);
    const title = document.querySelector('#bill-modal .modal-title');
    if (title) title.textContent = 'Edit Bill';
    const btn = document.querySelector('#bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('bill-modal');
  };

  window.saveBill = async function () {
    const vendor   = fieldVal('bill-vendor').trim();
    const amount   = parseFloat(fieldVal('bill-amount')) || 0;
    const due_date = fieldVal('bill-due');
    const status   = fieldVal('bill-status') || 'unpaid';
    const notes    = fieldVal('bill-notes');
    if (!vendor || !amount) { showNotify('Vendor and amount required.', true); return; }
    try {
      if (_billEditId) {
        await api('PUT', `/api/bills/${_billEditId}`, { vendor, amount, due_date, status, notes });
        const idx = _bills.findIndex(x => x.id === _billEditId);
        if (idx > -1) _bills[idx] = { ..._bills[idx], vendor, amount, due_date, status, notes };
        showNotify('Bill updated ✦');
      } else {
        const _eidBS = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        const row = await api('POST', '/api/bills', { vendor, amount, due_date, status, notes, entity_id: _eidBS });
        _bills.unshift(row);
        showNotify('Bill created ✦');
      }
      closeModalById('bill-modal');
      window.bills = _bills;
      renderBillsList(); updateBillMetrics();
      loadBills().catch(()=>{});
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
    } catch (e) { showNotify('Could not save bill — ' + e.message, true); }
  };

  window.deleteBill = async function (id) {
    if (!confirm('Delete this bill?')) return;
    try {
      await api('DELETE', `/api/bills/${id}`);
      _bills = _bills.filter(x => x.id !== id);
      renderBillsList(); updateBillMetrics();
      showNotify('Bill deleted');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ RECURRING BILLS ══
  // ─────────────────────────────────────────────────────────────────
  let _recurringBills = [];
  let _rbEditId = null;

  async function loadRecurringBills() {
    try {
      _recurringBills = await api('GET', '/api/recurring-bills') || [];
      window.recurringBills = _recurringBills;
      renderRecurringBillsList();
      updateRecurringBillMetrics();
    } catch (e) { console.warn('[RecurringBills] load error', e); }
  }

  function updateRecurringBillMetrics() {
    const monthly = _recurringBills.filter(r => r.status === 'active').reduce((s,r) => s + Number(r.amount||0), 0);
    const active  = _recurringBills.filter(r => r.status === 'active').length;
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('rb-active',  active);
    setMC('rb-monthly', '$' + monthly.toLocaleString());
  }

  function renderRecurringBillsList() {
    const list = document.getElementById('recurring-bills-list');
    if (!list) return;
    if (!_recurringBills.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No recurring bills set up</div>';
      return;
    }
    list.innerHTML = _recurringBills.map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--t1)">${escHTML(r.vendor)}</div>
          <div style="font-size:11px;color:var(--t3)">${r.frequency} · Next: ${r.next_run || '—'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-family:var(--font-mono);font-weight:600;color:var(--red)">-$${Number(r.amount||0).toLocaleString()}</span>
          ${statusBadge(r.status)}
          <button class="btn btn-ghost btn-sm" onclick="editRecurringBill(${r.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteRecurringBill(${r.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderRecurringBills = renderRecurringBillsList;

  window.openNewRecurringBillModal = function () {
    _rbEditId = null;
    setField('rb-vendor', ''); setField('rb-amount', '');
    setField('rb-freq', 'Monthly'); setField('rb-next', '');
    setField('rb-status', 'active');
    const title = document.querySelector('#recurring-bill-modal .modal-title');
    if (title) title.textContent = 'New Recurring Bill';
    const btn = document.querySelector('#recurring-bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save profile →';
    openModal('recurring-bill-modal');
  };

  window.editRecurringBill = function (id) {
    const r = _recurringBills.find(x => x.id === id);
    if (!r) return;
    _rbEditId = id;
    setField('rb-vendor', r.vendor);
    setField('rb-amount', r.amount);
    setField('rb-freq',   r.frequency);
    setField('rb-next',   r.next_run);
    setField('rb-status', r.status);
    const title = document.querySelector('#recurring-bill-modal .modal-title');
    if (title) title.textContent = 'Edit Recurring Bill';
    const btn = document.querySelector('#recurring-bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('recurring-bill-modal');
  };

  window.saveRecurringBill = async function () {
    const vendor    = fieldVal('rb-vendor').trim();
    const amount    = parseFloat(fieldVal('rb-amount')) || 0;
    const frequency = fieldVal('rb-freq') || 'Monthly';
    const next_run  = fieldVal('rb-next');
    const status    = fieldVal('rb-status') || 'active';
    if (!vendor || !amount) { showNotify('Vendor and amount required.', true); return; }
    try {
      if (_rbEditId) {
        await api('PUT', `/api/recurring-bills/${_rbEditId}`, { vendor, amount, frequency, next_run, status });
        const idx = _recurringBills.findIndex(x => x.id === _rbEditId);
        if (idx > -1) _recurringBills[idx] = { ..._recurringBills[idx], vendor, amount, frequency, next_run, status };
        showNotify('Profile updated ✦');
      } else {
        const row = await api('POST', '/api/recurring-bills', { vendor, amount, frequency, next_run, status });
        _recurringBills.push(row);
        showNotify('Recurring bill added ✦');
      }
      closeModalById('recurring-bill-modal');
      window.recurringBills = _recurringBills;
      renderRecurringBillsList(); updateRecurringBillMetrics();
      loadRecurringBills().catch(()=>{});
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
    } catch (e) { showNotify('Could not save — ' + e.message, true); }
  };

  window.deleteRecurringBill = async function (id) {
    if (!confirm('Remove this recurring bill profile?')) return;
    try {
      await api('DELETE', `/api/recurring-bills/${id}`);
      _recurringBills = _recurringBills.filter(x => x.id !== id);
      renderRecurringBillsList(); updateRecurringBillMetrics();
      showNotify('Profile removed');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ RECURRING INVOICES ══
  // ─────────────────────────────────────────────────────────────────
  let _recurringInvoices = [];
  let _riEditId = null;

  async function loadRecurringInvoices() {
    try {
      _recurringInvoices = await api('GET', '/api/recurring-invoices') || [];
      window.recurringInvoices = _recurringInvoices;
      renderRecurringInvoicesList();
    } catch (e) { console.warn('[RecurringInvoices] load error', e); }
  }

  function renderRecurringInvoicesList() {
    const list = document.getElementById('recurring-inv-list');
    if (!list) return;
    if (!_recurringInvoices.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No recurring invoice profiles</div>';
      return;
    }
    list.innerHTML = _recurringInvoices.map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--t1)">${escHTML(r.client)}</div>
          <div style="font-size:11px;color:var(--t3)">${r.frequency} · Next: ${r.next_run || '—'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-family:var(--font-mono);font-weight:600;color:var(--t1)">$${Number(r.amount||0).toLocaleString()}</span>
          ${statusBadge(r.status)}
          <button class="btn btn-ghost btn-sm" onclick="editRecurringInvoice(${r.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteRecurringInvoice(${r.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderRecurringInvoices = renderRecurringInvoicesList;

  window.openNewRecurringModal = function () {
    _riEditId = null;
    setField('ri-client', ''); setField('ri-amount', '');
    setField('ri-freq', 'Monthly'); setField('ri-next', '');
    setField('ri-status', 'active');
    const title = document.querySelector('#recurring-inv-modal .modal-title');
    if (title) title.textContent = 'New Recurring Invoice';
    const btn = document.querySelector('#recurring-inv-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save profile →';
    openModal('recurring-inv-modal');
  };

  window.editRecurringInvoice = function (id) {
    const r = _recurringInvoices.find(x => x.id === id);
    if (!r) return;
    _riEditId = id;
    setField('ri-client', r.client);
    setField('ri-amount', r.amount);
    setField('ri-freq',   r.frequency);
    setField('ri-next',   r.next_run);
    setField('ri-status', r.status);
    const title = document.querySelector('#recurring-inv-modal .modal-title');
    if (title) title.textContent = 'Edit Recurring Invoice';
    const btn = document.querySelector('#recurring-inv-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('recurring-inv-modal');
  };

  window.saveRecurringInvoice = async function () {
    const client    = fieldVal('ri-client').trim();
    const amount    = parseFloat(fieldVal('ri-amount')) || 0;
    const frequency = fieldVal('ri-freq') || 'Monthly';
    const next_run  = fieldVal('ri-next');
    const status    = fieldVal('ri-status') || 'active';
    if (!client || !amount) { showNotify('Client and amount required.', true); return; }
    try {
      if (_riEditId) {
        await api('PUT', `/api/recurring-invoices/${_riEditId}`, { client, amount, frequency, next_run, status });
        const idx = _recurringInvoices.findIndex(x => x.id === _riEditId);
        if (idx > -1) _recurringInvoices[idx] = { ..._recurringInvoices[idx], client, amount, frequency, next_run, status };
        showNotify('Profile updated ✦');
      } else {
        const row = await api('POST', '/api/recurring-invoices', { client, amount, frequency, next_run, status });
        _recurringInvoices.push(row);
        showNotify('Recurring invoice added ✦');
      }
      closeModalById('recurring-inv-modal');
      window.recurringInvoices = _recurringInvoices;
      renderRecurringInvoicesList();
      loadRecurringInvoices().catch(()=>{});
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
    } catch (e) { showNotify('Could not save — ' + e.message, true); }
  };

  window.deleteRecurringInvoice = async function (id) {
    if (!confirm('Remove this recurring invoice profile?')) return;
    try {
      await api('DELETE', `/api/recurring-invoices/${id}`);
      _recurringInvoices = _recurringInvoices.filter(x => x.id !== id);
      renderRecurringInvoicesList();
      showNotify('Profile removed');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ BOOT: load all data when a page is shown ══
  // ─────────────────────────────────────────────────────────────────
  const _origShowPage = window.showPage;
  window.showPage = function (id, el) {
    if (typeof _origShowPage === 'function') _origShowPage(id, el);
    // Lazy-load on first visit
    if (id === 'quotes')            loadQuotes();
    if (id === 'vendors')           loadVendors();
    if (id === 'bills')             loadBills();
    if (id === 'recurring-bills')   loadRecurringBills();
    if (id === 'recurring-invoices') loadRecurringInvoices();
  };

  // Also load if page is already active on boot (e.g. deep link)
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    // Give other wiring scripts a tick to set up first
    setTimeout(() => {
      // If already on one of these pages, load data now
      const active = document.querySelector('.page:not(.hidden), .page[style*="display"]');
      if (!active) return;
      const id = active.id?.replace('page-', '');
      if (['quotes','vendors','bills','recurring-bills','recurring-invoices'].includes(id)) {
        window.showPage && window.showPage(id, null);
      }
    }, 800);
  })()

  // Expose so entity-switch handler can reload entity-scoped data
  window._loadVendorsFromDB        = loadVendors;
  window._loadBillsFromDB          = loadBills;
  window._loadQuotesFromDB         = loadQuotes;
  window._loadRecurringBillsFromDB = loadRecurringBills;
  window._loadRecurringInvFromDB   = loadRecurringInvoices;

  console.log('[FinFlow Stubs Wiring] ✅ Quotes, Bills, Vendors, Recurring Bills, Recurring Invoices — all wired to real API');

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
function fmtDate(s){ if(!s)return ''; const d=new Date(s); return isNaN(d)?s:d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function _escHTML(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}
function nextNum(prefix, list, field='num'){
  const nums = list.map(r=>(r[field]||'').replace(prefix+'-','0')).map(Number).filter(n=>!isNaN(n));
  const next = nums.length ? Math.max(...nums)+1 : 1;
  return prefix + '-' + String(next).padStart(4,'0');
}

/* ══════════════════════════════════════════════════════════════════
   SALES RECEIPTS
══════════════════════════════════════════════════════════════════ */
let _receipts = [];

async function loadReceipts(){
  try{ _receipts = await apiFetch('/api/sales-receipts') || []; } catch(e){ _receipts=[]; }
  window.receipts = _receipts;
}

function renderReceipts(){
  // Was: loadReceipts().then(()=>{...})()  — that extra () invoked the Promise
  // returned by .then() as a function, throwing TypeError every time the
  // tab was rendered before pages.js had assigned its override.
  loadReceipts().then(()=>{
    const l = document.getElementById('receipts-list'); if(!l) return;
    if(!_receipts.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No sales receipts yet. Click + New Receipt to add one.</div>'; return; }
    l.innerHTML = _receipts.map(r=>`
      <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 80px">
        <span style="font-weight:500">${_escHTML(r.customer||'')}</span>
        <span style="color:var(--t3)">${r.num||''}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${fmtMoney(r.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(r.date)||r.date||''}</span>
        <span><span class="badge b-blue">${r.method||''}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditReceiptModal(${r.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteReceipt(${r.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function _sv(id,v){const el=document.getElementById(id); if(el) el.value=v;}
function _st(id,v){const el=document.getElementById(id); if(el) el.textContent=v;}
function openNewReceiptModal(){
  _st('receipt-modal-title','New Sales Receipt');
  _sv('receipt-id','');
  _sv('receipt-customer','');
  _sv('receipt-amount','');
  _sv('receipt-date', new Date().toISOString().slice(0,10));
  _sv('receipt-method','Card');
  _sv('receipt-notes','');
  openModal('modal-receipt');
}

function openEditReceiptModal(id){
  const r = _receipts.find(x=>x.id===id); if(!r) return;
  _st('receipt-modal-title','Edit Sales Receipt');
  _sv('receipt-id',id);
  _sv('receipt-customer',r.customer||'');
  _sv('receipt-amount',r.amount||'');
  _sv('receipt-date',(r.date||'').slice(0,10)||new Date().toISOString().slice(0,10));
  _sv('receipt-method',r.method||'Card');
  _sv('receipt-notes',r.notes||'');
  openModal('modal-receipt');
}

async function saveReceipt(){
  const id = document.getElementById('receipt-id').value;
  const payload = {
    customer: document.getElementById('receipt-customer').value.trim(),
    amount:   parseFloat(document.getElementById('receipt-amount').value)||0,
    date:     document.getElementById('receipt-date').value,
    method:   document.getElementById('receipt-method').value,
    notes:    document.getElementById('receipt-notes').value.trim(),
    num:      id ? (_receipts.find(r=>r.id===+id)||{}).num : nextNum('SR', _receipts),
  };
  if(!payload.customer){ alert('Customer is required'); return; }
  try{
    if(id){ await apiFetch('/api/sales-receipts/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/sales-receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-receipt');
    renderReceipts();
    window.finflow?.refresh(['invoices','dashboard','money-in','reports']);
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deleteReceipt(id){
  if(!confirm('Delete this receipt?')) return;
  await apiFetch('/api/sales-receipts/'+id,{method:'DELETE'});
  renderReceipts();
  window.finflow?.refresh(['invoices','dashboard','money-in','reports']);
}

/* ══════════════════════════════════════════════════════════════════
   PAYMENTS RECEIVED
══════════════════════════════════════════════════════════════════ */
let _paymentsReceived = [];

async function loadPaymentsReceived(){
  try{ _paymentsReceived = await apiFetch('/api/payments-received') || []; } catch(e){ _paymentsReceived=[]; }
  window.paymentsReceived = _paymentsReceived;
}

function renderPaymentsReceived(){
  loadPaymentsReceived().then(()=>{
    const l = document.getElementById('payments-recv-list'); if(!l) return;
    if(!_paymentsReceived.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No payments recorded yet. Click + Record Payment to add one.</div>'; return; }
    l.innerHTML = _paymentsReceived.map(p=>`
      <div class="table-row" style="grid-template-columns:1fr 110px 80px 80px 70px 80px">
        <span style="font-weight:500">${_escHTML(p.customer||'')}</span>
        <span style="color:var(--t3)">${p.invoice_ref||''}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${fmtMoney(p.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(p.date)||p.date||''}</span>
        <span><span class="badge b-blue">${p.method||''}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditPaymentReceivedModal(${p.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deletePaymentReceived(${p.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openRecordPaymentModal(){
  _st('pr-modal-title','Record Payment Received');
  _sv('pr-id','');
  _sv('pr-customer','');
  _sv('pr-invoice-ref','');
  _sv('pr-amount','');
  _sv('pr-date', new Date().toISOString().slice(0,10));
  _sv('pr-method','Bank Transfer');
  _sv('pr-notes','');
  openModal('modal-payment-received');
}

function openEditPaymentReceivedModal(id){
  const p = _paymentsReceived.find(x=>x.id===id); if(!p) return;
  _st('pr-modal-title','Edit Payment Received');
  _sv('pr-id',id);
  _sv('pr-customer',p.customer||'');
  _sv('pr-invoice-ref',p.invoice_ref||'');
  _sv('pr-amount',p.amount||'');
  _sv('pr-date',(p.date||'').slice(0,10)||new Date().toISOString().slice(0,10));
  _sv('pr-method',p.method||'Bank Transfer');
  _sv('pr-notes',p.notes||'');
  openModal('modal-payment-received');
}

async function savePaymentReceived(){
  const id = document.getElementById('pr-id').value;
  const payload = {
    customer:    document.getElementById('pr-customer').value.trim(),
    invoice_ref: document.getElementById('pr-invoice-ref').value.trim(),
    amount:      parseFloat(document.getElementById('pr-amount').value)||0,
    date:        document.getElementById('pr-date').value,
    method:      document.getElementById('pr-method').value,
    notes:       document.getElementById('pr-notes').value.trim(),
  };
  if(!payload.customer){ alert('Customer is required'); return; }
  try{
    if(id){ await apiFetch('/api/payments-received/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/payments-received',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-payment-received');
    renderPaymentsReceived();
    window.finflow?.refresh(['invoices','dashboard','money-in','reports']);
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deletePaymentReceived(id){
  if(!confirm('Delete this payment?')) return;
  await apiFetch('/api/payments-received/'+id,{method:'DELETE'});
  renderPaymentsReceived();
  window.finflow?.refresh(['invoices','dashboard','money-in','reports']);
}

/* ══════════════════════════════════════════════════════════════════
   CREDIT NOTES
══════════════════════════════════════════════════════════════════ */
let _creditNotes = [];

async function loadCreditNotes(){
  try{ _creditNotes = await apiFetch('/api/credit-notes') || []; } catch(e){ _creditNotes=[]; }
  window.creditNotes = _creditNotes;
}

function renderCreditNotes(){
  loadCreditNotes().then(()=>{
    const l = document.getElementById('credit-notes-list'); if(!l) return;
    if(!_creditNotes.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No credit notes yet. Click + New Credit Note to add one.</div>'; return; }
    l.innerHTML = _creditNotes.map(c=>`
      <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 80px">
        <span style="font-weight:500">${_escHTML(c.customer||'')}</span>
        <span style="color:var(--t3)">${c.num||''}</span>
        <span style="font-family:var(--font-mono);color:var(--amber)">${fmtMoney(c.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(c.date)||c.date||''}</span>
        <span><span class="badge ${c.status==='Applied'?'b-green':'b-amber'}">${c.status||'Open'}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditCreditNoteModal(${c.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteCreditNote(${c.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openNewCreditNoteModal(){
  _st('cn-modal-title','New Credit Note');
  _sv('cn-id','');
  _sv('cn-customer','');
  _sv('cn-amount','');
  _sv('cn-date', new Date().toISOString().slice(0,10));
  _sv('cn-status','Open');
  _sv('cn-reason','');
  openModal('modal-credit-note');
}

function openEditCreditNoteModal(id){
  const c = _creditNotes.find(x=>x.id===id); if(!c) return;
  _st('cn-modal-title','Edit Credit Note');
  _sv('cn-id',id);
  _sv('cn-customer',c.customer||'');
  _sv('cn-amount',c.amount||'');
  _sv('cn-date',(c.date||'').slice(0,10)||new Date().toISOString().slice(0,10));
  _sv('cn-status',c.status||'Open');
  _sv('cn-reason',c.reason||'');
  openModal('modal-credit-note');
}

async function saveCreditNote(){
  const id = document.getElementById('cn-id').value;
  const existing = id ? _creditNotes.find(c=>c.id===+id) : null;
  const payload = {
    customer: document.getElementById('cn-customer').value.trim(),
    amount:   parseFloat(document.getElementById('cn-amount').value)||0,
    date:     document.getElementById('cn-date').value,
    status:   document.getElementById('cn-status').value,
    reason:   document.getElementById('cn-reason').value.trim(),
    num:      existing ? existing.num : nextNum('CN', _creditNotes),
  };
  if(!payload.customer){ alert('Customer is required'); return; }
  try{
    if(id){ await apiFetch('/api/credit-notes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/credit-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-credit-note');
    renderCreditNotes();
    window.finflow?.refresh(['invoices','dashboard','money-in','reports']);
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deleteCreditNote(id){
  if(!confirm('Delete this credit note?')) return;
  await apiFetch('/api/credit-notes/'+id,{method:'DELETE'});
  renderCreditNotes();
  window.finflow?.refresh(['invoices','dashboard','money-in','reports']);
}

/* ══════════════════════════════════════════════════════════════════
   PAYMENTS MADE
══════════════════════════════════════════════════════════════════ */
let _paymentsMade = [];

async function loadPaymentsMade(){
  try{ _paymentsMade = await apiFetch('/api/payments-made') || []; } catch(e){ _paymentsMade=[]; }
  window.paymentsMade = _paymentsMade;
}

function renderPaymentsMade(){
  loadPaymentsMade().then(()=>{
    const l = document.getElementById('payments-made-list'); if(!l) return;
    if(!_paymentsMade.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No payments recorded yet. Click + Make Payment to add one.</div>'; return; }
    l.innerHTML = _paymentsMade.map(p=>`
      <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 80px">
        <span style="font-weight:500">${_escHTML(p.vendor||'')}</span>
        <span style="color:var(--t3)">${p.ref||''}</span>
        <span style="font-family:var(--font-mono);color:var(--red)">${fmtMoney(p.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(p.date)||p.date||''}</span>
        <span><span class="badge b-blue">${p.method||''}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditPaymentMadeModal(${p.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deletePaymentMade(${p.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openMakePaymentModal(){
  _st('pm-modal-title','Make Payment');
  _sv('pm-id','');
  _sv('pm-vendor','');
  _sv('pm-amount','');
  _sv('pm-date', new Date().toISOString().slice(0,10));
  _sv('pm-method','Bank Transfer');
  _sv('pm-notes','');
  openModal('modal-payment-made');
}

function openEditPaymentMadeModal(id){
  const p = _paymentsMade.find(x=>x.id===id); if(!p) return;
  _st('pm-modal-title','Edit Payment');
  _sv('pm-id',id);
  _sv('pm-vendor',p.vendor||'');
  _sv('pm-amount',p.amount||'');
  _sv('pm-date',(p.date||'').slice(0,10)||new Date().toISOString().slice(0,10));
  _sv('pm-method',p.method||'Bank Transfer');
  _sv('pm-notes',p.notes||'');
  openModal('modal-payment-made');
}

async function savePaymentMade(){
  const id = document.getElementById('pm-id').value;
  const existing = id ? _paymentsMade.find(p=>p.id===+id) : null;
  const payload = {
    vendor: document.getElementById('pm-vendor').value.trim(),
    amount: parseFloat(document.getElementById('pm-amount').value)||0,
    date:   document.getElementById('pm-date').value,
    method: document.getElementById('pm-method').value,
    notes:  document.getElementById('pm-notes').value.trim(),
    ref:    existing ? existing.ref : nextNum('PM', _paymentsMade, 'ref'),
  };
  if(!payload.vendor){ alert('Vendor is required'); return; }
  try{
    if(id){ await apiFetch('/api/payments-made/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/payments-made',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-payment-made');
    renderPaymentsMade();
    window.finflow?.refresh(['expenses','dashboard','money-out','budget','reports']);
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deletePaymentMade(id){
  if(!confirm('Delete this payment?')) return;
  await apiFetch('/api/payments-made/'+id,{method:'DELETE'});
  renderPaymentsMade();
  window.finflow?.refresh(['expenses','dashboard','money-out','budget','reports']);
}

/* ══════════════════════════════════════════════════════════════════
   VENDOR CREDITS
══════════════════════════════════════════════════════════════════ */
let _vendorCredits = [];

async function loadVendorCredits(){
  try{ _vendorCredits = await apiFetch('/api/vendor-credits') || []; } catch(e){ _vendorCredits=[]; }
  window.vendorCredits = _vendorCredits;
}

function renderVendorCredits(){
  loadVendorCredits().then(()=>{
    const l = document.getElementById('vendor-credits-list'); if(!l) return;
    if(!_vendorCredits.length){ l.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">No vendor credits yet. Click + New Credit to add one.</div>'; return; }
    l.innerHTML = _vendorCredits.map(c=>`
      <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 80px">
        <span style="font-weight:500">${_escHTML(c.vendor||'')}</span>
        <span style="color:var(--t3)">${c.num||''}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">${fmtMoney(c.amount)}</span>
        <span style="color:var(--t2)">${fmtDate(c.date)||c.date||''}</span>
        <span><span class="badge ${c.status==='Applied'?'b-blue':'b-green'}">${c.status||'Open'}</span></span>
        <span style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="openEditVendorCreditModal(${c.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteVendorCredit(${c.id})">Del</button>
        </span>
      </div>`).join('');
  });
}

function openNewVendorCreditModal(){
  _st('vc-modal-title','New Vendor Credit');
  _sv('vc-id','');
  _sv('vc-vendor','');
  _sv('vc-amount','');
  _sv('vc-date', new Date().toISOString().slice(0,10));
  _sv('vc-status','Open');
  _sv('vc-reason','');
  openModal('modal-vendor-credit');
}

function openEditVendorCreditModal(id){
  const c = _vendorCredits.find(x=>x.id===id); if(!c) return;
  _st('vc-modal-title','Edit Vendor Credit');
  _sv('vc-id',id);
  _sv('vc-vendor',c.vendor||'');
  _sv('vc-amount',c.amount||'');
  _sv('vc-date',(c.date||'').slice(0,10)||new Date().toISOString().slice(0,10));
  _sv('vc-status',c.status||'Open');
  _sv('vc-reason',c.reason||'');
  openModal('modal-vendor-credit');
}

async function saveVendorCredit(){
  const id = document.getElementById('vc-id').value;
  const existing = id ? _vendorCredits.find(c=>c.id===+id) : null;
  const payload = {
    vendor:  document.getElementById('vc-vendor').value.trim(),
    amount:  parseFloat(document.getElementById('vc-amount').value)||0,
    date:    document.getElementById('vc-date').value,
    status:  document.getElementById('vc-status').value,
    reason:  document.getElementById('vc-reason').value.trim(),
    num:     existing ? existing.num : nextNum('VC', _vendorCredits),
  };
  if(!payload.vendor){ alert('Vendor is required'); return; }
  try{
    if(id){ await apiFetch('/api/vendor-credits/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    else   { await apiFetch('/api/vendor-credits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
    closeModal('modal-vendor-credit');
    renderVendorCredits();
    window.finflow?.refresh(['expenses','dashboard','money-out','budget','reports']);
  } catch(e){ alert('Save failed: '+e.message); }
}

async function deleteVendorCredit(id){
  if(!confirm('Delete this vendor credit?')) return;
  await apiFetch('/api/vendor-credits/'+id,{method:'DELETE'});
  renderVendorCredits();
  window.finflow?.refresh(['expenses','dashboard','money-out','budget','reports']);
}

/* ══════════════════════════════════════════════════════════════════
   AI CHAT
══════════════════════════════════════════════════════════════════ */
let _aiHistory = [];

function renderAIPage(){
  const container = document.getElementById('ai-chat-messages');
  if(!container) return;
  if(!_aiHistory.length){
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
      <div style="font-size:32px;margin-bottom:12px">✦</div>
      <div style="font-size:14px;font-weight:600;color:var(--t2);margin-bottom:8px">FinFlow AI</div>
      <div style="font-size:13px">Ask me anything about your business — revenue, expenses, cash flow, forecasting, or financial strategy.</div>
    </div>`;
    return;
  }
  container.innerHTML = _aiHistory.map(m=>`
    <div style="display:flex;flex-direction:${m.role==='user'?'row-reverse':'row'};gap:10px;margin-bottom:16px;align-items:flex-start">
      <div style="width:30px;height:30px;border-radius:50%;background:${m.role==='user'?'var(--accent)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${m.role==='user'?'#fff':'var(--t1)'};flex-shrink:0">${m.role==='user'?'U':'✦'}</div>
      <div style="max-width:75%;background:${m.role==='user'?'var(--accent)':'var(--bg2)'};color:${m.role==='user'?'#fff':'var(--t1)'};border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.5;white-space:pre-wrap">${escHTML(m.content)}</div>
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
    typing.innerHTML = `<div style="width:30px;height:30px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:12px">✦</div><div style="background:var(--bg2);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--t3)">Thinking…</div>`;
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
    _aiHistory.push({ role: 'assistant', content: 'Error: ' + (e.message || 'Could not reach AI. Make sure ANTHROPIC_API_KEY is set in .env') });
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

  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `API error ${res.status}`); }
    return res.json();
  }

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const uid4 = () => String(Date.now()).slice(-4);

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
    const dt = new Date(d);
    if (isNaN(dt)) return false;
    const now = new Date();
    return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
  }

  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    if (!window._ffAuthed) { window.addEventListener('ff:authed', _run, {once:true}); return; }

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
      const cls = { pending: 'b-amber', accepted: 'b-green', declined: 'b-red' };
      el.innerHTML = _quotesData.length
        ? _quotesData.map(q => `
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(q.client)}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(q.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(q.amount)}</span>
            <span style="color:var(--t2)">${esc(q.expiry_date || '—')}</span>
            <span><span class="badge ${cls[q.status] || 'b-amber'}">${esc(q.status)}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteQuote(${q.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No quotes yet — click + New Quote to create one</div>';
      const accepted = _quotesData.filter(q => q.status?.toLowerCase() === 'accepted').length;
      const pending  = _quotesData.filter(q => q.status?.toLowerCase() === 'pending').length;
      const openVal  = _quotesData.filter(q => q.status?.toLowerCase() === 'pending').reduce((s, q) => s + (q.amount || 0), 0);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('qt-total', _quotesData.length);
      set('qt-accepted', accepted);
      set('qt-pending', pending);
      set('qt-value', S(openVal));
    };

    window.openNewQuoteModal = function () {
      ['quote-client','quote-amount','quote-expiry','quote-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const s = document.getElementById('quote-status'); if (s) s.value = 'pending';
      openModal('quote-modal');
    };

    window.saveQuote = async function () {
      const client = document.getElementById('quote-client')?.value?.trim();
      const amount = parseFloat(document.getElementById('quote-amount')?.value);
      if (!client) { notify('Client name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const expiry_date = document.getElementById('quote-expiry')?.value || null;
      const status = document.getElementById('quote-status')?.value || 'pending';
      const notes  = document.getElementById('quote-notes')?.value?.trim() || '';
      try {
        const saved = await api('POST', '/api/quotes', { client, amount, expiry_date, status, notes });
        _quotesData.unshift(saved.row || saved);
        window.quotes = _quotesData;
        closeModal('quote-modal');
        renderQuotes();
        notify(`Quote for ${esc(client)} saved ✦`);
        loadQuotes().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteQuote = async function (id) {
      const q = _quotesData.find(r => r.id === id);
      if (!q || !confirm(`Delete quote for ${q.client}? This cannot be undone.`)) return;
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
    loadReceipts();

    window.renderReceipts = function () {
      if (!_receiptsFetched) { loadReceipts(); return; }
      const el = document.getElementById('receipts-list');
      if (!el) return;
      el.innerHTML = _receiptsData.length
        ? _receiptsData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.customer || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span style="color:var(--t2)">${esc(r.method || '')}</span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteReceipt(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No receipts yet</div>';
      // KPI cards: count · cash sales · card/stripe sales · refunds
      const _rcCash = _receiptsData.filter(r => /cash/i.test(r.method || '')).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _rcCard = _receiptsData.filter(r => /card|stripe/i.test(r.method || '')).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _rcRefund = _receiptsData.filter(r => (parseFloat(r.amount) || 0) < 0).reduce((s, r) => s + Math.abs(parseFloat(r.amount) || 0), 0);
      setKpiCards('page-sales-receipts', [_receiptsData.length, S(_rcCash), S(_rcCard), S(_rcRefund)]);
      window._refreshDashboardUI?.();
    };

    window.openNewReceiptModal = function () {
      ['receipt-customer','receipt-amount','receipt-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('receipt-date'); if (d) d.value = todayStr();
      const m = document.getElementById('receipt-method'); if (m) m.value = 'Card';
      openModal('modal-receipt');
    };

    window.saveReceipt = async function () {
      const customer = document.getElementById('receipt-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('receipt-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('receipt-date')?.value   || todayStr();
      const method = document.getElementById('receipt-method')?.value || 'Card';
      const notes  = document.getElementById('receipt-notes')?.value?.trim() || '';
      const num    = 'SR-' + uid4();
      try {
        const saved = await api('POST', '/api/sales-receipts', { customer, num, amount, date, method, notes });
        _receiptsData.unshift(saved.row || saved);
        window.receipts = _receiptsData;
        closeModal('modal-receipt');
        renderReceipts();
        notify(`Receipt for ${esc(customer)} saved ✦`);
        loadReceipts().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteReceipt = async function (id) {
      if (!confirm('Delete this receipt? This cannot be undone.')) return;
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

    async function loadPaymentsReceived() {
      try {
        const rows = await api('GET', '/api/payments-received');
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
      el.innerHTML = _paymentsRecvData.length
        ? _paymentsRecvData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 110px 80px 80px 90px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.customer || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.invoice_ref || '—')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span style="color:var(--t2)">${esc(r.method || '')}</span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deletePaymentReceived(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No payments received yet</div>';
      // KPI cards: total received · outstanding · overdue · avg days to pay
      // Outstanding/overdue are derived from window._realInvoices (set by the
      // dashboard wiring). Avg-days-to-pay isn't derivable from the current
      // payment shape (no paid_at vs due_date), so it stays as the "—" placeholder.
      const _prTotal = _paymentsRecvData.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _prInvs = window._realInvoices || [];
      const _prOut = _prInvs.filter(i => i.status?.toLowerCase() !== 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const _prOver = _prInvs.filter(i => i.status?.toLowerCase() === 'overdue').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      setKpiCards('page-payments-received', [S(_prTotal), S(_prOut), S(_prOver), null]);
      window._refreshDashboardUI?.();
    };

    window.openRecordPaymentModal = function () {
      ['pr-customer','pr-invoice-ref','pr-amount','pr-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('pr-date'); if (d) d.value = todayStr();
      const m = document.getElementById('pr-method'); if (m) m.value = 'Bank Transfer';
      openModal('modal-payment-received');
    };

    window.savePaymentReceived = async function () {
      const customer = document.getElementById('pr-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('pr-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const invoice_ref = document.getElementById('pr-invoice-ref')?.value?.trim() || '';
      const date        = document.getElementById('pr-date')?.value   || todayStr();
      const method      = document.getElementById('pr-method')?.value || 'Bank Transfer';
      const notes       = document.getElementById('pr-notes')?.value?.trim() || '';
      try {
        const saved = await api('POST', '/api/payments-received', { customer, invoice_ref, amount, date, method, notes });
        _paymentsRecvData.unshift(saved.row || saved);
        window.paymentsReceived = _paymentsRecvData;
        closeModal('modal-payment-received');
        renderPaymentsReceived();
        notify(`Payment from ${esc(customer)} recorded ✦`);
        loadPaymentsReceived().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deletePaymentReceived = async function (id) {
      if (!confirm('Delete this payment record? This cannot be undone.')) return;
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
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(r.client)}</div>
              <div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(r.frequency)} · Next: ${esc(r.next_run || '—')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:var(--font-mono);font-weight:600">${S(r.amount)}</span>
              <span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status)}</span>
              <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteRecurringInvoice(${r.id})">✕</button>
            </div>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No recurring invoice profiles yet</div>';
      // KPI cards: active count · monthly value · next run · YTD generated
      // YTD comes from invoices that the recurring scheduler created (server
      // tags them with notes "Auto-generated from recurring schedule").
      const _riActive = _recurringInvData.filter(r => r.status?.toLowerCase() === 'active');
      const _riMonthly = _riActive.reduce((s, r) => s + monthlyEquiv(r.amount, r.frequency), 0);
      const _riNext = _riActive.map(r => r.next_run).filter(Boolean).sort()[0] || '—';
      const _riYtd = (window._realInvoices || [])
        .filter(i => (i.notes || '').includes('recurring schedule'))
        .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      setKpiCards('page-recurring-invoices', [_riActive.length, S(_riMonthly), _riNext, S(_riYtd)]);
      window._refreshDashboardUI?.();
    };

    window.openNewRecurringModal = function () {
      ['ri-client','ri-amount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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
      try {
        const saved = await api('POST', '/api/recurring-invoices', { client, amount, frequency, next_run, status });
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
      if (!confirm('Delete this recurring profile? This cannot be undone.')) return;
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
      const cls = { Open: 'b-amber', Applied: 'b-green', Void: 'b-red' };
      el.innerHTML = _creditNotesData.length
        ? _creditNotesData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.customer || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span><span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status || 'Open')}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteCreditNote(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No credit notes yet</div>';
      // KPI cards: count · open/unapplied sum · applied sum · this-month sum
      const _cnOpen = _creditNotesData.filter(r => r.status === 'Open').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _cnApplied = _creditNotesData.filter(r => r.status === 'Applied').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _cnMonthSum = _creditNotesData.filter(r => inThisMonth(r.date)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      setKpiCards('page-credit-notes', [_creditNotesData.length, S(_cnOpen), S(_cnApplied), S(_cnMonthSum)]);
      window._refreshDashboardUI?.();
    };

    window.openNewCreditNoteModal = function () {
      ['cn-customer','cn-amount','cn-reason'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('cn-date'); if (d) d.value = todayStr();
      const s = document.getElementById('cn-status'); if (s) s.value = 'Open';
      openModal('modal-credit-note');
    };

    window.saveCreditNote = async function () {
      const customer = document.getElementById('cn-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('cn-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('cn-date')?.value?.trim()   || todayStr();
      const status = document.getElementById('cn-status')?.value          || 'Open';
      const reason = document.getElementById('cn-reason')?.value?.trim()  || '';
      const num    = 'CN-' + uid4();
      try {
        const saved = await api('POST', '/api/credit-notes', { customer, num, amount, date, status, reason });
        _creditNotesData.unshift(saved.row || saved);
        window.creditNotes = _creditNotesData;
        closeModal('modal-credit-note');
        renderCreditNotes();
        notify(`Credit note for ${esc(customer)} saved ✦`);
        loadCreditNotes().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteCreditNote = async function (id) {
      if (!confirm('Delete this credit note? This cannot be undone.')) return;
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

    async function loadVendors() {
      try {
        const _eidV2 = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/vendors' + (_eidV2 ? '?entity_id=' + _eidV2 : ''));
        _vendorsFetched = true;
        _vendorsData = rows || [];
        window.vendors = _vendorsData;
        console.log('[Vendors] loaded', _vendorsData.length);
        renderVendors();
      } catch (e) { console.warn('[Vendors]', e.message); }
    }
    loadVendors();

    function renderVendorRows(list) {
      const el = document.getElementById('vendors-list');
      if (!el) return;
      el.innerHTML = list.length
        ? list.map(v => `
          <div class="table-row" style="grid-template-columns:1fr 100px 90px 90px 80px 50px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div style="font-weight:500">${esc(v.name)}</div>
              <div style="font-size:11px;color:var(--t3)">${esc(v.contact || '—')}</div>
            </div>
            <span><span class="badge b-blue" style="font-size:10px">${esc(v.category || 'Other')}</span></span>
            <span style="color:${v.owing > 0 ? 'var(--amber)' : 'var(--t2)'}">
              ${v.owing > 0 ? S(v.owing) + ' owing' : '—'}
            </span>
            <span style="color:var(--t2)">${S(v.ytd_paid || 0)} YTD</span>
            <span><span class="badge ${v.status === 'active' ? 'b-green' : 'b-red'}">${esc(v.status || 'active')}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteVendor(${v.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No vendors yet</div>';
    }

    window.renderVendors = function () {
      if (!_vendorsFetched) { loadVendors(); return; }
      renderVendorRows(_vendorsData);
      // KPI cards: count · total payables (unpaid bills) · overdue · paid (payments-made)
      const _vPayables = _billsData.filter(b => b.status?.toLowerCase() !== 'paid').reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      const _vPaid = _paymentsMadeData.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      setKpiCards('page-vendors', [_vendorsData.length, S(_vPayables), null, S(_vPaid)]);
      window._refreshDashboardUI?.();
    };

    window.filterVendorsBySearch = function (v) {
      const q = v.toLowerCase();
      renderVendorRows(q
        ? _vendorsData.filter(r => (r.name || '').toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || (r.contact || '').toLowerCase().includes(q))
        : _vendorsData);
    };

    window.openNewVendorModal = function () {
      ['vendor-name','vendor-contact','vendor-owing','vendor-ytd'].forEach(id => { const el = document.getElementById(id); if (el) el.value = id.includes('owing') || id.includes('ytd') ? '0' : ''; });
      const c = document.getElementById('vendor-category'); if (c) c.value = 'Software';
      openModal('vendor-modal');
    };

    window.saveVendor = async function () {
      const name = document.getElementById('vendor-name')?.value?.trim();
      if (!name) { notify('Vendor name required', true); return; }
      const contact  = document.getElementById('vendor-contact')?.value?.trim()  || '';
      const category = document.getElementById('vendor-category')?.value          || 'Other';
      const owing    = parseFloat(document.getElementById('vendor-owing')?.value) || 0;
      const ytd_paid = parseFloat(document.getElementById('vendor-ytd')?.value)   || 0;
      try {
        const _eidVNew = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        const saved = await api('POST', '/api/vendors', { name, contact, category, owing, ytd_paid, status: 'active', entity_id: _eidVNew });
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
      if (!v || !confirm(`Delete vendor ${v.name}? This cannot be undone.`)) return;
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
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 90px 80px 80px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(b.vendor)}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(b.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(b.amount)}</span>
            <span style="color:${b.status?.toLowerCase() === 'overdue' ? 'var(--red)' : 'var(--t2)'}">${esc(b.due_date || '—')}</span>
            <span><span class="badge ${cls[b.status?.toLowerCase()] || 'b-amber'}">${esc(b.status)}</span></span>
            <div style="display:flex;gap:4px">
              ${b.status?.toLowerCase() !== 'paid' ? `<button class="btn btn-ghost btn-sm" onclick="markBillPaid(${b.id})">Pay</button>` : ''}
              <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteBill(${b.id})">✕</button>
            </div>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No bills yet</div>';

      // badge
      const overdue = _billsData.filter(b => b.status?.toLowerCase() === 'overdue' || b.status?.toLowerCase() === 'due_soon').length;
      const badge = document.getElementById('badge-bills');
      if (badge) { badge.textContent = overdue; badge.style.display = overdue > 0 ? '' : 'none'; }
      // KPI cards: count · due-this-week sum · overdue sum · paid sum
      const _blOverdue = _billsData.filter(b => b.status?.toLowerCase() === 'overdue').reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      const _blPaid = _billsData.filter(b => b.status?.toLowerCase() === 'paid').reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      const _blToday = new Date(); _blToday.setHours(0, 0, 0, 0);
      const _weekAhead = new Date(); _weekAhead.setDate(_weekAhead.getDate() + 7);
      const _blDueWeek = _billsData.filter(b => {
        if (b.status?.toLowerCase() === 'paid' || !b.due_date) return false;
        const d = new Date(b.due_date); return !isNaN(d) && d >= _blToday && d <= _weekAhead;
      }).reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      setKpiCards('page-bills', [_billsData.length, S(_blDueWeek), S(_blOverdue), S(_blPaid)]);
      window._refreshDashboardUI?.();
    };

    window.openNewBillModal = function () {
      ['bill-vendor','bill-amount','bill-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('bill-due'); if (d) d.value = '';
      const s = document.getElementById('bill-status'); if (s) s.value = 'unpaid';
      openModal('bill-modal');
    };

    window.saveBill = async function () {
      const vendor = document.getElementById('bill-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('bill-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const due_date = document.getElementById('bill-due')?.value    || null;
      const status   = document.getElementById('bill-status')?.value || 'unpaid';
      const notes    = document.getElementById('bill-notes')?.value?.trim() || '';
      try {
        const _eidBNew = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        const saved = await api('POST', '/api/bills', { vendor, amount, due_date, status, notes, entity_id: _eidBNew });
        _billsData.unshift(saved.row || saved);
        window.bills = _billsData;
        closeModal('bill-modal');
        renderBills();
        notify(`Bill from ${esc(vendor)} saved ✦`);
        loadBills().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.markBillPaid = async function (id) {
      try {
        await api('PUT', `/api/bills/${id}`, { status: 'paid' });
        const b = _billsData.find(r => r.id === id);
        if (b) b.status = 'paid';
        renderBills();
        notify('Bill marked as paid ✦');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not update — ' + e.message, true); }
    };

    window.deleteBill = async function (id) {
      if (!confirm('Delete this bill? This cannot be undone.')) return;
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
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 90px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.vendor || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.ref || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span style="color:var(--t2)">${esc(r.method || '')}</span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deletePaymentMade(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No payments made yet</div>';
      // KPI cards: total paid · unique vendor count · largest single · avg
      const _pmTotal = _paymentsMadeData.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _pmVendors = new Set(_paymentsMadeData.map(r => r.vendor)).size;
      const _pmAmts = _paymentsMadeData.map(r => parseFloat(r.amount) || 0);
      const _pmLargest = _pmAmts.length ? Math.max(..._pmAmts) : 0;
      const _pmAvg = _pmAmts.length ? _pmTotal / _pmAmts.length : 0;
      setKpiCards('page-payments-made', [S(_pmTotal), _pmVendors, S(_pmLargest), S(_pmAvg)]);
      window._refreshDashboardUI?.();
    };

    window.openMakePaymentModal = function () {
      ['pm-vendor','pm-amount','pm-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('pm-date'); if (d) d.value = todayStr();
      const m = document.getElementById('pm-method'); if (m) m.value = 'Bank Transfer';
      openModal('modal-payment-made');
    };

    window.savePaymentMade = async function () {
      const vendor = document.getElementById('pm-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('pm-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('pm-date')?.value   || todayStr();
      const method = document.getElementById('pm-method')?.value || 'Bank Transfer';
      const notes  = document.getElementById('pm-notes')?.value?.trim() || '';
      const ref    = 'PM-' + uid4();
      try {
        const saved = await api('POST', '/api/payments-made', { vendor, ref, amount, date, method, notes });
        _paymentsMadeData.unshift(saved.row || saved);
        window.paymentsMade = _paymentsMadeData;
        closeModal('modal-payment-made');
        renderPaymentsMade();
        notify(`Payment to ${esc(vendor)} recorded ✦`);
        loadPaymentsMade().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deletePaymentMade = async function (id) {
      if (!confirm('Delete this payment record? This cannot be undone.')) return;
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
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(r.vendor)}</div>
              <div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(r.frequency)} · Next: ${esc(r.next_run || '—')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:var(--font-mono);font-weight:600">${S(r.amount)}</span>
              <span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status)}</span>
              <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteRecurringBill(${r.id})">✕</button>
            </div>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No recurring bill profiles yet</div>';
      // KPI cards: active count · monthly cost · next due · YTD total
      // YTD is approximated as monthly × elapsed months (Jan = 1 … current
      // month). No global "_realBills" array exists, so we can't filter
      // server-tagged bills the way recurring-invoices does.
      const _rbActive = _recurringBillsData.filter(r => r.status?.toLowerCase() === 'active');
      const _rbMonthly = _rbActive.reduce((s, r) => s + monthlyEquiv(r.amount, r.frequency), 0);
      const _rbNext = _rbActive.map(r => r.next_run).filter(Boolean).sort()[0] || '—';
      const _rbYtd = _rbMonthly * (new Date().getMonth() + 1);
      setKpiCards('page-recurring-bills', [_rbActive.length, S(_rbMonthly), _rbNext, S(_rbYtd)]);
      window._refreshDashboardUI?.();
    };

    window.openNewRecurringBillModal = function () {
      ['rb-vendor','rb-amount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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
      if (!confirm('Delete this recurring profile? This cannot be undone.')) return;
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
      const cls = { Open: 'b-green', Applied: 'b-amber' };
      el.innerHTML = _vendorCreditsData.length
        ? _vendorCreditsData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.vendor || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span><span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status || 'Open')}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteVendorCredit(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No vendor credits yet</div>';
      // KPI cards: count · open sum · applied sum · this-month sum
      const _vcOpen = _vendorCreditsData.filter(r => r.status === 'Open').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _vcApplied = _vendorCreditsData.filter(r => r.status === 'Applied').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _vcMonthSum = _vendorCreditsData.filter(r => inThisMonth(r.date)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      setKpiCards('page-vendor-credits', [_vendorCreditsData.length, S(_vcOpen), S(_vcApplied), S(_vcMonthSum)]);
      window._refreshDashboardUI?.();
    };

    window.openNewVendorCreditModal = function () {
      ['vc-vendor','vc-amount','vc-reason'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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
      const num    = 'VC-' + uid4();
      try {
        const saved = await api('POST', '/api/vendor-credits', { vendor, num, amount, date, status, reason });
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
      if (!confirm('Delete this vendor credit? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/vendor-credits/${id}`);
        _vendorCreditsData = _vendorCreditsData.filter(r => r.id !== id);
        renderVendorCredits();
        notify('Vendor credit deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };

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

  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `API error ${res.status}`); }
    return res.json();
  }

  function e(s) {
    return typeof window.esc === 'function'
      ? window.esc(s)
      : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) { return typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toFixed(2); }
  function tip(msg, isErr) { if (typeof notify === 'function') notify(msg, isErr); else console.warn(msg); }
  const today = () => new Date().toISOString().slice(0, 10);

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
          <button class="modal-close" onclick="document.getElementById('inv-view-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div id="ivm-body" style="margin-top:4px"></div>
      </div>`;
      document.body.appendChild(modal);
    }

    document.getElementById('ivm-sub').textContent = 'Paid invoice — ' + (inv.client || '');
    document.getElementById('ivm-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px">
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Client</div>
          <div style="font-size:14px;font-weight:600;color:var(--t1);margin-top:4px">${e(inv.client)}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Amount</div>
          <div style="font-size:14px;font-weight:600;color:var(--acc);margin-top:4px;font-family:var(--font-mono)">${money(inv.amount)}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Due Date</div>
          <div style="font-size:13px;color:var(--t2);margin-top:4px">${e(inv.due || '—')}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:var(--t3);letter-spacing:.08em">Status</div>
          <div style="margin-top:4px"><span class="badge b-green">${e(inv.status)}</span></div>
        </div>
      </div>
      ${inv.notes ? `<div style="margin-top:16px;padding:10px;background:var(--bg2);border-radius:var(--radius);font-size:12px;color:var(--t2);line-height:1.5">${e(inv.notes)}</div>` : ''}
    `;
    modal.classList.remove('hidden');
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
      el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--t3)">No time entries yet — click + Log Time to add one</div>';
      return;
    }
    el.innerHTML = _tsData.map(t => `
      <div style="display:grid;grid-template-columns:1fr 100px 80px 70px 70px 70px 36px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
        <span style="font-weight:500">${e(t.employee)}</span>
        <span style="color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(t.project || '—')}</span>
        <span style="color:var(--t2)">${e(t.date || '—')}</span>
        <span style="font-family:var(--font-mono)">${(t.hours || 0)}h</span>
        <span><span class="badge ${_isBillable(t) ? 'b-green' : 'b-amber'}">${_isBillable(t) ? 'Yes' : 'No'}</span></span>
        <span style="font-family:var(--font-mono);color:var(--t2)">${t.rate ? '$' + t.rate + '/h' : '—'}</span>
        <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7;padding:0 4px" onclick="deleteTimesheetEntry(${t.id})">✕</button>
      </div>`).join('');
  }

  function updateTimesheetMetrics() {
    const total    = _tsData.reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);
    const billable = _tsData.filter(_isBillable).reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);
    const nb       = total - billable;
    const rate     = total > 0 ? Math.round(billable / total * 100) : 0;
    const days     = new Set(_tsData.map(t => t.date)).size;
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
        <button class="modal-close" onclick="document.getElementById('ts-log-modal').classList.add('hidden')">
          <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
        </button>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label" for="ts-employee">Employee *</label><input class="finput" id="ts-employee" placeholder="Name or team member"></div>
        <div class="field-wrap"><label class="field-label" for="ts-project">Project / Client</label><input class="finput" id="ts-project" placeholder="Project or client name"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label" for="ts-date">Date</label><input class="finput" id="ts-date" type="date"></div>
        <div class="field-wrap"><label class="field-label" for="ts-hours">Hours *</label><input class="finput" id="ts-hours" type="number" min="0.25" step="0.25" placeholder="e.g. 2.5"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label" for="ts-billable">Billable?</label><select class="finput" id="ts-billable"><option value="Yes">Yes — billable</option><option value="No">No — internal</option></select></div>
        <div class="field-wrap"><label class="field-label" for="ts-rate">Rate ($/hr)</label><input class="finput" id="ts-rate" type="number" min="0" placeholder="0"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('ts-log-modal').classList.add('hidden')">Cancel</button>
        <button class="btn btn-primary" onclick="saveTimesheetEntry()">Save entry →</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  window.openLogTimeModal = function () {
    const modal = buildTimesheetModal();
    document.getElementById('ts-employee').value = '';
    document.getElementById('ts-project').value  = '';
    document.getElementById('ts-date').value     = today();
    document.getElementById('ts-hours').value    = '';
    document.getElementById('ts-rate').value     = '';
    document.getElementById('ts-billable').value = 'Yes';
    modal.classList.remove('hidden');
  };

  window.saveTimesheetEntry = async function () {
    const employee = document.getElementById('ts-employee')?.value?.trim();
    const hours    = parseFloat(document.getElementById('ts-hours')?.value);
    if (!employee) { tip('Employee name required', true); return; }
    if (!hours || hours <= 0) { tip('Valid hours required', true); return; }
    const project  = document.getElementById('ts-project')?.value?.trim()  || '';
    const date     = document.getElementById('ts-date')?.value             || today();
    const billable = document.getElementById('ts-billable')?.value         || 'Yes';
    const rate     = parseFloat(document.getElementById('ts-rate')?.value) || 0;
    try {
      const saved = await api('POST', '/api/timesheet', { employee, project, date, hours, billable, rate });
      _tsData.unshift(saved.row || saved);
      window.timesheet = _tsData;
      document.getElementById('ts-log-modal')?.classList.add('hidden');
      renderTimesheetList();
      updateTimesheetMetrics();
      tip('Time entry saved ✦');
      loadTimesheet().catch(()=>{});
      window._refreshDashboardUI?.();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not save — ' + err.message, true); }
  };

  window.deleteTimesheetEntry = async function (id) {
    if (!confirm('Delete this time entry?')) return;
    try {
      await api('DELETE', `/api/timesheet/${id}`);
      _tsData = _tsData.filter(t => t.id !== id);
      renderTimesheetList();
      updateTimesheetMetrics();
      tip('Entry deleted');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not delete — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 3. REPORTS — enrich top metrics with live data
  // ══════════════════════════════════════════════════════
  const _origRenderReports = typeof renderReports === 'function' ? renderReports : null;
  window.renderReports = async function () {
    if (_origRenderReports) _origRenderReports();   // static lists render immediately
    try {
      const [invoices, expenses] = await Promise.all([
        api('GET', '/api/invoices'),
        api('GET', '/api/expenses'),
      ]);
      const revenue  = invoices.filter(i => i.status?.toLowerCase() === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
      const expTotal = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
      const profit   = revenue - expTotal;

      const mcs  = document.querySelectorAll('#page-reports .mc-val');
      const chgs = document.querySelectorAll('#page-reports .mc-change');
      if (mcs[0])  mcs[0].textContent  = invoices.length + expenses.length;
      if (chgs[0]) chgs[0].textContent  = 'Invoices & expenses on file';
      if (mcs[1])  mcs[1].textContent  = money(revenue);
      if (chgs[1]) { chgs[1].textContent = 'Paid revenue this period'; chgs[1].className = 'mc-change up'; }
      if (mcs[2])  mcs[2].textContent  = money(profit);
      if (chgs[2]) { chgs[2].textContent = profit >= 0 ? 'Net profit' : 'Net loss'; chgs[2].className = 'mc-change ' + (profit >= 0 ? 'up' : 'dn'); }
    } catch (err) { /* static content still visible */ }
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
      const rows = await api('GET', '/api/holdings');
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
        if (typeof renderInvestments === 'function') renderInvestments();
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
          <div class="team-avatar" style="background:${col}22;color:${col};border:1px solid ${col}44">${e(initials)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(m.name)}</div>
            <div style="font-size:11px;color:var(--t3)">${e(m.email || '')}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
            <span class="role-badge ${roleCls}">${e(roleLabel)}</span>
            <span style="font-size:10px;color:var(--t3)">${e(m.lastSeen || 'Active')}</span>
          </div>
        </div>`;
      }).join('');

      const mcs = document.querySelectorAll('#page-team .mc-val');
      if (mcs[0]) mcs[0].textContent = members.length;
    } catch (err) { console.warn('[Team]', err.message); }
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
    // KPI cards: Active Projects · Billable Hours · Revenue · Unbilled
    const _pjKpi = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    _pjKpi('proj-active', _projects.filter(p => p.status === 'In Progress').length);
    const _tsAll = window.timesheetData || window.timesheet || [];
    const _billFn = window._isBillable || (t => t.billable === true || t.billable === 1 || String(t.billable || '').toLowerCase() === 'yes');
    const _billHrs = _tsAll.filter(_billFn).reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);
    _pjKpi('proj-hours', _billHrs.toFixed(1) + ' hrs');
    _pjKpi('proj-revenue', money(_projects.reduce((s, p) => s + (parseFloat(p.billed) || 0), 0)));
    _pjKpi('proj-unbilled', money(_projects.reduce((s, p) => s + Math.max(0, (parseFloat(p.budget) || 0) - (parseFloat(p.billed) || 0)), 0)));
    window._refreshDashboardUI?.();
    if (!_projects.length) {
      l.innerHTML = '<div style="padding:16px 0;color:var(--t3);font-size:13px">No projects yet. Click + New Project to add one.</div>';
      return;
    }
    const colorMap = { 'In Progress': 'b-blue', 'Completed': 'b-green', 'On Hold': 'b-amber' };
    l.innerHTML = _projects.map(p => {
      const billed = p.billed || 0;
      const budget = p.budget || 0;
      const pct    = budget > 0 ? Math.min(100, Math.round((billed / budget) * 100)) : 0;
      return `<div style="padding:10px 0;border-bottom:1px solid var(--bd)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--t1)">${e(p.name)}</div>
            <div style="font-size:11px;color:var(--t3)">${e(p.client || '—')} · ${e(p.hours || 0)}h logged</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="text-align:right">
              <div style="font-size:11px;color:var(--t3)">Billed / Budget</div>
              <div style="font-size:12px;font-weight:600;font-family:var(--font-mono)">$${billed.toLocaleString()} / $${budget.toLocaleString()}</div>
            </div>
            <span class="badge ${colorMap[p.status] || 'b-blue'}">${e(p.status)}</span>
            <button class="btn btn-ghost btn-sm" onclick="deleteProject(${p.id})" style="color:var(--red);padding:2px 6px" title="Delete">✕</button>
          </div>
        </div>
        <div class="bar-track" style="height:4px"><div class="bar-fill" style="width:${pct}%;background:${p.status === 'Completed' ? 'var(--green)' : 'var(--acc)'}"></div></div>
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
          <button class="modal-close" onclick="document.getElementById('proj-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <div><label class="flabel" for="proj-name">Project Name *</label><input id="proj-name" class="finput" placeholder="e.g. RetailCo Portal v2"></div>
          <div><label class="flabel" for="proj-client">Client</label><input id="proj-client" class="finput" placeholder="Client name"></div>
          <div><label class="flabel" for="proj-budget">Budget ($)</label><input id="proj-budget" class="finput" type="number" min="0" placeholder="0"></div>
          <div><label class="flabel" for="proj-status">Status</label>
            <select id="proj-status" class="finput">
              <option value="In Progress">In Progress</option>
              <option value="On Hold">On Hold</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        </div>
        <div class="modal-footer" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('proj-modal').classList.add('hidden')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveProject()">Save Project</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    ['proj-name', 'proj-client', 'proj-budget'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('proj-status').value = 'In Progress';
    modal.classList.remove('hidden');
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
    if (!confirm('Delete this project?')) return;
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
  window.generateReport = async function (name) {
    let modal = document.getElementById('report-gen-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'report-gen-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `<div class="modal" style="max-width:480px">
        <div class="modal-header">
          <div>
            <div class="modal-title" id="rpt-title"></div>
            <div class="modal-sub" id="rpt-sub"></div>
          </div>
          <button class="modal-close" onclick="document.getElementById('report-gen-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div id="rpt-body" style="margin-top:12px;font-size:13px;color:var(--t2)">Loading…</div>
        <div class="modal-footer" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('report-gen-modal').classList.add('hidden')">Close</button>
          <button class="btn btn-primary btn-sm" onclick="window.print()">Print ↗</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    document.getElementById('rpt-title').textContent = name;
    document.getElementById('rpt-sub').textContent = 'Generated ' + new Date().toLocaleDateString();
    document.getElementById('rpt-body').innerHTML = '<div style="color:var(--t3)">Loading data…</div>';
    modal.classList.remove('hidden');

    try {
      const [invoices, expenses] = await Promise.all([api('GET', '/api/invoices'), api('GET', '/api/expenses')]);
      const paid      = invoices.filter(i => i.status?.toLowerCase() === 'paid');
      const revenue   = paid.reduce((s, i) => s + (i.amount || 0), 0);
      const expTotal  = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
      const profit    = revenue - expTotal;
      const outstanding = invoices.filter(i => i.status?.toLowerCase() !== 'paid').reduce((s, i) => s + (i.amount || 0), 0);
      const catTotals = {};
      expenses.forEach(ex => { catTotals[ex.category] = (catTotals[ex.category] || 0) + (ex.amount || 0); });
      const catRows = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `<tr><td style="padding:3px 0;color:var(--t2)">${e(cat)}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--t1)">${money(amt)}</td></tr>`).join('');

      document.getElementById('rpt-body').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Revenue</div>
            <div style="font-size:16px;font-weight:600;color:var(--green)">${money(revenue)}</div>
            <div style="font-size:10px;color:var(--t3)">${paid.length} paid invoice${paid.length !== 1 ? 's' : ''}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Expenses</div>
            <div style="font-size:16px;font-weight:600;color:var(--red)">${money(expTotal)}</div>
            <div style="font-size:10px;color:var(--t3)">${expenses.length} expense${expenses.length !== 1 ? 's' : ''}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Net Profit</div>
            <div style="font-size:16px;font-weight:600;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${money(profit)}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Outstanding</div>
            <div style="font-size:16px;font-weight:600;color:var(--amber)">${money(outstanding)}</div>
          </div>
        </div>
        ${catRows ? `<div style="font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Expense Breakdown</div>
        <table style="width:100%;border-collapse:collapse">${catRows}</table>` : ''}`;
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
    try {
      await api('POST', '/api/holdings', {
        ticker, name, asset_type: type, shares, cost_per: cost, price, dividend: div,
      });
      if (typeof closeModal === 'function') closeModal('holding-modal');
      tip(`${e(ticker)} added to portfolio`);
      await loadHoldingsFromDB();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not save holding — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 11. TEAM INVITE — modal + POST /api/team
  // ══════════════════════════════════════════════════════
  window.openInviteModal = function () {
    let modal = document.getElementById('invite-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'invite-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `<div class="modal" style="max-width:360px">
        <div class="modal-header">
          <div class="modal-title">Invite Team Member</div>
          <button class="modal-close" onclick="document.getElementById('invite-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <div><label class="flabel" for="inv-name">Name *</label><input id="inv-name" class="finput" placeholder="Full name"></div>
          <div><label class="flabel" for="inv-email">Email *</label><input id="inv-email" class="finput" type="email" placeholder="email@company.com"></div>
          <div><label class="flabel" for="inv-role">Role</label>
            <select id="inv-role" class="finput">
              <option value="admin">Admin</option>
              <option value="accountant">Accountant</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        </div>
        <div class="modal-footer" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('invite-modal').classList.add('hidden')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="sendInvite()">Send Invite</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    ['inv-name', 'inv-email'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const roleEl = document.getElementById('inv-role');
    if (roleEl) roleEl.value = 'accountant';
    modal.classList.remove('hidden');
  };

  window.sendInvite = async function () {
    const name  = (document.getElementById('inv-name')?.value || '').trim();
    const email = (document.getElementById('inv-email')?.value || '').trim();
    const role  = document.getElementById('inv-role')?.value || 'viewer';
    if (!name || !email) { tip('Name and email are required', true); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { tip('Invalid email address', true); return; }
    try {
      await api('POST', '/api/team', { name, email, role });
      document.getElementById('invite-modal').classList.add('hidden');
      tip(`Invite sent to ${e(email)}`);
      if (typeof window.renderTeam === 'function') window.renderTeam();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not invite — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 12. PERSONAL FINANCE — wire spending, net worth, transactions
  //     Fetches: /api/holdings → net worth from portfolio value
  //              /api/personal-transactions → spending array + recent txns
  // ══════════════════════════════════════════════════════
  window.loadPersonalFinance = async function () {
    try {
      const [holdRows, txRows] = await Promise.all([
        api('GET', '/api/holdings').catch(() => []),
        api('GET', '/api/personal-transactions').catch(() => []),
      ]);

      // Net worth from total portfolio market value
      const portfolioValue = (holdRows || []).reduce((s, h) => {
        const price = parseFloat(h.price) || parseFloat(h.cost_per) || 0;
        return s + price * (parseFloat(h.shares) || 0);
      }, 0);
      if (typeof window.baseNetWorth !== 'undefined') {
        window.baseNetWorth = Math.round(portfolioValue);
      }

      // Personal transactions → populate persTransactions (keep salary entries)
      // DB stores tx_type (not type) and tx_date (not date)
      const dbTxns = (txRows || []).map(r => ({
        id:      r.id,
        desc:    r.description || r.desc || '',
        cat:     r.category || r.cat || 'Other',
        amount:  Math.abs(parseFloat(r.amount) || 0),
        type:    r.tx_type || r.type || (parseFloat(r.amount) < 0 ? 'expense' : 'income'),
        rawDate: r.tx_date || r.date || '',
        date:    (r.tx_date || r.date) ? new Date(r.tx_date || r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
      }));

      // Merge: keep payroll salary entries (added by syncAllPayrollsToPersonal),
      // replace everything else with DB rows
      if (typeof window.persTransactions !== 'undefined') {
        const salaryEntries = (window.persTransactions || []).filter(t => t.cat === 'Income' && t.desc.startsWith('Salary —'));
        window.persTransactions = [...salaryEntries, ...dbTxns.filter(t => !(t.cat === 'Income' && t.desc.startsWith('Salary —')))];
      }

      // Spending categories — filter to current month for pers-spend KPI
      const _now = new Date();
      const _thisMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
      const expTxns = dbTxns.filter(t => t.type === 'expense' || t.type === 'debit');
      const monthExpTxns = expTxns.filter(t => t.rawDate.startsWith(_thisMonth));
      const _allExpOrMonth = monthExpTxns.length ? monthExpTxns : expTxns;
      if (_allExpOrMonth.length && typeof window.spending !== 'undefined') {
        const catMap = {};
        _allExpOrMonth.forEach(t => { catMap[t.cat] = (catMap[t.cat] || 0) + t.amount; });
        const SPEND_COLORS = ['var(--red)', 'var(--amber)', 'var(--purple)', 'var(--teal)', 'var(--green)', 'var(--acc)'];
        const newSpending = Object.entries(catMap).map(([label, amount], i) => ({
          label, amount, color: SPEND_COLORS[i % SPEND_COLORS.length],
        }));
        if (newSpending.length) window.spending = newSpending;
      }

      // Recalculate income from payroll net (single source of truth) then render
      if (typeof window.syncAllPayrollsToPersonal === 'function') {
        window.syncAllPayrollsToPersonal();
      } else if (typeof window.renderPersonal === 'function') {
        window.renderPersonal();
      }
    } catch (err) {
      console.warn('[PersonalFinance]', err.message);
    }
  };

  // ══════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    if (!window._ffAuthed) { window.addEventListener('ff:authed', _run, {once:true}); return; }
    loadTimesheet();
    loadHoldingsFromDB();
    loadProjects();
    window.loadPersonalFinance();

    // Expose so entity-switch and external callers can reload
    window._loadTimesheetFromDB  = loadTimesheet;
    window._loadHoldingsFromDB   = loadHoldingsFromDB;
    window._loadProjectsFromDB   = loadProjects;
    window._loadPersonalFinance  = window.loadPersonalFinance;

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
    const now = new Date();
    // Build array of last 12 month labels and start dates
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString('en-US', { month: 'short' }) });
    }

    const revByMonth  = new Array(12).fill(0);
    const expByMonth  = new Array(12).fill(0);

    invoices.forEach(inv => {
      const d = parseDate(inv.date || inv.due_date || inv.created_at);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0 && inv.status?.toLowerCase() === 'paid') revByMonth[idx] += parseFloat(inv.amount) || 0;
    });

    expenses.forEach(exp => {
      const d = parseDate(exp.expense_date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0) expByMonth[idx] += parseFloat(exp.amount) || 0;
    });

    // Include sales receipts + payments received in revenue
    (window._receipts || []).forEach(r => {
      const d = parseDate(r.date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0) revByMonth[idx] += parseFloat(r.amount) || 0;
    });
    (window._paymentsReceived || []).forEach(p => {
      const d = parseDate(p.date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0) revByMonth[idx] += parseFloat(p.amount) || 0;
    });

    // Include payments made in expenses
    (window._paymentsMade || []).forEach(p => {
      const d = parseDate(p.date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0) expByMonth[idx] += parseFloat(p.amount) || 0;
    });

    return { months: months.map(m => m.label), revByMonth, expByMonth };
  }

  // ── Update Chart.js overview chart with real data ─────────────────
  function updateOverviewChart(revArr, expArr, labels) {
    if (typeof Chart === 'undefined' || !window.charts) return;

    // Update MONTHS and REV/EXP globals so period switching still works
    if (typeof window.MONTHS !== 'undefined') window.MONTHS.splice(0, 12, ...labels);
    if (typeof window.REV !== 'undefined') window.REV.splice(0, 12, ...revArr);
    if (typeof window.EXP !== 'undefined') window.EXP.splice(0, 12, ...expArr);

    let chart = window.charts.overview;
    if (!chart) {
      if (typeof buildCharts === 'function') buildCharts();
      chart = window.charts?.overview;
      if (!chart) return;
    }
    const safeData = arr => arr.map(v => Math.max(0, v || 0));
    chart.data.labels = labels;
    chart.data.datasets[0].data = safeData(revArr);
    chart.data.datasets[1].data = safeData(expArr);
    chart.update('none');
  }

  // ── Calculate MTD (current month) totals ─────────────────────────
  function calcMTD(invoices, expenses) {
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();

    const mtdInv  = invoices.filter(i => {
      const d = parseDate(i.date || i.due_date || i.created_at);
      return d && d.getMonth() === m && d.getFullYear() === y && i.status?.toLowerCase() === 'paid';
    });
    const mtdExp  = expenses.filter(e => {
      const d = parseDate(e.expense_date || e.date || e.created_at);
      return d && d.getMonth() === m && d.getFullYear() === y;
    });

    const rev = mtdInv.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const exp = mtdExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    return { rev, exp, profit: rev - exp };
  }

  // ── Update KPI cards ─────────────────────────────────────────────
  function updateKPIs(invoices, expenses, period) {
    const now = new Date();
    let rev = 0, exp = 0;

    // Extra revenue sources: sales receipts + payments received
    const receipts  = window._receipts         || [];
    const paymentsIn = window._paymentsReceived || [];
    // Extra expense sources: payments made
    const paymentsMade = window._paymentsMade  || [];

    if (period === 'month') {
      const { rev: r, exp: e } = calcMTD(invoices, expenses);
      rev = r; exp = e;
      // Add MTD receipts
      const m = now.getMonth(), y = now.getFullYear();
      receipts.forEach(r => { const d = parseDate(r.date); if (d && d.getMonth()===m && d.getFullYear()===y) rev += parseFloat(r.amount)||0; });
      paymentsIn.forEach(p => { const d = parseDate(p.date); if (d && d.getMonth()===m && d.getFullYear()===y) rev += parseFloat(p.amount)||0; });
      paymentsMade.forEach(p => { const d = parseDate(p.date); if (d && d.getMonth()===m && d.getFullYear()===y) exp += parseFloat(p.amount)||0; });
    } else if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3) * 3;
      const paidInv = invoices.filter(i => {
        const d = parseDate(i.due_date);
        return d && d.getMonth() >= q && d.getMonth() < q + 3 && d.getFullYear() === now.getFullYear() && i.status?.toLowerCase() === 'paid';
      });
      const qExp = expenses.filter(e => {
        const d = parseDate(e.expense_date);
        return d && d.getMonth() >= q && d.getMonth() < q + 3 && d.getFullYear() === now.getFullYear();
      });
      rev = paidInv.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      exp = qExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      receipts.forEach(r => { const d = parseDate(r.date); if (d && d.getMonth()>=q && d.getMonth()<q+3 && d.getFullYear()===now.getFullYear()) rev += parseFloat(r.amount)||0; });
      paymentsIn.forEach(p => { const d = parseDate(p.date); if (d && d.getMonth()>=q && d.getMonth()<q+3 && d.getFullYear()===now.getFullYear()) rev += parseFloat(p.amount)||0; });
      paymentsMade.forEach(p => { const d = parseDate(p.date); if (d && d.getMonth()>=q && d.getMonth()<q+3 && d.getFullYear()===now.getFullYear()) exp += parseFloat(p.amount)||0; });
    } else {
      // Year (default) — all records
      rev = invoices.filter(i => i.status?.toLowerCase() === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      exp = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      rev += receipts.reduce((s, r) => s + (parseFloat(r.amount)||0), 0);
      rev += paymentsIn.reduce((s, p) => s + (parseFloat(p.amount)||0), 0);
      exp += paymentsMade.reduce((s, p) => s + (parseFloat(p.amount)||0), 0);
    }

    const profit = rev - exp;
    const outstanding = invoices.filter(i => i.status?.toLowerCase() !== 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const overdue = invoices.filter(i => i.status?.toLowerCase() === 'overdue');
    const overdueAmt = overdue.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('d-rev',    money(rev));
    set('d-exp',    money(exp));
    set('d-profit', money(profit));
    set('d-outstanding', money(outstanding));
    if (overdue.length > 0) {
      set('d-outstanding-chg', `${overdue.length} overdue · ${money(overdueAmt)}`);
      const chgEl = document.getElementById('d-outstanding-chg');
      if (chgEl) chgEl.className = 'mc-change dn';
    }

    // ── Investments: total portfolio value from window.holdings ─────
    // Each holding has { shares, price, cost }. Value = shares × current price.
    // Cost basis is shown as the change line so the user sees unrealized P/L.
    const holdings = window.holdingsData || window.holdings || [];
    const portfolio = holdings.reduce((s, h) => s + (parseFloat(h.shares) || 0) * (parseFloat(h.price) || parseFloat(h.cost) || 0), 0);
    const basis     = holdings.reduce((s, h) => s + (parseFloat(h.shares) || 0) * (parseFloat(h.cost)  || 0), 0);
    set('d-invest', money(portfolio));
    const invChgEl = document.getElementById('d-invest-chg');
    if (invChgEl) {
      if (basis > 0) {
        const pl  = portfolio - basis;
        const pct = Math.round(pl / basis * 100);
        invChgEl.textContent = (pl >= 0 ? '+' : '') + money(pl) + ' · ' + (pct >= 0 ? '+' : '') + pct + '%';
        invChgEl.className   = 'mc-change ' + (pl >= 0 ? 'up' : 'dn');
      } else {
        invChgEl.textContent = holdings.length ? holdings.length + ' holding' + (holdings.length !== 1 ? 's' : '') : 'No holdings';
        invChgEl.className   = 'mc-change neutral';
      }
    }

    return { rev, exp, profit, outstanding, portfolio };
  }

  // ── Update expense breakdown bars ────────────────────────────────
  function updateExpenseBars(expenses) {
    const cats = {};
    expenses.forEach(e => {
      const cat = e.category || 'Other';
      cats[cat] = (cats[cat] || 0) + (parseFloat(e.amount) || 0);
    });

    const total = Object.values(cats).reduce((s, v) => s + v, 0) || 1;
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);

    // Update the 4 expense bar rows (sal, rent, sw, mkt) with top 4 categories
    const barIds = [
      ['exp-sal', 'exp-sal-bar'],
      ['exp-rent', 'exp-rent-bar'],
      ['exp-sw', 'exp-sw-bar'],
      ['exp-mkt', 'exp-mkt-bar'],
    ];
    const labelIds = ['exp-sal-lbl', 'exp-rent-lbl', 'exp-sw-lbl', 'exp-mkt-lbl'];

    sorted.slice(0, 4).forEach(([cat, amt], i) => {
      const valEl = document.getElementById(barIds[i][0]);
      const barEl = document.getElementById(barIds[i][1]);
      const lblEl = document.getElementById(labelIds[i]);
      if (valEl) valEl.textContent = money(amt);
      if (barEl) {
        const w = Math.round(amt / total * 100) + '%';
        barEl.style.setProperty('width', w, 'important');
        barEl.style.setProperty('--bar-w', w);
      }
      if (lblEl) lblEl.textContent = cat;
    });
  }

  // ── Update business transactions list ────────────────────────────
  function updateTransactions(invoices, expenses) {
    const el = document.getElementById('d-txns');
    if (!el) return;

    const allTxns = [
      ...invoices.slice(0, 5).map(i => ({
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
    const paid       = invoices.filter(i => i.status?.toLowerCase() === 'paid');
    const outstanding = invoices.filter(i => i.status?.toLowerCase() !== 'paid');
    const outAmt     = outstanding.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const paidAmt    = paid.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const total      = paidAmt + outAmt || 1;
    const pct        = Math.round(paidAmt / total * 100);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('inv-out',       money(outAmt));
    set('inv-paid-pct',  pct + '% collected');
  }

  // ── Main boot: load data and wire everything ─────────────────────
  async function bootDashboardWiring() {
    try {
      // Get active entity_id to filter correctly
      const activeEntity = (window.ENTITIES || []).find(e => e.active);
      const eid = activeEntity?._dbId;
      const eq = eid ? '?entity_id=' + eid : '';
      const [invoices, expenses] = await Promise.all([
        api('GET', '/api/invoices' + eq),
        api('GET', '/api/expenses' + eq),
      ]);

      // Store globally so period switching can re-use
      window._realInvoices = invoices || [];
      window._realExpenses = expenses || [];

      // Build monthly chart data
      const { months, revByMonth, expByMonth } = buildMonthlyArrays(window._realInvoices, window._realExpenses);
      updateOverviewChart(revByMonth, expByMonth, months);

      // Update KPIs (default to year view)
      updateKPIs(window._realInvoices, window._realExpenses, 'year');
      updateExpenseBars(window._realExpenses);
      updateTransactions(window._realInvoices, window._realExpenses);
      updateInvoiceStats(window._realInvoices);

      // Patch updateDashboard so period switching uses real data
      const _origUpdateDashboard = window.updateDashboard;
      window.updateDashboard = function (d) {
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

      // Force a full UI refresh so KPIs + chart render with real data on page load
      if (!window.charts?.overview && typeof buildCharts === 'function') buildCharts();
      if (typeof window._refreshDashboardUI === 'function') window._refreshDashboardUI();

      // Belt-and-suspenders: write KPI cards directly in case updateKPIs
      // IDs or the DOM aren't ready when _refreshDashboardUI runs above.
      (function _forceKPIs() {
        const inv = window._realInvoices || [];
        const exps = window._realExpenses || [];
        const rev = inv.filter(i => (i.status||'').toLowerCase() === 'paid')
                       .reduce((s, i) => s + (Number(i.amount) || 0), 0);
        let exp = exps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        // Include payroll gross in expenses
        const payroll = window.payrollEmployees || [];
        if (window.ownerPayroll) payroll.unshift(window.ownerPayroll);
        exp += payroll.reduce((s, e) => s + (Number(e.gross) || 0), 0);
        const outstanding = inv.filter(i => (i.status||'').toLowerCase() !== 'paid')
                              .reduce((s, i) => s + (Number(i.amount) || 0), 0);
        const fmt = n => {
          const v = Math.abs(n);
          const sign = n < 0 ? '-' : '';
          if (v >= 1000000) return sign + '$' + (v / 1000000).toFixed(1) + 'M';
          if (v >= 1000)    return sign + '$' + (v / 1000).toFixed(1) + 'K';
          return sign + '$' + v.toFixed(0);
        };
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('d-rev',         fmt(rev));
        set('d-exp',         fmt(exp));
        set('d-profit',      fmt(rev - exp));
        set('d-outstanding', fmt(outstanding));
      })();

      console.log('[Dashboard Wiring] ✅ Real data loaded — invoices:', invoices.length, 'expenses:', expenses.length);
    } catch (err) {
      console.warn('[Dashboard Wiring] Could not load real data:', err.message);
    }
  }

  // bootDashboardWiring is now called by loadEntityData — no separate boot needed
  // Expose it so loadEntityData can call it after entities are loaded
  window._bootDashboardWiring = bootDashboardWiring;

  // Direct UI refresh — called by refreshFinancials() after it updates
  // _realInvoices/_realExpenses. Bypasses the updateDashboard patch so it
  // works even if bootDashboardWiring hasn't run yet.
  window._refreshDashboardUI = function () {
    const invs = window._realInvoices;
    const exps = window._realExpenses;
    if (!invs || !exps) return;
    const period = window.currentPeriod || 'year';
    const { months, revByMonth, expByMonth } = buildMonthlyArrays(invs, exps);

    // Populate EXP_SAL/RENT/SW/MKT per-month so getPeriodData() has real values
    if (typeof window.EXP_SAL !== 'undefined') {
      const _n = new Date();
      const _ms = [];
      for (let _i = 11; _i >= 0; _i--) {
        const _d = new Date(_n.getFullYear(), _n.getMonth() - _i, 1);
        _ms.push({ year: _d.getFullYear(), month: _d.getMonth() });
      }
      window.EXP_SAL.fill(0); window.EXP_RENT.fill(0); window.EXP_SW.fill(0); window.EXP_MKT.fill(0);
      exps.forEach(e => {
        const _d2 = parseDate(e.expense_date || e.date || e.created_at);
        if (!_d2) return;
        const _ix = _ms.findIndex(m => m.year === _d2.getFullYear() && m.month === _d2.getMonth());
        if (_ix < 0) return;
        const _c = (e.category || '').toLowerCase();
        const _a = parseFloat(e.amount) || 0;
        if (/salary|salaries|payroll/.test(_c))    window.EXP_SAL[_ix]  += _a;
        else if (/rent|lease|office/.test(_c))     window.EXP_RENT[_ix] += _a;
        else if (/software|saas|subscript/.test(_c)) window.EXP_SW[_ix] += _a;
        else if (/marketing|adverti/.test(_c))     window.EXP_MKT[_ix] += _a;
      });
    }

    if (!window.charts?.overview && typeof buildCharts === 'function') buildCharts();
    updateOverviewChart(revByMonth, expByMonth, months);
    if (window.charts?.overview) {
      const _safe = arr => arr.map(v => Math.max(0, v || 0));
      window.charts.overview.data.labels = months;
      window.charts.overview.data.datasets[0].data = _safe(revByMonth);
      window.charts.overview.data.datasets[1].data = _safe(expByMonth);
      window.charts.overview.update();
    }
    const kpis = updateKPIs(invs, exps, period);

    // Add owner payroll gross to expense/profit KPIs so adding payroll
    // immediately reflects in dashboard totals without requiring a page refresh.
    const _op    = window.ownerPayroll;
    const _emps  = window.payrollEmployees || [];
    const _all   = _op ? [_op, ..._emps] : _emps;
    const _payrollTotal = _all.reduce((s, e) => s + (parseFloat(e.gross) || 0), 0);
    if (_payrollTotal > 0 && kpis) {
      const _totalExp    = (kpis.exp    || 0) + _payrollTotal;
      const _totalProfit = (kpis.rev    || 0) - _totalExp;
      const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      _set('d-exp',    money(_totalExp));
      _set('d-profit', money(_totalProfit));
    }

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
    if (!window._ffAuthed) { window.addEventListener('ff:authed', _run, {once:true}); return; }
    setTimeout(async function() {
      if (_booted) return;
      _booted = true;
      try {
        const r = await fetch('/api/auth/me', {credentials:'include'});
        if (!r.ok) return;
        const _meData = await r.json().catch(() => ({}));
        window.CURRENT_USER = _meData.user || _meData;
        const _seEl = document.getElementById('settings-user-email'); if (_seEl && window.CURRENT_USER?.email) _seEl.textContent = window.CURRENT_USER.email;
        if (!window.ENTITIES?.length && typeof loadEntitiesFromDB === 'function') await loadEntitiesFromDB();
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
    const rawLines = (window._jeLines || []).filter(
      l => l.code && (l.dr > 0 || l.cr > 0)
    );
    if (rawLines.length < 2) { tip('Add at least 2 lines', true); return; }

    const totalDr = rawLines.reduce((s, l) => s + (l.dr || 0), 0);
    const totalCr = rawLines.reduce((s, l) => s + (l.cr || 0), 0);
    if (status === 'Posted' && Math.abs(totalDr - totalCr) > 0.01) {
      tip('Debits must equal credits to post', true); return;
    }

    const date        = document.getElementById('je-date')?.value || new Date().toISOString().slice(0, 10);
    const description = document.getElementById('je-notes')?.value?.trim() || 'Manual journal entry';

    // Map frontend dr/cr fields → API debit/credit field names
    const apiLines = rawLines.map(l => ({
      code:   l.code,
      name:   l.name  || '',
      debit:  l.dr    || 0,
      credit: l.cr    || 0,
    }));

    try {
      await api('POST', '/api/journals', { date, description, lines: apiLines, status });
      if (typeof window.renderJournals === 'function') window.renderJournals();
      if (typeof window.renderCOA      === 'function') window.renderCOA();
      if (typeof window.closeModal     === 'function') window.closeModal('journal-entry-modal');
      tip('Journal entry ' + status.toLowerCase());
    } catch (e) {
      tip('Could not save journal entry — ' + e.message, true);
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
      const fetches = [
        fetchInv ? api('GET', '/api/invoices' + eq) : Promise.resolve(null),
        fetchExp ? api('GET', '/api/expenses' + eq) : Promise.resolve(null),
      ];
      const [invoices, expenses] = await Promise.all(fetches);

      // ── Refresh canonical arrays only when re-fetched ──────────────
      if (fetchInv && invoices) {
        window.userInvoices = invoices.map(r => ({
          _dbId:    r.id,
          client:   r.client,
          amount:   r.amount,
          due:      r.due_date
            ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'TBD',
          due_date: r.due_date,
          status:   r.status,
          notes:    r.notes || '',
          color:    r.status?.toLowerCase() === 'overdue' ? 'var(--red)' : 'var(--t2)',
        }));
        window._realInvoices = invoices;
      }

      if (fetchExp && expenses) {
        window.bizExpenses = expenses.map(r => ({
          _dbId:  r.id,
          desc:   r.description,
          cat:    r.category,
          amount: r.amount,
          ded:    r.deductible,
          date:   r.expense_date
            ? new Date(r.expense_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'Today',
        }));
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
        'tax-filing':         () => { if (typeof window.calcAndRenderTax        === 'function') window.calcAndRenderTax(); },
      };

      const _pgFn = _renderDispatch[_curPage];
      if (_pgFn) _pgFn();

      // ── Always rebuild dashboard KPIs + charts ─────────────────────
      if (typeof window._refreshDashboardUI === 'function') {
        window._refreshDashboardUI();
      } else if (typeof window.updateDashboard === 'function') {
        window.updateDashboard();
      }

      // ── Refresh tax filing if it's the active page ──────────────────
      if (_curPage === 'tax-filing' && typeof window.calcAndRenderTax === 'function') {
        window.calcAndRenderTax();
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
      if (['all','personal','holdings'].includes(hint)) {
        if (typeof window.loadPersonalFinance === 'function') window.loadPersonalFinance().catch(()=>{});
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

    const totalBilled  = invs.reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const collected    = invs.filter(i => i.status?.toLowerCase() === 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const outstanding  = invs.filter(i => i.status?.toLowerCase() !== 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const overdue      = invs.filter(i => i.status?.toLowerCase() === 'overdue').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const overdueCount = invs.filter(i => i.status?.toLowerCase() === 'overdue').length;
    const outCount     = invs.filter(i => i.status?.toLowerCase() !== 'paid').length;
    const pctCollected = totalBilled > 0 ? Math.round(collected / totalBilled * 100) : 0;

    set('inv-billed',     money(totalBilled));
    set('inv-paid',       money(collected));
    set('inv-paid-pct',   pctCollected + '% collected');
    set('inv-out',        money(outstanding));
    set('inv-over',       money(overdue));
    const lblEl = document.getElementById('inv-billed-lbl');
    if (lblEl) { lblEl.textContent = period.label || 'All time'; lblEl.className = 'mc-change neutral'; }
    const titleEl = document.getElementById('inv-table-title');
    if (titleEl) titleEl.textContent = 'Invoices — ' + (period.label || 'All time');

    // Update "N invoices" count subtitles (id="inv-out-cnt" / "inv-over-cnt")
    set('inv-out-cnt',  outCount     + ' invoice' + (outCount     !== 1 ? 's' : ''));
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
          'Your data is <strong style="color:#f2e8d5">securely stored in the cloud</strong> ' +
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
      window.loadEntitiesFromDB = async function () {
        await _origLoadEnt();
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
      'tax-filing':         () => { if (typeof window.calcAndRenderTax        === 'function') window.calcAndRenderTax(); },
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

