'use strict';
/**
 * verify-bootcache.js — executes the SHIPPED match logic (../../bootcache.js). Pure; no DB.
 * Proves the cache only serves the three servable paths for a matching entity scope and the
 * full-list shape, and falls through (null) for everything else — the safety invariant.
 */
const { bootKeyForUrl } = require('../../bootcache.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

// Servable: the three paths, no entity_id (session scope) or entity_id === batch entity.
A('invoices, no entity_id → served', bootKeyForUrl('/api/invoices', 5) === '/api/invoices');
A('expenses, no entity_id → served', bootKeyForUrl('/api/expenses', 5) === '/api/expenses');
A('bills, no entity_id → served', bootKeyForUrl('/api/bills', 5) === '/api/bills');
A('invoices?entity_id=5 with batch=5 → served', bootKeyForUrl('/api/invoices?entity_id=5', 5) === '/api/invoices');
A('empty entity_id → served (session scope)', bootKeyForUrl('/api/invoices?entity_id=', 5) === '/api/invoices');
A('batch null + no entity_id → served', bootKeyForUrl('/api/invoices', null) === '/api/invoices');

// NOT servable → null (fall through to real fetch).
A('different entity → null', bootKeyForUrl('/api/invoices?entity_id=9', 5) === null);
A('batch null + explicit entity_id → null', bootKeyForUrl('/api/invoices?entity_id=5', null) === null);
A('paginated (limit) → null', bootKeyForUrl('/api/invoices?limit=50', 5) === null);
A('paginated (before) → null', bootKeyForUrl('/api/invoices?before=1000', 5) === null);
A('non-servable path (reports) → null', bootKeyForUrl('/api/reports?entity_id=5', 5) === null);
A('non-servable path (customers) → null', bootKeyForUrl('/api/customers', 5) === null);
A('non-servable path (me) → null', bootKeyForUrl('/api/me', 5) === null);
A('garbage url → null', bootKeyForUrl('::::', 5) === null);
A('full URL form also parsed', bootKeyForUrl('https://app.finflow.app/api/expenses?entity_id=7', 7) === '/api/expenses');
A('extra params but entity matches → served', bootKeyForUrl('/api/invoices?entity_id=5&display=USD', 5) === '/api/invoices');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
