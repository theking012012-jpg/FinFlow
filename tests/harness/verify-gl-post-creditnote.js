'use strict';
/**
 * verify-gl-post-creditnote.js — GL Phase 2: credit note (revenue contra, F58).
 *   Open/Applied → Dr Revenue (4000) / Cr Accounts Receivable (1100) at its date; Void → nothing.
 * Seeds an issued invoice (200) + an Open credit note (50) + a Void credit note (999). Proves the
 * Open note posts a balanced contra entry, the Void note posts NOTHING, ledger Revenue ==
 * computeBooks.revenue (150 = 200 − 50, oracle), the GL also nets AR to 150 (an improvement over the
 * shoebox aggregate, which leaves AR at 200), and the trial balance ties to zero.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-creditnote.js
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
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — credit note (Dr Revenue 4000 / Cr Accounts Receivable 1100)\n' + '='.repeat(78) + '\n');
    const email = 'glcn@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.73' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    const invR = await http.post('/api/invoices', { client: 'Cust', amount: 200, status: 'pending', issue_date: '2026-06-01', entity_id: eid });
    A('POST invoice (200) 2xx', invR.status >= 200 && invR.status < 300, 'status=' + invR.status + ' ' + (invR.text || '').slice(0, 140));

    const cnR = await http.post('/api/credit-notes', { customer: 'Cust', amount: 50, status: 'Open', date: '2026-06-10', entity_id: eid });
    A('POST credit note (Open 50) 2xx', cnR.status >= 200 && cnR.status < 300, 'status=' + cnR.status + ' ' + (cnR.text || '').slice(0, 140));
    const cn = JSON.parse(cnR.text);
    const cnLines = (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id JOIN ledger_entries le ON le.id=ll.entry_id WHERE le.source_type='credit_note' AND le.source_id=$1`, [cn.id])).rows;
    const byCode = Object.fromEntries(cnLines.map(l => [l.code, l]));
    A('Dr Revenue (4000) = 50', byCode['4000'] && near(byCode['4000'].debit, 50) && near(byCode['4000'].credit, 0), JSON.stringify(byCode['4000']));
    A('Cr Accounts Receivable (1100) = 50', byCode['1100'] && near(byCode['1100'].credit, 50) && near(byCode['1100'].debit, 0), JSON.stringify(byCode['1100']));
    A('credit-note entry balances', near(cnLines.reduce((s, l) => s + +l.debit, 0), cnLines.reduce((s, l) => s + +l.credit, 0)));

    const voidR = await http.post('/api/credit-notes', { customer: 'Cust', amount: 999, status: 'Void', date: '2026-06-10', entity_id: eid });
    A('POST credit note (Void 999) 2xx', voidR.status >= 200 && voidR.status < 300, 'status=' + voidR.status);
    const voidCn = JSON.parse(voidR.text);
    const voidEntries = (await c.query(`SELECT id FROM ledger_entries WHERE source_type='credit_note' AND source_id=$1`, [voidCn.id])).rows;
    A('Void credit note posts NOTHING', voidEntries.length === 0, 'got ' + voidEntries.length);
    const cnCount = (await c.query(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE source_type='credit_note'`)).rows[0].n;
    A('exactly one credit-note entry total (only the Open one)', cnCount === 1, 'got ' + cnCount);

    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    const books = await computeBooks(uid, eid, 'year');
    A('ORACLE: ledger Revenue (150) == computeBooks.revenue (200 − 50)', near(-(await bal('4000')), books.revenue) && near(books.revenue, 150), 'ledgerRev=' + (-(await bal('4000'))) + ' revenue=' + books.revenue);
    A('GL nets AR to 150 (200 invoice − 50 credit; improvement over shoebox)', near(await bal('1100'), 150), 'ar=' + (await bal('1100')));

    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));
    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL credit note == oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
