// Moved out of accountant-client.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
// ── STATE ──────────────────────────────────────────────────────────────────
let _data = null;
let _userId = null;
let _clientName = '';
let _activeEntity = 'all';
let _period = 'year';
let _flagType = '', _flagRef = '';
let _checklistState = {};
const CHECKLIST_ITEMS = [
  'Review all invoices for the period',
  'Verify expense categorisation',
  'Confirm payroll records are complete',
  'Check bank reconciliation',
  'Set client tax rate',
  'Review journal entries',
  'Prepare tax summary',
  'File return',
];
const BAR_COLORS = ['#c9a84c','#4a9c6d','#5aaa9e','#c45c5c','#7a6fa0','#8fbfaa','#c48a2a'];

// ── INIT ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const meRes = await fetch('/api/accountants/me', { credentials: 'include' });
  if (!meRes.ok) { location.href = '/accountant-login'; return; }
  // D-E: ask for the current Professional Conduct Policy (client books pause after the grace period); reload on accept.
  try { const _me = await meRes.clone().json(); window.ffConductAccepted = function () { location.reload(); }; if (window.ffConductBanner) window.ffConductBanner(_me.conduct); } catch (_) {}

  const params = new URLSearchParams(location.search);
  _userId = params.get('client');
  _clientName = decodeURIComponent(params.get('name') || 'Client');
  if (!_userId || !/^\d+$/.test(_userId)) { location.href = '/accountant'; return; }
  setClientInfo();
  await loadData();
  updateMsgNavBadge();   // badge the "Message Client" nav item with unread client messages
});

function setClientInfo() {
  const initials = _clientName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('topbar-avatar').textContent = initials;
  document.getElementById('topbar-client-name').textContent = _clientName;
  document.getElementById('sb-client-name').textContent = _clientName;
  document.getElementById('dash-title').textContent = _clientName + "'s Dashboard";
}

// Build the /books URL scoped to the active entity + period. The server returns a canonical
// summary (computeBooks) already scoped, so every KPI reconciles with the client dashboard
// for the same entity AND period. 'all' aliases 'year' (all records), matching the client.
function booksUrl() {
  const p = new URLSearchParams();
  if (_activeEntity && _activeEntity !== 'all') p.set('entity_id', _activeEntity);
  p.set('period', _period === 'all' ? 'year' : _period);
  return `/api/accountants/clients/${_userId}/books?${p.toString()}`;
}

async function fetchBooks() {
  const res = await fetch(booksUrl(), {credentials:'include'});
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    document.getElementById('sb-client-meta').textContent = errData.error || 'Failed to load client data';
    return false;
  }
  _data = await res.json();
  return true;
}

// Per-entity edit capability. entityAccess maps entityId → level; legacy links have no map, so
// fall back to the account-wide accessLevel. 'all' view is editable if ANY entity is filing.
window._canEditActive = function() {
  const ea = _data && _data.entityAccess;
  if (!ea) return !!(_data && _data.accessLevel === 'filing');
  if (_activeEntity === 'all') return Object.values(ea).some(l => l === 'filing');
  return ea[String(_activeEntity)] === 'filing';
};
window._refreshEditAffordances = function() {
  window._acctCanEdit = window._canEditActive();
  document.querySelectorAll('[onclick="toggleJournalForm()"]').forEach(b => { b.style.display = window._acctCanEdit ? '' : 'none'; });
};

async function loadData() {
  try {
    if (!(await fetchBooks())) return;
    document.getElementById('sb-client-meta').textContent = (_data.allInvoices?.length||0) + ' invoices · ' + (_data.allExpenses?.length||0) + ' expenses';
    if (_data.accessLevel) {
      document.getElementById('sb-access-badge').innerHTML = `<i class="ti ti-shield-check" style="font-size:11px"></i> ${esc(_data.accessLevel)} access`;
    }
    // 'filing' = run the books (post journals + lock periods); 'view' = review only. The server
    // enforces this with a 403 either way; hiding the edit affordances just avoids showing a button
    // that would fail. Default to view (most restrictive) if the level is missing.
    window._refreshEditAffordances();
    buildEntityTabs();
    renderAll();
    loadNotes();
    loadChecklist();
  } catch(e) { console.error('Load failed:', e); }
}

async function refreshData() { await loadData(); }

// ── ENTITIES ───────────────────────────────────────────────────────────────
function buildEntityTabs() {
  const list = document.getElementById('entity-list');
  const entities = _data.entities || [];
  list.innerHTML = `<div class="entity-item active" data-entity="all" onclick="switchEntity('all',this)"><div class="entity-dot" style="background:var(--gold)"></div>All entities</div>`;
  entities.forEach((e, i) => {
    const color = BAR_COLORS[i % BAR_COLORS.length];
    list.innerHTML += `<div class="entity-item" data-entity="${parseInt(e.id)||0}" onclick="switchEntity('${parseInt(e.id)||0}',this)"><div class="entity-dot" style="background:${color}"></div>${esc(e.name)}</div>`;
  });
  if (_data.personalAccess && _data.personalAccess !== 'none' && _data.personal) {
    list.innerHTML += `<div class="entity-item" data-entity="__personal" onclick="openPersonalPanel()"><div class="entity-dot" style="background:#9b6bcc"></div>Personal finances <span style="margin-left:auto;font-size:10px;color:var(--text3)">${esc(_data.personalAccess)}</span></div>`;
  }
  document.getElementById('topbar-entity-name').textContent = 'All entities';
}

