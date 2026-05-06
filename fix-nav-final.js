const fs = require('fs');
let c = fs.readFileSync('public/index.html', 'utf8');

// Fix 1: Nuclear reset on nav-group and nav-group-inner CSS
const oldNavCSS = '.nav-group{overflow:hidden;height:0!important;transition:height .3s ease}.nav-group.open{height:auto!important}';
const newNavCSS = '.nav-group{display:none}.nav-group.open{display:block}';

if (c.includes(oldNavCSS)) {
    c = c.replace(oldNavCSS, newNavCSS);
    console.log('Nav CSS fixed with display:none approach');
} else {
    // Try to find and replace whatever is there
    const idx = c.indexOf('.nav-group{');
    const end = c.indexOf('.nav-group-inner{', idx);
    const current = c.substring(idx, end);
    console.log('Current nav CSS:', current);
    c = c.substring(0, idx) + newNavCSS + '\n' + c.substring(end);
    console.log('Replaced nav CSS');
}

// Fix 2: Simple toggleGroup using display
const oldToggle = `window.toggleGroup = function(name) {
  var grp = document.getElementById('nav-group-' + name);
  var arr = document.getElementById('arr-' + name);
  var hdr = document.getElementById('grp-' + name);
  if (!grp) return;
  var isOpen = grp.classList.contains('open');
  if (!isOpen) {
    // Measure content height by briefly making it visible
    grp.style.transition = 'none';
    grp.style.height = 'auto';
    var h = grp.offsetHeight || grp.getBoundingClientRect().height;
    if (h === 0) {
      // Force measure via scrollHeight of inner
      var inner = grp.querySelector('.nav-group-inner');
      h = inner ? inner.scrollHeight : 300;
    }
    grp.style.height = '0px';
    // Force reflow
    grp.offsetHeight;
    grp.style.transition = 'height .28s ease';
    grp.style.height = h + 'px';
    grp.classList.add('open');
    setTimeout(function(){ grp.style.height = 'auto'; grp.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 300);
  } else {
    var h2 = grp.scrollHeight || grp.getBoundingClientRect().height;
    grp.style.height = h2 + 'px';
    grp.style.transition = 'height .28s ease';
    requestAnimationFrame(function(){
      grp.style.height = '0px';
      grp.classList.remove('open');
    });
  }
  if (arr) arr.classList.toggle('open', !isOpen);
  if (hdr) { hdr.classList.toggle('active', !isOpen); hdr.setAttribute('aria-expanded', String(!isOpen)); }
};`;

const newToggle = `window.toggleGroup = function(name) {
  var grp = document.getElementById('nav-group-' + name);
  var arr = document.getElementById('arr-' + name);
  var hdr = document.getElementById('grp-' + name);
  if (!grp) return;
  var isOpen = grp.classList.contains('open');
  if (!isOpen) {
    grp.classList.add('open');
    if (arr) arr.classList.add('open');
    if (hdr) { hdr.classList.add('active'); hdr.setAttribute('aria-expanded', 'true'); }
  } else {
    grp.classList.remove('open');
    if (arr) arr.classList.remove('open');
    if (hdr) { hdr.classList.remove('active'); hdr.setAttribute('aria-expanded', 'false'); }
  }
};`;

if (c.includes(oldToggle)) {
    c = c.replace(oldToggle, newToggle);
    console.log('toggleGroup replaced with simple display toggle');
} else {
    console.log('toggleGroup pattern not found - trying partial match');
    const idx = c.indexOf('window.toggleGroup = function(name)');
    if (idx !== -1) {
        // Find the end of the function
        let depth = 0;
        let i = idx;
        let started = false;
        while (i < c.length) {
            if (c[i] === '{') { depth++; started = true; }
            if (c[i] === '}') { depth--; }
            if (started && depth === 0) { i++; break; }
            i++;
        }
        // Also consume the semicolon
        if (c[i] === ';') i++;
        c = c.substring(0, idx) + newToggle + c.substring(i);
        console.log('toggleGroup replaced via bracket matching');
    }
}

// Fix 3: Remove nav-group-inner position issues
c = c.replace('.nav-group-inner{opacity:1;transform:none;display:block;position:relative;top:0}', '.nav-group-inner{display:block}');
c = c.replace('.nav-group-inner{opacity:1;transform:none;display:block}', '.nav-group-inner{display:block}');
c = c.replace('.nav-group-inner{opacity:1;transform:none}', '.nav-group-inner{display:block}');

console.log('nav-group-inner CSS cleaned');

fs.writeFileSync('public/index.html', c);
console.log('DONE - refresh localhost:3000 and test');
