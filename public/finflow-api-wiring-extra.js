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
      _tsData = rows || [];
      renderTimesheetList();
      updateTimesheetMetrics();
    } catch (err) { console.warn('[Timesheet]', err.message); }
  }

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
        <span><span class="badge ${t.billable === 'Yes' ? 'b-green' : 'b-amber'}">${e(t.billable || 'No')}</span></span>
        <span style="font-family:var(--font-mono);color:var(--t2)">${t.rate ? '$' + t.rate + '/h' : '—'}</span>
        <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7;padding:0 4px" onclick="deleteTimesheetEntry(${t.id})">✕</button>
      </div>`).join('');
  }

  function updateTimesheetMetrics() {
    const total    = _tsData.reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);
    const billable = _tsData.filter(t => t.billable === 'Yes').reduce((s, t) => s + (parseFloat(t.hours) || 0), 0);
    const nb       = total - billable;
    const rate     = total > 0 ? (billable / total * 100).toFixed(0) : 0;
    const days     = new Set(_tsData.map(t => t.date)).size;
    const avg      = days > 0 ? (total / days).toFixed(1) : '0';

    const mcs = document.querySelectorAll('#page-timesheet .mc-val');
    if (mcs[0]) mcs[0].textContent = total.toFixed(1) + 'h';
    if (mcs[1]) mcs[1].textContent = billable.toFixed(1) + 'h';
    if (mcs[2]) mcs[2].textContent = nb.toFixed(1) + 'h';
    if (mcs[3]) mcs[3].textContent = avg + 'h';
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
      document.getElementById('ts-log-modal')?.classList.add('hidden');
      renderTimesheetList();
      updateTimesheetMetrics();
      tip('Time entry saved ✦');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
    } catch (err) { tip('Could not delete — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 3. REPORTS — enrich top metrics with live data
  // ══════════════════════════════════════════════════════
  const _origRenderReports = typeof renderReports === 'function' ? renderReports : null;
  window.renderReports = async function () {
    if (_origRenderReports) _origRenderReports();   // static lists render immediately
    try {
      const [invoices, expenses] = await Promise.all([
        api('GET', '/api/invoices'),
        api('GET', '/api/expenses'),
      ]);
      const revenue  = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
      const expTotal = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
      const profit   = revenue - expTotal;

      const mcs  = document.querySelectorAll('#page-reports .mc-val');
      const chgs = document.querySelectorAll('#page-reports .mc-change');
      if (mcs[0])  mcs[0].textContent  = invoices.length + expenses.length;
      if (chgs[0]) chgs[0].textContent  = 'Invoices & expenses on file';
      if (mcs[1])  mcs[1].textContent  = money(revenue);
      if (chgs[1]) { chgs[1].textContent = 'Paid revenue this period'; chgs[1].className = 'mc-change up'; }
      if (mcs[2])  mcs[2].textContent  = money(profit);
      if (chgs[2]) { chgs[2].textContent = profit >= 0 ? 'Net profit' : 'Net loss'; chgs[2].className = 'mc-change ' + (profit >= 0 ? 'up' : 'dn'); }
    } catch (err) { /* static content still visible */ }
  };

  // ══════════════════════════════════════════════════════
  // 4. BUDGET — live rows from real expense categories
  // ══════════════════════════════════════════════════════
  const _origRenderBudget = typeof renderBudget === 'function' ? renderBudget : null;
  window.renderBudget = async function () {
    if (_origRenderBudget) _origRenderBudget();   // show static rows immediately
    try {
      const expenses = await api('GET', '/api/expenses');
      const catTotals = {};
      expenses.forEach(ex => {
        catTotals[ex.category] = (catTotals[ex.category] || 0) + (ex.amount || 0);
      });
      if (!Object.keys(catTotals).length) return;

      const targets = {
        Rent: 50000, Software: 15000, Meals: 5000, Travel: 12000,
        Salaries: 180000, Marketing: 25000, Equipment: 8000, Other: 20000,
      };
      const colorMap = {
        Rent: 'var(--acc)', Software: 'var(--teal)', Meals: '#d4964a',
        Travel: 'var(--red)', Salaries: 'var(--green)', Marketing: 'var(--purple)',
        Equipment: 'var(--amber)', Other: 'var(--t3)',
      };

      const el = document.getElementById('budget-rows');
      if (!el) return;

      el.innerHTML = Object.entries(catTotals).map(([cat, actual]) => {
        const budget  = targets[cat] || 5000;
        const pct     = Math.min(100, (actual / budget) * 100);
        const over    = actual > budget;
        const variance = budget - actual;
        const varStr  = (over ? '-' : '+') + '$' + (Math.abs(variance) / 1000).toFixed(1) + 'K';
        const color   = colorMap[cat] || 'var(--acc)';
        return `<div class="budget-row" style="margin-top:8px">
          <span class="budget-label">${e(cat)}</span>
          <div class="budget-track">
            <div class="budget-actual" style="width:${pct.toFixed(1)}%;background:${over ? 'var(--red)' : color}"></div>
            <div class="budget-marker" style="left:100%"></div>
          </div>
          <span class="budget-vals" style="font-family:var(--font-mono);font-size:11px">$${(actual / 1000).toFixed(1)}K / $${(budget / 1000).toFixed(0)}K</span>
          <span class="budget-variance" style="color:${over ? 'var(--red)' : 'var(--green)'}">${varStr}</span>
        </div>`;
      }).join('');

      const totalActual = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
      const totalBudget = Object.values(targets).reduce((s, v) => s + v, 0);
      const remaining   = totalBudget - totalActual;
      const mcs  = document.querySelectorAll('#page-budget .mc-val');
      const chgs = document.querySelectorAll('#page-budget .mc-change');
      if (mcs[0])  mcs[0].textContent = '$' + (totalBudget / 1000).toFixed(0) + 'K';
      if (mcs[1])  mcs[1].textContent = '$' + (totalActual / 1000).toFixed(1) + 'K';
      if (chgs[1]) chgs[1].textContent = ((totalActual / totalBudget) * 100).toFixed(0) + '% used';
      if (mcs[2])  mcs[2].textContent = '$' + (Math.abs(remaining) / 1000).toFixed(1) + 'K';
      if (mcs[3])  { mcs[3].textContent = (remaining >= 0 ? '+' : '-') + '$' + (Math.abs(remaining) / 1000).toFixed(1) + 'K'; mcs[3].style.color = remaining >= 0 ? 'var(--green)' : 'var(--red)'; }
    } catch (err) { /* static already showing */ }
  };

  // ══════════════════════════════════════════════════════
  // 5. INVESTMENTS — load holdings from API into local array
  // ══════════════════════════════════════════════════════
  async function loadHoldingsFromDB() {
    try {
      const rows = await api('GET', '/api/holdings');
      if (!rows || !rows.length) return;
      const mapped = rows.map(r => ({
        _dbId: r.id, id: r.id, ticker: r.ticker, name: r.name,
        type: r.asset_type, shares: r.shares, cost: r.cost_per,
        price: r.price, div: r.dividend, color: r.color,
      }));
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
      _projects = await api('GET', '/api/projects');
      _projectsFetched = true;
      renderProjectsList();
    } catch (err) { console.warn('[Projects]', err.message); }
  }

  function renderProjectsList() {
    const l = document.getElementById('projects-list');
    if (!l) return;
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
      renderProjectsList();
      document.getElementById('proj-modal').classList.add('hidden');
      tip(`Project "${e(row.name)}" created`);
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
    } catch (err) { tip('Could not save — ' + err.message, true); }
  };

  window.deleteProject = async function (id) {
    if (!confirm('Delete this project?')) return;
    try {
      await api('DELETE', `/api/projects/${id}`);
      _projects = _projects.filter(p => p.id !== id);
      renderProjectsList();
      tip('Project deleted');
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
      modal.innerHTML = `<div class="modal" style="max-width:480px">
        <div class="modal-header">
          <div>
            <div class="modal-title" id="rpt-title"></div>
            <div class="modal-sub" id="rpt-sub"></div>
          </div>
          <button class="modal-close" onclick="document.getElementById('report-gen-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div id="rpt-body" style="margin-top:12px;font-size:13px;color:var(--t2)">Loading…</div>
        <div class="modal-footer" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('report-gen-modal').classList.add('hidden')">Close</button>
          <button class="btn btn-primary btn-sm" onclick="window.print()">Print ↗</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    document.getElementById('rpt-title').textContent = name;
    document.getElementById('rpt-sub').textContent = 'Generated ' + new Date().toLocaleDateString();
    document.getElementById('rpt-body').innerHTML = '<div style="color:var(--t3)">Loading data…</div>';
    modal.classList.remove('hidden');

    try {
      const [invoices, expenses] = await Promise.all([api('GET', '/api/invoices'), api('GET', '/api/expenses')]);
      const paid      = invoices.filter(i => i.status === 'paid');
      const revenue   = paid.reduce((s, i) => s + (i.amount || 0), 0);
      const expTotal  = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
      const profit    = revenue - expTotal;
      const outstanding = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amount || 0), 0);
      const catTotals = {};
      expenses.forEach(ex => { catTotals[ex.category] = (catTotals[ex.category] || 0) + (ex.amount || 0); });
      const catRows = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `<tr><td style="padding:3px 0;color:var(--t2)">${e(cat)}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--t1)">${money(amt)}</td></tr>`).join('');

      document.getElementById('rpt-body').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Revenue</div>
            <div style="font-size:16px;font-weight:600;color:var(--green)">${money(revenue)}</div>
            <div style="font-size:10px;color:var(--t3)">${paid.length} paid invoice${paid.length !== 1 ? 's' : ''}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Expenses</div>
            <div style="font-size:16px;font-weight:600;color:var(--red)">${money(expTotal)}</div>
            <div style="font-size:10px;color:var(--t3)">${expenses.length} expense${expenses.length !== 1 ? 's' : ''}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Net Profit</div>
            <div style="font-size:16px;font-weight:600;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${money(profit)}</div>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:10px">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Outstanding</div>
            <div style="font-size:16px;font-weight:600;color:var(--amber)">${money(outstanding)}</div>
          </div>
        </div>
        ${catRows ? `<div style="font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Expense Breakdown</div>
        <table style="width:100%;border-collapse:collapse">${catRows}</table>` : ''}`;
    } catch (err) {
      document.getElementById('rpt-body').textContent = 'Could not load data: ' + err.message;
    }
  };

  // ══════════════════════════════════════════════════════
  // 9. BUDGET TARGETS — editable modal + /api/budget-targets
  // ══════════════════════════════════════════════════════
  const DEFAULT_TARGETS = {
    Rent: 50000, Software: 15000, Meals: 5000, Travel: 12000,
    Salaries: 180000, Marketing: 25000, Equipment: 8000, Other: 20000,
  };

  window.openBudgetTargetsModal = async function () {
    let modal = document.getElementById('budget-targets-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'budget-targets-modal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `<div class="modal" style="max-width:400px">
        <div class="modal-header">
          <div class="modal-title">Edit Budget Targets</div>
          <button class="modal-close" onclick="document.getElementById('budget-targets-modal').classList.add('hidden')">
            <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
          </button>
        </div>
        <div id="bt-rows" style="margin-top:10px;display:flex;flex-direction:column;gap:8px">Loading…</div>
        <div class="modal-footer" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('budget-targets-modal').classList.add('hidden')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveBudgetTargets()">Save Targets</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    let targets = { ...DEFAULT_TARGETS };
    try {
      const saved = await api('GET', '/api/budget-targets');
      if (saved && typeof saved === 'object') targets = { ...targets, ...saved };
    } catch (err) { /* use defaults */ }
    document.getElementById('bt-rows').innerHTML = Object.entries(targets).map(([cat, val]) =>
      `<div style="display:flex;align-items:center;gap:8px">
        <label style="width:90px;font-size:12px;color:var(--t2)">${e(cat)}</label>
        <input id="bt-${e(cat)}" class="finput" type="number" min="0" value="${val}" style="flex:1">
      </div>`
    ).join('');
  };

  window.saveBudgetTargets = async function () {
    const targets = {};
    Object.keys(DEFAULT_TARGETS).forEach(cat => {
      const el = document.getElementById('bt-' + cat);
      if (el) targets[cat] = parseFloat(el.value) || 0;
    });
    try {
      await api('PUT', '/api/budget-targets', targets);
      document.getElementById('budget-targets-modal').classList.add('hidden');
      tip('Budget targets saved');
      if (typeof window.renderBudget === 'function') window.renderBudget();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
    } catch (err) { tip('Could not save — ' + err.message, true); }
  };

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
    try {
      await api('POST', '/api/holdings', {
        ticker, name, asset_type: type, shares, cost_per: cost, price, dividend: div,
      });
      if (typeof closeModal === 'function') closeModal('holding-modal');
      tip(`${e(ticker)} added to portfolio`);
      await loadHoldingsFromDB();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
    } catch (err) { tip('Could not save holding — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // 11. TEAM INVITE — modal + POST /api/team
  // ══════════════════════════════════════════════════════
  window.openInviteModal = function () {
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
      await api('POST', '/api/team', { name, email, role });
      document.getElementById('invite-modal').classList.add('hidden');
      tip(`Invite sent to ${e(email)}`);
      if (typeof window.renderTeam === 'function') window.renderTeam();
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
    } catch (err) { tip('Could not invite — ' + err.message, true); }
  };

  // ══════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    loadTimesheet();
    loadHoldingsFromDB();
    loadProjects();

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
        if (id === 'projects') {
          if (!_projectsFetched) loadProjects();
          else renderProjectsList();
        }
      };
    }
  })()

  console.log('[FinFlow Extra Wiring] ✅ Invoice View, Timesheet, Reports, Budget, Investments, Team, Projects, Generate Report, Budget Targets, Add Holding, Invite Member');
})();
