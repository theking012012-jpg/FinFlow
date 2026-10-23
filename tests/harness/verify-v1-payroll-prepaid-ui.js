'use strict';
/**
 * verify-v1-payroll-prepaid-ui.js — V1 client side (D1 option A + G7 / G8), the REAL SPA in jsdom against the real server.
 *
 * Before: the pay period was a free-text box (a typo the date reader could not parse silently fell back to the run date,
 * G7), defaulted from the viewer's clock (G8); Mark paid on a future month simply paid it.
 * After: a month picker defaulted from the BUSINESS's today, a live note saying where the expense lands, the stored
 * period stays "August 2026" (one-run-per-period holds for older runs), and Mark paid on a month that has not started
 * asks first — "Not yet" leaves it approved, "Pay in advance" pays it as prepaid payroll.
 *
 * clientMoneyKit seed (clock 2026-07-25): employee Sam gross 2,000, 10 % withholding → net 1,800; a July run exists.
 *   1  modal opens on 2026-07 (business today)               bug: "July 2026" typed text
 *   2  choosing 2026-08 → note says the month has not started (prepaid)
 *   3  submit → stored period "August 2026"
 *   4  typed "Agust 2026" (no month picker) → refused, no run   bug: run created, filed under the run date
 *   5  Mark paid on August, "Not yet" → still approved        bug: (server 409) error toast, approved
 *   6  "Pay in advance" → paid; 1250 Prepaid Payroll = 1,800  bug: never paid from the UI
 */
const { run } = require('./clientMoneyKit.js');

run('V1 UI — month picker, live note, confirm before paying a future month', async ({ w, d, ev, settle, http, A, eq }) => {
  const runs = async () => ((await http.get('/api/payroll-runs')).json || []);
  w.openRunPayrollModal(); await settle(4, 40);
  const per = d.getElementById('prm-period');
  eq('1  period field is a month picker opened on the business\'s month', [per && per.type, per && per.value], ['month', '2026-07'], ['text', 'July 2026']);
  per.value = '2026-08'; if (typeof w._prmPeriodHint === 'function') w._prmPeriodHint();
  const hint = (d.getElementById('prm-period-hint') || {}).textContent || '';
  A('2  the note says where the expense lands and that August has not started', /August 2026/.test(hint) && /prepaid payroll/.test(hint), JSON.stringify(hint));

  await w.submitPayrollRun(); await settle(20, 60);
  const aug = (await runs()).find(r => r.period === 'August 2026');
  A('3  the run is stored as "August 2026"', !!aug, JSON.stringify((await runs()).map(r => r.period)));

  const nBefore = (await runs()).length;
  w.openRunPayrollModal(); await settle(4, 40);
  const p2 = d.getElementById('prm-period'); p2.type = 'text'; p2.value = 'Agust 2026';   // a browser without a month picker
  await w.submitPayrollRun(); await settle(15, 60);
  eq('4  a period that is not a month is refused — no run created', (await runs()).length, nBefore, nBefore + 1);
  try { w.closeModal('run-payroll-modal'); } catch (_) {}

  if (aug) {
    A('premise: approve August', (await http.put('/api/payroll-runs/' + aug.id + '/approve', {})).status < 300);
    w._confirmModal = async () => false;
    await w.markPayrollPaid(aug.id); await settle(15, 60);
    eq('5  "Not yet" → the run stays approved', ((await runs()).find(r => r.id === aug.id) || {}).status, 'approved');
    let asked = '';
    w._confirmModal = async (msg) => { asked = msg; return true; };
    await w.markPayrollPaid(aug.id); await settle(15, 60);
    A('6  the question names the month and the prepaid treatment', /August 2026/.test(asked) && /prepaid payroll/.test(asked), JSON.stringify(asked));
    eq('6b "Pay in advance" → paid', ((await runs()).find(r => r.id === aug.id) || {}).status, 'paid', 'approved');
    const accts = ((await http.get('/api/gl/accounts')).json || {}).accounts || [];
    const pp = accts.find(a => a.code === '1250');
    eq('6c Chart of Accounts: 1250 Prepaid Payroll = 1,800 (August net pay)', pp ? Math.round(pp.balance * 100) / 100 : null, 1800, null);
  }
});
