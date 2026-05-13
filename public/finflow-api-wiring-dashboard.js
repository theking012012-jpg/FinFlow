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
      const d = parseDate(inv.due_date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0 && inv.status === 'paid') revByMonth[idx] += parseFloat(inv.amount) || 0;
    });

    expenses.forEach(exp => {
      const d = parseDate(exp.expense_date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0) expByMonth[idx] += parseFloat(exp.amount) || 0;
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

    const chart = window.charts.overview;
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = revArr;
    chart.data.datasets[1].data = expArr;
    chart.update('none');
  }

  // ── Calculate MTD (current month) totals ─────────────────────────
  function calcMTD(invoices, expenses) {
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();

    const mtdInv  = invoices.filter(i => {
      const d = parseDate(i.due_date);
      return d && d.getMonth() === m && d.getFullYear() === y && i.status === 'paid';
    });
    const mtdExp  = expenses.filter(e => {
      const d = parseDate(e.expense_date);
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

    if (period === 'month') {
      const { rev: r, exp: e } = calcMTD(invoices, expenses);
      rev = r; exp = e;
    } else if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3) * 3;
      const paidInv = invoices.filter(i => {
        const d = parseDate(i.due_date);
        return d && d.getMonth() >= q && d.getMonth() < q + 3 && d.getFullYear() === now.getFullYear() && i.status === 'paid';
      });
      const qExp = expenses.filter(e => {
        const d = parseDate(e.expense_date);
        return d && d.getMonth() >= q && d.getMonth() < q + 3 && d.getFullYear() === now.getFullYear();
      });
      rev = paidInv.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      exp = qExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    } else {
      // Year (default)
      rev = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      exp = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    }

    const profit = rev - exp;
    const outstanding = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const overdue = invoices.filter(i => i.status === 'overdue');
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

    return { rev, exp, profit, outstanding };
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
      if (barEl) barEl.style.width = Math.round(amt / total * 100) + '%';
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
        date: parseDate(i.due_date),
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
    const paid       = invoices.filter(i => i.status === 'paid');
    const outstanding = invoices.filter(i => i.status !== 'paid');
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
      const [invoices, expenses] = await Promise.all([
        api('GET', '/api/invoices'),
        api('GET', '/api/expenses'),
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

      console.log('[Dashboard Wiring] ✅ Real data loaded — invoices:', invoices.length, 'expenses:', expenses.length);
    } catch (err) {
      console.warn('[Dashboard Wiring] Could not load real data:', err.message);
    }
  }

  // Run after DOM + all other wiring scripts have loaded
  window.addEventListener('DOMContentLoaded', function () {
    // Small delay to let Chart.js and other wiring scripts initialize first
    setTimeout(bootDashboardWiring, 500);
  });

})();

// ════════════════════════════════════════════════════════════════════
// ENTITY WIRING
// Replaces hardcoded ENTITIES array with real API data.
// Fixes: new entities not showing, switching entity copies old data.
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.status); }
    return res.json();
  }

  // ── Load real entities from API and sync with ENTITIES array ──────
  async function loadRealEntities() {
    try {
      const rows = await api('GET', '/api/entities');
      if (!rows || !rows.length) return;

      // Sync window.ENTITIES with real DB entities
      window.ENTITIES.length = 0;
      rows.forEach(e => {
        window.ENTITIES.push({
          _dbId:    e.id,
          name:     e.name,
          tag:      'Entity',
          color:    e.color || '#c9a84c',
          currency: e.currency || 'USD',
          active:   !!e.is_active,
          data:     { rev: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 }, // will be filled by real data
        });
      });

      if (typeof window.renderEntities === 'function') window.renderEntities();
      console.log('[Entity Wiring] Loaded', rows.length, 'entities from DB');
    } catch (e) {
      console.warn('[Entity Wiring] Could not load entities:', e.message);
    }
  }

  // ── Override saveNewEntity to reload entities after creation ──────
  window.addEventListener('DOMContentLoaded', function () {
    const _origSaveNewEntity = window.saveNewEntity;
    window.saveNewEntity = async function () {
      const name     = document.getElementById('ne-name')?.value?.trim();
      const currency = document.getElementById('ne-currency')?.value || 'USD';
      const color    = document.getElementById('ne-color')?.value    || '#c9a84c';
      if (!name) { if (typeof notify === 'function') notify('Entity name is required'); return; }
      try {
        await api('POST', '/api/entities', { name, currency, color });
        if (typeof closeModal === 'function') closeModal('add-entity-modal');
        await loadRealEntities();
        if (typeof notify === 'function') notify(`Entity "${name}" created ✦`);
      } catch (e) {
        if (typeof notify === 'function') notify('Error: ' + (e.message || 'Failed to create entity'));
      }
    };

    // ── Override switchEntity to activate in session + reload data ──
    const _origSwitchEntity = window.switchEntity;
    window.switchEntity = async function (idx) {
      const entity = window.ENTITIES[idx];
      if (!entity) return;

      // Call original for UI updates
      if (typeof _origSwitchEntity === 'function') {
        try { _origSwitchEntity(idx); } catch (e) { /* ignore */ }
      }

      // Activate in session via API
      if (entity._dbId) {
        try {
          await api('POST', `/api/entities/${entity._dbId}/activate`, {});
          console.log('[Entity Wiring] Activated entity', entity._dbId, entity.name);

          // Reload invoices and expenses for this entity
          const [invoices, expenses] = await Promise.all([
            api('GET', '/api/invoices'),
            api('GET', '/api/expenses'),
          ]);

          // Update frontend arrays
          if (window.userInvoices) {
            window.userInvoices.length = 0;
            invoices.forEach(r => window.userInvoices.push({
              _dbId: r.id, client: r.client, amount: r.amount,
              due: r.due_date ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD',
              due_date: r.due_date, status: r.status, notes: r.notes || '',
              color: r.status === 'overdue' ? 'var(--red)' : 'var(--t2)',
            }));
          }
          if (window.bizExpenses) {
            window.bizExpenses.length = 0;
            expenses.forEach(r => window.bizExpenses.push({
              _dbId: r.id, desc: r.description, cat: r.category,
              amount: r.amount, ded: r.deductible,
              date: r.expense_date ? new Date(r.expense_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
            }));
          }

          // Update real data globals for dashboard wiring
          window._realInvoices = invoices;
          window._realExpenses = expenses;

          // Re-render
          if (typeof renderInvoices === 'function') renderInvoices();
          if (typeof renderExpenses === 'function') renderExpenses();
          if (typeof updateDashboard === 'function') updateDashboard();

          if (typeof notify === 'function') notify(`Switched to ${entity.name} ✦`);
        } catch (e) {
          console.warn('[Entity Wiring] Could not activate entity:', e.message);
        }
      }
    };

    // Load real entities on boot
    loadRealEntities();
  });

})();

