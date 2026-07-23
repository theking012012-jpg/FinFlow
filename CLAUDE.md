# CLAUDE.md — FinFlow

**Read this fully before touching anything.**

Every rule below exists because breaking it produced a real production defect in this
codebase. None of it is style preference. If a rule seems like overhead, that is because
the failure it prevents is invisible until it reaches the owner's live books.

---

## The project

FinFlow — accounting and financial management SaaS. Node/Express + Postgres (Supabase,
session pooler), hosted on Railway, auto-deploys from `main`. Single-founder build: the
owner is the planning, decision and approval layer; Claude Code writes the code.

`AUDIT_MASTER.md` tracks findings and decisions. It is a **ledger, not a proof of
correctness** — see "What done means" at the bottom.

---

## THE THREE FAILURES THAT DEFINE THIS CODEBASE

Everything else in this file follows from these. They have each happened more than once.

### 1. Dead-code shadowing
`app-main.js` defines a function. A wiring file then does `window.NAME = function(){…}`.
The bundle loads **after** `app-main.js`, so the wiring copy wins at runtime and the
`app-main` copy is dead code.

**23 of 28 shadowed functions are replacement overrides.** Two past "fixes" (`2a70564`
gross colour, `3bdae44` edit pencil) were applied to the dead copy, produced clean diffs,
were marked done, and **never rendered once**. The owner reported the same bug months
later.

5 of the 28 are *wrapper* overrides (they save and call `_origNAME`) — for those, editing
`app-main` does take effect. The distinction is load-bearing. Do not assume either way.

### 2. Multi-writer money figures
The same money figure is computed independently in several places, client and server, from
different sources. Six surfaces display an expense figure; after basis C only two of them
included payroll runs. Client and server both recompute revenue, AR, COGS and payroll.

Every such mirror is a future divergence. Fixing one surface and not the others is how
`F7`, `F56` and the payroll leg all regrew the same defect.

### 3. Tests that pass against fabricated reality
The golden master seeded `status:'final'` — a value that **does not exist** in the schema
(real vocabulary: `draft` / `approved` / `paid`). It passed, because nothing filtered
status. 62 green assertions, defect shipped to production.

Four separate stub-fidelity bugs occurred in a single session: an `async` keyword stripped
during source extraction, a stub returning `undefined` that silently became `0`, a new JOIN
the stub did not serve, and a paren-counter tripped by a `)` inside a code comment.

---

## Non-negotiable workflow

```
read-only investigate  →  report evidence  →  propose  →  diff  →  verify  →  HOLD  →  commit
```

- **Never commit without explicit owner approval.** Not "I'll commit unless you object."
- **Read-only first.** Investigate and report before proposing a fix. If blocked, say so
  and build a read-only instrument — never invent the answer.
- **Root fixes only.** If the same bug has appeared before, the previous fix was wrong.
  Find why it recurred; do not re-patch the symptom.
- **One fix per commit.** Two money changes in one commit means neither can be reverted
  independently.
- **Edit wiring sources, never `public/finflow-bundle.js`.** The `F13` pre-commit hook
  regenerates it; edits to the bundle are silently destroyed.

---

## Rule 1 — Find the runtime winner before you edit

Before editing any client function, determine which copy actually executes.

```bash
grep -n "function NAME" public/app-main.js
grep -rn "window.NAME *=" public/finflow-api-wiring-*.js
```

If a wiring file assigns `window.NAME`, that is the runtime winner **unless** its body
references a saved original (`_origNAME`), which makes it a wrapper.

Editing the shadowed copy produces a clean diff, a passing build, and zero effect.
This is the single most expensive trap in this repo.

---

## Rule 2 — A money figure lives on N surfaces, not one

Before changing how any figure is computed, enumerate **every** surface that displays it:
dashboard KPI, page-level stat cards, breakdown bars, charts, transaction lists, the
server engine (`computeBooks`), `/api/reports`, `/books`, the accountant portal, exports
(PDF/CSV).

Then either fix all of them, or fix the ones in scope and **log the rest as findings with
numbers**. Never leave an unfixed mirror mentioned only in prose — that is exactly how
`F55` survived three audits.

---

## Rule 3 — No stubs for money paths

Test against a **real Postgres instance with the real schema**, seeded with real rows,
hitting the real endpoints. Not a hand-written pool stub.

A stub is a second implementation of your database written by the person trying to prove
their code correct. It will agree with them. `status:'final'` could never have survived an
`INSERT` against the real schema.

Scratch database only. **Never test against production.**

---

## Rule 4 — Seeds must discriminate

A seed where the correct implementation and the suspected bug produce the **same number**
proves nothing, however green it goes.

The FIFO case: a single uniform-cost layer (10 @ $100) yields identical period COGS whether
the code preserves cross-period layer order or wrongly refilters from the cheapest layer.
The fix was two layers at different prices (4 @ $100, then 10 @ $200) with an earlier sale
exhausting the cheap one — so a correct implementation gives 400 and the bug gives 200.

