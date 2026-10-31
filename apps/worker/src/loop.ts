// The 60 s loop (spec 8.3): per merchant, staggered; one merchant's failure never stops the others;
// after all merchants world_tick() once, then a heartbeat.

import { CITY_IDS } from "@caravan/shared";
import { runMerchantOnce, type RunDeps } from "./run-once.js";

export interface CycleOptions {
  /** delay between merchants (spec: 15 s) */
  staggerMs: number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

export interface CycleResult {
  ok: string[];
  failed: Array<{ merchant: string; error: string }>;
  tick: "called" | "skipped" | "error" | "aborted";
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(t);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function runCycle(deps: RunDeps, opts: CycleOptions): Promise<CycleResult> {
  const result: CycleResult = { ok: [], failed: [], tick: "aborted" };
  for (let i = 0; i < CITY_IDS.length; i++) {
    const city = CITY_IDS[i]!;
    if (opts.signal?.aborted) return result;
    if (i > 0) await opts.sleep(opts.staggerMs, opts.signal);
    if (opts.signal?.aborted) return result;
    try {
      await runMerchantOnce(deps, city);
      result.ok.push(city);
    } catch (e) {
      const error = (e as Error).message.slice(0, 200);
      result.failed.push({ merchant: city, error });
      deps.log.error("merchant run failed", { merchant: city, error });
    }
  }
  try {
    const tick = await deps.chain.worldTick();
    result.tick = tick.skipped ? "skipped" : "called";
  } catch (e) {
    result.tick = "error";
    deps.log.warn("world_tick failed", { error: (e as Error).message.slice(0, 200) });
  }
  try {
    await deps.store.heartbeat(deps.now());
  } catch (e) {
    deps.log.error("heartbeat failed", { error: (e as Error).message.slice(0, 200) });
  }
  return result;
}

export async function runLoop(deps: RunDeps, opts: CycleOptions & { periodMs: number }): Promise<void> {
  while (!opts.signal?.aborted) {
    const started = Date.now();
    await runCycle(deps, opts);
    const wait = opts.periodMs - (Date.now() - started);
    if (wait > 0) await opts.sleep(wait, opts.signal);
  }
}
