// Repository layer: every SQL statement of the server lives here. Numbers are normalised
// (bigint columns arrive as number or string depending on the driver).

import type { Db } from "./types";

const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export type AccountStatus = "NONE" | "PENDING" | "CREATED" | "REGISTERED";

export interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  provider: string;
  provider_subject: string;
  near_account_id: string | null;
  account_status: AccountStatus;
  created_at: number;
}

export interface CustodyRow {
  user_id: string;
  public_key: string;
  enc_private_key: string;
  nonce: string;
  key_version: number;
}

export type ActionStatus = "PENDING" | "OK" | "FAILED";
export interface ActionRow {
  id: number;
  user_id: string;
  kind: string;
  idempotency_key: string;
  request_hash: string;
  response_json: string | null;
  tx_hash: string | null;
  status: ActionStatus;
  error_code: string | null;
  created_at: number;
}

export type DepositStatus = "PENDING" | "CREDITING" | "CREDITED" | "EXPIRED" | "FAILED";
export interface DepositRow {
  id: number;
  user_id: string;
  quote_id: string;
  deposit_address: string;
  origin_asset: string;
  amount_in: string;
  expected_fils: string;
  credited_fils: string | null;
  refund_address: string | null;
  status: DepositStatus;
  credit_ref: string | null;
  deadline: number;
  created_at: number;
  updated_at: number;
}

export type WithdrawalStatus = "RESERVED" | "REQUESTED" | "SENDING" | "SENT" | "REFUNDED" | "FAILED" | "CANCELLED";
export interface WithdrawalRow {
  id: number;
  user_id: string;
  contract_withdraw_id: number | null;
  fils: string;
  dest_asset: string;
  dest_address: string;
  quote_id: string | null;
  status: WithdrawalStatus;
  tx_hashes: string[];
  created_at: number;
  updated_at: number;
}

export interface NpcDecisionRow {
  merchant: string;
  ts: number;
  input_hash: string;
  output_json: string;
  model: string | null;
  request_id: string | null;
  attested: boolean;
  source: string;
  tx_hashes: string[];
}

type R = Record<string, unknown>;

const mapUser = (r: R): UserRow => ({
  id: str(r.id), email: optStr(r.email), display_name: str(r.display_name), provider: str(r.provider),
  provider_subject: str(r.provider_subject), near_account_id: optStr(r.near_account_id),
  account_status: str(r.account_status) as AccountStatus, created_at: num(r.created_at),
});
const mapAction = (r: R): ActionRow => ({
  id: num(r.id), user_id: str(r.user_id), kind: str(r.kind), idempotency_key: str(r.idempotency_key),
  request_hash: str(r.request_hash), response_json: optStr(r.response_json), tx_hash: optStr(r.tx_hash),
  status: str(r.status) as ActionStatus, error_code: optStr(r.error_code), created_at: num(r.created_at),
});
const mapDeposit = (r: R): DepositRow => ({
  id: num(r.id), user_id: str(r.user_id), quote_id: str(r.quote_id), deposit_address: str(r.deposit_address),
  origin_asset: str(r.origin_asset), amount_in: str(r.amount_in), expected_fils: str(r.expected_fils),
  credited_fils: optStr(r.credited_fils),
  refund_address: optStr(r.refund_address), status: str(r.status) as DepositStatus, credit_ref: optStr(r.credit_ref),
  deadline: num(r.deadline), created_at: num(r.created_at), updated_at: num(r.updated_at),
});
const mapWithdrawal = (r: R): WithdrawalRow => ({
  id: num(r.id), user_id: str(r.user_id),
  contract_withdraw_id: r.contract_withdraw_id === null || r.contract_withdraw_id === undefined ? null : num(r.contract_withdraw_id),
  fils: str(r.fils), dest_asset: str(r.dest_asset), dest_address: str(r.dest_address), quote_id: optStr(r.quote_id),
  status: str(r.status) as WithdrawalStatus, tx_hashes: JSON.parse(str(r.tx_hashes)) as string[],
  created_at: num(r.created_at), updated_at: num(r.updated_at),
});
const mapDecision = (r: R): NpcDecisionRow => ({
  merchant: str(r.merchant), ts: num(r.ts), input_hash: str(r.input_hash), output_json: str(r.output_json),
  model: optStr(r.model), request_id: optStr(r.request_id), attested: Boolean(r.attested), source: str(r.source),
  tx_hashes: JSON.parse(str(r.tx_hashes)) as string[],
});

