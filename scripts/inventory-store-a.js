#!/usr/bin/env node
// scripts/inventory-store-a.js — READ-ONLY inventory of Store A (payments_received).
//
// Dry-run ONLY. This tool never writes: no apply mode, no migration, no backup, no
// rollback. It reads payments_received + invoices and classifies each Store A row so the
// owner can decide its disposition per the F32 Store-A decision (see AUDIT_MASTER F32/F35).
//
//   node scripts/inventory-store-a.js            # all users
//   node scripts/inventory-store-a.js --user 42  # one user
//
// Buckets — the split matters, empty ref is NOT the same as unresolvable ref:
//
//   NEEDS DECISION   invoice_ref is empty/blank. An empty ref carries NO signal about
//                    whether the row settles an invoice or is a cash sale, so it CANNOT be
//                    auto-routed. Routing an empty-ref row to sales_receipts would invent
//                    revenue — the exact F32 defect verified fixed this session. Blocked
//                    pending a human ruling on what the row represents.
//   MATCHED          invoice_ref resolves to exactly one invoice id (same user). Would
//                    become an invoice_payments (Store B) settlement: draws down AR, adds
//                    NO revenue.
//   UNRESOLVABLE     invoice_ref is non-empty but matches no invoice. Would become a
//                    sales_receipts cash sale (recognized revenue). RECOMMENDATION ONLY —
//                    this tool still writes nothing.
'use strict';

// Pure, DB-free classifier so it can be unit-tested without a live connection.
// Matching is intentionally conservative: only an exact numeric invoice-id match (within
// the same user) counts as MATCHED. Anything non-empty that doesn't is UNRESOLVABLE, with
// same-customer invoice ids attached as a human hint — never treated as an auto-match.
function classifyStoreA(paymentsReceived, invoices) {
  const invByUserId = new Map();               // `${user_id}:${id}` -> invoice
  const invByCustomer = new Map();             // `${user_id}:${client-lower}` -> [ids]
  for (const i of invoices || []) {
    invByUserId.set(`${i.user_id}:${Number(i.id)}`, i);
    const ck = `${i.user_id}:${String(i.client || '').trim().toLowerCase()}`;
    if (!invByCustomer.has(ck)) invByCustomer.set(ck, []);
    invByCustomer.get(ck).push(i.id);
  }

  const out = { needsDecision: [], matched: [], unresolvable: [] };
  for (const r of paymentsReceived || []) {
    const ref = String(r.invoice_ref == null ? '' : r.invoice_ref).trim();
    const base = {
      id: r.id, user_id: r.user_id, entity_id: r.entity_id ?? null,
      amount: parseFloat(r.amount) || 0, customer: r.customer || '',
      invoice_ref: ref, date: r.date || null,
    };
    if (ref === '') {
      out.needsDecision.push({ ...base, reason: 'empty invoice_ref — no signal to classify; must NOT be auto-routed' });
      continue;
    }
    const asId = Number(ref);
    if (Number.isInteger(asId) && invByUserId.has(`${r.user_id}:${asId}`)) {
      out.matched.push({ ...base, invoiceId: asId, disposition: 'would become invoice_payments (Store B) — draws down AR, no new revenue' });
      continue;
    }
    const hint = invByCustomer.get(`${r.user_id}:${String(r.customer || '').trim().toLowerCase()}`) || [];
    out.unresolvable.push({ ...base, clientMatchHint: hint, disposition: 'would become sales_receipts (cash sale) — RECOMMENDATION ONLY' });
  }

  const sum = a => Math.round(a.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  out.totals = {
    rows: (paymentsReceived || []).length,
    needsDecision: out.needsDecision.length, needsDecisionAmount: sum(out.needsDecision),
    matched: out.matched.length, matchedAmount: sum(out.matched),
    unresolvable: out.unresolvable.length, unresolvableAmount: sum(out.unresolvable),
    // Store A is already excluded from revenue (F32 Stage 1), so doing nothing changes no
    // figure — today's revenue does NOT include any of these rows.
    revenueImpactIfUnchanged: 0,
    // What WOULD be (wrongly) added to revenue if unresolvable rows were routed to cash
    // sales — surfaced so the risk is explicit, never applied by this tool.
    revenueAddedIfUnresolvableRoutedToCashSales: sum(out.unresolvable),
  };
  return out;
}

function render(res) {
  const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const L = [];
  L.push('=== Store A (payments_received) — READ-ONLY inventory ===');
  L.push(`rows scanned .................. ${res.totals.rows}`);
  L.push('');
  L.push(`NEEDS DECISION (empty ref) .... ${res.totals.needsDecision}  (${money(res.totals.needsDecisionAmount)})  — BLOCKED, never auto-routed`);
  for (const r of res.needsDecision) L.push(`   • id ${r.id}  ${money(r.amount)}  customer="${r.customer}"  ref="" — ${r.reason}`);
  L.push(`MATCHED (ref → invoice id) .... ${res.totals.matched}  (${money(res.totals.matchedAmount)})  — would settle AR (Store B)`);
  for (const r of res.matched) L.push(`   • id ${r.id}  ${money(r.amount)}  ref="${r.invoice_ref}" → invoice ${r.invoiceId}`);
  L.push(`UNRESOLVABLE (ref, no match) .. ${res.totals.unresolvable}  (${money(res.totals.unresolvableAmount)})  — would be cash sale (RECOMMENDATION ONLY)`);
  for (const r of res.unresolvable) L.push(`   • id ${r.id}  ${money(r.amount)}  ref="${r.invoice_ref}" customer="${r.customer}"  client-id hints: [${r.clientMatchHint.join(', ')}]`);
  L.push('');
  L.push(`revenue impact if unchanged ... ${money(res.totals.revenueImpactIfUnchanged)}  (Store A already excluded from revenue — F32)`);
  L.push(`revenue if UNRESOLVABLE routed to cash sales: +${money(res.totals.revenueAddedIfUnresolvableRoutedToCashSales)}  (NOT applied — shown as risk)`);
  L.push('');
  L.push('This tool wrote nothing. Applying any disposition is a separate, owner-gated step.');
  return L.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const uIdx = argv.indexOf('--user');
  const userId = uIdx >= 0 ? Number(argv[uIdx + 1]) : null;
  const { pool, rowToObj } = require('../database.js');
  try {
    const prSql = userId != null
      ? ['SELECT * FROM payments_received WHERE user_id = $1 ORDER BY id', [userId]]
      : ['SELECT * FROM payments_received ORDER BY user_id, id', []];
    const invSql = userId != null
      ? ['SELECT * FROM invoices WHERE user_id = $1', [userId]]
      : ['SELECT * FROM invoices', []];
    const [{ rows: prRows }, { rows: invRows }] = await Promise.all([
      pool.query(prSql[0], prSql[1]),
      pool.query(invSql[0], invSql[1]),
    ]);
    const res = classifyStoreA(prRows.map(rowToObj), invRows.map(rowToObj));
    console.log(render(res));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[inventory-store-a] failed:', e.message); process.exit(1); });
}

module.exports = { classifyStoreA, render };
