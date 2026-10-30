"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CITY_IDS, GOOD_IDS, PARAMS, findRoute,
  type CityId, type GoodId, type Journey, type Player, type WorldState,
} from "@caravan/shared";
import { basisCost, type Basis } from "../ui/basis";
import { formatBp, formatDinar, formatEta } from "../ui/format";
import { CITY_META, GOOD_META } from "../ui/game-meta";
import {
  ambushLoss, cargoBaseValue, cargoUnits, estimateSale, estimateSaleNet, guardCostFils, riskWithGuards, type Cargo,
} from "../ui/trade-math";
import { EmptyState, ErrorState, GoodIcon, LoadingBlock, Money, Page } from "./Bits";
import { useActions, useGame, useNow } from "./GameProvider";
import { CaravanSprite, PixelImage } from "./PixelImage";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

interface Result { journey: Journey; player: Player; estimate: bigint | null; unsold: number }

function cargoBasis(basis: Basis, cargo: Cargo): bigint | null {
  let sum = 0n;
  for (const g of GOOD_IDS) {
    const n = cargo[g] ?? 0;
    if (n <= 0) continue;
    const c = basisCost(basis, g, n);
    if (c === null) return null;
    sum += c;
  }
  return sum;
}

export function JourneyScreen() {
  const { world, me, status, refresh, basis } = useGame();
  const [result, setResult] = useState<Result | null>(null);

  if (status === "error" && !world) return <ErrorState onRetry={() => void refresh()}>The caravan could not be loaded.</ErrorState>;
  if (!world || !me) return <LoadingBlock label="Loading your caravan" rows={5} />;

  const j = me.journey && me.journey.status !== "CLAIMED" ? me.journey : null;
  return (
    <Page title={j ? "On the road" : "Plan a journey"} subtitle={j ? undefined : `You are in ${CITY_META[me.location].name}.`}>
      {j ? <Transit journey={j} world={world} onClaimed={setResult} /> : <Planner world={world} me={me} basis={basis} />}
      <ResultSheet result={result} basis={basis} onClose={() => setResult(null)} />
    </Page>
  );
}

/* ------------------------------------------------------------------ planner */