**Design every seed so that the bug you are testing for changes the number.** State
explicitly, in the test, what value the buggy implementation would produce.

Corollary: seed values must differ from each other in ways that identify the *source*. If
the roster is $5,000/mo and the run is also $5,000, a passing test cannot tell you which
one was read.

---

## Rule 5 — Assert on executed values, never on source text

Run the code and compare numbers. Do not grep the source for patterns and call it a test.

Structural assertions (proving a code path was *deleted*, which no value can express) are
permitted but must be **explicitly labelled as structural** so their weight is visible.

Corollary: extracting functions by slicing source text is fragile by construction — it has
failed four times. Prefer making functions importable over improving the extractor.

Corollary: **`git log -L :funcname:file` OVER-REPORTS.** Its function-range detection sweeps in
adjacent lines, so a commit that only touched a neighbouring comment block is attributed to the
function. It attributed `469fd1a` to `saveProduct` that way — reported as a confirmed dead-copy
edit, and it was a false positive that cost a round trip. **Any commit `-L` flags must be
confirmed against the actual diff hunk before being called confirmed — it is "suspect" until
then.** The same caution applies to every line-range or text-proximity heuristic.

---

## Rule 6 — Agreement is not correctness

Client and server agreeing proves only that they share an assumption. During the payroll
double-count, dashboard == `/api/reports` == `/books` **while all three were wrong**, and
every consistency check passed.

Always check against an independently derived expected value — hand-computed by the owner,
not derived from the code under test. The code must never grade its own homework.

---

## Rule 7 — Never fabricate. Build the instrument instead

If you cannot reach the data, say so plainly and build a read-only tool the owner can run.
Report what you measured; never report what you assume.

Read-only tools must:
- contain `SELECT` statements only, with the parameters bound
- have no apply/write mode and no transaction control
- **be checked for import side effects** — `require('../database.js')` executes that module.
  If it invoked `initDB()`, merely importing it would fire `CREATE TABLE` / `ALTER TABLE`
  DDL at production. A scan of the script's own SQL would not catch that.
- print real error detail (`err.message`, `err.code`, `err.stack`, and `AggregateError.errors`)
  — a failure message that says nothing is as bad as a green test that proves nothing

---

## Rule 8 — Data changes are owner-gated and always separate

Never migrate, delete, reclassify or backfill rows as part of a code fix. Enumerate what
exists, report it, and hold for a decision. Historical data cleanup is its own commit and
its own approval.

A green test proves the code is right going forward. It says nothing about existing rows.

---

## Rule 9 — Idempotency at the write, not guards on the button

Existing dedupe uses `findRecentDuplicate` — a **5-second time window heuristic**. A slow
double-submit, or a differing parameter, defeats it. This is why the same double-fire
defect resurfaced on Run Payroll and Approve after being "fixed" for Record Payment.

Double-submit protection must be a **single shared mechanism every mutating handler routes
through** (unique constraint or idempotency key), so a new mutating action cannot ship
without it. Per-button patches are the failure mode, not the fix.

---

## Rule 10 — An accounting date is a calendar date, not an instant

'2026-06-01' has no time and no timezone. Converting it to an instant forces a timezone to be
chosen, and that choice makes the answer depend on WHO IS ASKING.

Confirmed by execution (F87). Period windows are built at the VIEWER'S local midnight
(app-main.js:1744, `new Date(fyStartYear, fyStartIdx + idx, 1)`) and compared instant-to-instant
against `new Date(value)` (server.js:3978), where a date-only string parses to UTC midnight.
Consequences:

- Two users in different timezones see DIFFERENT TOTALS for the same books. In the accountant
  marketplace, accountant and client disagree on the same period.
- The error is ASYMMETRIC. West of UTC a row dated the 1st falls before the local-midnight
  boundary and files into the previous month. East of UTC it does not. A London user sees
  correct figures; a New York user does not.
- A row dated 1 January misfiles into the PREVIOUS FISCAL YEAR.

The fix is not a better timezone — not UTC, not the entity's. Every choice still makes an
accounting date depend on a zone, and every choice is wrong for somebody. The fix is removing
timezone from the comparison: compare date strings to date strings, never Date to Date.

GENUINE TIMESTAMPS ARE THE OTHER HALF. A value like run_date = NOW() is a real instant, not a
calendar date, and assigning an instant to a month still requires choosing whose month. That
choice belongs to the BUSINESS, not the reader: books have a timezone, viewers don't. Genuine
timestamps resolve against the entity's timezone. Better still, an event that belongs to a
period by intent (a June payroll run) should carry that period explicitly rather than being
inferred from when a button was clicked — see F85.

TESTING COROLLARY: a timezone matrix must span the SIGN boundary — at least one positive offset.
UTC-4 and UTC-8 misfile identically, so a western-only matrix goes green on the bug it exists to
catch. This already produced one false negative.

SEED COROLLARY: a date-only seed cannot detect viewer dependence at all — every row lands before
every western boundary, so all viewers are wrong identically and nothing moves. Detecting it
requires a row timestamped inside the inter-viewer gap. Rule 4, applied to timezone.

