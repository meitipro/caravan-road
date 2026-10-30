"use client";

import Link from "next/link";
import { CITY_IDS, GOOD_IDS, findRoute } from "@caravan/shared";
import { formatBp, formatEta } from "../ui/format";
import { CITY_META, GOOD_META } from "../ui/game-meta";
import { riskWithGuards, priceBand, cargoUnits } from "../ui/trade-math";
import { EmptyState, GoodIcon, LoadingBlock, MoodChip, Page } from "./Bits";
import { FaucetBanner } from "./Faucet";
import { useGame } from "./GameProvider";
import { useLang } from "./Lang";
import { MapView } from "./MapView";

export function MapScreen() {
  const { world, me } = useGame();
  const { lang } = useLang();
  if (!world || !me) return <LoadingBlock label="Loading the map" rows={5} />;

  const traveling = me.journey && me.journey.status !== "CLAIMED";
  const carried = cargoUnits(me.inventory);
  const held = GOOD_IDS.filter((g) => me.inventory[g] > 0);

  return (
    <Page
      title="Silk Road"
      subtitle={
        traveling ? (
          <>Your caravan is on the road to {CITY_META[me.journey!.to].name}.</>
        ) : (
          <>You are in {CITY_META[me.location].name}. Tap a city to trade or a road to travel.</>
        )
      }
      actions={<span className="chip" title="The world advances in ticks"><span className="tick-dot" aria-hidden="true" /> Tick {world.tick}</span>}
    >
      <FaucetBanner />
      <MapView world={world} me={me} />

      <div className="grid-cols">
        <section className="panel stack-sm" aria-labelledby="inv-h">
          <h2 id="inv-h" className="h3">Your caravan</h2>
          {held.length === 0 ? (
            <p className="muted">Empty. Buy something cheap in the market, then send it where it is scarce.</p>
          ) : (
            <ul className="chips">
              {held.map((g) => (
                <li key={g} className="chip inv-chip">
                  <GoodIcon good={g} />
                  {GOOD_META[g].name} <span className="num">{me.inventory[g]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Cargo {carried} of 40 units.</p>
          <div className="row">
            <Link className="btn btn-primary" href={`/play/city/${me.location}`}>Open {CITY_META[me.location].name} market</Link>
            <Link className="btn" href="/play/journey">{traveling ? "See caravan" : "Plan a journey"}</Link>
          </div>
        </section>

        <section className="stack-sm" aria-labelledby="cities-h">
          <h2 id="cities-h" className="h3">Cities</h2>
          {world.merchants.length === 0 && <EmptyState title="No cities yet" />}
          <ul className="citylist">
            {CITY_IDS.map((c) => {
              const m = world.merchants.find((x) => x.id === c);
              const cheap = m ? GOOD_IDS.filter((g) => priceBand(BigInt(m.quotes[g].mid), g) === "cheap") : [];
              const dear = m ? GOOD_IDS.filter((g) => priceBand(BigInt(m.quotes[g].mid), g) === "dear") : [];
              const route = findRoute(me.location, c);
              const here = !traveling && me.location === c;
              return (
                <li key={c} className="panel citycard">
                  <div className="row-between">
                    <div>
                      <p className="strong">{CITY_META[c].name} <span className="muted small">{CITY_META[c].role}</span></p>
                      <p className="muted small">{CITY_META[c].merchant}</p>
                    </div>
                    {m && <MoodChip mood={m.mood} lang={lang} />}
                  </div>
                  <p className="small">
                    {cheap.length > 0 && <>Cheap: <strong>{cheap.map((g) => GOOD_META[g].name).join(", ")}</strong>. </>}
                    {dear.length > 0 && <>Pays well for: <strong>{dear.map((g) => GOOD_META[g].name).join(", ")}</strong>.</>}
                    {cheap.length === 0 && dear.length === 0 && <span className="muted">Prices are near normal.</span>}
                  </p>
                  <div className="row">
                    <Link className="btn btn-small" href={`/play/city/${c}`}>{here ? "Trade here" : "Prices"}</Link>
                    {!traveling && route && (
                      <Link className="btn btn-small" href={`/play/journey?to=${c}`}>
                        Travel {formatEta(route.durationSec)} · {formatBp(riskWithGuards(me.location, c, 0))} risk
                      </Link>
                    )}
                    {here && <span className="chip">You are here</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </Page>
  );
}
