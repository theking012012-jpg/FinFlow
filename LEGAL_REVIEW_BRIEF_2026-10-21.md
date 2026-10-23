# FinFlow — brief for legal review

**Documents for review (attached):** Terms of Service, Privacy Policy, Security overview — drafts as they will appear
on the website.

**Not yet in the drafts — please advise:** the contracting company's legal name and registered address, the governing
law and courts, and the retention period described in question 4 below. These will be added once decided.

## What FinFlow is

- Accounting and financial-management software (SaaS) for small businesses, with a separate **personal finance** area
  for the account holder. Personal and business data are kept strictly separate.
- **Multi-currency and multi-country**: around 50 currencies and 53 countries; each business keeps its books in its own
  currency and timezone. Customers may be in the UK, the EU, the Americas and the Caribbean.
- **Bank data**: users can link bank accounts through **Plaid** (US / Canada / UK / EU) and **Belvo** (Latin America),
  or upload bank statement files. Linked banks sync transactions automatically; bank access tokens are stored
  encrypted.
- **Payments**: invoices can include payment links (Stripe and other processors); a payment made through a link is
  recorded on the invoice automatically. FinFlow does not hold customer funds.
- **Tax**: FinFlow calculates **income-tax estimates only**. It does not file returns and has no VAT / GST / sales-tax
  calculation.
- **Accountant marketplace**: a business can engage an accountant through FinFlow, who then sees that business's books;
  accountants may receive referral payments.
- **AI features**: an AI assistant, insights and receipt scanning, provided by Anthropic.
- **Team access**: roles Owner, Admin, Accountant, Viewer.
- **Security log**: sign-ins, failed sign-ins and password / two-factor events are recorded with IP address and
  device; users are e-mailed about events such as a sign-in from a new device.
- **Audit trail**: every change to a business's books is recorded (who, when, what). When an account is deleted the
  audit trail is kept as a financial record; all other account and personal data is erased.
- **Free trial**: when a trial ends without a paid plan, the account becomes read-only (data can still be viewed and
  exported).
- **Service providers**: Railway (hosting), Supabase (database), Stripe (billing and payments), Resend (e-mail),
  Anthropic (AI), Sentry (error monitoring), Cloudflare (network security, if used), Plaid and Belvo (bank data), and
  any accounting / commerce platform a user chooses to connect.

## Questions on the three documents

1. **Controller / processor**: FinFlow processes customers' business records on their behalf, and is controller for the
   account holder's own data. Is a data processing agreement needed for business customers, and what form?
2. **Bank data (Plaid / Belvo)**: is the disclosure sufficient, including the end-user consent wording Plaid requires
   and how a user revokes access?
3. **Service providers**: is naming them in the Privacy Policy sufficient, or is a separate sub-processor list needed?
4. **Retention after account deletion**: the audit trail is kept because it is a financial record, and it contains
   sign-in IP addresses and device names. How long may — or must — FinFlow keep that data after an account is deleted?
   Options considered: keep the records indefinitely; keep them but erase the IP and device details after a set period;
   or delete the security records after a set period.
5. **International transfers**: UK and EU users' data is processed by US providers — what transfer mechanism and
   wording are required?
6. **Breach notification**: what commitment and timeline should be stated?
7. **Tax disclaimer**: is "estimates only, not advice, no filing, no VAT / GST" sufficient?
8. **Accountant marketplace**: FinFlow's role between client and accountant, liability for the accountant's advice,
   disclosure of referral payments, and the client's control of access.
9. **Payments**: is the wording on payment links / Stripe sufficient to show FinFlow is not a party to the payment or
   a money transmitter, and who bears disputes and refunds?
10. **Subscriptions**: trial, read-only after trial, refunds, price changes, cancellation, export on exit.
11. **Limitation of liability, acceptable use, governing law and venue** — enforceability in the countries sold into.
12. **Security overview**: are the statements appropriately worded for a public page?

