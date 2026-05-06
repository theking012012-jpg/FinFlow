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
  // BOOT
  // ══════════════════════════════════════════════════════
  window.addEventListener('DOMContentLoaded', function () {
    loadTimesheet();
    loadHoldingsFromDB();

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
      };
    }
  });

  console.log('[FinFlow Extra Wiring] ✅ Invoice View, Timesheet, Reports, Budget, Investments, Team');
})();
