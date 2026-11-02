'use strict';
/**
 * verify-c1-idempotency — C1 / F92 / CLAUDE.md Rule 9: double-submit protection is ONE shared mechanism at the write,
 * not a guard per button and not a time window. Every mutating /api request with an Idempotency-Key runs once per
 * (actor, key) — the database's unique key decides (idempotency_keys); a repeat gets the first response back; every
 * page sends a key on every write (public/ff-idem.js). Before: 14 money tables had their own key index; 16 create
 * routes had only the 5-second findRecentDuplicate window (a slow double-submit, or one differing field, beat it).
 * Real server, scratch Postgres, the real /app in Chromium (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-idempotency.js
 *
 * Bug values (HEAD): the header is ignored — two concurrent identical submits with one key on routes the window does
 * not catch, and a retry 6 s later, create 2 rows (the window is 5 s); no Idempotent-Replayed answer; no 422.
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('C1 — one idempotency mechanism for every write', async ({ open, A, eq, J, http, c, uid, base }) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const post = (p, body, key) => fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Cookie: [...http.cookies.entries()].map(([k, v]) => k + '=' + v).join('; '), 'X-Forwarded-For': '203.0.113.77' }, key ? { 'Idempotency-Key': key } : {}), body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, replay: r.headers.get('Idempotent-Replayed'), json: await r.json().catch(() => null) }));
  const rows = async (table) => (await c.query(`SELECT count(*)::int n FROM ${table} WHERE user_id = $1`, [uid])).rows[0].n;
  const projId = (await J('POST', '/api/projects', { name: 'Base project', client: 'X', budget: 100 })).id;

  // ── the class: 10 different create routes that had no database guard (Rule 13), each hit by two identical
  //    CONCURRENT submits with one key → exactly one row, the second answer is the first's (replayed)
  const ROUTES = [
    ['customers', '/api/customers', { company: 'Idem Customer Ltd', fname: '', lname: '' }],
    ['vendors', '/api/vendors', { name: 'Idem Vendor' }],
    ['payroll', '/api/payroll', { fname: 'Ida', lname: 'Em', gross: 2000 }],
    ['projects', '/api/projects', { name: 'Idem Project', client: 'Y', budget: 500 }],
    ['quotes', '/api/quotes', { client: 'Idem Quote Co', amount: 100, expiry_date: '2026-08-30' }],
    ['recurring_invoices', '/api/recurring-invoices', { client: 'Idem Retainer', amount: 500, frequency: 'Monthly', next_run: '2026-08-01', status: 'active' }],
    ['goals', '/api/goals', { name: 'Idem Goal', target_val: 3000, current_val: 0 }],
    ['personal_accounts', '/api/personal-accounts', { name: 'Idem Car', kind: 'asset', type: 'other', value: 1000 }],
    ['timesheet', '/api/timesheet', { employee: 'Idem Sam', project_id: projId, date: '2026-07-10', hours: 2, billable: 'Yes', rate: 100 }],
    ['items', '/api/items', { name: 'Idem Item', type: 'Service', price: 50 }],
  ];
  for (const [table, path, body] of ROUTES) {
    const before = await rows(table);
    const k = 'c1-' + table + '-concurrent-01';
    const [a, b] = await Promise.all([post(path, body, k), post(path, body, k)]);
    const after = await rows(table);
    const ok = [a, b].filter(x => x.status < 300);
    A(`${path}: two concurrent submits with one key → one row, the second is the first's answer`, after - before === 1 && ok.length === 2 && [a.replay, b.replay].includes('true') && a.json && b.json && a.json.id != null && a.json.id === b.json.id,
      JSON.stringify({ added: after - before, statuses: [a.status, b.status], replay: [a.replay, b.replay] }));
  }

  // ── the slow double-submit (the 5-second window's blind spot)
  const c0 = await rows('customers');
  const s1 = await post('/api/customers', { company: 'Slow Submit Co', fname: '', lname: '' }, 'c1-slow-submit-0001');
  await sleep(6000);
  const s2 = await post('/api/customers', { company: 'Slow Submit Co', fname: '', lname: '' }, 'c1-slow-submit-0001');
  eq('a retry 6 s later with the same key: still one customer (bug: 2 — the window is 5 s)', [await rows('customers') - c0, s2.replay, s2.json && s2.json.id === (s1.json && s1.json.id)], [1, 'true', true], [2, null, false]);
  // a NEW key is a new operation (goals: no name rule, and 6 s apart so the old window is out of the picture)
  const g0 = await rows('goals');
  await post('/api/goals', { name: 'Twice Goal', target_val: 10, current_val: 0 }, 'c1-new-key-00000a');
  await sleep(6000);
  const d1 = await post('/api/goals', { name: 'Twice Goal', target_val: 10, current_val: 0 }, 'c1-new-key-00000b');
  eq('a NEW key is a new operation: the same goal entered again later is created', [d1.status < 300, d1.replay, await rows('goals') - g0], [true, null, 2]);
  const r422 = await post('/api/customers', { company: 'Something Else', fname: '', lname: '' }, 'c1-slow-submit-0001');
  eq('the same key on a different request → 422 IDEMPOTENCY_KEY_REUSED (a key names one operation)', [r422.status, r422.json && r422.json.code], [422, 'IDEMPOTENCY_KEY_REUSED'], [201, undefined]);
  const bad = await post('/api/customers', { company: 'Bad Key Co', fname: '', lname: '' }, 'x');
  eq('a malformed key → 400', bad.status, 400);
  const v1 = await post('/api/customers', { company: '', fname: '', lname: '' }, 'c1-validation-0001');
  const v2 = await post('/api/customers', { company: '', fname: '', lname: '' }, 'c1-validation-0001');
  eq('a validation error is stored and replayed as the same error', [v1.status, v2.status, v2.replay], [400, 400, 'true']);
  // keys are per actor: another person's identical key is their own operation
  const stored = (await c.query(`SELECT actor, response_status FROM idempotency_keys WHERE key = 'c1-slow-submit-0001'`)).rows;
  eq('the key is stored once, scoped to this person, with the answer it gave', stored.map(r => [r.actor, r.response_status]), [['u:' + uid, 201]]);

  // ── the page: every write gets a key; a double-click is one operation; background writes are each their own
  const page = await open({ width: 1280, height: 900 });
  const seen = [];
  await page.route('**/api/**', route => { const r = route.request(); if (r.method() !== 'GET') seen.push({ p: new URL(r.url()).pathname, k: r.headers()['idempotency-key'] || null }); route.continue(); });
  const res = await page.evaluate(async () => {
    const btn = document.createElement('button'); btn.id = 'c1-btn'; btn.textContent = 'Save'; document.body.appendChild(btn);
    const other = document.createElement('button'); other.id = 'c1-other'; document.body.appendChild(other);
    const send = () => fetch('/api/vendors', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Double Click Vendor' }) }).then(r => r.status);
    btn.addEventListener('click', () => { window.__p = (window.__p || []).concat(send()); });
    let replays = 0; window.addEventListener('ff:idempotent-replay', () => replays++);
    btn.click(); await new Promise(r => setTimeout(r, 40)); btn.click();          // a double-click
    await Promise.all(window.__p);
    other.click();
    const s3 = await send();                                                        // a new gesture, same body
    await new Promise(r => setTimeout(r, 3500));
    const bg1 = fetch('/api/goals', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'BG', target_val: 1, current_val: 0 }) });
    const bg2 = fetch('/api/goals', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'BG', target_val: 1, current_val: 0 }) });
    await Promise.all([bg1, bg2]);
    return { replays, s3 };
  });
  const v = seen.filter(x => x.p === '/api/vendors'), g = seen.filter(x => x.p === '/api/goals');
  A('every /api write from the page carries an Idempotency-Key', seen.length >= 5 && seen.every(x => x.k && /^ff1-[0-9a-f]{16}-/.test(x.k)), JSON.stringify(seen));
  A('a double-click sends the SAME key twice; a new gesture a new key', v.length === 3 && v[0].k === v[1].k && v[2].k !== v[0].k, JSON.stringify(v.map(x => x.k)));
  eq('…so the double-click made ONE vendor, and the page heard the replay (the new gesture\'s same-name vendor is refused by the name rule, not by a key)', [(await c.query(`SELECT count(*)::int n FROM vendors WHERE user_id = $1 AND data->>'name' = 'Double Click Vendor'`, [uid])).rows[0].n, res.replays >= 1], [1, true]);
  A('writes no gesture started get a unique key each (behave as before)', g.length === 2 && g[0].k !== g[1].k, JSON.stringify(g.map(x => x.k)));

  // ── STRUCTURAL (labelled, Rule 5): the middleware is registered before every /api write route except the ones that
  //    must not use it (Stripe webhook — signed raw body; CSP reports) or run before sign-in (auth, Stripe checkout).
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'server.js'), 'utf8');
  const at = src.indexOf("app.use('/api', require('./idempotency.js')(pool));");
  const before = [...src.slice(0, at).matchAll(/app\.(post|put|patch|delete)\('(\/api\/[^']*)'/g)].map(m => m[2]);
  const allowed = new Set(['/api/stripe/webhook', '/api/csp-report', '/api/stripe/checkout', '/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/mfa/setup', '/api/auth/mfa/enable', '/api/auth/mfa/disable', '/api/auth/forgot-password', '/api/auth/reset-password']);
  A('[STRUCTURAL] every /api write route registered after the middleware, apart from the reviewed pre-auth list', at > 0 && before.every(p => allowed.has(p)), JSON.stringify(before.filter(p => !allowed.has(p))));
  const pages = require('fs').readdirSync(require('path').join(__dirname, '..', '..', 'public')).filter(f => f.endsWith('.html'));
  const missing = pages.filter(f => !/<script src="\/ff-idem\.js"><\/script>/.test(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public', f), 'utf8')));
  A('[STRUCTURAL] every page loads ff-idem.js', missing.length === 0, JSON.stringify(missing));
}, {});
