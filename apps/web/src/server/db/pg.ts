// Production driver: node-postgres against DATABASE_URL (Neon, Supabase or any Postgres).

import { Pool, type PoolClient } from "pg";
import type { Db } from "./types";

function wrapClient(c: PoolClient): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await c.query(sql);
    },
    async transaction() {
      throw new Error("nested transactions are not supported");
    },
    async close() {
      /* the pool owns the client */
    },
  };
}

export function createPgDb(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 5 });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const r = await fn(wrapClient(c));
        await c.query("commit");
        return r;
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
