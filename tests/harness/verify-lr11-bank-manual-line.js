#!/usr/bin/env node
'use strict';
/**
 * verify-lr11-bank-manual-line.js — LR11 (live retest 2026-10-20, T3): Banking "+ Add" (openAddTxnModal) only showed a
 * toast "Add manual transaction" — no form; saveBankTxn (POST /api/banking) had no caller. A stub on a money path.
 *
 * Real SPA in jsdom → real server → real scratch Postgres (Rule 3). Two businesses: A (USD, in view) and B (EUR).
 * Values chosen so each source is identifiable (Rule 4): the manual line is 123.45 out on 2026-07-20; nothing else in
 * the seed is 123.45.
 *
 *   UI
 *    1  "+ Add" opens a form (date · description · amount · money in/out · category)      bug: toast only, no form
 *    2  saving it — with a DOUBLE click — writes exactly ONE bank line on business A:
 *       amount 123.45, tx_type debit, tx_date 2026-07-20, source banking, entity A          bug: 0 rows
 *    3  the line is listed on the Banking page                                             bug: not listed
 *    4  one 'bank_lines' CREATE audit row on business A for that line                     bug: none
 *   SERVER (Rule 9 — idempotency at the write, not only the button)
 *    5  same idempotency_key, second POST > 5 s later → still ONE row, original returned   bug: 2 rows
 *    6  same idempotency_key, two CONCURRENT POSTs → ONE row                               bug: 2 rows (no index)
 *    7  different keys, same description + amount → TWO rows (a genuine second line kept)
 *    8  amount "abc" / 0 / -5 → 400, nothing stored        bug: 0 → 201, stored as a 0 line ("abc" / -5 already 400 — body-shape)
 *    9  date "20/07/2026" → 400                            (control — body-shape N63 already refuses it)
 *   WALL + GL
 *   10  the business line never appears in GET /api/personal-transactions (Personal)       (M56 — control)
 *   11  the business line never appears on business B's Banking                             (per-entity — control)
 *   12  no ledger entry is posted for a bank line (a bank line is a statement line; it is booked when matched in
 *       Bank Rec — book-expense / match-bill — same as imported / Plaid / Belvo lines)     (count unchanged)
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };
  const eq = (n, measured, expected, bug) => {
    const m = JSON.stringify(measured), e = JSON.stringify(expected);
    A(n + `  [measured ${m}, correct ${e}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, m === e);
  };
  console.log('\nLR11 — Banking "+ Add": a real, audited, idempotent, per-business manual bank line\n');
  let entA, entB;
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);   // two businesses
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 200)}`); return r.json; };
      entB = (await J('POST', '/api/entities', { name: 'Business B', currency: 'EUR', timezone: 'UTC', country: 'DE' })).id;
      entA = (await J('POST', '/api/entities', { name: 'Business A', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
      await J('POST', '/api/entities/' + entA + '/activate', {});
      await J('POST', '/api/personal-transactions', { description: 'Groceries', amount: 200, currency: 'USD', category: 'Groceries', tx_type: 'expense', tx_date: '2026-07-20' });
    } });
    const { window: w, settle, http, client } = boot;
    const d = w.document;
    await settle(80, 75);

    const bankRows = async (where = '') => (await client.query(
      `SELECT id, entity_id, data FROM personal_transactions WHERE data->>'source' = 'banking' ${where} ORDER BY id`)).rows;
    const ledgerCount = async () => (await client.query(`SELECT COUNT(*)::int n FROM ledger_entries`)).rows[0].n;
    const ledger0 = await ledgerCount();

    // ── UI ──
    try { w.showPage('banking'); } catch (_) {}
    await settle(30, 60);
    try { w.openAddTxnModal(); } catch (e) { console.log('    openAddTxnModal threw: ' + e.message); }
    await settle(5, 30);
    const modal = d.getElementById('bank-add-modal');
    const shown = !!modal && !modal.classList.contains('hidden');
    eq('1  "+ Add" opens a form', shown, true, false);
    const ids = ['bank-add-date', 'bank-add-desc', 'bank-add-amount', 'bank-add-dir', 'bank-add-cat', 'bank-add-save'];
    eq('1  form has date · description · amount · in/out · category · save', ids.filter(i => !d.getElementById(i)), []);

    if (shown) {
      const set = (id, v) => { const el = d.getElementById(id); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
      set('bank-add-date', '2026-07-20');
      set('bank-add-desc', 'ZZ MANUAL LINE');
      set('bank-add-amount', '123.45');
      set('bank-add-dir', 'out');
      set('bank-add-cat', 'Office');
      const btn = d.getElementById('bank-add-save');
      btn.click(); btn.click();   // the double click
      await settle(40, 60);
    }
    const mine = await bankRows(`AND data->>'description' = 'ZZ MANUAL LINE'`);
    eq('2  double-click saves exactly ONE bank line', mine.length, 1, 0);
    const r0 = mine[0] ? { entity: mine[0].entity_id, amount: Number(mine[0].data.amount), type: mine[0].data.tx_type, date: mine[0].data.tx_date, cat: mine[0].data.category } : null;
    eq('2  stored on business A as 123.45 money-out on 2026-07-20 (Office)', r0, { entity: entA, amount: 123.45, type: 'debit', date: '2026-07-20', cat: 'Office' }, null);
    const listed = (d.getElementById('bank-txns-list') || {}).textContent || '';
    A('3  the line is listed on the Banking page', /ZZ MANUAL LINE/.test(listed));
    const aud = mine[0] ? (await client.query(
      `SELECT entity_id, action FROM audit_trail WHERE table_name = 'bank_lines' AND record_id = $1`, [mine[0].id])).rows : [];
    eq('4  one bank_lines CREATE audit row on business A', aud.map(a => [a.entity_id, a.action]), [[entA, 'CREATE']], []);

    // ── SERVER: Rule 9 ──
    const k1 = 'lr11-key-slow';
    const p1 = await http.post('/api/banking', { desc: 'ZZ SLOW', amount: 50, type: 'credit', date: '2026-07-21', idempotency_key: k1 });
    await client.query(`UPDATE personal_transactions SET created_at = NOW() - INTERVAL '60 seconds' WHERE data->>'description' = 'ZZ SLOW'`);
    const p2 = await http.post('/api/banking', { desc: 'ZZ SLOW', amount: 50, type: 'credit', date: '2026-07-21', idempotency_key: k1 });
    eq('5  same key, retry 60 s later → ONE row', (await bankRows(`AND data->>'description' = 'ZZ SLOW'`)).length, 1, 2);
    eq('5  the retry returns the ORIGINAL row', p2.json && p2.json.id, p1.json && p1.json.id);

    const k2 = 'lr11-key-race';
    await Promise.all([1, 2, 3].map(() => http.post('/api/banking', { desc: 'ZZ RACE', amount: 60, type: 'debit', date: '2026-07-21', idempotency_key: k2 })));
    eq('6  same key, 3 concurrent POSTs → ONE row', (await bankRows(`AND data->>'description' = 'ZZ RACE'`)).length, 1, 3);

    await http.post('/api/banking', { desc: 'ZZ TWICE', amount: 70, type: 'debit', date: '2026-07-21', idempotency_key: 'lr11-a' });
    await client.query(`UPDATE personal_transactions SET created_at = NOW() - INTERVAL '60 seconds' WHERE data->>'description' = 'ZZ TWICE'`);
    await http.post('/api/banking', { desc: 'ZZ TWICE', amount: 70, type: 'debit', date: '2026-07-21', idempotency_key: 'lr11-b' });
    eq('7  different keys, same desc + amount → TWO rows', (await bankRows(`AND data->>'description' = 'ZZ TWICE'`)).length, 2);

    const bad = [];
    for (const amt of ['abc', 0, -5]) bad.push((await http.post('/api/banking', { desc: 'ZZ BAD ' + amt, amount: amt, type: 'debit', date: '2026-07-21' })).status);
    eq('8  amount "abc" / 0 / -5 → 400 each', bad, [400, 400, 400], [400, 201, 400]);   // body-shape already refused abc / -5; 0 passed
    eq('8  nothing stored for them', (await bankRows(`AND data->>'description' LIKE 'ZZ BAD %'`)).length, 0, 1);
    eq('9  date "20/07/2026" → 400 (control — body-shape N63 already refuses it)', (await http.post('/api/banking', { desc: 'ZZ BAD DATE', amount: 5, type: 'debit', date: '20/07/2026' })).status, 400);

    // ── WALL + GL ──
    const pers = (await http.get('/api/personal-transactions')).json || [];
    eq('10 no bank line from the business appears in Personal', pers.filter(t => /^ZZ /.test(t.description || '')).length, 0);
    await http.post('/api/entities/' + entB + '/activate', {});
    const bList = (await http.get('/api/banking')).json || [];
    eq('11 business B\'s Banking shows none of A\'s lines', bList.filter(t => /^ZZ /.test(t.description || '')).length, 0);
    await http.post('/api/entities/' + entA + '/activate', {});
    eq('12 no ledger entry posted for a bank line', await ledgerCount(), ledger0);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  // Explicit exit: a FATAL inside apiSeed leaves `boot` unset, so its server + Postgres would keep the process alive.
  process.exit(fail === 0 ? 0 : 1);
})();
