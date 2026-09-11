#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-proof-required.js — MANDATORY PROOF at accountant registration, EXECUTED.
 *
 * WHAT WENT WRONG BEFORE: POST /api/accountants/register required a verification METHOD
 * (`verification.method`) and nothing else. A method is a RADIO CHOICE — a claim about how the
 * applicant *intends* to prove their credentials — not proof. So an applicant could send
 * `{ verification: { method: 'membership' } }` with no membership number, no registry body and no
 * credential document, and the server returned 201 with status 'pending': a row sitting in the
 * admin queue with literally nothing for an admin to review. The admin's only options were to
 * reject blind or approve blind. Approving blind is how an unlicensed party reaches a client's
 * books through the accountant marketplace.
 *
 * THE FIX: at least ONE concrete, reviewable artefact is required — a VALID credential document, OR
 * a professional membership / registration number (either `verification.membershipNumber` or the
 * CV-extracted top-level `memberships`). Admin review still confirms it; this gate only guarantees
 * there is something to confirm.
 *
 * DISCRIMINATION (Rule 4) — the buggy value is stated per case:
 *
 *   case                                    PRE-FIX (buggy)           POST-FIX (correct)
 *   --------------------------------------- ------------------------- ------------------------
 *   method only, no doc, no number          201 + row, status pending  400, ZERO rows
 *   method + whitespace-only number ('  ')  201 + row                  400, ZERO rows
 *   invalid doc + no number                 400 (doc error)            400 (doc error)
 *   method + membershipNumber               201 + row                  201 + row   (unchanged)
 *   method + top-level `memberships`        201 + row                  201 + row   (unchanged)
 *   method + valid credentialDoc            201 + row + document       201 + row + document
 *
 * The two REJECT cases are the discriminators: pre-fix they return 201 and INSERT a row, so this
 * harness cannot go green against the old code. The three ACCEPT cases are the counterweight —
 * they prove the gate is a PROOF gate and not a blanket "registration is broken", which a
 * reject-only harness would pass just as happily.
 *
 * ROW COUNTS, NOT JUST STATUS. Each reject also asserts `SELECT count(*) FROM accountants` is
 * UNCHANGED. A 400 returned *after* the INSERT would look identical on status alone and would still
 * leave the unreviewable row in the admin queue — the actual harm. Rule 5: executed values.
 *
 * Real scratch Postgres, real schema, real endpoint (Rule 3). Each request carries its own
 * X-Forwarded-For so the authLimiter (max 10 / 15 min / IP, server.js:480) never colours a result.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-proof-required.js
 */

require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name))
                                : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

// A real (tiny) PDF, base64 — a genuinely valid credentialDoc, not a placeholder string.
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');

