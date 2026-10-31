// Entry point: `pnpm --filter @caravan/worker start`. Runs until SIGINT/SIGTERM, then finishes the
// current merchant and exits. Needs the environment listed in docs/WORKER.md (names only).

import { bootstrap } from "./bootstrap.js";
import { ConfigError, describeConfig } from "./config.js";
import { abortableSleep, runLoop } from "./loop.js";
import { consoleLogger } from "./types.js";

async function main(): Promise<void> {
  const log = consoleLogger();
  let app;
  try {
    app = await bootstrap(process.env, log);
  } catch (e) {
    if (e instanceof ConfigError) log.error("configuration error", { problems: e.problems });
    else log.error("startup failed", { error: (e as Error).message.slice(0, 300) });
    process.exitCode = 1;
    return;
  }
  log.info("worker starting", { ...describeConfig(app.cfg), modelId: app.model.id });

  const ctl = new AbortController();
  const stop = (sig: string) => {
    log.info("shutdown requested", { signal: sig });
    ctl.abort();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await runLoop(app.deps, {
    periodMs: app.cfg.periodSeconds * 1000,
    staggerMs: app.cfg.staggerSeconds * 1000,
    sleep: abortableSleep,
    signal: ctl.signal,
  });
  await app.shutdown();
  log.info("worker stopped");
}

void main();
