-- FA-M7 (2026-10-27): one chart of accounts per business — an own account's code is unique within its business (the
-- route refuses a duplicate with 409; this backs it in the database). GUARDED: the old code allowed duplicates, so if a
-- database already holds one the index is NOT built (a plain CREATE would fail) and a warning says so; run
-- tools/launch/list-chart-accounts.js (read-only) and decide (Rule 8). Schema only — no row is changed.
-- Rows with no business (entity_id NULL) count as one group.
DO $coa$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_chart_of_accounts_code') THEN
    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE data->>'code' IS NOT NULL
                GROUP BY user_id, COALESCE(entity_id, 0), data->>'code' HAVING count(*) > 1) THEN
      RAISE WARNING 'idx_chart_of_accounts_code NOT created: duplicate account codes exist — run tools/launch/list-chart-accounts.js';
    ELSE
      CREATE UNIQUE INDEX idx_chart_of_accounts_code ON chart_of_accounts (user_id, COALESCE(entity_id, 0), (data->>'code')) WHERE data->>'code' IS NOT NULL;
    END IF;
  END IF;
END
$coa$;