UNDER INVESTIGATION: timezone may be one instance of a broader class — any setting stored
PER-USER but applied to PER-ENTITY books yields viewer-dependent figures. Fiscal-year start and
display currency are being checked as the same shape.

---

## Rule 11 — Status vocabularies are real and must be checked

Never guess status values. Read the schema.

- Invoices: revenue allowlist is `pending` / `overdue` / `partial` / `paid`. `draft` is
  excluded. Basis is **ACCRUAL, ISSUE-BASED** — revenue is recognised when an invoice is
  issued, not when paid (owner decision, 18 July).
- Payroll runs: `draft` / `approved` / `paid`.
- Bills use a **different** vocabulary from invoices — the invoice AR helper does not apply
  to AP. Do not force it.

---

## Rule 12 — Payroll basis C

`payroll_runs` line items are the **single source of truth** for payroll expense. The roster
is a template and must produce no figure. The synthetic `roster × elapsedMonths` accrual is
deleted and must not return in any form.

Note: `payroll_runs.total_gross` (header) and `Σ payroll_run_lines` are stored independently
and can disagree. Basis C reads **the lines**. A header/lines divergence is a finding — it
means something wrote one of them wrong — not something to reconcile silently.

---

## Rule 13 — No finding is complete until its class is enumerated

Every finding starts as one instance someone happened to notice. Before it is logged, ask: what
class does this belong to, and where else does it apply? Report the full set, not the sighting.

This codebase's defining failure is fixing the instance instead of the class. B8 dedupe was
patched on two buttons rather than made an invariant, and resurfaced on Run Payroll and Approve.
F25 was fixed for revenue but not COGS. Basis C updated the KPI path but not the breakdown,
chart or transactions list. Each was a correct fix to an incomplete scope.

Enumerate from BOTH directions. Code-side ("where is this called") finds what exists.
Surface-side ("what does the user see, and what feeds it") finds what matters. Neither alone is
complete, and the two lists reconciling is the evidence that the enumeration is whole.

The rule binds review as much as implementation. "Period windows use local time (owner is
GMT-4)" recorded the instance and buried the class — that parenthetical was F87. "auditLog() is
called twice" recorded a count without asking "out of how many", which is the difference between
a gap and an absence.

A finding that names one surface when the defect spans six is not a finding. It is a sighting.

---

## Rule 14 — A fix is not verified until its failure path is executed

Reasoning about what a fix will do is not verification. In this codebase, every conclusion
reached by reasoning rather than execution has eventually been wrong: a null-entity clause called
a double-count that wasn't; a timezone matrix that reported zero differences because the seed
could not discriminate; a stale-detector whose regex never matched; four boot-fetch treatments
shipped as pattern-mirrors.

Mirroring a verified pattern is a reasonable way to WRITE a fix. It is not evidence the fix
works. The pattern may not fit, the wiring may differ, the call site may not be reached.

If executing a failure path is expensive, that expense is a TOOLING GAP to close, not a reason to
skip the test. Generic failure injection exists precisely so this excuse cannot recur.

Where a fix genuinely cannot be executed, it ships labelled UNEXECUTED — in the commit message
and in the finding — so nobody later cites it as verified.

---

## Reporting to the owner

**Evidence, not conclusions.** "Neither leg filters status" is a claim that must be
trusted. The five lines of the query are evidence that can be checked. Paste the actual
diff, the actual query, the actual test output, the actual row counts.

When blocked, say what is blocking and what you would need. Do not proceed on an assumption
and label it a finding.

When you find something outside the current task, **log it with a number**. Do not fold it
into the current commit, and do not leave it as a sentence in a chat message.

State the limits of what you verified. "I confirmed X by reading the code" and "I confirmed
X by executing it against real data" are different claims and must not sound alike.

**Correcting your own findings rows with results you have already verified is always in scope
and never needs asking.** If you verify something that changes a row — a suspect cleared, a
count corrected, a claim withdrawn — update the row in the same turn. Do not ask permission to
record what you just proved. Verified results that live only in a chat message are exactly how
`F55` survived three audits.

---

## What "done" means

`AUDIT_MASTER.md` is a **findings ledger**. It records what someone happened to notice. It
can never state that a figure is correct — only that no one has reported it wrong.

Correctness is established by `VERIFICATION.md`: a fixed, finite list of every figure the
app displays and every mutating action it performs, each asserted against an
owner-supplied expected value on real seeded data.

**Done = every check in `VERIFICATION.md` green.** Anything not on that list is explicitly
*unverified*, not assumed correct.

Rules for a sweep:
1. Run **every** check before fixing anything. Fix-as-you-find guarantees an endless drip.
2. **Freeze the failure list.** Anything discovered later goes on a separate list for the
   next round. The scope of a round does not grow while the round is being worked.
3. **Re-run every check after the fixes**, not only the ones that failed. A fix that breaks
   a different surface must surface in the same run, not months later at 3am.
