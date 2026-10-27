'use strict';
/**
 * FA-B4 (2026-10-27) — on the real page: every form that names a customer or vendor offers the saved ones, and a
 * company-only customer with no email can be saved from the Customers form.
 *
 * Seed: clientMoneyKit — its invoices saved customers "Acme Ltd", "Beta Co", "Gamma" and its bill saved vendor
 * "Supply Co" (batch 9). Bug values: the seven forms had no list (a typed name only); the Customers form refused a
 * company-only customer ("First name and last name are required") and a missing email.
 */
const { run } = require('./clientMoneyKit.js');

run('FA-B4 UI — saved contacts on every document form; a company-only customer', async ({ w, d, settle, http, eq }) => {
  const offers = async (opener, inputId) => {
    w[opener](); await settle(12, 30);
    const inp = d.getElementById(inputId); const dl = inp && inp.getAttribute('list') ? d.getElementById(inp.getAttribute('list')) : null;
    const names = dl ? Array.from(dl.options).map(o => o.value) : [];
    try { d.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden')); } catch (_) {}
    return names;
  };
  const cust = [['openNewQuoteModal', 'quote-client'], ['openNewReceiptModal', 'receipt-customer'], ['openNewCreditNoteModal', 'cn-customer'], ['openNewRecurringModal', 'ri-client']];
  const vend = [['openMakePaymentModal', 'pm-vendor'], ['openNewVendorCreditModal', 'vc-vendor'], ['openNewRecurringBillModal', 'rb-vendor']];
  const cOut = []; for (const [o, i] of cust) cOut.push([i, (await offers(o, i)).includes('Acme Ltd')]);
  eq('1  the quote, receipt, credit-note and recurring-invoice forms offer the saved customer "Acme Ltd"', cOut, cust.map(([, i]) => [i, true]), cust.map(([, i]) => [i, false]));
  const vOut = []; for (const [o, i] of vend) vOut.push([i, (await offers(o, i)).includes('Supply Co')]);
  eq('1  the payment, vendor-credit and recurring-bill forms offer the saved vendor "Supply Co"', vOut, vend.map(([, i]) => [i, true]), vend.map(([, i]) => [i, false]));

  w.openCustomerModal(); await settle(5, 20);
  d.getElementById('cust-company').value = 'Delta Traders';
  await w.saveCustomer(); await settle(20, 40);
  const saved = ((await http.get('/api/customers')).json || []).filter(c => c.company === 'Delta Traders').map(c => [c.company, c.email || '']);
  eq('2  the Customers form saves a company-only customer with no email', saved, [['Delta Traders', '']], []);
  w.openCustomerModal(); await settle(5, 20);
  await w.saveCustomer(); await settle(10, 30);
  eq('2  …and still refuses a customer with no name at all', ((await http.get('/api/customers')).json || []).filter(c => !c.company && !c.fname && !c.lname).length, 0);
});
