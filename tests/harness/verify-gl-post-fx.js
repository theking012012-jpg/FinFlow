'use strict';
/**
 * verify-gl-post-fx.js — GL Phase 2: FX settlement (realised gain/loss).
 *   gain → Dr Cash (1000) / Cr FX Gain-Loss (7000);  loss → Dr FX Gain-Loss (7000) / Cr Cash (1000).
 * computeBooks does NOT fold FX into netProfit (the dashboard reports fxRealised separately), so the
 * ORACLE here is the INDEPENDENT realised-GL formula (settleRate − txRate)*foreignAmount (Rule 6).
 * Seeds two positions — one settled at a GAIN (+50), one at a LOSS (−30) — distinct magnitudes so a
 * sign/qty bug cannot hide (Rule 4). Proves each entry balances, ledger FX Gain/Loss (expense-type,
 * debit−credit) == −Σ realisedGL = −20 (net gain), Cash == +20, and the trial balance ties to zero.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-fx.js
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
    console.log('\n' + '='.repeat(78) + '\n  GL PHASE 2 — FX settlement (Dr/Cr Cash 1000 ↔ FX Gain/Loss 7000)\n' + '='.repeat(78) + '\n');
    const email = 'glfx@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'GL Co', currency: 'USD' }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.75' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    // Position A: EUR 1000 @ 1.10; settle @ 1.15 → +50 gain. Position B: GBP 500 @ 1.30; settle @ 1.24 → −30 loss.
    const aR = await http.post('/api/fx-transactions', { foreign_currency: 'EUR', foreign_amount: 1000, rate_at_transaction: 1.10, entity_id: eid });
    A('POST fx-tx A (EUR) 2xx', aR.status >= 200 && aR.status < 300, 'status=' + aR.status + ' ' + (aR.text || '').slice(0, 140));
    const a = JSON.parse(aR.text);
    const bR = await http.post('/api/fx-transactions', { foreign_currency: 'GBP', foreign_amount: 500, rate_at_transaction: 1.30, entity_id: eid });
    A('POST fx-tx B (GBP) 2xx', bR.status >= 200 && bR.status < 300, 'status=' + bR.status);
    const b = JSON.parse(bR.text);

    const settle = (id, rate) => http.post('/api/fx-transactions/' + id + '/settle', { rate_at_settlement: rate });
    const entryLines = async srcId => (await c.query(`SELECT la.code, ll.debit, ll.credit FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id JOIN ledger_entries le ON le.id=ll.entry_id WHERE le.source_type='fx_settle' AND le.source_id=$1`, [srcId])).rows;

    const sA = await settle(a.id, 1.15);
    A('settle A @1.15 2xx', sA.status >= 200 && sA.status < 300, 'status=' + sA.status + ' ' + (sA.text || '').slice(0, 140));
    A('A realised gain = +50', near(JSON.parse(sA.text).realised_gain_loss, 50), 'gl=' + JSON.parse(sA.text).realised_gain_loss);
    const la = Object.fromEntries((await entryLines(a.id)).map(l => [l.code, l]));
    A('gain: Dr Cash (1000)=50 / Cr FX Gain-Loss (7000)=50', la['1000'] && near(la['1000'].debit, 50) && la['7000'] && near(la['7000'].credit, 50), JSON.stringify(la));

    const sB = await settle(b.id, 1.24);
    A('settle B @1.24 2xx', sB.status >= 200 && sB.status < 300, 'status=' + sB.status);
    A('B realised loss = −30', near(JSON.parse(sB.text).realised_gain_loss, -30), 'gl=' + JSON.parse(sB.text).realised_gain_loss);
    const lb = Object.fromEntries((await entryLines(b.id)).map(l => [l.code, l]));
    A('loss: Dr FX Gain-Loss (7000)=30 / Cr Cash (1000)=30', lb['7000'] && near(lb['7000'].debit, 30) && lb['1000'] && near(lb['1000'].credit, 30), JSON.stringify(lb));

    const allA = await entryLines(a.id), allB = await entryLines(b.id);
    A('both settlement entries balance', near(allA.reduce((s, l) => s + +l.debit, 0), allA.reduce((s, l) => s + +l.credit, 0)) && near(allB.reduce((s, l) => s + +l.debit, 0), allB.reduce((s, l) => s + +l.credit, 0)));

    const bal = async code => (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 AND la.code=$3`, [uid, eid, code])).rows[0].net;
    // Independent oracle (Rule 6): recompute realised GL straight from the settled fx_transactions rows.
    const oracleGL = (await c.query(`SELECT COALESCE(SUM((rate_at_settlement - rate_at_transaction) * foreign_amount),0)::float AS gl FROM fx_transactions WHERE user_id=$1 AND status='settled'`, [uid])).rows[0].gl;
    A('independent realised GL (from rows) = +20 net gain', near(oracleGL, 20), 'oracleGL=' + oracleGL);
    A('ORACLE: ledger FX Gain/Loss (debit−credit) == −Σ realisedGL (−20)', near(await bal('7000'), -oracleGL) && near(await bal('7000'), -20), 'ledger7000=' + (await bal('7000')));
    A('ledger Cash (1000) == +20 (gain in 50, loss out 30)', near(await bal('1000'), 20), 'cash=' + (await bal('1000')));

    const tb = (await c.query(`SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS cr FROM ledger_lines WHERE user_id=$1 AND entity_id=$2`, [uid, eid])).rows[0];
    A('TRIAL BALANCE ties to zero', near(tb.d - tb.cr, 0), 'diff=' + (tb.d - tb.cr));
    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (GL FX == independent oracle)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
