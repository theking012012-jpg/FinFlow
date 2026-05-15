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
  window.addEventListener('DOMContentLoaded', function () {

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
      } catch (e) {
        // Not logged in yet or no settings saved — fine, use defaults
      }
    }
    loadSettingsFromDB();

    // Patch saveSettings to actually persist
    window.saveSettings = async function () {
      const currency = document.getElementById('s-currency')?.value;
      const dark_mode = document.getElementById('s-dark-toggle')?.checked;
      const show_cents = document.getElementById('s-cents')?.checked;
      const notif_email = document.getElementById('s-notif-email')?.checked;
      const notif_inv = document.getElementById('s-notif-inv')?.checked;
      const notif_pay = document.getElementById('s-notif-pay')?.checked;
      const name = document.getElementById('s-user-name')?.value?.trim();

      try {
        await api('PUT', '/api/settings', {
          currency,
          dark_mode,
          show_cents,
          notif_email,
          notif_inv,
          notif_pay,
          name,
        });
        notify('Settings saved successfully ✦');
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) {
        notify('Could not delete goal — ' + e.message, true);
      }
    };

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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        window.holdings.push({ _dbId: saved.id, ticker, name, type, shares, cost, price, div, color });
        closeModal('holding-modal');
        if (typeof renderInvestments === 'function') renderInvestments();
        notify(`${ticker} added to portfolio ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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

      const _custEnt = (window.ENTITIES || []).find(e => e.active);
      const data = {
        fname, lname, email,
        company:   (typeof sanitizeText === 'function') ? sanitizeText(document.getElementById('cust-company')?.value, 200)  : document.getElementById('cust-company')?.value?.trim(),
        industry:  document.getElementById('cust-industry')?.value,
        phone:     (typeof sanitizePhone === 'function')  ? sanitizePhone(document.getElementById('cust-phone')?.value)       : document.getElementById('cust-phone')?.value?.trim(),
        revenue:   revRaw !== null ? revRaw : 0,
        status:    document.getElementById('cust-status')?.value,
        notes:     (typeof sanitizeText === 'function') ? sanitizeText(document.getElementById('cust-notes')?.value, 1000) : document.getElementById('cust-notes')?.value?.trim(),
        entity_id: _custEnt?._dbId || null,
      };

      const editId = document.getElementById('cust-edit-id')?.value;

      try {
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) {
        notify('Could not save customer — ' + e.message, true);
      }
    };

    window.deleteCustomer = async function () {
      const id = Number(document.getElementById('cust-edit-id')?.value);
      if (!id) return;
      if (!confirm('Delete this customer? This cannot be undone.')) return;

      const cust = window.customers.find(c => c.id === id);
      const dbId = cust?._dbId || id;

      try {
        await api('DELETE', `/api/customers/${dbId}`);
        window.customers = window.customers.filter(c => c.id !== id);
        closeModal('customer-modal');
        if (typeof renderCustomers === 'function') renderCustomers();
        notify('Customer deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) {
        notify('Could not delete customer — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 6. CUSTOMERS — load on boot + showPage hook
    // ════════════════════════════════════════════
    async function loadCustomersFromDB() {
      try {
        const _custEid = (window.ENTITIES || []).find(e => e.active)?._dbId;
        const rows = await api('GET', '/api/customers' + (_custEid ? '?entity_id=' + _custEid : ''));
        if (rows && rows.length > 0) {
          const maxDbId = rows.reduce((m, r) => Math.max(m, r.id), 0);
          window.nextCustId = Math.max(window.nextCustId || 1, maxDbId + 1);
          window.customers = rows.map(r => ({
            _dbId: r.id, id: r.id,
            fname: r.fname || '', lname: r.lname || '',
            email: r.email || '', company: r.company || '',
            industry: r.industry || '', phone: r.phone || '',
            revenue: r.revenue || 0, status: r.status || 'active',
            notes: r.notes || '',
          }));
          const search = document.getElementById('cust-search')?.value;
          if (typeof renderCustomers === 'function') renderCustomers(search);
        }
      } catch (e) {
        // Not logged in or no customers — ignore
      }
    }
    loadCustomersFromDB();
    window._loadCustomersFromDB = loadCustomersFromDB;

    // Reload customers when navigating to the customers page
    const _custOrigShowPage = window.showPage;
    if (typeof _custOrigShowPage === 'function') {
      window.showPage = function (id, navEl) {
        _custOrigShowPage(id, navEl);
        if (id === 'customers') loadCustomersFromDB();
      };
    }

    console.log('[FinFlow API Wiring] ✅ All easy patches applied');
  });

})();
