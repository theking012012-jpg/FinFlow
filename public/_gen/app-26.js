
/* ── GOOGLE SHEETS CONNECTOR (self-contained) ──────────────────────────────────
   Renders a ready-to-paste Google Apps Script (base URL auto-filled) that pulls the
   read-only /api/v1 data into the user's sheet with a FinFlow menu. Rides on the
   public API + the user's own key — no FinFlow-side OAuth. */
(function(){
  function appsScript(base){
    var L = [
      "/** FinFlow → Google Sheets sync. Paste into Extensions → Apps Script. */",
      "var FINFLOW_BASE = '" + base + "';",
      "var API_KEY = 'PASTE_YOUR_FINFLOW_KEY';  // from FinFlow → API",
      "",
      "function finflowSync() {",
      "  pull_('Invoices',  '/invoices?limit=200',  ['id','client','amount','amount_paid','status','issue_date','due_date','class','location']);",
      "  pull_('Expenses',  '/expenses?limit=200',  ['id','description','category','amount','deductible','expense_date','class','location']);",
      "  pull_('Customers', '/customers?limit=200', ['id','fname','lname','company','email','phone','status']);",
      "  summary_();",
      "  SpreadsheetApp.getActiveSpreadsheet().toast('FinFlow sync complete');",
      "}",
      "",
      "function headers_() { return { 'Authorization': 'Bearer ' + API_KEY }; }",
      "",
      "function pull_(tab, path, cols) {",
      "  var res = UrlFetchApp.fetch(FINFLOW_BASE + path, { headers: headers_(), muteHttpExceptions: true });",
      "  if (res.getResponseCode() !== 200) { throw new Error('FinFlow ' + tab + ': HTTP ' + res.getResponseCode() + ' — check your API key.'); }",
      "  var data = (JSON.parse(res.getContentText()).data) || [];",
      "  var rows = data.map(function(r){ return cols.map(function(c){ return r[c] == null ? '' : r[c]; }); });",
      "  writeTab_(tab, cols, rows);",
      "}",
      "",
      "function summary_() {",
      "  var res = UrlFetchApp.fetch(FINFLOW_BASE + '/reports/summary', { headers: headers_(), muteHttpExceptions: true });",
      "  if (res.getResponseCode() !== 200) return;",
      "  var s = JSON.parse(res.getContentText());",
      "  writeTab_('Summary', ['metric','value'], [['Revenue', s.revenue],['Expenses', s.expenses],['Net profit', s.net_profit],['Outstanding', s.outstanding]]);",
      "}",
      "",
      "function writeTab_(name, cols, rows) {",
      "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
      "  var sh = ss.getSheetByName(name) || ss.insertSheet(name);",
      "  sh.clearContents();",
      "  sh.getRange(1, 1, 1, cols.length).setValues([cols]);",
      "  if (rows.length) sh.getRange(2, 1, rows.length, cols.length).setValues(rows);",
      "}",
      "",
      "function onOpen() {",
      "  SpreadsheetApp.getUi().createMenu('FinFlow').addItem('Sync now', 'finflowSync').addToUi();",
      "}"
    ];
    return L.join('\n');
  }
  function renderSheets(){
    var pre=document.getElementById('gs-script'); if(!pre) return;
    var base=(window.location && window.location.origin ? window.location.origin : '') + '/api/v1';
    pre.textContent = appsScript(base);
  }
  window.ffCopySheetsScript=function(btn){
    var pre=document.getElementById('gs-script'); if(!pre) return;
    try{ navigator.clipboard.writeText(pre.textContent); if(btn){ btn.textContent='Copied'; setTimeout(function(){ btn.textContent='Copy script'; },1500); } }catch(e){}
  };
  function wrap(){ if(typeof window.showPage!=='function') return false; var o=window.showPage;
    window.showPage=function(id){ var r=o.apply(this,arguments); if(id==='api'){ try{ renderSheets(); }catch(e){} } return r; }; return true; }
  if(!wrap()){ var t=0,iv=setInterval(function(){ if(wrap()||++t>80) clearInterval(iv); },25); }
  setTimeout(function(){ try{ renderSheets(); }catch(e){} }, 1600);
})();