export type BeginAction =
  | { state: "new"; id: number }
  | { state: "existing"; row: ActionRow };

export function createRepo(db: Db) {
  return {
    db,

    // ---- users and custody ----
    async upsertUser(p: { provider: string; subject: string; email: string | null; name: string; now: number; id: string }): Promise<UserRow> {
      const rows = await db.query<R>(
        `insert into users (id, email, display_name, provider, provider_subject, created_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (provider, provider_subject) do update set email = excluded.email
         returning *`,
        [p.id, p.email, p.name, p.provider, p.subject, p.now],
      );
      return mapUser(rows[0]!);
    },
    async getUser(id: string): Promise<UserRow | null> {
      const rows = await db.query<R>("select * from users where id = $1", [id]);
      return rows[0] ? mapUser(rows[0]) : null;
    },
    /**
     * Reserves the account id and stores the encrypted key in one transaction, only if the user has
     * no account yet. Returns the user row as it is afterwards (maybe set by a concurrent caller).
     */
    async claimAccount(userId: string, accountId: string, key: Omit<CustodyRow, "user_id">): Promise<UserRow> {
      return db.transaction(async (tx) => {
        const upd = await tx.query<R>(
          `update users set near_account_id = $2, account_status = 'PENDING'
           where id = $1 and near_account_id is null returning *`,
          [userId, accountId],
        );
        if (upd[0]) {
          await tx.query(
            `insert into custody_keys (user_id, public_key, enc_private_key, nonce, key_version) values ($1, $2, $3, $4, $5)`,
            [userId, key.public_key, key.enc_private_key, key.nonce, key.key_version],
          );
          return mapUser(upd[0]);
        }
        const cur = await tx.query<R>("select * from users where id = $1", [userId]);
        return mapUser(cur[0]!);
      });
    },
    async setAccountStatus(userId: string, status: AccountStatus): Promise<void> {
      await db.query("update users set account_status = $2 where id = $1", [userId, status]);
    },
    async getCustody(userId: string): Promise<CustodyRow | null> {
      const rows = await db.query<R>("select * from custody_keys where user_id = $1", [userId]);
      const r = rows[0];
      return r
        ? { user_id: str(r.user_id), public_key: str(r.public_key), enc_private_key: str(r.enc_private_key), nonce: str(r.nonce), key_version: num(r.key_version) }
        : null;
    },
    async namesByAccount(accountIds: string[]): Promise<Map<string, string>> {
      const m = new Map<string, string>();
      if (accountIds.length === 0) return m;
      const rows = await db.query<R>("select near_account_id, display_name from users where near_account_id = any($1)", [accountIds]);
      for (const r of rows) m.set(str(r.near_account_id), str(r.display_name));
      return m;
    },
    async getUserByAccount(accountId: string): Promise<UserRow | null> {
      const rows = await db.query<R>("select * from users where near_account_id = $1", [accountId]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    // ---- idempotency / actions ----
    async beginAction(p: { userId: string; kind: string; key: string; requestJson: string; requestHash: string; now: number }): Promise<BeginAction> {
      const fullKey = `${p.userId}:${p.key}`;
      const ins = await db.query<R>(
        `insert into actions (user_id, kind, idempotency_key, request_json, request_hash, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'PENDING', $6, $6)
         on conflict (idempotency_key) do nothing returning id`,
        [p.userId, p.kind, fullKey, p.requestJson, p.requestHash, p.now],
      );
      if (ins[0]) return { state: "new", id: num(ins[0].id) };
      const rows = await db.query<R>("select * from actions where idempotency_key = $1", [fullKey]);
      return { state: "existing", row: mapAction(rows[0]!) };
    },
    async finishAction(id: number, p: { status: ActionStatus; txHash: string | null; errorCode: string | null; responseJson: string; now: number }): Promise<void> {
      await db.query(
        `update actions set status = $2, tx_hash = $3, error_code = $4, response_json = $5, updated_at = $6 where id = $1`,
        [id, p.status, p.txHash, p.errorCode, p.responseJson, p.now],
      );
    },

    // ---- rate limits ----
    /** Atomically counts one hit in the fixed window and returns the new count. */
    async hit(key: string, windowStart: number): Promise<number> {
      const rows = await db.query<R>(
        `insert into rate_limits (key, window_start, count) values ($1, $2, 1)
         on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count`,
        [key, windowStart],
      );
      return num(rows[0]!.count);
    },
    async purgeRateLimits(olderThan: number): Promise<void> {
      await db.query("delete from rate_limits where window_start < $1", [olderThan]);
    },

    // ---- flags ----
    async getFlag(key: string): Promise<string | null> {
      const rows = await db.query<R>("select value from flags where key = $1", [key]);
      return rows[0] ? str(rows[0].value) : null;
    },
    async setFlag(key: string, value: string): Promise<void> {
      await db.query(
        "insert into flags (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value",
        [key, value],
      );
    },

    // ---- deposits ----
    /**
     * Inserts the deposit only if credited + every PENDING/CREDITING row (deadline or not: cron can still credit
     * them) + this one stays within `cap`. Atomic per user (advisory lock inside one transaction).
     */
    async insertDepositWithinCap(d: { userId: string; quoteId: string; depositAddress: string; originAsset: string; amountIn: string; expectedFils: string; refundAddress: string; deadline: number; now: number }, cap: bigint): Promise<DepositRow | null> {
      return db.transaction(async (tx) => {
        await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`deposit:${d.userId}`]);
        const t = await tx.query<R>(
          `select coalesce(sum(case when status = 'CREDITED' then coalesce(credited_fils, expected_fils) else 0 end), 0)::text as credited,
                  coalesce(sum(case when status in ('PENDING', 'CREDITING') then expected_fils else 0 end), 0)::text as open
           from deposits where user_id = $1`,
          [d.userId],
        );
        if (BigInt(str(t[0]!.credited)) + BigInt(str(t[0]!.open)) + BigInt(d.expectedFils) > cap) return null;
        const rows = await tx.query<R>(
          `insert into deposits (user_id, quote_id, deposit_address, origin_asset, amount_in, expected_fils, refund_address, status, deadline, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $9) returning *`,
          [d.userId, d.quoteId, d.depositAddress, d.originAsset, d.amountIn, d.expectedFils, d.refundAddress, d.deadline, d.now],
        );
        return mapDeposit(rows[0]!);
      });
    },
    /** Credited plus open deposits (cheap pre-check before asking the provider for a quote). */
    async depositTotals(userId: string): Promise<{ credited: bigint; open: bigint }> {
      const rows = await db.query<R>(
        `select coalesce(sum(case when status = 'CREDITED' then coalesce(credited_fils, expected_fils) else 0 end), 0)::text as credited,
                coalesce(sum(case when status in ('PENDING', 'CREDITING') then expected_fils else 0 end), 0)::text as open
         from deposits where user_id = $1`,
        [userId],
      );
      return { credited: BigInt(str(rows[0]!.credited)), open: BigInt(str(rows[0]!.open)) };
    },
    async getDepositByQuote(userId: string, quoteId: string): Promise<DepositRow | null> {
      const rows = await db.query<R>("select * from deposits where user_id = $1 and quote_id = $2", [userId, quoteId]);
      return rows[0] ? mapDeposit(rows[0]) : null;
    },
    async listDepositsByStatus(status: DepositStatus, limit: number): Promise<DepositRow[]> {
      return (await db.query<R>("select * from deposits where status = $1 order by id limit $2", [status, limit])).map(mapDeposit);
    },
    async countDepositsByStatus(status: DepositStatus): Promise<number> {
      return num((await db.query<R>("select count(*) as n from deposits where status = $1", [status]))[0]!.n);
    },
    /** Compare-and-set; returns true if this caller moved the row. */
    async transitionDeposit(id: number, from: DepositStatus, to: DepositStatus, now: number, extra?: { creditRef?: string; creditedFils?: string }): Promise<boolean> {
      const rows = await db.query<R>(
        `update deposits set status = $3, updated_at = $4, credit_ref = coalesce($5, credit_ref), credited_fils = coalesce($6::bigint, credited_fils)
         where id = $1 and status = $2 returning id`,
        [id, from, to, now, extra?.creditRef ?? null, extra?.creditedFils ?? null],
      );
      return rows.length === 1;
    },
    /** Sum credited so far (for the re-check at credit time). */
    async creditedFilsTotal(userId: string): Promise<bigint> {
      const rows = await db.query<R>(
        "select coalesce(sum(coalesce(credited_fils, expected_fils)), 0)::text as t from deposits where user_id = $1 and status = 'CREDITED'",
        [userId],
      );
      return BigInt(str(rows[0]!.t));
    },

    // ---- withdrawals ----
    /**
     * Reserves a withdrawal inside the daily cap, atomically per user: advisory lock, sum of the last 24 h
     * (everything except REFUNDED and CANCELLED), insert a RESERVED row. Returns null when over the cap.
     * The row exists BEFORE the chain call, so a debit can never be left without a database record.
     */
    async reserveWithdrawal(w: { userId: string; fils: string; destAsset: string; destAddress: string; now: number }, cap: bigint): Promise<WithdrawalRow | null> {
      return db.transaction(async (tx) => {
        await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`withdraw:${w.userId}`]);
        const t = await tx.query<R>(
          `select coalesce(sum(fils), 0)::text as total from withdrawals
           where user_id = $1 and created_at >= $2 and status not in ('REFUNDED', 'CANCELLED')`,
          [w.userId, w.now - 86400],
        );
        if (BigInt(str(t[0]!.total)) + BigInt(w.fils) > cap) return null;
        const rows = await tx.query<R>(
          `insert into withdrawals (user_id, contract_withdraw_id, fils, dest_asset, dest_address, status, tx_hashes, created_at, updated_at)
           values ($1, null, $2, $3, $4, 'RESERVED', '[]', $5, $5) returning *`,
          [w.userId, w.fils, w.destAsset, w.destAddress, w.now],
        );
        return mapWithdrawal(rows[0]!);
      });
    },
    /** RESERVED -> REQUESTED once the chain id is known. False if already attached or the id is taken. */
    async attachWithdrawal(id: number, contractId: number, txHash: string | null, now: number): Promise<boolean> {
      try {
        const rows = await db.query<R>(
          `update withdrawals set contract_withdraw_id = $2, status = 'REQUESTED', updated_at = $3,
             tx_hashes = case when $4::text is null then tx_hashes else (tx_hashes::jsonb || to_jsonb($4::text))::text end
           where id = $1 and status = 'RESERVED' returning id`,
          [id, contractId, now, txHash],
        );
        return rows.length === 1;
      } catch {
        return false; // unique index: the chain withdrawal belongs to another row
      }
    },
    /** Records the relay transaction hash on a RESERVED row whose outcome could not be read. */
    async noteWithdrawalTx(id: number, txHash: string): Promise<void> {
      await db.query("update withdrawals set tx_hashes = (tx_hashes::jsonb || to_jsonb($2::text))::text where id = $1", [id, txHash]);
    },
    /** RESERVED -> CANCELLED: the chain call definitely failed, the reservation is released. */
    async cancelWithdrawal(id: number, now: number): Promise<boolean> {
      const rows = await db.query<R>("update withdrawals set status = 'CANCELLED', updated_at = $2 where id = $1 and status = 'RESERVED' returning id", [id, now]);
      return rows.length === 1;
    },
    async insertWithdrawal(w: { userId: string; contractWithdrawId: number | null; fils: string; destAsset: string; destAddress: string; txHash: string | null; now: number }): Promise<WithdrawalRow> {
      const rows = await db.query<R>(
        `insert into withdrawals (user_id, contract_withdraw_id, fils, dest_asset, dest_address, status, tx_hashes, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'REQUESTED', $6, $7, $7) returning *`,
        [w.userId, w.contractWithdrawId, w.fils, w.destAsset, w.destAddress, JSON.stringify(w.txHash ? [w.txHash] : []), w.now],
      );
      return mapWithdrawal(rows[0]!);
    },
    async getWithdrawal(id: number): Promise<WithdrawalRow | null> {
      const rows = await db.query<R>("select * from withdrawals where id = $1", [id]);
      return rows[0] ? mapWithdrawal(rows[0]) : null;
    },
    async getWithdrawalByContractId(contractId: number): Promise<WithdrawalRow | null> {
      const rows = await db.query<R>("select * from withdrawals where contract_withdraw_id = $1", [contractId]);
      return rows[0] ? mapWithdrawal(rows[0]) : null;
    },
    async maxContractWithdrawId(): Promise<number | null> {
      const v = (await db.query<R>("select max(contract_withdraw_id) as m from withdrawals"))[0]?.m;
      return v === null || v === undefined ? null : num(v);
    },
    async listWithdrawalsByStatus(status: WithdrawalStatus, limit: number): Promise<WithdrawalRow[]> {
      return (await db.query<R>("select * from withdrawals where status = $1 order by id limit $2", [status, limit])).map(mapWithdrawal);
    },
    async transitionWithdrawal(id: number, from: WithdrawalStatus, to: WithdrawalStatus, now: number, extra?: { quoteId?: string; txHash?: string }): Promise<boolean> {
      const rows = await db.query<R>(
        `update withdrawals set status = $3, updated_at = $4, quote_id = coalesce($5, quote_id),
           tx_hashes = case when $6::text is null then tx_hashes else (tx_hashes::jsonb || to_jsonb($6::text))::text end
         where id = $1 and status = $2 returning id`,
        [id, from, to, now, extra?.quoteId ?? null, extra?.txHash ?? null],
      );
      return rows.length === 1;
    },
    /** Fils that still have to leave the treasury (not yet sent). */
    async outstandingWithdrawalFils(): Promise<bigint> {
      const rows = await db.query<R>("select coalesce(sum(fils), 0)::text as t from withdrawals where status in ('RESERVED', 'REQUESTED', 'SENDING')");
      return BigInt(str(rows[0]!.t));
    },

    // ---- npc ----
    async insertDecision(d: NpcDecisionRow): Promise<void> {
      await db.query(
        `insert into npc_decisions (merchant, ts, input_hash, output_json, model, request_id, attested, source, tx_hashes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [d.merchant, d.ts, d.input_hash, d.output_json, d.model, d.request_id, d.attested, d.source, JSON.stringify(d.tx_hashes)],
      );
    },
    async listDecisions(merchant: string | undefined, limit: number): Promise<NpcDecisionRow[]> {
      const rows = merchant
        ? await db.query<R>("select * from npc_decisions where merchant = $1 order by ts desc, id desc limit $2", [merchant, limit])
        : await db.query<R>("select * from npc_decisions order by ts desc, id desc limit $1", [limit]);
      return rows.map(mapDecision);
    },
    async latestDecisionPerMerchant(): Promise<NpcDecisionRow[]> {
      const rows = await db.query<R>(
        `select distinct on (merchant) * from npc_decisions order by merchant, ts desc, id desc`,
      );
      return rows.map(mapDecision);
    },
    async latestProof(merchant: string): Promise<NpcDecisionRow | null> {
      const rows = await db.query<R>(
        "select * from npc_decisions where merchant = $1 and request_id is not null order by ts desc, id desc limit 1",
        [merchant],
      );
      return rows[0] ? mapDecision(rows[0]) : null;
    },

    // ---- worker heartbeat ----
    async latestHeartbeat(): Promise<number | null> {
      const rows = await db.query<R>("select max(ts) as ts from worker_heartbeat");
      const v = rows[0]?.ts;
      return v === null || v === undefined ? null : num(v);
    },
    async setHeartbeat(worker: string, ts: number): Promise<void> {
      await db.query(
        "insert into worker_heartbeat (worker, ts) values ($1, $2) on conflict (worker) do update set ts = excluded.ts",
        [worker, ts],
      );
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