const BASE = {
  firstName: 'Ada', lastName: 'Lovelace', password: 'harness-password-not-a-secret',
  firm: 'Lovelace & Co', country: 'GB', specialisation: 'tax', bio: 'Chartered.', experience: '10',
};

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    let ip = 0;
    const countRows = async () => parseInt((await c.query('SELECT count(*)::int AS n FROM accountants')).rows[0].n, 10);
    // Every call gets a fresh client on a fresh forwarded IP -> its own rate-limit bucket.
    const register = async (payload) => {
      const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.' + (++ip) });
      return http.post('/api/accountants/register', Object.assign({}, BASE, payload));
    };
    const rowFor = async (email) => (await c.query(
      'SELECT id, status, verification_method, verification_data, memberships FROM accountants WHERE email = $1',
      [email.toLowerCase()])).rows[0] || null;

    A('precondition: the accountants table starts empty', (await countRows()) === 0);

    // -- REJECT 1 -- a METHOD alone is not proof --------------------------------------------------
    // PRE-FIX THIS RETURNS 201 AND INSERTS A ROW. That is the defect, stated as a number.
    let before = await countRows();
    let r = await register({ email: 'noproof@finflow.test', verification: { method: 'membership' } });
    A('[GATE] method only, no doc, no membership number -> 400 (pre-fix: 201)',
      r.status === 400, `status=${r.status} body=${String(r.text).slice(0, 200)}`);
    let after = await countRows();
    A('[GATE] the rejected application inserted NO accountant row (pre-fix: +1 pending row)',
      after === before, `count went ${before} -> ${after}`);
    A('[GATE] the 400 names PROOF as the missing thing (an admin-actionable message)',
      /proof of credentials/i.test(String(r.text)), `body=${String(r.text).slice(0, 200)}`);

    // -- REJECT 2 -- a whitespace-only number is not a number --------------------------------------
    // Discriminates a gate that merely checks TRUTHINESS ('   ' is truthy) from one that trims.
    before = await countRows();
    r = await register({ email: 'blankno@finflow.test', verification: { method: 'membership', profBody: 'ACCA', membershipNumber: '   ' } });
    A('[GATE] whitespace-only membershipNumber -> 400 (a truthiness-only gate would pass this)',
      r.status === 400, `status=${r.status} body=${String(r.text).slice(0, 200)}`);
    after = await countRows();
    A('[GATE] whitespace-only number inserted NO row', after === before, `count went ${before} -> ${after}`);

    // -- REJECT 3 -- an INVALID document with no membership number is still no proof ---------------
    // A present-but-invalid file must not be silently dropped and then let through by the fallback.
    before = await countRows();
    r = await register({
      email: 'badtype@finflow.test', verification: { method: 'document' },
      credentialDoc: { fileName: 'cert.exe', mediaType: 'application/x-msdownload', base64: PDF_B64 },
    });
    A('[GATE] invalid credentialDoc + no membership number -> 400',
      r.status === 400, `status=${r.status} body=${String(r.text).slice(0, 200)}`);
    after = await countRows();
    A('[GATE] invalid-document application inserted NO row', after === before, `count went ${before} -> ${after}`);

    // -- ACCEPT 1 -- a membership number IS proof --------------------------------------------------
    r = await register({ email: 'member@finflow.test',
      verification: { method: 'membership', profBody: 'ACCA', membershipNumber: 'ACCA-778899' } });
    A('[GATE] membership number only -> accepted (201)', r.status === 201, `status=${r.status} body=${String(r.text).slice(0, 200)}`);
    let row = await rowFor('member@finflow.test');
    A('membership applicant landed in the queue as PENDING (never auto-verified)',
      !!row && row.status === 'pending', `status=${row && row.status}`);
    // The proof must be REVIEWABLE -- a gate that accepts the number but stores nothing leaves the
    // admin exactly as blind as before, which is the defect wearing a green test.
    const vd = row && (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data);
    A('the membership number is PERSISTED for admin review (verification_data.membershipNumber)',
      !!vd && vd.membershipNumber === 'ACCA-778899', `verification_data=${JSON.stringify(vd)}`);

    // -- ACCEPT 2 -- the CV-extracted top-level `memberships` field is proof too -------------------
    r = await register({ email: 'cvmember@finflow.test', verification: { method: 'cv' }, memberships: 'ICAEW #55123' });
    A('[GATE] top-level `memberships` (CV-extracted) only -> accepted (201)',
      r.status === 201, `status=${r.status} body=${String(r.text).slice(0, 200)}`);
    row = await rowFor('cvmember@finflow.test');
    A('the CV-extracted membership string is PERSISTED (accountants.memberships)',
      !!row && row.memberships === 'ICAEW #55123', `memberships="${row && row.memberships}"`);

    // -- ACCEPT 3 -- a VALID document is proof, with no membership number at all -------------------
    r = await register({
      email: 'doconly@finflow.test', verification: { method: 'document' },
      credentialDoc: { fileName: 'practising-licence.pdf', mediaType: 'application/pdf', base64: PDF_B64 },
    });
    A('[GATE] valid credential document only (no membership number) -> accepted (201)',
      r.status === 201, `status=${r.status} body=${String(r.text).slice(0, 200)}`);
    row = await rowFor('doconly@finflow.test');
    const docs = row ? (await c.query(
      `SELECT doc_type, media_type, file_name FROM accountant_documents WHERE accountant_id = $1`, [row.id])).rows : [];
    A('the credential document is PERSISTED and reviewable (accountant_documents row)',
      docs.length === 1 && docs[0].doc_type === 'credential_proof' && docs[0].media_type === 'application/pdf',
      `docs=${JSON.stringify(docs)}`);

    // -- the ledger: exactly the three ACCEPTED applications exist ---------------------------------
    // Pre-fix this is 5 (the two proof-less rejects also landed). The single number that
    // summarises the whole gate.
    after = await countRows();
    A('[GATE] exactly 3 accountants exist -- the 3 accepted, none of the rejects (pre-fix: 5)',
      after === 3, `count=${after}`);

    // -- the METHOD requirement is still enforced (this gate ADDED to it, did not replace it) ------
    before = await countRows();
    r = await register({ email: 'nomethod@finflow.test', memberships: 'ICAJ #1' });
    A('a missing verification.method is still a 400 (the pre-existing rule survives)',
      r.status === 400 && /verification method/i.test(String(r.text)),
      `status=${r.status} body=${String(r.text).slice(0, 200)}`);
    after = await countRows();
    A('the method-less application inserted NO row', after === before, `count went ${before} -> ${after}`);

  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e && e.errors) console.error('  AggregateError.errors:', e.errors.map(x => x && x.message));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { await scratch.stop(); } catch {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (accountant registration: mandatory proof)\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main();