// Personal finances — a self-contained overlay populated from the server's `personal` block
// (served only when the owner granted personal access). Read-only; net worth mirrors the owner's
// own computation so the two reconcile.
window.openPersonalPanel = function() {
  const pd = _data && _data.personal;
  if (!pd) return;
  const fmt = v => Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const accts = (pd.accounts||[]).map(a => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">${esc(a.name||a.kind||'—')} <span style="font-size:10px;color:var(--text3)">${esc(a.kind||'')}</span></span><span style="font-family:var(--mono,monospace);color:var(--text1)">${fmt(a.value)}</span></div>`).join('') || '<div style="color:var(--text3);font-size:12px">No accounts</div>';
  // C6: income / spending for the year to date (server, per currency — never mixed into one number).
  const _cur = Object.keys(pd.incomeByCurrency||{}).concat(Object.keys(pd.expenseByCurrency||{})).filter((c,i,a)=>a.indexOf(c)===i);
  const _yd = (by) => _cur.length ? _cur.map(c => esc(c) + ' ' + fmt((by||{})[c]||0)).join('<br>') : fmt(0);
  const _win = pd.window ? ' (' + esc(pd.window.from) + ' → ' + esc(pd.window.to) + ')' : '';
  const _allTx = (pd.transactions||[]).length;
  const txns = (pd.transactions||[]).slice(0,25).map(t => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">${esc(t.description||t.category||'—')} <span style="font-size:10px;color:var(--text3)">${esc(t.tx_date||'')}</span></span><span style="font-family:var(--mono,monospace);color:${t.tx_type==='income'?'#4a9c6d':'var(--text1)'}">${t.tx_type==='income'?'+':'−'}${fmt(t.amount)}</span></div>`).join('') || '<div style="color:var(--text3);font-size:12px">No transactions</div>';
  let ov = document.getElementById('personal-overlay');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'personal-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--bg1,#14110c);border:1px solid var(--border,#2a2419);border-radius:14px;max-width:560px;width:100%;max-height:85vh;overflow:auto;padding:22px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div><div style="font-size:16px;color:var(--text1,#f2e8d5);font-weight:600">Personal finances</div>
      <div style="font-size:11px;color:var(--text3)">${esc(_data.personalAccess)} access · read-only</div></div>
      <button onclick="document.getElementById('personal-overlay').remove()" style="background:none;border:1px solid var(--border);color:var(--text2);border-radius:8px;padding:5px 10px;cursor:pointer">Close</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px"><div style="font-size:11px;color:var(--text3)">Net worth</div><div style="font-size:20px;font-weight:600;color:var(--gold,#c9a84c);font-family:var(--mono,monospace)">${fmt(pd.netWorth)}</div></div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px"><div style="font-size:11px;color:var(--text3)">Portfolio</div><div style="font-size:20px;font-weight:600;color:var(--text1);font-family:var(--mono,monospace)">${fmt(pd.portfolio)}</div></div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px"><div style="font-size:11px;color:var(--text3)">Assets</div><div style="font-size:16px;color:#4a9c6d;font-family:var(--mono,monospace)">${fmt(pd.assets)}</div></div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px"><div style="font-size:11px;color:var(--text3)">Liabilities</div><div style="font-size:16px;color:#c05a5a;font-family:var(--mono,monospace)">${fmt(pd.liabilities)}</div></div>
      <div id="pp-income" style="border:1px solid var(--border);border-radius:10px;padding:12px"><div style="font-size:11px;color:var(--text3)">Income, year to date${_win}</div><div style="font-size:16px;color:#4a9c6d;font-family:var(--mono,monospace)">${_yd(pd.incomeByCurrency)}</div></div>
      <div id="pp-expense" style="border:1px solid var(--border);border-radius:10px;padding:12px"><div style="font-size:11px;color:var(--text3)">Spending, year to date</div><div style="font-size:16px;color:#c05a5a;font-family:var(--mono,monospace)">${_yd(pd.expenseByCurrency)}</div></div>
    </div>
    <div style="font-size:12px;color:var(--text2);font-weight:600;margin-bottom:6px">Assets &amp; liabilities</div>${accts}
    <div style="font-size:12px;color:var(--text2);font-weight:600;margin:16px 0 6px">Recent personal transactions${_allTx > 25 ? ' <span style="font-weight:400;color:var(--text3)">(latest 25 of ' + _allTx + ')</span>' : ''}</div>${txns}
  </div>`;
  document.body.appendChild(ov);
};

async function switchEntity(id, el) {
  _activeEntity = id;
  if (document.getElementById('journal-form')?.classList.contains('open')) _loadJnlChart();   // FA-M7: that business's chart
  document.querySelectorAll('.entity-item').forEach(i=>i.classList.remove('active'));
  if (el) el.classList.add('active');
  const name = el?.textContent?.trim() || 'All entities';
  document.getElementById('topbar-entity-name').textContent = name;
  await fetchBooks();   // re-fetch: canonical summary is scoped server-side per entity+period
  window._refreshEditAffordances();
  renderAll();
}

// ── PERIOD ─────────────────────────────────────────────────────────────────
async function setPeriod(el) {
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  _period = el.dataset.period;
  await fetchBooks();   // re-fetch canonical summary for the new period
  renderAll();
}

// ── FILTER ─────────────────────────────────────────────────────────────────
function getFiltered() {
  if (!_data) return { invoices:[], expenses:[] };
  let invs = _data.allInvoices || [];
  let exps = _data.allExpenses || [];
  if (_activeEntity !== 'all') {
    invs = invs.filter(i => String(i.entity_id) === String(_activeEntity));
    exps = exps.filter(e => String(e.entity_id) === String(_activeEntity));
  }
  // L11 (Rule 10): list exactly the rows the server summary covers — the calendar window it resolved (the
  // client's FISCAL year / quarter / month, D2 = not after today), compared as 'YYYY-MM-DD' STRINGS. The old
  // filter used viewer-local Date months, CALENDAR quarters, 'year' = every record, and filtered invoices by
  // DUE date while revenue is recognised by ISSUE date.
  const W = _data.window;
  const filterDate = d => {
    if (!W || !W.start || !W.end) return true;            // legacy server: no window ⇒ unfiltered
    const y = _ymdOf(d); if (!y) return false;
    return y >= W.start && y < W.end && (!W.today || y <= W.today);
  };
  return {
    invoices: invs.filter(i=>filterDate(i.issue_date || i.created_at)),
    expenses: exps.filter(e=>filterDate(e.expense_date || e.created_at)),
  };
}

// ── FORMAT ─────────────────────────────────────────────────────────────────
// LA15b: the summary's own currency — the selected business's, or the base currency the all-entities view is
// consolidated into (server `currency`) — never a literal "$" (shared table: /finflow-currency.js).
function _curCode() {
  if (_activeEntity && _activeEntity !== 'all') {
    const e = ((_data && _data.entities) || []).find(x => String(x.id) === String(_activeEntity));
    if (e && e.currency) return String(e.currency).toUpperCase();
  }
  return String((_data && _data.currency) || 'USD').toUpperCase();
}
function fmt(n) {
  const sym = window.FinFlowCurrency ? window.FinFlowCurrency.symbol(_curCode()) : '$';
  return sym + (parseFloat(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
// LA15b: on the consolidated view, a business with no rate to the base currency is left out of every figure. Say
// which currencies are missing and how to fix it — a smaller total must never look complete.
function renderFxCoverageNote() {
  let n = document.getElementById('fx-coverage-note');
  const cov = _data && _data.fxCoverage;
  const missing = (_activeEntity === 'all' && cov && cov.complete === false)
    ? [...new Set((cov.unconvertible || []).map(u => String(u.from || '').toUpperCase()).filter(Boolean))] : [];
  if (!missing.length) { if (n) { n.style.display = 'none'; n.textContent = ''; } return; }
  if (!n) {
    n = document.createElement('div');
    n.id = 'fx-coverage-note';
    n.setAttribute('role', 'status');
    n.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid rgba(201,168,76,.4);background:rgba(201,168,76,.1);border-radius:8px;font-size:12px;color:var(--text2)';
    const anchor = document.getElementById('d-revenue');
    const host = (anchor && anchor.closest('.page, section, main')) || document.body;
    host.insertBefore(n, host.firstChild);
  }
  const to = _curCode();
  n.textContent = missing.join(', ') + ' figures are not included in these ' + to + ' totals — there is no ' + missing.map(c => c + '→' + to).join(' / ') +
    ' rate. The client can add one under FX / Currency, or pick a single business above for its own figures.';
  n.style.display = '';
}
// Rule 10: a 'YYYY-MM-DD' (or ISO timestamp) reduces to its calendar date by STRING, and displays from its own
// parts — new Date('2026-08-30').toLocaleDateString() is "Aug 29" for every viewer west of UTC.
function _ymdOf(d) { const m = String(d == null ? '' : d).match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
function fmtDate(d) {
  if (!d) return '—';
  const y = _ymdOf(d); if (!y) return d;
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return MN[+y.slice(5,7)-1] + ' ' + (+y.slice(8,10)) + ', ' + y.slice(0,4);
}

// ── RENDER ALL ─────────────────────────────────────────────────────────────
function renderAll() {
  const { invoices, expenses } = getFiltered();
  renderFxCoverageNote();   // LA15b
  renderDashboard(invoices, expenses);
  renderInvoicesPage(invoices);
  renderExpensesPage(expenses);
  renderPnL(invoices, expenses);
  renderBalanceSheet();
  renderCashFlow(invoices, expenses);
  renderPayroll();
  renderCustomers();
  renderJournals();
  renderTax(invoices, expenses);
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
function renderDashboard(invoices, expenses) {
  const paid     = invoices.filter(i=>i.status==='paid');
  const pending  = invoices.filter(i=>i.status==='pending');
  const overdue  = _portalOverdueInvoices(invoices);   // L10: past due by DATE with a balance, not status==='overdue'
  // Headline KPIs come from the canonical server summary (computeBooks), scoped to the active
  // entity + period — so they reconcile with the client dashboard. Revenue = paid invoices +
  // receipts + payments received; Expenses = canonical OpEx (incl payroll); Profit = Net (incl COGS).
  const S = _data.summary || {};
  const revenue     = parseFloat(S.revenue)||0;
  const totalExp    = parseFloat(S.opex)||0;
  const profit      = parseFloat(S.netProfit)||0;
  const outstanding = parseFloat(S.outstanding)||0;

  set('d-revenue', fmt(revenue));
  set('d-expenses', fmt(totalExp));
  set('d-profit', fmt(profit));
  set('d-outstanding', fmt(outstanding));
  set('d-margin', revenue ? ((profit/revenue*100).toFixed(1)+'% margin') : '0% margin');
  set('s-paid', paid.length+' · '+fmt(paid.reduce((s,i)=>s+(parseFloat(i.amount)||0),0)));
  set('s-pending', pending.length+' · '+fmt(pending.reduce((s,i)=>s+(parseFloat(i.amount)||0),0)));
  set('s-overdue', overdue.length+' · '+fmt(_portalOverdueTotal()));   // L10: canonical overdue AR
  set('inv-count', invoices.length);
  set('exp-count', expenses.length);

  const banner = document.getElementById('overdue-banner');
  if (overdue.length) {
    banner.style.display='flex';
    set('overdue-text', `${overdue.length} overdue invoice${overdue.length>1?'s':''} totalling ${fmt(_portalOverdueTotal())} — follow up required`);
  } else { banner.style.display='none'; }

  // Recent invoices (5)
  const invEl = document.getElementById('dash-invoices');
  invEl.innerHTML = invoices.slice(0,5).map((inv,i)=>`
    <tr>
      <td class="primary">${esc(inv.client||'—')}</td>
      <td>${fmtDate(inv.due_date)}</td>
      <td class="amount income">${fmt(inv.amount)}</td>
      <td><span class="badge ${inv.status==='paid'?'badge-green':inv.status==='overdue'?'badge-red':'badge-amber'}">${inv.status}</span></td>
      <td><button class="flag-btn" onclick="flagTxn('invoice','${esc(inv.client||'')}')">⚑</button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">No invoices for this period</td></tr>`;

  // Category bars
  const cats = {};
  expenses.forEach(e=>{const c=e.category||'Other';cats[c]=(cats[c]||0)+(parseFloat(e.amount)||0);});
  const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  const maxC = sorted[0]?.[1]||1;
  document.getElementById('dash-categories').innerHTML = sorted.length ? sorted.slice(0,6).map(([c,a],i)=>`
    <div class="cat-row">
      <div class="cat-meta"><span class="cat-label">${esc(c)}</span><span class="cat-amount">${fmt(a)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(a/maxC*100).toFixed(1)}%;background:${BAR_COLORS[i%BAR_COLORS.length]}"></div></div>
    </div>`).join('') : '<div class="empty">No expenses</div>';

  // Recent expenses (5)
  const expEl = document.getElementById('dash-expenses');
  expEl.innerHTML = expenses.slice(0,5).map(e=>`
    <tr>
      <td class="primary">${esc(e.description||'—')}</td>
      <td>${esc(e.category||'—')}</td>
      <td class="amount expense">${fmt(e.amount)}</td>
      <td>${(f=>f===1?'<span class="badge badge-green">✓ Full</span>':f===0.5?'<span class="badge badge-amber">½</span>':'—')(window.FinFlowDates.deductibleFactor(e.deductible))}</td>
      <td><button class="flag-btn" onclick="flagTxn('expense','${esc(e.description||'')}')">⚑</button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">No expenses for this period</td></tr>`;

  // P&L summary
  document.getElementById('dash-pl').innerHTML = `
    <div class="pl-row"><span class="pl-label">Gross Revenue</span><span style="color:var(--green)">${fmt(revenue)}</span></div>
    <div class="pl-row"><span class="pl-label">Total Expenses</span><span style="color:var(--red)">${fmt(totalExp)}</span></div>
    <div class="pl-row"><span>Net Profit</span><span class="pl-total ${profit>=0?'gold':''}" style="color:${profit>=0?'var(--gold)':'var(--red)'}">${fmt(profit)}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px">Profit margin · ${revenue?(profit/revenue*100).toFixed(1):0}%</div>`;
}

// ── L10: the portal's AR figures are the OWNER's canonical ones ───────────────────────────────
// Outstanding / Overdue come from the server summary (computeBooks: Σ unpaid balance of recognised
// invoices, net of credit notes; overdue = past due by DATE) for the scope the page loaded; Collected
// is Σ amount_paid (the owner's Invoices page definition). The portal used to sum full invoice amounts
// by status literal, so a part-paid or credited invoice, or a past-due one still marked 'pending',
// showed different money here than on the client's own dashboard.
const _AR_RECOGNISED = ['pending','overdue','partial','paid'];
const _invBalance = i => Math.max(0, (parseFloat(i.amount)||0) - (parseFloat(i.amount_paid)||0));
// L36: the client ENTITY's day, from the server (computeBooks window.today = entityTodayYmd) — the same "today" its
// overdue AMOUNT (summary.overdue) is computed on. The UTC day here could drop or add an invoice near midnight for a
// business far from UTC, so the overdue COUNT disagreed with the amount beside it. UTC only if the payload lacks it.
const _todayYmd = () => (_data && _data.window && _data.window.today) || new Date().toISOString().slice(0,10);
function _portalOverdueInvoices(invoices){
  const today=_todayYmd();
  return (invoices||[]).filter(i=>_AR_RECOGNISED.includes(String(i.status||'').toLowerCase()) && _invBalance(i)>0.005
    && i.due_date && String(i.due_date).slice(0,10) < today);
}
function _portalOverdueTotal(){ const v=_data && _data.summary && _data.summary.overdue; return v==null ? 0 : (parseFloat(v)||0); }

// ── INVOICES PAGE ──────────────────────────────────────────────────────────
function renderInvoicesPage(invoices) {
  const S = (_data && _data.summary) || {};
  const outstanding = invoices.filter(i=>_AR_RECOGNISED.includes(String(i.status||'').toLowerCase()) && _invBalance(i)>0.005);
  const overdue = _portalOverdueInvoices(invoices);
  const totalBilled = invoices.reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
  const totalPaid = invoices.reduce((s,i)=>s+(parseFloat(i.amount_paid)||0),0);   // L10: Σ amount_paid (owner's "Collected")
  const totalOut = parseFloat(S.outstanding)||0;                                   // L10: canonical AR
  const totalOv = _portalOverdueTotal();                                           // L10: canonical overdue
  set('inv-total', fmt(totalBilled));
  set('inv-collected', fmt(totalPaid));
  set('inv-outstanding', fmt(totalOut));
  set('inv-out-count', outstanding.length+' invoices');
  set('inv-overdue', fmt(totalOv));
  set('inv-ov-count', overdue.length+' invoices');
  set('inv-subtitle', invoices.length+' invoices · '+fmt(totalBilled)+' total');
  document.getElementById('all-invoices').innerHTML = invoices.map((inv,i)=>`
    <tr>
      <td class="primary">${esc(inv.client||'—')}</td>
      <td>${fmtDate(inv.due_date)}</td>
      <td class="amount income">${fmt(inv.amount)}</td>
      <td><span class="badge ${inv.status==='paid'?'badge-green':inv.status==='overdue'?'badge-red':'badge-amber'}">${inv.status}</span></td>
      <td><button class="flag-btn" onclick="flagTxn('invoice','${esc(inv.client||'')}')">⚑</button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">No invoices for this period</td></tr>`;
}

// ── EXPENSES PAGE ──────────────────────────────────────────────────────────
function renderExpensesPage(expenses) {
  // L10: Total = the canonical operating expenses (computeBooks opex: expense rows + issued bills +
  // orphan payments + payroll runs − vendor credits + posted journal expenses), and Deductible = the
  // canonical figure (yes 100% + half 50%) — the owner's Expenses page shows the same two numbers.
  // The rows below remain the expense RECORDS; they were summed alone and called the total.
  const S = (_data && _data.summary) || {};
  const total = parseFloat(S.opex)||0;
  const ded = parseFloat(S.deductible)||0;
  const cats = {};
  expenses.forEach(e=>{const c=e.category||'Other';cats[c]=(cats[c]||0)+(parseFloat(e.amount)||0);});
  const top = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
  set('exp-total', fmt(total));
  set('exp-ded', fmt(ded));
  set('exp-top-cat', top?top[0]:'—');
  set('exp-subtitle', expenses.length+' expense record'+(expenses.length===1?'':'s')+' · total operating expenses '+fmt(total));
  document.getElementById('all-expenses').innerHTML = expenses.map(e=>`
    <tr>
      <td class="primary">${esc(e.description||'—')}</td>
      <td>${esc(e.category||'—')}</td>
      <td>${fmtDate(e.expense_date)}</td>
      <td class="amount expense">${fmt(e.amount)}</td>
      <td>${(f=>f===1?'<span class="badge badge-green">✓ Full</span>':f===0.5?'<span class="badge badge-amber">½ deductible</span>':'—')(window.FinFlowDates.deductibleFactor(e.deductible))}</td>
      <td><button class="flag-btn" onclick="flagTxn('expense','${esc(e.description||'')}')">⚑</button></td>
    </tr>`).join('') || `<tr><td colspan="6" class="empty">No expenses for this period</td></tr>`;
}

// ── P&L PAGE ───────────────────────────────────────────────────────────────
function renderPnL(invoices, expenses) {
  // Canonical P&L from the server summary (computeBooks), scoped to entity + period.
  const S = _data.summary || {};
  const revenue = parseFloat(S.revenue)||0;
  const cogs = parseFloat(S.cogs)||0;
  const grossProfit = parseFloat(S.grossProfit)||0;
  const opex = parseFloat(S.opex)||0;
  const profit = parseFloat(S.netProfit)||0;
  const cats = {};
  expenses.forEach(e=>{const c=e.category||'Other';cats[c]=(cats[c]||0)+(parseFloat(e.amount)||0);});
  const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  const maxC = sorted[0]?.[1]||1;
  document.getElementById('pnl-statement').innerHTML = `
    <div class="pl-row"><span class="pl-label">Revenue</span><span style="color:var(--green)">${fmt(revenue)}</span></div>
    <div class="pl-row"><span class="pl-label">Cost of Goods Sold</span><span style="color:var(--red)">− ${fmt(cogs)}</span></div>
    <div class="pl-row"><span class="pl-label">Gross Profit</span><span>${fmt(grossProfit)}</span></div>
    <div class="pl-row"><span class="pl-label">Operating Expenses</span><span style="color:var(--red)">− ${fmt(opex)}</span></div>
    <div class="pl-row"><span>Net Profit</span><span class="pl-total" style="color:${profit>=0?'var(--gold)':'var(--red)'}">${fmt(profit)}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px">Profit margin · ${revenue?(profit/revenue*100).toFixed(1):0}%</div>`;
  document.getElementById('pnl-categories').innerHTML = sorted.map(([c,a],i)=>`
    <div class="cat-row">
      <div class="cat-meta"><span class="cat-label">${esc(c)}</span><span class="cat-amount">${fmt(a)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(a/maxC*100).toFixed(1)}%;background:${BAR_COLORS[i%BAR_COLORS.length]}"></div></div>
    </div>`).join('') || '<div class="empty">No expenses</div>';
}

// ── BALANCE SHEET ──────────────────────────────────────────────────────────
// L38: renders the server's statement (glBalanceSheet — the SAME one the client sees, scoped to this grant); nothing
// is computed here. It used to build its own: assets = AR only, liabilities = AP + the period payroll EXPENSE
// ("Payroll Obligations" — wages already paid), equity = the difference.
function renderBalanceSheet() {
  if (!_data?.balanceSheet) return;
  const bs = _data.balanceSheet;
  const L = (bs.lines && Array.isArray(bs.lines.assets)) ? bs.lines : null;
  // Ledger not reconciled ⇒ the server's honest stub (cash not tracked): AR | AP | the difference — as the client sees.
  const lines = L || {
    assets: [{ label: 'Accounts Receivable', amount: bs.accountsReceivable }],
    liabilities: [{ label: 'Accounts Payable', amount: bs.accountsPayable }],
    equity: [{ label: 'Receivables less payables', amount: bs.equity }],
  };
  const rows = (arr, color) => (arr || []).map(l => `<div class="bs-row"><span class="bs-label">${esc(l.label)}</span><span style="color:${color}">${fmt(l.amount)}</span></div>`).join('');
  const put = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  put('bs-assets-lines', (bs.cashTracked === false ? '<div class="bs-row"><span class="bs-label">Cash &amp; Equivalents</span><span style="color:var(--text3)">Not tracked</span></div>' : '') + rows(lines.assets, 'var(--green)'));
  put('bs-liab-lines', rows(lines.liabilities, 'var(--red)'));
  put('bs-equity-lines', rows(lines.equity, 'var(--text2)'));
  set('bs-assets-label', bs.totalAssetsExcludesCash ? 'Total Assets (excl. untracked cash)' : 'Total Assets');
  set('bs-assets', fmt(bs.totalAssets));
  set('bs-liabilities', fmt(bs.totalLiabilities));
  set('bs-equity', fmt(bs.equity));
  const cta = typeof bs.cta === 'number' ? bs.cta : 0;
  set('bs-note', Math.abs(cta) >= 0.01 ? 'Cumulative Translation Adjustment (ASC 830, supplementary — not in Total Equity): ' + fmt(cta) : '');
}

// ── CASH FLOW ──────────────────────────────────────────────────────────────
function renderCashFlow(invoices, expenses) {
  // CASH basis (period-scoped), from canonical parts — deliberately DISTINCT from Net Profit:
  // cash in = paid invoices + receipts + payments received; cash out = expenses + payments
  // made. Accrual payroll and COGS are NOT cash events, so they're excluded (a cash-flow
  // statement is not the P&L). Payroll cash isn't separately tracked in the data model.
  const S = _data.summary || {}, P = S.parts || {};
  const cashIn  = parseFloat(S.revenue)||0;
  const cashOut = (parseFloat(P.expenses)||0) + (parseFloat(P.paymentsMade)||0);
  const ar = parseFloat(S.outstanding)||0;
  const netOp = Math.round((cashIn - cashOut)*100)/100;
  const el = document.getElementById('cf-operating');
  if (el) el.innerHTML = `
    <div class="pl-row"><span class="pl-label">Cash receipts (paid invoices + receipts)</span><span style="color:var(--green)">${fmt(cashIn)}</span></div>
    <div class="pl-row"><span class="pl-label">Cash payments (expenses + bill payments)</span><span style="color:var(--red)">− ${fmt(cashOut)}</span></div>
    <div class="pl-row"><span class="pl-label">A/R outstanding (not yet cash)</span><span style="color:var(--amber)">${fmt(ar)}</span></div>
    <div class="pl-row"><span class="pl-label" style="font-weight:500">Net operating cash flow</span><span style="color:${netOp>=0?'var(--green)':'var(--red)'};font-weight:500">${fmt(netOp)}</span></div>`;
  set('cf-net', fmt(netOp));
  const labels = {year:'Year to date',quarter:'Current quarter',month:'Current month',all:'All time'};   // FIX-2: the year counts what is dated up to today
  set('cf-subtitle', labels[_period] || _period);
}

// ── PAYROLL ────────────────────────────────────────────────────────────────
function renderPayroll() {
  const payroll = _data?.allPayroll || [];
  const list = document.getElementById('payroll-list');
  if (!payroll.length) { list.innerHTML = `<tr><td colspan="6" class="empty">No payroll records</td></tr>`; return; }
  const total = payroll.reduce((s,p)=>s+(parseFloat(p.gross)||0),0);
  // Deduction model (F8): net = gross − Σ(deductions); percent → gross×value/100, fixed → value.
  // (Previously read p.tax_rate — a field F8 deleted — so net was computed off a dead field.)
  const dedTotal = p => {
    const g = parseFloat(p.gross)||0;
    return (Array.isArray(p.deductions)?p.deductions:[]).reduce((s,d)=>{
      const v = parseFloat(d.value)||0;
      return s + (d.type==='percent' ? g*v/100 : v);
    }, 0);
  };
  list.innerHTML = payroll.map(p=>{
    const gross = parseFloat(p.gross)||0;
    const ded = Math.round(dedTotal(p)*100)/100;
    const net = Math.round((gross-ded)*100)/100;
    return `<tr>
      <td class="primary">${esc((p.fname||'')+' '+(p.lname||''))}</td>
      <td>${esc(p.role||'—')}</td>
      <td>${esc(p.emp_type||'Full-time')}</td>
      <td class="amount">${fmt(gross)}</td>
      <td style="color:var(--text3)">${fmt(ded)}</td>
      <td class="amount income">${fmt(net)}</td>
    </tr>`;}).join('');
  document.getElementById('payroll-summary').style.display='flex';
  set('payroll-total', fmt(total));
}

// ── CUSTOMERS ──────────────────────────────────────────────────────────────
function renderCustomers() {
  const customers = _data?.allCustomers || [];
  const el = document.getElementById('customers-list');
  if (!customers.length) { el.innerHTML = '<div class="empty">No customers found</div>'; return; }
  el.innerHTML = `<div class="card-hdr"><div class="card-title">Customers · ${customers.length}</div></div>` +
    customers.map(c=>{
      const initials = (c.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      return `<div class="customer-row">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="customer-avatar">${esc(initials)}</div>
          <div>
            <div style="font-size:13px;color:var(--text)">${esc(c.name||'—')}</div>
            <div style="font-size:11px;color:var(--text3)">${esc(c.email||c.company||'')}</div>
          </div>
        </div>
        <div class="amount income">${fmt(c.revenue||0)}</div>
      </div>`;}).join('');
}

// ── JOURNALS ───────────────────────────────────────────────────────────────
function renderJournals() {
  const journals = _data?.allJournals || [];
  const el = document.getElementById('journals-list');
  el.innerHTML = journals.length ? journals.map(j=>`
    <div style="padding:12px;background:var(--card2);border:1px solid var(--border);border-radius:6px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:13px;color:var(--text);font-weight:400">${esc(j.description||'Journal Entry')}</span>
        <span style="font-size:11px;color:var(--text3)">${fmtDate(j.date)}</span>
      </div>
      ${j.posted_by?`<div style="font-size:11px;color:var(--amber)">Posted by ${esc(j.posted_by.replace('accountant:','Accountant #'))}</div>`:''}
    </div>`).join('') : '<div class="empty">No journal entries yet. Use the button above to post one.</div>';

  // Period locking
  const now = new Date();
  const periods = [];
  for (let i=0;i<6;i++) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    periods.push(d.toLocaleString('en-US',{month:'long',year:'numeric'}));
  }
  document.getElementById('periods-list').innerHTML = periods.map(p=>`
    <div class="period-row">
      <span style="color:var(--text2)">${p}</span>
      ${window._acctCanEdit ? `<button class="lock-btn" onclick="lockPeriod('${p}',this)">🔓 Lock Period</button>` : `<span style="font-size:11px;color:var(--text3)">View-only</span>`}
    </div>`).join('');
}

// ── TAX ────────────────────────────────────────────────────────────────────
function renderTax(invoices, expenses) {
  // F139 — revenue AND deductible both come from the canonical summary (computeBooks, entity +
  // fiscal-year scoped), the SAME source the client's own Income-Tax worksheet reads, so accountant
  // and client agree on taxable BY CONSTRUCTION. The deductible was recomputed HERE from client-side
  // getFiltered() rows with a narrower factor map ('yes'/'half' only — missing '100'/'50') and no
  // fiscal-year window ('year' returned ALL records), three ways to diverge from the client; that is
  // gone. `expenses` is no longer read for tax figures.
  const _s = _data.summary || {};
  const revenue  = parseFloat(_s.revenue)  || 0;
  const dedFull  = parseFloat(_s.deductibleFull) || 0;
  const dedHalf  = parseFloat(_s.deductibleHalf) || 0;
  // M6: deductions / taxable come from computeBooks (every ordinary cost, not only flagged expense rows).
  const totalDed = parseFloat(_s.taxDeductions != null ? _s.taxDeductions : _s.deductible) || 0;
  const taxable = _s.taxableIncome != null ? (parseFloat(_s.taxableIncome) || 0) : Math.max(0, revenue-totalDed);
  const rate = parseFloat(_data?.taxRate)||0;
  // F137-k/F138: prefer the client's Income Tax worksheet lines (accurate for fixed/revenue lines);
  // fall back to the single derived rate for older clients that never set lines.
  const escH = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const taxLines = Array.isArray(_data?.taxLines) ? _data.taxLines : [];
  const lineAmt = l => { const v = parseFloat(l.value)||0; return l.type==='revenue' ? revenue*v/100 : l.type==='fixed' ? v : taxable*v/100; };
  const hasLines = taxLines.length > 0;
  const liability = hasLines ? taxLines.reduce((s,l)=>s+lineAmt(l),0) : (rate ? taxable*(rate/100) : 0);
  const hasEstimate = hasLines || rate > 0;
  set('tax-liability', hasEstimate ? fmt(liability) : 'Not set up');
  set('tax-deductible', fmt(totalDed));
  set('tax-taxable', fmt(taxable));
  const warnBanner = document.getElementById('tax-rate-warning');
  if (warnBanner) warnBanner.style.display = hasEstimate ? 'none' : 'flex';
  const linesHtml = hasLines
    ? taxLines.map(l=>{ const suffix = l.type==='fixed' ? ' (fixed)' : l.type==='revenue' ? ` (${parseFloat(l.value)||0}% of revenue)` : ` (${parseFloat(l.value)||0}% of taxable)`; return `<div class="pl-row"><span class="pl-label">${escH(l.label||'Tax')}${suffix}</span><span style="color:var(--red);font-weight:500">${fmt(lineAmt(l))}</span></div>`; }).join('')
        + `<div class="pl-row" style="font-weight:600"><span class="pl-label">Total estimated tax</span><span style="color:var(--red)">${fmt(liability)}</span></div>`
    : (rate ? `<div class="pl-row"><span class="pl-label">Tax rate (${rate}%)</span><span style="color:var(--red);font-weight:500">${fmt(liability)}</span></div>` : '<div style="font-size:11px;color:var(--text3);padding:8px 0">Client has not set up tax lines in their settings.</div>');
  document.getElementById('tax-breakdown').innerHTML = `
    <div class="card-hdr"><div class="card-title">Tax Calculation Breakdown</div></div>
    <div class="pl-row"><span class="pl-label">Gross Revenue</span><span>${fmt(revenue)}</span></div>
    <div class="pl-row"><span class="pl-label">Fully deductible expenses</span><span style="color:var(--green)">− ${fmt(dedFull)}</span></div>
    <div class="pl-row"><span class="pl-label">50% deductible expenses</span><span style="color:var(--green)">− ${fmt(dedHalf)}</span></div>
    <div class="pl-row"><span class="pl-label">Taxable Income</span><span style="color:var(--amber);font-weight:500">${fmt(taxable)}</span></div>
    ${linesHtml}`;
}

// ── NOTES ──────────────────────────────────────────────────────────────────
async function loadNotes() {
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/notes`, { credentials:'include' });
    if (r.ok) {
      const data = await r.json();
      if (data.note) document.getElementById('notes-content').value = data.note;
    }
  } catch(e) {}
}

async function saveNotes() {
  const note = document.getElementById('notes-content').value;
  try {
    await fetch(`/api/accountants/clients/${_userId}/notes`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({note}),
    });
    showToast('Note saved');
  } catch(e) { showToast('Save failed'); }
}

// ── JOURNAL FORM ───────────────────────────────────────────────────────────
function toggleJournalForm() {
  const f = document.getElementById('journal-form');
  f.classList.toggle('open');
  _fillJnlSelects();
  if (f.classList.contains('open')) _loadJnlChart();
  if (f.classList.contains('open')) {
    const d = document.getElementById('jnl-date');
    if (!d.value) { var _n = new Date(); d.value = _n.getFullYear() + '-' + String(_n.getMonth()+1).padStart(2,'0') + '-' + String(_n.getDate()).padStart(2,'0'); }  // C3/F37: local date, not UTC (standalone page, no window.todayLocal)
    showSection('journals', null);
  }
}

// FA-M7: the client business's ONE chart of accounts (GET /api/accountants/clients/:id/chart) — the same list the owner's
// Chart of Accounts page and journal picker show. A line carries the account's `acct` and posts to exactly that account.
let _jnlChart = null, _jnlChartFor = null;
function _jnlAcctOptions() {
  if (_jnlChart == null) return '<option value="">Loading the chart of accounts…</option>';
  const usable = _jnlChart.filter(a => a.journal);
  if (!usable.length) return '<option value="">No accounts in this business\'s chart</option>';
  const groups = {}; usable.forEach(a => { (groups[a.category] = groups[a.category] || []).push(a); });
  return '<option value="">Select account…</option>' + Object.entries(groups).map(([g, accs]) => '<optgroup label="' + esc(g) + '">'
    + accs.map(a => '<option value="' + esc(a.acct) + '">' + esc(a.code) + ' ' + esc(a.name) + (a.kind === 'older' ? ' (older journal account)' : '') + '</option>').join('') + '</optgroup>').join('');
}
async function _loadJnlChart() {
  const key = String(_activeEntity || 'all');
  if (_jnlChart != null && _jnlChartFor === key) return;
  _jnlChart = null; _jnlChartFor = key; _fillJnlSelects(true);
  try {
    const q = (_activeEntity && _activeEntity !== 'all') ? '?entity_id=' + encodeURIComponent(_activeEntity) : '';
    const r = await fetch(`/api/accountants/clients/${_userId}/chart` + q, { credentials: 'include' });
    const j = r.ok ? await r.json() : null;
    if (_jnlChartFor === key) _jnlChart = (j && Array.isArray(j.accounts)) ? j.accounts : [];
  } catch (_) { if (_jnlChartFor === key) _jnlChart = []; }
  _fillJnlSelects(true);
}
function _fillJnlSelects(force) {
  document.querySelectorAll('#jnl-lines select.jnl-acct').forEach(sel => { if (force || !sel.options.length) { const v = sel.value; sel.innerHTML = _jnlAcctOptions(); sel.value = v; } });
}

function addJournalLine() {
  const lines = document.getElementById('jnl-lines');
  const row = document.createElement('div');
  row.className = 'jnl-line';
  row.innerHTML = `
    <select class="jnl-input jnl-acct">${_jnlAcctOptions()}</select>
    <input type="number" class="jnl-input" placeholder="0.00">
    <input type="number" class="jnl-input" placeholder="0.00">
    <button class="jnl-remove" onclick="removeJournalLine(this)">×</button>`;
  lines.appendChild(row);
}

function removeJournalLine(btn) {
  const rows = document.querySelectorAll('.jnl-line');
  if (rows.length > 1) btn.closest('.jnl-line').remove();
}

async function submitJournal() {
  const date = document.getElementById('jnl-date').value;
  const description = document.getElementById('jnl-desc').value.trim();
  if (!description) { showToast('Add a description', 'error'); return; }
  const lines = [];
  let missingAcct = false;
  document.querySelectorAll('.jnl-line').forEach(row=>{
    const sel = row.querySelector('select.jnl-acct');
    const inputs = row.querySelectorAll('input');
    const acct = sel ? sel.value : '';
    const debit = parseFloat(inputs[0].value)||0;
    const credit = parseFloat(inputs[1].value)||0;
    if (!debit && !credit) return;
    if (!acct) { missingAcct = true; return; }
    lines.push({acct, debit, credit});
  });
  if (missingAcct) { showToast('Choose an account for every line with an amount', 'error'); return; }
  if (lines.length < 2) { showToast('Add at least two lines (a debit and a credit)', 'error'); return; }
  try {
    const res = await fetch(`/api/accountants/clients/${_userId}/journal`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({date, description, lines}, (_activeEntity && _activeEntity !== 'all') ? { entity_id: parseInt(_activeEntity) } : {})),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    toggleJournalForm();
    showToast('Journal entry posted');
    await loadData();
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

// ── PERIOD LOCKING ─────────────────────────────────────────────────────────
async function lockPeriod(period, btn) {
  try {
    await fetch(`/api/accountants/clients/${_userId}/lock`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({period, locked:true}),
    });
    btn.textContent = '🔒 Locked';
    btn.classList.add('locked');
    btn.disabled = true;
    showToast(`${period} locked`);
  } catch(e) { showToast('Could not lock period', 'error'); }
}

// ── FLAG ───────────────────────────────────────────────────────────────────
function flagTxn(type, ref) {
  _flagType = type; _flagRef = ref;
  document.getElementById('flag-note').value = '';
  document.getElementById('flag-modal').classList.add('open');
}
function closeFlagModal() {
  document.getElementById('flag-modal').classList.remove('open');
}
async function submitFlag() {
  const note = document.getElementById('flag-note').value.trim();
  try {
    const res = await fetch(`/api/accountants/clients/${_userId}/flag`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({type:_flagType, ref:_flagRef, note}),
    });
    if (!res.ok) throw new Error();
    closeFlagModal();
    showToast('Flagged and client notified', 'success');
  } catch(e) { showToast('Could not flag', 'error'); }
}

// ── EXPORT ─────────────────────────────────────────────────────────────────
function exportCSV() {
  if (!_data) return;
  const { invoices, expenses } = getFiltered();
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';   // L10: 0 is a value, not an empty cell
  const lines = [];
  lines.push('INVOICES');
  lines.push([q('Client'), q('Amount'), q('Status'), q('Due Date')].join(','));
  invoices.forEach(i => lines.push([q(i.client||''), q(parseFloat(i.amount)||0), q(i.status||''), q(i.due_date||'')].join(',')));
  lines.push('');
  lines.push('EXPENSES');
  lines.push([q('Description'), q('Category'), q('Amount'), q('Date'), q('Deductible')].join(','));
  expenses.forEach(e => lines.push([q(e.description||''), q(e.category||''), q(parseFloat(e.amount)||0), q(e.expense_date||''), q(e.deductible||'')].join(',')));
  lines.push('');
  lines.push('PAYROLL');
  // F8 follow-up: `tax_rate` was deleted; net = gross − Σ(deductions) (percent → gross×value/100,
  // fixed → value), matching renderPayroll's dedTotal. The old CSV read the dead tax_rate → 0% and
  // net == gross. Export the real Deductions + Net instead.
  lines.push([q('Name'), q('Role'), q('Gross'), q('Deductions'), q('Net Pay')].join(','));
  (_data.allPayroll || []).forEach(p => {
    const g = parseFloat(p.gross) || 0;
    const ded = Math.round((Array.isArray(p.deductions) ? p.deductions : []).reduce((s, d) => { const v = parseFloat(d.value) || 0; return s + (d.type === 'percent' ? g * v / 100 : v); }, 0) * 100) / 100;
    lines.push([q((p.fname||'')+' '+(p.lname||'')), q(p.role||''), q(g), q(ded), q(Math.round((g - ded) * 100) / 100)].join(','));
  });
  lines.push('');
  // L10: the P&L summary is the canonical one (server computeBooks for the loaded scope + period) — the
  // same figures as the portal's headline cards and the client's own P&L. It used to be revenue = PAID
  // invoices and expenses = expense rows only (cash-ish, missing every other leg).
  const _S = _data.summary || {};
  lines.push('P&L SUMMARY');
  lines.push([q('Metric'), q('Amount')].join(','));
  lines.push([q('Revenue'), q(parseFloat(_S.revenue)||0)].join(','));
  lines.push([q('Cost of Goods Sold'), q(parseFloat(_S.cogs)||0)].join(','));
  lines.push([q('Expenses'), q(parseFloat(_S.opex)||0)].join(','));
  lines.push([q('Net Profit'), q(parseFloat(_S.netProfit)||0)].join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], {type:'text/csv'}));
  a.download = _clientName.replace(/\s+/g, '_') + '_books.csv';
  a.click();
}

// ── NAVIGATION ─────────────────────────────────────────────────────────────
function showSection(name, el) {
  document.querySelectorAll('.page-section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const sec = document.getElementById('section-'+name);
  if (sec) sec.classList.add('active');
  if (el) el.classList.add('active');
  else {
    document.querySelectorAll('.nav-item').forEach(n=>{
      if (n.getAttribute('onclick')?.includes("'"+name+"'")) n.classList.add('active');
    });
  }
  if (name === 'messages') loadMessages();
  if (name === 'proposals') loadProposals();
  if (name === 'requests') loadTasks();
  closeClientSidebar(); // collapse the mobile overlay after choosing a section
}

// ── REQUESTS / TASKS (accountant view) ──────────────────────────────────────
async function loadTasks() {
  const el = document.getElementById('tasks-list'); if (!el) return;
  el.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/tasks`, {credentials:'include'});
    if (!r.ok) { el.innerHTML = '<div class="empty" style="margin:auto;padding:20px">Could not load requests.</div>'; return; }
    const tasks = (await r.json()).tasks || [];
    if (!tasks.length) { el.innerHTML = '<div class="empty" style="margin:auto;padding:20px">No requests yet — add your first above.</div>'; return; }
    // L18 (Rule 10): show the calendar date's own parts — new Date(d) showed the previous day west of UTC.
    const due = d => { const y = _ymdOf(d); if (!y) return ''; const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `<span style="font-size:11px;color:var(--text3);margin-left:8px">due ${+y.slice(8,10)} ${MN[+y.slice(5,7)-1]}</span>`; };
    el.innerHTML = tasks.map(t => {
      const done = t.status === 'done';
      const tag = done ? '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(74,156,109,.15);color:#4a9c6d">Done</span>'
        : '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(212,150,74,.15);color:var(--amber,#d4964a)">Open</span>';
      return `<div style="border-bottom:1px solid var(--border);padding:12px 0;display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px"><span style="font-size:13.5px;color:var(--text1);${done?'text-decoration:line-through;color:var(--text3)':''}">${esc(t.title)}</span>${tag}${due(t.due_date)}</div>
            ${t.detail?`<div style="font-size:12.3px;color:var(--text2);margin-top:3px;white-space:pre-wrap">${esc(t.detail)}</div>`:''}
          </div>
          <button class="topbar-btn" onclick="deleteTask(${t.id},this)" title="Remove"><i class="ti ti-trash"></i></button>
        </div>`;
    }).join('');
  } catch(e) { el.innerHTML = '<div class="empty" style="margin:auto;padding:20px">Could not load requests.</div>'; }
}
async function createTask(btn) {
  const title = (document.getElementById('task-title').value||'').trim();
  if (!title) { alert('Give the request a title.'); return; }
  const body = { title, detail: (document.getElementById('task-detail').value||'').trim(), due_date: document.getElementById('task-due').value || null };
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/tasks`, {method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Could not add request.'); if (btn) btn.disabled=false; return; }
    document.getElementById('task-title').value=''; document.getElementById('task-detail').value=''; document.getElementById('task-due').value='';
    if (btn) btn.disabled=false;
    loadTasks();
  } catch(e) { if (btn) btn.disabled=false; alert('Could not add request.'); }
}
async function deleteTask(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/accountants/tasks/${id}`, {method:'DELETE',credentials:'include'});
    if (!r.ok) { if (btn) btn.disabled=false; return; }
    loadTasks();
  } catch(e) { if (btn) btn.disabled=false; }
}

// ── ENGAGEMENT PROPOSALS (accountant view) ──────────────────────────────────
const _propFee = (cents, cur) => (cur||'USD') + ' ' + ((Number(cents)||0)/100).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2});
async function loadProposals() {
  const el = document.getElementById('proposals-list'); if (!el) return;
  el.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/proposals`, {credentials:'include'});
    if (!r.ok) { el.innerHTML = '<div class="empty" style="margin:auto;padding:20px">Could not load proposals.</div>'; return; }
    const props = (await r.json()).proposals || [];
    if (!props.length) { el.innerHTML = '<div class="empty" style="margin:auto;padding:20px">No proposals yet — send your first above.</div>'; return; }
    const bill = b => b==='monthly'?'/mo':(b==='hourly'?'/hr':'');
    const tag = s => s==='pending'?'<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(212,150,74,.15);color:var(--amber,#d4964a)">Pending</span>'
      : s==='accepted'?'<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(74,156,109,.15);color:#4a9c6d">Accepted</span>'
      : s==='declined'?'<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(200,90,74,.15);color:#c85a4a">Declined</span>'
      : '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,.06);color:var(--text3)">Withdrawn</span>';
    el.innerHTML = props.map(p => `<div style="border-bottom:1px solid var(--border);padding:12px 0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:14px;color:var(--text1);font-weight:500">${esc(p.title)}</span>${tag(p.status)}</div>
        ${p.scope?`<div style="font-size:12.5px;color:var(--text2);margin-top:4px;white-space:pre-wrap">${esc(p.scope)}</div>`:''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
          <span style="font-size:13px;color:var(--gold);font-family:var(--mono,monospace)">${_propFee(p.fee_cents,p.currency)}<span style="color:var(--text3)">${bill(p.billing)}</span></span>
          ${p.status==='pending'?`<button class="topbar-btn" onclick="withdrawProposal(${p.id},this)">Withdraw</button>`:''}
        </div></div>`).join('');
  } catch(e) { el.innerHTML = '<div class="empty" style="margin:auto;padding:20px">Could not load proposals.</div>'; }
}
async function sendProposal(btn) {
  const title = (document.getElementById('prop-title').value||'').trim();
  if (!title) { alert('Give the proposal a title.'); return; }
  const body = {
    title,
    scope: (document.getElementById('prop-scope').value||'').trim(),
    fee: parseFloat(document.getElementById('prop-fee').value||'0')||0,
    currency: document.getElementById('prop-currency').value,
    billing: document.getElementById('prop-billing').value,
  };
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/proposals`, {method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Could not send proposal.'); if (btn) btn.disabled=false; return; }
    document.getElementById('prop-title').value=''; document.getElementById('prop-scope').value=''; document.getElementById('prop-fee').value='';
    if (btn) btn.disabled=false;
    loadProposals();
  } catch(e) { if (btn) btn.disabled=false; alert('Could not send proposal.'); }
}
async function withdrawProposal(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/accountants/proposals/${id}/withdraw`, {method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:'{}'});
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Could not withdraw.'); if (btn) btn.disabled=false; return; }
    loadProposals();
  } catch(e) { if (btn) btn.disabled=false; }
}

// Mobile sidebar overlay toggle (the 220px sidebar is off-canvas under 900px).
function toggleClientSidebar() {
  const sb = document.querySelector('.sidebar');
  const scrim = document.getElementById('cb-scrim');
  const open = sb.classList.toggle('mobile-open');
  if (scrim) scrim.classList.toggle('open', open);
}
function closeClientSidebar() {
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  document.getElementById('cb-scrim')?.classList.remove('open');
}

// ── TAX REMINDER ───────────────────────────────────────────────────────────
async function sendTaxReminder() {
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/notify`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message:'Please set your tax rate in Settings → Tax to enable accurate tax calculations.'}),
    });
    if (r.ok) showToast('Reminder sent to client', 'success');
    else showToast('Could not send reminder', 'error');
  } catch(e) { showToast('Could not send reminder', 'error'); }
}

