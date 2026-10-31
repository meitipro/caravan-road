// CLI: `pnpm --filter @caravan/web db:migrate` (needs DATABASE_URL in the environment).

import { createPgDb } from "./pg";
import { migrate } from "./migrate";
import { redact } from "../log";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createPgDb(url);
  try {
    const applied = await migrate(db);
    console.warn(applied.length ? `applied: ${applied.join(", ")}` : "database is up to date");
  } finally {
    await db.close();
  }
}

main().catch((e: unknown) => {
  console.error(redact(e instanceof Error ? e.message : "migration failed"));
  process.exit(1);
});
