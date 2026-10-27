// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
function loadChartJS(callback){
  if(typeof Chart!=='undefined'){try{if(Chart.defaults)Chart.defaults.animation=false;}catch(e){}callback();return;}
  if(window._chartJSLoading){(window._chartJSQueue=window._chartJSQueue||[]).push(callback);return;}
  window._chartJSLoading=true;
  window._chartJSQueue=[callback];
  const s=document.createElement('script');
  // Self-hosted (2026-08-23): Chart.js 4.4.1 is vendored at /public/vendor/chart.umd.js and served
  // same-origin, so charts render even when a CDN or a strict CSP blocks cdnjs. No crossOrigin needed.
  s.src='/vendor/chart.umd.js';
  s.onload=function(){try{if(window.Chart&&Chart.defaults)Chart.defaults.animation=false;}catch(e){}(window._chartJSQueue||[]).forEach(function(fn){try{fn();}catch(e){}});window._chartJSQueue=[];};
  s.onerror=function(){console.warn('Chart.js failed to load — charts will be skipped.');};
  document.head.appendChild(s);
}
