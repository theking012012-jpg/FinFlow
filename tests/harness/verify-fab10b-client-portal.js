'use strict';
/**
 * FA-B10b (2026-10-27) — the client portal: a private, expiring, revocable link where a customer sees their open and paid
 * invoices and what they owe, and pays online through the business's own payment-link writer. No account needed.
 *
 * BUG (executed on the old code): the feature did not exist — POST /api/customers/:id/portal-link and /api/portal/view
 * were 404 (the app's JSON 404), so a customer could only be emailed one invoice at a time.
 *
 * Seed "P Co" (USD; harness clock 2026-07-25). Customer "Acme Ltd":
 *   I1 pending 250, due 2026-07-10 (overdue)     I2 400, due 2026-08-20, 150 paid → partial, owes 250
 *   I3 300 paid in full                          I4 draft 100 (never shown)
 *   I5 pending 70, due 2026-08-01 — an OLDER invoice saved before links existed (no customer_id, name "Acme Ltd")
 * Customer "Beta" — I6 pending 999 (another customer's: never on Acme's page).
 * Hand-computed: open, by due date = I1 250 · I5 70 · I2 250 → owed 570, overdue 250; paid = I3.
 *   bug shapes: draft counted 670 · face value of the part-paid one 720 · Beta's included 1569 · legacy dropped 500
 */
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('FA-B10b — the client portal', async ({ newOwner, c, eq, server }) => {
  const { J, http, ids: [eid], uid } = await newOwner('P');
  const inv = (client, amount, due, key, status = 'pending') => J('POST', '/api/invoices', { client, amount, status, issue_date: '2026-06-10', due_date: due, idempotency_key: key });
  const i1 = await inv('Acme Ltd', 250, '2026-07-10', 'p-1');
  const i2 = await inv('Acme Ltd', 400, '2026-08-20', 'p-2');
  await J('POST', '/api/invoice-payments', { invoice_id: i2.id, amount: 150, payment_date: '2026-07-01', method: 'Bank', idempotency_key: 'p-2p' });
  const i3 = await inv('Acme Ltd', 300, '2026-07-05', 'p-3');
  await J('POST', '/api/invoice-payments', { invoice_id: i3.id, amount: 300, payment_date: '2026-07-04', method: 'Bank', idempotency_key: 'p-3p' });
  const i4 = await inv('Acme Ltd', 100, '2026-08-30', 'p-4', 'draft');
  const i5 = (await c.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1, $2, $3) RETURNING id`,
    [uid, eid, { client: 'Acme Ltd', number: 'INV-OLD-5', amount: 70, amount_paid: 0, status: 'pending', issue_date: '2026-05-01', due_date: '2026-08-01' }])).rows[0].id;
  await inv('Beta', 999, '2026-07-15', 'p-6');
  const acme = (await c.query(`SELECT id FROM customers WHERE entity_id = $1 AND data->>'company' = 'Acme Ltd'`, [eid])).rows[0].id;

  const made = await http.request('POST', '/api/customers/' + acme + '/portal-link', {});
  eq('1  the owner makes a portal link for Acme', made.status, 201, 404);
  const url = made.json && made.json.link && made.json.link.url;
  const token = url ? url.split('#')[1] : '';
  eq('1  …a /portal#<token> link, the token in the fragment (never sent to a server), 43 characters of random', [/\/portal#/.test(url || ''), token.length], [true, 43]);
  const stored = (await c.query(`SELECT token_hash, token_enc FROM customer_portal_links WHERE customer_id = $1`, [acme])).rows[0] || {};
  eq('1  the token itself is not stored — only its hash, and an encrypted copy for the owner', [stored.token_hash === require('crypto').createHash('sha256').update(token).digest('hex'), String(stored.token_enc || '').includes(token)], [true, false]);

  const pub = new HarnessHttp(server.baseUrl, { xff: '198.51.100.7' });   // a stranger's browser — no session
  const view = await pub.request('POST', '/api/portal/view', { token });
  const v = view.json || {};
  eq('2  the customer opens it with no account', view.status, 200, 404);
  eq('2  open invoices, by due date: I1 250 (overdue) · I5 70 (older, linked by name) · I2 250 (part-paid)', (v.open || []).map(i => [i.id, i.balance, i.overdue]),
    [[i1.id, 250, true], [i5, 70, false], [i2.id, 250, false]]);
  eq('2  owed 570 · overdue 250', [v.total_due, v.overdue_due], [570, 250], [670, 250]);
  eq('2  the part-paid one shows 150 of 400 paid', (v.open || []).filter(i => i.id === i2.id).map(i => [i.amount, i.paid]), [[400, 150]]);
  eq('2  paid: I3 only — no draft, nothing of Beta\'s', (v.paid || []).map(i => i.id), [i3.id]);
  eq('2  business and customer named; no processor connected → cannot pay online', [v.business && v.business.name, v.business && v.business.currency, v.customer && v.customer.name, v.can_pay], ['P Co', 'USD', 'Acme Ltd', false]);
  eq('2  nothing internal leaks (ids of other customers, owner email, the token)', /999|Beta|@finflow\.test/.test(view.text) || view.text.includes(token), false);

  const pay = await pub.request('POST', '/api/portal/pay', { token, invoice_id: i1.id });
  eq('3  pay with no processor → 400, says to contact the business', [pay.status, pay.json && pay.json.code], [400, 'NO_PAYMENT_PROVIDER']);
  // A link made earlier for exactly what is owed (I1: 250) is handed back — the same writer's stored link, no new checkout.
  await c.query(`UPDATE invoices SET data = data || $2::jsonb WHERE id = $1`, [i1.id, { payment_link: 'https://pay.example/i1', payment_link_amount: 250 }]);
  const pay2 = await pub.request('POST', '/api/portal/pay', { token, invoice_id: i1.id });
  eq('3  …an existing link for the amount owed is reused', [pay2.status, pay2.json && pay2.json.payment_link], [200, 'https://pay.example/i1']);
  await c.query(`UPDATE invoices SET data = data || $2::jsonb WHERE id = $1`, [i2.id, { payment_link: 'https://pay.example/i2-full', payment_link_amount: 400 }]);
  eq('3  …a stale link for a different amount (400 vs 250 owed) is NOT handed out', (await pub.request('POST', '/api/portal/pay', { token, invoice_id: i2.id })).status, 400, 200);
  const beta = (await c.query(`SELECT id FROM invoices WHERE entity_id = $1 AND data->>'client' = 'Beta'`, [eid])).rows[0].id;
  eq('3  another customer\'s invoice, a paid one, a draft → 404', await Promise.all([beta, i3.id, i4.id].map(async id => (await pub.request('POST', '/api/portal/pay', { token, invoice_id: id })).status)), [404, 404, 404]);

  eq('4  the owner sees it was opened (1 view)', ((await J('GET', '/api/customers/' + acme + '/portal-link')).link || {}).view_count, 1);
  const again = await J('POST', '/api/customers/' + acme + '/portal-link', {});
  const token2 = again.link.url.split('#')[1];
  eq('4  a new link replaces the old: old → 404, new → 200', [(await pub.request('POST', '/api/portal/view', { token })).status, (await pub.request('POST', '/api/portal/view', { token: token2 })).status], [404, 200]);
  await c.query(`UPDATE customer_portal_links SET expires_at = NOW() - interval '1 minute' WHERE customer_id = $1 AND revoked_at IS NULL`, [acme]);
  eq('4  an expired link → 404', (await pub.request('POST', '/api/portal/view', { token: token2 })).status, 404, 200);
  const third = (await J('POST', '/api/customers/' + acme + '/portal-link', {})).link.url.split('#')[1];
  eq('4  turned off → 404, and a second turn-off says there is none', [(await http.request('DELETE', '/api/customers/' + acme + '/portal-link')).status, (await pub.request('POST', '/api/portal/view', { token: third })).status, (await http.request('DELETE', '/api/customers/' + acme + '/portal-link')).status], [200, 404, 404]);
  eq('4  a made-up token → 404 with the same message as a revoked one', [(await pub.request('POST', '/api/portal/view', { token: 'x'.repeat(43) })).status, (await pub.request('POST', '/api/portal/view', { token: third })).json.code], [404, 'PORTAL_LINK_INACTIVE']);

  const other = await newOwner('Q');
  eq('5  another owner cannot make or read a link for this owner\'s customer', [(await other.http.request('POST', '/api/customers/' + acme + '/portal-link', {})).status, (await other.http.request('GET', '/api/customers/' + acme + '/portal-link')).status], [404, 404]);
  eq('5  making and turning off a link are in the audit trail (on the customer)', (await c.query(`SELECT new_data::jsonb->>'portal_link' p FROM audit_trail WHERE user_id = $1 AND table_name = 'customers' AND record_id = $2 AND new_data::jsonb ? 'portal_link' ORDER BY id`, [uid, acme])).rows.map(r => r.p), ['shared', 'shared', 'shared', 'revoked']);

  const page = await pub.request('GET', '/portal');
  const csp = String(page.headers.get('content-security-policy') || '');
  eq('6  the page is served with a strict policy (no inline code allowed), never indexed', [page.status, /script-src 'self';/.test(csp) && !/unsafe-inline/.test(csp), page.headers.get('x-robots-tag')], [200, true, 'noindex, nofollow']);
});
