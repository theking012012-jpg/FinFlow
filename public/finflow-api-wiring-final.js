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

  window.addEventListener('DOMContentLoaded', async function () {

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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
  });

})();
