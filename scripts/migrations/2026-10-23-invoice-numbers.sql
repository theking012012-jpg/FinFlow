-- B1b (2026-10-23): invoice numbers — one per business, never repeated. The app assigns them (assignInvoiceNumber in
-- server.js); this backs it in the database. GUARDED: a CSV import used to store the file's own number unchecked, so a
-- database may already hold a duplicate. Then the index is NOT built (a plain CREATE would fail) and a warning says so;
-- run tools/launch/list-invoice-numbers.js (read-only) and decide (Rule 8). Schema only — no row is changed.
DO $inv$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_invoices_number') THEN
    IF EXISTS (SELECT 1 FROM invoices WHERE data->>'number' IS NOT NULL
                GROUP BY user_id, entity_id, data->>'number' HAVING count(*) > 1) THEN
      RAISE WARNING 'idx_invoices_number NOT created: duplicate invoice numbers exist — run tools/launch/list-invoice-numbers.js';
    ELSE
      CREATE UNIQUE INDEX idx_invoices_number ON invoices (user_id, entity_id, (data->>'number')) WHERE data->>'number' IS NOT NULL;
    END IF;
  END IF;
END
$inv$;
