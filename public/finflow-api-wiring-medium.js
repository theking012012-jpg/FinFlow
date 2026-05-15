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
            color:  r.status === 'overdue' ? 'var(--red)' : 'var(--t2)',
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
      el.innerHTML = window.userInvoices.map((inv, idx) => `
        <div class="table-row inv-cols">
          <span>${esc(inv.client)}</span>
          <span style="font-weight:600;font-family:var(--font-mono)">${esc(S(inv.amount))}</span>
          <span style="color:${esc(inv.color)}">${esc(inv.due)}</span>
          <span><span class="badge ${badgeCls[inv.status] || 'b-amber'}">${esc(inv.status)}</span></span>
          <span class="table-actions">
            ${inv.status === 'overdue'
              ? `<button class="btn btn-ghost btn-sm inv-remind-btn"
                   data-idx="${idx}"
                   data-client="${esc(inv.client)}"
                   data-amount="${esc(S(inv.amount))}">Remind ↗</button>`
              : ''}
            ${inv.status === 'paid'
              ? `<button class="btn btn-ghost btn-sm" onclick="viewInvoice(${idx})">View</button>`
              : ''}
            ${inv.status === 'pending'
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
      const lowCount = window.inventory.filter(i => i.low).length;
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

    // Boot: load saved payroll from DB
    async function loadPayrollFromDB() {
      try {
        const _eidPay = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/payroll' + (_eidPay ? '?entity_id=' + _eidPay : ''));
        if (!rows || rows.length === 0) return;

        rows.forEach(r => {
          const emp = {
            _dbId:    r.id,
            fname:    r.fname,
            lname:    r.lname,
            role:     r.role     || '',
            type:     r.emp_type || 'Full-time',
            gross:    r.gross,
            taxRate:  r.tax_rate,
            net:      Math.round(r.gross * (1 - r.tax_rate / 100)),
            initials: (typeof getInitials === 'function') ? getInitials(r.fname, r.lname) : (r.fname[0] + (r.lname[0] || '')).toUpperCase(),
            avClass:  r.av_class || 'av-blue',
            isOwner:  !!r.is_owner,
          };

          if (r.is_owner) {
            // Restore ownerPayroll compat pointer
            window.ownerPayroll = emp;
            // Also restore ownerPayrollByEntity for the active entity
            const activeIdx = (window.ENTITIES || []).findIndex(e => e.active);
            if (activeIdx >= 0) {
              window.ownerPayrollByEntity = window.ownerPayrollByEntity || {};
              window.ownerPayrollByEntity[activeIdx] = {
                ...emp,
                currency:   'USD',
                entityName: (window.ENTITIES[activeIdx] || {}).name || 'Entity',
              };
            }
          } else {
            // Add to payrollEmployees if not already present
            if (!window.payrollEmployees) window.payrollEmployees = [];
            const exists = window.payrollEmployees.some(e => e._dbId === r.id);
            if (!exists) window.payrollEmployees.push(emp);
          }
        });

        if (typeof renderPayroll === 'function') renderPayroll();
      } catch (e) {
        // Ignore
      }
    }
    loadPayrollFromDB();

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
          ${e.isOwner ? `<button class="btn-icon" onclick="openOwnerModal()" title="Edit" style="border:none;background:none;color:var(--acc)"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11 2l3 3L5 14H2v-3z"/></svg></button>` : '<span></span>'}
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

      try {
        for (const [idxStr, op] of Object.entries(byEntity)) {
          const idx = parseInt(idxStr);
          const entity = ENTITIES[idx];
          const entityDbId = entity?._dbId || null;

          if (op._dbId) {
            // Update existing record
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
          } else {
            // Create new record scoped to this entity
            const saved = await api('POST', '/api/payroll', {
              fname:     op.fname,
              lname:     op.lname,
              role:      op.role     || 'CEO / Founder',
              emp_type:  op.type     || 'owner',
              gross:     op.gross,
              tax_rate:  op.taxRate,
              av_class:  op.avClass  || 'av-blue',
              is_owner:  true,
              entity_id: entityDbId,
            });
            // Store DB id back so next save does a PUT
            byEntity[idxStr]._dbId = saved.id;
            if (window.ownerPayroll && !window.ownerPayroll._dbId) {
              window.ownerPayroll._dbId = saved.id;
            }
          }
        }
        console.log('[FinFlow] Owner payroll persisted per-entity ✦');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) {
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (rows && rows.length > 0) {
          window.itemsData = rows.map(r => ({
            _dbId:  r.id,
            name:   r.name,
            type:   r.type,
            price:  r.price,
            unit:   r.unit,
            stock:  r.stock,
            status: r.status,
            sku:    r.sku || '',
          }));
          if (typeof renderItems === 'function') renderItems();
        }
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
      ['item-name', 'item-sku', 'item-price', 'item-unit', 'item-stock'].forEach(id => {
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
      const unit   = document.getElementById('item-unit')?.value?.trim() || 'each';
      const stockEl = document.getElementById('item-stock');
      const stock  = stockEl?.value !== '' && stockEl?.value != null ? parseInt(stockEl.value) : null;
      const status = document.getElementById('item-status')?.value  || 'Active';
      const sku    = document.getElementById('item-sku')?.value?.trim() || '';
      try {
        if (_itemModalMode === 'edit' && _editItemDbId != null) {
          await api('PUT', `/api/items/${_editItemDbId}`, { name, type, price, unit, stock, status, sku });
          const item = (window.itemsData || []).find(i => i._dbId === _editItemDbId);
          if (item) Object.assign(item, { name, type, price, unit, stock, status, sku });
        } else {
          const saved = await api('POST', '/api/items', { name, type, price, unit, stock, status, sku });
          if (!window.itemsData) window.itemsData = [];
          window.itemsData.unshift({ _dbId: saved.id, name, type, price, unit, stock, status, sku });
        }
        closeModal('item-modal');
        if (typeof renderItems === 'function') renderItems();
        notify(`${esc(name)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
      const annualRev = invs.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
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
      const totalRev = ents.reduce((s, e) => s + (e.data && e.data.rev ? parseFloat(e.data.rev) : 0), 0);
      const totalProfit = ents.reduce((s, e) => s + (e.data && e.data.netProfit ? parseFloat(e.data.netProfit) : 0), 0);
      set('ent-consol-rev', S(totalRev));
      set('ent-consol-profit', S(totalProfit));
      if (totalRev > 0) {
        const margin = Math.round(totalProfit / totalRev * 100);
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
        if (id === 'timesheet')  _setTimesheetTitle();
        if (id === 'documents')  { if (typeof window.renderDocuments === 'function') window.renderDocuments(); }
      };
    }

    // Set timesheet title immediately on load
    _setTimesheetTitle();

    console.log('[FinFlow API Wiring — Medium] ✅ Invoices, Expenses, Inventory, Payroll, Items patched');
  })()

})();
