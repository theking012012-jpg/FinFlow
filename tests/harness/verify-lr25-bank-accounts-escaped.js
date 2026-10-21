'use strict';
/**
 * verify-lr25-bank-accounts-escaped.js — LR25 (security) + LR24 (bank balance currency).
 *  • The Banking accounts list wrote bank, last4, type and updated into innerHTML raw — a bank name carrying markup
 *    became live elements on the page (an HTML-injection path). The dashboard transactions list escaped only < / >.
 *  • The account balance was a literal "$" on every business — "$1,000" on a TT$ business.
 *
 * Real scratch Postgres, real server, real SPA (bundle). The hostile account is put into the page's own account list
 * (bankAccounts) and the page's own renderBanking() draws it — then the DOM is read back.
 *   TT$ business, account { bank:'<img …>', last4:'<b>1</b>', type:'<u>chk</u>', updated:'<i>x</i>', balance:1000 }:
 *     elements created from the fields: none            (old: img, b, u, i → 4)
 *     the text shows the markup literally               (old: tags gone)
 *     balance "TT$1,000"                                (old: "$1,000")
 *   Dashboard transactions list, an expense categorised "R&copy;D" → shown as typed   (old: "R©D" — only < was escaped)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr25-bank-accounts-escaped.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR25 / LR24 — bank account fields are escaped; the balance is in the business currency\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Island LR25', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('POST', '/api/expenses', { description: 'Lab kit', amount: 40, category: 'R&copy;D', expense_date: '2026-07-20' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('banking');
    await settle(30, 40);

    w.eval(`bankAccounts.length = 0; bankAccounts.push({ name:'Ops', bank:'<img src=x id=lr25img>', last4:'<b>1</b>', type:'<u>chk</u>', updated:'<i>x</i>', balance:1000 });`);
    w.renderBanking();
    await settle(5, 10);
    const al = d.getElementById('bank-accounts-list');
    const injected = al ? al.querySelectorAll('img, b, u, i').length : -1;
    eq('no element is created from an account field', injected, 0, 4);
    const txt = al ? al.textContent : '';
    eq('the markup is shown as text', ['<img src=x id=lr25img>', '<b>1</b>', '<u>chk</u>', '<i>x</i>'].every(s => txt.includes(s)), true, false);
    eq('balance is in TT$ (no bare "$")', [/TT\$1,000/.test(txt), (txt.match(/(?<!TT)\$[\d,.]+/g) || [])], [true, []], [false, ['$1,000']]);

    // The bank transactions list (same page) — a category carrying markup draws no element.
    w.eval(`bankTxns.length = 0; bankTxns.push({ desc:'Tea', cat:'"><img src=x id=lr25cat>', date:'2026-07-20', _iso:'2026-07-20', amount:5, type:'debit' });`);
    w.renderBanking();
    await settle(5, 10);
    const tl = d.getElementById('bank-txns-list');
    eq('[GUARD] bank transactions list: no element from a category', tl ? tl.querySelectorAll('img').length : -1, 0, undefined);

    // The dashboard transactions list (finflow-api-wiring-dashboard.js) escaped only "<" by hand, so an entity in a
    // category was decoded: a category typed as "R&copy;D" showed as "R©D". The full escaper shows what was typed.
    w.showPage('dashboard');
    await settle(60, 60);
    const dt = (d.getElementById('d-txns') || {}).textContent || '';
    eq('dashboard list shows the category exactly as typed', [dt.includes('R&copy;D'), dt.includes('R©D')], [true, false], [false, true]);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
