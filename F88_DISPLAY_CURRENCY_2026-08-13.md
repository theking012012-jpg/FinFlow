# F88 2b — display-currency viewer-dependence: findings (2026-08-13)

**Requested:** decide whether the per-user display currency is a correctness defect (and if so, make
it an entity property). **Read-only investigation. HOLD — no code changed.**

**Conclusion: NOT a correctness defect.** The books' authoritative figures are the entity's **native**
currency and are viewer-independent; the accountant marketplace reads native on both sides; display
currency is a faithful **client-side view preference** over those native figures, not a change to the
books. The one genuinely unverified piece is the reconciliation check (**A8c**), which is deliberately
deferred to the Appendix B FX pass because the base seed is USD-only. F88 2b should be **downgraded**,
and the "entity-property" idea is an optional UX nicety, not a fix.

## Evidence

1. **Native is the single source of truth, viewer-independent.**
   - `computeBooks(uid, eid, period, display=null, …)` with no display ⇒ **identity/native**
     (server.js:4744, 3748-3755). This is what every A5/step3 check asserts, and step4 proves the
     native client figures are identical across four timezones.
   - Storage is always native: no `display_currency` column exists; `window._displayCurrency` is a
     browser global (app-main.js:4898), null by default ⇒ native.

2. **The accountant marketplace reads NATIVE on both sides — the "two viewers disagree" concern does
   not arise.**
   - Both accountant reads call `computeBooks(userId, entityId, period, null, fyStartIdx)` —
     **display = null** (accountant-routes.js:578, 581) — and the portal surfaces each entity's own
     `currency` (accountant-routes.js:544, 613).
   - So the accountant sees the entity's native figures; the client sees the same native figures by
     default. There is no path where accountant and client disagree on the authoritative number. (This
     is unlike fiscal-year F88 2a and timezone F87, where the *books'* boundaries could move per reader
     — display currency changes only a personal lens, never the stored/native figure.)

3. **Display currency is a faithful, labelled conversion — and the symbol-matches-value correctness is
   already verified.**
   - A non-native display triggers `?display=CCY`, converting **each leg at its own recognition-date
     rate** (server.js:3746-3755); a missing rate renders "—", never a relabel (server.js:3802-3804).
   - `f124-native-currency-surfaces.js` executes the real chart/KPI code with entity=TTD, display=EUR
     and asserts every figure's **symbol names the currency the value is actually in** ('$' vs 'TT$'
     vs '€' are three distinct strings, Rule 4). So a converted number can't be shown with the wrong
     symbol, and a native number can't be silently relabelled.

## The one real gap: A8c is unverified (deferred to the FX pass, by design)

`VERIFICATION.md` A8c (display-currency **reconciliation** — converted figures reconcile exactly back
to native at the stated rate, and don't reconcile *differently each day*) has a **blank** result. It
is not automated because the base seed is **USD-only** (VERIFICATION Environment: "FX has its own
pass — Appendix B"). This is the actual remaining verification, and it is a scoped pass, not a bug:

- **Appendix B FX pass** — add one EUR invoice + one EUR expense and seeded `fx_rates` (USD↔EUR), set a
  non-USD display, and re-run Part A converted: assert (a) figures convert, (b) symbols match, (c) a
  blocked rate yields "—" not a native number presented as converted, and (d) native ↔ converted
  reconcile exactly at the stated rate. That closes A8c and the FX appendix together.

Until then A8c is **explicitly unverified**, not assumed correct — but it is a *verification* gap, not a
known wrong number: native (the authoritative figure) is verified, and the conversion path is
symbol-correct (f124) and renders "—" on a missing rate.

## Recommendation

1. **Downgrade F88 2b** from "the last live viewer-dependence" to "by-design view preference; native is
   authoritative and read by the marketplace; reconciliation (A8c) tracked under the Appendix B FX
   pass." (Ledger updated accordingly.)
2. **Optional, low priority (owner UX call, not correctness):** persist display currency per-entity so a
   client's own dashboard defaults consistently across devices. Low value — the accountant already sees
   native, and the client's preference already persists within a session.
3. **The genuinely worthwhile next verification is the Appendix B FX pass** (closes A8c + Appendix B). I
   can build it as a probe (seed EUR rows + rates, fail-then-pass with a rate-blocked control) on your
   go — it's the display-currency analogue of what `verify-a9-future-dated.js` just did for D2.
