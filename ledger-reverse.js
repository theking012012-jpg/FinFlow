'use strict';
// ledger-reverse.js — the ONE implementation of "undo a source document's ledger entry" (A6, 2026-10-21). Moved out of
// server.js unchanged so the owner-run test-data purge (tools/launch/purge-test-data.js) reverses exactly as the app's
// own delete / void routes do, instead of keeping a second copy (Rule 2 — a second writer is a future divergence).
//
// A reversal is a NEW posted entry with every line's debit and credit swapped, linked by reversal_of and keyed
// 'reverse:<type>:<id>' (idempotent: a second call returns the first reversal). Ledger history is never deleted.
// Runs on the client it is given — the caller owns the transaction.
async function reverseLedgerEntryBody(client, { userId, sourceType, sourceId }) {
  const revKey = 'reverse:' + sourceType + ':' + sourceId;
  const { rows: already } = await client.query(`SELECT id FROM ledger_entries WHERE user_id=$1 AND idempotency_key=$2 LIMIT 1`, [userId, revKey]);
  if (already[0]) return already[0].id;                                   // already reversed - idempotent
  const { rows: orig } = await client.query(
    `SELECT id, entity_id, entry_date::text AS entry_date, description, currency FROM ledger_entries
      WHERE user_id=$1 AND source_type=$2 AND source_id=$3 AND reversal_of IS NULL AND status='posted' ORDER BY id ASC LIMIT 1`,
    [userId, sourceType, sourceId]);
  if (!orig[0]) return null;                                             // nothing posted for this source
  const o = orig[0];
  const { rows: lines } = await client.query(`SELECT account_id, debit, credit, debit_base, credit_base FROM ledger_lines WHERE entry_id=$1`, [o.id]);
  if (!lines.length) return null;
  const { rows: [rev] } = await client.query(
    `INSERT INTO ledger_entries (user_id, entity_id, entry_date, description, source_type, source_id, currency, status, reversal_of, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'posted',$8,$9) RETURNING id`,
    [userId, o.entity_id, o.entry_date, ('Reversal - ' + (o.description || '')).slice(0, 500), sourceType, sourceId, o.currency, o.id, revKey]);
  for (const l of lines) {
    await client.query(
      `INSERT INTO ledger_lines (entry_id, user_id, entity_id, account_id, debit, credit, debit_base, credit_base)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [rev.id, userId, o.entity_id, l.account_id, l.credit, l.debit, l.credit_base, l.debit_base]);   // swap debit<->credit
  }
  return rev.id;
}

// V1 (2026-10-22): every ledger source a payroll run's CASH can post under — a prepayment (cash before the run's period)
// adds a *_release entry dated the period's first day. Voiding a run reverses all of them; the server's void route and the
// owner-run purge tool read this ONE list (Rule 2), so a new leg can never be left behind by one of them.
const PAYROLL_CASH_SOURCE_TYPES = ['payroll_paid', 'payroll_paid_release', 'payroll_remit', 'payroll_remit_release'];

module.exports = { reverseLedgerEntryBody, PAYROLL_CASH_SOURCE_TYPES };
