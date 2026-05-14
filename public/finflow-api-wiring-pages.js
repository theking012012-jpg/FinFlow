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

  window.addEventListener('DOMContentLoaded', function () {

    // ════════════════════════════════════════════
    // QUOTES
    // ════════════════════════════════════════════
    let _quotesData = [], _quotesFetched = false;

    async function loadQuotes() {
      try {
        const rows = await api('GET', '/api/quotes');
        _quotesFetched = true;
        _quotesData = rows || [];
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
      const accepted = _quotesData.filter(q => q.status === 'accepted').length;
      const pending  = _quotesData.filter(q => q.status === 'pending').length;
      const openVal  = _quotesData.filter(q => q.status === 'pending').reduce((s, q) => s + (q.amount || 0), 0);
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
        closeModal('quote-modal');
        renderQuotes();
        notify(`Quote for ${esc(client)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        closeModal('modal-receipt');
        renderReceipts();
        notify(`Receipt for ${esc(customer)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteReceipt = async function (id) {
      if (!confirm('Delete this receipt? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/sales-receipts/${id}`);
        _receiptsData = _receiptsData.filter(r => r.id !== id);
        renderReceipts();
        notify('Receipt deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
    };

    window.openRecordPaymentModal = function () {
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
        closeModal('modal-payment-received');
        renderPaymentsReceived();
        notify(`Payment from ${esc(customer)} recorded ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deletePaymentReceived = async function (id) {
      if (!confirm('Delete this payment record? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/payments-received/${id}`);
        _paymentsRecvData = _paymentsRecvData.filter(r => r.id !== id);
        renderPaymentsReceived();
        notify('Payment record deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
    };

    window.openNewRecurringModal = function () {
      ['ri-client','ri-amount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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
      try {
        const saved = await api('POST', '/api/recurring-invoices', { client, amount, frequency, next_run, status });
        _recurringInvData.unshift(saved.row || saved);
        closeModal('recurring-inv-modal');
        renderRecurringInvoices();
        notify(`Recurring profile for ${esc(client)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteRecurringInvoice = async function (id) {
      if (!confirm('Delete this recurring profile? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/recurring-invoices/${id}`);
        _recurringInvData = _recurringInvData.filter(r => r.id !== id);
        renderRecurringInvoices();
        notify('Profile deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        closeModal('modal-credit-note');
        renderCreditNotes();
        notify(`Credit note for ${esc(customer)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteCreditNote = async function (id) {
      if (!confirm('Delete this credit note? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/credit-notes/${id}`);
        _creditNotesData = _creditNotesData.filter(r => r.id !== id);
        renderCreditNotes();
        notify('Credit note deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // VENDORS
    // ════════════════════════════════════════════
    let _vendorsData = [], _vendorsFetched = false;

    async function loadVendors() {
      try {
        const rows = await api('GET', '/api/vendors');
        _vendorsFetched = true;
        _vendorsData = rows || [];
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
        const saved = await api('POST', '/api/vendors', { name, contact, category, owing, ytd_paid, status: 'active' });
        _vendorsData.unshift(saved.row || saved);
        closeModal('vendor-modal');
        renderVendors();
        notify(`${esc(name)} added ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };


    // ════════════════════════════════════════════
    // BILLS
    // ════════════════════════════════════════════
    let _billsData = [], _billsFetched = false;

    async function loadBills() {
      try {
        const rows = await api('GET', '/api/bills');
        _billsFetched = true;
        _billsData = rows || [];
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
            <span style="color:${b.status === 'overdue' ? 'var(--red)' : 'var(--t2)'}">${esc(b.due_date || '—')}</span>
            <span><span class="badge ${cls[b.status] || 'b-amber'}">${esc(b.status)}</span></span>
            <div style="display:flex;gap:4px">
              ${b.status !== 'paid' ? `<button class="btn btn-ghost btn-sm" onclick="markBillPaid(${b.id})">Pay</button>` : ''}
              <button class="btn btn-ghost btn-sm" style="color:var(--red);opacity:.7" onclick="deleteBill(${b.id})">✕</button>
            </div>
          </div>`).join('')
        : '<div style="padding:2rem;text-align:center;color:var(--t3)">No bills yet</div>';

      // badge
      const overdue = _billsData.filter(b => b.status === 'overdue' || b.status === 'due_soon').length;
      const badge = document.getElementById('badge-bills');
      if (badge) { badge.textContent = overdue; badge.style.display = overdue > 0 ? '' : 'none'; }
    };

    window.openNewBillModal = function () {
      ['bill-vendor','bill-amount','bill-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('bill-due'); if (d) d.value = '';
      const s = document.getElementById('bill-status'); if (s) s.value = 'unpaid';
      openModal('bill-modal');
    };

    window.saveBill = async function () {
      const vendor = document.getElementById('bill-vendor')?.value?.trim();
      const amount = parseFloat(document.getElementById('bill-amount')?.value);
      if (!vendor) { notify('Vendor name required', true); return; }
      if (!amount || amount <= 0) { notify('Valid amount required', true); return; }
      const due_date = document.getElementById('bill-due')?.value    || null;
      const status   = document.getElementById('bill-status')?.value || 'unpaid';
      const notes    = document.getElementById('bill-notes')?.value?.trim() || '';
      try {
        const saved = await api('POST', '/api/bills', { vendor, amount, due_date, status, notes });
        _billsData.unshift(saved.row || saved);
        closeModal('bill-modal');
        renderBills();
        notify(`Bill from ${esc(vendor)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.markBillPaid = async function (id) {
      try {
        await api('PUT', `/api/bills/${id}`, { status: 'paid' });
        const b = _billsData.find(r => r.id === id);
        if (b) b.status = 'paid';
        renderBills();
        notify('Bill marked as paid ✦');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not update — ' + e.message, true); }
    };

    window.deleteBill = async function (id) {
      if (!confirm('Delete this bill? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/bills/${id}`);
        _billsData = _billsData.filter(r => r.id !== id);
        renderBills();
        notify('Bill deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        closeModal('modal-payment-made');
        renderPaymentsMade();
        notify(`Payment to ${esc(vendor)} recorded ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deletePaymentMade = async function (id) {
      if (!confirm('Delete this payment record? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/payments-made/${id}`);
        _paymentsMadeData = _paymentsMadeData.filter(r => r.id !== id);
        renderPaymentsMade();
        notify('Payment deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        closeModal('recurring-bill-modal');
        renderRecurringBills();
        notify(`Recurring bill for ${esc(vendor)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteRecurringBill = async function (id) {
      if (!confirm('Delete this recurring profile? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/recurring-bills/${id}`);
        _recurringBillsData = _recurringBillsData.filter(r => r.id !== id);
        renderRecurringBills();
        notify('Profile deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
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
        closeModal('modal-vendor-credit');
        renderVendorCredits();
        notify(`Vendor credit from ${esc(vendor)} saved ✦`);
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not save — ' + e.message, true); }
    };

    window.deleteVendorCredit = async function (id) {
      if (!confirm('Delete this vendor credit? This cannot be undone.')) return;
      try {
        await api('DELETE', `/api/vendor-credits/${id}`);
        _vendorCreditsData = _vendorCreditsData.filter(r => r.id !== id);
        renderVendorCredits();
        notify('Vendor credit deleted');
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials();
      } catch (e) { notify('Could not delete — ' + e.message, true); }
    };

    console.log('[FinFlow API Wiring — Pages] ✅ Quotes, Receipts, Payments Received, Recurring Invoices, Credit Notes, Vendors, Bills, Payments Made, Recurring Bills, Vendor Credits wired');
  });
})();
