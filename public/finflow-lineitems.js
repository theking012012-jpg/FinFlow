'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * finflow-lineitems.js — a repeatable Qty / Rate / Description editor for the New Invoice,
 * New Bill and New Quote modals (F194 Phase 2a invoices; Phase 2b bills + quotes).
 *
 * OPTIONAL and backward-compatible: leave it empty and the single "Amount" field behaves exactly as
 * before. Add one or more rows and the Amount becomes the live Σ (qty × rate) and locks — but that
 * on-screen number is only a MIRROR. The server re-derives amount = round(Σ qty×rate, 2) from the
 * line_items on save and stores THAT as canonical (CLAUDE.md Rule 2 — one writer for the money
 * figure), so the browser's sum can never become a second source of truth.
 *
 * One factory, one editor implementation, three instances keyed by an id-prefix:
 *   inv   → #inv-*   → window.ffInvLineItems    (invoice modal)
 *   bill  → #bill-*  → window.ffBillLineItems   (bill modal — feeds expense recognition)
 *   quote → #quote-* → window.ffQuoteLineItems  (quote modal — document total only)
 * Every instance operates ONLY on its own prefixed ids, so the three never collide.
 *
 * Ships DIRECTLY (loaded <script defer> AFTER the bundle). saveInvoice/saveBill/saveQuote (bundle)
 * call the matching instance's .get() to attach line_items to the POST; the modal-open functions
 * call .reset(). The invoice instance keeps its exact prior id/API surface for backward-compat.
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  // FA-B5: the business's saved items (Items page), one datalist shared by the three editors; refreshed on each new form.
  var _items = [];
  function itemByName(v) { var k = String(v || '').trim().toLowerCase(); if (!k) return null; for (var i = 0; i < _items.length; i++) if (String(_items[i].name || '').trim().toLowerCase() === k) return _items[i]; return null; }
  function loadItems() {
    try {
      fetch('/api/items', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
        _items = (Array.isArray(rows) ? rows : []).filter(function (i) { return i && i.name && String(i.status || 'Active').toLowerCase() !== 'inactive'; });
        var dl = $('ff-items-dl'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'ff-items-dl'; document.body.appendChild(dl); }
        dl.innerHTML = _items.map(function (i) { var o = document.createElement('option'); o.value = i.name; return o.outerHTML; }).join('');
      }).catch(function () {});
    } catch (_) {}
  }
  function money(n) { try { if (typeof S === 'function') return S(n); } catch (_) {} return '$' + (parseFloat(n) || 0).toFixed(2); }
  function num(v) { var n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

  // Build one editor bound to a prefix (e.g. 'inv'). All ids are `${p}-li-*`; the amount field the
  // editor drives is `${p}-amount` — the same naming the invoice modal already used, so the invoice
  // instance is byte-identical to the pre-Phase-2b module.
  function makeLI(p) {
    var ROW = ''
      + '<tr class="' + p + '-li-row" data-style="border-bottom:1px solid var(--bd,#2a2318)">'
      +   '<td data-style="padding:4px 6px 4px 0"><input class="finput ' + p + '-li-desc" list="ff-items-dl" autocomplete="off" placeholder="Item or service" aria-label="Item or service" data-style="font-size:13px;padding:6px 8px"></td>'
      +   '<td data-style="padding:4px 6px"><input class="finput ' + p + '-li-qty" type="number" min="0" step="any" placeholder="1" data-style="font-size:13px;padding:6px 8px;text-align:center"></td>'
      +   '<td data-style="padding:4px 6px"><input class="finput ' + p + '-li-rate" type="number" min="0" step="any" placeholder="0.00" data-style="font-size:13px;padding:6px 8px;text-align:right"></td>'
      +   '<td class="' + p + '-li-line" data-style="padding:4px 6px;text-align:right;color:var(--t2,#b9ad93);font-size:13px;white-space:nowrap">—</td>'
      +   '<td data-style="padding:4px 0 4px 6px;text-align:center"><button type="button" class="' + p + '-li-del" title="Remove line" data-style="background:none;border:none;color:var(--t3,#7a6f57);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px">×</button></td>'
      + '</tr>';

    var reDesc = new RegExp(p + '-li-(desc|qty|rate)');

    function rowEls() { var b = $(p + '-li-rows'); return b ? Array.prototype.slice.call(b.querySelectorAll('.' + p + '-li-row')) : []; }
    function readRow(tr) {
      return {
        itemId: tr.getAttribute('data-item-id') ? Number(tr.getAttribute('data-item-id')) : null,
        desc: (tr.querySelector('.' + p + '-li-desc') || {}).value || '',
        qty:  num((tr.querySelector('.' + p + '-li-qty')  || {}).value),
        rate: num((tr.querySelector('.' + p + '-li-rate') || {}).value),
        lineEl: tr.querySelector('.' + p + '-li-line'),
      };
    }

    // A row counts only if the user has actually put something in it. An empty just-added row is
    // ignored, so "Add line" then leaving it blank still falls back to the single-amount path.
    function collect() {
      var out = [];
      rowEls().forEach(function (tr) {
        var v = readRow(tr);
        var filled = v.desc.trim() !== '' || v.qty > 0 || v.rate > 0;
        if (filled) out.push(Object.assign({ desc: v.desc.trim(), qty: v.qty, rate: v.rate }, v.itemId ? { item_id: v.itemId } : {}));
      });
      return out.length ? out : null;
    }

    function recompute() {
      var items = collect();
      var amt = $(p + '-amount');
      var totRow = $(p + '-li-total'), totVal = $(p + '-li-total-val');
      // per-line amounts
      rowEls().forEach(function (tr) { var v = readRow(tr); if (v.lineEl) v.lineEl.textContent = (v.qty > 0 || v.rate > 0) ? money(v.qty * v.rate) : '—'; });
      if (items) {
        var sum = Math.round(items.reduce(function (s, i) { return s + i.qty * i.rate; }, 0) * 100) / 100;
        if (totRow) totRow.style.display = '';
        if (totVal) totVal.textContent = money(sum);
        if (amt) { amt.value = sum ? sum.toFixed(2) : ''; amt.readOnly = true; amt.style.opacity = '.65'; amt.title = 'Computed from line items'; }
      } else {
        if (totRow) totRow.style.display = 'none';
        if (amt) { amt.readOnly = false; amt.style.opacity = ''; amt.title = ''; }
      }
    }

    function addRow() {
      var b = $(p + '-li-rows'); if (!b) return;
      var tmp = document.createElement('tbody'); tmp.innerHTML = ROW;
      b.appendChild(tmp.firstChild);
      recompute();
    }

    // FA-B5: typing or picking a saved item's name links the line to it and, when the rate is still empty, fills it —
    // the selling price on invoices and quotes, the cost (else the price) on bills. Change the name and the link drops.
    function pickItem(input) {
      var tr = input.closest ? input.closest('.' + p + '-li-row') : null; if (!tr) return;
      var it = itemByName(input.value);
      if (!it) { tr.removeAttribute('data-item-id'); return; }
      tr.setAttribute('data-item-id', String(it.id));
      var rate = tr.querySelector('.' + p + '-li-rate'), qty = tr.querySelector('.' + p + '-li-qty');
      var r = p === 'bill' ? (it.cost != null && it.cost !== '' ? it.cost : it.price) : it.price;
      if (rate && !(num(rate.value) > 0) && num(r) > 0) rate.value = String(num(r));
      if (qty && !(num(qty.value) > 0)) qty.value = '1';
    }

    function reset() {
      loadItems();
      var b = $(p + '-li-rows'); if (b) b.innerHTML = '';
      var amt = $(p + '-amount'); if (amt) { amt.readOnly = false; amt.style.opacity = ''; amt.title = ''; }
      var totRow = $(p + '-li-total'); if (totRow) totRow.style.display = 'none';
    }

    function install() {
      var wrap = $(p + '-li-wrap'); if (!wrap || wrap._ffWired) return;
      wrap._ffWired = true;
      var addBtn = $(p + '-li-add'); if (addBtn) addBtn.addEventListener('click', addRow);
      // one delegated listener each for edits and row-removal
      wrap.addEventListener('input', function (e) {
        if (!e.target || !reDesc.test(e.target.className)) return;
        if (e.target.classList.contains(p + '-li-desc')) pickItem(e.target);
        recompute();
      });
      wrap.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.' + p + '-li-del') : null;
        if (!btn) return;
        var tr = btn.closest('.' + p + '-li-row'); if (tr) tr.parentNode.removeChild(tr);
        recompute();
      });
    }

    // LR9: open a saved document for editing with its lines — reset, one row per stored line, then the total re-derives
    // from them (Rule 2). An empty / missing list leaves the single-amount path.
    function load(items) {
      reset();
      (Array.isArray(items) ? items : []).forEach(function (it) {
        addRow();
        var rows = rowEls(), tr = rows[rows.length - 1]; if (!tr) return;
        var d = tr.querySelector('.' + p + '-li-desc'), q = tr.querySelector('.' + p + '-li-qty'), r = tr.querySelector('.' + p + '-li-rate');
        if (d) d.value = it && it.desc != null ? String(it.desc) : '';
        if (q) q.value = it && it.qty != null ? String(it.qty) : '';
        if (r) r.value = it && it.rate != null ? String(it.rate) : '';
        if (it && it.item_id) tr.setAttribute('data-item-id', String(it.item_id)); else tr.removeAttribute('data-item-id');
      });
      recompute();
    }

    return { get: collect, reset: reset, addRow: addRow, recompute: recompute, install: install, load: load };
  }

  var inv   = makeLI('inv');
  var bill  = makeLI('bill');
  var quote = makeLI('quote');

  window.ffInvLineItems   = { get: inv.get,   reset: inv.reset,   addRow: inv.addRow,   recompute: inv.recompute,   load: inv.load };
  window.ffBillLineItems  = { get: bill.get,  reset: bill.reset,  addRow: bill.addRow,  recompute: bill.recompute,  load: bill.load };
  window.ffQuoteLineItems = { get: quote.get, reset: quote.reset, addRow: quote.addRow, recompute: quote.recompute, load: quote.load };

  function installAll() { inv.install(); bill.install(); quote.install(); }

  // Bills/quotes open via generic modal-show functions (no per-modal reset like openInvoiceModal has),
  // so wrap those openers to clear the editor first — a fresh modal = a fresh (empty) line-items set.
  // The invoice modal already resets via openInvoiceModal (app-main.js) → its instance is untouched here.
  function wrapOpener(name, inst) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig._ffLiWrapped) return;
    var wrapped = function () { try { inst.reset(); } catch (_) {} return orig.apply(this, arguments); };
    wrapped._ffLiWrapped = true;
    window[name] = wrapped;
  }
  function wrapOpeners() { wrapOpener('openBillModal', bill); wrapOpener('openQuoteModal', quote); }

  function boot() { installAll(); wrapOpeners(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
