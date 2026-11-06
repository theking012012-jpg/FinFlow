// ── F5 Step 4: role-based access control — single source of truth ────────────
// Enforces the role→capability matrix on every mutating/sensitive /api route.
//
// ROLE COMES FROM THE RESOLVED MEMBERSHIP (req.accountRole), never the request.
// req.accountRole is set per-request by the account resolver in server.js from the
// caller's ACTIVE team_members row — resolved fresh each request (no session cache),
// so a revoked membership loses access on the very next request.
//
// Two enforcement layers work together (defense-in-depth):
//   1. A coarse method gate in server.js (viewer = read-only; DELETE = owner/admin)
//      is the catch-all so any route NOT explicitly mapped here stays safe.
//   2. requirePerm(cap) below adds the finer, owner-only / owner+admin-only limits
//      that a method rule can't express (payroll, team, settings, entities, bank,
//      permissions, audit).
//
// Owner is implicitly granted EVERY capability (see roleHasPerm), so it is omitted
// from the grant lists. Fail-closed: unknown role / unknown capability → deny.

const ROLES = ['owner', 'admin', 'accountant', 'viewer'];

// capability → roles granted it (besides owner, who always passes).
const MATRIX = {
  'books:read':         ['admin', 'accountant', 'viewer'],  // read any business data + read-only report POSTs
  'books:write':        ['admin', 'accountant'],            // create/edit records — DELETE stays owner/admin via the coarse gate
  'payroll:write':      ['admin'],                          // run/edit payroll (accountant excluded)
  'team:manage':        ['admin'],                          // invite / change roles / remove members
  'audit:read':         ['admin'],                          // full activity trail — external accountant excluded
  'settings:manage':    ['admin'],                          // account settings, lock settings
  'bank:manage':        [],                                 // link bank connections — owner only
  'entities:manage':    [],                                 // add/remove/switch business entities — owner only
  'permissions:manage': [],                                 // edit the RBAC config itself — owner only
  'ai:use':             ['admin', 'accountant'],            // AI chat — viewer excluded (cost + reads everything)
  'records:delete':     ['admin'],                          // DELETE any record — enforced by server.js's coarse method gate (F30: one source)
};

// F30 (2026-11-06): the role table the Settings page SHOWS, built from MATRIX itself — so what people see is exactly what is
// enforced. (It used to be a hand-written copy in the browser that had drifted: it showed accountants deleting expenses,
// which the server refuses, and API keys as owner-only, which admins can make.) permissions:manage is left out — it is the
// owner's own right to this table, which has no editor (custom role tables were never enforced; the save is gone).
const DISPLAY = [
  ['books:read', 'View reports and records', 'P&L, cash flow, balance sheet, every list'],
  ['books:write', 'Create and edit records', 'Invoices, bills, expenses, payments, journals'],
  ['records:delete', 'Delete records', 'Remove invoices, bills, expenses and other records'],
  ['payroll:write', 'Run payroll', 'Create, approve and pay payroll runs'],
  ['team:manage', 'Manage team', 'Invite, remove, change roles'],
  ['audit:read', 'Audit log', 'View the full change history'],
  ['settings:manage', 'Settings and API keys', 'Account settings, period locks, API keys'],
  ['ai:use', 'AI assistant', 'Ask the AI about your books'],
  ['bank:manage', 'Bank connections', 'Link and manage bank accounts'],
  ['entities:manage', 'Businesses', 'Add, remove and switch businesses'],
];
function permissionTable() {
  return { roles: ROLES.slice(), rows: DISPLAY.map(([cap, label, desc]) => ({ cap, label, desc, grants: Object.fromEntries(ROLES.map(r => [r, roleHasPerm(r, cap)])) })) };
}

// Does `role` hold capability `cap`? Owner: always. Unknown cap: never (fail-closed).
function roleHasPerm(role, cap) {
  if (role === 'owner') return true;
  const grants = MATRIX[cap];
  if (!grants) return false;
  return grants.includes(role);
}

// Express middleware factory. Insert AFTER requireAuth so a session (and therefore
// req.accountRole from the resolver) is guaranteed. Missing role → 'viewer' (most
// restrictive) so a resolver miss fails closed rather than open.
function requirePerm(cap) {
  return function (req, res, next) {
    const role = req.accountRole || 'viewer';
    if (roleHasPerm(role, cap)) return next();
    return res.status(403).json({
      error: 'You do not have permission to perform this action.',
      code:  'RBAC_DENIED',
      need:  cap,
    });
  };
}

module.exports = { ROLES, MATRIX, DISPLAY, roleHasPerm, requirePerm, permissionTable };
