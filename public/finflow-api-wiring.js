// ════════════════════════════════════════════════════════════════════
// FINFLOW — API WIRING PATCH
// Drop this file into /public and add ONE script tag at the bottom
// of index.html, just before </body>:
//   <script src="/finflow-api-wiring.js"></script>
//
// This file patches all in-memory-only save functions to also persist
// data to the backend API. It does NOT touch any existing code — it
// only wraps/replaces functions after they are defined.
//
// Covers all EASY fixes from the checklist:
//   ✅ saveSettings()        → PUT  /api/settings
//   ✅ Boot: load settings   → GET  /api/settings
//   ✅ saveGoal()            → POST /api/goals
//   ✅ deleteGoal()          → DELETE /api/goals/:id  (new function)
//   ✅ saveTransaction()     → POST /api/personal-transactions
//   ✅ saveHolding()         → POST /api/holdings
//   ✅ Boot: load personal   → GET  /api/personal-transactions
//   ✅ saveCustomer() create → POST /api/customers
//   ✅ saveCustomer() edit   → PUT  /api/customers/:id
//   ✅ deleteCustomer()      → DELETE /api/customers/:id
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Shared fetch helper ────────────────────────────────────────────
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

  // ── Wait for DOM + existing scripts to finish ──────────────────────
  // We patch after DOMContentLoaded so all original functions exist.
  (function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }

    // ════════════════════════════════════════════
    // 1. SETTINGS — load on boot + save
    // ════════════════════════════════════════════
    // F196 Tier 2 — PER-ENTITY BUSINESS PROFILE.
    // The letterhead on every document is issued BY an entity, but /api/settings is ONE row per
    // ACCOUNT (server.js: `WHERE user_id=$1 AND data->>'key' IS NULL`), loaded once at boot and never
    // reloaded on an entity switch. So a multi-entity account printed the same business name, address,
    // tax-id and contact on every entity's documents. That is the Rule 10 "under investigation" class:
    // a setting stored PER-USER applied to PER-ENTITY output.
    //
    // The Business-profile panel now edits the ACTIVE ENTITY's profile, with the account blob kept as
    // the fallback for any field the entity has not set (so nothing changes for a single-entity account
    // and no data migration is required — Rule 8).
    //
    // NOTE the deliberate split: `s-biz-email` / `s-biz-phone` are the BUSINESS contact that prints on
    // documents; `s-email` / `s-phone` under "Your profile" remain the USER's own and are NOT touched
    // here. The letterhead previously read the user's fields, so a business document printed the
    // user's personal contact details.
    var ENT_PROFILE_FIELDS = {
      business_name: 's-biz-name',
      address:       's-address',
      email:         's-biz-email',
      phone:         's-biz-phone',
      tax_id:        's-tax-id',
      website:       's-website',
    };
    var _accountProfile = {};   // the account-wide blob, cached at boot as the per-field FALLBACK

    function _activeEntity() {
      try { return (window.ENTITIES || []).find(function (e) { return e && e.active; }) || null; }
      catch (_) { return null; }
    }

    // Paint the Business-profile inputs for whichever entity is active RIGHT NOW. Every field is
    // recomputed from scratch (entity ?? account ?? '') rather than only overwritten when the entity
    // has a value — otherwise a switch would leave the previous entity's values on screen for any
    // field the new entity has not set.
    function applyEntityProfileFields() {
      var ent = _activeEntity();
      var prof = (ent && ent.profile) || {};
      Object.keys(ENT_PROFILE_FIELDS).forEach(function (f) {
        var el = document.getElementById(ENT_PROFILE_FIELDS[f]);
        if (!el) return;
        var v = prof[f];
        if (v == null || v === '') v = _accountProfile[f];
        // business_name falls back to the entity's own switcher name before the account blob, so a
        // brand-new entity shows its own name rather than another entity's business name.
        if ((v == null || v === '') && f === 'business_name' && ent && ent.name) v = ent.name;
        el.value = (v == null) ? '' : v;
      });
      if (typeof window.updateBrandName === 'function') { try { window.updateBrandName(); } catch (_) {} }
    }
    // Exposed so the entity switcher can repaint the panel without a page reload (index.html switchEntity).
    window._ffApplyEntityProfile = applyEntityProfileFields;

    // Load settings from DB and apply them to the form fields
    async function loadSettingsFromDB() {
      try {
        const s = await api('GET', '/api/settings');
        // Apply currency
        if (s.currency) {
          const sel = document.getElementById('s-currency');
          if (sel) {
            sel.value = s.currency;
            // Trigger currency update
            const map = { USD: '$', EUR: '€', GBP: '£', TTD: 'TT$', CAD: 'C$', AUD: 'A$' };
            window.currencySymbol = map[s.currency] || '$';
          }
        }
        // Apply dark mode
        if (s.dark_mode != null) {
          window.darkMode = !!s.dark_mode;
          document.getElementById('app')?.classList.toggle('light-mode', !window.darkMode);
          const tog = document.getElementById('s-dark-toggle');
          if (tog) tog.checked = !!s.dark_mode;
        }
        // Apply show cents
        if (s.show_cents != null) {
          const sc = document.getElementById('s-cents');
          if (sc) sc.checked = !!s.show_cents;
        }
        // Apply notification toggles
        if (s.notif_email != null) {
          const el = document.getElementById('s-notif-email');
          if (el) el.checked = !!s.notif_email;
        }
        if (s.notif_inv != null) {
          const el = document.getElementById('s-notif-inv');
          if (el) el.checked = !!s.notif_inv;
        }
        if (s.notif_pay != null) {
          const el = document.getElementById('s-notif-pay');
          if (el) el.checked = !!s.notif_pay;
        }
        // Business profile fields (set from onboarding or earlier saves)
        const setField = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
        setField('s-biz-name', s.business_name);
        setField('s-industry', s.industry);
        setField('s-address',  s.address);
        setField('s-email',    s.email);
        setField('s-phone',    s.phone);
        setField('s-website',  s.website);
        setField('s-tax-id',   s.tax_id);
        setField('s-fy',       s.fiscal_year);
        // F196 Tier 2: the account blob above is ONE row per account, so on a multi-entity account it
        // labels every entity with the same business. Cache it as the FALLBACK, then overlay the
        // ACTIVE entity's own profile on top. Cached (rather than re-fetched) so an entity switch can
        // recompute every field deterministically: entity value ?? account value ?? '' — otherwise
        // switching from an entity that HAS an address to one that does not would leave the previous
        // entity's address on screen (the same stale-carry-over class as F151).
        _accountProfile = {
          business_name: s.business_name, address: s.address, email: s.email,
          phone: s.phone, tax_id: s.tax_id, website: s.website,
        };
        applyEntityProfileFields();
      } catch (e) {
        // Not logged in yet or no settings saved — fine, use defaults
      }
    }
    loadSettingsFromDB();

    // Patch saveSettings to actually persist
    window.saveSettings = async function () {
      const currency = document.getElementById('s-currency')?.value;
      const dark_mode = document.getElementById('s-dark-toggle')?.checked || document.getElementById('s-dark')?.checked;
      const show_cents = document.getElementById('s-cents')?.checked;
      const notif_email = document.getElementById('s-notif-email')?.checked;
      const notif_inv = document.getElementById('s-notif-inv')?.checked;
      const notif_pay = document.getElementById('s-notif-pay')?.checked;
      const name = document.getElementById('s-user-name')?.value?.trim();
      // Business profile fields — these are audit-logged on the server
      const business_name = document.getElementById('s-biz-name')?.value?.trim();
      const industry      = document.getElementById('s-industry')?.value;
      const address       = document.getElementById('s-address')?.value?.trim();
      const email         = document.getElementById('s-email')?.value?.trim();
      const phone         = document.getElementById('s-phone')?.value?.trim();
      const website       = document.getElementById('s-website')?.value?.trim();
      const tax_id        = document.getElementById('s-tax-id')?.value?.trim();
      const fiscal_year   = document.getElementById('s-fy')?.value;

      try {
        await api('PUT', '/api/settings', {
          currency,
          dark_mode,
          show_cents,
          notif_email,
          notif_inv,
          notif_pay,
          name,
          business_name,
          // F149-b: this is the deliberate "rename the business I'm viewing" action, so it opts in
          // to the server's entity rename (server.js ~1733). No other /api/settings caller sends this,
          // so a settings write can never rename an entity by accident (that was F149).
          rename_active_entity: true,
          industry,
          address,
          email,
          phone,
          website,
          tax_id,
          fiscal_year,
        });
        notify('Settings saved successfully ✦');
        // F196 Tier 2: the Business profile belongs to the ACTIVE ENTITY — write it there too, so a
        // multi-entity account gets per-entity letterheads instead of one account-wide business.
        // The /api/settings write above is deliberately left intact: it keeps the account blob current
        // as the FALLBACK for entities with no profile, and it is what a role holding `settings:manage`
        // but NOT `entities:manage` is permitted to do. Both writers take the SAME input fields, so
        // they cannot disagree (Rule 2) — the entity copy simply wins when present.
        try {
          const _ent = _activeEntity();
          if (_ent && _ent._dbId) {
            const _profile = {
              business_name: document.getElementById('s-biz-name')?.value?.trim() || '',
              address:       document.getElementById('s-address')?.value?.trim() || '',
              email:         document.getElementById('s-biz-email')?.value?.trim() || '',
              phone:         document.getElementById('s-biz-phone')?.value?.trim() || '',
              tax_id:        document.getElementById('s-tax-id')?.value?.trim() || '',
              website:       document.getElementById('s-website')?.value?.trim() || '',
            };
            await api('PUT', '/api/entities/' + _ent._dbId, _profile);
            // Keep the in-memory entity in lockstep so the next document renders the new letterhead
            // without a page reload (the letterhead reads ENTITIES[i].profile, not the DB).
            _ent.profile = Object.assign({}, _ent.profile || {}, _profile);
          }
        } catch (e2) {
          // Never silent: the account-level save succeeded but the per-entity letterhead did not, and
          // the user must know which one they are looking at.
          notify('Saved, but this entity\'s business profile did not update — ' + e2.message, true);
        }
        // Refresh all financial displays so currency symbol + format changes apply immediately
        if (typeof window.refreshFinancials === 'function') window.refreshFinancials('all');
      } catch (e) {
        notify('Could not save settings — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 2 + 3. GOALS & PERSONAL TRANSACTIONS — owned by app-main.js
    // ════════════════════════════════════════════
    // REMOVED the stale window.saveGoal / deleteGoal / loadGoalsFromDB and
    // window.saveTransaction / loadPersonalTransactionsFromDB overrides. They wrote
    // the legacy window.goals / window.persTransactions arrays and refreshed only the
    // business dashboard (_refreshDashboardUI) — disconnected from app-main's rebuilt
    // personal pipeline (module goals / _allPersTxs → _applyPersFilter → renderPersonal),
    // so goals and transactions "saved but didn't show until re-nav". app-main.js now
    // owns saveGoal / deletePersGoal / saveTransaction (+ inline quick-add), each POSTing
    // and calling loadPersonalFinance(), which loads goals + transactions from the DB and
    // re-renders. The showPage('personal') hook below calls loadPersonalFinance() so the
    // initial load is covered too. (Holdings overrides intentionally left for a separate
    // Investments-page pass.)

    // ════════════════════════════════════════════
    // 4. HOLDINGS — save
    // ════════════════════════════════════════════
    window.saveHolding = async function () {
      const ticker = (document.getElementById('h-ticker')?.value || '').trim().toUpperCase();
      const name   = (document.getElementById('h-name')?.value   || '').trim() || ticker;
      const shares = parseFloat(document.getElementById('h-shares')?.value) || 0;
      const cost   = parseFloat(document.getElementById('h-cost')?.value)   || 0;
      const price  = parseFloat(document.getElementById('h-price')?.value)  || cost;
      const div    = parseFloat(document.getElementById('h-div')?.value)    || 0;
      const type   = document.getElementById('h-type')?.value || 'Stock';

      if (!ticker || !shares) { notify('Ticker and shares are required', true); return; }

      const colors = ['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a4e3a'];
      const color  = colors[window.holdings.length % colors.length];

      try {
        const saved = await api('POST', '/api/holdings', {
          ticker,
          name,
          asset_type: type,
          shares,
          cost_per: cost,
          price,
          dividend: div,
          color,
        });
        if (!window.holdings) window.holdings = [];
        window.holdings.push({ _dbId: saved.id, ticker, name, type, shares, cost, price, div, color });
        closeModal('holding-modal');
        if (typeof renderInvestments === 'function') renderInvestments();
        notify(`${ticker} added to portfolio ✦`);
        if (typeof window._loadHoldingsFromDB === 'function') window._loadHoldingsFromDB().catch(()=>{});
        window._refreshDashboardUI?.();
      } catch (e) {
        notify('Could not save holding — ' + e.message, true);
      }
    };

    // ════════════════════════════════════════════
    // 5. CUSTOMERS — save (create + edit) + delete
    // ════════════════════════════════════════════
    window.saveCustomer = async function () {
      // Input helpers — use same sanitize/validate functions already in the app
      const fname = (typeof sanitizeText === 'function')
        ? sanitizeText(document.getElementById('cust-fname')?.value, 100)
        : document.getElementById('cust-fname')?.value?.trim();
      const lname = (typeof sanitizeText === 'function')
        ? sanitizeText(document.getElementById('cust-lname')?.value, 100)
        : document.getElementById('cust-lname')?.value?.trim();
      const email = document.getElementById('cust-email')?.value?.trim().toLowerCase().slice(0, 254);

      if (!fname || !lname) { notify('First name and last name are required', true); return; }
      if (!email || (typeof validateEmail === 'function' && !validateEmail(email))) {
        notify('A valid email address is required', true); return;
      }

      const revRaw = (typeof validateAmount === 'function')
        ? validateAmount(document.getElementById('cust-revenue-val')?.value)
        : parseFloat(document.getElementById('cust-revenue-val')?.value) || 0;

      const data = {
        fname, lname, email,
        company:  (typeof sanitizeText === 'function') ? sanitizeText(document.getElementById('cust-company')?.value, 200)  : document.getElementById('cust-company')?.value?.trim(),
        industry: document.getElementById('cust-industry')?.value,
        phone:    (typeof sanitizePhone === 'function')  ? sanitizePhone(document.getElementById('cust-phone')?.value)       : document.getElementById('cust-phone')?.value?.trim(),
        revenue:  revRaw !== null ? revRaw : 0,
        status:   document.getElementById('cust-status')?.value,
        notes:    (typeof sanitizeText === 'function') ? sanitizeText(document.getElementById('cust-notes')?.value, 1000) : document.getElementById('cust-notes')?.value?.trim(),
      };

      const editId = document.getElementById('cust-edit-id')?.value;

      try {
        if (!window.customers) window.customers = [];
        if (editId) {
          // Find DB id
          const cust = window.customers.find(c => c.id === Number(editId));
          const dbId = cust?._dbId || editId;
          await api('PUT', `/api/customers/${dbId}`, data);
          const idx = window.customers.findIndex(c => c.id === Number(editId));
          if (idx > -1) window.customers[idx] = { ...window.customers[idx], ...data };
          notify('Customer updated ✦');
        } else {
          const saved = await api('POST', '/api/customers', data);
          data.id    = window.nextCustId++;
          data._dbId = saved.id;
          window.customers.push(data);
          notify('Customer added ✦');
        }
        closeModal('customer-modal');
        const search = document.getElementById('cust-search')?.value;
        if (typeof renderCustomers === 'function') renderCustomers(search);
      } catch (e) {
        notify('Could not save customer — ' + e.message, true);
      }
    };

    window.deleteCustomer = async function () {
      const id = Number(document.getElementById('cust-edit-id')?.value);
      if (!id) return;
      if (!(await window._confirmModal('Delete this customer? This cannot be undone.', {danger:true}))) return;

      const cust = (window.customers || []).find(c => c.id === id);
      const dbId = cust?._dbId || id;

      try {
        await api('DELETE', `/api/customers/${dbId}`);
        window.customers = (window.customers || []).filter(c => c.id !== id);
        closeModal('customer-modal');
        if (typeof renderCustomers === 'function') renderCustomers();
        notify('Customer deleted');
      } catch (e) {
        notify('Could not delete customer — ' + e.message, true);
      }
    };

    // ── showPage hook: reload personal data when user visits that page ─
    // Goals + personal transactions now load via app-main's loadPersonalFinance()
    // (the rebuilt pipeline), not the removed legacy loaders.
    const _wiringOrig = window.showPage;
    if (typeof _wiringOrig === 'function') {
      window.showPage = function (id, navEl) {
        _wiringOrig(id, navEl);
        if (id === 'personal' && typeof window.loadPersonalFinance === 'function') {
          window.loadPersonalFinance();
        }
      };
    }

    console.log('[FinFlow API Wiring] ✅ All easy patches applied');
  })()

})();
