'use strict';
/**
 * C29 (Cowork end-to-end test): every audit-log filter finds the events it names.
 * BUG: the table filter's values were hand-written names, and the server matched them exactly. "Payroll" asked for
 * `payroll`, but payroll runs are recorded as `payroll_runs`, so Payroll was always empty. Ten other recorded kinds
 * had no option, and the Action filter offered only Create, Update and Delete (no Approve, Mark paid, Void, …).
 * Executed: clientMoneyKit (Business A) + a payroll run created and approved through the API; the Audit page's
 * own selects are set and loadAuditTrail() runs against the real server.
 *   Payroll filter → the run's rows (CREATE + APPROVE)             bug: "No audit events found."
 *   Journals & accounts → journals AND chart_of_accounts           bug: one exact name only
 *   Action "Approve" → the approval row                            bug: no such option
 * STRUCTURAL (labelled, Rule 5): every table name and action recorded by the audit writers (recordAudit, auditLog,
 * _audit, logAudit literals in server.js + accountant-routes.js) is covered by an option, so a new recorded
 * kind cannot ship unfilterable. `accountants` is exempt: those rows carry no owner (user_id NULL).
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./clientMoneyKit.js');
const ROOT = path.join(__dirname, '..', '..');

function written() {
  // Every audit_trail write goes through recordAudit (one INSERT). Callers: recordAudit / auditLog (server.js),
  // _audit (accountant-routes.js alias), logAudit(req, ACTION, TABLE, …) (server.js), _auditRec(req, TABLE, ACTION, …) (server.js, FIX-3). Object-literal bodies are
  // brace-matched, since they nest (newData: { … }).
  const tables = new Set(), actions = new Set(), onTable = new Map();   // onTable: action → the tables it is written on
  for (const f of ['server.js', 'accountant-routes.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/\b(?:recordAudit|auditLog|_audit)\([^,()]+,\s*\{/g)) {
      let i = m.index + m[0].length, depth = 1;
      while (depth && i < s.length) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; i++; }
      const body = s.slice(m.index + m[0].length, i);
      const t = /\btable:\s*'([a-z_]+)'/.exec(body); const a = /\baction:\s*'([A-Z_]+)'/.exec(body);
      if (t) tables.add(t[1]); if (a) actions.add(a[1]);
      if (a) { if (!onTable.has(a[1])) onTable.set(a[1], new Set()); onTable.get(a[1]).add(t ? t[1] : '?'); }
    }
    for (const m of s.matchAll(/\blogAudit\(req,\s*(?:'([A-Z_]+)'|[^,]*\?\s*'([A-Z_]+)'\s*:\s*'([A-Z_]+)'),\s*'([a-z_]+)'/g)) {
      [m[1], m[2], m[3]].filter(Boolean).forEach(a => { actions.add(a); if (!onTable.has(a)) onTable.set(a, new Set()); onTable.get(a).add(m[4]); }); tables.add(m[4]);
    }
    // FIX-3: _auditRec(req, TABLE, ACTION, old, new) — the JSONB-record wrapper over recordAudit (server.js).
    for (const m of s.matchAll(/\b_auditRec\(req,\s*'([a-z_]+)',\s*'([A-Z_]+)'/g)) { tables.add(m[1]); actions.add(m[2]); if (!onTable.has(m[2])) onTable.set(m[2], new Set()); onTable.get(m[2]).add(m[1]); }
  }
  tables.delete('accountants');   // user_id NULL — never on an owner's trail
  // SW3: an action written ONLY on those rows (CONDUCT_ACCEPT — an accountant accepting the Conduct Policy) can never
  // appear on an owner's Audit page either, so an option for it would always show nothing. Exempt for the same reason.
  for (const [act, ts] of onTable) if ([...ts].every(t => t === 'accountants')) actions.delete(act);
  return { tables: [...tables].sort(), actions: [...actions].sort() };
}

run('C29 — audit-log filters find what they name', async ({ w, d, settle, eq, A }) => {
  const rows = () => Array.from(d.querySelectorAll('#audit-trail-body tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
  const pick = async (tbl, act) => {
    d.getElementById('audit-filter-table').value = tbl; d.getElementById('audit-filter-action').value = act;
    await w.loadAuditTrail(); await settle(5, 30);
    return rows().filter(r => r.length > 1);
  };
  try { w.showPage('audit'); } catch (_) {}
  await settle(10, 40);
  const tableOpts = Array.from(d.getElementById('audit-filter-table').options).map(o => o.value);
  const actionOpts = Array.from(d.getElementById('audit-filter-action').options).map(o => o.value);

  const pay = await pick(tableOpts.find(v => v.split(',').includes('payroll_runs')) || 'payroll', 'all');
  A('Payroll filter shows the payroll run (bug: nothing)', pay.some(r => r[1] === 'payroll_runs'), JSON.stringify([...new Set(pay.map(r => r[1]))]));
  eq('…and only payroll events (runs + roster, C29b)', [...new Set(pay.map(r => r[1]))].filter(t => t !== 'payroll_runs' && t !== 'payroll'), []);
  A('…its CREATE and APPROVE', ['CREATE', 'APPROVE'].every(a => pay.some(r => r[3] === a)), JSON.stringify(pay.map(r => r[3])));

  const recv = await pick(tableOpts.find(v => v.split(',').includes('invoice_payments')) || 'invoice_payments', 'all');
  eq('Payments received shows the invoice payment', [...new Set(recv.map(r => r[1]))], ['invoice_payments']);
  const jr = await pick(tableOpts.find(v => v.split(',').includes('chart_of_accounts')) || 'journals', 'all');
  eq('a group filter ("Journals & accounts") shows every table in it', [...new Set(jr.map(r => r[1]))].sort(), ['chart_of_accounts', 'journals'], 'no such option (the select falls back to everything)');

  const appr = actionOpts.includes('APPROVE') ? await pick('all', 'APPROVE') : [];
  eq('Action "Approve" shows the approval (one row per changed field)', [...new Set(appr.map(r => r[1] + ' ' + r[3]))], ['payroll_runs APPROVE'], []);

  const wr = written();
  const covT = new Set(tableOpts.flatMap(v => v.split(',')));
  eq('STRUCTURAL: every recorded table has a filter option', wr.tables.filter(t => !covT.has(t)), [], ['payroll_runs', '…']);
  const covA = new Set(actionOpts.flatMap(v => v.split(',')));
  eq('STRUCTURAL: every recorded action has a filter option', wr.actions.filter(a => !covA.has(a)), [], ['APPROVE', '…']);
  A('STRUCTURAL: the enumeration found the writers (sanity)', wr.tables.length >= 30 && wr.actions.length >= 18, wr.tables.length + ' tables, ' + wr.actions.length + ' actions');
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/payroll-runs', { period: '2026-07', idempotency_key: 'c29-run' });
  if (r.status >= 300) throw new Error('payroll run ' + r.status + ' ' + String(r.text).slice(0, 200));
  const a = await http.request('PUT', '/api/payroll-runs/' + r.json.id + '/approve', {});
  if (a.status >= 300) throw new Error('approve ' + a.status + ' ' + String(a.text).slice(0, 200));
  const inv = (await http.get('/api/invoices')).json.find(i => Number(i.amount) > 0 && i.status !== 'paid' && i.status !== 'draft');
  const p1 = await http.request('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 10, payment_date: '2026-07-20', method: 'bank' });
  if (p1.status >= 300) throw new Error('invoice payment ' + p1.status + ' ' + String(p1.text).slice(0, 200));
  // (a standalone "payment received" is retired — 410 — so the group check uses journals + chart of accounts)
  const acct = await http.request('POST', '/api/chart-of-accounts', { code: '6950', name: 'C29 Test Expense', category: 'Expenses', idempotency_key: 'c29-a' });
  if (acct.status >= 300) throw new Error('account ' + acct.status + ' ' + String(acct.text).slice(0, 200));
  const jn = await http.request('POST', '/api/journals', { date: '2026-07-22', description: 'C29', lines: [{ account: '6950', debit: 5 }, { account: '1000', credit: 5 }], idempotency_key: 'c29-j' });
  if (jn.status >= 300) throw new Error('journal ' + jn.status + ' ' + String(jn.text).slice(0, 200));
} });
