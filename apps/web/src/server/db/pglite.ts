// Offline Postgres for tests and local development (WASM Postgres, no server needed).

import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./types";

type Queryable = Pick<PGlite, "query" | "exec">;

function wrap(q: Queryable, root?: PGlite): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const r = await q.query<T>(sql, params);
      return r.rows;
    },
    async exec(sql) {
      await q.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (!root) throw new Error("nested transactions are not supported");
      return root.transaction(async (tx) => fn(wrap(tx)));
    },
    async close() {
      if (root) await root.close();
    },
  };
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  return wrap(pg, pg);
}
