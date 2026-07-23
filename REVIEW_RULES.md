# REVIEW_RULES.md — the review layer

`CLAUDE.md` governs **Claude Code**, which writes the code. This file records that a second
set of rules governs the **review layer** — the Claude instance the owner plans and decides
with, which does not write code.

## Where the binding copy lives

**The project's custom instructions in claude.ai.** Not here.

That is deliberate. The review-layer Claude does not automatically read this repository at the
start of a conversation; it reads the project instructions. Rules stored only in a repo file
would not be loaded, and would create a second copy that drifts out of sync — the exact defect
that made `VERIFICATION.md` contradict itself when expected values lived in three places.

**Do not copy the rule text into this file.** One source, edited in one place.

## What the rules cover, in summary

1. **Read before claiming** — every statement about the code cites a file and line actually
   read from the repo. Never infer from Claude Code's summaries and present it as fact.
2. **Cause before symptom** — when a bug is reported, first establish *why* it happens, not
   how the app should behave when it does.
3. **No unrequested prompts** — default to conversation; one prompt per turn, only when asked.
4. **Answer the question asked** — not the surrounding context.
5. **Enumerate the class** — one instance is a sighting, not a finding (`CLAUDE.md` Rule 13).

## Why they exist

Each traces to a specific failure during the audit:

- Fourteen hours of analysis were produced by reasoning about *descriptions* of the code while
  direct read access to the repository existed and was never tested. Conclusions reached that
  way — a null-entity clause called a double-count that wasn't, an audit-trail count reported
  without a denominator, "period windows use local time (owner is GMT-4)" recording the
  instance and burying the class — were wrong.
- Two consecutive Claude Code prompts investigated how the dashboard should *render* a failed
  fetch. Neither asked why the fetches were failing. The cause was an API rate limiter at
  `server.js:305` combined with fifteen loaders firing eagerly at boot — both readable at any
  time. Findings F96, F97 and F98 are real, but all downstream of it.
- Prompts issued reflexively, several per turn, superseding each other mid-flight, forced the
  owner to ask which one to send.

Rule 1 is the load-bearing one because it is the only one that is *checkable*: a claim about
the code without a file and line number is inference, and should be treated as worthless.

## Relationship to the other documents

| File | Governs | Read by |
|---|---|---|
| `CLAUDE.md` | implementation | Claude Code, every session |
| `VERIFICATION.md` | what "correct" means | both, when verifying |
| `AUDIT_MASTER.md` | findings, decisions, limitations | both, as the ledger |
| project instructions | the review layer | review Claude, every message |
| this file | a pointer to the above | humans, and anyone auditing the setup |
