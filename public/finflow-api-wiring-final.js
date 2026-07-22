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

      // Live modal uses h-* field ids (not hold-*).
      const ticker    = document.getElementById('h-ticker')?.value?.trim().toUpperCase();
      const name      = document.getElementById('h-name')?.value?.trim();
      const assetType = document.getElementById('h-type')?.value || 'Stock';
      const shares    = parseFloat(document.getElementById('h-shares')?.value) || 0;
      const costPer   = parseFloat(document.getElementById('h-cost')?.value)   || 0;
      const price     = parseFloat(document.getElementById('h-price')?.value)  || costPer;
      const dividend  = parseFloat(document.getElementById('h-div')?.value)    || 0;

      if (!ticker || !shares) { notify('Ticker and shares required.', true); return; }

      const h    = (window.holdings || window.portfolioHoldings || []).find(h => h.id === Number(editId));
      const dbId = h?._dbId || editId;

      try {
        await api('PUT', `/api/holdings/${dbId}`, { ticker, name: name||ticker, asset_type: assetType, shares, cost_per: costPer, price, dividend });
        const list = window.holdings || window.portfolioHoldings;
        if (list) {
          const idx = list.findIndex(h => h.id === Number(editId));
          // Mirror the client holding shape (type/cost/div) so the re-render reflects the edit
          // immediately — the object exposes those, not asset_type/cost_per/dividend.
          if (idx > -1) list[idx] = { ...list[idx], ticker, name: name||ticker, type: assetType, asset_type: assetType, shares, cost: costPer, cost_per: costPer, price, div: dividend, dividend };
        }
        if (typeof closeModal === 'function') closeModal('holding-modal');
        if (typeof renderInvestments === 'function') renderInvestments();
        notify('Holding updated ✦');
        const _eid = document.getElementById('holding-edit-id'); if (_eid) _eid.value = '';
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
        if (typeof renderInvestments === 'function') renderInvestments();
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
