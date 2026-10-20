# FinFlow — live retest of the 2026-10-20 release (for Cowork)

**What this checks:** the fixes for the 2026-10-19 live check (`COWORK_FIX_HANDOFF.md`, FIX-1 to FIX-5) and the new
audit-trail coverage, now live on production — plus a short regression of the earlier checks.

App: https://finflow-production-dab2.up.railway.app — the same test account as the 2026-10-19 live check (owner
**Sam Owner**; businesses **Northwind Studio** (USD) and **Island Traders** (TTD)).

**Ground rules, report format and the `ZZ-LIVECHECK` naming are exactly those of `COWORK_LIVE_CHECK.md`** (record what
the screen shows; fix nothing; delete nothing; no emails, real payments, real banks or real credentials; DevTools
Console + Network open with Preserve log; note the time and timezone of each step). Unless told otherwise: Northwind
Studio, period **Year**.

---

## Part R — the release is live

**R0. The new code is deployed.** Audit page → the first filter has an option **"Connected services"**; Settings has a
section **"Recent security activity"**. If either is missing, **stop** — report that and nothing else.

---

## Part F — the 2026-10-19 findings

**F1. Time links to its project (FIX-1).** Projects → **+ New Project**: **ZZ-LIVECHECK P1** (budget **$500**) and
**ZZ-LIVECHECK P2** (budget **$300**). Timesheet → log, choosing the project in the entry's **project** field:
- 1.5 h to **P1**, billable, rate **$80**
- 0.5 h to **P1**, **non-billable**, rate $80
- 2.0 h to **P2**, billable, rate **$50**

Expected on the Projects list — **each project counts only its own entries**:

| Project | Hours | Billable value | Budget remaining |
|---|---|---|---|
| ZZ-LIVECHECK P1 | **2.0** | **$120.00** (1.5 × 80; the non-billable 0.5 h adds hours, not value) | **$380.00** |
| ZZ-LIVECHECK P2 | **2.0** | **$100.00** | **$200.00** |

The old **"ZZ-LIVECHECK project"** from 19 Oct still shows **0 h** — its entry was logged before the fix and is not
linked (expected; relinking old entries is an owner decision). Record exactly what it shows.

**F1b. Projects labels (LC1b).** The Projects cards read **"Billable value"** ("Logged time × rate") and **"Budget
remaining"** ("Budget − billable value") — **not** "Billed", "Revenue — From projects" or "Unbilled".

**F2. "Year to date" (FIX-2).** Dashboard, period Year: the Expenses card caption reads **"Year to date"** (not "Full
year total"). Reports, period Year: the period line reads **"Fiscal year to date · … – today"**. The figures are
unchanged from before the release (it is a label fix) — note them.

**F3. Record Payment warning (FIX-4).** Open an invoice that still has money owed (or **ZZ-LIVECHECK invoice**,
$100.00, pending) → Record Payment. Type, in turn:
- an amount **below** what is owed → **no** "Amount exceeds the remaining balance" warning; Save enabled
- an amount **above** it → the warning **shows**; Save disabled
- back to an amount **below** → the warning **disappears**

**Close without saving.**

**F4. No sideways scroll (FIX-5).** Resize the window to about **800, 900, 1,000, 1,100 and 1,280 px** wide. At each
width, on Dashboard, Invoices and Expenses: the page **does not scroll sideways**; the page title is **visible**; the
Export / Ask AI / bell controls are on screen (they may wrap onto a second row — that is the fix). Screenshot one width.

---

## Part T — the audit trail now records it

Audit page. For each, set the filter named in **bold** and record what rows appear (action, record, user, time).

**T1. Projects & time (FIX-3).** **Projects & time**: the two projects and three time entries from F1 are listed
(CREATE), by Sam Owner.

**T2. Quotes and budget (FIX-3).** Create quote **ZZ-LIVECHECK quote**, 1 line, $100.00; then edit it to $150.00.
**Quotes**: a CREATE and an UPDATE; the UPDATE shows the amount **100 → 150**. Budget page: set a monthly budget of
**$25** for any expense category. **Budget**: an UPDATE with that category and 25.

**T3. Money routes (FIX-3b).** Banking (Northwind) → add a manual bank line **ZZ-LIVECHECK line**, **$1.00**.
**Bank feed & reconciliation**: a CREATE for it.

**T4. Security log (LC3d).** In a **private window**, try to sign in to the test account with a **wrong password** once,
then close that window. In the main window: Settings → **Recent security activity** lists, newest first, the
**Failed sign-in** (with its IP and device) and this session's **Signed in** (e.g. "Chrome on Windows"). Audit page,
action filter **Security (sign-in, 2FA, password)**: the same events. No password appears anywhere. (Alert e-mails are
not checked here — e-mail is not configured for real users yet.)

**T5. Integration request (LC3e).** Integrations page → pick an integration that is **not built yet** and click its
**Request** button (do **not** connect anything). Audit filter **Sign-ins & account**: a CREATE naming that
integration. Filter **Connected services**: record what it shows (expected: nothing new — no service was connected).

**T6. Accountant side (LC3f) — only if an accountant login is available.** As the client (Sam Owner), send a message
**ZZ-LIVECHECK hello** to the accountant. Audit filter **Accountant**: a **MESSAGE** row naming the sender — **not**
the message text. If no accountant is linked, mark **BLOCKED**.

**T7. The wall.** Personal → add a transaction **ZZ-LIVECHECK personal**, $5.00. Back on Northwind's Audit page
(Everything): **no** row for it, and no personal item anywhere on the page. (Personal records are deliberately kept off
the business trail; a separate personal history is not built yet.)

**T8. Edit shows what changed.** Edit time entry 2.0 h → **2.5 h** (P2). Audit: an UPDATE showing hours **2 → 2.5**,
and Projects now shows P2 **2.5 h / $125.00 / $175.00**.

---

## Part G — regression (from `COWORK_LIVE_CHECK.md`)

Run these checks exactly as written there: **A1** (hard reload ×2: 0 boot errors, no $0 cards), **B1** (P&L
reconciles end to end), **B2** (receivables reconcile), **B5** (each action writes once — use new `ZZ-LIVECHECK`
names), **B6** (payroll December run → owner salary in Personal → void removes it), **B7** (the wall), **B8** (Island
Traders in TT$), **C15** (every page, every console; then ~390 px).

---

## Final summary (top of your report)

- R: PASS / FAIL. F: n/6 (F1, F1b, F2, F3, F4 + the old project). T: n/8. G: n/8.
- Every FAIL in one line, worst first, with the figure seen vs expected.
- Every `ZZ-LIVECHECK` record created (type, name, amount) — for the owner to clean up.
- Every red console error (full text + stack) with its step, and any full page reload.
