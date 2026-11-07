import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CITY_IDS, CITY_NAMES } from "@caravan/shared";
import { describe, expect, it } from "vitest";
import { CITY_META, modeBadge } from "./game-meta";

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
    expect(modeBadge("PLAY", false)).toEqual({ label: "PLAY", text: "Practice with free coins" });
    expect(modeBadge("LIVE", false).label).toBe("LIVE");
  });
});

describe("display names (plain English, one map)", () => {
  it("shows Farmstead, Minetown, Harbor and Capital; ids stay internal", () => {
    expect(CITY_META.dasht.name).toBe("Farmstead");
    expect(CITY_META.madan.name).toBe("Minetown");
    expect(CITY_META.bandar.name).toBe("Harbor");
    expect(CITY_META.shahr.name).toBe("Capital");
    for (const id of CITY_IDS) {
      expect(CITY_META[id].id).toBe(id);
      expect(CITY_META[id].name).toBe(CITY_NAMES[id]);
    }
  });

  it("merchants have common English names; portrait files keep their internal names", () => {
    expect(Object.values(CITY_META).map((c) => c.merchant)).toEqual(["Hazel", "Bram", "Mara", "Victor"]);
    expect(Object.values(CITY_META).map((c) => c.portrait)).toEqual(["golnar", "rostam", "nahid", "sohrab"]);
  });

  it("no shown text in components, pages or the ui folder uses the old place, merchant or currency words", () => {
    // built from pieces so this file does not contain them either
    const words = ["Din" + "ar", "din" + "ar", "Da" + "sht", "Ma" + "dan", "Ban" + "dar", "Sha" + "hr", "Gol" + "nar", "Ros" + "tam", "Na" + "hid", "Soh" + "rab", "Baz" + "aar", "baz" + "aar", "So" + "uk"];
    const re = new RegExp(`\\b(${words.join("|")})`);
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return n === "shoot" || n === "fonts" ? [] : walk(p);
        return /\.(tsx?|css)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
      });
    const src = join(__dirname, "..");
    for (const f of [...walk(join(src, "components")), ...walk(join(src, "app")), ...walk(__dirname)]) {
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // the portrait file names are internal ids and live in game-meta.ts only
      const shown = f.endsWith("game-meta.ts") ? text.replace(/portrait: "[a-z]+"/g, "") : text;
      expect(shown, f).not.toMatch(re);
    }
  });
});
