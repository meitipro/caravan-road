import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Rule 5: no chain vocabulary in normal-flow text. Allowed only in the Advanced drawer and the proof page.
const ROOT = join(__dirname, "..");
const ALLOWED = new Set(["components/Advanced.tsx", "components/ProofScreen.tsx"]);
const FORBIDDEN = /\b(wallet|gas|sign|signs|signed|signing|hash|hashes|blockchain|transaction|transactions)\b/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "shoot" ? [] : files(p);
    return /\.(tsx)$/.test(n) ? [p] : [];
  });
}

/** String literals and JSX text only; comments and import lines are dropped. */
function visibleText(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of noComments.matchAll(/"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out.filter((t) => !t.startsWith("/") && !t.startsWith("../") && !t.startsWith("./") && !t.includes("@caravan"));
}

describe("vocabulary", () => {
  const targets = [...files(join(ROOT, "components")), ...files(join(ROOT, "app", "play"))];
  for (const f of targets) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;
    it(`${rel} has no chain words`, () => {
      const bad = visibleText(readFileSync(f, "utf8")).filter((t) => FORBIDDEN.test(t));
      expect(bad).toEqual([]);
    });
  }
});
