-- Caravan Road server schema (master plan 6.4). Times are unix seconds (bigint).
-- Money is integer fils. Additions to the 6.4 column lists are marked "extra".

create table users (
  id               text primary key,
  email            text,
  display_name     text not null,
  provider         text not null,
  provider_subject text not null,                     -- extra: stable id from the OAuth provider
  near_account_id  text unique,
  account_status   text not null default 'NONE',      -- extra: NONE | PENDING | CREATED | REGISTERED
  created_at       bigint not null,
  unique (provider, provider_subject)
);

create table custody_keys (
  user_id         text primary key references users (id),
  public_key      text not null,
  enc_private_key text not null,                      -- base64(AES-256-GCM ciphertext || tag)
  nonce           text not null,                      -- base64(12 random bytes)
  key_version     integer not null
);

create table actions (
  id              bigserial primary key,
  user_id         text not null references users (id),
  kind            text not null,
  idempotency_key text not null unique,               -- "<user_id>:<client key>"
  request_json    text not null,
  request_hash    text not null,                      -- extra: detects key reuse with another body
  response_json   text,                               -- extra: stored response for replays
  tx_hash         text,
  status          text not null,                      -- PENDING | OK | FAILED
  error_code      text,
  created_at      bigint not null,
  updated_at      bigint not null                     -- extra
);
create index actions_user_created on actions (user_id, created_at);

create table deposits (
  id              bigserial primary key,
  user_id         text not null references users (id),
  quote_id        text not null unique,
  deposit_address text not null,
  origin_asset    text not null,
  amount_in       text not null,
  expected_fils   bigint not null,
  refund_address  text,                               -- extra
  status          text not null,                      -- PENDING | CREDITING | CREDITED | EXPIRED | FAILED
  credit_ref      text unique,
  deadline        bigint not null,
  created_at      bigint not null,                    -- extra
  updated_at      bigint not null
);
create index deposits_user on deposits (user_id);
create index deposits_status on deposits (status);

create table withdrawals (
  id                   bigserial primary key,
  user_id              text not null references users (id),
  contract_withdraw_id bigint,
  fils                 bigint not null,
  dest_asset           text not null,
  dest_address         text not null,
  quote_id             text,
  status               text not null,                 -- REQUESTED | SENDING | SENT | REFUNDED | FAILED
  tx_hashes            text not null default '[]',    -- JSON array
  created_at           bigint not null,               -- extra
  updated_at           bigint not null                -- extra
);
create index withdrawals_user on withdrawals (user_id, created_at);
create index withdrawals_status on withdrawals (status);

create table npc_decisions (
  id          bigserial primary key,                  -- extra
  merchant    text not null,
  ts          bigint not null,
  input_hash  text not null,
  output_json text not null,
  model       text,
  request_id  text,
  attested    boolean not null default false,
  source      text not null,
  tx_hashes   text not null default '[]'
);
create index npc_decisions_merchant_ts on npc_decisions (merchant, ts desc);

create table worker_heartbeat (
  worker text primary key,
  ts     bigint not null
);

create table rate_limits (
  key          text not null,
  window_start bigint not null,
  count        integer not null,
  primary key (key, window_start)
);

create table flags (
  key   text primary key,
  value text not null
);
insert into flags (key, value) values ('PAUSE_ALL', 'false');
