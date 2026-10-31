-- Security hardening (review of Phase 3).
-- Withdrawal statuses are now: RESERVED (cap reserved, chain call not confirmed), REQUESTED, SENDING, SENT,
-- REFUNDED, CANCELLED (reservation released after a definite failure). The status column is plain text.

alter table deposits add column credited_fils bigint;            -- what was actually credited (min of received and expected)

-- A chain withdrawal can be linked to at most one database row.
create unique index withdrawals_contract_id_unique on withdrawals (contract_withdraw_id) where contract_withdraw_id is not null;