// ── AI INSIGHTS ────────────────────────────────────────────────────────────
async function generateInsights() {
  const el = document.getElementById('ai-results');
  el.innerHTML = '<div class="loading"><i class="ti ti-loader" style="display:inline-block;animation:spin 1s linear infinite;margin-right:8px"></i>Analysing books with Claude…</div>';
  try {
    const res = await fetch(`/api/accountants/clients/${_userId}/ai-insights`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      el.innerHTML = `<div class="empty">${esc(e.error || 'Failed to generate insights.')}</div>`;
      return;
    }
    const data = await res.json();
    const bullets = (data.insights || '').split('\n').filter(b => b.trim());
    el.innerHTML = bullets.length
      ? bullets.map(b => `<div class="ai-bullet"><div class="ai-dot"></div><span>${esc(b.replace(/^[•\-\*\d\.\)]+\s*/, ''))}</span></div>`).join('')
      : '<div class="empty">No insights generated.</div>';
  } catch(e) { el.innerHTML = '<div class="empty">Failed to generate insights. Check AI configuration.</div>'; }
}

// ── FILING CHECKLIST ───────────────────────────────────────────────────────
function renderChecklist() {
  const el = document.getElementById('checklist-items');
  if (!el) return;
  el.innerHTML = CHECKLIST_ITEMS.map((item, i) => `
    <div class="checklist-item${_checklistState[i] ? ' done' : ''}" id="ci-${i}">
      <input type="checkbox" id="chk-${i}" ${_checklistState[i] ? 'checked' : ''} onchange="toggleCheck(${i},this)">
      <label for="chk-${i}">${esc(item)}</label>
    </div>`).join('');
}
function toggleCheck(idx, el) {
  _checklistState[idx] = el.checked;
  const row = document.getElementById('ci-' + idx);
  if (el.checked) row.classList.add('done'); else row.classList.remove('done');
}
async function saveChecklist() {
  try {
    await fetch(`/api/accountants/clients/${_userId}/checklist`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({items: _checklistState}),
    });
    showToast('Checklist saved', 'success');
  } catch(e) { showToast('Save failed', 'error'); }
}
async function loadChecklist() {
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/checklist`, {credentials:'include'});
    if (r.ok) { const d = await r.json(); _checklistState = d.items || {}; }
  } catch(e) {}
  renderChecklist();
}

// ── MESSAGES — real-time (SSE) with read receipts, typing, and a poll fallback ──
let _msgs = [], _otherLastRead = null, _msgSse = null, _msgPoll = null;
let _typingSentAt = 0, _typingHideTimer = null;

function renderMessages() {
  const el = document.getElementById('messages-thread');
  if (!el) return;
  if (!_msgs.length) { el.innerHTML = '<div class="empty" style="margin:auto">No messages yet. Start the conversation.</div>'; return; }
  // "Seen" tick: the last accountant message the CLIENT has read (created_at <= their last_read).
  const readTs = _otherLastRead ? new Date(_otherLastRead).getTime() : 0;
  let lastSeenIdx = -1;
  _msgs.forEach((m, i) => { if (m.sender === 'accountant' && new Date(m.created_at).getTime() <= readTs) lastSeenIdx = i; });
  el.innerHTML = _msgs.map((m, i) => {
    const body = esc(m.content != null ? m.content : m.message);
    const seen = i === lastSeenIdx ? '<span class="seen">✓ Seen</span>' : '';
    const att = m.att_name ? `<a href="/api/accountants/chat-attachment/${m.id}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:5px;background:rgba(0,0,0,.15);border-radius:8px;padding:6px 10px;font-size:12px;color:inherit;text-decoration:none">📎 ${esc(m.att_name)}${m.att_size?` · ${_fmtBytes(m.att_size)}`:''}</a>` : '';
    return `<div class="msg-bubble msg-${esc(m.sender)}${m._sending ? ' sending' : ''}">
        <div>${body}</div>
        ${att}
        <div class="msg-meta">${m.sender === 'accountant' ? 'You' : 'Client'} · ${fmtDate(m.created_at)}${seen}</div>
      </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

const _fmtBytes = n => { n=Number(n)||0; if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(1)+' MB'; };
window.sendClientAttachment = function(inputEl){
  const f = inputEl && inputEl.files && inputEl.files[0]; if(!f) return;
  if(f.size > 5*1024*1024){ alert('File too large (max 5MB).'); inputEl.value=''; return; }
  const reader = new FileReader();
  reader.onload = function(){
    fetch('/api/accountants/clients/attach', {method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body: JSON.stringify({ userId: _userId, name: f.name, mime: f.type||'application/octet-stream', dataB64: String(reader.result||'') })})
      .then(r => r.ok ? r.json() : r.json().then(j => { throw new Error(j.error||'Upload failed'); }))
      .then(row => { if(!_msgs.some(m => m.id === row.id)){ _msgs.push(row); renderMessages(); } })
      .catch(e => alert(e.message || 'Upload failed'));
    inputEl.value='';
  };
  reader.readAsDataURL(f);
};

async function loadMessages() {
  const el = document.getElementById('messages-thread');
  if (!el) return;
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/messages`, {credentials:'include'});
    if (!r.ok) { el.innerHTML = '<div class="empty" style="margin:auto">Could not load messages.</div>'; return; }
    const data = await r.json();
    _msgs = data.messages || [];
    _otherLastRead = data.otherLastRead || null;
    renderMessages();
    clearMsgNavBadge();
    openMsgStream();
    if (!_msgPoll) _msgPoll = setInterval(refreshMessages, 20000);  // backstop if SSE ever drops
  } catch(e) { el.innerHTML = '<div class="empty" style="margin:auto">Could not load messages.</div>'; }
}

// Light re-fetch used by the poll fallback (no stream reconnect churn).
async function refreshMessages() {
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/messages`, {credentials:'include'});
    if (!r.ok) return;
    const data = await r.json();
    _msgs = data.messages || [];
    _otherLastRead = data.otherLastRead || null;
    renderMessages();
  } catch(e) {}
}

