// ════════════════════════════════════════════════════════════════════
// FINFLOW — POSTGRES FINAL WIRING
// Completes the localStorage → Postgres migration by:
//   ✅ Neutralising loadPersistedData() — data comes from the API
//   ✅ Neutralising persistAll()        — API is now the source of truth
//   ✅ saveJournalEntry()  → POST /api/journals
//   ✅ addBusiness()       → POST /api/entities (then reload)
//   ✅ Clearing stale journalEntries array on boot
//   ✅ Replacing the "browser-only" data-safety banner with a cloud message
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `API ${res.status}`);
    }
    return res.json();
  }

  function tip(msg, isErr) {
    if (typeof window.notify === 'function') window.notify(msg, isErr);
    else console.warn('[FinFlow]', msg);
  }

  // ── 1. Neutralise localStorage persistence ────────────────────────
  // Data is now durably stored in PostgreSQL — no need to mirror it
  // to localStorage. Making these no-ops prevents stale local data from
  // conflicting with the authoritative API responses.
  window.loadPersistedData = function () {};
  window.persistAll        = function () {};

  // Also clear any locally-cached journal entries that came from
  // localStorage so renderJournalsLive() shows only what's in the DB.
  if (typeof window.journalEntries !== 'undefined') {
    window.journalEntries.length = 0;
  }

  // ── 2. Wire saveJournalEntry → POST /api/journals ─────────────────
  window.saveJournalEntry = async function (status) {
    const rawLines = (window._jeLines || []).filter(
      l => l.code && (l.dr > 0 || l.cr > 0)
    );
    if (rawLines.length < 2) { tip('Add at least 2 lines', true); return; }

    const totalDr = rawLines.reduce((s, l) => s + (l.dr || 0), 0);
    const totalCr = rawLines.reduce((s, l) => s + (l.cr || 0), 0);
    if (status === 'Posted' && Math.abs(totalDr - totalCr) > 0.01) {
      tip('Debits must equal credits to post', true); return;
    }

    const date        = document.getElementById('je-date')?.value || new Date().toISOString().slice(0, 10);
    const description = document.getElementById('je-notes')?.value?.trim() || 'Manual journal entry';

    // Map frontend dr/cr fields → API debit/credit field names
    const apiLines = rawLines.map(l => ({
      code:   l.code,
      name:   l.name  || '',
      debit:  l.dr    || 0,
      credit: l.cr    || 0,
    }));

    try {
      await api('POST', '/api/journals', { date, description, lines: apiLines, status });
      if (typeof window.renderJournals === 'function') window.renderJournals();
      if (typeof window.renderCOA      === 'function') window.renderCOA();
      if (typeof window.closeModal     === 'function') window.closeModal('journal-entry-modal');
      tip('Journal entry ' + status.toLowerCase());
    } catch (e) {
      tip('Could not save journal entry — ' + e.message, true);
    }
  };

  // ── 3. Wire addBusiness → POST /api/entities ──────────────────────
  // The old addBusiness() only saved to localStorage. Now it persists
  // to Postgres and reloads entities so the sidebar stays in sync.
  window.addBusiness = async function () {
    const name = document.getElementById('nb-name')?.value?.trim();
    if (!name) { tip('Please enter a business name', true); return; }

    const currency = document.getElementById('nb-currency')?.value || 'USD';
    const industry = document.getElementById('nb-industry')?.value || '';

    // Pick a colour from the same cycle the old code used
    const colors   = ['#c9a84c', '#9e8fbf', '#5aaa9e', '#d4964a', '#7db87d', '#c46a5a'];
    const color    = colors[(window.businesses || []).length % colors.length];

    try {
      await api('POST', '/api/entities', { name, currency, color, tag: industry || 'Business' });
      if (typeof window.closeModal === 'function') window.closeModal('add-biz-modal');
      // Reload entities from DB so sidebar + switcher update
      if (typeof window.loadEntitiesFromDB === 'function') await window.loadEntitiesFromDB();
      tip(`Business "${name}" created ✦`);
    } catch (e) {
      tip('Could not create business — ' + e.message, true);
    }
  };

  // ── 4. Live refresh helper ───────────────────────────────────────────
  // Called after any create/edit/delete so the dashboard and lists
  // immediately reflect the authoritative API state without a page reload.
  // Targeted refresh. `hint` filters which collections re-fetch:
  //   'all'              — invoices + expenses (default, backwards-compatible)
  //   'invoices'|'revenue' — invoices only
  //   'expenses'|'costs'   — expenses only
  //   'none'             — skip API fetches, just re-render the active page
  window.refreshFinancials = async function (hint) {
    if (hint === undefined) hint = 'all';
    try {
      const activeEntity = (window.ENTITIES || []).find(e => e.active);
      const eid = activeEntity?._dbId;
      const eq  = eid ? '?entity_id=' + eid : '';

      const fetchInv = ['all','invoices','revenue'].includes(hint);
      const fetchExp = ['all','expenses','costs'].includes(hint);
      const fetches = [
        fetchInv ? api('GET', '/api/invoices' + eq) : Promise.resolve(null),
        fetchExp ? api('GET', '/api/expenses' + eq) : Promise.resolve(null),
      ];
      const [invoices, expenses] = await Promise.all(fetches);

      // ── Refresh canonical arrays only when re-fetched ──────────────
      if (fetchInv && invoices) {
        window.userInvoices = invoices.map(r => ({
          _dbId:    r.id,
          client:   r.client,
          amount:   r.amount,
          due:      r.due_date
            ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'TBD',
          due_date: r.due_date,
          status:   r.status,
          notes:    r.notes || '',
          color:    r.status?.toLowerCase() === 'overdue' ? 'var(--red)' : 'var(--t2)',
        }));
        window._realInvoices = invoices;
      }

      if (fetchExp && expenses) {
        window.bizExpenses = expenses.map(r => ({
          _dbId:  r.id,
          desc:   r.description,
          cat:    r.category,
          amount: r.amount,
          ded:    r.deductible,
          date:   r.expense_date
            ? new Date(r.expense_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'Today',
        }));
        window._realExpenses = expenses;
      }

      // ── Detect the currently open page ────────────────────────────
      // window.currentPage is set by the showPage tracking wrapper below.
      // Fall back to DOM inspection for robustness.
      const _curPage = window.currentPage
        || document.querySelector('.page.active')?.id?.replace('page-', '')
        || 'dashboard';

      // ── Re-render the active page (list rows + stat cards) ─────────
      // Each page's render function rebuilds BOTH the table rows and the
      // stat/KPI cards at the top of that page from the current in-memory
      // arrays (which the save handler already updated optimistically).
      const _renderDispatch = {
        'invoices':           () => { if (typeof window.renderInvoices          === 'function') window.renderInvoices(); },
        'expenses':           () => { if (typeof window.renderExpenses          === 'function') window.renderExpenses(); },
        'customers':          () => { if (typeof window.renderCustomers         === 'function') window.renderCustomers(); },
        'payroll':            () => { if (typeof window.renderPayroll           === 'function') window.renderPayroll(); },
        'inventory':          () => { if (typeof window.renderInventory         === 'function') window.renderInventory(); },
        'items':              () => { if (typeof window.renderItems             === 'function') window.renderItems(); },
        'quotes':             () => { if (typeof window.renderQuotes            === 'function') window.renderQuotes(); },
        'vendors':            () => { if (typeof window.renderVendors           === 'function') window.renderVendors(); },
        'bills':              () => { if (typeof window.renderBills             === 'function') window.renderBills(); },
        'payments-received':  () => { if (typeof window.renderPaymentsReceived  === 'function') window.renderPaymentsReceived(); },
        'payments-made':      () => { if (typeof window.renderPaymentsMade      === 'function') window.renderPaymentsMade(); },
        'sales-receipts':     () => { if (typeof window.renderReceipts          === 'function') window.renderReceipts(); },
        'recurring-invoices': () => { if (typeof window.renderRecurringInvoices === 'function') window.renderRecurringInvoices(); },
        'recurring-bills':    () => { if (typeof window.renderRecurringBills    === 'function') window.renderRecurringBills(); },
        'credit-notes':       () => { if (typeof window.renderCreditNotes       === 'function') window.renderCreditNotes(); },
        'vendor-credits':     () => { if (typeof window.renderVendorCredits     === 'function') window.renderVendorCredits(); },
        'projects':           () => { if (typeof window.renderProjects          === 'function') window.renderProjects(); },
        'timesheet':          () => { if (typeof window.renderTimesheet         === 'function') window.renderTimesheet(); },
        'investments':        () => { if (typeof window.renderInvestments       === 'function') window.renderInvestments(); },
        'personal':           () => { if (typeof window.renderPersonal          === 'function') window.renderPersonal(); },
        'manual-journals':    () => { if (typeof window.renderJournals          === 'function') window.renderJournals(); },
        'chart-of-accounts':  () => { if (typeof window.renderCOA              === 'function') window.renderCOA(); },
        'reports':            () => { if (typeof window.renderReports           === 'function') window.renderReports(); },
        'budget':             () => { if (typeof window.renderBudget            === 'function') window.renderBudget(); },
        'cashflow':           () => { if (typeof window.renderCashflow          === 'function') window.renderCashflow(); },
        // PL#11: tax-filing is a static placeholder — no render hook (calcAndRenderTax removed).
      };

      const _pgFn = _renderDispatch[_curPage];
      if (_pgFn) _pgFn();

      // ── Always rebuild dashboard KPIs + charts ─────────────────────
      if (typeof window._refreshDashboardUI === 'function') {
        window._refreshDashboardUI();
      } else if (typeof window.updateDashboard === 'function') {
        window.updateDashboard();
      }

      // ── Refresh journal and COA KPI cards if on those pages ────────
      if (_curPage === 'manual-journals' && typeof window.renderJournals === 'function') {
        window.renderJournals();
      }
      if (_curPage === 'chart-of-accounts' && typeof window.renderCOA === 'function') {
        window.renderCOA();
      }

      // ── Refresh personal finance income from payroll ────────────────
      if (typeof window.syncPayrollToPersonal === 'function') {
        window.syncPayrollToPersonal();
      }

      // ── Reload budget progress bars with fresh expense data ─────────
      if (typeof window._loadBudgetFromDB === 'function') {
        window._loadBudgetFromDB().catch(() => {});
      }

      // ── Refresh journal + COA KPI cards ────────────────────────────
      if (typeof window.renderJournals === 'function' && (_curPage === 'manual-journals' || _curPage === 'chart-of-accounts')) {
        window.renderJournals();
      }
      if (typeof window.renderCOA === 'function' && _curPage === 'chart-of-accounts') {
        window.renderCOA();
      }

      // ── Refresh personal finance surfaces (net worth, transactions) ─
      if (typeof window.loadPersonalFinance === 'function') {
        window.loadPersonalFinance().catch(() => {});
      }

      console.log('[FinFlow] refreshFinancials ✅ page:', _curPage,
        '— hint:', hint,
        '— inv:', invoices ? invoices.length : 'skipped',
        'exp:',  expenses ? expenses.length : 'skipped');
    } catch (err) {
      console.warn('[FinFlow] refreshFinancials failed:', err.message);
    }
  };

  // ── 5. Patch updateInvoices to read from API data ────────────────
  // index.html declares `let userInvoices = []` which is NOT window.userInvoices —
  // so the original updateInvoices() always reads an empty/stale closure binding.
  // We replace it with a version that reads from window._realInvoices (API source
  // of truth) and also updates the count subtitles which have no IDs in the HTML.
  window.updateInvoices = function (d) {
    const invs = window._realInvoices || window.userInvoices;
    if (!invs) return;
    const money  = n => typeof S === 'function' ? S(n) : '$' + (parseFloat(n) || 0).toLocaleString();
    const set    = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const period = d || (typeof getPeriodData === 'function' ? getPeriodData() : { label: 'All time' });

    const totalBilled  = invs.reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const collected    = invs.filter(i => i.status?.toLowerCase() === 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const outstanding  = invs.filter(i => i.status?.toLowerCase() !== 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const overdue      = invs.filter(i => i.status?.toLowerCase() === 'overdue').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const overdueCount = invs.filter(i => i.status?.toLowerCase() === 'overdue').length;
    const outCount     = invs.filter(i => i.status?.toLowerCase() !== 'paid').length;
    const pctCollected = totalBilled > 0 ? Math.round(collected / totalBilled * 100) : 0;

    set('inv-billed',     money(totalBilled));
    set('inv-paid',       money(collected));
    set('inv-paid-pct',   pctCollected + '% collected');
    set('inv-out',        money(outstanding));
    set('inv-over',       money(overdue));
    const lblEl = document.getElementById('inv-billed-lbl');
    if (lblEl) { lblEl.textContent = period.label || 'All time'; lblEl.className = 'mc-change neutral'; }
    const titleEl = document.getElementById('inv-table-title');
    if (titleEl) titleEl.textContent = 'Invoices — ' + (period.label || 'All time');

    // Update "N invoices" count subtitles (id="inv-out-cnt" / "inv-over-cnt")
    set('inv-out-cnt',  outCount     + ' invoice' + (outCount     !== 1 ? 's' : ''));
    set('inv-over-cnt', overdueCount + ' invoice' + (overdueCount !== 1 ? 's' : ''));

    // Navigation badge
    const badge = document.getElementById('badge-inv');
    if (badge) { badge.textContent = overdueCount; badge.style.display = overdueCount > 0 ? '' : 'none'; }
  };

  // ── 6. Update data-safety banner to reflect cloud storage ─────────
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
    // Small delay so the banner has been injected into the DOM first
    setTimeout(function () {
      const banner = document.getElementById('data-safety-banner');
      if (!banner) return;
      const span = banner.querySelector('span[style*="flex"]');
      if (span) {
        span.innerHTML =
          'Your data is <strong style="color:#f2e8d5">securely stored in the cloud</strong> ' +
          '— backed by PostgreSQL on Supabase. It\'s safe across all browsers and devices.';
      }
    }, 600);
  })();

  // ── 7. Track current page so refreshFinancials dispatches correctly ─
  // ── Also wrap loadEntitiesFromDB to reload vendors/bills on entity switch
  (function _run2() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run2); return; }
    // Outermost showPage wrapper — runs first, sets currentPage, then calls chain
    const _pgTrack = window.showPage;
    if (typeof _pgTrack === 'function') {
      window.showPage = function (id, navEl) {
        window.currentPage = id;
        return _pgTrack(id, navEl);
      };
    }
    // Set initial page from DOM in case showPage was never called yet
    if (!window.currentPage) {
      window.currentPage = document.querySelector('.page:not(.hidden)')?.id?.replace('page-', '') || 'dashboard';
    }

    // Wrap loadEntitiesFromDB to also reload vendors/bills after entity switch
    const _origLoadEnt = (typeof loadEntitiesFromDB === 'function') ? loadEntitiesFromDB : null;
    if (_origLoadEnt) {
      window.loadEntitiesFromDB = async function () {
        await _origLoadEnt();
        if (typeof window._loadVendorsFromDB === 'function') try { await window._loadVendorsFromDB(); } catch(e) {}
        if (typeof window._loadBillsFromDB   === 'function') try { await window._loadBillsFromDB();   } catch(e) {}
      };
    }
  })();

  // ── window.finflow.refresh(sections[]) ────────────────────────────
  // Global real-time refresh dispatcher. Call after any DB write with an
  // array of affected section names. Falls back to full refreshFinancials.
  window.finflow = window.finflow || {};
  window.finflow.refresh = function (sections) {
    const all = sections || [];
    // Page-specific re-renders
    const dispatch = {
      'invoices':           () => { if (typeof window.renderInvoices          === 'function') window.renderInvoices(); },
      'expenses':           () => { if (typeof window.renderExpenses          === 'function') window.renderExpenses(); },
      'customers':          () => { if (typeof window.renderCustomers         === 'function') window.renderCustomers(); },
      'payroll':            () => { if (typeof window.renderPayroll           === 'function') window.renderPayroll(); },
      'inventory':          () => { if (typeof window.renderInventory         === 'function') window.renderInventory(); },
      'budget':             () => { if (typeof window.renderBudget            === 'function') window.renderBudget(); if (typeof window._loadBudgetFromDB === 'function') window._loadBudgetFromDB().catch(()=>{}); },
      'banking':            () => { if (typeof window._loadVendorsFromDB      === 'function') window._loadVendorsFromDB().catch(()=>{}); if (typeof window._loadBillsFromDB === 'function') window._loadBillsFromDB().catch(()=>{}); },
      'journal':            () => { if (typeof window.renderJournals          === 'function') window.renderJournals(); },
      'chart-of-accounts':  () => { if (typeof window.renderCOA              === 'function') window.renderCOA(); },
      'reports':            () => { if (typeof window.renderReports           === 'function') window.renderReports(); },
      'cashflow':           () => { if (typeof window.renderCashflow          === 'function') window.renderCashflow(); },
      // PL#11: tax-filing is a static placeholder — no render hook (calcAndRenderTax removed).
      'time-tracking':      () => { if (typeof window.renderTimesheet         === 'function') window.renderTimesheet(); },
      'investments':        () => { if (typeof window.renderInvestments       === 'function') window.renderInvestments(); },
      'documents':          () => { if (typeof window.renderDocuments         === 'function') window.renderDocuments(); },
      'mrr':                () => { if (typeof window.renderMRR               === 'function') window.renderMRR(); },
      'money-in':           () => { if (typeof window.renderInvoices          === 'function') window.renderInvoices(); },
      'money-out':          () => { if (typeof window.renderExpenses          === 'function') window.renderExpenses(); },
      'personal-finance':   () => { if (typeof window.loadPersonalFinance     === 'function') window.loadPersonalFinance().catch(()=>{}); },
    };
    all.forEach(s => { const fn = dispatch[s]; if (fn) fn(); });
    // Always refresh dashboard when requested or when dashboard is in the list.
    // Pick a narrower hint when the affected sections only touch one side.
    if (!all.length || all.includes('dashboard')) {
      const hasInc = all.some(s => ['invoices','money-in','quotes','receipts','payments-received','credit-notes','recurring-invoices','revenue'].includes(s));
      const hasExp = all.some(s => ['expenses','money-out','vendors','bills','payments-made','vendor-credits','recurring-bills','payroll','budget','costs'].includes(s));
      const hint = (hasInc && !hasExp) ? 'invoices' : (hasExp && !hasInc) ? 'expenses' : 'all';
      if (typeof window.refreshFinancials === 'function') window.refreshFinancials(hint);
    } else if (typeof window._refreshDashboardUI === 'function') {
      window._refreshDashboardUI();
    }
  };

  console.log('[FinFlow] Postgres wiring active — DB-only, zero localStorage.');

  // ── Define renderMRR so the finflow.refresh dispatch actually works ──
  // index.html exposes renderMRRChart + loadMRRData but not a unified renderMRR.
  // This wrapper calls both so any save that triggers 'mrr' refresh rebuilds
  // both the chart and the subscriber data.
  window.renderMRR = function () {
    if (typeof window.loadMRRData      === 'function') window.loadMRRData().catch(() => {});
    if (typeof window.renderMRRChart   === 'function') window.renderMRRChart();
  };

})();
