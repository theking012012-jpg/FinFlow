'use strict';
// Full-app audit, desktop half (1280 px): every /app page — no sideways scroll, no script error or CSP violation, no broken
// value on screen. The phone half is verify-audit-every-page-phone.js; the checks live in audit-every-page-impl.js.
require('./audit-every-page-impl.js')('desktop');
