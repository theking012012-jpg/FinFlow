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
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function money(n, cur){ var v = (parseFloat(n) || 0); return sym(cur) + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function $(id){ return document.getElementById(id); }
  function val(id){ var el = $(id); return el && el.value != null ? String(el.value).trim() : ''; }

  // FA-B1 part 2: the business's document style (Templates page) — its design, accent colour and the FinFlow footer line.
  // It used to be a fixed design and colour: the Templates page changed a preview only.
  function docStyle(ds){
    ds = ds || {};
    return { template: ['classic', 'minimal', 'compact'].indexOf(ds.template) >= 0 ? ds.template : 'classic',
             accent: /^#[0-9a-fA-F]{6}$/.test(String(ds.accent || '')) ? ds.accent : '#c9a84c', poweredBy: ds.powered_by !== false };
  }
  window.FinFlowDocStyle = docStyle;

  // ── letterhead + currency, from what the app already has loaded ──
  function letterhead(){
    var e = null;
    try { e = (window.ENTITIES || []).find(function(x){ return x.active; }) || (window.ENTITIES || [])[0] || null; } catch(_){}
    // F196 Tier 2: a document is issued BY the active ENTITY, so the entity's OWN profile wins for
    // EVERY letterhead field — not just the name (Tier 1). The account-wide settings inputs
    // (`s-*`, ONE row per account) remain the FALLBACK, so an entity with no profile set renders
    // exactly what it rendered before: no migration, no behaviour change for single-entity accounts.
    var p = (e && e.profile) || {};
    return {
      name:   p.business_name || (e && e.name) || val('s-biz-name') || 'Your Business',
      address:p.address || val('s-address'),
      email:  p.email   || val('s-biz-email') || val('s-email'),
      phone:  p.phone   || val('s-biz-phone') || val('s-phone') || val('nb-phone'),
      taxId:  p.tax_id  || val('s-tax-id') || val('nb-tax-id'),
      website:p.website || val('s-website') || val('nb-website'),
      // NOTE: no UI writes a logo yet (neither the entity profile nor _invoiceLogoDataURL /
      // _companyLogo, which are read here but set nowhere). The entity field is accepted and
      // validated server-side; wiring an upload is a separate piece of work — see AUDIT_MASTER F196.
      logo:   p.logo || window._invoiceLogoDataURL || window._companyLogo || null,
      currency: (e && e.currency) || 'USD',
      style:  docStyle(e && e.doc_style),   // (FA-B5b: the printed terms come from each document's own dates — docTerms)
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
  // FA-B5b: a document's terms are its own — the days from its issue date to its due date (calendar arithmetic, no
  // timezone). The printed "Terms" line used the BUSINESS setting, so an invoice given its own due date (10 days) printed
  // "Net 30" beside "Due" 10 days out. null = no due date (nothing printed).
  function docTerms(doc) {
    var ymd = function (v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
    var i = ymd(doc && doc.issue_date), d = ymd(doc && doc.due_date);
    if (i == null || d == null || d < i) return null;
    return Math.round((d - i) / 86400000);
  }
  window._ffDocTerms = docTerms;
  // doc: { number, party, party_address, issue_date, due_date, status, notes, amount, tax, line_items:[{desc,qty,rate}], currency }
  function buildDocumentHTML(doc, kind, styleOverride){
    doc = doc || {};
    var K = KIND[kind] || KIND.invoice;
    var L = letterhead();
    var cur = doc.currency || L.currency || 'USD';
    var S = styleOverride ? docStyle(Object.assign({}, { template: L.style.template, accent: L.style.accent, powered_by: L.style.poweredBy }, styleOverride)) : L.style;   // a preview may pass unsaved choices
    var acc = S.accent;

    var items = Array.isArray(doc.line_items) && doc.line_items.length ? doc.line_items : null;
    var rowsHTML, subtotal;
    if (items){
      subtotal = items.reduce(function(s,i){ return s + (parseFloat(i.qty)||0) * (parseFloat(i.rate)||0); }, 0);
      rowsHTML = items.map(function(i, n){
        var lineTotal = (parseFloat(i.qty)||0) * (parseFloat(i.rate)||0);
        return '<tr>'
          + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;color:#555;width:28px">'+(n+1)+'</td>'
          + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;color:#222">'+esc(i.desc || '—')+'</td>'
          + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;text-align:center;color:#666">'+(parseFloat(i.qty)||0)+'</td>'
          + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#666">'+money(i.rate, cur)+'</td>'
          + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#222;font-weight:600">'+money(lineTotal, cur)+'</td>'
          + '</tr>';
      }).join('');
    } else {
      // no line items — a single summary row from the record's own amount + description/notes
      subtotal = parseFloat(doc.amount) || 0;
      rowsHTML = '<tr>'
        + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;color:#555;width:28px">1</td>'
        + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;color:#222">'+esc(doc.notes || doc.description || (K.title.charAt(0) + K.title.slice(1).toLowerCase()))+'</td>'
        + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;text-align:center;color:#666">1</td>'
        + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#666">'+money(subtotal, cur)+'</td>'
        + '<td data-style="padding:11px 8px;border-bottom:1px solid #eee;text-align:right;color:#222;font-weight:600">'+money(subtotal, cur)+'</td>'
        + '</tr>';
    }
    var tax = parseFloat(doc.tax) || 0;
    var total = subtotal + tax;
    // Balance actually OWED nets any payment already made — a fully-paid invoice/bill must show 0, not its
    // full total. `amount_paid` is passed by the invoice/bill viewers; status 'paid' forces 0 as a fallback.
    var _paid = parseFloat(doc.amount_paid) || 0;
    var balanceOwed = ((doc.status || '').toLowerCase() === 'paid') ? 0 : Math.max(0, total - _paid);
    var _isOwed = (K.balanceLabel === 'Balance Due' || K.balanceLabel === 'Amount Due');
    var _balanceVal = _isOwed ? balanceOwed : total;
    // FA-M3: what was already paid is ON the document (the customer sees why the balance is lower than the total).
    var _paidShown = _isOwed ? Math.min(total, ((doc.status || '').toLowerCase() === 'paid') ? total : _paid) : 0;
    // FA-M6b: a credit note / vendor credit applied to it is shown as what it is — not as a payment received.
    var _creditShown = Math.min(_paidShown, parseFloat(doc.credit_applied) || 0);
    _paidShown = _paidShown - _creditShown;
    var _settledShown = _paidShown + _creditShown;

    var logoHTML = L.logo
      ? '<img src="'+esc(L.logo)+'" data-style="max-height:52px;max-width:180px;object-fit:contain" alt="">'
      : '<div data-style="font-size:22px;font-weight:700;color:'+acc+';font-family:Georgia,serif;font-style:italic">'+esc(L.name)+'</div>';

    var statusBadge = doc.status
      ? '<span data-style="display:inline-block;margin-top:8px;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:'+statusColor(doc.status)+'">'+esc(doc.status)+'</span>'
      : '';

    var partyBlock = '<div data-style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:6px">'+K.party+'</div>'
      + '<div data-style="font-size:14px;font-weight:600;color:#1a1a1a">'+esc(doc.party || '—')+'</div>'
      + (doc.party_address ? '<div data-style="font-size:12px;color:#666;margin-top:3px;white-space:pre-line">'+esc(doc.party_address)+'</div>' : '');

    var lhLines = [L.address, L.phone, L.email, (L.taxId ? 'Tax ID: ' + L.taxId : '')].filter(Boolean)
      .map(function(x){ return '<div data-style="font-size:12px;color:#666;line-height:1.55">'+esc(x)+'</div>'; }).join('');

    var totalsHTML =
        '<div data-style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#555"><span>Subtotal</span><span>'+money(subtotal, cur)+'</span></div>'
      + (tax ? '<div data-style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#555"><span>Tax</span><span>'+money(tax, cur)+'</span></div>' : '')
      + (_settledShown > 0.005
          ? '<div data-style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#222;font-weight:600"><span>Total</span><span>'+money(total, cur)+'</span></div>'
          + (_paidShown > 0.005 ? '<div data-style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#1a7f4b"><span>'+(kind === 'bill' ? 'Paid' : 'Payments received')+'</span><span>&minus;'+money(_paidShown, cur)+'</span></div>' : '')
          + (_creditShown > 0.005 ? '<div data-style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#1a7f4b"><span>'+(kind === 'bill' ? 'Vendor credit applied' : 'Credit note applied')+'</span><span>&minus;'+money(_creditShown, cur)+'</span></div>' : '')
          : '')
      + '<div data-style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:6px;border-top:2px solid #222;font-size:15px;font-weight:700;color:#111"><span>'+K.balanceLabel+'</span><span>'+money(_balanceVal, cur)+'</span></div>';

    var footer = S.poweredBy ? '<div data-style="text-align:center;margin-top:34px;padding-top:16px;border-top:1px solid #eee"><span data-style="font-size:10px;color:#bbb;letter-spacing:.08em">POWERED BY </span><span data-style="font-size:10px;font-weight:700;color:'+acc+';letter-spacing:.06em;font-family:Georgia,serif;font-style:italic">FinFlow</span></div>' : '';
    var dates = (doc.issue_date ? '<div><span data-style="color:#999">Date:</span> '+dlabel(doc.issue_date)+'</div>' : '') + (doc.due_date ? '<div><span data-style="color:#999">Due:</span> '+dlabel(doc.due_date)+'</div>' : '')
      + ((kind === 'invoice' || !kind) && docTerms(doc) != null ? '<div><span data-style="color:#999">Terms:</span> '+(docTerms(doc) ? 'Net '+docTerms(doc)+' — due within '+docTerms(doc)+' days' : 'Due on receipt')+'</div>' : '');   // FA-B1 part 2 / FA-B5b: THIS invoice's terms (its own dates), never the business default beside a different due date
    if (S.template === 'compact') {   // a narrow receipt-style page
      var crow = function(a, b, st){ return '<div data-style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed #ddd;'+(st||'')+'"><span>'+a+'</span><span>'+b+'</span></div>'; };
      var lines = items ? items.map(function(i){ return crow(esc(i.desc || '—') + ' × ' + (parseFloat(i.qty)||0), money((parseFloat(i.qty)||0) * (parseFloat(i.rate)||0), cur)); }).join('') : crow(esc(doc.notes || doc.description || K.title), money(subtotal, cur));
      return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><template data-ff-css>*{box-sizing:border-box;margin:0;padding:0}body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#fff;color:#222;padding:28px 22px;max-width:460px;margin:0 auto;font-size:12.5px}@media print{body{padding:0}}</template></head><body>'
        + '<div data-style="text-align:center;border-bottom:2px dashed #ccc;padding-bottom:12px;margin-bottom:12px">'+logoHTML+'<div data-style="margin-top:6px;font-size:11px;color:#777">'+[L.address, L.email, L.phone].filter(Boolean).map(esc).join(' · ')+'</div>'
        + '<div data-style="margin-top:10px;font-weight:700;letter-spacing:.06em;color:'+acc+'">'+K.title+(doc.number ? ' #'+esc(doc.number) : '')+'</div><div data-style="font-size:11px;color:#777">'+esc(doc.party || '')+(doc.issue_date ? ' · '+dlabel(doc.issue_date) : '')+(doc.due_date ? ' · due '+dlabel(doc.due_date) : '')+'</div>'+statusBadge+'</div>'
        + lines + crow('Subtotal', money(subtotal, cur), 'color:#777') + (tax ? crow('Tax', money(tax, cur), 'color:#777') : '')
        + (_settledShown > 0.005 ? crow('Total', money(total, cur)) + (_paidShown > 0.005 ? crow(kind === 'bill' ? 'Paid' : 'Payments received', '&minus;'+money(_paidShown, cur), 'color:#1a7f4b') : '') + (_creditShown > 0.005 ? crow(kind === 'bill' ? 'Vendor credit applied' : 'Credit note applied', '&minus;'+money(_creditShown, cur), 'color:#1a7f4b') : '') : '')
        + '<div data-style="display:flex;justify-content:space-between;padding-top:8px;margin-top:4px;border-top:2px dashed #ccc;font-size:15px;font-weight:700"><span>'+K.balanceLabel+'</span><span data-style="color:'+acc+'">'+money(_balanceVal, cur)+'</span></div>'
        + (doc.notes && items ? '<div data-style="margin-top:14px;font-size:11.5px;color:#666">'+esc(doc.notes)+'</div>' : '')
        + footer + '</body></html>';
    }
    var minimal = S.template === 'minimal';
    var header = minimal
      ? '<div data-style="background:'+acc+';margin:-44px -40px 26px;padding:26px 40px;display:flex;justify-content:space-between;align-items:center;gap:20px"><div>'+(L.logo ? logoHTML : '<div data-style="font-size:22px;font-weight:800;color:#fff">'+esc(L.name)+'</div>')+'</div>'
        + '<div data-style="text-align:right;color:#fff"><div data-style="font-size:26px;font-weight:800;letter-spacing:-.01em">'+K.title+'</div>'+(doc.number ? '<div data-style="font-size:12px;opacity:.85">#'+esc(doc.number)+'</div>' : '')+statusBadge+'</div></div>'
      : '<div data-style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">'
        +   '<div>'+logoHTML+'</div>'
        +   '<div data-style="text-align:right">'
        +     '<div data-style="font-size:30px;font-weight:800;letter-spacing:.04em;color:'+acc+';font-family:Georgia,serif">'+K.title+'</div>'
        +     (doc.number ? '<div data-style="font-size:12px;color:#888;margin-top:2px">#'+esc(doc.number)+'</div>' : '')
        +     statusBadge
        +   '</div>'
        + '</div>'
        + '<div data-style="height:1px;background:#eee;margin:22px 0"></div>';
    var thead = minimal ? '<tr data-style="border-bottom:2px solid '+acc+';color:#666">' : '<tr data-style="background:#2a2a2a;color:#fff">';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<template data-ff-css>*{box-sizing:border-box;margin:0;padding:0}'
      + 'body{font-family:'+(minimal ? 'Arial,Helvetica,sans-serif' : '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif')+';background:#fff;color:#222;padding:44px 40px;max-width:760px;margin:0 auto}'
      + 'table{width:100%;border-collapse:collapse}'
      + '@media print{body{padding:0}}</template></head><body>'
      + header
      + '<div data-style="display:flex;justify-content:space-between;gap:24px">'
      +   '<div data-style="max-width:52%">'
      +     '<div data-style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:4px">'+esc(L.name)+'</div>'+lhLines
      +   '</div>'
      +   '<div data-style="text-align:right;font-size:12px;color:#555;line-height:1.9">'+dates+'</div>'
      + '</div>'
      + '<div data-style="margin:26px 0 18px">'+partyBlock+'</div>'
      + '<table><thead>'+thead
      +   '<th data-style="padding:10px 8px;text-align:left;font-size:11px;letter-spacing:.05em;width:28px">#</th>'
      +   '<th data-style="padding:10px 8px;text-align:left;font-size:11px;letter-spacing:.05em">Item &amp; Description</th>'
      +   '<th data-style="padding:10px 8px;text-align:center;font-size:11px;letter-spacing:.05em">Qty</th>'
      +   '<th data-style="padding:10px 8px;text-align:right;font-size:11px;letter-spacing:.05em">Rate</th>'
      +   '<th data-style="padding:10px 8px;text-align:right;font-size:11px;letter-spacing:.05em">Amount</th>'
      + '</tr></thead><tbody>'+rowsHTML+'</tbody></table>'
      + '<div data-style="display:flex;justify-content:flex-end;margin-top:20px"><div data-style="width:260px">'+totalsHTML+'</div></div>'
      + (doc.notes && items ? '<div data-style="margin-top:28px;padding-top:14px;border-top:1px solid #eee"><div data-style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:5px">Notes</div><div data-style="font-size:12.5px;color:#555;line-height:1.6">'+esc(doc.notes)+'</div></div>' : '')
      + footer
      + '</body></html>';
  }
  window.buildDocumentHTML = buildDocumentHTML;

  // ── the overlay: the document in an isolated iframe + a toolbar (Print / Download / Close) ──
  function overlay(){
    var o = $('ff-docview'); if (o) return o;
    o = document.createElement('div');
    o.id = 'ff-docview';
    o.style.cssText = 'position:fixed;inset:0;z-index:9600;display:none;align-items:flex-start;justify-content:center;background:rgba(10,8,5,.62);padding:28px 16px;overflow:auto';
    o.innerHTML =
        '<div data-style="width:100%;max-width:820px">'
      +   '<div data-style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:10px">'
      +     '<button id="ff-docview-print" data-style="font-family:var(--font,inherit);font-size:12.5px;font-weight:600;padding:8px 15px;border-radius:7px;border:1px solid var(--acc2,#8a6d1f);background:linear-gradient(135deg,var(--acc,#c9a84c),var(--acc2,#8a6d1f));color:#1a1305;cursor:pointer">Print / PDF ↧</button>'
      +     '<button id="ff-docview-close" data-style="font-family:var(--font,inherit);font-size:12.5px;padding:8px 15px;border-radius:7px;border:1px solid var(--bd,#3a3128);background:var(--bg2,#221c14);color:var(--t1,#e8dcc4);cursor:pointer">Close ✕</button>'
      +   '</div>'
      +   '<iframe id="ff-docview-frame" title="Document" data-style="width:100%;height:78vh;border:none;border-radius:10px;background:#fff;box-shadow:0 18px 60px rgba(0,0,0,.5)"></iframe>'
      // Batch 7: the document's change history — OUTSIDE the frame, so it never prints or reaches a customer's PDF.
      +   '<div id="ff-docview-history" data-style="display:none;margin-top:10px;background:var(--bg1,#1a160f);border:1px solid var(--bd,#3a3128);border-radius:10px;padding:10px 14px;color:var(--t2,#cfc3ab);font-size:12px;line-height:1.7"></div>'
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
    var _h = $('ff-docview-history'); if (_h) { _h.style.display = 'none'; _h.innerHTML = ''; }   // a previous document's history never lingers
    var frame = $('ff-docview-frame');
    try { window.ffFrameWrite(frame, buildDocumentHTML(doc, kind)); } catch(e){ console.warn('[docview]', e && e.message); return; }
    o.style.display = 'flex';
  }
  window.ffOpenDocView = openDoc;

  // ── F90 part 2: the record's History — what changed, who, when, how — on every record, in plain words ──────────────
  // Read from the audit trail (the database records every change in the same transaction as the change, F90 part 1),
  // as the server pairs it: one action = one event (a route's named event + the row changes it made). Owner / admin only
  // (audit:read); anyone else simply gets no panel. Never printed: it sits OUTSIDE the document frame.
  var H_LABEL = { amount: 'Amount', client: 'Customer', customer: 'Customer', vendor: 'Vendor', issue_date: 'Issued', due_date: 'Due',
    expiry_date: 'Expires', status: 'Status', notes: 'Notes', memo: 'Memo', number: 'Number', num: 'Number', ref: 'Reference',
    amount_paid: 'Paid', payment_date: 'Paid on', paid_date: 'Paid on', date: 'Date', expense_date: 'Date', description: 'Description',
    category: 'Category', method: 'Method', reference: 'Reference', line_items: 'Line items', tax: 'Tax', currency: 'Currency',
    total_gross: 'Gross', total_net: 'Net pay', total_deductions: 'Deductions', period: 'Period', run_date: 'Run on', name: 'Name',
    email: 'Email', role: 'Role', units: 'Units', unit_cost: 'Unit cost', cost: 'Cost', price: 'Price', budget: 'Budget', billed: 'Billed',
    hours: 'Hours', employee: 'Employee', frequency: 'Frequency', next_run: 'Next run', end_date: 'Ends', deductible: 'Deductible',
    invoice_id: 'Invoice', bill_id: 'Bill', credit_applied: 'Credit applied', class: 'Class', location: 'Location', quantity: 'Quantity',
    lock_date: 'Locked up to', enabled: 'On', fiscal_year: 'Fiscal year', timezone: 'Time zone', country: 'Country', access_level: 'Access',
    entity_access: 'Businesses', from_currency: 'From', to_currency: 'To', rate: 'Rate', rate_date: 'Rate date' };
  var H_SKIP = { id: 1, user_id: 1, entity_id: 1, created_at: 1, updated_at: 1, idempotency_key: 1, customer_id: 1, vendor_id: 1, _dbId: 1,
    last_restock_qty: 1, last_restock_at: 1, row_ids: 1 };
  var H_MONEY = /^(amount|amount_paid|total|subtotal|tax|price|cost|unit_cost|gross|net|total_gross|total_net|total_deductions|budget|billed|balance|credit_applied|fee|net_pay|bonus|overtime|foreign_amount|base_amount)$/;
  var H_VERB = { CREATE: 'created', UPDATE: 'edited', DELETE: 'deleted', APPROVE: 'approved', MARK_PAID: 'marked paid', VOID: 'voided',
    REFUND: 'refunded', UNDO: 'undone', INVITE: 'invited', ACCEPT: 'accepted the invitation', PAY_IN_ADVANCE: 'paid in advance',
    REMIT_WITHHOLDINGS: 'remitted the withholdings', RECALC: 'updated from payments', LOCK: 'locked', UNLOCK: 'unlocked',
    CLIENT_REVOKE: 'revoked the accountant’s access', ACCESS_REQUESTED: 'asked an accountant for access', CLIENT_ACTIVATE: 'activated',
    EMAIL_TEST_SENT: 'sent a test email' };
  function hLabel(k){ return H_LABEL[k] || String(k).replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); }); }
  function hVal(k, v){
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return k === 'line_items' ? v.length + (v.length === 1 ? ' line' : ' lines') : v.length + (v.length === 1 ? ' item' : ' items');
    if (typeof v === 'object') { var j = JSON.stringify(v); return j.length > 60 ? j.slice(0, 57) + '…' : j; }
    if (H_MONEY.test(k) && v !== '' && isFinite(Number(v))) return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v)) && (/(date|_on|^due|^next_run|^period_)/.test(k) || String(v).length === 10)) return dlabel(v);
    if (v === true || v === 1 && /^(enabled|deductible)$/.test(k)) return 'yes';
    if (v === false || v === 0 && /^(enabled|deductible)$/.test(k)) return 'no';
    return String(v).slice(0, 80);
  }
  function hSame(k, a, b){ return hVal(k, a) === hVal(k, b); }
  function hVerb(a){ a = String(a || '').toUpperCase(); return H_VERB[a] || a.toLowerCase().replace(/_/g, ' '); }
  function hVia(src){
    src = String(src || '');
    if (/^api_key:/.test(src)) return 'via an API key';
    if (/^job:recurring/.test(src)) return 'automatically — recurring schedule';
    if (/^job:/.test(src)) return 'automatically';
    if (/^webhook/.test(src)) return 'from a payment provider';
    if (/^tool:/.test(src)) return 'by a FinFlow maintenance tool';
    if (src === 'database') return 'directly in the database, outside the app';
    return '';
  }
  // A genuine instant is shown in the BUSINESS's time zone (books have a zone, viewers don't — CLAUDE.md Rule 10).
  function hWhen(ts){
    var d = new Date(ts); if (isNaN(d)) return '';
    var ent = (window.ENTITIES || []).find(function (e) { return e && e.active; }) || {};
    var tz = ent.timezone || 'UTC';
    try {
      var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return p.day + ' ' + p.month + ' ' + p.year + ', ' + p.hour + ':' + p.minute;
    } catch (_) { return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  }
  function _obj(x){ if (!x) return {}; if (typeof x === 'string') { try { return JSON.parse(x) || {}; } catch (_) { return {}; } } return x; }
  function _flat(o){ o = _obj(o); var out = {}; Object.keys(o).forEach(function (k) {
    if (k === 'data' && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) Object.keys(o[k]).forEach(function (kk) { if (!(kk in out)) out[kk] = o[k][kk]; });
    else out[k] = o[k]; }); return out; }
  // One event → { head, details[] } in plain words.
  function hEvent(a){
    var who = a.actor_name || 'Someone', act = String(a.action || '').toUpperCase();
    var o = _flat(a.old_data), n = _flat(a.new_data), det = [];
    var keys = Array.isArray(a.changed_fields) && a.changed_fields.length ? a.changed_fields
      : Object.keys(Object.assign({}, o, n));
    var row = String(a.row_action || act).toUpperCase();
    if (row === 'CREATE' || row === 'DELETE') {
      var src = row === 'CREATE' ? n : o;
      ['amount', 'client', 'customer', 'vendor', 'name', 'description', 'issue_date', 'date', 'expense_date', 'payment_date', 'due_date', 'status', 'period', 'role', 'email']
        .forEach(function (k) { if (src[k] != null && src[k] !== '') det.push(hLabel(k) + ' ' + hVal(k, src[k])); });
    } else {
      keys.forEach(function (k) {
        if (H_SKIP[k]) return;
        if (k === 'targets' && (o[k] || n[k])) {   // a budget: one line per target
          var ot = o[k] || {}, nt = n[k] || {};
          Object.keys(Object.assign({}, ot, nt)).forEach(function (t) { if (!hSame('amount', ot[t], nt[t])) det.push(t + ' ' + hVal('amount', ot[t]) + ' → ' + hVal('amount', nt[t]) + ' per year'); });
          return;
        }
        if (!hSame(k, o[k], n[k])) det.push(hLabel(k) + ' ' + hVal(k, o[k]) + ' → ' + hVal(k, n[k]));
      });
      if (!det.length && a.field_name) det.push(hLabel(a.field_name) + ' ' + String(a.old_value || '—') + ' → ' + String(a.new_value || '—'));
    }
    var via = hVia(a.source);
    return { head: hWhen(a.changed_at || a.created_at) + ' · ' + who + ' ' + hVerb(act) + (via ? ' (' + via + ')' : ''), details: det.slice(0, 12) };
  }
  window.ffHistoryEvent = hEvent;   // test surface
  async function hRows(table, id){
    var r = await fetch('/api/audit-trail?table=' + encodeURIComponent(table) + '&record_id=' + encodeURIComponent(id), { credentials: 'include' });
    if (!r.ok) return null;   // no audit access → no panel (never an error on someone's screen)
    var rows = await r.json(); return Array.isArray(rows) ? rows : null;
  }
  function hHTML(rows){
    return rows.map(function (a) {
      var e = hEvent(a);
      return '<div data-style="padding:6px 0;border-top:1px solid var(--bd,#3a3128)">'
        + '<div data-style="color:var(--t1,#e8dcc4)">' + esc(e.head) + '</div>'
        + (e.details.length ? '<div data-style="color:var(--t2,#b8aa8e);font-size:11.5px;margin-top:2px">' + e.details.map(esc).join(' · ') + '</div>' : '')
        + '</div>';
    }).join('');
  }
  // In the document viewer (invoices, bills, quotes, receipts, credit notes, vendor credits, payments)
  window.ffDocHistory = async function (table, id) {
    var panel = $('ff-docview-history'); if (!panel || id == null) return;
    try {
      var rows = await hRows(table, id); if (!rows || !rows.length) return;
      panel.innerHTML = '<div data-style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3,#8a7d66);margin-bottom:4px">History · not printed</div>' + hHTML(rows);
      panel.style.display = 'block';
    } catch (_) { /* history is a convenience — never blocks the document */ }
  };
  // For records with no document (expenses, payroll runs, journals, …): a History window of its own
  window.ffRecordHistory = async function (table, id, title) {
    var o = $('ff-history'); if (!o) {
      o = document.createElement('div'); o.id = 'ff-history';
      o.style.cssText = 'position:fixed;inset:0;z-index:9650;display:none;align-items:flex-start;justify-content:center;background:rgba(10,8,5,.62);padding:48px 16px;overflow:auto';
      o.innerHTML = '<div data-style="width:100%;max-width:640px;background:var(--bg1,#1a160f);border:1px solid var(--bd,#3a3128);border-radius:12px;padding:16px 18px;color:var(--t2,#c9bca2);font-size:12.5px">'
        + '<div data-style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div id="ff-history-title" data-style="font-weight:600;color:var(--t1,#e8dcc4)"></div>'
        + '<button id="ff-history-close" type="button" class="btn btn-ghost btn-sm">Close</button></div><div id="ff-history-body"></div></div>';
      document.body.appendChild(o);
      o.addEventListener('click', function (ev) { if (ev.target === o) o.style.display = 'none'; });
      $('ff-history-close').onclick = function () { o.style.display = 'none'; };
    }
    $('ff-history-title').textContent = 'History — ' + (title || 'record');
    var body = $('ff-history-body'); body.innerHTML = '<div data-style="color:var(--t3,#8a7d66)">Loading…</div>';
    o.style.display = 'flex';
    try {
      var rows = await hRows(table, id);
      if (rows == null) { body.innerHTML = '<div data-style="color:var(--t3,#8a7d66)">Only the owner and admins can see a record’s history.</div>'; return; }
      body.innerHTML = rows.length ? hHTML(rows) : '<div data-style="color:var(--t3,#8a7d66)">No changes recorded yet.</div>';
    } catch (_) { body.innerHTML = '<div data-style="color:var(--red,#c0392b)">Couldn’t load the history — close this and try again.</div>'; }
  };

  // ── map a client-side invoice record → the renderer's shape ──
  function invoiceToDoc(inv){
    return {
      number: inv.number || inv.num || '',   // B1b: the real number; it used to fabricate "INV-" + (1000 + id) on a customer-facing document
      party: inv.client || inv.customer || '—',
      party_address: inv.client_address || inv.bill_to || '',
      issue_date: inv.issue_date || inv.date || null,
      due_date: inv.due_date || null,
      status: inv.status || '',
      notes: inv.notes || '',
      amount: inv.amount,
      amount_paid: inv.amount_paid,   // FA-M3: Balance Due nets what was received (it printed the full total)
      credit_applied: inv.credit_applied || 0,   // FA-M6b: shown as a credit, not a payment
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
      if (window.ffDocHistory) window.ffDocHistory('invoices', rec._dbId != null ? rec._dbId : rec.id);   // batch 7: what changed
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
