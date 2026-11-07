import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A page load rebuilds the in-memory mock world, so the flags that describe what the player did in it
// (claimed the free coins, cost basis) must be dropped with it; login and onboarding flags stay.
function fakeStorage(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    api: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  };
}

describe("mock world flags", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (globalThis as { __caravanMockWorld?: boolean }).__caravanMockWorld;
  });

  it("drops claimed and basis on a fresh page load, keeps login and onboarding, and only once per load", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK", "1");
    const s = fakeStorage({ "caravan.claimed": "1", "caravan.basis.v1": "{}", "caravan.onboarded": "1", "caravan.mock.session": "google" });
    vi.stubGlobal("window", { localStorage: s.api });
    await import("./api"); // module load = page load
    expect([...s.m.keys()].sort()).toEqual(["caravan.mock.session", "caravan.onboarded"]);
    // the player claims again in the new world; a hot reload (same page load) must not wipe it
    s.m.set("caravan.claimed", "1");
    vi.resetModules();
    await import("./api");
    expect(s.m.get("caravan.claimed")).toBe("1");
  });

  it("does nothing outside mock mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK", "0");
    const s = fakeStorage({ "caravan.claimed": "1" });
    vi.stubGlobal("window", { localStorage: s.api });
    await import("./api");
    expect(s.m.get("caravan.claimed")).toBe("1");
  });
});

describe("evidence badge", () => {
  it("says verified only when attested is true, and marks sample data", async () => {
    const { evidenceBadge } = await import("../components/Mind");
    expect(evidenceBadge(null).text).not.toMatch(/verified/i);
    expect(evidenceBadge(false).text).not.toMatch(/verified/i);
    expect(evidenceBadge(true).text).toMatch(/verified/i);
    expect(evidenceBadge(false, true).text).toMatch(/sample data/);
    expect(evidenceBadge(null, true).text).not.toMatch(/verified/i);
    expect(evidenceBadge(true, true).text).toMatch(/verified.*sample data/);
  });
});
