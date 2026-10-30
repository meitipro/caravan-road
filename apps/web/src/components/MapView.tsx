"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { CITY_IDS, type CityId, type Journey, type Player, type WorldState } from "@caravan/shared";
import { formatBp, formatEta } from "../ui/format";
import { CITY_META } from "../ui/game-meta";
import { CITY_POS, MAP_ROUTES, pointOnRoute } from "../ui/map-config";
import { useNow } from "./GameProvider";
import { CaravanSprite, useAssetOk } from "./PixelImage";
import { useToast } from "./Toast";

interface Props { world: WorldState; me: Player }

function journeyProgress(j: Journey, now: number): number {
  const span = j.arrives_at - j.started_at;
  if (span <= 0 || now <= 0) return 0;
  return Math.min(1, Math.max(0, (now - j.started_at) / span));
}

export function MapView({ world, me }: Props) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow();
  const bg = useAssetOk("/assets/map/world.png");
  const scroller = useRef<HTMLDivElement>(null);
  const j = me.journey && me.journey.status !== "CLAIMED" ? me.journey : null;
  const here = j ? null : me.location;

  // On a phone the canvas is wider than the screen: bring the player's city into view once.
  const focusCity = j ? j.from : me.location;
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const x = (CITY_POS[focusCity].x / 100) * el.scrollWidth - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, x);
  }, [focusCity]);

  const onRoute = (a: CityId, b: CityId, durationSec: number, riskBp: number) => {
    if (here === a || here === b) {
      router.push(`/play/journey?to=${here === a ? b : a}`);
    } else if (j) {
      router.push("/play/journey");
    } else {
      toast.info(`${CITY_META[a].name} to ${CITY_META[b].name}: ${formatEta(durationSec)}, ${formatBp(riskBp)} ambush risk. Travel to one of those cities first.`);
    }
  };

  let caravan: { x: number; y: number; flip: boolean; left: number } | null = null;
  if (j) {
    const t = journeyProgress(j, now);
    const p = pointOnRoute(j.from, j.to, t);
    caravan = { ...p, flip: CITY_POS[j.to].x < CITY_POS[j.from].x, left: j.arrives_at - now };
  }

  return (
    <div className="mapwrap" ref={scroller}>
      <div className="mapcanvas" role="group" aria-label="Map of the four cities">
        {bg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/assets/map/world.png" alt="" className="pixel mapbg" aria-hidden="true" />
        ) : (
          <div className="mapbg mapbg-flat" aria-hidden="true" />
        )}

        <svg className="maplines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {MAP_ROUTES.map((r) => {
            const mine = here === r.a || here === r.b;
            return (
              <line
                key={r.key}
                x1={CITY_POS[r.a].x} y1={CITY_POS[r.a].y} x2={CITY_POS[r.b].x} y2={CITY_POS[r.b].y}
                className={`route-line ${mine ? "mine" : ""}`}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {MAP_ROUTES.map((r) => {
          const mine = here === r.a || here === r.b;
          return (
            <button
              key={r.key}
              type="button"
              className={`route-label ${mine ? "mine" : ""}`}
              style={{ left: `${r.label.x}%`, top: `${r.label.y}%` }}
              onClick={() => onRoute(r.a, r.b, r.durationSec, r.riskBp)}
              aria-label={`Route ${CITY_META[r.a].name} to ${CITY_META[r.b].name}, ${formatEta(r.durationSec)}, ${formatBp(r.riskBp)} ambush risk${mine ? ", plan a journey" : ""}`}
            >
              {formatEta(r.durationSec)} · {formatBp(r.riskBp)}
            </button>
          );
        })}

        {CITY_IDS.map((c) => {
          const m = world.merchants.find((x) => x.id === c);
          const youHere = here === c;
          return (
            <Link
              key={c}
              href={`/play/city/${c}`}
              className={`city-node ${youHere ? "here" : ""}`}
              style={{ left: `${CITY_POS[c].x}%`, top: `${CITY_POS[c].y}%` }}
              aria-label={`${CITY_META[c].name}, ${CITY_META[c].role}${youHere ? ", you are here" : ""}. Open market`}
            >
              <span className="city-house" aria-hidden="true" />
              <span className="city-name">{CITY_META[c].name}</span>
              {m && <span className={`mood-dot mood-${m.mood}`} aria-hidden="true" />}
              {youHere && <span className="you-flag" aria-hidden="true">YOU</span>}
            </Link>
          );
        })}

        {caravan && (
          <div className="caravan-marker" style={{ left: `${caravan.x}%`, top: `${caravan.y}%` }}>
            <CaravanSprite flip={caravan.flip} scale={1} />
            <span className="caravan-eta num">{formatEta(caravan.left)}</span>
          </div>
        )}
      </div>

      <ul className="sr-only" aria-label="Cities and routes">
        {CITY_IDS.map((c) => (
          <li key={c}>{CITY_META[c].name}, {CITY_META[c].role}</li>
        ))}
        {MAP_ROUTES.map((r) => (
          <li key={r.key}>
            {CITY_META[r.a].name} to {CITY_META[r.b].name}: {formatEta(r.durationSec)}, {formatBp(r.riskBp)} ambush risk
          </li>
        ))}
      </ul>
    </div>
  );
}
