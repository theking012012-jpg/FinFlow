-- NEW-3 (live retest 2026-10-30): a bank-feed line is unique by its source id within its scope (account + business, or
-- Personal = entity NULL → 0): the statement line (import_key), the Plaid transaction (plaid_txn_id), the Belvo
-- transaction (belvo_txn_id). Two imports of one file at the same moment inserted every line twice.
-- GUARDED (as idx_invoices_number): where duplicates already exist the index is not built and a WARNING names the lister
-- (tools/launch/list-duplicate-bank-lines.js) — nothing is deleted here (Rule 8). Schema only. initDB runs the same.
DO $bl$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('idx_bank_line_import_key','import_key'), ('idx_bank_line_plaid_txn','plaid_txn_id'), ('idx_bank_line_belvo_txn','belvo_txn_id')) AS t(ix, k) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = r.ix) THEN
      EXECUTE format('SELECT 1 FROM personal_transactions WHERE data->>%L IS NOT NULL GROUP BY user_id, COALESCE(entity_id,0), data->>%L HAVING count(*) > 1 LIMIT 1', r.k, r.k);
      IF FOUND THEN
        RAISE WARNING '% NOT created: duplicate bank lines exist — run tools/launch/list-duplicate-bank-lines.js', r.ix;
      ELSE
        EXECUTE format('CREATE UNIQUE INDEX %I ON personal_transactions (user_id, COALESCE(entity_id, 0), (data->>%L)) WHERE data->>%L IS NOT NULL', r.ix, r.k, r.k);
      END IF;
    END IF;
  END LOOP;
END
$bl$;
