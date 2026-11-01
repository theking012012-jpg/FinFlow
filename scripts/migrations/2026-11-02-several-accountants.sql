-- Owner decision 2026-11-01: a client may work with SEVERAL accountants (each listed in My Accountant with its own access
-- and revoke). The NEW-12 one-active-accountant index (2026-11-01-one-active-accountant.sql) is dropped. Schema only.
DROP INDEX IF EXISTS idx_acc_clients_one_active;
