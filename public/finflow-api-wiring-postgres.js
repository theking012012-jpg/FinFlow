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
  window.refreshFinancials = async function () {
    try {
      const activeEntity = (window.ENTITIES || []).find(e => e.active);
      const eid = activeEntity?._dbId;
      const eq  = eid ? '?entity_id=' + eid : '';

      const [invoices, expenses] = await Promise.all([
        api('GET', '/api/invoices' + eq),
        api('GET', '/api/expenses' + eq),
      ]);

      // Update userInvoices — used by renderInvoices() and legacy updateDashboard()
      window.userInvoices = (invoices || []).map(r => ({
        _dbId:    r.id,
        client:   r.client,
        amount:   r.amount,
        due:      r.due_date
          ? new Date(r.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'TBD',
        due_date: r.due_date,
        status:   r.status,
        notes:    r.notes || '',
        color:    r.status === 'overdue' ? 'var(--red)' : 'var(--t2)',
      }));

      // Update bizExpenses — used by renderExpenses() and legacy updateDashboard()
      window.bizExpenses = (expenses || []).map(r => ({
        _dbId:  r.id,
        desc:   r.description,
        cat:    r.category,
        amount: r.amount,
        ded:    r.deductible,
        date:   r.expense_date
          ? new Date(r.expense_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'Today',
      }));

      // Update _realInvoices/_realExpenses — used by the patched updateDashboard()
      // (finflow-api-wiring-dashboard.js overwrites updateDashboard to read these)
      window._realInvoices = invoices || [];
      window._realExpenses = expenses || [];

      // Re-render invoice + expense lists
      if (typeof window.renderInvoices === 'function') window.renderInvoices();
      if (typeof window.renderExpenses === 'function') window.renderExpenses();

      // Re-render dashboard KPIs, expense bars, transaction list, invoice stats
      // updateDashboard is patched to read _realInvoices/_realExpenses, so this
      // will show the freshly-fetched data without a page reload.
      if (typeof window.updateDashboard === 'function') window.updateDashboard();
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
    const collected    = invs.filter(i => i.status === 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const outstanding  = invs.filter(i => i.status !== 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const overdue      = invs.filter(i => i.status === 'overdue').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const overdueCount = invs.filter(i => i.status === 'overdue').length;
    const outCount     = invs.filter(i => i.status !== 'paid').length;
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
  window.addEventListener('DOMContentLoaded', function () {
    // Small delay so the banner has been injected into the DOM first
    setTimeout(function () {
      const banner = document.getElementById('data-safety-banner');
      if (!banner) return;
      const span = banner.querySelector('span[style*="flex"]');
      if (span) {
        span.innerHTML =
          'Your data is <strong style="color:#f2e8d5">securely stored in the cloud</strong> ' +
          '— backed by PostgreSQL on Railway. It\'s safe across all browsers and devices.';
      }
    }, 600);
  });

  console.log('[FinFlow] Postgres wiring active — localStorage persistence neutralised.');
})();
