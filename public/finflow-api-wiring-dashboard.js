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
    const _fyWin = FD.resolvePeriod({ period: 'year', fyStartMonth: _fyStartIdx, today: FD.resolvedToday(new Date()) });
    const _baseAbs = parseInt(_fyWin.start.slice(0,4),10)*12 + (parseInt(_fyWin.start.slice(5,7),10)-1);
    const months = [];
    for (let i = 0; i < 12; i++) { const _a = _baseAbs + i; months.push({ ym: Math.floor(_a/12)+'-'+String((_a%12)+1).padStart(2,'0'), label: _MN[_a%12] }); }
    const _idxOf = v => { const y = FD._toYmd(v); if (y == null) return -1; const k = y.slice(0,7); return months.findIndex(m => m.ym === k); };

    const revByMonth  = new Array(12).fill(0);
    const expByMonth  = new Array(12).fill(0);

    invoices.forEach(inv => {
      const idx = _idxOf(inv.issue_date || inv.created_at || inv.date);   // F36 issue_date; created_at fallback (transition)
      if (idx >= 0 && ['pending','overdue','partial','paid'].includes(inv.status?.toLowerCase())) revByMonth[idx] += parseFloat(inv.amount) || 0;
    });
    // Cash sales receipts count as revenue; payments_received is NOT revenue (F32).
    (window.receipts || []).forEach(r => { const idx = _idxOf(r.date); if (idx >= 0) revByMonth[idx] += parseFloat(r.amount) || 0; });
    expenses.forEach(exp => { const idx = _idxOf(exp.expense_date); if (idx >= 0) expByMonth[idx] += parseFloat(exp.amount) || 0; });
    // F38 Step 4: issued bills accrue as expense in their ISSUE month — RECOGNIZED_BILL, FULL amount.
    const _RECBILL = ['unpaid','due_soon','overdue','partial','paid'];
    (window.bills || []).forEach(b => { if (!_RECBILL.includes((b.status || '').toLowerCase())) return; const idx = _idxOf(b.issue_date || b.created_at || b.due_date); if (idx >= 0) expByMonth[idx] += parseFloat(b.amount) || 0; });
    // ONLY orphan payments (bill_id IS NULL) — a linked payment settles AP, not a fresh expense.
    (window.paymentsMade || []).filter(p => p.bill_id == null).forEach(p => { const idx = _idxOf(p.date); if (idx >= 0) expByMonth[idx] += parseFloat(p.amount) || 0; });
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
      const idx = _idxOf(r.period ? String(r.period).slice(0, 7) + '-01' : r.run_date);
      if (idx < 0) return;
      (r.lines || []).forEach(l => { expByMonth[idx] += (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0); });
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
    // F38 Step 4: issued bills accrue as expense by ISSUE date — RECOGNIZED_BILL, FULL amount.
    const _RECBILL = ['unpaid','due_soon','overdue','partial','paid'];
    exp += (window.bills || []).filter(b => _RECBILL.includes((b.status||'').toLowerCase()) && inP(b.issue_date || b.created_at || b.due_date)).reduce((s,b)=>s+(parseFloat(b.amount)||0),0);
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
        chgEl.className = 'mc-change dn';
      } else if (_ar.count > 0) {
        chgEl.textContent = `${_ar.count} unpaid invoice${_ar.count === 1 ? '' : 's'}`;
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
    if (!_fxOwned) set('d-invest', money(portfolio));   // F59: overlay owns this under a display currency
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
    const _w = (typeof window._periodWindow === 'function') ? window._periodWindow(_p) : null;
    const rows = _w ? (expenses || []).filter(e => _w.inWin(e.expense_date || e.date || e.created_at))
                    : (expenses || []);
    const cats = {};
    rows.forEach(e => {
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
        const w = (amt == null) ? '0%' : Math.round(amt / total * 100) + '%';
        barEl.style.setProperty('width', w, 'important');
        barEl.style.setProperty('--bar-w', w);
      }
      if (lblEl && cat != null) lblEl.textContent = cat;
    };
    for (let i = 0; i < 4; i++) _paint(i, null, null);          // clear
    sorted.slice(0, 4).forEach(([cat, amt], i) => _paint(i, cat, amt));   // then paint
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
    // F56: same canonical AR definition as the dashboard card — Σ max(0, amount − amount_paid)
    // over recognized statuses. "Collected" is its mirror: Σ amount_paid, so out + collected
    // equals total billed and the percentage is honest for partially-paid invoices too (which
    // the old paid-vs-unpaid split counted entirely on one side or the other).
    const outAmt  = ((typeof window._arOutstanding === 'function') ? window._arOutstanding(invoices).total : 0);
    const paidAmt = invoices.reduce((s, i) => s + (parseFloat(i.amount_paid) || 0), 0);
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
    var _bdwSeq = window._entitySwitchSeq || 0;   // F151 stale-response guard: token captured at start
    try {
      // Get active entity_id to filter correctly
      const activeEntity = (window.ENTITIES || []).find(e => e.active);
      const eid = activeEntity?._dbId;
      const eq = eid ? '?entity_id=' + eid : '';
      const [invoices, expenses] = await Promise.all([
        apiGetStatus('/api/invoices' + eq),
        apiGetStatus('/api/expenses' + eq),
      ]);

      // F151 stale-response guard: if a switch happened while these fetches were in flight, a newer
      // load owns the dashboard — discard this stale result instead of clobbering _realInvoices (the
      // tab-refocus bug where a backgrounded Saige fetch resolved late and painted Saige under Acme).
      if ((window._entitySwitchSeq || 0) !== _bdwSeq) return;
      // Store globally so period switching can re-use
      window._realInvoices = invoices || [];
      window._realExpenses = expenses || [];

      // Stash the entity-scoped FIFO COGS total for the canonical Net (Revenue − COGS − OpEx)
      // that app-main updateDashboard / AI / health score subtract. Non-inventory → 0.
      try { const _c = await apiGetStatus('/api/cogs' + eq); window._cogsTotal = parseFloat(_c && _c.totalCOGS) || 0; }
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
      const _fyWin = FD.resolvePeriod({ period: 'year', fyStartMonth: _fyStartIdx, today: FD.resolvedToday(new Date()) });
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
