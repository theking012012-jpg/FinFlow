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
    document.querySelectorAll('[onclick*="logout"],[onclick*="Logout"],[onclick*="signOut"]').forEach(el => {
      const existing = el.getAttribute('onclick');
      if (!existing.includes('doLogout')) return;
      el.setAttribute('onclick', 'doLogout()');
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
      const saveBtn = modal.querySelector('button[onclick*="saveExpense"]');
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
                     class: v('bexp-class').trim(), location: v('bexp-location').trim() };
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
      const saveBtn = modal.querySelector('button[onclick*="saveHolding"]');
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
