'use strict';
/**
 * M21 (money audit 2026-10-09): re-dating a POSTED journal must move it in the books, not only in the list.
 * BUG: PUT /api/journals/:id accepted the new date but the ledger entry kept the old one (posting was
 * idempotent on 'journal:<id>'), so June's books kept a journal the list showed in July.
 * Seed: posted journal Dr 1010 / Cr 4000 Service Revenue 300 dated 2026-06-15, then re-dated 2026-07-10.
 *   correct: ledger date 2026-07-10 · June revenue 0 · July revenue 300
 *   bug:     ledger date 2026-06-15 · June revenue 300 · July revenue 0
 * Also the Posted → Draft → Posted cycle must land the journal back in the books (it stayed reversed).
 */
const { run } = require('./moneyFixKit.js');

run('M21 — a re-dated posted journal moves in the books', async ({ newOwner, c, eq }) => {
  const { uid, J } = await newOwner('M21');
  const j = await J('POST', '/api/journals', { date: '2026-06-15', description: 'June service', status: 'Posted', idempotency_key: 'm21-j',
    lines: [{ code: '1010', debit: 300, credit: 0 }, { code: '4000', debit: 0, credit: 300 }] });
  const month = async mi => (await J('GET', '/api/reports?period=month&monthIdx=' + mi)).revenue;
  eq('June revenue before the re-date (control)', await month(5), 300);
  await J('PUT', '/api/journals/' + j.id, { date: '2026-07-10' });
  const { rows: [gl] } = await c.query(`SELECT entry_date::text AS d FROM ledger_entries WHERE user_id=$1 AND source_type='journal' AND source_id=$2 AND reversal_of IS NULL AND status='posted'`, [uid, j.id]);
  eq('ledger entry date follows the journal', gl && gl.d, '2026-07-10', '2026-06-15');
  eq('June revenue after the re-date', await month(5), 0, 300);
  eq('July revenue after the re-date', await month(6), 300, 0);

  // Posted → Draft → Posted
  await J('PUT', '/api/journals/' + j.id, { status: 'Draft' });
  eq('a journal set back to Draft leaves the books', await month(6), 0);
  await J('PUT', '/api/journals/' + j.id, { status: 'Posted' });
  eq('posting it again brings it back into the books', await month(6), 300, 0);
  const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id=$1 AND source_type='journal' AND source_id=$2 AND reversal_of IS NULL`, [uid, j.id]);
  eq('still exactly one live ledger entry for the journal', n, 1);
});
