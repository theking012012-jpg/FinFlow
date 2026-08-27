'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * finflow-docview.js — a single REUSABLE document viewer for every Money In / Money Out record
 * (invoices, bills, sales receipts, payments, credit notes, quotes, vendor credits).
 *
 * Replaces the bare "Invoice Details" modal (and the total absence of a view on the other doc types)
 * with a professional, printable document: business letterhead + logo, the record's REAL data, a
 * line-items table when present (JSONB `line_items` = [{desc, qty, rate}]) or a single summary line
 * when not, status, totals, and Print / Download-PDF. Backward-compatible: a record with no
 * line_items renders exactly the amount it already has.
 *
 * Ships DIRECTLY (loaded by <script defer> AFTER finflow-bundle.js), so its window.viewInvoice
 * override is the runtime winner (Rule 1) — no bundle regen. Letterhead is read from the settings
 * fields the app already loads at boot (s-biz-name / s-address / s-email / s-phone / s-tax-id).
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var SYM = { USD:'$', CAD:'C$', EUR:'€', GBP:'£', TTD:'TT$', AUD:'A$', NGN:'₦', ZAR:'R', BRL:'R$', MXN:'MX$', INR:'₹', JPY:'¥' };
  function sym(cur){ return SYM[cur] || (cur ? cur + ' ' : '$'); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
  function money(n, cur){ var v = (parseFloat(n) || 0); return sym(cur) + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function $(id){ return document.getElementById(id); }
  function val(id){ var el = $(id); return el && el.value != null ? String(el.value).trim() : ''; }

  // ── letterhead + currency, from what the app already has loaded ──
  function letterhead(){
    var e = null;
    try { e = (window.ENTITIES || []).find(function(x){ return x.active; }) || (window.ENTITIES || [])[0] || null; } catch(_){}
    return {
      // F196: a document is issued BY the active ENTITY — its name wins over the account-wide settings
      // business_name (`s-biz-name` is one per account, so it mislabels every entity but the first).
      name:   (e && e.name) || val('s-biz-name') || 'Your Business',
      address:val('s-address'),
      email:  val('s-email'),
      phone:  val('s-phone') || val('nb-phone'),
      taxId:  val('s-tax-id') || val('nb-tax-id'),
      website:val('s-website') || val('nb-website'),
      logo:   window._invoiceLogoDataURL || window._companyLogo || null,
      currency: (e && e.currency) || 'USD',
    };
  }

  // ── per-kind labels ──
  var KIND = {
    invoice:      { title: 'INVOICE',      party: 'Bill To',  numPrefix: 'INV', balanceLabel: 'Balance Due' },
    bill:         { title: 'BILL',         party: 'From',     numPrefix: 'BILL', balanceLabel: 'Amount Due' },
    receipt:      { title: 'RECEIPT',      party: 'Received From', numPrefix: 'RCT', balanceLabel: 'Amount Paid' },
    'credit-note':{ title: 'CREDIT NOTE',  party: 'Credit To', numPrefix: 'CN', balanceLabel: 'Credit Total' },
    quote:        { title: 'QUOTE',        party: 'Prepared For', numPrefix: 'QT', balanceLabel: 'Estimate Total' },
    payment:      { title: 'PAYMENT',      party: 'Party',    numPrefix: 'PAY', balanceLabel: 'Amount' },
    'vendor-credit':{ title: 'VENDOR CREDIT', party: 'Vendor', numPrefix: 'VC', balanceLabel: 'Credit Total' },
  };
  function statusColor(s){
    s = String(s || '').toLowerCase();
    if (s === 'paid' || s === 'approved') return '#1a7f4b';
    if (s === 'overdue') return '#c0392b';
    if (s === 'partial' || s === 'pending' || s === 'unpaid') return '#b8860b';
    if (s === 'draft') return '#888';
    return '#555';
  }

  function ymd(v){ if (!v) return ''; try { return window.FinFlowDates ? window.FinFlowDates._toYmd(v) : String(v).slice(0,10); } catch(_){ return String(v).slice(0,10); } }
  function dlabel(v){ var d = ymd(v); if (!d) return '—'; var p = d.split('-'); var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return (+p[2]) + ' ' + M[(+p[1]-1)] + ' ' + p[0]; }

  // ── the reusable renderer: a full white document, ready for print/iframe ──
  // doc: { number, party, party_address, issue_date, due_date, status, notes, amount, tax, line_items:[{desc,qty,rate}], currency }
  function buildDocumentHTML(doc, kind){
    doc = doc || {};
    var K = KIND[kind] || KIND.invoice;
    var L = letterhead();
    var cur = doc.currency || L.currency || 'USD';
    var acc = '#c9a84c';

    var items = Array.isArray(doc.line_items) && doc.line_items.length ? doc.line_items : null;
    var rowsHTML, subtotal;
    if (items){
      subtotal = items.reduce(function(s,i){ return s + (parseFloat(i.qty)||0) * (parseFloat(i.rate)||0); }, 0);
      rowsHTML = items.map(function(i, n){
        var lineTotal = (parseFloat(i.qty)||0) * (parseFloat(i.rate)||0);
        return '<tr>'
          + '<td style="padding:11px 8px;border-bottom:1px solid #eee;color:#555;width:28px">'+(n+1)+'</td>'
          + '<td style="padding:11px 8px;border-bottom:1px solid #eee;color:#222">'+esc(i.desc || '—')+'</td>'
          + '<td style="padding:11px 8px;border-bottom:1px solid #eee;text-align:center;color:#666">'+(parseFloat(i.qty)||0)+'</td>'
          + '<td style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#666">'+money(i.rate, cur)+'</td>'
          + '<td style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#222;font-weight:600">'+money(lineTotal, cur)+'</td>'
          + '</tr>';
      }).join('');
    } else {
      // no line items — a single summary row from the record's own amount + description/notes
      subtotal = parseFloat(doc.amount) || 0;
      rowsHTML = '<tr>'
        + '<td style="padding:11px 8px;border-bottom:1px solid #eee;color:#555;width:28px">1</td>'
        + '<td style="padding:11px 8px;border-bottom:1px solid #eee;color:#222">'+esc(doc.notes || doc.description || (K.title.charAt(0) + K.title.slice(1).toLowerCase()))+'</td>'
        + '<td style="padding:11px 8px;border-bottom:1px solid #eee;text-align:center;color:#666">1</td>'
        + '<td style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#666">'+money(subtotal, cur)+'</td>'
        + '<td style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#222;font-weight:600">'+money(subtotal, cur)+'</td>'
        + '</tr>';
    }
    var tax = parseFloat(doc.tax) || 0;
    var total = subtotal + tax;

    var logoHTML = L.logo
      ? '<img src="'+esc(L.logo)+'" style="max-height:52px;max-width:180px;object-fit:contain" alt="">'
      : '<div style="font-size:22px;font-weight:700;color:'+acc+';font-family:Georgia,serif;font-style:italic">'+esc(L.name)+'</div>';

    var statusBadge = doc.status
      ? '<span style="display:inline-block;margin-top:8px;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:'+statusColor(doc.status)+'">'+esc(doc.status)+'</span>'
      : '';

    var partyBlock = '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:6px">'+K.party+'</div>'
      + '<div style="font-size:14px;font-weight:600;color:#1a1a1a">'+esc(doc.party || '—')+'</div>'
      + (doc.party_address ? '<div style="font-size:12px;color:#666;margin-top:3px;white-space:pre-line">'+esc(doc.party_address)+'</div>' : '');

    var lhLines = [L.address, L.phone, L.email, (L.taxId ? 'Tax ID: ' + L.taxId : '')].filter(Boolean)
      .map(function(x){ return '<div style="font-size:12px;color:#666;line-height:1.55">'+esc(x)+'</div>'; }).join('');

    var totalsHTML =
        '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#555"><span>Subtotal</span><span>'+money(subtotal, cur)+'</span></div>'
      + (tax ? '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#555"><span>Tax</span><span>'+money(tax, cur)+'</span></div>' : '')
      + '<div style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:6px;border-top:2px solid #222;font-size:15px;font-weight:700;color:#111"><span>'+K.balanceLabel+'</span><span>'+money(total, cur)+'</span></div>';

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>*{box-sizing:border-box;margin:0;padding:0}'
      + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#222;padding:44px 40px;max-width:760px;margin:0 auto}'
      + 'table{width:100%;border-collapse:collapse}'
      + '@media print{body{padding:0}}</style></head><body>'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">'
      +   '<div>'+logoHTML+'</div>'
      +   '<div style="text-align:right">'
      +     '<div style="font-size:30px;font-weight:800;letter-spacing:.04em;color:#1a1a1a;font-family:Georgia,serif">'+K.title+'</div>'
      +     (doc.number ? '<div style="font-size:12px;color:#888;margin-top:2px">#'+esc(doc.number)+'</div>' : '')
      +     statusBadge
      +   '</div>'
      + '</div>'
      + '<div style="height:1px;background:#eee;margin:22px 0"></div>'
      + '<div style="display:flex;justify-content:space-between;gap:24px">'
      +   '<div style="max-width:52%">'
      +     '<div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:4px">'+esc(L.name)+'</div>'+lhLines
      +   '</div>'
      +   '<div style="text-align:right;font-size:12px;color:#555;line-height:1.9">'
      +     (doc.issue_date ? '<div><span style="color:#999">Date:</span> '+dlabel(doc.issue_date)+'</div>' : '')
      +     (doc.due_date ? '<div><span style="color:#999">Due:</span> '+dlabel(doc.due_date)+'</div>' : '')
      +   '</div>'
      + '</div>'
      + '<div style="margin:26px 0 18px">'+partyBlock+'</div>'
      + '<table><thead><tr style="background:#2a2a2a;color:#fff">'
      +   '<th style="padding:10px 8px;text-align:left;font-size:11px;letter-spacing:.05em;width:28px">#</th>'
      +   '<th style="padding:10px 8px;text-align:left;font-size:11px;letter-spacing:.05em">Item &amp; Description</th>'
      +   '<th style="padding:10px 8px;text-align:center;font-size:11px;letter-spacing:.05em">Qty</th>'
      +   '<th style="padding:10px 8px;text-align:right;font-size:11px;letter-spacing:.05em">Rate</th>'
      +   '<th style="padding:10px 8px;text-align:right;font-size:11px;letter-spacing:.05em">Amount</th>'
      + '</tr></thead><tbody>'+rowsHTML+'</tbody></table>'
      + '<div style="display:flex;justify-content:flex-end;margin-top:20px"><div style="width:260px">'+totalsHTML+'</div></div>'
      + (doc.notes && items ? '<div style="margin-top:28px;padding-top:14px;border-top:1px solid #eee"><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:5px">Notes</div><div style="font-size:12.5px;color:#555;line-height:1.6">'+esc(doc.notes)+'</div></div>' : '')
      + '<div style="text-align:center;margin-top:34px;padding-top:16px;border-top:1px solid #eee"><span style="font-size:10px;color:#bbb;letter-spacing:.08em">POWERED BY </span><span style="font-size:10px;font-weight:700;color:'+acc+';letter-spacing:.06em;font-family:Georgia,serif;font-style:italic">FinFlow</span></div>'
      + '</body></html>';
  }
  window.buildDocumentHTML = buildDocumentHTML;

  // ── the overlay: the document in an isolated iframe + a toolbar (Print / Download / Close) ──
  function overlay(){
    var o = $('ff-docview'); if (o) return o;
    o = document.createElement('div');
    o.id = 'ff-docview';
    o.setAttribute('style', 'position:fixed;inset:0;z-index:9600;display:none;align-items:flex-start;justify-content:center;background:rgba(10,8,5,.62);padding:28px 16px;overflow:auto');
    o.innerHTML =
        '<div style="width:100%;max-width:820px">'
      +   '<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:10px">'
      +     '<button id="ff-docview-print" style="font-family:var(--font,inherit);font-size:12.5px;font-weight:600;padding:8px 15px;border-radius:7px;border:1px solid var(--acc2,#8a6d1f);background:linear-gradient(135deg,var(--acc,#c9a84c),var(--acc2,#8a6d1f));color:#1a1305;cursor:pointer">Print / PDF ↧</button>'
      +     '<button id="ff-docview-close" style="font-family:var(--font,inherit);font-size:12.5px;padding:8px 15px;border-radius:7px;border:1px solid var(--bd,#3a3128);background:var(--bg2,#221c14);color:var(--t1,#e8dcc4);cursor:pointer">Close ✕</button>'
      +   '</div>'
      +   '<iframe id="ff-docview-frame" title="Document" style="width:100%;height:78vh;border:none;border-radius:10px;background:#fff;box-shadow:0 18px 60px rgba(0,0,0,.5)"></iframe>'
      + '</div>';
    document.body.appendChild(o);
    o.addEventListener('click', function(ev){ if (ev.target === o) close(); });
    $('ff-docview-close').onclick = close;
    $('ff-docview-print').onclick = function(){ try { var f = $('ff-docview-frame'); f.contentWindow.focus(); f.contentWindow.print(); } catch(_){} };
    return o;
  }
  function close(){ var o = $('ff-docview'); if (o) o.style.display = 'none'; }
  function openDoc(doc, kind){
    var o = overlay();
    var frame = $('ff-docview-frame');
    try { frame.srcdoc = buildDocumentHTML(doc, kind); } catch(e){ console.warn('[docview]', e && e.message); return; }
    o.style.display = 'flex';
  }
  window.ffOpenDocView = openDoc;

  // ── map a client-side invoice record → the renderer's shape ──
  function invoiceToDoc(inv){
    return {
      number: inv.number || inv.num || (inv._dbId != null ? 'INV-' + String(1000 + Number(inv._dbId)) : ''),
      party: inv.client || inv.customer || '—',
      party_address: inv.client_address || inv.bill_to || '',
      issue_date: inv.issue_date || inv.date || null,
      due_date: inv.due_date || null,
      status: inv.status || '',
      notes: inv.notes || '',
      amount: inv.amount,
      tax: inv.tax || 0,
      line_items: inv.line_items || null,
      currency: inv.currency || null,
    };
  }

  // ── override the bare viewInvoice (loaded after the bundle ⇒ this wins, Rule 1) ──
  // Merge the raw DB row (_realInvoices — carries issue_date and, once Phase 2 lands, line_items)
  // UNDER the mapped display record (userInvoices — client/amount/status/notes/due_date). Same
  // array order in every wiring path that sets both (postgres-wiring:150/167), so idx aligns.
  function install(){
    window.viewInvoice = function(idx){
      var mapped = (window.userInvoices || [])[idx];
      var raw    = (window._realInvoices || [])[idx];
      if (!mapped && !raw) return;
      var rec = Object.assign({}, raw || {}, mapped || {});
      // Object.assign lets `mapped` win, but mapped drops issue_date/line_items — restore from raw.
      if (rec.issue_date == null && raw && raw.issue_date != null) rec.issue_date = raw.issue_date;
      if (rec.line_items == null && raw && raw.line_items != null) rec.line_items = raw.line_items;
      openDoc(invoiceToDoc(rec), 'invoice');
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
