// Offline Postgres for tests and local development (WASM Postgres, no server needed).

import type { PGlite } from "@electric-sql/pglite";
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

/**
 * PGlite locates its WASM files with `new URL(..., import.meta.url)`, which webpack rewrites into something
 * the Node filesystem API rejects inside `next dev`. Loading the package through a native dynamic import keeps
 * it out of the bundle; it still resolves from apps/web/node_modules at runtime.
 */
type PGliteCtor = typeof import("@electric-sql/pglite").PGlite;
async function loadPglite(): Promise<PGliteCtor> {
  // webpackIgnore: leave this import() to Node at runtime instead of bundling the package (vitest ignores the comment).
  return (await import(/* webpackIgnore: true */ "@electric-sql/pglite")).PGlite;
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const PGliteClass = await loadPglite();
  const pg = new PGliteClass(dataDir);
  await pg.waitReady;
  return wrap(pg, pg);
}
