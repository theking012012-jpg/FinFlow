const fs=require('fs'),path=require('path');const {parse}=require('node-html-parser');
const F=path.join(__dirname,'..','public','_gen','index.html');
let html=fs.readFileSync(F,'utf8');const root=parse(html,{comment:true});
let n=0;
for(const el of root.querySelectorAll('.page')){
  const id=el.getAttribute('id')||'';if(!id||el.classList.contains('active'))continue;
  const cls=el.getAttribute('class')||'page';const inner=el.innerHTML;
  el.replaceWith(parse(`<div class="${cls}" id="${id}" data-lz="1"></div><template data-lz="${id}">${inner}</template>`));n++;
}
const hook=`<script>(function(){function H(id){try{var p=document.getElementById(id);if(!p||!p.hasAttribute('data-lz'))return;var t=document.querySelector('template[data-lz="'+id+'"]');if(t){p.appendChild(t.content.cloneNode(true));p.removeAttribute('data-lz');}}catch(e){}}window.__lzHydrate=H;function w(){if(typeof window.showPage!=='function')return false;var o=window.showPage;window.showPage=function(id){try{H('page-'+id);H(id);}catch(e){}return o.apply(this,arguments);};return true;}if(!w()){var i=setInterval(function(){if(w())clearInterval(i);},25);setTimeout(function(){clearInterval(i);},8000);}})();</script>`;
let outHtml=root.toString();
if(outHtml.indexOf('__lzHydrate')===-1){
  if(outHtml.indexOf('</body>')!==-1){outHtml=outHtml.replace('</body>',hook+'</body>');}
  else if(outHtml.indexOf('</html>')!==-1){outHtml=outHtml.replace('</html>',hook+'</html>');}
  else{outHtml=outHtml+hook;}
}
fs.writeFileSync(F,outHtml,'utf8');
if(outHtml.indexOf('__lzHydrate')===-1){console.error('[lazy] FATAL: hook not injected');process.exit(1);}
console.log('[lazy] wrapped '+n+' screens; hook injected OK');