## Further areas to advise on (beyond the three documents)

This list is not exhaustive; please confirm what applies.

**UK data protection**
- UK GDPR / Data Protection Act 2018: lawful bases, record of processing, a DPIA (financial and bank data), handling
  of access / erasure / portability requests, breach process (72 hours to the ICO).
- ICO registration / data-protection fee.
- PECR: cookie consent (a session cookie and page-view analytics with IP-based coarse location) and e-mail marketing.
- International transfer mechanism (UK IDTA / Addendum) for US providers.
- AI: transparency wording; no solely automated decisions with legal effect.

**Financial-services regulation (UK)**
- **Account information services**: reading UK users' bank data through Plaid is a regulated activity. Can FinFlow rely
  on Plaid's FCA permission (as its agent or under its terms), or does it need its own registration?
- Payment links / Stripe Connect: confirm FinFlow is outside the Payment Services Regulations and e-money rules.
- Financial promotions: marketing claims about savings, tax or cash flow.

**Consumer and commercial**
- Whether sole traders count as consumers: Consumer Rights Act 2015, Consumer Contracts Regulations (14-day
  cancellation), auto-renewal and price-change notice, and the subscription-contract rules under the DMCC Act 2024.
- Unfair-terms review of the limitation of liability.
- Website trading disclosures (company name, number, registered office, contact details, VAT number).
- VAT on FinFlow's own subscriptions (UK and overseas customers).
- Accessibility (Equality Act).
- **Marketing content**: the website shows customer testimonials and price comparisons with other accounting products
  — please confirm what is needed for these to be lawful (DMCC Act 2024 fake-review rules; comparative advertising).

**Accountant marketplace**
- Platform terms between FinFlow, clients and accountants; referral-payment disclosure; professional-body rules for the
  accountants; who is controller for client data the accountant sees.

**Records and retention**
- Customers must keep their own accounting records for statutory periods (e.g. 6 years in the UK) — how should account
  deletion and data export be worded around that duty?

**Other markets (those sold into at launch)**
- EU GDPR (including an EU representative if there is no EU establishment), US state privacy laws, Latin American laws
  (e.g. Brazil, Mexico) for Belvo users, Caribbean data-protection acts.

**Third-party terms the documents must respect**
- Plaid, Belvo, Stripe (including Connect), the connected accounting / commerce platforms' developer terms, and
  Anthropic's usage policy.

## Added 23 October 2026

13. **Professional Conduct Policy for accountants** (new document, `/conduct.html`, version 1.0). Accountants must accept
    it to join, and existing accountants are asked to accept it; access to client books pauses 14 days after they are
    asked if they have not. Please review the whole document, and in particular section 8 (keeping work on the platform):
    a 24-month non-circumvention period, a conversion fee (10% of the previous 12 months' fees billed through FinFlow,
    minimum USD 250), and the penalties — warning plus repayment, 90-day suspension, permanent removal with forfeiture of
    unpaid referral payments and set-off. Are these enforceable in the countries we operate in, and proportionate?
14. **Legal entity name**: the website and documents currently say "FinFlow Inc.". The correct registered entity will be
    confirmed once registered; all documents and the website will then name it.
15. **Subscriptions — new commitments to word**: annual plans at 20% off; customers may leave an annual plan at any time
    and are refunded what was paid minus the months used, charged at the monthly price; a renewal reminder 30 days
    before each annual renewal; prices locked for the paid term; a self-serve downgrade that takes effect at the end of
    the billing period. Terms section 6 currently says fees are non-refundable — it needs to change to match.
16. **Data after cancellation**: proposed policy — export at any time; read-only access for 90 days after cancellation;
    a warning 14 days before deletion; then deletion, except the audit trail of changes to the books (see question 4).
    Is this consistent with customers' own record-keeping duties (question under "Records and retention")?
17. **Marketing content (update)**: the testimonials, invented company logos, unsourced statistics and the competitor
    price comparison have been removed from the website.
