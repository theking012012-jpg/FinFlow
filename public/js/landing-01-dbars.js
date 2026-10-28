// Moved out of landing.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
window.addEventListener('scroll',()=>{
  document.getElementById('nav').classList.toggle('scrolled',window.scrollY>40);
});
const dbars=document.getElementById('dbars');
if(dbars){
  const rev=[68,74,72,81,85,79,88,92,84,95,96,102];
  const exp=[42,45,44,48,50,47,52,55,51,58,57,62];
  const mx=Math.max(...rev);
  dbars.innerHTML=rev.map((r,i)=>`<div class="d-bar-group"><div class="d-bar-r" data-h="${Math.round(r/mx*74)}" data-style="background:var(--acc);opacity:.8"></div><div class="d-bar-e" data-h="${Math.round(exp[i]/mx*74)}" data-style="background:var(--bg3);border:1px solid var(--bd)"></div></div>`).join('');
  setTimeout(()=>dbars.querySelectorAll('[data-h]').forEach(b=>b.style.height=b.dataset.h+'px'),500);
}
const obs=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible');});},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));
setTimeout(()=>{
  const t=document.getElementById('t-typing'),a=document.getElementById('t-answer');
  if(t)t.style.display='flex';
  setTimeout(()=>{if(t)t.style.display='none';if(a)a.style.display='block';},2400);
},3500);