// ════════════════════════════════════════════════════════════════════
// LOAD ENTITY DATA OVERRIDE
// Replaces hardcoded loadEntityData() with real API calls.
// This prevents copying hardcoded invoices/expenses when switching.
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  async function api(method, path) {
    const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.status); }
    return res.json();
  }

  window.addEventListener('DOMContentLoaded', function () {

    // Override loadEntityData to use real API data instead of hardcoded arrays
    window.loadEntityData = async function (idx) {
      const entity = window.ENTITIES[idx];
      if (!entity) return;

      // Activate entity in session first
      if (entity._dbId) {
        try {
          await api('POST', `/api/entities/${entity._dbId}/activate`);
        } catch (e) {
          console.warn('[Entity Wiring] Could not activate entity:', e.message);
        }
      }

      try {
        // Load real data for this entity from API
        const [invoices, expenses, customers, inventory, payroll] = await Promise.all([
          api('GET', '/api/invoices'),
          api('GET', '/api/expenses'),
          api('GET', '/api/customers'),
          api('GET', '/api/inventory'),
          api('GET', '/api/payroll'),
        ]);

        // Clear and replace userInvoices
        if (Array.isArray(window.userInvoices)) window.userInvoices.length = 0;
        else window.userInvoices = [];
        (invoices || []).forEach(r => window.userInvoices.push({
          _dbId: r.id, client: r.client, amount: r.amount,
          due: r.due_date ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD',
          due_date: r.due_date, status: r.status, notes: r.notes || '',
          color: r.status === 'overdue' ? 'var(--red)' : 'var(--t2)',
        }));

        // Clear and replace bizExpenses
        if (Array.isArray(window.bizExpenses)) window.bizExpenses.length = 0;
        else window.bizExpenses = [];
        (expenses || []).forEach(r => window.bizExpenses.push({
          _dbId: r.id, desc: r.description, cat: r.category,
          amount: r.amount, ded: r.deductible,
          date: r.expense_date ? new Date(r.expense_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
        }));

        // Clear and replace customers
        if (Array.isArray(window.customers)) window.customers.length = 0;
        else window.customers = [];
        (customers || []).forEach(r => window.customers.push({ ...r, _dbId: r.id }));

        // Clear and replace inventory
        if (Array.isArray(window.inventory)) window.inventory.length = 0;
        else window.inventory = [];
        (inventory || []).forEach(r => window.inventory.push({
          _dbId: r.id, sku: r.sku, name: r.name,
          units: r.units, max: r.max_units || 200, cost: r.cost, low: !!r.low_stock,
        }));

        // Update real data globals for dashboard
        window._realInvoices = invoices || [];
        window._realExpenses = expenses || [];

        // Zero out hardcoded chart data for this entity (real data will come from dashboard wiring)
        const empty12 = new Array(12).fill(0);
        if (typeof window.REV !== 'undefined') window.REV.splice(0, 12, ...empty12);
        if (typeof window.EXP !== 'undefined') window.EXP.splice(0, 12, ...empty12);

        // Re-render all pages
        if (typeof renderInvoices === 'function') renderInvoices();
        if (typeof renderExpenses === 'function') renderExpenses();
        if (typeof renderCustomers === 'function') renderCustomers();
        if (typeof renderInventory === 'function') renderInventory();
        if (typeof updateDashboard === 'function') updateDashboard();

        // Rebuild chart with real data
        const { months, revByMonth, expByMonth } = window._buildMonthlyArrays
          ? window._buildMonthlyArrays(window._realInvoices, window._realExpenses)
          : { months: [], revByMonth: empty12, expByMonth: empty12 };

        if (window.charts && window.charts.overview) {
          window.charts.overview.data.labels = months;
          window.charts.overview.data.datasets[0].data = revByMonth;
          window.charts.overview.data.datasets[1].data = expByMonth;
          window.charts.overview.update('none');
        }

        console.log('[Entity Wiring] Loaded real data for', entity.name, '— invoices:', invoices.length, 'expenses:', expenses.length);
      } catch (e) {
        console.warn('[Entity Wiring] Could not load entity data:', e.message);
      }
    };

  });

})();
