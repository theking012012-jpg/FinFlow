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
        <div class="field-wrap"><label class="field-label">Employee *</label><input class="finput" id="ts-employee" placeholder="Name or team member"></div>
        <div class="field-wrap"><label class="field-label">Project / Client</label><input class="finput" id="ts-project" placeholder="Project or client name"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Date</label><input class="finput" id="ts-date" type="date"></div>
        <div class="field-wrap"><label class="field-label">Hours *</label><input class="finput" id="ts-hours" type="number" min="0.25" step="0.25" placeholder="e.g. 2.5"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Billable?</label><select class="finput" id="ts-billable"><option value="Yes">Yes — billable</option><option value="No">No — internal</option></select></div>
        <div class="field-wrap"><label class="field-label">Rate ($/hr)</label><input class="finput" id="ts-rate" type="number" min="0" placeholder="0"></div>
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
  // Status-aware GET for this scoped surface — attaches HTTP status so a genuine
  // failure (5xx / network) is distinguishable from logged-out (401/403). Local;
  // the shared api() copies are left untouched.
  async function apiGetStatus(path) {
    const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { const e = new Error('API error ' + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  // Reports KPI three-state renderer. 'loaded' is set inline below; this covers the
  // loading and load-failed states over the #page-reports metric cards.
  function _reportsSetState(state) {
    const mcs  = document.querySelectorAll('#page-reports .mc-val');
    const chgs = document.querySelectorAll('#page-reports .mc-change');
    if (state === 'loading') {
      [0, 1, 2].forEach(i => { if (mcs[i]) mcs[i].textContent = '…'; });
      if (chgs[1]) { chgs[1].textContent = 'Loading…'; chgs[1].className = 'mc-change neutral'; }
    } else if (state === 'error') {
      [0, 1, 2].forEach(i => { if (mcs[i]) mcs[i].textContent = '—'; });
      if (chgs[1]) {
        chgs[1].innerHTML = 'Unable to load · ' + (window._ffRetryBtn ? window._ffRetryBtn('window.renderReports&&window.renderReports()') : 'Retry');
        chgs[1].className = 'mc-change dn';
      }
    }
  }
  const _origRenderReports = typeof renderReports === 'function' ? renderReports : null;
  window.renderReports = async function () {
    if (_origRenderReports) _origRenderReports();   // static lists render immediately
    _reportsSetState('loading');
    try {
      const [invoices, expenses] = await Promise.all([
        apiGetStatus('/api/invoices'),
        apiGetStatus('/api/expenses'),
      ]);
      // ── F128 (second half): DELEGATE, exactly as generateReport does. ────────────────────────
      // This is the SAME defect as the report modal's, on the page BEHIND it: paid-only revenue
      // (the pre-F32 basis), Σ-expenses-only opex (no bills, no payroll, no F58 contras) and no
      // period window. The two were written separately and drifted together — which is why fixing
      // one and not the other would have left the Reports PAGE contradicting the Reports MODAL
      // launched from it, and both contradicting the dashboard.
      //
      // Rule 1 note: this function is a WRAPPER — it calls _origRenderReports() above (which paints
      // the static report lists) and then overwrites the metric cards. So these three cards are the
      // runtime-winning values; app-main's own paid-only recompute feeds only the onclick args that
      // the replacement generateReport ignores. Fixing it there would have rendered nothing.
      //
      // Same three sources as the modal, so page, modal and dashboard cannot disagree (Rule 6).
      if (typeof window.computeRevenue !== 'function' || typeof window.computeExpenseBreakdown !== 'function') {
        // Honest failure, never a fabricated total: the engines read window._realInvoices /
        // _realExpenses, so if they are absent a "0" here would read as a business with no revenue.
        const _e = new Error('Report engine not ready'); _e.status = 0; throw _e;
      }
      const period   = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
      const revenue  = window.computeRevenue(period);
      const expTotal = window.computeExpenseBreakdown(period).total;
      const cogs     = parseFloat(window._cogsTotal) || 0;
      const profit   = revenue - cogs - expTotal;      // the dashboard's composition (app-main.js:2167)
      // Native symbol: these come out of the engines unconverted (F124), and the shared money()
      // helper routes through S(), which would stamp activeCurrency on an unconverted figure.
      const _m = n => (typeof window._fmtMoneyNative === 'function') ? window._fmtMoneyNative(n) : money(n);
      const PERIOD_LABEL = { month: 'this month', quarter: 'this quarter', year: 'this fiscal year' };

      const mcs  = document.querySelectorAll('#page-reports .mc-val');
      const chgs = document.querySelectorAll('#page-reports .mc-change');
      if (mcs[0])  mcs[0].textContent  = invoices.length + expenses.length;
      if (chgs[0]) chgs[0].textContent  = 'Invoices & expenses on file';
      if (mcs[1])  mcs[1].textContent  = _m(revenue);
      // The old caption read "Paid revenue this period" — wrong on BOTH counts once this is accrual
      // AND period-scoped, and a stale caption on a corrected figure is its own defect.
      if (chgs[1]) { chgs[1].textContent = 'Revenue issued, ' + (PERIOD_LABEL[period] || period); chgs[1].className = 'mc-change up'; }
      if (mcs[2])  mcs[2].textContent  = _m(profit);
      if (chgs[2]) { chgs[2].textContent = profit >= 0 ? 'Net profit' : 'Net loss'; chgs[2].className = 'mc-change ' + (profit >= 0 ? 'up' : 'dn'); }
    } catch (err) {
      // Logged-out (401/403) or pre-auth: keep the static content, stay silent.
      // Only a genuinely authenticated failure shows the in-place error state.
      if (!window._ffAuthed || err.status === 401 || err.status === 403) return;
      _reportsSetState('error');
    }
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
      const rows = await api('GET', '/api/holdings?scope=personal');   // personal = entity_id NULL only
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
          <div><label class="flabel">Project Name *</label><input id="proj-name" class="finput" placeholder="e.g. RetailCo Portal v2"></div>
          <div><label class="flabel">Client</label><input id="proj-client" class="finput" placeholder="Client name"></div>
          <div><label class="flabel">Budget ($)</label><input id="proj-budget" class="finput" type="number" min="0" placeholder="0"></div>
          <div><label class="flabel">Status</label>
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
      // F137-g: the rich reports are taller than the viewport, so the shell is a flex column capped at
      // 88vh with a SCROLLING body — otherwise the modal overflows and clips the top KPIs / bottom Net
      // Profit (as it did on first ship). Header + footer stay pinned; #rpt-body scrolls (min-height:0
      // lets the flex child actually shrink and scroll).
      modal.innerHTML = `<div class="modal" style="max-width:480px;max-height:88vh;display:flex;flex-direction:column">
        <div class="modal-header" style="flex:0 0 auto">
          <div>
            <div class="modal-title" id="rpt-title"></div>
            <div class="modal-sub" id="rpt-sub"></div>
          </div>
          <button class="modal-close" onclick="document.getElementById('report-gen-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div id="rpt-body" style="margin-top:12px;font-size:13px;color:var(--t2);overflow-y:auto;flex:1 1 auto;min-height:0">Loading…</div>
        <div class="modal-footer" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;flex:0 0 auto">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('report-gen-modal').classList.add('hidden')">Close</button>
          <button class="btn btn-primary btn-sm" onclick="window.print()">Print ↗</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    // F137 print-optimization: the "Print" button calls window.print(), which otherwise prints the
    // whole dark app. This @media-print sheet (injected once) hides everything except the report and
    // REDEFINES the theme CSS variables to a light palette scoped to the modal — because the report is
    // built from var(--...)-driven inline styles, flipping the vars re-themes every element (tiles,
    // bars, text) to dark-on-white for paper without touching the on-screen (dark) rendering.
    // NOTE: on-paper appearance is owner-confirmed via print preview — jsdom cannot render @media print.
    if (!document.getElementById('rpt-print-css')) {
      const _pcss = document.createElement('style');
      _pcss.id = 'rpt-print-css';
      _pcss.textContent = '@media print {'
        + ' body > *:not(#report-gen-modal){display:none !important;}'
        + ' #report-gen-modal{position:static !important;background:#fff !important;}'
        + ' #report-gen-modal .modal{--bg2:#f4f1ea;--bd:#d9d2c4;--t1:#1a1712;--t2:#3a352c;--t3:#6a6255;--green:#1f7a44;--red:#a23b2e;--acc:#9a7d2e;background:#fff !important;color:#111 !important;max-width:none !important;max-height:none !important;box-shadow:none !important;border:none !important;}'
        + ' #report-gen-modal #rpt-body{overflow:visible !important;max-height:none !important;}'
        + ' #report-gen-modal .modal-footer, #report-gen-modal .modal-close{display:none !important;}'
        + ' @page{margin:14mm;}'
        + '}';
      document.head.appendChild(_pcss);
    }
    document.getElementById('rpt-title').textContent = name;
    document.getElementById('rpt-sub').textContent = 'Generated ' + new Date().toLocaleDateString();
    document.getElementById('rpt-body').innerHTML = '<div style="color:var(--t3)">Loading data…</div>';
    modal.classList.remove('hidden');

    try {
      // ── F137 (per-report renderers). Shared cell helpers. `m` is the app's native money formatter,
      // so these reports read money exactly as every other surface does (F124). ─────────────────────
      const m = n => (typeof window._fmtMoneyNative === 'function')
        ? window._fmtMoneyNative(n)
        : (typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toFixed(2));
      const hdr = l => `<div style="font-size:11px;color:var(--acc, #c8a44a);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:9px 0 4px;border-bottom:1px solid var(--acc-bg, rgba(200,164,74,.18));margin-bottom:2px">${l}</div>`;
      const row = (label, val, opts = {}) => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd)${opts.bold ? ';font-weight:600' : ''}"><span style="color:var(--t2)">${e(label)}</span><span style="font-family:var(--font-mono)${opts.color ? `;color:${opts.color}` : ''}">${val}</span></div>`;
      const _rptBody = html => { document.getElementById('rpt-body').innerHTML = html; };
      // ── F137 rich shared helpers (used across the report renderers). ────────────────────────────
      const _gold = 'var(--acc, #c8a44a)';
      const tile = (label, val, sub, cls) => `<div style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:9px 10px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3)">${e(label)}</div><div style="font-size:17px;font-weight:600;margin-top:4px;color:${cls || 'var(--t1)'};font-family:var(--font-mono)">${val}</div>${sub ? `<div style="font-size:10px;color:var(--t3);margin-top:2px">${e(sub)}</div>` : ''}</div>`;
      const tiles = arr => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">${arr.join('')}</div>`;
      const pillHtml = t => `<span style="font-size:10px;font-weight:600;color:${_gold};background:rgba(200,164,74,.14);border-radius:5px;padding:2px 7px;margin-left:6px">${e(t)}</span>`;
      // A share-bar row: label + amount + a proportional bar (share of `denom`).
      const shareRow = (label, amt, denom, color) => `<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--t2)">${e(label)}</span><span style="font-family:var(--font-mono);color:${color || 'var(--t1)'}">${m(amt)}</span></div><div style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i style="display:block;height:100%;background:${_gold};opacity:.75;width:${denom > 0 ? Math.max(2, Math.round(Math.abs(amt) / denom * 100)) : 0}%"></i></div></div>`;
      // Paired-series monthly SVG bar chart (rows: [{label, a, b}]). Inline SVG → prints cleanly.
      const barChart = (cap, series, aLabel, bLabel) => {
        const rws = series.slice(-6);
        if (!rws.length) return '';
        const maxV = Math.max(1, ...rws.map(r => Math.max(Math.abs(r.a || 0), Math.abs(r.b || 0))));
        const CW = 440, CH = 108, base = CH - 4, gw = CW / rws.length, bw = Math.min(15, gw / 3.2);
        let bars = '';
        rws.forEach((r, i) => {
          const cx = i * gw + gw / 2;
          const ah = Math.round((Math.abs(r.a || 0) / maxV) * (base - 6));
          const bh = Math.round((Math.abs(r.b || 0) / maxV) * (base - 6));
          bars += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${base - ah}" width="${bw.toFixed(1)}" height="${ah}" rx="1" fill="${_gold}"/>`;
          bars += `<rect x="${(cx + 1).toFixed(1)}" y="${base - bh}" width="${bw.toFixed(1)}" height="${bh}" rx="1" fill="var(--t3)"/>`;
        });
        const xl = rws.map(r => `<span style="flex:1;text-align:center">${e(r.label || '')}</span>`).join('');
        return `<div style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:11px 12px;margin-bottom:14px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:8px">${e(cap)}</div>
          <svg viewBox="0 0 ${CW} ${CH}" style="width:100%;height:104px;display:block" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${base}" x2="${CW}" y2="${base}" stroke="var(--bd,#2b2620)"/>${bars}</svg>
          <div style="display:flex;font-size:9px;color:var(--t3);margin-top:3px">${xl}</div>
          <div style="font-size:10px;color:var(--t3);text-align:right;margin-top:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${_gold};margin:0 4px 0 8px;vertical-align:middle"></span>${e(aLabel)}<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--t3);margin:0 4px 0 10px;vertical-align:middle"></span>${e(bLabel)}</div>
        </div>`;
      };

      // ── F137-a: the Balance Sheet report must render an ACTUAL balance sheet (assets /
      // liabilities / equity), NOT the generic P&L overview below. app-main.js:5647 had this but is
      // dead-shadowed by this winner. Delegates to the canonical /api/reports/balance-sheet (AR via
      // computeBooks; AP = Σ max(0, amount − amount_paid), which F135 made correct), and honors F123:
      // cash is NOT tracked, so it is shown as "Not tracked", never a fabricated $0, and Total Assets
      // is labelled as excluding it. Returns before the generic render so the P&L cards do not also show.
      if (name === 'Balance Sheet') {
        const bs = await api('POST', '/api/reports/balance-sheet', {});
        const cashCell = bs.cashTracked === false ? '<span style="color:var(--t3)">Not tracked</span>' : m(bs.cash);
        const ta = parseFloat(bs.totalAssets) || 0, tl = parseFloat(bs.totalLiabilities) || 0, eq = parseFloat(bs.equity) || 0;
        const denomBS = Math.max(1, ta, tl);
        _rptBody(
          tiles([
            tile('Total Assets', m(ta), 'excl. untracked cash', 'var(--green)'),
            tile('Total Liabilities', m(tl), 'accounts payable', 'var(--red)'),
            tile('Equity', m(eq), 'assets − liabilities', eq >= 0 ? 'var(--green)' : 'var(--red)'),
            tile('Receivable', m(bs.accountsReceivable), 'outstanding AR'),
          ])
          + hdr('Assets vs Liabilities')
          + shareRow('Assets', ta, denomBS, 'var(--green)')
          + shareRow('Liabilities', tl, denomBS, 'var(--red)')
          + hdr('Assets')
          + row('Cash & Equivalents', cashCell)
          + row('Accounts Receivable', m(bs.accountsReceivable), { color: 'var(--green)' })
          + row('Total Assets (excl. untracked cash)', m(ta), { bold: true })
          + hdr('Liabilities')
          + row('Accounts Payable', m(bs.accountsPayable), { color: 'var(--red)' })
          + row('Total Liabilities', m(tl), { color: 'var(--red)', bold: true })
          + `<div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Equity</span><span style="font-family:var(--font-mono);color:${eq >= 0 ? 'var(--green)' : 'var(--red)'}">${m(eq)}</span></div>`);
        return;
      }

      // ── F137-b: Cash Flow Statement — monthly inflow/outflow/net from the SHARED cash cache
      // (_cashMonthly, POST /api/reports/cash-flow), the same array the dashboard cash card reads,
      // so the two cannot drift (F57/D3). Pure delegation — no recompute. ──────────────────────────
      if (name === 'Cash Flow Statement') {
        if (typeof window._loadCashMonthly === 'function') await window._loadCashMonthly();
        const rows = window._cashMonthly || [];
        const tin = rows.reduce((s, r) => s + (parseFloat(r.inflow) || 0), 0);
        const tout = rows.reduce((s, r) => s + (parseFloat(r.outflow) || 0), 0);
        const net = tin - tout;
        const detail = rows.map(r => {
          const rn = (parseFloat(r.inflow) || 0) - (parseFloat(r.outflow) || 0);
          return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd)"><span style="color:var(--t2)">${e(r.month || '')}</span><span style="color:var(--t3);font-family:var(--font-mono);font-size:11px">${m(r.inflow)} in / ${m(r.outflow)} out</span><span style="font-family:var(--font-mono);color:${rn >= 0 ? 'var(--green)' : 'var(--red)'}">${m(rn)}</span></div>`;
        }).join('');
        _rptBody(
          tiles([
            tile('Net Cash Flow', m(net), 'inflow − outflow', net >= 0 ? 'var(--green)' : 'var(--red)'),
            tile('Total Inflow', m(tin), 'received', 'var(--green)'),
            tile('Total Outflow', m(tout), 'paid out', 'var(--red)'),
            tile('Active Months', String(rows.length), 'with cash activity'),
          ])
          + barChart('Cash in vs out — monthly', rows.map(r => ({ label: r.month, a: parseFloat(r.inflow) || 0, b: parseFloat(r.outflow) || 0 })), 'Inflow', 'Outflow')
          + hdr('Monthly detail')
          + (detail || '<div style="padding:8px 0;color:var(--t3);font-size:12px">No cash movement recorded.</div>')
          + `<div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Net Cash Flow</span><span style="font-family:var(--font-mono);color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${m(net)}</span></div>`);
        return;
      }

      // ── F137-c: Accounts Receivable — outstanding customer balances. The TOTAL is the canonical
      // _arOutstanding (F56, the same figure the dashboard/balance-sheet use). The per-customer rows
      // are a breakdown using the IDENTICAL per-invoice rule (RECOGNIZED, not future-dated,
      // Σ max(0, amount − amount_paid)), so Σ rows == total by construction (asserted in the harness),
      // not a second implementation of the total. ─────────────────────────────────────────────────
      if (name === 'Accounts Receivable') {
        const invs = (await api('GET', '/api/invoices')) || [];
        const ar = (typeof window._arOutstanding === 'function') ? window._arOutstanding(invs) : { total: 0 };
        const REC = ['pending', 'overdue', 'partial', 'paid'];
        const today = window.FinFlowDates ? window.FinFlowDates.resolvedToday(new Date()) : null;
        const byCust = {};
        invs.forEach(i => {
          const st = (i.status || '').toLowerCase(); if (!REC.includes(st)) return;
          const dy = window.FinFlowDates ? window.FinFlowDates._toYmd(i.issue_date || i.created_at || i.date) : null;
          if (today != null && (dy == null || dy > today)) return;
          const due = Math.max(0, (parseFloat(i.amount) || 0) - (parseFloat(i.amount_paid) || 0));
          if (due <= 0) return;
          const cst = i.client || '—'; byCust[cst] = (byCust[cst] || 0) + due;
        });
        const entries = Object.entries(byCust).sort((a, b) => b[1] - a[1]);
        const rows = entries.map(([c, amt]) => shareRow(c, amt, ar.total || 1, 'var(--red)')).join('');
        _rptBody(
          tiles([
            tile('Total Receivable', m(ar.total), (ar.count || 0) + ' open', 'var(--green)'),
            tile('Overdue', m(ar.overdueTotal || 0), (ar.overdueCount || 0) + ' invoices', (ar.overdueTotal || 0) > 0 ? 'var(--red)' : 'var(--t2)'),
          ])
          + hdr('Outstanding by customer')
          + (rows || '<div style="padding:8px 0;color:var(--t3);font-size:12px">No outstanding receivables.</div>')
          + row('Total Receivable', m(ar.total), { bold: true, color: 'var(--green)' }));
        return;
      }

      // ── F137-d: Accounts Payable — outstanding vendor balances. The TOTAL is the canonical
      // /api/reports/balance-sheet accountsPayable (Σ max(0, amount − amount_paid), F135). Per-vendor
      // rows use the IDENTICAL server AP rule (RECOGNIZED_BILL, not future-dated), so Σ rows == total. ─
      if (name === 'Accounts Payable') {
        const bs = await api('POST', '/api/reports/balance-sheet', {});
        const bills = (await api('GET', '/api/bills')) || [];
        const REC = ['unpaid', 'due_soon', 'overdue', 'partial', 'paid'];
        const today = window.FinFlowDates ? window.FinFlowDates.resolvedToday(new Date()) : null;
        const byVendor = {};
        bills.forEach(b => {
          const st = (b.status || '').toLowerCase(); if (!REC.includes(st)) return;
          const dy = window.FinFlowDates ? window.FinFlowDates._toYmd(b.issue_date || b.created_at || b.due_date) : null;
          if (today != null && (dy == null || dy > today)) return;
          const due = Math.max(0, (parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0));
          if (due <= 0) return;
          const v = b.vendor || '—'; byVendor[v] = (byVendor[v] || 0) + due;
        });
        const apTotal = parseFloat(bs.accountsPayable) || 0;
        const entries = Object.entries(byVendor).sort((a, b) => b[1] - a[1]);
        const rows = entries.map(([v, amt]) => shareRow(v, amt, apTotal || 1, 'var(--red)')).join('');
        _rptBody(
          tiles([
            tile('Total Payable', m(apTotal), entries.length + ' vendor' + (entries.length === 1 ? '' : 's'), 'var(--red)'),
            tile('Largest', entries.length ? m(entries[0][1]) : m(0), entries.length ? String(entries[0][0]) : '—'),
          ])
          + hdr('Outstanding by vendor')
          + (rows || '<div style="padding:8px 0;color:var(--t3);font-size:12px">No outstanding payables.</div>')
          + row('Total Payable', m(apTotal), { bold: true, color: 'var(--red)' }));
        return;
      }

      // ── F137-e: Sales by Customer — recognized revenue grouped by client, over the active period.
      // Per-customer rows mirror computeRevenue's INVOICE leg EXACTLY (same _realInvoices, same
      // _periodWindow, same RECOGNIZED allowlist, issue-date basis — F32), so their sum equals the
      // invoice portion of the canonical computeRevenue by construction. The TOTAL is computeRevenue
      // itself; any gap (cash receipts +, credit notes −, neither customer-attributed) is shown as one
      // explicit "unattributed" row so Σ(rows) == Total, not a second revenue implementation. ────────
      if (name === 'Sales by Customer') {
        const period = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
        const PERIOD_LABEL = { month: 'this month', quarter: 'this quarter', year: 'this fiscal year' };
        const w = (typeof window._periodWindow === 'function') ? window._periodWindow(period) : null;
        const REC = ['pending', 'overdue', 'partial', 'paid'];
        const byCust = {};
        let invoiced = 0;
        (window._realInvoices || []).forEach(i => {
          if (!REC.includes((i.status || '').toLowerCase())) return;
          if (w && !w.inWin(i.issue_date || i.created_at || i.date)) return;
          const amt = parseFloat(i.amount) || 0;
          const c = i.client || '—'; byCust[c] = (byCust[c] || 0) + amt; invoiced += amt;
        });
        const total = (typeof window.computeRevenue === 'function') ? window.computeRevenue(period) : invoiced;
        const entries = Object.entries(byCust).sort((a, b) => b[1] - a[1]);
        const denomS = Math.max(1, total, invoiced);
        const custRows = entries.map(([c, amt]) => shareRow(c, amt, denomS, 'var(--green)')).join('');
        const remainder = Math.round((total - invoiced) * 100) / 100;
        const remRow = Math.abs(remainder) >= 0.01 ? row('Cash sales / credits (unattributed)', m(remainder), { color: 'var(--t2)' }) : '';
        _rptBody(
          tiles([
            tile('Total Revenue', m(total), PERIOD_LABEL[period] || period, 'var(--green)'),
            tile('Top Customer', entries.length ? m(entries[0][1]) : m(0), entries.length ? String(entries[0][0]) : '—'),
          ])
          + hdr('Revenue by customer — ' + (PERIOD_LABEL[period] || period))
          + (custRows || '<div style="padding:8px 0;color:var(--t3);font-size:12px">No invoiced revenue in this period.</div>')
          + remRow
          + row('Total Revenue', m(total), { bold: true, color: 'var(--green)' }));
        return;
      }

      // ── F137-f: Payroll Summary — one row per payroll run (period · status · gross · net). Gross is
      // Σ of the run's LINE items (gross+bonus+overtime), the SINGLE SOURCE OF TRUTH per basis C /
      // Rule 12 — NOT the stored total_gross header (which can diverge; that divergence is F-space, not
      // reconciled silently here). Net is Σ line net_pay. ────────────────────────────────────────────
      if (name === 'Payroll Summary') {
        const runs = (await api('GET', '/api/payroll-runs')) || [];
        const lineGross = l => (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0);
        const runData = runs.map(r => {
          const lines = Array.isArray(r.lines) ? r.lines.filter(Boolean) : [];
          return { period: r.period || '', status: (r.status || '').toLowerCase(),
            g: lines.reduce((s, l) => s + lineGross(l), 0), n: lines.reduce((s, l) => s + (parseFloat(l.net_pay) || 0), 0) };
        });
        const tGross = runData.reduce((s, x) => s + x.g, 0);
        const tNet = runData.reduce((s, x) => s + x.n, 0);
        const gDen = Math.max(1, ...runData.map(x => x.g));
        const runRows = runData.map(x => `<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--t2)">${e(x.period)} <span style="color:var(--t3);font-size:11px">${e(x.status)}</span></span><span style="font-family:var(--font-mono)">net ${m(x.n)}</span></div><div style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i style="display:block;height:100%;background:${_gold};opacity:.75;width:${Math.max(2, Math.round(x.g / gDen * 100))}%"></i></div><div style="font-size:10px;color:var(--t3);margin-top:2px">gross ${m(x.g)}</div></div>`).join('');
        _rptBody(
          tiles([
            tile('Total Gross', m(tGross), 'Σ line items (basis C)', 'var(--red)'),
            tile('Total Net', m(tNet), 'take-home', 'var(--green)'),
            tile('Runs', String(runData.length), 'payroll runs'),
            tile('Deductions', m(Math.round((tGross - tNet) * 100) / 100), 'gross − net'),
          ])
          + hdr('Payroll runs (gross = Σ line items, basis C)')
          + (runRows || '<div style="padding:8px 0;color:var(--t3);font-size:12px">No payroll runs yet.</div>')
          + `<div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Total Gross / Net</span><span style="font-family:var(--font-mono)">${m(tGross)} / ${m(tNet)}</span></div>`);
        return;
      }

      // ── F137-g: Profit & Loss Statement — a RICH statement: hero KPI tiles, a monthly
      // revenue-vs-expenses chart (inline SVG — prints/exports cleanly, unlike a canvas), then the
      // full statement with per-category expense share-bars and margin pills. Delegates to
      // /api/reports/profit-loss (canonical computeBooks totals + dated monthly rows) for the figures
      // and window.computeExpenseBreakdown for the manual-category split; every category + Payroll +
      // a "Bills & other" remainder reconcile to the canonical Total Operating Expenses. ────────────
      if (name === 'Profit & Loss Statement') {
        const d = await api('POST', '/api/reports/profit-loss', {});
        const prows = Array.isArray(d.rows) ? d.rows : [];
        const rev = parseFloat(d.totalRevenue) || 0, cogs = parseFloat(d.cogs) || 0, gp = parseFloat(d.grossProfit) || 0;
        const pay = parseFloat(d.payroll) || 0, exp = parseFloat(d.totalExpenses) || 0, net = parseFloat(d.netProfit) || 0;
        const period = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
        const pct = (n, dd) => dd > 0 ? (Math.round((n / dd) * 1000) / 10) + '%' : '—';
        const gold = 'var(--acc, #c8a44a)';

        // Hero KPI tiles.
        const tile = (label, val, sub, cls) => `<div style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:9px 10px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3)">${e(label)}</div><div style="font-size:17px;font-weight:600;margin-top:4px;color:${cls || 'var(--t1)'};font-family:var(--font-mono)">${val}</div><div style="font-size:10px;color:var(--t3);margin-top:2px">${e(sub)}</div></div>`;
        const kpis = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          ${tile('Revenue', m(rev), 'issued', 'var(--green)')}
          ${tile('Gross Profit', m(gp), pct(gp, rev) + ' margin')}
          ${tile('Net Profit', m(net), pct(net, rev) + ' net margin', net >= 0 ? 'var(--green)' : 'var(--red)')}
          ${tile('Expenses', m(exp), 'incl. payroll + COGS', 'var(--red)')}
        </div>`;

        // Monthly revenue-vs-expenses chart (last 6 months of dated rows).
        const rws = prows.slice(-6);
        let chart = '';
        if (rws.length) {
          const maxV = Math.max(1, ...rws.map(r => Math.max(parseFloat(r.revenue) || 0, parseFloat(r.expenses) || 0)));
          const CW = 440, CH = 108, base = CH - 4, groupW = CW / rws.length, bw = Math.min(15, groupW / 3.2);
          let bars = '';
          rws.forEach((r, i) => {
            const cx = i * groupW + groupW / 2;
            const rh = Math.round(((parseFloat(r.revenue) || 0) / maxV) * (base - 6));
            const eh = Math.round(((parseFloat(r.expenses) || 0) / maxV) * (base - 6));
            bars += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${base - rh}" width="${bw.toFixed(1)}" height="${rh}" rx="1" fill="${gold}"/>`;
            bars += `<rect x="${(cx + 1).toFixed(1)}" y="${base - eh}" width="${bw.toFixed(1)}" height="${eh}" rx="1" fill="var(--t3)"/>`;
          });
          const xl = rws.map(r => `<span style="flex:1;text-align:center">${e(r.month || '')}</span>`).join('');
          chart = `<div style="background:var(--bg2,#1e1a14);border:1px solid var(--bd,#2b2620);border-radius:9px;padding:11px 12px;margin-bottom:14px">
            <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:8px">Revenue vs Expenses — monthly</div>
            <svg viewBox="0 0 ${CW} ${CH}" style="width:100%;height:104px;display:block" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${base}" x2="${CW}" y2="${base}" stroke="var(--bd,#2b2620)"/>${bars}</svg>
            <div style="display:flex;font-size:9px;color:var(--t3);margin-top:3px">${xl}</div>
            <div style="font-size:10px;color:var(--t3);text-align:right;margin-top:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${gold};margin:0 4px 0 8px;vertical-align:middle"></span>Revenue<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--t3);margin:0 4px 0 10px;vertical-align:middle"></span>Expenses</div>
          </div>`;
        }

        // Operating-expense category share-bars: manual categories + Payroll + a reconciling
        // "Bills & other" remainder, so Σ == the canonical Total Operating Expenses (exp).
        // byCategory is MANUAL expense rows only; bd.total is the FULL opex (bills + payments +
        // payroll too), so the remainder must be exp − payroll − Σ(manual categories), NOT
        // exp − payroll − bd.total (which double-subtracts and drove a bogus negative "Bills & other").
        const bd = (typeof window.computeExpenseBreakdown === 'function') ? window.computeExpenseBreakdown(period) : { byCategory: {} };
        const catList = Object.entries(bd.byCategory || {}).map(([c, a]) => [c, parseFloat(a) || 0]);
        const manualCatsSum = catList.reduce((s, kv) => s + kv[1], 0);
        const billsOther = Math.round((exp - pay - manualCatsSum) * 100) / 100;
        catList.push(['Payroll', pay]);
        if (Math.abs(billsOther) >= 0.01) catList.push(['Bills & other', billsOther]);
        catList.sort((a, b) => b[1] - a[1]);
        const catBar = ([label, amt]) => `<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--t2)">${e(label)}</span><span style="font-family:var(--font-mono);color:var(--red)">${m(amt)}</span></div><div style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i style="display:block;height:100%;background:${gold};opacity:.75;width:${exp > 0 ? Math.max(2, Math.round((amt / exp) * 100)) : 0}%"></i></div></div>`;
        const pill = t => `<span style="font-size:10px;font-weight:600;color:${gold};background:rgba(200,164,74,.14);border-radius:5px;padding:2px 7px;margin-left:6px">${e(t)}</span>`;

        _rptBody(
          kpis
          + chart
          + hdr('Revenue')
          + row('Total Revenue', m(rev), { bold: true, color: 'var(--green)' })
          + hdr('Cost of Sales')
          + row('Cost of Goods Sold (FIFO)', '− ' + m(cogs), { color: 'var(--red)' })
          + `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd);font-weight:600"><span>Gross Profit ${pill(pct(gp, rev) + ' margin')}</span><span style="font-family:var(--font-mono)">${m(gp)}</span></div>`
          + hdr('Operating Expenses')
          + catList.map(catBar).join('')
          + row('Total Operating Expenses', m(exp), { bold: true, color: 'var(--red)' })
          + `<div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:700"><span>Net Profit ${pill(pct(net, rev) + ' net margin')}</span><span style="font-family:var(--font-mono);color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${m(net)}</span></div>`);
        return;
      }

      // ── F137-j: Tax-Deductible Expenses — deductible business costs grouped by category. Real
      // data: expenses carry a `deductible` flag (server.js:1036); same basis as /api/tax-filing.
      // Σ(category rows) == Total Deductible by construction. ──────────────────────────────────────
      if (name === 'Tax-Deductible Expenses') {
        const exps = (await api('GET', '/api/expenses')) || [];
        const isDed = x => { const d = x.deductible; return d === true || /^(yes|true|1|y)$/i.test(String(d || '')); };
        const byCat = {}; let ded = 0, nonDed = 0, dedCount = 0;
        exps.forEach(x => {
          const amt = parseFloat(x.amount) || 0;
          if (isDed(x)) { const c = x.category || 'Other'; byCat[c] = (byCat[c] || 0) + amt; ded += amt; dedCount++; }
          else nonDed += amt;
        });
        const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        const rows = entries.map(([c, a]) => shareRow(c, a, ded || 1, 'var(--green)')).join('');
        _rptBody(
          tiles([
            tile('Total Deductible', m(ded), dedCount + ' expense' + (dedCount === 1 ? '' : 's'), 'var(--green)'),
            tile('Not Deductible', m(nonDed), 'excluded from tax', 'var(--t2)'),
          ])
          + hdr('Deductible by category')
          + (rows || '<div style="padding:8px 0;color:var(--t3);font-size:12px">No deductible expenses recorded.</div>')
          + row('Total Deductible', m(ded), { bold: true, color: 'var(--green)' }));
        return;
      }

      // ── F137-k: Income Tax Estimate — consumes /api/tax-filing (taxable = revenue − deductibles;
      // estimatedTax = taxable × 25%; quarterly = /4). The 25% is a FLAT PLACEHOLDER (server.js:3720),
      // surfaced as an explicit "rough estimate, not tax advice" banner — never authoritative. ──────
      if (name === 'Income Tax Estimate') {
        // Multi-line estimate WORKSHEET (F137-k). Each line is a % of taxable income, a % of revenue,
        // or a fixed amount, summed. Cross-border obligations (foreign tax credits, worldwide income,
        // capital gains not tracked here) are entered as fixed lines. NOT a tax engine — a worksheet.
        const [t, st] = await Promise.all([
          api('GET', '/api/tax-filing').catch(() => ({})),
          api('GET', '/api/settings').catch(() => ({})),
        ]);
        window._taxTaxable = parseFloat((t || {}).taxableIncome) || 0;
        window._taxRevenue = parseFloat((t || {}).revenue) || 0;
        let saved = Array.isArray(st && st.tax_lines) ? st.tax_lines : null;
        if (!saved || !saved.length) {
          const legacy = (st && st.tax_rate != null && st.tax_rate !== '') ? parseFloat(st.tax_rate) : 25;
          saved = [{ label: 'Income tax', type: 'taxable', value: isFinite(legacy) ? legacy : 25, note: '' }];
        }
        window._taxLines = saved.map(l => ({
          label: String((l && l.label) || ''),
          type: ['taxable', 'revenue', 'fixed'].includes(l && l.type) ? l.type : 'taxable',
          value: parseFloat(l && l.value) || 0,
          note: String((l && l.note) || ''),
        }));

        const lineAmt = l => { const v = parseFloat(l.value) || 0; return l.type === 'revenue' ? (window._taxRevenue || 0) * v / 100 : l.type === 'fixed' ? v : (window._taxTaxable || 0) * v / 100; };
        const r2 = n => Math.round(n * 100) / 100;
        const totalTax = () => r2(window._taxLines.reduce((s, l) => s + lineAmt(l), 0));
        const persistTax = () => {
          const total = totalTax(), tx = window._taxTaxable || 0;
          const eff = tx > 0 ? r2(total / tx * 100) : 0;   // derived effective rate → accountant portal
          clearTimeout(window._taxSave);
          window._taxSave = setTimeout(() => { try { api('PUT', '/api/settings', { tax_lines: window._taxLines, tax_rate: eff }); } catch (_) { /* ignore */ } }, 500);
        };
        window._readTaxInputs = () => window._taxLines.forEach((l, i) => {
          const g = id => document.getElementById(id + i);
          if (g('tl-label-')) l.label = g('tl-label-').value;
          if (g('tl-val-')) l.value = parseFloat(g('tl-val-').value) || 0;
          if (g('tl-type-')) l.type = g('tl-type-').value;
          if (g('tl-note-')) l.note = g('tl-note-').value;
        });
        window.onTaxEdit = () => {
          window._readTaxInputs();
          window._taxLines.forEach((l, i) => { const a = document.getElementById('tl-amt-' + i); if (a) a.textContent = m(r2(lineAmt(l))); });
          const total = totalTax(), q = Math.round(total / 4);
          ['tl-total', 'tl-total2'].forEach(id => { const x = document.getElementById(id); if (x) x.textContent = m(total); });
          ['tl-quarter', 'tl-fq'].forEach(id => { const x = document.getElementById(id); if (x) x.textContent = m(q); });
          persistTax();
        };
        window.addTaxLine = () => { window._readTaxInputs(); window._taxLines.push({ label: '', type: 'taxable', value: 0, note: '' }); window._renderTaxWorksheet(); persistTax(); };
        window.removeTaxLine = (i) => { window._readTaxInputs(); window._taxLines.splice(i, 1); if (!window._taxLines.length) window._taxLines.push({ label: 'Income tax', type: 'taxable', value: 0, note: '' }); window._renderTaxWorksheet(); persistTax(); };
        window._renderTaxWorksheet = () => {
          const opt = (v, lbl, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${lbl}</option>`;
          const lineRows = window._taxLines.map((l, i) => `<div style="padding:8px 0;border-bottom:1px solid var(--bd)">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
              <input id="tl-label-${i}" value="${e(l.label)}" oninput="onTaxEdit()" placeholder="Tax name" style="flex:1;min-width:0;background:var(--bg,#0f0d0a);border:1px solid var(--bd,#2b2620);color:var(--t1);border-radius:6px;padding:5px 7px;font-size:12px">
              <input id="tl-val-${i}" type="number" step="0.1" min="0" value="${l.value}" oninput="onTaxEdit()" style="width:62px;text-align:right;font-family:var(--font-mono);background:var(--bg,#0f0d0a);border:1px solid var(--bd,#2b2620);color:var(--t1);border-radius:6px;padding:5px 6px;font-size:12px">
              <select id="tl-type-${i}" onchange="onTaxEdit()" style="background:var(--bg,#0f0d0a);border:1px solid var(--bd,#2b2620);color:var(--t1);border-radius:6px;padding:5px 4px;font-size:11px">${opt('taxable', '% taxable', l.type)}${opt('revenue', '% revenue', l.type)}${opt('fixed', 'fixed $', l.type)}</select>
              <button onclick="removeTaxLine(${i})" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 3px">✕</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <input id="tl-note-${i}" value="${e(l.note)}" oninput="onTaxEdit()" placeholder="note (optional)" style="flex:1;min-width:0;background:none;border:none;color:var(--t3);font-size:11px;padding:0">
              <span style="font-family:var(--font-mono);color:var(--red);font-size:12px">= <span id="tl-amt-${i}">${m(r2(lineAmt(l)))}</span></span>
            </div></div>`).join('');
          const total = totalTax(), q = Math.round(total / 4);
          _rptBody(
            `<div style="background:rgba(200,164,74,.12);border:1px solid var(--acc-bg, rgba(200,164,74,.3));border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:11px;color:var(--t2)">Add a line per tax you owe — each a % of taxable income, % of revenue, or a fixed amount. <strong>Rough estimate — not tax advice.</strong> Cross-border obligations (foreign tax credits, worldwide income, capital gains) aren't computed here — enter them as fixed amounts and consult a professional. Your lines also feed your accountant's Tax Summary.</div>`
            + tiles([
              tile('Estimated Tax', `<span id="tl-total">${m(total)}</span>`, 'sum of all lines', 'var(--red)'),
              tile('Per Quarter', `<span id="tl-quarter">${m(q)}</span>`, 'set aside each Q', 'var(--red)'),
              tile('Taxable Income', m(window._taxTaxable || 0), 'revenue − deductibles'),
              tile('Revenue', m(window._taxRevenue || 0), 'gross income'),
            ])
            + hdr('Tax lines')
            + lineRows
            + `<button onclick="addTaxLine()" style="margin-top:8px;background:none;border:1px dashed var(--acc,#c8a44a);color:var(--acc,#c8a44a);border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;width:100%">+ Add tax line</button>`
            + `<div style="margin-top:12px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:700"><span>Total Estimated Tax <span style="color:var(--t3);font-size:11px;font-weight:500">(<span id="tl-fq">${m(q)}</span>/quarter)</span></span><span style="font-family:var(--font-mono);color:var(--red)" id="tl-total2">${m(total)}</span></div>`);
        };
        window._renderTaxWorksheet();
        return;
      }

      // ── F137-l: VAT Return — FinFlow tracks NO VAT/GST (server.js:4009/4142). Honest "not tracked"
      // state (F123 class), never a fabricated return. ────────────────────────────────────────────
      if (name === 'VAT Return') {
        _rptBody(
          `<div style="text-align:center;padding:28px 16px;color:var(--t2)">
            <div style="font-size:30px;margin-bottom:10px">🧾</div>
            <div style="font-size:15px;font-weight:600;color:var(--t1);margin-bottom:6px">VAT / GST is not tracked</div>
            <div style="font-size:12px;color:var(--t3);line-height:1.5;max-width:340px;margin:0 auto">FinFlow doesn’t record VAT or sales tax on invoices or bills, so a VAT return can’t be produced from your data. If you’re VAT/GST-registered and need this, VAT tracking can be added as a feature.</div>
          </div>`);
        return;
      }

      // ── F137-m: 1099 / W-2 Summary — per-employee wages from real payroll runs (W-2-style; gross =
      // Σ line items, basis C). Contractor/1099 payments are NOT tracked, stated plainly. ───────────
      if (name === '1099 / W-2 Summary') {
        const runs = (await api('GET', '/api/payroll-runs')) || [];
        const lg = l => (parseFloat(l.gross) || 0) + (parseFloat(l.bonus) || 0) + (parseFloat(l.overtime) || 0);
        const byEmp = {}; let tG = 0, tN = 0;
        runs.forEach(r => (Array.isArray(r.lines) ? r.lines : []).filter(Boolean).forEach(l => {
          const nm = l.employee_name || '—'; const g = lg(l), n = parseFloat(l.net_pay) || 0;
          if (!byEmp[nm]) byEmp[nm] = { g: 0, n: 0 };
          byEmp[nm].g += g; byEmp[nm].n += n; tG += g; tN += n;
        }));
        const emps = Object.entries(byEmp).sort((a, b) => b[1].g - a[1].g);
        const gDen = Math.max(1, ...emps.map(([, v]) => v.g));
        const rows = emps.map(([nm, v]) => `<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--t2)">${e(nm)}</span><span style="font-family:var(--font-mono)">gross ${m(v.g)} · net ${m(v.n)}</span></div><div style="height:5px;background:var(--bd,#221e18);border-radius:3px;margin-top:5px;overflow:hidden"><i style="display:block;height:100%;background:${_gold};opacity:.75;width:${Math.max(2, Math.round(v.g / gDen * 100))}%"></i></div></div>`).join('');
        _rptBody(
          tiles([
            tile('Employees', String(emps.length), 'on payroll (W-2)'),
            tile('Total Wages', m(tG), 'gross, Σ line items', 'var(--red)'),
            tile('Total Withheld', m(Math.round((tG - tN) * 100) / 100), 'deductions'),
            tile('Total Net', m(tN), 'take-home', 'var(--green)'),
          ])
          + `<div style="background:rgba(200,164,74,.12);border:1px solid var(--acc-bg, rgba(200,164,74,.3));border-radius:8px;padding:8px 11px;margin-bottom:10px;font-size:11px;color:var(--t2)">Employee (W-2) wages from payroll runs. <strong>Contractor / 1099 payments are not separately tracked</strong> in FinFlow.</div>`
          + hdr('Employee wages (W-2)')
          + (rows || '<div style="padding:8px 0;color:var(--t3);font-size:12px">No payroll runs recorded.</div>')
          + `<div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Total Wages / Net</span><span style="font-family:var(--font-mono)">${m(tG)} / ${m(tN)}</span></div>`);
        return;
      }
      // ── F128: DELEGATE to the canonical client engines. Do NOT recompute. ────────────────────
      //
      // What was here: `invoices.filter(i => i.status === 'paid')` summed at full amount, plus
      // `Σ expenses` alone, both unwindowed. Three defects in four lines:
      //   · PAID-ONLY revenue is the PRE-F32 basis. F32 (owner decision, 18 July) moved
      //     recognition to ACCRUAL, ISSUE-BASED — allowlist pending/overdue/partial/paid — across
      //     computeBooks, computeRevenue, /api/reports, /books, the monthly buckets and the
      //     accountant portal. This function was missed, so the Reports page reported a revenue
      //     figure no other surface in the product agreed with. Same survival F76 records for
      //     GET /api/tax-filing — except that endpoint is unconsumed and this button is not.
      //   · EXPENSES omitted issued bills, orphan payments made and payroll entirely, so "Net
      //     Profit" was revenue-minus-some-expenses.
      //   · NO PERIOD. Both legs were all-time regardless of the period selector.
      // Credit notes and vendor credits (F58) were absent from both legs as well.
      //
      // The fix is delegation, not better arithmetic. Rule 2: this figure already has four
      // implementations (computeBooks, /api/reports, the client pair, and this) — writing a fifth
      // correct one just moves the next divergence. computeRevenue / computeExpenseBreakdown are
      // the canonical CLIENT pair the dashboard KPIs read, they carry every leg including the F58
      // contras, and step 4 gates them against VERIFICATION across four timezones. Sourcing from
      // them makes Reports agree with the dashboard BY CONSTRUCTION rather than by coincidence
      // (Rule 6) — a future basis change lands on both at once, which is the whole point.
      //
      // PERIOD — stated, not assumed. This report follows the app's ACTIVE period selector, the
      // same window every other money surface uses, and the modal now LABELS it. Previously it was
      // silently all-time; changing that without saying so on screen would move a number the user
      // had no way to explain. `currentPeriod` is a top-level `let` in app-main.js, so it lives in
      // the shared global LEXICAL scope, not on `window` (see F125) — hence the bare read with a
      // typeof guard, the pattern already used for it in the dashboard wiring.
      const period = (typeof currentPeriod !== 'undefined' && currentPeriod) ? currentPeriod : 'year';
      const PERIOD_LABEL = { month: 'this month', quarter: 'this quarter', year: 'this fiscal year' };
      if (typeof window.computeRevenue !== 'function' || typeof window.computeExpenseBreakdown !== 'function') {
        // Honest failure, never a fabricated total (class C6/C7): if the engines are not loaded
        // there is no figure to report, and a zero here would read as a business with no revenue.
        throw new Error('Report engine not ready — reload the page and try again.');
      }
      // F124 rule: these figures come out of the client engines NATIVE — nothing converts them —
      // so they carry the ENTITY's symbol. The shared `money()` helper in this file routes through
      // S(), which stamps activeCurrency, and would label an unconverted figure with the display
      // currency under a non-native selection. Scoped to this function; the other `money()` call
      // sites in this file are F129's sweep, not this commit's.
      const money = n => (typeof window._fmtMoneyNative === 'function')
        ? window._fmtMoneyNative(n)
        : (typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toFixed(2));
      const revenue  = window.computeRevenue(period);
      const breakdown = window.computeExpenseBreakdown(period);
      const expTotal = breakdown.total;
      // COGS is the THIRD leg of the canonical net, and leaving it out was the remaining way this
      // report could disagree with the dashboard. `updateDashboard` composes d-profit as
      // `revenue − COGS − opex` (app-main.js:2167), and the AI/insight surfaces use the identical
      // line at :4502 and :4539. Reproduced here rather than approximated: on the seed, omitting it
      // gives −300 where every other surface says −1,700 — the exact 1,400 of FY COGS.
      // `window._cogsTotal` is the client's PERIOD-SCOPED COGS, refetched by _loadPeriodCOGS on
      // every period switch (F25); a non-inventory business leaves it 0 and net == revenue − opex.
      const cogs     = parseFloat(window._cogsTotal) || 0;
      const profit   = revenue - cogs - expTotal;
      // Outstanding stays as it was: already canonical via _arOutstanding (F56), and AR is an
      // all-time balance-sheet figure by design — it deliberately does NOT take the period window.
      const invoices = await api('GET', '/api/invoices');
      const outstanding = (typeof window._arOutstanding === 'function')
        ? window._arOutstanding(invoices).total
        : invoices.filter(i => i.status?.toLowerCase() !== 'paid').reduce((s, i) => s + (i.amount || 0), 0);
      // Category rows come from the same breakdown, so they are period-scoped and consistent with
      // the total above them. NOTE they cover the manual-expense rows only — byCategory is built
      // from those (app-main.js) — so they do not sum to expTotal, which also carries bills,
      // payments made and payroll. Labelled in the heading rather than left to be discovered.
      const catRows = Object.entries(breakdown.byCategory || {}).sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `<tr><td style="padding:3px 0;color:var(--t2)">${e(cat)}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--t1)">${money(amt)}</td></tr>`).join('');

      document.getElementById('rpt-body').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Revenue</div>
            <div style="font-size:16px;font-weight:600;color:var(--green)">${money(revenue)}</div>
            <div style="font-size:10px;color:var(--t3)">issued, ${e(PERIOD_LABEL[period] || period)}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Expenses</div>
            <div style="font-size:16px;font-weight:600;color:var(--red)">${money(expTotal)}</div>
            <div style="font-size:10px;color:var(--t3)">incl. bills &amp; payroll</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Net Profit</div>
            <div style="font-size:16px;font-weight:600;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${money(profit)}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Outstanding</div>
            <div style="font-size:16px;font-weight:600;color:var(--amber)">${money(outstanding)}</div>
            <div style="font-size:10px;color:var(--t3)">all time</div>
          </div>
        </div>
        ${catRows ? `<div style="font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Expense Breakdown — recorded expenses only</div>
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
    // Scope the write to the page the modal was opened from (personal vs business entity).
    const scope = window._holdingScope === 'business' ? 'business' : 'personal';
    try {
      await api('POST', '/api/holdings', {
        ticker, name, asset_type: type, shares, cost_per: cost, price, dividend: div, scope,
      });
      if (typeof closeModal === 'function') closeModal('holding-modal');
      tip(`${e(ticker)} added to portfolio`);
      // Repaint the CORRECT list (+ dashboard d-invest) — no manual reload.
      if (typeof window._refreshHoldings === 'function') window._refreshHoldings(scope);
      else await loadHoldingsFromDB();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not save holding — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 11. TEAM INVITE — modal + POST /api/team
  // ══════════════════════════════════════════════════════
  window.openInviteModal = function () {
    // F54: member invites disabled for launch (server also rejects POST /api/team/invite
    // with 403 — this just avoids opening a modal that would fail). Accountant client-access
    // (request-access / approve, accountant-routes.js) is a separate flow and is untouched.
    // Reversible: delete this early return to re-enable.
    if (typeof tip === 'function') tip('Team invites are coming soon.', true);
    return;
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
          <div><label class="flabel">Name *</label><input id="inv-name" class="finput" placeholder="Full name"></div>
          <div><label class="flabel">Email *</label><input id="inv-email" class="finput" type="email" placeholder="email@company.com"></div>
          <div><label class="flabel">Role</label>
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
      // Real RBAC invite (Step A): creates a pending membership + emails a secure,
      // single-use accept link. Role/account are bound to the invite row server-side.
      await api('POST', '/api/team/invite', { name, email, role });
      document.getElementById('invite-modal').classList.add('hidden');
      tip(`Invitation emailed to ${e(email)}`);
      if (typeof window.renderTeam === 'function') window.renderTeam();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials('none');
    } catch (err) { tip('Could not invite — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 12. PERSONAL FINANCE — owned by app-main.js
  // ══════════════════════════════════════════════════════
  // REMOVED the stale window.loadPersonalFinance override. It populated the
  // legacy window.persTransactions / window.spending arrays, but app-main's
  // rebuilt render path reads window._allPersTxs → _applyPersFilter → module
  // persTransactions/spending. Because this file is concatenated after app-main
  // and loaded deferred, its override WON at runtime and _allPersTxs was never
  // populated — so the transaction list, Monthly Spending and the donut stayed
  // empty even though rows loaded. app-main.js now owns loadPersonalFinance
  // (it GETs /api/personal-transactions into window._allPersTxs and renders);
  // the showPage('personal') hook below calls it so nav-based loads still work.

  // ══════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    loadTimesheet();
    loadHoldingsFromDB();
    loadProjects();
    // Personal finance loads via app-main's loadPersonalFinance() on the
    // showPage('personal') hook below (no boot preload needed here).

    // Expose so entity-switch and external callers can reload
    window._loadTimesheetFromDB  = loadTimesheet;
    window._loadHoldingsFromDB   = loadHoldingsFromDB;
    window._loadProjectsFromDB   = loadProjects;

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
        if (id === 'biz-investments' && typeof window._loadBizHoldingsFromDB === 'function') window._loadBizHoldingsFromDB();
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
