'use strict';
// Full-app audit, phone part (375 px): every /app page — no sideways scroll, no control under 24 × 24 px, no script error
// or CSP violation, no broken value on screen. Desktop: verify-audit-every-page.js. Pages outside /app:
// verify-audit-every-page-outside.js. The checks live in audit-every-page-impl.js.
require('./audit-every-page-impl.js')('phone');
