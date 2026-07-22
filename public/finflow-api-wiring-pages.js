// ════════════════════════════════════════════════════════════════════
// FINFLOW — API WIRING (ALL REMAINING PAGES)
// Wires: Quotes, Sales Receipts, Payments Received, Recurring Invoices,
//        Credit Notes, Vendors, Bills, Payments Made, Recurring Bills,
//        Vendor Credits
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

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const uid4 = () => String(Date.now()).slice(-4);

  // ── KPI card helpers ──────────────────────────────────────────────
  // Sets the .mc-val cells of a page by index; null/undefined entries are
  // skipped so cards with no derivable value keep their placeholder.
  function setKpiCards(pageId, vals) {
    const els = document.querySelectorAll('#' + pageId + ' .mc-val');
    vals.forEach((v, i) => { if (v != null && els[i]) els[i].textContent = v; });
  }
  // Monthly-equivalent value of a recurring amount given its frequency.
  function monthlyEquiv(amount, frequency) {
    const a = parseFloat(amount) || 0;
    const f = String(frequency || 'Monthly').toLowerCase();
    if (f.startsWith('week'))    return a * 52 / 12;
    if (f.startsWith('quarter')) return a / 3;
    if (f.startsWith('year') || f.startsWith('annual')) return a / 12;
    return a;
  }
  function inThisMonth(d) {
    if (!d) return false;
    const dt = new Date(d);
    if (isNaN(dt)) return false;
    const now = new Date();
    return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
  }

  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }

    // ════════════════════════════════════════════
    // QUOTES
    // ════════════════════════════════════════════
    let _quotesData = [], _quotesFetched = false;

    async function loadQuotes() {
      try {
        const rows = await api('GET', '/api/quotes');
        _quotesFetched = true;
        _quotesData = rows || [];
        window.quotes = _quotesData;
        console.log('[Quotes] loaded', _quotesData.length);
        renderQuotes();
      } catch (e) { console.warn('[Quotes]', e.message); }
    }
    loadQuotes();

    window.renderQuotes = function () {
      if (!_quotesFetched) { loadQuotes(); return; }
      const el = document.getElementById('quotes-list');
      if (!el) return;
      const cls = { pending: 'b-amber', accepted: 'b-green', declined: 'b-red' };
      el.innerHTML = _quotesData.length
        ? _quotesData.map(q => `
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(q.client)}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(q.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(q.amount)}</span>
            <span style="color:var(--t2)">${esc(q.expiry_date || '—')}</span>
            <span><span class="badge ${cls[q.status] || 'b-amber'}">${esc(q.status)}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteQuote(${q.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No quotes yet — click + New Quote to create one</div>';
      const accepted = _quotesData.filter(q => q.status?.toLowerCase() === 'accepted').length;
      const pending  = _quotesData.filter(q => q.status?.toLowerCase() === 'pending').length;
      const openVal  = _quotesData.filter(q => q.status?.toLowerCase() === 'pending').reduce((s, q) => s + (q.amount || 0), 0);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('qt-total', _quotesData.length);
      set('qt-accepted', accepted);
      set('qt-pending', pending);
      set('qt-value', S(openVal));
    };

    window.openNewQuoteModal = function () {
      ['quote-client','quote-amount','quote-expiry','quote-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const s = document.getElementById('quote-status'); if (s) s.value = 'pending';
      openModal('quote-modal');
    };

    window.saveQuote = async function () {
      const client = document.getElementById('quote-client')?.value?.trim();
      const amount = parseFloat(document.getElementById('quote-amount')?.value);
      if (!client) { notify('Client name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const expiry_date = document.getElementById('quote-expiry')?.value || null;
      const status = document.getElementById('quote-status')?.value || 'pending';
      const notes  = document.getElementById('quote-notes')?.value?.trim() || '';
      try {
        const saved = await api('POST', '/api/quotes', { client, amount, expiry_date, status, notes });
        _quotesData.unshift(saved.row || saved);
        window.quotes = _quotesData;
        closeModal('quote-modal');
        renderQuotes();
        notify(`Quote for ${esc(client)} saved ✦`);
        loadQuotes().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteQuote = async function (id) {
      const q = _quotesData.find(r => r.id === id);
      if (!q || !confirm(`Delete quote for ${q.client}? This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/quotes/${id}`);
        _quotesData = _quotesData.filter(r => r.id !== id);
        renderQuotes();
        notify('Quote deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // SALES RECEIPTS
    // ════════════════════════════════════════════
    let _receiptsData = [], _receiptsFetched = false;

    async function loadReceipts() {
      try {
        const rows = await api('GET', '/api/sales-receipts');
        _receiptsFetched = true;
        _receiptsData = rows || [];
        window.receipts = _receiptsData;
        console.log('[Receipts] loaded', _receiptsData.length);
        renderReceipts();
      } catch (e) { console.warn('[Receipts]', e.message); }
    }
    loadReceipts();

    window.renderReceipts = function () {
      if (!_receiptsFetched) { loadReceipts(); return; }
      const el = document.getElementById('receipts-list');
      if (!el) return;
      el.innerHTML = _receiptsData.length
        ? _receiptsData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.customer || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span style="color:var(--t2)">${esc(r.method || '')}</span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteReceipt(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No receipts yet</div>';
      // KPI cards: count · cash sales · card/stripe sales · refunds
      const _rcCash = _receiptsData.filter(r => /cash/i.test(r.method || '')).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _rcCard = _receiptsData.filter(r => /card|stripe/i.test(r.method || '')).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _rcRefund = _receiptsData.filter(r => (parseFloat(r.amount) || 0) < 0).reduce((s, r) => s + Math.abs(parseFloat(r.amount) || 0), 0);
      setKpiCards('page-sales-receipts', [_receiptsData.length, S(_rcCash), S(_rcCard), S(_rcRefund)]);
      window._refreshDashboardUI?.();
    };

    window.openNewReceiptModal = function () {
      ['receipt-customer','receipt-amount','receipt-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('receipt-date'); if (d) d.value = todayStr();
      const m = document.getElementById('receipt-method'); if (m) m.value = 'Card';
      openModal('modal-receipt');
    };

    window.saveReceipt = async function () {
      const customer = document.getElementById('receipt-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('receipt-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('receipt-date')?.value   || todayStr();
      const method = document.getElementById('receipt-method')?.value || 'Card';
      const notes  = document.getElementById('receipt-notes')?.value?.trim() || '';
      const num    = 'SR-' + uid4();
      try {
        const saved = await api('POST', '/api/sales-receipts', { customer, num, amount, date, method, notes });
        _receiptsData.unshift(saved.row || saved);
        window.receipts = _receiptsData;
        closeModal('modal-receipt');
        renderReceipts();
        notify(`Receipt for ${esc(customer)} saved ✦`);
        loadReceipts().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteReceipt = async function (id) {
      if (!confirm('Delete this receipt? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/sales-receipts/${id}`);
        _receiptsData = _receiptsData.filter(r => r.id !== id);
        renderReceipts();
        notify('Receipt deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // PAYMENTS RECEIVED
    // ════════════════════════════════════════════
    let _paymentsRecvData = [], _paymentsRecvFetched = false;

    async function loadPaymentsReceived() {
      try {
        const rows = await api('GET', '/api/payments-received');
        _paymentsRecvFetched = true;
        _paymentsRecvData = rows || [];
        window.paymentsReceived = _paymentsRecvData;
        console.log('[Payments Received] loaded', _paymentsRecvData.length);
        renderPaymentsReceived();
      } catch (e) { console.warn('[Payments Received]', e.message); }
    }
    loadPaymentsReceived();

    window.renderPaymentsReceived = function () {
      if (!_paymentsRecvFetched) { loadPaymentsReceived(); return; }
      const el = document.getElementById('payments-recv-list');
      if (!el) return;
      el.innerHTML = _paymentsRecvData.length
        ? _paymentsRecvData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 110px 80px 80px 90px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.customer || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.invoice_ref || '—')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span style="color:var(--t2)">${esc(r.method || '')}</span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deletePaymentReceived(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No payments received yet</div>';
      // KPI cards: total received · outstanding · overdue · avg days to pay
      // Outstanding/overdue are derived from window._realInvoices (set by the
      // dashboard wiring). Avg-days-to-pay isn't derivable from the current
      // payment shape (no paid_at vs due_date), so it stays as the "—" placeholder.
      const _prTotal = _paymentsRecvData.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _prInvs = window._realInvoices || [];
      // F56: same canonical AR definition as the dashboard card, the Invoices page and the
      // server — otherwise this page showed a different Outstanding than the dashboard did.
      const _prAr = (typeof window._arOutstanding === 'function')
        ? window._arOutstanding(_prInvs) : { total: 0, overdueTotal: 0 };
      const _prOut = _prAr.total;
      const _prOver = _prAr.overdueTotal;
      setKpiCards('page-payments-received', [S(_prTotal), S(_prOut), S(_prOver), null]);
      window._refreshDashboardUI?.();
    };

    // F35 Step 5: this Store-A "payment received" opener is renamed off the colliding
    // `openRecordPaymentModal` name (which now belongs SOLELY to the invoice Store-B opener,
    // index.html:4160). The invoice "Record Payment" button therefore reaches Store B (real
    // invoice_id, flips status via recalcInvoiceStatus), not this blank received-payment form.
    window.openPaymentReceivedModal = function () {
      ['pr-customer','pr-invoice-ref','pr-amount','pr-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('pr-date'); if (d) d.value = todayStr();
      const m = document.getElementById('pr-method'); if (m) m.value = 'Bank Transfer';
      openModal('modal-payment-received');
    };

    window.savePaymentReceived = async function () {
      const customer = document.getElementById('pr-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('pr-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const invoice_ref = document.getElementById('pr-invoice-ref')?.value?.trim() || '';
      const date        = document.getElementById('pr-date')?.value   || todayStr();
      const method      = document.getElementById('pr-method')?.value || 'Bank Transfer';
      const notes       = document.getElementById('pr-notes')?.value?.trim() || '';
      try {
        const saved = await api('POST', '/api/payments-received', { customer, invoice_ref, amount, date, method, notes });
        _paymentsRecvData.unshift(saved.row || saved);
        window.paymentsReceived = _paymentsRecvData;
        closeModal('modal-payment-received');
        renderPaymentsReceived();
        notify(`Payment from ${esc(customer)} recorded ✦`);
        loadPaymentsReceived().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deletePaymentReceived = async function (id) {
      if (!confirm('Delete this payment record? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/payments-received/${id}`);
        _paymentsRecvData = _paymentsRecvData.filter(r => r.id !== id);
        renderPaymentsReceived();
        notify('Payment record deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // RECURRING INVOICES
    // ════════════════════════════════════════════
    let _recurringInvData = [], _recurringInvFetched = false;

    async function loadRecurringInvoices() {
      try {
        const rows = await api('GET', '/api/recurring-invoices');
        _recurringInvFetched = true;
        _recurringInvData = rows || [];
        window.recurringInvoices = _recurringInvData;
        console.log('[Recurring Invoices] loaded', _recurringInvData.length);
        renderRecurringInvoices();
      } catch (e) { console.warn('[Recurring Invoices]', e.message); }
    }
    loadRecurringInvoices();

    window.renderRecurringInvoices = function () {
      if (!_recurringInvFetched) { loadRecurringInvoices(); return; }
      const el = document.getElementById('recurring-inv-list');
      if (!el) return;
      const cls = { active: 'b-green', paused: 'b-amber' };
      el.innerHTML = _recurringInvData.length
        ? _recurringInvData.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(r.client)}</div>
              <div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(r.frequency)} · Next: ${esc(r.next_run || '—')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:var(--font-mono);font-weight:600">${S(r.amount)}</span>
              <span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status)}</span>
              <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteRecurringInvoice(${r.id})">✕</button>
            </div>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No recurring invoice profiles yet</div>';
      // KPI cards: active count · monthly value · next run · YTD generated
      // YTD comes from invoices that the recurring scheduler created (server
      // tags them with notes "Auto-generated from recurring schedule").
      const _riActive = _recurringInvData.filter(r => r.status?.toLowerCase() === 'active');
      const _riMonthly = _riActive.reduce((s, r) => s + monthlyEquiv(r.amount, r.frequency), 0);
      const _riNext = _riActive.map(r => r.next_run).filter(Boolean).sort()[0] || '—';
      const _riYtd = (window._realInvoices || [])
        .filter(i => (i.notes || '').includes('recurring schedule'))
        .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      setKpiCards('page-recurring-invoices', [_riActive.length, S(_riMonthly), _riNext, S(_riYtd)]);
      window._refreshDashboardUI?.();
    };

    window.openNewRecurringModal = function () {
      ['ri-client','ri-amount','ri-end'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const f = document.getElementById('ri-freq'); if (f) f.value = 'Monthly';
      const n = document.getElementById('ri-next'); if (n) n.value = todayStr();
      const s = document.getElementById('ri-status'); if (s) s.value = 'active';
      openModal('recurring-inv-modal');
    };

    window.saveRecurringInvoice = async function () {
      const client = document.getElementById('ri-client')?.value?.trim();
      const amount = parseFloat(document.getElementById('ri-amount')?.value);
      if (!client) { notify('Client name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const frequency = document.getElementById('ri-freq')?.value   || 'Monthly';
      const next_run  = document.getElementById('ri-next')?.value   || todayStr();
      const status    = document.getElementById('ri-status')?.value || 'active';
      const end_date  = document.getElementById('ri-end')?.value    || null;
      try {
        const saved = await api('POST', '/api/recurring-invoices', { client, amount, frequency, next_run, status, end_date });
        _recurringInvData.unshift(saved.row || saved);
        window.recurringInvoices = _recurringInvData;
        closeModal('recurring-inv-modal');
        renderRecurringInvoices();
        notify(`Recurring profile for ${esc(client)} saved ✦`);
        loadRecurringInvoices().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteRecurringInvoice = async function (id) {
      if (!confirm('Delete this recurring profile? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/recurring-invoices/${id}`);
        _recurringInvData = _recurringInvData.filter(r => r.id !== id);
        renderRecurringInvoices();
        notify('Profile deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // CREDIT NOTES
    // ════════════════════════════════════════════
    let _creditNotesData = [], _creditNotesFetched = false;

    async function loadCreditNotes() {
      try {
        const rows = await api('GET', '/api/credit-notes');
        _creditNotesFetched = true;
        _creditNotesData = rows || [];
        window.creditNotes = _creditNotesData;
        console.log('[Credit Notes] loaded', _creditNotesData.length);
        renderCreditNotes();
      } catch (e) { console.warn('[Credit Notes]', e.message); }
    }
    loadCreditNotes();

    window.renderCreditNotes = function () {
      if (!_creditNotesFetched) { loadCreditNotes(); return; }
      const el = document.getElementById('credit-notes-list');
      if (!el) return;
      const cls = { Open: 'b-amber', Applied: 'b-green', Void: 'b-red' };
      el.innerHTML = _creditNotesData.length
        ? _creditNotesData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.customer || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span><span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status || 'Open')}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteCreditNote(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No credit notes yet</div>';
      // KPI cards: count · open/unapplied sum · applied sum · this-month sum
      const _cnOpen = _creditNotesData.filter(r => r.status === 'Open').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _cnApplied = _creditNotesData.filter(r => r.status === 'Applied').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _cnMonthSum = _creditNotesData.filter(r => inThisMonth(r.date)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      setKpiCards('page-credit-notes', [_creditNotesData.length, S(_cnOpen), S(_cnApplied), S(_cnMonthSum)]);
      window._refreshDashboardUI?.();
    };

    window.openNewCreditNoteModal = function () {
      ['cn-customer','cn-amount','cn-reason'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('cn-date'); if (d) d.value = todayStr();
      const s = document.getElementById('cn-status'); if (s) s.value = 'Open';
      openModal('modal-credit-note');
    };

    window.saveCreditNote = async function () {
      const customer = document.getElementById('cn-customer')?.value?.trim();
      const amount   = parseFloat(document.getElementById('cn-amount')?.value);
      if (!customer) { notify('Customer name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('cn-date')?.value?.trim()   || todayStr();
      const status = document.getElementById('cn-status')?.value          || 'Open';
      const reason = document.getElementById('cn-reason')?.value?.trim()  || '';
      const num    = 'CN-' + uid4();
      try {
        const saved = await api('POST', '/api/credit-notes', { customer, num, amount, date, status, reason });
        _creditNotesData.unshift(saved.row || saved);
        window.creditNotes = _creditNotesData;
        closeModal('modal-credit-note');
        renderCreditNotes();
        notify(`Credit note for ${esc(customer)} saved ✦`);
        loadCreditNotes().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteCreditNote = async function (id) {
      if (!confirm('Delete this credit note? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/credit-notes/${id}`);
        _creditNotesData = _creditNotesData.filter(r => r.id !== id);
        renderCreditNotes();
        notify('Credit note deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('invoices');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // VENDORS
    // ════════════════════════════════════════════
    let _vendorsData = [], _vendorsFetched = false;

    async function loadVendors() {
      try {
        const _eidV2 = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/vendors' + (_eidV2 ? '?entity_id=' + _eidV2 : ''));
        _vendorsFetched = true;
        _vendorsData = rows || [];
        window.vendors = _vendorsData;
        console.log('[Vendors] loaded', _vendorsData.length);
        renderVendors();
      } catch (e) { console.warn('[Vendors]', e.message); }
    }
    loadVendors();

    function renderVendorRows(list) {
      const el = document.getElementById('vendors-list');
      if (!el) return;
      el.innerHTML = list.length
        ? list.map(v => `
          <div class="table-row" style="grid-template-columns:1fr 100px 90px 90px 80px 50px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div style="font-weight:500">${esc(v.name)}</div>
              <div style="font-size:11px;color:var(--t3)">${esc(v.contact || '—')}</div>
            </div>
            <span><span class="badge b-blue" style="font-size:10px">${esc(v.category || 'Other')}</span></span>
            <span style="color:${v.owing > 0 ? 'var(--amber)' : 'var(--t2)'}">
              ${v.owing > 0 ? S(v.owing) + ' owing' : '—'}
            </span>
            <span style="color:var(--t2)">${S(v.ytd_paid || 0)} YTD</span>
            <span><span class="badge ${v.status === 'active' ? 'b-green' : 'b-red'}">${esc(v.status || 'active')}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteVendor(${v.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No vendors yet</div>';
    }

    window.renderVendors = function () {
      if (!_vendorsFetched) { loadVendors(); return; }
      renderVendorRows(_vendorsData);
      // KPI cards: count · total payables (unpaid bills) · overdue · paid (payments-made)
      const _vPayables = _billsData.filter(b => b.status?.toLowerCase() !== 'paid').reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      const _vPaid = _paymentsMadeData.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      setKpiCards('page-vendors', [_vendorsData.length, S(_vPayables), null, S(_vPaid)]);
      window._refreshDashboardUI?.();
    };

    window.filterVendorsBySearch = function (v) {
      const q = v.toLowerCase();
      renderVendorRows(q
        ? _vendorsData.filter(r => (r.name || '').toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || (r.contact || '').toLowerCase().includes(q))
        : _vendorsData);
    };

    window.openNewVendorModal = function () {
      ['vendor-name','vendor-contact','vendor-owing','vendor-ytd'].forEach(id => { const el = document.getElementById(id); if (el) el.value = id.includes('owing') || id.includes('ytd') ? '0' : ''; });
      const c = document.getElementById('vendor-category'); if (c) c.value = 'Software';
      openModal('vendor-modal');
    };

    window.saveVendor = async function () {
      const name = document.getElementById('vendor-name')?.value?.trim();
      if (!name) { notify('Vendor name required', true); return; }
      const contact  = document.getElementById('vendor-contact')?.value?.trim()  || '';
      const category = document.getElementById('vendor-category')?.value          || 'Other';
      const owing    = parseFloat(document.getElementById('vendor-owing')?.value) || 0;
      const ytd_paid = parseFloat(document.getElementById('vendor-ytd')?.value)   || 0;
      try {
        const _eidVNew = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        const saved = await api('POST', '/api/vendors', { name, contact, category, owing, ytd_paid, status: 'active', entity_id: _eidVNew });
        _vendorsData.unshift(saved.row || saved);
        window.vendors = _vendorsData;
        closeModal('vendor-modal');
        renderVendors();
        notify(`${esc(name)} added ✦`);
        loadVendors().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteVendor = async function (id) {
      const v = _vendorsData.find(r => r.id === id);
      if (!v || !confirm(`Delete vendor ${v.name}? This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/vendors/${id}`);
        _vendorsData = _vendorsData.filter(r => r.id !== id);
        renderVendors();
        notify('Vendor deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // BILLS
    // ════════════════════════════════════════════
    let _billsData = [], _billsFetched = false;

    async function loadBills() {
      try {
        const _eidB2 = (window.ENTITIES||[]).find(e=>e.active)?._dbId;
        const rows = await api('GET', '/api/bills' + (_eidB2 ? '?entity_id=' + _eidB2 : ''));
        _billsFetched = true;
        _billsData = rows || [];
        window.bills = _billsData;
        console.log('[Bills] loaded', _billsData.length);
        renderBills();
      } catch (e) { console.warn('[Bills]', e.message); }
    }
    loadBills();

    window.renderBills = function () {
      if (!_billsFetched) { loadBills(); return; }
      const el = document.getElementById('bills-list');
      if (!el) return;
      const cls = { unpaid: 'b-amber', due_soon: 'b-amber', overdue: 'b-red', paid: 'b-green' };
      el.innerHTML = _billsData.length
        ? _billsData.map(b => `
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 90px 80px 80px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(b.vendor)}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(b.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(b.amount)}</span>
            <span style="color:${b.status?.toLowerCase() === 'overdue' ? 'var(--red)' : 'var(--t2)'}">${esc(b.due_date || '—')}</span>
            <span><span class="badge ${cls[b.status?.toLowerCase()] || 'b-amber'}">${esc(b.status)}</span></span>
            <div style="display:flex;gap:4px">
              ${b.status?.toLowerCase() !== 'paid' ? `<button class="btn btn-ghost btn-sm" onclick="markBillPaid(${b.id})">Pay</button>` : ''}
              <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteBill(${b.id})">✕</button>
            </div>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No bills yet</div>';

      // badge
      const overdue = _billsData.filter(b => b.status?.toLowerCase() === 'overdue' || b.status?.toLowerCase() === 'due_soon').length;
      const badge = document.getElementById('badge-bills');
      if (badge) { badge.textContent = overdue; badge.style.display = overdue > 0 ? '' : 'none'; }
      // KPI cards: count · due-this-week sum · overdue sum · paid sum
      const _blOverdue = _billsData.filter(b => b.status?.toLowerCase() === 'overdue').reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      const _blPaid = _billsData.filter(b => b.status?.toLowerCase() === 'paid').reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      const _blToday = new Date(); _blToday.setHours(0, 0, 0, 0);
      const _weekAhead = new Date(); _weekAhead.setDate(_weekAhead.getDate() + 7);
      const _blDueWeek = _billsData.filter(b => {
        if (b.status?.toLowerCase() === 'paid' || !b.due_date) return false;
        const d = new Date(b.due_date); return !isNaN(d) && d >= _blToday && d <= _weekAhead;
      }).reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
      setKpiCards('page-bills', [_billsData.length, S(_blDueWeek), S(_blOverdue), S(_blPaid)]);
      window._refreshDashboardUI?.();
    };

    window.openNewBillModal = function () {
      ['bill-vendor','bill-amount','bill-notes','bill-end-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const iss = document.getElementById('bill-issue'); if (iss) iss.value = (typeof todayLocal==='function'?todayLocal():todayStr()); // F36: default issue date = today (local)
      const d = document.getElementById('bill-due'); if (d) d.value = '';
      const s = document.getElementById('bill-status'); if (s) s.value = 'unpaid';
      const rc = document.getElementById('bill-recurring'); if (rc) rc.checked = false;
      const ro = document.getElementById('bill-recurring-opts'); if (ro) ro.style.display = 'none';
      const bf = document.getElementById('bill-freq'); if (bf) bf.value = 'Monthly';
      openModal('bill-modal');
    };

    // Next occurrence date for a recurring bill (mirrors server nextRunDate).
    function _billNextRun(dateStr, freq) {
      const d = new Date(dateStr || todayStr());
      if (freq === 'Weekly')         d.setDate(d.getDate() + 7);
      else if (freq === 'Quarterly') d.setMonth(d.getMonth() + 3);
      else if (freq === 'Yearly')    d.setFullYear(d.getFullYear() + 1);
      else                           d.setMonth(d.getMonth() + 1); // Monthly
      return d.toISOString().slice(0, 10);
    }

    window.saveBill = async function () {
      const vendor = document.getElementById('bill-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('bill-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const due_date = document.getElementById('bill-due')?.value    || null;
      const issue_date = document.getElementById('bill-issue')?.value || (typeof todayLocal==='function'?todayLocal():todayStr()); // F36/F38
      const status   = document.getElementById('bill-status')?.value || 'unpaid';
      const notes    = document.getElementById('bill-notes')?.value?.trim() || '';
      const recurring = !!document.getElementById('bill-recurring')?.checked;
      const frequency = document.getElementById('bill-freq')?.value || 'Monthly';
      const endDate   = document.getElementById('bill-end-date')?.value || null;
      try {
        const _eidBNew = (window.ENTITIES||[]).find(e=>e.active)?._dbId || null;
        const saved = await api('POST', '/api/bills', { vendor, amount, due_date, issue_date, status, notes, entity_id: _eidBNew });
        _billsData.unshift(saved.row || saved);
        window.bills = _billsData;
        // Recurring: this bill IS the current occurrence; also create a recurring
        // profile scheduled for the NEXT cycle so the server's hourly scheduler
        // (runRecurringScheduler) generates future bills. next_run is strictly
        // after the due date, so today's bill is never duplicated. Reuses the
        // existing /api/recurring-bills route + table; end_date is optional.
        if (recurring) {
          try {
            await api('POST', '/api/recurring-bills', {
              vendor, amount, frequency,
              next_run: _billNextRun(due_date, frequency),
              status: 'active', end_date: endDate,
            });
            if (typeof loadRecurringBills === 'function') loadRecurringBills().catch(()=>{});
          } catch (re) { notify('Bill saved, but recurring setup failed — ' + re.message, true); }
        }
        closeModal('bill-modal');
        renderBills();
        notify(recurring ? `Recurring bill for ${esc(vendor)} set up ✦` : `Bill from ${esc(vendor)} saved ✦`);
        loadBills().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.markBillPaid = async function (id) {
      try {
        // F38 Step 5: "mark paid" must create a REAL linked payments_made (bill_id set) for the
        // outstanding balance — NOT a bare status flip. A settlement is Dr AP / Cr Cash: the cash
        // outflow has to be a payments_made row or the cash-basis cash-flow route can't see it,
        // and recalcBillStatus (server) then sets amount_paid = amount + status = 'paid' from the
        // payments, so AP drops to 0 arithmetically (matches the Step 4 AP amendment). The issued
        // bill was already recognized as expense at issue; this linked payment is excluded from
        // expense by the bill_id-IS-NULL guard, so no double count.
        const b = _billsData.find(r => r.id === id);
        const amt  = parseFloat(b && b.amount) || 0;
        const paid = parseFloat(b && b.amount_paid) || 0;
        const outstanding = Math.round((amt - paid) * 100) / 100;
        const _d = new Date();
        const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
        if (outstanding > 0) {
          // recalcBillStatus (server) sets amount_paid + status='paid' from the linked payments.
          await api('POST', '/api/payments-made', {
            bill_id: id, amount: outstanding, date: today,
            vendor: (b && b.vendor) || '', method: 'other', notes: 'Bill marked paid',
          });
        } else {
          // Already fully covered (or zero-amount) — just ensure the status reflects it.
          await api('PUT', `/api/bills/${id}`, { status: 'paid' });
        }
        renderBills();
        notify('Bill marked as paid ✦');
        loadBills().catch(() => {});
        if (typeof window._loadPaymentsMadeFromDB === 'function') window._loadPaymentsMadeFromDB().catch(() => {});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not update — ' + e.message, true); }
    };

    window.deleteBill = async function (id) {
      if (!confirm('Delete this bill? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/bills/${id}`);
        _billsData = _billsData.filter(r => r.id !== id);
        renderBills();
        notify('Bill deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // PAYMENTS MADE
    // ════════════════════════════════════════════
    let _paymentsMadeData = [], _paymentsMadeFetched = false;

    async function loadPaymentsMade() {
      try {
        const rows = await api('GET', '/api/payments-made');
        _paymentsMadeFetched = true;
        _paymentsMadeData = rows || [];
        window.paymentsMade = _paymentsMadeData;
        console.log('[Payments Made] loaded', _paymentsMadeData.length);
        renderPaymentsMade();
      } catch (e) { console.warn('[Payments Made]', e.message); }
    }
    loadPaymentsMade();

    window.renderPaymentsMade = function () {
      if (!_paymentsMadeFetched) { loadPaymentsMade(); return; }
      const el = document.getElementById('payments-made-list');
      if (!el) return;
      el.innerHTML = _paymentsMadeData.length
        ? _paymentsMadeData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 90px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.vendor || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.ref || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span style="color:var(--t2)">${esc(r.method || '')}</span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deletePaymentMade(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No payments made yet</div>';
      // KPI cards: total paid · unique vendor count · largest single · avg
      const _pmTotal = _paymentsMadeData.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _pmVendors = new Set(_paymentsMadeData.map(r => r.vendor)).size;
      const _pmAmts = _paymentsMadeData.map(r => parseFloat(r.amount) || 0);
      const _pmLargest = _pmAmts.length ? Math.max(..._pmAmts) : 0;
      const _pmAvg = _pmAmts.length ? _pmTotal / _pmAmts.length : 0;
      setKpiCards('page-payments-made', [S(_pmTotal), _pmVendors, S(_pmLargest), S(_pmAvg)]);
      window._refreshDashboardUI?.();
    };

    window.openMakePaymentModal = function () {
      ['pm-vendor','pm-amount','pm-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('pm-date'); if (d) d.value = todayStr();
      const m = document.getElementById('pm-method'); if (m) m.value = 'Bank Transfer';
      openModal('modal-payment-made');
    };

    window.savePaymentMade = async function () {
      const vendor = document.getElementById('pm-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('pm-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('pm-date')?.value   || todayStr();
      const method = document.getElementById('pm-method')?.value || 'Bank Transfer';
      const notes  = document.getElementById('pm-notes')?.value?.trim() || '';
      const ref    = 'PM-' + uid4();
      try {
        const saved = await api('POST', '/api/payments-made', { vendor, ref, amount, date, method, notes });
        _paymentsMadeData.unshift(saved.row || saved);
        window.paymentsMade = _paymentsMadeData;
        closeModal('modal-payment-made');
        renderPaymentsMade();
        notify(`Payment to ${esc(vendor)} recorded ✦`);
        loadPaymentsMade().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deletePaymentMade = async function (id) {
      if (!confirm('Delete this payment record? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/payments-made/${id}`);
        _paymentsMadeData = _paymentsMadeData.filter(r => r.id !== id);
        renderPaymentsMade();
        notify('Payment deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // RECURRING BILLS
    // ════════════════════════════════════════════
    let _recurringBillsData = [], _recurringBillsFetched = false;

    async function loadRecurringBills() {
      try {
        const rows = await api('GET', '/api/recurring-bills');
        _recurringBillsFetched = true;
        _recurringBillsData = rows || [];
        window.recurringBills = _recurringBillsData;
        console.log('[Recurring Bills] loaded', _recurringBillsData.length);
        renderRecurringBills();
      } catch (e) { console.warn('[Recurring Bills]', e.message); }
    }
    loadRecurringBills();

    window.renderRecurringBills = function () {
      if (!_recurringBillsFetched) { loadRecurringBills(); return; }
      const el = document.getElementById('recurring-bills-list');
      if (!el) return;
      const cls = { active: 'b-green', paused: 'b-amber' };
      el.innerHTML = _recurringBillsData.length
        ? _recurringBillsData.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
            <div>
              <div style="font-weight:500;font-size:13px">${esc(r.vendor)}</div>
              <div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(r.frequency)} · Next: ${esc(r.next_run || '—')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:var(--font-mono);font-weight:600">${S(r.amount)}</span>
              <span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status)}</span>
              <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteRecurringBill(${r.id})">✕</button>
            </div>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No recurring bill profiles yet</div>';
      // KPI cards: active count · monthly cost · next due · YTD total
      // YTD is approximated as monthly × elapsed months (Jan = 1 … current
      // month). No global "_realBills" array exists, so we can't filter
      // server-tagged bills the way recurring-invoices does.
      const _rbActive = _recurringBillsData.filter(r => r.status?.toLowerCase() === 'active');
      const _rbMonthly = _rbActive.reduce((s, r) => s + monthlyEquiv(r.amount, r.frequency), 0);
      const _rbNext = _rbActive.map(r => r.next_run).filter(Boolean).sort()[0] || '—';
      const _rbYtd = _rbMonthly * (new Date().getMonth() + 1);
      setKpiCards('page-recurring-bills', [_rbActive.length, S(_rbMonthly), _rbNext, S(_rbYtd)]);
      window._refreshDashboardUI?.();
    };

    window.openNewRecurringBillModal = function () {
      ['rb-vendor','rb-amount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const f = document.getElementById('rb-freq'); if (f) f.value = 'Monthly';
      const n = document.getElementById('rb-next'); if (n) n.value = todayStr();
      const s = document.getElementById('rb-status'); if (s) s.value = 'active';
      openModal('recurring-bill-modal');
    };

    window.saveRecurringBill = async function () {
      const vendor = document.getElementById('rb-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('rb-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const frequency = document.getElementById('rb-freq')?.value   || 'Monthly';
      const next_run  = document.getElementById('rb-next')?.value   || todayStr();
      const status    = document.getElementById('rb-status')?.value || 'active';
      try {
        const saved = await api('POST', '/api/recurring-bills', { vendor, amount, frequency, next_run, status });
        _recurringBillsData.unshift(saved.row || saved);
        window.recurringBills = _recurringBillsData;
        closeModal('recurring-bill-modal');
        renderRecurringBills();
        notify(`Recurring bill for ${esc(vendor)} saved ✦`);
        loadRecurringBills().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteRecurringBill = async function (id) {
      if (!confirm('Delete this recurring profile? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/recurring-bills/${id}`);
        _recurringBillsData = _recurringBillsData.filter(r => r.id !== id);
        renderRecurringBills();
        notify('Profile deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // VENDOR CREDITS
    // ════════════════════════════════════════════
    let _vendorCreditsData = [], _vendorCreditsFetched = false;

    async function loadVendorCredits() {
      try {
        const rows = await api('GET', '/api/vendor-credits');
        _vendorCreditsFetched = true;
        _vendorCreditsData = rows || [];
        window.vendorCredits = _vendorCreditsData;
        console.log('[Vendor Credits] loaded', _vendorCreditsData.length);
        renderVendorCredits();
      } catch (e) { console.warn('[Vendor Credits]', e.message); }
    }
    loadVendorCredits();

    window.renderVendorCredits = function () {
      if (!_vendorCreditsFetched) { loadVendorCredits(); return; }
      const el = document.getElementById('vendor-credits-list');
      if (!el) return;
      const cls = { Open: 'b-green', Applied: 'b-amber' };
      el.innerHTML = _vendorCreditsData.length
        ? _vendorCreditsData.map(r => `
          <div class="table-row" style="grid-template-columns:1fr 90px 80px 80px 70px 50px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)">
            <span style="font-weight:500">${esc(r.vendor || '')}</span>
            <span style="font-size:11px;color:var(--t3);font-family:var(--font-mono)">${esc(r.num || '')}</span>
            <span style="font-family:var(--font-mono)">${S(r.amount)}</span>
            <span style="color:var(--t2)">${esc(r.date || '')}</span>
            <span><span class="badge ${cls[r.status] || 'b-amber'}">${esc(r.status || 'Open')}</span></span>
            <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteVendorCredit(${r.id})">✕</button>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No vendor credits yet</div>';
      // KPI cards: count · open sum · applied sum · this-month sum
      const _vcOpen = _vendorCreditsData.filter(r => r.status === 'Open').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _vcApplied = _vendorCreditsData.filter(r => r.status === 'Applied').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const _vcMonthSum = _vendorCreditsData.filter(r => inThisMonth(r.date)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      setKpiCards('page-vendor-credits', [_vendorCreditsData.length, S(_vcOpen), S(_vcApplied), S(_vcMonthSum)]);
      window._refreshDashboardUI?.();
    };

    window.openNewVendorCreditModal = function () {
      ['vc-vendor','vc-amount','vc-reason'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('vc-date'); if (d) d.value = todayStr();
      const s = document.getElementById('vc-status'); if (s) s.value = 'Open';
      openModal('modal-vendor-credit');
    };

    window.saveVendorCredit = async function () {
      const vendor = document.getElementById('vc-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('vc-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const date   = document.getElementById('vc-date')?.value?.trim()   || todayStr();
      const status = document.getElementById('vc-status')?.value          || 'Open';
      const reason = document.getElementById('vc-reason')?.value?.trim()  || '';
      const num    = 'VC-' + uid4();
      try {
        const saved = await api('POST', '/api/vendor-credits', { vendor, num, amount, date, status, reason });
        _vendorCreditsData.unshift(saved.row || saved);
        window.vendorCredits = _vendorCreditsData;
        closeModal('modal-vendor-credit');
        renderVendorCredits();
        notify(`Vendor credit from ${esc(vendor)} saved ✦`);
        loadVendorCredits().catch(()=>{});
        window._refreshDashboardUI?.();
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteVendorCredit = async function (id) {
      if (!confirm('Delete this vendor credit? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/vendor-credits/${id}`);
        _vendorCreditsData = _vendorCreditsData.filter(r => r.id !== id);
        renderVendorCredits();
        notify('Vendor credit deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('expenses');
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };

    // ── Expose load functions so entity-switch + showPage can reload ──
    window._loadVendorsFromDB        = loadVendors;       // overrides stubs.js — pages.js wins
    window._loadBillsFromDB          = loadBills;         // overrides stubs.js — pages.js wins
    window._loadReceiptsFromDB       = loadReceipts;
    window._loadPaymentsRecvFromDB   = loadPaymentsReceived;
    window._loadCreditNotesFromDB    = loadCreditNotes;
    window._loadPaymentsMadeFromDB   = loadPaymentsMade;
    window._loadVendorCreditsFromDB  = loadVendorCredits;
    window._loadRecurringBillsFromDB = loadRecurringBills;
    window._loadRecurringInvFromDB   = loadRecurringInvoices;
    window._loadQuotesFromDB         = loadQuotes;

    // ── showPage hooks for pages not already covered by stubs.js ─────
    const _pagesOrig = window.showPage;
    if (typeof _pagesOrig === 'function') {
      window.showPage = function (id, navEl) {
        _pagesOrig(id, navEl);
        if (id === 'sales-receipts')     loadReceipts();
        if (id === 'payments-received')  loadPaymentsReceived();
        if (id === 'credit-notes')       loadCreditNotes();
        if (id === 'payments-made')      loadPaymentsMade();
        if (id === 'vendor-credits')     loadVendorCredits();
        if (id === 'vendors')            loadVendors();
        if (id === 'bills')              loadBills();
        if (id === 'quotes')             loadQuotes();
        if (id === 'recurring-invoices') loadRecurringInvoices();
        if (id === 'recurring-bills')    loadRecurringBills();
      };
    }

    console.log('[FinFlow API Wiring — Pages] ✅ Quotes, Receipts, Payments Received, Recurring Invoices, Credit Notes, Vendors, Bills, Payments Made, Recurring Bills, Vendor Credits wired');
  })()
})();
