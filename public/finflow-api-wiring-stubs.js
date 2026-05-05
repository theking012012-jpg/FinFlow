// ════════════════════════════════════════════════════════════════════
// FINFLOW — STUBS WIRING
// Replaces all static/hardcoded data with real API calls for:
//   ✅ Quotes       (GET/POST/PUT/DELETE /api/quotes)
//   ✅ Bills        (GET/POST/PUT/DELETE /api/bills)
//   ✅ Vendors      (GET/POST/PUT/DELETE /api/vendors)
//   ✅ Recurring Bills     (GET/POST/PUT/DELETE /api/recurring-bills)
//   ✅ Recurring Invoices  (GET/POST/PUT/DELETE /api/recurring-invoices)
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  // SHARED API HELPER
  // ─────────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `API error ${res.status}`);
    }
    return res.json();
  }

  // ─────────────────────────────────────────────────────────────────
  // MODAL HELPERS
  // ─────────────────────────────────────────────────────────────────
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.style.display = '';
  }
  function closeModalById(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.style.display = 'none';
  }
  function fieldVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }
  function setField(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  }
  function showNotify(msg, isErr) {
    if (typeof window.notify === 'function') window.notify(msg, isErr);
    else alert(msg);
  }

  // ─────────────────────────────────────────────────────────────────
  // STATUS BADGE HELPER
  // ─────────────────────────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      accepted: 'b-green', active: 'b-green',
      pending: 'b-amber',  due_soon: 'b-amber', paused: 'b-amber',
      declined: 'b-red',   overdue: 'b-red',
      paid: 'b-green',     unpaid: 'b-amber',
    };
    const cls = map[status?.toLowerCase()] || 'b-amber';
    const label = status ? status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';
    return `<span class="badge ${cls}">${label}</span>`;
  }

  // ─────────────────────────────────────────────────────────────────
  // ══ QUOTES ══
  // ─────────────────────────────────────────────────────────────────
  let _quotes = [];
  let _quoteEditId = null;

  async function loadQuotes() {
    try {
      _quotes = await api('GET', '/api/quotes');
      renderQuotesList();
      updateQuoteMetrics();
    } catch (e) { console.warn('[Quotes] load error', e); }
  }

  function updateQuoteMetrics() {
    const total   = _quotes.length;
    const pending = _quotes.filter(q => q.status === 'pending').length;
    const value   = _quotes.reduce((s, q) => s + Number(q.amount || 0), 0);
    const accepted = _quotes.filter(q => q.status === 'accepted').length;
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('qt-total',    total);
    setMC('qt-pending',  pending);
    setMC('qt-value',    '$' + value.toLocaleString());
    setMC('qt-accepted', accepted);
  }

  function renderQuotesList() {
    const list = document.getElementById('quotes-list');
    if (!list) return;
    if (!_quotes.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No quotes yet — create your first one</div>';
      return;
    }
    list.innerHTML = _quotes.map(q => `
      <div class="table-row" style="grid-template-columns:1fr 100px 90px 90px 80px 100px">
        <span style="font-weight:500">${q.client}</span>
        <span style="color:var(--t3)">${q.num}</span>
        <span style="font-family:var(--font-mono)">$${Number(q.amount).toLocaleString()}</span>
        <span style="color:var(--t2)">${q.expiry_date || '—'}</span>
        <span>${statusBadge(q.status)}</span>
        <div class="table-actions" style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="editQuote(${q.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteQuote(${q.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderQuotes = renderQuotesList;

  window.openNewQuoteModal = function () {
    _quoteEditId = null;
    setField('quote-client', ''); setField('quote-amount', '');
    setField('quote-expiry', ''); setField('quote-status', 'pending');
    setField('quote-notes', '');
    const title = document.querySelector('#quote-modal .modal-title');
    if (title) title.textContent = 'New Quote';
    const btn = document.querySelector('#quote-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save quote →';
    openModal('quote-modal');
  };

  window.editQuote = function (id) {
    const q = _quotes.find(x => x.id === id);
    if (!q) return;
    _quoteEditId = id;
    setField('quote-client', q.client);
    setField('quote-amount', q.amount);
    setField('quote-expiry', q.expiry_date);
    setField('quote-status', q.status);
    setField('quote-notes',  q.notes);
    const title = document.querySelector('#quote-modal .modal-title');
    if (title) title.textContent = 'Edit Quote';
    const btn = document.querySelector('#quote-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('quote-modal');
  };

  window.saveQuote = async function () {
    const client      = fieldVal('quote-client').trim();
    const amount      = parseFloat(fieldVal('quote-amount')) || 0;
    const expiry_date = fieldVal('quote-expiry');
    const status      = fieldVal('quote-status') || 'pending';
    const notes       = fieldVal('quote-notes');
    if (!client || !amount) { showNotify('Client and amount required.', true); return; }
    try {
      if (_quoteEditId) {
        await api('PUT', `/api/quotes/${_quoteEditId}`, { client, amount, expiry_date, status, notes });
        const idx = _quotes.findIndex(x => x.id === _quoteEditId);
        if (idx > -1) _quotes[idx] = { ..._quotes[idx], client, amount, expiry_date, status, notes };
        showNotify('Quote updated ✦');
      } else {
        const row = await api('POST', '/api/quotes', { client, amount, expiry_date, status, notes });
        _quotes.unshift(row);
        showNotify('Quote created ✦');
      }
      closeModalById('quote-modal');
      renderQuotesList();
      updateQuoteMetrics();
    } catch (e) { showNotify('Could not save quote — ' + e.message, true); }
  };

  window.deleteQuote = async function (id) {
    if (!confirm('Delete this quote?')) return;
    try {
      await api('DELETE', `/api/quotes/${id}`);
      _quotes = _quotes.filter(x => x.id !== id);
      renderQuotesList(); updateQuoteMetrics();
      showNotify('Quote deleted');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ VENDORS ══
  // ─────────────────────────────────────────────────────────────────
  let _vendors = [];
  let _vendorEditId = null;
  let _vendorSearch = '';

  async function loadVendors() {
    try {
      _vendors = await api('GET', '/api/vendors');
      renderVendorsList();
      updateVendorMetrics();
    } catch (e) { console.warn('[Vendors] load error', e); }
  }

  function updateVendorMetrics() {
    const total   = _vendors.length;
    const payables = _vendors.reduce((s, v) => s + Number(v.owing || 0), 0);
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('vendor-total', total);
    setMC('vendor-payables', '$' + payables.toLocaleString());
  }

  function renderVendorsList() {
    const list = document.getElementById('vendors-list');
    if (!list) return;
    const filtered = _vendorSearch
      ? _vendors.filter(v => v.name.toLowerCase().includes(_vendorSearch) || (v.contact || '').toLowerCase().includes(_vendorSearch) || (v.category || '').toLowerCase().includes(_vendorSearch))
      : _vendors;
    if (!filtered.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No vendors found</div>';
      return;
    }
    list.innerHTML = filtered.map(v => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="emp-init av-blue" style="font-size:10px;font-weight:700">${v.name.slice(0,2).toUpperCase()}</div>
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--t1)">${v.name}</div>
            <div style="font-size:11px;color:var(--t3)">${v.contact || '—'} · ${v.category || '—'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:right"><div style="font-size:12px;color:var(--t3)">Owing</div><div style="font-weight:600;font-family:var(--font-mono);color:${Number(v.owing)>0?'var(--red)':'var(--green)'}">$${Number(v.owing||0).toLocaleString()}</div></div>
          <div style="text-align:right"><div style="font-size:12px;color:var(--t3)">YTD paid</div><div style="font-weight:600;font-family:var(--font-mono);color:var(--t1)">$${Number(v.ytd_paid||0).toLocaleString()}</div></div>
          <button class="btn btn-ghost btn-sm" onclick="editVendor(${v.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteVendor(${v.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderVendors = renderVendorsList;

  window.filterVendorsBySearch = function (val) {
    _vendorSearch = val.toLowerCase();
    renderVendorsList();
  };

  window.openNewVendorModal = function () {
    _vendorEditId = null;
    setField('vendor-name', ''); setField('vendor-contact', '');
    setField('vendor-category', ''); setField('vendor-owing', '0');
    setField('vendor-ytd', '0');
    const title = document.querySelector('#vendor-modal .modal-title');
    if (title) title.textContent = 'New Vendor';
    const btn = document.querySelector('#vendor-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save vendor →';
    openModal('vendor-modal');
  };

  window.editVendor = function (id) {
    const v = _vendors.find(x => x.id === id);
    if (!v) return;
    _vendorEditId = id;
    setField('vendor-name',     v.name);
    setField('vendor-contact',  v.contact);
    setField('vendor-category', v.category);
    setField('vendor-owing',    v.owing);
    setField('vendor-ytd',      v.ytd_paid);
    const title = document.querySelector('#vendor-modal .modal-title');
    if (title) title.textContent = 'Edit Vendor';
    const btn = document.querySelector('#vendor-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('vendor-modal');
  };

  window.saveVendor = async function () {
    const name     = fieldVal('vendor-name').trim();
    const contact  = fieldVal('vendor-contact').trim();
    const category = fieldVal('vendor-category').trim();
    const owing    = parseFloat(fieldVal('vendor-owing')) || 0;
    const ytd_paid = parseFloat(fieldVal('vendor-ytd'))  || 0;
    if (!name) { showNotify('Vendor name required.', true); return; }
    try {
      if (_vendorEditId) {
        await api('PUT', `/api/vendors/${_vendorEditId}`, { name, contact, category, owing, ytd_paid });
        const idx = _vendors.findIndex(x => x.id === _vendorEditId);
        if (idx > -1) _vendors[idx] = { ..._vendors[idx], name, contact, category, owing, ytd_paid };
        showNotify('Vendor updated ✦');
      } else {
        const row = await api('POST', '/api/vendors', { name, contact, category, owing, ytd_paid });
        _vendors.push(row);
        _vendors.sort((a,b) => a.name.localeCompare(b.name));
        showNotify('Vendor added ✦');
      }
      closeModalById('vendor-modal');
      renderVendorsList(); updateVendorMetrics();
    } catch (e) { showNotify('Could not save vendor — ' + e.message, true); }
  };

  window.deleteVendor = async function (id) {
    if (!confirm('Remove this vendor?')) return;
    try {
      await api('DELETE', `/api/vendors/${id}`);
      _vendors = _vendors.filter(x => x.id !== id);
      renderVendorsList(); updateVendorMetrics();
      showNotify('Vendor removed');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ BILLS ══
  // ─────────────────────────────────────────────────────────────────
  let _bills = [];
  let _billEditId = null;

  async function loadBills() {
    try {
      _bills = await api('GET', '/api/bills');
      renderBillsList();
      updateBillMetrics();
    } catch (e) { console.warn('[Bills] load error', e); }
  }

  function updateBillMetrics() {
    const unpaid  = _bills.filter(b => b.status !== 'paid').reduce((s,b) => s + Number(b.amount||0), 0);
    const overdue = _bills.filter(b => b.status === 'overdue').length;
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('bills-total',   '$' + unpaid.toLocaleString());
    setMC('bills-overdue', overdue);
  }

  function renderBillsList() {
    const list = document.getElementById('bills-list');
    if (!list) return;
    if (!_bills.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No bills yet</div>';
      return;
    }
    list.innerHTML = _bills.map(b => `
      <div class="table-row" style="grid-template-columns:1fr 100px 80px 80px 80px 110px">
        <span style="font-weight:500">${b.vendor}</span>
        <span style="color:var(--t3)">${b.num}</span>
        <span style="font-family:var(--font-mono)">$${Number(b.amount||0).toLocaleString()}</span>
        <span style="color:${b.status==='overdue'?'var(--red)':'var(--t2)'}">${b.due_date || '—'}</span>
        <span>${statusBadge(b.status)}</span>
        <div class="table-actions" style="display:flex;gap:4px">
          ${b.status !== 'paid' ? `<button class="btn btn-ghost btn-sm" onclick="markBillPaid(${b.id})">Pay</button>` : '<span style="font-size:11px;color:var(--t3)">✓ Paid</span>'}
          <button class="btn btn-ghost btn-sm" onclick="editBill(${b.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteBill(${b.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderBills = renderBillsList;

  window.markBillPaid = async function (id) {
    try {
      await api('PUT', `/api/bills/${id}`, { status: 'paid' });
      const b = _bills.find(x => x.id === id);
      if (b) {
        // Update vendor owing too
        const vendor = _vendors.find(v => v.name === b.vendor);
        if (vendor) {
          const newOwing = Math.max(0, Number(vendor.owing || 0) - Number(b.amount || 0));
          const newYtd   = Number(vendor.ytd_paid || 0) + Number(b.amount || 0);
          await api('PUT', `/api/vendors/${vendor.id}`, { ...vendor, owing: newOwing, ytd_paid: newYtd });
          vendor.owing    = newOwing;
          vendor.ytd_paid = newYtd;
        }
        b.status = 'paid';
      }
      renderBillsList(); updateBillMetrics();
      renderVendorsList(); updateVendorMetrics();
      showNotify('Bill marked as paid ✦');
    } catch (e) { showNotify('Could not update — ' + e.message, true); }
  };

  window.openNewBillModal = function () {
    _billEditId = null;
    setField('bill-vendor', ''); setField('bill-amount', '');
    setField('bill-due', ''); setField('bill-status', 'unpaid');
    setField('bill-notes', '');
    const title = document.querySelector('#bill-modal .modal-title');
    if (title) title.textContent = 'New Bill';
    const btn = document.querySelector('#bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save bill →';
    openModal('bill-modal');
  };

  window.editBill = function (id) {
    const b = _bills.find(x => x.id === id);
    if (!b) return;
    _billEditId = id;
    setField('bill-vendor', b.vendor);
    setField('bill-amount', b.amount);
    setField('bill-due',    b.due_date);
    setField('bill-status', b.status);
    setField('bill-notes',  b.notes);
    const title = document.querySelector('#bill-modal .modal-title');
    if (title) title.textContent = 'Edit Bill';
    const btn = document.querySelector('#bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('bill-modal');
  };

  window.saveBill = async function () {
    const vendor   = fieldVal('bill-vendor').trim();
    const amount   = parseFloat(fieldVal('bill-amount')) || 0;
    const due_date = fieldVal('bill-due');
    const status   = fieldVal('bill-status') || 'unpaid';
    const notes    = fieldVal('bill-notes');
    if (!vendor || !amount) { showNotify('Vendor and amount required.', true); return; }
    try {
      if (_billEditId) {
        await api('PUT', `/api/bills/${_billEditId}`, { vendor, amount, due_date, status, notes });
        const idx = _bills.findIndex(x => x.id === _billEditId);
        if (idx > -1) _bills[idx] = { ..._bills[idx], vendor, amount, due_date, status, notes };
        showNotify('Bill updated ✦');
      } else {
        const row = await api('POST', '/api/bills', { vendor, amount, due_date, status, notes });
        _bills.unshift(row);
        showNotify('Bill created ✦');
      }
      closeModalById('bill-modal');
      renderBillsList(); updateBillMetrics();
    } catch (e) { showNotify('Could not save bill — ' + e.message, true); }
  };

  window.deleteBill = async function (id) {
    if (!confirm('Delete this bill?')) return;
    try {
      await api('DELETE', `/api/bills/${id}`);
      _bills = _bills.filter(x => x.id !== id);
      renderBillsList(); updateBillMetrics();
      showNotify('Bill deleted');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ RECURRING BILLS ══
  // ─────────────────────────────────────────────────────────────────
  let _recurringBills = [];
  let _rbEditId = null;

  async function loadRecurringBills() {
    try {
      _recurringBills = await api('GET', '/api/recurring-bills');
      renderRecurringBillsList();
      updateRecurringBillMetrics();
    } catch (e) { console.warn('[RecurringBills] load error', e); }
  }

  function updateRecurringBillMetrics() {
    const monthly = _recurringBills.filter(r => r.status === 'active').reduce((s,r) => s + Number(r.amount||0), 0);
    const active  = _recurringBills.filter(r => r.status === 'active').length;
    const setMC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setMC('rb-active',  active);
    setMC('rb-monthly', '$' + monthly.toLocaleString());
  }

  function renderRecurringBillsList() {
    const list = document.getElementById('recurring-bills-list');
    if (!list) return;
    if (!_recurringBills.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No recurring bills set up</div>';
      return;
    }
    list.innerHTML = _recurringBills.map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--t1)">${r.vendor}</div>
          <div style="font-size:11px;color:var(--t3)">${r.frequency} · Next: ${r.next_run || '—'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-family:var(--font-mono);font-weight:600;color:var(--red)">-$${Number(r.amount||0).toLocaleString()}</span>
          ${statusBadge(r.status)}
          <button class="btn btn-ghost btn-sm" onclick="editRecurringBill(${r.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteRecurringBill(${r.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderRecurringBills = renderRecurringBillsList;

  window.openNewRecurringBillModal = function () {
    _rbEditId = null;
    setField('rb-vendor', ''); setField('rb-amount', '');
    setField('rb-freq', 'Monthly'); setField('rb-next', '');
    setField('rb-status', 'active');
    const title = document.querySelector('#recurring-bill-modal .modal-title');
    if (title) title.textContent = 'New Recurring Bill';
    const btn = document.querySelector('#recurring-bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save profile →';
    openModal('recurring-bill-modal');
  };

  window.editRecurringBill = function (id) {
    const r = _recurringBills.find(x => x.id === id);
    if (!r) return;
    _rbEditId = id;
    setField('rb-vendor', r.vendor);
    setField('rb-amount', r.amount);
    setField('rb-freq',   r.frequency);
    setField('rb-next',   r.next_run);
    setField('rb-status', r.status);
    const title = document.querySelector('#recurring-bill-modal .modal-title');
    if (title) title.textContent = 'Edit Recurring Bill';
    const btn = document.querySelector('#recurring-bill-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('recurring-bill-modal');
  };

  window.saveRecurringBill = async function () {
    const vendor    = fieldVal('rb-vendor').trim();
    const amount    = parseFloat(fieldVal('rb-amount')) || 0;
    const frequency = fieldVal('rb-freq') || 'Monthly';
    const next_run  = fieldVal('rb-next');
    const status    = fieldVal('rb-status') || 'active';
    if (!vendor || !amount) { showNotify('Vendor and amount required.', true); return; }
    try {
      if (_rbEditId) {
        await api('PUT', `/api/recurring-bills/${_rbEditId}`, { vendor, amount, frequency, next_run, status });
        const idx = _recurringBills.findIndex(x => x.id === _rbEditId);
        if (idx > -1) _recurringBills[idx] = { ..._recurringBills[idx], vendor, amount, frequency, next_run, status };
        showNotify('Profile updated ✦');
      } else {
        const row = await api('POST', '/api/recurring-bills', { vendor, amount, frequency, next_run, status });
        _recurringBills.push(row);
        showNotify('Recurring bill added ✦');
      }
      closeModalById('recurring-bill-modal');
      renderRecurringBillsList(); updateRecurringBillMetrics();
    } catch (e) { showNotify('Could not save — ' + e.message, true); }
  };

  window.deleteRecurringBill = async function (id) {
    if (!confirm('Remove this recurring bill profile?')) return;
    try {
      await api('DELETE', `/api/recurring-bills/${id}`);
      _recurringBills = _recurringBills.filter(x => x.id !== id);
      renderRecurringBillsList(); updateRecurringBillMetrics();
      showNotify('Profile removed');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ RECURRING INVOICES ══
  // ─────────────────────────────────────────────────────────────────
  let _recurringInvoices = [];
  let _riEditId = null;

  async function loadRecurringInvoices() {
    try {
      _recurringInvoices = await api('GET', '/api/recurring-invoices');
      renderRecurringInvoicesList();
    } catch (e) { console.warn('[RecurringInvoices] load error', e); }
  }

  function renderRecurringInvoicesList() {
    const list = document.getElementById('recurring-inv-list');
    if (!list) return;
    if (!_recurringInvoices.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No recurring invoice profiles</div>';
      return;
    }
    list.innerHTML = _recurringInvoices.map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--t1)">${r.client}</div>
          <div style="font-size:11px;color:var(--t3)">${r.frequency} · Next: ${r.next_run || '—'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-family:var(--font-mono);font-weight:600;color:var(--t1)">$${Number(r.amount||0).toLocaleString()}</span>
          ${statusBadge(r.status)}
          <button class="btn btn-ghost btn-sm" onclick="editRecurringInvoice(${r.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteRecurringInvoice(${r.id})">✕</button>
        </div>
      </div>`).join('');
  }

  window.renderRecurringInvoices = renderRecurringInvoicesList;

  window.openNewRecurringModal = function () {
    _riEditId = null;
    setField('ri-client', ''); setField('ri-amount', '');
    setField('ri-freq', 'Monthly'); setField('ri-next', '');
    setField('ri-status', 'active');
    const title = document.querySelector('#recurring-inv-modal .modal-title');
    if (title) title.textContent = 'New Recurring Invoice';
    const btn = document.querySelector('#recurring-inv-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save profile →';
    openModal('recurring-inv-modal');
  };

  window.editRecurringInvoice = function (id) {
    const r = _recurringInvoices.find(x => x.id === id);
    if (!r) return;
    _riEditId = id;
    setField('ri-client', r.client);
    setField('ri-amount', r.amount);
    setField('ri-freq',   r.frequency);
    setField('ri-next',   r.next_run);
    setField('ri-status', r.status);
    const title = document.querySelector('#recurring-inv-modal .modal-title');
    if (title) title.textContent = 'Edit Recurring Invoice';
    const btn = document.querySelector('#recurring-inv-modal .ff-save-btn');
    if (btn) btn.textContent = 'Save changes →';
    openModal('recurring-inv-modal');
  };

  window.saveRecurringInvoice = async function () {
    const client    = fieldVal('ri-client').trim();
    const amount    = parseFloat(fieldVal('ri-amount')) || 0;
    const frequency = fieldVal('ri-freq') || 'Monthly';
    const next_run  = fieldVal('ri-next');
    const status    = fieldVal('ri-status') || 'active';
    if (!client || !amount) { showNotify('Client and amount required.', true); return; }
    try {
      if (_riEditId) {
        await api('PUT', `/api/recurring-invoices/${_riEditId}`, { client, amount, frequency, next_run, status });
        const idx = _recurringInvoices.findIndex(x => x.id === _riEditId);
        if (idx > -1) _recurringInvoices[idx] = { ..._recurringInvoices[idx], client, amount, frequency, next_run, status };
        showNotify('Profile updated ✦');
      } else {
        const row = await api('POST', '/api/recurring-invoices', { client, amount, frequency, next_run, status });
        _recurringInvoices.push(row);
        showNotify('Recurring invoice added ✦');
      }
      closeModalById('recurring-inv-modal');
      renderRecurringInvoicesList();
    } catch (e) { showNotify('Could not save — ' + e.message, true); }
  };

  window.deleteRecurringInvoice = async function (id) {
    if (!confirm('Remove this recurring invoice profile?')) return;
    try {
      await api('DELETE', `/api/recurring-invoices/${id}`);
      _recurringInvoices = _recurringInvoices.filter(x => x.id !== id);
      renderRecurringInvoicesList();
      showNotify('Profile removed');
    } catch (e) { showNotify('Could not delete — ' + e.message, true); }
  };

  // ─────────────────────────────────────────────────────────────────
  // ══ BOOT: load all data when a page is shown ══
  // ─────────────────────────────────────────────────────────────────
  const _origShowPage = window.showPage;
  window.showPage = function (id, el) {
    if (typeof _origShowPage === 'function') _origShowPage(id, el);
    // Lazy-load on first visit
    if (id === 'quotes')            loadQuotes();
    if (id === 'vendors')           loadVendors();
    if (id === 'bills')             loadBills();
    if (id === 'recurring-bills')   loadRecurringBills();
    if (id === 'recurring-invoices') loadRecurringInvoices();
  };

  // Also load if page is already active on boot (e.g. deep link)
  window.addEventListener('DOMContentLoaded', function () {
    // Give other wiring scripts a tick to set up first
    setTimeout(() => {
      // If already on one of these pages, load data now
      const active = document.querySelector('.page:not(.hidden), .page[style*="display"]');
      if (!active) return;
      const id = active.id?.replace('page-', '');
      if (['quotes','vendors','bills','recurring-bills','recurring-invoices'].includes(id)) {
        window.showPage && window.showPage(id, null);
      }
    }, 800);
  });

  console.log('[FinFlow Stubs Wiring] ✅ Quotes, Bills, Vendors, Recurring Bills, Recurring Invoices — all wired to real API');

})();