function openMsgStream() {
  if (_msgSse) return;
  try {
    _msgSse = new EventSource(`/api/accountants/clients/${_userId}/stream`, { withCredentials: true });
    _msgSse.addEventListener('message', (e) => {
      const d = JSON.parse(e.data);
      if (_msgs.some(m => m.id === d.id)) return;   // de-dupe our own echoed send
      _msgs.push(d);
      renderMessages();
      // A message we're seeing live is read by us the moment it lands — tell the other side.
      if (d.sender === 'client') markRead();
    });
    _msgSse.addEventListener('read', (e) => {
      const d = JSON.parse(e.data);
      if (d.by === 'client') { _otherLastRead = d.at; renderMessages(); }
    });
    _msgSse.addEventListener('typing', (e) => {
      const d = JSON.parse(e.data);
      if (d.by === 'client') showTyping();
    });
    _msgSse.onerror = () => { try { _msgSse.close(); } catch(_){} _msgSse = null; setTimeout(openMsgStream, 4000); };
  } catch(e) { _msgSse = null; }
}

function showTyping() {
  const t = document.getElementById('msg-typing');
  if (!t) return;
  t.innerHTML = 'Client is typing<span class="tdot">.</span><span class="tdot">.</span><span class="tdot">.</span>';
  clearTimeout(_typingHideTimer);
  _typingHideTimer = setTimeout(() => { t.innerHTML = ''; }, 3000);
}

