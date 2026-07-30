#!/usr/bin/env bash
# tests/h1-from-index.test.sh
#
# H1 proof — the pre-commit bundle guard must build the committed bundle from the
# STAGED sources, never the working tree.
#
# Setup: partially stage one wiring source — index = edit1, working tree =
# edit1+edit2 — then commit. The committed bundle MUST carry edit1 (the staged
# edit) and MUST NOT carry edit2 (the unstaged edit).
#
#   OLD hook  (node bundle.js reads the working tree, hook `git add`s it):
#             the committed bundle carries edit2 → this test FAILS. That failing
#             run is the evidence the bug is real, not asserted.
#   FIXED hook (node bundle.js --from-index reads the index, writes the index):
#             the committed bundle carries only edit1 → this test PASSES.
#
# The same script produces both results; which one you get depends only on which
# hook is installed. Runs entirely on a throwaway branch and reverts on exit —
# main is never moved, and an unrelated uncommitted change (e.g. the fix under
# test) is preserved.
#
# Run from the repo root:  bash tests/h1-from-index.test.sh
set -u

SRC=public/finflow-api-wiring.js
BUNDLE=public/finflow-bundle.js
BRANCH="h1-scratch-$$"
STAMP="$$_${RANDOM}"
E1="H1_STAGED_EDIT_${STAMP}"     # staged   — MUST be in the committed bundle
E2="H1_UNSTAGED_EDIT_${STAMP}"   # unstaged — MUST NOT be in the committed bundle

start_branch="$(git rev-parse --abbrev-ref HEAD)"

cleanup() {
  # Drop the throwaway edits, return to the starting branch, delete the scratch
  # branch. Touches only the test source and the bundle — never the fix files.
  git checkout -q -- "$SRC" "$BUNDLE" 2>/dev/null || true
  git checkout -q "$start_branch" 2>/dev/null || true
  git branch -q -D "$BRANCH" 2>/dev/null || true
}
trap cleanup EXIT

fail() { echo; echo "RESULT: FAIL — $1"; exit 1; }

# Refuse to run if the target source already has a staged change — we must not
# clobber a real one. (Staged/unstaged edits to OTHER files, e.g. an uncommitted
# fix to bundle.js and the hook, are expected and fine.)
if ! git diff --cached --quiet -- "$SRC"; then
  fail "precondition: $SRC already has staged changes; refusing to clobber them"
fi
# cleanup() hard-discards the working tree for $SRC and $BUNDLE (git checkout --),
# so any UNSTAGED edit to either — held WIP in the wiring source, a hand-modified
# bundle — would be lost silently. In a held-and-reviewed workflow that is the
# wrong failure mode; refuse instead.
git diff --quiet -- "$SRC" "$BUNDLE" || fail "precondition: unstaged changes to $SRC or $BUNDLE; refusing to clobber them — commit or stash first"

git checkout -q -b "$BRANCH" || fail "could not create scratch branch $BRANCH"
echo "on scratch branch $BRANCH (from $start_branch)"

# edit1 — append a marker and STAGE it.
printf '\n/* %s */\n' "$E1" >> "$SRC"
git add "$SRC"

# edit2 — append a second marker ON TOP, and DO NOT stage it.
printf '\n/* %s */\n' "$E2" >> "$SRC"

# Confirm the partial-stage setup: index has edit1 only; working tree has both.
git show ":$SRC" | grep -q "$E1" || fail "setup: staged copy is missing edit1"
if git show ":$SRC" | grep -q "$E2"; then fail "setup: staged copy unexpectedly contains edit2"; fi
grep -q "$E2" "$SRC" || fail "setup: working tree is missing edit2"
echo "setup OK: index has edit1 only; working tree has edit1+edit2"

# Commit. The pre-commit hook regenerates and stages the bundle.
git commit -q -m "h1 test: partial stage ${STAMP}" || fail "commit failed (hook aborted?)"

# Inspect what was actually committed.
bundle="$(git show "HEAD:${BUNDLE}")"
src="$(git show "HEAD:${SRC}")"

# The committed SOURCE must carry edit1 and not edit2 (only edit1 was staged).
# This is the staging model itself; if it breaks the rest is meaningless.
echo "$src" | grep -q "$E1" || fail "committed source is missing the staged edit1"
if echo "$src" | grep -q "$E2"; then fail "committed source carries the unstaged edit2 (staging model broken)"; fi

# Decisive checks on the committed BUNDLE.
b_has_e1=no; b_has_e2=no
echo "$bundle" | grep -q "$E1" && b_has_e1=yes
echo "$bundle" | grep -q "$E2" && b_has_e2=yes
echo "committed bundle contains edit1 (staged): $b_has_e1   (want yes)"
echo "committed bundle contains edit2 (unstaged): $b_has_e2   (want no)"

[ "$b_has_e1" = yes ] || fail "committed bundle is MISSING the staged edit1 — bundle not built from the staged source"
[ "$b_has_e2" = no ]  || fail "committed bundle CONTAINS the unstaged edit2 — bundle built from the working tree, not the index (H1 bug: unreviewed code would deploy)"

echo
echo "RESULT: PASS — committed bundle carries the staged edit1 and not the unstaged edit2; it matches the committed source."
exit 0
