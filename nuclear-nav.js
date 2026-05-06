const fs = require('fs');
let c = fs.readFileSync('public/index.html', 'utf8');

// Fix CSS - use display:none/block, no height tricks
c = c.replace(
  '.nav-group{overflow:hidden;height:0!important;transition:height .3s ease}.nav-group.open{height:auto!important}',
  '.nav-group{display:none}.nav-group.open{display:block}'
);

// Fix nav-group-inner
c = c.replace('.nav-group-inner{opacity:1;transform:none;display:block;position:relative;top:0}', '.nav-group-inner{display:block}');
c = c.replace('.nav-group-inner{opacity:1;transform:none;display:block}', '.nav-group-inner{display:block}');
c = c.replace('.nav-group-inner{opacity:1;transform:none}', '.nav-group-inner{display:block}');

// Verify
const idx = c.indexOf('.nav-group{');
console.log('Nav CSS now:', c.substring(idx, idx + 80));

const idx2 = c.indexOf('.nav-group-inner{');
console.log('Inner CSS now:', c.substring(idx2, idx2 + 50));

fs.writeFileSync('public/index.html', c);
console.log('DONE');
