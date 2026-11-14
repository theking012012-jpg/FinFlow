'use strict';
// Full-app audit, phone half (375 px): every /app page plus the 13 pages outside /app — no sideways scroll, no control under
// 24 × 24 px, no script error or CSP violation, no broken value on screen. The checks live in audit-every-page-impl.js.
require('./audit-every-page-impl.js')('phone');
