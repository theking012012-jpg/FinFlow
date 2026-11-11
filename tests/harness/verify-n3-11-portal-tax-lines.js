#!/usr/bin/env node
'use strict';
/**
 * verify-n3-11-portal-tax-lines.js — N3-11 (live re-audit 2026-11-11), end to end through the REAL routes.
 *
 * The owner's Income Tax worksheet is saved by PUT /api/settings into `user_settings` (server.js, F137-k). The accountant
 * portal's books route read `tax_rate` / `tax_lines` from `SELECT data FROM users` — a row that never receives them — so
 * the accountant's Tax Summary said "Client has not set a tax rate … Not set up" while the owner's own estimate showed 20 %.
 * verify-f138-accountant-taxlines passed throughout because it hands renderTax() a hand-built `_data` (a stub of the server
 * response) — it never exercised the read (CLAUDE.md failure #3). This harness has no stub: the owner logs in and saves
 * through PUT /api/settings exactly as the Income Tax Estimate does; a linked accountant logs in and reads
 * GET /api/accountants/clients/:id/books.
 *
 * Owner saves: lines [{ Income tax, % of taxable, 20 }, { Business levy, fixed, 150 }]; derived tax_rate 20.
 * EXPECTED (the values the owner saved, Rule 6): taxLines has those 2 lines (labels, types, values); taxRate 20.
 * BUG VALUES (Rule 4): taxLines [] and taxRate 0 — "Not set up".
 * Fallback kept: a client whose tax fields exist ONLY on the legacy `users` row (pre-F137-k) still reads them.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-n3-11-portal-tax-lines.js
 * Scratch Postgres only (guard.js).
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  N3-11 — the accountant portal reads the tax lines the owner saved\n' + '='.repeat(78) + '\n');

    const mkUser = async (email) => (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email, name: 'Client ' + email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const clientId = await mkUser('n311-client@finflow.test');
    await seed(c, clientId);
    const legacyId = await mkUser('n311-legacy@finflow.test');
    await seed(c, legacyId);
    // the legacy client: tax fields only on the users row (as before F137-k moved them to user_settings)
    await c.query(`UPDATE users SET data = data || $2::jsonb WHERE id = $1`, [legacyId, JSON.stringify({ tax_rate: 15, tax_lines: [{ label: 'Old tax', type: 'taxable', value: 15, note: '' }] })]);

    const acc = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('n311-acc@finflow.test', $1, 'Acc', 'N311', 'Firm', 'N311CODE', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    for (const uid of [clientId, legacyId]) {
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', 'view')`, [acc, uid]).catch(async e => {
        // NEW-12: one active accountant per client — fine here (different clients); rethrow anything else
        throw e;
      });
    }

    // ── the owner saves the worksheet through the real route ──
    const owner = new HarnessHttp(server.baseUrl);
    const li = await owner.post('/api/auth/login', { email: 'n311-client@finflow.test', password: PW });
    A('owner logs in', li.status === 200, li.status + ' ' + li.text.slice(0, 120));
    // N3-12 needs books where the full deduction ≠ the expense-entry split (Rule 4): invoice 10,000; expenses 1,000
    // (deductible) + 300 (not); a bill 2,000. Hand-computed taxable = 10,000 − (1,000 + 2,000) = 7,000.
    // Bug on screen: "10,000 − fully deductible 1,000 − 50 % 0" next to "Taxable 7,000" — does not add up.
    const OK = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return r; };
    const ent = JSON.parse(OK(await owner.post('/api/entities', { name: 'Tax Co', currency: 'USD', timezone: 'UTC', country: 'US' })).text);
    OK(await owner.post('/api/entities/' + ent.id + '/activate', {}));
    OK(await owner.post('/api/invoices', { client: 'TaxCust', amount: 10000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-31', idempotency_key: 'n312-i' }));
    OK(await owner.post('/api/expenses', { description: 'Ded', amount: 1000, category: 'Software', deductible: 'yes', expense_date: '2026-07-02', idempotency_key: 'n312-e1' }));
    OK(await owner.post('/api/expenses', { description: 'NonDed', amount: 300, category: 'Meals', deductible: 'no', expense_date: '2026-07-03', idempotency_key: 'n312-e2' }));
    OK(await owner.post('/api/bills', { vendor: 'TaxVend', amount: 2000, status: 'unpaid', issue_date: '2026-07-05', due_date: '2026-08-05', idempotency_key: 'n312-b' }));
    const LINES = [{ label: 'Income tax', type: 'taxable', value: 20, note: '' }, { label: 'Business levy', type: 'fixed', value: 150, note: '' }];
    const put = await owner.put('/api/settings', { tax_lines: LINES, tax_rate: 20 });
    A('owner PUT /api/settings (the Income Tax Estimate save) → 2xx', put.status >= 200 && put.status < 300, put.status + ' ' + put.text.slice(0, 160));
    const back = JSON.parse((await owner.get('/api/settings')).text || '{}');
    const ownerLines = back.tax_lines || (back.settings && back.settings.tax_lines) || [];
    A('owner reads them back (persisted): 2 lines, rate 20', Array.isArray(ownerLines) && ownerLines.length === 2, JSON.stringify(back).slice(0, 200));

    // ── the accountant reads the same client's books ──
    const accHttp = new HarnessHttp(server.baseUrl);
    const al = await accHttp.post('/api/accountants/login', { email: 'n311-acc@finflow.test', password: PW });
    A('accountant logs in', al.status === 200, al.status + ' ' + al.text.slice(0, 120));
    const b = await accHttp.get(`/api/accountants/clients/${clientId}/books`);
    const j = JSON.parse(b.text || '{}');
    const tl = j.taxLines || [];
    A('portal books → 200', b.status === 200, b.status + ' ' + b.text.slice(0, 160));
    if (process.env.N311_DEBUG) console.log('  DEBUG keys=' + Object.keys(j).join(',') + ' summary=' + JSON.stringify(j.summary || null).slice(0, 400));
    A('portal taxLines = the 2 lines the owner saved (bug: [] → "Not set up")',
      tl.length === 2 && tl[0].label === 'Income tax' && tl[0].type === 'taxable' && Number(tl[0].value) === 20 && tl[1].label === 'Business levy' && tl[1].type === 'fixed' && Number(tl[1].value) === 150,
      JSON.stringify(tl));
    A('portal taxRate = 20 (bug: 0)', Number(j.taxRate) === 20, 'taxRate=' + j.taxRate);

    // ── N3-12: the Tax Summary breakdown adds up — the SHIPPED renderTax() run on this REAL /books response ──
    {
      const { JSDOM } = require('jsdom');
      const src = require('./appScripts.js').pageSource('accountant-client.html');
      const st = src.indexOf('function renderTax(invoices, expenses)'), en = src.indexOf('// ── NOTES', st);
      const dom = new JSDOM('<div id="tax-liability"></div><div id="tax-deductible"></div><div id="tax-taxable"></div><div id="tax-rate-warning"></div><div id="tax-breakdown"></div>');
      const d = dom.window.document;
      const set = (id, v) => { const el = d.getElementById(id); if (el) el.textContent = v; };
      const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      new Function('document', 'set', 'fmt', '_data', src.slice(st, en) + '\n; return renderTax;')(d, set, fmt, j)([], []);
      const num = t => parseFloat(String(t || '').replace(/[^0-9.\-]/g, '')) || 0;
      const rows = [...d.querySelectorAll('#tax-breakdown .pl-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
      const rev = num((rows.find(r => /^Gross Revenue/.test(r)) || '').replace(/^Gross Revenue/, ''));
      const dedRow = rows.find(r => /^Deductible costs/.test(r)) || '';
      const ded = num((dedRow.match(/−\s*\$[\d,.]+/) || [''])[0]);
      const tax = num((rows.find(r => /^Taxable Income/.test(r)) || '').replace(/^Taxable Income/, ''));
      A('N3-12 breakdown: 10,000 − Deductible costs 3,000 == Taxable 7,000 on screen (bug: 10,000 − 1,000 − 0 shown beside 7,000)',
        Math.abs(rev - 10000) < 0.01 && Math.abs(tax - 7000) < 0.01 && Math.abs(rev - ded - tax) < 0.01 && Math.abs(tax - num(d.getElementById('tax-taxable').textContent)) < 0.01,
        JSON.stringify({ rev, ded, tax, card: d.getElementById('tax-taxable').textContent, rows: rows.slice(0, 5) }));
      A('N3-12 Tax Summary shows the owner\'s estimate (lines), not "Not set up"', !/Not set up/.test(d.getElementById('tax-liability').textContent), d.getElementById('tax-liability').textContent);
    }

    // ── legacy fallback ──
    const lb = JSON.parse((await accHttp.get(`/api/accountants/clients/${legacyId}/books`)).text || '{}');
    A('legacy client (fields only on users row) still reads: rate 15, 1 line "Old tax"', Number(lb.taxRate) === 15 && (lb.taxLines || []).length === 1 && lb.taxLines[0].label === 'Old tax', JSON.stringify({ rate: lb.taxRate, lines: lb.taxLines }));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e && e.errors) e.errors.forEach(x => console.log('    ' + (x && x.stack || x)));
  } finally {
    if (server && server.close) await server.close().catch(() => {});
    await scratch.stop().catch(() => {});
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-11 portal tax lines)'));
  process.exit(fail ? 1 : 0);
}
main();
