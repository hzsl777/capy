// Shortwave (src/map/shortwave.ts, src/ui/dial.ts): an experimental design that stays off the Design menu; its radio
// front under the map shows only in this design; the dial's needle and the longitude it stands for agree both ways;
// the printed scale fits the window; and nothing on it flashes (WCAG 2.3.1): the static drifts slowly at an even light
// and the tuning lamp fades rather than blinks.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dialAt,
  EYE_OPEN,
  EYE_SHUT,
  KEY_PX,
  LABEL_PX,
  LAMP_DIM,
  LAMP_FADE_S,
  LAMP_LIT,
  lampLevel,
  lonAt,
  lonText,
  scaleLabels,
  scaleStep,
  sectorPath,
  STATIC_DRIFT_S,
  STATIC_FADE_S,
  STATIC_OPACITY,
  turnBetween,
  WING_TURN,
} from "../src/map/shortwave.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const css = readFileSync(here("../src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("Shortwave", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.shortwave;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("shortwave");
    expect(FEATURED).not.toContain("shortwave");
  });

  it("keeps hollow, filled, ringed and fresh markers apart", () => {
    const t = THEMES.shortwave;
    expect(t.fresh).not.toBe(t.dot);
    expect(t.dotStroke).not.toBe(t.dot);
    expect(t.dotShape).toBe("circle");
  });

  it("shows the radio under the map in this design only", () => {
    // Every rule that names the radio on its own (not a part inside it), with what it sets.
    const rules = [...css.matchAll(/([^{}]*\.sw-radio(?![\w-])[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const base = rules.filter((r) => r.sel === ".sw-radio");
    expect(base).toHaveLength(1);
    expect(base[0]!.body).toMatch(/display:\s*none/);
    for (const r of rules) {
      if (/display:\s*(?!none)\w/.test(r.body)) expect(r.sel, r.sel).toContain(':root[data-theme="shortwave"]');
    }
  });

  it("lays the static over the dial window only, never over the map", () => {
    const rules = [...css.matchAll(/([^{}]*\.sw-static[^{}]*)\{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(rules.length).toBeGreaterThan(0);
    for (const sel of rules) expect(sel).not.toMatch(/\.map\b/);
    // Positioned inside the glass, which clips it.
    expect(css).toMatch(/\.sw-glass\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.sw-static\s*\{[^}]*position:\s*absolute/);
  });
});

describe("Shortwave's dial", () => {
  it("runs from 180 W at the left end to 180 E at the right, with 0 in the middle", () => {
    expect(dialAt(-180)).toBe(0);
    expect(dialAt(0)).toBe(0.5);
    expect(dialAt(90)).toBe(0.75);
    expect(lonAt(0)).toBe(-180);
    expect(lonAt(1)).toBe(180);
    expect(lonAt(-0.5)).toBe(-180);
    expect(lonAt(2)).toBe(180);
  });

  it("puts the needle where the longitude is, and back again, for every longitude", () => {
    for (let lon = -179.5; lon < 180; lon += 7.3) {
      const f = dialAt(lon);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(lonAt(f)).toBeCloseTo(lon, 9);
    }
    // A longitude past the date line wraps to its place on the scale.
    expect(dialAt(190)).toBeCloseTo(dialAt(-170), 12);
    expect(dialAt(-200)).toBeCloseTo(dialAt(160), 12);
  });

  it("prints its numbers far enough apart to read, on a phone and on a wide screen", () => {
    for (const w of [180, 220, 260, 320, 480, 650, 900]) {
      const step = scaleStep(w);
      const labels = scaleLabels(step);
      expect(labels[0]!.lon).toBe(-180);
      expect(labels.at(-1)!.lon).toBe(180);
      if ((w * 90) / 360 >= LABEL_PX) expect((w * step) / 360).toBeGreaterThanOrEqual(LABEL_PX);
    }
    expect(scaleStep(650)).toBe(30);
    expect(scaleStep(260)).toBe(60);
  });

  it("prints longitude like a band's frequencies: numbers with W or E, and no names", () => {
    const labels = scaleLabels(30);
    expect(labels.map((l) => l.num + l.side)).toEqual(["180", "150W", "120W", "90W", "60W", "30W", "0", "30E", "60E", "90E", "120E", "150E", "180"]);
    for (const l of labels) expect(l.num).toMatch(/^\d+$/);
    expect(lonText(36.82)).toBe("36.8 degrees east");
    expect(lonText(-77)).toBe("77 degrees west");
    expect(lonText(0)).toBe("0 degrees");
  });

  it("turns the knob the short way round across the date line", () => {
    expect(turnBetween(170, -170)).toBe(20);
    expect(turnBetween(-170, 170)).toBe(-20);
    expect(turnBetween(10, 40)).toBe(30);
    expect(Math.abs(turnBetween(0, 180))).toBe(180);
    expect(KEY_PX).toBe(40);
  });
});

describe("Shortwave's lamp and static never flash", () => {
  it("the lamp's glow fades over at least a third of a second, so it can't swing on and off more than three times a second", () => {
    expect(LAMP_FADE_S).toBeGreaterThanOrEqual(1 / 3);
    expect(lampLevel(0, LAMP_DIM, LAMP_LIT)).toBe(LAMP_DIM);
    expect(lampLevel(LAMP_FADE_S, LAMP_DIM, LAMP_LIT)).toBe(LAMP_LIT);
    // In any tenth of a second the glow moves by under a third of its range.
    for (let t = 0; t < LAMP_FADE_S; t += 0.01) {
      const d = Math.abs(lampLevel(t + 0.1, LAMP_DIM, LAMP_LIT) - lampLevel(t, LAMP_DIM, LAMP_LIT));
      expect(d).toBeLessThanOrEqual((LAMP_LIT - LAMP_DIM) / 3 + 1e-9);
    }
  });

  it("the eye's wings close the wedge to a sliver and no further", () => {
    expect(EYE_OPEN - 2 * WING_TURN).toBe(EYE_SHUT);
    expect(EYE_SHUT).toBeGreaterThan(0);
    expect(sectorPath(-45, 45)).toMatch(/^M20 20L[\d.]+ [\d.]+A17 17 0 0 1 [\d.]+ [\d.]+Z$/);
  });

  it("the static is faint, drifts slowly at an even light and fades out rather than cutting", () => {
    expect(STATIC_OPACITY).toBeLessThanOrEqual(0.5);
    expect(STATIC_DRIFT_S).toBeGreaterThanOrEqual(8);
    expect(STATIC_FADE_S).toBeGreaterThanOrEqual(1 / 3);
    // The drift is a plain slide of a tiling texture, linear, never stepped, so no frame is lighter than the last.
    expect(css).toMatch(/\.sw-static::before\s*\{[^}]*animation:\s*sw-drift[^;]*linear infinite/);
    // And it holds still for reduced motion.
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*\.sw-static::before\s*\{\s*animation:\s*none/);
  });
});
