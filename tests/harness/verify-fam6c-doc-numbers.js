'use strict';
/*
 * verify-fam6c-doc-numbers.js — FA-M6c (class of FA-M5c). Credit notes, vendor credits, sales receipts, quotes, journals
 * and payments made were numbered from the CLOCK ('CN-' + the last 4 digits of Date.now(), on the server and again in the
 * browser; a client journal from "how many entries are loaded + 43"): not sequential, not per business, and two
 * documents created in the same millisecond — or 10 seconds apart on the wrong digits — got the SAME number.
 * After: every one is numbered by the one assigner invoices and bills use — per business, sequential, never reused,
 * prefix per business; a number the user typed is kept when free in that business, else the next in sequence.
 *
 * Real Postgres + real routes. The clock is PINNED (clock.js), so under the bug every clock-derived number in a run is
 * IDENTICAL — the discriminating case. Hand-computed:
 *   business 1: two of each kind → CN-0001, CN-0002 · VC-0001, VC-0002 · SR-0001, SR-0002 · QT-0001, QT-0002 ·
 *   JE-0001, JE-0002 · PM-0001, PM-0002 (bug: CN-xxxx twice, the same 4 digits)
 *   business 2: its first credit note is CN-0001 (per business, bug: the same clock digits)
 *   a typed "CN-7" is kept; a second typed "CN-7" gets the next in sequence (CN-0003; the kept CN-7 used no counter value), never a duplicate
 *   five concurrent credit notes → five different numbers
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam6c-doc-numbers.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const J = r => { try { return JSON.parse(r.text); } catch (_) { return {}; } };
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  FA-M6c — every document number sequential per business\n' + '='.repeat(78) + '\n');
    const email = 'm6c@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const e1 = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'One', currency: 'USD', timezone: 'UTC', is_active: 1 }])).rows[0].id;
    const e2 = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Two', currency: 'USD', timezone: 'UTC', is_active: 0 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.97' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const q = e => '?entity_id=' + e;
    let k = 0; const key = () => 'm6c-' + (++k);
    const make = {
      cn: (e, extra) => http.post('/api/credit-notes' + q(e), Object.assign({ customer: 'Acme', amount: 10, date: '2026-07-10', idempotency_key: key() }, extra || {})),
      vc: e => http.post('/api/vendor-credits' + q(e), { vendor: 'Vee', amount: 10, date: '2026-07-10', idempotency_key: key() }),
      sr: e => http.post('/api/sales-receipts' + q(e), { customer: 'Walk-in ' + k, amount: 10 + k, date: '2026-07-10', idempotency_key: key() }),
      qt: e => http.post('/api/quotes' + q(e), { client: 'Prospect ' + (++k), amount: 100 + k, expiry_date: '2026-08-30' }),
      je: e => http.post('/api/journals' + q(e), { date: '2026-07-10', description: 'Accrual ' + (++k), lines: [{ code: '6000', debit: 5 + k }, { code: '2000', credit: 5 + k }], status: 'Draft', idempotency_key: key() }),
      pm: e => http.post('/api/payments-made' + q(e), { vendor: 'Vee ' + (++k), amount: 7 + k, date: '2026-07-10', idempotency_key: key() }),
    };
    const field = { cn: 'num', vc: 'num', sr: 'num', qt: 'num', je: 'ref', pm: 'ref' };
    const prefix = { cn: 'CN-', vc: 'VC-', sr: 'SR-', qt: 'QT-', je: 'JE-', pm: 'PM-' };
    for (const kind of Object.keys(make)) {
      const r1 = J(await make[kind](e1)), r2 = J(await make[kind](e1));
      const n1 = r1[field[kind]], n2 = r2[field[kind]];
      A(kind + '  two in business One → ' + prefix[kind] + '0001, ' + prefix[kind] + '0002 (bug: the same clock digits twice)', n1 === prefix[kind] + '0001' && n2 === prefix[kind] + '0002', JSON.stringify([n1, n2]));
    }
    const b2 = J(await make.cn(e2));
    A('business Two\'s first credit note is CN-0001 (per business)', b2.num === 'CN-0001', String(b2.num));
    const typed = J(await make.cn(e1, { num: 'CN-7' })), typed2 = J(await make.cn(e1, { num: 'CN-7' }));
    A('a typed "CN-7" is kept; typed again it gets the next in sequence (CN-0003 — a kept typed number uses no counter value), not a duplicate', typed.num === 'CN-7' && typed2.num === 'CN-0003', JSON.stringify([typed.num, typed2.num]));
    const many = (await Promise.all([1, 2, 3, 4, 5].map(() => make.cn(e1)))).map(r => J(r).num);
    A('five concurrent credit notes → five different numbers', new Set(many).size === 5 && many.every(n => /^CN-\d{4}$/.test(n)), JSON.stringify(many));
    const dup = (await c.query(`SELECT data->>'num' n, COUNT(*)::int c FROM credit_notes WHERE user_id=$1 AND entity_id=$2 GROUP BY 1 HAVING COUNT(*) > 1`, [uid, e1])).rows;
    A('no credit-note number appears twice in a business', dup.length === 0, JSON.stringify(dup));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (FA-M6c document numbers)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
