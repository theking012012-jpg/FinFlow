'use strict';
/**
 * verify-live-retest-2026-10-30 — the defects the full live re-test of 2026-10-30 found (NEW-1 … NEW-5), executed in a
 * real browser on the real /app against the real server and a scratch Postgres (Rule 3).
 *
 * RUN WITH THE EVENING CLOCK (the live failure needs it):
 *   SWEEP_PIN_ISO=2026-10-31T01:30:00.000Z node -r ./tests/harness/clock-oct.js tests/harness/verify-live-retest-2026-10-30.js
 * The server's clock is then 01:30 UTC on 31 Oct = 21:30 on 30 Oct in New York (a US business). Rule 10 seed corollary:
 * a noon pin cannot tell the UTC day from the business's day; this one can.
 *
 *   NEW-1  Settings shows the business profile saved at onboarding (Industry "Media & Creative"), without a reload.
 *          Bug: "Technology" (the select's first option — Settings was filled before onboarding saved).
 *   NEW-2  Record Payment and Remit default to the BUSINESS's today on the server's clock: 2026-10-30.
 *          Bug: 2026-10-31 (the server's UTC day — "tomorrow" from 8 pm in New York).
 *   NEW-3  Two imports of one statement at the same moment write each line once (4). Bug: 8.
 *   NEW-4  The PDF header names the business and the business's date ("Northwind QA · FinFlow · Oct 30 2026").
 *          Bug: "FinFlow · <viewer's clock and locale>".
 *   NEW-5  Connections: a provider not set up on this server says "Not set up yet" (bug: "Available"); the header
 *          counts connected / ready / not set up (bug: "17 live connections" with none connected).
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('Live re-test 2026-10-30 — NEW-1 … NEW-5', async ({ open, A, eq, J, http, base }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  eq('clock: the server is on the evening pin (UTC day 2026-10-31)', new Date().toISOString().slice(0, 16), '2026-10-31T01:30');

  const page = await open({ width: 1280, height: 900 });
  const toasts = [];
  await page.exposeFunction('__toast', t => toasts.push(t));
  await page.evaluate(() => { const o = window.notify; window.notify = function (m) { try { window.__toast(String(m)); } catch (_) {} return o && o.apply(this, arguments); }; });

  // ── NEW-1: onboarding → Settings, same session ────────────────────────────────────────────────────────────────
  await page.evaluate(async () => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('ob-biz-name', 'Northwind QA'); set('ob-industry', 'Media & Creative'); set('ob-user-name', 'Sam QA'); set('ob-email', 'qa@finflow.test');
    set('ob-address', '100 Main St'); set('ob-currency', 'USD'); set('ob-country', 'US');
    await window.skipOnboarding();   // calls finishOnboarding (the module's own, with the fields above)
  });
  await wait(2500);
  const ind = await page.evaluate(async () => { showPage('settings'); await new Promise(r => setTimeout(r, 800)); return document.getElementById('s-industry').value; });
  eq('NEW-1 Settings → Industry right after onboarding', ind, 'Media & Creative', 'Technology');

  // ── seed through the API (the business onboarding just created) ───────────────────────────────────────────────
  const ents = await J('GET', '/api/entities');
  eq('the business onboarding created is in New York time', [ents.length, ents[0].timezone], [1, 'America/New_York']);
  await J('POST', '/api/entities/' + ents[0].id + '/activate', {});
  await J('POST', '/api/invoices', { client: 'Bright Labs', amount: 2500, issue_date: '2026-08-05', due_date: '2026-09-04', status: 'pending', idempotency_key: 'nr-1' });
  await J('POST', '/api/payroll', { fname: 'Jordan', lname: 'Lee', gross: 3000, deductions: [{ label: 'Income tax', value: 10, type: 'percent' }] });
  const run = await J('POST', '/api/payroll-runs', { period: 'September 2026', run_date: '2026-10-30', idempotency_key: 'nr-run', lines: [{ employee_name: 'Jordan Lee', gross: 3000, bonus: 0, overtime: 0, payroll_id: null }] });
  await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
  await J('PUT', '/api/payroll-runs/' + run.id + '/mark-paid', {});
  await page.reload({ waitUntil: 'load' }); await wait(3500);   // a fresh session boot (auth/me primes the server clock)

  // ── NEW-2: the default money date ─────────────────────────────────────────────────────────────────────────────
  const d = await page.evaluate(async () => {
    showPage('invoices'); await new Promise(r => setTimeout(r, 1200));
    const inv = (window.userInvoices || []).find(x => x.client === 'Bright Labs'); openRecordPaymentModal(inv); await new Promise(r => setTimeout(r, 300));
    const rp = document.getElementById('rp-date').value; closeModal('record-payment-modal');
    showPage('payroll'); await loadPayrollRuns(); await new Promise(r => setTimeout(r, 500));
    openRemitWithholdings((window.payrollRuns || [])[0].id); const rw = document.getElementById('rw-date').value; closeModal('remit-withholdings-modal');
    return { rp, rw };
  });
  eq('NEW-2 Record Payment defaults to the business\'s today', d.rp, '2026-10-30', '2026-10-31');
  eq('NEW-2 Remit withholdings defaults to the business\'s today', d.rw, '2026-10-30', '2026-10-31');

  // ── NEW-3: two imports of one statement at the same moment ────────────────────────────────────────────────────
  const csv = 'Date,Description,Amount\n2026-08-21,BRIGHT LABS PAYMENT,1000.00\n2026-10-08,BANK FEE,-35.00\n2026-10-09,PAPER SUPPLY CO,-650.00\n2026-10-09,TRANSFER TO SAVINGS,-500.00\n';
  const both = await Promise.all([1, 2].map(() => http.request('POST', '/api/banking/import', { format: 'csv', content: csv })));
  const lines = await J('GET', '/api/banking');
  eq('NEW-3 two concurrent imports: each line once', lines.length, 4, 8);
  eq('NEW-3 between them: 4 imported and 4 "already there"', [both[0].json.imported + both[1].json.imported, both[0].json.skipped + both[1].json.skipped], [4, 4]);
  const again = await http.request('POST', '/api/banking/import', { format: 'csv', content: csv });
  eq('NEW-3 a later import adds nothing', [again.json.imported, again.json.skipped], [0, 4]);

  // ── NEW-4: the PDF header ─────────────────────────────────────────────────────────────────────────────────────
  const pdfHead = await page.evaluate(async () => {
    let bytes = null; const oc = URL.createObjectURL; URL.createObjectURL = function (b) { if (b && b.type === 'application/pdf') b.arrayBuffer().then(a => { bytes = new Uint8Array(a); }); return oc.call(URL, b); };
    const oa = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    window._ffExportPdf([['Line', 'Amount'], ['Revenue', '2500.00']], 'pl.pdf', 'Profit & Loss');
    for (let i = 0; i < 40 && !bytes; i++) await new Promise(r => setTimeout(r, 150));
    HTMLAnchorElement.prototype.click = oa; URL.createObjectURL = oc;
    if (!bytes) return null;
    const txt = new TextDecoder('windows-1252').decode(bytes);   // the PDF's own encoding (WinAnsi), not UTF-8
    const m = txt.match(/\(([^()]*FinFlow[^()]*)\) Tj/); return m ? m[1] : null;
  });
  eq('NEW-4 the PDF header names the business and its date', pdfHead, 'Northwind QA · FinFlow · Oct 30 2026', 'FinFlow · <viewer date>');

  // ── NEW-5: Connections states ─────────────────────────────────────────────────────────────────────────────────
  const conn = await page.evaluate(async () => {
    showPage('connections'); await new Promise(r => setTimeout(r, 2500));
    const t = document.getElementById('page-connections').innerText;
    const card = n => { const c = [...document.querySelectorAll('.conn-card')].find(x => x.querySelector('.conn-card-name')?.textContent === n); return c ? c.querySelector('.conn-card-footer').innerText.replace(/\s+/g, ' ').trim() : null; };
    const st = await (await fetch('/api/codat/status', { credentials: 'include' })).json();
    return { codatConfigured: st.configured, codat: card('Codat'), wise: card('Wise'), live: /live connection/.test(t), header: (t.match(/\d+ connected · [^\n]*/) || [''])[0] };
  });
  eq('NEW-5 this server has no Codat keys (the case under test)', conn.codatConfigured, false);
  A('NEW-5 a provider not set up says so (Codat)', /^Not set up yet/.test(conn.codat || ''), 'card: ' + conn.codat + '  (bug: "Available Connect")');
  A('NEW-5 a provider that takes your own keys stays ready (Wise)', /^Ready to connect/.test(conn.wise || ''), 'card: ' + conn.wise);
  A('NEW-5 the header counts what is true — no "live connections"', !conn.live && /^0 connected · \d+ ready to connect · \d+ not set up yet$/.test(conn.header), JSON.stringify(conn.header));
}, { entities: [] });
