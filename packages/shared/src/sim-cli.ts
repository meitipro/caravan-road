// CLI: pnpm sim --bots 5 --ticks 240 --seed 7 [--nonpc] [--rebal 30] [--house 10]
import { defaultSimOptions, formatSummary, runSim } from "./sim.js";

function main(argv: string[]): void {
  const o = defaultSimOptions();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v)) throw new Error(`${a} needs an integer`);
      return v;
    };
    if (a === "--bots") o.bots = next();
    else if (a === "--ticks") o.ticks = next();
    else if (a === "--seed") o.seed = next();
    else if (a === "--rebal") o.rebalPct = next();
    else if (a === "--house") o.housePct = next();
    else if (a === "--nonpc") o.npc = false;
    else if (a === "--npc") o.npc = true;
    else throw new Error(`unknown argument ${a}`);
  }
  const start = 50000 * 4 + 50000 * o.bots;
  o.onTick = (tick, total) => {
    if (total !== start) throw new Error(`money not conserved at tick ${tick}: ${total} != ${start}`);
  };
  const result = runSim(o);
  console.log(formatSummary(result));
  console.log("money conserved on every tick: yes");
}

main(process.argv.slice(2));
