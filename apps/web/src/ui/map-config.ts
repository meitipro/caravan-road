// Map layout. Coordinates are percentages of the 960x540 world.png (master plan 7.4 task 3).

import { CITY_IDS, ROUTES, type CityId } from "@caravan/shared";

export const MAP_SIZE = { w: 960, h: 540 } as const;

export const CITY_POS: Record<CityId, { x: number; y: number }> = {
  dasht: { x: 28, y: 62 },
  madan: { x: 72, y: 30 },
  bandar: { x: 20, y: 22 },
  shahr: { x: 74, y: 72 },
};

export interface MapRoute {
  key: string;
  a: CityId;
  b: CityId;
  durationSec: number;
  riskBp: number;
  mid: { x: number; y: number };
  /** where the label sits along the route (0 = first city, 1 = second) so labels do not collide */
  label: { x: number; y: number };
}

const LABEL_T: Record<string, number> = { "shahr-bandar": 0.8, "madan-dasht": 0.3, "dasht-bandar": 0.5, "dasht-shahr": 0.5 };

export const MAP_ROUTES: readonly MapRoute[] = ROUTES.map((r) => {
  const key = `${r.a}-${r.b}`;
  const t = LABEL_T[key] ?? 0.5;
  return {
  key,
  a: r.a,
  b: r.b,
  durationSec: r.durationSec,
  riskBp: r.riskBp,
  mid: {
    x: (CITY_POS[r.a].x + CITY_POS[r.b].x) / 2,
    y: (CITY_POS[r.a].y + CITY_POS[r.b].y) / 2,
  },
  label: {
    x: CITY_POS[r.a].x + (CITY_POS[r.b].x - CITY_POS[r.a].x) * t,
    y: CITY_POS[r.a].y + (CITY_POS[r.b].y - CITY_POS[r.a].y) * t,
  },
  };
});

/** Position (percent) along a route between two cities, t in [0, 1] from `from` to `to`. */
export function pointOnRoute(from: CityId, to: CityId, t: number): { x: number; y: number } {
  const a = CITY_POS[from];
  const b = CITY_POS[to];
  const c = Math.min(1, Math.max(0, t));
  return { x: a.x + (b.x - a.x) * c, y: a.y + (b.y - a.y) * c };
}

export const ALL_CITIES = CITY_IDS;
