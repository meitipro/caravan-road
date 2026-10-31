// Applies db/migrations/*.sql in file-name order, once each. Run by the db:migrate script and by
// the tests. The files are read from disk, so this is a deploy-time step, not a request-time one.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./types";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(db: Db, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at bigint not null)");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into schema_migrations (name, applied_at) values ($1, $2)", [f, Math.floor(Date.now() / 1000)]);
    });
    applied.push(f);
  }
  return applied;
}
