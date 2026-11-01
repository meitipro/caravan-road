-- 1Click says the quote `signature` must be kept to resolve disputes. Nullable: rows created before this
-- migration, and providers that return none, have no signature.
-- Withdrawal statuses gain FINALIZING (a cron run is closing a SENT withdrawal) and DONE (provider succeeded).

alter table deposits add column quote_signature text;
alter table withdrawals add column quote_signature text;
