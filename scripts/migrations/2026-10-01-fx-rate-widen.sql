-- 2026-10-01-fx-rate-widen.sql
-- Widen fx_rates.rate so the live USD-base feed can store high-value currencies (e.g. IRR, which
-- exceeds NUMERIC(12,6)'s < 1,000,000 ceiling and caused "numeric field overflow", aborting the
-- whole refresh). NUMERIC(20,6) holds any real FX rate. Safe widening; data preserved.
ALTER TABLE fx_rates ALTER COLUMN rate TYPE NUMERIC(20,6);
