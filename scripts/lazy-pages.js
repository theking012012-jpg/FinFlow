const fs=require('fs'),path=require('path');const {parse}=require('node-html-parser');
// L21 (Phase 1.3): render code written for the full page (document.getElementById(id).textContent = …) runs at
// boot, before a lazy screen is opened — its elements were still inside a <template>, so getElementById returned
// null and the render threw, aborting the CALLER too (refreshFinancials, syncAllPayrollsToPersonal, loadEntityData).
// The hook below makes the lazy layer transparent: a getElementById miss for an id that lives in a not-yet-hydrated
// screen hydrates THAT screen and returns the element (id→screen map built once on the first miss). Only screens a
// boot render actually writes to are hydrated early; the rest stay lazy.
const F=path.join(__dirname,'..','public','_gen','index.html');
let html=fs.readFileSync(F,'utf8');const root=parse(html,{comment:true});
let n=0;
for(const el of root.querySelectorAll('.page')){
  const id=el.getAttribute('id')||'';if(!id||el.classList.contains('active'))continue;
  const cls=el.getAttribute('class')||'page';const inner=el.innerHTML;
  el.replaceWith(parse(`<div class="${cls}" id="${id}" data-lz="1"></div><template data-lz="${id}">${inner}</template>`));n++;
}
const hook=`<script>(function(){function H(id){try{var p=document.getElementById(id);if(!p||!p.hasAttribute('data-lz'))return;var t=document.querySelector('template[data-lz="'+id+'"]');if(t){p.appendChild(t.content.cloneNode(true));p.removeAttribute('data-lz');}}catch(e){}}window.__lzHydrate=H;var G=Document.prototype.getElementById,M=null;Document.prototype.getElementById=function(id){var el=G.call(this,id);if(el||this!==document)return el;try{if(!M){M={};var ts=document.querySelectorAll('template[data-lz]');for(var i=0;i<ts.length;i++){var pid=ts[i].getAttribute('data-lz'),ns=ts[i].content.querySelectorAll('[id]');for(var j=0;j<ns.length;j++)if(!M[ns[j].id])M[ns[j].id]=pid;}}var pg=M[id];if(pg){H(pg);for(var k in M)if(M[k]===pg)delete M[k];return G.call(this,id);}}catch(e){}return null;};function w(){if(typeof window.showPage!=='function')return false;var o=window.showPage;window.showPage=function(id){try{H('page-'+id);H(id);}catch(e){}return o.apply(this,arguments);};return true;}if(!w()){var i=setInterval(function(){if(w())clearInterval(i);},25);setTimeout(function(){clearInterval(i);},8000);}})();</script>`;
let outHtml=root.toString();
if(outHtml.indexOf('__lzHydrate')===-1){
  if(outHtml.indexOf('</body>')!==-1){outHtml=outHtml.replace('</body>',hook+'</body>');}
  else if(outHtml.indexOf('</html>')!==-1){outHtml=outHtml.replace('</html>',hook+'</html>');}
  else{outHtml=outHtml+hook;}
}
fs.writeFileSync(F,outHtml,'utf8');
if(outHtml.indexOf('__lzHydrate')===-1){console.error('[lazy] FATAL: hook not injected');process.exit(1);}
console.log('[lazy] wrapped '+n+' screens; hook injected OK');
