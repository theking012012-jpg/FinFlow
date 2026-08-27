'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * finflow-lineitems.js — a repeatable Qty / Rate / Description editor for the New Invoice modal.
 *
 * OPTIONAL and backward-compatible: leave it empty and the single "Amount" field behaves exactly as
 * before. Add one or more rows and the Amount becomes the live Σ (qty × rate) and locks — but that
 * on-screen number is only a MIRROR. The server re-derives amount = round(Σ qty×rate, 2) from the
 * line_items on save and stores THAT as canonical (CLAUDE.md Rule 2 — one writer for the money
 * figure), so the browser's sum can never become a second source of truth.
 *
 * Ships DIRECTLY (loaded <script defer> AFTER the bundle). saveInvoice (bundle) calls
 * window.ffInvLineItems.get() to attach line_items to the POST; openInvoiceModal calls .reset().
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function money(n) { try { if (typeof S === 'function') return S(n); } catch (_) {} return '$' + (parseFloat(n) || 0).toFixed(2); }
  function num(v) { var n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

  var ROW = ''
    + '<tr class="inv-li-row" style="border-bottom:1px solid var(--bd,#2a2318)">'
    +   '<td style="padding:4px 6px 4px 0"><input class="finput inv-li-desc" placeholder="Item or service" style="font-size:13px;padding:6px 8px"></td>'
    +   '<td style="padding:4px 6px"><input class="finput inv-li-qty" type="number" min="0" step="any" placeholder="1" style="font-size:13px;padding:6px 8px;text-align:center"></td>'
    +   '<td style="padding:4px 6px"><input class="finput inv-li-rate" type="number" min="0" step="any" placeholder="0.00" style="font-size:13px;padding:6px 8px;text-align:right"></td>'
    +   '<td class="inv-li-line" style="padding:4px 6px;text-align:right;color:var(--t2,#b9ad93);font-size:13px;white-space:nowrap">—</td>'
    +   '<td style="padding:4px 0 4px 6px;text-align:center"><button type="button" class="inv-li-del" title="Remove line" style="background:none;border:none;color:var(--t3,#7a6f57);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px">×</button></td>'
    + '</tr>';

  function rowEls() { var b = $('inv-li-rows'); return b ? Array.prototype.slice.call(b.querySelectorAll('.inv-li-row')) : []; }
  function readRow(tr) {
    return {
      desc: (tr.querySelector('.inv-li-desc') || {}).value || '',
      qty:  num((tr.querySelector('.inv-li-qty')  || {}).value),
      rate: num((tr.querySelector('.inv-li-rate') || {}).value),
      lineEl: tr.querySelector('.inv-li-line'),
    };
  }

  // A row counts only if the user has actually put something in it. An empty just-added row is
  // ignored, so "Add line" then leaving it blank still falls back to the single-amount path.
  function collect() {
    var out = [];
    rowEls().forEach(function (tr) {
      var v = readRow(tr);
      var filled = v.desc.trim() !== '' || v.qty > 0 || v.rate > 0;
      if (filled) out.push({ desc: v.desc.trim(), qty: v.qty, rate: v.rate });
    });
    return out.length ? out : null;
  }

  function recompute() {
    var items = collect();
    var amt = $('inv-amount');
    var totRow = $('inv-li-total'), totVal = $('inv-li-total-val');
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
    var b = $('inv-li-rows'); if (!b) return;
    var tmp = document.createElement('tbody'); tmp.innerHTML = ROW;
    b.appendChild(tmp.firstChild);
    recompute();
  }

  function reset() {
    var b = $('inv-li-rows'); if (b) b.innerHTML = '';
    var amt = $('inv-amount'); if (amt) { amt.readOnly = false; amt.style.opacity = ''; amt.title = ''; }
    var totRow = $('inv-li-total'); if (totRow) totRow.style.display = 'none';
  }

  function install() {
    var wrap = $('inv-li-wrap'); if (!wrap || wrap._ffWired) return;
    wrap._ffWired = true;
    var addBtn = $('inv-li-add'); if (addBtn) addBtn.addEventListener('click', addRow);
    // one delegated listener each for edits and row-removal
    wrap.addEventListener('input', function (e) { if (e.target && /inv-li-(desc|qty|rate)/.test(e.target.className)) recompute(); });
    wrap.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.inv-li-del') : null;
      if (!btn) return;
      var tr = btn.closest('.inv-li-row'); if (tr) tr.parentNode.removeChild(tr);
      recompute();
    });
  }

  window.ffInvLineItems = { get: collect, reset: reset, addRow: addRow, recompute: recompute };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
