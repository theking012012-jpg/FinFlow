'use strict';
/**
 * verify-gl-post-vendorcredit.js — GL Phase 2: vendor credit (opex contra, F58 — mirror of credit note).
 *   Open/Applied → Dr Accounts Payable (2000) / Cr Operating Expenses (6000) at its date; Void → nothing.
 * Seeds an issued bill (300) + an Open vendor credit (80) + a Void vendor credit (999). Proves the Open
 * credit posts a balanced contra entry, the Void posts NOTHING, ledger Opex == computeBooks.opex
 * (220 = 300 − 80, oracle), the GL nets AP to 220, and the trial balance ties to zero.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-vendorcredit.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — vendor credit (Dr Accounts Payable 2000 / Cr Operating Expenses 6000)\n' + '='.repeat(78) + '\n');
    const email = 'glvc@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.74' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    const billR = await http.post('/api/bills', { vendor: 'Acme', amount: 300, status: 'unpaid', issue_date: '2026-06-01', entity_id: eid });
    A('POST bill (300) 2xx', billR.status >= 200 && billR.status < 300, 'status=' + billR.status + ' ' + (billR.text || '').slice(0, 140));

    const vcR = await http.post('/api/vendor-credits', { vendor: 'Acme', amount: 80, status: 'Open', date: '2026-06-10', entity_id: eid });
    A('POST vendor credit (Open 80) 2xx', vcR.status >= 200 && vcR.status < 300, 'status=' + vcR.status + ' ' + (vcR.text || '').slice(0, 140));
    const vc = JSON.parse(vcR.text);
    const vcLines = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id JOIN ledger_entries le ON le.id=ll.entry_id WHERE le.source_type='vendor_credit' AND le.source_id=$1`, [vc.id])).rows;
    const byCode = Object.fromEntries(vcLines.map(l => [l.code, l]));
    A('Dr Accounts Payable (2000) = 80', byCode['2000'] && near(byCode['2000'].debit, 80) && near(byCode['2000'].credit, 0), JSON.stringify(byCode['2000']));
    A('Cr Operating Expenses (6000) = 80', byCode['6000'] && near(byCode['6000'].credit, 80) && near(byCode['6000'].debit, 0), JSON.stringify(byCode['6000']));
    A('vendor-credit entry balances', near(vcLines.reduce((s, l) => s + +l.debit, 0), vcLines.reduce((s, l) => s + +l.credit, 0)));

    const voidR = await http.post('/api/vendor-credits', { vendor: 'Acme', amount: 999, status: 'Void', date: '2026-06-10', entity_id: eid });
    A('POST vendor credit (Void 999) 2xx', voidR.status >= 200 && voidR.status < 300, 'status=' + voidR.status);
    const voidVc = JSON.parse(voidR.text);
    const voidEntries = (await c.query(`SELECT id FROM ledger_entries WHERE source_type='vendor_credit' AND source_id=$1`, [voidVc.id])).rows;
    A('Void vendor credit posts NOTHING', voidEntries.length === 0, 'got ' + voidEntries.length);

    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger Opex (220) == computeBooks.opex (300 − 80)', near(await bal('6000'), books.opex) && near(books.opex, 220), 'ledgerOpex=' + (await bal('6000')) + ' opex=' + books.opex);
    A('GL nets AP to 220 (300 bill − 80 credit)', near(-(await bal('2000')), 220), 'ap=' + (-(await bal('2000'))));

    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));
    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL vendor credit == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
