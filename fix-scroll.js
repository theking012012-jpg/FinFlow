const fs = require('fs');
let c = fs.readFileSync('public/index.html', 'utf8');

const old = `setTimeout(function(){ grp.style.height = 'auto'; }, 300);`;
const newStr = `setTimeout(function(){ grp.style.height = 'auto'; grp.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 300);`;

if (c.includes(old)) {
    c = c.replace(old, newStr);
    console.log('Fixed - scrollIntoView added');
} else {
    console.log('Pattern not found');
}

fs.writeFileSync('public/index.html', c);