function onMsgTyping() {
  const now = Date.now();
  if (now - _typingSentAt < 2000) return;   // throttle: at most one signal / 2s
  _typingSentAt = now;
  fetch(`/api/accountants/clients/${_userId}/typing`, { method:'POST', credentials:'include' }).catch(()=>{});
}
function onMsgKey(ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendMessage(); }
}
async function markRead() {
  // Re-open (GET) is what stamps accountant_last_read server-side; cheap and idempotent.
  fetch(`/api/accountants/clients/${_userId}/messages`, {credentials:'include'}).catch(()=>{});
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const message = (input?.value || '').trim();
  if (!message) return;
  input.value = '';
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/messages`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content: message}),
    });
    if (!r.ok) { showToast('Send failed', 'error'); input.value = message; return; }
    const row = await r.json();
    if (!_msgs.some(m => m.id === row.id)) { _msgs.push({ ...row, sender:'accountant' }); renderMessages(); }
  } catch(e) { showToast('Send failed', 'error'); input.value = message; }
}

// Nav unread badge for the "Message Client" item.
async function updateMsgNavBadge() {
  try {
    const r = await fetch(`/api/accountants/clients/${_userId}/unread`, {credentials:'include'});
    if (!r.ok) return;
    const { unread } = await r.json();
    setMsgNavBadge(unread || 0);
  } catch(e) {}
}
function setMsgNavBadge(n) {
  const nav = document.querySelector('.nav-item[onclick*="messages"]');
  if (!nav) return;
  let b = nav.querySelector('.nav-badge');
  if (n > 0) { if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; nav.appendChild(b); } b.textContent = n; }
  else if (b) b.remove();
}
function clearMsgNavBadge() { setMsgNavBadge(0); }

// ── UTILS ──────────────────────────────────────────────────────────────────
function set(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }
function esc(s) { return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

function showToast(msg, type='') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${type==='error'?'#2a0d0d':'#1a1a10'};color:${type==='error'?'#c45c5c':'#c9a84c'};border:1px solid ${type==='error'?'rgba(196,92,92,.3)':'rgba(201,168,76,.3)'};border-radius:8px;padding:10px 18px;font-size:13px;z-index:9999;font-family:'Jost',sans-serif;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}
