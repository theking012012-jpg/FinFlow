'use strict';
// Full-app audit, the 13 pages outside /app (sign-in, sign-up, accountant, admin, legal …) at 375 px: no sideways scroll,
// no control under 24 × 24 px, no script error or CSP violation. The checks live in audit-every-page-impl.js.
require('./audit-every-page-impl.js')('outside');
