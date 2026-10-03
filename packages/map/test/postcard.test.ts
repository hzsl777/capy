// Postcards (src/map/postcard.ts, src/ui/postcard.ts): an experimental design that stays off the Design menu; the
// folded sheet's creases never run through the reticle; and the postcard's slide and turn stay under the no-flash
// limit (WCAG 2.3.1): short, still for reduced motion, never more than once a second on their own, and between two
// faces close enough in brightness that the turn swings the panel's light less than 10%.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FACES, faceLuminance, FLIP_MS, HOLD_MS, luminance, sheetFolds, SLIDE_MS } from "../src/map/postcard.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const css = readFileSync(here("../src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ours = css.slice(css.indexOf(':root[data-theme="postcard"] {'));

describe("Postcards", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.postcard;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("postcard");
    expect(FEATURED).not.toContain("postcard");
    expect(t.surface).toBe("postcard");
  });

  it("keeps fresh reports apart from the normal marker, and the hollow mark hollow", () => {
    const t = THEMES.postcard;
    expect(t.fresh).not.toBe(t.dot);
    expect(luminance(t.dotStroke)).toBeGreaterThan(0.8);
    expect(luminance(t.dot)).toBeLessThan(0.3);
  });

  it("shows the postcard's parts in this design only", () => {
    const rules = [...css.matchAll(/([^{}]*\.pc-(?:bar|card)(?![\w-])[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const base = rules.filter((r) => /^\.pc-bar,\s*\.pc-card$/.test(r.sel));
    expect(base).toHaveLength(1);
    expect(base[0]!.body).toMatch(/display:\s*none/);
    for (const r of rules) if (/display:\s*(?!none)\w/.test(r.body)) expect(r.sel, r.sel).toContain(':root[data-theme="postcard"]');
  });
});

describe("Postcards' folded sheet", () => {
  const sizes: [number, number][] = [
    [1400, 900],
    [1100, 640],
    [390, 420],
    [360, 380],
    [2560, 1300],
    [700, 1000],
  ];

  it("folds into an odd number of panels each way, so the reticle sits mid-panel", () => {
    for (const [w, h] of sizes) {
      const folds = sheetFolds(w, h);
      const cols = folds.filter((f) => f.upright).length + 1;
      const rows = folds.filter((f) => !f.upright).length + 1;
      expect(cols % 2, `${w}x${h}`).toBe(1);
      expect(rows % 2, `${w}x${h}`).toBe(1);
      for (const f of folds) {
        const mid = f.upright ? w / 2 : h / 2;
        const panel = (f.upright ? w : h) / (f.upright ? cols : rows);
        expect(Math.abs(f.at - mid), `${w}x${h}`).toBeGreaterThanOrEqual(panel / 2 - 0.5);
      }
    }
  });

  it("keeps every fold inside the sheet, the same on every load, and alternates the light like an accordion", () => {
    for (const [w, h] of sizes) {
      const a = sheetFolds(w, h);
      expect(sheetFolds(w, h)).toEqual(a);
      for (const f of a) {
        expect(f.at).toBeGreaterThan(0);
        expect(f.at).toBeLessThan(f.upright ? w : h);
      }
      const up = a.filter((f) => f.upright);
      for (let i = 1; i < up.length; i++) expect(up[i]!.lit).toBe(-up[i - 1]!.lit);
    }
  });

  it("gives panels a pocket map's size", () => {
    for (const [w, h] of sizes) {
      const folds = sheetFolds(w, h);
      const cols = folds.filter((f) => f.upright).length + 1;
      if (cols > 1) expect(w / cols).toBeGreaterThanOrEqual(110);
    }
  });
});

describe("Postcards' slide and turn", () => {
  it("are short, and the card turns by itself at most once a second", () => {
    expect(SLIDE_MS).toBeLessThan(500);
    expect(FLIP_MS).toBeLessThan(500);
    expect(HOLD_MS).toBeGreaterThanOrEqual(1000);
    // The style sheet runs them at the same speeds.
    expect(ours).toMatch(new RegExp(`\\.pc-flip \\{[^}]*transition: transform ${FLIP_MS}ms`));
    expect(ours).toMatch(new RegExp(`animation: pc-slide ${SLIDE_MS}ms`));
  });

  it("hold still for readers who ask for reduced motion", () => {
    const reduce = ours.slice(ours.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduce).toMatch(/\.pc-flip \{\s*transition: none;/);
    expect(reduce).toMatch(/\.pc-in \.pc-card \{\s*animation: none;/);
  });

  it("swap two faces close in brightness, so a turn swings the panel's light less than 10%", () => {
    const front = faceLuminance(FACES.front);
    const back = faceLuminance(FACES.back);
    const behind = faceLuminance(FACES.behind);
    expect(Math.abs(front - back)).toBeLessThan(0.1);
    // Half way through, the card is edge on and the panel's paper shows behind it.
    expect(Math.abs(front - behind)).toBeLessThan(0.1);
    expect(Math.abs(back - behind)).toBeLessThan(0.1);
  });

  it("uses the colours it is checked with", () => {
    for (const p of [...FACES.front, ...FACES.back, ...FACES.behind]) expect(css.toLowerCase(), p.colour).toContain(p.colour.toLowerCase());
  });
});
