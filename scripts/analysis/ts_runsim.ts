// Runs the shared TypeScript sim (packages/shared/src/sim.ts, read only) for a list of option sets and prints JSON.
// Usage: packages/shared/node_modules/.bin/tsx scripts/analysis/ts_runsim.ts '[{"bots":5,"ticks":240,"seed":7,"npc":true,"rebalPct":30,"housePct":10}]'
// Every run also asserts money conservation on every tick (same check as `pnpm sim`).
import { runSim } from "../../packages/shared/src/sim.js";
import type { SimOptions } from "../../packages/shared/src/sim.js";

const specs = JSON.parse(process.argv[2] ?? "[]") as Array<Omit<SimOptions, "onTick">>;
const out = specs.map((o) => {
  const start = 50000 * 4 + 50000 * o.bots;
  let conserved = true;
  const opts: SimOptions = {
    ...o,
    onTick: (_t, total) => {
      if (total !== start) conserved = false;
    },
  };
  const r = runSim(opts);
  return {
    opts: o,
    trips: r.trips,
    median: r.medianProfit,
    p10: r.p10,
    p90: r.p90,
    broke: r.brokeEvents,
    treasury: r.treasury,
    house: r.house,
    worths: r.botWorth,
    conserved,
  };
});
console.log(JSON.stringify(out));
