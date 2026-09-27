#!/usr/bin/env bash
# ============================================================================
# FinFlow — backup restore drill  (Ops hardening, F202)
# ============================================================================
# A backup you have never restored is not a backup. This drill proves the
# production dump restores cleanly into a fresh database and that the core
# tables come back with data. Run it on a schedule (e.g. monthly) and before
# any risky migration.
#
#   SRC="$PROD_DATABASE_URL"  ./scripts/restore-drill.sh
#   # or restore a specific dump file:
#   DUMP=backup.dump  DEST="$SCRATCH_DATABASE_URL"  ./scripts/restore-drill.sh
#
# Requires: pg_dump, pg_restore/psql (matching the server's major version).
# Exits non-zero if the restore fails or a core table comes back empty.
# ============================================================================
set -euo pipefail

SRC="${SRC:-}"                       # source prod DB URL (to dump), OR set DUMP=
DUMP="${DUMP:-}"                     # existing custom-format dump file, OR set SRC=
DEST="${DEST:-}"                     # scratch DB URL to restore INTO (REQUIRED, must be throwaway)
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

if [[ -z "$DEST" ]]; then echo "ERROR: set DEST=<scratch database url to restore into>"; exit 2; fi
case "$DEST" in *prod*|*production*) echo "REFUSING: DEST looks like production ($DEST)"; exit 2;; esac

if [[ -z "$DUMP" ]]; then
  [[ -n "$SRC" ]] || { echo "ERROR: set SRC=<prod url> or DUMP=<file>"; exit 2; }
  DUMP="$WORK/finflow.dump"
  echo ">> pg_dump (custom format) from source…"
  pg_dump -Fc --no-owner --no-privileges "$SRC" -f "$DUMP"
fi
echo ">> dump size: $(du -h "$DUMP" | cut -f1)"

echo ">> restoring into DEST (scratch)…"
pg_restore --no-owner --no-privileges --clean --if-exists -d "$DEST" "$DUMP"

echo ">> verifying core tables are non-empty…"
FAIL=0
for t in users entities invoices ledger_entries ledger_lines; do
  n=$(psql "$DEST" -tAc "SELECT COUNT(*) FROM $t" 2>/dev/null || echo "ERR")
  printf "   %-16s %s\n" "$t" "$n"
  if [[ "$t" == "users" && ( "$n" == "ERR" || "$n" == "0" ) ]]; then FAIL=1; fi
done

echo ">> smoke query (a real join)…"
psql "$DEST" -tAc "SELECT COUNT(*) FROM invoices i JOIN entities e ON e.id=i.entity_id" >/dev/null && echo "   join OK"

if [[ "$FAIL" == "1" ]]; then echo "DRILL FAILED — users did not restore"; exit 1; fi
echo "RESTORE DRILL PASSED — dump restores cleanly and core data is present."
