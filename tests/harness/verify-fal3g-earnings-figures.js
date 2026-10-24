'use strict';
/**
 * verify-fal3g-earnings-figures.js — FA-L3g (Rule 2: one figure, every surface). What FinFlow collected in commission
 * and what an accountant has earned were computed separately on six surfaces, none of them right:
 *   admin overview "Commission Earned"        Σ amount_cents of EVERY row (accountants' nets + referral pay)
 *   admin earnings "Total Earned (Platform)"  Σ amount_cents of service rows (the ACCOUNTANT's net) incl. unpaid bills
 *   admin accountant detail "Total Earned"    incl. bills the client has not paid
 *   admin accountants list "clients"          COUNT(clients) × earnings rows (a join fan-out)
 *   accountant "Total Earned"                 the newest 100 rows only (LIMIT 100), incl. unpaid bills
 *   accountant "This Month"                   a paid service fee never counted (service rows had no period month)
 *
 * Real server + real Postgres; the service fee is paid through the REAL signed payment webhook. Hand-computed:
 *   A: referral $10.00 booked this month (pending) + $10.00 paid last month + 120 old $1.00 referral rows (2025)
 *      + a $500 bill PAID now (commission $50.00, est. Stripe fee $14.80 → net $435.20)
 *      + a $100 bill paid last month (commission $10.00, net $84.10) + a $200 bill NOT paid (commission $20.00, net $172.20)
 *      3 active clients
 *   B: a bill paid last month (commission $7.00, net $60.00)
 *   FinFlow commission collected = 50.00 + 10.00 + 7.00 = $67.00   (bug: $751.50 = every service net, unpaid included)
 *   overview Commission Earned     = $67.00                          (bug: $891.50 = every row, both accountants)
 *   A earned  = 10 + 10 + 120 + 435.20 + 84.10 = $659.30            (bug detail: $831.50 − $60.00 = $771.50 with the unpaid bill)
 *   A this month = 10.00 + 435.20 = $445.20                          (bug: $10.00 — the paid fee had no month)
 *   A billed, client not paid yet = $172.20 (shown apart)
 *   A clients = 3                                                    (bug: 3 × A's earnings rows)
 * Then the accountant dashboard and the admin page are rendered in jsdom from the REAL API responses.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal3g-earnings-figures.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_fal3g';
process.env.ADMIN_PASSWORD = 'harness-admin-fal3g';
require('./clock.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const usd = c => '$' + (Number(c) / 100).toFixed(2);
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    const database = require('../../database.js');
    await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const stripe = app._stripe();

    const PW = 'fal3g-pw-1';
    const mkAcc = async (tag) => (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, stripe_account_id)
      VALUES ($1, $2, $3, 'Earner', 'Firm', $4, 'verified', $5) RETURNING id`, [`fal3g-${tag}@finflow.test`, bcrypt.hashSync(PW, 10), 'Acc' + tag.toUpperCase(), 'FAL3G' + tag.toUpperCase(), 'acct_' + tag])).rows[0].id;
    const accA = await mkAcc('a'), accB = await mkAcc('b');
    for (const n of [1, 2, 3]) {
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: `fal3g-c${n}@finflow.test`, plan: 'business', role: 'owner', subscriptionStatus: 'trialing' }])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, requested_by) VALUES ($1,$2,'active','client')`, [accA, uid]);
    }
    const ins = (acc, type, amount, status, period, extra) => c.query(
      `INSERT INTO accountant_earnings (accountant_id, type, amount_cents, billed_cents, commission_cents, stripe_fee_cents, description, status, period_month, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${period},${(extra && extra.created) || 'NOW()'}) RETURNING id`,
      [acc, type, amount, extra && extra.billed || null, extra && extra.commission || null, extra && extra.fee || null, (extra && extra.desc) || type, status]);
    const THIS = "date_trunc('month', NOW())::date", LAST = "(date_trunc('month', NOW()) - interval '1 month')::date";
    for (let i = 0; i < 120; i++) await ins(accA, 'referral', 100, 'paid', "'2025-01-01'", { created: "'2025-01-15T10:00:00Z'" });
    await ins(accA, 'referral', 1000, 'paid', LAST);
    await ins(accA, 'service_commission', 8410, 'paid', LAST, { billed: 10000, commission: 1000, fee: 590 });
    await ins(accB, 'service_commission', 6000, 'paid', LAST, { billed: 7000, commission: 700, fee: 300 });
    await ins(accA, 'service_commission', 17220, 'awaiting_payment', 'NULL', { billed: 20000, commission: 2000, fee: 780, desc: 'Unpaid bill' });
    const bill = (await ins(accA, 'service_commission', 43520, 'awaiting_payment', 'NULL', { billed: 50000, commission: 5000, fee: 1480, desc: 'Q3 bookkeeping' })).rows[0].id;
    await ins(accA, 'referral', 1000, 'pending', THIS);

    // the client pays the $500 bill — the real signed webhook
    const payload = JSON.stringify({ id: 'evt_fal3g_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_fal3g_1', object: 'payment_intent', metadata: { kind: 'accountant_bill', accountant_id: String(accA), earning_id: String(bill) } } } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const wh = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    const paidRow = (await c.query(`SELECT status, amount_cents, period_month FROM accountant_earnings WHERE id=$1`, [bill])).rows[0];
    const thisMonth = (await c.query(`SELECT ${THIS} AS p`)).rows[0].p;
    A('the $500 bill is paid through the webhook: paid, net $435.20, booked in this month (bug: no month)', wh.status === 200 && paidRow.status === 'paid' && paidRow.amount_cents === 43520 && paidRow.period_month === thisMonth, JSON.stringify(paidRow) + ' this=' + thisMonth);

    console.log('\n' + '='.repeat(78) + '\n  FA-L3g — commission collected and accountant earnings, one figure on every surface\n' + '='.repeat(78) + '\n');
    // accountant side
    const acc = new HarnessHttp(base, { xff: '10.94.0.1' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'fal3g-a@finflow.test', password: PW })).status === 200);
    const er = await acc.get('/api/accountants/earnings');
    const s = (er.json || {}).summary || {};
    A('accountant earned $659.30 — booked referral pay + paid fees, all rows (bug: newest 100 rows, unpaid bill included)', s.earnedCents === 65930, JSON.stringify(s));
    A('accountant this month $445.20 — this month\'s $10.00 + the fee paid now (bug: $10.00)', s.thisMonthCents === 44520, JSON.stringify(s));
    A('accountant: billed, client has not paid yet $172.20 — shown apart', s.awaitingClientCents === 17220, JSON.stringify(s));
    A('accountant: referral pay still owed $10.00', s.referralOwedCents === 1000, JSON.stringify(s));

    // admin side
    const adm = new HarnessHttp(base, { xff: '10.94.0.2' });
    A('admin login', (await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const ov = (await adm.get('/api/admin/overview')).json || {};
    A('admin overview "Commission Earned" $67.00 = Σ commission on PAID bills (bug: $891.50 — every row)', ov.earnings && ov.earnings.commissionCollectedCents === 6700, JSON.stringify(ov.earnings));
    const ea = (await adm.get('/api/admin/earnings')).json || {};
    A('admin earnings: commission collected $67.00 (bug: $751.50 — the accountants\' nets, unpaid included)', ea.summary && Number(ea.summary.commission_collected_cents) === 6700, JSON.stringify(ea.summary));
    const det = (await adm.get('/api/admin/accountants/' + accA)).json || {};
    const dA = det.accountant || det;
    A('admin accountant detail "Total Earned" $659.30 (bug: $831.50 with the unpaid bill)', Number(dA.total_earnings_cents) === 65930, String(dA.total_earnings_cents));
    const list = (await adm.get('/api/admin/accountants')).json;
    const rowA = (Array.isArray(list) ? list : (list && (list.accountants || list.rows)) || []).find(r => r.id === accA) || {};
    A('admin accountants list: A has 3 clients (bug: 3 × A\'s earnings rows)', Number(rowA.client_count) === 3, String(rowA.client_count));

    // the pages, rendered from the REAL responses above
    const render = async (file, api) => {
      let html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
      const stub = `<script>window.fetch=function(u){var p=String(u).split('?')[0];var data=(${JSON.stringify(api)})[p];return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(data==null?{}:data);}});};window.open=function(){};window.Chart=function(){this.destroy=function(){};};HTMLCanvasElement.prototype.getContext=function(){return {};};</script>`;
      html = html.replace(/<head>/i, () => '<head>' + stub)
        .replace('<script src="/tier-config.js"></script>', () => '<script>' + fs.readFileSync(path.join(ROOT, 'tier-config.js'), 'utf8') + '</script>')
        .replace('<script src="/finflow-dates.js"></script>', () => '<script>' + fs.readFileSync(path.join(ROOT, 'public', 'finflow-dates.js'), 'utf8') + '</script>');
      const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://finflow.test/' + file }).window;
      for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 40));
      return w;
    };
    const wA = await render('accountant-dashboard.html', { '/api/accountants/earnings': er.json, '/api/accountants/me': { first_name: 'A', status: 'verified', conduct: { accepted: true, version: '1.0', current: '1.0', blocked: false } }, '/api/accountants/clients': [], '/api/accountants/pending-requests': [], '/api/accountants/deadlines': [] });
    try { await wA.loadEarnings(); } catch (_) {}
    const t = id => ((wA.document.getElementById(id) || {}).textContent || '').trim();
    A('dashboard shows Total Earned $659.30 · This Month $445.20 · Pending Payout $10.00', t('earn-total') === '$659.30' && t('earn-mtd') === '$445.20' && t('earn-pending') === '$10.00', [t('earn-total'), t('earn-mtd'), t('earn-pending')].join(' · '));
    A('  …and says $172.20 is billed, waiting for the client', /\$172\.20/.test(t('earn-total-sub')), t('earn-total-sub'));
    wA.close();
    const wD = await render('admin.html', { '/api/admin/overview': ov, '/api/admin/earnings': ea });
    try { await wD.loadOverview(); } catch (_) {}
    try { await wD.loadEarnings(); } catch (_) {}
    const u = id => ((wD.document.getElementById(id) || {}).textContent || '').trim();
    A('admin page shows Commission Earned $67.00 (overview) and $67.00 (earnings)', u('ov-commission') === '$67.00' && u('earn-commission') === '$67.00', u('ov-commission') + ' / ' + u('earn-commission'));
    wD.close();
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await new Promise(r => server.close(r)); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-L3g earnings figures)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
