'use strict';
/**
 * FA-M7 (2026-10-27) — the one chart, on the real pages (jsdom, real server, real scratch Postgres).
 *
 *   Owner app: the Chart of Accounts page and the journal picker read the same chart; a journal made in the modal
 *   (Dr 6950 Website costs 40 / Cr 1000 Cash 40) shows on the 6950 row — one row, $40 — and no "Journal …" account
 *   appears. The New account form has no "Opening balance" (it showed a balance the books never held) and no
 *   free "Nature" (the side follows the category).
 *   Accountant portal: the journal form's accounts are the client business's chart (the template's
 *   "5000 Salaries & Wages" is gone; "6950 Website costs" is there).
 * Seed: clientMoneyKit (hand-computed there) + own account 6950 Website costs. The bug values are named per check.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { seed } = require('./clientMoneyKit.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nFA-M7 UI — one chart on the Chart of Accounts page, the journal picker and the accountant portal\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, failMap: {}, apiSeed: async (ctx) => {
      await seed(ctx);
      const r = await ctx.http.request('POST', '/api/chart-of-accounts', { code: '6950', name: 'Website costs', category: 'Expenses', idempotency_key: 'm7ui-own' });
      if (r.status >= 300) throw new Error('own account ' + r.status);
    } });
    const { window: w, settle, origin, client: c, userId } = boot;
    const d = w.document;
    await settle(80, 75);
    const coaRows = () => Array.from(d.querySelectorAll('#coa-list .coa-row, #coa-list > div > div:not(:first-child)')).map(r => Array.from(r.children).map(x => x.textContent.replace(/\s+/g, ' ').trim()));
    const coaRow = code => coaRows().filter(r => r[0] === code);

    w.showPage('chart-of-accounts'); await settle(25, 40);
    eq('1  the Chart of Accounts lists 6950 Website costs once, at $0', coaRow('6950').map(r => [r[1].replace(/yours$/, '').trim(), r[2]]), [['Website costs', '$0']]);

    w.openJournalEntryModal(); await settle(15, 30);
    const opts = () => Array.from(d.querySelectorAll('#je-lines select')[0].options).map(o => o.textContent.trim());
    const o = opts();
    eq('2  the picker offers the business\'s own account', o.includes('6950 Website costs'), true, false);
    eq('2  the picker offers the built-in accounts by their ledger names (1000 Cash, 3000 Retained Earnings)', ['1000 Cash', '3000 Retained Earnings'].every(x => o.includes(x)), true, false);
    eq('2  the old template is gone (5000 Salaries & Wages, 2100 Credit Card) and COGS is not offered', o.filter(x => /Salaries & Wages|Credit Card|Cost of Goods Sold/.test(x)), [], ['2100 Credit Card', '5000 Salaries & Wages']);

    // Drive the modal: line 1 Dr 6950 40, line 2 Cr 1000 40, Post.
    const pickIn = (i, label) => { const sel = d.querySelectorAll('#je-lines select')[i]; const op = Array.from(sel.options).find(x => x.textContent.trim() === label); sel.value = op ? op.value : ''; sel.dispatchEvent(new w.Event('change')); };
    const amt = (i, k, v) => { const inp = d.querySelectorAll('#je-lines > div')[i].querySelectorAll('input')[k]; inp.value = String(v); inp.dispatchEvent(new w.Event('input')); };
    pickIn(0, '6950 Website costs'); amt(0, 0, 40);
    pickIn(1, '1000 Cash'); amt(1, 1, 40);
    d.getElementById('je-date').value = '2026-07-20'; d.getElementById('je-notes').value = 'Website (UI)';
    await w.saveJournalEntry('Posted'); await settle(20, 40);
    w.showPage('chart-of-accounts'); await w.renderCOA(); await settle(20, 40);
    eq('3  after posting in the modal, 6950 Website costs reads $40 — one row', coaRow('6950').map(r => r[2]), ['$40'], ['$0']);
    eq('3  no "Journal …" account and no J-coded twin on the page', coaRows().filter(r => /^J/.test(r[0] || '') || /^Journal\s/.test(r[1] || '')).map(r => r[0] + ' ' + r[1]), [], ['J6950 Journal 6950', 'J1000 Journal 1000']);

    w.openNewAccountModal(); await settle(3, 20);
    eq('4  the New account form has no "Opening balance" and no free "Nature"', [!!d.getElementById('coa-balance'), !!d.getElementById('coa-nature')], [false, false], [true, true]);

    // Accountant portal (standalone page, its own session).
    const PW = 'm7ui-acc-pw-not-a-secret';
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status) VALUES ('m7ui@finflow.test', $1, 'M', 'Seven', 'Firm', 'M7UIREF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','filing','client')`, [accId, userId]);
    const ah = new HarnessHttp(origin);
    if ((await ah.post('/api/accountants/login', { email: 'm7ui@finflow.test', password: PW })).status !== 200) throw new Error('accountant login');
    const page = await ah.get(`/accountant-client?client=${userId}`);
    const jar = new CookieJar(); for (const [k, v] of ah.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, origin);
    const cookie = [...ah.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const adom = new JSDOM(page.text, { url: `${origin}/accountant-client?client=${userId}`, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const aw = adom.window;
    aw.fetch = (input, init = {}) => { const u = typeof input === 'string' ? input : input.url; return global.fetch(u.startsWith('http') ? u : origin + u, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookie }) })); };
    await settle(50, 80);
    aw.toggleJournalForm(); await settle(25, 60);
    const ao = Array.from(aw.document.querySelectorAll('#jnl-lines select.jnl-acct')[0].options).map(x => x.textContent.trim());
    eq('5  the accountant\'s journal form offers the client\'s own 6950 Website costs', ao.includes('6950 Website costs'), true, false);
    eq('5  …and not the old template (5000 Salaries & Wages)', ao.some(x => /Salaries & Wages/.test(x)), false, true);
    adom.window.close();
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
