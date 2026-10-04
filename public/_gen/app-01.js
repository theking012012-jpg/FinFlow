
// Keep the mobile drawer's theme/currency controls in sync with the canonical #s-dark/#s-currency
// state (the source of truth toggleTheme()/updateCurrency() maintain). Read from the DOM so it works
// across script boundaries; called each time the drawer opens.
window._syncMobileControls=function(){
  var d=document.getElementById('s-dark');  var dark = d ? !!d.checked : true;
  var lbl=document.getElementById('smc-theme-label'); if(lbl) lbl.textContent = dark ? '☀ Light' : '☾ Dark';
  var c=document.getElementById('smc-currency'), s=document.getElementById('s-currency');
  if(c && s && s.value) c.value = s.value;
};
function openSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
  document.body.classList.add('sidebar-open');   // Mobile fix: hides the bottom nav + FAB while the drawer is open
  document.body.style.overflow='hidden';
  if(typeof _syncMobileControls==='function') _syncMobileControls();   // reflect current theme/currency on open
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  document.body.classList.remove('sidebar-open');
  document.body.style.overflow='';
}
// Close on ESC
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeSidebar();});
// Close on resize to desktop
window.addEventListener('resize',function(){if(window.innerWidth>768)closeSidebar();});
