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
    // FISCAL-YEAR indexed (F33): index i = the i-th month of the current fiscal year, so
    // REV[i]/EXP[i] align with MONTH_FULL[i] (labels) and the stepper's currentMonthIdx.
    // (Was rolling-last-12, which put label and data on different months.)
    const _fym = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const _fyName = (typeof document !== 'undefined' && (document.getElementById('s-fy')||{}).value) || 'January';
    const _fyStartIdx = Math.max(0, _fym.indexOf(_fyName));
    const _fyStartYear = (now.getMonth() >= _fyStartIdx) ? now.getFullYear() : now.getFullYear() - 1;
    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(_fyStartYear, _fyStartIdx + i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString('en-US', { month: 'short' }) });
    }

    const revByMonth  = new Array(12).fill(0);
    const expByMonth  = new Array(12).fill(0);

    invoices.forEach(inv => {
      const d = parseDate(inv.issue_date || inv.created_at || inv.date);   // F36 issue_date; created_at fallback is a time-boxed transition (UTC — see server computeBooks issueDate)
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0 && ['pending','overdue','partial','paid'].includes(inv.status?.toLowerCase())) revByMonth[idx] += parseFloat(inv.amount) || 0;
    });

    expenses.forEach(exp => {
      const d = parseDate(exp.expense_date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0) expByMonth[idx] += parseFloat(exp.amount) || 0;
    });

    // Include cash sales receipts in revenue. payments_received is NOT revenue (F32).
    // Reads window.receipts (the name the loader sets; window._receipts was never assigned).
    (window.receipts || []).forEach(r => {
      const d = parseDate(r.date);
      if (!d) return;
      const idx = months.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (idx >= 0) revByMonth[idx] += parseFloat(r.amount) || 0;
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

    // Revenue: issue-based accrual (F32) — issued invoices (recognized statuses) at FULL
    // amount by ISSUE date (created_at, NOT due_date) + cash sales receipts. NO
    // payments_received leg. Expenses keep their existing basis (real expenses + payments
    // made). Reads window.receipts (window._receipts was never assigned). This rev is NOT
    // written to d-rev — app-main updateDashboard owns that (F7); it only feeds the returned
    // object's non-conflicting cards.
    const RECOGNIZED = ['pending','overdue','partial','paid'];
    const isIssued = i => RECOGNIZED.includes(i.status?.toLowerCase());
    const issueD   = i => parseDate(i.issue_date || i.created_at || i.date);   // F36 issue_date; created_at fallback (transition)
    const receipts     = window.receipts      || [];
    const paymentsMade = window._paymentsMade || [];
    const m = now.getMonth(), y = now.getFullYear(), q = Math.floor(m / 3) * 3;
    const inP = d => {
      if (!d) return false;
      if (period === 'month')   return d.getMonth()===m && d.getFullYear()===y;
      if (period === 'quarter') return d.getMonth()>=q && d.getMonth()<q+3 && d.getFullYear()===y;
      return true; // year — all records
    };
    rev  = invoices.filter(i => isIssued(i) && inP(issueD(i))).reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
    rev += receipts.filter(r => inP(parseDate(r.date))).reduce((s,r)=>s+(parseFloat(r.amount)||0),0);
    exp  = expenses.filter(e => inP(parseDate(e.expense_date || e.date || e.created_at))).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
    exp += paymentsMade.filter(p => inP(parseDate(p.date || p.created_at))).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);

    const profit = rev - exp;
    const outstanding = invoices.filter(i => i.status?.toLowerCase() !== 'paid').reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const overdue = invoices.filter(i => i.status?.toLowerCase() === 'overdue');
    const overdueAmt = overdue.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    // d-rev / d-exp / d-profit are written ONLY by app-main updateDashboard (canonical R1/E1
    // − COGS), so this wiring can't overwrite them with a divergent basis (root of F7). This
    // function still owns the non-conflicting cards below. rev/exp/profit are still computed
    // above for the returned object (used by _refreshDashboardUI's other cards).
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
        chg.innerHTML = 'Unable to load · ' + (window._ffRetryBtn ? window._ffRetryBtn('window._bootDashboardWiring&&window._bootDashboardWiring()') : 'Retry');
        chg.className = 'mc-change dn';
      }
    }
  }

  // ── Main boot: load data and wire everything ─────────────────────
  async function bootDashboardWiring() {
    _dashSetState('loading');
    try {
      // Get active entity_id to filter correctly
      const activeEntity = (window.ENTITIES || []).find(e => e.active);
      const eid = activeEntity?._dbId;
      const eq = eid ? '?entity_id=' + eid : '';
      const [invoices, expenses] = await Promise.all([
        apiGetStatus('/api/invoices' + eq),
        apiGetStatus('/api/expenses' + eq),
      ]);

      // Store globally so period switching can re-use
      window._realInvoices = invoices || [];
      window._realExpenses = expenses || [];

      // Stash the entity-scoped FIFO COGS total for the canonical Net (Revenue − COGS − OpEx)
      // that app-main updateDashboard / AI / health score subtract. Non-inventory → 0.
      try { const _c = await apiGetStatus('/api/cogs' + eq); window._cogsTotal = parseFloat(_c && _c.totalCOGS) || 0; }
      catch (e) { window._cogsTotal = window._cogsTotal || 0; }

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
    updateKPIs(invs, exps, period);
    // (Removed the payroll patch that re-wrote d-exp/d-profit here — those cards are now
    // owned solely by app-main updateDashboard, which refreshFinancials calls right after
    // this. computeExpenseBreakdown already accrues payroll into the canonical OpEx.)

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
