#!/usr/bin/env node
'use strict';
/**
 * verify-bank-import.js — F178. Bank statement import (OFX/QFX + CSV) — how ANY bank, including
 * local/Caribbean banks with no API, gets its transactions into the app. Executes the real endpoint
 * against real Postgres with real statement fixtures:
 *   - OFX parsed correctly (date, sign→tx_type, amount, description) into personal_transactions
 *   - idempotent: re-uploading the SAME statement imports 0 (FITID / content-hash dedupe)
 *   - CSV parsed with header auto-detect + sign handling
 *   - garbage rejected (400), unknown columns rejected (400)
 *   - RBAC: a viewer cannot import (coarse read-only gate)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-bank-import.js
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260710120000<TRNAMT>-45.00<FITID>TT001<NAME>REPUBLIC BANK GROCERY</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260712<TRNAMT>1200.00<FITID>TT002<NAME>SALARY DEPOSIT</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260715<TRNAMT>-9.99<FITID>TT003<NAME>STREAMING SVC<MEMO>monthly</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const CSV = `Date,Description,Amount
2026-07-18,FIRST CITIZENS ATM,-200.00
2026-07-19,CLIENT PAYMENT,500.00
2026/07/20,"WICKED, GOOD ROTI",-35.50`;

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const mkUser = async (email) => (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ownerId = await mkUser('bi-owner@finflow.test');
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`, [ownerId, { name: 'BI Co', currency: 'TTD', is_active: 1 }]);
    const viewerId = await mkUser('bi-viewer@finflow.test');
    await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId, { member_user_id: String(viewerId), status: 'active', role: 'viewer', name: 'V', email: 'bi-viewer@finflow.test' }]);
    const login = async (email) => { const h = new HarnessHttp(server.baseUrl); if ((await h.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + email); return h; };
    const bankRows = async () => (await c.query(`SELECT data->>'description' d, data->>'amount' a, data->>'tx_type' t, data->>'tx_date' dt FROM personal_transactions WHERE user_id=$1 AND data->>'source'='banking' ORDER BY data->>'tx_date'`, [ownerId])).rows;

    const owner = await login('bi-owner@finflow.test');

    console.log('\n' + '='.repeat(78));
    console.log('  BANK STATEMENT IMPORT — OFX/QFX + CSV, any bank, idempotent');
    console.log('='.repeat(78));

    // ── OFX ──
    console.log('\n-- OFX --');
    const o1 = await owner.post('/api/banking/import', { format: 'ofx', content: OFX });
    A('OFX import → 201, imported 3', o1.status === 201 && o1.json.imported === 3 && o1.json.skipped === 0, JSON.stringify(o1.json));
    let rows = await bankRows();
    A('3 banking rows landed', rows.length === 3, `rows=${rows.length}`);
    A('OFX debit sign parsed (−45.00 → debit 45)', rows.some(r => r.t === 'debit' && parseFloat(r.a) === 45 && /GROCERY/.test(r.d)));
    A('OFX credit parsed (1200 → credit)', rows.some(r => r.t === 'credit' && parseFloat(r.a) === 1200 && /SALARY/.test(r.d)));
    A('OFX date parsed (20260710 → 2026-07-10)', rows.some(r => r.dt === '2026-07-10'));

    // idempotency: same file again
    const o2 = await owner.post('/api/banking/import', { format: 'ofx', content: OFX });
    A('re-import same OFX → imported 0, skipped 3 (FITID dedupe)', o2.json.imported === 0 && o2.json.skipped === 3, JSON.stringify(o2.json));
    A('still only 3 rows (no double-import)', (await bankRows()).length === 3);

    // ── CSV ──
    console.log('\n-- CSV --');
    const cimp = await owner.post('/api/banking/import', { format: 'csv', content: CSV });
    A('CSV import → 201, imported 3', cimp.status === 201 && cimp.json.imported === 3, JSON.stringify(cimp.json));
    rows = await bankRows();
    A('now 6 banking rows total', rows.length === 6, `rows=${rows.length}`);
    A('CSV quoted comma field kept intact ("WICKED, GOOD ROTI")', rows.some(r => /WICKED, GOOD ROTI/.test(r.d) && parseFloat(r.a) === 35.5));
    A('CSV slash-date normalized (2026/07/20 → 2026-07-20)', rows.some(r => r.dt === '2026-07-20'));
    const c2 = await owner.post('/api/banking/import', { format: 'csv', content: CSV });
    A('re-import same CSV → imported 0 (content-hash dedupe)', c2.json.imported === 0 && c2.json.skipped === 3, JSON.stringify(c2.json));

    // ── validation + RBAC ──
    console.log('\n-- validation + RBAC --');
    A('empty content → 400', (await owner.post('/api/banking/import', { format: 'ofx', content: '' })).status === 400);
    A('OFX with no transactions → 400', (await owner.post('/api/banking/import', { format: 'ofx', content: '<OFX></OFX>' })).status === 400);
    A('CSV with unknown columns → 400', (await owner.post('/api/banking/import', { format: 'csv', content: 'foo,bar\n1,2' })).status === 400);
    const viewer = await login('bi-viewer@finflow.test');
    A('viewer import → 403 (read-only)', (await viewer.post('/api/banking/import', { format: 'ofx', content: OFX })).status === 403);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (bank statement import)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[bank-import] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