function Planner({ world, me, basis }: { world: WorldState; me: Player; basis: Basis }) {
  const params = useSearchParams();
  const actions = useActions();
  const toast = useToast();
  const wanted = params?.get("to");
  const others = CITY_IDS.filter((c) => c !== me.location);

  // Default cargo: everything held, up to the caravan capacity.
  const initialCargo = useMemo<Cargo>(() => {
    let left: number = PARAMS.CARGO_CAP;
    const c: Cargo = {};
    for (const g of GOOD_IDS) {
      const n = Math.min(me.inventory[g], left);
      if (n > 0) c[g] = n;
      left -= n;
    }
    return c;
    // only on first render for this location
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.location]);
  const [cargo, setCargo] = useState<Cargo>(initialCargo);
  const [guards, setGuards] = useState(0);
  const [to, setTo] = useState<CityId | null>(wanted && (others as string[]).includes(wanted) ? (wanted as CityId) : null);
  const [busy, setBusy] = useState(false);
  const picked = useRef(to !== null);

  // Keep cargo within what the player really holds when inventory changes.
  const held = GOOD_IDS.map((g) => me.inventory[g]).join(",");
  useEffect(() => {
    setCargo((c) => {
      const next: Cargo = {};
      let left: number = PARAMS.CARGO_CAP;
      for (const g of GOOD_IDS) {
        const n = Math.min(c[g] ?? 0, me.inventory[g], left);
        if (n > 0) next[g] = n;
        left -= n;
      }
      return next;
    });
  }, [held, me.inventory]);

  const units = cargoUnits(cargo);
  const sale = (dest: CityId): bigint | null => {
    const m = world.merchants.find((x) => x.id === dest);
    return m ? estimateSaleNet(m, cargo) : null;
  };
  const cost = cargoBasis(basis, cargo);

  // Pick the most profitable destination by default.
  useEffect(() => {
    if (picked.current || units === 0) return;
    let best: CityId | null = null;
    let bestVal = -1n;
    for (const c of others) {
      const v = sale(c) ?? 0n;
      if (v > bestVal) {
        bestVal = v;
        best = c;
      }
    }
    if (best) setTo(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, me.location]);

  if (units === 0 && GOOD_IDS.every((g) => me.inventory[g] === 0)) {
    return (
      <EmptyState
        title="Nothing to carry"
        action={<Link className="btn btn-primary" href={`/play/city/${me.location}`}>Buy goods in {CITY_META[me.location].name}</Link>}
      >
        Caravans carry goods. Buy something cheap here, then pick a city where it sells for more.
      </EmptyState>
    );
  }

  const route = to ? findRoute(me.location, to) : undefined;
  const risk = to ? riskWithGuards(me.location, to, guards) : 0;
  const guardCost = guardCostFils(cargo, guards);
  const potentialLoss = ambushLoss(cargo);
  const lossUnits = cargoUnits(potentialLoss);
  const lossValue = cargoBaseValue(potentialLoss);
  const broke = guardCost > BigInt(me.fils);
  const canStart = !!to && units > 0 && !broke && !busy;

  const setQty = (g: GoodId, n: number) => {
    const others2 = units - (cargo[g] ?? 0);
    const max = Math.min(me.inventory[g], PARAMS.CARGO_CAP - others2);
    const v = Math.max(0, Math.min(n, max));
    setCargo((c) => {
      const next = { ...c };
      if (v > 0) next[g] = v;
      else delete next[g];
      return next;
    });
  };

  const start = async () => {
    if (!to || !canStart) return;
    setBusy(true);
    const r = await actions.startJourney({ to, cargo, guards });
    setBusy(false);
    if (r.ok) toast.success(`Caravan left for ${CITY_META[to].name}`);
  };

  return (
    <div className="planner">
      <section className="panel stack" aria-labelledby="cargo-h">
        <h2 id="cargo-h" className="h3">1. Load the caravan <span className="muted small">({units} of {PARAMS.CARGO_CAP})</span></h2>
        <ul className="cargo-list">
          {GOOD_IDS.filter((g) => me.inventory[g] > 0).map((g) => (
            <li key={g} className="cargo-row">
              <GoodIcon good={g} />
              <span className="strong">{GOOD_META[g].name}</span>
              <span className="muted small">of {me.inventory[g]}</span>
              <span className="stepper">
                <button type="button" className="btn btn-icon btn-small" onClick={() => setQty(g, (cargo[g] ?? 0) - 1)} aria-label={`Less ${GOOD_META[g].name}`}>−</button>
                <span className="num qty-show" aria-live="polite">{cargo[g] ?? 0}</span>
                <button type="button" className="btn btn-icon btn-small" onClick={() => setQty(g, (cargo[g] ?? 0) + 1)} aria-label={`More ${GOOD_META[g].name}`}>+</button>
                <button type="button" className="btn btn-small" onClick={() => setQty(g, me.inventory[g])}>All</button>
              </span>
            </li>
          ))}
        </ul>
        {units === 0 && <p className="loss strong">Choose at least one unit to carry.</p>}
      </section>

      <section className="stack" aria-labelledby="dest-h">
        <h2 id="dest-h" className="h3">2. Choose where to go</h2>
        <div role="radiogroup" aria-labelledby="dest-h" className="dests">
          {others.map((c) => {
            const r = findRoute(me.location, c)!;
            const sv = sale(c);
            const profit = sv !== null && cost !== null ? sv - cost - guardCost : null;
            const on = to === c;
            return (
              <label key={c} className={`panel dest ${on ? "on" : ""}`}>
                <input type="radio" name="dest" className="sr-only" checked={on} onChange={() => { picked.current = true; setTo(c); }} />
                <span className="row-between">
                  <span className="strong">{CITY_META[c].name}</span>
                  <span className="chip">{formatEta(r.durationSec)}</span>
                </span>
                <span className="small muted">Ambush risk {formatBp(riskWithGuards(me.location, c, guards))}</span>
                {units > 0 && sv !== null && (
                  <span className="small">Sells for about <Money fils={sv} />{profit !== null && <> · est. profit <Money fils={profit} sign /></>}</span>
                )}
              </label>
            );
          })}
        </div>
      </section>

      <section className="panel stack" aria-labelledby="guard-h">
        <h2 id="guard-h" className="h3">3. Hire guards</h2>
        <div role="radiogroup" aria-labelledby="guard-h" className="guards">
          {[0, 1, 2, 3].map((g) => (
            <label key={g} className={`pill guard-pill ${guards === g ? "on" : ""}`}>
              <input type="radio" name="guards" className="sr-only" checked={guards === g} onChange={() => setGuards(g)} />
              <span className="row">
                <PixelImage slot="ui/guard" w={16} h={16} scale={2} alt="" decorative color="var(--stone)" />
                <span className="num">{g}</span>
              </span>
              <span className="small">{g === 0 ? "free" : `${formatDinar(guardCostFils(cargo, g))}`}</span>
            </label>
          ))}
        </div>
        <p className="muted small">Each guard costs 2% of the cargo&apos;s base value and cuts the ambush risk by 35%.</p>
      </section>

      <section className="panel stack-sm summary" aria-labelledby="sum-h">
        <h2 id="sum-h" className="h3">Trip summary</h2>
        {!to ? (
          <p className="muted">Choose a destination.</p>
        ) : (
          <dl className="kv cost">
            <dt>Route</dt><dd>{CITY_META[me.location].name} to {CITY_META[to].name}</dd>
            <dt>Travel time</dt><dd className="num">{route ? formatEta(route.durationSec) : "-"}</dd>
            <dt>Ambush risk</dt><dd className="num strong">{formatBp(risk)}</dd>
            <dt>If ambushed</dt>
            <dd>
              {lossUnits > 0 ? <span className="loss">lose {lossUnits} unit{lossUnits === 1 ? "" : "s"} (30% of each good), worth about {formatDinar(lossValue)} dinars</span> : "nothing to lose"}
            </dd>
            <dt>Guards</dt><dd className="num">{guards} · <Money fils={guardCost} /></dd>
          </dl>
        )}
        {broke && <p className="loss strong" role="alert">Not enough dinars for the guards.</p>}
        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!canStart} onClick={start}>
          {busy ? "Sending…" : to ? `Send caravan to ${CITY_META[to].name}` : "Choose a destination"}
        </button>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ in transit */

function Transit({ journey: j, world, onClaimed }: { journey: Journey; world: WorldState; onClaimed: (r: Result) => void }) {
  const now = useNow();
  const actions = useActions();
  const toast = useToast();
  const { basis } = useGame();
  const [busy, setBusy] = useState(false);
  const notified = useRef(false);

  const total = j.arrives_at - j.started_at;
  const left = j.arrives_at - now;
  const ready = now > 0 && (j.status === "ARRIVED" || left <= 0);
  const t = total > 0 && now > 0 ? Math.min(1, Math.max(0, (now - j.started_at) / total)) : 0;

  useEffect(() => {
    if (ready && !notified.current) {
      notified.current = true;
      toast.info(`Your caravan reached ${CITY_META[j.to].name}. Claim it!`);
    }
  }, [ready, j.to, toast]);

  const claim = async () => {
    setBusy(true);
    const m = world.merchants.find((x) => x.id === j.to);
    const r = await actions.claim();
    setBusy(false);
    if (r.ok) {
      const lost = r.data.journey.lost ?? {};
      const arrived: Cargo = {};
      for (const g of GOOD_IDS) {
        const n = (r.data.journey.cargo[g] ?? 0) - (lost[g] ?? 0);
        if (n > 0) arrived[g] = n;
      }
      const est = m ? estimateSale(m, arrived) : null;
      onClaimed({ journey: r.data.journey, player: r.data.player, estimate: est ? est.net : null, unsold: est ? est.unsold : 0 });
    }
  };

  const cargoEntries = GOOD_IDS.filter((g) => (j.cargo[g] ?? 0) > 0);

  return (
    <div className="stack">
      <section className="panel stack transit" aria-label="Caravan progress">
        <div className="row-between">
          <p className="strong">{CITY_META[j.from].name} to {CITY_META[j.to].name}</p>
          <span className="chip">Risk {formatBp(j.risk_bp)}</span>
        </div>
        <p className="countdown num" role="timer" aria-live="off">{ready ? "Arrived" : formatEta(left)}</p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t * 100)} aria-label="Journey progress">
          <span className="progress-fill" style={{ width: `${t * 100}%` }} />
          <span className="progress-sprite" style={{ left: `${t * 100}%` }}><CaravanSprite moving={!ready} /></span>
        </div>
        <div className="row-between muted small">
          <span>{CITY_META[j.from].name}</span><span>{CITY_META[j.to].name}</span>
        </div>
        <button type="button" className={`btn btn-lg btn-block ${ready ? "btn-primary pulse" : ""}`} disabled={!ready || busy} onClick={claim}>
          {busy ? "Claiming…" : ready ? "Claim your caravan" : "Waiting for arrival"}
        </button>
      </section>

      <section className="panel stack-sm" aria-labelledby="load-h">
        <h2 id="load-h" className="h3">Aboard</h2>
        <ul className="chips">
          {cargoEntries.map((g) => (
            <li key={g} className="chip inv-chip"><GoodIcon good={g} />{GOOD_META[g].name} <span className="num">{j.cargo[g]}</span></li>
          ))}
        </ul>
        <p className="muted small">{j.guards} guard{j.guards === 1 ? "" : "s"} hired. Cargo worth about {formatDinar(cargoBaseValue(j.cargo))} dinars at base prices.</p>
        {basisHint(basis, j.cargo)}
      </section>
    </div>
  );
}

