#!/usr/bin/env node
'use strict';
/**
 * verify-csv-region.js — N40. Imported CSV / bank-statement dates and amounts are read in the FILE's own
 * conventions; an unreadable date rejects the row; statuses map onto the real vocabularies.
 *
 * Defects: new Date(text) read every numeric date month-first (a day-first bank's 03/04/2026 → 4 March) and
 * turned any unreadable date into TODAY; amounts were stripped to digits/'.'/'-' ("1.234,56" → 1.23456,
 * "45,00" → 4500); CSV invoice/bill statuses 'sent'/'void' went to the database as-is (outside the CHECK
 * constraint → the row failed; a void document would have been recognised).
 *
 * Executed: real server + Postgres, real import routes. Business in Trinidad & Tobago (day-first default).
 *   expenses CSV: 03/04/2026 Rent "1.234,56" · 15/04/2026 Fuel "45,00" · "garbage" Bad "10,00"
 *     Rent 1234.56 on 2026-04-03 (bug: 1.23456 on 2026-03-04) · Fuel 45 on 2026-04-15 (bug: 4500 on today)
 *     Bad rejected, not dated today (bug: imported 2026-07-25)
 *   ambiguous file (03/04/2026 only): day-first ASSUMED from the country → 2026-04-03, reported assumed
 *   invoices CSV: status "Sent" → pending (bug: row failed) · "Void" → skipped (bug: row failed)
 *   bank CSV: 03/04/2026 Coffee "-4,50" · 20/04/2026 Salary "2.500,00" · "not a date"
 *     Coffee debit 4.50 on 2026-04-03 (bug: 450 on 2026-03-04) · Salary credit 2500 · bad line rejected
 *   control: month-first file (04/15/2026) → 2026-04-15
 *   node -r ./tests/harness/clock.js tests/harness/verify-csv-region.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'csv-region-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'cr@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eT = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'TT Ltd', currency: 'TTD', country: 'TT', is_active: 1 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.40.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'cr@finflow.test', password: PW })).status === 200);
    const exp = async (desc) => (await c.query(`SELECT data->>'amount' a, data->>'expense_date' d FROM expenses WHERE user_id=$1 AND data->>'description'=$2`, [uid, desc])).rows;

    console.log('\n' + '='.repeat(78));
    console.log('  CSV IMPORT — the file\'s own date order and decimal mark');
    console.log('='.repeat(78));
    const r1 = await h.post(`/api/import/csv?entity_id=${eT}`, { type: 'expenses', content: 'date,description,amount\n03/04/2026,Rent,"1.234,56"\n15/04/2026,Fuel,"45,00"\ngarbage,Bad,"10,00"\n' });
    A('expenses import → 200', r1.status === 200, `status ${r1.status} ${r1.text.slice(0, 160)}`);
    const rent = await exp('Rent'), fuel = await exp('Fuel'), bad = await exp('Bad');
    A('Rent = 1234.56 on 2026-04-03 (bug: 1.23456 on 2026-03-04)', rent.length === 1 && Number(rent[0].a) === 1234.56 && rent[0].d === '2026-04-03', JSON.stringify(rent));
    A('Fuel = 45 on 2026-04-15 (bug: 4500, dated today)', fuel.length === 1 && Number(fuel[0].a) === 45 && fuel[0].d === '2026-04-15', JSON.stringify(fuel));
    A('unreadable date → row rejected, not dated today (bug: imported 2026-07-25)', bad.length === 0 && r1.json && r1.json.badDates === 1, JSON.stringify({ bad, badDates: r1.json && r1.json.badDates }));
    A('  response reports the detected conventions (dmy, decimal ",")', r1.json && r1.json.dateOrder === 'dmy' && r1.json.decimalMark === ',' && !r1.json.dateOrderAssumed, JSON.stringify(r1.json && { o: r1.json.dateOrder, m: r1.json.decimalMark, a: r1.json.dateOrderAssumed }));

    const r2 = await h.post(`/api/import/csv?entity_id=${eT}`, { type: 'expenses', content: 'date,description,amount\n03/04/2026,Ambiguous,20.00\n' });
    const amb = await exp('Ambiguous');
    A('ambiguous file: day-first ASSUMED from the country (TT) → 2026-04-03, reported as assumed', amb.length === 1 && amb[0].d === '2026-04-03' && r2.json && r2.json.dateOrderAssumed === true, JSON.stringify({ amb, assumed: r2.json && r2.json.dateOrderAssumed }));
    const r3 = await h.post(`/api/import/csv?entity_id=${eT}`, { type: 'expenses', content: 'date,description,amount\n04/15/2026,MonthFirst,30.00\n' });
    const mf = await exp('MonthFirst');
    A('control: a month-first file (04/15/2026) → 2026-04-15', mf.length === 1 && mf[0].d === '2026-04-15', JSON.stringify(mf));
    const r4 = await h.post(`/api/import/csv?entity_id=${eT}`, { type: 'expenses', content: 'date,description,amount\n15/04/2026,Mix1,1\n04/15/2026,Mix2,2\n' });
    A('a file mixing day-first and month-first → 400, nothing imported', r4.status === 400 && (await exp('Mix1')).length === 0, `status ${r4.status} ${r4.text.slice(0, 100)}`);

    const r5 = await h.post(`/api/import/csv?entity_id=${eT}`, { type: 'invoices', content: 'customer,amount,status,date\nSent Co,100,Sent,10/07/2026\nVoid Co,200,Void,11/07/2026\n' });
    const sent = (await c.query(`SELECT data->>'status' s FROM invoices WHERE user_id=$1 AND data->>'client'='Sent Co'`, [uid])).rows;
    const voided = (await c.query(`SELECT 1 FROM invoices WHERE user_id=$1 AND data->>'client'='Void Co'`, [uid])).rows;
    A('invoice status "Sent" → imported as pending (bug: row failed the status constraint)', sent.length === 1 && sent[0].s === 'pending', JSON.stringify({ sent, tally: r5.json }));
    A('invoice status "Void" → skipped, never recognised (bug: row failed)', voided.length === 0 && r5.json && r5.json.failed === 0, JSON.stringify(r5.json));

    const r6 = await h.post(`/api/banking/import?entity_id=${eT}`, { format: 'csv', content: 'date,description,amount\n03/04/2026,Coffee,"-4,50"\n20/04/2026,Salary,"2.500,00"\nnot a date,X,1\n' });
    const bk = async (d) => (await c.query(`SELECT data->>'amount' a, data->>'tx_date' t, data->>'tx_type' k FROM personal_transactions WHERE user_id=$1 AND data->>'description'=$2`, [uid, d])).rows;
    const cof = await bk('Coffee'), sal = await bk('Salary'), x = await bk('X');
    A('bank: Coffee = debit 4.50 on 2026-04-03 (bug: 450 on 2026-03-04)', r6.status === 201 && cof.length === 1 && Number(cof[0].a) === 4.5 && cof[0].t === '2026-04-03' && cof[0].k === 'debit', `status ${r6.status} ${JSON.stringify(cof)}`);
    A('bank: Salary = credit 2500 on 2026-04-20 (bug: 2.5)', sal.length === 1 && Number(sal[0].a) === 2500 && sal[0].t === '2026-04-20', JSON.stringify(sal));
    A('bank: unreadable date → line rejected (bug: dated today)', x.length === 0 && r6.json && r6.json.rejectedBadDate === 1, JSON.stringify({ x, r: r6.json }));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (CSV region)` : `  ALL GREEN — ${pass} passed, 0 failed  (CSV region)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
