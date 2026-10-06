# N20 — Manual journals post to the GL and flow into the P&L / balance sheet

**Goal:** a *Posted* manual journal entry (JE) affects the P&L and balance sheet correctly, and
`glReconcile.booksBalanced` stays true. Draft JEs change nothing.

## Verified facts this plan rests on (all read from the branch `keen`)
1. JE create path (runtime winner): `finflow-api-wiring-postgres.js` → `POST /api/journals` with
   `lines: [{code, name, debit, credit}]`, `status` Draft|Posted. `code` is a **client template**
   (`COA_ACCOUNTS`, app-main.js:1159) — 16 fixed accounts, each with a `type`
   (Asset/Liability/Equity/Revenue/Expense).
2. The template codes **collide** with the GL's `DEFAULT_COA` (database.js:1280) — e.g. JE `5000`
   = Salaries but GL `5000` = COGS; JE `3000`/`3100` swap Owner's Equity / Retained Earnings;
   7 template codes have no GL account at all. **So we must NOT post by raw code.**
3. `postLedgerEntry(client,{lines:[{code,debit,credit}]})` throws on an unknown `code`
   (server.js:9741); entries must balance; idempotent on `idempotency_key`.
4. `reverseLedgerEntry(..., sourceType:'journal', sourceId)` already exists; DELETE already calls it
   for a posted JE (server.js:3311).
5. `glFinancials` rolls up **purely by `type`** (9969–9987): income=Σ income, expenses=Σ expense,
   balance sheet by asset/liability/equity. New typed accounts flow in automatically.
6. `glReconcile` (10138–10140) requires `glFinancials.income == computeBooks.revenue` and
   `Σ expense (≠7000) == computeBooks.(cogs+opex)` to the cent — the all-or-nothing invariant.
7. Reports already read FROM the GL when reconciled (Phase 5b). So once a JE is in the GL AND
   reconcile is green, it shows in the P&L/BS/dashboard with no per-surface wiring.
8. Ledger accounts created idempotently via `ON CONFLICT (user_id,entity_id,code) DO NOTHING`.

## Design
### Account bridge (collision-free)
- Server-authoritative map `JOURNAL_COA`: the 16 template codes → `{name, type}` (mirror of
  `COA_ACCOUNTS`). The server resolves a line's type by its code; an unknown code → **reject** the
  post (never guess a money classification).
- Each JE account maps to a **`J`-namespaced** ledger account: GL code = `'J'+templateCode`
  (J1010, J4000, J5000 …), `type` = template.type→GL (Revenue→income, Expenses→expense,
  Assets→asset, Liabilities→liability, Equity→equity), `normal` = asset/expense→debit else credit.
  `J`-prefix guarantees no collision with system codes; faithful per-account detail.
- `ensureJournalLedgerAccounts(client,userId,entityId,codes)` — INSERT the needed J-accounts
  ON CONFLICT DO NOTHING (same pattern as `ensureLedgerAccountsForEntity`).

### Posting
- `POST /api/journals`: after insert, if `status==='posted'`, ensure J-accounts, then
  `postLedgerEntry` with `sourceType:'journal'`, `idempotencyKey:'journal:'+id`,
  date = JE date, lines = mapped `[{code:'J'+c, debit, credit}]`. Remove the Phase-stopper NOTE.
- `PUT /api/journals/:id`: status Draft→Posted ⇒ post; Posted→Draft ⇒ reverse; a date change on a
  posted JE ⇒ reverse + repost. Best-effort GL (never breaks the write), mirroring the doc routes.
- `DELETE`: unchanged (already reverses a posted JE).

### computeBooks P&L leg
- Load `journals` (entity-scoped `ent`), posted only, `inPeriod(JE date)`; classify each line by
  `JOURNAL_COA[code].type`: income ⇒ `jeRevenue += (credit − debit)`; expense ⇒
  `jeOpex += (debit − credit)`; asset/liability/equity ⇒ no P&L effect. FX via `_fxAccrual` at the
  JE date in the entity's currency (consolidated → base), identical to every other leg.
- Fold `jeRevenue` into `revenue`, `jeOpex` into `opex` **before** netProfit. Because `glFinancials`
  sees the same lines by type, `glReconcile` stays green by construction.

### Why reconcile stays green
income JE line → GL income account (counts in `glFinancials.income`) AND → `computeBooks.revenue`.
expense JE line → GL expense account (≠7000, counts in `glExpNonFx`) AND → `computeBooks.opex`.
Both sides move by the same amount at the same date/FX ⇒ `revenueOk && expenseOk` hold; balanced
entry ⇒ trial balance and balance sheet stay balanced.

## Verification
- New harness `verify-gl-post-journal.js` (discriminating seed, direct SQL into `journals`):
  - Posted JE #1: Dr Rent (5100, expense) 100 / Cr Checking (1010, asset) 100.
  - Posted JE #2: Dr Checking (1010) 200 / Cr Service Revenue (4000, income) 200.
  - Draft JE #3: any — must contribute 0.
  - Assert: `computeBooks` opex +100, revenue +200, netProfit = revenue−cogs−opex moved correctly;
    `glFinancials` income +200 / expense +100; `glReconcile.booksBalanced === true`
    (trialBalanced && balanceSheetBalanced && reconciledToReports).
  - Multi-currency: a second entity in another currency with a posted JE; consolidated reconcile green.
- **Differential:** run the harness against the pre-change code (must FAIL — JE ignored) and the
  changed code (must PASS).
- **Full regression:** `run-verification-sweep.js` — all 416 + the new one green.

## Scope / limits (honest)
- Uses the current 16-account picker template. A future real customizable Chart of Accounts unifies
  the picker, `chart_of_accounts` table, and GL into one chart; the `J`-accounts generalize to that.
- Pure balance-sheet-only JEs (no income/expense leg) post to the GL and keep the BS balanced; their
  P&L effect is correctly zero.
