# Manual Test Queue — run with a human at the keyboard
_Logged 2026-10-01 (01:38 America/La_Paz). These require a real click / real inbox and can't be safely driven by automation._

## 1. Export PDF (every page)
- Mechanism: `exportPDF()` → `window.print()` (browser print-to-PDF).
- Why manual: `window.print()` opens the OS print dialog, which blocks browser automation.
- Test: click **Export PDF** on Dashboard, Invoices, Reports → confirm the print/save-as-PDF preview shows the right page with correct figures & currency.

## 2. Delete (invoices, expenses, customers, etc.)
- Mechanism: `deleteInvoice(i)` → custom `_confirmModal("…cannot be undone", {danger})` → `DELETE /api/invoices/:id`.
- Why manual: I don't execute permanent deletions.
- Test: delete a test invoice → confirm it disappears, AR/Dashboard update, and GL stays balanced. Repeat for an expense + a customer.

## 3. Team Invite
- Mechanism: `sendInvite()` → `POST /api/team/invite` (creates a member user + sends email).
- Why manual: creates an account + emails a person.
- Test: invite your OWN email → confirm invite email arrives, pending member shows under Team & Roles, acceptance flow works, and entity_access scoping is honored.

## 4. Invoice "Remind"
- Mechanism: overdue-invoice "Remind ↗" → sends reminder email to the customer.
- Why manual: seeded customers have fabricated addresses; firing it emails non-existent third parties.
- Test: add yourself as a customer on an overdue invoice (or use a real address) → confirm reminder email arrives and is correctly formatted.

## 5. Pay-link (follow-up)
- `ffInvoicePayLinkChoose()` runs clean but no payment provider is connected on the test account.
- Test once Stripe/WiPay is connected: generate a pay link on a pending invoice → confirm link opens a working checkout and a paid webhook settles the invoice.
