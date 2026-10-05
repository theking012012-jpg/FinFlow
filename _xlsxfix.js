const fs=require('fs');
function edit(file, pairs){
  let s=fs.readFileSync(file,'utf8');
  const crlf=/\r\n/.test(s);
  let sN=s.replace(/\r\n/g,'\n');
  let n=0;
  for(const [a,b] of pairs){
    if(sN.indexOf(b)!==-1){ continue; }
    if(sN.indexOf(a)===-1){ console.error('MISS in '+file+': '+a.slice(0,50)); process.exit(1); }
    if(sN.split(a).length>2){ console.error('AMBIGUOUS in '+file+': '+a.slice(0,50)); process.exit(1); }
    sN=sN.split(a).join(b); n++;
  }
  fs.writeFileSync(file, crlf?sN.replace(/\n/g,'\r\n'):sN);
  return n;
}
const HELPERS = `// xlsx export — writes the SAME rows the CSV export builds as a real .xlsx, via lazy-loaded
// SheetJS (vendored at /vendor/xlsx.mini.min.js, same-origin). Loaded only on first xlsx export.
window._ffLoadXlsx = function(cb){
  if (window.XLSX) { cb(); return; }
  if (window._xlsxLoading) { (window._xlsxQ = window._xlsxQ || []).push(cb); return; }
  window._xlsxLoading = true; window._xlsxQ = [cb];
  var s = document.createElement('script');
  s.src = '/vendor/xlsx.mini.min.js';
  s.onload = function(){ (window._xlsxQ || []).forEach(function(fn){ try{ fn(); }catch(e){} }); window._xlsxQ = []; };
  s.onerror = function(){ window._xlsxLoading = false; if (typeof notify === 'function') notify('Could not load the spreadsheet exporter.', true); };
  document.head.appendChild(s);
};
window._ffExportXlsx = function(rows, filename){
  window._ffLoadXlsx(function(){
    try{
      var X = window.XLSX;
      var ws = X.utils.aoa_to_sheet(rows);
      var wb = X.utils.book_new();
      var base = String(filename || 'Sheet').replace('.csv', '') || 'Sheet';
      X.utils.book_append_sheet(wb, ws, base.slice(0, 31));
      var outName = String(filename || 'export.csv').replace('.csv', '.xlsx');
      X.writeFile(wb, outName);
      if (typeof notify === 'function') notify('Exported ' + outName);
    }catch(e){ if (typeof notify === 'function') notify('XLSX export failed: ' + (e && e.message || e), true); }
  });
};
window.exportAllCSV = function(format){`;
const n1 = edit('public/app-main.js', [
  ['window.exportAllCSV = function(){', HELPERS],
  ["if (rows.length <= 1) { notify('No data to export.', true); return; }",
   "if (rows.length <= 1) { notify('No data to export.', true); return; }\n  if (String(format) === 'xlsx') { return window._ffExportXlsx(rows, filename); }"]
]);
const CSVBTN = '<button class="btn btn-ghost" onclick="exportAllCSV()" title="Export all data as CSV backup" style="font-size:11.5px">\u2B07 CSV</button>';
const BOTHBTN = CSVBTN + '<button class="btn btn-ghost" onclick="exportAllCSV(\'xlsx\')" title="Export this page as an Excel .xlsx file" style="font-size:11.5px">&#11015; XLSX</button>';
const n2 = edit('public/index.html', [[CSVBTN, BOTHBTN]]);
console.log('app-main edits: '+n1+' (expect 2) | index edits: '+n2+' (expect 1)');