function basisHint(basis: Basis, cargo: Cargo) {
  const c = cargoBasis(basis, cargo);
  return c === null ? null : <p className="muted small">You paid about {formatDinar(c)} dinars for this cargo.</p>;
}

/* ------------------------------------------------------------------ result */

function ResultSheet({ result, basis, onClose }: { result: Result | null; basis: Basis; onClose: () => void }) {
  if (!result) return <Sheet open={false} onClose={onClose} title="Caravan" >{null}</Sheet>;
  const j = result.journey;
  const lost = j.lost ?? {};
  const survived: Cargo = {};
  for (const g of GOOD_IDS) {
    const n = (j.cargo[g] ?? 0) - (lost[g] ?? 0);
    if (n > 0) survived[g] = n;
  }
  const ambushed = !!j.ambushed;
  const lostEntries = GOOD_IDS.filter((g) => (lost[g] ?? 0) > 0);
  const survivedEntries = GOOD_IDS.filter((g) => (survived[g] ?? 0) > 0);
  const paid = cargoBasis(basis, survived);
  const profit = result.estimate !== null && paid !== null ? result.estimate - paid : null;

  return (
    <Sheet
      open
      onClose={onClose}
      tone={ambushed ? "danger" : "success"}
      title={ambushed ? "Ambushed on the road!" : `Safe arrival in ${CITY_META[j.to].name}`}
      footer={
        <>
          <Link className="btn btn-primary btn-lg grow" href={`/play/city/${j.to}`} onClick={onClose}>Go to the market</Link>
          <button type="button" className="btn btn-lg" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="stack">
        {ambushed ? (
          <>
            <p className="loss strong">Bandits took part of your cargo.</p>
            <ul className="chips">
              {lostEntries.map((g) => (
                <li key={g} className="chip chip-loss"><GoodIcon good={g} />-{lost[g]} {GOOD_META[g].name}</li>
              ))}
            </ul>
            <p className="muted small">Hire guards next time: each one cuts the ambush risk by about a third.</p>
          </>
        ) : (
          <p className="strong">Nothing was lost.</p>
        )}
        {survivedEntries.length > 0 && (
          <>
            <h3 className="h3">Delivered</h3>
            <ul className="chips">
              {survivedEntries.map((g) => (
                <li key={g} className="chip inv-chip"><GoodIcon good={g} />{GOOD_META[g].name} <span className="num">{survived[g]}</span></li>
              ))}
            </ul>
          </>
        )}
        {result.estimate !== null && (
          <div className="panel-dim stack-sm">
            <p>Selling it all here now would bring about <Money fils={result.estimate} />.</p>
            {profit !== null && <p>Estimated profit on this trip: <Money fils={profit} sign className="strong" /></p>}
            {result.unsold > 0 && <p className="small">The merchant cannot afford {result.unsold} of your units right now. Sell the rest later or in another city.</p>}
            <p className="muted small">Estimate only. Prices move as you sell.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
