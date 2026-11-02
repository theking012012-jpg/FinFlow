'use strict';
// F90 — WHO is making a change, carried to the database so the audit trigger (database.js, ff_audit_row) can record it.
//
// Every HTTP request runs inside an AsyncLocalStorage store (middleware below); background jobs run inside asSystem().
// database.js sends the current context to Postgres (`finflow.ctx`) on the same connection right before any write to an
// audited table, and when a client is checked out for a transaction. The trigger reads it and writes the audit row IN THE
// SAME TRANSACTION as the change — so a change can never land without its record, whichever code path made it.
//
// Context: { t: actor type (user | accountant | admin | system | anonymous), a: actor id, ip, ua, src: where it came from
//            ("web POST /api/invoices", "api_key:12 POST /api/v1/…", "job:recurring-scheduler", "webhook POST /api/…"),
//            rid: one id per request / job run }
const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');
const als = new AsyncLocalStorage();

const WEBHOOK = /\/webhook\b/;

function ofRequest(req) {
  const s = req.session || {};
  const route = String(req.method || '') + ' ' + String(req.originalUrl || req.url || '').split('?')[0].slice(0, 160);
  let t = 'anonymous', a = null, src = 'web ' + route;
  if (req.apiKeyId != null) { t = 'user'; a = req.apiUserId != null ? Number(req.apiUserId) : null; src = 'api_key:' + req.apiKeyId + ' ' + route; }
  else if (s.accountantId) { t = 'accountant'; a = Number(s.accountantId); }
  else if (s.userId) { t = 'user'; a = Number(s.userId); }
  else if (s.isAdmin) { t = 'admin'; a = s.adminId == null ? null : Number(s.adminId); }
  else if (WEBHOOK.test(route)) { t = 'system'; src = 'webhook ' + route; }
  const ua = typeof req.get === 'function' ? String(req.get('user-agent') || '').slice(0, 300) || null : null;
  if (!req._auditRid) req._auditRid = randomUUID();   // one id per request: pairs a route's named event with the row changes it made
  return { t, a, ip: req.clientIp || req.ip || null, ua, src, rid: req._auditRid };
}

// The JSON the trigger reads ('' when nothing is known — the trigger then records 'system', source 'database').
function current() {
  const st = als.getStore();
  if (!st) return '';
  try { return JSON.stringify(st.req ? ofRequest(st.req) : st.fixed); } catch (_) { return ''; }
}

function middleware(req, res, next) { als.run({ req }, next); }
function asSystem(source, fn) { return als.run({ fixed: { t: 'system', a: null, ip: null, ua: null, src: 'job:' + source, rid: randomUUID() } }, fn); }

// Where the current change comes from (recordAudit writes it on the route's own event rows, so an event and the row
// changes it made can be shown as one).
function _ctx() { const st = als.getStore(); if (!st) return null; try { return st.req ? ofRequest(st.req) : st.fixed; } catch (_) { return null; } }
function source() { const c = _ctx(); return (c && c.src) || null; }
function requestId() { const c = _ctx(); return (c && c.rid) || null; }

module.exports = { middleware, asSystem, current, source, requestId, ofRequest };
