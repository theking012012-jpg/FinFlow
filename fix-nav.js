const fs = require('fs');
let c = fs.readFileSync('public/index.html', 'utf8');

const inject = `
<script>
window.toggleGroup=function(name){
  var grp=document.getElementById('nav-group-'+name);
  var arr=document.getElementById('arr-'+name);
  var hdr=document.getElementById('grp-'+name);
  if(!grp)return;
  var isOpen=grp.classList.contains('open');
  grp.classList.toggle('open');
  if(arr)arr.classList.toggle('open');
  if(hdr){hdr.classList.toggle('active');hdr.setAttribute('aria-expanded',String(!isOpen));}
};
</script>
</body>`;

c = c.replace('</body>', inject);
fs.writeFileSync('public/index.html', c);
console.log('Done - toggleGroup injected');
