import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Legibility guard: the pixel font (Pixelify Sans) draws "5" like "S" and 1/7 ambiguously, so digits must
// never be rendered with it. The fix is a unicode-range split: an Inter face declared for U+0030-0039 only
// is listed first in --font-pixel, so digits fall to Inter inside pixel-font text (headings, tables, ...).
const UI = __dirname;
const SRC = join(UI, "..");
const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string, re: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "shoot" || n === "fonts" ? [] : walk(p, re);
    return re.test(n) ? [p] : [];
  });
}

const layout = read(join(SRC, "app", "layout.tsx"));
const tokens = read(join(UI, "tokens.css"));
const cssFiles = walk(UI, /\.css$/);
const tsxFiles = [...walk(join(SRC, "components"), /\.tsx$/), ...walk(join(SRC, "app", "play"), /\.tsx?$/)];

describe("digit font (no pixel-font digits)", () => {
  it("declares an Inter digits face for U+0030-0039 only, from a bundled file", () => {
    expect(layout).toMatch(/localFont\(/);
    expect(layout).toMatch(/variable:\s*"--font-digits"/);
    expect(layout).toMatch(/prop:\s*"unicode-range",\s*value:\s*"U\+0030-0039"/);
    // the fallback face next/font adds has no unicode-range and would capture every character
    expect(layout).toMatch(/adjustFontFallback:\s*false/);
    expect(layout).toMatch(/\$\{digits\.variable\}/);
    const file = layout.match(/path:\s*"([^"]+\.woff2)"/)?.[1];
    expect(file, "digits font file referenced").toBeTruthy();
    expect(existsSync(join(SRC, "app", file!))).toBe(true);
  });

  it("lists the digits face before Pixelify Sans in --font-pixel", () => {
    const stack = tokens.match(/--font-pixel:\s*([^;]+);/)?.[1] ?? "";
    expect(stack).toContain("var(--font-digits)");
    expect(stack).toContain("var(--font-pixelify)");
    expect(stack.indexOf("var(--font-digits)")).toBeLessThan(stack.indexOf("var(--font-pixelify)"));
  });

  it("never references Pixelify Sans except through --font-pixel", () => {
    for (const f of cssFiles) {
      const rel = relative(UI, f);
      const css = read(f);
      if (rel !== "tokens.css") expect(css, rel).not.toMatch(/--font-pixelify|Pixelify/i);
      for (const decl of css.matchAll(/font-family:\s*([^;}]+)/g)) {
        const v = decl[1];
        if (/pixel/i.test(v)) expect(v.trim(), `${rel}: ${v}`).toBe("var(--font-pixel)");
      }
    }
  });

  it("keeps numeric elements on the body face (Inter, tabular figures)", () => {
    const all = cssFiles.map(read).join("\n");
    // rules for numeric elements must not select the pixel stack
    for (const sel of [".num", ".countdown", ".big-balance", ".medal", ".money", ".qty-input", ".badge", ".btn"]) {
      const re = new RegExp(`(^|\n)\s*${sel.replace(".", "\.")}\b[^{]*\{([^}]*)\}`, "g");
      for (const m of all.matchAll(re)) expect(m[2], `${sel} must not use --font-pixel`).not.toMatch(/--font-pixel/);
    }
    expect(all).toMatch(/\.num\s*\{[^}]*tabular-nums[^}]*font-family:\s*var\(--font-body\)/);
    expect(all).toMatch(/\.countdown\s*\{[^}]*var\(--font-body\)/);
    expect(all).toMatch(/\.big-balance\s*\{[^}]*var\(--font-body\)/);
    // text rendered in the pixel stack gets tabular figures too
    expect(all).toMatch(/h1,\s*h2,\s*h3,\s*h4[^{]*\{\s*font-variant-numeric:\s*tabular-nums/);
  });

  it("no component or page sets a font on an element, inline or by class", () => {
    for (const f of tsxFiles) {
      const rel = relative(SRC, f).split("\\").join("/");
      const src = read(f);
      expect(src, `${rel}: inline font`).not.toMatch(/fontFamily|font-family|Pixelify|--font-pixel/);
      // the pixel-font utility class may only sit on text, never on a number: the digits would still fall
      // back to Inter, but keep the intent explicit
      for (const m of src.matchAll(/className=\{?[`"][^`"]*\bpixel-font\b[^`"]*[`"]/g)) {
        expect(m[0], `${rel}: pixel-font on a numeric element`).not.toMatch(/\bnum\b|countdown|balance|money|price|timer/);
      }
    }
  });
});

describe("English only", () => {
  it("ships a single Latin UI: lang=en, no extra font family, no RTL or locale hooks", () => {
    expect(layout).toMatch(/<html lang="en"/);
    expect(layout).not.toMatch(/Vazirmatn|vazirmatn/);
    expect(tokens).not.toMatch(/--font-fa|vazirmatn/i);
    for (const f of cssFiles) expect(read(f), relative(UI, f)).not.toMatch(/\[dir=|\[lang=|:lang\(|direction:\s*rtl/);
    for (const f of tsxFiles) expect(read(f), relative(SRC, f)).not.toMatch(/\bdir=\{|\bdir="rtl"|useLang|LangProvider/);
  });

  it("has no Arabic-script characters in source files", () => {
    for (const f of walk(SRC, /\.(tsx?|css)$/)) {
      expect(read(f), relative(SRC, f)).not.toMatch(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/);
    }
  });
});
