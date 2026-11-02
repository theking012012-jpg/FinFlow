'use strict';
/**
 * verify-f90d-tamper-evident — F90 part 4. Every audit entry carries a fingerprint (SHA-256) of its content and of the
 * entry before it in the account's chain; "Verify trail" recomputes all of them and names the first entry that does
 * not hold. Changing a recorded value, or removing an entry, is detected — even by someone with direct database access
 * who turns the append-only guard off.
 *
 * BUG: nothing could tell whether the trail had been altered. The append-only trigger stops the app, but anyone able to
 * disable a trigger (a database admin, a leaked superuser) could edit or delete entries without a trace.
 *
 * Executed: real server + scratch Postgres (Rule 3) + the real /app in Chromium for the page. The failure paths are
 * executed with the guard actually disabled and the rows actually edited / deleted (Rule 14).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90d-tamper-evident.js
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('F90 part 4 — the trail is tamper-evident', async ({ open, A, eq, J, c, uid }) => {
  const inv = await J('POST', '/api/invoices', { client: 'Pier Co', amount: 1200, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01' });
  await J('PUT', '/api/invoices/' + inv.id, { amount: 1250 });
  await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-07-10', method: 'Bank' });
  // 20 writes at once: the chain must not fork (each entry its own number, each linked to the one before)
  await Promise.all(Array.from({ length: 20 }, (_, i) => J('POST', '/api/expenses', { description: 'Load ' + i, category: 'Travel', amount: 10 + i, expense_date: '2026-07-11', idempotency_key: 'f90d-' + i })));
  const v0 = await J('GET', '/api/audit-log/verify');
  const n = (await c.query(`SELECT count(*)::int n, count(DISTINCT chain_seq)::int d, max(chain_seq)::int m FROM audit_trail WHERE user_id = $1 AND chain_seq IS NOT NULL`, [uid])).rows[0];
  A('after normal use (incl. 20 concurrent writes): intact, every entry numbered once, no gaps', v0.intact === true && n.n === n.d && n.m === n.n && v0.entries === n.n && n.n >= 25, JSON.stringify({ v0, n }));

  const target = (await c.query(`SELECT id, chain_seq, new_data FROM audit_trail WHERE user_id = $1 AND table_name = 'invoices' AND action = 'UPDATE' ORDER BY id LIMIT 1`, [uid])).rows[0];
  // ── 1: someone turns the guard off and changes a recorded amount ──
  await c.query(`ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_mutate`);
  await c.query(`UPDATE audit_trail SET new_data = jsonb_set(new_data, '{amount}', '1300') WHERE id = $1`, [target.id]);
  const v1 = await J('GET', '/api/audit-log/verify');
  eq('a changed amount is found: not intact, at that entry, "changed after it was recorded"', [v1.intact, v1.problem && v1.problem.entry_id, v1.problem && /changed after it was recorded/.test(v1.problem.what)], [false, target.id, true], [true, null, false]);
  // …and if they also recompute that entry's own fingerprint, the NEXT entry's link gives it away
  await c.query(`UPDATE audit_trail a SET row_hash = encode(sha256(convert_to(ff_audit_content(a), 'UTF8')), 'hex') WHERE id = $1`, [target.id]);
  const v2 = await J('GET', '/api/audit-log/verify');
  eq('…even with its fingerprint recomputed: found at the next entry (the broken link)', [v2.intact, v2.problem && v2.problem.number], [false, Number(target.chain_seq) + 1], [true, null]);
  // put it back exactly → intact again (the check is about the content, nothing else)
  await c.query(`UPDATE audit_trail a SET new_data = $2::jsonb WHERE id = $1`, [target.id, JSON.stringify(target.new_data)]);
  await c.query(`UPDATE audit_trail a SET row_hash = encode(sha256(convert_to(ff_audit_content(a), 'UTF8')), 'hex') WHERE id = $1`, [target.id]);
  eq('restored exactly → intact again', (await J('GET', '/api/audit-log/verify')).intact, true);

  // ── 2: someone deletes an entry from the middle ──
  const mid = (await c.query(`SELECT id, chain_seq FROM audit_trail WHERE user_id = $1 AND chain_seq = 10`, [uid])).rows[0];
  await c.query(`DELETE FROM audit_trail WHERE id = $1`, [mid.id]);
  const v3 = await J('GET', '/api/audit-log/verify');
  eq('a removed entry is found: at #11, "removed or changed before this one"', [v3.intact, v3.problem && v3.problem.number, v3.problem && /removed or changed/.test(v3.problem.what)], [false, 11, true], [true, null, false]);
  await c.query(`ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_mutate`);

  // ── 3: the one change that IS allowed (LC3d-b: sign-in IP / device removed after an account is deleted) is not tampering ──
  const u2 = (await c.query(`INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, '{"email":"gone@finflow.test"}') RETURNING id`)).rows[0].id;
  await c.query(`INSERT INTO audit_trail (user_id, table_name, action, actor_type, actor_id, ip_address, user_agent) VALUES ($1, 'users', 'LOGIN', 'user', $1, '198.51.100.7', 'UA/1'), ($1, 'users', 'LOGIN', 'user', $1, '198.51.100.8', 'UA/2')`, [u2]);
  await c.query(`BEGIN`); await c.query(`SELECT set_config('finflow.strip_pii', $1, true)`, [String(u2)]);
  await c.query(`UPDATE audit_trail SET ip_address = NULL, user_agent = NULL WHERE user_id = $1`, [u2]); await c.query(`COMMIT`);
  const v4 = (await c.query(`SELECT * FROM ff_audit_verify($1)`, [u2])).rows[0];
  eq('IP / device removed under LC3d-b: that account\'s chain still verifies (2 entries, no problem)', [Number(v4.entries), v4.reason], [2, null]);

  // ── the page ──
  const page = await open({ width: 1400, height: 900 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.showPage('audit')); await page.waitForTimeout(1200);
  await page.evaluate(() => window.verifyAuditTrail()); await page.waitForTimeout(1200);
  const msg = await page.evaluate(() => (document.getElementById('audit-verify-result') || {}).textContent || '');
  A('the Audit page\'s "Verify trail" names the problem: "✗ Problem at entry #11 …"', /✗ Problem at entry #11/.test(msg), msg);
  eq('no page errors', errs, []);
}, {});
