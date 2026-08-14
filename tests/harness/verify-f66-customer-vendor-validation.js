'use strict';
/**
 * verify-f66-customer-vendor-validation.js — PROVE (Rule 14, real endpoints per Rule 3) that the
 * two formerly-unvalidated write routes now coerce+cap their string fields and reject a malformed
 * email, and DISCRIMINATE (Rule 4) that valid input is NOT blanket-rejected.
 *
 *   PUT  /api/customers/:id  — copied 8 fields RAW (object/array/500KB string → JSONB). Now capped.
 *   POST /api/vendors        — inserted name/contact/category RAW. Now capped.
 *   POST /api/customers      — capped, but never format-checked email. Now symmetric with PUT.
 *
 * Each assertion states what the PRE-FIX code produced, so the check is known to discriminate:
 *   - a malformed / object email returned 200 and stored the junk  → now 400
 *   - a 400KB string was stored whole                              → now length-capped
 *   - an object field was stored as an object in JSONB             → now a bounded string
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f66-customer-vendor-validation.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f66@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F66', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }])).rows[0].id;
    // F150 seed-debt fix: create an active entity so req.entityId resolves (production onboarding
    // POSTs /api/entities); without it, business-route writes stamp entity_id NULL → chk_*_entity_nn.
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'F66 Co', currency: 'USD', is_active: 1 }]);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    const BIG = 'x'.repeat(400000);

    // ── POST /api/customers ──────────────────────────────────────────────────
    // valid customer (control: a normal create still succeeds and is the row we PUT against)
    const mk = await http.post('/api/customers', { fname: 'Ada', lname: 'Lovelace', email: 'ada@calc.io', company: 'Analytical', notes: 'ok' });
    A('POST /api/customers valid → 201 (control: not blanket-rejected)', mk.status === 201, `status ${mk.status}`);
    const cid = mk.json && mk.json.id;

    const badEmailCreate = await http.post('/api/customers', { fname: 'B', email: 'not-an-email' });
    A('POST /api/customers malformed email → 400 (pre-fix: 201, stored junk)', badEmailCreate.status === 400, `status ${badEmailCreate.status}`);

    const noEmailCreate = await http.post('/api/customers', { fname: 'NoMail' });
    A('POST /api/customers absent email → 201 (empty email still allowed)', noEmailCreate.status === 201, `status ${noEmailCreate.status}`);

    // ── PUT /api/customers/:id ───────────────────────────────────────────────
    const objEmail = await http.put(`/api/customers/${cid}`, { email: { a: 1 } });
    A('PUT /api/customers object email → 400 (pre-fix: 200, stored {a:1})', objEmail.status === 400, `status ${objEmail.status}`);

    const badEmail = await http.put(`/api/customers/${cid}`, { email: 'garbage@@' });
    A('PUT /api/customers malformed email → 400', badEmail.status === 400, `status ${badEmail.status}`);

    const objField = await http.put(`/api/customers/${cid}`, { company: { evil: true } });
    A('PUT /api/customers object company → stored as STRING (pre-fix: raw object in JSONB)',
      objField.status === 200 && typeof objField.json.company === 'string',
      `status ${objField.status}, company typeof ${typeof (objField.json||{}).company}`);

    const bigNotes = await http.put(`/api/customers/${cid}`, { notes: BIG });
    A('PUT /api/customers 400KB notes → truncated to 500 (pre-fix: 400KB stored whole)',
      bigNotes.status === 200 && typeof bigNotes.json.notes === 'string' && bigNotes.json.notes.length === 500,
      `len ${(bigNotes.json && bigNotes.json.notes || '').length}`);

    const validPut = await http.put(`/api/customers/${cid}`, { email: 'ada2@calc.io', company: 'Babbage' });
    A('PUT /api/customers valid update → 200 + values stored (control: valid input accepted)',
      validPut.status === 200 && validPut.json.email === 'ada2@calc.io' && validPut.json.company === 'Babbage',
      JSON.stringify({ status: validPut.status, email: validPut.json && validPut.json.email, company: validPut.json && validPut.json.company }));

    // ── POST /api/vendors ────────────────────────────────────────────────────
    const objVendor = await http.post('/api/vendors', { name: 'Acme', contact: { phone: 5 }, category: 'supplies' });
    A('POST /api/vendors object contact → stored as STRING (pre-fix: raw object in JSONB)',
      (objVendor.status === 200 || objVendor.status === 201) && typeof objVendor.json.contact === 'string',
      `status ${objVendor.status}, contact typeof ${typeof (objVendor.json||{}).contact}`);

    const bigVendor = await http.post('/api/vendors', { name: BIG, contact: 'c', category: 'k' });
    A('POST /api/vendors 400KB name → truncated to 200 (pre-fix: 400KB stored whole)',
      (bigVendor.status === 200 || bigVendor.status === 201) && typeof bigVendor.json.name === 'string' && bigVendor.json.name.length === 200,
      `len ${(bigVendor.json && bigVendor.json.name || '').length}`);

    const validVendor = await http.post('/api/vendors', { name: 'Globex', contact: 'Hank', category: 'legal', owing: '250.50' });
    A('POST /api/vendors valid → name/contact stored + owing numeric (control: valid input accepted)',
      (validVendor.status === 200 || validVendor.status === 201) && validVendor.json.name === 'Globex' && validVendor.json.contact === 'Hank' && Number(validVendor.json.owing) === 250.5,
      JSON.stringify({ status: validVendor.status, name: validVendor.json && validVendor.json.name, owing: validVendor.json && validVendor.json.owing }));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
