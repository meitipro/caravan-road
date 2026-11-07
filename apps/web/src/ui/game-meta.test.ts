import { describe, expect, it } from "vitest";
import { modeBadge } from "./game-meta";

describe("modeBadge", () => {
  it("calls the browser-only mock a DEMO and never PLAY or LIVE", () => {
    for (const mode of ["PLAY", "LIVE"] as const) {
      const b = modeBadge(mode, true);
      expect(b.label).toBe("DEMO");
      expect(b.text).toMatch(/simulated/i);
      expect(b.text).toMatch(/no real money/i);
    }
  });

  it("keeps the real mode label outside the mock", () => {
    expect(modeBadge("PLAY", false)).toEqual({ label: "PLAY", text: "Practice with free dinars" });
    expect(modeBadge("LIVE", false).label).toBe("LIVE");
  });
});
