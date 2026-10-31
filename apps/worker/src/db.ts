// Plain `pg` store (spec 8.9 task 1). Table and column names follow the server's migration
// (apps/web/src/server/db/migrations/0001_init.sql, owned by the server; read, not imported):
//   npc_decisions(merchant, ts, input_hash, output_json, model, request_id, attested, source, tx_hashes)
//   worker_heartbeat(worker, ts)
// `output_json` holds the full Decision JSON. The server schema has no column for the inference
// evidence record (hashes, signature, checks), so the worker keeps it in its OWN table `npc_evidence`,
// created idempotently at startup (ensureSchema). The server may read it for /api/proof/{merchant}.

import pg from "pg";
import type { DecisionRecord, DecisionStore } from "./types.js";

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

export class PgDecisionStore implements DecisionStore {
  constructor(
    private readonly db: Queryable,
    private readonly workerId: string,
  ) {}

  /** Idempotent: the worker's own evidence table. The server owns npc_decisions / worker_heartbeat. */
  async ensureSchema(): Promise<void> {
    await this.db.query(
      `create table if not exists npc_evidence (
         id bigserial primary key,
         merchant text not null,
         ts bigint not null,
         request_id text,
         evidence_json text not null
       )`,
    );
    await this.db.query("create index if not exists npc_evidence_merchant_ts on npc_evidence (merchant, ts desc)");
  }

  async insertDecision({ decision: d, input_hash, evidence }: DecisionRecord): Promise<void> {
    await this.db.query(
      `insert into npc_decisions (merchant, ts, input_hash, output_json, model, request_id, attested, source, tx_hashes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [d.merchant, d.ts, input_hash, JSON.stringify(d), d.model, d.request_id, d.attested, d.source, JSON.stringify(d.tx_hashes)],
    );
    if (evidence) {
      await this.db.query("insert into npc_evidence (merchant, ts, request_id, evidence_json) values ($1, $2, $3, $4)", [
        d.merchant,
        d.ts,
        evidence.request_id,
        JSON.stringify(evidence),
      ]);
    }
  }

  async heartbeat(at: number): Promise<void> {
    await this.db.query(
      "insert into worker_heartbeat (worker, ts) values ($1, $2) on conflict (worker) do update set ts = excluded.ts",
      [this.workerId, at],
    );
  }
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
}
