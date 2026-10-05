// Departures (src/map/flap.ts, src/ui/flap.ts): the tiles land on their own letters within a second, the board turns
// over in a short cascade, a flip is a fold over a small area and never a change of light, and the hall clock's ring
// stays outside the globe and inside the frame.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clockRing, clockTicks } from "../src/map/flap.ts";
import {
  boardClock,
  DRUM,
  FLAP_FACE,
  flapAt,
  flapSequence,
  flipEnd,
  flipStarts,
  handAngles,
  LAND_MS,
  ROW_MS,
  rowStart,
  STEP_MS,
  STEPS,
  TILE_TOP,
  TURN_MS,
  TURN_ROWS,
  turnEnd,
} from "../src/ui/flap.ts";
import { DESIGN_GROUPS, FEATURED, THEMES } from "../src/themes.ts";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const flapCss = css.slice(css.indexOf("---- Departures (id flap"));

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const c = (i: number) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
}

describe("Departures", () => {
  it("is experimental, so it opens only from a link and stays off the Design menu", () => {
    const t = THEMES.flap;
    expect(t.experimental).toBe(true);
    expect(DESIGN_GROUPS.flatMap((g) => g.ids)).not.toContain("flap");
    expect(FEATURED).not.toContain("flap");
    expect(t.fresh).not.toBe(t.dot);
    expect(t.dotShape).toBe("square");
  });

  it("has its own colours: no amber or yellow anywhere, which is Market Terminal's", () => {
    // Hue 38 to 70 degrees at strong colour (the brass of the hall's hairlines is muted and stays under the line).
    const hsl = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
      if (!d) return { h: 0, s: 0, l };
      const sat = d / (1 - Math.abs(2 * l - 1));
      const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: (hue * 60 + 360) % 360, s: sat, l };
    };
    const own = flapCss.slice(0, flapCss.indexOf("/* ---- Desktop 95"));
    const hexes = [...own.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
    const t = THEMES.flap;
    for (const c of [...hexes, t.coast, t.dot, t.fresh, t.tuned, t.ocean, t.land]) {
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) continue;
      const k = hsl(c);
      expect(k.h >= 38 && k.h <= 70 && k.s > 0.6 && k.l > 0.25 && k.l < 0.85, `${c} is amber or yellow`).toBe(false);
    }
    expect(t.coast).not.toBe(THEMES.terminal.coast);
    expect(t.ocean).not.toBe(THEMES.terminal.ocean);
  });

  it("has a stylesheet section of its own", () => {
    expect(flapCss.length).toBeGreaterThan(1000);
    expect(flapCss).toContain(':root[data-theme="flap"]');
  });
});

describe("the flap tiles", () => {
  it("each tile passes a few letters on its drum and lands on its own", () => {
    for (const ch of [..."GlobalGist", ..."Encouragement", ..."0123456789"]) {
      const seq = flapSequence(ch);
      expect(seq).toHaveLength(STEPS + 1);
      expect(seq.at(-1)).toBe(ch);
      for (const s of seq.slice(0, -1)) expect(DRUM).toContain(s);
    }
    expect(flapSequence("G")).toEqual(["B", "C", "D", "E", "F", "G"]);
  });

  it("a blank or a letter not on the drum lands at once", () => {
    for (const ch of [" ", "\u00a0", "\u00e9", "-", "\u00df"]) expect(flapSequence(ch)).toEqual([ch]);
  });

  it("every word lands within a second, left to right", () => {
    expect(LAND_MS).toBeLessThan(1000);
    for (let n = 1; n <= 40; n++) {
      const starts = flipStarts(n);
      expect(starts[0]).toBe(0);
      for (let i = 1; i < n; i++) expect(starts[i]!).toBeGreaterThanOrEqual(starts[i - 1]!);
      expect(flipEnd(n)).toBeLessThanOrEqual(LAND_MS);
    }
  });

  it("shows its first flap at the start and its own letter at the end", () => {
    expect(flapAt(0, 0)).toBe(0);
    expect(flapAt(STEPS * STEP_MS, 0)).toBe(STEPS);
    expect(flapAt(10_000, 0)).toBe(STEPS);
    let last = 0;
    for (let t = 0; t <= 600; t += 7) {
      const k = flapAt(t, 90);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });

  it("a flip is a fold, not a change of light: the flap is the tile's own grey", () => {
    expect(Math.abs(luminance(FLAP_FACE) - luminance(TILE_TOP))).toBeLessThan(0.01);
    expect(flapCss).toContain(FLAP_FACE);
    expect(flapCss).toContain(TILE_TOP);
    expect(flapCss).toContain(`fl-fold-a ${STEP_MS}ms`);
  });

  it("the letters a fold covers at once stay far under the area that could flash", () => {
    // WCAG 2.3.1's small-area limit: a quarter of 341 by 256 pixels. A tile of the word at its biggest (72 px type,
    // a tile about an em wide and 1.25 em tall); a falling flap covers the top half of the letter, and a letter inks
    // under half of that. Count the tiles turning at the same moment for every word length.
    const limit = 0.25 * 341 * 256;
    const tile = 72 * 1 * 72 * 1.25;
    for (let n = 1; n <= 16; n++) {
      const starts = flipStarts(n);
      let most = 0;
      for (let t = 0; t <= flipEnd(n); t += 5) most = Math.max(most, starts.filter((s) => t >= s && t < s + STEPS * STEP_MS).length);
      expect(most * tile * 0.5 * 0.5, `${n} letters`).toBeLessThan(limit);
    }
  });
});

describe("the board turning over", () => {
  it("cascades top to bottom and ends within a second", () => {
    for (let i = 1; i < 40; i++) expect(rowStart(i)).toBeGreaterThanOrEqual(rowStart(i - 1));
    expect(rowStart(100)).toBe(TURN_ROWS * ROW_MS);
    expect(turnEnd(100)).toBeLessThan(1000);
    expect(turnEnd(0)).toBe(0);
  });

  it("runs at the times the stylesheet uses", () => {
    expect(flapCss).toContain(`fl-turn ${TURN_MS}ms`);
    expect(flapCss).toContain(`* ${ROW_MS}ms`);
  });

  it("holds still for reduced motion", () => {
    const reduce = flapCss.slice(flapCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduce).toContain(".lt::before");
    expect(reduce).toContain(".fl-turn");
    expect(reduce).toContain("animation: none");
  });
});

describe("the hall clock", () => {
  it("rings the globe outside its edge and inside the frame at the widest zoom", () => {
    const scale = THEMES.flap.globeScale ?? 0.46;
    for (let side = 160; side <= 2400; side += 40) {
      const R = side * scale;
      const ring = clockRing(R);
      expect(ring.inner).toBeGreaterThan(R);
      expect(ring.outer, `frame ${side}`).toBeLessThanOrEqual(side / 2);
      const ticks = clockTicks(R);
      expect(ticks).toHaveLength(60);
      expect(ticks.filter((t) => t.hour)).toHaveLength(12);
      for (const t of ticks) {
        expect(t.r0).toBeGreaterThan(ring.inner);
        expect(t.r1).toBeLessThan(ring.outer - ring.rim);
      }
    }
  });

  it("sets its hands to the time", () => {
    expect(handAngles(3, 0)).toEqual({ hour: 90, minute: 0 });
    expect(handAngles(18, 30)).toEqual({ hour: 195, minute: 180 });
  });

  it("writes a report's time as hours and minutes", () => {
    expect(boardClock(Date.UTC(2026, 9, 3, 12, 5) / 1000)).toMatch(/^\d\d:\d\d$/);
  });
});
