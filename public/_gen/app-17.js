
(function(){
  const _open = (name) => function(){
    const fn = window[name];
    if (typeof fn === 'function') return fn.apply(this, arguments);
    console.warn('[Modal alias] target function not found:', name);
  };
  const _modal = (id) => function(){
    const m = document.getElementById(id);
    if (m) { m.classList.remove('hidden'); m.style.display='flex'; return; }
    console.warn('[Modal alias] modal HTML not found:', id);
  };
  // 18 aliases required by live-tested buttons. Each prefers the existing
  // canonical opener; falls back to directly showing the modal if needed.
  window.openQuoteModal             = window.openQuoteModal             || function(){ (window.openNewQuoteModal           || _modal('quote-modal'))(); };
  window.openBillModal              = window.openBillModal              || function(){ (window.openNewBillModal            || _modal('bill-modal'))(); };
  window.openVendorModal            = window.openVendorModal            || function(){ (window.openNewVendorModal          || _modal('vendor-modal'))(); };
  window.openPayrollModal           = window.openPayrollModal           || function(){ (window.openOwnerModal              || _modal('owner-modal'))(); };
  window.openInventoryModal         = window.openInventoryModal         || function(){ (window.openProductModal            || _modal('product-modal'))(); };
  window.openItemModal              = window.openItemModal              || function(){ (window.openNewItemModal            || _modal('item-modal'))(); };
  window.openProjectModal           = window.openProjectModal           || function(){ (window.openNewProjectModal         || _modal('project-modal'))(); };
  window.openTimesheetModal         = window.openTimesheetModal         || function(){ (window.openLogTimeModal            || _modal('timesheet-modal'))(); };
  window.openReceiptModal           = window.openReceiptModal           || function(){ (window.openNewReceiptModal         || _modal('modal-receipt'))(); };
  window.openPaymentReceivedModal   = window.openPaymentReceivedModal   || function(){ _modal('modal-payment-received')(); };  // F35 Step 5: fallback no longer references openRecordPaymentModal (that is now the invoice Store-B opener)
  window.openPaymentMadeModal       = window.openPaymentMadeModal       || function(){ (window.openMakePaymentModal        || _modal('modal-payment-made'))(); };
  window.openRecurringInvoiceModal  = window.openRecurringInvoiceModal  || function(){ (window.openNewRecurringModal       || _modal('recurring-inv-modal'))(); };
  window.openRecurringBillModal     = window.openRecurringBillModal     || function(){ (window.openNewRecurringBillModal   || _modal('recurring-bill-modal'))(); };
  window.openCreditNoteModal        = window.openCreditNoteModal        || function(){ (window.openNewCreditNoteModal      || _modal('modal-credit-note'))(); };
  window.openVendorCreditModal      = window.openVendorCreditModal      || function(){ (window.openNewVendorCreditModal    || _modal('modal-vendor-credit'))(); };
  window.openInvestmentModal        = window.openInvestmentModal        || function(){ (window.openAddHoldingModal         || _modal('holding-modal'))(); };
  window.openPersonalModal          = window.openPersonalModal          || function(){ (window.openTransactionModal        || _modal('transaction-modal'))(); };
  window.openBankingModal           = window.openBankingModal           || function(){ (window.openAddTxnModal              || window.openAddAccountModal || _modal('reconcile-modal'))(); };
})();
