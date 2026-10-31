// Dry run: the real worker cycle against the in-memory sim world with a FAKE scripted model.
// No network, no keys, no chain. Shows what the worker does tick by tick.
//
//   pnpm --filter @caravan/worker dry-run -- --ticks 30 --bots 5 --seed 7 [--baseline] [--faults 0.15] [--show 6]

import { FakeModel, FAKE_MODEL_NAME } from "./fake/fake-model.js";
import { simulate } from "./simulate.js";
import { PERSONAS } from "./personas.js";

function parse(argv: string[]) {
  const o = { ticks: 30, bots: 5, seed: 7, baseline: false, faults: 0, show: 6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const num = () => {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v)) throw new Error(`${a} needs a number`);
      return v;
    };
    if (a === "--ticks") o.ticks = num();
    else if (a === "--bots") o.bots = num();
    else if (a === "--seed") o.seed = num();
    else if (a === "--faults") o.faults = num();
    else if (a === "--show") o.show = num();
    else if (a === "--baseline") o.baseline = true;
    else if (a === "--") continue;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function main(): Promise<void> {
  const o = parse(process.argv.slice(2));
  const model = o.baseline
    ? null
    : new FakeModel(o.seed, { noJson: o.faults / 3, outOfRange: o.faults / 3, wrongType: o.faults / 3 });
  console.log(`DRY RUN (no network, no keys). Model: ${o.baseline ? "none (baseline only)" : `${FAKE_MODEL_NAME}, a scripted fake, NOT a language model`}`);
  console.log(`ticks=${o.ticks} bots=${o.bots} seed=${o.seed} injected-fault-rate=${o.faults}`);

  let shown = 0;
  const res = await simulate({
    ticks: o.ticks,
    bots: o.bots,
    seed: o.seed,
    model,
    onOutcome: (out) => {
      const d = out.decision;
      if (d.ts < 1_800_000_000 + o.show * 60 * 1) {
        shown++;
        const ship = d.ship ? `ship ${d.ship.qty} ${d.ship.good} -> ${d.ship.to}` : "no ship";
        console.log(
          `t+${String(Math.round((d.ts - 1_800_000_000) / 60)).padStart(3)}  ${PERSONAS[d.merchant].name.padEnd(13)} ${d.source.padEnd(8)} spread=${String(d.spread_bp).padStart(4)} bias=${String(d.bias_bp).padStart(5)} ${d.mood.padEnd(8)} ${ship}${out.skippedModel ? " (model skipped)" : ""} | ${d.line.en}`,
        );
      }
    },
  });
  void shown;
  const s = res.stats;
  console.log("");
  console.log(`decisions: ${res.decisions.length} (llm ${res.bySource.llm}, baseline ${res.bySource.baseline}, keep ${res.bySource.keep})`);
  console.log(`bot trips: ${s.trips}  median profit/trip (fils): ${s.medianProfit}  merchant-broke events: ${s.brokeEvents}  ambushes: ${s.ambushes}`);
  console.log(`mean spread over run (bp): ${s.meanSpreadBp}`);
  console.log(`merchant treasuries (fils): ${JSON.stringify(s.treasuries)}  house: ${s.house}`);
  console.log(`money conserved on every tick: yes (start ${s.moneyStart}, now ${s.moneyNow})`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
