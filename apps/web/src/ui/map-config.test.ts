import { describe, expect, it } from "vitest";
import { MAP_ROUTES, MAP_SIZE } from "./map-config";

describe("map route labels", () => {
  it("never overlap each other (the crossing Harbor-Capital and Farmstead-Minetown roads once shared a label spot)", () => {
    // a label is about 90 x 28 px on the 960 x 540 world art
    for (let i = 0; i < MAP_ROUTES.length; i++) {
      for (let j = i + 1; j < MAP_ROUTES.length; j++) {
        const a = MAP_ROUTES[i]!.label;
        const b = MAP_ROUTES[j]!.label;
        const dx = Math.abs(a.x - b.x) * (MAP_SIZE.w / 100);
        const dy = Math.abs(a.y - b.y) * (MAP_SIZE.h / 100);
        expect(dx >= 90 || dy >= 28, `${MAP_ROUTES[i]!.key} vs ${MAP_ROUTES[j]!.key}`).toBe(true);
      }
    }
  });
});
