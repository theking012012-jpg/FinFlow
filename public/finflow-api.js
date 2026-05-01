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
    gate.innerHTML = '<style>#ff-box{width:100%;max-width:380px;padding:2rem 2.25rem;background:#16120d;border:1px solid #3d3222;border-radius:14px}.ff-t{font-size:22px;font-family:"Cormorant Garamond",serif;font-style:italic;color:#e4c97a;margin-bottom:4px}.ff-s{font-size:13px;color:#7d7060;margin-bottom:1.5rem}.ff-tabs{display:flex;gap:4px;margin-bottom:1.25rem;background:#0e0b08;border-radius:8px;padding:4px}.ff-tab{flex:1;padding:6px;border:none;border-radius:5px;font-size:12.5px;cursor:pointer;color:#7d7060;background:transparent}.ff-tab.on{background:#1c1712;color:#f2e8d5}.ff-err{font-size:12px;color:#c46a5a;background:#1e0d0a;border:1px solid #3d1a14;border-radius:6px;padding:8px;margin-bottom:1rem;display:none}.ff-lbl{font-size:11.5px;color:#9e8e73;display:block;margin-bottom:5px}.ff-inp{width:100%;padding:9px 11px;border:1px solid #3d3222;border-radius:6px;background:#1c1712;color:#f2e8d5;font-size:13px;outline:none;margin-bottom:.9rem;box-sizing:border-box;font-family:Jost,system-ui}.ff-btn{width:100%;padding:10px;border:none;border-radius:6px;background:#c9a84c;color:#0e0b08;font-size:13.5px;font-weight:600;cursor:pointer}.ff-btn:disabled{opacity:.5}.ff-hint{font-size:11.5px;color:#7d7060;text-align:center;margin-top:1rem}.ff-hint span{color:#c9a84c;cursor:pointer}</style><div id="ff-box"><div class="ff-t">FinFlow</div><div class="ff-s">Sign in to your workspace</div><div class="ff-tabs"><button class="ff-tab on" id="fft-li" onclick="ffTab(\'login\')">Sign in</button><button class="ff-tab" id="fft-re" onclick="ffTab(\'register\')">Create account</button></div><div id="ff-err" class="ff-err"></div><div id="ff-li"><label class="ff-lbl">Email</label><input class="ff-inp" id="ff-le" type="email" placeholder="you@example.com"><label class="ff-lbl">Password</label><input class="ff-inp" id="ff-lp" type="password" placeholder="••••••••"><button class="ff-btn" id="ff-lb" onclick="ffLogin()">Sign in &rarr;</button><div class="ff-hint">No account? <span onclick="ffTab(\'register\')">Create one</span></div></div><div id="ff-re" style="display:none"><label class="ff-lbl">Name</label><input class="ff-inp" id="ff-rn" type="text" placeholder="Your name"><label class="ff-lbl">Email</label><input class="ff-inp" id="ff-re2" type="email" placeholder="you@example.com"><label class="ff-lbl">Password (min 6 chars)</label><input class="ff-inp" id="ff-rp" type="password" placeholder="Choose a password"><button class="ff-btn" id="ff-rb" onclick="ffRegister()">Create account &rarr;</button><div class="ff-hint">Have one? <span onclick="ffTab(\'login\')">Sign in</span></div></div></div>';
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
    var gate=document.getElementById('ff-auth-gate'); if(gate) gate.remove();
    try{sessionStorage.setItem('ff_onboarded','1');}catch(e){}
    var ob=document.getElementById('ob-overlay'); if(ob) ob.remove();
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

    ['renderInvoices','renderExpenses','renderCustomers','renderInventory',
     'renderPayroll','renderPersonal','renderInvestments','updateDashboard','updateAI'
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
